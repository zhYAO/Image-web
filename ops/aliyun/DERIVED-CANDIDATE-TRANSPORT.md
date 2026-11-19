# Release-side candidate transport prototype

This local prototype derives a transfer subset from a complete frozen candidate.
It does not build, query GitHub, use SSH, invoke an application, change workflows
or activate a release. The complete candidate must remain available. The existing
candidate-artifact.py verifier remains responsible for current-main/workflow,
repository, successful run/job, attempt, artifact ID/digest and expiry checks.

## Trust inputs and verification

The release-side caller must supply an independently verified pin containing
schema 1, releaseSha, manifestSha256, transportSha256, transportBytes,
candidateArtifactSha256, runId, attempt and artifactId. The prototype binds and
retains the artifact identity, but cannot authenticate it from caller-created
JSON. The upstream verifier supplies authorization and current GitHub provenance.
The CLI requires an independent SHA-256 of the exact pin-file bytes.

An inventory snapshot binds schema 1, destinationId, pinSha256, capturedAt and
inventory. destinationId is the independently established target identity hash.
pinSha256 and the snapshot digest use canonical JSON (sorted keys, compact
separators, UTF-8, no trailing newline). The CLI snapshot-sha256 option uses this
canonical model digest. The prototype's snapshot window is 300 seconds and
rejects future timestamps. This local model window is not a new deployment policy.

Snapshot creation only reads the at-most-seven paths requested by the existing
transport validator. It never creates a missing cache. Derivation re-reads that
cache before and after packaging and rejects lost/changed declared hits or a
changed inventory. A cold, explicitly recorded empty cache remains valid.
Missing inventory and stale inventory fail closed.

The prototype verifies original transport SHA and size, unpacks via the existing
bounded validator, requires all seven original objects and checks the original
manifest plus every layer index/archive. Existing layer extraction validates
inner bytes and paths in temporary local directories. It runs no archive code.
It then reuses the existing bundle planner/producer, reopens the derived archive,
requires the planned exact object set and unchanged manifest bytes, and verifies
the full destination closure using transferred bytes plus read-only cached bytes.
The original candidate and derived transport have separate digests. Exclusive
publication refuses an existing output. Failed work cannot switch current/previous.

Source/cache may still change after any offline check. Production integration
must retain the installed helper's locked complete-closure verification and
failure/rollback behavior immediately before activation. No helper is changed
here. Reports always keep productionReady false and
destinationActivationVerified false.

## Local test scope

The three-way comparison uses seeded synthetic bytes, synthetic font metadata
and a fake artifact identity through the existing portable fixture. It does not
represent image rendering, a real GitHub candidate, Linux ABI admission, ECS
performance or production network savings. One observed run measured:

| Synthetic cache | Derived gzip bytes | Upload objects | Reuse objects |
| --- | ---: | ---: | ---: |
| Cold | 105,903 | 7 | 0 |
| Assets hit | 71,954 | 5 | 2 |
| Assets and runtime hit | 5,084 | 3 | 4 |

Eight defensive cases cover full-candidate preservation, original/derived digests,
cache races, stale/future/missing snapshots, target binding, altered hit metadata,
partial candidate rejection, immutable output and malformed identity values.
No verified frozen candidate transport is currently present on D1M, so no real
candidate size comparison has been performed by this prototype.

## Read-only ECS observation

On 2026-11-18, the existing authenticated Edge Cloud Assistant session completed
one bounded check on the previously domain-verified instance. Target service
identity matched the trusted Node/current-release relationship. The bounded
root-owned Nginx-file inspection did not establish a verified static image alias
or a concurrent version directory. Alias availability remains unknown after this bounded inspection.

The service-UID fontconfig query used existing tools and an installed trusted
libseccomp library. Its child filter rejected file-opening write flags and file
mutation syscalls. Both regular and bold matched system DejaVu Sans, outside
release directories. Chinese language matching and the fixed sample's Chinese
glyph coverage were false for both. The sample is only a small availability
probe. No system-font substitute is approved for Sharp Chinese output.

There was no authorization to write server resources. No environment/credential
files, full configuration or private application data were output. No font was
installed, downloaded or changed. The Cloud Assistant invocation completed once,
with ID t-sh073h08vbtl1j4. A future image alias/destination and adequate trusted
Chinese system fonts still need verification before migration or font removal.
