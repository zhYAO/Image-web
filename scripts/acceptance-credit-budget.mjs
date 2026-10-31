import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Separate from the historical image-count ledger: includes chat and copy fees.
export const CREDIT_LIMIT_MINOR = 1000;
export const FIRST_PASS_LIMIT_MINOR = 600;
const states = new Set(['reserved', 'submitted', 'succeeded', 'rejected', 'unknown']);
const phases = new Set(['first', 'retest']);
const operations = new Set(['image', 'chat', 'optimize']);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
const amount = value => Number.isSafeInteger(value) && value >= 0;

export function validateCreditBudget(ledger) {
  if (ledger?.version !== 1 || ledger.limitMinor !== CREDIT_LIMIT_MINOR
    || ledger.firstPassLimitMinor !== FIRST_PASS_LIMIT_MINOR || !text(ledger.runId)
    || !Array.isArray(ledger.attempts)) throw new Error('Invalid credit ledger; never reset a run.');
  const cases = new Set();
  const requests = new Set();
  let committedMinor = 0;
  let firstPassMinor = 0;
  for (const item of ledger.attempts) {
    if (!text(item.caseId) || cases.has(item.caseId) || !text(item.quoteVersion)
      || !operations.has(item.operation) || !phases.has(item.phase) || !states.has(item.status)
      || !amount(item.quotedMinor) || item.quotedMinor === 0
      || (item.actualMinor !== undefined && !amount(item.actualMinor))
      || (item.requestId !== undefined && (!text(item.requestId) || requests.has(item.requestId)))) {
      throw new Error('Invalid or duplicated credit attempt.');
    }
    cases.add(item.caseId);
    if (item.requestId !== undefined) requests.add(item.requestId);
    // Rejections/refunds never replenish this run. Unexpected higher charges
    // remain visible and stop future reservations instead of hiding an overrun.
    const committed = Math.max(item.quotedMinor, item.actualMinor ?? 0);
    committedMinor += committed;
    if (item.phase === 'first') firstPassMinor += committed;
  }
  if (!Number.isSafeInteger(committedMinor)) throw new Error('Invalid credit total.');
  return { ledger, committedMinor, firstPassMinor,
    remainingMinor: Math.max(0, CREDIT_LIMIT_MINOR - committedMinor),
    exceeded: committedMinor > CREDIT_LIMIT_MINOR || firstPassMinor > FIRST_PASS_LIMIT_MINOR };
}

export function readCreditBudget(file) {
  return validateCreditBudget(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function updateCreditBudget(file, command, input = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  fs.mkdirSync(lock);
  try {
    if (command === 'init' && fs.existsSync(file)) return readCreditBudget(file);
    const ledger = command === 'init'
      ? { version: 1, runId: randomUUID(), limitMinor: CREDIT_LIMIT_MINOR,
        firstPassLimitMinor: FIRST_PASS_LIMIT_MINOR, createdAt: new Date().toISOString(), attempts: [] }
      : readCreditBudget(file).ledger;
    if (command === 'reserve') {
      const previous = validateCreditBudget(ledger);
      if (previous.exceeded) throw new Error('Credit budget already exceeded; reconcile first.');
      if (ledger.attempts.some(item => ['reserved', 'submitted', 'unknown'].includes(item.status))) {
        throw new Error('Reconcile the pending attempt before another paid operation.');
      }
      if (!amount(input.availableMinor) || !amount(input.quotedMinor) || input.quotedMinor > input.availableMinor) {
        throw new Error('The current available wallet balance cannot cover this quote.');
      }
      ledger.attempts.push({ caseId: input.caseId, phase: input.phase, operation: input.operation,
        quoteVersion: input.quoteVersion, quotedMinor: input.quotedMinor,
        status: 'reserved', reservedAt: new Date().toISOString() });
      if (validateCreditBudget(ledger).exceeded) throw new Error('Credit budget would be exceeded.');
    } else if (command === 'record') {
      const item = ledger.attempts.find(attempt => attempt.caseId === input.caseId);
      if (!item || !states.has(input.status) || input.status === 'reserved') throw new Error('Invalid result.');
      if (['succeeded', 'rejected'].includes(item.status) && input.status !== item.status) throw new Error('Terminal result is immutable.');
      if (item.status === 'unknown' && input.status === 'submitted') throw new Error('Do not resubmit an unknown request.');
      if (!text(input.evidence)) throw new Error('Result evidence is required.');
      if (input.requestId !== undefined && item.requestId !== undefined && item.requestId !== input.requestId) throw new Error('Request identity is immutable.');
      if (input.actualMinor !== undefined && item.actualMinor !== undefined && input.actualMinor < item.actualMinor) throw new Error('Recorded spend cannot decrease.');
      Object.assign(item, { status: input.status, evidence: input.evidence, updatedAt: new Date().toISOString() });
      if (input.actualMinor !== undefined) item.actualMinor = input.actualMinor;
      if (input.requestId !== undefined) item.requestId = input.requestId;
    } else if (command !== 'init') throw new Error('Unknown command.');
    const result = validateCreditBudget(ledger);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return result;
  } finally { fs.rmdirSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'status', file, inputFile] = process.argv.slice(2);
  if (!file) throw new Error('Usage: acceptance-credit-budget.mjs COMMAND LEDGER [INPUT_JSON]');
  const result = command === 'status' ? readCreditBudget(file)
    : updateCreditBudget(file, command, inputFile ? JSON.parse(fs.readFileSync(inputFile, 'utf8')) : {});
  console.log(JSON.stringify(result, null, 2));
}
