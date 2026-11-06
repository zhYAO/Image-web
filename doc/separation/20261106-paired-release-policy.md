## 2026-11-06 实际发布准备完成，聊天可用性仍待决定

状态：**release_preflight_prepared_reviewed；active_policy_absent；no_production_switch**。本轮仅本地策略候选、只读生产核验、合成SQL及文档；没有安装活动策略、执行M6、封口/切换、改价格/Secret、付费调用或处理历史数据。

See [current review-only preparation and product decisions](./20261106-paired-release-preflight.md). Earlier implementation/install statements below are historical.

# 当前实现状态补充

实际协调器已在原分支实现并完成本地测试和独立审查修复，尚未安装root工具或策略、执行M6或切换生产。详见[实际协调器与交接门禁](./20261106-actual-paired-coordinator.md)。下文是此前策略准备的历史状态；其中“未实现”不代表当前代码状态。登录交接已改为浏览器同源只读验证，不再复制Cookie。

# 2026-11-06 配对发布与恢复准备

状态：策略草案及本地验证完成，**尚无可执行的生产配对协调器，也未安装新root策略**。本文、draft JSON和测试结果都不是生产发布授权或上线成功证明。保留现有backend/frontend/first-window门禁；不调用旧opened操作，不伪造相同数据库版本。

## 已绑定的实际输入

| 对象 | 身份 |
|---|---|
| 当前后端 / 前端 | fb4fb09f909c0ae5dce98ebd0d9540386685ddb7 / release-fb4fb09f909c |
| 当前前端artifact | 463f3941ed68204bbbfc828407aaec8bb82dd8cc620d6a9efb0e6c09f16abf06 |
| 新应用commit | 7a811b326aa4b344cee08bc5a33c04e44a780fd4；后续运维提交不重标它 |
| Linux manifest | 282f0500d895f9beb97bfff81d9658708df61e754442297648591d20ad6cca37 |
| 新code归档 | 81b9ffc5252891a63d684136e2454221123865ed815b2b92c9e031a3a2e14706；4,580,033 B |
| 新前端candidate / payload index | 78c970c3a53b6b188d323140546578159fee5605d72186dd42eb03ef88469f0d / 1af7f99d4fb807ff6bdb742da407c377a981ffb323c7ae45e48d5446a8afa67a |
| 新前端namespace | release-7a811b326aa4；正式artifact/acceptance尚未生成 |
| M6原SQL | 20261105190000_chat_usage_settlement.sql；e02af4ba32942e8718ed0a2de9b1598e1329fe62fd44f286f2992d437687b22f |
| M6原子封装 | dd7355c13a4384de2f5f0b863b02afd3bda46281564ed99501bd13ef575d23a5；另行绑定实际执行载荷 |

JSON草案见同目录20261106-paired-release-policy.draft.json，绑定原文SHA、实际载荷SHA及路径；实际载荷为20261106-migration6-atomic-envelope.sql。`executable=false`，缺失的正式前端artifact和协调器SHA仍为null；不能把它写到现有backend-release-policy.json冒充批准。

## 先解决的运行影响

原生PG17.11合成实验使用37个应用迁移文件及本地Auth/Storage/队列shim（跳过4项cron部署），没有TCP、生产访问、真实数据或备份。M6后58张既有测试表行hash不变，4个旧函数正文保留，4个RPC只有service_role执行。旧目录2条chat报价变为0条；旧式新聊天请求报chat_tariff_unavailable，未创建资金操作。

这说明M6默认关闭所有新聊天费率。新Web的豆包服务端中转还依赖独立模型映射和开关。维护前应核实并获得所需配置批准，使原豆包聊天可以按新规则恢复；若决定先发布关闭状态，须明确告知聊天暂不可用，不能把结构部署完成写成聊天可用。新OpenAI/套餐价格及供应商启用另行受控，不顺手开启。

空新表本地约81,920 B，这不是生产账单或最终容量保证。切换前重新核对整个组织的Free数据库、Storage、Edge调用和两类出站余量；既有cron不增频，不新增轮询服务或购买资源。

## 原子执行与未知结果

官方[迁移接口](https://supabase.com/docs/reference/api/v1-apply-a-migration)列明query/name等参数；本轮未从该页获得“SQL与迁移历史一起提交”的明确保证。因此不能仅凭工具报错推断没有执行，也不盲目加入BEGIN/COMMIT改变框架事务。

准备了一个可审查的单语句DO封装：原23,714 B SQL逐字作为动态SQL正文，外加102 B原子执行结构；不添加持久对象、权限、价格或历史处理。原文件不变，同时记录原文和封装两个SHA。PG17无客户端事务的实验在DO内确认新表已可见后主动抛错，验证整条DDL回滚；之后正常封装执行与原M6行为一致。实际采用该载荷前仍须审查两个SHA和完整可读内容。

即使DDL单语句原子，接口响应或迁移历史仍可能不确定。只读核对迁移名/实际远端版本、全部新对象与函数正文/ACL/RLS后再分类；历史记录缺失而DDL已存在时保持封口，单独协调记录修复。不得重放M6、分段补DDL或删除迁移历史。

## 配对维护顺序

1. **prepared**：固定上述输入；复验保留的旧组合和资源；完成新协调器代码/故障测试/独立审查，并对准确root安装范围取得批准。现有工具没有pair命令，本步骤未完成时不进入维护。
2. **identity_verified**：本人本机隐藏输入工具就绪后，先完成当前fb4的真实只读身份基线。ready.json只表示验证进程就绪，不等于账号有效。核对当前指针、root配置、实际服务PID/生命周期及Free余量。
3. **sealed**：新operation持有既有deploy.lock，持久关闭入口及backend全部新请求，确认真实503已生效。等待精确旧进程的HTTP、framework与5项业务计数全部归零；零快照或空队列不能替代持续封口后的drain。异常保留旧进程，不发送强制终止。
4. **drained / migration_pending**：停已排空的旧Web；root私有准备新后端和冻结的前端candidate，原生/索引/源码绑定再核验。正式包和旧目录保留；不得使用已启动并生成route-cache的staging。
5. **migration_submitted**：仅向image-web/klmiycyesxnpinxpeqep提交一次准确M6载荷。先记录原文/载荷SHA及提交意图；结果未知先只读核实，不以新operation重复迁移。
6. **migration_committed / pair_checking**：记录实际迁移历史/对象版本，选择新后端；仍保持checking封口。获得新PID绑定的独立公网身份/账号/会话/严格只读目录回执。目录检查已对齐合法token报价的三个可选字段，但catalogReady只证明DTO和只读marker，不证明成本已批准、价格合理或聊天已启用。完成与精确F1 subject绑定的真实协议验收报告，依真实证据生成正式F1包和批准申请，再审核/安装准确批准。候选allowlist和合成测试不是verifiedBackends。
7. **pair_selected**：由同一已审查的配对协调流程，在同一锁和operation下选择准确F1并验证两个指针。普通frontend与backend工具不提供本次跨schema事务；不得伪造first-window身份或关闭其guard。若未能完成该协调实现，保持封口，不手动只切一个current。
8. **pair_verified**：checking范围内完成新旧标签、只读浏览器、完整静态资源与缺失chunk404检查；所有新付费功能继续受已批准的价格/开关限制。缺少认证、实际F1批准或兼容证据时不得开放。新旧标签需要刷新的行为必须实际确认。
9. **opening**：再封新读并排空候选验证请求；重新核对精确版本/进程/两个指针/实际DB与Worker/价格快照。先持久化writesMayHaveOpened=true及精确组合，再开放准入；崩溃后不能把opening当作未开放。
10. **opened**：记录真实开放结果，独立公网读回版本/资源和Free用量；保留所有产物、日志与财务记录。付费模型验收须另有批准，不以健康200替代。

## 恢复判定

| 失败位置 | 安全路线 |
|---|---|
| 尚未维护、M6未提交 | 原组合继续运行；不操作current、旧账务或供应商 |
| 封口后、M6未提交，实际DB仍为原版本 | 只有旧产物、精确进程、真实drain和指针都可信时，恢复准确旧组合；新nonce身份和健康复验后才考虑开放 |
| M6响应丢失或部分证据不一致 | 保持封口；核对历史/对象/ACL，不重试、不退款、不“补齐”不明DDL |
| M6已提交、新Web/F1/认证检查失败 | 默认保持封口并前向修复。保留新数据库保护，不自动恢复旧金融API或仅退回网页；本地保留旧函数不等于跨schema组合已兼容 |
| 已记录opening、已开放或状态未知 | 新维护operation重新封口和drain，再核对真实新业务及资金。禁止旧自动recover、数据库回放、历史unknown重试或批量退款 |
| 任一版本/PID/指针/配置漂移 | 停止当前动作、保持封口并人工核实；不猜previous |

用户已决定不备份旧数据，故没有可承诺的整库恢复点。此方案的“迁移后恢复”是安全封口和前向修复，不承诺一键恢复旧业务或固定维护时长。若要求迁移提交后自动回旧组合，需要另外实现、证明并审查实际新schema下的兼容路径，不能改写版本字段冒充相同数据库。

## 具体root边界与当前缺口

既有固定对象为/opt/zimage/deploy.lock、/etc/zimage/backend-maintenance.json、/run/zimage-lifecycle/control.sock、/etc/zimage/ingress-{maintenance,checking,open}.json、两套current/previous和root管理的frontend acceptance。新配对协调器需要在这些精确对象上执行封口、drain、受控选择与审计；不能获得任意路径/任意命令、密钥导出、普通用户管理权限或自动资金操作。

当前/etc/zimage/backend-release-policy.json仍缺失；新配对协调器及其root策略**尚未实现/安装**。本轮完成的是具体策略、原子载荷、本地行为验证和安全登录工具，不是可执行生产pair命令。下一项独立工程工作是按上述阶段实现并审查协调器；代码与准确安装SHA齐备后才提交具体安全授权。正式F1 artifact/approval、真实认证/旧标签验收及聊天配置仍待完成。

证据：任务verification/migration6-local-compatibility-v3.json、migration6-atomic-envelope.{sql,json}、paired-release-policy.draft.json、test_paired_policy.py、paired-preparation-backend-tests*.log，以及先前Linux产物和公开/RSC有限验收。策略场景测试10项通过；它们是故障规则验证，不授予生产权限。
