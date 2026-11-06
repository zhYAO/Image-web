# 新模型与收费启用清单（2026-11-06，本地候选）

生产仍为已开放的7a811配套版本。本轮没有生产DDL、Secret修改、价格发布、开关启用或真实模型请求。以下是可审阅候选，**不是已批准价格或启用命令**。

## 官方模型与接口

|用途|准确请求ID|接口与当前限制|
|---|---|---|
|OpenAI聊天|gpt-6-astra、gpt-6.1-sol|Chat Completions，纯文字，无外部工具；固定default与30m缓存|
|OpenAI普通生图|gpt-image-2.6-sunburst、gpt-image-2.6-flare|Images generations/edits；1024×1024、medium、PNG；尚不支持A+非方形模块|
|豆包候选|doubao-seed-2-1-lite-260915|官方现行多模态模型；建议独立配置聊天、视觉、策划三个映射，不能共享一个可变聊天设置|
|A+图片|现有代码请求别名doubao-seedream-5.0-pro（待核实）|现有Agent Plan链路；不能冒充普通API的doubao-seedream-5-0-pro-260628版本，或直接切换收费路径；按真实像素/供应商回执核实|

官方四个OpenAI页面已逐一打开核实：[Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst)、[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare)。豆包准确版本来自[官方模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)。这证明公开ID/能力，不证明本项目密钥有权限、地域可用或账户已开通。

## 价格候选：币种、汇率和销售费率须批准

OpenAI[官方Standard/Short目录](https://developers.openai.com/api/docs/pricing)，USD/百万token：Astra输入10、缓存读取1、30m写入12.5、输出50；Sol分别2、0.10、2.50、10。[Chat接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)明确实际service_tier和prompt_tokens_details.cache_write_tokens；只使用Chat支持的30m TTL。[缓存规则](https://developers.openai.com/api/docs/guides/prompt-caching)说明写入费率替代普通输入，不能重复加收。

**仅以可配置示例汇率USD/CNY=7.2、已确认成本加价100%估算**，客户积分/百万token：

|模型|普通输入|缓存读取|30m缓存写入|输出|32,000输入/4,000输出最高冻结|
|---|---:|---:|---:|---:|---:|
|Astra|144|14.4|180|720|8.64积分|
|Sol|28.8|1.44|36|144|1.73积分|

费用按整次高精度用量求和，最后向上取整至0.01积分。聊天不使用图片0.5积分最低价；输出包含供应商计入completion_tokens的推理token。7.2是示例固定汇率，不是已核实实时汇率；目录估值也不等于折扣/税费/套餐后的最终实付。长期配置应记录汇率、目录日期与批准依据，发布新不可变版本，旧快照不重算。

豆包2.1 Lite[常规目录](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1)为输入0.80、缓存0.16、输出2.70元/百万token；同样加价100%为1.60/0.32/5.40积分，32k/4k最高冻结0.08积分。它使用独立V3常规档位回执，不伪造OpenAI写入量或TTL。输入仍限制32k以保留现有成本适配；实际返回版本必须在冻结白名单内。

OpenAI方图示例：1024方图medium按1449输出token、另假设1000文本输入token，目录估值约0.349元，按上述汇率/加价向上取整约0.70积分/张。真实参考图输入、规格或用量变化需另计；不是已批准售价或现金硬上限。

Seedream Agent Plan以AFP计量，不能从usage精确推导人民币实付。A+按张售价仍缺**经用户批准的每张人民币成本估值/AFP换算依据**（套餐价格、总AFP及摊销假设，或用户直接指定的保守成本）。不得把测试fixture、0.70的OpenAI方图示例或旧0.30图片目录直接作为新整套成本。至少一张成功时整单最低0.5积分、加价100%已确认；分析策划包含，出图前取消全退，未知结果保持冻结规则不变。

## 真实配置：只检查名称，不读取Secret值

已在目标image-web/main项目`klmiycyesxnpinxpeqep`的完整Secrets表重新观察：ARK_API_KEY、OPENAI_API_KEY、ZIMAGE_SEEDREAM_PLAN_API_KEY存在。未验证值有效性、账户资格或实际模型。缺少：

- ZIMAGE_OPENAI_ENABLED
- ZIMAGE_DOUBAO_EDGE_ENABLED
- ZIMAGE_DOUBAO_CHAT_MODEL
- ZIMAGE_DOUBAO_VISION_MODEL
- ZIMAGE_DOUBAO_PLANNER_MODEL

建议后三项分别映射上述2.1 Lite准确ID，仍为独立配置。供应商key仅由Edge读取，不迁回Web；本地.env.local其余23项继续保留。Web另需相应运行开关（OPENAI/DOUBAO/COMMERCE_PACKAGES）和原Supabase服务身份；不在此输出任何环境值。仅添加key不启用功能。

生产数据库三种聊天settings仍disabled/null version，chat_usage_versions为空；整套settings.disabled且成本/销售版本为空，OpenAI/MiniMax关闭。新本地迁移20261106101025_verified_openai_chat_metering.sql只替换六个已有函数，保留ACL/owner；不增加GRANT、数据表、价格或启用操作，M6原文不改。须先配套发布已验证Web/Edge与该迁移，再在具体费率和模型验收通过后绑定版本/启用。不要复用前次已结束发布策略或重放M6。

## 建议的下一次逐项授权

1. 确认Astra/Sol的示例汇率7.2、32k/4k上限及上表销售费率，或给出替代值；确认豆包三个独立映射采用2.1 Lite及其费率。此时仍不发真实请求。
2. 首轮真实验收拟为2次聊天、每模型一次。0.50元预算只适用于独立2048/128诊断，不能套用正式32k/4k上限（两次供应商目录估值5.184元）。已另行准备[默认关闭的小额诊断本地候选](provider-diagnostics-2026-11-06.md)：固定60字节消息JSON、n1/output128、独立活动与持久一次资格，不触及用户积分。Chat没有独立max_input_tokens参数；2048为保守预算/回执阈值，不伪称供应商输入token硬熔断。后续仍需明确批准新增RPC权限/部署、具体单次活动及付费预算；当前不调用。供应商最终账单不能实时硬熔断；缺失或矛盾证据即停，不自动重试。
3. 图片分析/整套的后续验收需先批准Seedream成本依据及按模型/规格单价，再明确图片内容、张数、AFP和API现金预算。建议先一张公开合成商品图、一次分析/一次策划/一张输出，不测试真实未知结果重买；失败退款/重复结算已在隔离测试验证。

模型调用资格、真实图像效果、供应商账单以及生产新价格均未验收。网站已恢复不等于这些付费能力已开放。

## 独立审查与边界

聊天审查发现的矛盾流终止可留有效回执问题，已补三个失败用例并修复；已核实用量后的明确AbortError停止仍可结算。Ark分析/策划总量、缓存上界和实际档位校验通过独立七种注入场景；V3豆包聊天通过独立关闭/映射错误/旧profile/回放/正常调用检查。

延后非阻断项：SQL对cacheWriteTokens接受数字字符串而domain要求number；重复usage按JSON键序比较可能产生保守待核对；分析总token256k保护比domain512k更保守（现有32k输入/受控输出范围不触及）；历史/新增字段兼容与Web新字段保留可补更直接的专项测试。均不导致自动多扣费，不以放宽校验解决。
