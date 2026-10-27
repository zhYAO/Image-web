# Local three-layer release prototype

This opt-in tool does not install, upload, activate, deploy, run CI, or garbage-collect anything. Every manifest and result remains `productionReady:false`; assembly requires `--allow-sample`. The current QA build uses a test HTTPS asset domain and QA build marker and is not a production artifact.

It imports the existing `release-layers.py` canonical serialization, SHA, runtime fingerprint, deterministic archive, exclusive file publication and Linux `renameat2(RENAME_NOREPLACE)` tools without changing that script.

## Pack an existing staged release

```sh
python ops/aliyun/three-layer-release.py pack /tmp/staged-runtime /tmp/three-layer/store \
  --project /workspace/Image-web-slim-51cc0a9 \
  --assets /tmp/resource-output/ACTUAL_ASSET_MANIFEST_SHA256 \
  --assembly-cache-root /tmp/three-layer/cache \
  --release-id qa-three-layer \
  --sample-label 'QA sample; not production'
```

`--source-commit FULL_COMMIT_SHA` is optional provenance metadata. The actual `config.env.ZIMAGE_BUILD_SHA` and `BUILD_ID` are retained separately and never rewritten. Equality of marker/commit strings is not proof of a clean or reproducible build. Omit an unestablished source commit instead of inventing one.

The business raw budget is **unconfigured by default**. Reports then contain `budgetBytes:null` and `budgetPassed:null`: this means no cap was configured, not that a hidden size gate passed. To enforce an optional positive cap, add for example `--code-raw-budget 10000000`; a configured cap is checked against complete code raw bytes including indexes, the full release manifest and symlink targets. Successful capped reports contain `budgetPassed:true`. No sample label is required for any budget value. Exceeding an explicit cap exits nonzero without publishing a release manifest; validated immutable layer blobs may remain for reuse. Gzip sizes are independent transfer fields and never satisfy a raw cap. New manifests contain no 10 MB goal gate; historical goal fields are informational only.

The tool detects exactly one `apps/web/.next/required-server-files.json` or `apps/web/.next-build-qa/required-server-files.json` and requires `config.distDir` to agree. Both server and client chunks, workspace packages, and other business files remain code. Only paths with an exact `node_modules` component enter runtime. Generated server/static `.map` and server `.js.nft.json` files stay unchanged in the staged input as existing debug evidence, outside runtime delivery; omitted counts/bytes are recorded. Other `.map` files and `.map`-suffixed route directories remain intact.

Compiled image `remotePatterns` under `/static-assets/` must use HTTPS, an exact hostname/port, empty query, and exactly `/static-assets/ASSET_MANIFEST_SHA256/commerce/**`. Pack records the single `compiledAssetBaseUrl`, and assemble revalidates the actual extracted config. Identical resource payload with different manifest metadata is a different version and cannot be bound to stale compiled URLs. Builds without these patterns retain legacy local URL support.

All staged public/font files must match the independent asset manifest before being excluded. Missing public/font directories in standalone output are supported; the independent asset package must still be complete. The five original source PNG exclusions were already applied by resource/staging packaging; an unexpected staged source PNG is rejected, not silently discarded.

`assets` uses the original `asset-manifest.json` bytes as its file index and SHA identity. Its archive contains the 95 resource files, with the original manifest stored alongside the extracted cache for verification/font consumers. Fonts, licenses and provenance are public by explicit choice; private Storage content is excluded.

`runtime` identity binds lock SHA, full Node version, ABI, OS, architecture, exact glibc version, and every indexed file/link. Non-Linux or non-glibc samples are rejected. No global mutable dependency directory or package installation is used.

All source, project, asset-version, store and bound cache roots must be disjoint in both directions. Symlink input roots/output ancestors, environment files, path escapes and external archive links are rejected. Internal pnpm/workspace symlinks retain their original paths and targets.

## Assemble with a trusted manifest SHA

```sh
python ops/aliyun/three-layer-release.py assemble \
  /tmp/three-layer/store/releases/qa-three-layer.json \
  /tmp/three-layer/store /tmp/app-release-qa \
  --cache /tmp/three-layer/cache \
  --manifest-sha256 TRUSTED_RELEASE_MANIFEST_SHA256 \
  --allow-sample
```

Obtain the trusted release-manifest SHA from the pack result through a trusted channel. The cache root must equal the pack-time binding, so the generated public-link target and its raw byte count are exact. A production layout requires its approved ECS cache root and a new pack with the correct production build/config; the QA package cannot be promoted by rewriting markers.

Before assembly, every index/archive file is verified against its trusted SHA and byte count. Code archive members are semantically validated on every extraction. On runtime/assets cache misses, extraction also checks archive paths, duplicate/extra/missing members, types, sizes, permissions, link targets and file contents before atomic no-replace cache publication. On cache hits, runtime/assets archives receive checksum/size verification but are not decoded again for header/member semantics; instead the existing cache tree is checked file-by-file, including contents, links, modes and extra directories. No cache marker is trusted as proof. Incoming external/hard links and escaping paths remain forbidden.

Cache regular files are 0444 or executable 0555; directories are 0555. Runtime regular files are hardlinked into each application release at their original paths, and each release recreates the original symlink tree. `node_modules` is never replaced by a single symlink, so workspace aliases can resolve to business packages. Cross-filesystem `EXDEV` uses a verified private copy and reports copied file/byte counts instead of claiming hardlink savings. An owner/root can deliberately chmod and corrupt shared inodes; normal service writes are prevented, and cache verification catches tampering on reuse. The cache parent and application parent must have suitable traversal permissions for the service UID.

Every newly created cache/intermediate directory is explicitly chmod 0755 before immutable object directories become 0555, even under umask 0077. Existing ancestor permissions and the process umask remain unchanged. Deployers must check the actual application/Nginx UID and all existing ancestor traversal permissions. Serve only `CACHE/assets` over HTTP; never expose `CACHE/runtime`, the store, private Storage, or arbitrary application files. This prototype does not claim Nginx or production acceptance.

After code/runtime verification, the assembler creates exactly one controlled external link:

```text
APP/apps/web/public -> CACHE/assets/ASSET_MANIFEST_SHA256
```

Only the assembler can create this link, to the fully verified asset cache root bound by the trusted release manifest. Archive-supplied external links remain forbidden. This preserves old `/commerce/...` URLs and Next's internal image optimizer while new UI requests can use versioned HTTPS `/static-assets/SHA/...` URLs. No public resources are copied into each code release. Every exposed file is a selected public resource/font/license/manifest; no private directory is linked.

After generating `public`, every original archive symlink is resolved again against the final application graph, including cache-reuse assemblies. None may escape through `public` or any other path; only the assembler-generated `public` link itself is exempt.

The assemble result supplies local font environment values:

```text
ZIMAGE_SHARED_FONT_DIR=CACHE/assets/ASSET_MANIFEST_SHA256/fonts
ZIMAGE_STATIC_ASSET_SHA256=ASSET_MANIFEST_SHA256
```

Raw accounting separates regular file payload, original symlink target text, the generated public-link target text, code/runtime indexes, original asset manifest, and the complete release manifest. Full deployment raw includes runtime and all assets once; it is not hidden by layer reuse. `filesystemAccounting` separately reports logical regular bytes and unique-inode regular bytes across this release and its two cache objects; it excludes store archives/indexes and other releases and does not estimate filesystem blocks.

Application destination and release ID never overwrite existing paths. Concurrent cooperating publications use exclusive file linking and `RENAME_NOREPLACE`; only each invocation's unpublished staging is cleaned. Rollback means selecting a trusted old manifest and verified cache for a new destination; activation and GC are deliberately external.

## Offline tests

```sh
python -m unittest discover -s ops/aliyun -p test_three_layer_release.py
```

Temporary fixtures cover raw/metadata accounting, explicit-cap rejection of highly compressible large code, uncapped default reporting, actual QA markers, code changes reusing runtime/assets, lock/Node/ABI/content identity changes, native compatibility, resource mismatch/missing/corruption, trusted manifest/sample gates, original workspace links, exact cache checks/tampering, archive escape/duplicate/extra/external-link/missing members, concurrent publication, EXDEV copy reporting, bound cache roots, changing input size during inventory, stale archive size rejection, and source/old-release retention. Inventory uses stable file-descriptor reads and checks inode/device, size, timestamps and mode before/after hashing. Files changing during these checks, or whose archived bytes/size differ from the index, are rejected without a release manifest. No full application build or network is involved.
