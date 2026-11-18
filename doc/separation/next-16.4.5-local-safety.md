# Local Next 16.4.5 safety preparation (2026-11-18)

Base: exact main 64dc732079ec2f79a79d7c51a6416e5e48aad624. This local patch
does not publish or activate a release and is not the unavailable cloud candidate
eb8356340d0a1f4627dcc507d89003936b3ad584.

## Vendor and lock provenance

[Official release](https://github.com/vercel/next.js/releases/tag/v16.4.5)
published November 3 documents security fixes. Official npm pack, with scripts
disabled and registry.npmjs.org selected, produced both source archives. Their
SHA512 values match the original and newly resolved pnpm lock entries respectively:

- 16.4.1: `uc657V62E34fOI6W5NtG9IzwsPcms0Z60grz2MJGtglgD+pTFnNt4Yw2PzaU622tfX4vhrDgLZzicE2YlhI20Q==`
- 16.4.5: `rmdfsWosjTUO+6R0S3KokoIk6Kj0sWDRTe86tZHdqaWH/oXq/udX3/4xb+YQi7aWbyEFoglDU54kaifLCdXbBw==`

Node 24.19.0 and pnpm 11.19.0 were already available on D1M. Online pnpm add
timed out downloading package tarballs, and offline add lacked the new tarball in
its store. No install scripts ran. After setting the exact package declaration,
standard `pnpm install --lockfile-only --ignore-scripts --offline` completed
successfully using the official resolved metadata. Only Next, its @next/env/SWC
vendor versions and dependent peer identities change; other declared packages
remain pinned. Existing eslint-config-next 16.4.1 is a lint-only dependency and
is unchanged. No full working dependency installation or build was completed.

## Admission source audit

All nine original SHA256 pins match the official 16.4.1 archive. Comparing those
nine files to 16.4.5 yields only two changed files (76 unified-diff lines):

- start-server.js: process-title version literal changes; awaited HTTP callback
  boundary is unchanged. New SHA256: `2beb0e087fc69702d0eb7b67e5fd0f95fa216d6463dc3732c9a2966310aea5ad`.
- next-server.js: fetched-response framing header filtering, middleware trace
  context and internal cookie-header filtering change. New SHA256:
  `b213afa46803f94a38aa506c6b130eeb94841d7e1ca37686357adf2637cce69e`.
- ResponseCache, image optimizer, batcher, scheduler, disk LRU, LRU and image
  transform are byte-identical. Their exact existing pins remain enforced.

New runtime accepts only 16.4.5 plus the audited source hashes, not a version
range. The two exact retained source SHAs have a separately encoded old source
profile and path/trust check for recovery. This is not a blanket 16.4.1 allowance.
The transaction observer also binds legacy markers to those exact SHAs.
The application lifecycle reader independently requires the current exact marker;
its three version checks and related synthetic fixtures are updated as well.
The Nginx-referenced app-router-headers source is byte-identical in both official
archives, so no Nginx configuration or historical fixture protocols are changed.

## Local validation and remaining test gaps

- Five Node version/source-profile/path/trust-boundary tests passed.
- Two pure Python process-evidence tests passed, including old versions allowed
  only for the two exact historical source SHAs and malformed versions rejected.
- One test of the actual application lifecycle source passed after transpilation
  with the already-installed TypeScript compiler and synthetic bridge metadata.
- All nine pins for both profiles match their respective official npm archives;
  lock semantic comparison confirms unrelated package records/importers unchanged.
- Existing local HTTP admission subset: nine passed, one failed with Windows
  socket write ECONNABORTED. The single failing case was repeated once and tested
  against the exact unchanged baseline; both produced the same ECONNABORTED.
  No HTTP implementation, test expectation or security protection was weakened.
- `git diff --check` and the offline standard pnpm lock-only operation passed.

Full dependency installation, actual patched Next/Sharp cache-hook integration,
Vitest/application tests, lint/typecheck, acceptance budget and ordinary application
build were not completed. Linux/POSIX ownership/systemd and real rollback behavior
remain untested. These gaps prevent a production-readiness claim.

## Historical source comparison and deployment limits

Canonical repository commit APIs and local objects agree for production source
7a811b326aa4b344cee08bc5a33c04e44a780fd4 (tree b6d9c5f49da468150f0ca753fa4487e608ffe2ef)
and retained rollback source fb4fb09f909c0ae5dce98ebd0d9540386685ddb7
(tree fbcb2750358586390392b454f3c4c04b5c6cf831). Both are ancestors of the
main baseline. These are source provenance checks, not new live server readback.

Main already differs from 7a811b3 in metering/tier/cache-write token contracts,
provider receipt checks, isolated diagnostics and related migration files,
as well as release tooling/docs. The older rollback source additionally predates
the image-analysis/versioned-billing and v18 UI integration. This narrow patch
adds no such features. Source ancestry does not establish regression absence,
database/Worker compatibility, or permission to apply those migrations.

http-admission.cjs and transaction.py hashes change. Existing reviewed root helper
closure/systemd and paired-operation policies cannot be assumed to accept them.
Separate reviewed installation/closure verification, exact current/previous and
schema/Worker/catalog evidence, Linux native/admission/drain/recovery tests,
fresh candidate build and explicit activation approval remain necessary. The
successful baseline candidate 44245726919 is for the old exact source and cannot
be reused as evidence for this new patch. No server, cloud setting, Turnstile,
database, Actions or remote Git state was modified.
