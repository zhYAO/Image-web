# A+ 整套报价与父订单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 图片分析、用户确认、策划及自选张数出图归于一次报价与父订单，成本加价100%，最低0.5积分；成本及加价独立配置。

**Architecture:** 纯领域报价使用整数高精度成本，服务端保存不可变版本和报价快照。父订单一次冻结，阶段结果持久恢复，最终扣款及释放差额；真实入口在结算政策及成本配置未确认时关闭。

**Tech Stack:** TypeScript/Zod/Vitest/PostgreSQL, existing Supabase service-only RPC and generation journal.

**Spec:** doc/requirements.md, 2026-11-05用户授权及本计划约束。

## Global Constraints
- 原分支，不提交、推送、发布或执行生产迁移，不调用付费模型。
- 保留用户 next-env.d.ts、历史账务、MiniMax历史恢复和原生图链路。
- 1积分=1元；成本加价100%=售价成本×2，独立可配；最低整套50Minor。
- 套餐摊销价不能默认成为生产实际成本；没有明确版本配置不可报价/扣费。
- 固定价/按实与退款规则待交互卡确认，未确认不得启用。

## Review Focus
- 跨用户/会话/过期或角色变化的图片不能沿用旧授权。
- 重复请求与并发结算不能重复调用、扣款或退还。
- provider结果未知/存储失败不能自动重发或承诺退款。
- 新费率不重算已接受订单，旧普通生成和账务保持兼容。
- 部分成功及成本超过授权不得静默追扣，资料或模块改变需新授权。

### Task 1: 高精度成本与报价快照
**Files:** packages/domain/src/commerce-package-pricing.ts, packages/domain/tests/commerce-package-pricing.test.ts, packages/domain/src/index.ts
**Interfaces:** buildCommercePackageQuote(config,input) returns immutable serializable quote with outputCount,totalMinor,stages; config carries separate cost/sale versions.
- [x] 先写成本×2、最低50、N与双端张数、参考图输入成本、token上限、高精度取整、配置/输入拒绝测试并观察红。
- [x] 实现纯报价和明细分配，测试转绿；无生产成本默认值。

### Task 2: 父订单持久状态与钱包结算
**Files:** additive supabase migration; SQL integration tests; apps/web/server/commerce-package/*; focused tests.
**Interfaces:** service-only RPC quote/reserve/read/claim/result/confirm/fail/unknown/finalize; all inputs scoped by user/session/order and frozen snapshot.
- [x] 用隔离本地库测试报价一次接受、钱包守恒、阶段依赖、未知结果恢复、部分成功政策、并发和历史兼容。
- [x] 实现一次预占与单次最终结算；失去调用结果必须保留unknown。
- [x] 不注册新生产价格，不应用生产迁移。

### Task 3: 分析策划生图连接与报价交互
**Files:** server package orchestrator, commerce UI, existing analysis route, API amendments/tests.
**Interfaces:** quote accepted before first paid call; subsequent actions reference orderId+revision; image children use funded allocations.
- [x] 离线测试真实授权函数与注入模型，证明已保存结果不重复调用、确认资料后才策划。
- [x] 用户看到张数/双端/整套总价和退款规则，单价配置不可由客户端覆盖。
- [x] 未确认规则/成本环境保持不可用；不得将离线模拟称真实已接通。

### Task 4: 回归与独立审查
- [x] 运行domain/web/frontend、类型、lint、预算、构建及可用本地数据库测试，保护原服务和next-env。
- [x] 新上下文独立审查、修复关键问题；记录可用与未验证边界于doc/project-progress.md。

## Execution ledger
- Ruling: 用户明确要求原分支本地实施，覆盖skill的worktree/commit建议；不触碰原服务与生产。
- Ruling: 未确认财务政策不猜测，先实现共同基础并保持真实资金/模型入口关闭。

### 执行检查点
- Task 1: 报价及订单领域45项通过，未默认供应商成本。
- Task 2: 旧固定价候选SQL33项通过并保留9个旧表；最新实际计量未接入SQL，不可启用。
- Task 3: 服务6项、传输7项模拟通过；真实路由/UI与Worker计量未接通。
- Review: 领域独立P2两项均已RED→GREEN修复；全栈审查尚待。
- Ruling: 新规则为冻结最高金额、可靠实际成本加价100%、多退；缺usage、超上限或分摊规则未确定均不自动结算。旧固定价SQL只是未启用待改候选。
- Ruling: 部分成功共享成本及最低价要求显式策略，不替用户默认选择；错误选择会影响退款金额，因此保持关闭。

### 当前实施结果（2026-11-05，以项目进度账本最终证据为准）
- 父订单、版本报价、实际用量、取消/部分成功/未知结果处理已连接数据库、服务、向导与任务卡；旧固定价候选已被最新实际成本实现替代。
- MiniMax 新调用关闭、历史恢复保留；图片分析、事实确认、模块策划已接入。
- 四个 OpenAI 模型已接官方端点及原会话/Worker恢复通道，默认关闭且无生产默认价格。
- 独立审查发现的快照比较、整数金额、删除生命周期、回执最终化、实际模型身份与价格类型问题均已修复并复核；完整回归和隔离构建正在最终执行。
- 实际供应商成本/缓存费率、密钥、账号权限和小额真实验收未验证，安全关闭保持生效；不据离线结果声明上线。

### 最终本地候选记录（取代早期检查点）
- Task 1: complete — 领域257项全量通过；成本精度、快照、按实上限、共享成本及整单最低价均离线验证。
- Task 2: complete for local candidate — SQL67项及双连接重复接受、单次抢占、重复取消、余额竞争和账本守恒通过；新配置空/关闭，不代表生产迁移。
- Task 3: complete for local candidate — 路由、Worker用量、向导、任务结算和账号未结算订单发现接通；最后专项24项通过。
- Task 4: complete for local candidate — Web全量1287、前端195、领域257、Worker92，lint/typecheck/预算/双端构建通过；最后新增恢复保护另有24项专项通过。
- Final: fixed — 接受响应丢失和已知orderId读失败允许新报价覆盖身份；package-lost-accept-red/package-known-order-red→final-package-ui 24/24。
- Final: fixed — 浏览器草稿过期后找不到未结算资金订单；package-discovery-red→package-discovery-green，SQL按owner列表断言及final-database通过。
- Final: fixed — 冻结加价比例/最低费用未准确公开；package-disclosure-red→package-review-green。
- Final: fixed — 跨文本输入价格档位成本无法核实；package-tier-red→package-tier-green，数据库入口/结算防护通过。
- Final: fixed — OpenAI价格管理员接受字符串金额；openai_prices.test.sql覆盖类型拒绝，final-database通过。
- Ruling: 用户最终规则覆盖所有早期固定价/分摊待确认候选，实施actual_capped + include_once_if_any_success + whole_order；成本证据缺失仍关闭。
- Ruling: 当前单一文本费率实现只支持≤32,000输入预算且明确缓存命中为0；其他情况停止自动结算，代价是部分真实调用暂不可自动处理，避免猜测扣款。
- Ruling: OpenAI首轮只开放已适配的普通聊天及1K方图medium接口，A+套餐继续Seedream；其他尺寸/质量/套餐适配需另行验证，代价是当前模型能力范围较窄。
- Final: no known unaddressed important findings in the offline candidate; real environment acceptance and cost/key activation remain intentionally pending.

Final delivery: full domain257/frontend195/web1289 exit0; before/after code SHA256 3908e6091f602e6aefec99853654beee6b0eff684b9c9fd12d7303d3933b144d unchanged. Worker92/SQL67 and all gates passed. Final unsupported-commerce-model UI fix RED→GREEN31, then full suite. No live calls, production migration, credentials changes, commit or publish.
