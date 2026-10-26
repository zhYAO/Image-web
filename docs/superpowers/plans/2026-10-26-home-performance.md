# Homepage performance implementation plan

**Goal:** Improve initial `/home` and `/` loading without changing the design, motion, authentication enforcement or creative features.
**Architecture:** Keep the public landing page server rendered. Load the existing application providers only when entering application routes, then retain that tree across navigation. Load rich assistant rendering only when a message needs it. Avoid speculative workspace downloads while authentication is unresolved.
**Tech stack:** Next 16.4.1, React 19.2.7, TypeScript, Vitest.
**Spec:** User request of 2026-10-26: diagnose access failure, establish reproducible performance baselines, optimize locally on an independent branch, no push/merge/deploy/production changes or paid model calls.

## Constraints and review focus

- Preserve ownership resets, server authentication, persistent workspace navigation and login return URLs.
- Preserve SSR landing content, animation intent, reduced motion, images, fonts and responsive navigation.
- Never substitute mock/fixture evidence for production health or authenticated real services.
- Measure TTFB, FCP, LCP, CLS, compressed JS/CSS, waterfall and main thread work using the same browser/network/cache conditions, three repetitions per route/profile.
- Keep logs/screenshots outside the tracked repository. No credentials in deliverables.

## Tasks

1. Baseline: locked dependencies, webpack production mock build with formal auth enabled; browser fixtures return only a synthetic identity after 500ms; block external requests. Capture `/home` and `/`, desktop 1440×1000 and mobile 390×844, 150ms RTT / 1.6Mbps / 4× CPU, cold browser cache. Production DNS/TLS/HTTP checks are blocked by environment transport; record this separately.
2. Add regression tests first for public landing isolation and provider retention across `/` → `/home` → `/`; verify failing behavior. Move existing provider nesting into `app/workspace-providers.tsx`, load it from `app/application-shell.tsx`, and preserve the tree after first entry. Remove unconditional workspace prefetch from `app/client-workspace.tsx`; test checking/error/guest paths never load the editor.
3. Defer `AssistantMessageContent` from `WorkspaceTimeline.tsx` until a message is rendered; retain the existing safe renderer. Verify structured messages, Markdown, streaming and image previews. Add bounded server identity work only if supported by evidence; do not guess at production auth failure.
4. Run relevant tests, lint, typecheck, full test command, budget check and production build. Repeat the identical benchmark and inspect screenshots, navigation, errors, mobile menu and delayed messages. Record exact outcomes and limitations in `doc/project-progress.md` and a diagnostic report. Do not publish.

## Decisions

- Use the fresh task checkout on `codex/home-performance-20261026`; no additional worktree is needed because it was clean and dedicated to this independent session.
- User already authorized local performance implementation. Execute the plan in this session; no extra approval gate for reversible local work.
- Retain evidence under `/workspace/scratch/zimage-diagnostic/`; do not commit raw logs or screenshots.
- Mobile baseline found a zero-width main column: the final responsive rule changes the workspace grid to flex, while `.main` had no flex growth. Add `flex: 1` in the existing mobile `.main` rule and verify actual browser geometry. Baseline mobile `/` meaningful readiness is unavailable (blank page), so its spinner FCP/LCP cannot establish a successful loading baseline.
- First comparison waterfall showed desktop `/home` still auto-prefetching login/assets code (376639 script bytes versus mobile 217449). Reuse the existing `IntentLink` for visible application links and CTAs so navigation warms on hover/focus/touch rather than competing with initial render. Browser-check no login prefetch before intent and successful navigation after intent.

## 2026-10-26 02:58 UTC user addition: unauthenticated navigation

Confirmed guest workspace visits return to the public `/home`, never the login page. Preserve error/timeout as error, manual retry and per-request server authentication. Direct public landing must remain independent of identity service. Explicit login routes stay accessible. Apply the same rule to account page 401, expired account actions, and successful logout; a failed logout/service request must neither clear a valid session nor redirect. Use replace to avoid keeping the protected current entry in history. No new persisted return URL: guests requesting protected deep links intentionally return to `/home`; explicit login returnTo validation remains unchanged.

- RED then GREEN: auth-status guest/deep-link routes, timeout vs error, manual recovery, confirmed logout and no self-loop; server account 401 vs 503; account action 401, logout success vs network failure.
- Verify public homepage initial load/refresh, guest `/` and protected deep links, back after logout, error retry → valid identity, no protected content or private session API before authorization.
- Re-run final full suite, lint, typecheck and both production compilers after navigation changes. Existing performance figures remain tagged to the preceding measured revision; do not relabel them as a new post-navigation benchmark.
- Independent review found two concrete ambiguity bugs: action services and account profile/getUser errors historically used401 for service failures. Fixed by confirming action401 against the dedicated identity endpoint and retaining verified account service failures as503. The identity RPC itself now only emits401 for its exact known denial or documented PostgREST JWT/anonymous-denial401; unknown/database/transport/invalid payload remain503 and closed. Read Supabase official error-code documentation and installed PostgREST transport handling (status0). RED→GREEN tests cover these real mappings. No database/schema/provider/permission changes or relaxation of API access.

## 03:10 UTC production evidence and public proxy boundary

Parent Edge evidence: identity GET canceled after15.009s with no HTTP response, exactly the browser15s timeout; existing root navigation entry200/31.114s TTFB is not a fresh navigation. Source shows public/home still awaited getClaims in proxy; add formal-only exact /home GET/HEAD public bypass before config/client creation. Never bypass other pages/APIs, child paths, POST or legacy anonymous mode. Unit boundary coverage must verify retained cookies and unchanged protected paths. This removes the public auth dependency, not the unproven production server bottleneck. The 6 previously failed guard tests used incomplete synthetic RPC denials; update those fixtures to actual P0001/unauthorized or42501+HTTP401, preserving all original401/no-Storage/no-admin assertions. Full final source suite and both builds are rerun after this last change.
