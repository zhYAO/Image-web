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

## Protected main signature and paired publishing

On a protected `main` push, the hosted stage tests the two exact GitHub ZIP
artifacts in isolation. It rebuilds the 7a fixture, checks the browser
workspace and finishes teardown before uploading its report. The reusable
`attest-stage.yml` is pinned by commit. It reads GitHub's workflow, attempt,
job and artifact APIs itself, then signs one statement that binds both ZIP
digests to the same repository, commit, run and attempt. The resulting
attestation is stage evidence. Production approval is a separate decision.

The workflow uses the browser stage with `ZIMAGE_PROTECTED_MAIN_BROWSER_SHADOW`
set to `true` and both legacy flags `ZIMAGE_PAIRED_AUTOMATION` and
`ZIMAGE_PAIRED_PRODUCTION` set explicitly to `false`. The artifact object
hosts under `ZIMAGE_ARTIFACT_OBJECT_HOSTS` must be the reviewed exact GitHub
storage hostnames. The frontend public config and backend target must match
the admitted artifact bytes. Review-branch artifacts cannot satisfy the
protected run, artifact name, namespace and signing identity checks.

### Production SSH entry

- `publish-pair` is the sole production job in the paired workflow. It uses
  the `production` environment with a main-only branch policy, independent
  required approval, self-review disabled and administrator bypass disabled.
  Enabling `ZIMAGE_PAIRED_SSH_RELEASE` also disables the legacy standalone
  backend deploy and rollback jobs in GitHub Actions.
- A dedicated `ZIMAGE_PAIR_SSH_KEY` is scoped to the production environment.
  The client connects as `zimage-release` using the exact
  `ZIMAGE_PAIR_SSH_HOST` and `ZIMAGE_PAIR_SSH_KNOWN_HOSTS` pin. The matching
  server key is restricted to the root-owned `paired/ssh-publish` forced
  command with SSH forwarding, PTY and user RC disabled. Its only privileged
  executable is `/usr/local/libexec/zimage-paired-release/receive-ordinary-pair`
  with zero arguments. The status-only key has its own separate authorization.
- The SSH request consists of a fixed magic header and six bounded,
  length-prefixed members. It carries only the stage subject and bundle, the
  exact candidate descriptor and both outer ZIPs. The server independently
  checks protected main, the real attempt and signer, the archive bytes and
  the same-run pair. The release key supplies no path, credentials, root
  approval, rollback selection or executable to the root controller.
- The installed controller must supply an approved host adapter to
  `paired/ordinary_ssh.py`. The adapter must verify the root approval, retained
  packages, live rollback drill on the exact old pair, and authenticated
  checks of the candidate. It must use the existing deploy lock and durable
  journal against all legacy and ordinary writers. No migration operation
  is part of this path.
- The workflow checks the public rollback pair named in
  `ZIMAGE_PAIR_ROLLBACK_SHA` before sending the request. After a successful
  SSH reply it uploads the exact deployment receipt, then independently
  checks the public backend version, frontend release, readiness and route
  shells. The receipt must identify the same commit, run, attempt, digests,
  operation and tested rollback target. Authenticated workspace acceptance
  must also be observed before recording the release as complete.

The review-branch implementation contains the workflow, receiver admission,
fixed SSH invocation and transaction integration. The root command and its
concrete ECS adapter still require installation and live validation. Keep
paired publication disabled until that installation, approval gate and
rollback evidence have been verified. A failed or interrupted SSH response
requires read-only reconciliation through the existing status interface
before any further write.

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
