# Phase 1 Web technical design

> Status: checkpoint 1 approved on 2026-08-24
> Requirements: `doc/requirements.md`
> Architecture: `doc/architecture.md`
> Figma: none
> Evidence channel: static source, local command evidence, Supabase metadata, and official product documentation

## 1. Requirement and scope

- Goal: replace the Phase 1A mock boundary with a recoverable, private, observable Web implementation and complete Phase 1B/1C evidence.
- In scope: desktop workspace, anonymous identity, sessions/timeline, chat SSE, direct and tool-driven image generation, three skills, quotas, health, private assets, cleanup, observability, CI, and preview release.
- Out of scope: native mobile, mobile-specific Web features, PWA/offline, account linking, team/RBAC, custom skills, 4K, payments, dynamic model discovery, external chat/SMS alerts, and production-readiness claims before backup/restore gates.

## 2. Web and state design

- Keep `/` as the sole workspace and reuse existing LobeHub/Ant Design components and tokens.
- New functionality targets 1440px desktop. Preserve existing 1024px/narrow drawer and 390px core-flow behavior without adding mobile-only interactions.
- Split Zustand by workspace, composer, timeline, generation, and capability responsibilities. Persist no server-owned session, timeline, generation, quota, or provider-health fact in the client store.
- Replace mock gateway calls through the existing gateway boundary, allowing contract tests to exercise both deterministic fakes and the real HTTP implementation.

## 3. Runtime architecture

- Vercel hosts Next.js pages and Route Handlers. Browser and server Supabase clients use cookie-based anonymous sessions; `proxy.ts` refreshes claims but does not perform business authorization.
- Postgres is authoritative for sessions, timeline sequence, generation state, quota accounting, provider health, cleanup progress, and safety audit metadata.
- `uploads` and `generated` are private buckets. The server constructs object paths and issues short-lived signed URLs after ownership and expiry checks.
- PGMQ stores durable generation and cleanup messages. A scheduled Edge Function claims one generation, conditionally moves it to processing, calls one provider, uploads the result, settles quota/state, and archives the message.
- Browser, Route Handler, and Edge Function errors carry one correlation ID into structured logs and Sentry.

## 4. Data and authorization

- Public user-owned tables: `sessions`, `timeline_items`, `generation_batches`, `generations`, and reference-upload metadata. They receive explicit minimum grants plus RLS ownership predicates using `(select auth.uid())`.
- Server-only data: queue internals, checkpointer tables, quota ledger, health windows, cleanup jobs, and safety audits. They are not exposed to browser roles.
- Required privileged functions live in a private schema, set a safe search path, validate identity/ownership in their body, revoke execute from `PUBLIC`, `anon`, and `authenticated`, and grant only the required server role.
- State invariants, retention, idempotency, sequence allocation, and partial-batch aggregation follow `doc/architecture.md` without adding alternate states.

## 5. API and provider design

- Public request/response shapes and SSE events remain exactly those in the approved implementation plan and `doc/tech-selection.md`.
- Schemas are authored once with Zod and shared by Route Handlers, OpenAPI generation, gateway parsing, and contract tests.
- Provider adapters normalize capabilities, safety categories, timeouts, errors, usage, and concrete model/deployment metadata without leaking raw provider payloads to the UI.
- Repository model definitions use stable logical IDs and a registry version. Environment configuration maps logical IDs to account-specific provider model/deployment IDs; startup fails closed when an enabled mapping is invalid.

## 6. Failure and operational behavior

- Input, identity, Origin/CSRF, ownership, quota, and rate checks happen before paid work is enqueued.
- Infrastructure failures proven to occur before provider submission may retry with backoff. Provider rejection, timeout after possible acceptance, or unknown acceptance does not resubmit automatically.
- Chat may retry one transient failure only before the first content event. A later failure emits `stream.failed` and leaves an actionable resend path.
- Cleanup and expiry steps are idempotent and observable. User-visible deletion hides the session immediately while durable cleanup finishes in the background.
- Provider status uses five-minute shared windows. Degraded-provider substitution always requires explicit user confirmation.

## 7. Change areas

| Area | Change | Purpose |
|---|---|---|
| `apps/web` | modify/add | Real gateway, auth clients, Route Handlers, workspace states, provider/asset UI, Sentry, and E2E configuration |
| `packages/domain` | modify/add | Versioned schemas, model registry, state/error contracts, gateway interfaces, and provider-neutral logic |
| `supabase` | add | Local configuration, migrations, pgTAP tests, seeds, and Edge Functions |
| `.github/workflows` | add | Static, database, integration, provider, and browser release gates |
| `doc/delivery/phase1` | add/update | Survey, design, change log, review, cases, and regression evidence |

## 8. Risks and gates

- Remote database authentication currently blocks schema inventory and cloud migration; local implementation may proceed, but remote DDL may not.
- Real provider, Sentry, Vercel, and cloud-browser validation requires secrets supplied only through platform secret stores.
- Supabase Free does not close the approved backup/restore production gate.
- Edge Function wall-clock/CPU limits prohibit image transformation inside the worker; providers return final assets and the worker streams them to Storage.

## 9. Acceptance criteria

- [x] Phase 1A gaps are closed without regressing current desktop/narrow behavior.
- [ ] Anonymous users can recover same-browser sessions and cannot access another user's data.
- [ ] Direct and chat-tool image flows survive refresh and partial failure without duplicate billing.
- [ ] Private asset upload, renewal, download, expiry, recreation, and deletion behave as documented.
- [ ] Chat/tool, skills, quota, health, errors, and Sentry behavior meet fixed contracts.
- [ ] Coverage, pgTAP, CI, provider, performance, and real-browser gates produce retained evidence.
- [x] Production readiness remains explicitly blocked until the declared paid backup/restore gates close.

## Checkpoint 1

- [x] Requirement understanding approved on 2026-08-24
- [x] Technical approach approved on 2026-08-24

## Checkpoint 2

- [x] Local implementation, static review, unit/contract coverage, production build, and mock-browser regression completed on 2026-08-24.
- [ ] Supabase migrations, pgTAP/RLS negatives, and generated-type drift verified against a running database.
- [ ] Capped real-provider, deployed Sentry, Vercel Preview, cloud Safari, and backup/restore gates authorized and completed.
