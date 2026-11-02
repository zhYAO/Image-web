# Exact v18 ZImage UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the user-approved Dot v18 presentation across the existing ZImage business frontend while preserving its working business and security contracts.

**Architecture:** Keep React 19.2.7 and Vite 7.3.6 in `apps/frontend`, its existing adapters, and the shared presentation in `apps/web/features`. Reuse the existing workspace, Zustand state and HTTP gateways; adapt visual components to their current props. The Next API runtime, Sharp implementation, domain contracts, release scripts and database are outside scope.

**Tech Stack:** React 19, Vite 7, TypeScript 6, CSS/CSS modules, Vitest/Testing Library, pnpm 11.19, Node 24.19.

**Spec:** User's delegated 2026-11-02 instructions and the exact v18 reference; `doc/requirements.md` and `apps/web/AGENTS.md` continue to define business invariants. The approved source archive is read-only. Expected source commit: `2f0aaac25e6e85d785b39c50adff497606139f47`.

## Global Constraints

- Start only after the parent explicitly reports Terra's source-versus-live v18 match PASS. Preparation is not that PASS.
- Branch `codex/replicate-dot-zimage-ui-20261102`; base `2c1c0c4e440fb7c856d966844487dd4b1fbbb1cd`.
- Preserve real authentication, uploads, generation/SSE, pricing/credits, persistence/recovery, owner isolation, private Storage and downloads/exports. No demo provider/session/store is imported.
- Source model options are visual references only; available model/provider IDs and prices come from the existing runtime. The source's local phone code `123456` must never authenticate or create a session.
- Keep registration/legal approval behavior. Missing backend features remain explicitly unavailable and are reported as business differences.
- Keep system fonts and existing reviewed resources; carry upstream notices and MIT + Commons Clause license for retained React Bits adaptations. Do not import raw fonts.
- All browser/UI work is assigned to the existing GPT-6.1 Terra thread by the parent. Do not create browser automation, launch competing previews, or run paid/production operations.
- Commit and normal push of this feature branch are separately authorized by the user. Do not merge main, create a PR, publish, change production DB/Storage, perform real uploads or run paid generation. Commit only business code, necessary tests and documentation; keep temporary packages, logs and machine snapshots outside Git.

## Review Focus

- Owner changes while a request is pending must discard stale results and must not submit a subsequent business POST (Task 2/3 regression suites).
- Mode/route navigation must preserve separate drafts, real session identity and image references without a second store (Task 2).
- Model menus must retain runtime IDs, availability and pricing; keyboard selection must send the selected existing ID (Task 2).
- Commerce previews/downloads must preserve actual task outcomes and owner checks; unsupported demo collection/favorite actions must not suggest server persistence (Task 3).
- Authentication/legal presentation must not introduce simulated success, enable unapproved registration or turn a 503 into a guest session (Task 4).

---

### Task 1: Shared material, resources and public homepage

**Files:** Modify `apps/web/app/globals.css`, `apps/web/features/brand/bridge.css`, `apps/web/features/brand/Glass.tsx`, `apps/web/features/brand/liquid-glass.css`, `apps/web/features/brand/landing/*`, `apps/web/features/controls/GlideSelect.tsx`, `apps/web/features/controls/glide-select.css` as evidence requires. Resource changes are limited to reviewed `apps/web/public/**` and, when necessary, `apps/frontend/build/public-asset-allowlist.json`. Preserve license files in `apps/web/public/licenses/`.

**Interfaces:** Keep `LandingPage()` and `Glass` public exports and the existing `GlideSelect` controlled contract (`options`, `value`, `onChange`, accessible name, disabled/open state). `apps/frontend/src/pages/home.tsx` remains a source bridge.

- [ ] Read Terra's exact source/live match result and complete route inventory; record the evidence link and business exceptions here before implementation.
- [ ] For any changed navigation/select behavior, first extend `apps/web/tests/brand-interactions.test.tsx` or `glide-select.test.tsx`; observe the specific behavioral failure. Pure spacing/color changes use Terra visual acceptance, not implementation-mirroring tests.
- [ ] Port the matched material, homepage geometry and motion from reference `src/components/landing`, `Glass`, `react-bits` and `src/styles/liquid-glass.css`; retain auth-aware CTA destinations and reduced-motion support.
- [ ] Run affected Web tests and frontend `public-pages.test.tsx`, `static-resources.test.ts`; all pass and public SSR makes no runtime requests.
- [ ] Hand homepage, select/portal and shared-material states to Terra before downstream visual work. Commit only after this task's checks pass, if commits are authorized.

### Task 2: Workspace, sidebar, composer and model menus

**Files:** Modify `apps/web/features/workspace/{WorkspaceFrame,SessionSidebar,UnifiedComposer,GenerationConfig,WorkspaceTimeline,HomeCommerceCarousel,CategoryFilters,ComposerOrbs}.tsx`, `workspace.module.css`, `session-sidebar.module.css`, `home-commerce-carousel.module.css`; create focused presentation helpers under the same feature only if needed.

**Interfaces:** `UnifiedWorkspace` remains the owner of references and business callbacks. Keep `UnifiedComposerProps` and `GenerationSelection` semantics; obtain model entries from current capabilities and `CHAT_PROVIDER_MODELS`, not reference `src/lib/model-catalog.ts`. Keep the single `WorkspaceApplication` and `WorkspaceHost` lifecycle.

- [ ] Extend `workspace-components.test.tsx`, `model-selection.test.tsx` and `apps/frontend/tests/business-runtime.test.tsx` only for changed behavior: keyboard selection sends the runtime ID; route round-trip retains the same draft; changing mode preserves image references. Observe a relevant new failure before adding UI state/behavior.
- [ ] Adapt reference `WorkspaceShell`, `WorkspacePage`, `WorkspaceComposer`, `ModelSelector`, `ProviderIcon`, `SceneCarousel` and workspace CSS onto the existing business components. Preserve real timeline states, pending credits, SSE recovery and safe Markdown.
- [ ] Run the above suites plus `unified-workspace-creation-modes`, `unified-workspace-references`, `unified-workspace-recovery`, `unified-workspace-sessions`, `session-drafts`, `composer-attachments-races`, `apps/frontend/tests/{owner-http-scope,stale-owner,private-download}.test.*`.
- [ ] Terra checks empty/session/loading/error workspace, open model menus, sidebar states, mode transitions and scroll at the same desktop viewport as the matched reference.

### Task 3: Five commerce flows and real asset library

**Files:** Modify `apps/web/features/commerce/{PublicCommerceCatalogue,CommerceCatalogue,CommerceChrome,CommerceEditor,CommercePlanFields,CommerceSelect,CommerceDetailPreview,CommerceTaskCard,CommerceWorkspace,ApparelWorkspace,ApparelResultImage}.tsx`, their existing feature CSS, and `apps/web/features/assets/{SessionAssets.tsx,assets.module.css}`. Limit edits inside business-owning containers to presentation composition; keep submission/recovery/ownership code.

**Interfaces:** Preserve `CommerceEditorProps`, `CommerceBrief`, `CommercePlan`, `CommerceSlot`, current gateway callbacks and persisted drafts. Preserve `SessionAssets({gateway,sessions,ownerKey,loading,error,onRetry})`; populate the visual library from real session assets, not source `library.ts` fixtures.

- [ ] Extend behavioral tests for any new editor UI state before implementation: settings reach the unchanged submission DTO, actual task state drives results, late private downloads are rejected after owner change.
- [ ] Port catalogue/editor/result composition for `product-set`, `detail`, `clone`, `product-main`, `apparel-catalog` from the reference commerce feature. Retain business-only validation, capability limits, uploads, credits and export affordances.
- [ ] Port asset layout/filter/preview presentation. Inventory demo favorite/collection/bulk actions against real interfaces; leave unsupported actions truthfully unavailable and document them instead of inventing persistence.
- [ ] Run `commerce-workbench`, `commerce-flow-regressions`, `commerce-ui`, `commerce-preview`, `commerce-image-visibility`, `commerce-safe-export-ui`, `commerce-safe-download`, `apparel-workspace`, `apparel-download`, `session-assets`, `assets-access`, and frontend `apparel-owner`/`private-download` tests.
- [ ] Terra checks create/catalogue, every editor's initial/configured/result/error view and assets empty/populated/filter/preview states with fixtures only.

### Task 4: Account, authentication and legal presentation

**Files:** Modify `apps/web/features/account/{AccountFrame,AccountPanel}.tsx`, `apps/frontend/src/pages/account-panel.tsx`, `apps/web/features/auth/{AuthPanel,ResetPasswordPanel,VerifyPanel}.tsx`, `apps/web/features/brand/{AuthShell.tsx,identity.css}`, `apps/frontend/src/pages/legal.tsx` and existing route presentation only as needed.

**Interfaces:** Keep `AccountPanel({account: Account})`, existing account refresh owner validation, auth POST DTOs, CAPTCHA and return-to semantics. The frontend account copy and shared Next account view must stay visually synchronized. Reference `AuthRoute`, `PhoneLoginForm`, `AccountLedger`, `LegalPage` supply layout only.

- [ ] Before changed form behavior, add a focused regression proving real API success/error handling, unavailable SMS login and legal-disabled registration. Run it red before implementation.
- [ ] Apply matched v18 form/account/legal layout while keeping actual account data/credit ledger, existing confirmation dialogs and unapproved legal text. Do not import `phone-auth.ts`, fake balances or demo success states.
- [ ] Run Web `auth-phone-placeholder`, `auth-delivery`, `auth-redirect`, `account-page`, `account-feedback`, and frontend `identity`, `account-reader`, `routes`, `runtime-boundary`, `business-runtime` tests.
- [ ] Terra checks login/register-disabled/recovery/verify/reset, account states and both legal pages; report unsupported v18 demo capabilities explicitly.

### Task 5: Integration, regression and acceptance

**Files:** Final review spans Tasks 1–4. Update `doc/project-progress.md` with actual current evidence and remaining differences only after checks. Do not change release scripts, server/domain/schema or production settings.

**Interfaces:** Existing Vite aliases, client boundary, allowlisted resource namespace and build source identity remain enforced. Public and private routes continue through current `route-policy.ts`.

- [ ] Run affected tests after each task. At integration run `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm --filter @zimage/web test:acceptance-budget`, `pnpm build` and `pnpm build:frontend` under Node 24.19 / pnpm 11.19. Supply only a real or explicitly fixture-backed local compatibility descriptor through the existing build contract; never weaken the guard.
- [ ] Verify `git diff --check`, resource closure, no new mock/runtime/backend dependencies and no business contract changes. Capture failures by name without claiming real-service acceptance.
- [ ] Parent arranges independent review after code stabilizes; address concrete findings and rerun only affected checks plus the final required gates when changes justify them.
- [ ] Terra performs paired same-viewport comparisons for every route/state in Tasks 1–4, including portal/focus, scroll and reduced motion; resolve visual differences or list the exact business exception.
- [ ] Report branch, changed scope, tests, Terra evidence, business differences and blockers. Only commit/push when separately authorized; do not merge or publish.

## Final evidence and scope

The approved source commit is `2f0aaac25e6e85d785b39c50adff497606139f47`. The trusted source inventory (204 files) and static export inventory (226 files) matched their SHA256 manifests; source and export were not modified. Terra matched the source to the live v18 reference before implementation.

The task checklist above records the original plan; it is not evidence that every proposed state or real service was exercised. The final observed scope, closed findings and test limitations are recorded in [the QA matrix](../reviews/2026-11-02-v18-qa-fix-matrix.md). The user's later instruction authorizes a normal commit and push of the feature branch only.
