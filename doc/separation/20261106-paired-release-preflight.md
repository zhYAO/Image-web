# 实际配对发布准备与待决策项（2026-11-06）

当前仅准备，不安装活动策略、不封口/切换、不执行M6或发布价格。生产仍旧fb4后端/F0，工具为cdf5991来源，应用为7a811；原分支和用户next-env保留。四个工具已安装不等于操作策略已批准。无付费调用或新凭据。

## 可审阅的策略候选

paired-release-policy.PROPOSED.json包含当前实际旧/新后端、两个前端namespace、旧artifact、新Linux manifest、前端candidate/payload、M6原文/单语句载荷、独立浏览器验证器、配置/ingress/Worker及DB before/expected-after摘要。策略验证器已接受这份候选的字段及时间边界。具体字节/摘要/提出的4小时时窗见paired-release-policy-review-manifest.json。

这只是本地候选，4小时时窗尚未与用户约定；不能直接复制成服务器活动策略。当前服务器/etc/zimage/paired-release-policy.json不存在。候选摘要变化、延长过期时间或新费率/开关变化都须重新审阅。新的有效时间应在实际维护安排确定后重新冻结，而非偷偷延长已批准策略。

真实before于06:56:53UTC在单个只读SQL快照重取，规范化SHA仍872f628d62fd77352a1772fe9789e41ce7fe855bec4cfb0a9d41ad2c05456801，41迁移、M6不存在。expected-after为本地精确M6合成结果1759a1d3eade413b59ad827b238a3dea814fd2a2b8ee69821e7018edce6120f4，不是真实after。paired-before-snapshot.sql可重取；paired-after-snapshot.sql必须等真实单次授权提交后查询，缺表直接失败。

## 封口后的资金、队列和租约证明

paired-sealed-financial-check.sql是一条SELECT，无queue read/claim、RPC、副作用或原始客户行导出。它在数据库内对12个既有关系完整行做SHA256、按行hash排序并保留重复及行数；每表无行时显式保留空摘要。范围含钱包/操作/账本/幂等记录/管理员审计/配额账本、套餐四表、generations和generation_work。新M6空操作/回执表必须另验零行，不能用它们填补before缺表。

financialRowsSha256的固定算法：用协调器core.digest，即UTF-8 JSON对象键排序、紧凑分隔符、末尾LF，对对象{"scope": observation.scope,"protectedRows": observation.protectedRows}求SHA256。不要把checkedAt、活动计数或cron时间纳入此稳定资金摘要，也不能只比行数。所有原始客户数据留在DB；完整实际摘要观测仅保留本地0600证据，不进入源码提交。

所有自动可领取/维护条件统一按22分钟前瞻评估，包括next_run_at、lease到期、reference write_until、preview保留期及promotion过期。processing且attempts>=5会自动被标failed，也计入屏障，不能因无重试次数而忽略这种写入。

activeJobs为查询声明的13项之和：全部队列消息、明确可运行的图片、processing套餐阶段、清理任务及账户清理、孤儿引用、preview ledger保留期、promotion绑定，以及图片/参考图/服装到期和孤儿意图。计数可重叠，因为门禁仅接受零；服装意图故意保守，假阳性必须核对，不能当作删除授权。activeLeases为生成、生成清理、cleanup_jobs、服装清理、creative_batches、apparel_runs、账户清理、引用清理及引用write_until九项之和；后者按所有状态保守阻塞以保护晚到Storage写。历史unknown只单列数量，其完整状态仍受资金摘要保护；不重试、退款、清空、改写或随意重新分类。

两个已有cron仍在运行：generation每分钟、cleanup每15分钟。Web封口不停止它们。07:10:02UTC扩展V2未封口观测中，13项任务屏障和九类租约均0，历史unknown图片3条保留。此观测proofReady=false，绝不作为封口后证明。若实际维护时有活动或变化，保持封口/停止后续动作，先核实；不得通过清理历史、强行归零或擅自暂停cron来通过门禁。若确需暂停/恢复某个cron，应另列准确jobname、期间影响及恢复核对并请求具体批准。

实际顺序：先取得本人旧版认证回执，再由已批准协调器seal/drain/stop；随后在真实封口状态重取before元数据、资金/队列/租约及当前Worker/配置/cron/Free。PROOF_FIELDS中的checkedAt必须是观测UTC秒数（不能换成生成证明的较新时间），有效期120秒；before migrationNonce=null。仅在全部门禁满足时，由可信操作者按精确策略生成并审批root数据库证明，authorize-migration持久化单次意图并产生nonce。这个准备文档不会生成或安装这种证明。

提交精确M6载荷最多一次。响应不明先查历史和对象，绝不重放。实际after先验证42条历史、前41条完全一致、最后唯一chat_usage_settlement且实际14位版本大于旧最大值；保存真实版本后只把该条version规范化为ASSIGNED_AT_DISPATCH。检查完整对象/动态REVOKE匹配和重载/表列ACL/RLS/全部用户trigger、默认3费率关闭且无版本、新操作/回执空表，以及12关系资金摘要、队列/租约、Worker/配置/cron与Free仍符合。之后才形成带实际nonce的after证明。打开前须再取全新证明；过期不能只改checkedAt。

这些是可信操作者的有界证明，不是全库锁或Supabase签名。其他管理员/直接调用者、cron和未来流量仍在信任边界外；任一漂移都保留封口和证据。M6派发意图后仅前向核实/修复，不回旧Web或旧资金API。用户已放弃旧数据备份，无整库恢复点承诺。

## 本人登录与配套前端验收

由主会话统一安排。在zhao Mac本人解锁后，使用正常Chrome配置在https://www.zimage.store登录既有账号，保持同一顶层标签。不要发送Cookie、token、密码、截图中的私密账户资料或浏览器存储。

现有browser-readonly-verifier.mjs可为operation paired-7a811b3-20261106和两个准确release生成可读Sources Snippet；只装载此公开代码。Chrome若出现self-XSS保护立即停，不输override、不换profile/执行入口规避。它不会登录或刷新认证；若中途认证过期，保持封口并按正常交接处理，不能借验证入口开放写接口。

Snippet最多20分钟/8次nonce，每次挑战120秒，固定7个同源GET。计划需要旧组合、新后端及最终新组合至少3个成功回合；预留失败余量但不重载脚本绕过上限。只传redacted receipt及其精确下载字节SHA，独立比较后由协调器accept-auth；不导出私有响应。回执的catalogReady只证明真实DTO/marker，不证明聊天费率、供应商调用或完整A+可用。

真实新后端checking后，需要读取真实兼容证据才生成正式F1及其root批准。不能预写verifiedBackends或用旧F0/新B1假装已兼容。选F1后再次认证、验证public/static/MIME/immutable/缺失chunk404和旧标签表现。checking只允许固定GET，不开放上传/余额写/生成去做演示；完整A+/付费模型验收仍另需批准。

## M6聊天影响：实际证据和选择

当前生产积分总开关true、版本2026-10-12.1。旧价格表仍含豆包2minor（0.02积分/次）和MiniMax3minor，但MiniMax provider=false；后者是兼容历史价格，不是可调用产品。豆包及Seedream provider=true，OpenAI/GPT两项均false，套餐enabled=false。

默认M6创建3个enabled=false/version=null聊天设置，费率版本表空；catalog过滤所有旧chat价格且不发布新价格。新聊天无可用费率时在credit_wallet冻结之前抛chat_tariff_unavailable；旧请求精确回放及已有结果完成保留。已加载旧F0即使日后启用了费率，也因缺少rateVersion报credit_price_changed，不能只切数据库。新UI可能显示供应商正常同时暂无报价；直接请求当前映射为积分服务尚未就绪503。这些是代码/合成SQL证据，尚未在真实登录页面验收，不能声称友好的停服体验已通过。

明确生图意图走独立image分支，不由新chat费率控制；既有图功能能否正常使用还取决于各自runtime/provider/报价和完整配对验收。A+套餐目前关闭；M6与Web部署本身不会启用新的分析/策划/整套生成。不得把工具安装或健康200报告为用户原需求全部上线。

目标项目Secrets名称已在现有登录Edge页面完整清单确认：ARK_API_KEY及OPENAI_API_KEY存在，值和有效性未读/未调用。Custom Secrets未列ZIMAGE_DOUBAO_EDGE_ENABLED、ZIMAGE_OPENAI_ENABLED、ZIMAGE_DOUBAO_CHAT_MODEL、ZIMAGE_DOUBAO_VISION_MODEL、ZIMAGE_DOUBAO_PLANNER_MODEL；因此新Edge路径按代码保持关闭/配置不全。Web侧也必须分别具备相应启用标记、项目URL和现有服务端Supabase授权入口，当前不读取其密钥或擅自改配置。仅添加OPENAI_API_KEY不等于聊天/生图启用。

供主会话询问的两项产品选择：

- A：接受部署后暂时无法发起新的豆包/OpenAI聊天，先按当前默认关闭合同上线；历史查看/兼容结果恢复保留，新A+仍等待独立费率/配置批准。当前协调器只接受chatAvailability=approved-disabled、newPaidCallsEnabled=false；用户必须明确接受这一实际产品影响。
- B（建议保留现有聊天的情况下选）：旧版继续在线，先完成模型/费率/用量回执与安全启用准备，再发布能保障聊天可用的新方案。现有协调器不接受enabled聊天，默认after合同也绑定3个关闭设置；需要另行实现/测试/审查准确启用合同和最终门禁，不能把A的策略暗改为B或在活动operation内换价格。当前不做此选择或擅自启用。

## 安全启用聊天还缺什么

1. 确定真正可用的物理请求模型与可信响应模型白名单，分豆包/OpenAI；视觉/策划映射独立，不能拿聊天模型代替。目标项目Secret名称可核对，模型/凭据有效性尚无真实请求证据。
2. 核实对应模型、上下文档位、缓存和服务级别的官方费率与适用条件；明确汇率/换算时间与来源、是否含折扣税费。按可信实际token乘已发布积分费率结算，不冒称供应商单请求最终实付。当前旧0.02积分/次不能换算成新token费率，测试fixture费率不得发布。
3. 每个新immutable tariff版本需model/requestModel/responseModels、input/cached/outputPerMillionNano（每百万token成本人民币×10^9）、markupBps、maxInputTokens/maxOutputTokens和evidence。用户已同意1积分=1元、成本加价100%（markupBps=10000）；具体单价、版本及预算上限尚未批准。缓存必须有可信usage字段，缺失/模型不符/超上限保持待核对。小额费用聚合本次输入输出后按0.01钱包单位向上取整。
4. DB中只以受控管理员事务新增不可变chat_usage_versions记录并把对应chat_usage_settings指向它；不改旧版本。现有M6不提供chat tariff管理RPC，不能误用credit_admin旧固定单价操作。四个新RPC仅service_role执行，private表及辅助函数不向anon/authenticated/service_role直接开放；启用费率不需要新增普通用户表权限或关闭RLS。未来操作须明确批准，不在本轮执行。
5. 分别核验Web/Edge开关、现有服务端授权、DB provider可用性/健康、Supabase Secret映射及供应商账户权限；不从Edge取回密钥，不建公开代理。开关/映射/费率更改须按具体目标分别批准或由用户安全填写。新模型的2聊天2图片ID并不意味着该账户有权使用。
6. 仅在批准具体模型、请求次数及费用上限后做最小真实验收，核对requestId/解析模型、输入/输出/缓存/总token、终止与[DONE]、实际账本冻结/扣费/退差及幂等。主动停止有可信usage才结算，未知保持冻结待核对，不重复供应商请求。此文未授权付费调用或给出虚构预算。

[Supabase官方Nov4变更记录](https://supabase.com/changelog)说明CLI v3改变本地/远程默认和确认规则；本方案继续使用现有MCP明确project_id，不升级/安装CLI，不按旧--linked习惯猜命令。Secret遵循[官方服务端配置说明](https://supabase.com/docs/guides/functions/secrets)。Free记录仍需临近切换刷新，仪表盘有舍入/1小时延迟，不是硬熔断。

## 本轮独立审查与验证

安全启用前补充：最新官方价格参考已核对，但不是已批准售价。当前OpenAI relay未指定service_tier，回执/费率模型也不含处理档位或缓存写入分项；不能据普通输入/缓存读取/输出三项宣称完整供应商成本已验证。详见同目录openai-pricing-reference.md。此缺口保持在启用门禁，未改冻结应用或擅自发布费率。

独立审阅Critical0、Important2、Minor1。已补实际账户/引用清理、preview prune/promotion过期、耗尽租约状态更新，并统一22分钟窗口。修复前活动回归2/12通过，修复后12/12通过；完整before/after SQL、同数量余额修改检测、事务回滚和合成shim恢复也通过。夸大的测试字段已改为beforeSnapshotFlagsM6AlreadyPresent，未声称运行未实现的拒绝消费者。合成PG已停止，没有备份。

公开Snippet已生成并通过Node语法检查：SHAecaa5700bf4e82ca20aeabbad49432cdf7dbe51613c8bc794432015954beec34、20721B，只绑定当前operation及准确旧/新release，未装载到浏览器。07:05:23UTC只读核验20项安装摘要、配置/ingress、旧PID456496/指针和ready/meta200一致，活动policy不存在。此前执行通道短暂断连，未创建进程；只读探测恢复后继续，没有重放生产操作。
