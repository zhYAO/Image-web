# Mac business build and Linux runtime reuse plan

> **For agentic workers:** Use superpowers:executing-plans inline; preserve the user's original branch and unrelated working changes.

**Goal:** Deliver the approved A+ analysis/package/OpenAI changes through a fresh Mac business build and a verified isolated Linux candidate, without GitHub CI, local Ubuntu or a production Next build.
**Architecture:** Freeze a real local source commit, build in a separate clean checkout, export business-only artifacts with Mac provenance, then prove dependency/link/native closure against the existing immutable Linux runtime before considering activation. Keep original packer/runtime gates, never relabel a Mac runtime. If runtime reuse cannot be proved, report the exact missing dependency or incompatibility.
**Spec:** User-approved route and doc/requirements.md; current delivery state is only in doc/project-progress.md.
**Tech Stack:** Existing Node24.19.0/pnpm11.19.0/Next16.4.1; current source lock and config hashes; existing business-transfer and Linux layer tools.

## Constraints and review focus
- No push, GitHub CI, local Ubuntu, production Next build or production dependency installation.
- Preserve user's next-env change and env file metadata/values; no supplier credentials enter build, artifacts or logs.
- Runtime reuse requires indexed bytes/modes/link targets, exact Linux Node/ABI/glibc, complete dependency resolution and native/font tests; same lock is necessary but insufficient.
- Preserve Mac provenance and actual commit/build ID. No fabricated Git SHA, receipt or compatibility assertion.
- No historical retry/refund/delete/backup. Keep new suppliers, tariffs and package admission closed pending exact configuration.
- Do not apply migration6 under old public chat admission. Paired policy must be reviewed against actual artifacts; fresh authentication and security-policy decisions remain explicit boundaries.

## Tasks
- [ ] 1. Freeze source: verify code fingerprint and diff checks, scan only intended source paths, stage an explicit allowlist excluding next-env, env values, logs and temporary plans outside source handoff roots; make a local commit on the original branch. Create a separate clean detached build checkout without changing the developer checkout.
- [ ] 2. Formal Mac build: obtain only current public build DTO through existing verified HTTPS, store five permitted public keys outside source at0600 without displaying values. Verify cached toolchain, fonts/resources and frozen local dependencies. Build canonical Next .next and frontend with real source ID; retain complete source/build receipts and separately verify the strict business export.
- [ ] 3. Runtime candidate proof: review existing immutable Linux runtime manifest/index and bytes. Design the smallest bounded assembly step preserving source provenance; write failure tests before any reusable assembler code. Require all new reference/require/link paths to close within exact candidate plus permitted public asset link. Reuse runtime only after exact graph/config/lock checks; no Mac native payloads.
- [ ] 4. Isolated Linux validation: use existing SSH/Node and a new candidate directory only; strict CPU/memory/time bounds and no application secrets. Run original Linux packer plus Sharp/codec/font and candidate offline checks. Existing current/previous/caches remain unchanged. Obtain an independent review before candidate activation or root policy changes.
- [ ] 5. Paired release: only after exact artifacts and reviewed rollback exist, prepare the concrete root-owned policy and obtain required specific security/input approval. Seal admission, prove drain, apply migration6 with matching Web, activate the matched pair, require fresh protected local authenticated verifier and public health/version/closed-provider checks. No paid call or price enablement invented.

## Execution rulings
- The previous investigation report was approved as the execution route by the parent; no repeat general plan/production approval is needed.
- Use doc/separation for this release plan to follow existing release documentation and the source export allowlist.
- The source handoff guard was stale for already tracked dated plans/reviews and the exact SDK synthetic auth fixture. Five RED regressions and independent review cover a narrow dated-Markdown allowlist and path/whole-file/marker-digest exception; legitimate task plans join the release commit. Other credential/path checks stay in force.
- Preserve deployed SQL bytes, including an existing extra blank EOF line; use a one-command whitespace check excluding only blank-at-EOF, never change applied migration content for style.
- A detached build checkout is only a build input; development remains on the user's original branch.
- Local compilation and source export are authorized. Root policy changes, new access, owner-controlled login or uncertain compatibility are stop/report boundaries.
