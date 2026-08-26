# ZImage

Phase 1 Web 统一图片工作台：在同一个可恢复时间线中流式聊天、直接生图或通过聊天工具触发生图。

## 当前进度

当前任务状态、阻塞项、验收证据和下一阶段顺序统一记录在 [`doc/project-progress.md`](doc/project-progress.md)。该账本是唯一的当前交付进度事实源；需求、架构和历史交付文档不替代它。

## 本地开发

需要 Node.js 24.19+ 与 pnpm 11.19+。

```bash
pnpm install
pnpm dev
```

默认仍使用版本化 localStorage mock（`zimage:mock:v1`），便于无密钥开发。将 `NEXT_PUBLIC_DATA_MODE` 设置为 `http` 后，Web 会切换到 Supabase 匿名身份、真实 SSE、持久队列和 private Storage；所需变量见 `apps/web/.env.example`。

数据库迁移、pgTAP 与 Edge Worker 位于 `supabase/`。真实 Provider、Sentry、Supabase Cloud 和 Vercel Preview 验证需要部署侧密钥，不能用本地 mock 结果替代。

真实环境的显式入口为 `pnpm setup:langgraph` 与 `pnpm e2e:http`。后者必须提供 `PHASE1B_HTTP_BASE_URL`；Storage 写入和真实 Provider SSE 还需分别显式设置验收开关，避免本地回归误触云资源或费用。

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm e2e
```
