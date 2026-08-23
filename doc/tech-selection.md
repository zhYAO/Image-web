# zimage 技术选型文档

> **版本**：v1.3
> **状态**：与 `requirements.md` v1.3 对齐的开发决策
> **更新日期**：2026-08-21

## 1. 选型原则与实施顺序

技术选型服务于统一首页，不再按独立页面拆分系统。Phase 1 按以下顺序实施：

1. `UnifiedWorkspace` 前端 mock：覆盖聊天流、排队、部分成功、失败、过期和删除等状态。
2. Chrome、Edge、Safari 最近两个主版本完成关键流程验收。
3. 接入会话、SSE、Supabase Queues、provider、private Storage、告警与备份。

当前文档只批准技术方向，不表示任何代码已经交付。

## 2. 基础栈

| 决策 ID | 选择 | 依据与约束 |
| --- | --- | --- |
| TS-BASE-01 | Next.js 16 App Router、React、TypeScript strict、pnpm workspace | Next.js 16 默认 Turbopack；ESLint 作为独立 CI 命令运行。应用目录统一为 `apps/web/app`。 |
| TS-BASE-02 | Supabase Cloud：Postgres、Auth、Queues、Storage | Phase 1 复用单一平台的身份、数据和持久任务能力；生产使用 Pro 或更高方案。 |
| TS-DB-01 | SQL migration + 生成数据库类型 + pgTAP | 每张公开业务表显式 `GRANT` 和 RLS。不能依赖新建表自动暴露给 Data API。 |
| TS-TYPE-01 | Zod（或等价运行时 schema）+ `unknown` + 判别联合 | 请求、SSE 事件、provider 响应和队列消息均先验证后使用；不在示例或实现中使用 TypeScript 任意类型。 |
| TS-I18N-01 | 结构化 zh-CN key | Phase 1 只暴露中文；组件禁止散落不可检索文案，为 Phase 2 en-US 保留 key 而不提前实现入口。 |
| TS-PERF-01 | OpenTelemetry/Sentry timing + 固定性能夹具 | 分别测量 2K 生图端到端 P95 与 50 会话侧栏渲染；不把 queue 接收时间误当生成完成时间。 |

建议的工作区包：

```text
apps/web                 Next.js Web 与 Route Handlers
packages/domain          领域类型、状态机、错误码
packages/provider        Seedream/Gemini adapter
packages/skills          版本化技能定义与验证
packages/fetch-sse       `@zimage/fetch-sse` 统一 SSE 解析
supabase/migrations      schema、RLS、GRANT、queue 初始化
workers                  生成、删除、到期与备份任务
```

## 3. 前端：UnifiedWorkspace

### 3.1 组件边界

| 决策 ID | 组件/选择 | 职责 |
| --- | --- | --- |
| TS-FE-01 | `UnifiedWorkspace` | `/` 唯一工作区；组合可折叠会话侧栏、主时间线、首页技能卡片、输入框和点击浮层。 |
| TS-FE-02 | `UnifiedComposer` | 维护显式 `chat \| image` 模式，提交前完成模式对应的客户端校验。 |
| TS-FE-03 | `Timeline` + `GenerationCard` | 文本、生成批次和错误使用同一排序；直接与工具生图复用同一卡片。 |
| TS-FE-04 | `ModelPopover` + `GenerationParameterPopover` + `SkillPopover` | 桌面输入框上方的互斥点击浮层：模型与健康状态、能力驱动参数、技能字段与提示词预览；参考图只在输入框内维护，窄屏继续使用兼容抽屉。 |
| TS-FE-05 | Next.js redirect | `/chat`、`/image` 只重定向到 `/`，不加载旧 store 或旧数据。 |
| TS-FE-06 | `SessionSidebar` | 会话创建、选择、重命名、删除；匿名恢复边界提示。 |
| TS-FE-07 | Zustand v5 | 仅保存 UI/请求瞬态；服务端会话和时间线始终以 API 返回为准。 |
| TS-FE-08 | `ToolSelector` | 图片工具默认关闭；用户选技能时按 `triggers.tools` 开启，取消技能时恢复明确的用户选择；提交时把工具许可随请求发送。 |
| TS-FE-09 | 上传/技能表单/批量下载 | 参考图状态机、技能必填字段、可编辑提示词预览；最多 4 个成功资产使用新签发 URL 批量下载。 |

### 3.2 Store slices

统一 store 分为以下 slices，禁止再创建聊天与生图两套会话 store：

| Slice | 客户端状态 | 明确不负责 |
| --- | --- | --- |
| `workspaceSlice` | 当前 `sessionId`、侧栏折叠、活动浮层和窄屏抽屉开合 | 会话持久化 |
| `composerSlice` | 模式、草稿、参考图本地预览 | 服务端消息 |
| `timelineSlice` | 当前页缓存、乐观 pending 卡片、SSE 增量缓冲 | 跨刷新事实源 |
| `generationSlice` | 当前图片 provider/model、能力归一化后的比例/分辨率/数量、批次轮询状态 | 任务执行与重试 |
| `capabilitySlice` | 技能、provider 健康与配额缓存 | provider 真实状态 |

SSE 事件使用判别字段，例如 `session.created`、`message.delta`、`message.completed`、`tool.queued`、`stream.failed`。解析器收到 `unknown` 后先用 schema 验证；未知事件记录诊断并安全忽略。

### 3.3 图片参数

| 决策 ID | 决策 |
| --- | --- |
| TS-IMG-01 | 数量固定为 1–4；提示词支持中英文；前后端都校验长度、参考图数量和文件限制。 |
| TS-IMG-02 | 每个 provider/model 维护服务端 capability manifest，前端据此渲染。Gemini 只映射官方支持的比例、尺寸、输出格式和参考图字段。未知字段不得透传。 |
| TS-IMG-03 | 公共 UI 基线为五种比例、1K/2K 且默认 2K；空提示词禁用。参考图限 PNG/JPEG/WebP、单文件 10 MB、1–4 张，首图可初始化比例/尺寸。provider 更严格限制覆盖公共基线。 |

`GenerationRequest` 使用 `provider` 判别联合。provider adapter 负责把规范化领域参数转换成官方请求，不允许 UI 直接拼 provider payload。

## 4. 公共 API 决策

### 4.1 接口全景

| 决策 ID | 方法与路径 | 响应/职责 |
| --- | --- | --- |
| TS-API-01 | `POST /api/chat` | SSE。事务内创建/验证 session 和用户消息；若新建会话，首个控制事件返回 `sessionId`。完整 assistant 消息完成后持久化。 |
| TS-API-02 | `POST /api/image` | 事务内创建 session（按需）、batch、1–4 条 generation、timeline item、配额预占与 queue message；提交后返回 HTTP 202。 |
| TS-API-03 | `POST /api/image/recreate` | 接收 `single \| failed \| all`，复制原参数为新批次并返回 HTTP 202。 |
| TS-API-04 | `GET /api/image/{batchId}` | 返回批次和单张状态，不返回长期资产地址。 |
| TS-API-05 | `GET/POST /api/sessions`；`PATCH/DELETE /api/sessions/{id}`；`GET /api/sessions/{id}/timeline` | 唯一历史 API。删除只接受一次并返回 HTTP 202。 |
| TS-API-06 | `GET /api/openapi.json` | 由应用代码维护和验证，不读取 Supabase anon 角色的自动规范。 |
| TS-API-07 | 统一 error schema 与错误码 registry | 基础码为 `bad_request`、`unauthorized`、`quota_exceeded`、`provider_error`、`network`、`moderation`；领域码扩展资产过期、删除中等状态。所有失败分支做 schema 测试。 |

辅助只读接口为 `GET /api/skills`、`GET /api/health/providers`、`GET /api/quotas` 和 `GET /api/generations/{id}/asset-url`。

请求字段固定为：

- Chat：`{ sessionId?, message, tools?, chatModel?, imageProvider?, skillId?, images? }`。
- Image：`{ sessionId?, prompt, provider?, model?, params, skillId? }`，其中 `params` 由 capability schema 验证。
- Recreate：`{ batchId, mode: "single"|"failed"|"all", generationId? }`。

### 4.2 统一错误与幂等

错误体为 `{ code, message, retryable, correlationId, details? }`，其中 `details` 必须通过白名单。稳定错误码至少覆盖：认证失效、无权访问、输入无效、配额不足、内容拦截、provider 不可用、任务失败、资产过期和删除处理中。

所有生图提交接收客户端幂等键。数据库对 `(user_id, idempotency_key)` 建唯一约束；相同键和相同请求返回原批次，相同键但不同请求返回冲突。

## 5. AI 与 provider

| 决策 ID | 选择 | 约束 |
| --- | --- | --- |
| TS-AI-01 | LangGraphJS + Postgres checkpointer | `sessions.id` 直接作为 `thread_id`；workflow/checkpointer 按请求创建并 compile；聊天模型与图片 provider 独立选择。 |
| TS-AI-02 | Seedream adapter + Gemini `gemini-3-pro-image` adapter | Gemini 使用稳定模型；请求只含 capability manifest 白名单字段。 |
| TS-AI-03 | 服务端版本化 `SKILL.md`/结构化 manifest | Phase 1 只内置白底图、模特图、种草图；记录 `skill_id` 与 `skill_version`。 |
| TS-AI-04 | provider 原生内容安全网关 + 统一审计映射 | 对提示词、参考图、上下文与输出生效；用固定数据集验证 95% 门槛。 |
| TS-AI-05 | 只推荐、不自动付费切换图片 provider | 展示能力和价格差异，用户确认后才新建任务。 |
| TS-AI-06 | Doubao + MiniMax 聊天 adapter | 两个聊天 provider 独立健康和选择；图片 provider 故障不改变聊天 provider。 |

聊天 tool `generate_image` 的职责止于调用同一个领域服务创建批次与 queue message，并向 SSE 发送 `tool.queued`；后续执行完全脱离聊天请求。

| 决策 ID | 重试规则 |
| --- | --- |
| TS-RETRY-01 | 聊天 LLM 仅在首个内容块输出前对瞬时失败自动重试一次；输出后不自动重放。图片 provider 请求一旦可能已提交就不自动重试。 |

## 6. 数据模型

### 6.1 核心表

| 决策 ID | 表/选择 | 关键字段与约束 |
| --- | --- | --- |
| TS-DATA-01 | `sessions` | `id, user_id, title, status(active\|deleting), created_at, updated_at, deleted_at`；唯一工作区和 LangGraph thread。 |
| TS-DATA-02 | `timeline_items` | `id, session_id, sequence, kind(message\|generation\|error), role, text, batch_id, status, timestamps`；`(session_id, sequence)` 唯一，sequence 由数据库函数原子分配。 |
| TS-DATA-03 | `generation_batches` / `generations` | batch 含 `session_id, source(direct\|chat_tool), provider, model, config, parent_batch_id`；generation 含状态、参数、对象路径、到期状态和错误码。 |
| TS-DATA-04 | `skills` 或版本化发布清单 | 保存技能版本与 capability；timeline/batch 固化使用时版本，避免历史漂移。 |

辅助表：

- `image_safety_audits`：provider 拦截类别、请求关联 ID、最小必要证据，不保存思维链。
- `quota_ledger`：预占、结算、释放均为不可变账本记录。
- `provider_health_windows`：provider、窗口、总量、错误量和计算状态。
- `cleanup_jobs`：删除/到期工作的状态、尝试次数、下次执行时间和错误摘要。
- LangGraph checkpointer 表与 Supabase Queues/pgmq 内部表。

### 6.2 权限

| 决策 ID | 决策 |
| --- | --- |
| TS-SEC-01 | 用户可达业务表启用 RLS，并只向 `authenticated` 显式授予所需操作；policy 用 `auth.uid() = user_id` 或经 session 所有权验证。queue、健康窗口和清理表不向客户端开放。 |
| TS-SEC-02 | service role、provider key、S3 备份凭证仅在 server/worker secret 中；浏览器只使用 publishable/anon 凭证。 |
| TS-SEC-03 | 上传 API 同时校验 MIME、扩展名、magic bytes、文件大小、像素和参考图数量；只接受允许的栅格格式。 |
| TS-PRIVACY-01 | 日志和审计采用字段白名单及脱敏；不保存思维链，不记录可直接访问资产的 signed URL。 |

Supabase 2026 的 Data API 默认暴露行为已经变化，因此迁移必须包含显式权限语句并由 pgTAP 验证“授权角色可访问、其他用户不可访问、未授权表不可访问”。

## 7. 持久队列与状态机

| 决策 ID | 决策 |
| --- | --- |
| TS-QUEUE-01 | 图片任务先在同一数据库事务中写 batch/generation/timeline/配额，再发送 Supabase Queue message；请求提交后才返回 202。禁止依赖请求结束后的后台回调。 |
| TS-QUEUE-02 | queue message 含版本、`jobId`、`generationId`、`idempotencyKey` 和 correlation ID；使用可见性超时、归档/死信和积压监控。 |
| TS-QUEUE-03 | worker 以条件更新取得任务，执行 `pending → processing → succeeded\|failed`；重复消费首先读取终态并安全退出。 |
| TS-QUEUE-04 | 只有连接 provider 前即可证明未提交的基础设施故障可由队列退避重试；超时或未知提交结果进入人工/用户重试路径，避免重复计费。 |

| 决策 ID | 配额 |
| --- | --- |
| TS-QUOTA-01 | 匿名用户每日额度为 30 张；在创建批次的事务中原子预占每张额度，成功结算，确定未提交的失败释放，未知提交结果等待对账。 |

## 8. Storage、删除与到期

| 决策 ID | 决策 |
| --- | --- |
| TS-STORAGE-01 | `uploads` 和 `generated` 均为 private bucket。 |
| TS-STORAGE-02 | 路径为 `{userId}/{sessionId}/{batchId}/{generationId}/...`；资产 API 验证 RLS/所有权后签发短期 signed URL，客户端过期时按 generation ID 续签。 |
| TS-STORAGE-03 | generation 元数据保留到主动删除；成功原图设置 `asset_expires_at = created_at + 90 days`，到期后标记 `expired` 并保留重生成参数。 |
| TS-STORAGE-04 | worker 只调用 Storage API 删除对象，成功后再更新业务状态；不得直接操作 Storage 内部对象行。 |
| TS-STORAGE-05 | reference upload 设置 30 天到期时间；到期或删会话时经 Storage API 清理。依赖已过期参考图的 recreate 要求重新上传。 |
| TS-DELETE-01 | DELETE 先原子把 session 标记 `deleting` 并入 cleanup queue；UI 立即隐藏。worker 依次清 checkpoint、Storage 对象、子记录和 session；步骤可重复执行，失败告警并重试。 |

到期清理与会话删除共用可恢复清理框架，但任务类型和审计原因分开。删除用户主动选择的会话时，清理记录可保留最小运维审计，不保留用户内容。

## 9. 健康、监控与灾备

| 决策 ID | 决策 |
| --- | --- |
| TS-HEALTH-01 | provider 结果写入 Postgres 5 分钟共享窗口；错误率达到 30% 为 warning，超过 50% 且样本不少于 10 为 unavailable 并告警。 |
| TS-OBS-01 | Sentry + 结构化日志；错误对外归一化，对内以 correlation ID 关联 API、queue、provider 和 Storage。 |
| TS-OBS-02 | Phase 1 用 Sentry 告警队列积压/死信、清理失败、provider 高错误率、备份失败和关键 SLO。 |
| TS-OBS-03 | 指标覆盖 API QPS/成功率/错误率/P95、SSE 首块、队列等待、生成耗时/成功率/费用、配额 80% 阈值、signed URL、清理与备份。 |
| TS-OPS-03 | 生产 Supabase Pro 每日数据库备份，RPO 目标 24 小时；Phase 1 不承诺 PITR 或多区域主动容灾。 |
| TS-OPS-04 | 每日把两个 private bucket 增量复制到独立 S3-compatible 目标，并校验对象数、大小与抽样哈希。 |
| TS-OPS-05 | 每季度从数据库备份和 Storage 备份联合恢复到隔离环境，执行完整性脚本并满足 RTO 不超过 4 小时。 |
| TS-OPS-06 | PR 生成隔离 preview；生产人工 promote，可回退上一制品。数据库使用 expand/contract 迁移，破坏性收缩在兼容版本稳定后执行。 |
| TS-OPS-07 | CI 运行 secret scanning、环境变量 schema 校验、生成数据库类型 diff、migration drift 与 pgTAP 权限测试；生产控制台不得成为 schema 事实源。 |

Supabase 数据库备份只包含 Storage 元数据，不包含对象本体，因此 TS-OPS-03 与 TS-OPS-04 缺一不可。

## 10. 匿名身份与阶段边界

| 决策 ID | 决策 |
| --- | --- |
| TS-AUTH-01 | 首次访问建立 Supabase 匿名用户，cookie/session 有效时用 `auth.uid()` 恢复同浏览器历史。 |
| TS-AUTH-02 | 侧栏和删除确认中提示：换设备、退出或清理浏览器数据后匿名历史可能不可恢复。 |
| TS-SCOPE-01 | Phase 1 仅 Web；不做多人协作、在线精修、模型训练、技能市场或首页监控图表。 |
| TS-SCOPE-02 | 匿名账号绑定和跨设备同步推迟到 Phase 2。 |
| TS-SCOPE-03 | 飞书、钉钉、PagerDuty 等外部告警通道推迟到 Phase 2；Phase 1 以 Sentry 为准。 |
| TS-SCOPE-04 | 套图自动编排、视频/文档/Canvas、4K、付费/短信、离线/PWA 与完整无障碍认证均不进入 Phase 1。 |

## 11. 验证策略

| 决策 ID | 门禁 |
| --- | --- |
| TS-TEST-01 | 单元、组件、集成、pgTAP 与 E2E 纳入 CI；前端和后端语句覆盖率分别不低于 70%。 |
| TS-TEST-02 | Playwright 覆盖 Chrome、Edge、Safari 最近两个主版本的关键流程；Safari 可使用对应 WebKit 版本并在真实 Safari 做发布前抽测。 |
| TS-TEST-03 | 契约/恢复/provider 回归门禁：失败结构 100% 可解析、同浏览器恢复 100%、双图片 provider 各 n≥30 且成功率≥95%，健康告警回放满足误报/漏报阈值。 |

关键测试清单：

- SSE 分片、断流、首块前重试一次、输出后失败。
- 图片工具默认关闭、技能自动开启/取消、明确意图触发和普通讨论不误触。
- 1–4 张任务原子入队、部分成功、重复消息、实例重启和未知 provider 提交结果。
- 空提示词、五种比例、1K/2K、参考图格式/10 MB/上传状态、技能必填字段、提示词预览和批量下载。
- 聊天工具生图刷新恢复、直接生图轮询、三种 recreate。
- private URL 续签、越权拒绝、生成原图 90 天/参考图 30 天到期与原参数重生成。
- 删除 UI 隐藏、各清理步骤失败重试、Storage API 删除与最终物理删除。
- 每日 30 张配额并发预占/释放、provider 健康窗口、告警误报/漏报和用户确认降级。
- Doubao/MiniMax 聊天切换与 Seedream/Gemini 图片选择隔离；双图片 provider 的 2K P95/成功率回归。
- 95% 内容安全固定集、日志脱敏、RLS/GRANT 负向用例。
- 同浏览器恢复 100%、统一错误 schema 100%、50 会话侧栏 200 ms 和 zh-CN key 检查。
- 每日数据库/Storage 备份验证与季度恢复演练。

## 12. 参考依据

- [Next.js 16 升级说明](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Gemini 图片模型](https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase 匿名身份](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Storage 删除对象](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Supabase 数据库备份](https://supabase.com/docs/guides/platform/backups)
- [Supabase Data API 默认暴露变更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
