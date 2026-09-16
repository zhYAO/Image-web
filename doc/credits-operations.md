# 积分部署与运维

## 本地实现及迁移差异

依次运行 `20260913082732_commerce_xhs_poster.sql`、`20260913090000_session_activity_summary.sql`、`20260915140000_credits.sql`。
前两项已有迁移扩充海报校验和会话摘要；第三项新增 private 钱包、价格版本、计费操作、请求回执、流水、审计表，增加生成入队/完成/删除触发器与三个 service-role RPC。旧生成没有对应计费操作，触发器直接跳过，不补扣；不改现有参考图、会话、图片记录与每日额度。已有验证活跃账号通过唯一 `welcome:v1` 流水赠送；新验证账号首次访问钱包时使用同一幂等入口。

默认数据库 `credit_settings.enabled=false`，Web `ZIMAGE_CREDITS_ENABLED=false`。发布前先验证三份迁移、现有记录数量、历史任务抽样与待核对任务清单。云端执行与 Worker 发布必须另行确认。再部署兼容代码、配置 Web 标志，最后用审计命令启用数据库计费。任何中间版本遗漏报价时会拒绝新增扣费任务。

暂停时先将数据库 enabled 设为 false，并保留 Web 计费标志为 true，使新请求被拒绝；已冻结任务完成/退款入口继续工作。禁止删除账本、重新派发未知任务或直接将余额清零。

## 运维命令

从 apps/web 运行（服务端凭证仅来自环境文件，禁止提交密钥）：

```sh
node scripts/credits-admin.mjs --env .env.local --file operation.json
node scripts/credits-admin.mjs --env .env.local --file operation.json --apply
```

第一条预览，第二条写入。两次使用相同 JSON。`requestId` 必须是新的 UUID，重试原操作则保持不变。所有操作必填 `actor` 与 `reason`。输出不含服务端密钥。

补发示例：

```json
{"action":"grant","requestId":"11111111-1111-4111-8111-111111111111","actor":"operator","reason":"客服补发说明","userId":"22222222-2222-4222-8222-222222222222","amountMinor":100}
```

- `audit`：指定 `userId`，只读比较钱包与流水计算的可用/冻结/消费总额，并列出待处理操作；不会修正余额。
- `activate`：`enabled` 布尔值。
- `price`：全新 `version` 和完整七项 `prices`，格式与 `/api/credits/pricing` 一致；只允许现有组合、正整数价格。旧版本和旧操作金额保持不变。
- `reconcile`：`operationId`、`outcome`（`succeeded` 或 `refunded`）、至少十字符 `evidence`，说明上游最终结果的核对依据。并发重试的前置失败只会取消尚未被领取的请求，不能退款其他重试已开始的调用。已有持久化文本结果会走恢复完成，不允许用手工退款绕过成功结果。文字结果尚未保存时，成功对账必须附 `result`（聊天为 content，优化为 text），先保存再结算。

## 接口

GET `/api/credits` 返回 availableMinor/frozenMinor/spentMinor。
GET `/api/credits/ledger?cursor=...` 返回 items/nextCursor，每页 30 条。
GET `/api/credits/pricing` 返回 version/enabled/prices。
POST `/api/credits/quote` 接受 items 或业务 action/input，返回逐项费用与总费用。

图片、重做、电商提交、聊天和文字优化携带稳定请求编号及 `billing:{version,totalMinor}`。服务端重新计价，客户端无法用低价覆盖数据库。402 insufficient_credits、429 quota_exceeded、409 price_changed/billing_pending、503 service_not_ready 分别处理。`/api/quotas` 保持每日张数含义。

## 隔离数据库验证

`supabase/tests/run-credits.mjs` 只会启动本地 PostgreSQL 端口 55439，不接受远程连接字符串；完整运行旧电商、海报、摘要与新增积分断言，随后通过两个连接验证余额竞争、同请求回执、模型单次领取及并发退款。需在隔离临时目录安装 `embedded-postgres`（含平台 postinstall），用 `LOCAL_PG_MODULE` 指向入口；结束后关闭自建实例。auth/storage/pgmq 是本地兼容表和函数，不能代替真实 Supabase 扩展/生产验收。
