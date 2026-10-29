# Default three-layer release contract

The default package is code + immutable versioned runtime + independent original resources. `package-release.mjs` stages and checks the application once, then uses schema 2 of `three-layer-release.py` and `release-transport.py`. All reports retain `productionReady:false`: local validation does not establish Linux deployment or external acceptance. No garbage collection exists; retain releases, store objects and caches referenced by current, previous or any retained release.

## Exact target and resources

Supply an administrator measured target JSON with exactly `schema`, `runtime`, `toolchain` and `assemblyCacheRoot`. This is a shape example, **not a measured production target**:

```json
{"schema":1,"runtime":{"node":"24.19.0","abi":"137","platform":"linux","arch":"x64","libc":"glibc-REPLACE_WITH_ACTUAL"},"toolchain":{"packageManager":"pnpm@11.19.0"},"assemblyCacheRoot":"/opt/zimage/layer-cache"}
```

Record the actual exact glibc value and verify it on the build host and server. Node/ABI/platform/architecture/libc must all match. A runner label such as ubuntu-24.04 does not prove compatibility with another Ubuntu/glibc release. `node ops/aliyun/package-release.mjs --check-target --target /safe/target.json` checks the actual host and package manager before any staging or archive output. Windows cannot package for Linux through an override.

Create the **complete** original resource manifest with `package-static-assets.mjs --font-source ORIGINAL_VERIFIED_DIRECTORY --output NEW_OUTPUT`. Omit `--fonts-only` for releases. The source must contain both original Noto OTFs, their original license and provenance; see [FONTS.md](FONTS.md). Original `asset-manifest.json` bytes and their SHA are the resource identity. Same-origin delivery keeps `NEXT_PUBLIC_STATIC_ASSET_BASE_URL` empty; schema 2 explicitly binds `same-origin-public`, a null compiled remote base and the sole generated public link to `/opt/zimage/layer-cache/assets/<manifestSHA>`. Actual compiled configuration is rechecked. Schema 1 retains its original absolute production URL requirements in the privileged adapter; it cannot borrow the new same-origin declaration.

Static JS/CSS, server code and workspace code remain in code. Only exact `node_modules` path components enter runtime. Runtime identity binds actual indexed contents, paths, modes and link targets, lock SHA, exact runtime, pinned package manager, original config source hashes and the stable compiled dependency resolution subset. Same lock with changed traced files, native aliases, config or toolchain produces another runtime identity. Old weak cache identities never satisfy schema 2. `.node`, `.so` and numbered `.so` require matching Linux ELF headers; `.dll`/`.dylib` are rejected. Headers do not replace the original Sharp/native/font loading probe.

## Cold pack and incremental transport

Use full lowercase SHA40 values and new output directories outside the project; their parent must exist. Build an HTTP/slim Webpack standalone on the exact compatible host first, with source SHA, BUILD_ID and compiled build marker equal. This document does not run that build.

```sh
node ops/aliyun/package-release.mjs apps/web/.next /tmp/zimage-cold \
  --assets /safe/resources/RESOURCE_SHA64 --release-id RELEASE_SHA40 \
  --target /safe/target.json
```

Cold output includes `staging/`, `store/`, `inventory-request.json`, `release-result.json` and one `transport.tgz` containing all seven immutable closure objects. Optional `debug-maps.tgz` and `build-traces.tgz` are separate private diagnostic artifacts and must never be uploaded to the server. `release:pack` selects layers. Explicit fallback is `node ops/aliyun/package-release.mjs apps/web/.next /tmp/zimage-full --format full` (or `release:pack:full`); it produces `/tmp/zimage-full.tgz`, preserving original full-package preflight.

For incremental delivery, prepare without producing a cold outer archive:

```sh
node ops/aliyun/package-release.mjs apps/web/.next /tmp/zimage-prepared \
  --assets /safe/resources/RESOURCE_SHA64 --release-id RELEASE_SHA40 \
  --target /safe/target.json --prepare-only
# After verifying installed helper hashes and enabled exact target (manual runbook):
ssh EXISTING_RESTRICTED_IDENTITY 'sudo /usr/bin/python3 -I /usr/local/libexec/zimage-three-layer/release-three-layer.py inventory' \
  < /tmp/zimage-prepared/inventory-request.json > /tmp/zimage-inventory.json
python3 -I -B ops/aliyun/release-transport.py bundle \
  /tmp/zimage-prepared/store /tmp/zimage-prepared/store/releases/RELEASE_SHA40.json \
  /tmp/zimage-delta.tgz --manifest-sha256 TRUSTED_MANIFEST_SHA64 \
  --inventory /tmp/zimage-inventory.json
```

Read the trusted manifest SHA from `release-result.json` at `pack.manifestSha256`; obtain the measured outer SHA from the bundle result, independently checking the final file. The inventory operation accepts at most seven precise descriptors through at most 16 KiB stdin, uses only the fixed root-owned store, hashes requested files and returns verified hashes/sizes. Missing files are absent. A corrupt or unsafe existing privileged store object is an error, never permission to overwrite it. Pure local advisory inventory deliberately treats corrupt/unsafe objects as misses. Inventory always remains a hint: forged or stale hits cannot authorize activation. The adapter validates every omitted object and every existing immutable file before publishing, then the entire seven-object closure, schema/index bindings, accounting and actual runtime/assets caches again before activation. It never fetches, silently falls back or rewrites manifest bytes.

`release-transport.py request|inventory|plan|bundle|unpack` are offline operations; `unpack` accepts a validated subset with the mandatory trusted manifest as well as historical seven-object bundles. Code-only transport may reuse all runtime/assets objects; all-hit transport still contains the release manifest. A fresh release always has its exact manifest identity.

## Accounting and activation

`pack.raw` describes complete indexed raw payload and metadata; `transport.rawTransferBytes` / `compressedTransferBytes` describe selected inner objects, while `transport.bytes` measures actual outer compressed bytes. These fields have different boundaries. Staging size is not network transfer. No 10 MB cap is implied; an explicit configured raw budget is enforced separately.

The privileged adapter has fixed production paths, no arbitrary input/store/cache CLI paths, the original non-root native/font probe, root-owned immutable stores/caches and the shared legacy `deploy.lock`. Normal deploy requires a valid exact current release and preserves original local HTTP/TLS failure recovery. Explicit `--initial-deploy` is manual only, requires no current/previous/dangling/temporary links, deployment sequence or retained release, and validates closure first. On attempted initial activation failure it stops zimage and removes only its own current link, without inventing an old release. Validated retained files/caches remain for administrator inspection; the helper does not delete them to make a retry look empty.

Rollback takes an exact retained SHA. Layered targets are reconstructed from the trusted retained manifest and store, with exact runtime/cache/config/resource bindings and all retained file/link/env bytes checked before the native/font probe and selection. Full retained targets follow original full gates. Health recovery chooses the target's retained format, not the failed deployment's format, and restores only the original recorded SHA when current still names the failed SHA. Same-SHA normal retries accept byte-identical release content even if the new outer transport differs; the first outer hash remains as audit metadata. Same-SHA health failure never rolls back an older previous version. The exact manifest/environment/cache bindings cannot change.

See [MANUAL-THREE-LAYER-RELEASE.md](MANUAL-THREE-LAYER-RELEASE.md) for future administrator installation, initial/incremental/rollback commands and unexecuted acceptance gates. No installation, service operation, server connection, CI run, native Linux acceptance or release garbage collection was performed. A retired shell-fixture PATH error caused one failed reserved-host SSH/DNS attempt; its exact evidence and replacement mock protections are recorded in the Task 3 handoff report.
