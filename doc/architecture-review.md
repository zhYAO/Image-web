# Zima `architecture.md` 严格覆盖审计报告

| 字段 | 内容 |
| --- | --- |
| 审计对象 | [`requirements.md`](./requirements.md)、[`architecture.md`](./architecture.md) |
| 补充证据 | [`tech-selection.md`](./tech-selection.md)、[`tech-selection-review.md`](./tech-selection-review.md)、[`AGENTS.md`](../AGENTS.md) |
| 审计日期 | 2026-08-17 |
| 审计类型 | Phase 1 架构覆盖质量门禁 |
| 覆盖口径 | 架构文档内逐条闭环；范围引用和跨文档跳转不算实质覆盖 |
| 审计结论 | **重大修订后复审** |

## 1. 审计口径

本报告检查当前 111 条正式需求是否能仅凭 `architecture.md` 找到可实施路径。每条需求必须至少有一项可定位的实质证据：模块职责、接口、事务、领域事实、状态迁移、通信方式、失败恢复或架构级验收机制。`AUTH-001～011` 一类范围引用、只有测试 ID、或只指向 `tech-selection.md` 的情况，不构成实质证据。

主状态只有以下四种：

| 状态 | 判定规则 |
| --- | --- |
| `covered` | 需求的主要行为、约束和失败语义在架构内形成可实施闭环 |
| `partial` | 架构已有正确模块或部分机制，但仍缺少会影响实现或验收的约束 |
| `uncovered` | 架构没有实质实现路径，或只有范围引用/跨文档跳转 |
| `conflicting` | 架构明确规定了与需求互斥的行为；仅缺失或用词不清不算冲突 |

覆盖率采用固定公式：

```text
coverage = (covered × 1 + partial × 0.5) / 111
         = (60 + 37 × 0.5) / 111
         = 70.7%
```

EXT-001～005 是外部发布依赖，不计入 111 条需求主状态。它们以及受其约束的能力会另行标记为 `external-gated`，但该标记不能替代架构覆盖状态。

## 2. 执行摘要

### 2.1 覆盖结果

| 状态 | 数量 | 占比 | 结论 |
| --- | ---: | ---: | --- |
| `covered` | 60 | 54.1% | 核心任务、积分、对账和安全主链路较完整 |
| `partial` | 37 | 33.3% | 已有方向，但实施者仍需自行补决策 |
| `uncovered` | 14 | 12.6% | 无法仅凭架构实施或验收 |
| `conflicting` | 0 | 0% | 未发现已经确认的直接需求冲突 |
| **合计** | **111** | **100%** | 覆盖加权得分 **70.7%** |

核心优势：

- 统一 Agent 入口、图片 Tool 三来源门控、文本回合计费、图片任务异步执行和逐输出结算已经形成端到端闭环。
- Postgres、Storage、Queue 与 Realtime 的真相源划分明确，Worker 重投、供应商未知状态和 15 分钟/24 小时对账具备恢复路径。
- RLS、显式 GRANT、私有 Storage、服务端密钥、审核前后置和账户删除形成了较完整的安全边界。

主要阻塞：

- `TASK-011` 的单用户活动任务上限完全缺失，任务受理事务无法按需求执行容量拒绝。
- `IMG-008～010` 的发布质量门禁完全缺失，无法阻止未达到素材数量、自动硬检查和盲评阈值的版本发布。
- 首页、Skill、社区和结果操作大量依赖页面级文档，`architecture.md` 不能独立指导这些功能。
- TaskOutput 与 Asset 的状态词在图片时序中混用，虽然尚未构成明确冲突，但可能诱导实现出未定义状态。

### 2.2 六维质量评分

| 维度 | 得分 | 依据 |
| --- | ---: | --- |
| 完整性 | 71 | 60 条完整覆盖、37 条部分覆盖、14 条未覆盖 |
| 清晰度 | 86 | 模块和时序总体清楚；输出/资产状态词及少量责任边界仍有歧义 |
| 一致性 | 91 | 未发现直接冲突；状态词和发布/运行时边界需要统一 |
| 可测试性 | 80 | 关键链路有失败语义和测试映射，页面、质量门禁与 UX 缺少架构级测点 |
| 可追踪性 | 69 | 有需求族映射，但范围引用不能证明逐条设计覆盖 |
| 可行性 | 88 | 技术路线可行；供应商、SMTP、价表、合规和备份仍受外部门槛约束 |
| **总体** | **81** | 六项等权平均；低于独立实施蓝图的 90 分门槛 |

评分属于架构文档质量，不改变 `requirements.md` 的有效性。由于未覆盖项包含 P0 容量控制和生产质量门禁，即使总体分为“良好”，批准结论仍为“重大修订后复审”。

## 3. 重点问题与冲突结论

### 3.1 严重度清单

| 问题 ID | 严重度 | 关联需求 | 问题与影响 | 修复条件 |
| --- | --- | --- | --- | --- |
| ARCH-C-001 | Critical | TASK-011 | 缺少每用户最多一个 `running/reconciling` 的事务约束；可能同时执行多个高成本任务 | 在任务受理原子边界增加活动任务条件约束、稳定错误码和并发测试 |
| ARCH-C-002 | Critical | IMG-008～010 | 缺少 60 组素材、每能力 20 例、硬检查 95%、双设计师盲评和主体破坏为零的发布门禁 | 新增 Quality & Release Gate、证据产物和阻断发布规则 |
| ARCH-M-001 | Major | HOME-001～004、SKILL-003～005、COMM-001～004 | 公开页面、目录和策展能力没有独立应用模块，只有 Browser 和跨文档引用 | 增加 Public Experience、Skill Catalog、Curated Community 模块及读写边界 |
| ARCH-M-002 | Major | AUTH-006～007 | 登录后草稿恢复/再次提交和邀请限流未闭环 | 增加 Draft Restore Policy 与邀请码 IP/邮箱/摘要限流边界 |
| ARCH-M-003 | Major | IMG-001～006、TOOL-008 | 五种能力的尺寸、倍率、格式、参考角色和换背景 7 输出规则不完整 | 增加版本化 Capability Contract 与结果操作边界 |
| ARCH-M-004 | Major | CREDIT-001～002、CREDIT-006～009 | 整数、公开 DTO、价表判别项和邀请基准额度未完整落入架构 | 补充 Credit/PriceBook 不变量及 EXT-005 gate |
| ARCH-M-005 | Major | NFR-UX-002～004、NFR-PERF-003～004 | 键盘、焦点、i18n、全异步状态、Worker 并发 2 和原图按需加载缺少边界 | 增加 Web Experience 与 Capacity/Performance 约束 |
| ARCH-M-006 | Major | SEC-005～006、SEC-009、TASK-003 | 管理审计字段和 Queue 函数授权未明确；浏览器角色可能被误授予 `pgmq_public` 执行权 | 明确管理审计事实，并撤销浏览器角色的 Queue 函数权限 |
| ARCH-M-007 | Major | TaskOutput/Asset 状态 | `ready/rejected` 与 `succeeded/failed` 在图片时序中指代不明确 | 将 TaskOutput、Asset、审核错误分别使用冻结枚举 |
| ARCH-N-001 | Minor | PROJ-001～002 | 标题降级、改名、搜索和排序缺少 Project Query/Command 路径 | 增加项目查询与命令职责表 |
| ARCH-N-002 | Minor | NFR-REL-002 | 扩大内测前的套餐升级和恢复演练只被笼统引用 | 明确为独立 expansion gate 和证据检查 |
| ARCH-N-003 | Minor | TASK-013 | 已明确轮询，但未来回调复用相同条件迁移和幂等键的约束未写入 | 在 Provider 通信边界补充非 Phase 1 回调约束 |

### 3.2 直接冲突结论

本次没有发现 `architecture.md` 明确要求实现与 `requirements.md` 相反行为的条目，因此 `conflicting=0`。

但以下表述必须在修订时消除，否则实现后可能形成冲突：

- `architecture.md` §5.3 L341-345 与 §7 L479-482 使用“输出 ready/rejected”式表达；需求中的 `TaskOutputStatus` 不包含 `ready` 或 `rejected`。应明确：TaskOutput 使用 `pending/processing/reconciling/succeeded/failed/deleted`，Asset 使用 `pending/ready/rejected/deleted`，内容拒绝归一为 TaskOutput `failed + policy_rejected`。
- `architecture.md` §4.1 使用 `pgmq_public.*` 是正确 API，但未明确撤销 `anon/authenticated` 的函数执行权限。该问题当前是安全边界缺失，不是需求冲突。

## 4. 111 条需求逐项审计

### 4.1 邀请与认证（11）

| ID | 摘要 | 状态 | `architecture.md` 实质证据 | 缺口、风险与修复 | 测试 | `tech-selection.md` 补充证据 |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | 一次性邀请码及状态/过期/额度/备注 | `partial` | §3.3 L159；§5.5 L398-403 | 有预约/核销边界，但未列邀请码完整事实；补 Invitation 聚合字段和状态机 | T-AUTH-01、T-AUTH-02 | §3.4、§5 |
| AUTH-002 | 核销、账户、积分 grant 同事务 | `covered` | §5.5 L400-403；§6.2 L436 | 原子边界和失败回滚明确 | T-AUTH-01、T-AUTH-02 | §3.4、§4.3 |
| AUTH-003 | OTP 失败不消耗且核销幂等 | `covered` | §5.5 L400-403；§6.3 L448 | 失败释放和核销幂等依据明确 | T-AUTH-01、T-AUTH-02 | §3.4 |
| AUTH-004 | Supabase OTP/会话与阿里云 SMTP | `covered` | §2 L61-77、L89-90；§1.2 L38 | Auth/SMTP 拓扑和外部门槛明确 | T-AUTH-04 | §2.2、§3.4 |
| AUTH-005 | 匿名只读公开内容 | `partial` | §4.2 L192；§7 L461 | profile 是应用资格，但未列匿名可读/禁写能力；补 Public Access Policy | T-RLS-01、T-AUTH-05 | §3.1～3.4、§4.3 |
| AUTH-006 | 登录后仅恢复草稿且再次提交 | `uncovered` | 只有 Browser 本地草稿 §3.1 L113 | 未定义登录恢复字段和“不得自动执行/扣费”；新增 Draft Restore Policy | T-AUTH-04 | §3.1、§3.4 |
| AUTH-007 | 邀请摘要存储与三维限流 | `partial` | §5.5 L400；§6.3 L448 | 有摘要，无 IP/邮箱/摘要限流；补 Rate Limit Service/事实 | T-AUTH-05 | §3.4、§4.2 |
| AUTH-008 | 无有效邀请不得建立应用资格 | `covered` | §4.2 L192；§5.5 L401-403；§7 L461 | Auth 身份与 profile 应用资格分离 | T-RLS-01、T-AUTH-05 | §3.4、§4.3 |
| AUTH-009 | 10 分钟邀请预约 | `covered` | §5.5 L400；§6.3 L448 | 预约事实、challenge 和期限明确 | T-AUTH-03 | §3.4 |
| AUTH-010 | 单邀请码有效预约唯一且可释放 | `covered` | §5.5 L400-403；§6.3 L448 | 唯一约束与过期释放路径明确 | T-AUTH-03 | §3.4、§5 |
| AUTH-011 | OTP 后按 uid/email/challenge 原子开户 | `covered` | §5.5 L400-403；§6.2 L436 | 已验证会话和 private RPC 边界明确 | T-AUTH-03 | §3.4、§4.3 |

### 4.2 首页与导航（4）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| HOME-001 | 首屏输入、主图/参考图、Skill、四工具 | `partial` | §5.1 L216-217 涵盖 prompt、Tool/Skill、资产 | 未形成首页组件和角色输入边界；补 Public Experience 与 Home Composer | T-HOME-01 | §3.1 |
| HOME-002 | 四快捷工具与 generate 文本入口 | `uncovered` | 无实质证据 | 未列四工具和 generate 入口；补 Home Tool Catalog 与门控映射 | T-HOME-01 | §3.1、§4.5 |
| HOME-003 | 登录最近项目/匿名说明和案例 | `uncovered` | 无实质证据 | 未定义 RSC 登录态分支和查询投影；补 Home Read Model | T-HOME-01 | §3.1 |
| HOME-004 | 首页/工作台/Skill/社区统一导航 | `uncovered` | 无实质证据 | Browser 模块未包含导航状态；补 App Navigation/route metadata | T-HOME-01 | §3.1～3.3、§3.6 |

### 4.3 项目与资产（9）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| PROJ-001 | 首次回合/任务建项目及标题降级 | `partial` | §5.2 L258-264；§5.3 L315-316 | 原子建项目明确，提示词标题和日期降级缺失；补 Project Title Policy | T-PROJECT-01、T-AGENT-CHAT-01 | §3.5～3.6、§4.5～4.6 |
| PROJ-002 | 改名、查询、最近排序、软删恢复 | `partial` | §3.3 L160；§5.5 L405-410 | 仅删除恢复闭环；补 Project Query/Command Service | T-PROJECT-01、T-DELETE-01 | §3.5、§4.2 |
| PROJ-003 | 删除隐藏、禁新任务、7 天清理 | `covered` | §5.5 L405-410；§3.3 L160 | 隐藏、阻断、恢复和清理路径明确 | T-PROJECT-01、T-DELETE-01 | §3.5、§3.8 |
| ASSET-001 | 一主图、三参考图及角色 | `partial` | §5.3 L308-309；§5.5 L392-396 | 有角色校验边界，未冻结数量和三种参考角色；补 AssetRoleContract | T-ASSET-01、T-RLS-01 | §3.6、§4.1、§4.4 |
| ASSET-002 | JPEG/PNG/WebP、20 MiB、真实校验 | `partial` | §4.1 L174；§5.5 L394-396 | 有真实解码，无总大小/格式列表和能力尺寸；补 Upload Capability Contract | T-ASSET-01、T-RLS-01 | §4.4、§4.11 |
| ASSET-003 | 原图/输出/缩略图独立及派生关系 | `covered` | §3.3 L160；§5.3 L344-345；§5.5 L396 | 独立对象和父/输出派生关系明确 | T-ASSET-01、T-RLS-01 | §4.4、§5 |
| ASSET-004 | 私有资产与短时签名 URL | `covered` | §4.2 L195；§8.1 L493 | 私有 object key、签名 URL 不入库 | T-ASSET-01、T-RLS-01 | §3.6、§4.3～4.4 |
| ASSET-005 | 抠图 PNG，其余 JPG/可选 PNG | `partial` | §5.3 L339；§7 L479 | 有格式/alpha 校验，未规定能力默认格式；补 OutputFormatPolicy | T-ASSET-02、T-DELETE-01 | §4.7 |
| ASSET-006 | 输出 7 天回收并保留审计 | `covered` | §5.5 L407-410 | 软删、清理、账本/安全审计保留完整 | T-ASSET-02、T-DELETE-01 | §3.6、§3.8 |

### 4.4 Agent（10）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| AGENT-001 | 单一 Agent 且不可创建/切换 | `partial` | §2 L54；§3.1 L115 | 单一 Orchestrator 隐含，但无产品/配置禁用路径；补 SingleAgentPolicy | T-AGENT-01 | §3.1、§3.6 |
| AGENT-002 | 项目咨询/建议/解释且不做图片复盘 | `partial` | §1.1 L25、L32；§5.2 | 无跨项目/无复盘明确，三类允许文本用途未完整列出 | T-AGENT-01 | §4.1、§4.5 |
| AGENT-003 | 无关问题确定性拒绝且免费 | `covered` | §5.1 L225-227；§7 L465 | 不调用模型、不扣费、可行动引导明确 | T-AGENT-01 | §4.5 |
| AGENT-004 | 结构化计划经服务端校验 | `covered` | §1.1 L27-28；§5.1 L243；§5.3 L308-309 | 冻结计划与 schema/权限/成本/上限校验完整 | T-PLAN-01、T-API-01 | §4.1、§4.5 |
| AGENT-005 | Agent 不决定供应商/扣款/绕策略 | `covered` | §1.1 L28、L30；§3.1 L115-119 | Agent、Credit 与 Provider 职责分离 | T-PLAN-01、T-API-01 | §4.1、§4.5、§4.11 |
| AGENT-006 | 中立 TextModelAdapter/一个活动模型 | `covered` | §3.1 L116；§4.1 L178 | 一个活动配置、服务端密钥和前端隐藏明确 | T-TEXT-01 | §4.1、§4.5 |
| AGENT-007 | 模型切换审计/只影响新请求/不静默切换 | `covered` | §1.1 L27；§7 L466、L484；§3.3 L165 | 冻结配置、失败降级和管理审计边界明确 | T-TEXT-01 | §4.5、§5 |
| AGENT-008 | 文本调用预扣并按 usage 结算 | `covered` | §5.2 L257-289；§7 L466-468 | 成功/失败/中断、usage、平台差额和观测闭环 | T-TEXT-01、T-TEXT-BILLING-01 | §4.1、§4.5 |
| AGENT-009 | 统一输入分流且最多一次模型调用 | `covered` | §5.1 L216-243；§5.2 L270 | 唯一入口、确定性分流、单次调用明确 | T-AGENT-CHAT-01 | §4.2、§4.5 |
| AGENT-010 | 项目单会话、持久化、上下文隔离 | `covered` | §1.1 L25；§3.3 L161；§5.2 L258-264 | Conversation 唯一、最近上下文、无隐藏摘要和删除路径完整 | T-AGENT-CHAT-01、T-ACCOUNT-DELETE-01 | §4.1、§4.5、§5 |

### 4.5 图片 Tool 门控（8）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| TOOL-001 | 图片 Tool 只有三种触发来源 | `covered` | §1.1 L23；§5.1 L224-236 | 三来源及统一门控入口明确 | T-GATE-01 | §4.5 |
| TOOL-002 | 上传/咨询/模糊/未选 Skill 不触发 | `covered` | §1.1 L23；§5.1 L228-234；§7 L464 | 负向条件和澄清/文本分支明确 | T-GATE-01 | §4.5 |
| TOOL-003 | 通过后自动执行且展示步骤/报价 | `partial` | §5.1 L235-238；§5.3 L306-323 | 自动入队存在，未明确无二次确认和执行卡片投影 | T-GATE-01 | §3.1、§3.6、§4.5 |
| TOOL-004 | 3 步/8 输出且不可隐藏拆分 | `covered` | §1.1 L24；§5.1 L243；§5.3 L309 | 服务端与 Worker 冻结计划防隐藏扩张 | T-GATE-01、T-PLAN-01 | §4.5 |
| TOOL-005 | 余额不足不入队且保留输入 | `covered` | §5.3 L317-319；§7 L471 | 原子回滚、无预扣和草稿保留明确 | T-GATE-01 | §4.6 |
| TOOL-006 | 人物常规处理与高风险前拒绝 | `partial` | §5.3 L310-313；§7 L469-470 | 有前置审核，未列人物允许/禁止能力边界 | T-GATE-01、T-POLICY-01 | §4.5、§4.7 |
| TOOL-007 | Tool/Skill 互斥且无隐藏来源 | `covered` | §7 L463；§5.1 L216-236 | strict schema、互斥拒绝和单一 source 清楚 | T-GATE-01、T-PLAN-01 | §4.2、§4.5 |
| TOOL-008 | 非透明换背景显式两步/最多 7 结果 | `partial` | §1.1 L24；§5.3 L309 | 两步可见可计费，缺 7 结果限制和透明 RGBA 省略规则 | T-REPLACE-01 | §4.5、§4.7 |

### 4.6 图片能力与质量（10）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| IMG-001 | 抠图透明、保主体、失败留输入 | `partial` | §5.3 L339-345；§7 L479 | 有 alpha/格式校验和失败释放，未规定 PNG/主体边缘质量 | T-IMG-01、T-QUALITY-01、T-PROVIDER-01 | §4.7、§4.12 |
| IMG-002 | 换背景描述/三参考且不混主图 | `partial` | §5.3 L308-309 | 有角色校验，缺文本背景、最多三图和主图隔离契约 | T-IMG-01、T-QUALITY-01、T-PROVIDER-01 | §4.1、§4.7 |
| IMG-003 | 四比例和能力约束自定义尺寸 | `uncovered` | 无实质证据 | 只写“能力校验”，无比例/自定义尺寸契约；新增 Capability Contract | T-IMG-01、T-QUALITY-01、T-PROVIDER-01 | §4.1、§4.11 |
| IMG-004 | 2×/4×，不支持需入队前拒绝 | `partial` | §3.1 L117；§5.3 L308-313 | 有能力校验边界，缺倍率枚举和 capability_unavailable 行为 | T-IMG-01、T-QUALITY-01、T-PROVIDER-01 | §4.1、§4.11 |
| IMG-005 | generate 中英文且计入 8 输出 | `partial` | §1.1 L24；§5.3 L309 | 输出上限存在，中英文契约和 generate 入口未列出 | T-IMG-01、T-QUALITY-01、T-PROVIDER-01 | §4.1、§4.7 |
| IMG-006 | 预览/下载/删除/反馈/继续加工 | `partial` | §4.2 L195；§5.5 L407；§8.2 L498 | 预览、删除、反馈有边界，缺“作为新任务主图”与完整 Result Actions | T-RESULT-01 | §3.6、§4.2 |
| IMG-007 | 单输出删除/重试不影响成功输出 | `covered` | §5.3 L352；§6.1 L430 | 子任务、独立结算和历史不变明确 | T-PARTIAL-01 | §4.8 |
| IMG-008 | 60 组授权素材/每能力 20 例 | `uncovered` | 无实质证据 | 发布质量数据集无架构所有者；新增 Quality Dataset Registry | T-QUALITY-01 | §4.12 |
| IMG-009 | 硬检查总体 ≥95% | `uncovered` | 无实质证据 | 运行时输出校验不能替代发布基准统计；新增自动质量 gate | T-QUALITY-01 | §4.12 |
| IMG-010 | 双设计师盲评 ≥4/5 且零破坏 | `uncovered` | 无实质证据 | 无评审工作流、分歧复核和发布阻断；新增 Blind Review Gate | T-QUALITY-01 | §4.12 |

### 4.7 Skill（5）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| SKILL-001 | 管理员官方声明式 Skill/无任意代码 | `partial` | §3.2 L147；§3.3 L164 | 禁任意代码和管理写边界存在，未明确 script/network/SQL schema 拒绝 | T-SKILL-01 | §3.2、§4.5、§5 |
| SKILL-002 | 版本冻结且历史不变 | `covered` | §1.1 L27；§3.3 L164；§5.3 L308 | immutable SkillVersion 与任务冻结明确 | T-SKILL-01 | §3.2、§4.5 |
| SKILL-003 | 浏览/搜索/分类/启停且仅选中生效 | `partial` | §1.1 L23；§3.3 L164 | “仅本次选择”完整，目录查询和用户启停边界缺失 | T-SKILL-01 | §3.2、§5 |
| SKILL-004 | 发布前校验 schema/步骤/能力/变量 | `partial` | §3.1 L117；§5.3 L308-309 | 有计划校验，未定义 Skill 发布校验职责和提示词变量 | T-SKILL-01 | §3.2、§4.5 |
| SKILL-005 | retired 不用于新任务且历史可见 | `uncovered` | 无实质证据 | immutable 不等于 retired 生命周期；新增 SkillVersion lifecycle/read projection | T-SKILL-01 | §3.2、§5 |

### 4.8 精选社区（4）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| COMM-001 | 仅管理员策展发布且无投稿 | `covered` | §3.3 L164 | 策展案例由管理 RPC 写、公开只读投影，用户无写边界 | T-COMM-01 | §3.3、§5 |
| COMM-002 | 详情字段及隐藏供应商/模型 | `uncovered` | 无实质证据 | 无 Community Case DTO/投影字段；新增 Curated Community Read Model | T-COMM-01 | §3.3、§5 |
| COMM-003 | 用同款只预选不执行/匿名登录 | `uncovered` | 无实质证据 | 无 Draft Prefill 与认证回跳路径；新增 Use-the-same Flow | T-COMM-01 | §3.3 |
| COMM-004 | 仅授权展示资产且不公开私有图 | `partial` | §3.3 L160、L164；§8.1 L493 | 私有边界明确，缺案例独立资产和发布授权证据 | T-COMM-01 | §3.3、§5 |

### 4.9 任务（13）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | 用户+客户端幂等键唯一任务 | `covered` | §5.1 L217-222；§6.3 L447 | 重放返回持久化结果且不重复执行/扣费 | T-IDEMP-01、T-CRASH-01 | §4.2、§4.6 |
| TASK-002 | 报价/余额/预扣/记录/入队一致 | `covered` | §5.3 L315-321；§6.2 L439 | 单事务和失败整体回滚明确 | T-IDEMP-01、T-CRASH-01 | §4.6 |
| TASK-003 | Queue 仅 taskId/必要版本 | `covered` | §4.1 L180；§8.1 L494 | 明确禁止 prompt/URL/邮箱/密钥 | T-IDEMP-01、T-CRASH-01 | §4.6～4.7 |
| TASK-004 | 可见性窗口/条件更新/执行令牌 | `covered` | §4.1 L180-184；§6.3 L450-451 | 重投、并发和条件迁移闭环 | T-IDEMP-01、T-CRASH-01 | §4.7 |
| TASK-005 | 错误分类与最多三次临时重试 | `covered` | §7 L463、L469-470、L476 | 永久错误不重试、临时错误有限 Attempt | T-IDEMP-01、T-RECON-01 | §4.7 |
| TASK-006 | 未知状态只查不重提 | `covered` | §5.3 L326-334；§5.4 L371-381 | submissionId 条件和 24 小时对账明确 | T-IDEMP-01、T-RECON-01 | §4.7、§4.9 |
| TASK-007 | Realtime 优先/轮询兜底 | `covered` | §5.4 L365-386；§7 L475 | rowVersion、退避、终态停止完整 | T-RESULT-01 | §4.10 |
| TASK-008 | 只重试失败输出且保留历史 | `covered` | §5.3 L352；§6.1 L430 | 关联子任务，不改原审计事实 | T-PARTIAL-01、T-ATTEMPT-01 | §4.8 |
| TASK-009 | 用户重试新键/新价/新预扣 | `covered` | §5.3 L352；§6.1 L430 | 原预扣释放、成功输出不复用明确 | T-PARTIAL-01、T-ATTEMPT-01 | §4.8 |
| TASK-010 | 每次提交/自动重试唯一 Attempt | `covered` | §5.3 L324-331；§6.3 L451 | findOrCreate、submissionId 和未知先查询明确 | T-ATTEMPT-01、T-RECON-01 | §4.7、§4.9 |
| TASK-011 | 单用户一个活动任务/排队不设上限 | `uncovered` | 无实质证据 | 缺活动任务条件约束、错误码和“排队全额预扣”；加入任务受理事务 | T-CAPACITY-01 | §4.6、§5 |
| TASK-012 | 全局 100 队列容量拒绝 | `covered` | §5.3 L317-319；§7 L472 | `queue_capacity_reached`、无任务/预扣和草稿保留完整 | T-CAPACITY-01 | §4.6 |
| TASK-013 | Phase 1 轮询必需/未来回调同幂等 | `partial` | §4.1 L182；§5.4 L373-375 | 轮询明确，未来回调复用状态条件和幂等键未写入 | T-IDEMP-01、T-PROVIDER-01、T-RECON-01 | §4.11 |

### 4.10 积分（10）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| CREDIT-001 | 整数积分/只追加账本/受约束余额 | `partial` | §1.1 L29；§3.1 L119；§4.2 L194 | 只追加和余额锁明确，未声明整数存储/check；补 CreditInvariant | T-LEDGER-01、T-TEXT-BILLING-01 | §4.1、§5 |
| CREDIT-002 | 前台只显示统一积分和三类数值 | `partial` | §1.1 L30；§5.1 L238；§5.2 L289 | 已隐藏供应商成本，未冻结公开 DTO 的预计/实际/余额字段 | T-LEDGER-01、T-TEXT-BILLING-01 | §3.7、§4.2 |
| CREDIT-003 | BillableUnit 独立 reserve/capture/release | `covered` | §3.3 L163；§5.2 L263-283；§5.3 L335-345 | 文本和逐输出结算完整 | T-LEDGER-01、T-PARTIAL-01、T-TEXT-BILLING-01 | §4.1、§4.8 |
| CREDIT-004 | 实际不超冻结上限 | `covered` | §5.2 L289；§7 L468 | 用户上限、平台差额和告警明确 | T-LEDGER-01、T-TEXT-BILLING-01 | §4.5、§4.8 |
| CREDIT-005 | 所有账本事件幂等 | `covered` | §1.1 L29；§6.3 L452 | grant/reserve/capture/release/adjustment 唯一键明确 | T-LEDGER-01、T-IDEMP-01 | §4.8 |
| CREDIT-006 | 仅邀请 grant/管理员调整且无支付 | `partial` | §6.2 L436；§7 L471 | 无支付入口只在降级表出现，未定义允许的 ledger 来源集合 | T-LEDGER-01、T-TEXT-BILLING-01 | §3.7、§4.2 |
| CREDIT-007 | 不可变图片/文本判别价表 | `partial` | §1.1 L27；§3.1 L119；§5.2 L259-289 | 版本冻结存在，未定义图片分辨率和文本百万 token 判别项 | T-PRICE-01 | §4.1、§4.5 |
| CREDIT-008 | 邀请额度约 50 标准输出 | `uncovered` | §1.2 L42 仅标 EXT-005 | 未记录 50 个基准价值；补邀请额度公式并继续外部门禁 | T-PRICE-01 | §4.1、§5 |
| CREDIT-009 | 新价仅新任务/逐输出取整/重试规则 | `partial` | §1.1 L27；§5.3 L352；§6.1 L430 | 版本与重试价明确，图片逐输出向上取整未明确 | T-PRICE-01 | §4.8 |
| CREDIT-010 | 文本估算预扣/usage 取整/失败幂等 | `covered` | §5.2 L257-289；§7 L466-468、L471 | 输入估算、最大输出、可信 usage、余额和重放完整 | T-TEXT-BILLING-01、T-PRICE-01 | §4.5 |

### 4.11 安全、隐私与合规（12）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | 浏览器表先 RLS 并做跨用户测试 | `covered` | §8.1 L491 | RLS、所有权和负向测试明确 | T-RLS-01、T-DATAAPI-01 | §4.3、§5 |
| SEC-002 | publishable key/服务端密钥隔离 | `covered` | §1.1 L30；§8.1 L490 | 浏览器与服务端凭证边界明确 | T-SECURITY-01 | §4.3 |
| SEC-003 | Storage 所有权和短时签名 URL | `covered` | §4.2 L195；§8.1 L493 | 稳定 key 与临时 URL 边界明确 | T-RLS-01、T-DATAAPI-01 | §4.3～4.4 |
| SEC-004 | 日志敏感字段禁止项 | `covered` | §8.2 L498-500 | 完整 prompt、PII、密钥、URL、原始 body 和二进制均脱敏 | T-SECURITY-01 | §4.13 |
| SEC-005 | 管理变更记录人/时/原因/前后版本 | `partial` | §3.3 L165；§7 L484 | 有受控管理/审计，未冻结审计字段和余额静默修改禁令 | T-ADMIN-01 | §5 |
| SEC-006 | 上传授权证据且私有素材不训练/公开/人工看 | `partial` | §5.5 L392-396；§3.3 L160 | 授权事实完整，未明确禁止训练、公开案例和人工浏览 | T-SECURITY-01 | §4.4、§5 |
| SEC-007 | 前置意图审核与结果审核 | `covered` | §5.3 L310-345；§7 L469-481 | 两阶段失败关闭、拒绝无最终扣款完整 | T-POLICY-01 | §4.5、§4.7 |
| SEC-008 | 扩大内测前合规门禁 | `covered` | §1.2 L41；§10 L539 | EXT-004 明确且未伪装完成；`external-gated` | T-EXPANSION-GATE-01 | §1.3、§6 |
| SEC-009 | 管理数据必须受控函数和审计 | `partial` | §3.3 L159-165；§8.1 L492 | 通用边界存在，未逐项列管理对象；Queue 公共函数授权也未收口 | T-ADMIN-01 | §4.3、§5 |
| SEC-010 | 显式 GRANT+RLS/安全视图 | `covered` | §4.1 L177；§8.1 L491-492 | 双门槛、最小权限、security_invoker 和 definer 防护明确 | T-RLS-01、T-DATAAPI-01 | §4.3、§5 |
| SEC-011 | 删除申请阻断/7 天/撤会话后清理 | `covered` | §5.5 L405-410；§7 L461 | 请求、撤销、会话撤销和数据清理完整 | T-ACCOUNT-DELETE-01 | §3.8、§5 |
| SEC-012 | 审计 180 天/日志 30 天/法定覆盖 | `covered` | §5.5 L410 | 保留期限和法定依据明确 | T-ACCOUNT-DELETE-01 | §3.8、§4.13 |

### 4.12 非功能需求（15）

| ID | 摘要 | 状态 | 实质证据 | 缺口、风险与修复 | 测试 | 技术补充 |
| --- | --- | --- | --- | --- | --- | --- |
| NFR-PERF-001 | BFF p95 ≤3 秒 | `covered` | §8.3 L506 | 起止、样本、排除项和阈值明确 | T-PERF-01 | §4.13 |
| NFR-PERF-002 | 状态可见 p95 ≤5 秒 | `covered` | §5.4 L365-386；§8.3 L507 | rowVersion 测点、样本和分报明确 | T-PERF-01 | §4.10、§4.13 |
| NFR-PERF-003 | 100 排队且 Worker 默认并发 2 | `partial` | §7 L472、L474 | 100 容量和持久恢复明确，Worker 并发 2/可配置缺失 | T-PERF-01 | §4.7、§4.13 |
| NFR-PERF-004 | 列表缩略图/原图按需加载 | `partial` | §5.5 L396；§4.2 L195 | 有独立缩略图，未定义列表禁止加载原图的 Query/DTO 边界 | T-PERF-01 | §3.5～3.6 |
| NFR-REL-001 | Web/BFF 月可用性 99.0% | `covered` | §8.3 L508 | 5 分钟探测和排除项报告规则明确 | T-NFR-REL-01 | §4.13 |
| NFR-REL-002 | 扩大内测前备份与恢复演练 | `partial` | §1.2 L40；§10 L539 | 备份门禁存在，缺套餐升级、一次恢复演练和 RPO/RTO 证据项；`external-gated` | T-EXPANSION-GATE-01 | §1.3、§6 |
| NFR-REL-003 | Worker 重启恢复且不靠内存 | `covered` | §4.2 L196-197；§7 L474 | Queue/Postgres 真相和可见性恢复完整 | T-NFR-REL-01 | §4.7 |
| NFR-REL-004 | 供应商失败保留证据 | `covered` | §7 L476-482；§4.2 L193-197 | 可行动状态、任务/输入/账本与供应商证据保留 | T-NFR-REL-01 | §4.7、§4.13 |
| NFR-UX-001 | 响应式 Web-only 范围 | `covered` | §1 L17；§1.1 L21；§10 L539 | Web 宽屏/375px 能力和原生端禁令明确 | T-NFR-UX-01 | §2、§3.6 |
| NFR-UX-002 | 键盘操作和可见焦点 | `partial` | §3.2 L150 仅称组件可访问 | 缺键盘/焦点的模块责任、测试工具和失败门禁 | T-NFR-UX-01 | §2.1、§3.6 |
| NFR-UX-003 | zh-CN i18n key/中英文提示词 | `uncovered` | 无实质证据 | 未定义 i18n 模块、消息键或语言边界；新增 Web Localization | T-NFR-UX-01 | §2.1、§3.6 |
| NFR-UX-004 | 全异步/离线 UI 状态 | `partial` | §5.4 L365-386；§6.1 L416-428；§7 L475 | 任务状态和离线恢复明确，空态/排队/处理/部分成功 UI 模型未闭环 | T-NFR-UX-01 | §3.6、§4.10 |
| NFR-OBS-001 | 任务/时长/错误/重试/积分/反馈指标 | `covered` | §8.2 L498；§8.3 L504-510 | 固定事件和分组指标可计算全部要求 | T-NFR-OBS-01、T-METRIC-01 | §4.13 |
| NFR-OBS-002 | ID 关联且不依赖用户内容 | `covered` | §8.2 L498-500 | request/task/step/output/turn ID 和脱敏清单明确 | T-NFR-OBS-01 | §4.13 |
| NFR-OBS-003 | 四类关键告警 | `covered` | §8.2 L500；§7 L474、L477-478 | 重复扣款、未知、dead-letter、长预扣及扩展告警完整 | T-NFR-OBS-01 | §4.13 |

## 5. 外部依赖审计

| 外部门槛 | 架构状态 | 不得宣称完成的能力 | 审计结论 |
| --- | --- | --- | --- |
| EXT-001 SMTP/发信域名 | 架构已隔离且可 Mock | 正式 OTP 送达 | `external-gated`，非设计遗漏 |
| EXT-002 阿里云图片/审核账号、配额和成本 | Provider/ContentSafety 端口已定义 | 五种生产能力、审核可用性和真实成本 | `external-gated`，需真实账号契约测试 |
| EXT-003 Supabase 新加坡项目/凭证 | Auth/DB/Storage/Queue/Realtime 边界已定义 | 生产部署、套餐和备份能力 | `external-gated` |
| EXT-004 ICP/协议/隐私/跨境评估 | 数据流和删除边界已定义 | 合规批准与扩大内测 | `external-gated` |
| EXT-005 价表/邀请整数额度 | 版本冻结和结算公式已定义 | 真实扣费、邀请额度发放 | `external-gated`；CREDIT-008 仍属架构未覆盖 |

NFR-REL-002 同时是 `partial` 和外部门禁：架构已认识到备份门槛，但尚未写出套餐升级、恢复演练和批准的 RPO/RTO 证据链。外部依赖不能把该缺口自动提升为 `covered`。

## 6. Supabase 当前官方约束复核

截至 2026-08-17，以下结论已按官方资料复核：

- Queue API 使用 `pgmq_public.read(queue_name, sleep_seconds, n)`、延迟 `pgmq_public.send(..., sleep_seconds)` 与 `pgmq_public.archive(...)`，`architecture.md` 的 API 名称和可见性窗口方向正确；修订时还需明确撤销 `anon/authenticated` 的 Queue 函数执行权，只允许受控事务函数和 Worker 调用。[Supabase Queues API](https://supabase.com/docs/guides/queues/api)
- 显式 GRANT 与 RLS 是两层独立控制。新表不能依赖自动 Data API 暴露，现有 §8.1 的“双门槛”方向正确。[Securing your API](https://supabase.com/docs/guides/api/securing-your-api)、[Data API 默认暴露变更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- `realtime` schema 已禁止创建或修改自定义对象，但仍允许为 `realtime.messages` 配置授权策略。架构修订应明确业务表和触发器放在业务 schema，只调用官方 Broadcast 能力。[Realtime schema locked down](https://supabase.com/changelog/realtime-schema-locked-down-against-modification)、[Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)

这些结论没有形成当前需求冲突，但属于实施前必须写清的安全约束。

## 7. 建议修订顺序

1. **先修容量与状态边界**：补 TASK-011；区分 TaskOutput 与 Asset 状态；明确 Queue 函数授权。
2. **补生产质量门禁**：增加 Quality & Release Gate，完整承载 IMG-008～010。
3. **补页面应用模块**：增加 Public Experience、Project Query、Skill Catalog、Curated Community 和 Result Actions。
4. **补能力与价表契约**：固化五种能力的角色/尺寸/倍率/格式，换背景 7 输出上限，整数积分、公开 DTO 和邀请基准额度。
5. **补 Web 体验与发布门禁**：i18n、键盘/焦点、完整异步 UI、Worker 并发 2、缩略图查询和备份恢复证据。
6. **重跑本报告**：所有 14 条 `uncovered` 必须至少变为 `covered`，37 条 `partial` 必须逐项闭环；目标覆盖率和六维总分均不低于 90%。

## 8. 批准决定

**决定：重大修订后复审。**

当前架构可以指导统一 Agent、文本计费、图片异步任务、积分结算、安全和对账等核心主链路，但不能独立覆盖全部 111 条需求。实施前至少必须关闭 ARCH-C-001、ARCH-C-002 和 ARCH-M-007；其余 Major 问题需要完成修订或形成明确、获批准的阶段性豁免。没有发现直接需求冲突，因此不需要推翻现有总体拓扑或技术路线。

复审通过条件：

- 111 条需求全部具有唯一状态和实质架构证据；
- `uncovered=0`、`conflicting=0`；
- 所有 P0 需求为 `covered`，P1 的 `partial` 必须有批准的延期理由；
- TaskOutput/Asset 状态、五种能力、3 步/8 输出、15 分钟/24 小时、积分事件与 Web-only 范围完全一致；
- Supabase Queue、Data API、RLS、Realtime 与 Storage 约束符合届时最新官方资料。
