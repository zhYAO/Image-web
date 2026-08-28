# Phase 1 Web zero-cost acceptance operations runbook

## Cost and safety invariants

- Use existing Supabase Free projects and Sentry Developer Free only. Vercel is not used in this acceptance run. Stop before any billing activation, recharge, paid fallback or soft limit that can become a charge.
- Keep `generation_enabled=false` and every provider disabled until a provider is independently proven to require no recharge, have no automatic paid fallback and expose a hard spending limit.
- Never place Supabase Secret Keys, database URLs, provider credentials, worker secrets or Sentry credentials in client-visible variables or evidence files.
- The acceptance service must use HTTP data mode and the server-side usage ledger; never present a mock-mode run as real HTTP evidence.

## Supabase setup

1. Apply every file in `supabase/migrations` in order through migration tooling, then run every pgTAP file in `supabase/tests/database`.
2. Generate database TypeScript types from the migrated primary project and compare them with `apps/web/lib/supabase/database.generated.ts`; any drift blocks deployment.
3. Enable anonymous Auth and Turnstile CAPTCHA together. Configure `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the Preview before enforcing CAPTCHA; with this key set, browser challenge completion replaces the no-token server auto-bootstrap. For an isolated acceptance Preview, use [Cloudflare's documented always-pass Turnstile test site/secret pair](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) in both the app and Supabase CAPTCHA settings; never use test keys in the production deployment.
4. Store `zimage_project_url`, `zimage_secret_key` (a modern `sb_secret_...` key) and `zimage_worker_cron_secret` in Vault, and configure the same worker secret plus optional Sentry DSN through Edge Function secrets. Cron sends the Supabase Secret Key only through the `apikey` header, never as a Bearer token.
5. Run `SUPABASE_DB_URL='postgresql://…' pnpm setup:langgraph` once with the private pooler URL. Application requests intentionally do not create checkpoint tables.
6. Deploy `generation-worker` and `cleanup-worker` with their `deno.json` and `deno.lock`. Their public endpoints are protected by `ZIMAGE_WORKER_CRON_SECRET`; do not substitute an anon or publishable key.
7. Call `select public.schedule_cleanup_worker();` only after all three Vault values exist. It schedules cleanup every 15 minutes and reads secrets at execution time, so `cron.job` contains no secret value.
8. Do not schedule generation while every Provider is disabled. After the cost gate, enable only the approved image Provider plus `generation_enabled`, then call `select public.schedule_generation_worker();`. The RPC fails closed before creating a job if any prerequisite is missing.

## Local production-mode HTTP acceptance

1. Configure local-only variables from `apps/web/.env.example`; never commit the populated file.
2. Build with `NEXT_PUBLIC_DATA_MODE=http` and `ZIMAGE_DEPLOYMENT_ENV=acceptance`, then start `next start --hostname 127.0.0.1 --port 3100` with `ZIMAGE_ALLOWED_ORIGINS=http://127.0.0.1:3100`.
3. Keep the Supabase Secret Key, database URL, provider credentials, Sentry server token and worker values server-only.
4. Verify anonymous identity/Cookies, two-context RLS isolation, session CRUD, uploads/signed URLs/cleanup, every quota boundary, concurrent reservations and compensating release.
5. Confirm chat and generation return unavailable and do not enqueue work while providers are disabled.
6. Run with `PHASE1B_HTTP_BASE_URL=http://127.0.0.1:3100`, `PHASE1B_STORAGE_WRITE=true`, `PHASE1B_CHAT_MODEL=doubao`, `PHASE1B_CHAT_TOOL_MODEL=minimax` and `PHASE1B_IMAGE_PROVIDER=seedream`. The suite rejects any other provider values.
7. The suite is serial: Doubao runs one short SSE; MiniMax queues one chat-tool Seedream image; Seedream also runs direct text-to-image and direct reference-image once each. Every request uses `count=1`; normal total is 3 images and the hard ceiling is 5 attempts. Do not retry an unknown submission result.
8. Every entity uses `phase1b-acceptance-<runId>` and must be deleted in `finally`; wait for cleanup, old signed URL failure and Storage object removal before accepting the run.

Vercel Preview, Alibaba Cloud ECS, Docker, TLS, reverse proxy, production deployment and rollback are separate later plans and are not acceptance prerequisites here.

## Sentry validation

1. Create a Developer Free Next.js project and configure DSNs only after confirming the plan is still free.
2. Temporarily enable a random-key diagnostic entry point for browser, Next.js Server and Supabase Edge helper events on the local acceptance service.
3. Record only event IDs and correlation IDs. Confirm the payload contains no prompt, image, Cookie, token, user identity or original exception message.
4. Disable/delete the diagnostic entry point, revoke the key and rebuild before accepting the run. No diagnostic route may remain in the final public API.

The 2026-08-28 acceptance run completed all three event classes. Browser event `87022e71135d446e91b11a72452eaf72` used correlation `16b6d502-ae83-44fb-a29b-45eca4bfb98e`; Next server event `d387fa02d7534a54b51f766e94e5ac44` used `41a9db0f-6577-4d3e-b7f4-2e9fab90e3e9`; Supabase Edge event `52f32dc230a5490d88e4a8aaac952cd1` used `b5352834-4ff3-41a6-a718-4ffbf607513e`. Each retained only the approved tags and redacted error text, with no request, original diagnostic content, identity or Geo values. Organization IP and `user.geo` scrubbing remain required; application and Edge sanitizers also set an unspecified address so Relay cannot infer the transport IP when the user object is absent. All temporary routes and Edge branches were removed after validation.

## Production restore drill (deferred)

This drill was removed from the zero-cost Phase 1B/1C acceptance gate on 2026-08-28. It remains mandatory before a production-readiness claim or Alibaba Cloud production release.

1. Create a CLI logical dump in a temporary directory outside the repository. Supabase Free does not provide the production automatic daily backup evidence required by the later gate.
2. Apply the same migrations to the same-region free restore project.
3. Restore `supabase/restore-drill/controlled-fixture.sql` using a fixture-only Auth user; Auth sessions are intentionally not migrated.
4. Upload the documented 1x1 PNG to the matching private Storage path and verify SHA-256 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.
5. Compare application table/function/policy counts, fixture row counts, queue state, signed URL access, cross-user denial and cleanup behavior.
6. Record elapsed time only as a successful manual logical/joint restore. Never claim automatic daily backup, PITR, production RPO or production readiness from this drill.
