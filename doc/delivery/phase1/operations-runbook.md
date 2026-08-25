# Phase 1 Web free-preview operations runbook

## Cost and safety invariants

- Use Supabase Free, Vercel Hobby and Sentry Developer Free only. Stop before any billing activation, recharge, paid fallback or soft limit that can become a charge.
- Keep `generation_enabled=false` and every provider disabled until a provider is independently proven to require no recharge, have no automatic paid fallback and expose a hard spending limit.
- Never place Supabase Secret Keys, database URLs, provider credentials, worker secrets or Sentry credentials in client-visible variables or evidence files.
- A public Preview must use HTTP data mode and the server-side usage ledger; never deploy a mock-mode Preview as release evidence.

## Supabase setup

1. Apply every file in `supabase/migrations` in order through migration tooling, then run every pgTAP file in `supabase/tests/database`.
2. Generate database TypeScript types from the migrated primary project and compare them with `apps/web/lib/supabase/database.generated.ts`; any drift blocks deployment.
3. Enable anonymous Auth and Turnstile CAPTCHA together. Configure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the Preview before enforcing CAPTCHA; with this key set, browser challenge completion replaces the no-token server auto-bootstrap. For an isolated acceptance Preview, use [Cloudflare's documented always-pass Turnstile test site/secret pair](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in both the app and Supabase CAPTCHA settings; never use test keys in the production deployment.
4. Store `zimage_project_url`, `zimage_secret_key` (a modern `sb_secret_...` key) and `zimage_worker_cron_secret` in Vault, and configure the same worker secret plus optional Sentry DSN through Edge Function secrets. Cron sends the Supabase Secret Key only through the `apikey` header, never as a Bearer token.
5. Run `SUPABASE_DB_URL='postgresql://…' pnpm setup:langgraph` once with the private pooler URL. Application requests intentionally do not create checkpoint tables.
6. Deploy `generation-worker` and `cleanup-worker` with their `deno.json` and `deno.lock`. Their public endpoints are protected by `ZIMAGE_WORKER_CRON_SECRET`; do not substitute an anon or publishable key.
7. Call `select public.schedule_cleanup_worker();` only after all three Vault values exist. It schedules cleanup every 15 minutes and reads secrets at execution time, so `cron.job` contains no secret value.
8. Do not schedule generation while every Provider is disabled. After the cost gate, enable only the approved image Provider plus `generation_enabled`, then call `select public.schedule_generation_worker();`. The RPC fails closed before creating a job if any prerequisite is missing.

## Vercel Preview

1. Create the Hobby project `zimage-web` and configure Preview-only encrypted variables from `apps/web/.env.example`.
2. Set `NEXT_PUBLIC_DATA_MODE=http`; expose only the Supabase URL/publishable key and browser Sentry DSN. Keep the Supabase Secret Key, database, Sentry server and worker values server-only.
3. Build with `pnpm install --frozen-lockfile` and `pnpm build`, then create a Preview deployment. Do not promote it to Production.
4. Verify anonymous identity/Cookies, two-context RLS isolation, session CRUD, uploads/signed URLs/cleanup, every quota boundary, concurrent reservations and compensating release.
5. Confirm chat and generation return unavailable and do not enqueue work while providers are disabled.
6. Run `PHASE1B_HTTP_BASE_URL='https://preview.example' pnpm e2e:http` for identity/RLS. The suite waits up to 30 seconds for CAPTCHA-backed anonymous identity readiness. Add `PHASE1B_STORAGE_WRITE=true` only after cleanup scheduling is confirmed. Add `PHASE1B_CHAT_MODEL=doubao` or `minimax` only after the Provider cost gate is approved.

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
