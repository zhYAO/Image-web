import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const IMAGE_LIMITS = Object.freeze({ ordinary: 6, commerce: 12, edit: 2, retest: 4 });
const statuses = new Set(['reserved', 'submitted', 'succeeded', 'rejected', 'unknown']);

function validate(ledger) {
  if (ledger.version !== 1 || ledger.limit !== 24 || !Array.isArray(ledger.attempts)) {
    throw new Error('Invalid budget ledger; do not reset it to resume generation.');
  }
  const ids = new Set();
  const requests = new Set();
  for (const item of ledger.attempts) {
    if (!item.caseId || ids.has(item.caseId) || !item.requestId || requests.has(item.requestId)
      || item.provider !== 'seedream' || !Object.hasOwn(IMAGE_LIMITS, item.category)
      || !Number.isInteger(item.count) || item.count < 1 || !statuses.has(item.status)) {
      throw new Error('Invalid or duplicated attempt in budget ledger.');
    }
    ids.add(item.caseId);
    requests.add(item.requestId);
  }
  for (const category of Object.keys(IMAGE_LIMITS)) {
    if (ledger.attempts.filter(x => x.category === category).reduce((n, x) => n + x.count, 0) > IMAGE_LIMITS[category]) {
      throw new Error(`Budget exceeded: ${category}`);
    }
  }
  return ledger;
}

export function readBudget(file) {
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function updateBudget(file, command, input = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  fs.mkdirSync(lock); // Fail closed if another writer owns the ledger.
  try {
    if (command === 'init') {
      if (fs.existsSync(file)) return readBudget(file); // Never reset an existing run.
      const ledger = { version: 1, limit: 24, runId: input.runId ?? randomUUID(), createdAt: new Date().toISOString(), attempts: [] };
      fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      return ledger;
    }
    const ledger = readBudget(file);
    if (command === 'reserve') {
      if (input.provider !== 'seedream') throw new Error('Only Seedream is authorized.');
      if (!input.caseId || !Object.hasOwn(IMAGE_LIMITS, input.category)
        || !Number.isInteger(input.count) || input.count < 1) throw new Error('Require case ID, category and positive image count.');
      const existing = ledger.attempts.find(x => x.caseId === input.caseId);
      if (existing) throw new Error(`Case already reserved (${existing.requestId}); inspect its result, never submit it again automatically.`);
      if (ledger.attempts.some(x => x.status === 'unknown')) throw new Error('Unknown provider result: reconcile before any new generation.');
      ledger.attempts.push({ ...input, requestId: randomUUID(), status: 'reserved', reservedAt: new Date().toISOString() });
    } else if (command === 'record') {
      const attempt = ledger.attempts.find(x => x.caseId === input.caseId);
      if (!attempt) throw new Error('Reserve the attempt before recording its result.');
      if (!statuses.has(input.status) || input.status === 'reserved') throw new Error('Invalid result status.');
      if (['succeeded', 'rejected'].includes(attempt.status) && input.status !== attempt.status) throw new Error('Terminal result cannot be overwritten.');
      if (attempt.status === 'unknown' && input.status !== 'unknown' && !input.evidence?.trim()) throw new Error('Reconciliation requires upstream evidence.');
      Object.assign(attempt, { status: input.status, updatedAt: new Date().toISOString() });
      if (input.evidence) attempt.evidence = input.evidence;
      if (input.generationIds) attempt.generationIds = input.generationIds;
    } else throw new Error('Unknown budget command.');
    validate(ledger);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return ledger;
  } finally { fs.rmdirSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    ledger: { type: 'string' }, case: { type: 'string' }, category: { type: 'string' },
    provider: { type: 'string' }, count: { type: 'string' }, status: { type: 'string' },
    evidence: { type: 'string' }, generations: { type: 'string' },
  } });
  if (!values.ledger) throw new Error('An explicit persistent --ledger path is required.');
  const command = positionals[0] ?? 'status';
  const ledger = command === 'status' ? readBudget(values.ledger) : updateBudget(values.ledger, command, {
    caseId: values.case, category: values.category, provider: values.provider,
    count: values.count === undefined ? undefined : Number(values.count), status: values.status,
    evidence: values.evidence, generationIds: values.generations?.split(',').filter(Boolean),
  });
  const used = ledger.attempts.reduce((n, x) => n + x.count, 0);
  console.log(JSON.stringify({ ...ledger, used, remaining: 24 - used }, null, 2));
}
