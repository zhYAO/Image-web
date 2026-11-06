# Free Worker Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Bound local image-worker requests beneath Free runtime limits while preserving once-only provider attempts and durable recovery.
**Architecture:** Keep the existing token-fenced SQL queue, submission journal, rejection journal and image-result checkpoint. Bound preparation/provider/whole-run stages and defer checkpointed upload/finalization; do not add a new queue, deployment or schema migration.
**Tech Stack:** TypeScript, Deno, Supabase RPC/Storage, Vitest fake clocks, disposable local Postgres.
**Spec:** Parent's 2026-11-05 delegation: implement locally a recoverable Free-compatible task flow, no blind retries, duplicate billing or production changes.

## Global Constraints

- Original branch and existing dirty work stay intact; no commit, push, deployment, secrets access or paid model calls.
- Supabase Free wall clock is 150 seconds per worker, CPU 2 seconds, memory 256 MB. Local budgets reduce risk but cannot guarantee runtime remaining when an existing worker serves a request.
- Queue RPC limit 10 seconds, preparation 20 seconds, provider 90 seconds, processClaim 120 seconds; reserve at least 20 seconds before starting Storage upload.
- A submitted request with no definitive receipt remains unknown. Only persisted result/rejection may recover without another provider attempt.
- No new SQL migration; preserve historical unknown rows and all wallet state.

## Review Focus

- Provider ignores cancellation and resolves late: never checkpoint/upload it after unknown/deferred return.
- Preparation completes late: never submit or continue downloading other references after its deadline.
- Checkpoint succeeds near overall deadline: defer upload and recover same object without provider call.
- Upload or completion hangs: terminate bounded work, preserve checkpoint, and token-fence late DB updates.
- Claim response arrives after timeout: do not process that claim; its lease expires under existing SQL state machine.

### Task 1: bounded stages and durable yield

**Files:** `_shared/generation-runner.ts`, `generation-worker/reliability.test.ts` under `supabase/functions`.
**Interfaces:** `processClaim(admin, claim, dependencies)` remains compatible; queue checkpoint format unchanged.
- [x] Add deadline, late-preparation, late-provider, near-deadline checkpoint/recovery and hung-upload tests; run and observe expected failures.
- [x] Implement fixed stage limits, cancellation checks between reference reads, bounded provider wait, 120-second global timeout and checkpoint yield.
- [x] Run all Worker/cleanup tests; verify old long-running test now exercises work within the Free budget.

### Task 2: bounded queue control

**Files:** same runner and `generation-worker/index.ts`; reliability test.
**Interfaces:** exported `generationQueueRpc<T>(admin, name, input?)` handles only claim/archive RPC with a 10-second timeout; handler consumes it without changing auth or provider flow.
- [x] Add hung-claim/late-result and ordinary queue response tests, observe RED.
- [x] Implement timer cleanup and bounded queue RPC; replace handler's queue calls.
- [x] Run Worker tests, native Deno checks, SQL recovery regressions, full project validation.

### Task 3: evidence and deployment gates

**Files:** `doc/project-progress.md`, `doc/commerce-package-operations.md`, task verification records.
- [x] Read-only verify known config-backup and operation metadata, without opening archive contents.
- [x] Document concrete encrypted backup destination/scope proposal; export no production data yet.
- [x] Independent review; fix important defects via RED/GREEN; record fresh final code fingerprint and tests.

## Rulings and ledger

- Parent explicitly asked local design/implementation/verification and independent progress; no additional design/execution approval card is needed.
- User required original branch; use it, preserving dirty files, rather than creating a worktree.
- Commit steps omitted because parent explicitly prohibited commits.
- Provider cannot be resumed/polled safely without supported API evidence. Timeouts use reconciliation, not an invented provider retry.
- Plan tasks 1/2 share runner and tests; complete edits before final tests and review. No competing implementer.

- Task1 complete: five initial RED cases, stage/late-cancel GREEN;132 Worker tests after review fixes.
- Task2 complete: queue control RED→GREEN; native five checks/four auth tests pass, SQL224 assertions/four races pass. Full regression270/195/1308 and lint/type/budget/frontend/Web builds passed; original user files preserved.
- Final review: two P2 findings fixed in one pass via three failing tests, including observed Vitest unhandled rejection; full Worker suite132/132 green. No deferred minors reported.
- Ruling: no new schema/queue protocol because existing durable SQL recovery satisfies the required boundaries; cost if wrong would be unresumable work, covered by real local transaction recovery tests. Hosted gateway still a separate gate.

- Task3 complete within local/read-only scope: backup metadata and concrete encrypted destination/tooling/restore proposal recorded; no real export. Root policy and migration-aware paired rollback remain production gates, not silently repaired.
- Final whole-candidate fingerprint and all current checks: see task verification/free-runtime-final-acceptance.json. No commit, push, production migration/deployment, purchase, credential value access or paid model call.
