# Phase 1 project survey

> Survey date: 2026-08-24
> Branch/HEAD: `setup2` / `48e7382`
> Evidence: repository source, current git state, baseline commands, and read-only Supabase project metadata

## Repository state

- Monorepo managed by pnpm 11.19.0 with Node.js 24.19.0 or newer.
- `apps/web` uses Next.js 16.3.0, React 19.2.7, TypeScript 6.0.3, Zustand 5, Ant Design 6, Vitest, Testing Library, and Playwright.
- `packages/domain` contains shared workspace types, domain logic, and the gateway abstraction.
- Current implementation is a Phase 1A mock: `UnifiedWorkspace` talks to `MockWorkspaceGateway`, and mock persistence uses browser local storage.
- There are no application Route Handlers, Supabase migrations/functions, provider adapters, or CI workflows at this baseline.
- The only pre-existing working-tree item is untracked `diagram/`; it is outside this delivery scope and must be preserved.

## Current behavior and invariants

- `/` is the only workspace; `/chat` and `/image` redirect to it.
- Chat and image drafts are independent. Image references are owned by `UnifiedWorkspace` and are not duplicated between composer and configuration UI.
- Direct and chat-tool image generation share one timeline card while preserving their source.
- Zustand currently stores a flat collection of UI/mock state; server-owned facts do not exist yet.

## Baseline evidence

- `pnpm lint`: passed after using the bundled Node runtime path.
- `pnpm typecheck`: passed for domain and Web when run outside the filesystem sandbox, which otherwise blocks child-process creation with `spawn EPERM`.
- `pnpm build`: passed; the baseline contains only static `/`, `/_not-found`, `/chat`, and `/image` routes.
- Coverage baseline: domain tests passed 10/10 with 80.7% statements; the combined command did not return complete Web evidence within the original tool window and must be rerun.
- E2E startup was blocked before assertions because an existing Next dev process for this workspace owns the Next 16 development lock. That process remains untouched; E2E will gain an explicit external-base-URL mode.

## External development services

- Supabase project `image-web` (`klmiycyesxnpinxpeqep`) is `ACTIVE_HEALTHY`, region `ap-northeast-2`, Postgres 17.6.1.155.
- No Edge Functions are currently deployed.
- Supabase database inventory is blocked by MCP password authentication failures for both the read-only user and `postgres`. No remote migration may be applied until authentication is restored and the existing schema/migration inventory is captured.

## Constraints

- Desktop Web receives full Phase 1 behavior; narrow-screen Web receives regression protection only.
- Provider, Supabase secret/service-role, Sentry, Vercel, and cloud-browser credentials never enter the repository, reports, logs, or chat.
- Product requirements are read from `doc/requirements.md`; `doc/tech-selection.md` and `doc/architecture.md` constrain implementation but do not add product scope.

