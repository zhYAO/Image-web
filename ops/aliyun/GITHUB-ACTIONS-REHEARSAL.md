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
- The receiver checks the exact rooted source inventory in
  `/etc/zimage/ordinary-receiver-tools.json` before consuming SSH input. Its
  private spool is `/opt/zimage/ordinary-requests` with mode `0700`. The
  `paired/ordinary-authority.py` is installed at
  `ordinary-runtime/ordinary-authority.py`. It reads the trust policies and
  Sigstore digests from `/etc/zimage/ordinary-authority.json` and a root-only
  GitHub observer credential from `/etc/zimage/ordinary-github-observer.token`.
  The receiver uses its fixed offline verifier and its own GET-only client
  for `api.github.com`.
  Missing authority code or any changed digest causes refusal before the
  first request byte.
  Lifecycle policy is resolved for the authenticated batch and its current
  rollback pair after admission, then checked again under the shared lock.
- The authority reads `/etc/zimage/ordinary-authorizations/<runId>-<attempt>.json`
  for the exact batch and its signed stage digest. It checks the lifecycle
  digest and requires the operation identity `zimage-release-<runId>-<attempt>`.
  Independent evidence under `/etc/zimage/ordinary-evidence/<runId>-<attempt>/`
  binds to that operation and packet. It includes a fresh read-only database
  contract observation, the live baseline and a digest-linked rollback drill
  with the retained pair's public readiness and route acceptance. Candidate
  checks reuse the backend read-only receipt. The host issues separate private
  `baseline-readonly-challenge.json`, `candidate-challenge.json`, and
  `restoration-candidate-challenge.json` files for the exact running process.
  The first probe verifies the live rollback baseline before the first switch
  intent. Each response must match the host nonce, PID, start time and boot
  identity within the available authorization window. `backend/verify.py`
  reads the challenge over its existing bounded stdin or file interface and
  returns only the batch-bound receipt with authenticated GET results. It
  keeps its test credential and response bodies on the observing machine.
  The receiver can use a dedicated mutual TLS connection to the independent
  verifier. Its root-owned `/etc/zimage/ordinary-observer-tls/client.json`
  pins the observer address, certificate hostname and leaf SHA-256. The
  adjacent `ca.pem`, `client.pem` and owner-only `client.key` are local to the
  release host. The observer's `verify.py --ordinary-listen` uses its own
  trust material and pins the release host's leaf certificate. Only one
  bounded challenge and redacted receipt cross each connection. The receiver
  validates the reply before installing its root-owned batch receipt. A
  configured connection failure stops that check without using a local
  receipt. Sites with a separately reviewed root file transport can keep using
  the private challenge and receipt files. Restored public acceptance
  is checked against the exact prior pair and required routes before issuing a
  restoration receipt.
- The SSH request consists of a fixed version-two magic header and seven bounded,
  length-prefixed members. It carries only the stage subject and bundle, the
  exact candidate descriptor, both outer ZIPs and the publicly observed prior
  pair. The public pair is compared against separately authorized and locally
  verified rollback evidence before mutation. The server independently
  checks protected main, the real attempt and signer, the archive bytes and
  the same-run pair. The release key supplies no path, credentials, root
  approval, rollback selection or executable to the root controller.
- `paired/ordinary_ssh.py` routes an approved request through
  `paired/ordinary_system.py` and the existing service and ingress tools.
  Under the common deploy lock, it requires independent protected-merge and
  required-check evidence and checks the active pair and rollback evidence
  before creating the first intent. It drains the old backend, switches
  both components behind the fence, and checks the candidate process before
  reopening. The installed host must provide the independent evidence and
  private staging and exclude unresolved legacy writers under the same lock.
  No migration operation is part of this path.
- The GitHub observer derives the PR, required check and Actions run from
  the signed release commit. It binds the approved workflow bytes to that
  commit, requires the successful check to precede the merge and requires
  an actual passing GitHub rule suite for this update to main. The check
  and PR rules must both have been enforced by ruleset `27873546`. The
  selected PR, check, workflow run and rule suite IDs are recorded before
  sealing. Current branch settings alone do not prove a protected merge.
- `paired/ordinary_stage.py` uses the private SSH spool below `/opt/zimage`.
  It rechecks the signed ZIPs before rebuilding the formal frontend. The
  frontend must match existing root-owned acceptance and the approved
  archive and manifest digests. Only then does it stage the exact backend
  transport. It writes no acceptance or live release pointer.
- The workflow measures the live public pair anew before each request. The
  next successful release therefore uses the immediately previous pair as
  its rollback target. After a successful
  SSH reply it uploads the exact deployment receipt, then independently
  checks the public backend version, frontend release, readiness and route
  shells. The receipt must identify the same commit, run, attempt, digests,
  operation and tested rollback target. Authenticated workspace acceptance
  must also be observed before recording the release as complete.
- Failed public acceptance produces a separate observation linked to the
  deployment receipt digest. Even if the previous pair is visible again,
  the result stays unverified until a root-controlled restoration receipt
  proves the recovery. This observation issues no restore command.
- The same SSH forced command and key accept one bounded restoration frame.
  The selector carries the original batch packet and its installed approval
  digest. The receiver obtains the approval and the rollback pair from the
  installed authority and the original journal. It requires the original
  protected PR and required-check evidence, the exact opened PID and
  frontend generation, and independently observed public failure. Under the
  same deploy lock it records intent before restoring the retained pair or
  reopening traffic. The SSH client checks the publication receipt against
  the exact stage bytes and local failure observation before requesting
  restoration, and checks that the reply binds the exact original release
  and rollback pair.
  The independent observer can collect a witness with `github_pair_public.py
  --capture-failure` for the exact candidate SHA. It records the failed route
  check, HTTP metadata, and a bounded response-body digest. Probe errors that
  yield no usable HTTP response do not produce a witness. The installed
  authority requires the actual `failed-public-acceptance.json` bytes and
  verifies their digest in `public-failure.json`, tied to the live process and
  generation. Only the independent observer may supply these host records.
  The journal exposes a restoration receipt only after authenticated checks
  and an independent public check of the restored pair. An interrupted
  restoration blocks the next writer. The review-only Linux workflow exercises
  the first failed public response, the receipt-bound request, the fixed frame,
  replay rejection and the durable journal. It checks the restored pair through
  a separate public probe using fixture responses and a simulated SSH transport.
  The production workflow still records only the failure observation.

The review branch contains the workflow, fixed root receiver, root evidence
reader, private staging, lifecycle adapter and durable restoration logic.
The intended trigger is the maintainer's manual PR merge into protected main.
Keep paired publication disabled until the reviewed host installation, the
independent machine that produces batch authorization and live observations,
and the workflow's restoration dispatch have been exercised together. The
independent read-only GitHub observer must verify a real protected merge and
the exact required check, and rollback evidence must match the retained pair.
A failed or interrupted SSH response requires read-only reconciliation through
the existing status interface before any further write.

On 2026-11-23, read-only Cloud Assistant invocations `t-sh073yb4uhspczk` and
`t-sh073yb8bp4zbpc` verified the current production pair
`7a811b326aa4b344cee08bc5a33c04e44a780fd4` / `release-7a811b326aa4`.
The legacy paired CLI, backend receipt validator and kernel process reader
are root-owned. The ordinary receiver, pinned verifier, ordinary rollback and
candidate/restoration challenge producer are absent at their reviewed
installation paths. No fresh records existed in the ordinary evidence tree.
The planned isolated receiver environment resolved `api.github.com`, then
timed out connecting to IPv4 TCP 443 before TLS. No production components
were installed by these checks.

An ECS attribute query identified one attached basic security group with no
explicit outbound rules. Cloud Assistant invocation `t-sh073ybpdq3xfk0`
confirmed a gateway route, an `ACCEPT` iptables `OUTPUT` policy, and no
direct rule rejecting TCP 443 in that chain. The inspected nftables output
chains had no drop policy. These checks did not establish the cause of the
TCP timeout.

`paired/ordinary_install_inventory.py <reviewed-commit>` prints both exact
code digest maps and their corresponding Git source files. Use `--section
receiver` for the expected receiver inventory, or `--section paired` for
the shared lifecycle inventory. It reads committed regular-file blobs and
does not install files, create authorization, or open either release path.
The review CI authenticates and imports the exact locked sources and checks
the lifecycle inventory against the native paired CLI. Installed bytes,
ownership, credentials, network reachability and host policy still require
an independently authorized ECS preflight.

### Versioned receiver handoff for independent public evidence

The isolated `review-ordinary-public.yml` workflow uses the existing fixed
command name, `zimage-publish-pair-v1`. Its interactive request markers are
`ZIMAGE-CI-PAIR` versions 4 and 5 for publication and restoration. An explicit
end marker leaves stdin open for the challenge response. The deployed entry
point's default reader refuses these versions. The Linux rehearsal sends the
restoration selector through a child process's stdin and stdout, with fixture
responses and a real GitHub OIDC attestation. A separate job measures live
public HTTPS. Its result cannot be inferred from the fixture job.

1. Use the existing installed-layout procedure to stage a receiver generation
   identified by its reviewed Git commit. Extend the closed receiver inventory
   to cover the interactive module and its dependencies before activation.
   Verify the exact bytes, root ownership, executable modes, the fixed command
   and the installed verifier and trust-root digests together. Keep the prior
   receiver generation and its matching inventory available. A future change
   of generation must select the receiver and matching inventory as one unit.
2. Wire interactive admission using the exact protected merge, signed pair,
   installed batch authorization and retained rollback target. Accept the new
   frame versions only after selecting the authenticated receiver generation.
   Use the original journal and shared lock for mutations. Bind the attested
   observation to a fresh nonce, exact batch, stage and current pair, and
   recheck journal and live state before committing a result or a rollback.
3. Pin the independent production observer workflow, commit, run and attempt
   in receiver policy. That workflow must perform the existing anonymous HTTPS
   checks from GitHub-hosted Actions. A transport failure creates no rollback
   witness. Record both the measured candidate rejection and restored-pair
   acceptance where restoration is needed. The rehearsal workflow and
   attestation predicate have their own identity and cannot admit production.
4. Require the separately authorized Supabase read-only observer and its fresh
   contract evidence before enabling release. ECS process receipts, fixture
   responses and anonymous HTTPS observations cannot satisfy this DB gate.

The isolated receiver expects `/etc/zimage/ordinary-database-observer.json`
with the exact observer workflow SHA and reviewed query SHA-256. Its batch
evidence directory must contain `database.json` and `database.bundle.jsonl`.
The subject must match the approved project, role, contract, release packet and
operation. The offline verifier additionally pins the database workflow path,
main source commit, run, attempt and repository ID. The temporary PostgreSQL
rehearsal produces a `fixture` measurement. The receiver rejects this mode and
the earlier unsigned database record. Production still requires an approved
independent observer workflow, DB principal and evidence handoff.

### Independent GitHub evidence connection

The receiver can use an explicitly authorized observer when direct GitHub
egress is unavailable. Root-owned `/etc/zimage/ordinary-github-tls/client.json`
selects a single address and port with a pinned hostname and leaf certificate.
The observer authenticates the receiver's leaf certificate. The protocol
accepts only the receiver's existing GitHub evidence paths for `zhYAO/Image-web`.
It has no forwarding mode, HTTP CONNECT, caller headers or destination URL.
The observer makes fresh GET requests to `api.github.com` using its own local
read-only `github.token`. A scoped credential requires repository
`Administration: read` for the [rule-suite endpoints](https://docs.github.com/en/rest/repos/rule-suites?apiVersion=2022-11-28),
plus read access to the existing check, workflow, pull-request and contents
lookups. The observer reads the current private file on every allowed query.
An independent credential provider can rotate it atomically while the listener
keeps running. A missing or invalid credential stops the lookup. The ECS
receiver still evaluates all merge, required-check, ruleset-execution and
artifact signature evidence. The
observer is trusted to return the authenticated GitHub responses. A failed
connection in this mode ends the proof check.

On the explicitly approved observer host, keep the listener policy, private
token and TLS identity in its own protected directory. Use a dedicated peer
identity for this protocol. For the ECS readiness test, run the committed
`ordinary_github_relay.py` with the client policy and `--probe HEAD RUN_ID`
as the same UID and in the same network context as the planned receiver.
For the observed draft head `48900922262c256af1132cc3c773b9c4b0a6f9f0`,
run `45124137190` returned check `137524481164` and main `a3f43a6a43a7…`
through eight real GitHub reads carried by a temporary mutual TLS listener
bound to D1M loopback. The probe also verified ruleset `27873546`, its
effective protections, rule-suite list readability and the exact check workflow
bytes at that head. The observed main rule-suite list was empty. The test
used the existing D1M GitHub CLI session behind the listener. It established
the read and framing behavior in D1M. The target probe must return the same
check and run for that head and `releaseAuthority: false`. A later release
still requires the actual protected merge, rule-suite execution and the
original same-attempt artifact signature checks on ECS. Review CI sends a
complete synthetic merge fixture through native mutual TLS to exercise the
actual receiver verifier. It rejects a failed rule evaluation and a tested
tree that differs from the merged tree.

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
