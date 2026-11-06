# OpenAI 估算与未启用价格（2026-11-05）

以下为目录价情景估算，不是已批准售价或真实实付账单。假设美元兑人民币7.2（估算参数，非实时汇率）、1积分=1元、成本加价100%；订单内先合并，再向上取整到0.01积分。上下文包含历史轮次，不能只算用户本轮字数。

| 模型 | 输入/缓存输入/输出，美元每百万token | 无缓存1000输入+500输出：成本人民币 | 加价100%后的示例积分 |
|---|---|---:|---:|
| gpt-6-astra | 10 / 1 / 50 | 0.252 | 0.51 |
| gpt-6.1-sol | 2 / 0.10 / 10 | 0.0504 | 0.11 |

费率来自[OpenAI Standard短上下文价格](https://developers.openai.com/api/docs/pricing)。不同服务等级、长上下文、缓存写入及地区附加费须单独复核，不使用 Flex/Batch 或 Fast 费率替代 Standard。上表未将任何价格写入启用配置。若选择32000输入、4000输出的上限，相同假设下Astra最高冻结示例7.49积分、Sol1.50积分；真实上限须批准后配置。

两个图片模型 gpt-image-2.6-sunburst / gpt-image-2.6-flare 的目录价均为：图片输入8、缓存2、输出30美元/百万token；文本输入5、缓存1.25美元/百万token。依据同一[价格表](https://developers.openai.com/api/docs/pricing)，价格相同不证明模型效果或账号权限相同。

采用主会话核查的[图像计算器](https://developers.openai.com/api/docs/guides/image-generation#calculating-costs)情景：1024×1024、medium、1449输出token，并假设1000文本输入token、无参考图。美元估值=1449×30/百万+1000×5/百万=0.04847；按上述汇率成本0.348984元，加价100%示例0.70积分/张。参考图、其他尺寸/质量和额外计费会改变成本。当前仅普通方形生图支持这些参数，A+不能直接采用该情景报价。

Seedream Plan 的 AFP 用量和套餐购买/利用率需另估摊销成本，不能把 usage 当作逐请求现金实付。[官方AFP规则](https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-personal-afp-credits-billing-rules)应与实际采购套餐一同核对。所有供应商的折扣、税费、账期调整与实际账单仍需对账。
