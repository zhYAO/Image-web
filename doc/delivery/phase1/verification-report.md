# Phase 1 Web verification report

> Evidence date: 2026-08-24
> Runtime: Node 24.19.0, pnpm 11.19.0, Windows local workspace

## Passed local gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | Passed for `@zimage/domain` and `@zimage/web`. |
| `pnpm lint` | Passed with zero warnings. |
| `pnpm test:coverage` | Domain: 24/24 tests, 95.83% statements and 72.72% functions. Web: 54/54 tests, 87.93% statements and 71.42% functions. |
| Provider adapter contract test | 6/6 Gemini/Seedream mapping and decoding tests passed through root Vitest. |
| `pnpm e2e` against existing `http://localhost:3000` | 15 passed; 6 desktop-only scenarios skipped by tablet/mobile project conditions; 0 failed. |
| `NEXT_PUBLIC_DATA_MODE=mock pnpm build` | Passed. Next generated 14 pages and all planned Route Handlers. |

## Covered behaviors

- Independent chat/image drafts and providers, skills, editable prompt, tool enable/clear rules, required fields, references, provider health, quota, generation parameters, partial/expired assets, recreation, download, session CRUD, redirects, refresh recovery, and narrow-screen core flow.
- Strict API schemas, session and timeline stores, reference validation, image idempotency service, chat retry/tool behavior, Supabase environment boundaries, OpenAPI generation, and safe route error handling.

## Gates not executed

| Gate | Blocking evidence |
|---|---|
| Local migrations and pgTAP | Docker is unavailable, so `supabase start` / `supabase test db` cannot run locally. |
| Remote migrations and pgTAP | The linked Supabase database rejects the available database credentials; remote schema inventory is therefore also unavailable. |
| Generated database type parity | Requires a successfully migrated local or remote database. |
| Real provider probes and 30-sample sets | Requires provider secrets, account-specific model IDs, paid-call authorization, and a hard cost cap. |
| Sentry ingestion and alerts | Requires deployed DSN/auth token and alert destinations. |
| Vercel Preview and real Safari | Requires deployment authorization and a cloud-browser session. |
| Backup and restore | Requires Supabase Pro backup, independent private Storage backup, and a joint restore drill. |

The passed local gates establish an implementation-complete local candidate, not production readiness.

