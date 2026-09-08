<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ZImage Web Agent Guide

## Sources of truth

- `../../doc/requirements.md` is the only product-requirements source. `../../doc/tech-selection.md` records implementation decisions, and `../../doc/architecture.md` records runtime boundaries; neither may invent requirements.
- `../../doc/project-progress.md` is the only source for current delivery status, blockers, and next actions. Requirements marked `covered`, commit titles, existing code, or historical reports must not be used to infer that a task is `done`.
- The workspace supports versioned mock and real HTTP modes behind the same gateway contract. Phase 1B integration code exists, but real Supabase, SSE, provider, queue, and private Storage readiness must only be claimed after the corresponding environment evidence is recorded.
- Keep the generated Next.js rules block above intact. Before using a Next.js API, read the matching local guide under `node_modules/next/dist/docs/`.

## Workspace invariants

- `/` is the only workspace. `/chat` and `/image` remain redirects; do not introduce a second chat/image session store, timeline, or route implementation.
- Chat and image drafts stay independent. Server sessions and timeline items come from the gateway; Zustand holds only UI and request-transient state.
- In image mode, the image-tool switch is not rendered. Image mode still derives image capability internally without mutating the user's explicit chat-tool preference; returning to chat restores that preference, while a selected skill may force-enable it.
- Toolbar and mobile-drawer skill selection preserve the current mode; only the empty-state quick skill cards explicitly enter image mode. Desktop and mobile configuration must share `selectedSkillId` and `skillValues` rather than creating a second skill state.
- Controlled assistant tags are presentation-only. Parse only the documented whitelist, keep raw persisted/SSE content unchanged, and render unknown, mismatched, code-contained, or finally incomplete tags through the existing safe Markdown path.
- Direct image generation and chat-tool generation use the same timeline card and status semantics, while preserving their `direct` and `chat_tool` sources.

## Reference-image ownership

- The composer and generation config must share one `references` state owned by `UnifiedWorkspace`; never duplicate attachment state between components.
- Accept at most four PNG, JPEG, or WebP files, each no larger than 10 MB. Mock mode marks valid local selections as `ready`; HTTP mode uploads them through the private Storage route before submission.
- Object URLs are UI-only: create them for immediate previews, revoke them on removal and unmount, and exclude them from gateway payloads.
- Keep chat mode free of direct-image attachments. Switching to chat hides image references without clearing them so returning to image mode restores the current configuration.

## Change and verification discipline

- Per the user's 2026-09-08 instruction, browser regression targets desktop Web only. Do not run mobile or tablet projects or switch tests to phone/tablet viewports unless the user explicitly requests that scope again.
- Preserve unrelated staged, unstaged, and untracked work. Keep patches narrow and do not format or rewrite project documents unless the task explicitly requires it.
- When a task completes acceptance, update `../../doc/project-progress.md` in the same change with its status, validation date, automated results, and applicable real-environment evidence. A task is `done` only when all evidence required by that ledger is current; downgrade it when evidence expires or the environment drifts.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm build`, and `pnpm e2e` before claiming the web workspace is ready.
