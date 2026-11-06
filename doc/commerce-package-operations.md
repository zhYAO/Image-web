# A+、OpenAI 与计费：本地候选操作说明

2026-11-05。产品规则以 requirements.md 为准，当前交付状态以 project-progress.md 为准。下列代码未部署到生产，不是启用指令。

## 密钥边界

供应商 Secret 仅由 Supabase Edge Function 读取：OpenAI 为 OPENAI_API_KEY，豆包为 ARK_API_KEY，Seedream Plan 为 ZIMAGE_SEEDREAM_PLAN_API_KEY。Web 只保留 Supabase 服务端认证和非敏感运行开关，不应读取供应商 Secret。聊天 openai-chat / doubao-chat、分析和策划及文字优化 doubao-text、图片 generation-worker 是不同入口。任何 Secret 不使用 NEXT_PUBLIC_ 前缀。

Supabase 已存在 Secret 名称不证明值有效、模型权限可用或函数已经部署。不要把密钥发到聊天。Web 与 Edge 的开关不会自动同步。本轮授权删除的 MiniMax、Sentry、Gemini 本地项目已分别记录，其余 23 项 .env.local 配置继续保留。不得按此文直接迁移或删除其他凭据。

## A+ 固定图片售价

当前新订单只接受 fixed_images。不可变成本版本保留纳元精度；不可变销售版本的 imagePrices 按模型、resolution、standard/desktop/mobile 指定 estimatedUnitCostNano，并要求 priceEvidence 批准依据。售价按配置的 markupBps 形成，向上取整至钱包 0.01 积分；10000 表示成本加价100%。这不是供应商实际账单价格。

整套最高冻结额为选定图片单价之和与 minimumMinor 的较大值。分析与策划包含；出图前取消全退。图片全部明确完成后，仅对成功图片的冻结单价求和；至少一张成功时应用一次整单最低价（已确认最低0.5积分），没有成功则全退。最低价可能使少量失败不产生退款，报价必须事先显示。未知图片结果不当成失败，保留全单冻结待核对，不自动重试供应商。

成本估值由原回执与冻结成本版本另行计算。缓存、模型、尺寸、用量缺失产生 costReviewReason，不抹掉已完成成果，不改变新订单的固定售价。旧 fixed / actual_capped 订单保留原快照计算，不能改成新价。当前 A+ 仅支持已实现的 Seedream Plan 2K；高级规格需分别发布桌面/移动价格，缺任一价格拒绝报价。

## 聊天实际 token 结算

20261105190000_chat_usage_settlement.sql 创建空的不可变费率表、逐模型关闭的设置和逐请求快照，不提供已批准真实费率。chat_usage_versions.tariff 包含 requestModel、允许的 responseModels、输入/缓存输入/输出纳元每百万token费率、markupBps、输入/输出预算及依据。配置前须核实上下文档位、币种汇率、服务等级、缓存范围及供应商协议。

目录向客户显示每百万 token 销售费率、rateVersion 和最高冻结额。请求必须同时确认原价格目录版本、费率版本和上限；新旧服务入口都不能绕过未配置费率创建新的固定价聊天。已存在的旧订单仍可恢复。

Edge 使用已冻结历史与模型，先做保守输入字节预算预检，再创建一次供应商 attempt。该预检不是精确 tokenizer；明确未调用的拒绝在同一账务锁下全退。输出参数受冻结上限约束。完成帧之后继续等待供应商用量，可信输入/输出/缓存、模型和请求ID写入私有回执；完整内容先持久化，再发送成功终止标记。

结算先合并所有高精度 token 成本，再按加价比例一次向上取整到0.01积分，退回冻结差额；不使用图片最低价。主动停止按已产生且可核实用量结算；无最终用量、模型不符、超预算或未知结果保留成果与冻结待核对。不会根据已显示字数猜 token，不会重复调用来补回执，也不会用旧全额扣款路径代替实际结算。

## 四个 OpenAI 模型及限制

聊天：gpt-6-astra、gpt-6.1-sol。图片：gpt-image-2.6-sunburst、gpt-image-2.6-flare。图片通过 Images generations / edits，当前只支持方形1024×1024（1K）、medium、PNG、最多4张私有参考图，不用于A+非方形模块。图片用量按数值白名单保存在私有 checkpoint；缺明细标记待核对，不猜供应商现金账单。

## 验证与启用前置条件

本地跑 lint、typecheck、test:run、test:acceptance-budget、Worker、隔离SQL及前后端构建。临时字体按 ops/aliyun/FONTS.md 校验既有资源哈希；Web隔离构建只用 .next-build-qa，并保护原 next-env.d.ts 与正在运行的服务。

本机原生 Deno 与真实 SDK 禁网假凭据测试可运行，但不等于完整 Supabase 网关/队列/Storage/SSE 真环境验收。当前没有容器运行时；Edge 浏览器拒绝 file 协议，本地监听曾遭 EPERM；不绕过。真实浏览器、私有图上传、实际模型/账单及生产发布都未验收。

用户已授权直接部署既有生产项目，不重复索取泛化授权。执行前仍须完成可恢复备份与迁移维护/配对回退门禁；root策略安装、服务端Secret配置、价格版本/费率/上限、运行开关及真实付费验收按具体范围协调。不得从本文复制合成测试费率到生产。

## Free Worker 的执行与恢复

单次队列RPC10秒，准备20秒，供应商90秒，processClaim120秒；每次Storage上传（含重试）在续租后检查至少20秒余量，不足则保留checkpoint交给下一次既有cron回收。原有120秒租约及10分钟SQL claim deadline是fencing/回收状态，不代表Free函数可以运行10分钟。没有新增轮询或付费请求。

准备未提交可安全重试；submitted没有可信回执只能待核对，不能自动重买、全退或按失败计费。result/uploaded恢复沿用原字节、Storage路径和供应商回执，仅完成上传/结算；明确拒绝回执仅恢复失败结算。旧token、过期租约与重复结算由SQL拒绝/幂等处理。

Free150秒限制属于复用Worker生命周期；平台仍可能更早终止。Promise.race不能撤销已发送RPC/Storage，晚到写入由fencing和登记路径补偿保护。本地故障测试及原生Deno检查不能代替托管CPU/内存/bundle、真实队列/Storage/SSE验收。不得通过增加套餐、放宽供应商超时或重试未知调用来掩盖限制。
