# Stable 16.4.x compatibility review

Local review branch based on main 6de272701aa6a5ab41d7edb564651be271706ef1.
No dependency, lockfile, workflow, layer activation, server setting or production
change is part of this patch. Smoke branch 6c6c852 remains separate and unchanged.

## Range, profile and artifact are separate checks

Canonical stable 16.4.x labels are accepted (no leading zero, prerelease, metadata,
whitespace, non-string, out-of-range or unsafe numeric patch). They must match
one entire nine-file fingerprint group from next-source-profiles.json. Files from
different groups cannot be combined. A compatible label can reuse the same audited
group; an unknown internal implementation still requires source review.

The candidate group is the audited 16.4.5 source group. Dependencies and lockfile
remain exactly pinned to 16.4.5 for reproducibility/security. Old 16.4.1 source
does not become a valid new candidate merely because its version fits the range.

The app's expected version is compiled from apps/web/package.json's exact Next
dependency, and its source profile from the reviewed catalog. It never learns an
expected value from a live bridge, environment override or first status response.
For example, a future reviewed artifact pinned to 16.4.6 with the identical audited
group does not require a new patch-literal guard; a 16.4.5 artifact receiving a
16.4.6 bridge is still an artifact/runtime mismatch and is refused.

## Independent root expectation and negotiation

The production preload resolves package JSON and every audited source through
createRequire of the canonical immutable release entry. All resolved sources must
belong to the same Next package within the same root-managed release; the resolved
package version must equal that release's app dependency. Existing real HTTP,
ResponseCache and disk-cache hooks/module-cache identities remain checked.

Current frameworkWork uses protocolVersion 2 and adds sourceProfile. The HTTP
bridge protocol itself remains 1. The app requires the exact v2 field set; old
observers reject v2 rather than silently accepting extra fields.

SystemOps.framework_contract first verifies the retained layered closure and
invokes the trusted root-owned Node/preload inspector in static JSON/hash mode.
It does not execute server.js or call application/database services. The root
observer requires this independent contract BEFORE reading status. It checks the
artifact pin and reviewed profile against live version/profile/counters/epoch/PID.
The inspected inode/ctime/mtime/mode/owner identities are cached for the operation;
any change fails instead of refreshing expectations from changed files or status.

Only canonical retained entries for 7a811b326aa4b344cee08bc5a33c04e44a780fd4 and
fb4fb09f909c0ae5dce98ebd0d9540386685ddb7 retain the separately audited 16.4.1 group
and original exact v1 frameworkWork payload. No new fields are sent to old apps.
Unknown SHAs, changed old versions or mixed old sources are not recovery exceptions.

## Installation and remaining evidence

The app, preload, transaction/release observer and root-owned profile catalog are
companion changes. Backend/first-window and paired closure authentication now
includes the catalog. Existing reviewed ownership, immutable layer, process,
compatibility policy and maintenance controls still apply. This code installs
nothing and does not retrofit a bridge into a running process.

The ordinary GitHub layered route still calls the original layer activation
adapter, not BackendTransaction. This change does not repair the measured missing
preload launch configuration, implement a migration window or authorize restart.
The existing smoke branch is pinned to the old artifact/helper/protocol, so it is
not evidence for this new companion change and has not been rewritten.

Offline evidence: 12 focused Node/Python defensive tests pass, covering stable
label reuse, complete-group/mixed-hash rejection, immutable source ownership/module
boundaries, artifact-compiled reader expectations, v1 recovery/v2 negotiation,
independent observer expectations and immutable identity cache drift. Both groups'
nine hashes match their previously integrity-verified official local npm archives.

Focused application source type checking passed with zero diagnostics using
the existing cached TypeScript, Node types and Zod. No software is installed. Full transaction/first-window
filesystem suites could not execute successfully on Windows (temporary file and
directory permission/POSIX operations); these are not reported as passes.

Actual Linux module-cache behavior, ownership/signatures, compiled standalone
app/package contract, native hooks, protected requests, full transaction/recovery
and production companion installation remain unverified. A fresh exact candidate,
matched Linux smoke and separate root installation/activation authorization are
required before a production readiness claim. No paid/provider call is made here.
