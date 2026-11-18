# Opt-in same-job lifecycle validation

Local review only, based on compatibility commit
75b13b75ded14220b6024950b16cefc8255e830a. No workflow has run for this code.
The independent old artifact-smoke branch 6c6c852 remains unchanged and must not
be used to claim validation of framework protocol v2.

## One build, original upload and original production controls

verify_lifecycle is a manual boolean input, default false. Its one added step
executes only for action=candidate on main. A requested full-format verification
fails; only layers is supported. There are no added jobs, runners, builds,
dependency installs, cache operations or uploads. All non-candidate jobs,
candidate job permissions/runner and original steps remain structurally identical.
With the input false no verification code or extra commands execute.

When requested, the fresh delivery is checked after provenance generation and
immediately before the original upload step. A failure prevents upload; there
is no continue-on-error, rerun, substitute build or old artifact fallback.
Verification is optional and is not a new automatic production approval gate.

## Provenance before code execution

The expected source, run and attempt come from GitHub's run context, not an
archive. The verifier checks main through the existing read-only consumer API
before validation and again before upload. sha256sum independently hashes the
fresh transport; Python rehashes the private snapshot and compares exact local
candidate provenance, report, manifest and independently supplied target JSON.
The future artifact name must remain candidate-SHA-run-attempt.

An artifact ID and GitHub ZIP digest do not exist before upload. This does not
invent those values or replace their later validation: candidate-artifact.py
and all its existing run/attempt/workflow/freshness/ZIP/transport checks are
unchanged. The original four delivery files and one-day retention are unchanged.
Private receipts and logs live outside the uploaded delivery directory.

The original consumer/validator/assembler source bytes are pinned to the reviewed
implementation before import. The complete schema-2 closure is restored with the original transport validator
and offline assembler, retaining all hashes, ELF/runtime, safe paths/links and
target/toolchain/cache bindings. Explicit local assembly mode is unchanged.
No shell or installer from the archive is executed.

The companion preload/catalog bytes are pinned to the reviewed v2 implementation
and also checked against Git blobs at the current run SHA. The expected Next pin
comes from that commit's app manifest. The static Node inspector runs against the
actual assembled release before application startup and must match that expected
v2 contract, reviewed source-profile ID and immutable module paths. A first live
status cannot set the expected version or profile.

## Isolated synthetic execution

Only the already selected, ephemeral GitHub-hosted Linux runner is supported.
The child supervisor receives only literal PATH/locale in new network, PID and
mount namespaces. Non-loopback interfaces, outbound IPv4/IPv6 routes, a shared
namespace, unsupported primitives or an existing /opt/zimage tree fail closed.
The application is chrooted into only the verified artifact, trusted Node/shared
libraries and root-owned audited companion files. It has no host credential
filesystem, task token, supplementary groups, capabilities or new privileges.
CPU/process/file/descriptor limits, bounded startup and namespace-child cleanup
apply. Raw child logs stay private and are never uploaded or printed.

Injected runtime values are synthetic run identity, checking-mode maintenance and
the artifact's nonsecret resource binding. No production runtime configuration,
account, service key, cookie or provider key is obtained. The exact artifact keeps
its already-approved compiled public build values; these are not rewritten into
test URLs. No outbound interface exists to contact their endpoints.

Lifecycle remains enabled and checking never opens writes. Actual v2 bridge,
Next/source-profile, socket owner/mode and kernel peer PID/UID must agree with the
child and reviewed artifact. Only loopback GET ready/meta and a protected GET
rejected by the real HTTP barrier are used. No account/catalog/DB/model operation
is invoked. Idle counters are checked again before success.

## Local evidence and limits

Windows evidence covers offline contract/structure tests, Python 3.10 syntax and
shell parsing only. It cannot establish Linux namespace/chroot/shared-library
availability or actual standalone startup. Any missing runtime dependency or
configuration is a failure, not authority to install or supply production data.
Twelve new offline tests passed; the twelve inherited compatibility tests also
passed. The added shell block passed Bash syntax checking. No Linux process or
GitHub workflow was started for these checks.
No rollback, complete native rendering/cache-drain, systemd or production
installation acceptance is claimed.

Before ECS: a separately approved exact combined source must be published/reviewed
through the normal repository route, then one candidate/layers run must explicitly
set verify_lifecycle=true and succeed. Backend helper/catalog installation,
missing preload launch reconciliation, full Linux drain/recovery evidence,
production compatibility policy and activation approval remain separate.
The unchanged ordinary layered deployment does not invoke BackendTransaction.
