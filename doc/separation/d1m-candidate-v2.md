# D1M narrow candidate V2

Local implementation based on main `2150286cb890cc93c3a430448beecb8a6cc9bb1c`.
This is a new change, not candidate `eb8356340d0a1f4627dcc507d89003936b3ad584`.
The original candidate remains unchanged; its Library handoff could not preserve
required metadata with the current Windows helper.

## Manual workflow contract

Only `workflow_dispatch` remains. All actions require the main ref:

- `checks`: existing quality, coverage, build and database checks, explicitly requested.
- `candidate` (default): build and package only; no production environment, SSH,
  deployment secrets or write token. Existing native/target, slim-size and retired-route
  packaging checks remain. No duplicate quality/database job runs automatically.
- `deploy`: requires `candidate_run_id` and `candidate_attempt`, plus the same
  `format` selected for that candidate. No install or application rebuild occurs.
- `rollback`: existing retained-release path and production protection remain.

The candidate artifact contains exactly transport.tgz, release-result.json,
dist-size-report.json and candidate.json. Retention is one day. The summary
contains transport bytes and the existing distribution size report. Layered
candidates use the existing cold transport packaging mode, without production
inventory access. This trades missing-only upload optimization for credential-free
candidate construction; deploy sends the exact original transport without repacking.

Release selection requires this repository, the trusted ci.yml workflow ID/path,
successful completed manual main run at the current main SHA, successful
candidate-build job, no deploy/rollback execution, explicit run/attempt, one
matching unexpired artifact younger than a day, GitHub artifact SHA256, and
matching internal provenance plus transport SHA256. Missing digest fails closed.
The ZIP is verified before extraction; unexpected/duplicate paths and special
file types are refused. Main and run/expiry are rechecked after download.
Archive download bytes, total expansion, and per-member sizes are bounded;
transport uses the existing 2,000,000,000-byte cap and each metadata file is
limited to 1,000,000 bytes. Transport hashing and extraction use bounded chunks.
The ZIP envelope uses a strict four-file reader; the existing production
installer still validates the inner transport and applies its trust policy.
The selected artifact ID/digest/metadata and local file hashes are retained
inside the private job directory. After recording the production rollback
point, the upload step rechecks artifact identity/expiry, run attempt/status,
workflow/repository binding, local regular-file hashes and current main before
upload. Recheck does not redownload, rebuild or repack. Local paths reject
symlinks, non-regular files and multiple hard links.
Existing production target/report checks, current-main check, exact original
release recording, installed helper/target validation, activation, health and
recovery remain in the sole workflow deploy job. No new human approval is added.

## Unverified deployment prerequisites

This change does not establish Linux/native compatibility, installed server
closure, fonts/licensing, target enablement, public configuration correctness,
credentials, rollback health, or real artifact API behavior. It does not install,
deploy, trigger Actions, change GitHub settings, or enable business features.

Candidate jobs cannot read production-scoped variables. Required nonsecret
public build configuration, measured target and provisioned font source must be
available in an approved scope to the build runner. Repository variables were
empty at preflight; production-scoped variables alone are insufficient. The
existing target gate fails before install if target configuration is absent.
Organization variable availability has not been verified. No scope was changed.

Local verification uses synthetic API metadata/ZIPs and existing packaging
argument tests. Windows Node 22 tests do not certify the locked Linux Node
24.19.0/pnpm 11.19.0 production runtime. No dependencies are installed for tests.
Read-only GitHub metadata and upload/activation cannot form one atomic transaction;
a trusted runner and existing server-side activation/health gates remain required.
The added pre-upload check narrows the observation interval and does not claim to
lock main against concurrent changes or protect a compromised runner account.

The standalone paired frontend/backend operations CLI is unchanged. This V2
does not replace its separate authorization/evidence contract or claim a paired
business release is ready.
