# ZImage 项目进度

本文件是 ZImage **唯一的当前交付进度事实源**。需求定义仍以 [`requirements.md`](./requirements.md) 为准；架构、技术选型和历史交付文档用于解释范围与保留审计证据，不代表当前任务已经完成。

## 审计基线

| 项目 | 当前值 |
| --- | --- |
| 审计日期 | 2026-08-27 |
| Git 基线 | `setup2@64eab6d874a6` |
| 远端对齐 | 本轮不以远端分支或部署状态作为验收前提 |
| 工作区 | 基线干净；本文件与同批实现变更尚未提交 |
| 审计边界 | 本地代码、自动化检查、主/恢复 Supabase 受控写入与现有免费 Provider 验收；不操作 Vercel、不测试真实 Safari、不创建阿里云资源、不升级或充值 |

## 状态与 Done 定义

| 状态 | 定义 |
| --- | --- |
| `todo` | 尚未开始，或仅完成范围确认、没有可验证交付物。 |
| `in_progress` | 已有实现或部分证据，但仍缺少必需验收。 |
| `blocked` | 已有明确前置条件、授权或环境证据缺口，当前不能安全闭环。 |
| `done` | 当前代码、必需自动化验证，以及适用的真实环境证据均已闭环。 |

执行规则：

- 阶段仅在该阶段全部必需任务均为 `done` 后才能标记 `done`。
- 需求矩阵中的 `covered` 只说明需求与实现/验证项建立了映射，不能据此推断交付任务为 `done`。
- 提交标题、已有实现、一次历史测试或本地 mock 结果均不能单独作为 `done` 证据。
- 当代码变化、自动化结果过期、环境漂移或真实证据失效时，状态必须从 `done` 降级。
- 完成任务验收的同一批变更必须同步更新本文件，记录日期、验证命令和适用的真实环境证据。

## 阶段汇总

| 阶段 | 状态 | 当前结论 |
| --- | --- | --- |
| Phase 1A：统一工作区与 mock | `done` | 2026-08-27 静态检查、98/98 Web 与 27/27 Domain Vitest、四项覆盖率 ≥70%、Chromium/Edge/Playwright WebKit mock E2E 全部闭环。 |
| Phase 1B：真实运行链路 | `done` | 2026-08-28 恢复项目迁移、142 条 pgTAP、HTTP/RLS、Doubao、MiniMax 工具路径、Seedream 三单图及 Sentry 三端脱敏事件全部闭环。Free 联合恢复已按用户决定从本阶段移除。 |
| Phase 1C：零费内测门禁 | `done` | 2026-08-28 需求矩阵、全部零费链路、最终回归、临时入口撤销和测试产物检查完成；此状态不代表生产就绪。 |
| Phase 2 | `todo` | 必须在 Phase 1C 全部必需任务 `done` 后重新立项。 |

## 阶段结束判定与剩余工期

| 阶段 | 结束判定 | 当前剩余开发量 |
| --- | --- | --- |
| Phase 1A | lint、typecheck、普通 Vitest、Web/Domain 四项覆盖率均 ≥70%、Chromium/Edge/Playwright WebKit mock E2E 全绿，且测试产物可清理。 | 已完成；无剩余开发。 |
| Phase 1B | 主/恢复项目均为 13 个迁移，8 套/142 条 pgTAP 与生成类型一致；本地真实 HTTP 身份、RLS、上传、Doubao、MiniMax 工具、Seedream 三单图、signed URL 与 cleanup 通过；moderation 与 Sentry 三端脱敏事件通过。Free 联合恢复不属于本阶段。 | 已完成；无剩余开发。 |
| Phase 1C：零费内测 | Phase 1A/1B 均完成，最终证据账本、环境开关、临时诊断入口撤销、工作区与测试产物检查通过。 | 已完成；无剩余开发。 |
| 后续生产门禁 | 真实 Safari、Gemini、1000 条/95% 安全集、双图片 Provider 各 30 次及 P95、Supabase Pro 自动备份、每日独立对象备份、生产部署与回滚全部取得证据。 | 不属于本轮；需在阿里云部署方案确定后另行估算。 |

## 任务账本

### Phase 1A：统一工作区与 mock

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1A-01 | 统一工作区与 mock | `done` | 2026-08-27：测试 Gateway 注入立即完成 delay，生产 mock 的 180/700/900ms 语义未改；`pnpm test:run` 为 Web 98/98、Domain 27/27；`unified-workspace.test.tsx` 为 20/20。Web 覆盖率 89.75/85.64/76.30/89.75，Domain 为 95.83/82.60/72.72/95.83（statements/branches/functions/lines）。 | 代码或测试基线变化时重新运行全部门禁。 |
| P1A-02 | 浏览器矩阵 | `done` | 2026-08-27 `pnpm e2e`：Chromium desktop、Edge tablet、Playwright WebKit mobile 共 15 passed，6 个桌面专属用例按设计跳过。 | 真实 Safari 已移入后续生产门禁，不影响本轮状态。 |

### Phase 1B：真实运行链路

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1B-01 | 主项目迁移同步 | `done` | 2026-08-26 只读复核：本地与主 Supabase 项目均为 13 个迁移。 | 若本地迁移或主项目迁移历史发生变化，立即重新核验并按证据降级。 |
| P1B-02 | 恢复项目同步 | `done` | 2026-08-27 仅向恢复项目依次应用仓库已有的 3 个迁移；主/恢复项目均为 13 个迁移。恢复项目 8 套 pgTAP 共 142 条断言全绿；两项目实时生成类型字节一致，仓库类型仅同步 PostgREST 14.17 版本标记。两项目 Advisor 均无 ERROR，WARN 已按暴露面记录。 | 迁移或项目配置漂移时重新核验；本项不等于联合恢复演练完成。 |
| P1B-03 | 运行基础设施 | `done` | 主项目存在 LangGraph 表、`uploads`/`generated` 两个私有 bucket、`generation-worker`/`cleanup-worker` 两个 ACTIVE Worker；generation/cleanup Cron 最近运行成功。真实图片、Storage cleanup 与 Sentry Edge helper 已分别由 P1B-05/06 完成联合验收；`cleanup-worker v14 ACTIVE`。 | Worker、Cron、Vault/Edge Secret 或 Provider 开关变化时重新核验。 |
| P1B-04 | 匿名身份与聊天 | `done` | 2026-08-27 本地生产模式 HTTP：匿名身份建立/刷新、第二身份跨用户读取与重命名拒绝、1×1 PNG 上传所有权/MIME/尺寸、Doubao 短 SSE 首块/完成/持久化/清理均通过；另取得一次真实 MiniMax 普通聊天响应。 | 身份、RLS 或聊天路由变化时重新验收。 |
| P1B-05 | 图片生成与 Storage | `done` | 2026-08-27 真实 Seedream：MiniMax 显式工具 `source=chat_tool`、直接无参考图、直接带 16×16 受控 PNG 三个单图场景成功；均验证批次/active 资产/signed URL/所有权拒绝/刷新恢复与 cleanup。累计硬上限 5/5：1 次明确未提交、3 张成功、1 次因 1×1 参考图不满足 Provider 最小边长而明确失败；未发生未知结果重试。结束后验收会话、批次、生成、Storage 对象和待处理 cleanup 均为 0。 | 真实图片预算已封顶，本轮禁止再调用；双图片 Provider 各 30 次及 P95 属后续生产门禁。 |
| P1B-06 | 安全与脱敏 | `done` | 2026-08-28 Provider moderation 归一化与原始 prompt/URL/token 不泄漏测试通过。Sentry Developer Free 三端真实事件通过：浏览器 `87022e71135d446e91b11a72452eaf72` / `16b6d502-ae83-44fb-a29b-45eca4bfb98e`，Next 服务端 `d387fa02d7534a54b51f766e94e5ac44` / `41a9db0f-6577-4d3e-b7f4-2e9fab90e3e9`，Edge helper `52f32dc230a5490d88e4a8aaac952cd1` / `b5352834-4ff3-41a6-a718-4ffbf607513e`（event ID / correlation ID）。三者均验证统一脱敏正文、无原始诊断文本、请求、身份或 Geo；组织级 IP/`user.geo` 清理开启，应用与 Edge 使用不可定位地址阻断 Relay 自动推导。临时入口已删除，云端 `cleanup-worker v14 ACTIVE` 且无诊断分支。 | 1000 条/95% 安全集属于后续生产门禁；Sentry 项目/组织清理规则或 DSN 变化时重新验收。 |

### Phase 1C：零费内测门禁

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1C-01 | 需求状态矩阵 | `done` | 147 个需求 ID 均已归入 `covered`、`deferred` 或 `non-goal`；当前统计为 127 / 5 / 15。 | 需求或映射变化时重新审核；`covered` 不自动提升其他交付任务状态。 |
| P1C-02 | 零费内测证据收口 | `done` | 2026-08-28 本地 lint、typecheck、普通 Vitest、覆盖率、生产构建、三引擎 mock E2E、真实 HTTP/Provider 链路及 Sentry 三端脱敏事件已取得证据；诊断入口已撤销，最终构建路由与测试产物检查通过，不依赖 Vercel 或真实 Safari。 | 代码、云端配置或验收口径变化时重新运行对应门禁。 |

### 后续生产门禁（不计入 Phase 1A/1B 完成）

| ID | 门禁 | 状态 | 完成条件 |
| --- | --- | --- | --- |
| PROD-01 | 浏览器与安全规模证据 | `todo` | 真实 Safari、Gemini、1000 条安全集且准确率 ≥95%、双图片 Provider 各 30 次及 P95。 |
| PROD-02 | 备份、恢复与发布 | `todo` | Supabase Pro 自动备份、每日独立对象备份、数据库与 Storage 联合恢复、阿里云 ECS/Docker/TLS/反向代理、生产发布与回滚演练。Free 项目联合恢复不作为零费内测门禁。 |

### Phase 2

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P2-00 | 重新立项 | `todo` | 当前没有已批准的 Phase 2 交付范围。 | Phase 1C 全部必需任务 `done` 后再讨论目标、需求、架构和验收计划。 |

### 2026-08-29 Web 统一会话与图片交互改造

- 会话体验：Web 按 `sessionId` 隔离时间线加载、流式回复、临时生图回合和 busy 状态；切换即时高亮并展示消息骨架，失败可原位重试，慢请求不能覆盖当前会话，后台任务在侧栏保留进行中标记。
- 统一输入：移除聊天/生图双模式，单一输入框默认聊天；启用“创建图片”或图片技能后展示参考图与图片设置并调用既有图片接口；Enter 发送、Shift+Enter 换行，输入法合成期间不误发送。
- 会话式生图：提交后立即展示用户提示词和按数量、比例生成的骨架；入队成功无闪烁替换为真实批次并立即恢复输入，失败在原回合重试；直接生图和历史工具生图不重复提示词。
- 图片预览：生成图、助手 Markdown 图片和输入框参考图统一使用 Lobe UI 图片查看器，技能封面不进入会话预览组；保留原有 URL 安全、签名 URL、过期状态和对象 URL 回收规则。
- 范围：本次仅修改和验证 `apps/web` 及对应 Web 说明；未修改或验证 Supabase、Edge Functions、数据库、Provider、共享领域包和其他客户端，也未调用真实图片 Provider 或部署环境。
- 自动化：`pnpm exec eslint apps/web --max-warnings=0`、Web typecheck、Web 生产构建均通过；Web Vitest 20/20 个文件、126/126 个测试通过；Playwright 在 Chromium 桌面、Edge 平板和 Chromium 移动视口下 22 passed / 8 个按设备条件跳过。移动 Web 使用 Chromium 项目，避开当前本机 Playwright WebKit 与 macOS 浏览器二进制的协议不兼容；不据此声明 Safari 或其他客户端已验证。

### 2026-08-28 聊天生图与单图重建缺陷修复

- 实现：初始化时从健康状态非 `unavailable` 的图片 Provider 中选择首项；聊天图片工具只在明确出图意图时预检图片 Provider，普通聊天仍只受聊天 Provider 约束；时间线单图重建完整透传 `generationId`；HTTP Gateway 不再显示 Mock 场景控件。
- 浏览器验收额外发现并修复：`recreate_image_generation` RPC 已成功创建批次后，严格公开响应 schema 因内部 `deduplicated` 字段返回 400；现统一摘取 `{ batchId, sessionId, status }`，未修改数据库、迁移或公开 API schema。
- 自动化：`pnpm lint`、`pnpm typecheck`、`pnpm test:run`、`pnpm build`、`pnpm e2e` 均退出码 0；Web Vitest 108/108、Domain Vitest 27/27；Playwright 15 passed / 6 个按设备条件跳过。
- 内部浏览器（`http://localhost:3000`，HTTP 模式）：Mock 控件计数为 0；聊天工具请求携带 `imageProvider=seedream` 并生成 1 张 `seedream-4.5` 图片；普通聊天前后图片批次卡片保持 4→4；单图重建请求携带具体 `generationId` 且返回 HTTP 202；控制台 error 为 0。Gemini 未进行真实调用，既有 Next Image LCP 警告按范围保留。
- 验收副作用：原计划最多新增 2 个真实 Seedream 任务；第一次单图重建的 HTTP 400 发生在数据库已写入批次之后，修复后重试又创建一批，因此本轮实际新增 3 个成功任务，额度显示由 29 降至 26。未擅自删除这些验收数据，后续禁止继续调用图片 Provider。

## 高优先级风险

> **费用硬停止：** 2026-08-28 用户批准的缺陷验收已结束；因一次“数据库成功、HTTP 响应序列化失败”的隐藏写入，本轮实际新增 3 个 Seedream 成功任务，额度由 29 降至 26。后续不得继续调用 Seedream 或新增图片 Provider；Gemini 必须保持 disabled。

## 下一阶段执行顺序

1. Phase 1A、Phase 1B 与零费 Phase 1C 已完成；后续代码或云端配置变化时按对应门禁复验。
2. 阿里云 ECS、Docker、TLS、反向代理、生产联合恢复与回滚另立计划。
3. Phase 2 可以重新立项，但不得把后续生产门禁误报为已完成。

## 2026-08-27 零费内测证据快照

- 本地门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test:run`、`pnpm test:coverage`、`pnpm build` 均退出码 0；Web 98/98、Domain 27/27，四项覆盖率均 ≥70%。
- 浏览器：`pnpm e2e` 在 Chromium desktop、Edge tablet、Playwright WebKit mobile 上 15 passed / 6 skipped；不要求真实 Safari。
- Worker/Provider：图片 Provider adapter 9/9，Chat adapter 与 Edge 依赖 9/9；moderation 归一化与脱敏用例通过。
- Supabase：主/恢复项目均 13 个迁移；恢复项目 8 套/142 条 pgTAP 全绿；实时类型字节一致；Advisor 无 ERROR。
- 真实 HTTP：身份/RLS、1×1 上传、Doubao SSE、MiniMax 普通聊天与显式工具路径、Seedream 三个单图场景取得证据；所有验收实体与 Storage 对象清理为 0。
- 2026-08-28 Sentry 三端真实脱敏事件已通过，事件 ID 与 correlation ID 见 P1B-06；临时本地/Edge 诊断入口均已撤销。
- 2026-08-28 用户决定从零费内测范围移除 Free 联合恢复；未安装 Docker/`pg_dump`、未配置恢复项目服务端密钥不再阻塞 Phase 1B/1C，但不得据此声明生产恢复、RTO 或 RPO 已验证。
- 2026-08-28 永久代码回归：`pnpm lint`、`pnpm typecheck`、`pnpm build` 均退出码 0；最终路由清单无诊断入口；Web 99/99、Domain 27/27 Vitest 全绿。

## 2026-08-26 证据快照

以下是本次账本初始化使用的快照，不替代后续任务自己的验收记录。

### 本地仓库

- Git：`setup2@80db326d8c34`，审计开始时与 `origin/setup2` 一致且工作区干净。
- 代码清单：13 个数据库迁移、13 个 API route、Web 97 条 Vitest、Domain 27 条 Vitest、142 条 pgTAP 断言。
- 2026-08-26 本次实现验证：`pnpm lint`、`pnpm typecheck`、`pnpm test:run` 和 `pnpm build` 退出码为 0；普通 Vitest 为 Web 97/97、Domain 27/27。
- `pnpm test:coverage` 退出码为 1：Domain 27/27 通过且语句/行覆盖率为 95.83%；Web 为 87/97，通过前 17 个文件，`unified-workspace.test.tsx` 在覆盖率插桩下 10/20 失败，主要原因是测试超时。因此没有形成完整 Web 覆盖率结果。
- `pnpm e2e` 退出码为 1：Playwright 的 3100 mock 服务器因同目录已有 Next dev（PID 74688、端口 3000）占用单实例锁而无法启动；未结束用户现有服务器，也未形成浏览器测试结果。
- 当前没有任何被 Vitest、Playwright、pgTAP 或 CI 发现机制使用的测试文件符合删除条件。

### Supabase（只读复核）

- 主项目 `image-web` 为 13 个迁移；恢复项目 `image-web-restore-drill` 为 10 个迁移，落后 3 个。
- 主项目存在 LangGraph 表、两个私有 bucket、两个 ACTIVE Edge Worker 和两个最近成功的 Cron。
- 匿名用户 16 个、会话 3 个、时间线消息 13 条；generation batch、generation、reference upload 和相关 Storage object 均为 0。
- Provider 健康样本不足：Doubao 1 个、MiniMax 1 个、Seedream 2 个且包含错误，不能作为 Provider 验收完成证据。

### Vercel 与外部验收（只读复核）

- 当前团队下未发现 Vercel 项目，因此 Preview 和远端发布验收保持 `blocked`。
- 本次审计未取得可关闭任务的 Sentry replay、真实 Safari、远端 CI、性能、备份或联合恢复证据。

## 历史证据索引

以下文件继续保留为范围、设计或历史交付证据；当前状态以本文件为准。

- 产品与技术边界：[`requirements.md`](./requirements.md)、[`tech-selection.md`](./tech-selection.md)、[`architecture.md`](./architecture.md)
- Phase 1 运维入口：[`delivery/phase1/operations-runbook.md`](./delivery/phase1/operations-runbook.md)
- Phase 1 历史快照：[`project-survey.md`](./delivery/phase1/project-survey.md)、[`technical-design.md`](./delivery/phase1/technical-design.md)、[`review.md`](./delivery/phase1/review.md)、[`verification-report.md`](./delivery/phase1/verification-report.md)、[`change-log.md`](./delivery/phase1/change-log.md)
- 已批准实施计划：[`2026-08-24-phase1-web.md`](../docs/superpowers/plans/2026-08-24-phase1-web.md)

## 维护要求

- 任务证据闭环时，在同一批变更中更新任务状态、验证日期、命令/运行记录和适用的真实环境证据。
- 阻塞项解除后先完成验收，再将 `blocked` 改为 `in_progress` 或 `done`；不得只因开始工作而移除阻塞记录。
- 保留历史交付记录用于审计，不在历史文档中维护“当前状态”。发现历史描述与运行现状冲突时，以本文件和最新可复核证据为准。
- 不从需求覆盖率、提交标题、文件存在、资源存在或旧报告推断 `done`。
