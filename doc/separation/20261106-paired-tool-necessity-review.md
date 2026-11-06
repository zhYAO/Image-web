# 配对发布工具必要性复核（2026-11-06）

结论：**当前 M6 与新 Web 必须有受控的协同发布顺序，但架构不要求必须安装这四个 root 文件。** 四文件工具是其中一种实现，不能把它当成部署唯一前提。安装保持暂停。它不是常驻服务，不新增 sudo/账户权限；风险来自新增916行可由root执行的发布代码，以及活动策略以后允许的入口、服务和指针操作。

推荐：**本次若沿用已经冻结的7a811＋原M6，保留已测协调器、严格限定此次operation，是当前验证最充分的路线；不应仅为少装几个文件，临时换成未测脚本。** 它不是架构唯一解，也不应继续扩展成发布平台。若优先目标是不新增永久root代码，可先设计并验证一次性流程；若优先目标是保留聊天可用性和降低以后发布耦合，应先完成兼容协议改造。两者目前都不是可直接替换的生产方案。“保持当前制品”只是本次比较基线，并非用户禁止修改。生产尚无M6表/新token订单，仍有重做兼容迁移的空间，但那需要SQL/应用、桥接制品及恢复回归，不能把新设计当作本次已完成的捷径。安装继续暂停，由主会话结合用户对维护时间/改动量的取舍决定，不因之前的条件性批准自动执行。

## 核对的实际架构

- 线上 zimage.service active，后端fb4fb09f909c0ae5dce98ebd0d9540386685ddb7；独立静态指针releases/release-fb4fb09f909c。不是数据库迁移能一并替换的单一事务对象。
- 05:58:52UTC生产仍41项迁移，private.chat_usage_settings不存在。四文件root工具/活动策略未安装，未进入维护。
- 新应用7a811已真实Mac构建/Linux运行层封包，四文件协调器39项Linux合成测试通过；真实账号/旧标签/正式F1与完整DB合同仍未验。已测不等于线上完成。
- 16项既有root辅助文件与仓库逐项SHA相同。现有普通发布器的限制是真实防护，不能只改版本标签或复用已opened的first-window操作绕过。

## 可重复行为证据

本次用已有、已验证的原生PostgreSQL17.11工具，新建私有Unix socket合成实例；应用37个应用迁移并使用已有Auth/Storage/队列shim（跳过4项cron部署）。没有TCP、生产连接、真实图片/密钥/模型调用或备份，实例已停止。费率和回答都是明确的合成测试数据。

| 组合/动作 | 实测结果 |
|---|---|
| 旧Web调用方式＋M5 | 按旧报价创建聊天冻结成功 |
| 新Web调用方式＋M5 | chat_usage_dispatch缺失，SQLSTATE42883，无资金变化 |
| 旧Web＋默认M6 | chat报价2→0；新聊天报chat_tariff_unavailable，无资金变化 |
| 旧订单跨M6恢复 | 同请求返回原订单，已保存旧结果可完成；说明保留历史兼容不等于新聊天兼容 |
| 旧F0请求＋M6，额外启用合成token费率 | 缺billing.rateVersion，报credit_price_changed，无资金变化 |
| 新Web请求＋M6＋合成费率 | 正确rateVersion和预算可冻结新token订单 |
| 用旧text_complete结算新token订单 | 报use_token_settlement，未把整笔预算扣完；需保留新协议结算/恢复能力 |

原子DO封装此前已在本地证明整条DDL出错回滚。但它不能把远端数据库、Web进程、两个文件指针、已加载的浏览器JS变成同一个ACID事务。协调器提供的是维护期间的顺序约束、持久状态与未知结果处理。

源代码佐证：

- 新Web apps/web/server/credits/credit-service.ts:184–185、209直接调用新RPC；旧fb4版本同文件:184调用credit_dispatch/text_start。
- M6第3–4/12行默认关闭费率；第86行改旧text_start入口，第89–93行换掉旧chat目录，第48行要求rateVersion，第99–101行保护token订单免于旧整额结算。
- 旧fb4的apps/web/features/credits/CreditsProvider.tsx:128只返回version/totalMinor；当前已打开的旧标签不会因服务器换了静态指针而自动替换JS。
- apps/frontend/src/platform/runtime-provider.tsx:19–27只在挂载/descriptor/attempt变化时拉取runtime；不能假定旧ready标签会在切换时自动重验或刷新。
- ops/aliyun/backend/transaction.py:58–60要求schema/Worker/catalog相同，:206–216的失败路线会选旧后端并可能重新开放。这不适用于当前跨协议M6。
- ops/aliyun/frontend/release.py:331要验证旧F0与当前后端；manifest.py:170–175验证精确verifiedBackendReleases。现有F0未批准B1，不能任意补兼容声明。
- ops/aliyun/backend/first-window.py:309–310拒绝重复已启动first-window；observer.py:404–437的诊断观察窗口会到期自动恢复入口，也不能拿来包住M6。

## 方案比较

| 方案 | 目前可用程度 | 停机与恢复 | 复杂度与权限 |
|---|---|---|---|
| 原M6＋当前四文件协调器 | 工具已实现/39项合成测试通过；线上门禁仍缺 | 全维护窗口贯穿迁移、Web、F1和身份检查；提交迁移意图后默认前向修复 | 新增4个root源文件/916行及20文件校验闭包；固定接口、无DB凭据、不常驻；不能解决旧F0协议或默认费率关闭 |
| 经审查的一次性维护流程/小脚本，复用已安装原语 | **可行方向，尚无完整受测实现** | 与原M6相同的必要维护/迁移后前向恢复边界；并不因为文件少就可无停机或任意回滚 | 可少装永久代码和独立策略格式；仍要root封口、服务/指针权限、持久意图和日志。人工遗漏和中断恢复成本可能上升 |
| 真正兼容的分阶段发布（expand-contract/版本化RPC） | **需修改SQL/应用并重新构建、验证，当前不可直接用** | DB扩展可先做而保留旧聊天；单实例Web切换仍须排空/短暂停机。只有旧前端及新旧订单恢复矩阵通过后，扩展期代码回滚才可信；收缩后另行界定 | 减少DB/Web/F1同时变更的耦合，复用普通发布器；增加过渡协议、桥接制品和回归工作，不能靠改迁移名/策略标签实现 |

“直接跑一次M6，再依次发布”不是第四条安全路线：实际证明无论先Web还是先M6，现有聊天协议都会有断点；且普通发布器可能按错误的回滚前提处理失败。

## 最小一次性流程仍不可删除的条件

1. 独立operation、同一deploy.lock、真实版本/指针/PID-start/DB状态和已审核产物绑定。
2. 持久封口后完整HTTP/framework/业务drain，核对队列和Worker租约，再停止旧服务。
3. M6提交前记录意图；未知响应只读核对，不重放，不以旧schema快照推断尚未提交。
4. 实际DB-after/ACL/RLS与财务保护记录核对；不能只接受健康200或一个成功布尔值。
5. M6提交后禁止自动回旧代码、数据库降级、历史退款或重试。
6. 在checking封口下完成新后端/F1批准与真实身份检查，明确旧标签及聊天可用性。
7. 开放前持久记录可能已开放；任何不确定结果保持封口，按真实状态恢复。

现有工具已复用不可变产物校验、drain、select/start/stop、前端seal/approval/probe原语，不能再以“复用”名义删除这些约束。可简化的候选是额外的哈希链＋镜像state、多个自定义证明格式、四模块永久安装方式；是否能安全删减，须以一个具体一次性方案及故障测试证明，不能现在宣称它更安全。

## 兼容方向至少要验证什么

保留旧credit_dispatch的start/catalog语义；新增/版本化token catalog/start/complete，由新应用明确选择；按订单保存的计费协议走可信结算，不能允许旧整额结算捕获新token预算。新前端/后端还需可验证的桥接协议或桥接制品，既有不可变F0不允许就地改verifiedBackends。覆盖旧Web＋扩展DB、新Web＋扩展DB、旧标签＋新后端、已有旧订单恢复，以及出现新token订单后的代码回退；最后单独控制旧协议收缩。设计选定前不改生产，也不修改原M6或重标现有制品。

独立fresh gpt-6-astra只读审查与上述结论一致：协调必要，特定四文件框架非必需；一次性与兼容方案均未完成可用性证明。无新生产操作、root安装或付费调用。原代码和提案保留作备选，不删除已有工作。

证据：verification/m6-release-necessity-matrix-v2.{json,log}（完整财务行hash；首轮matrix日志也保留）、recheck-m6-release-necessity.py、此前migration6-local-compatibility-v3.json及paired-coordinator-linux-final.json。安装保持暂停，下一步由主会话决定是否进入兼容设计或具体一次性流程验证。
