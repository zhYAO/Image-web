# Phase 1 project survey

> Survey date: 2026-08-24
> Branch/base HEAD: `setup2` / `b7d9029`; Phase 1B evidence below also includes the current uncommitted working tree
> Evidence: repository source, current git state, baseline commands, and read-only Supabase project metadata

## Repository state

- Monorepo managed by pnpm 11.19.0 with Node.js 24.19.0 or newer.
- `apps/web` uses Next.js 16.3.0, React 19.2.7, TypeScript 6.0.3, Zustand 5, Ant Design 6, Vitest, Testing Library, and Playwright.
- `packages/domain` contains shared workspace types, domain logic, and the gateway abstraction.
- The workspace now supports `mock` and `http` data modes behind `WorkspaceGateway`: mock persistence remains in browser local storage, while HTTP mode uses Supabase anonymous identity, Route Handlers, SSE, queues, and private Storage.
- The repository contains application Route Handlers, ten migrations applied to Supabase plus one pending emergency-stop migration in the working tree, two deployed Edge Functions, provider adapters, database tests, and CI workflows. Phase 1B is therefore an activation and evidence-closing effort, not a greenfield implementation.
- Pre-existing working-tree changes remain outside this delivery scope and must be preserved.

## Current behavior and invariants

- `/` is the only workspace; `/chat` and `/image` redirect to it.
- Chat and image drafts are independent. Image references are owned by `UnifiedWorkspace` and are not duplicated between composer and configuration UI.
- Direct and chat-tool image generation share one timeline card while preserving their source.
- Zustand stores UI and request-transient state only; HTTP mode obtains server-owned sessions, timeline items, quota, uploads, and generation status through the gateway.

## Baseline evidence

- `pnpm lint`: passed after using the bundled Node runtime path.
- `pnpm typecheck`: passed for domain and Web when run outside the filesystem sandbox, which otherwise blocks child-process creation with `spawn EPERM`.
- `pnpm build`: passed; the baseline contains only static `/`, `/_not-found`, `/chat`, and `/image` routes.
- Current coverage: domain 24/24 and Web 68/68 tests pass; Web statements/lines are 87.93% and functions are 71.42%.
- Mock E2E passes in Chromium and Edge (11 passed, 3 project-condition skips). Playwright WebKit remains blocked before page creation by the macOS 14/Playwright 1.62.1 `PushAPIEnabled` protocol mismatch; the explicit HTTP acceptance suite requires a Preview URL.

## External development services

- Supabase project `image-web` (`klmiycyesxnpinxpeqep`) is `ACTIVE_HEALTHY`, region `ap-northeast-2`, Postgres 17.6.1.155.
- The generation and cleanup Edge Functions are deployed and active. Both remain fail-closed until their runtime flags, provider configuration, Vault values, and cost gates are satisfied.
- The primary database inventory is available: ten migrations are applied, the image queue and two private buckets exist, and all 126 remote pgTAP assertions pass. Real anonymous-user, object, checkpoint, and scheduled-generation evidence is still open.

## Constraints

- Desktop Web receives full Phase 1 behavior; narrow-screen Web receives regression protection only.
- Provider, Supabase secret/service-role, Sentry, Vercel, and cloud-browser credentials never enter the repository, reports, logs, or chat.
- Product requirements are read from `doc/requirements.md`; `doc/tech-selection.md` and `doc/architecture.md` constrain implementation but do not add product scope.
