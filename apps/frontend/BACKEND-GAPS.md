# Integration contracts for the coordinating task

2026-10-29, source review; no backend changes made here.

## Existing paths consumed unchanged

- `GET /api/auth/session`: private/no-store `{id: UUID}` on verified active
  identity, `401` only for confirmed guest/revoked identity; dependency failure
  remains a retryable `503`. Frontend aborts stale reads, never caches tokens.
- `GET /api/account`: current `accountSchema` (`id`, `email`, `displayName`,
  `status`), private/no-store; returned ID must match the current verified owner.
  Frontend reads with AbortSignal and refetches data on owner changes, not a
  synthetic Next refresh. `PATCH/DELETE /api/account` and existing auth POSTs
  remain same-origin JSON requests with original DTOs.
- Public config and meta fields remain frozen. Cookie refresh, complete
  Set-Cookie handling, Origin/CSRF and parallel refresh are Task 2 backend gates;
  their implementation is not implied by frontend tests.

## Unresolved legacy anonymous mode

The existing `AnonymousAuthGate` directly uses Supabase browser credentials to
`getClaims` and `signInAnonymously({captchaToken})` when formal auth is disabled.
The frozen HTTP-only public config intentionally does not expose those
credentials. `GET /api/auth/session` calls `requireVerifiedUserId`, so it cannot
be assumed to bootstrap a legacy anonymous identity.

The new frontend can fully use **formalAuth=true** with the current paths. It
must fail closed for a private legacy-anonymous bootstrap until the coordinator
chooses either a supported backend bootstrap contract or scopes the initial
static rollout explicitly to the formal-auth configuration. No browser token
storage or new Supabase credential exposure is introduced here.

If preserving that mode through a backend endpoint is required, a candidate
contract for backend owner review is same-origin `POST /api/auth/anonymous`
with `{captchaToken?: string}`, validated Origin/CAPTCHA/rate limit, server-owned
Cookie session creation, no JWT in response and no paid side effects. Endpoint
name/DTO are proposals, not existing or frozen APIs. Do not advertise this
capability or change S1 contracts without a coordinated decision and tests.

## Additional direct frontend dependencies

For the reused full business UI, append existing exact versions:
`zod@4.4.3`, `zustand@5.0.4`, `react-markdown@10.1.0`, `remark-gfm@4.0.1`,
`remend@1.3.0`, `shiki@4.4.3`. They are browser/pure dependencies, no Sharp,
Next, server Supabase or raw fonts. Existing `@testing-library/user-event@14.6.1`
and `@testing-library/jest-dom@6.9.1` may be reused for ported UI tests.

Browser observability additionally requires direct `@sentry/browser@10.75.2`
(already present transitively via the old Next integration). Browser SDK init,
privacy scrubbing and route tracing now exist in the new frontend source, with
privacy unit tests. Direct dependency installation, bundling and configured
telemetry verification remain pending. No server Sentry package enters the graph.

No package manifest or lockfile is edited by this task.
