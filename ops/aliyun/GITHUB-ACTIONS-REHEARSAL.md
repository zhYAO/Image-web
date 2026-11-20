# GitHub Actions: isolated release candidates

This workflow is an additive first step. It does not replace `ci.yml`, its
manual quality/database checks, existing branch protection or the production
release/rollback gates. Checkout, package and pair intake run by default;
protected staging and production are both off until separately provisioned.
There is no target bridge installation in this source tree. A stock runner or
missing bridge fails closed. Do not feed these artifacts to the legacy workflow.

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
   re-verifies the complete cold transport closure after unpacking the transport.
   It does not embed production Supabase values, and is not production evidence.
3. Supply `ZIMAGE_REHEARSAL_PUBLIC_CONFIG_JSON`, the actual non-secret public
   staging config contract. Frontend builds once from the same main commit and
   records the formal `--subject-only` digest, not an acceptance report. Neither
   missing variable is replaced with fallback/sample evidence. A failed build or
   absent required configuration blocks the same-run review.
4. The final job uses the artifact IDs and SHA-256s emitted by those two jobs,
   verifies their repository metadata and exact run/attempt name binding, and
   refuses a run whose SHA is no longer current `main`. The same job downloads the exact two artifact ZIPs by ID,
   hashes each against the GitHub metadata before extracting an allowlisted
   file set, rechecks the formal full backend transport, and independently
   recomputes the formal frontend acceptance subject. It never executes the
   artifacts and a valid pair still reports production blocked. It cannot
   generate staging acceptance, an authenticated backend receipt, or root approval. Artifact access follows
   repository access; the rehearsal upload is explicitly scoped to candidates and
   checksum metadata. It excludes traces, videos, Playwright reports and environment
   files, and is retained for two days. Existing comprehensive quality/database
   jobs in `ci.yml` are unchanged and still manually triggered.

## Protected staging and production (not provisioned)

The same workflow defines the staging job and a downstream GitHub environment
`production` job. Neither starts without explicit repository opt-ins
`ZIMAGE_PAIRED_AUTOMATION` and (for production) `ZIMAGE_PAIRED_PRODUCTION`.
Do not set either before separately reviewing and provisioning all boundaries.
The main event still selects the exact commit automatically. An opted-in build
uses the canonical `release-<backend-SHA12>` frontend namespace. Diagnostics
remain unpromotable.

- Establish independently isolated staging. An application cache on the same
  production ECS is not staging. Use dedicated trusted runner groups restricted
  to this exact workflow, not generic self-hosted runners shared with pull
  requests. The labels identify roles but are not a security boundary.
- The protected environments have independent reviewers, branch restriction to
  protected main, no self-review and no bypass where available. All three jobs
  that recalculate the frontend subject need the same reviewed public config
  value. No credentials or authenticated read receipts are uploaded as artifacts.
- Separately install/review the fixed root-owned executable
  `/usr/local/libexec/zimage-paired-release/github-bridge` on each target-specific
  controller runner with the real staging/backend/ordinary adapter closure.
  Supply role and independently reviewed binary SHA-256 using
  `ZIMAGE_PAIRED_ROLE` and `ZIMAGE_PAIRED_BRIDGE_SHA256`. The workflow cannot
  override the path, install code, choose a different host or supply a cookie.
  CLI protocol: <phase> <pins.json> <backend.zip> <frontend.zip> <config.json>
  <bound argument>. Roles must only allow `staging` or read-only
  `authorization` plus `production` respectively; never a general command,
  unrestricted sudo or unreviewed SSH endpoint.
- Staging must independently authenticate the candidate backend with the
  existing nonce/PID/release receipt and exercise actual frontend acceptance
  against that exact backend, config and candidate subject. It returns no auth
  cookies or reports to the workflow, only fixed run/pair/evidence digests.
  Staging fixture output never grants production authority. The production
  controller must independently verify the staging evidence and exact reviewed
  root approval in its own custody before returning `authorization`, then
  verify the same bytes again under the real common lock before mutation. Neither
  deployment reviewers nor operators choose a version in the normal run.
- The old `paired/cli.py` requires a *different database fingerprint* and real
  migration approval; it cannot be called for a no-DDL release. The new ordinary
  coordinator kernel orders exact preflight, seal/drain, backend, frontend,
  authenticated health and open, and rejects unknown/replayed or uncertain
  states. A real root adapter still must wire these callbacks to the reviewed
  Linux lifecycle/publisher tools, same shared deploy.lock plus cross-entrypoint
  unfinished journal checks, exact old/new pair and genuine recoverable
  prior state. Test actual rollback independently before enabling: that is
  not equivalent to merely observing the current SHA or a mock state.
- Existing legacy receiver/rollbacks are unchanged. The new production job
  shares their GitHub concurrency group and never cancels an in-progress
  operation. The root lock and journal must still protect both old and new
  helpers. The workflow checks current main and every digest again after
  the approval wait. A genuine production controller must also check current
  main while holding the lock and before reopening traffic.

No live staging/controller was verified or installed here. Enabling repository
flags, installing a privileged adapter, or validating real session credentials
requires separately authorized operation. The offline tests use fixture
controllers; they do not create acceptance, approve artifacts or deploy anything.

References: [secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[protected environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).
