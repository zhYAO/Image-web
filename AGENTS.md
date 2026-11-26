# AGENTS.md

ZImage 是电商图片工作台。生产由 Nginx 在同一域名提供 Vite 静态前端和 Next.js API，Supabase 提供身份、数据库、持久队列和私有 Storage。

## 从哪里开始

| 范围 | 入口 |
| --- | --- |
| 静态页面、路由和浏览器适配 | [apps/frontend/src](apps/frontend/src/)，构建约束在 [apps/frontend/build](apps/frontend/build/) |
| Vite 与 Next Web 共用的工作区、电商、认证 UI 与网关 | [apps/web/features](apps/web/features/)、[gateways](apps/web/gateways/) 和 [store](apps/web/store/) |
| Next.js API、业务服务和数据库客户端 | [apps/web/app/api](apps/web/app/api/)、[server](apps/web/server/) 和 [lib/supabase](apps/web/lib/supabase/) |
| 共享 Zod 契约、模型能力、积分与业务规则 | [packages/domain/src](packages/domain/src/)（`@zimage/domain`） |
| SQL 迁移、数据库测试、Edge Worker 与模型中继 | [supabase/migrations](supabase/migrations/)、[tests](supabase/tests/) 和 [functions](supabase/functions/) |
| 开发启动、CI 与 ECS 发布 | [scripts](scripts/)、[.github/workflows](.github/workflows/) 和 [ops/aliyun/production](ops/aliyun/production/) |

- 产品范围看[需求](doc/requirements.md)，技术背景看[选型](doc/tech-selection.md)和[架构](doc/architecture.md)，交付状态及真实验收证据看[项目进度](doc/project-progress.md)。历史快照里的命令和状态须用当前代码、配置或后续记录核对。
- 修改 `apps/web/` 或其共享 UI 时，先看 [Web 专属指引](apps/web/AGENTS.md)。涉及 Next.js API 时，读安装版本的 `apps/web/node_modules/next/dist/docs/`。视觉细节参考 [DESIGN.md](DESIGN.md) 和现行组件。

## 本地开发与检查

从仓库根目录运行。Node.js 最低 `24.19.0`（`.node-version`），pnpm 锁定 `11.19.0`（`package.json`）。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

- `pnpm dev` 启动 Next Web，默认 `127.0.0.1:7788` 和 Mock 数据。`pnpm dev:split` 启动 Vite（默认 `127.0.0.1:5173`）和本地 Next 后端，使用 HTTP 与正式认证。从模板配置 `apps/web/.env.local`，确认 Supabase 指向预期测试环境。真实聊天、生图和文案优化可能扣费。[环境变量模板](apps/web/.env.example) · [启动参数](README.md#本地开发)
- `pnpm build` 构建 Next Web。有运行中的开发服务时，在 Bash 中用 `NEXT_DIST_DIR=.next-build-qa NEXT_PUBLIC_DATA_MODE=mock pnpm build` 隔离产物。`pnpm build:frontend` 需要显式 `ZIMAGE_ASSET_NAMESPACE` 和 `ZIMAGE_FRONTEND_COMPATIBILITY`，示例见[成对构建脚本](ops/aliyun/production/build.sh)。

| 影响范围 | 检查命令 |
| --- | --- |
| 通用 JS/TS | `pnpm lint`、`pnpm typecheck`、`pnpm test:run` |
| 单包或单个测试 | `pnpm --filter @zimage/web test:run tests/openapi.test.ts`，按范围换为 `@zimage/frontend` 或 `@zimage/domain` 及包内测试路径 |
| 分离开发或验收预算 | `pnpm test:dev-split`、`pnpm test:credit-budget`、`pnpm --filter @zimage/web test:acceptance-budget` |
| Edge Worker | `pnpm exec vitest run supabase/functions/generation-worker supabase/functions/cleanup-worker` |
| 数据库（需 Docker） | `pnpm exec supabase start` 启动本地栈，再运行 `pnpm exec supabase test db --local supabase/tests/database` |
| 接收器与分层归档（Linux） | `python3 -B -m unittest discover -s ops/aliyun/production -v`、`python3 -B ops/aliyun/test_release_three_layer.py -v` |

完整检查及字体等测试依赖以 [PR 工作流](.github/workflows/pr-build.yml) 和[回归脚本](ops/aliyun/pr-checks.sh)为准。按影响范围运行检查，交付时列出结果及跳过的项目。

## 跨层变更

- `/workspace` 是唯一工作区，`/` 和 `/home` 是品牌首页，`/chat` 和 `/image` 跳转到 `/workspace`。改路由时同时核对 [Vite 路由](apps/frontend/src/route-policy.ts)、[共享路由](apps/web/features/workspace/workspace-route.ts)和 [Nginx](ops/aliyun/split.nginx.conf)。
- 复用共享 UI 和网关，按账号与会话隔离草稿。持久会话与时间线由后端网关提供。Vite 业务请求走同源 `/api`，平台差异放在 `apps/frontend/src/platform/`，共享代码须通过[浏览器依赖边界](apps/frontend/build/client-boundary.ts)。
- 更新接口时同步核对领域 Zod schema、网关、Route Handler、[OpenAPI](apps/web/server/openapi.ts)及契约测试。沿用 [route-context](apps/web/server/route-context.ts) 的错误与响应处理，对受保护请求验证身份和所有权，对写入验证 Origin。保留 RLS、显式 GRANT 与服务端凭据边界，私有资产通过已有授权和短期签名 URL 访问。
- 保留请求 ID、幂等键、持久入队与积分结算语义。供应商结果为 `unknown` 时核对原请求，禁止自动重提或退款。通过新增迁移演进已应用的 SQL。用 `pnpm exec supabase gen types typescript --local` 从本地库重新生成[数据库类型](apps/web/lib/supabase/database.generated.ts)。
- 变更公开示例图时，同步[锁定清单](ops/aliyun/public-images.json)、[共享路径](apps/web/features/commerce/public-image-paths.json)与 [Vite 白名单](apps/frontend/build/public-asset-allowlist.json)。沿用 `publicAssetUrl()`。生产构建校验同源版本化图片的字节与摘要，用户上传留在私有 Storage。

## 交付与发布

- 保留已有的暂存、未暂存和未跟踪工作。提交限于当前任务，排除凭据、构建产物和缓存。项目记录用 `doc/`，避免写入 `.workbuddy-ai/`。保留 `.design-qa/2026-09-16-real-acceptance/` 的验收和费用证据。
- 同仓分支向 `main` 提 PR，通过 `zimage-release-pr-required` 后由维护者手动 Merge。纯文档合并跳过生产发布，PR 检查照常。生产构建、签名、投递和回滚核对走[合并即发布](doc/merge-to-release.md)与[接收端手册](ops/aliyun/production/README.md)。
- 改动 [`kit.py` 的 `FILES` 清单](ops/aliyun/production/kit.py)中的文件会改变 `KIT_ID`，须按手册在合并前准备对应接收器。迁移树变化须核对候选与回滚代码的数据库兼容性。数据库迁移、Edge 部署及真实付费操作独立于网站发布，按本次任务的明确授权执行。
- 发布成功须同时核对接收端 `committed`、签名归档摘要与事务日志一致、公网前后端版本与合并 SHA 一致。结果为 `unconfirmed` 时先核主机事务。按当前环境的验证证据更新 `doc/project-progress.md`，本地构建或 Mock 检查只覆盖对应本地环境。
