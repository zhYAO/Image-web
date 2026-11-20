# GitHub Actions: isolated release candidates

This workflow is an additive first step. It does not replace `ci.yml`, its
manual quality/database checks, existing branch protection or the production
release/rollback gates. It never connects to ECS, uses production secrets,
executes a production receipt or publishes a site. Do not use its artifacts as
inputs to the existing production workflow.

## After merging into protected main

A push to protected `main` automatically builds the backend and frontend once,
bound to that event's exact commit, run ID, and attempt. The frontend nominates
the backend of that same commit. No release version, run ID or attempt needs to
be typed. Manual dispatch is only an optional single-component diagnostic and
can nominate a different backend for that frontend test; it cannot promote.

1. Create `release-rehearsal` before merging and restrict it to protected
   `main`. Keep it secretless. Required reviewers are optional for the rehearsal
   boundary; the eventual production environment must require independent
   reviewers and disallow self-review and administrative bypass where available.
2. Supply `ZIMAGE_RELEASE_TARGET_JSON` with the independently verified ECS
   target. The named runner is not compatibility evidence: the packer verifies
   exact Node, ABI, platform and glibc. Backend uses model-only schema 3 and
   re-verifies the cold transport closure after assembly of the transport.
   It does not embed production Supabase values, and is not production evidence.
3. Supply `ZIMAGE_REHEARSAL_PUBLIC_CONFIG_JSON`, the actual non-secret public
   staging config contract. Frontend builds once from the same main commit and
   records the formal `--subject-only` digest, not an acceptance report. Neither
   missing variable is replaced with fallback/sample evidence. A failed build or
   absent required configuration blocks the same-run review.
4. The final job uses the artifact IDs and SHA-256s emitted by those two jobs,
   verifies their repository metadata and exact run/attempt name binding, and
   refuses a run whose SHA is no longer current `main`. It does not download or
   execute the artifacts, let alone accept or deploy them. Artifact access follows
   repository access; the rehearsal upload is explicitly scoped to candidates and
   checksum metadata. It excludes traces, videos, Playwright reports and environment
   files, and is retained for two days. Existing comprehensive quality/database
   jobs in `ci.yml` are unchanged and still manually triggered.

## Before enabling production

Attach a production environment-protected job downstream of the same-run review
and actual staging acceptance. Do not introduce a version selector on the normal
main path: approval releases the exact artifact IDs/digests bound to that run,
not whichever artifact is latest at approval time. Recheck current protected
main after waiting for approval and immediately before any remote operation so
an older pending run cannot supersede a newer main candidate. Reconcile schema 3 with the pinned, independently reviewed lifecycle
verifier and the server-side backend receipt workflow. Rehearse with the actual
isolated staging service first; prove exact rollback and authenticated health.
For frontend, verify the exact subject against the nominated backend in staging,
then use the existing packer and independent root-managed acceptance; an
allowlist, checksum or GitHub receipt is not that acceptance.

Protect one production workflow with independent reviewers, main restrictions,
no self-approval/bypass and least-privilege credentials. Serialize production
backend deployment, frontend deployment and rollbacks in the same concurrency
group with cancellation disabled. Promotion must download the same verified
bytes, revalidate their GitHub run provenance and hash, require explicit pinned
SSH host keys if using SSH, validate all component receipts, record the current
exact release(s), and verify after activation. Fail closed on missing tags,
host keys, provenance, receipts, approvals or health; use the already validated
exact rollback target. This document does not authorize those steps.

References: [secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[protected environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).
