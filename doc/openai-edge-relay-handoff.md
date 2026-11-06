> 2026-11-05 最新追加：图片按模型/规格和成功张数固定售价，聊天按可信 token 结算；供应商密钥只由 Supabase Edge 读取。本文早期固定次数计费或 Web 直接读取供应商 key 的描述已被后续改造取代。当前操作边界与关闭条件见 [操作说明](commerce-package-operations.md)，估算见 [价格情景](openai-price-estimates-2026-11-05.md)，最终状态见 [项目进度](project-progress.md)。

# OpenAI聊天Supabase代理：本地候选交接
本说明取代早期“Web本地填写OPENAI_API_KEY”的步骤；此前本地候选验证不等于本轮变更验收。

- OpenAI provider key仅由Supabase openai-chat Edge Function和原图片Worker通过Deno.env读取。Web仅使用既有Supabase URL/服务端凭据调用函数，不取得OpenAI key。
- 入口withSupabase({auth:['secret']})；config.toml的verify_jwt=false配合该认证方式，不允许匿名、publishable或普通用户JWT充当服务授权。尚未部署。
- Web仅在billedChat完成原认证、Origin检查、冻结积分和text_claim后携带userId/requestId/model调用；不转发任意prompt/messages。无积分OpenAI聊天及暂不支持的OpenAI文字优化在工作前拒绝。
- 服务专用openai_chat_relay RPC复查账户、冻结模型、真实reserve账本和processing状态；只允许一次claim，从原userMessageId截止的最后20条数据库消息冻结上下文。并发或未知重复请求不重买。
- Edge只转发解析后的文本SSE；上游错误正文不转发、不记录密钥/原始请求。完整结果先写入既有credit_operations.result，成功后才发送完成标记；Web沿原完成/积分结算。Web断连时结果仍可恢复，未知不自动退款或重试。
- 暂存历史在结果保存后清空，会话关闭/删除也清空；账户删除沿原账务级联清理。财务结果沿原规则保留。
- Web的OPENAI_API_KEY配置项本轮未读取、转移或删除。旧已运行/回退版本仍可能依赖本地key，需新函数和迁移部署验证后，另行明确授权清理。
- ARK_API_KEY、Supabase服务端凭据及现有认证/来源/模型映射仍有用途，不因本次OpenAI代理改造删除。
- 新本地迁移20261105082353_openai_chat_edge_relay.sql由CLI生成；未生产应用。新Edge函数使用已有锁定依赖，不安装或升级。部署时需审核该迁移和函数/auth配置，并确认目标项目已有OPENAI_API_KEY、函数和Web各自的ZIMAGE_OPENAI_ENABLED开关及数据库模型/价格；本轮均未改生产。
- 真实Supabase Edge运行、实际密钥/模型资格、供应商调用均未验收；本机无Deno，未声称Deno check已执行。独立审查检查了鉴权、归属、费用、重放、流式和删除路径；重要删除保留问题已RED→GREEN修复。
- Edge浏览器仅确认公开首页可访问。隔离mock服务受本地listen EPERM阻止，未绕过；没有完成A+向导/订单恢复/响应式浏览器验证。临时副本已清理，现有5173/7788服务未重启。
- 验证日志在本任务verification目录；本轮完成前不能沿用旧3908e609指纹和Web1289声称新代理通过。

服务间鉴权按Supabase官方auth secret规则，仅接受项目名为default的Supabase Secret key，经apikey请求头传递。它与OPENAI_API_KEY不同。现有Web Supabase凭据的名称/云端有效性本轮未读取或核实，应在后续受控部署验收时确认，不通过扩大auth模式绕过。参考：https://supabase.com/docs/guides/functions/auth

最终验证：domain257/frontend195/web1295、Worker98、SQL82及双连接，全部质量门槛与构建通过；代码指纹06908d339bf5b0c5b901b835cf80d478faac8cb0f349ccbb5bb74ad1a783e1f3前后一致。未执行Deno/真实Edge或付费验收，未操作实际密钥、生产或.env.local条目。
