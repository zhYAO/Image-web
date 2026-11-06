# 独立诊断生产检查点（2026-11-06，两个聊天模型验证成功并关闭）

目标 image-web/main，项目 klmiycyesxnpinxpeqep。仅执行用户明确批准的一次最长15分钟活动，Astra、Sol各一次，预算0.50元为非硬上限；没有重试、网站用户积分扣费或正式模型/价格启用。Seedream 0.002元/AFP基准已批准，仍未发布完整售价。

- 迁移 isolated_provider_diagnostics 已在生产历史版本20261106123202应用；源文件20261106110341_isolated_provider_diagnostics.sql，SHA256 7fc3d2c1144692d25d52e0f50e57b3ad05bf4b8131c0bc8545b2efee9c830923。本轮未重放迁移或重新部署。
- provider-diagnostics v1，函数ID07d98059-eecf-447e-b25d-774f6cc5afec，部署摘要c63ddbda73c7ed2d2cf407fc847ced63d993bb643ea96c80914a0e036fba49ef；源提交bba2787e7d3e02ee6b01f6b00cb8ac2b633e76ab。get_edge_function返回的入口、处理器、deno.json与审查源码逐字节相同；未返回lock和纯类型文件，不能伪称已远端逐字节核对。
- public.provider_diagnostic(uuid,text,text,jsonb) owner=postgres，SECURITY DEFINER，空search_path；13:19:33UTC重新核对service_role execute=true、anon/authenticated=false。两张私有表RLS已验证，service_role无直接INSERT活动权限。
- 使用原有Edge的Supabase测试面板“Add secret key”托管认证，不导出或保存凭据。关闭状态的认证预检返回503 unavailable，无供应商调用；此前无凭据GET返回401。未读取供应商API key值，未创建新凭据；临时测试认证字段在结束前移除。
- 唯一活动cb7677be-0ab1-4e20-a4a8-3da1b515642b，13:13:14.141054UTC批准，13:28:14.141054UTC到期；Astra可信成功后才执行Sol。数据库活动最终complete，2条attempt全部verified；没有第三次调用或自动重试。

|请求模型|完成时间UTC|输入token|输出token|缓存读/写token|目录估值USD|
|---|---|---:|---:|---|---:|
|gpt-6-astra|13:14:35.581730|13|4|0/0|0.000330|
|gpt-6.1-sol|13:15:58.865407|13|4|0/0|0.000066|

两次均HTTP200、serviceTier=default、finishReason=stop。请求的缓存TTL为30m，只是请求设置，不是供应商确认缓存TTL。providerRequestId及完整非秘密回执已持久化在private.provider_diagnostic_attempts和执行工作区verification/diagnostics-production-checkpoint.json。

合计目录估值USD0.000396，按示例汇率7.2约CNY0.0028512；未核实供应商最终账单、税费、优惠或真实换汇，不将其称为实付。没有调用图片、豆包分析或策划，不能把两个短文本测试当作全部业务验收。

- 13:17:28UTC已把ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED保存为false；控制台摘要fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa与SHA256(false)相同。活动ID保留审计；complete状态、已消费双槽和15分钟到期共同限制后续调用。不删除或重置活动记录。
- 13:19:33UTC正式聊天启用费率0、packages_enabled=false；openai、gpt-6-astra、gpt-6.1-sol、minimax=false，现有doubao、seedream=true未改变。本次诊断不通过用户钱包/报价/收费路径。
- 测试前Free面板仍显示函数741/500000、Storage0.032/1GB、Egress0.001/5GB、cached0/5GB；面板可延迟1小时，不捏造测试后精确函数总数。SQL数据库最终142625939B，低于500MB。不能保证未来流量永不超额。
- Mac通道和既有浏览器已恢复，未绕过此前操作冲突。CLI仍未登录；没有提取令牌或降低鉴权。原分支和用户next-env.d.ts改动保留，.env.local23项没有更改。

剩余：配对发布M7可信聊天计费迁移及Web/Edge候选，确认销售费率/汇率/冻结上限，验证豆包独立模型映射和图片模型，发布完整成本/销售版本；后续真实图像/分析/策划调用须另行明确预算。不得复用已完成活动的两次授权，也不能直接启用未确认价格。
