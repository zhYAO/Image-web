# ZImage remaining work: reviewed execution plan

Goal: release specifically approved PR9, validate PR10 in isolation, and prepare a read-only Cron retention preview.
Spec: current delegated scope, `doc/requirements.md`, `doc/project-progress.md`, and existing performance/memory QA reports.

## Scope and decisions

- PR9 head `c274e14f2a7ad54f7269edf40b5481e314b0e665`, PR10 head `585e9e153554293ac13884ffbe65a150dbb59a09`; starting remote main `1a3eba2891ff0c659a530eed01bcdde67e4f9ea6`. Both drafts, both existing CI runs green.
- Initial combination via `git merge-tree` has only two document conflicts: requirements and progress. Application files compose without textual conflicts. Resolve by preserving both histories and all requirements, then record current evidence above historical snapshots.
- User's subsequent explicit PR9 approval permits marking that draft ready and merging that exact head using the existing main auto-release workflow. Approval does not extend to PR10, production database migrations/deletion/scheduling/permissions, or model requests. Main updates trigger deployment, so no documentation-only main pushes.
- PR10 optimization flags stay default off. Pilot hashes/read counts are correctness evidence; short timings cannot meet zero-regression P95 or real-load acceptance. No long series, dev server, leak tracing, or browser automation. Timed harness, tests and build execute sequentially.
- Keep original file upload production verification with the main conversation. This environment checks deployment SHA and harmless public endpoints only.
- Updated user constraint: repository commits contain business code, existing necessary tests/configuration and concise documents only. Keep logs, raw diagnostic/performance outputs, transient generated build paths, screenshots/traces and production row manifests outside git; preserve them locally and save permitted evidence separately to Library. No new diagnostic driver is committed.

## Tasks

1. Verify PR9 exact head, remote main, CI57 quality/database and existing release workflow; mark ready and merge only PR9. Follow the resulting main workflow and independently verify public health SHA, login/static resources, unauthorized account, and retired endpoints. Stop on review rejection; do not circumvent it.
2. Create a temporary isolated PR9+PR10 checkout, resolve only both document conflicts, and validate combined sources. Run existing unit suites, lint/typecheck, acceptance budget, Worker/ops checks and one bounded build sequentially. Use existing fixture prepare/pilot (three one-pair cases) plus bounded shared-budget correctness only; never run the 120-pair measure phase. If no application defect is found, make no speculative behavior change.
3. In Supabase `klmiycyesxnpinxpeqep`, freeze UTC retention cutoffs, run read-only aggregate preview under timeout, and report mapped job/status counts, excluded rows, range and first at-most-500 exact run IDs. Do not read Cron command/return_message, Vault, user records or broad logs. Prepare metadata archive/recovery limitations and remaining approval checklist; execute no pruning/migration/schedule/VACUUM.
4. Record final conclusions/aggregates/verification methods in QA and project-progress, preserve PR9 history/requirements in PR10 readiness branch, and submit a draft PR without deploying. Save raw evidence and exact row manifests to Library, never git. Existing database CI62 remains evidence for unchanged migration; new draft CI must be inspected separately. Report verified, unverified and approval-required items to the main conversation.

## Risks and priorities

- PR9 first: current upload bug affects usage; release needs full workflow completion, not only PR CI. Original upload still requires main-conversation verification.
- PR10 second: no established real-load tail-latency benefit; default-off path gives no source reuse/visible-loading savings. Cron archive migration does not reclaim history until separately approved execution.
- Preview thumbnails: highest potential all-views egress benefit, but needs separate private assets, ownership, retention and ZIP exclusion design. ETag: only after fresh authorization; ensure logout/expiry/deletion revoke access. Short Cron wrapper: changes privileged execution and needs separate approval, lower priority than scoped retention. Do not implement these later phases in this task.
- Preserve unmapped jobs, unfinished/unknown statuses, recent history and credit audit data. Metadata-only archive cannot restore original command/return_message; post-commit pruning cannot be fully reversed. No promise that physical database size drops immediately.

## Verification outcomes

PR9 published as `4659d8aeccde752b8d96c06e784082e481204ad1`; CI63 and12 deployment loopback/public checks passed. Combined local lint/typecheck, Domain76/Web687/Worker80/budget5/performance-script8/ops20 and isolated build passed; bounded three-case one-pair and one five-claim wave preserved output hashes and released source bytes. Both flags remain off. Read-only Cron aggregate/first500 package is ready, with raw evidence in Library. Full results and limits: `doc/qa/2026-10-13-zimage-readiness.md`. No green CI claim substitutes for performance acceptance or production upload evidence.
