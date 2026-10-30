# Static frontend implementation handoff — 2026-10-29

Only new `apps/frontend/**` implementation files were written. The coordinator
created `apps/frontend/package.json` and owns its updates/install/lockfile.
No existing application source, shared config, production service, DB, Worker,
paid API or Git history was changed by this implementation task.

## Implemented, with source-level/HTTP-fixture evidence

- Browser History navigation: query/hash, replace, scroll, native link exclusions,
  user-intent preload, existing URL/scene/retired-route classification.
- Strict same-origin public runtime GETs; compatibility tied to exact descriptor.
  Missing/unverified pair blocks runtime modules; public content remains readable.
- Real verified-UUID auth presentation, 401/503 distinction, abort/timeout,
  stale-owner discard, logout/login epoch handling and identity reset hook.
  A replaced/reloaded runtime descriptor also requires a fresh session check;
  the stale-authorization regression was reproduced and fixed.
- Original auth/login/register/recovery/verify UI reused through runtime captcha
  and navigation adapters. Unapproved legal version keeps registration disabled;
  phone login remains the original unavailable placeholder. No token is consumed
  automatically on verification/reset page entry.
- Single Turnstile loader, per-widget cleanup, failed-script retry and real
  runtime site key. No browser Supabase credentials or SDK added.
- Account API loader validates DTO and current owner, cancels/discards stale reads,
  handles retryable outages and supports data refetch. Original account actions,
  password/logout/delete confirmations and credit UI are preserved.
- Original WorkspaceApplication/UnifiedWorkspace, store, HTTP gateway, SSE,
  request IDs, pending credit recovery, commerce/apparel, exports, assets and
  Markdown are reused. Real editor module loaded under HTTP fixtures; a typed
  draft survives home -> workspace. Owner changes reset only the private runtime;
  public login state survives checking -> guest (a regression was found and fixed).
- Public catalogue and assets guest UI preserve existing components. Authorized
  catalogue/assets use the same persistent workspace. Guest private routes return
  safely home; dependency failure displays retry UI rather than guest.
- Home and `/create` semantic prerender, existing legal draft state, route CSS
  import closure and noindex private shell. No private data or runtime requests
  occur during public rendering.
- Allowlisted public media/license copy; static resource checker covers missing
  HTML/CSS/lazy resources, namespace mismatch, fonts/native packages, private maps,
  symlinks/hardlinks, case collisions and forbidden server/secret markers.
- Browser-only Sentry adapter deferred behind optional explicit public DSN. It
  removes identity/request/prompts/breadcrumbs, redacts error messages and uses
  route classes rather than private IDs/queries. No server SDK enters the graph.
- Runtime error boundary offers explicit recovery without automatic business
  retries or displaying raw exception messages.

## Validation

Commands use existing local binaries, never a pnpm command or install:

```sh
node node_modules/vitest/vitest.mjs run --config apps/frontend/vitest.config.ts --reporter=dot
node node_modules/typescript/bin/tsc -p apps/frontend/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js apps/frontend --max-warnings=0
node --check apps/frontend/scripts/prerender.mjs
node --check apps/frontend/scripts/check-dist.mjs
node --check apps/frontend/scripts/copy-public-assets.mjs
git diff --check -- apps/frontend
```

Tests are HTTP fixtures, pure logic, server markup and jsdom components. They
never contact real accounts/providers or invoke paid calls. The final whole run
passed **13 files / 116 tests**, started at 00:00:46 UTC on 2026-10-30 and exited
0. TypeScript, targeted ESLint, three script syntax checks and whitespace checks
also exited 0. Source and script checks are not a full browser/SSR build. Ignored
`.vite` test caches are not an installed dependency tree.

## Pending integration actions — no denial or uncertain side effect

1. **Coordinator dependency install/package pipeline:** add the seven exact
   dependencies in README and append public copy/check scripts. Test-only aliases
   and the current TypeScript legacy-source fallback paths do not prove a
   standalone frontend-only installation/type resolution. Verify that separately
   when coordinating dependencies/packages-ui extraction. Do not mark the
   artifact build done.
2. **Backend gates:** parent reported S2 runtime/compile-time P1 and Task 2 work.
   This task leaves interface fields unchanged and does not certify its fix,
   API-only Cookie refresh, concurrent auth, complete Set-Cookie or CSRF checks.
3. **Legacy anonymous mode:** frozen public config lacks the credentials used by
   the old browser Supabase bootstrap. Formal-auth path is implemented. Private
   formalAuth=false remains fail-closed until the coordinator explicitly resolves
   that mode or limits the initial rollout; see BACKEND-GAPS for a candidate
   backend bootstrap contract, not an invented existing endpoint.
4. **Artifact/integration:** full Vite browser + render builds, generated real
   dist/media/CSS closure, version marker, release identity/index and ingress
   status codes have not run here. The new resource checker was tested against
   fixtures, not presented as a verified production artifact.
5. **Acceptance:** Terra desktop browser, Windows build, real Supabase/storage,
   SSE/queue/billing recovery, old tab/RSC compatibility and exact rollback remain
   unverified. No production operation is authorized; the production pause stays.

## Rulings and review

- Retain an audited source bridge while packages/ui is coordinator-owned.
  Cost if wrong: dependency leakage or adapter drift. Exact substitutions and
  graph/source guards fail closed, but a real build is still required.
- Support fixed HTTP transport in the new frontend; no selectable mock runtime.
  Cost: old anonymous HTTP bootstrap needs a coordinated backend decision.
- Copy only AccountPanel for its SSR-input boundary, preserving UI/actions.
  Cost: keep that narrow copy synchronized until shared UI extraction.
- Error/trace telemetry is opt-in; no DSN produces no network initialization.
  Cost: telemetry acceptance still needs configured environment evidence.

Author self-review and React quality checklist completed; independent parent
integration/security review remains required. No reviewer or browser was spawned
from this implementation task. Existing unrelated work was preserved.


## Latest integration and safety addendum — 2026-10-30 UTC

This addendum supersedes the earlier unchanged-legacy-source and unbuilt-artifact
scope statements. The coordinator explicitly authorized the shared legacy safety
patches and the five-step real QA build. No production deployment, paid operation,
main-repository commit or dependency installation was performed by this agent.
Package manifests, tsconfig and the root lock remain coordinator-owned.

The stale create-session failure and success regressions were both run red first:
the former restored A's private draft into B's editor; the latter continued with
`POST /api/chat` using B's current cookie. The final StrictMode regressions discard
both old outcomes. Security review independently reran those cases and the related
HTTP/download/apparel regressions and reported them passing.

| Shared source scope | Guard and behavior |
| --- | --- |
| `UnifiedWorkspace.tsx` | Capture owner/mount epoch around session creation, image/chat recovery, reads, commerce callbacks, uploads, deletion and downloads; global drafts/composers and business continuations reject stale owners. |
| `http-workspace-gateway.ts` | Fixed `createOwnerScope` child transport, pre/post-fetch and post-body/stream checks; root reset aborts every registered scope, and `isCurrent` closes the reset-to-React-commit window. |
| Both creative-text adapters | Explicit scoped HTTP optimization; stale success/error bodies cannot complete/reject another owner's pending billing record. Unknown outcomes retain their original request identity. |
| `http-commerce-gateway.ts`, `http-apparel-gateway.ts`, `commerce-ui.ts` | Scoped downloads and checks after blob reads and before private download clicks. |
| `download-images.ts` | Owner checks before each image and after fetch/blob awaits prevent late URL creation/clicks and later downloads. |
| `ApparelWorkspace.tsx` | Mount/owner checks before persistence, after awaited session/upload/save/submit results and before ZIP clicks. |
| `LegacyCreativeBatchHistory.tsx` | Existing alive guard also checks the HTTP owner scope before late history/download effects. |

The old Next mock behavior and valid same-owner session switching remain covered
by its targeted regression suites. The exact shared UI/gateway validation set is
13 files / 104 passing tests. The prior frontend whole run passed 19 files / 152
tests; the added provenance/metadata targeted run passed 3 files / 41 tests.
The final complete rerun, lint/typecheck and build outcomes are stored under
`.design-qa/2026-10-29-separation/frontend-finalize/` and
`frontend-build-result.json`; use those current logs for final totals.

Candidate runtime descriptors are strictly `{apiRequirements,allowedBackendReleases}`.
This is only a candidate backend identity allowlist with exact API/capability and
release matching, never combination acceptance. Vite emits only
`.release/candidate.json` with six strict fields: `schemaVersion`, `namespace`,
`apiRequirements`, `allowedBackendReleases`, `sourceIdentity` and
`buildToolchainFingerprint`. Actual Git/tree/lock/dirty state and executing
Node/package-manager identity are sampled and rechecked. Every executable build
stage matches the same temporary input snapshot; public commerce/license media
are included. Explicit no-Git QA remains `dirty:true` with a zero source SHA.
The frozen domain formal manifest is unchanged. Ops owns real combination
acceptance evidence and creates its formal manifest only for matching clean
source and actual locked toolchain; dirty, unaccepted or relabeled candidates fail.

Media copying uses an exact reviewed 68-file allowlist (8,075,948 bytes on this
source). The service `commerce/apparel-v2/manifest.json` and all four `source-*.png`
originals are explicitly excluded. Unknown commerce/license files fail before any
copy. Only the single candidate metadata file is allowed under `.release`; it is
validated and excluded from browser payload statistics.

The source bridge resolves dependencies directly from frontend/node_modules.
`useMediaQuery` is an explicit frontend copy/alias rather than a blanket app gate.
The legacy relative captcha module has a type-only `next/script` declaration for
tsc; Vite still forbids that runtime import and uses the real browser captcha
adapter. There is no runtime Script shim or installed Next dependency in frontend.

Remaining integration gates are coordinator source-isolation installation/build,
real authenticated API/Storage/SSE/billing acceptance, desktop browser and Windows
verification, old Next/RSC compatibility and rollback evidence. This QA candidate
uses uncommitted source and a candidate backend identity; it is not production ready.
