# 电商生图 Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development; execute and review each task without waiting for another development approval.

**Goal:** 实现已批准 v0.2 的电商场景入口、同工作台方案确认、逐图执行与可恢复交付，并修复审查发现的底层可靠性问题。

**Architecture:** 领域 schema/模板/纯函数编译统一 mock 与 HTTP；服务端保存不可变方案和执行组，数据库事务复用 count=1 批次；所有向导和旧 Skill 在唯一 `/` 工作台内执行。现有 Worker 负责模型调用，增加租约、结果登记与补偿清理。

**Tech Stack:** 仓库锁定 Next/React/TypeScript/Zod/Zustand/Supabase/PGMQ，Node 24.19.0、pnpm 11.19.0。

**Spec:** `doc/research/senyu-zimage/zimage-commerce-prd.md`、`zimage-commerce-technical.md`、`critical-review.md`（D01–D11）。

## Global Constraints

- 只做图片；淘宝、抖音、小红书；复用现有模型。无收费调用、线上迁移、发布或私人数据删除。
- `/create` 公开目录，`/` 唯一执行工作台；原三个 Skill 统一先方案后确认。
- 1–8 slot，每次 Provider 子批次 count=1；最多四张 PNG/JPEG/WebP 参考图，每张 10MB。
- 销售主图/套图/详情图必须真实商品引用；AI 整图文字，改字重生成。
- 默认采用新成功图，可切旧图；导出固定 slot/generation 清单。旧在途结果不能覆盖新版选择。
- 手填可完成整个流程。未验证的视觉分析不开放；模板只用原创内容，明确模型效果待验。
- 保留上轮未提交研究文档；在当前 `codex/phase2` 分支完成，不重置工作区、不自动提交或发布。

## Task 1: 执行与清理可靠性

**Files:** 新增 Supabase reliability migration；修改 `supabase/functions/generation-worker/index.ts`、`cleanup-worker/index.ts`；新增数据库/Worker 故障回归。
**Interfaces:** 保持已有 submit/complete RPC 兼容，新增 claim token、lease renewal、result checkpoint 与 cleanup compensation 的受限服务调用。原有 quota reserve/settle/release 语义不改变。

- [x] RED：覆盖删会话后额度保留、120s 后合法执行、Storage 成功后落库失败、在途删除、账号清理领取后崩溃。
- [x] 迁移将额度账本与内容级联删除分离；记录不可变目标/业务标识。账号清理增加过期重领。
- [x] Worker 领取带租约版本，周期续租；超时先核对，不盲目重发；持久保存已知结果路径并幂等补写完成。
- [x] 对象写入先登记；删除与在途写入协调，提交被拒绝安排持久化补偿删除；清理器幂等。
- [x] GREEN：运行聚焦故障测试和 SQL 权限检查，记录实际可用环境，交独立审查。

Required regression shape:
```ts
await worker.run(claim);
expect(provider.calls).toBe(1);
await worker.recoverAfterCompletionWriteFailure(claim);
expect(provider.calls).toBe(1);
expect(await assets.forGeneration(claim.generationId)).toHaveLength(1);
```
该段为测试场景说明；具体夹具使用实现所提供的依赖注入 Worker，不创建虚假的仅测 mock 行为断言。

## Task 2: 领域、模板与规划

**Files:** 新建 `packages/domain/src/commerce.ts`、`commerce-templates.ts`、领域测试；导出 index；定义 `CommerceGateway` 并接入 WorkspaceGateway。
**Interfaces:** `CommerceTask` 包含 id/sessionId/scene/revision/brief/slots/runs/selections；`CommerceSlot` 包含稳定 id、role、prompt、exactText、referenceIds 和模型参数。网关 create/list/get/save/submit/select/export/ref 上传均返回 schema 校验结果。

- [x] RED：商品资料缺失一次仅一个问题；不同场景角色；合法 1–8；模型参数不兼容拒绝；模板不编造规格。
- [x] 建立六类场景（主图、套图、详情、种草、参考风格、现有模特）和十二个原创模板；区分商品与风格引用。
- [x] 编译函数按商品事实优先，生成不可变逐图 prompt；修改目标仅更新对应 slot，讨论不触发执行。
- [x] GREEN：确定性编译、引用限制、版本/选图规则测试。

```ts
expect(nextCommerceQuestion({ name: '', referenceIds: [] }, 'product-set')).toBeTruthy();
expect(buildCommerceSlots(brief, 'product-set', 5, settings)).toHaveLength(5);
```

## Task 3: 持久化与原子执行

**Files:** 新 commerce migration；`apps/web/server/commerce/`；`app/api/creative-tasks/`、`creative-templates/`；HTTP/mock commerce gateways。
**Consumes:** Task 2 schema/编译与 Task 1 底座；事务调用现有内部 submit_image_batch，不循环 HTTP 请求。
**Produces:** 服务端任务恢复、乐观锁修订、请求幂等、整个执行组原子入队、当前选图与导出快照。

- [x] RED：同 key 异内容冲突、旧 revision 冲突、跨账号/会话引用拒绝、第 N 张失败全回滚、并发确认不重复。
- [x] 建表/受限 RPC/RLS 与 task revision/run item/selection/export 关联；服务端解析可信模板，不信任客户端 prompt。
- [x] 新请求身份/所有权→幂等查找→锁→验证引用与参数→原子创建子批次；每日与 preview guard 不可旁路。
- [x] 保存选择版本与兼容哈希；默认采用新成功图，迟到结果加入历史；失败保留旧图；导出冻结顺序映射。
- [x] GREEN：Store/service 与 mock/HTTP 契约测试、数据库事务测试。

```ts
const run = await gateway.submit({taskId, revision, slotIds, requestId});
expect(await gateway.submit({taskId, revision, slotIds, requestId})).toEqual(run);
```

## Task 4: 统一入口与工作台

**Files:** `app/create/page.tsx`；`features/commerce/` 向导/任务卡/hooks/CSS；`UnifiedWorkspace.tsx`、导航、旧 Skill 内容及触发入口。
**Consumes:** CommerceGateway；UI 状态仅表单，已保存方案与执行来自服务端/mock事实源。

- [x] RED：普通讨论零生图、旧 Skill 发送形成草案、确认生成、刷新恢复、单图重做后全套完整。
- [x] 新入口展示场景、平台、输入/产物边界；链接参数不包含商品数据。登录返回场景；桌面/移动均可发现。
- [x] 三步资料/风格结构/分图方案，引用上传共享原规则；只显示一个关键缺项；可选部分生成。
- [x] 任务聚合卡轮询恢复，逐图状态、改字/目标对话修改、旧图切换、集合下载；子批次不重复顶层展示。
- [x] 普通输入讨论保持聊天，所有 Skill 在方案中确认；通用明确生图保留直接入口。
- [x] GREEN：组件与浏览器真实交互，窄屏、失败、并发/刷新关键路径。

## Task 5: 正式文档与验收

**Files:** `doc/requirements.md`、`architecture.md`、`tech-selection.md`、`project-progress.md`；新增流程 E2E。

- [x] 正式纳入 D08–D11，修订旧 Skill 发送授权与动作数标准；架构记录实际选择，研究快照保留。
- [x] 运行 lint/typecheck/domain+web tests/build/mock E2E；数据库/Worker 与隔离 HTTP 测试按本地环境分别记录。
- [x] 独立审查全 diff 并修复有效问题；不因 mock 通过宣称云端迁移或真实图片效果通过。
- [x] 保留可审阅改动和完整结果，标记尚需真实 Provider 评测与上线操作的边界。

## Execution ledger

- Setup: bundled Node/pnpm exactly match declared toolchain; installing locked dependencies. Prior dirty changes are solely approved research documents.
- Ruling: work in current non-main feature branch to keep user's current project reviewable; no new worktree, git reset, commit, remote mutations or paid calls.
- Preflight: T1 owns Worker/reliability migration; T2 owns domain; T3 owns commerce migration/API/gateways; T4 owns UI; T5 docs/tests. T1/T3 share only existing submit RPC signature, which remains compatible. T2/T3/T4 share CommerceGateway and schema, established in T2 before consumers. T4/T5 old Skill tests intentionally change to D08. Scope agrees with v0.2; optional vision disabled until real capability evidence.

- Task 2 implemented: domain schema, six scenes/twelve original templates, compiler, one-question guard and targeted edits; 23 focused domain checks passed. Broader review pending.
- Task 3 in progress: TS routes/services and mock/HTTP gateways implemented; SQL atomic persistence delegated separately. Initial 5 mock workflow tests + 26 selected compatibility tests passed.
- Task 1 delegated Tesla; Task 4 delegated Locke; Task 5 formal docs delegated Mencius; commerce SQL delegated Boole. Disjoint write sets, no subagents of subagents, no commits.


- Review closeout: reliability R1–R4、commerce CS1–CS3、UI 7 项、reference 2 项、integration 6 项已独立复核关闭；Mock 后续写入隔离与子类转发问题已修复，最后三个真实复现测试也由审查者复验通过。
- Native gate remains open: completed checkboxes above denote implementation plus available local tests, not real PostgreSQL/Storage/Provider acceptance. 29 two-connection assertions remain skipped; full platform readiness is not claimed.
- Final verification evidence is consolidated in [验证记录](./2026-09-08-commerce-validation.md); project delivery status remains in [项目进度](../project-progress.md).
- Local closeout: lint/typecheck/build passed; Domain 40, Web 308 across full run plus corrected fixture-file replay, Worker/Provider 31, PGlite 293 + 4 passed / 29 concurrency skipped. Final complete browser run: 53 passed / 25 conditional skipped. No remote migration, paid generation, deployment or Git commit.
