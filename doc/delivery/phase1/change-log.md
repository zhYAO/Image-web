# Phase 1 Web change log

> Date: 2026-08-24
> Branch: `setup2`
> Scope: Web only; no mobile-specific development
> Delivery label: Phase 1 Web free-environment candidate

## Delivered in the current working tree

- Added a private, fail-closed provider registry. Gemini, Seedream, Doubao and MiniMax are disabled by default; generation is disabled and uploads are enabled by default.
- Added an atomic preview usage ledger with transaction advisory locks, UTC windows and compensating release:
  - 10 sessions per anonymous user per day.
  - 10 uploads and 50 MiB per anonymous user per day.
  - 60 writes per anonymous user per hour.
  - 200 uploads and 500 MiB globally per day.
- Preserved the existing API success contracts. Limit rejections use `quota_exceeded` with HTTP 429 and the route correlation ID; disabled capabilities fail closed with the existing provider-unavailable semantics.
- Added service-role-only runtime flag/provider RPCs, minimum grants, bounded ledger retention, composite quota indexes and explicit RLS policies on private runtime tables.
- Wired the generated remote database type into browser, SSR, proxy and service-role Supabase clients.
- Added pinned Sentry SDK support for both Supabase workers. Browser, Server and Edge events remove identity, request bodies, cookies, headers, query strings, breadcrumbs, extras and original exception messages.
- Changed the third Playwright project from another Chromium profile to WebKit, while retaining Edge-channel regression.
- Added CAPTCHA-aware anonymous bootstrap: when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is configured, server auto-registration pauses and the browser supplies the Turnstile token to `signInAnonymously` before mounting the workspace.
- Added explicit `setup:langgraph` and `e2e:http` operations. The HTTP suite verifies cookie identity restoration, two-context ownership denial and opt-in private upload/SSE paths without changing `WorkspaceGateway` or existing public API contracts.
- Pinned both Edge Functions to `@supabase/server@1.4.1`, `@supabase/functions-js@2.112.4` and committed frozen Deno v5 lockfiles. Deno type checking also closed an unreachable-action narrowing gap in generation-worker.
- Added a generation emergency-stop migration: when `generation_enabled` is false, queue claim returns before `pgmq.read`, preserving message visibility and preventing already-queued work from reaching a paid Provider. Expanded queue/scheduler pgTAP from source inspection to behavioral disabled-flag, missing-provider, missing-Vault and no-Cron assertions.

## Delivered to Supabase Free

- Primary project `image-web` (`klmiycyesxnpinxpeqep`) and the restore drill received all ten Phase 1 migrations, including fail-closed generation scheduling.
- `generation-worker` and `cleanup-worker` are ACTIVE at version 4. Both use custom secret authentication, exact dependency versions and frozen lockfiles.
- All eight pgTAP suites pass on the primary project: 44 + 12 + 7 + 6 + 23 + 8 + 12 + 14 = 126 assertions. The changed scheduling suite also passes on the restore project.
- The advisor-hardening migration added five missing foreign-key indexes and explicit private-table policies. The remaining primary security warnings are the pre-existing `vector in public` placement and disabled leaked-password protection; the restore project reports only the latter.
- Created the zero-cost same-region project `image-web-restore-drill` (`kccgjkuzlmxlkefftxhu`), applied the same ten migrations, and restored a controlled session, timeline item, upload metadata row and queue message. Application inventory matches the primary: 12 tables, 66 non-extension functions and 11 policies.

## Intentionally fail-closed or externally gated

- No provider probe or paid image call was made. All providers and generation scheduling remain disabled.
- Cleanup Cron is not scheduled until the required URL, service-role key and worker secret exist in Vault. Generation Cron additionally fails closed until generation and at least one image Provider are enabled; both projects currently have zero Cron jobs.
- A live Auth probe returned `anonymous_provider_disabled` (422), so anonymous Auth is confirmed disabled rather than merely untested. Enabling Auth/CAPTCHA, writing Vault/Edge secrets, LangGraph setup, the Storage object portion of the restore drill, Sentry replay and Vercel Preview still require authenticated configuration.
- The eleventh emergency-stop migration and expanded 133-assertion pgTAP source are ready locally but not yet applied/re-run on primary or restore: the Supabase connector reached its usage limit during the final review cycle. Both projects still have zero Cron jobs, so generation remains fail-closed.
- Chromium and Edge Playwright regression passes locally (11 passed, 3 project-condition skips). Playwright 1.62.1 WebKit is blocked on macOS 14 by a driver/browser protocol mismatch for `PushAPIEnabled`; this is not recorded as an application pass.
- No real Safari run, paid-provider 30-sample gate, automatic backup or PITR evidence exists. Playwright WebKit is regression evidence only.
- No commit, push, pull request, merge, Production deployment or mobile change was made.
