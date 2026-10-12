# Plan 实测安全配置交接

2026-10-12 只读检查。本轮不配置密钥、不部署、不迁移生产、不执行供应商请求。四张额度批准尚未收到，批准后也必须先确认现有 Plan 额度足够且无额外按量收费。

## 用户选择的 Supabase 私有变量位置

已核验对应项目：`klmiycyesxnpinxpeqep`，名称 image-web，状态 ACTIVE_HEALTHY。[Edge Function Secrets 安全页面](https://supabase.com/dashboard/project/klmiycyesxnpinxpeqep/functions/secrets)。用户在该页面亲自填写真实值，聊天只回复“已配置”，不发送密钥截图、密钥文本或含密钥的文件。

| 位置 | 变量 | 是否必需 | 分支实际读取位置 |
| --- | --- | --- | --- |
| Supabase Edge Function Secrets | `ZIMAGE_SEEDREAM_PLAN_API_KEY` | Plan 图片必需 | `supabase/functions/_shared/generation-runner.ts` 的 Plan 模型专用 `providerConfiguration` |
| Supabase Edge Function Secrets | `ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT` | 可选，默认已正确 | 同函数，完整指定 Plan 地址或官方 Plan Base URL，仅规范化一次 |
| Supabase Edge Function Secrets | `ZIMAGE_WORKER_CRON_SECRET` | 运行 Worker 的既有要求 | `supabase/functions/generation-worker/index.ts` 校验 `x-worker-secret` |

Plan 模型固定 `doubao-seedream-5.0-pro`，不需要新增模型名 Secret。Plan Key 不填入 `ARK_API_KEY`；旧队列与聊天的既有密钥保持各自用途。不要新增任何 `NEXT_PUBLIC_*` Plan Key。

**只设置 Secret 仍不能支持当前未部署分支的实测。** Supabase 更新生产 Secret 无须重部署即可供已部署代码读取，前提是代码已经读取该变量。已读取线上 `generation-worker` v16 的源码，它没有新 Plan Key/模型分支；生产数据库也没有 `20261012024930` 新准入迁移。Supabase Secret 是函数运行环境变量，不是远程代码更新，不能让旧 Worker 自动使用新分支。Secret 不会同步或反向导出到本地 Next.js。本轮不会为了验证而部署兼容 Worker、应用迁移或改生产队列。

## 本地 Next.js 与 Worker 的区别

本地完整 HTTP 流程的最小连接配置放在受保护且不入 Git 的 `apps/web/.env.local` 或运行进程的安全环境注入中，不在 Supabase Edge Function Secrets 中：

| 变量 | 性质与作用 |
| --- | --- |
| `NEXT_PUBLIC_DATA_MODE=http` | 非敏感；启用真实网关 |
| `NEXT_PUBLIC_PHASE2_AUTH=true` | 非敏感；启用账号保护 |
| `NEXT_PUBLIC_SUPABASE_URL` | 对应隔离测试项目 URL，不能静默指向生产 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 对应项目可公开 Publishable Key |
| `SUPABASE_SECRET_KEY` | 服务端现代 `sb_secret_*` Key，安全注入，不发聊天、不打包到浏览器 |
| `AUTH_RATE_LIMIT_PEPPER` | production 模式的既有服务端认证要求；本地 dev 有 local-only 默认值，可另行安全注入 |
| `ZIMAGE_CREDITS_ENABLED=true` | 若需验证项目预占/扣费；隔离库需完成相应目录与额度准备 |

完整流程还需真实测试账号登录、该分支全部迁移、私有 Storage、兼容 Worker 及可安全触发 Worker 的凭据；每个边界都有独立证据。当前环境没有这些本地凭据或登录态。Supabase MCP 的已授权只读连接可以核验项目/代码/迁移，但不是本地用户登录，不授予 Next.js 或本地 Worker 相同凭据。

聊天明确生图分支直接提交共享图片服务，无须用 Plan Key 替换 Web 聊天 Key。若还要实际普通文字聊天或文字优化，则 Web 的 `ARK_API_KEY` 与 `ZIMAGE_DOUBAO_CHAT_MODEL` 是额外独立配置，仍不能借用 Plan 图片 Key。

在坚持“仅存在 Supabase 私有变量、禁止部署”的当前条件下，没有已验证的渠道让本地未部署 Worker 安全消费该 Secret，也没有可执行的本分支端到端真实路径。不要读回 Secret、不把 Secret 复制到本地、不以生产旧模型结果替代。需后续另行确定一个已授权、代码版本匹配的隔离测试环境；当前只交付示例、检查证据和待执行用例。

依据：[Supabase 环境变量说明](https://supabase.com/docs/guides/functions/secrets)。线上项目/Worker/迁移来自本轮实际只读查询，Secret 存在性未宣称已验证。
