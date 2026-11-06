# Paired Release Preparation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded preparation. No production activation is included.

**Goal:** Make the remaining release gates concrete, test failure/recovery decisions without credentials, and give the user a safe local read-only login verifier.

**Architecture:** Keep the existing independent backend release guard unchanged. A draft paired policy binds the exact Mac-built/Linux-verified artifacts and migration6, with explicit pre/post-migration failure rules. A local verifier session wraps the reviewed fixed GET-only verifier, accepts a cookie only through a real hidden terminal prompt, and writes only redacted nonce-bound receipts.

**Tech Stack:** Existing Python3.12/standard library, reviewed verify.py, existing isolated PostgreSQL17 and Node24 tools. No installs, new accounts, secrets, paid model requests or production writes.

**Spec:** doc/separation/20261106-runtime-reuse-checkpoint.md and the parent instruction to prepare/validate the paired release and safe login handoff.

## Global Constraints

- Original branch and original next-env/23 local env entries remain intact; application identity stays7a811b326aa4b344cee08bc5a33c04e44a780fd4.
- No ordinary backend/first-window/old opened manual operation may be used to conceal a schema change.
- Never automatically downgrade financial APIs, restore a database, retry unknown suppliers, refund history or reopen after an uncertain write-open boundary.
- A failed check after migration6 defaults to sealed maintenance and forward repair; restoring an old pair requires independently proved compatibility with the actual remaining database, not a guessed schema label.
- All new provider/price gates remain disabled. The default migration6 closes all new chat tariffs; operational readiness must explicitly address the resulting chat availability.
- The user enters any login credential on zhao Mac personally; never in chat, argv, env files, logs, SSH/SCP or the agent's input tools.

## Review Focus

- An expired or wrong-operation challenge causes no authenticated requests or receipt.
- Symlinks, hardlinks, weak permissions and concurrent request replacement cannot redirect credential-bearing work or overwrite output.
- Missing/invalid live-session or pricing dependencies never mint an authenticated success receipt.
- A migration may commit while the tool response is lost; do not replay it or reopen on a timeout.
- Old tabs/new catalogs and disabled tariffs are separate from API liveness; refresh and live compatibility checks remain mandatory.

## Task1: Local safe verifier session

- [x] Add failing tests for scope/freshness, private file handling, redaction, duplicate nonce handling and hidden-input refusal.
- [x] Implement ops/aliyun/backend/verify-session.py using the existing verify.verify/public_fetch implementation. No alternate destinations or mutation transport.
- [x] Run new tests and existing backend verifier tests, retain RED/GREEN evidence, then independent review.
- [x] Write the exact Chrome + Terminal handoff and operator request/receipt transfer sequence. Do not start it with real credentials.

## Task2: Bound paired policy and recovery validation

- [x] Record a non-executable draft policy with exact artifact/migration identities and missing evidence as missing, never success.
- [x] Exercise pre-migration rollback, migration uncertainty, post-migration check failure, pointer drift and writes-open uncertainty against the unchanged transaction guard and a pure decision table.
- [x] In disposable local PG17, show pre/post migration6 catalog/admission behavior and preservation of existing synthetic records; no production data or backup.
- [x] Record fixed root paths/capabilities that a future reviewed paired coordinator would need; current tools remain unmodified and uninstalled.
- [x] Update project progress and report precise user-dependent gates. No production maintenance or migration is started during preparation.

Preparation complete: 19 local-session cases and token-catalog compatibility covered; actual privileged paired coordinator remains an explicitly separate implementation/installation gate, not a hidden completed item. No live credentials or production changes.
