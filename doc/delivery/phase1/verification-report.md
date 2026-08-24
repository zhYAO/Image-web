# Phase 1 Web free-environment verification report

> Evidence date: 2026-08-24
> Runtime: Node 24.19.0, pnpm 11.19.0, Windows local workspace
> Status: candidate; external authenticated gates remain

## Passed local gates

| Gate | Result |
|---|---|
| `pnpm typecheck` | Passed for `@zimage/domain` and `@zimage/web`. |
| `pnpm lint` | Passed with zero warnings. |
| Web Vitest | 15 files and 61/61 tests passed, including quota ownership, compensation and Sentry sanitization. |
| `pnpm test:coverage` | Domain 24/24 and Web 61/61 passed. Web functions 71.42%, lines 87.93%. |
| Provider adapter contract test | 6/6 Gemini/Seedream mapping and decoding tests passed without external provider calls. |
| Playwright against existing `http://localhost:3000` | Passed with no failed tests across Chromium, Edge channel and WebKit projects. The tracked matrix contains 15 passes and 6 project-condition skips. |
| `pnpm build` | Passed with all Web routes compiled. |
| `git diff --check` | Passed; line-ending conversion notices are non-errors. |

## Remote Supabase evidence

| Evidence | Primary `image-web` | Restore drill |
|---|---|---|
| Project reference | `klmiycyesxnpinxpeqep` | `kccgjkuzlmxlkefftxhu` |
| Plan / region | Free / `ap-northeast-2` | Free / `ap-northeast-2` |
| Migrations | 9; latest remote version `20260824101031` | 9; latest remote version `20260824101039` |
| pgTAP | 8 suites, 120 assertions, all passed | 8 suites, 120 assertions, all passed |
| Application inventory | 12 tables, 62 non-extension functions, 11 policies | Exact match |
| Edge Functions | generation v3 ACTIVE; cleanup v3 ACTIVE | Not deployed by design |
| Security advisor | Existing `vector in public`; leaked-password protection disabled | Leaked-password protection disabled |
| Performance advisor | Only unused-index INFO on the empty candidate database | Only unused-index INFO on the fixture-sized database |

Remote database types were regenerated after the public-write hardening migration, checked for exact parity, and wired into all Supabase clients. Primary and restore migration histories contain the same named migrations; remote version timestamps differ because each project records its own apply time.

## Restore evidence

- Restored one independent fixture user, one session, one timeline item, one reference-upload metadata row and one image-queue message.
- Logical fixture checksum from `supabase/restore-drill/verify.sql`: `d7a2991f59c5f47a3d8df97457da26e9da52eefa631c067ed3b6b54aa3bd4291`.
- Controlled PNG expected SHA-256: `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.
- The Storage object count is currently zero because the dashboard/service credential login is unavailable. Signed URL, object checksum and post-object cleanup are therefore not yet verified, and the restore project has not been paused.

## External gates still open

| Gate | Current evidence / blocker |
|---|---|
| Anonymous Auth and secrets | Supabase dashboard login is required to enable anonymous sign-in and write Vault/Edge secrets without exposing them. |
| Cleanup schedule | Not created; the SQL scheduler correctly fails closed until all three Vault values exist. Cron job ID: not available. |
| Generation schedule | Intentionally absent while every provider is disabled. |
| Provider probes and 30-sample sets | Not run under the strict zero-cost rule; no qualifying hard-limited free account evidence was available. |
| LangGraph checkpointer | Requires the private database pooler URL from the authenticated dashboard. |
| Sentry | Project, DSNs, diagnostic replay and event IDs require authenticated setup. |
| Vercel Preview | Project/Preview URL/deployment ID are not created because required encrypted server variables and Sentry setup are unavailable. |
| Preview HTTP E2E | Requires the real Preview URL and anonymous Auth; local mock regression is not substituted. This gate includes genuine multi-connection quota-boundary concurrency. |
| Real Safari | Not run. WebKit passing is recorded only as WebKit regression. |
| Backup/PITR | Free projects do not establish production-grade automatic backup or PITR. The partial drill is logical/manual only. |

The evidence supports a locally and remotely migrated Phase 1 Web free-environment candidate. It does not support Production Ready, full restore, Sentry-connected or publicly deployed claims.
