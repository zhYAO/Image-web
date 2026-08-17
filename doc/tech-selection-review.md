# Zima 需求—技术选型审计报告

| 字段 | 内容 |
| --- | --- |
| 审计日期 | 2026-08-17 |
| 审计对象 | 修订前 108 条需求与对应 `tech-selection.md`；修订后 111 条需求复核 |
| 产品真相源 | `C:\Users\yao.zhao\workspace\zima\doc\requirements.md` |
| 技术依据 | `C:\Users\yao.zhao\workspace\zima\doc\tech-selection.md` |
| 审查方法 | completeness、clarity、consistency、testability、traceability、feasibility 六维等权 |
| 状态词 | `covered` / `partial` / `uncovered` / `conflicting` / `external-gated` |
| 结论 | 修订前为有条件通过，存在 Major 缺口；本轮文档修复完成后可进入实现前复审，生产发布仍受 EXT-001～005 门控 |

## 1. 审计口径

1. 逐条需求只有一个主状态；`partial` 表示技术方向存在但缺少可直接实现或验证的机制。
2. 仅出现需求 ID、ID 范围或页面名不算 `covered`，必须能指向接口、类型、事务、状态、失败行为或测试。
3. 下文 108 行矩阵记录的是**本轮修订前**的覆盖质量；“修复与测试”列记录本轮已写入文档的修订结果。
4. EXT-001～005 是真实外部发布依赖，统一标为 `external-gated`，不把未完成的账号、审批或生产证据伪装为代码能力。
5. 本报告是文档桌面审查，不代表供应商账号、生产 Supabase、真实 SMTP、法务材料或运行时测试已经完成。

## 2. 六维质量评分

### 2.1 修订前评分

| 维度 | 分数 | 主要依据 |
| --- | ---: | --- |
| 完整性 | 76 | 页面结构和图片主链路较完整，但统一文本入口、项目会话、文本计费、输出格式及素材授权证据未形成闭环 |
| 清晰度 | 84 | 状态机、3 步/8 输出和 15 分钟/24 小时窗口清楚；“桌面端”“文本免费”和账本单元含义存在歧义 |
| 一致性 | 74 | 技术文档与新产品决策在原生范围、文本计费、Supabase key 术语及 Queue API 上冲突 |
| 可测试性 | 82 | 主要场景有测试 ID；文本 usage 失败结算、跨项目上下文、无障碍和可用性分母不足 |
| 可追踪性 | 71 | 有族级追踪表，但大量 ID 范围引用不能证明逐条实质覆盖 |
| 可行性 | 73 | 模块化单体和 Supabase 路线可行；不存在的 Queue API 与未定义文本账本会阻塞实现 |
| **等权总分** | **77** | `(76 + 84 + 74 + 82 + 71 + 73) / 6 = 76.67`，四舍五入为 77 |

批准建议：**Approve with Conditions / 重大问题修复后复审**。在 MAJ-001～009 未关闭前，不应开始计费、Queue 或统一 Agent 主链路实现。

### 2.2 修订后复核评分

| 维度 | 分数 | 修订结果 |
| --- | ---: | --- |
| 完整性 | 93 | 111 条需求已覆盖统一入口、项目会话、图片/文本 BillableUnit、审核、格式和删除链路 |
| 清晰度 | 92 | Web-only、一次性 JSON、usage 失败结算和 Queue 事务语义已固定 |
| 一致性 | 94 | 三份文档统一 Web 范围、publishable key、文本计费和项目上下文边界 |
| 可测试性 | 94 | 新增 T-AGENT-CHAT-01、T-TEXT-BILLING-01，并补充 SLI、契约和故障注入 |
| 可追踪性 | 93 | 本报告保留 108 条基线证据，修订后追踪表覆盖 111 个唯一需求 ID |
| 可行性 | 90 | 使用官方 Queue read/send delay/archive；生产可行性仍依赖 EXT-001～005 |
| **等权总分** | **93** | `(93 + 92 + 94 + 94 + 93 + 90) / 6 = 92.67`，四舍五入为 93 |

修订后建议：**文档层面通过实现前复审**。这不是生产就绪声明；任何外部门控未完成时，只能使用 Mock 或封闭验证配置。

## 3. 主要问题与处置

| 编号 | 严重度 | 修订前问题 | 风险 | 本轮处置 |
| --- | --- | --- | --- | --- |
| MAJ-001 | Major | 文本咨询声明免费，缺少文本价表、预扣和失败 usage 结算 | 无法实现统一账本，可能少扣、重复扣或透支 | 新增 AGENT-008～010、CREDIT-010、BillableUnit、文本公式与事务测试 |
| MAJ-002 | Major | Agent 图片结果复盘超出 Phase 1 技术能力且未定义像素读取 | 隐式引入多模态调用、成本和隐私链路 | 明确 Phase 1 不做图片结果复盘，限制为咨询/澄清/解释 |
| MAJ-003 | Major | Worker 伪代码调用不存在的 `queue.reschedule` | 实现阶段直接阻塞或产生非原子轮询 | 改为 logged Basic Queue 的 `read`、延迟 `send`、`archive` 事务 |
| MAJ-004 | Major | requirements 使用 legacy anon key，技术文档使用 publishable key | 密钥基线和构建扫描标准不一致 | 新项目统一 publishable key，legacy anon 仅作兼容术语 |
| MAJ-005 | Major | 108 条需求主要用范围引用追踪 | 遗漏无法被审计，测试归属不明确 | 新增逐项基线矩阵并把新增需求映射到具体机制与测试 |
| MAJ-006 | Major | 上传授权只在 UI/API 文案出现，未规定持久化证据 | 无法证明用户、时间和政策版本 | upload intent 同事务写不可变授权确认记录 |
| MAJ-007 | Major | ASSET-005 只有格式要求，无 ready 前校验/转码链路 | 扩展名与真实内容不一致，透明图失效 | 增加受限下载、解码、alpha/尺寸检查、Sharp 转码和结果审核 |
| MAJ-008 | Major | 缺少统一 Agent endpoint、项目消息和文本回合状态 | 首页与工作台可能形成两套规则，模型重放重复计费 | 固定 `/api/v1/agent/respond`、Conversation/Message/Turn 与幂等键 |
| MAJ-009 | Major | 内容安全仅为一句原则，没有 adapter、状态和失败结算 | 审核拒绝仍可能 ready 或扣费 | 定义 ContentSafetyAdapter、两阶段审核、隔离清理与 release |
| MIN-001 | Minor | “桌面端优先”易被理解为原生桌面 | 错误创建 Electron 范围 | 全文改为响应式 Web 宽屏与 375px 移动 Web |
| MIN-002 | Minor | 无障碍与 i18n 没有固定工具 | 验收方式不一致 | 固定 next-intl 与 `@axe-core/playwright` |
| MIN-003 | Minor | 可用性、受理和状态延迟分母不够明确 | 指标可被选择性解释 | 固定 5 分钟探测、1,000/500 样本与原始数据口径 |
| MIN-004 | Minor | Worker 并发未落到执行配置 | 容量测试无法复现 | 固定默认并发 2，可配置但必须重新验证 |
| MIN-005 | Minor | 五能力缺少角色、格式、倍率和语言契约表 | 供应商映射容易漂移 | 增加能力注册表契约和中英文 fixture 测试 |

## 4. 原 108 条需求逐项审计

### 4.1 邀请与认证（11）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| AUTH-001 | 邀请码准入及额度 | covered | 3.4、4.2 定义预约/核销接口和邀请表 | 低 | 保留；T-AUTH-01 |
| AUTH-002 | 核销开户发积分同事务 | covered | `finalize_invitation` 锁码、建 profile/账户、grant | 低 | 保留；T-AUTH-01/02 |
| AUTH-003 | OTP 失败不消耗且幂等 | covered | 预约与核销分离、challenge 幂等 | 低 | 保留；T-AUTH-02/03 |
| AUTH-004 | Supabase OTP + 自定义 SMTP | covered | Supabase Auth/SMTP 边界明确，生产证据受 EXT-001 门控 | 邮件未实测 | 保留外部门控；T-AUTH-04 |
| AUTH-005 | 匿名只读公开内容 | covered | RSC 分支、profile gate、RLS | 低 | 保留；T-AUTH-04、T-RLS-01 |
| AUTH-006 | 登录只恢复安全草稿 | covered | DraftStore 只保存文本/选择/资产引用 | 低 | 保留；T-AUTH-04 |
| AUTH-007 | 邀请摘要与三维限流 | partial | 有摘要和限流描述，但缺少限流键竞争/过期测试细节 | 枚举、暴力尝试 | 在 3.4 固定 IP/邮箱/摘要；T-AUTH-05 |
| AUTH-008 | 无邀请 Auth 记录不可进入应用 | covered | profile gate 与 RLS 双重限制 | 低 | 保留；T-AUTH-05 |
| AUTH-009 | 10 分钟预约 | covered | `reserve_invitation` 保存 challenge/expiry | 低 | 保留；T-AUTH-03 |
| AUTH-010 | 单码单预约与重放 | partial | 有唯一约束方向，但重复请求返回契约不够具体 | 并发占码 | 明确相同邮箱/challenge 返回原结果；T-AUTH-03 |
| AUTH-011 | OTP 后以已验证身份原子核销 | covered | BFF claims + private RPC + auth.users 交叉验证 | 低 | 保留；T-AUTH-01/02 |

### 4.2 首页与导航（4）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| HOME-001 | 首屏输入/素材/Skill/工具 | covered | 3.1 HomeComposer 与组件边界 | 低 | 统一入口复用 `/agent/respond`；T-HOME-01 |
| HOME-002 | 四快捷工具及文本生成入口 | covered | ToolPicker 与明确意图门控 | 低 | 保留；T-GATE-01 |
| HOME-003 | 登录最近项目/匿名案例 | covered | RSC 身份分支和安全 DTO | 低 | 保留；T-HOME-01 |
| HOME-004 | 统一导航 | covered | AppNavigation 与 route metadata | 低 | 增加 Web 宽屏/375 验收；T-NFR-UX-01 |

### 4.3 项目（3）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| PROJ-001 | 首任务自动建项目 | covered | task RPC 可原子建项目 | 文本首回合原先未覆盖 | 扩展到 reserve_agent_turn；T-PROJECT-01、T-AGENT-CHAT-01 |
| PROJ-002 | 查询改名排序删除恢复 | covered | 3.5 查询/软删/RLS | 低 | 保留；T-PROJECT-01 |
| PROJ-003 | 删除即隐藏，7 天清理 | covered | purge_after 与 cleanup job | 低 | 对话一并清理；T-DELETE-01 |

### 4.4 资产（6）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| ASSET-001 | 1 主图 + 3 角色参考图 | covered | CreateTask schema 与角色校验 | 低 | 增加能力角色契约；T-ASSET-01、T-IMG-01 |
| ASSET-002 | 格式/20MiB/真实解码 | covered | TUS finalize + magic bytes + Sharp | 低 | 保留；T-ASSET-01 |
| ASSET-003 | 原图/输出/缩略图独立派生 | covered | assets 父关系及输出 FK | 低 | 保留；T-ASSET-02 |
| ASSET-004 | 私有与短签名 URL | covered | private bucket、owner RLS、signed URL | 低 | 保留；T-RLS-01 |
| ASSET-005 | 抠图 PNG，其他 JPG/PNG | partial | 只有需求和 provider format 元数据，缺少 ready 前转码 | alpha 丢失、伪格式 | 新增 materializeProviderOutput；T-IMG-01、T-ASSET-02 |
| ASSET-006 | 单输出 7 天回收 | covered | 删除/恢复 API、purge_after | 低 | 保留；T-DELETE-01 |

### 4.5 Agent（原 8）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| AGENT-001 | 单一视觉 Agent | covered | UI/配置无 Agent 切换 | 低 | 保留；T-AGENT-01 |
| AGENT-002 | 咨询及图片结果复盘 | conflicting | 技术文档未定义像素读取、额外模型和隐私/计费 | 隐式多模态范围 | 修订为不做结果复盘；T-AGENT-01 负向 |
| AGENT-003 | 无关问题拒绝 | partial | 只有业务范围说明，未保证不调用文本模型 | 无效消耗与越界回答 | 门控增加 deterministic refuse；T-AGENT-CHAT-01 |
| AGENT-004 | 结构化计划服务端校验 | covered | Zod ExecutionPlan + 能力/成本/上限校验 | 低 | 保留；T-PLAN-01 |
| AGENT-005 | 模型不得决定供应商/扣款 | covered | strict schema 拒绝 provider/model/ledger 字段 | 低 | 保留；T-API-01 |
| AGENT-006 | 中立 TextModelAdapter/单配置 | partial | adapter 与单配置存在，但没有项目会话和 usage 契约 | 双实现、usage 漂移 | 扩展 estimate/generate/usage；T-TEXT-01 |
| AGENT-007 | 配置切换审计与失败降级 | partial | 管理 RPC 有方向，缺少保留输入和禁止静默切换的完整路径 | 丢草稿、模型漂移 | `/agent/respond` 错误契约；T-TEXT-01 |
| AGENT-008 | 文本免费并记录成本 | conflicting | 与“所有实际 token 扣积分”决策冲突，账本仅覆盖图片 | 无法收费或失败错账 | 改为 token reserve/usage settle；T-TEXT-BILLING-01 |

### 4.6 Tool（8）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| TOOL-001 | 三来源图片门控 | covered | evaluateToolGate 明确三来源 | 低 | 保留；T-GATE-01 |
| TOOL-002 | 上传/建议/模糊/未选 Skill 不触发 | covered | negative gate 分支 | 低 | 文本分支纳入统一入口；T-GATE-01 |
| TOOL-003 | 通过后自动执行并展示报价 | covered | execution card + create task | 低 | 保留；T-AGENT-01 |
| TOOL-004 | 3 步/8 输出硬上限 | covered | validateExecutionPlan 服务端断言 | 低 | 保留；T-PLAN-01 |
| TOOL-005 | 余额不足不入队并保留输入 | covered | 原子 RPC 余额锁与 preservedDraft | 低 | 文本余额不足同规则；T-TEXT-BILLING-01 |
| TOOL-006 | 人物政策与前置拒绝 | partial | 政策存在，缺少统一审核端口和失败结算 | 审核旁路 | 新增 ContentSafetyAdapter；T-POLICY-01 |
| TOOL-007 | Tool/Skill 互斥 | covered | strict request + gate reject | 低 | 保留；T-GATE-01 |
| TOOL-008 | 换背景显式两步 | covered | compiler 展开、输出上限和派生关系 | 低 | 保留；T-REPLACE-01 |

### 4.7 图片能力与质量（10）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| IMG-001 | 透明抠图与保留输入 | partial | ProviderAdapter 有抠图，alpha/边缘结果契约不足 | 不透明 PNG、主体破坏 | 强制 PNG/alpha + 基准；T-IMG-01、T-QUALITY-01 |
| IMG-002 | 换背景描述/参考角色 | partial | 能力存在，参考角色映射未逐项固定 | 主图/参考图混淆 | 增加角色契约表；T-IMG-01 |
| IMG-003 | 固定比例与自定义尺寸 | partial | 注册表记录尺寸，但 custom schema 验证不具体 | 入队后供应商拒绝 | 冻结尺寸能力并契约测试；T-IMG-01 |
| IMG-004 | 2x/4x 能力发现 | partial | getCapabilities 存在，倍率失败路径未具体 | 不支持倍率仍扣费 | 注册表入队前拒绝；T-PROVIDER-01 |
| IMG-005 | 中英文生成与输出上限 | partial | generate/上限存在，缺少中英文 fixture | 提示词映射漂移 | 增加中英文契约；T-IMG-01 |
| IMG-006 | 预览下载删除反馈派生 | covered | 工作台操作及相应 BFF | 低 | 保留；T-RESULT-01 |
| IMG-007 | 单输出重试不影响成功项 | covered | 子任务、新价、原事实不改 | 低 | 保留；T-PARTIAL-01 |
| IMG-008 | 60 组授权基准 | covered | quality-benchmark manifest | 素材本身仍需真实授权 | T-QUALITY-01；生产证据待建 |
| IMG-009 | 硬检查 ≥95% | covered | evaluateBenchmark + 解码/格式/alpha/尺寸 | 低 | 保留；T-QUALITY-01 |
| IMG-010 | 双盲评 ≥4/5、重大破坏零 | covered | 双评审、第三人复核、一票否决 | 低 | 保留；T-QUALITY-01 |

### 4.8 Skill（5）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| SKILL-001 | 官方声明式、无任意代码 | covered | SkillVersion schema/发布校验 | 低 | 保留；T-SKILL-01 |
| SKILL-002 | 版本冻结 | covered | immutable version + task FK | 低 | 保留；T-SKILL-01 |
| SKILL-003 | 浏览启停且仅明确选择生效 | covered | 页面服务 + explicit gate | 低 | 保留；T-GATE-01 |
| SKILL-004 | 发布前校验契约 | covered | compile/publish schema | 低 | 保留；T-SKILL-01 |
| SKILL-005 | retired 不用于新任务 | covered | published/retired 状态过滤和历史摘要 | 低 | 保留；T-SKILL-01 |

### 4.9 精选社区（4）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| COMM-001 | 仅管理员策展 | covered | published 安全投影、无投稿 API | 低 | 保留；T-COMM-01 |
| COMM-002 | 案例详情不暴露供应商 | covered | curated DTO 白名单 | 低 | 保留；T-COMM-01 |
| COMM-003 | 用同款只预选不执行 | covered | draft 恢复和登录 gate | 低 | 保留；T-COMM-01 |
| COMM-004 | 只引用授权展示资产 | covered | case-assets 独立 bucket/授权证据 | 低 | 上传授权记录补强；T-SECURITY-01 |

### 4.10 任务（13）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| TASK-001 | 创建幂等 | covered | 用户+幂等键唯一和已有结果返回 | 低 | 保留；T-IDEMP-01 |
| TASK-002 | 报价/预扣/记录/入队一致 | covered | `create_task_and_enqueue` 单事务 | 低 | 保留；T-CRASH-01 |
| TASK-003 | Queue 只含任务 ID/版本 | covered | QueueMessageSchema | 低 | 保留；T-IDEMP-01 |
| TASK-004 | 可见性窗口/条件更新/令牌 | conflicting | 状态原则正确，但伪代码调用不存在的 `queue.reschedule` | Worker 无法实现 | 改官方 read/send delay/archive；T-CRASH-01 |
| TASK-005 | 错误分类与最多 3 Attempt | covered | non-retryable/retryable 分类 | 低 | 保留；T-ATTEMPT-01 |
| TASK-006 | 未知先查询对账 | covered | submissionId 保存、getStatus、reconciling | 低 | 保留；T-RECON-01 |
| TASK-007 | Realtime + 轮询兜底 | covered | private Broadcast + Query polling | 低 | 保留；T-RESULT-01 |
| TASK-008 | 只重试失败输出 | covered | linked child task | 低 | 保留；T-PARTIAL-01 |
| TASK-009 | 用户重试新报价/新预扣 | covered | 子任务独立 price/version | 低 | 保留；T-ATTEMPT-01 |
| TASK-010 | TaskAttempt 与 submission 唯一 | covered | execution token/conditional insert | 低 | 保留；T-ATTEMPT-01 |
| TASK-011 | 单用户一活动任务 | covered | partial unique index，queued 仍全额预扣 | 低 | 保留；T-CAPACITY-01 |
| TASK-012 | 全局 100 排队容量 | covered | singleton capacity 行与任务事务 | 低 | 保留；T-CAPACITY-01 |
| TASK-013 | Phase 1 轮询必需、回调非必需 | covered | provider submit/getStatus | 低 | 官方 Queue 延迟轮询；T-PROVIDER-01 |

### 4.11 积分（原 9）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| CREDIT-001 | 整数与只追加账本 | covered | credit_account + ledger 约束 | 低 | 保留；T-LEDGER-01 |
| CREDIT-002 | 前台统一积分 | covered | 安全 DTO 不含供应商成本 | 低 | 保留；T-LEDGER-01 |
| CREDIT-003 | 逐输出预扣/结算/释放 | partial | 只定义 image output，无法表达 text turn | 文本错账 | 泛化 BillableUnit；T-TEXT-BILLING-01 |
| CREDIT-004 | 实际不超过冻结报价 | covered | `min(actual,reserved)` + 平台差额 | 文本尚未接入 | 扩展文本 usage 上限；T-PRICE-01 |
| CREDIT-005 | 账本幂等 | covered | 唯一业务事件 key | 低 | 文本 turn 同键；T-LEDGER-01 |
| CREDIT-006 | Phase 1 无支付 | covered | 页面/API 负向范围 | 低 | 保留；T-LEDGER-01 |
| CREDIT-007 | 版本化能力价表 | partial | 图片能力条目明确，文本 token union 未定义 | 价格 schema 分叉 | 增加 image/text discriminated union；T-PRICE-01 |
| CREDIT-008 | 邀请额度约 50 标准输出 | covered | EXT-005 未批阻止生产发放 | 真实数值待外部确认 | 保持 external gate；T-PRICE-01 |
| CREDIT-009 | 新价只影响新任务 | covered | 版本冻结、逐项取整、重试新报价 | 低 | 文本 turn 同样冻结；T-PRICE-01 |

### 4.12 安全与隐私（12）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | 浏览器表 RLS + 跨用户测试 | covered | migration/GRANT/RLS/pgTAP 规则 | 低 | 保留；T-RLS-01 |
| SEC-002 | 浏览器 key 与服务端 secret | conflicting | requirements 使用 anon 术语，技术文档已用 publishable | 构建基线混乱 | 统一 publishable；T-SECURITY-01 |
| SEC-003 | 私有路径与短签名 URL | covered | uid object key + signed URL owner check | 低 | 保留；T-RLS-01 |
| SEC-004 | 日志脱敏 | covered | Pino 固定 redaction | 低 | 加入 turn/token 字段但不记内容；T-NFR-OBS-01 |
| SEC-005 | 管理变更审计 | covered | 受控 RPC、reason、before/after | 低 | 保留；T-ADMIN-01 |
| SEC-006 | 素材授权证据/禁训练公开 | partial | 页面确认存在，缺少不可变持久化结构 | 无法举证 | 新增 asset_rights_attestations；T-SECURITY-01 |
| SEC-007 | 前置与结果审核、拒绝不扣 | partial | 原为原则句，缺少端口/状态/清理 | 审核旁路、误扣 | ContentSafetyAdapter + output state；T-POLICY-01 |
| SEC-008 | 法务/ICP/跨境 | external-gated | 仅能记录发布门槛，不能由代码完成 | 不合规发布 | EXT-004；T-EXPANSION-GATE-01 |
| SEC-009 | 管理写入受控函数 | covered | private RPC/权限撤销/审计 | 低 | 保留；T-ADMIN-01 |
| SEC-010 | GRANT + RLS 双门槛 | covered | Data API 明确授权模板 | 低 | 保留；T-DATAAPI-01 |
| SEC-011 | 账户删除 7 天及会话/数据清理 | covered | request/revoke/cleanup 状态机 | 原未含 AgentMessage | 补消息/turn 清理；T-ACCOUNT-DELETE-01 |
| SEC-012 | 180/30 天保留 | covered | retention job 和去标识规则 | 低 | 保留；T-ACCOUNT-DELETE-01 |

### 4.13 非功能（15）

| ID | 摘要 | 修订前状态 | 技术证据或缺口 | 风险 | 修复与测试 |
| --- | --- | --- | --- | --- | --- |
| NFR-PERF-001 | BFF p95 ≤3 秒 | covered | 性能事件和 1,000 样本方向 | 低 | 固定起止/分母；T-PERF-01 |
| NFR-PERF-002 | 状态可见 p95 ≤5 秒 | covered | rowVersion/DB 时间/Broadcast/poll | 低 | 固定 500 样本分报；T-PERF-01 |
| NFR-PERF-003 | 100 排队、Worker 并发 2 | partial | 100 容量明确，Worker 并发未固定 | 测试不可复现 | 固定默认 2；T-PERF-01 |
| NFR-PERF-004 | 列表缩略图、按需原图 | covered | ProjectCover/preview signed URL | 低 | 保留；T-PERF-01 |
| NFR-REL-001 | Web/BFF 99.0% | partial | 有目标和 SLS，缺少探测分母/排除规则 | 可用性被美化 | 固定 5 分钟原始序列；T-NFR-REL-01 |
| NFR-REL-002 | 扩大内测前备份恢复 | external-gated | 阶段门槛明确，套餐/演练未完成 | 扩容不可恢复 | EXT-003/004；T-EXPANSION-GATE-01 |
| NFR-REL-003 | Worker 重启恢复 | covered | Queue/Postgres 真相、进程强杀测试 | 低 | 官方 Queue 语义补强；T-CRASH-01 |
| NFR-REL-004 | 供应商故障保留证据 | covered | normalized error/task/input/ledger | 低 | 保留；T-NFR-REL-01 |
| NFR-UX-001 | 响应式 Web-only 范围 | conflicting | 文档仍写“桌面端优先”，可能解释为原生桌面 | 范围膨胀 | 改 Web 宽屏 + 375；T-NFR-UX-01 |
| NFR-UX-002 | 键盘与可见焦点 | partial | Radix/键盘原则存在，未固定自动 a11y 工具 | 回归漏检 | 加 `@axe-core/playwright`；T-NFR-UX-01 |
| NFR-UX-003 | zh-CN i18n key/中英文 prompt | partial | 有 i18n 原则，未固定消息库/目录 | 文案散落 | 固定 next-intl；T-NFR-UX-01 |
| NFR-UX-004 | 全异步状态 | covered | task/status UI state model | 低 | 保留；T-NFR-UX-01 |
| NFR-OBS-001 | 任务/成本/反馈指标 | covered | OperationalEvent 和 SLS 指标 | 文本调用未纳入 | 增加 agent turn/usage；T-NFR-OBS-01 |
| NFR-OBS-002 | ID 关联且不依赖内容 | covered | request/task/step/output + redaction | turn ID 原缺失 | 增加 turnId；T-NFR-OBS-01 |
| NFR-OBS-003 | 四类关键告警 | covered | ledger/unknown/dead-letter/reserve 告警 | 文本 usage 超限原缺失 | 增加文本/契约/容量告警；T-NFR-OBS-01 |

## 5. 外部依赖审计

| ID | 状态 | 依赖 | 技术文档允许做什么 | 未完成时禁止声称 |
| --- | --- | --- | --- | --- |
| EXT-001 | external-gated | 发信域名、阿里云邮件、SPF/DKIM/DMARC | 本地 Mailpit、SMTP 配置校验、Mock | 正式 OTP 送达可用 |
| EXT-002 | external-gated | 百炼/视觉智能账号、配额、限流、审核、成本 | ProviderAdapter、Mock、脱敏契约测试 | 五种真实能力与审核已生产可用 |
| EXT-003 | external-gated | Supabase 新加坡项目、Queues、Storage、凭证 | 本地 migration、pgTAP、生成类型 | 生产基础设施或备份就绪 |
| EXT-004 | external-gated | ICP、隐私、用户协议、跨境评估 | 数据流清单、发布 gate | 法务/合规批准完成 |
| EXT-005 | external-gated | 首版图片/文本价表、邀请整数额度 | 版本化 schema、公式和假价禁入检查 | 可真实扣费或发放生产邀请 |

## 6. 交互决策记录

| 决策 | 已确认选择 | 选择理由 | 被否决范围 | 落点 |
| --- | --- | --- | --- | --- |
| 客户端范围 | 仅响应式 Web | 单代码基线验证需求，避免原生端分散 Phase 1 资源 | Electron、Windows/macOS、iOS/Android 原生 | NFR-UX-001、AGENTS 2/3.2 |
| 响应式能力 | Web 宽屏全创作；375px 登录/查看/预览/下载 | 保留移动场景但不承诺复杂编辑 | 375px 完整创作 | tech 3.6、T-NFR-UX-01 |
| Agent 入口 | 同一输入确定性分流文本/图片 | 首页和工作台共享规则，避免两套门控 | 单独聊天页、模型自行选 Tool | AGENT-009、`/agent/respond` |
| 文本会话 | 项目内多轮，首次可建项目 | 上下文与资产/任务同一所有权边界 | 跨项目记忆、全局聊天 | AGENT-010、Conversation |
| 上下文压缩 | 最近消息按 token 预算截取 | 行为可审计且不产生隐藏费用 | 隐藏 LLM 摘要 | T-AGENT-CHAT-01 |
| 图片复盘 | Phase 1 不做 | 避免新增多模态读取、隐私和计费链路 | 输出图片视觉复盘 | AGENT-002 |
| 文本计费 | 所有实际模型 token 扣积分 | 用户已确认实际消耗均计费 | 文本免费/平台长期补贴 | AGENT-008、CREDIT-010 |
| 失败计费 | 有可信 usage 即结算，无 usage 才释放 | 与真实成本一致且账本可对账 | 按 HTTP 成败一刀切 | T-TEXT-BILLING-01 |
| 文本响应 | Phase 1 一次性 JSON | 降低流式中断和部分 usage 状态复杂度 | SSE/流式 turn | tech 4.2/4.5 |

本轮没有剩余需要产品选择且会改变当前范围的疑问，因此未追加新的交互卡片。真实价格、账号能力、审核供应商和法务结论属于已登记外部依赖，不应由文档作者替用户猜测。

## 7. 修订后残余风险

| 风险 | 等级 | 当前控制 | 下一门槛 |
| --- | --- | --- | --- |
| 供应商可信 usage 字段在失败响应中的可得性未知 | High | TextModelAdapter 允许有/无 usage 两条明确结算路径，禁止估算冒充实际值 | EXT-002 真实故障联调与 T-TEXT-BILLING-01 |
| 五种图片能力、格式和审核的生产映射未验证 | High | 版本化注册表、Mock 契约、ready 前服务端校验 | EXT-002 + 60 组基准 |
| 首版文本/图片积分值未批准 | High | EXT-005 阻止生产邀请和真实扣费，不提供猜测默认值 | 成本核验与 PriceBookVersion 审批 |
| SMTP、ICP、隐私和跨境材料未完成 | High | 发布 gate，不写成已完成能力 | EXT-001/004 |
| Supabase 生产 Queue/Storage 与扩大内测备份演练未完成 | Medium | 本地 pgTAP/故障测试；扩大内测单独门槛 | EXT-003、T-EXPANSION-GATE-01 |
| 需求 ID 已从 108 增至 111 | Low | 修订后唯一性与追踪脚本校验 | 后续变更必须同步三文档和本报告 |

## 8. 实现前批准清单

- 111 个需求 ID 唯一，AGENT-009、AGENT-010、CREDIT-010 有独立测试映射。
- 统一入口不会让明确图片意图进入文本模型，也不会让无关问题调用任何模型。
- 文本 turn 的 reserve/capture/release、失败 usage、上限和幂等由数据库测试证明。
- Queue 仅使用当前官方 `read`、延迟 `send`、`archive`；消息仅含任务 ID 与必要版本。
- 输出只有通过真实解码、格式/alpha/尺寸契约和结果审核后才能 `ready`。
- Web 构建不包含 Electron 或原生客户端；375px 只承诺已确认关键路径。
- EXT-001～005 的未完成项在发布检查中继续阻断相应生产声明。

## 9. 参考

- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Supabase Queues API](https://supabase.com/docs/guides/queues/api)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- `C:\Users\yao.zhao\workspace\lobehub-canary\LICENSE`

