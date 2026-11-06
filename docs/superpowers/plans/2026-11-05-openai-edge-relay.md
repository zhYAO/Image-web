# OpenAI Edge Relay Implementation Plan
> Use superpowers:executing-plans. 原分支本地实施，不提交、部署、付费调用或操作密钥。
Goal: OpenAI聊天密钥只在Supabase Edge Function读取。
Architecture: 服务专用Edge入口，仅接受已计费且processing的聊天requestId/userId；SQL一次抢占、冻结数据库会话历史，Edge先保存完整结果再发送完成标记。Web不读OpenAI key，未计费路径拒绝OpenAI。
Spec: 用户最新要求；原认证、归属、幂等、流式和未知结果语义保持。
- [x] Web relay配置/请求授权测试 RED→GREEN。
- [x] Edge安全解析/单次调用/结果先持久化/未知结果测试 RED→GREEN。
- [x] 服务专用SQL授权/并发/历史兼容检查。
- [x] 全量回归、构建、独立审查；记录端口EPERM限制。
Review focus: 无计费代理、跨用户、重放、断流未知、秘密出现在响应/日志。

Final: native implementation, fresh read-only security review completed. History retention and unsupported-path findings fixed RED→GREEN. Full257/195/1295, Worker98, SQL82 plus two-connection claim conservation and gates/build passed. Code SHA06908d339bf5b0c5b901b835cf80d478faac8cb0f349ccbb5bb74ad1a783e1f3 unchanged before/after tests. No Deno/live Edge or browser paid verification; no production/credential/env.local/deployment changes.
