# ZImage 项目进度

本文件是 ZImage **唯一的当前交付进度事实源**。需求定义仍以 [`requirements.md`](./requirements.md) 为准；架构、技术选型和历史交付文档用于解释范围与保留审计证据，不代表当前任务已经完成。

## 审计基线

| 项目 | 当前值 |
| --- | --- |
| 审计日期 | 2026-08-26 |
| Git 基线 | `setup2@80db326d8c34` |
| 远端对齐 | 审计开始时与 `origin/setup2` 一致 |
| 工作区 | 审计开始时干净 |
| 审计边界 | 本地代码与自动化检查；Supabase、Vercel 只读复核；未修改数据库、云端开关或部署状态 |

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
| Phase 1A：统一工作区与 mock | `in_progress` | 核心实现、静态门禁和完整 Vitest 已闭环；覆盖率与隔离浏览器矩阵仍待闭环。 |
| Phase 1B：真实运行链路 | `blocked` | 主项目基础设施已落地，但恢复项目、真实图片链路、HTTP/RLS、Sentry、安全集和 Provider 证据未闭环。 |
| Phase 1C：发布验收 | `blocked` | 需求状态矩阵完成；CI、Preview、性能、Safari、备份和联合恢复等发布证据不足。 |
| Phase 2 | `todo` | 必须在 Phase 1C 全部必需任务 `done` 后重新立项。 |

## 任务账本

### Phase 1A：统一工作区与 mock

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1A-01 | 统一工作区与 mock | `in_progress` | 当前代码包含统一工作区与版本化 mock；2026-08-26 的 lint、typecheck、生产构建通过，`pnpm test:run` 为 Web 97/97、Domain 27/27。 | `pnpm test:coverage` 未通过：Web 的 `unified-workspace.test.tsx` 在覆盖率插桩下 10/20 失败，主要为 15/30 秒超时；修复后重新取得完整覆盖率与隔离 mock E2E 成功结果。 |
| P1A-02 | 浏览器矩阵 | `blocked` | Playwright 已配置 Chromium desktop、Edge tablet 和 WebKit mobile 三个 mock 项目。 | 2026-08-26 隔离运行因同目录已有 Next dev（PID 74688、端口 3000）占用单实例锁而未启动 3100 测试服务器；真实 Safari 验收仍缺失。不得占用或结束用户现有开发服务器。 |

### Phase 1B：真实运行链路

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1B-01 | 主项目迁移同步 | `done` | 2026-08-26 只读复核：本地与主 Supabase 项目均为 13 个迁移。 | 若本地迁移或主项目迁移历史发生变化，立即重新核验并按证据降级。 |
| P1B-02 | 恢复项目同步 | `blocked` | 2026-08-26 只读复核：恢复项目为 10 个迁移。 | 补齐 `generation_emergency_stop`、`modern_secret_key_scheduling`、`enabled_overrides_health`，运行当前 142 条 pgTAP，并验证生成类型一致。 |
| P1B-03 | 运行基础设施 | `in_progress` | 主项目存在 LangGraph 表、`uploads`/`generated` 两个私有 bucket、`generation-worker`/`cleanup-worker` 两个 ACTIVE Worker；generation/cleanup Cron 最近运行成功。 | 仍需与真实图片、清理、告警和恢复链路联合验收；单项资源存在不等于运行闭环。 |
| P1B-04 | 匿名身份与聊天 | `in_progress` | 2026-08-26 只读复核：16 个匿名用户、3 个会话、13 条时间线消息。 | 缺当前 HTTP E2E、跨用户 RLS 隔离和完整恢复证据。 |
| P1B-05 | 图片生成与 Storage | `blocked` | 生成和上传运行开关已启用；相关 bucket 为私有。当前 generation、reference upload 和 Storage object 均为 0；Seedream 最新仅 2 个样本且状态为 warning。 | 先确认费用授权与硬上限，再完成上传、排队、生成、signed URL、清理和恢复闭环。 |
| P1B-06 | Sentry、安全与 Provider 验收 | `blocked` | 当前无足以关闭任务的真实环境证据。 | 补齐脱敏 Sentry replay、1000 条安全集，以及每个 Provider 30 个样本的验收闭环。 |

### Phase 1C：发布验收

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1C-01 | 需求状态矩阵 | `done` | 145 个需求 ID 均已归入 `covered`、`deferred` 或 `non-goal`；当前统计为 125 / 5 / 15。 | 需求或映射变化时重新审核；`covered` 不自动提升其他交付任务状态。 |
| P1C-02 | 覆盖率、CI、性能、Safari、备份和发布 | `blocked` | 本地 lint、typecheck、普通 Vitest 和生产构建通过；2026-08-26 只读复核未发现 Vercel 项目。 | 当前 Web 覆盖率命令失败；同时缺远端 CI、Vercel Preview、性能、真实 Safari、备份、联合恢复和生产证据。 |

### Phase 2

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P2-00 | 重新立项 | `todo` | 当前没有已批准的 Phase 2 交付范围。 | Phase 1C 全部必需任务 `done` 后再讨论目标、需求、架构和验收计划。 |

## 高优先级风险

> **费用与授权风险：** 主 Supabase 项目当前已启用 generation、Seedream 和 generation Cron，但尚无图片成功样本。在继续任何真实图片调用前，必须由有权限的负责人确认费用授权、可核验的硬上限和紧急停止路径。确认前 P1B-05 保持 `blocked`。

## 下一阶段执行顺序

1. 核验 generation / Seedream 的费用授权与硬限制。
2. 补齐 restore 项目最后 3 个迁移，运行当前 142 条 pgTAP，并验证生成类型一致。
3. 完成真实图片上传、排队、生成、signed URL、清理和恢复闭环。
4. 创建 Vercel Preview，运行 HTTP / RLS E2E 和 Sentry 脱敏 replay。
5. 完成 Provider 样本、安全集、性能、Safari、备份与联合恢复后关闭 Phase 1C。
6. Phase 1C 全部 `done` 后再讨论 Phase 2。

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
