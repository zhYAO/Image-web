<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ZImage Web Agent Guide

## Sources of truth

- `../../doc/requirements.md` is the only product-requirements source. `../../doc/tech-selection.md` records implementation decisions, and `../../doc/architecture.md` records runtime boundaries; neither may invent requirements.
- The current delivery is the Phase 1A unified-home mock. Do not claim or assume that Supabase, real SSE, providers, queues, or private Storage are connected.
- Keep the generated Next.js rules block above intact. Before using a Next.js API, read the matching local guide under `node_modules/next/dist/docs/`.

## Workspace invariants

- `/` is the only workspace. `/chat` and `/image` remain redirects; do not introduce a second chat/image session store, timeline, or route implementation.
- Chat and image drafts stay independent. Server sessions and timeline items come from the gateway; Zustand holds only UI and request-transient state.
- In image mode, the image-tool switch is a checked, locked presentation state. It must not mutate the user's explicit chat-tool preference; returning to chat restores that preference.
- Direct image generation and chat-tool generation use the same timeline card and status semantics, while preserving their `direct` and `chat_tool` sources.

## Reference-image ownership

- The composer and generation config must share one `references` state owned by `UnifiedWorkspace`; never duplicate attachment state between components.
- Accept at most four PNG, JPEG, or WebP files, each no larger than 10 MB. Phase 1A marks valid local selections as `ready` because there is no real upload service.
- Object URLs are UI-only: create them for immediate previews, revoke them on removal and unmount, and exclude them from gateway payloads.
- Keep chat mode free of direct-image attachments. Switching to chat hides image references without clearing them so returning to image mode restores the current configuration.

## Change and verification discipline

- Preserve unrelated staged, unstaged, and untracked work. Keep patches narrow and do not format or rewrite project documents unless the task explicitly requires it.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm build`, and `pnpm e2e` before claiming the web workspace is ready.
