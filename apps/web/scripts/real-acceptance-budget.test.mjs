import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateBudget, readBudget, IMAGE_LIMITS } from './real-acceptance-budget.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zimage-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'budget.json');
  updateBudget(file, 'init');
  return file;
}
const attempt = (caseId, category = 'ordinary', count = 1) => ({ caseId, category, count, provider: 'seedream' });

test('reinitialization preserves consumed budget and duplicate cases cannot submit again', t => {
  const file = fixture(t);
  updateBudget(file, 'reserve', attempt('first', 'ordinary', 4));
  updateBudget(file, 'record', { caseId: 'first', status: 'rejected' });
  updateBudget(file, 'init');
  assert.equal(readBudget(file).attempts[0].count, 4);
  assert.throws(() => updateBudget(file, 'reserve', attempt('first')), /already reserved/);
});
test('24 image ceiling and category ceilings survive separate calls', t => {
  const file = fixture(t);
  for (const [category, count] of Object.entries(IMAGE_LIMITS)) updateBudget(file, 'reserve', attempt(category, category, count));
  assert.equal(readBudget(file).attempts.reduce((n, x) => n + x.count, 0), 24);
  assert.throws(() => updateBudget(file, 'reserve', attempt('extra')), /Budget exceeded/);
  assert.equal(readBudget(file).attempts.length, 4);
});
test('Gemini and malformed counts fail before reserving budget', t => {
  const file = fixture(t);
  assert.throws(() => updateBudget(file, 'reserve', { ...attempt('gemini'), provider: 'gemini' }), /Only Seedream/);
  for (const count of [0, -1, 1.5, NaN]) assert.throws(() => updateBudget(file, 'reserve', attempt('invalid', 'ordinary', count)));
  assert.equal(readBudget(file).attempts.length, 0);
});
test('unknown results block new generation until evidence-backed reconciliation', t => {
  const file = fixture(t);
  updateBudget(file, 'reserve', attempt('unknown'));
  updateBudget(file, 'record', { caseId: 'unknown', status: 'unknown' });
  assert.throws(() => updateBudget(file, 'reserve', attempt('next')), /Unknown provider/);
  assert.throws(() => updateBudget(file, 'record', { caseId: 'unknown', status: 'rejected' }), /evidence/);
  updateBudget(file, 'record', { caseId: 'unknown', status: 'rejected', evidence: 'Provider request confirmed rejected' });
  updateBudget(file, 'reserve', attempt('next'));
  assert.equal(readBudget(file).attempts.length, 2);
});
test('missing, corrupt and locked ledgers cannot silently start a new run', t => {
  const file = fixture(t);
  fs.mkdirSync(`${file}.lock`);
  assert.throws(() => updateBudget(file, 'reserve', attempt('locked')), /EEXIST/);
  fs.rmdirSync(`${file}.lock`);
  fs.writeFileSync(file, '{}');
  assert.throws(() => updateBudget(file, 'init'), /Invalid budget/);
  fs.unlinkSync(file);
  assert.throws(() => updateBudget(file, 'reserve', attempt('missing')), /ENOENT/);
});
