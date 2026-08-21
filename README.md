# ZImage

Phase 1A 统一首页 mock：在同一个时间线中流式聊天、直接生图或通过聊天工具触发生图。

## 本地开发

需要 Node.js 24.19+ 与 pnpm 11.19+。

```bash
pnpm install
pnpm dev
```

默认使用版本化 localStorage mock（`zimage:mock:v1`）。Phase 1A 不包含 Supabase、真实 SSE、provider、队列或 Storage 接入。

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm e2e
```
