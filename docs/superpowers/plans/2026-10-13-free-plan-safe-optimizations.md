# Free Plan safe optimizations

Goal: reduce avoidable reads and bound private image memory without changing generation cadence, output bytes or authorization. Provide a dormant, explicitly approved Cron-history cleanup mechanism and bounded operations guidance.
Architecture: single-claim source admission cache; visible-only result image mounting in the existing scroll container; owner-only, unscheduled SQL function archives approved terminal Cron rows before deleting exactly those IDs.
Tech stack: TypeScript, React/AntD, Sharp, PostgreSQL/pgTAP.
Spec: doc/requirements.md, 2026-10-13 optimization scope. User authorized implementation, review and separate PR; no production migration, merge, schedule or deletion.

## Global constraints

- Preserve all prior branches and user changes. Start from main 1a3eba2 in the existing isolated worktree. PR #9 remains separate.
- No model calls, user photos, credentials, production mutations, policies/grants or scheduling changes.
- Keep generation every minute and cleanup every 15 minutes; original and ZIP bytes unchanged; private authorization and deletion revocation remain authoritative.
- Cache only inside one authorized owner/session/task/run/claim closure. Admit at most 8 MiB per claim, 32 MiB across readers in a Node process. No eviction churn, failed values or cross-claim reuse; over-budget reads use the baseline loader. Release in finally, including pending reads. This limits retained source bytes, not Sharp/native/total RSS.
- Real result cards mount images only when visible. With no derivative images, first visible request still transfers the original. Open original on demand; do not preload all PreviewGroup items.
- Cron code is dormant DDL. Explicit current job IDs, frozen UTC cutoffs (success >=14d, failure >=30d), exact run IDs/count and approval reference required. Maximum 500 rows/call; archived metadata excludes command and return_message. Archive-before-delete is atomic, total archive capped at 100000 rows. No automatic archive purge.
- Derived previews/ETag and short Cron wrappers deferred: require separate asset lifecycle/authorization and Vault/role/scheduling review.

## Tasks

1. Write source cache and service regression tests, observe RED. Implement bounded admission and temporary Storage failure classification. GREEN focused service/cache/renderer tests. Compare synthetic renderer output SHA-256, source reads, P95 and fresh-process peak RSS to baseline; report fixture limits.
2. Write visibility/original-opening tests, observe RED. Implement visible-only cards with the aside scroll root, account/run remount and on-demand original. GREEN workspace/image tests; verify ZIP tests untouched and passing.
3. Generate dormant SQL migration using Supabase CLI. Write isolated pgTAP tests, observe RED. Implement owner-only bounded approval mechanism, archive whitelist and rollback. GREEN temporary local PostgreSQL and CI pgTAP, no production apply.
4. Document Log Query window/projection/query budget and snapshot limitations. Update requirements/progress with scope/evidence. Run lint, typecheck, unit, Worker, acceptance-budget, operations, database and build checks. Fresh whole-branch review; fix material findings. Commit/push independent branch and create draft PR; inspect CI.

## Review focus

Authorization on cache hits and lease loss; dispose while downloading; aggregate accounting and oversized fallback; failure classification without automatic model retry; native memory vs source-byte budget; nested scroll visibility and AntD preload; private original revocation/ZIP fidelity; Cron exact IDs, job mapping, race/locks, rollback and inaccessible roles; migration must not execute cleanup or install schedules; no performance claims for real users without load evidence.

## Native Cron compatibility ruling after CI58

Upstream native defaults expose SELECT (job), SELECT/DELETE (history) with owner RLS; Supabase may retain additional history permissions, which this implementation does not change. Explicit FOR UPDATE/KEY SHARE requires unauthorized UPDATE grants. Keep native privileges: archive first, then DELETE using current mapping and identical archived metadata; row/count changes abort the transaction. Only the disposable CI administrator seeds inactive rows; pgTAP and the function use normal postgres. Verify the old function RED under these permissions and the new 31 checks GREEN. No production permission or schedule change.
