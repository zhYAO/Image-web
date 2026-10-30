# Independent static frontend — coordination contract

This local implementation reuses the existing React UI and HTTP gateways. It
has no production activation, database change, Worker change or paid operation.
The coordinator owns package manifests, lockfiles and shared configuration;
this implementation owns the remaining new `apps/frontend/**` files.

## Dependencies the coordinator must lock

Existing direct package: React/React DOM 19.2.7, lucide-react 1.31.0,
`@zimage/domain@workspace:*`, Vite 7.3.6, TypeScript 6.0.3 and existing test types.
Add these already-used exact browser dependencies for the full business UI:

- `zod@4.4.3`, `zustand@5.0.4`
- `react-markdown@10.1.0`, `remark-gfm@4.0.1`, `remend@1.3.0`, `shiki@4.4.3`
- `@sentry/browser@10.75.2` (replaces the Next browser instrumentation)

No Next, Sharp, server Supabase, LangChain, raw fonts or Node modules belong in
this browser package. Tests and production resolve the direct frontend dependencies; no legacy
web/node_modules test aliases are used.

## Build pipeline to wire after integration gates

Run from `apps/frontend`, with explicit `ZIMAGE_ASSET_NAMESPACE` and
`ZIMAGE_FRONTEND_COMPATIBILITY` (JSON with only `apiRequirements` and
`allowedBackendReleases`). These are candidate backend identity allowlists only; exact
API version/capability/release matching stays mandatory. The Vite browser build
emits `.release/candidate.json` with the strict fields `schemaVersion`,
`namespace`, `apiRequirements`, `allowedBackendReleases`, `sourceIdentity` and
`buildToolchainFingerprint`. `sourceIdentity` records actual Git HEAD, the raw
`git ls-tree -r --full-tree HEAD` SHA256, actual lock SHA256 and dirty state. The
build fingerprints executing Node plus the locked package-manager declaration,
and rechecks all identities and relevant source bytes before emitting output.
Build labels never come from caller SHA/toolchain environment variables.
The browser build writes a temporary `.vite/source-snapshot.json`; SSR must match
it and emits `.prerender/source-snapshot.json`. The copy, prerender and final check
CLIs verify the same source snapshot before and after their work, including public
media bytes. Prerender removes all temporary `.vite` metadata before resource
checking. An isolated no-Git test may explicitly use `ZIMAGE_NO_GIT_QA=1`; its zero
source SHA and `dirty:true` candidate can never be production packaged. It never creates a formal release manifest or claims
combination acceptance. The ops packager requires independently recorded real
combination evidence bound to the candidate payload, matching clean source and
actual locked toolchain before it can create a formal
manifest and populate its frozen `verifiedBackendReleases` field.

```sh
vite build
vite build --ssr src/prerender.tsx
node scripts/copy-public-assets.mjs
node scripts/prerender.mjs
node scripts/check-dist.mjs
```

The coordinator's package build script includes all five steps.
Public catalogue constants in the four reviewed landing/editor/example modules
are resolved to `/frontend-assets/<namespace>/...` by the shared browser/SSR
source transform. Only complete literals in the public asset allowlist are
rewritten. The runtime URL helper remains for dynamic inputs and is idempotent;
calling it around an unversioned constant alone does not satisfy artifact
closure. Both build checking and formal packaging reject raw root resource URLs.
Build/subject outcomes and remaining acceptance gates are recorded in
`../../doc/project-progress.md`; build success does not establish production readiness.
No `.env` values are exposed. Optional public telemetry inputs are `ZIMAGE_SENTRY_DSN` and
`ZIMAGE_SENTRY_TRACES_SAMPLE_RATE` (default 0); absent DSN means no telemetry init.
Sourcemaps remain disabled; public payload cannot contain private sourcemaps.

## Runtime and extraction boundary

`main.tsx` mounts `Application`; the runtime is lazy until a non-home route needs
it. Once entered, `RuntimeApplication` retains the existing providers and one
workspace through home navigation. Only the private workspace subtree is keyed
by owner, so an identity check does not destroy a public login form.

The existing AuthPanel, VerifyPanel, ResetPasswordPanel, credits, catalogue,
editor, commerce/apparel, assets, Markdown, store and HTTP gateways are reused.
The account panel is a migrated copy with original UI/actions, replacing its
server refresh with `AccountData` HTTP refetch. The shared legacy workspace and HTTP gateway now also enforce owner/mount
request scopes, preserving the existing Next runtime while preventing stale
requests from restoring drafts or continuing business POSTs after account changes.
Next Link/Image/navigation/dynamic and environment-driven auth/captcha/gateway
edges resolve to explicit browser adapters. There is no fake `router.refresh`.

The source bridge is temporary while shared `packages/ui` extraction is owned
by the coordinator. Three reviewed source substitutions remove mock-only
branches from UnifiedWorkspace, CommerceTaskCard and LegacyCreativeBatchHistory.
They check exact source counts and fail on drift. Mock gateways/ledger are never
selected or included in the browser graph; HTTP credit events use an event-only
adapter. HTTP request IDs, pending credit requests, SSE parsing and recovery
continue through the original implementation. A failed chunk presents explicit
recovery; it never automatically retries a business POST.

`prerender.tsx` emits `/`, `/home`, `/create`, `/terms`, `/privacy`. Private session
IDs are not enumerated. Legal approval stays unapproved. The prerender step
collects catalogue CSS through the Vite import graph, emits a noindex `app.html`
for known private routes, then removes the temporary Vite manifest. Public media
copy uses `build/public-asset-allowlist.json`: only reviewed catalogue images and
license notices are copied. The service source manifest and four original source
PNGs are explicitly omitted; unknown commerce/license paths fail before copying. `check-dist` verifies
local resource closure and rejects forbidden files/markers; it is not the
coordinator's release identity/signature/ingress verifier.

## Remaining gates

See `BACKEND-GAPS.md` for exact existing API contracts and the unresolved legacy
anonymous mode. Formal-auth UI is implemented; real API-only Cookie refresh,
concurrent refresh/revocation, Origin/CSRF and real Supabase acceptance remain
backend/integration gates. No static compatibility check proves those.

Missing/retired paths and APIs need real HTTP errors from ingress; browser route
classification cannot supply status codes. Exact version marker, release index,
retained old Next/RSC resources, Windows build, full resource artifact and rollback
are coordinator gates. All browser work belongs to Terra. Production stays paused.
