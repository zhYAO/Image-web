import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateCreditBudget as update, readCreditBudget as read } from './acceptance-credit-budget.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zimage-credit-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'ledger.json');
  update(file, 'init');
  return file;
}
const quote = (caseId, quotedMinor, phase = 'first') => ({ caseId, phase, quotedMinor, operation: 'image', quoteVersion: 'catalog-v1', availableMinor: 1000 });
const finish = (file, caseId, status = 'succeeded') => update(file, 'record', { caseId, status, evidence: 'Observed task and credit result' });

test('enforces first-pass and whole-run caps across image, chat and optimization', t => {
  const file = fixture(t);
  update(file, 'reserve', quote('image', 500)); finish(file, 'image');
  update(file, 'reserve', { ...quote('text', 100), operation: 'optimize' }); finish(file, 'text');
  assert.throws(() => update(file, 'reserve', quote('extra-first', 1)), /exceeded/);
  update(file, 'reserve', { ...quote('retest', 400, 'retest'), operation: 'chat' }); finish(file, 'retest');
  assert.throws(() => update(file, 'reserve', quote('extra', 1, 'retest')), /exceeded/);
  assert.equal(read(file).committedMinor, 1000);
});
test('checks the live available balance and never replenishes refunds or resets', t => {
  const file = fixture(t);
  assert.throws(() => update(file, 'reserve', { ...quote('costly', 400), availableMinor: 341 }), /balance/);
  update(file, 'reserve', quote('first', 100)); finish(file, 'first', 'rejected');
  update(file, 'init');
  assert.equal(read(file).committedMinor, 100);
  assert.throws(() => update(file, 'reserve', quote('first', 100)), /duplicated/);
});
test('pending and unknown operations block subsequent spend until evidenced reconciliation', t => {
  const file = fixture(t);
  update(file, 'reserve', quote('first', 30));
  assert.throws(() => update(file, 'reserve', quote('next', 30)), /pending/);
  finish(file, 'first', 'unknown');
  assert.throws(() => update(file, 'record', { caseId: 'first', status: 'succeeded' }), /evidence/);
  assert.throws(() => finish(file, 'first', 'submitted'), /resubmit/);
  finish(file, 'first');
  update(file, 'reserve', quote('next', 30));
});
test('retains unexpected higher charges, freezes identity and prevents further spend', t => {
  const file = fixture(t);
  update(file, 'reserve', quote('first', 30));
  update(file, 'record', { caseId: 'first', status: 'succeeded', actualMinor: 1001, requestId: 'request-one', evidence: 'Observed ledger charge exceeds quote' });
  assert.equal(read(file).exceeded, true);
  assert.throws(() => update(file, 'reserve', quote('next', 1)), /already exceeded/);
  assert.throws(() => update(file, 'record', { caseId: 'first', status: 'succeeded', actualMinor: 30, evidence: 'refund' }), /decrease/);
  assert.throws(() => update(file, 'record', { caseId: 'first', status: 'succeeded', requestId: 'request-two', evidence: 'other' }), /identity/);
});
test('invalid amounts, corrupted ledgers and concurrent writers fail closed', t => {
  const file = fixture(t);
  for (const value of [0, -1, 0.5, NaN, Infinity]) assert.throws(() => update(file, 'reserve', quote('invalid', value)));
  fs.mkdirSync(`${file}.lock`);
  assert.throws(() => update(file, 'reserve', quote('locked', 30)), /EEXIST/);
  fs.rmdirSync(`${file}.lock`);
  fs.writeFileSync(file, '{}');
  assert.throws(() => update(file, 'init'), /Invalid/);
});
