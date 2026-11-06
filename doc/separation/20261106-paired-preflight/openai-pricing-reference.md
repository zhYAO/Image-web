# OpenAI价格参考，尚未批准用于生产

2026-11-06核对[官方Pricing](https://developers.openai.com/api/docs/pricing)的Standard/Short展示，单位USD/百万token：

|模型|输入|输出|缓存读取|30m写入|12h写入|
|---|---:|---:|---:|---:|---:|
|gpt-6-astra|10|50|1|12.5|25|
|gpt-6.1-sol|2|10|0.10|2.5|5|

仅以汇率7.2作假设、成本加价100%换算，输入/输出/缓存读取分别为：Astra 144/720/14.4积分，Sol 28.8/144/1.44积分，每百万token。7.2不是实时或已批准汇率；未包含可能的其他计费分项，不是可发布价格。

[Chat API](https://developers.openai.com/api/reference/resources/chat)说明未指定service_tier时采用auto，受项目设置影响。代码目前未指定该参数，也未保留实际档位；不能证明Standard目录价适用。

[缓存指南](https://developers.openai.com/api/docs/guides/prompt-caching)列出新模型的缓存写入和按lifetime拆分用量，并有Responses API专属规则。当前接口是Chat Completions；需核实其适用规则和可信回执，不能照搬Responses字段或忽略写入费用。

当前SQL费率与回执仅覆盖普通输入、缓存读取和输出；没有档位/写入分项。用户按实际token乘发布费率结算，与供应商最终实付不同。真实启用前须完成适用规则、汇率、物理模型/响应白名单及必要代码验证；现保持关闭。豆包物理聊天模型尚未确定，不能核定其token费率。无真实模型调用或价格写入。
