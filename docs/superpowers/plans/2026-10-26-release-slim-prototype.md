# Local release slimming prototype

> For agentic workers: execute inline with superpowers:executing-plans. This is the explicitly requested local prototype, not a production deployment.

**Goal:** Exclude exactly five provenance PNGs while preserving repository originals, then measure a separate daily code layer against 10,000,000 bytes.

**Architecture:** Preserve the existing self-contained release format. Add an opt-in, local-only deterministic packer and assembler for code, dependencies, static assets, and fonts. Every release pins immutable layer digests. Assembly materializes a self-contained directory; it never activates services.

Generated `.next/static` JS/CSS belongs to the daily code layer. The reusable static layer contains public assets only.

**Tech stack:** Existing Node.js, Python standard library, tar/gzip; no dependency installation.

**Spec:** User delegation of 2026-10-26; baseline 51cc0a953c7582fe19663d8afc497cca9e8cfbf5.

## Constraints

- Isolated worktree; no push, PR, Actions, cloud upload, Nginx, restart or activation.
- Keep original PNGs, manifests, JPEGs/WebPs and existing artifacts.
- Full archive, first-install layers and subsequent code-only transfer must be reported separately.
- Dependency identity binds lockfile, Node version/ABI, OS/architecture/libc and content.
- Reject missing, changed, incompatible or unsafe layers before publishing an assembled directory.
- Retain old release manifests/layers for rollback; no automatic garbage collection.
- Existing Next 16.3 development output is a labeled sample only. Current 16.4.1 production size remains unverified without a matching build.

## Tasks and evidence

- [x] 1. Write and run real packaging regressions for exact PNG exclusion, retained neighboring images/manifests, and no overwrite. Implement the policy and rerun.
- [x] 2. Write failing layer round-trip and refusal tests. Implement deterministic content-addressed archives, release manifest, runtime identity, exclusive publication and safe local assembly.
- [x] 3. Test first assembly, dependency reuse, rollback, absent/corrupt layers, runtime mismatch, code budget and concurrent same-target assembly; run all deployment tests.
- [x] 4. Measure existing sample with conspicuous provenance, record decimal bytes and MiB, download totals and feasibility limits. Update the project ledger as prototype/unverified production.
- [x] 5. Obtain one independent whole-change review and resolve important findings before handoff.

## Review focus

- Symlinks and pnpm links can cross layers, but must remain inside the final release.
- Existing destinations and artifacts must never be overwritten or removed.
- Missing layers must not publish a partial release; parallel writers must never share a mutable staging directory.
- A runtime fingerprint or dependency content change must invalidate reuse.
- A small code layer must not hide the first-install, asset or native dependency transfer.

## Progress

- Authorized follow-up: user explicitly approved isolated frozen dependency install and one matching QA build. Install used ignore-scripts and a private scratch store; lock/input manifests unchanged. Single Next16.4.1 webpack build passed in131.953seconds.
- Current QA budget RED:21,250,446bytes with generated maps; still RED:10,045,307 after separate debug archive; GREEN:9,977,498 with gzip9 code plus index/manifest. All JS/CSS retained; first required layers70,061,633bytes, optional debug11,232,847bytes.
- New map split regressions RED then GREEN; Node4/4 and Python76/76, renderer8/8, actual assembled Next/native/static/font33 checks passed. Two placeholder-RPC503s remain explicitly unverified business/auth boundaries.
- Follow-up independent review: no present-build major finding. Regraded map-suffixed-directory exclusion as a required-code preservation concern; reproduced RED and fixed with literal collected-file tar patterns, GREEN4/4.
- Ruling: generated source maps remain in original build/staging and separate debug artifact; no Sentry upload/symbolication claim. Cost if debug retention is ignored on adoption: lost production diagnostics.
- Ruling: current QA passes code budget with22,502bytes headroom only; real settings/future builds must pass again. Cost if ignored: false general <=10MB guarantee.
- Ruling: retained protected API503 as QA limitation because placeholder RPC cannot verify identity; production401 gates unchanged. Cost if ignored: false authentication-readiness claim.

- Baseline and worktree established; original checkout untouched. Implementation has not started.
- Ruling: use a sibling worktree to avoid modifying the original checkout's ignore rules.
- Ruling: prototype authorization permits implementation without another design approval; no deployable infrastructure change is being made.
- Task 1: complete. Node packaging regressions RED 0/3 to GREEN 3/3; source originals retained, existing outputs protected.
- Task 2: complete. Local pack/assemble with deterministic indexes, SHA checks, runtime binding and Linux no-replace publication. Initial 13 tests GREEN; follow-up pnpm layout fixes each reproduced RED then GREEN.
- Ruling: retain unused dangling internal pnpm aliases exactly as standalone emits them; reject external links. Missing layers and required framework/font files are checked independently.
- Ruling: the initial 4,736,485-byte sample code result excluded generated browser assets and is superseded. `.next/static` must count toward the 10,000,000-byte daily budget.
- Task 3: complete. Final local deployment suite 75/75, including 26 layer tests; packaging 3/3. Missing marker, overlap and unsafe output parent regressions reproduced review findings RED before fixes GREEN.
- Task 4: complete for the explicitly labeled old sample only. Daily 8,822,577 bytes; first install 60,616,131 bytes. Current production remains unmeasured; no new build/install/Actions.
- Final review: one independent reviewer found 2 Important and 1 Minor issues. Important issues fixed: all prototype outputs remain non-production and missing generated output blocks packaging; symmetric input/store/project/destination overlap and symlinked store output directories are refused.
- Final: minor (deferred): non-glibc runtimes share a generic libc label. Only the measured Linux/glibc environment is validated; define explicit alternative-libc support before production integration.
- Final: Ruling: no real Next/native startup is certified from fixture execution; matching-build HTTP/render smoke checks are still required. Cost if ignored: an assembled directory could fail at runtime.
- Final: Ruling: official production size cannot be certified without its matching build; old sample identity remains embedded and gated. Cost if ignored: false <=10MB claim.
- Final: Ruling: transport/activation are deliberately absent from this local prototype. Cost if ignored: existing production helper cannot consume a layer manifest directly.
- Final: Ruling: cache storage is trusted/private; hostile concurrent local filesystem mutation is not certified. Cost if ignored: integrity checks alone are not a complete defense against a hostile cache owner.
- Ruling: keep the isolated worktree/branch and all measurement artifacts; do not merge, push, remove existing output, or ask for an integration choice already excluded by the user.
