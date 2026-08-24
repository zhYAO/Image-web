# Phase 1 Web operations runbook

## Required deployment setup

1. Apply all `supabase/migrations` in order and run every pgTAP file under `supabase/tests/database`.
2. Run `PostgresSaver.setup()` once against `SUPABASE_DB_URL` with schema `langgraph`; application requests intentionally do not create checkpoint tables.
3. Deploy `generation-worker` and `cleanup-worker` with secret-key authentication. Store `ZIMAGE_WORKER_CRON_SECRET` and all provider keys only in the platform secret store.
4. Schedule both workers with Supabase Cron. Each invocation processes at most one item; scale frequency or concurrent invocations from queue age, never by replaying an unknown provider submission.
5. Configure Web environment from `apps/web/.env.example`, set `NEXT_PUBLIC_DATA_MODE=http`, and configure Sentry DSNs and source-map upload credentials.

## Release gates requiring external evidence

- Run a one-call provider probe, then exactly 30 fixed samples per Doubao, MiniMax, Seedream, and Gemini under a hard call cap.
- Verify real Sentry browser, Route Handler, generation-worker, cleanup dead-job, provider-health, and backup alerts. Structured logs alone are not Sentry proof.
- Verify the release candidate in current Chrome and Edge plus real Safari through a cloud browser service. Playwright WebKit is regression evidence only.
- Confirm Supabase Pro database backup, independent private Storage backup, and one joint restore drill. Until this is recorded, the build is not production-ready.

## Failure policy

- Chat retries once only before the first content chunk. Partial assistant text is never persisted.
- Image infrastructure failures before provider submission retry up to five queue reads. Once submission may have occurred, automatic resubmission is forbidden.
- Cleanup retries with bounded exponential backoff and becomes a dead job after five attempts; dead jobs require Sentry alerting and manual resolution.
