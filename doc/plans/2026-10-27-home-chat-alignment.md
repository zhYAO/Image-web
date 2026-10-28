# Homepage and chat alignment implementation plan

> **For agentic workers:** Use superpowers:executing-plans; follow TDD and request one independent final review.

**Goal:** Serve the public brand homepage at /, keep one workspace at /workspace, and adapt the supplied React Bits presentation to existing real services.

**Architecture:** Reuse LandingPage at / and /home. Move only the workspace route identity and navigation, retaining the shared gateway, sessions, drafts, auth and billing. A small public-page auth provider checks only /api/auth/session and keeps the editor bundle deferred. Reveal prepares offscreen content before it can animate; already visible content is never hidden. One shared accessible select binds the existing registered models and commerce options.

**Tech Stack:** Existing Next.js 16.4.1 / React / Ant Design / Zustand / CSS modules; no new dependency.

**Spec:** User-approved scope recorded in the 2026-10-27 delegation: root brand home, /home compatibility, single /workspace, guest login CTA, authenticated login hiding, first-scroll flash fix, reference shell/composer/tooltip/select styling; only Doubao, MiniMax, Seedream. Local only, no push/PR/deploy, production access or paid model calls.

## Global constraints
- Preserve API contracts, billing, health, image capability restrictions, uploads, session ownership and transient drafts.
- Reference checkout 2450e9a is not proven identical to deployed Site version 18; do not claim visual parity without browser comparison.
- Browser native read denied; do not retry without new permission. Record screenshot/scroll/mobile visual checks as blocked if still unavailable.
- Sync dependencies using frozen lockfile; preserve existing acceptance evidence and generated Next agent block.

## Review focus
- Guest and expired-session navigation cannot loop between homepage, login and workspace.
- Legacy root scene queries and existing session/task/batch links retain destinations.
- Public auth timeout/error does not gate homepage render or expose authenticated UI.
- Fast scrolling, late hydration, keyboard focus and reduced-motion never hide already visible content.
- Shared selects work inside dialogs, preserve disabled choices and do not strand focus or bypass billing/health.

### Task 1: Public root, workspace routes and lightweight auth
Files: app/{page,workspace/page,workspace-host,application-shell,anonymous-auth-gate}.tsx; workspace-route.ts; WorkspaceApplication/UnifiedWorkspace; auth return paths; landing navigation/CTA; tests for route/proxy/auth/nav.
Interfaces: / and /home are public; /workspace is the sole blank workspace; /sessions and /create retain existing semantics. CTA returns to /workspace after login.
- [x] Add failing regressions for root isolation, workspace route/legacy scene compatibility, safe default login return, guest/authenticated CTA and header behavior.
- [x] Run focused tests and inspect expected failures.
- [x] Implement route migration and a small landing auth provider using only session endpoint, abort/epoch guards and auth-change events.
- [x] Run focused regressions; inspect all internal workspace links and login defaults.

### Task 2: First-scroll reveal
Files: landing/Reveal.tsx, react-bits/FadeContent.tsx, tests/brand-interactions.test.tsx or a dedicated reveal regression.
Interfaces: stable semantic host, server/no-JS content visible, motion enabled only when safely prepared offscreen; no late opacity reset.
- [x] Reproduce the delayed controller/visible-content behavior in a DOM timing regression; watch failure.
- [x] Remove delayed double-observer timing, prepare offscreen elements synchronously after hydration and retain visible/reduced-motion/focus fallback.
- [x] Run animation regressions including cleanup and preference changes.

### Task 3: Reference shell/composer and shared real selects
Files: workspace/SessionSidebar, WorkspaceFrame, UnifiedComposer, GenerationConfig, workspace CSS; commerce/CommerceSelect; shared GlideSelect and tests.
Interfaces: options are existing CHAT_PROVIDER_MODELS/image capabilities; existing onSelect handlers update real request state. Do not copy reference demo provider/state.
- [x] Add failing tests for expanded tooltip suppression, keyboard selection/focus/outside closing, disabled options and actual selected model in outgoing request.
- [x] Adapt supplied reference select with original license and fit existing popovers/dialogs; use it for model, mobile and commerce selections.
- [x] Align shell geometry (244/76px sidebar, 24px pad/gap, 984px composer), tooltip surface and input presentation, with bounded responsive overrides.
- [x] Run focused sidebar/composer/gateway/commerce tests.

### Task 4: Verification, preview and review
- [x] Run pnpm lint, pnpm typecheck, pnpm test:run, pnpm --filter @zimage/web test:acceptance-budget and pnpm build with local mock/public-safe configuration.
- [x] Start a local mock preview; verify HTTP routes and assets without paid upstream requests.
- [x] Request a fresh independent code review; fix substantive findings with regressions.
- [x] Update project-progress with current results and visual/real-service limitations; keep local development branch, no remote actions.

## Execution ledger
- Prepared from clean latest origin/main 9c5c3ea95e0c66193b23a2db50643530aa7d095a on codex/home-chat-react-bits-20261027.
- Pre-flight: Task 1 supplies /workspace navigation to Task 3; Task 2 shares only landing host. No interface conflict.
- Ruling: use user-requested existing branch in original checkout, not a new worktree; user explicitly selected direct local implementation.
- Ruling: focused tests per task, full required suite once before completion; avoid repeated unrelated long suite runs. Local commits are optional until final review.

- Task 1: route/home auth regressions RED 16 failures → GREEN 33/33 in 6 files (12.77s). Legacy query redirects handled before auth to keep root static.
- Task 2: animation regressions RED 3 failures/1 pass confirmed the visible-content opacity reset and absent offscreen preparation.

- Task 2: GREEN 7/7 reveal/brand tests. Task 3 initial focused GREEN 13/13 sidebar/scroll/model tests; window.scrollTo provided by the jsdom harness.
- Interruption: Mac execution environment became unavailable; first full test session 91041 stopped mid-run without a suite verdict. Its log preserves the then-missing CommerceSelect imports. Connection restored, no test processes remained; imports and unsupported RTL role flags fixed, typecheck passed.
- Independent review: original interrupted reviewer resumed the same review; found one Important document scroll reset issue. New regression RED 1/8 confirms it; visible empty workspace reset added, retained outside pages guarded. No other substantive source findings established.

- Additional control boundary test caught a genuine Window resize/scroll target passed to Node.contains; regression RED 1/4 with TypeError, fixed by a Node guard. Existing commerce tests now use the combobox/listbox roles and await the existing lazy wizard readiness rather than treating popup DOM as a native select.

- Current lint and typecheck pass. Initial QA build passed with 49/49 static pages; final rebuild includes the Window event guard.
- Loopback-only mock preview initial HTTP checks: /, /home, /workspace, /login, /create, /assets 200; /chat and /image redirect to /workspace; legacy product-set query redirects preserving platform; retired batch query/path 404. Final artifact HTTP recheck follows rebuild.
- Browser extension inventory recovered, but one reference-tab read again timed out on CDP focus emulation. Native CUA denial was not retried; screenshot/first-scroll frames/mobile visual parity remain blocked.

- User visual feedback supersedes earlier acceptance assumptions: landing Reveal controller child layout effect ran before the ancestor host ref attachment, never registering observers; the prior test exercised FadeContent itself rather than actual Reveal. Actual Reveal regression RED 1/5 reproduced it. Reveal now uses the host-owning FadeContent component directly, retaining the original fade/translate effect and delay.
- Collapsed sidebar regression: new tooltip span changed DOM direct-child selectors, preventing collapsed padding/alignment rules from matching. Structural regression RED 1/5 reproduced it. Tooltip now enhances the existing trigger without a DOM wrapper; original rail selectors match again, and icon bounds are constrained to 17/18px.
- Old full-suite snapshot stopped at user-prioritized regressions; it had two shared-font path string comparison failures on this Mac (/var versus /private/var; bold false/true), not a green suite. Preserve /tmp/zimage-final-tests.log. No screenshot-based acceptance claimed.

- Browser access recovered via a fresh Edge tab. Actual reference workspace read and screenshot obtained. Actual local reveal intermediate frames, rail width/alignment and keyboard tooltip, expanded tooltip suppression, model keyboard/focus/outside close and mobile390 layout verified.
- Bottom CTA tested while opacity0.376678/translateY17.453px: first visible pointer click navigated to guest login. All guest CTAs and authenticated-fixture login hiding verified without real credentials or model calls.
- A second Mac disconnect terminated test/preview processes; restored after checking uncertain command results. Auth-status migration actually executed and 17/17 passed. Remaining default verify return expectation migrated; final full run in /tmp/zimage-restored-full-tests.log.

- Final verification complete: pnpm test:run --maxWorkers=2 exits0, Web911/911 in124files (495.66s), Domain106/106 in12files; official Node25 storage flag + canonical TMPDIR retained. Latest lint/typecheck, budget5/5 and final product build49/49 pass. Product code unchanged after build; final expectation-only migrations retain all rejection assertions.
- Final narrow independent review found no substantive issues. Temporary auth fixture services and inactive QA output removed;3100 mock dev preview kept. Current status and QA evidence saved in project-progress and doc/qa/2026-10-27-home-chat-local.md. No push/PR/deploy or paid model calls.

- 2026-10-28 integration authorization: user explicitly requested commit/push of this feature branch for self-run on D1M. Keep main/PR/deployment and paid calls untouched; include [skip ci], do not change workflow or trigger CI. Product/test files match final acceptance; only README route description and handoff documents updated.
