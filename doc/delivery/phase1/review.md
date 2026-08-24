# Phase 1 Web independent review record

> Review type: repository-grounded self-review because delegated/subagent review was not authorized for this run
> Review date: 2026-08-24

## Findings resolved before handoff

| Severity | Finding | Resolution |
|---|---|---|
| High | Authenticated clients could insert generation batches and generations directly, bypassing server quota/idempotency controls. | Removed browser-role insert grants and changed pgTAP expectations to assert the denial. |
| High | A cleanup worker crash after claiming a job could leave it in `processing` permanently. | Added a five-minute stale-processing lease and a pgTAP function-definition assertion for reclaimability. |
| Medium | Skill prompt preview was read-only and skill field values did not become the direct-image prompt snapshot. | Added editable resolved prompt state and a submission regression test. |
| Medium | Real mode polled active batches at mock cadence and did not refresh quota after work. | Split polling to 300 ms mock / 1500 ms HTTP and refresh quota after image/chat completion. |
| Low | Batch downloads always used an SVG filename even for real assets. | Derive PNG/JPEG/WebP extension from the signed URL, with PNG fallback. |

## Static security and failure review

- Privileged SQL functions use an empty `search_path`, revoke browser execution, and grant only `service_role` where server authorization is required.
- Private schemas, queue internals, quota, health, cleanup, checkpoint, and safety records are not exposed to browser roles.
- Origin, verified user ID, ownership, strict request schemas, redacted API errors, private signed assets, and storage path construction are enforced before paid work.
- Image retries are allowed only before provider submission is possible; unknown acceptance is recorded as terminal and not automatically resubmitted.
- Chat retries only before the first emitted content chunk. Partial content is not persisted as a completed assistant turn.

## Remaining risks requiring runtime evidence

- SQL syntax, migrations, RLS negatives, pgTAP, PGMQ, and LangGraph checkpoint cleanup are statically reviewed but not executed against Postgres in this run.
- Provider payloads are contract-tested against current documented shapes, but real account model IDs, moderation, latency, and billing behavior are unverified.
- Sentry initialization compiles with no-DSN disablement, but deployed ingestion and alert routing are unverified.
- Supabase backup plus private Storage backup and joint restore remain production blockers.

