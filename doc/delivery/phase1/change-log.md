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

## Delivered to Supabase Free

- Primary project `image-web` (`klmiycyesxnpinxpeqep`) received all nine Phase 1 migrations.
- `generation-worker` and `cleanup-worker` are ACTIVE at version 3. Both use custom secret authentication and the pinned Sentry Deno SDK.
- All eight pgTAP suites pass on the primary and restore-drill projects: 44 + 12 + 7 + 6 + 23 + 8 + 6 + 14 assertions.
- The advisor-hardening migration added five missing foreign-key indexes and explicit private-table policies. The remaining primary security warnings are the pre-existing `vector in public` placement and disabled leaked-password protection; the restore project reports only the latter.
- Created the zero-cost same-region project `image-web-restore-drill` (`kccgjkuzlmxlkefftxhu`), applied the same nine migrations, and restored a controlled session, timeline item, upload metadata row and queue message. Application inventory matches the primary: 12 tables, 62 non-extension functions and 11 policies.

## Intentionally fail-closed or externally gated

- No provider probe or paid image call was made. All providers and generation scheduling remain disabled.
- Cleanup Cron is not scheduled until the required URL, service-role key and worker secret exist in Vault; therefore no cron job ID is recorded yet.
- Anonymous Auth, Vault/Edge secrets, LangGraph checkpointer setup, the Storage object portion of the restore drill, Sentry project/event replay and Vercel Preview require an authenticated dashboard session and remain incomplete.
- No real Safari run, paid-provider 30-sample gate, automatic backup or PITR evidence exists. Playwright WebKit is regression evidence only.
- No commit, push, pull request, merge, Production deployment or mobile change was made.
