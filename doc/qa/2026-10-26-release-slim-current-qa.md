# Current-version release slimming QA

Local QA only; not original artifact12645402037 and not approved for deployment.
Application source is baseline `51cc0a953c7582fe19663d8afc497cca9e8cfbf5` on the
isolated slimming branch. No push, Actions, upload, production access or activation.

## Dependencies and single build

After explicit user approval, ran `pnpm install --frozen-lockfile --ignore-scripts
--store-dir <new QA store>` in the isolated worktree. Registry was
`https://registry.npmjs.org`; pnpm's supply-chain check passed1179 entries. No
lifecycle scripts ran. Required prebuilt native packages work without them.

Lockfile SHA256 before/after is unchanged:
`62b7a0a523438da5fad23d1a5be2926021ad566f6bde24d35ec2b1f425955d0c`.
Package manifests/workspace policy and original checkout remain unchanged.

Exactly one **Next16.4.1 / Sharp0.35.5 webpack QA build** passed in131.953seconds,
including TypeScript and49 static pages. It used HTTP/phase2-auth, the production
environment guard, placeholder public Supabase values, no Sentry DSN/token and
build ID `qa-slim-51cc0a9-20261026`. No production secrets were read. Build-created
next-env.d.ts changes were restored. Existing no-cache/global-error warnings kept.

## Actual current QA measurements

Decimal budget:10,000,000bytes. These are current-version QA results, not the old
Next16.3 sample and not an official production package result.

| Delivery | Bytes | MiB |
| --- | ---: | ---: |
| Full package after five PNG exclusions, generated maps included | 80,488,936 | 76.760231 |
| Daily code with maps, gzip6 | 21,250,446 | 20.266005 |
| Daily code with maps separate, gzip6 | 10,045,307 | 9.579951 |
| **Daily code with maps separate, gzip9** | **9,977,498** | **9.515284** |
| **First install: all required layers/indexes + release manifest** | **70,061,633** | **66.815980** |
| Reviewed full self-contained runtime tgz | 69,143,502 | 65.940382 |
| Separate optional debug tgz | 11,232,847 | 10.712478 |
| First required installation plus debug retention | 81,294,480 | 77.528458 |

Both over-budget attempts failed closed without publishing a release manifest.
Final daily code includes all staged server/application output and generated
client JS/CSS:9,776,761-byte tgz +198,384-byte code index +2353-byte manifest.
Headroom is only **22,502bytes**; future builds/real configuration must pass again.

| Required layer | Archive bytes | Index bytes | Raw file bytes |
| --- | ---: | ---: | ---: |
| Code, including generated client output | 9,776,761 | 198,384 | 45,297,593 |
| Runtime dependencies/native libraries | 21,249,085 | 867,168 | 69,670,930 |
| Public resources, five PNGs excluded | 10,180,630 | 16,450 | 10,273,530 |
| Fonts/license/provenance | 27,770,051 | 751 | 33,444,454 |

Changed resource/dependency layers are additional downloads. Assembled disk use
is not reduced to10MB. Browser first-screen traffic is separate and unmeasured.

## Maps and integrity

Current webpack produced423 server source maps:53,471,956 raw bytes and11,383,545
as independent gzip6 streams. The old Turbopack sample did not expose this cause.
Maps remain untouched in the build/staging and in a separate debug archive. Only
collected map files under `.next/server` and `.next/static` are separated; JS/CSS,
map-suffixed route directories, public maps and dependency maps stay intact.
GNU tar patterns escape glob characters. Code gzip level is bound into its index
identity, so changing encoding cannot silently overwrite a cached layer.

**No Sentry upload or online symbolication was performed or verified.** Before
production use, choose private debug retention/upload bound to the exact release;
CI upload configuration was not changed. Debug transfer/storage is shown above.

Reviewed runtime SHA256:
`9e5854a76fe39e1d9d09f383e4b830b828dc7a7c86f7f944980fc2bb94c23abe`.
Paired debug SHA256:
`5e1991d70144979c6edde2e85026a0e4d0b6d30a8824e4302c3facd9dc8f6a7b`.
Layer release manifest SHA256:
`285aedb84f53fda41bf8e7afb96a9c2f4a4dff34e632692d44f9fbaf70d5a799`.
Code archive SHA256:
`7d35e6a5ca1cdc072a543773210487e4d16cd2bbfa8d659eb4edaace7b2782ae`.
None identifies the original production artifact.

## Real runtime verification and limits

- Layer assembly passed. A new loopback child ran the assembled Next16.4.1;
  only that owned process was stopped afterwards.
- **33 checks passed:** QA build identity, public/retired pages,13 generated JS/CSS
  URL/file hashes, public JPEG/WebP/manifest hashes, five excluded PNG404s, real
  Next image optimizer200 WebP360x480, both Chinese font hashes and their
  JPEG/WebP/AVIF encode/decode dimensions.
- Protected `/api/account` and `/api/auth/session` returned503/network against
  placeholder identity RPC, not production-expected401. These are explicitly
  **unverified QA limitations**, not passing authentication checks; gates unchanged.
- Packaged Linux Sharp `.node` and `libvips-cpp.so.8.18.7` were confirmed loaded,
  no WASM fallback. Native library hash matches installed source:
  `4aa73553408c3964071728f4a231a8e86918e39bc49f1fbae75355f7ea933ea9`.
  Trace omits optional version JSON, so `sharp.versions.vips` falls back to8.18.6;
  actual loaded file/hash proof establishes8.18.7 instead of relying on that field.
- Fontconfig initially lacked writable system/home caches; process-local
  XDG_CACHE_HOME inside new QA scratch fixed it without permission changes.
- **8/8 real apparel-renderer tests passed.** Initial pnpm test invocation failed
  its auto-install/home-store check before running tests; direct execution of
  the installed Vitest runner passed, without global installation or escalation.
- **4/4 Node packaging and76/76 Python deployment tests passed.** Map regressions
  first failed then passed. Independent review found no present-build major
  issue; its map-suffixed-directory edge case was reproduced and fixed.

Manifests remain non-production and require local sample override. Native checks
cover Linuxx64/Node24.19.0/ABI137/glibc2.41, not arbitrary target hosts. Real public
build settings, authenticated backend flows, target compatibility, backup,
transport/activation and private debug retention still need authorized checks.
Original artifact/Library reads were not retried. No paid generation was invoked.
