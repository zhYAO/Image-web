# ZImage

Phase 1 Web 统一图片工作台：在同一个可恢复时间线中流式聊天、直接生图或通过聊天工具触发生图。

## 本地开发

需要 Node.js 24.19+ 与 pnpm 11.19+。

```bash
pnpm install
pnpm dev
```

默认仍使用版本化 localStorage mock（`zimage:mock:v1`），便于无密钥开发。将 `NEXT_PUBLIC_DATA_MODE` 设置为 `http` 后，Web 会切换到 Supabase 匿名身份、真实 SSE、持久队列和 private Storage；所需变量见 `apps/web/.env.example`。

数据库迁移、pgTAP 与 Edge Worker 位于 `supabase/`。真实 Provider、Sentry、Supabase Cloud 和 Vercel Preview 验证需要部署侧密钥，不能用本地 mock 结果替代。

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm e2e
```
