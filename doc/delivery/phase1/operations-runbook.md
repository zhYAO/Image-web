# Phase 1 Web free-preview operations runbook

## Cost and safety invariants

- Use Supabase Free, Vercel Hobby and Sentry Developer Free only. Stop before any billing activation, recharge, paid fallback or soft limit that can become a charge.
- Keep `generation_enabled=false` and every provider disabled until a provider is independently proven to require no recharge, have no automatic paid fallback and expose a hard spending limit.
- Never place service-role keys, database URLs, provider credentials, worker secrets or Sentry credentials in client-visible variables or evidence files.
- A public Preview must use HTTP data mode and the server-side usage ledger; never deploy a mock-mode Preview as release evidence.

## Supabase setup

1. Apply every file in `supabase/migrations` in order through migration tooling, then run every pgTAP file in `supabase/tests/database`.
2. Generate database TypeScript types from the migrated primary project and compare them with `apps/web/lib/supabase/database.generated.ts`; any drift blocks deployment.
3. Enable anonymous Auth in the dashboard. Store `zimage_project_url`, `zimage_service_role_key` and `zimage_worker_cron_secret` in Vault, and configure the same worker secret plus optional Sentry DSN through Edge Function secrets.
4. Run `PostgresSaver.setup()` once against `SUPABASE_DB_URL` with schema `langgraph`; application requests intentionally do not create checkpoint tables.
5. Deploy `generation-worker` and `cleanup-worker`. Their public endpoints are protected by `ZIMAGE_WORKER_CRON_SECRET`; do not substitute an anon or publishable key.
6. Call `schedule_cleanup_worker()` only after all three Vault values exist. It schedules cleanup every 15 minutes and reads secrets at execution time, so `cron.job` contains no secret value.
7. Do not schedule generation while every provider is disabled. If a provider later passes the strict zero-cost gate, record its evidence and enable only that provider plus the generation flag.

## Vercel Preview

1. Create the Hobby project `zimage-web` and configure Preview-only encrypted variables from `apps/web/.env.example`.
2. Set `NEXT_PUBLIC_DATA_MODE=http`; expose only the Supabase URL/publishable key and browser Sentry DSN. Keep service-role, database, Sentry server and worker values server-only.
3. Build with `pnpm install --frozen-lockfile` and `pnpm build`, then create a Preview deployment. Do not promote it to Production.
4. Verify anonymous identity/Cookies, two-context RLS isolation, session CRUD, uploads/signed URLs/cleanup, every quota boundary, concurrent reservations and compensating release.
5. Confirm chat and generation return unavailable and do not enqueue work while providers are disabled.

## Sentry validation

1. Create a Developer Free Next.js project and configure DSNs only after confirming the plan is still free.
2. Temporarily enable a random-key diagnostic entry point for browser, Next.js Server and Supabase Edge events.
3. Record only event IDs and correlation IDs. Confirm the payload contains no prompt, image, Cookie, token, user identity or original exception message.
4. Disable/delete the diagnostic entry point, revoke the key and redeploy before accepting the Preview.

## Restore drill

1. Apply the same migrations to the same-region free restore project.
2. Restore `supabase/restore-drill/controlled-fixture.sql` using a fixture-only Auth user; Auth sessions are intentionally not migrated.
3. Upload the documented 1x1 PNG to the matching private Storage path and verify SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.
4. Compare application table/function/policy counts, fixture row counts, queue state, signed URL access, cross-user denial and cleanup behavior.
5. Pause the restore project only after the Storage and cleanup checks pass. Record this as a logical/manual restore drill, never as automatic backup or PITR.
