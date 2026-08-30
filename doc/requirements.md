# zimage 需求文档（PRD / SRS）

> **版本**：v1.4
> **状态**：开发基线
> **更新日期**：2026-08-27
> **唯一需求源**：本文件。`tech-selection.md` 负责技术决策，`architecture.md` 负责运行时结构；两者不得反向创造需求。

## 1. 产品边界与交付顺序

ZImage 是面向电商设计师的对话式图片工作台。Phase 1 只提供一个工作区入口 `/`：用户在同一输入框中显式选择“聊天”或“生图”，聊天文本、直接生图和聊天工具生图都进入同一条可恢复时间线。

交付顺序固定为：

1. 统一首页 mock，使用可控假数据完成所有关键状态。
2. 前端关键流程与三浏览器验收。
3. 接入会话 API、SSE、持久队列、模型服务、私有 Storage 与运维能力。

本轮文档修订不代表前端或后端已经实现。

### 1.1 Phase 1A / 1B 零费内测口径

- Phase 1A 的浏览器门禁固定为 Chromium、Microsoft Edge 与 Playwright WebKit；本轮不要求真实 Safari。
- Phase 1B 在本地 Next.js 生产模式 HTTP 服务上验收，环境必须使用 `NEXT_PUBLIC_DATA_MODE=http` 与 `ZIMAGE_DEPLOYMENT_ENV=acceptance`，不依赖 Vercel。
- Phase 1C 在本轮表示“零费内测门禁”，通过后只允许受控内测，不得表述为生产就绪。
- SC-05、SC-07 中的真实 Safari 部分、SC-08、SC-10、SC-15，以及 OPS-06、OPS-07、OPS-11 的生产发布部分保留原稳定 ID，但归入后续生产门禁。本轮不因这些外部门禁未完成而阻断 Phase 1A/1B 的零费内测验收。
- 需求追溯矩阵的 `covered` 只表示已有实现或验证落点，不表示对应生产证据已经完成，也不自动将阶段任务提升为 `done`。
- 阿里云 ECS、Docker、TLS、反向代理、生产发布与回滚另立计划；本轮不创建或部署相关资源。

## 2. 成功指标

| ID | 指标与目标 | 验证方法 |
| --- | --- | --- |
| SC-01 | 从打开首页到发起第一次聊天或生图不超过 3 个用户动作 | 可用性任务脚本 |
| SC-02 | 白底图、模特图、种草图三个首发技能人工可用率均不低于 80% | 每技能每周 10 组（5 随机 + 5 高频），由 2–3 名设计师盲评 |
| SC-03 | 聊天首个 SSE 内容块 P95 不超过 3 秒（不含用户网络异常） | 生产指标按 5 分钟窗口统计 |
| SC-04 | 1–4 张直接生图请求在 1 秒内返回已排队状态 | API 指标与集成测试 |
| SC-05 | 内容安全 1000 条固定样本集识别准确率不低于 95% | 上线前与每日回归；同时记录误放和误杀 |
| SC-06 | 前后端自动化测试语句覆盖率均不低于 70% | CI 覆盖率门禁 |
| SC-07 | Chrome、Edge、Safari 最近两个主版本通过关键流程 | 浏览器矩阵 E2E |
| SC-08 | 生产数据 RPO 不超过 24 小时，RTO 不超过 4 小时 | 每季度恢复演练 |
| SC-09 | 已提交任务在应用实例重启后可继续处理，且不会因重复消费产生重复计费 | 故障注入与幂等性测试 |
| SC-10 | Seedream 与 Gemini 的 2K 单张端到端生成延迟分别满足 P95 不超过 60 秒 | 每个 provider 至少 30 个固定请求，从 API 接收到对象可访问 |
| SC-11 | 匿名用户每日配额为 30 张，并能在额度内连续完成至少 20 张 | 24 小时配额扣减、复位、并发和越界跑测 |
| SC-12 | 同一浏览器且匿名身份有效时，会话与生成历史刷新恢复率为 100% | 创建会话和两类生图后刷新/重开 E2E |
| SC-13 | API 失败返回可解析统一错误结构的比例为 100% | 所有失败分支的 schema 契约测试 |
| SC-14 | provider unavailable 告警误报低于 5%、漏报低于 1% | 故障注入样本回放 |
| SC-15 | Seedream 与 Gemini 固定回归集的生成请求成功率分别不低于 95% | 每次 provider 依赖升级各运行至少 30 个样本 |

## 3. 用户故事与验收要求

### 3.1 US1：统一首页工作区

| ID | 验收要求 |
| --- | --- |
| US1-AC01 | `/` 是唯一工作区；首次进入即可输入，无需先选择独立页面。 |
| US1-AC02 | 同一 `UnifiedComposer` 仅提供一个输入框和草稿；非输入法合成状态下 Enter 发送、Shift+Enter 换行。 |
| US1-AC03 | 聊天模式通过 SSE 增量显示文本；刷新后只展示已经持久化的完整消息，不伪造未完成输出。 |
| US1-AC04 | 会话切换立即高亮目标并展示消息骨架；时间线、加载、流式回复、生图回合和 busy 按 `sessionId` 隔离，原会话任务可在后台继续且异步结果不得污染其他会话。 |
| US1-AC05 | 聊天工具生图与直接生图使用相同的生成卡片、状态语义和资产访问方式。 |
| US1-AC06 | 桌面端的模型、生成参数和技能配置从输入框工具栏点击后在其上方浮层展开；参考图仅在输入框内维护。窄屏可回退为配置抽屉，且不得遮挡主时间线的基本操作。 |
| US1-AC07 | `/chat` 和 `/image` 保留兼容重定向到 `/`，不得形成第二套状态或历史。 |
| US1-AC08 | Web 仅保留一个输入框和单一草稿，不展示聊天/生图双模式；默认发送聊天，启用“创建图片”或选择需要图片的技能后调用现有图片提交链路。 |
| US1-AC09 | “创建图片”发送后保持选中，清空本次提示词和参考图，保留图片参数与技能；未启用时任何普通聊天不得误触发付费图片任务。 |
| US1-AC10 | 助手正文中的 `think/reasoning`、`tool/tool_call`、`tool_result/observation` 受控标签以只读折叠块展示；流式未完成块自动展开，完成后自动折叠。代码中的标签、未知标签、错配标签和流结束时仍残缺的标签按安全文本展示，原始消息内容不得因展示解析而改写。 |
| US1-AC11 | 时间线在用户接近底部时自动跟随新消息、流式增量和生图状态；用户主动上滑后停止抢占阅读位置并提供“回到底部”入口，发送新消息恢复跟随，会话切换直接定位最新内容，减少动态效果偏好必须生效。 |
| US1-AC12 | 启用“创建图片”后默认只展示参考图、描述输入、技能和模型/比例/分辨率/数量摘要，完整设置按需展开且桌面浮层与窄屏抽屉共享状态；提交后立即展示用户提示词和等比例图片骨架，入队成功无闪烁替换，失败在原回合重试且不得重复提示词。 |

### 3.2 US2：批量图片生成

| ID | 验收要求 |
| --- | --- |
| US2-AC01 | 用户可输入中文或英文提示词并选择 1–4 张。 |
| US2-AC02 | 参数表单只显示当前 provider/model 官方支持的比例、尺寸、输出格式和参考图约束。 |
| US2-AC03 | 提交直接生图后服务返回 HTTP 202、`sessionId`、`batchId` 和 `pending` 状态。 |
| US2-AC04 | 单张结果至少经历 `pending → processing → succeeded\|failed`；批次允许部分成功。 |
| US2-AC05 | 时间线可区分 `direct` 与 `chat_tool` 来源，但交互表现一致。 |
| US2-AC06 | 用户可以按 `single`、`failed` 或 `all` 重新生成；每次重生成新批次并保留来源关系。 |
| US2-AC07 | provider 已接收请求后不得自动重试，避免重复扣费；用户可主动重试。 |
| US2-AC08 | 生成结果、助手 Markdown 图片和输入框参考图支持统一大图预览及全屏、Esc、缩放、拖动、旋转/翻转、前后切换、复制和下载；技能封面不进入会话预览组，下载和预览继续使用安全 URL 与短期 signed URL。 |
| US2-AC09 | 生成记录保留到用户主动删除；原图自生成成功起保存 90 天。 |
| US2-AC10 | 原图到期前提示；到期后卡片标为 `expired`，可用原参数重新生成但不得承诺复原同一像素结果。 |
| US2-AC11 | 空白提示词不能提交；前后端执行一致的必填和长度校验。 |
| US2-AC12 | 公共基线提供 1:1、3:4、4:3、9:16、16:9 比例和 1K/2K 分辨率，默认 2K；只有 provider 支持项可选择。 |
| US2-AC13 | 可上传 1–4 张 PNG、JPEG 或 WebP 参考图，单文件不超过 10 MB；provider 更低上限优先。 |
| US2-AC14 | 每张上传显示 `uploading \| ready \| error`，失败可重试，未 ready 的引用不能提交。 |
| US2-AC15 | 首张参考图可初始化比例/尺寸，用户可在 capability 允许范围内覆盖。 |
| US2-AC16 | 成功卡片显示缩略图、provider、尺寸和下载入口，不显示永久公开地址。 |
| US2-AC17 | 批次可下载所有成功且未到期的图片；失败/过期项不阻塞其他项。 |
| US2-AC18 | 失败卡片显示稳定错误码，并允许复制经过脱敏的错误详情与 correlation ID。 |
| US2-AC19 | 参考图对象保留 30 天或至会话删除（取先发生者）；过期后依赖参考图的重生成要求重新上传并解释原因。 |

### 3.3 US3：服饰技能

| ID | 验收要求 |
| --- | --- |
| US3-AC01 | Phase 1 内置白底图、模特图、种草图三个技能。 |
| US3-AC02 | 技能包含名称、说明、适用条件、系统指令和受支持的模型/参数约束。 |
| US3-AC03 | 技能可从首页图片快捷卡片、输入框技能浮层和窄屏兼容抽屉选择；首页快捷卡片作为立即生图入口切换到生图模式，工具栏或抽屉选择保持当前模式，所有入口共享同一份单选技能状态。 |
| US3-AC04 | 技能改变提示上下文或参数默认值，但不绕过内容安全、配额和 provider 能力校验。 |
| US3-AC05 | 不支持的技能与模型组合必须在提交前阻止并解释原因。 |
| US3-AC06 | 技能配置在服务端版本化；时间线记录使用时的版本。 |
| US3-AC07 | 用户自定义技能、技能市场和在线编辑器不属于 Phase 1。 |
| US3-AC08 | 技能选择器显示图标、中文名和一句话说明。 |
| US3-AC09 | 技能必填字段在 UI 显式列出，缺失字段标记错误并阻止提交。 |
| US3-AC10 | 生图模式展示技能模板填充后的提示词预览，用户可在提交前编辑。 |
| US3-AC11 | 聊天模式选择声明图片工具的技能时自动强制开启且暂时禁止关闭；清除技能只移除强制启用效果，不得改写用户原有的显式图片工具偏好。 |

### 3.4 US4：会话与时间线

| ID | 验收要求 |
| --- | --- |
| US4-AC01 | `sessions` 是唯一工作区实体，ID 同时作为 LangGraph `thread_id`。 |
| US4-AC02 | 侧栏按最近更新时间展示会话，支持创建、重命名和删除。 |
| US4-AC03 | 文本消息、生成批次和可展示错误按稳定 `sequence` 排序，刷新后顺序不变。 |
| US4-AC04 | 聊天工具生图和直接生图都必须持久化；不得仅保存在进程内或客户端。 |
| US4-AC05 | 删除会话后 UI 立即隐藏；后台可重试地清理 checkpoint、Storage 对象和数据库记录。 |
| US4-AC06 | 被删除或不属于当前用户的会话及资产不可访问。 |
| US4-AC07 | 在固定 50 会话夹具和千兆网络环境下，侧栏收到响应后的渲染耗时不超过 200 ms。 |

### 3.5 US5：模型选择与降级

| ID | 验收要求 |
| --- | --- |
| US5-AC01 | 聊天模型和图片模型分别选择；图片 provider 首发为 Seedream 与 Gemini。 |
| US5-AC02 | Gemini 使用稳定模型 `gemini-3-pro-image`，只发送官方支持字段。 |
| US5-AC03 | provider 健康状态来自 Postgres 共享窗口，不依赖单个 serverless 实例内存。 |
| US5-AC04 | 5 分钟窗口错误率达到 30% 显示警告；超过 50% 且样本不少于 10 个时标记不可用并告警。 |
| US5-AC05 | 自动推荐降级 provider 前展示能力或价格差异；未经用户确认不得自动产生图片费用。 |
| US5-AC06 | 历史生成记录显示创建时的 provider/model，后续默认模型变化不得改写历史。 |
| US5-AC07 | Phase 1 聊天 LLM provider 为 Doubao 与 MiniMax；图片 provider 故障不得连带切换聊天 provider。 |

### 3.6 US6：匿名身份与恢复边界

| ID | 验收要求 |
| --- | --- |
| US6-AC01 | Phase 1 使用 Supabase 匿名身份，首次访问自动建立匿名用户。 |
| US6-AC02 | 同一浏览器、身份仍有效时，刷新和重新打开可恢复会话与时间线。 |
| US6-AC03 | 匿名用户换设备、退出或清理浏览器数据后不保证恢复历史，UI 必须明确提示。 |
| US6-AC04 | 匿名身份与未来正式账号绑定属于 Phase 2；Phase 1 不宣称跨设备同步。 |
| US6-AC05 | 所有数据访问以服务端验证后的 `auth.uid()` 为所有权边界。 |

### 3.7 US7：失败、配额与可观察性

| ID | 验收要求 |
| --- | --- |
| US7-AC01 | 用户看到可行动的错误状态；内部错误、密钥、provider 原始敏感响应不得泄漏。 |
| US7-AC02 | 聊天仅在首个 SSE 内容块输出前对瞬时 LLM 错误自动重试一次；输出后失败必须结束流并允许用户重发。 |
| US7-AC03 | 配额在任务入队前原子预占，失败或取消按确定规则释放，避免并发超额。 |
| US7-AC04 | 队列积压、死信、清理失败、provider 高错误率和备份失败均产生 Sentry 告警。 |
| US7-AC05 | 对外基础错误码至少统一为 `bad_request`、`unauthorized`、`quota_exceeded`、`provider_error`、`network`、`moderation`；资产过期和删除中使用额外稳定领域码。 |

## 4. 公共接口契约

所有写接口均验证匿名或正式登录会话、CSRF/Origin、所有权、配额和输入大小。错误使用稳定错误码，不把 provider 原始错误直接返回客户端。

| ID | 接口 | 契约 |
| --- | --- | --- |
| API-01 | `POST /api/chat` | 请求为 `{ sessionId?, message, tools?, chatModel?, imageProvider?, skillId?, images? }`；响应为 SSE。若未传会话，首个控制事件返回新 `sessionId`。 |
| API-02 | `POST /api/image` | 请求为 `{ sessionId?, prompt, provider?, model?, params, skillId? }`；返回 `202 { sessionId, batchId, status: "pending" }`。 |
| API-03 | `POST /api/image/recreate` | 请求含 `batchId`、`mode: "single"\|"failed"\|"all"` 及按需 `generationId`；返回新批次的 HTTP 202。 |
| API-04 | `GET /api/image/{batchId}` | 返回用户有权访问的批次及单张状态，不内嵌长期公开 URL。 |
| API-05 | `GET/POST /api/sessions` | 查询或创建统一会话。 |
| API-06 | `PATCH/DELETE /api/sessions/{id}` | 重命名；或把会话标记为 `deleting` 并入清理队列。删除返回 HTTP 202。 |
| API-07 | `GET /api/sessions/{id}/timeline` | 以稳定 `sequence` 分页读取完整时间线。 |
| API-08 | `GET /api/generations/{id}/asset-url` | 对未过期且有权访问的私有对象签发短期 URL。 |
| API-09 | `GET /api/skills` | 返回服务端版本化技能及兼容能力。 |
| API-10 | `GET /api/health/providers` | 返回对用户可展示的 provider 状态，不暴露内部响应。 |
| API-11 | `GET /api/quotas` | 返回当前用户可用额度和重置时间。 |
| API-12 | `GET /api/openapi.json` | 返回应用自身维护的接口规范；不依赖 Supabase anon key 的自动 OpenAPI 暴露。 |

## 5. AI、数据与技术约束

### 5.1 AI 约束

| ID | 约束 |
| --- | --- |
| AI-01 | 聊天编排使用 LangGraphJS；每个 `session.id` 等于 checkpoint `thread_id`。 |
| AI-02 | 生图工具只创建持久批次并入队，不在聊天请求生命周期内等待 provider 完成。 |
| AI-03 | tool 参数通过判别联合和运行时 schema 校验；未知字段拒绝或显式忽略并记录。 |
| AI-04 | 图片提示词、参考图、技能上下文与输出均通过 provider 安全网关；拦截结果归一化并留审计证据。 |
| AI-05 | 内容安全固定集达到 SC-05 前不得发布；95% 是准确率门槛，不代表零漏放承诺。 |
| AI-06 | 不保存模型思维链；仅保存用户输入、可见输出、工具调用摘要和必要审计元数据。 |
| AI-07 | provider 调用有超时、关联 ID、费用归因和结构化日志。 |
| AI-08 | 聊天与生图重试严格遵守 US2-AC07 和 US7-AC02。 |

### 5.2 数据与平台约束

| ID | 约束 |
| --- | --- |
| CON-01 | Web 使用 Next.js 16 App Router、React、TypeScript 严格模式；Next.js 16 默认 Turbopack，ESLint 独立执行。 |
| CON-02 | 前端状态使用 Zustand v5；服务端实体以 API/数据库为准，客户端状态不可作为恢复依据。 |
| CON-03 | 数据库、Auth、队列和 Storage 使用 Supabase；图片任务使用 Supabase Queues/pgmq。 |
| CON-04 | 生产运行于 serverless 环境，禁止依赖请求结束后的未等待后台工作或实例内共享内存。 |
| CON-05 | 所有数据库变更经迁移管理；显式设置表权限与 RLS，不能依赖新表自动暴露。 |
| CON-06 | TypeScript 示例和实现不使用显式任意类型；外部输入先作为 `unknown` 再经 schema/类型守卫收窄。 |
| CON-07 | LangGraph workflow 与 checkpointer 按请求创建/编译，不使用可能跨用户串状态的模块级可变单例。 |
| CON-08 | Phase 1 用户界面仅提供 zh-CN；文案必须使用结构化 i18n key，en-US 入口推迟。 |

## 6. 安全、隐私与运维约束

### 6.1 安全与隐私

| ID | 约束 |
| --- | --- |
| SEC-01 | `uploads` 与 `generated` 两个 bucket 均为 private。 |
| SEC-02 | Storage 路径以用户、会话、批次和单张 ID 分段；访问须验证所有权并签发短期 URL。 |
| SEC-03 | Storage 删除只通过 Storage API；不得直接删除 `storage.objects` 数据行。 |
| SEC-04 | 公开业务表启用 RLS，并对 `authenticated` 使用最小权限显式 `GRANT`；service role 只在服务端 worker 使用。 |
| SEC-05 | provider 密钥、service role、备份凭证只存服务端 secret 管理，不进入客户端包或日志。 |
| SEC-06 | 上传校验 MIME、扩展名、文件头、大小和像素上限；拒绝 SVG 等主动内容格式。 |
| SEC-07 | 日志对提示词、URL、token、邮箱和 provider 响应脱敏；安全审计保留最小必要字段。 |
| SEC-08 | 删除与到期清理是可审计、可重试的状态机；UI 隐藏不等于物理删除完成。 |

### 6.2 运维与可靠性

| ID | 约束 |
| --- | --- |
| OPS-01 | 图片任务使用持久队列、可见性超时、幂等任务键和死信处理。 |
| OPS-02 | worker 状态迁移为 `pending → processing → succeeded\|failed`，只有可证明尚未提交 provider 的基础设施错误可自动重试。 |
| OPS-03 | provider 健康窗口持久化在 Postgres，按 US5-AC04 计算。 |
| OPS-04 | 会话删除采用 `deleting → 入队 → 清 checkpoint/对象/记录 → 物理删除`，失败保留任务并告警。 |
| OPS-05 | 原图成功 90 天后由 worker 经 Storage API 删除，并把记录标为 `expired`。 |
| OPS-06 | 生产使用 Supabase Pro 或更高方案的每日数据库备份，目标 RPO 不超过 24 小时。 |
| OPS-07 | 每日将两个 private bucket 的对象复制到独立 S3-compatible 备份目标；数据库备份不能替代该任务。 |
| OPS-08 | 每季度执行数据库与 Storage 联合恢复演练，记录证据并验证 RTO 不超过 4 小时。 |
| OPS-09 | Phase 1 使用 Sentry 收集错误、性能和告警；飞书、钉钉、PagerDuty 等外部告警通道推迟到 Phase 2。 |
| OPS-10 | 关键指标含 API QPS/成功率/错误率/P95、SSE 首块、队列等待、生成耗时/成功率/费用、配额 80% 阈值、死信、清理、signed URL 和备份状态。 |
| OPS-11 | 每个 PR 生成隔离预览；生产发布需人工提升且可回退到上一制品；数据库破坏性变更采用 expand/contract，不依赖高风险 down migration。 |
| OPS-12 | CI 执行 secret scanning、环境变量 schema、数据库类型/迁移漂移和权限测试；禁止只在控制台修改生产 schema。 |

## 7. 非目标与风险

### 7.1 Phase 1 非目标

| ID | Phase 1 非目标 |
| --- | --- |
| NG-01 | 原生 iOS、Android 或桌面客户端。 |
| NG-02 | 多人实时协作、评论、组织和复杂 RBAC。 |
| NG-03 | 自定义技能编辑器、技能市场和第三方技能执行。 |
| NG-04 | 跨设备匿名历史恢复；账号绑定留到 Phase 2。 |
| NG-05 | 图片在线精修、图层编辑和完整画布。 |
| NG-06 | 训练或微调自有基础模型。 |
| NG-07 | 自动切换到可能产生费用的图片 provider。 |
| NG-08 | 首页监控仪表盘及图表组件。 |
| NG-09 | 多区域主动容灾和低于 24 小时的 PITR 承诺。 |
| NG-10 | 飞书、钉钉、PagerDuty 等外部告警集成。 |
| NG-11 | 正式登录、注册、找回密码和 OAuth PKCE；Phase 1 仅匿名身份。 |
| NG-12 | 多类型套图的自动规划与批量编排。 |
| NG-13 | 视频生成、文档生成和通用 Canvas 工具。 |
| NG-14 | 4K 图片生成；Phase 1 上限为 2K。 |
| NG-15 | 积分、付费、订阅和短信验证码。 |
| NG-16 | 离线模式和 PWA。 |
| NG-17 | en-US 语言切换入口。 |
| NG-18 | 完整 WCAG 2.1 AA 认证；Phase 1 仍需保证关键操作键盘可达和基本可读性。 |

### 7.2 风险登记

| 风险/触发条件 | 影响 | 已批准缓解 |
| --- | --- | --- |
| Gemini 在目标网络 5 分钟错误率达到 30% | 图片能力受限 | 展示 warning 和 Seedream 备选；费用/能力差异确认后才提交。 |
| 任一技能周盲评低于 80% | 素材不可用 | 阻断该技能发布，调优模板并用同一固定集回归。 |
| 单匿名 UID 24 小时尝试超过 30 张或并发突增 | 成本滥用 | 原子配额、用户/IP 分层限速和队列容量保护。 |
| provider 内容安全固定集低于 95% | 合规风险 | 阻断发布，复盘审计样本；是否增加独立安全服务需另行决策。 |
| queue oldest age 达 critical | 交付延迟 | 限制新付费任务、扩 worker；聊天和历史读取继续服务。 |
| provider capability 与 adapter 漂移 | 参数错误或扣费风险 | schema 入仓、未知字段拒绝、依赖升级契约测试。 |
| 数据库或 Storage 恢复超过目标 | 数据丢失/长停机 | 每日双备份、季度联合演练和失败告警。 |

## 8. v1.3 需求追溯矩阵

规则：每个稳定 ID 恰好出现一次。`covered` 表示 Phase 1 有明确技术与架构落点；`deferred` 与 `non-goal` 是已确认的阶段边界，不是遗漏。技术决策号见 `tech-selection.md`，模块/数据流号见 `architecture.md`。

| 需求 ID | 技术决策 | 架构模块/数据流 | 最终状态 | v1.3 处理结果 |
| --- | --- | --- | --- | --- |
| SC-01 | TS-FE-01 | M01/F01 | covered | 单首页、单输入框 |
| SC-02 | TS-AI-03 | M07/F04 | covered | 三技能固定评测 |
| SC-03 | TS-API-01 | M05/F02 | covered | SSE 首块 SLO |
| SC-04 | TS-QUEUE-01 | M06/F03 | covered | 先持久化后返回 202 |
| SC-05 | TS-AI-04 | M08/F04 | covered | 安全准确率统一为 95% |
| SC-06 | TS-TEST-01 | M18 | covered | 前后端覆盖率门禁 70% |
| SC-07 | TS-TEST-02 | M18/F01 | covered | 三浏览器最近两版 |
| SC-08 | TS-OPS-03 | M17/F08 | covered | RPO 24h、RTO 4h |
| SC-09 | TS-QUEUE-02 | M12/F03 | covered | 持久队列与幂等消费 |
| SC-10 | TS-PERF-01 | M08/M12/M17/F03 | covered | 双 provider 2K P95 60 秒 |
| SC-11 | TS-QUOTA-01 | M10/M18/F03 | covered | 每日 30 张配额跑测 |
| SC-12 | TS-TEST-03 | M09/M10/M18/F01 | covered | 同浏览器恢复率 100% |
| SC-13 | TS-API-07 | M06/M18 | covered | 全失败分支 schema 验证 |
| SC-14 | TS-HEALTH-01 | M14/M18/F09 | covered | 告警误报/漏报回放 |
| SC-15 | TS-TEST-03 | M08/M18/F03 | covered | 双 provider 成功率回归 |
| US1-AC01 | TS-FE-01 | M01/F01 | covered | `/` 唯一工作区 |
| US1-AC02 | TS-FE-02 | M03/F01 | covered | 单一草稿、Enter 发送与 Shift+Enter 换行 |
| US1-AC03 | TS-API-01 | M02/F02 | covered | SSE 与完整消息持久化 |
| US1-AC04 | TS-FE-03 | M01/M02/F03 | covered | 会话骨架、竞态隔离与后台任务恢复 |
| US1-AC05 | TS-FE-03 | M02/F04 | covered | 统一生成卡片 |
| US1-AC06 | TS-FE-04 | M04/F01 | covered | 桌面点击浮层、窄屏兼容抽屉 |
| US1-AC07 | TS-FE-05 | M01/F01 | covered | 旧路径只重定向 |
| US1-AC08 | TS-FE-08 | M03/F02 | covered | 单一输入框按“创建图片”工具显式路由 |
| US1-AC09 | TS-FE-08 | M03/M07/F04 | covered | 图片工具保持选中且普通聊天不误触发 |
| US1-AC10 | TS-FE-10 | M02/F02 | covered | 受控标签只读折叠展示 |
| US1-AC11 | TS-FE-11 | M01/M02/F01 | covered | 智能跟随、手动暂停与回到底部 |
| US1-AC12 | TS-FE-12 | M02/M03/M04/F01 | covered | 即时图片骨架、无闪烁替换与原回合重试 |
| US2-AC01 | TS-IMG-01 | M03/F03 | covered | 1–4 张与双语提示词 |
| US2-AC02 | TS-IMG-02 | M04/F03 | covered | provider schema 驱动 |
| US2-AC03 | TS-API-02 | M06/F03 | covered | 统一 202 契约 |
| US2-AC04 | TS-QUEUE-03 | M12/F03 | covered | 单张状态机与部分成功 |
| US2-AC05 | TS-DATA-03 | M10/F03 | covered | `source` 持久化 |
| US2-AC06 | TS-API-03 | M06/F05 | covered | 三种 recreate 模式 |
| US2-AC07 | TS-QUEUE-04 | M12/F03 | covered | provider 提交后不自动重试 |
| US2-AC08 | TS-STORAGE-02 | M02/M13/F06 | covered | 会话图片统一预览与 private signed URL |
| US2-AC09 | TS-STORAGE-03 | M10/F07 | covered | 记录与原图生命周期分离 |
| US2-AC10 | TS-STORAGE-03 | M02/F07 | covered | 到期提示与原参数重生 |
| US2-AC11 | TS-IMG-03 | M03/M06/F03 | covered | 空提示词双端阻止 |
| US2-AC12 | TS-IMG-03 | M04/M08/F03 | covered | 五比例、1K/2K、默认 2K |
| US2-AC13 | TS-FE-09 | M03/M13/F03 | covered | 参考图格式/数量/大小 |
| US2-AC14 | TS-FE-09 | M03/M13/F03 | covered | 上传状态与重试 |
| US2-AC15 | TS-FE-09 | M04/F03 | covered | 首图初始化并可覆盖 |
| US2-AC16 | TS-FE-03 | M02/M13/F06 | covered | 生成卡片与安全下载 |
| US2-AC17 | TS-FE-09 | M02/M13/F06 | covered | 批量下载成功项 |
| US2-AC18 | TS-API-07 | M02/M17/F09 | covered | 脱敏错误复制 |
| US2-AC19 | TS-STORAGE-05 | M13/M15/F07 | covered | 上传 30 天到期与重传 |
| US3-AC01 | TS-AI-03 | M07/F01 | covered | 三个内置技能 |
| US3-AC02 | TS-AI-03 | M07 | covered | 服务端技能定义 |
| US3-AC03 | TS-FE-04 | M03/M04/F01 | covered | 快捷卡进生图，工具栏保持模式，共享 skillId |
| US3-AC04 | TS-AI-04 | M07/M08/F04 | covered | 不绕过校验 |
| US3-AC05 | TS-IMG-02 | M04/M07 | covered | 前后端兼容校验 |
| US3-AC06 | TS-DATA-04 | M07/M10 | covered | 记录技能版本 |
| US3-AC07 | TS-SCOPE-01 | M18 | non-goal | 自定义技能推迟 |
| US3-AC08 | TS-AI-03 | M04/M07/F01 | covered | 技能展示元数据 |
| US3-AC09 | TS-FE-09 | M04/M07/F01 | covered | 必填字段校验 |
| US3-AC10 | TS-FE-09 | M04/M07/F03 | covered | 可编辑提示词预览 |
| US3-AC11 | TS-FE-08 | M03/M07/F04 | covered | 技能强制启用不改写显式偏好 |
| US4-AC01 | TS-DATA-01 | M09/M11 | covered | session/thread 统一 |
| US4-AC02 | TS-FE-06 | M01/M09/F01 | covered | 会话侧栏 CRUD |
| US4-AC03 | TS-DATA-02 | M10/F02 | covered | 原子 sequence |
| US4-AC04 | TS-DATA-03 | M10/F03/F04 | covered | 两类生图均持久化 |
| US4-AC05 | TS-DELETE-01 | M09/M15/F05 | covered | 异步可靠删除 |
| US4-AC06 | TS-SEC-01 | M09/M13/F06 | covered | 所有权隔离 |
| US4-AC07 | TS-PERF-01 | M01/M18/F01 | covered | 50 会话渲染 200 ms |
| US5-AC01 | TS-AI-01 | M07/M08 | covered | 聊天/图片模型分选 |
| US5-AC02 | TS-AI-02 | M08/F03 | covered | 稳定 Gemini 模型与官方字段 |
| US5-AC03 | TS-HEALTH-01 | M14/F09 | covered | Postgres 共享窗口 |
| US5-AC04 | TS-HEALTH-01 | M14/F09 | covered | 阈值与最小样本统一 |
| US5-AC05 | TS-AI-05 | M04/M14/F09 | covered | 费用前置确认 |
| US5-AC06 | TS-DATA-03 | M02/M10 | covered | 历史 provider/model 不变 |
| US5-AC07 | TS-AI-06 | M05/M08/F02 | covered | Doubao/MiniMax 聊天双 provider |
| US6-AC01 | TS-AUTH-01 | M16/F01 | covered | Supabase 匿名身份 |
| US6-AC02 | TS-AUTH-01 | M09/M10/F01 | covered | 同浏览器恢复 |
| US6-AC03 | TS-AUTH-02 | M01/M16 | covered | UI 明示恢复边界 |
| US6-AC04 | TS-SCOPE-02 | M16 | deferred | 账号绑定 Phase 2 |
| US6-AC05 | TS-SEC-01 | M09/M10/M13 | covered | `auth.uid()` 所有权 |
| US7-AC01 | TS-OBS-01 | M02/M17/F09 | covered | 稳定错误码与脱敏 |
| US7-AC02 | TS-RETRY-01 | M05/F02 | covered | 首块前仅重试一次 |
| US7-AC03 | TS-QUOTA-01 | M06/M10/F03 | covered | 原子预占与释放 |
| US7-AC04 | TS-OBS-02 | M12/M15/M17/F09 | covered | Sentry 告警范围 |
| US7-AC05 | TS-API-07 | M02/M06/F09 | covered | 稳定错误码集合 |
| API-01 | TS-API-01 | M05/F02 | covered | SSE 聊天统一接口 |
| API-02 | TS-API-02 | M06/F03 | covered | 异步生图接口 |
| API-03 | TS-API-03 | M06/F05 | covered | 统一重生成接口 |
| API-04 | TS-API-04 | M06/F03 | covered | 批次查询 |
| API-05 | TS-API-05 | M09/F01 | covered | 会话集合接口 |
| API-06 | TS-API-05 | M09/M15/F05 | covered | 重命名与异步删除 |
| API-07 | TS-API-05 | M09/M10/F01 | covered | 时间线分页 |
| API-08 | TS-STORAGE-02 | M13/F06 | covered | 资产 URL 续签 |
| API-09 | TS-AI-03 | M07/F01 | covered | 技能查询 |
| API-10 | TS-HEALTH-01 | M14/F09 | covered | provider 健康查询 |
| API-11 | TS-QUOTA-01 | M10/F03 | covered | 配额查询 |
| API-12 | TS-API-06 | M06 | covered | 应用维护 OpenAPI |
| AI-01 | TS-AI-01 | M05/M11/F02 | covered | LangGraph 与 thread 统一 |
| AI-02 | TS-QUEUE-01 | M05/M12/F04 | covered | tool 只入队 |
| AI-03 | TS-TYPE-01 | M05/M08 | covered | schema 与类型守卫 |
| AI-04 | TS-AI-04 | M08/F03/F04 | covered | provider 安全网关与审计 |
| AI-05 | TS-AI-04 | M08/M18 | covered | 发布门禁 95% |
| AI-06 | TS-PRIVACY-01 | M10/M17 | covered | 不保存思维链 |
| AI-07 | TS-OBS-01 | M08/M17/F09 | covered | 超时、追踪、费用日志 |
| AI-08 | TS-RETRY-01 | M05/M12/F02/F03 | covered | 分场景重试 |
| CON-01 | TS-BASE-01 | M01/M06 | covered | Next.js 16/Turbopack/独立 lint |
| CON-02 | TS-FE-07 | M01/M09/M10 | covered | Zustand v5 仅管客户端状态 |
| CON-03 | TS-BASE-02 | M09/M12/M13/M16 | covered | Supabase 平台边界 |
| CON-04 | TS-QUEUE-01 | M06/M12 | covered | 无请求后后台工作 |
| CON-05 | TS-DB-01 | M10/M16 | covered | 迁移、显式 GRANT、RLS |
| CON-06 | TS-TYPE-01 | M01/M06 | covered | unknown + 守卫 |
| CON-07 | TS-AI-01 | M05/M11/F02 | covered | workflow/checkpointer 请求级创建 |
| CON-08 | TS-I18N-01 | M01/M18/F01 | covered | Phase 1 zh-CN |
| SEC-01 | TS-STORAGE-01 | M13/F06 | covered | 两 bucket 私有 |
| SEC-02 | TS-STORAGE-02 | M13/F06 | covered | 分层路径与 signed URL |
| SEC-03 | TS-STORAGE-04 | M13/M15/F05/F07 | covered | 只经 Storage API 删除 |
| SEC-04 | TS-SEC-01 | M09/M10/M16 | covered | 最小权限与 RLS |
| SEC-05 | TS-SEC-02 | M08/M12/M17 | covered | 服务端 secret |
| SEC-06 | TS-SEC-03 | M06/M13 | covered | 上传校验 |
| SEC-07 | TS-PRIVACY-01 | M17/F09 | covered | 日志脱敏 |
| SEC-08 | TS-DELETE-01 | M15/F05/F07 | covered | 可审计清理状态机 |
| OPS-01 | TS-QUEUE-02 | M12/F03 | covered | durable queue 与死信 |
| OPS-02 | TS-QUEUE-03 | M12/F03 | covered | 幂等状态迁移 |
| OPS-03 | TS-HEALTH-01 | M14/F09 | covered | 共享健康窗口 |
| OPS-04 | TS-DELETE-01 | M15/F05 | covered | 删除工作流 |
| OPS-05 | TS-STORAGE-03 | M15/F07 | covered | 90 天到期工作流 |
| OPS-06 | TS-OPS-03 | M17/F08 | covered | 每日数据库备份 |
| OPS-07 | TS-OPS-04 | M13/M17/F08 | covered | 独立 Storage 备份 |
| OPS-08 | TS-OPS-05 | M17/F08 | covered | 季度联合恢复演练 |
| OPS-09 | TS-OBS-02 | M17/F09 | covered | Phase 1 Sentry |
| OPS-10 | TS-OBS-03 | M17/F09 | covered | 关键指标集合 |
| OPS-11 | TS-OPS-06 | M17/M18/F08 | covered | 预览、人工提升与安全回滚 |
| OPS-12 | TS-OPS-07 | M16/M18 | covered | secret/env/migration/权限门禁 |
| NG-01 | TS-SCOPE-01 | M18 | non-goal | 仅 Web |
| NG-02 | TS-SCOPE-01 | M18 | non-goal | 不做多人协作/RBAC |
| NG-03 | TS-SCOPE-01 | M18 | non-goal | 不做技能平台 |
| NG-04 | TS-SCOPE-02 | M16 | non-goal | 匿名不跨设备 |
| NG-05 | TS-SCOPE-01 | M18 | non-goal | 不做在线精修画布 |
| NG-06 | TS-SCOPE-01 | M18 | non-goal | 不训练基础模型 |
| NG-07 | TS-AI-05 | M14 | non-goal | 不自动产生 provider 费用 |
| NG-08 | TS-SCOPE-01 | M18 | non-goal | 不做首页监控图表 |
| NG-09 | TS-OPS-03 | M17 | non-goal | 不承诺多区域/PITR |
| NG-10 | TS-SCOPE-03 | M17 | deferred | 外部告警 Phase 2 |
| NG-11 | TS-SCOPE-02 | M16 | deferred | 正式认证 Phase 2 |
| NG-12 | TS-SCOPE-04 | M18 | non-goal | 不做套图自动编排 |
| NG-13 | TS-SCOPE-04 | M18 | non-goal | 不做视频/文档/Canvas |
| NG-14 | TS-SCOPE-04 | M08/M18 | non-goal | Phase 1 不做 4K |
| NG-15 | TS-SCOPE-04 | M10/M18 | non-goal | 不做付费与短信 |
| NG-16 | TS-SCOPE-04 | M01/M18 | non-goal | 不做离线/PWA |
| NG-17 | TS-I18N-01 | M01/M18 | deferred | en-US Phase 2 |
| NG-18 | TS-SCOPE-04 | M18 | deferred | 完整无障碍认证 Phase 2 |

## 9. 零费内测与生产门禁

Phase 1C 零费内测前必须同时满足：

- Chromium、Edge、Playwright WebKit 的 mock 关键流程通过；不要求真实 Safari。
- 本地 HTTP 验收完成匿名恢复、跨用户拒绝、上传、Doubao/MiniMax、Seedream 三个单图场景、signed URL 与清理闭环。
- Web 与 Domain 的 branches/functions/lines/statements 均不低于 70%，并完成 moderation 故障注入和 Sentry 脱敏 replay。
- Gemini 保持 disabled；正常验收只生成 3 张 Seedream 图片，累计硬上限 5 张，未知提交结果不得自动重试。

以下条款是后续生产门禁，不属于零费内测完成声明：真实 Safari、1000 条/95% 安全集、Seedream/Gemini 各 n≥30 与 2K P95、Supabase Pro 自动每日数据库备份、独立 Storage 每日备份、数据库与 Storage 联合恢复、生产部署和回滚。

Phase 1 发布前必须同时满足：

- 矩阵中每个需求 ID 都有且只有一个已批准的最终状态。
- 首页聊天、直接生图、聊天工具生图、刷新恢复、删除、到期、配额和降级均完成契约测试。
- 通过 SSE 增量渲染、1–4 张排队、private URL 续签、队列故障、删除重试、90 天到期与三浏览器 E2E。
- 安全固定集达到 95%，前后端测试覆盖率达到 70%。
- 完成一次数据库与 Storage 联合恢复演练并满足 RPO/RTO。
