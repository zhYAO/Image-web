# 独立小额 OpenAI 诊断（本地候选，未部署）

该路径用于在不启用正式聊天/售价、不访问任何用户钱包的情况下，验证服务身份、真实 Chat SSE、模型及用量回执。它不是面向用户的聊天代理，不验收生产钱包结算或回答质量。

## 固定执行范围

- 独立函数 `provider-diagnostics`，配置文件默认 `enabled=false`。入口使用既有 `withSupabase({auth:['secret']})`，浏览器用户身份、发布 key、其他命名服务 key 与 Bearer-only 身份均不能授权。
- 独立运行门 `ZIMAGE_PROVIDER_DIAGNOSTICS_ENABLED=true` 和准确匹配的非秘密 `ZIMAGE_PROVIDER_DIAGNOSTICS_CAMPAIGN_ID`，缺任一项不能发送供应商请求。正式 `ZIMAGE_OPENAI_ENABLED`、聊天费率及整套配置不变。
- 数据库 owner 需另外创建并批准最多15分钟的 campaign，迁移不创建活动。服务角色只能调用 dispatcher，不能直接创建、重置或改写活动表。没有 arming/reset/retry API。
- 一个 campaign 最多 `gpt-6-astra` 一次，然后 `gpt-6.1-sol` 一次；第一项未取得可信完成回执时不能发第二项。每次调用资格先持久化消费，确认丢失或进程退出也不恢复资格。
- 固定消息只有 `Reply with the single word OK.`；消息 JSON 为60个 ASCII 字节，代码上限128字节，完整请求 SHA256 与 SQL 白名单匹配。不能提供提示词、用户ID、历史、图像、工具、模型或端点，也不跟随重定向。
- 固定 `n=1`、`max_completion_tokens=128`、`service_tier=default`、30分钟隐式缓存、`store=false`，30秒请求超时；最多读取128KiB供应商流和512帧。
- Chat API没有独立的 `max_input_tokens` 硬上限参数。这里强制的是不可变短输入和字节界限，2048输入token是预算/回执核对阈值，不能声称向供应商强制了2048 token。隐藏内容、价格变化、税费和汇率使人民币最终账单仍不能实时硬熔断。

## 安全与状态记录

新迁移 `20261106110341_isolated_provider_diagnostics.sql` 只新增两张私有 RLS 表和一个 `public.provider_diagnostic(uuid,text,text,jsonb)`。函数为 SECURITY DEFINER、空 search_path，仅授予现有 service_role 执行；匿名和认证用户没有执行权限，表不授予服务角色直接管理权限。该新生产权限仍需后续明确批准，当前没有执行迁移。

父活动行锁串行化 claim/record；主键限制每活动每模型一条尝试。`claimed` 是已消费但结果待确认，不能推断供应商确实未开始。完整可信终止且模型、请求ID、档位、缓存分类、总量和上限一致才写 `verified`；否则 `needs_review` 并停止整个活动。已完成结果重放不发请求，重复相同回执幂等，冲突终态不能覆盖。活动到期后仍可查询/保存已开始的结果，但不能开始新调用。

只有验证后的回执与目录美元微元估值入库，不保存生成文字、原始供应商错误、提示词或密钥值。缓存TTL字段明确命名为 `requestedCacheTtl`，来自完整请求摘要绑定的本地配置，不冒充供应商返回或账单确认；可信回执验证的是供应商实际返回的模型、档位、token分类与终止。每个正文/终止choice必须是数字index0。不读写钱包、积分操作、用户会话、订单、供应商正式开关或销售费率。SQL测试同时比较钱包/操作/聊天费率前后快照。

## 小测预算

固定2048输入预算/128输出、全部输入按最贵30分钟写入估算：Astra最多 $0.032，Sol最多 $0.0064，合计 $0.0384。以尚待批准的汇率7.2换算为0.27648元，0.50元可作为目录预算缓冲；金额归 OpenAI key 所属 API项目账务，不扣用户积分。估值只适用于此固定诊断，不适用于正式32k/4k聊天上限。

费率依据2026-11-06 [OpenAI官方价格](https://developers.openai.com/api/docs/pricing)。真正运行前仍需复核目录/资格与汇率；出现未知结果立即停止，不通过另建活动自动补测。该预算不包括生图、豆包、Seedream AFP、充值、订阅、税费或完整产品验收；Supabase仍会产生少量函数/数据库调用和出站用量。

## 后续真正运行前的门禁

1. 审核当前实际部署版本、Free余量和待处理迁移。诊断迁移本身独立于本地M7，但不能通过一次未经审核的 `db push` 顺带执行其他挂起迁移。
2. 明确批准新增 SECURITY DEFINER dispatcher 的 service_role 权限，随后才部署迁移及已验证函数；复核普通用户权限仍关闭。保持函数/运行门未启用，直到单次测试获批准。
3. 单独批准两个模型各一次及API预算；由已有数据库 owner 创建带准确批准引用与到期时间的活动，再由受信任运维环境设置非秘密活动ID及门。不要把 key、会话或服务凭据复制到聊天。
4. 受信任服务端只提交 `{campaignId,slot:'astra'|'sol',action:'run'|'status'}`。先Astra，验证通过后才能Sol。调用取消、超时或响应丢失时仅查询 status；不得自动重试供应商。
5. 结束后关闭独立运行门，保留审计记录。暂停/禁用不删除或重置 attempt，日后重测需新的具体授权且先核对旧结果。

本次仅本地模拟/合成数据库与假密钥真实SDK测试；生产 key 归属与有效性、生产服务身份匹配、实际供应商回执及账单均未验收。
