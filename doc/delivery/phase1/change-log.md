# Phase 1 Web change log

> Date: 2026-08-24
> Branch: `setup2`
> Scope: desktop Web implementation; narrow-screen regression only; no mobile-specific development

## Delivered locally

- Replaced the mock-only runtime boundary with a strict HTTP gateway, anonymous Supabase SSR identity, origin validation, shared Zod contracts, and an OpenAPI route.
- Added sessions, timeline, reference uploads, direct image submission, recreation, signed assets, quotas, skills, provider health, chat SSE, and explicit image-tool routing.
- Added versioned Doubao/MiniMax chat and Gemini/Seedream image adapters. Provider IDs remain deployment environment mappings; secrets never enter the repository.
- Added durable PGMQ image work, idempotent quota reservation, unknown-provider-submission protection, partial batch aggregation, private Storage, bounded cleanup, stale cleanup lease recovery, and safety-audit metadata.
- Added three versioned skills. Required fields block submission; the resolved image prompt is editable and the edited value is the submitted snapshot.
- Added Sentry browser/server/edge wiring, structured correlation IDs, health windows, CI gates, operational runbook, and deterministic mock regression scenarios.
- Tightened browser-role grants so authenticated users cannot bypass the service layer to insert timeline, batch, or generation records.

## Compatibility preserved

- `/` remains the sole workspace; `/chat` and `/image` remain redirects.
- Chat and image provider selections remain independent.
- Existing narrow and 390px core flows remain regression targets; no native/mobile-specific feature was introduced.
- Pre-existing untracked `diagram/` content was not modified.

## Not claimed as delivered

- No remote Supabase migration, Edge deployment, Vercel deployment, paid provider batch, Sentry alert replay, real Safari run, or backup/restore drill was performed.
- No commit, pull request, merge, or branch change was made.

