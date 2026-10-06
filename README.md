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

`pnpm run dev` 从项目内统一启动器运行已安装的 Next.js，按 `.node-version` 检查 Node 最低版本。当前 Node 过旧时，会检查 PATH 与 Homebrew 已安装的兼容版本；也可用 `ZIMAGE_NODE_BIN=/绝对路径/node pnpm run dev` 明确指定。启动器不下载软件、不修改全局 PATH，也不再嵌套调用全局 pnpm。依赖安装仍应使用项目声明的 pnpm 11.19。

开发服务默认使用 3000 端口（可用 `PORT=3100 pnpm run dev` 更改）；端口被占用时明确失败，不会悄悄切到另一个端口。此命令是前台服务，需保持终端运行；停止命令或关闭终端后，本地页面会不可用。启动日志会打印实际 Node 路径。Next 16.3 的开发磁盘缓存恢复曾触发 TaskGuard panic，因此开发缓存暂时关闭；首次页面编译会比热更新慢。

默认仍使用版本化 localStorage mock（`zimage:mock:v1`），便于无密钥开发。将 `NEXT_PUBLIC_DATA_MODE` 设置为 `http` 后，Web 会切换到 Supabase 匿名身份、真实 SSE、持久队列和 private Storage；所需变量见 `apps/web/.env.example`，本地统一写入 `apps/web/.env.local`，不再维护 `.env`。生产服务端凭据独立保存在服务器环境文件；构建与发布不复制本地环境文件。

数据库迁移、pgTAP 与 Edge Worker 位于 `supabase/`。真实 Provider、Sentry、Supabase Cloud 和 Vercel Preview 验证需要部署侧密钥，不能用本地 mock 结果替代。

LangGraph 初始化入口为 `pnpm setup:langgraph`。真实环境验收需单独安排，涉及 Storage 写入或付费模型时必须遵守现有授权范围与预算限制。

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm --filter @zimage/web test:acceptance-budget
```

已移除 Playwright / E2E 工具链和截图基线；保留单元测试、Worker 测试及数据库测试，当前不再提供浏览器自动回归覆盖。历史 E2E 结论仅作为当时的验收记录。

## 构建产物管理

日常开发使用默认 `.next`。确需与开发服务隔离时，统一使用 `NEXT_DIST_DIR=.next-build-qa pnpm build`，验证完成后清理该目录，不再按任务新建 `.next-*`。删除缓存前确认没有进程正在使用；缓存会在下次开发或构建时重新生成。`.gitignore` 只防止提交，不会自动清理磁盘。

真实验收目录 `.design-qa/2026-09-16-real-acceptance/` 包含费用预算、未知任务核对记录和验收证据，禁止作为普通测试缓存批量清理。
