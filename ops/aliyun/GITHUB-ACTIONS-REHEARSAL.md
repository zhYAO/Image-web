# GitHub Actions: isolated release candidates

This workflow is an additive first step. It does not replace `ci.yml`, its
manual quality/database checks, existing branch protection or the production
release/rollback gates. Checkout, package and pair intake run by default;
protected staging and production are both off until separately provisioned.
This source tree includes a versioned intake-only bridge, not an installed
staging or production adapter. Missing installation or authenticated stage
acceptance fails closed. Do not feed these artifacts to the legacy workflow.

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

## Disposable GitHub-hosted runtime smoke

On a protected-main push, when both live opt-ins are off, a separate
`ubuntu-22.04` job tests only the already-verified same-run archives. It has
no GitHub environment, application secrets, artifact upload, output consumed
by promotion, or production dependencies. Configure the non-secret
`ZIMAGE_REHEARSAL_PUBLIC_CONFIG_JSON` as a repository variable so the job
can recompute the same subject; the `release-rehearsal` environment must not
shadow it with different bytes/values. Missing or mismatched config fails
closed. Manual dispatch remains component-only; do not enable a production
flag to test a branch.

The job uses the package's exact cache binding in the disposable VM and feeds
the application a credential-scrubbed process environment. The install uses the
lockfile-pinned Supabase CLI `2.115.0`, configured PostgreSQL 17 and exact checked
in SQL migrations, in a new local project with no linked cloud configuration.
It needs the local Unix Docker socket, isolates all keys in memory, starts no
project Edge workers, and uses only the fixed loopback endpoint and synthetic
account. It does not print the CLI status, account credentials, session or cookie.

The runtime check covers same-origin HTTP login (bad password, successful
password, real cookie-backed live-session RPC, and logout/parsing the cleared
cookie) on the exact backend. The exact frontend is checked for its matching
commit, namespace and app shell only. This is not a browser UI/frontend-login
exercise. A success is only a local synthetic fixture smoke result. It cannot
issue the independent PID-bound staging acceptance or root approval, nor prove
production routing, credentials, or rollback. App/runtime failures and
unsupported fixture prerequisites are failures, not green auth results.
See [Supabase local Auth testing](https://supabase.com/docs/guides/auth/testing-auth-flows).

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
- Separately review and install `paired/github-bridge` as
  `/usr/local/libexec/zimage-paired-release/github-bridge` on a **dedicated
  independent staging runner**. It runs as the named non-root runner UID, with
  no sudo and no credentials. Install its exact reviewed Python/JSON tool
  inventory under the same root-owned directory, preserving relative names.
  A root-owned `/etc/zimage/ci-staging-bridge.json` must specify
  `schemaVersion: 1`, `mode: "intake-only"`, numeric `runnerUid`, and a
  `tools` mapping of every listed source path to its independently reviewed
  SHA-256. Assign the expected binary hash and role via the protected
  `ZIMAGE_PAIRED_BRIDGE_SHA256` and `ZIMAGE_PAIRED_ROLE`. Hashes are never
  learned from a request.
- Intake protocol v1 permits only `staging PAIR_SHA256`. Request input is
  bounded stdin: magic `ZIMAGE-CI-STAGE\x01`, then four ordered records with
  8-byte unsigned big-endian lengths and bytes for pins, backend ZIP, frontend
  ZIP, and config. No filenames or paths can be supplied by the caller. Output
  is a sanitized blocked intake report and exit 3, never an authenticated
  receipt. `authorization`, `production`, alternative commands and all
  caller-selected paths are refused. The repository client also rejects live
  production operations with this interface.
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

  In staging only, use `queue: max` without canceling the running job. Under
  GitHub's default single pending slot, if A is active, current C queues first,
  and stale B finishes building last, B could replace C before the SHA checks
  run. The expanded staging queue retains both in this example; the existing
  current-main check rejects B. Queue order is not commit order; the limit is
  100 pending jobs. The shared production queue is unchanged, including the
  legacy manual deploy and rollback jobs; the default single pending slot
  does not guarantee rollback priority or retain every eligible candidate.
  Before changing production policy, verify candidate retention and the time
  to reach an emergency rollback under backlog on the actual runner.
  See the [GitHub concurrency contract](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

No live staging/controller was verified or installed here. Minimum to run the
hosted intake job: nominate an independent Linux staging machine and a dedicated
non-root runner account; authorize and review the runner/group and bridge setup,
and supply the reviewed staging public config and exact backend target
fingerprint. This is not enough to go live: authenticated staging additionally
needs a staging-only test account and a real audited runtime adapter; production
also needs separate root approval custody, protected settings and a real
rollback drill. Enabling repository
flags, installing a privileged adapter, or validating real session credentials
requires separately authorized operation. The offline tests use fixture
controllers; they do not create acceptance, approve artifacts or deploy anything.

References: [secure use](https://docs.github.com/en/actions/reference/security/secure-use),
[protected environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data).

## Fixed review-branch diagnostic, without merging main

`review-branch-diagnostic.yml` runs only for a push to the exact
`codex/zimage-github-actions-review-20261120` branch of `zhYAO/Image-web`.
It builds the branch SHA, verifies the complete formal backend transport,
assembles it against a disposable VM cache, checks the matching nonpromotable
frontend subject, and exercises loopback Auth with newly generated local data.
It has no GitHub environment, deployment controller, artifact upload, provider
credentials or production dependency. Its public image CDN references are the
already pinned read-only policy; all authenticated requests stay in the fixture.
No GitHub setting or main workflow gate is changed. New commits and a first
push/run still require separate review and authorization.

## Disposable review-branch publication

An exact review branch push runs a GitHub-hosted job with no environment
secrets, OIDC, SSH, promotion evidence or external release target. The job
checks the pinned prior commit 532d953cdd8fb4cc2446b83de77f435e13041315 is
in the candidate's history. It independently builds each commit in a clean
worktree with a shared pnpm store, verifies each schema 3 backend transport
and frontend subject, and rejects identical archive digests. The two
commits may intentionally have identical application source; the log
separately reports that fact. Release IDs and frontend namespaces differ.

The runtime uses independent Next processes for the paired builds. It seals
a private test write route, selects the candidate, verifies the exact
candidate through loopback, then stops its process while it is selected.
The resulting HTTP 503 is required before rollback; the exact previous
commit, frontend namespace, live process and write gate must recover. A
fresh diagnostic install then verifies healthy candidate activation.
Disposable authentication is tested once on the candidate.

This is not verification of production Nginx, systemd, OIDC, staging
provisioning or rollback. The write route is a private fixture, not a
business API. Public asset verification in the build remains read-only;
release HTTP, state transitions and data are runner-local.

The review runner additionally checks the assembled schema 3 candidate in a
separate PID, mount and network namespace with no outbound interface. Its
unprivileged Next child uses the unmodified reviewed preload and 0600 Unix
socket; the supervisor verifies the kernel peer PID/UID and exact release.
A private loopback Nginx process uses the existing admission includes with
only the marker paths relocated. It checks ready, sealed/drained with zero
work, selective checking, and reopen without changing the app PID. This
is not the production Nginx/TLS config, a systemd installation, a signed
staging receipt, or permission to publish outside the runner.

The byte report distinguishes source-input scanning (which may count public
source files delivered externally), verified schema 3 layer/index/metadata
accounting, regular files inside the assembled app directory (without following
external cache links), and actual cold-transport gzip bytes. The frontend
diagnostic gzip is a local archive of the built static folder, not a
promotable package.

## Ordinary staging binding (local prototype, not installed)

The no-DDL binding joins the ordinary kernel to the persistent shared flock
and journal and requires an independently scoped staging system. It rejects
the production-bound implementation of ingress, readiness and frontend
operations. Candidate selection starts only after the exact old process has
drained and stopped. The candidate must pass the existing nonce/PID/timestamp
receipt validator and the exact pair probe before an open intent is recorded.
After any error under a durable intent the binding attempts to hold the same
staging gate without rewinding either pointer; unresolved intent blocks the
next participating writer, even when opening may have started.

Local tests use actual temporary filesystem pointers and a Unix socket to
distinct local child processes, but operation authority and the authenticated
receipt are synthetic. The binding has no install/CLI entrypoint. A real
stage still needs a protected Linux runner on an independent target, an audited
staging path/service/ingress binding, individually verified runtime credentials
and root-reviewed authority for current main/artifacts/database contract and
the authentic read-only probe. Every legacy writer must honor the same
unresolved journal under its shared lock before this can be installed.
The staging bridge remains intake-only and cannot emit a promotion receipt.

### Linux interrupted opening rehearsal

From the checkout, run this as an unprivileged Linux user with Python 3 and
Nginx already available in the system executable path.

```sh
python3 -I -B ops/aliyun/review-ordinary-reconcile.py
```

The rehearsal uses temporary gate files and release pointers, loopback
listeners, synthetic approval, and a synthetic HTTP application. It reuses
the hosted review's Nginx fixture and the repository's admission includes.
After Nginx forwards a successful fixture write, the supervisor kills the
paused publisher at the open checkpoint and confirms that only
`writes-may-open` is durable. A separate process calls
`StageBinding.reconcile_open`. The check then requires a maintenance 503
from Nginx, draining from the application, and the same candidate pointers
and Linux PID/start/boot identity. The rehearsal exercises a local Nginx gate
with the synthetic application. Real Next, TLS and systemd are outside its scope.
