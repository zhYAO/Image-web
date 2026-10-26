# Uncompressed release budget and lossless trace exclusion

Local QA only. This is not original production artifact12645402037. The existing
QA build is Next16.4.1/Sharp0.35.5 webpack, application source baseline
`51cc0a953c7582fe19663d8afc497cca9e8cfbf5`, build ID
`qa-slim-51cc0a9-20261026`, with placeholder HTTP/auth configuration. This round
did not install, rebuild, run Actions, upload, contact production or invoke paid
generation. The original build, release archives, source PNGs and fonts remain.

## Acceptance and result

The user's clarified target is **5,000,000 uncompressed bytes**, preserving all
pages, generation/export, supported languages/fonts, image quality and security.
The earlier approximately4MB XZ candidate was compressed delivery size. Its
approximately56MiB decoder peak was process memory. Neither met this target.

**The current implementation does not meet the5MB uncompressed target.** The
small verified optimization below reduces business output from45,297,593 to
42,545,964bytes. Packaging flags cannot make the existing emitted files fit.
This measured result is not a proof that a future architectural redesign could
never achieve5MB; no such redesign or functional reduction is authorized here.

## Mutually exclusive logical file bytes

Next has no single Vite-style `dist`. The runtime combines standalone traced
server/dependencies with generated `.next/static` and public files. Do not add
the original `.next/server` again on top of standalone. The following counts
regular-file contents once and does not follow pnpm symlinks.

| Category | Before trace exclusion | After trace exclusion | After MiB |
| --- | ---: | ---: | ---: |
| Server `.next` | 27,052,602 | 24,300,973 | 23.175214 |
| Client `.next/static`, including JS/CSS | 18,109,982 | 18,109,982 | 17.271025 |
| Other application entry/configuration | 135,009 | 135,009 | 0.128755 |
| **Business build** | **45,297,593** | **42,545,964** | **40.574993** |
| All traced runtime dependencies | 69,670,930 | 69,670,930 | 66.443377 |
| Server fonts/license/provenance | 33,444,454 | 33,444,454 | 31.895117 |
| Public assets, five source PNGs already excluded | 10,273,530 | 10,273,530 | 9.797602 |
| **Complete required runtime files** | **158,686,507** | **155,934,878** | **148.711088** |

There are4287 retained regular files and113 symlinks. The previous1118 business
files contained931JS files totaling41,590,325bytes and6CSS files totaling
223,012bytes. Those JS/CSS bytes remain unchanged:41,813,337bytes already exceeds
the requested budget before counting other application output. These are current
emitted sizes, not theoretical minimum sizes after future module optimization.

The previous assembled directory after smoke tests had158,885,219 logical
regular-file bytes:158,686,507 indexed runtime bytes,2353 release-marker bytes,
and196,359 runtime-cache bytes. It had no duplicate hardlink paths. `du -s -B1`
was170,233,856 allocated bytes; `du -sb` was158,892,474 including symlink text.
Filesystem block allocation, caches, tar headers, and decoder memory are distinct
from artifact file contents. The build's `.next` also contains cache and duplicate
standalone/source output and is not itself the deployable runtime measurement.

## Verified lossless optimization

Exactly70 regular files ending `.js.nft.json` under
`apps/web/.next/server/` total2,751,629bytes. The pinned Next local
`dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` describes
NFT lists as inputs to copying traced files. The standalone runtime serves the
already copied files. Pinned `dist/server`, `dist/shared` and corresponding ESM
runtime source contain no `.nft.json` reads. Build tools and the offline
`dist/cli/internal/static-routes-info.js` diagnostic do read them; those tools
must use the preserved original build/staging.

The packager retains traces in staging and a separate
`<destination>.build-traces.tgz`, excluding only those collected regular files
from runtime. The layer inventory uses the same roots/suffix. It preserves
symlinks, directories ending `.js.nft.json`, runtime children under those
directories, unknown `.nft.json` files and public/dependency resources. Literal
tar exclusions escape glob characters, including bracketed dynamic routes.
The new sidecar is protected against overwriting an existing artifact.

The sidecar contains the exact70 original files, raw2,751,629bytes,
compressed175,628bytes, SHA256
`1713dc44747dd32d0146f9379ce61a34c51f0d4d3923b801640f51f7a1b8fe05`.
Keep it privately with the exact build for trace/debug provenance. This is not
a replacement for Sentry source maps; all423 original source maps are retained
separately, raw53,471,956bytes. No online symbolication was tested.

## Verification and actual delivery costs

- Before editing, an isolated candidate copied the indexed runtime without the
  70 traces. All4287 retained regular-file SHA256 values matched the original
  indexes. The existing33-check real Next/static/Sharp/CJK-font/codec smoke passed.
- New packager and layer regressions first failed for missing exclusion/sidecar
  protection, then passed. Full Node packaging suite6/6 and Python operations
  suite77/77 passed. These are real temporary filesystem/CLI fixtures.
- The actual runtime archive was independently read and checked against the old
  file index minus exactly70 traces: every file hash and113 symlink targets
  matched, no additional files were dropped, raw155,934,878bytes. Both map and
  trace sidecars were inspected and counted. Actual layer assembly and its own
  33-check loopback runtime smoke also passed, separately from the manual candidate.
- Protected `/api/account` and `/api/auth/session` still return503 with the
  placeholder Supabase RPC. Real authenticated/generation/provider/export flows
  are not established by these checks. No security gate was relaxed. Application
  implementation, image/font bytes, lockfile and dependency versions are unchanged.

For transparency only, existing gzip settings yield daily delivery9,559,119bytes
(code archive9,371,694 + index185,196 + release manifest2229). First required
layers/indexes/manifest total69,643,254bytes. Complete runtime tgz68,767,319bytes,
SHA256`811f664ef10fb4a574a658f8cc6c0ae78ca04039a0cae76434d0caffe5c874b3`.
Separate source maps add11,233,126bytes and trace retention adds175,628bytes.
These compressed numbers are **not uncompressed5MB acceptance**. Changed layers
remain additional transfers; initial dependency/font/public contents are shown
in full above. Prototype outputs remain `productionReady:false`.

## Remaining scope and reasonable budget

The current runtime's largest files include libvips18,699,288bytes, two required
CJK fonts17,002,248/16,437,364bytes, esbuild11,427,952bytes, Next font metrics
4,301,622bytes, and server chunk1389.js4,254,063bytes. libvips/fonts are actually
used. Metrics are directly required by Next font-utils. esbuild and Babel are
traced candidates for further dependency-path investigation, not proven safe
deletions; removing them would not reduce business output42.55MB to5MB.

An initial budget of business50–60MB and complete runtime180–200MB is consistent
with this one QA sample and some headroom; real production configuration must be
measured before adopting it. The5MB goal requires a separately scoped examination
of the JS/module graph and potentially the application architecture, with all
languages, routes, security, generation and export acceptance retained. Changing
what counts by relocating dependencies/assets or counting only an incremental
bundle does not satisfy a complete uncompressed output target. No rewrite,
production migration, remote asset move or new infrastructure was performed.

Machine-readable measurements are in
[uncompressed results](2026-10-26-release-uncompressed-results.json).
