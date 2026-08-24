# Phase 1 Web free-environment verification report

> Evidence date: 2026-08-24
> Runtime: bundled Node 24.19.0, pnpm 11.19.0, macOS 14.8.5 (x86_64)
> Status: Phase 1B activation candidate; external authenticated, pending cloud migration, and WebKit toolchain gates remain

## Passed local gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | Passed for `@zimage/domain` and `@zimage/web`. |
| `pnpm lint` | Passed with zero warnings. |
| Web Vitest | 17 files and 68/68 tests passed, including CAPTCHA bootstrap/retry failures, dependency locking, quota ownership, compensation and Sentry sanitization. |
| `pnpm test:coverage` | Domain 24/24 and Web 68/68 passed. Web functions 71.42%, lines 87.93%. |
| Provider adapter contract test | 6/6 Gemini/Seedream mapping and decoding tests passed without external provider calls. |
| Playwright mock regression | Chromium and Edge passed 11 tests with 3 project-condition skips. New macOS screenshots were visually inspected and passed on rerun. WebKit is blocked before page creation by Playwright 1.62.1/macOS 14 protocol mismatch (`PushAPIEnabled`). |
| `pnpm build` | Passed with all Web routes compiled before the final review patch. The post-review rerun was blocked by the Codex usage limit; final lint, typecheck and the five Auth Gate tests pass. |
| Edge dependency check | Both workers pass Deno 2.9.5 type checking with frozen v5 lockfiles. |
| `git diff --check` | Passed. |

## Remote Supabase evidence

| Evidence | Primary `image-web` | Restore drill |
|---|---|---|
| Project reference | `klmiycyesxnpinxpeqep` | `kccgjkuzlmxlkefftxhu` |
| Plan / region | Free / `ap-northeast-2` | Free / `ap-northeast-2` |
| Migrations | 10; latest remote version `20260824143603` | 10; latest remote version `20260824150238` |
| pgTAP | 8 suites, 126 assertions, all passed | Changed 12-assertion scheduling suite passed after migration |
| Application inventory | 12 tables, 66 non-extension functions, 11 policies | Exact match |
| Edge Functions | generation v4 ACTIVE; cleanup v4 ACTIVE | Not deployed by design |
| Security advisor | Existing `vector in public`; leaked-password protection disabled | Leaked-password protection disabled |
| Performance advisor | Only unused-index INFO on the empty candidate database | Only unused-index INFO on the fixture-sized database |

Remote database types were regenerated after the generation-scheduling migration and match `database.generated.ts` byte-for-byte. Primary and restore migration histories contain the same ten named migrations; remote version timestamps differ because each project records its own apply time.

The working tree now adds an eleventh `phase1_generation_emergency_stop` migration plus seven behavioral pgTAP assertions (133 total in source). It prevents a disabled generation runtime from claiming or changing queued-message visibility. The independent review found no remaining Critical or Important issue, but the new migration and 133-assertion suite are not yet remote evidence: the Supabase connector reached its usage limit before application/retest.

## Restore evidence

- Restored one independent fixture user, one session, one timeline item, one reference-upload metadata row and one image-queue message.
- Logical fixture checksum from `supabase/restore-drill/verify.sql`: `d7a2991f59c5f47a3d8df97457da26e9da52eefa631c067ed3b6b54aa3bd4291`.
- Controlled PNG expected SHA-256: `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.
- The Storage object count is currently zero because the dashboard/service credential login is unavailable. Signed URL, object checksum and post-object cleanup are therefore not yet verified, and the restore project has not been paused.

## External gates still open

| Gate | Current evidence / blocker |
|---|---|
| Anonymous Auth and CAPTCHA | Live publishable-key probe returned `anonymous_provider_disabled` (422), with zero anonymous users created. The code is Turnstile-token aware; dashboard Auth/CAPTCHA settings and the site key are still required. |
| Emergency-stop migration | Present and reviewed in the working tree; pending application to primary/restore and remote execution of the expanded 133-assertion pgTAP set because the Supabase connector reached its usage limit. Existing Cron count remains zero, so no Provider work can be scheduled meanwhile. |
| Cleanup schedule | Not created; the SQL scheduler correctly fails closed until all three Vault values exist. Cron job ID: not available. |
| Generation schedule | Migration applied and RPC tested; it returns `generation_schedule_disabled`. No Cron exists while every Provider and the generation flag remain disabled. |
| Provider probes and 30-sample sets | Not run under the strict zero-cost rule; no qualifying hard-limited free account evidence was available. |
| LangGraph checkpointer | Requires the private database pooler URL from the authenticated dashboard. |
| Sentry | Project, DSNs, diagnostic replay and event IDs require authenticated setup. |
| Vercel Preview | Project/Preview URL/deployment ID are not created because required encrypted server variables and Sentry setup are unavailable. |
| Preview HTTP E2E | A dedicated two-context suite now exists, but requires the real Preview URL and enabled anonymous Auth. Storage writes and real SSE require explicit opt-in flags. |
| WebKit / real Safari | Playwright WebKit cannot create a page on this macOS 14 runner because its driver requests unsupported `PushAPIEnabled`; real Safari is also not run. |
| Backup/PITR | Free projects do not establish production-grade automatic backup or PITR. The partial drill is logical/manual only. |

The evidence supports the repository implementation, the ten already-applied database migrations, scheduler and Worker-locking portion of a Phase 1B activation candidate. It does not yet support the pending emergency-stop migration as cloud-applied, real anonymous HTTP/SSE/Storage completion, Production Ready, full restore, Sentry-connected or publicly deployed claims.
