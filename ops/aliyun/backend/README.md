# Independent backend release and drain

This directory is implementation plus local fixture evidence. It has not been
installed or executed on production. No production SSH, restart, OTP, paid model,
database change, Worker deployment, or dependency install is authorized by it.

## Fixed interfaces

After a separately reviewed administrator installation, the ordinary privileged
entrypoint is `/usr/bin/python3 -I /usr/local/libexec/zimage-backend/release.py`:

```text
deploy SHA40 OUTER_SHA256 MANIFEST_SHA256 RUN_NUMBER EXPECTED_CURRENT_SHA40 OPERATION_ID
rollback TARGET_SHA40 EXPECTED_CURRENT_SHA40 OPERATION_ID
status
verification-request
accept-receipt OPERATION_ID SHA40 PID EXPECTED_RECEIPT_SHA256
```

`deploy` accepts the existing Linux layered artifact protocol in
`/opt/zimage/incoming/<SHA40>.layers.tgz`; it retains all original layer/object
hash, cache, runtime/ABI/glibc/ELF, safe-copy, immutable graph and native/font
checks. It does not accept source, a static frontend dist, or arbitrary paths.
The existing adapter prepares the candidate, while this wrapper replaces its
activation call with the drain transaction. The original helper is unchanged.
Actual Sharp/font probing occurs after the old API is safely stopped, avoiding
two API processes competing for the currently constrained memory.

The wrapper shares `/opt/zimage/deploy.lock` with frontend and existing release
tools. Daily frontend releases must not call this wrapper or restart Node.
Backend release only changes the existing backend `current` / `previous` links.
It never changes `/opt/zimage/frontend/current`, schema, Worker or model catalog.

The stable authorized Linux build/return adapter required for `build:backend`
is **not implemented or verified here**. Existing Linux artifacts can be
validated/prepared by the wrapper; a cloud build integration remains a delivery
blocker, and this helper must never substitute a local Mac build for it.

## Trust and installation prerequisites

All helper files, their parent directories, and the existing fixed
`/usr/local/libexec/zimage-three-layer` helper closure must be root-owned and not
group/world writable. `transaction.py`, `verify.py`, `receipt.py`, `http-admission.cjs`, and the systemd drop-in template
belong in the same fixed backend helper directory. The exact service drop-in must be installed at `/etc/systemd/system/zimage.service.d/backend-lifecycle.conf`.
The drop-in retains the trusted Node path, existing memory NODE_OPTIONS, per-release font binding, UID and resource limits, and adds the fixed root-owned `--require /usr/local/libexec/zimage-backend/http-admission.cjs`. The helper checks the loaded systemd ExecStart as well as the exact template bytes. Nothing here installs/enables units.

The fixed service drop-in creates `/run/zimage-lifecycle` as a private mode-0700
systemd RuntimeDirectory for the existing `zimage` service UID. The API creates
an ordinary Unix status socket at `/run/zimage-lifecycle/control.sock`, mode 0600.
There is no socket activation unit: a status read cannot start the API. The
root helper first requires an active nonzero systemd MainPID; it verifies socket
ownership/mode, Linux SO_PEERCRED PID/UID, response PID, then rechecks MainPID.
Stopped or changed processes fail closed. The private socket accepts only a
bounded `{"command":"status"}` newline; it cannot alter root maintenance state.
The separate `verification-request` command reads only atomic metadata and can
run while candidate checks hold the global release lock.

`/etc/zimage/backend-maintenance.json` must be root-owned, mode 0644 (readable by
the API), with a root-owned non-writable `/etc/zimage` parent. Its exact schema is:

```json
{"schemaVersion":2,"operationId":"reviewed-window-1","mode":"draining"}
```

The reviewed Node preload reads it before admission of every HTTP request, including GET/RSC/image requests and requests on an existing keep-alive connection. `draining` denies every new HTTP request; `checking` opens only the exact reviewed health/verifier/helper paths, with method/query/static rules enforced by the preload; `open` permits ordinary admission. Upgrades are refused during maintenance. The service also reads it before every effective mutation. Missing, invalid,
oversized, linked or untrusted state closes admission. It survives process exit,
crash and restart; starting a candidate never opens it. Maintenance returns the
existing parseable `network` error contract with HTTP 503, `Retry-After: 30` and
`private, no-store`. The original request identity remains the client's recovery
key; the wrapper does not resend requests or force-settle unknown billing.

The root-owned `/etc/zimage/backend-release-policy.json` separately records
reviewed backend API compatibility for **every** supported frontend (including
old tabs), exact current frontend artifactId, and identical schema/Worker/model
catalog revisions. Its schema is exercised in `test_transaction.py:policy`.
Each backend record additionally requires `drainProtocol: 1` in production.
The current frontend manifest is independently read and matched to that record.
There is no automatic compatibility claim based on a Git SHA or ready probe.

`/opt/zimage/backend-operations/` must be a pre-created root-managed directory.
It holds atomic/fsynced `current.json`, immutable operation identity histories
`<operationId>.json`, monotonic sequences and `verification-request.json`.
Do not give the deploy account or API service write permission there or in `/etc`.

## Lifecycle and failure behavior

Every `executeRoute` callback is conservatively counted as `activeMutations`,
including reads. SSE and attachment/ZIP responses retain a separate body count
until fully consumed or cancellation settles. Detached chat graphs, billed
chat/optimize provider-result RPCs, and apparel lease renewals retain
`pendingFinalizers`. Apparel work retains `activeRenders` until Storage/RPC and
the last running renewal finish. ZIP source iteration retains `activeExports`
through pending downloads and asynchronous iterator cancellation/finally.

The wrapper closes root admission, verifies the same old SHA/PID observed that
operation, and waits for all five business counters, `activeHttpRequests`, and `activeFrameworkWork` to reach zero under `mode: draining`. Every recovery stop repeats this sequence, including the transition from checking back to draining. Missing or invalid HTTP/framework bridge markers cannot authorize stop. The preload pins the reviewed Next 16.4.1 ResponseCache hooks and counts detached cache revalidation through native processing and cache writes; an HTTP response ending alone is insufficient. The runtime marker is `frameworkWork: {installed:true,protocolVersion:1,nextVersion:"16.4.1",hook:"response-cache-revalidate-v1",controlValid:true}`. Unknown version, missing hooks or invalid integrity fails closed. Default maximum is
300 seconds. Timeout cancels the update, reopens admission only for the exact
still-running old process, and never calls stop/restart/select. Process or pointer
drift instead leaves the gate closed and records `needs_attention`.

After drain: stop old, probe candidate native/fonts, select exact new SHA, start,
verify exact API/process plus local HTTP/real-Host TLS, then require independent
read-only receipt before opening. Candidate pre-open failure attempts at most
one exact old-version recovery, with its own native and read-only checks. Recovery
failure keeps maintenance closed and reports the real current selection. A live
candidate with pending work is never stopped for recovery. If admission may
already have opened, the helper recloses it and records `needs_attention` without
blind rollback. Reused IDs and unfinished journals refuse automatic replay.

**The real first legacy B0 upgrade remains blocked by missing evidence.** A
separate executable first-window coordinator now exists; it does not manufacture
B0 lifecycle evidence or relax the ordinary helper. No socket/counters means no
proof of B0 in-flight SSE, Sharp leases, ZIP or post-disconnect finalizers. Queue
emptiness, quiet logs, ready=200, elapsed time, stop timeout or installing new code
cannot establish the missing historical completion. See the dedicated protocol below.

## Concrete independent read-only verifier

When candidate checking begins, `verification-request` exposes an exact
SHA/PID/operation/nonce request valid for at most 120 seconds. On an independently
authorized machine, using an existing authorized short-lived test-account cookie:

```text
python3 ops/aliyun/backend/verify.py --request request.json --output receipt.json
```

`ZIMAGE_AUTH_COOKIE` is read only from that verifier's environment. The verifier
uses fixed HTTPS `www.zimage.store`, rejects redirects/arbitrary destinations,
preserves refreshed cookies, and performs only GET requests to ready/meta,
auth/session, account, sessions and `/api/credits/pricing`. Only pricing receives
`x-zimage-readonly-probe: catalog-v1`, and its successful response must return
the same marker plus the strict domain catalog DTO. That path calls the catalog
RPC without the compatibility TRIAL fallback; missing RPC, transport, database
or DTO failure cannot produce the marker or a receipt. The verifier requires the
exact release, no-store, active same-owner account, every listed response, and
rechecks release after the suite. It writes a mode-0600 receipt with no credentials, owner, email
or private response bodies. The helper binds that receipt to the root nonce,
request digest, process, version, operation, freshness and exact successful checks.

The receipt keeps `schemaVersion: 1` and uses
`verifierProtocol: "zimage-backend-readonly-v2"`. Its exact success fields are
`authenticatedReadOnly: true`, `independentPublic: true`, and `catalogReady: true`;
the old `dependenciesReady` field and v1 receipts are rejected. Catalog readiness
covers the read-only catalog RPC and valid DTO, not wallet or ledger integrity.
The existing operator read-only wallet/ledger audit is a separate acceptance gate
and is not performed by this verifier. `GET /api/credits` and
`GET /api/credits/ledger` can initialize wallets or welcome credits and are never
probed here. The legacy `ops/aliyun/authenticated_health.py` checks only account
and sessions and omits account identity from its success output. It has no
nonce/PID/release binding and cannot replace this independent verifier or the
separate wallet/ledger audit.

The unified release CLI requires an already-authorized `ZIMAGE_AUTH_COOKIE` before
any backend mutation. During the root helper's wait it reads the fixed
`verification-request`, invokes the local reviewed GET-only verifier, uploads only
the receipt to fixed `incoming/backend-readonly-receipt.json`, then calls
`accept-receipt OPERATION_ID SHA40 PID EXPECTED_RECEIPT_SHA256` with the actual
SHA256 of those local verifier output bytes through the existing root SSH
argument channel. Incoming JSON cannot choose that expected digest. SSH/SCP do not inherit the auth cookie.
Both the candidate and exact old-version recovery require a fresh nonce-bound
receipt; a verified recovery still reports the original deployment failure.
The CLI starts one `verify.py --stdio` process and waits for its ready handshake
before mutation. Candidate and recovery requests share one in-memory CookieJar,
so a refreshed cookie survives between nonce checks without outputting or writing
it to disk. Its bounded NDJSON channel carries only requests and redacted receipts.

`accept-receipt` is a narrow concurrent action, using a separate root receipt lock
because the backend transaction retains `deploy.lock`. It snapshots the fixed
incoming file through directory FDs into a root-private mode-0700 stage; rejects
links/special/oversized/partial files and concurrent inode/content replacement;
checks exact root request, journal phase/target, maintenance, actual backend and
kernel-bound process identity, root-approved frontend/backend compatibility,
nonce, digest, timestamps and all successful check DTOs; and atomically installs
the accepted root-only receipt. Incoming cannot create a compatibility approval
or choose an arbitrary destination. The helper waits up to 110 seconds within the
120-second request lifetime; missing or failed verification never opens writes.

This uses the existing trusted release operator and existing root SSH identity;
it adds no signer credential, account, sudo permission or manual Boolean bypass.
A JSON receipt is not cryptographic proof against a malicious root/operator that
fabricates GET results. The reviewed CLI/verifier and independently maintained
root policy are the trust chain. No incoming receipt can modify that policy.

The independent verifier execution, fixed receipt transport/root installation,
authorized cookie, real catalog checks, and root installation **have not been
validated on production in this local task**. Their complete local fixture paths
exist; Linux and real independent execution remain explicit acceptance gates.
The receipt records the listed auth/account/session reads and catalog readiness;
it does not prove wallet/ledger integrity, paid provider, Storage/queue recovery
or all Task6 evidence.

## Upload ingestion budget

`POST /api/uploads` checks Origin/maintenance before SDK/body work, then obtains
one of two process-wide upload slots. Actual streamed multipart bytes are capped
at 10 MiB + 256 KiB = 10,747,904 bytes (`10496k` in the new split ingress). A legal
10 MiB single file plus normal multipart fields remains valid. Content-Length is
only an early rejection hint; chunked or false small lengths cannot bypass it.
Only bounded bytes reach multipart parsing. File.size is checked before copying
its arrayBuffer. Body reception, parsing and File conversion share a 30-second
ingestion deadline; unchanged Storage/finalize/compensation work remains awaited.
Slots stay held until the entire route's business work and any late cancel/parser/
File promises settle. Timeout can return promptly while pendingFinalizers keep
unsettled cleanup and its slot visible to drain. Capacity rejection uses a
retryable 503/Retry-After, not a new per-user product quota. No other import/export
or original Nginx body limit is changed by this bounded upload path.

## Local evidence

```text
python3 -m unittest discover -s ops/aliyun/backend -p 'test_*.py' -v
node apps/web/node_modules/vitest/vitest.mjs run ...backend lifecycle tests...
```

Fixture tests cover every active counter, timeout/no-stop, delayed finalizers,
legacy blocking, exact SHA/PID/pointer drift, candidate/native/recovery failures,
post-open ambiguity, journal replay, API/schema/Worker/catalog mismatch, GET-only
verifier failures, account isolation, cache protection and redaction. They prove
local control flow, not actual Linux/systemd/production/native-cloud readiness.


## Dedicated B1-first window and exact legacy recovery

After independent administrator review/installation, the separate fixed entrypoint is
`/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py`:

```text
run SHA40 OUTER_SHA256 MANIFEST_SHA256 RUN_NUMBER EXPECTED_B0_SHA40 OPERATION_ID EXPECTED_POLICY_SHA256 EXPECTED_COMPLETION_SHA256
recover OPERATION_ID EXPECTED_POLICY_SHA256 EXPECTED_COMPLETION_SHA256
status
verification-request
accept-receipt OPERATION_ID SHA40 PID EXPECTED_RECEIPT_SHA256
```

The unified local CLI invokes it as `first-window run/status/recover`. The new
`run` first validates the reviewed original service/process, the exact all-ingress
seal and historical completion evidence, before artifact preparation or any gate,
native, stop or pointer mutation. It then uses the existing immutable Linux layered
adapter; native/ABI/glibc/ELF/font requirements are retained. Candidate B1 is checked
under the genuine socket/meta/v2 receipt protocol, then checking closes and all
business, HTTP and framework work drains. Success is `backend_ready` with both
gates still sealed, `productionReady:false` and no writes opened. Static F1
activation and ingress switching are separate reviewed work; this coordinator
never creates a static frontend/current, fabricates F0 manifests or opens ingress.

The dedicated path alone permits absent `frontend/current`. It requires the
root-controlled `/etc/zimage/legacy-frontend-identity.json` to have exactly
`schemaVersion:1`, `kind:"legacy-next"`, exact `backendRelease`, `treeSha256`,
`ingressConfigSha256` and nonempty `auditRefs`; the canonical digest is the
policy's frontend identity. A real static current rejects this path. Ordinary
backend/frontend helpers retain their existing strict manifest checks.

The root-controlled `/etc/zimage/first-window-policy.json` has exact fields:
`schemaVersion:1`, `operationId`, `old`, `target`, `oldProcess` (`pid`, Linux
`startTicks`, `bootId`), `legacyFrontendSha256`, `ingressConfigPath` (a reviewed
regular path below `/etc/nginx/`), `ingressConfigSha256`, `candidateManifestSha256`,
`compatibilitySha256`, `candidatePolicy`, `serviceTemplates` (`candidate` and
`legacy` exact installed template SHA256), `originalServiceSha256`, `auditRefs`,
`issuedAt`, `expiresAt`. Policy lifetime is at most 86400 seconds. The compatibility
record is the ordinary retained-frontends schema, including unchanged DB/Worker/
model catalog revisions and explicit B0+B1 compatibility evidence; B1 additionally
requires reviewed `drainProtocol:1` and `httpAdmissionProtocol:1`. It is not a claim
that B0 implements meta or drain. `originalServiceSha256` binds normalized selected
nonsecret systemd metadata (UID/group/working directory, exact argv, EnvironmentFiles
paths and DropInPaths); the helper never reads credential environment contents.

Policy, legacy frontend, completion and legacy request document digests use sorted,
compact canonical JSON plus newline, recursively normalizing integral floats to
integers (`first_window.digest`). Artifact/template/ingress config digests are raw
byte SHA256. The CLI compares the explicitly reviewed policy/completion digests and
candidate manifest digest before upload. Both approved document digests are also
mandatory fixed root-helper arguments for run and recover. Under the global
release lock the helper compares the current canonical root documents with those
original approvals before artifact preparation, journal writes, gates or service
operations. It retains both digests in the operation journal (`policySha256` and
`completionSha256`) and rechecks the pinned documents before stop and recovery
checks. It never refreshes or adopts changed approval documents. No incoming file
can create approval.

`/etc/zimage/first-window-completion.json` must be independently reviewed and
root-installed. Its exact fields are `schemaVersion:1`,
`protocol:"zimage-legacy-completion-v1"`, `operationId`, `old`, `oldProcess`,
`policySha256`, `ingressConfigSha256`, `ingressSealSha256`, `coverageStartTicks`,
`sealedAt`, `checkedAt`, `expiresAt`, `coverage`, `completion`, `auditRefs`, and
`reviewDecision:"exact-completion-reviewed"`. Its maximum lifetime is 600 seconds;
review follows actual seal and coverage starts at the exact original process
start. Every coverage/completion item has exact `category`, `evidenceSha256`,
`auditRef`, `outcome`. Coverage, in order, is `public-http`, `public-https`,
`existing-http2`, `loopback`, `direct-bind`, `internal-callers`, each `sealed`.
Completion, in order, is `http-responses`, `nonbilled-graphs`,
`billed-provider-health`, `sharp-storage`, `inflight-renew`, `zip-cancel-finally`,
`upload-compensation-preview`, each `completed`. Missing/unknown categories,
booleans, quiet logs and queue/timeout substitutes are rejected. Referenced evidence
must actually substantiate full historical lifecycle closure; a digest is only a
binding, not proof that the evidence is valid. If original materials do not exist,
this attestation cannot truthfully be issued and production remains blocked.

The external flag protocol uses fixed `/etc/zimage/ingress-maintenance.json`,
`ingress-checking.json` and `ingress-open.json`. Each present file must match
`{schemaVersion:1,operationId,ingressConfigSha256}`. The flags directory must be
root-owned mode 0755; files are root-owned, non-writable to group/world, bounded
regular files. The reviewed Nginx candidate defaults closed with missing or
contradictory flags. This coordinator requires maintenance present and open absent;
initial B0 completion additionally requires checking absent. It only creates or
removes checking atomically/fsynced. During drain, checking is removed first and
the external seal remains. File presence does not establish real coverage of
alternate/direct/internal ingress; the independently reviewed evidence must cover
all of them. No production Nginx installation/upload/test is performed here.

`first-window-current.json` and retained operation history persist intent and
completion around stop/config/native/select/start/check phases. Recovery is an
explicit command, never forward replay. A live exact B1 must observe the same
operation's draining gate and all seven counters must reach zero before stop;
PID/start, epoch, pointer, ingress or policy drift keeps admission closed. A
stopped service is distinguished from a transitioning/unknown service. The helper
then restores the exact old native resources/current, installs the reviewed
`backend-legacy.conf` only while stopped, fsyncs and daemon-reloads, then starts
B0 using its genuine original trusted Node argv with lifecycle disabled and no
preload. Candidate mode similarly binds the reviewed preload before B1 start.
Original UID/environment/font binding/memory limits remain unchanged. Initial B0
may truthfully have no lifecycle drop-in; a policy-bound original metadata hash is
required instead. Unknown installed template or loaded service properties reject.

Recovery uses real B0 ready SHA plus systemd PID/start/boot identity and the
separate `zimage-legacy-readonly-v1` verifier. Its nonce request adds `processStart`
and `verifierProtocol` to the ordinary bounded 120-second request. The actual
GET-only verifier reads only ready/account/sessions and rechecks ready; it never
requires fake B0 meta/drain/catalog markers, wallet GETs, or ledger GETs. Redacted
receipts are installed through the same sealed-copy/digest/nonce transport kernel,
with a distinct exact legacy journal validator. Candidate receipts cannot satisfy
legacy verification and legacy receipts cannot satisfy candidate verification.

A separate root-installed `/etc/zimage/first-window-legacy-audit.json` is mandatory
before declaring legacy recovery verified. Exact fields: `schemaVersion:1`,
`protocol:"zimage-legacy-wallet-ledger-audit-v1"`, `operationId`, `backendRelease`,
`processStart`, `requestSha256`, `policySha256`, `checkedAt`, `expiresAt`,
`accessMode:"read-only-select"`, `walletLedgerEvidenceSha256`, `auditRefs`,
`reviewDecision:"wallet-ledger-reviewed"`. It must bind the fresh recovery nonce,
process, policy, and at most 120-second window. This independently reviewed SELECT
audit is not created by the HTTP verifier; `catalogReady:true` is insufficient.
Successful recovery records `recovered`, still sealed, and the failed deployment
continues to report failure. Failed audit/safe-read checks remain sealed.

`writesOpened:true`, opening phases, unknown/open backend gate or any possible
opening recorded as `writesMayHaveOpened` prohibit automatic rollback, even after
a later gate closure. Crash recovery rechecks actual live state before deciding
whether stop/start/selection has happened; it does not blindly repeat actions. A
live candidate without its previously recorded PID/start identity (including a
lost start reply before identity persistence) remains sealed for explicit operator
provenance reconciliation; the helper never adopts and stops an unknown process.
The same restriction applies to an unknown replacement B0 process: a non-original
legacy PID requires its exact previously recorded `recoveryProcess`. After a
successful legacy start, the coordinator immediately persists `legacy_started`
with its actual PID/start/boot identity before further checks. A lost legacy start
reply or crash before that record cannot be treated as verified recovery. The
original still-running B0 PID can be safely rechecked without stop or adoption.
These protocols explicitly trust the authorized root operator and independent
review of evidence; JSON/digests cannot prove truth against fabricated root
attestations and add no cryptographic signer. No local fixture or historical
snapshot is a production approval.
