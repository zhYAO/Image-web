# Local layered release prototype

This is an opt-in local packaging/assembly experiment. Existing CI and production
deployment are not switched to it. `release.py` still accepts a self-contained
archive; it does not accept a layer or a release manifest.

## Boundaries

| Layer | Contents | Reuse rule |
| --- | --- | --- |
| code | Standalone application/server output, generated `.next/static` JS/CSS, application packages and build metadata | Changes with the application build |
| dependencies | Every `node_modules` path, including internal pnpm links/native libraries | Exact lockfile SHA + Node version/ABI + Linux architecture/libc + content/index digest |
| static | `apps/web/public` except the five precise source PNG exclusions | Exact content/index digest |
| fonts | `apps/web/server/apparel/fonts`, including license/provenance | Exact content/index digest |

Daily code bytes include the code tgz, its file index, and the entire release
manifest. The default and maximum budget is **10,000,000 decimal bytes**
(9.536743 MiB). Failure to fit refuses the release manifest; it never removes
required code to fit. Changed static/font/dependency layers are additional
downloads. First install always needs all four layers and all four indexes.

Archives and indexes are deterministic and immutable. A release manifest binds
each exact archive SHA/index SHA, records the actual and expected build versions,
and must be delivered with a trusted manifest SHA. The dependency lock hash binds
the input lockfile; it is not proof that an upstream build used that lockfile.
Frozen-lockfile build provenance must be verified by the build pipeline.

The packer currently fingerprints the build host. Assembly conservatively
requires the identical Node patch/ABI, OS/architecture and libc string. This can
reject compatible but different target hosts. Before production integration,
define and validate an explicit target compatibility policy; do not silently
relax native compatibility checks or borrow installed host modules.

## Local use

Run from the repository root, using an already built, matching standalone output:

```sh
prototype_root=$(mktemp -d /tmp/zimage-layer-prototype-XXXXXXXX)
node ops/aliyun/package-release.mjs apps/web/.next "$prototype_root/full"
python3 ops/aliyun/release-layers.py pack "$prototype_root/full" "$prototype_root/store" \
  --release-id local-review --expected-build-sha "$(git rev-parse HEAD)"
```

The pack JSON reports the manifest path/digest and both transfer totals. Supply
that trusted digest explicitly to `assemble`:

```sh
python3 ops/aliyun/release-layers.py assemble MANIFEST_PATH STORE_PATH NEW_DESTINATION \
  --manifest-sha256 TRUSTED_MANIFEST_SHA256 --allow-sample
```

`--sample-label` is mandatory for mismatched/development inputs. Such an input
is conspicuously labeled. **Every output of this prototype remains
`productionReady: false`, including matching SHA/version inputs, and every local
assembly requires `--allow-sample`.** Matching marker strings do not establish
production readiness. Inputs must contain the generated server/client output,
BUILD_ID and required runtime files before measuring complete code. A sample
must never be uploaded as an official artifact or relabeled as a commit build.

Assembly verifies runtime, every cached layer/index, archive entries, file hashes,
permissions and final internal links. Missing or damaged layers fail closed;
there is no automatic download, package installation or network fallback. It
extracts to a unique new sibling directory and publishes using Linux
`renameat2(RENAME_NOREPLACE)`. Concurrent same-target attempts can publish only
one complete result. Existing directories/archives are never replaced.

Unused dangling *internal* pnpm aliases may already exist in a standalone trace
and are preserved. These are distinct from absent layers; required Next/Sharp
metadata and both fonts are checked. Assembly does not prove every application
route can execute: a matching-build startup/render smoke check remains required.

## First deployment, rollback and disk accounting

1. Transport all missing archives/indexes plus the release manifest. Verify their
   trusted digests before assembly; transport is deliberately not implemented.
2. Assemble locally, then run the existing health/version/static checks and a
   font/render smoke check. This prototype never starts a server or activates a
   release itself.
3. A rollback uses the old manifest and the exact layers it pins. Retain those
   layers, the old assembled release, licenses, and a tested independent backup.
   There is no automatic garbage collection or `latest` pointer.
4. Partial new scratch is removed only by its creating invocation on failure.
   No existing artifact or prior release is deleted.

The prototype materializes complete releases, retaining original public/static
paths and local font lookup. It reduces repeat *transfer*, not assembled disk
usage: cached compressed layers add disk usage and unpacked releases still carry
their full files. Disk deduplication/shared read-only installation is a separate
future change requiring deployment tests and authorization.

This prototype does not migrate static assets to URLs or change Nginx. A future
public resource URL migration must preserve legacy URLs, use immutable content
fingerprints, adjust `next/image`, retain rollback assets and validate CORS/cache
behavior as described in the audit.

## Validation

Generated Next map files under `.next/server` and `.next/static` are preserved in
the input and in a separate `<destination>.debug-maps.tgz`; they are omitted from
runtime archives/indexes. Public/dependency maps and map-suffixed directories are
retained. The sidecar is optional at runtime but must be kept privately for
debugging and associated with the exact build before production adoption. This
prototype does not upload it or establish Sentry online symbolication.

Generated regular `.js.nft.json` files under `.next/server` are likewise retained
in the input and a separate `<destination>.build-traces.tgz`, then omitted from
runtime archives/indexes. They are build-copy/diagnostic metadata, not modules.
Use the original build/staging for offline Next diagnostics. Trace-suffixed
directories and symlinks and public/dependency lookalikes remain untouched.

**The budget above measures compressed transfer, not uncompressed `dist`.**
The user's clarified5,000,000-byte uncompressed goal is not met: current QA
business output is42,545,964bytes and complete runtime files155,934,878bytes
after separating70 trace files (2,751,629bytes). All necessary client output,
dependencies and fonts are counted. See [raw-size evidence and limitations](../../doc/qa/2026-10-26-release-uncompressed-budget.md).

Code layers use gzip9 with encoding settings bound into the index identity;
other layers use gzip6. Current matching-version QA after trace separation has
daily code9,559,119bytes, including client JS/CSS/index/manifest. First required
download is69,643,254bytes, plus11,233,126bytes if source maps and175,628bytes if
traces are fetched. Earlier [QA evidence](../../doc/qa/2026-10-26-release-slim-current-qa.md)
records the preserved pre-trace-exclusion baseline.

```sh
node --test ops/aliyun/package-release.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/aliyun -p 'test_*.py'
```

Tests use new temporary local fixture files. Their Node probe loads the assembled
dependency link, application package, image and font bytes without starting a
network service. No cloud connection or paid generation is required.
