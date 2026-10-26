# Release slimming: local prototype, current production size unverified

Baseline source: `51cc0a953c7582fe19663d8afc497cca9e8cfbf5`.
Work is isolated on `codex/release-slim-51cc0a9`; original checkout is unchanged.

The official artifact `12645402037` was not downloaded or changed. Its supplied
outer ZIP is 90,907,063 bytes and SHA256
`403b1d6e5da0a82ca77db48f34a2a282a654ccaa0305109f7da4bb2987ba58ad`.
Its inner tgz size/digest remain unknown. Earlier Forbidden/download failures were
not retried or bypassed. No build, dependency installation, push, PR, Actions,
upload, Nginx edit, restart, deployment, or existing-artifact deletion occurred.

## Exact packaging change

Only these five `apps/web/public/` paths are excluded from both standalone and
public copy inputs; repository originals and provenance manifests are retained:

- `commerce/apparel-v1/source-contact-sheet.png`
- `commerce/apparel-v2/source-hero.png`
- `commerce/apparel-v2/source-detail.png`
- `commerce/apparel-v2/source-lifestyle.png`
- `commerce/apparel-v2/source-seated.png`

Their combined raw size is 11,063,941 bytes (10.551396 MiB). Current full SHA256s
match the two existing manifests. Runtime source audit found no dependency on
them: the UI uses prepared WebP/JPEG outputs, real rendering reads authorized
Storage uploads, and mocks read uploaded form bytes. Existing external source
URLs remain a compatibility concern requiring separately authorized static
hosting before relying on those URLs after deployment.

Three real Node packaging tests first failed, then passed: exact exclusions from
both copy inputs with source originals unchanged; all 44 prepared JPEG/WebP
files across v1/v2 and both manifests retained; similar filenames retained;
existing output directory/archive cannot be overwritten.

## Measured sample only

The only available compiled output is **Next 16.3.0 / Sharp 0.35.3 /
`ZIMAGE_BUILD_SHA=development`**, not the requested Next 16.4.1 / Sharp 0.35.5
production output. Measurements below combine that old output with current
public files. They prove local packaging mechanics and feasibility for this
sample, not a current official release result.

| Sample delivery | Decimal bytes | MiB |
| --- | ---: | ---: |
| Original self-contained packaging | 70,380,286 | 67.119871 |
| Self-contained packaging after exact PNG exclusion | 59,920,350 | 57.144499 |
| Actual self-contained archive saving | 10,459,936 | 9.975372 |
| Daily code: server + generated browser output + code index + release manifest | 8,822,577 | 8.413865 |
| First install: all layer archives/indexes + release manifest | 60,616,131 | 57.808047 |

The daily code total uses a 8,600,515-byte code tgz, 219,737-byte code index and
2,325-byte release manifest. It is below 10,000,000 bytes for this **sample only**.
The initial 4,736,485-byte code-only measurement excluded generated `.next/static`
and was rejected as incomplete daily accounting; it is superseded by this table.

| Layer | Compressed archive bytes | Index bytes | File bytes before archive compression |
| --- | ---: | ---: | ---: |
| Code, including generated `.next/static` | 8,600,515 | 219,737 | 38,660,214 |
| Runtime dependencies/native libraries | 13,323,858 | 501,814 | 47,534,914 |
| Public assets, five originals excluded | 10,180,630 | 16,450 | 10,273,530 |
| Fonts + license/provenance | 27,770,051 | 751 | 33,444,454 |

The separate archives plus integrity metadata slightly exceed the single full
tgz. First deployment and changed resource/dependency layers are additional
downloads; no required Sharp/native code/font is deleted to meet the code budget.
These figures describe release transfer, not browser first-screen network usage.

The sample pack and assembly both succeeded locally. Provenance is embedded in
the release manifest, and assembly required the explicit sample override. Sample
runtime is Node 24.19.0 / ABI 137 / Linux x64 / glibc 2.41. No sample is an approved
production deployment.

Final independent review found two Important issues, both reproduced and fixed:
all prototype outputs remain non-production even when marker strings match;
missing generated server/client output or BUILD_ID blocks packaging; overlapping
input/store/project/output paths and symlinked store output directories are
refused before writes. Final tests: **75/75 Python deployment tests (including
26 layer tests), 3/3 Node packaging tests**. These use local fixtures, not real
production HTTP/SSH checks. Non-glibc version fingerprinting is a deferred minor;
only the measured glibc environment is validated. Cache directories are trusted
private inputs, not certified against hostile concurrent filesystem mutation.

After the review fixes, a new local output store reproduced the same layer/index
digests and daily/first-install byte totals, and assembled successfully. No prior
sample artifact was overwritten. Release manifest SHA256:
`f524e9e60a6a3ecdfc7896b8a93ef88174d035d2ff5d80f509af14b420ce6fd9`.

## Prototype scope and remaining checks

See [local prototype usage and safety](../../ops/aliyun/LAYERS.md). Every release
pins content-addressed layer archives/indexes. Dependencies additionally bind
the lockfile and runtime fingerprint. Tests cover initial runnable assembly,
code/client output changes, reusable dependency layers, independent asset/font
versions and rollback, absent/corrupt layers, wrong manifest digest, wrong ABI,
existing output refusal, concurrent same-target publication, budget refusal,
development/version mismatch, internal pnpm link layouts and path traversal.

Current 16.4.1 daily code size is **unverified** because no matching build is
available and this task does not reinstall or rebuild it. A trusted matching
build, target runtime compatibility decision, actual HTTP/render smoke checks,
transport/activation integration and independent backup/rollback rehearsal are
required before any production adoption. Existing deployment workflow/helper is
not wired to the prototype. Static URL hosting/migration and image encoding
comparisons remain separate, unexecuted work; existing Sharp is sufficient for
the planned offline image pipeline.
