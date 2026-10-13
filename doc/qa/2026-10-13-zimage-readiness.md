# ZImage plan review and bounded follow-up

Plan: [reviewed execution plan](../../docs/superpowers/plans/2026-10-13-zimage-readiness.md).

## Reviewed state and scope

Starting main `1a3eba2891ff0c659a530eed01bcdde67e4f9ea6`; PR9 `c274e14f2a7ad54f7269edf40b5481e314b0e665`, PR10 `585e9e153554293ac13884ffbe65a150dbb59a09`. PR9 CI57 and PR10 CI62 were inspected: quality/database success, production jobs skipped. Initial combined tree had document conflicts only in requirements/progress.

Subsequent specific user approval covered PR9 merge/publication and original upload-only verification. PR9 was marked ready and merged as `4659d8aeccde752b8d96c06e784082e481204ad1`, triggering [main CI63](https://github.com/zhYAO/Image-web/actions/runs/38367930499). PR10 deployment, database migration/pruning/scheduling/permissions, and model calls remain outside scope. Original upload verification is owned by the main conversation.

CI63 finished successfully at 2026-10-13 08:52 UTC: quality, database, production-build and deploy all success; rollback skipped. Deployment logs supplied 12 loopback/public checks: health200/no-store with exact expected/actual SHA `4659d8aeccde752b8d96c06e784082e481204ad1`, unauthorized account401, three retired POST routes410/no-store, and retired page404 on each origin. Remote main still matched that SHA after deployment. This establishes publication/version/these routes; it does not establish authenticated original upload, live carousel interaction or Plan image quality.

Subsequent original-image verification: the main conversation reported one production save at 08:55:55.863 UTC, confirmed a saved v1 draft with one reference/zero generated images and unchanged available balance5.51. At08:59 UTC this task queried only the provided session/task IDs in a read-only5s-timeout transaction: one PNG1536×2048/2,484,415B active/ready and a present Storage object; commerce runs/items, session generation batches/generations and session credit operations all0. Since08:55:50 UTC, the same account had0 new credit operations and0 reserve/capture ledger rows. Wallet available551minor matched UI5.51; current frozen60minor was recorded separately, without changing/investigating older holds. This establishes successful original upload/draft and no new charge in the tested window; it does not establish generated image fidelity or a downloaded-original hash comparison. IDs and raw record stay in Library, not git. This task did not upload or invoke a model.

The main conversation also reported a successful read-only production carousel check: first group1–3/5 with three cards automatically changed as a whole to4–5/5 with two cards; no sliding2–4 window and no previous/next/play/pause controls. Together with the original upload/draft and billing check, PR9 acceptance is complete for this scope. No expanded real-touch-device or Plan quality claim follows.

The follow-up branch is based on this new main. All 25 paths changed by original PR10 under apps/packages/supabase/.github/ops retain exact original bytes, preserving both approved upload/three-card behavior and PR10 controls. Requirements/progress retain every original line from PR9, PR10 and their common base. Original PR10 branch is unchanged; the follow-up draft provides a resolved integration tree for review.

Independent read-only static review found no actionable Critical/Important/Minor findings in combined source, upload/apparel format boundaries, independent default-off controls, claim ownership/lease/budgets, dormant retention, benchmark limitations or manifest correctness. No new runtime behavior was added. Final evidence documents were checked by the executor after that review.

## Verification record

- lint/typecheck passed; `pnpm test:run` Domain 76/76 and Web 687/687; Worker 80/80, acceptance budget 5/5, performance-script safety/statistics 8/8 and ops 20/20 all passed. One isolated Webpack build with `NEXT_DIST_DIR=.next-build-qa`, one CPU and 4 GiB V8 heap completed successfully. Its generated cache was removed after checking no active Next process owned it. Existing Sentry global-error-handler warnings are unchanged, not a new runtime failure.
- No dev server, long memory investigation, browser automation, model request or paid test was started. Local tests, benchmark and build are sequential.
- The three-case one-pair pilot is a correctness/resource check only. It cannot prove a P95 non-regression gate, cold/steady behavior, fast Storage overhead, real-load throughput, full-page/private UI readiness or production memory safety. Both optimization flags remain default off; source reuse/visible-loading savings are therefore absent in production.
- Bounded raw evidence, logs, input/bundle/runner fingerprints and the exact Cron batch are stored separately in the [Library evidence archive](https://chatgpt.com/api/library/files/libfile_505a1272e2888191be16778b7bb2b2d5/download). Repository documents keep conclusions, necessary aggregates and verification methods. Normal 750×1000: 14→7 reads, 11 output hashes equal. Encoded-overbudget 10 MiB/20 displays: 52→52 reads, 30 hashes equal. Actual 12MP: 14→13 reads, 11 hashes equal. Both modes release retained bytes to zero. Each case is only one pair; no latency percentile is reported as acceptance.
- One guarded five-claim 12MP reuse wave required 2,456,741,888 B headroom and started with 16,819,630,080 B available. All 55 outputs matched the serial baseline digest; reads 66 versus 65 for five unconstrained serial reuse claims verifies an actual additional fallback. Estimated requested encoded retention 36,672,325 B exceeds the 33,554,432 B process cap; observed peak was 29,338,061 B and final zero. Fresh process maxRSS was 737,505,280 B, including input preloading, imports, Sharp/font/native caches; this is not a 32 MiB RSS promise or causal performance improvement. One wave cannot establish sustained capacity. The owned child had a 60s bound and 250ms low-headroom guard.
- Fontconfig emitted unwritable-cache-directory warnings during the synthetic harness; explicit bundled fonts still produced matching output hashes. This reinforces the limits on timing/cache/production conclusions. No 120-pair `measure` series was run.
- Direct cloud-environment HTTPS requests to the production domain were blocked by the environment proxy (403 tunnel refusal), including with explicitly enabled network permissions. Public/loopback release evidence must be verified from the existing deployment job, with independent logged-in/original upload verification in the main conversation. Transport rejection is not an application HTTP result.

## Retention and later phases

[Read-only Cron preview and rollback limits](2026-10-13-cron-retention-preview.md) freezes successful cutoff 2026-09-29 08:15 UTC and failure cutoff 2026-09-13 08:15 UTC. It reports 53,868 eligible mapped succeeded rows, preserves 2,457 unmapped rows and all recent history, and supplies only a first 500-row exact proposed batch. Production archive/function remain absent. No DELETE, migration, grants, schedules or VACUUM were executed.

Previews/ETag/short Cron wrapper remain separate stages. Derived private previews offer potential all-views egress savings but require asset authorization/expiry/cleanup and exclusion from completed originals/ZIP. Conditional caching requires fresh authorization before 304. A shorter Cron command changes privileged runtime boundaries and requires a separately approved rollout. No implementation or production benefit is claimed for these stages.

## Rulings

- Keep both performance opt-ins off and stop at bounded correctness evidence: no zero-regression/real-load evidence. Cost: optimization savings remain deferred.
- Treat only the first exact 500-row manifest as concrete proposed scope, not the 53,868-row aggregate. Cost: later batches require their own review.
- Preserve original PR10 and publish the resolved combination as a separate draft. Cost: reviewers must use the follow-up draft for the current integration tree; no shared branch is rewritten.

The user subsequently excluded logs, raw diagnostics/performance outputs and production row manifests from repository commits. Two new JSON artifacts were removed from the local unpublished commit before any push, with original bytes retained locally and saved to Library. The temporary concurrency driver stays outside the repository; existing PR10 business/test source and configuration remain intact. The isolated build's generated Next typing paths were restored before the final typecheck.

No deferred actionable minor findings. Memory retention root cause, production business stress and four-image Plan quality remain unverified; original upload/draft and desktop production carousel are now verified as described above. Plan test authorization is handled separately by the main conversation; no generation was performed here.
