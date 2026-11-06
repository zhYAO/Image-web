> 2026-11-05 最新追加：图片按模型/规格和成功张数固定售价，聊天按可信 token 结算；供应商密钥只由 Supabase Edge 读取。本文早期固定次数计费或 Web 直接读取供应商 key 的描述已被后续改造取代。当前操作边界与关闭条件见 [操作说明](commerce-package-operations.md)，估算见 [价格情景](openai-price-estimates-2026-11-05.md)，最终状态见 [项目进度](project-progress.md)。

# 豆包供应商密钥统一：本地候选交接

2026-11-05；原分支 `codex/replicate-dot-zimage-ui-20261102`，未提交、未部署。

## 调用边界

- Web 豆包聊天、字段优化、A+ 商品图/风格图分析和策划均只调用 Supabase；Web 运行时代码不再读取 ARK_API_KEY。
- `doubao-chat` 与 `doubao-text` 使用现有固定版本 @supabase/server 的 `auth:['secret']`，仅接受 default Secret 的 apikey Header；verify_jwt=false 是替代服务认证，不是匿名代理。
- Web 仍需要 Supabase 服务凭据完成原认证、账户与账务 RPC；本次仅集中供应商凭据。不要将服务凭据、运维 SSH/面板口令放到浏览器变量。
- Ark endpoint 固定官方地址，不接受用户覆盖 endpoint/model。聊天只传账务身份；优化绑定原始 request hash；A+ 绑定用户、会话、整套订单、阶段 claim、冻结模型/预算、私图角色和已确认资料。
- Web 保留私图归属验证与 Sharp 去元数据/缩放；只向 Edge 发送经过处理的 PNG 字节。每张 ≤4 MiB、合计 ≤16 MiB，原图下载合计仍 ≤30 MiB，Edge JSON 上限24 MiB。新 attempt 表不存图片或完整提示词。
- 编译提示词和商品事实校验保留在可信 Web 服务；Edge 不是浏览器公开的提示词代理。

## 资金、幂等与恢复

- SQL 先 inspect 资金与冻结记录，再校验 Edge 模型映射，再创建唯一 attempt；并发只允许一个模型请求。
- Ark 的正文和真实 usage/模型/request ID 先存为私有回执，再返回 Web 进行原有事实/结构校验及结算；缺少 usage 不猜成本。
- 优化丢失响应后仅 read 回执。A+ 原订单恢复 GET 可只读回执并保存阶段结果，不下载新图片或再次调用供应商；停用新调用仍允许该恢复。
- 旧版本直接 Ark 的 processing/needs_review 订单不会因新 attempt 表为空而重新调用或自动退款。旧结果继续由原账务记录恢复。
- 只有数据库在同一账户/订单锁下确认没有 attempt 的新优化/聊天配置失败，才产生 relay_not_started 证据并释放冻结。与 claim 竞争时，二者只可成功一个；其他503/409/超时均未知，不退款或重买。
- 优化已验证结果持久后、或明确退款后，触发器清空重复 raw 正文；保留防重 tombstone。未知回执保留。A+ 回执随会话关闭清除，账户删除级联清理。
- 整套最低0.5积分、实际成本加价100%、出图前取消全退、成功图片共同承担共享成本及未知结果核对规则保持。

## 配置位置（只列名称，不操作密钥）

由用户自行在 Supabase 项目 Dashboard → Edge Functions → Secrets 安全填写/核实：

- ARK_API_KEY：豆包聊天/视觉/策划与已有历史 Ark Worker 使用，不能自动替换或迁移。
- ZIMAGE_DOUBAO_CHAT_MODEL：聊天及独立字段优化的部署模型。
- ZIMAGE_DOUBAO_VISION_MODEL：独立商品图分析模型，必须匹配报价的 visionModel。
- ZIMAGE_DOUBAO_PLANNER_MODEL：独立 A+ 策划模型，必须匹配报价的 plannerModel；不会改聊天模型。
- ZIMAGE_DOUBAO_EDGE_ENABLED：当前示例 false，先完成运行时与配置验证才允许开启。
- 原 Plan 生图仍使用 ZIMAGE_SEEDREAM_PLAN_API_KEY；OpenAI 仍使用 OPENAI_API_KEY 和 ZIMAGE_OPENAI_ENABLED。不回传供应商 Secret。

Web 仅保留 NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SECRET_KEY 及服务端功能开关 ZIMAGE_DOUBAO_EDGE_ENABLED；正式文字计费还需原 ZIMAGE_CREDITS_ENABLED，整套需原 ZIMAGE_COMMERCE_PACKAGES_ENABLED 与经审计成本配置。示例默认关闭，未改真实 .env.local。

## 本地迁移与限制

新本地迁移 `20261105090233_doubao_edge_relay.sql`；SQL 函数内套餐表依赖稍后套餐迁移，完整本地迁移序列已由 disposable PostgreSQL 验证。任何真实迁移、部署、启用、费用验收均待独立授权，本次没有执行。

旧未计费预览只有次数配额，没有持久的供应商 attempt 证明；实际 Edge 模式在任何会话/配额写入前503关闭。Mock UI 与隔离生命周期单测保留。若仍要提供免费预览，需专用配额声明及恢复协议，不能直接开放本代理。独立商品分析仍503，须从有预算授权的 A+ 套餐进入。

无本机 Deno/容器运行时，未声称真实 Edge SDK/Deno 验收；浏览器隔离监听曾 EPERM，未绕过。未登录、上传真实图片或调用付费模型。生产已有 Secret、命名、额度、模型可用性与实际费率均未读取/验证。

最终本地验证：domain257、frontend195、Web1306、Worker113、SQL112及三组双连接检查通过；lint/type/budget及两端构建通过。完整证据与真实验收待办以 doc/project-progress.md 最新记录为准。
