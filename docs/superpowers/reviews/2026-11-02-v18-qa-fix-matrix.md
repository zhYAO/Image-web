# ZImage v18 replication acceptance

Reference: approved Dot v18 source commit `2f0aaac25e6e85d785b39c50adff497606139f47`. Status as of 2026-11-02: all reported UI findings are closed in the observed GPT-6.1 Terra desktop/mobile checks. This does not certify every page/state or real backend readiness.

| Finding | Final change and acceptance |
|---|---|
| Product-main examples | Three reviewed perfume examples; the existing guarded uploader stays left. Examples never become input, and the hint directs the user to the real uploader. PASS. |
| Carousel | Complete overlapping last group of three; reference arrows; accessible status; definite cover width removes white strips. PASS. |
| Category controls | Existing category styling applied without changing real filtering. PASS. |
| Session rename | Bounded form/input, wrapped actions, trim/cancel/reopen behavior and native length limit. Observed layout PASS; persistence remains backend-unverified. |
| Account sidebar | Owner-scoped presentation bridge reuses the sole workspace SessionSidebar and its guarded callbacks; no second store or gateway. PASS. |
| Apparel examples | Desktop bounded four-column/three-row grid shows all eleven thumbnails at 1461×734; contained images and compact captions; notes expand/collapse. Phone 390×844 keeps two natural-height columns and working preview without horizontal overflow. PASS. |
| Mobile assets | Full heading width, import control placement and unbroken title. PASS. |
| Composer | Native resize handle removed; existing reference ownership retained. PASS. |
| Model region | Actual runtime model label shown; reference demo providers are not imported. Observed presentation PASS. |
| A+ output specification | Full 970×600 setting visible on mobile. PASS. |
| Product-main scene cards | Concise descriptions replace exposed internal guidance; the existing plan compiler retains full guidance. PASS. |
| Scene titles/navigation | Observed titles, homepage-to-workspace, sidebar-to-catalogue and mobile drawer checks PASS. |
| Account feedback | Visible owner-scoped safe mutation error feedback; automated regression passes. Writes were not exercised against real services. |
| Fixture corrections | Classified sessions and schema-valid generation/reference/task data; eleven local apparel JPEGs. Test-only data and HTTP harness remain outside Git. |

## Automated verification

| Check | Recorded result |
|---|---|
| Final apparel workspace/image suites | 16/16 pass, including disclosure/gallery regression observed red then green |
| Earlier integrated UI / upload-mode suites | 59/59 and 29/29 pass |
| Full domain suite | 209/209 pass |
| Full frontend suite | 193/195; two baseline Windows symlink setup failures below |
| Full Web suite | 1230/1235 before two obsolete upload-copy/location assertions were corrected; those suites subsequently passed 29/29. Three baseline symlink setup failures remain below. No inferred full-suite-green claim. |
| Typecheck / lint / budget | All three TypeScript projects passed; final web/frontend recheck and lint passed; final budget 5/5 |
| Builds / source guard | Complete Vite browser/SSR/assets/prerender pipeline and established CI webpack build passed; unchanged resource/source guard passed after final changes |
| API inventory | 16/16 pass using canonical Git blob bytes in isolated validation; API business files and frozen hashes unchanged |
| Independent review | Final owner/store integration and local presentation reviews PASS, no actionable findings |

Long full suites were not repeated for the final local presentation change. The final 47 changed code/test files matched the accepted frozen candidate byte-for-byte. Raw logs, manifests, screenshots, local environment records and preview scripts are deliberately not committed.

## Baseline limitations

These five tests fail while Windows creates symlinks (EPERM), before their security assertions. The same failures were reproduced on an untouched base snapshot whose 853 tracked files matched Git blob IDs. No test was skipped and no security setting was relaxed.

- `dev-server.test.ts`: serves only reviewed public media and rejects excluded sources, traversal and symlinks.
- `static-resources.test.ts`: static payload resource closure rejects symlinks and does not follow them.
- `apparel-font-files.test.ts`: rejects a font symlink escaping the version directory.
- `apparel-font-files.test.ts`: rejects a directory symlink escaping the version directory.
- `apparel-font-files.test.ts`: rejects a manifest symlink escaping the version directory.

Working-tree CRLF conversion also affects raw frozen API hashes; isolated verification used the unchanged canonical Git bytes. The correct existing external font package matched all pinned hashes and was reused read-only. No API logic, font payload, hash expectation or guard exclusion was changed to obtain a pass. A post-build test assertion edit once caused source drift; a fresh stable-source artifact and unchanged guard resolved it.

## Business and acceptance boundaries

The real default HTTP mode, owner/auth boundaries, shared references/drafts, uploads, generation/SSE recovery, credits, tasks and exports remain connected to their existing implementations. Available model IDs and pricing come from the runtime. No phone-code demo authentication or fake persistence was imported. Unsupported SMS, legal/registration and library actions remain truthfully unavailable.

Visual QA used synthetic owner/session/task fixtures with GET/HEAD only, rejected writes and no backend proxy. Real authentication, account/session mutation and persistence, private uploads, paid generation/provider/SSE recovery, credits/payment and real export/download delivery were not exercised. Exhaustive keyboard/focus/scroll/reduced-motion and all-route/state pixel certification were not completed. Those require separate authorized integration acceptance; this change does not establish deployment readiness.
