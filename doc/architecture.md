# zimage 架构文档

> ZImage — 面向设计师的电商图片处理工作台的运行时架构与故障应对手册。
>
> 本文档定位为**架构全景 + 故障应对手册**，面向三类读者：① 系统架构师（评审整体设计）② 新入职工程师（30 分钟内建立心智模型）③ Code Reviewer（评估 PR 是否破坏既有边界）。所有架构决策的来源已在 `requirements.md §1.4` 决策记录、`tech-selection.md §3.x` 技术选型、`doc/review-report-requirements-vs-tech.md`（req ↔ tech 审查）、`doc/review-report-requirements-vs-architecture.md`（req ↔ arch 审查）中锁定，本文不复述决策理由。
>
> **本版本（v1.1）基于 review-report-requirements-vs-architecture.md 修订**：落实 3 项决策澄清（C-AR-1 Storage 访问模式 / C-AR-2 i18n / C-AR-3 工具触发路径图）+ 6 项 MEDIUM GAP + 1 项 Phase2 跟进。详细变更见 §10.1。

---

## 0. 与既有文档的关系

| 主题 | requirements.md §4.1 | tech-selection.md §3.x | **本 architecture.md** |
|---|---|---|---|
| 高层架构图 | ✅ 粗粒度 3 层 | — | ✅ 细粒度 5 层 × 23 模块 |
| 模块职责边界 | — | — | ✅ **核心新增**（§2） |
| 数据流时序图 | 粗流程（聊天 + 工作台两条） | — | ✅ **8 个场景详细时序**（§3.1-§3.8，含 review-report C-AR-3 新增的 §3.8 工具触发路径图） |
| 通信方式 | — | 分散 | ✅ **统一通信矩阵 + 9 端点全景**（§4） |
| 降级策略 | 风险表 §5.2 列出 | §3.13a 部分 | ✅ **8 场景应对路径**（§5） |
| 安全约束 | §4.6 11 条分散 | — | ✅ **§9 安全边界集中视图**（review-report GAP-C2） |
| SLO / 性能 | 1 指标 | — | ✅ **§6 14 项 SLO 指标**（含 review-report GAP-B1 / GAP-L1 新增 2 行） |
| 库 / 版本选型 | — | ✅ | — |
| 数据模型 / SQL | §4.3 | — | —（仅在 §2 L6 Persistence 层 M21-M23 简述） |
| i18n | §4.7 zh-CN 优先 | §2.10 react-i18next | ✅ **M01/M06 各一行**（review-report C-AR-2） |
| Storage 访问模式 | §4.3.2 双 bucket | §3.5 上传客户端 | ✅ **M22 区分 publicUrl / signedUrl**（review-report C-AR-1） |

**阅读建议**：
- 想了解「系统在做什么」→ 先读 §1 模块总览 + §3 核心数据流
- 想了解「某模块如何工作」→ 直接跳到 §2 对应小节
- 想了解「上游出错会怎样」→ §5 降级策略
- 想了解「安全边界」→ §9 安全约束矩阵 + 信任边界
- 想了解「为什么要这样做」→ 回查 requirements.md / tech-selection.md / review-report

---

## 1. 模块总览

### 1.1 模块清单（23 个细粒度模块）

zimage 系统划分为 **5 层 × 23 模块**。每个模块有明确的「职责 / 输入 / 输出 / 失败模式」四要素（详见 §2）。

| 层 | 模块 ID | 名称 | 职责一句话 | 对应技术栈 |
|---|---|---|---|---|
| **L1 Browser** | M01 | Client UI | 渲染聊天 / 工作台 / 首页 UI | Next.js Client Components + @lobehub/ui + antd |
| | M02 | Client Store | 全局状态（聊天流 / 生图配置 / 技能选择） | zustand slices |
| | M03 | Client SSE Parser | 解析 `/api/chat` 的 SSE 事件流 | `packages/fetch-sse` |
| **L2 API Gateway** | M04 | Route Handler | Next.js API 路由入口与 SSE 流写入 | Next.js App Router (Node runtime) |
| | M05 | Auth Middleware | 鉴权 / anon 自动登录 / RLS 上下文注入 | `@supabase/ssr` + AuthBootstrap |
| | M06 | Error Handler | 6 个错误码枚举 → HTTP 状态映射的统一构造 | `packages/shared/errors.ts` |
| **L3 LangGraph** | M07 | LangGraph Agent | 每请求 compile StateGraph + 工具调度 | `@langchain/langgraph` |
| | M08 | LangGraph Checkpointer | 聊天历史持久化（`thread_id` = `sessions.id`） | `@skroyc/langgraph-supabase-checkpointer` |
| | M09 | Tool Registry | 四类工具注册表（custom / langchain / mcp / canvas） | `apps/web/agent/config/unified-tools.config.ts` |
| **L4 Provider** | M10 | Image Provider 抽象 | ImageProvider interface + 参数归一 | `packages/image-providers/src/types.ts` |
| | M11 | Image Adapter: Seedream | 调用火山方舟 Ark API 生图 | 火山方舟 SDK |
| | M12 | Image Adapter: Gemini | 调用 `@google/genai` 生图 | `@google/genai` |
| | M13 | Chat Provider 抽象 | ChatProvider interface + 模型归一 | `packages/chat-providers/src/types.ts` |
| | M14 | Chat Adapter: Doubao | 字节火山聊天模型（OpenAI 兼容） | `@langchain/openai` |
| | M15 | Chat Adapter: MiniMax | MiniMax 聊天模型（Anthropic 兼容） | `@langchain/anthropic` |
| **L5 Middleware** | M16 | Quota Middleware | 配额扣减（30 张/日 UTC）+ 原子事务 | `apps/web/middleware/quota.ts` |
| | M17 | Content Safety Adapter | 委托 provider 网关 + 错误码模式映射（ADR-001） | `packages/shared/safety.ts` + 各 provider adapter 入口 |
| | M18 | Provider Health Monitor | 5 分钟滚动窗口错误率监控 | `apps/web/monitoring/provider-health.ts` |
| | M19 | Reference Image Validator | 上传图片 MIME + 大小（10MB）校验 | `packages/image-providers/src/validate.ts` |
| | M20 | Logger + Sentry | 结构化日志 + 错误埋点 | `pino` + `@sentry/nextjs` |
| **L6 Persistence** | M21 | Supabase Postgres | 5 张业务表 + 2 个 cron job + RLS | Supabase Cloud |
| | M22 | Supabase Storage | generated-images 90 天（publicUrl）/ uploads 30 天（signedUrl） | Supabase Cloud |
| | M23 | Supabase Auth | 匿名登录 + Phase2 OAuth PKCE | `@supabase/ssr` |

> **注**：L5 Middleware 与 L2 API Gateway 在物理位置上都位于 Next.js Route Handler 内，但逻辑上 Middleware 是**横向可复用的处理环节**（Quota 可被 `/api/image` 与 `/api/chat` 共用），而 API Gateway 是**纵向入口层**。本文按"功能模块"而非"代码物理位置"分层。

### 1.2 架构分层图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ L1 Browser (Next.js Client Components)                                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                                   │
│   │ M01 UI   │←→│ M02 Store│  │ M03 SSE  │                                   │
│   └────┬─────┘  └──────────┘  │  Parser  │                                   │
│        │            ↑          └────┬─────┘                                   │
└────────┼────────────┼───────────────┼─────────────────────────────────────────┘
         │ fetch / SSE stream │ 解析后回填 Store
         ▼            │            │
┌─────────────────────────────────────────────────────────────────────────────┐
│ L2 API Gateway (Next.js Route Handler, Node runtime)                         │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                       │
│   │ M04 Route    │  │ M05 Auth     │  │ M06 Error    │                       │
│   │  Handler     │→ │  Middleware  │→ │  Handler     │                       │
│   └──────┬───────┘  └──────────────┘  └──────────────┘                       │
└──────────┼──────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ L3 LangGraph Agent (每请求 compile)                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                       │
│   │ M07 Agent    │←→│ M08 Check-   │  │ M09 Tool     │                       │
│   │  (StateGraph)│  │  pointer     │  │  Registry    │                       │
│   └──────┬───────┘  └──────────────┘  └──────┬───────┘                       │
└──────────┼─────────────────────────────────────┼──────────────────────────────┘
           │                                     │ bindTools(toolIds)
           ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ L4 Provider Layer                                                            │
│   ┌──────────────────────────────────────────┐                               │
│   │ L4a Image Generation                     │                               │
│   │  M10 ImageProvider                       │                               │
│   │   ├─ M11 Seedream Adapter (火山方舟)      │                               │
│   │   └─ M12 Gemini Adapter (@google/genai)  │                               │
│   └──────────────────────────────────────────┘                               │
│   ┌──────────────────────────────────────────┐                               │
│   │ L4b Chat LLM                             │                               │
│   │  M13 ChatProvider                        │                               │
│   │   ├─ M14 Doubao Adapter (OpenAI 兼容)    │                               │
│   │   └─ M15 MiniMax Adapter (Anthropic 兼容)│                               │
│   └──────────────────────────────────────────┘                               │
└──────────┬───────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ L5 Middleware (横向处理环节，可在多个 API 路径复用)                          │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│   │ M16 Quota    │ │ M17 Content   │ │ M18 Provider │ │ M19 RefImage │ ...    │
│   │              │ │   Safety     │ │   Health    │ │   Validator  │        │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│   ┌──────────────┐                                                         │
│   │ M20 Logger + │                                                         │
│   │   Sentry     │                                                         │
│   └──────────────┘                                                         │
└──────────┬───────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ L6 Persistence (Supabase Cloud)                                              │
│   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│   │ M21 Postgres     │  │ M22 Storage      │  │ M23 Auth         │          │
│   │  5 表 + RLS +    │  │  generated-      │  │  anon + Phase2   │          │
│   │  2 cron jobs     │  │  images/uploads  │  │  OAuth PKCE      │          │
│   └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 模块依赖关系（粗略）

- **L1 → L2**：fetch（HTTP/SSE）
- **L2 → L3**：API 路由调用 LangGraph agent（仅 `/api/chat`）；`/api/image` 与 `/api/skills` 等直调 L4 + L5 + L6
- **L3 → L4**：bindTools / model.invoke
- **L4 → L5**：每次生成调用 Quota + Content Safety + RefImage Validator
- **L5 → L6**：DB 读写、Storage 上传、Auth 校验
- **L5 ↔ L6**：Provider Health Monitor 写入内存桶；Sentry 上报 Sentry Cloud（外部）
- **L1 → L5**：前端配额卡片轮询 `/api/quotas`；Provider 健康检查轮询 `/api/health/providers`

> **关键不变量**：L1 与 L3/L4 之间不直接通信（必须经 L2）；L4 抽象层之间不互相调用（Image 与 Chat 解耦）。

---

## 2. 模块详解

> 每个模块包含：**职责** / **输入** / **输出** / **失败模式** / **关键代码位置**。

### L1 Browser Layer

#### M01 Client UI

- **职责**：渲染三个页面（首页 chat hero、`/image` 工作台、聊天页）；触发用户交互事件
- **输入**：用户点击 / 输入 / 拖拽上传；来自 M02 Store 的 state
- **输出**：调用 M02 的 action；触发 fetch/SSE 调 M04
- **失败模式**：组件崩溃由 Sentry `ErrorBoundary` 捕获；UI 降级为骨架屏
- **i18n**（review-report C-AR-2）：所有 UI 文案走 react-i18next，资源包位于 `packages/shared/i18n/zh-CN.ts`；新增文案必须先有 zh-CN key（`packages/shared/i18n/zh-CN.ts` 结构化 key，参考 lobehub-canary `packages/locales/src/default/agent.ts`）
- **关键代码**：`apps/web/app/{page.tsx, image/page.tsx}` + `src/features/{Home,ImageWorkspace,Chat}/*` + `apps/web/src/i18n.ts`

#### M02 Client Store

- **职责**：全局状态管理（聊天消息流 / 生图配置 / 技能选择 / 配额计数）
- **输入**：组件 dispatch action；SSE 解析回填（M03 → M04 → M02）
- **输出**：组件 `useStore(selector)` 订阅；触发 fetch/SSE
- **失败模式**：状态不一致时由 `devtools` 时间旅行调试；zustand 持久化（Phase2）可恢复
- **关键代码**：`apps/web/src/store/{image,chat,skill}/slices/*`（参考 lobehub-canary 分层）

#### M03 Client SSE Parser

- **职责**：解析 `/api/chat` 返回的 SSE 流（6 类事件：`session` / `chunk` / `tool_calls` / `tool_result` / `tool_error` / `end`，详见 tech-selection §2.9）
- **输入**：ReadableStream 二进制块
- **输出**：`onMessage(data, event)` 回调，由 useChatMessages hook 处理
- **失败模式**：
  - **行截断**：缓存残余，下一轮合并
  - **心跳**：忽略（`:heartbeat` 注释行）
  - **连接中断**：见 §5.7 降级策略
- **关键代码**：`packages/fetch-sse/src/index.ts`（从 lobehub-canary `@lobechat/fetch-sse` 抽出）

---

### L2 API Gateway Layer

#### M04 Route Handler

- **职责**：所有 `/api/*` 路由的入口；SSE 流的写入器
- **输入**：HTTP 请求（fetch / multipart / JSON）
- **输出**：JSON 响应 / SSE 流 / HTTP 错误
- **失败模式**：
  - Vercel serverless 60s 超时（`maxDuration = 60`）→ 长任务降级
  - 多实例下 module-level cache 失效 → LangGraph 每请求 compile 解决
- **关键代码**：`apps/web/app/api/{chat,image,skills,topics,health,quotas}/route.ts`

#### M05 Auth Middleware

- **职责**：每个受保护路由鉴权；匿名登录态注入 RLS 上下文
- **输入**：请求 cookies / headers
- **输出**：`auth.uid()`（anon uuid）；RLS 自动按 uid 隔离
- **失败模式**：
  - JWT 过期 → 自动重新 anon signInAnonymously
  - 浏览器首次访问 → AuthBootstrap 静默 anon 登录
- **关键代码**：`apps/web/src/components/AuthBootstrap.tsx` + `libs/supabase/{server,browser}.ts`

#### M06 Error Handler

- **职责**：统一 6 个错误码（`bad_request` / `unauthorized` / `quota_exceeded` / `provider_error` / `network` / `moderation`）→ HTTP 状态码映射（400/401/429/502/503/403）
- **输入**：业务代码抛出的 Error 或显式 code
- **输出**：`Response.json({ error: { code, message } }, { status: ERROR_STATUS[code] })`
- **失败模式**：未捕获异常 → fallback `provider_error` 502 + Sentry 上报
- **i18n**（review-report C-AR-2）：错误消息国际化由 `ERROR_MESSAGES` 中文常量提供（`packages/shared/errors.ts`），UI 端 L1 M01 通过 react-i18next 引用；新增错误码时同步添加中文文案
- **关键代码**：`packages/shared/errors.ts`

---

### L3 LangGraph Agent Layer

#### M07 LangGraph Agent

- **职责**：每请求 compile StateGraph；拼系统消息（base + skill prompt + tool usage prompt）；调度模型与工具
- **输入**：聊天消息 + toolIds + skillId + model 选择
- **输出**：SSE 事件流（M07 → M04 → L1）
- **失败模式**：
  - LLM 调用超时 → 上限重试 1 次 → 失败返回 `provider_error`
  - 工具调用失败 → 走 `tool_error` 事件，前端渲染 `<ErrorCard>`
  - 模型选择器变更 → 自动跳过 unhealthy provider（见 §5.1）
- **关键代码**：`apps/web/agent/chatbot.ts`（每请求 `buildChatGraph({ provider, toolIds, userId })`）

#### M08 LangGraph Checkpointer

- **职责**：聊天历史持久化（key: `thread_id = sessions.id`，value: LangGraph state）
- **输入**：`StateGraph.compile({ checkpointer: new SupabaseSaver(client, undefined, userId) })`
- **输出**：DB 表 `checkpoints`（按 `@skroyc/langgraph-supabase-checkpointer` 库 schema）
- **失败模式**：
  - 写入失败 → 主流程 warn + Sentry（不阻塞回复用户）
  - 读取失败 → 返回空 state（新会话）
  - 删除失败 → §5.4 降级策略
- **关键代码**：`@skroyc/langgraph-supabase-checkpointer` 库 + `supabase/migrations/0003_checkpointer.sql`

#### M09 Tool Registry

- **职责**：四类工具注册表（custom / langchain / mcp / canvas）；按 `toolIds` 选择性 `bindTools`
- **输入**：前端传入 `tools: string[]`（`image_generation` 等）
- **输出**：LangChain `tools` 数组
- **失败模式**：未知 toolId → 静默忽略（不报错）
- **关键代码**：`apps/web/agent/config/unified-tools.config.ts` + `tools/image-generation.ts`

---

### L4 Provider Layer

#### M10 Image Provider 抽象

- **职责**：定义 `ImageProvider` interface；归一不同 provider 的参数/错误/响应
- **输入**：`ImageGenerationParams`（prompt / provider / model / aspectRatio / resolution / imageUrls / num / providerSpecificParams）
- **输出**：`ImageResult[]`（{ url, storagePath, width, height }）
- **失败模式**：归一失败 → 抛 `bad_request`
- **关键代码**：`packages/image-providers/src/types.ts`

#### M11 Image Adapter: Seedream

- **职责**：调用火山方舟 Ark API（`POST /api/v3/images/generations`）；鉴权用 `ARK_API_KEY`
- **输入**：`ImageGenerationParams`
- **输出**：`ImageResult[]`（从火山方舟响应 `.data[]` 映射）
- **失败模式**：
  - HTTP 5xx → `provider_error` 502
  - HTTP 429 → `quota_exceeded`（上游配额耗尽）
  - HTTP 4xx → `bad_request` 400
  - 网络中断 → `network` 503
- **关键代码**：`packages/image-providers/src/seedream.ts`（tech-selection §3.7）

#### M12 Image Adapter: Gemini

- **职责**：调用 `@google/genai` SDK 的 `models.generateContent`（model=`gemini-3-pro-image-preview`，`responseModalities=['IMAGE']`）
- **输入**：`ImageGenerationParams`
- **输出**：`ImageResult[]`
- **失败模式**：与 M11 类似；Gemini 健康检查失败时由 M18 标记为 unhealthy
- **关键代码**：`packages/image-providers/src/gemini.ts`

#### M13 Chat Provider 抽象

- **职责**：定义 `ChatProvider` interface；归一不同 LLM 的 `BaseChatModel`
- **输入**：`provider: 'doubao' | 'minimax'`
- **输出**：`BaseChatModel` 实例（LangChain 标准）
- **失败模式**：未知 provider → 抛 `bad_request`
- **关键代码**：`packages/chat-providers/src/types.ts`

#### M14 Chat Adapter: Doubao

- **职责**：字节火山聊天模型（OpenAI 兼容 baseURL），使用 `ARK_API_KEY`
- **输入**：模型 ID（`process.env.DOUBAO_MODEL ?? 'doubao-pro'`）
- **输出**：`ChatOpenAI` 实例
- **失败模式**：与 LLM 调用相同（详见 M07）
- **关键代码**：`packages/chat-providers/src/doubao.ts`

#### M15 Chat Adapter: MiniMax

- **职责**：MiniMax 聊天模型（Anthropic 兼容 baseURL `https://api.minimaxi.com/anthropic`）
- **输入**：`MINIMAX_MODEL`（接入时确认）
- **输出**：`ChatAnthropic` 实例
- **失败模式**：与 M14 类似；Phase1 实测前不确定
- **关键代码**：`packages/chat-providers/src/minimax.ts`

---

### L5 Middleware Layer

#### M16 Quota Middleware

- **职责**：每个匿名用户每天 30 张配额（UTC 日）；原子扣减；越界返回 `quota_exceeded` HTTP 429
- **输入**：`user_id` + 增量数（默认 1）
- **输出**：`{ used, limit, remaining }` 或抛 `QuotaExceededError`
- **失败模式**：
  - DB 锁冲突 → RPC 重试
  - 越界 → `QuotaExceededError` → `errorResponse(QUOTA_EXCEEDED)` 含 `Retry-After: 86400`
- **关键代码**：`apps/web/middleware/quota.ts` + `supabase/migrations/0006_quotas.sql` + `0007_increment_quota_rpc.sql`

#### M17 Content Safety Adapter（ADR-001）

- **职责**：归一各个 provider 内容安全网关的拦截信号到 zimage 统一的 `moderation` 错误码（HTTP 403）；**不引入独立第三方**内容安全供应商。
- **输入**：`ProviderError { code?: string, message?: string }`，由 M11 / M12 / M14 / M15 在调用 provider 抛出错误时传入
- **输出**：命中拦截模式 → 抛 `ContentModerationError`（由 M06 Error Handler 映射为 `moderation` 403）；未命中 → 交由 `classifyError()` 归一到 `provider_error` / `network` 等
- **失败模式**：
  - Provider 拦截信号漏识别 → Sentry metric `safety.detection.miss`（运营监控复盘）
  - 拦截模式新增 → append-only，避免历史 generation 被误判 `provider_error`
- **审计落库**：被判定 `moderation` 的 generations 写 `image_safety_audits` 表（reason = provider code + message）
- **i18n**：用户面向文案走 `ERROR_MESSAGES.moderation`，Phase2 切换英文沿用 lobehub 风格 `errorContentModeration`
- **关键代码**：`packages/shared/safety.ts` `isProviderModeration()` + 各 `packages/{image-providers,chat-providers}/src/*` adapter 入口 + `apps/web/middleware/error-handler.ts`（tech-selection §3.12）

#### M18 Provider Health Monitor

- **职责**：5 分钟滚动窗口统计各 provider 错误率；错误率 > 50% 标记 unhealthy
- **输入**：每次 provider 调用的 success/error 信号
- **输出**：`isProviderHealthy(provider) → boolean`；API endpoint `/api/health/providers`
- **失败模式**：
  - 样本不足（<10 calls/5min）→ 默认健康（避免冷启动误判）
  - 告警写日志 + Sentry，**不阻塞主流程**
- **关键代码**：`apps/web/monitoring/provider-health.ts`（tech-selection §3.13a）

#### M19 Reference Image Validator

- **职责**：参考图上传校验——MIME ∈ {png, jpeg, webp} + sizeBytes ≤ 10MB + 最多 4 张
- **输入**：`imageUrls: string[]`
- **输出**：通过 / 抛 `ReferenceImageValidationError`
- **失败模式**：不通过 → `bad_request` HTTP 400
- **关键代码**：`packages/image-providers/src/validate.ts`（tech-selection §3.7）

#### M20 Logger + Sentry

- **职责**：结构化 JSON 日志（pino）+ Sentry 错误埋点；脱敏（不打印 prompt / apiKey 全量）
- **输入**：所有模块调用 `logger.info/warn/error()` + `Sentry.captureException()`
- **输出**：本地日志（PM2 兜底）/ Sentry Cloud
- **失败模式**：Sentry 上报失败 → 主流程不受影响（异步非阻塞）
- **关键代码**：`apps/web/libs/logger.ts` + `sentry.{client,server}.config.ts`

---

### L6 Persistence Layer

#### M21 Supabase Postgres

- **职责**：5 张业务表（topics / generation_batches / generations / sessions / image_safety_audits）+ 配额表（quotas）+ checkpointer 表 + 3 个 cron job
- **输入**：所有 L2-L5 的 DB 操作（RLS 自动按 `auth.uid()` 隔离）
- **输出**：rows / RPC 返回值
- **失败模式**：
  - 连接失败 → 上层 retry 1 次 → 失败 5xx
  - 迁移漂移 → `supabase db diff` CI 校验
- **关键代码**：`supabase/migrations/*.sql`（11 个迁移文件）

#### M22 Supabase Storage

- **职责**：两个 bucket，**访问模式不同**（review-report C-AR-1）：
  - `generated-images`：**public 读**，90 天生命周期，路径 `generated/{user_id}/{batch_id}/{generation_id}.{ext}`
  - `uploads`：**private**，30 天生命周期，路径 `uploads/{user_id}/{uuid}.{ext}`（参考图）
- **输入**：上传 buffer / 删除 path 列表
- **输出**：**按 bucket 属性选择**：
  - `generated-images` → `publicUrl`（直接 `getPublicUrl()`，与 LangGraphPj 一致）
  - `uploads` → `signedUrl`（1h 过期签名 `createSignedUrl()`，zimage 独有）
- **失败模式**：
  - 上传失败 → generation.status='failed' + `provider_error`
  - 删除失败 → §5.4 / tech-selection §3.5a cron 兜底
  - signed URL 过期 → L1 M01 自动重新获取（不影响用户）
- **关键代码**：`apps/web/services/storage.service.ts`（两个 bucket 用同一服务但走不同 API：`storage.from('generated-images').getPublicUrl()` vs `storage.from('uploads').createSignedUrl(path, 3600)`）+ `supabase/migrations/0009_storage_lifecycle.sql`

#### M23 Supabase Auth

- **职责**：匿名登录（Phase1）+ OAuth PKCE（Phase2）；JWT 颁发；anon uuid 持久化到浏览器 cookie
- **输入**：`signInAnonymously()` / OAuth callback
- **输出**：`{ user: { id }, session }`
- **失败模式**：登录失败 → 5xx 错误，前端显示重试
- **关键代码**：`@supabase/ssr` + `AuthBootstrap.tsx`

---

## 3. 核心数据流

> 本节给出 7 个关键场景的时序图。每个场景展示：从触发到结束的完整调用链 + 失败分支点。
> 时序图采用 mermaid sequenceDiagram 语法 + 关键节点文字注解的混合形式，确保可读性与完整性。

### 3.1 聊天链路（核心场景）

**触发条件**：用户在首页 / `/chat` 输入文本并提交，含技能选择 + 工具勾选。

```mermaid
sequenceDiagram
    autonumber
    participant U as User<br/>(Browser)
    participant M01 as M01 UI
    participant M02 as M02 Store
    participant M04 as M04 Route Handler<br/>(/api/chat)
    participant M05 as M05 Auth
    participant M07 as M07 LangGraph Agent
    participant M08 as M08 Checkpointer
    participant M14 as M14 Chat Adapter<br/>(Doubao / MiniMax)
    participant M18 as M18 Provider Health
    participant M21 as M21 Postgres

    U->>M01: 输入消息 + 选 SKILL + 勾选 image_generation
    M01->>M02: dispatch(sendMessage)
    M02->>M04: POST /api/chat (SSE stream)
    M04->>M05: getUser() 鉴权
    M05-->>M04: anonUid
    M04->>M07: buildChatGraph({ provider, toolIds, userId, skillId })
    M07->>M18: isProviderHealthy(provider)?
    alt 不健康
        M18-->>M07: false（自动选健康 provider）
    end
    M07->>M08: new SupabaseSaver(client, undefined, anonUid)
    M07->>M07: 拼系统消息：base + skill prompt + tool usage prompt
    M07->>M07: compile({ checkpointer })
    M07->>M14: model.invoke(messages)
    M14-->>M07: 增量 tokens
    M07->>M04: emit SSE 'session' { threadId }
    M07->>M04: emit SSE 'chunk' { text }
    M04->>M01: SSE 流 (ReadableStream)
    M01->>M03: parseSseEvents
    M03->>M02: appendChunk(text)
    M02->>M01: 渲染增量文本

    opt 模型决定调用 image_generation
        M07->>M04: emit SSE 'tool_calls' { toolId, args }
        M07->>M11: ImageProvider.generate()
        M11->>M11: isProviderModeration(err) 检查 catch 块
        alt provider 网关拦截（ADR-001）
            M11-->>M07: throw ContentModerationError
            M07->>M04: emit SSE 'tool_error' { code: 'moderation' }
            M04->>M01: ErrorCard
            M11->>M21: 写 image_safety_audits 拦截证据
        else 正常
            M11->>M22: upload to Storage
            M22-->>M11: publicUrl
            M11-->>M07: ImageResult[]
            M07->>M04: emit SSE 'tool_result' { ImageCard data }
            M04->>M01: 渲染图片卡片
        end
    end

    M07->>M08: state.save() (异步)
    M07->>M04: emit SSE 'end' {}
    M04->>M01: 关闭流
```

**关键节点注解**：
- 节点 8（Provider Health）：每次请求前查询，不健康时自动切换到另一 provider（见 §5.1）
- 节点 14（系统消息拼装）：base + skill.triggers.providerHints 触发的 skill prompt + toolIds 触发的 tool usage prompt
- 节点 17（**ADR-001 内容安全拦截点**）：M11 adapter `generate()` 内 `catch` 块，命中 `isProviderModeration(err)` → 抛 `ContentModerationError`，无中间件 preCheck/postCheck 同步调用
- 节点 21（save）：checkpointer 写入失败仅 warn，不阻塞 SSE 'end' 发送

**失败分支**：
- 模型调用失败 → 自动重试 1 次（同 provider）→ 失败 `provider_error` 502 + `<ErrorCard>`
- provider 网关拦截（ADR-001） → M11 throw `ContentModerationError` → SSE `tool_error` → 前端 ErrorCard → M21 `image_safety_audits` 写入拦截证据

---

### 3.2 工作台批量生图（核心场景）

**触发条件**：用户在 `/image` 工作台提交 prompt + 配置（provider/model/aspect/resolution/num 1-4）。

**前置：参考图上传与自动尺寸推断**（review-report GAP-A2）：

```
[L1 M01] 用户拖拽首张参考图到 <UploadDropzone>
  ↓
[L1 M02] dispatch(addReferenceImage({ file, previewUrl, mimeType, sizeBytes }))
  ↓
[L1 M01] onReferenceImageAdded:
  ├─ 客户端校验: MIME ∈ {png, jpeg, webp} & sizeBytes ≤ 10MB（M19 RefImage Validator 同步规则）
  ├─ 上传到 M22 storage.from('uploads') 拿 signedUrl（zimage 独有 private bucket 模式）
  ├─ 推断 aspectRatio = readImageDimensions(file) → '1:1' / '3:4' / ...
  └─ 预填表单字段: aspectRatio 默认值（如未手动设置）
  ↓
[L1 M01] 用户可手动覆盖 aspectRatio（显式选择）
```

**主链路**：

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant M01 as M01 UI
    participant M04 as M04 Route Handler<br/>(/api/image POST)
    participant M05 as M05 Auth
    participant M16 as M16 Quota
    participant M21 as M21 Postgres<br/>(create_generation_batch RPC)
    participant M19 as M19 RefImage Validator
    participant M11 as M11 Image Adapter
    participant M22 as M22 Storage
    participant M01b as M01 UI<br/>(SWR 轮询)

    U->>M01: 提交表单（已含参考图与自动设尺寸）
    M01->>M04: POST /api/image {prompt, params, topicId?, skillId?}
    M04->>M05: getUser()
    M04->>M16: checkAndIncrementQuota(user.id, num)
    alt quota exceeded
        M16-->>M04: QuotaExceededError
        M04-->>M01: 429 quota_exceeded
        M01->>U: 显示「今日配额已用完」
    else quota ok
        M16-->>M04: { used, limit, remaining }
        M04->>M21: rpc('create_generation_batch', {num})
        M21-->>M04: { batch, generations[pending] }
        M04-->>M01: 200 { taskId=batchId, batchId, generations }
        M01->>M01b: 立即渲染 pending 卡片
        M01b->>M04: GET /api/image/[taskId] (SWR 2s 轮询)

        par 异步生成（fire-and-forget, ADR-001 无前置 preCheck）
            M04->>M19: validateReferenceImages() — 服务端二次校验
            M19-->>M04: ok
            M04->>M11: ImageProvider.generate() × N
            loop 每张图
                M11->>M11: try { generate() } catch (err)
                alt provider 网关拦截（ADR-001，isProviderModeration 命中）
                    M11-->>M11: throw ContentModerationError
                    M11->>M21: 写 image_safety_audits（verdict='block', reasons=provider code/message）
                    M11->>M21: update generation.status='failed', error_code='moderation'
                else 正常
                    M11->>M22: upload(buffer) → publicUrl（generated-images public bucket）
                    M22-->>M11: { url, storage_path }
                    M11->>M21: update generation.status='succeeded'
                end
            end
        end
    end

    M01b->>M04: GET /api/image/[taskId] (持续轮询)
    M04-->>M01b: { generations: [{status, image_url, error_code, ...}] }
    M01b->>U: 渲染 succeeded/failed 卡片
```

**关键节点注解**：
- **节点 0（前置：参考图上传与自动尺寸推断，review-report GAP-A2）**：客户端首图上传后立即读 `Image.naturalWidth/naturalHeight` 推断比例（5 种 enum 之一），预填表单的 `aspectRatio`；用户可手动覆盖
- 节点 5（Quota）：用 RPC 原子事务（`increment_quota`）保证并发越界保护
- 节点 11（pending generations）：同步建 batch + N 条 generations（status='pending'）后立即返回；前端 SWR 轮询
- 节点 16（async fire-and-forget）：`process.nextTick` 派发；不阻塞 200 响应
- 节点 18-22（per-generation loop）：每张图独立状态，失败不影响其他
- **节点 22（M22 Storage 上传 review-report C-AR-1）**：generated-images 是 public bucket，返回 `publicUrl` 直传前端展示；uploads 是 private bucket（仅前端参考图上传路径），返回 `signedUrl`（1h 过期）
- **ADR-001 拦截点**：M11 adapter `generate()` 内 `catch` 块，命中 `isProviderModeration(err)` → throw `ContentModerationError`，无前置 preCheck / postCheck 同步调用

**失败分支**：
- 参考图 MIME/大小不通过：客户端 toast 立即拒绝（不等服务端）；服务端 M19 二次校验失败 → 400 `bad_request`
- Quota 越界：429 → 前端禁用重试按钮
- provider 网关拦截（ADR-001）：单张 generation.status='failed'，其他张继续；同步写 `image_safety_audits` 留证
- Provider 5xx：generation.status='failed', error_code='provider_error'

---

### 3.3 工具调用生图（聊天内生图）

**触发条件**：在聊天中，模型判断需调用 `image_generation` 工具（基于工具描述 + 用户意图）。

```
[L3 LangGraph Agent]
  ├─ 模型输出含 tool_calls [{ name: 'image_generation', args: { prompt, ... } }]
  ├─ emit SSE 'tool_calls' 事件
  ├─ 调 image_generation handler:
  │    ├─ L19 校验 imageUrls (10MB/MIME)
  │    ├─ L11 Seedream/Gemini.generate() — ADR-001 catch 块命中 isProviderModeration → 抛 ContentModerationError
  │    ├─ L22 Storage.upload()
  │    ├─ 写 generations 表 (status='succeeded', image_url, storage_path)
  │    │   或 status='failed' / error_code='moderation'（命中拦截时，同步写 image_safety_audits）
  │    └─ 返回 ImageCard 数据 (URL + 元信息)
  ├─ emit SSE 'tool_result' { toolId, result: ImageCard }
  └─ 继续模型生成（拼 ImageCard 到回复上下文）
```

**与 §3.2 工作台链路的区别**：
- 工作台走 M04 `/api/image` 直调，**不经 L3 LangGraph**
- 工具调用走 L3 LangGraph 内 `ToolNode`，结果通过 SSE `tool_result` 事件回传 L1
- 工作台生成图片落 DB（generations 表）；工具调用生成的图**不落 DB**（仅供当前聊天流展示）—— Phase1 设计选择，避免污染历史库

---

### 3.4 SKILL.md 加载与模板填充

```
[L1 M01] 选中技能 (e.g. 'white-bg') 
  ↓
[L1 M02] dispatch(setActiveSkill('white-bg'))
  ↓
[L2 M04] GET /api/skills → 返回 Skill[] (meta + promptTemplate)
  ↓
[L1 M01] <SkillRequiredFields> 显示 params: ['imageUrls']（review-report GAP-A1）
  ↓
[L1 M01] useSkillPrompt hook: renderSkillPrompt(skill, { prompt: '', imageUrls: [] })
  ↓
[L1 M01] 预览区显示：替换占位符后的完整系统提示词（review-report GAP-A1）
  ↓
[L1 M01] 用户填必填字段（imageUrls 上传）
  ├─ 字段缺失 → useSkillPrompt.getMissingFields() 返回缺失列表 → 字段标红
  └─ 字段填全 → 预览实时更新 + 提交按钮可点击
  ↓
[L3 M07] chatbotNode:
  1. loadSkill('white-bg') - 读 packages/skills/skills/white-bg/SKILL.md
  2. parseSkill(raw) - 拆 frontmatter (yaml) + body
  3. renderSkillPrompt(skill, { prompt, imageUrls }) - 替换 {prompt}/{imageUrls} 占位符
  4. 拼系统消息: [base system] + [rendered skill prompt] + [tool usage prompt]
  5. effectiveProvider = skill.triggers.providerHints[0] ?? 'seedream'
  6. enabledTools = skill.triggers.tools // 自动 bindTools
```

**关键设计**：
- 技能切换是**纯前端 + LangGraph 系统消息层**的事情，**不经 M04 后端 API**
- SKILL.md 在 Phase1 是文件加载（`packages/skills/skills/`），Phase2 才考虑 DB 化
- **必填字段缺失**（review-report GAP-A1）：
  - L1 表单层由 `useSkillPrompt.getMissingFields()` 标红（用户感知）
  - L3 chatbotNode 内做兜底校验（服务端不能信任前端）
  - 缺失项**不阻塞**发送，但服务端 reject + 提示错误
- **工作台预览**（review-report GAP-A1）：`<GenerationForm>` 内集成 `useSkillPrompt` hook，预览区直接显示 SKILL.md 模板填充结果（可二次编辑）

---

### 3.5 配额扣减（原子事务）

```sql
-- supabase/migrations/0007_increment_quota_rpc.sql
BEGIN;
  -- UPSERT 当日 quota 行 + SELECT FOR UPDATE
  INSERT INTO quotas (user_id, quota_date, used_count)
  VALUES (p_user_id, p_quota_date, 0)
  ON CONFLICT DO NOTHING;

  SELECT used_count INTO v_used
  FROM quotas WHERE user_id = p_user_id AND quota_date = p_quota_date
  FOR UPDATE;

  IF v_used + p_increment > p_limit THEN
    RETURN QUERY SELECT v_used, 'exceeded'::text;
    -- 不 COMMIT，事务回滚
  END IF;

  UPDATE quotas SET used_count = used_count + p_increment, last_reset_at = now()
  WHERE user_id = p_user_id AND quota_date = p_quota_date;

  RETURN QUERY SELECT v_used + p_increment, 'ok'::text;
COMMIT;
```

**调用点**：
- `/api/image` POST：扣 `body.params.num`
- `/api/chat` 调用 `image_generation` 工具：扣 1
- `/api/image/recreate` POST：扣选中目标数

**关键设计**：
- `FOR UPDATE` 行锁避免并发越界（同一 uid 多次并发请求安全）
- 越界时 `RETURN ... 'exceeded'` 而非抛异常，事务回滚后 L16 抛 `QuotaExceededError`

---

### 3.6 Provider 健康检查（5 分钟滚动窗口）

```
[L11 Seedream Adapter] 或 [L12 Gemini Adapter]
  ↓ generate() 返回成功/失败
[L18 Provider Health Monitor]
  ├─ recordProviderCall(provider, isError)
  │    └─ buckets.set(`${provider}:${windowStart}`, { totalCalls++, errorCalls++ })
  ├─ 清理过期桶（保留最近 1 个完整窗口）
  └─ isProviderHealthy(provider)
       ├─ sampleSize < 10 → 默认 true（冷启动保护）
       └─ errorRate > 0.5 → false

[L1 M01 /image ConfigPanel] 60s 轮询 GET /api/health/providers
  ↓ 返回 { providers: [{ name, healthy, errorRate, sampleSize }] }
[L1 M01] ModelSwitchPanel:
  ├─ unhealthy provider → 显示「限上」Tag + disabled
  └─ 当前选中变 unhealthy → 顶部 toast「X 不可用，已自动切换 Y」

[L1 M01 useAutoDegrade hook] 监听 unhealthy，自动切到健康 provider
```

**告警写日志**（Phase2 才外发 Lark/钉钉/PagerDuty）：
- `logger.warn({ provider, errorRate, sampleSize }, 'provider unhealthy')`
- `Sentry.captureMessage(...)`

---

### 3.7 内容安全（ADR-001：provider 网关拦截 + adapter 归一）

```
[L4 M11 Seedream Adapter | M12 Gemini Adapter] generate(prompt, imageUrls)
  ↓
[L4 adapter 内部] catch (providerErr):
  ├─ isProviderModeration(providerErr) === true
  │    ├─ 命中拦截模式 → throw ContentModerationError(reason)
  │    └─ 未命中 → classifyError(providerErr) → provider_error / network / bad_request
  ├─ 写 image_safety_audits 表（仅命中 moderation 时）
  └─ 上抛至 M06 Error Handler → HTTP 403 moderation

[未拦截 ↓]
[L6 M22 Storage] upload(buffer)
  ↓ 落 generations.status='succeeded'
```

**拦截模式来源**：`packages/shared/safety.ts` `isProviderModeration()`，模式集合 append-only。
**模式覆盖**：
- Google Gemini：`InputTextSensitiveContentDetected` / `content_policy_violation`
- 火山方舟 Ark：`sensitive_information_detected`
- Doubao / MiniMax：`moderation_blocked` 等错误码
- 中英文消息兜底关键词：`content policy` / `safety system` / `sensitive information` / `content moderation` / `内容违规` / `敏感信息`

**为什么不独立中间件**：
- ❌ 旧方案需在生图前同步 HTTP 调用第三方，预 check 抢 ~500ms~2s
- ❌ 旧方案需对图像 buffer 二次调用第三方，post check 又加 ~500ms~2s
- ✅ provider 网关自带内容安全（Google 安全过滤 / OpenAI content policy / 火山 sensitive_word 等）
- ✅ adapter 一次性拦截，零额外延迟（参考 lobehub-canary 21 行 `contentPolicyError.ts`）

**审计回流**：每次拦截写一条 `image_safety_audits` 记录（reason = provider code / message），可由运营复盘模式覆盖率。

**降级行为**：provider 网关不可用 → 与一般 `provider_error` 同样处理（M11/M12 抛 `provider_error` 5xx），不区分「网关挂了」vs「网关拦截」。

---

### 3.8 工具触发路径（三种触发方式）

> requirements §3.3 明确规定图片工具有 3 种触发路径（review-report C-AR-3）。本节为每条路径给出独立时序图，覆盖 requirements §3.3 的全部触发入口。
>
> 共同前置：图片工具默认关闭，三种打开路径独立生效。

#### 3.8.1 路径 A：手动勾选（ToolSelector）

**触发条件**：用户在聊天输入框旁 `<ToolSelector>` 显式勾选「图片工具」。

```
[L1 M01] ToolSelector UI: 用户勾选 image_generation
  ↓
[L1 M02] dispatch(setEnabledTools(['image_generation']))
  ↓
[L2 M04] POST /api/chat { message, thread_id?, tools: ['image_generation'], ... }
  ↓
[L3 M07] chatbotNode:
  ├─ 按 toolIds 选择性 bindTools: [image_generation]
  ├─ model.invoke(messages) — 模型根据工具描述判断是否调用
  └─ 显式提示词如「生成」「画一张」触发工具调用
  ↓ (后续走 §3.1 聊天链路，进入 image_generation tool 执行)
```

**关键设计**：
- `toolIds` 是会话级开关（zustand 持久化在 M02 Store），刷新页面后保持
- 模型根据工具描述（"用于生成图片；当用户明确要求出图且提示词含人物 / 场景 / 商品 / 服饰等关键信息时调用"）判断是否真调
- 未勾选时 `toolIds=[]` → `bindTools([])` → 模型看不到工具描述 → 不会调用

#### 3.8.2 路径 B：技能自动启用（triggers.tools）

**触发条件**：用户选中任一服饰技能（`white-bg` / `model-image` / `scene`），从 `skill.triggers.tools` 读取并自动启用。

```
[L1 M01] <SkillSelector>: 用户选中 'white-bg'
  ↓
[L1 M02] dispatch(setActiveSkill('white-bg'))
  ↓
[L1 M01] useEffect 监听 skillId 变化 → dispatch(setEnabledTools(skill.triggers.tools))
  └─ skill.triggers.tools = ['image_generation']（从 SKILL.md frontmatter 读取）
  ↓
[L2 M04] POST /api/chat { skillId: 'white-bg', tools: ['image_generation'], ... }
  ↓
[L3 M07] chatbotNode:
  ├─ loadSkill('white-bg') → parseSkill → renderSkillPrompt
  ├─ 系统消息: [base] + [rendered skill prompt] + [tool usage prompt（triggers.tools 启用时）]
  ├─ effectiveProvider = skill.triggers.providerHints[0] ?? 'seedream'
  └─ bindTools(skill.triggers.tools) — 即使前端未传 toolIds，技能也可自动启用
  ↓ (后续走 §3.1 聊天链路)
```

**关键设计**：
- 技能切换是**纯前端 + LangGraph 系统消息层**的事，**不经 L2 M04 后端 API**
- `skill.triggers.tools` 在 SKILL.md frontmatter 中声明（例：`tools: [image_generation]`）
- Phase2 v1.1 扩展（卖点图/A+/尺码图）时，新技能可能启用多个工具

#### 3.8.3 路径 C：意图识别（模型判断）

**触发条件**：未勾选工具也未选技能，但用户消息含显式出图意图（"生成"、"画一张"、"做白底图"等）。

```
[L1 M01] 用户输入: "帮我生成一张白底图"（toolIds=[]，未选技能）
  ↓
[L2 M04] POST /api/chat { message: '帮我生成一张白底图', tools: [], ... }
  ↓
[L3 M07] chatbotNode:
  ├─ toolIds=[] → bindTools([])
  ├─ 模型看不到工具描述 → 不会调用 image_generation tool
  └─ **本路径不生效**（模型无法在 toolIds=[] 时调用工具）
  ↓
[L1 M01] 模型回复: "请先在工具栏勾选'图片工具'或选择一个服饰技能"
```

**关键设计**：
- 路径 C 的"意图识别"**依赖路径 A 或 B 的前置启用**：模型判断调用需基于工具描述可见
- 严格说，路径 C 是路径 A/B 的**激活后行为**，不是独立路径
- requirements §3.3 描述为三条独立路径是**用户体验上的区分**（手动 vs 技能 vs "我直接说要生成"），但**架构上是 A 或 B 触发 → C 行为**

#### 3.8.4 路径对比表

| 维度 | 路径 A 手动勾选 | 路径 B 技能自动 | 路径 C 意图识别 |
|---|---|---|---|
| 用户操作 | ToolSelector 勾选 | SkillSelector 选中 | 直接说"生成..." |
| 工具启用时机 | UI 操作时立即 | UI 操作时立即 | 不需要（依赖 A/B） |
| 工具描述对模型可见 | ✅ | ✅ | 需 A 或 B 先启用 |
| `bindTools` 入参 | `toolIds` | `skill.triggers.tools` | 需 A 或 B |
| 系统消息 | base | base + skill prompt + tool usage prompt | base（无 skill） |
| effectiveProvider | UI 选择 | `skill.triggers.providerHints[0]` | UI 选择 |
| 工作台适用？ | ❌ | ❌（走工具栏） | ❌（走工具栏） |

> **/image 工作台不参与触发路径**：工作台直接 POST `/api/image`，不经 LangGraph agent，工具触发机制与工作台链路无关（详见 §3.2 数据流）。

---

## 4. 模块间通信矩阵

> 本节列出 23 个模块之间的主通信路径（共约 25 条）+ 9 个 API 端点全景。

### 4.1 通信方式分类

| 方式 | 协议 | 同步性 | 用途 |
|---|---|---|---|
| **HTTP REST** | fetch / `openapi-fetch` | 同步（请求-响应） | UI ↔ API Gateway、表单提交、状态查询 |
| **SSE 流** | ReadableStream + text/event-stream | 异步（服务端推送） | `/api/chat` 长连接 |
| **DB 直查** | `@supabase/ssr` + RLS | 同步（单次 RPC） | 配额扣减、状态轮询 |
| **DB RPC** | PostgreSQL `FUNCTION` + transaction | 同步（事务保证） | 配额原子扣减、batch 事务创建 |
| **LangChain Tool** | `model.bindTools()` + `ToolNode` | 异步（agent 调度） | LangGraph 工具调用 |
| **Memory** | 进程内 Map | 同步（进程局部） | Provider Health 桶、in-memory cache |
| **3rd-party API** | fetch + 各 provider SDK | 同步（请求-响应） | 火山方舟 / Gemini / Doubao / MiniMax / 内容安全已并入 provider 网关（ADR-001） |
| **Storage** | `@supabase/supabase-js` upload | 异步（流式上传） | 图片 buffer 落 Storage |
| **Sentry** | `@sentry/nextjs` SDK | 异步（非阻塞） | 错误埋点、性能监控 |

### 4.2 通信矩阵

| # | 源模块 | 目标模块 | 方式 | 协议 / 端点 | 同步性 | 关键约束 |
|---|---|---|---|---|---|---|
| 1 | M01 UI | M02 Store | In-process | zustand action dispatch | 同步 | — |
| 2 | M01 UI | M04 Route Handler | HTTP | `POST /api/chat` (SSE) | 异步推送 | ReadableStream 心跳 15s |
| 3 | M01 UI | M04 Route Handler | HTTP | `POST /api/image` | 同步（≤500ms） | 返回后 SWR 轮询 |
| 4 | M01 UI | M04 Route Handler | HTTP | `GET /api/image/[taskId]` | 同步（轮询 2s） | SWR `refreshInterval: 2000` |
| 5 | M01 UI | M04 Route Handler | HTTP | `GET /api/skills` | 同步 | — |
| 6 | M01 UI | M04 Route Handler | HTTP | `GET /api/health/providers` | 同步（轮询 60s） | Provider 状态轮询 |
| 7 | M01 UI | M04 Route Handler | HTTP | `GET /api/quotas` | 同步（轮询 30s） | 配额卡片实时显示 |
| 8 | ~~M01 UI ↔ /api/image/safety-check~~ | **ADR-001 已删除该端点**（provider 网关拦截信号已异步返回，前端展示 `<ErrorCard>`） | — | — | — |
| 9 | M01 UI | M04 Route Handler | HTTP | `DELETE /api/chat/sessions/[id]` | 同步 | 同步清 checkpointer + storage |
| 10 | M01 UI | M04 Route Handler | HTTP | `POST /api/image/recreate` | 同步（≤500ms） | 三模式重生成 |
| 11 | M03 SSE Parser | M02 Store | In-process | `onMessage` callback | 同步（解析后） | 行截断 + 心跳容错 |
| 12 | M04 Route Handler | M05 Auth | DB | `supabase.auth.getUser()` | 同步（≤100ms） | cookie JWT 解码 |
| 13 | M04 Route Handler | M07 LangGraph | In-process | `buildChatGraph().invoke()` | 异步（SSE） | 每请求 compile |
| 14 | M04 Route Handler | M11/M12 Image Adapter | In-process | `imageProvider.generate()` | 同步（最长 60s） | maxDuration=60 |
| 15 | M04 Route Handler | M16 Quota | DB RPC | `increment_quota(...)` | 同步（事务） | FOR UPDATE 行锁 |
| 16 | M04 Route Handler | M19 RefImage Validator | 3rd-party HTTP | `fetch(url, { method: 'HEAD' })` | 同步 | MIME + size 校验（不再含 Content Safety 第三方调用） |
| 17 | M04 Route Handler | M21 Postgres | DB | `INSERT/UPDATE/SELECT` | 同步（≤500ms） | RLS 自动按 uid |
| 18 | M04 Route Handler | M22 Storage | DB | `storage.upload()` | 异步（流式） | 失败回滚 generation |
| 19 | M04 Route Handler | M20 Logger | In-process | `logger.info/warn/error` | 异步（非阻塞） | 脱敏 prompt/apiKey |
| 20 | M07 LangGraph | M08 Checkpointer | DB | `SupabaseSaver` 自动 | 异步（状态保存） | 失败仅 warn |
| 21 | M07 LangGraph | M09 Tool Registry | In-process | `createLangChainTools(toolIds)` | 同步（按需加载） | — |
| 22 | M07 LangGraph | M11/M12 Image Adapter | LangChain Tool | `model.invoke(tool_call)` | 异步 | ADR-001：拦截在 adapter 入口 `isProviderModeration` |
| 23 | M07 LangGraph | M14/M15 Chat Adapter | LangChain | `model.invoke(messages)` | 异步（SSE chunk） | 增量 tokens |
| 24 | M11/M12 Image Adapter | M22 Storage | DB | `storage.upload(buffer)` | 异步 | 失败 → generation='failed' |
| 25 | M11/M12 Image Adapter | M18 Provider Health | In-process | `recordProviderCall()` | 同步（内存写入） | 5 分钟桶 |
| 26 | M11/M12 Image Adapter | 火山方舟 / @google/genai | 3rd-party HTTP | `POST /images/generations` | 同步（≤60s） | maxDuration=60 |
| 27 | M14/M15 Chat Adapter | Doubao / MiniMax | 3rd-party HTTP | OpenAI / Anthropic 兼容 | 异步（SSE） | — |
| 28 | M11/M12/M14/M15 Provider Adapter | M17 Content Safety Adapter | In-process | `isProviderModeration(err)` 模式匹配 | 同步（一次性） | provider 网关拦截归一 |
| 29 | M19 RefImage Validator | Storage 对象 | HTTP HEAD | `fetch(url, { method: 'HEAD' })` | 同步 | MIME + size 校验 |
| 30 | M20 Logger + Sentry | pino / Sentry Cloud | In-process + 3rd-party | — | 异步（非阻塞） | — |

### 4.3 通信模式总结

- **同步链路**：UI 表单提交、配额扣减、provider 健康检查 → 都是**请求-响应模式**，超时需明确上限（内容安全由 provider 网关拦截，零额外同步调用，ADR-001）
- **异步链路**：聊天 SSE 流、生图 async fire-and-forget、checkpointer 状态保存 → 都是**单向推送 / 后台处理**
- **关键异步边界**：M04 `/api/image` POST 在 N+1 张图场景下，**只同步建 batch + generations 记录，立即返回 200**，实际生成在 `process.nextTick` 后台跑；前端通过 SWR 轮询感知进度。这一边界是 Phase1 区分「同步 API」与「异步队列」的过渡设计（v1.2 改为 Supabase Edge Function 队列后接口不变）。

---

### 4.4 API 端点全景

> review-report GAP-C1：requirements §4.4.1–§4.4.3 共定义 9 个 API 端点，本节集中列出。本节为**接口契约**，实现细节见 tech-selection §3.x。

| # | 方法 + 路径 | 功能 | 关键模块 | 同步性 | 备注 |
|---|---|---|---|---|---|
| 1 | `POST /api/chat` | 聊天 SSE 流 | M04 + M07 + M03 | 异步推送 | 首事件 `session`，末事件 `end`，中间 4 类工具事件 |
| 2 | `GET /api/chat/sessions` | 聊天会话列表 | M04 + M21 | 同步 | — |
| 3 | `POST /api/chat/sessions` | 创建新会话 | M04 + M21 | 同步 | — |
| 4 | `PATCH /api/chat/sessions` | 更新会话（重命名） | M04 + M21 | 同步 | — |
| 5 | `DELETE /api/chat/sessions/[id]` | 删会话 + 同步清 checkpointer + Storage | M04 + M21 + M08 + M22 | 同步 | §5.4 4 阶段清理 |
| 6 | `GET /api/image/[taskId]` | 单 batch 状态轮询 | M04 + M21 | 同步 | SWR 2s 间隔 |
| 7 | `POST /api/image` | 创建生成任务 | M04 + M16 + M21 | 同步（≤500ms，lambda 部分） | async fire-and-forget 后续生成（ADR-001 移除 M17 preCheck 同步调用） |
| 8 | `POST /api/image/recreate` | 重生成三模式 | M04 + M16 + M21 | 同步 | `single` / `failed` / `all` |
| 9 | `POST /api/image/safety-check` | ~~内容安全实时预览~~（ADR-001 删除该端点） | — | — | Phase1 由前端展示 provider 网关拦截错误即可 |

> **超出 9 端点的扩展端点**（不在 requirements §4.4 强制范围，属架构建议）：
> - `GET /api/skills` — 技能列表
> - `GET /api/topics` / `POST /api/topics` / `GET /api/topics/[id]/batches` — 话题 CRUD
> - `GET /api/health/providers` — Provider 健康状态（review-report §3.13a）
> - `GET /api/quotas` — 配额查询（review-report §3.7b）
> - `GET /api/openapi.json` — OpenAPI 文档（tech-selection §2.8 / §3.15）

---

## 5. 降级策略（8 个故障场景）

> 本节定义系统对各类故障的应对路径。覆盖**用户感知**（UI 显示什么）与**系统行为**（自动 / 手动降级、是否阻塞主流程）两个维度。

### 5.1 Provider 不健康（Gemini 不可用）

**触发**：M18 Provider Health Monitor 检测到 provider 在 5 分钟窗口内错误率 > 50%（样本数 ≥ 10）

**用户感知**：
- `<ModelSwitchPanel>` 中不健康 provider 项**显示禁用态 + 「限上」红色 Tag + tooltip「近 5 分钟错误率 XX%，限上不可用」**
- 当前聊天正在用的 provider 若变为 unhealthy，**顶部 toast 提示「Gemini 不可用，已自动切换 Seedream」**

**系统行为**：
1. M18 `recordProviderCall()` 累计 → `isProviderHealthy()` 返回 false
2. M04 写入 Sentry（`provider unhealthy: gemini, errorRate=0.62, sampleSize=23`）
3. M01 轮询 `/api/health/providers` 拿到新状态
4. M01 `useAutoDegrade` hook：若当前选中 provider 变 unhealthy → 自动 `onSwitch(其他健康 provider)`
5. 下一次聊天请求：M07 在 `buildChatGraph` 前查询 M18，跳过 unhealthy provider

**降级等级**：**自动 + 无缝**（用户无感，仅看到 toast）

---

### 5.2 配额耗尽

**触发**：M16 `increment_quota` RPC 返回 `'exceeded'`

**用户感知**：
- 前端 `<ErrorCard>` 显示「今日配额已用完（30/30）」+ HTTP 429 错误码 + `Retry-After: 86400`
- **重试按钮被禁用**（quota 错误码走 ERROR_STATUS 429，UI 判断禁用重试）
- 配额卡片显示 `0 / 30 剩余`

**系统行为**：
1. M04 捕获 `QuotaExceededError` → 调 `errorResponse(QUOTA_EXCEEDED, ...)`
2. M20 logger 记录 `quota_exceeded: user=xxx, used=30, limit=30`
3. M02 Store 更新 `quotaRemaining = 0`
4. M01 禁用所有生图按钮直到 UTC 日切（每日 0 点 reset）

**降级等级**：**硬阻断**（不可重试，等待配额 reset）

---

### 5.3 内容安全拦截（ADR-001）

**触发**：provider 网关（Seedream / Gemini / Doubao / MiniMax）拦截信号命中 `isProviderModeration()` 模式

**用户感知**：
- 聊天流：模型生成中途被网关拦截 → SSE `tool_error` 事件 → `<ErrorCard code='moderation'>` 显示「Provider 内容安全网关拒收了请求或结果，请修改提示词后重试。」
- 工作台：单张图卡片显示「内容违规」徽章 + `<ErrorCard>`（其他张继续）

**系统行为**：
1. Provider 调用抛错 → M11/M12/M14/M15 在 adapter 入口调 `isProviderModeration(err)` → 命中 → throw `ContentModerationError`
2. M06 Error Handler 捕获 → `errorResponse(MODERATION)`（HTTP 403）
3. 工作台路径：M11 → 写 `generations.status='failed', error_code='moderation'` + 同步 `image_safety_audits`（verdict='block'，reasons = provider code/message）
4. 聊天路径：M07 → SSE `tool_error` 事件 → 立即结束本次流
5. M20 logger + Sentry 上报（**不打印原始 prompt，仅记错误码与 provider code/message**）

**降级等级**：**软阻断**（仅当次拒绝，用户可改写 prompt 再试）

**与旧方案的差异**（ADR-001）：
- ❌ 不再有 preCheck 在图像生成前的「同步 HTTP 调用」
- ❌ 不再有 postCheck 在图像生成后的「同步 HTTP 调用」
- ✅ 拦截信号完全由 provider 网关异步返回，无独立中间件
- ✅ `image_safety_audits` 表 repurposed：记录 provider 网关拦截证据，而非第三方供应商审计

---

### 5.4 LangGraph checkpointer 删除失败

**触发**：DELETE `/api/chat/sessions/[id]` 时 M08 checkpointer 删除失败（外键约束 / DB 锁等）

**用户感知**：
- 主流程成功：session 从列表消失
- 顶部黄色警告 toast：「部分资源清理失败，已上报」

**系统行为**（4 阶段清理，按 tech-selection §3.11a 实现）：
1. 阶段 1：删 checkpointer 失败 → `warnings[]` 记录 → M20 warn + Sentry
2. 阶段 2：删 Storage 对象失败 → 同上
3. 阶段 3：删 DB `sessions` 行（**关键，最后删**）→ 失败直接返回 `provider_error` 502
4. 阶段 4：返回 `{ ok: true, warnings: [...] }`

**兜底清理**：`supabase/migrations/0008_orphan_cleanup.sql` cron job 每日扫孤儿数据

**降级等级**：**主流程优先 + 异步兜底**（用户感知"成功"，孤儿数据后台清理）

---

### 5.5 上游 provider 5xx / 网络中断

**触发**：M11 Seedream / M12 Gemini 调用返回 HTTP 5xx / 网络中断 / 超时

**用户感知**：
- 单张 generation 显示 `<ErrorCard code='provider_error'>` + 「生图服务异常，请稍后重试」+ 重试按钮
- 聊天流工具调用失败 → SSE `tool_error` → `<ErrorCard>` 含重试按钮

**系统行为**：
1. M11/M12 catch → 调 `classifyError(err)` → 映射到 6 错误码之一
2. M18 `recordProviderCall(provider, true)` 累计错误
3. M20 logger + Sentry 上报（含 provider 名 + status code）
4. 工作台路径：写 `generations.status='failed', error_code='provider_error'`
5. 聊天路径：SSE `tool_error` 事件

**自动重试**：Phase1 **不自动重试**（避免增加 latency + 不必要的 provider 配额消耗）；用户点重试按钮触发新请求

**降级等级**：**单次失败 + 需手动重试**

---

### 5.6 鉴权失败 / JWT 过期

**触发**：M05 `supabase.auth.getUser()` 返回 null 或 JWT 过期

**用户感知**：
- 自动重新 `signInAnonymously()` 静默登录
- 若重登失败：顶部红色 toast「登录失效，请刷新页面重试」

**系统行为**：
1. AuthBootstrap 在首次访问 / 每次请求失败时尝试 anon 登录
2. 重新登录成功后：`auth.uid()` 更新 → 后续请求带新 cookie
3. 重登失败：返回 `unauthorized` 401 + 前端强制刷新

**降级等级**：**自动恢复**（通常无感）

---

### 5.7 SSE 连接中断

**触发**：M03 Client SSE Parser 在解析过程中遇到网络中断（fetch 抛 AbortError / chunked stream 异常终止）

**用户感知**：
- 当前消息气泡显示「连接中断，点击重连」按钮
- 已接收的 chunk 不丢失（按行截断缓存）

**系统行为**：
1. M03 检测到 stream 异常 → 触发 `onError` callback
2. M02 Store 标记当前消息状态为 `incomplete`
3. M01 显示重连按钮
4. 用户点击：M01 用 `last-event-id` 重新发起请求（Phase1 简化：直接重发整条消息，未做 event-id 续传）
5. LangGraph 会话延续（依赖 M08 checkpointer 的 thread_id 状态）

**降级等级**：**手动恢复**（用户感知但不自动重连，避免反复失败）

> **Phase2 优化**：引入 EventSource + `Last-Event-ID` 头实现自动续传（依赖 tech-selection §3.13 升级 LangGraph 版本支持）

---

### 5.8 Storage 上传失败

**触发**：M22 `storage.upload(buffer)` 抛错（网络 / 配额 / RLS 拒绝）

**用户感知**：
- 单张 generation 显示 `<ErrorCard code='provider_error'>` 「图片上传失败」
- 已成功上传的其他张不受影响

**系统行为**：
1. M11 catch → 写 `generations.status='failed', error_code='provider_error'`
2. M20 logger + Sentry 上报（含 storage path + error message）
3. **不重试**（重试会重复消耗 provider 配额）

**降级等级**：**单张失败 + 需手动 recreate**

---

### 5.9 降级策略总览表

| 故障场景 | 模块 | 触发条件 | 用户感知 | 系统行为 | 降级等级 |
|---|---|---|---|---|---|
| Provider 不健康 | M18 | 5min 错误率 > 50% | UI 禁用 + 自动切 | 自动切到健康 provider | 自动无缝 |
| 配额耗尽 | M16 | used + n > 30 | 429 + 禁用重试 | 等 UTC 日切 reset | 硬阻断 |
| 内容违规 | M17 + provider 网关 | provider 拦截信号命中 `isProviderModeration()` | 错误卡片 + 可改写 | adapter 入口归一 → 写 moderation 错误码 + image_safety_audits | 软阻断 |
| Checkpointer 删除失败 | M08 | DB 操作失败 | warn toast | 主流程成功 + cron 兜底 | 主流程优先 |
| Provider 5xx / 网络 | M11/M12 | HTTP 5xx / timeout | 错误卡片 + 重试 | 写 provider_error | 手动重试 |
| 鉴权失败 | M05 | JWT 过期 | 自动 anon 重登 | 静默恢复 | 自动恢复 |
| SSE 中断 | M03 | fetch 异常 | 重连按钮 | 用户手动触发 | 手动恢复 |
| Storage 上传失败 | M22 | storage 抛错 | 错误卡片 | 单张 generation 失败 | 单张失败 |

---

## 6. 关键时序约束（QoS / SLO）

| 指标 | 目标 | 测量方法 | 涉及模块 |
|---|---|---|---|
| 单张生图 p95 端到端延迟（2K） | ≤ 60 s | Seedream 2G / Gemini 2G 各 n ≥ 30 样本分统计 | M04 + M11/M12 + M22 |
| 聊天流首 token 时间（TTFT） | ≤ 2 s | 从 `POST /api/chat` 到首个 SSE 'chunk' 事件 | M04 + M07 + M14/M15 |
| `/api/image` POST 返回延迟 | ≤ 500 ms | 从请求到 `taskId` 返回（lambda 同步部分） | M04 + M16 + M21 |
| `/api/image/[taskId]` GET 轮询响应 | ≤ 200 ms | DB 单条 batch + N 条 generations 查询 | M04 + M21 |
| 聊天侧栏渲染耗时（review-report GAP-B1） | ≤ 200 ms | 浏览器 Performance API 测量侧栏列表首次渲染耗时；测试环境 Chrome/Safari 最新版 + 千兆网络 | M01 + M02 |
| 刷新/重开浏览器历史恢复率（review-report GAP-L1） | 100% | Playwright e2e：创建会话 → 刷新 → 验证 sessions + generations 完整 | M08 + M21 + M02 |
| Provider 健康检查 API 响应 | ≤ 100 ms | 内存桶读取 | M04 + M18 |
| 配额越界响应 | ≤ 100 ms | RPC 返回 | M04 + M16 |
| 配额扣减 RPC 原子性 | FOR UPDATE 行锁 | 并发测试：同一 uid 50 并发扣减仅越界一次 | M16 + M21 |
| Provider 健康检查窗口 | 5 分钟 | `Math.floor(now / 5min) * 5min` 对齐 | M18 |
| 内容安全拦截率（ADR-001）| ≥ 95%（provider 网关拦截） | 1000 条已知违规样本日回归（CI 验证 provider 网关行为） | M17 `isProviderModeration` 模式覆盖率 |
| Provider 健康检查告警准确率 | 误报 < 5% / 漏报 < 1% | 人工验证 + 边界值测试 | M18 |
| 备份 RPO / RTO | RPO ≤ 1h / RTO ≤ 4h | Supabase 自动备份 + 季度恢复演练 | M21 |
| LangGraph 每请求 compile 开销 | ≤ 50ms | benchmark 测试 | M07 |
| Vercel serverless 超时 | maxDuration=60 | 长任务降级 | M04 |

**性能基准（目标）**：
- 简单聊天（无工具调用）：p95 ≤ 3s 完成
- 单张生图（无参考图）：p95 ≤ 60s（含 provider 调用 + 内容安全由 provider 网关异步拦截，无 postCheck 同步开销 + upload）
- 4 张批量生图：p95 ≤ 90s（provider 并行可优化，Phase1 串行）
- 配额扣减 RPC：p95 ≤ 100ms（含行锁等待）

---

## 7. 假设与已知风险

### 7.1 架构假设

| 假设 | 影响 | 失效应对 |
|---|---|---|
| 单租户 + 匿名登录（每浏览器实例独立 anon uid） | 跨设备历史不同步属预期 | Phase2 引入 OAuth PKCE + 邮箱绑定 |
| Vercel serverless 单实例最长 60s | 长任务需降级 | maxDuration=60 显式声明；v1.2 改 Edge Function 队列 |
| 国内访问 Gemini 需代理 | Gemini 不可达风险 | Phase1 末确认代理方案；UI 已实现降级 UI |
| 每浏览器实例一个 anon uid | 同一用户多设备视为不同用户 | Phase2 引入 OAuth 后合并 |
| Phase1 仅 web 端 | 响应式 Web 即可，不做移动 / 桌面 | Phase2+ 评估 |
| LangGraph 每请求 compile 性能可接受 | 约 +50ms/请求；多次并发实例安全 | Phase2 评估是否引入 Map 缓存 |
| 内容安全（ADR-001）采用 provider 网关 + 错误码模式映射（lobehub 风格） | 不引入独立第三方供应商 | Phase2 视运营复盘拦截率决定是否补回独立第三方兜底 |
| 单一 Next.js 全栈部署（Vercel / 自托管 PM2） | 不分离前后端 | 自托管兜底 |
| **工程实践（review-report GAP-C3）**：PR 模板 + CodeQL + secret scanning 已配置 | 安全门禁到位 | tech-selection §1.5 husky + §1.6 GitHub Actions + §4.9.4 评审清单；`pull_request_template.md` 含「变更类型 / 关联 US / 验收标准 / 影响范围 / 回滚方案」五段 |
| 错误码统一在 `packages/shared/errors.ts` | 全栈一致 | tech-selection §3.16 ERROR_CODES + ERROR_STATUS |
| provider 健康检查告警渠道 Phase2 推迟 | Phase1 仅本地日志 + Sentry | tech-selection §3.13；§5.1 降级策略仅依赖健康检查本身 |

### 7.2 已知架构风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Seedream 4K 单张 ≥ 60s 与 p95 ≤ 60s 冲突 | 取消（4K 已挪 Phase2） | — | Phase1 仅 2K |
| Gemini 国内访问受限 | 高 | 中 | M18 健康检查 + 自动降级 |
| Seedream 服饰效果未达可用率 80% | 中 | 高 | SKILL.md 模板调优回归 |
| 无登录被薅羊毛 | 中 | 中 | 30 张配额 + UA/IP 软限速 |
| 内容合规（ADR-001） | 中 | 中 | provider 网关拦截率 ≥ 95% 即满足 Phase1；定期人工 audit `image_safety_audits` 表复盘命中模式；Phase2 视拦截率决定是否补接独立第三方 |
| serverless 长任务超时 | 低 | 中 | maxDuration=60 + 同步生成 |
| checkpointer 删 thread 失败 | 低 | 低 | 主流程 warn + cron 兜底 |
| parametersSchema 与 provider 版本漂移 | 中 | 中 | schema 入仓 + CI 校验 |
| 监控告警误报 / 漏报 | 中 | 中 | 阈值季度回归 |
| 备份恢复失败 | 低 | 高 | 季度演练 |
| 迁移文件漂移 | 中 | 中 | `supabase db diff` CI 校验 |
| 密钥泄漏 | 低 | 高 | 预提交钩子 + secret scanning |
| LangGraph 每请求 compile 50ms 开销 | 中 | 低 | 已确认可接受；Phase2 评估缓存 |

---

## 8. 附录：US ↔ Architecture 交叉索引

> 将 `requirements.md §2.2` 的 7 条 US 映射到 architecture.md 的章节，方便追溯。

| US | 标题 | 主要涉及模块 | 架构章节 |
|---|---|---|---|
| US1 | 通用文生图 | M04 /api/image + M11/M12 + M22 + M16 + M17 | §3.2、§5.2、§5.3、§5.5 |
| US2 | 通用图生图（图生图） | + M19 RefImage Validator | §3.2、§3.7、M19 |
| US3 | 服饰技能出图 | + L3 M07 SKILL.md 注入 + L1 SkillSelector | §3.4、M07 LangGraph Agent |
| US4 | 聊天内置生图 | M07 + M09 + M03 SSE + Tool 路径 | §3.1、§3.3、§5.1、§5.7 |
| US5 | 工作台批量与重生成 | M04 /api/image + /api/image/recreate + M16 | §3.2、§3.6 recreate API、§5.2 |
| US6 | 持久化与历史 | M21 + M22 + M08 + DELETE endpoint | §3.1 checkpointer、tech-selection §3.11a DELETE、§5.4 |
| US7 | 模型切换 | M18 + M11/M12 + M13/M14/M15 | §3.6、§5.1 |

### 8.1 决策对齐索引

| 决策 ID | 决策 | 架构章节 |
|---|---|---|
| Q1 | 人工盲评可用率 | 不涉及（属运营流程） |
| Q2 | 极简集 7 字段 + provider 透传带 | M10 Image Provider 抽象 |
| Q3 | Phase1 Gemini 双 provider 验收 | M11 + M12 + M18 健康检查 |
| Q4 | 错误码 6 个（API 权威） | M06 Error Handler + §5 降级策略 |
| Q5 | taskId = batchId 复用 | M04 `/api/image` 响应 + M21 schema |
| Q6 | sessions.id = thread_id | M08 Checkpointer + M21 sessions 表 |
| Q7 | 简化版 parametersSchema | M10 Image Provider schema 加载 |
| Q8 | 4K 挪 Phase2 | M11/M12 supportedResolutions=['1K','2K'] |
| Q9 | 监控/备份纳入 MVP | M18 + M20 + §7.2 RPO/RTO |
| Q10 | workflow 每请求 compile | M07 LangGraph Agent |
| Q11 | 内容安全 Phase1 委托 provider 网关 + 错误码模式映射（ADR-001） | M17 Content Safety Adapter + 各 provider adapter 入口 |
| Q12 | 聊天 LLM = Doubao + MiniMax | M14 + M15 Chat Adapter |
| D1 | 借鉴范围（@lobehub/ui + 自建） | L1 Browser UI |
| D2 | 工具注册表四类 | M09 Tool Registry |
| D3 | 删会话同步清理 | §5.4 4 阶段清理 + cron |
| D4 | SSE 事件名（chunk） | M03 SSE Parser + M07 emit* |
| D5 | SKILL.md triggers.tools/providerHints | M09 Tool Registry + L1 SkillSelector |
| D6 | 重生成三模式 | M04 `/api/image/recreate` + §5.5 |
| D7 | snake_case + bucket 路径 | M21 + M22 |
| D8 | 术语统一 | 全文 |
| D9 | generations.provider 冗余 | M21 schema |
| D10 | 90 / 30 天保留 | M22 Storage + §3.5a cron |
| D11 | i18n 仅 zh-CN | L1 UI |
| D12 | OAuth PKCE Phase2 | M23 Supabase Auth |
| D13 | 禁 any | tech-selection §1.3 + §1.4 |
| Q-C1 | 聊天 LLM 锁定 Doubao + MiniMax | M14 + M15 |
| Q-C2 | parametersSchema 数据格式锁定 JSON Schema | M10 + tech-selection §3.8 |
| C-1 | Seedream env 命名统一 ARK_* | M11 + tech-selection §1.7 |

### 8.2 Review Report 修复索引

| GAP / 冲突 | 修复位置 |
|---|---|
| GAP-1（10MB/MIME 校验） | M19 RefImage Validator + L1 表单 |
| GAP-2（SKILL.md loader） | M07 LangGraph + §3.4 |
| GAP-3（Gemini 降级 UI） | M18 + L1 useAutoDegrade hook |
| GAP-4（recreate 三模式） | M04 `/api/image/recreate` |
| GAP-5（删会话同步清理） | §5.4 + tech-selection §3.11a |
| GAP-6（配额 30 张 + HTTP 429） | M16 + §5.2 |
| GAP-7（Provider 健康检查） | M18 + §5.1 |
| GAP-12（SSE 事件名映射） | M03 + M07 emit* + §3.1 |
| GAP-13（HTTP 状态码映射） | M06 Error Handler |
| GAP-15（Storage 90/30 天 cron） | M22 + tech-selection §3.5a |
| C-1（env 命名冲突） | tech-selection §1.7 已统一 ARK_* |

---

## 9. 安全边界（review-report GAP-C2 集中视图）

> requirements §4.6 共 11 条安全约束，本节集中说明每条约束在 architecture 中由谁实现。**架构层 vs 实施层分工**：
> - 架构层（本节）：定义边界、责任模块、违反后果
> - 实施层（tech-selection §1.3 / §1.4 / §4.6）：具体代码、配置、CI 校验
>
> 详细实施细节见 tech-selection §4.6 与 §1.3，本节不重复。

### 9.1 安全约束矩阵

| # | 约束 | 责任模块 | 违反后果 | 实施层（tech-selection） |
|---|---|---|---|---|
| 1 | **密钥走 env，不入代码库** | M20 Logger + 平台原生 secrets | 密钥泄漏 → Sentry alert + 立即轮转 | §1.7 Secrets 管理（review-report C-1 统一 ARK_*） |
| 2 | **RLS 完整且匿名用户有效** | M21 Supabase Postgres + M05 Auth | 数据越权 → RLS 自动拦截 | §4.3.3 完整 SQL 5 张表策略 |
| 3 | **构建类型检查（禁 `any`）** | M07 LangGraph Agent + 编译期 | 类型漏洞绕过 → 运行时崩溃 | §1.3 strict TS + §1.4 ESLint `@typescript-eslint/no-explicit-any: error` |
| 4 | **SSE 解析容错** | M03 Client SSE Parser + M04 Route Handler | 连接中断 → 用户感知重连按钮 | §2.9 行截断 / 多事件 / 心跳容错 |
| 5 | **禁 `eval` / `Function`** | 全模块（code review） | 代码执行逃逸 → XSS / RCE | Code Review 规则 + 预提交钩子 |
| 6 | **每请求 compile** | M07 LangGraph Agent | serverless 多实例串数据 | §3.10 buildChatGraph 每请求调用 |
| 7 | **OAuth PKCE（Phase2）** | M23 Supabase Auth | implicit flow 漏洞 | Phase2 引入 PKCE |
| 8 | **迁移文件入仓 + CI 校验** | M21 Postgres + CI | 表结构漂移 → 生产事故 | tech-selection §4.9.3 + `supabase db diff` |
| 9 | **配额按 UTC 日原子扣减** | M16 Quota Middleware + M21 Postgres RPC | 配额绕过 / 并发越界 | §3.5 `increment_quota` RPC FOR UPDATE 行锁 |
| 10 | **内容安全（ADR-001：provider 网关 + 错误模式映射）** | M11/M12/M14/M15 各 provider adapter + M17 模式匹配器 + M21 `image_safety_audits` 表 | 拦截模式漏识别 → 合规风险 | tech-selection §3.12 `isProviderModeration` + 模式 append-only；audit 表记录每次拦截证据 |
| 11 | **日志脱敏** | M20 Logger + Sentry | prompt / apiKey 泄漏 → 隐私事故 | pino redact 配置 + Sentry beforeSend |

### 9.2 信任边界

```
┌────────────────────────────────────────────────────────────────┐
│ 信任边界 1：浏览器 ↔ API Gateway                               │
│   ├─ 入口：Cookie JWT（HttpOnly + Secure + SameSite=Lax）     │
│   ├─ 上行：所有请求必须经 M05 Auth Middleware（RLS 上下文注入）│
│   └─ 下行：响应不得包含 service_role key、原始 prompt 等敏感数据 │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│ 信任边界 2：API Gateway ↔ Supabase                              │
│   ├─ 入口：anon key + user JWT（anon sign-in）                  │
│   ├─ 关键：禁用 service_role 走前端（防 RLS 旁路）              │
│   └─ 所有 DB 操作走 M21 RLS 隔离                              │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│ 信任边界 3：Provider Layer ↔ 3rd-party API                     │
│   ├─ 入口：ARK_API_KEY / GOOGLE_API_KEY（env 注入）            │
│   ├─ 上行：参考图 MIME/大小校验（M19）                          │
│   │   备注：内容安全由 provider 网关自助拦截                    │
│   │         （ADR-001，详见 M17 / tech §3.12）                  │
│   └─ 下行：3rd-party 返回 buffer 不再过 postCheck                 │
│            provider 网关拦截信号由 adapter 入口归一到           │
│            moderation 错误码并审计落 image_safety_audits         │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────┐
│ 信任边界 4：客户端 UI ↔ 用户（LLM 生成内容）                   │
│   ├─ 入口：所有 LLM 输出经 MarkdownRenderer（防 XSS）          │
│   ├─ 关键：禁 eval/Function 执行 AI 生成代码（修复 LangGraphPj │
│   │        CodePreviewPanel 风险）                             │
│   └─ SSE 解析容错防心跳解析崩溃                                │
└────────────────────────────────────────────────────────────────┘
```

### 9.3 数据敏感性分级

| 数据类型 | 敏感性 | 存储位置 | 访问控制 |
|---|---|---|---|
| API 密钥（ARK / GOOGLE / ANTHROPIC / DOUBAO_MODEL / MINIMAX） | 🔴 高 | env（不入仓） | 仅服务端访问 |
| anon user JWT | 🟡 中 | Cookie（HttpOnly + Secure + SameSite=Lax） | 仅服务端验证 |
| 用户提示词 prompt | 🟡 中 | DB generations.prompt + LangGraph checkpointer | RLS + 日志脱敏 |
| 生成图片 URL（generated-images public bucket） | 🟢 低 | Storage public | 无需签名 |
| 参考图 URL（uploads private bucket） | 🟡 中 | Storage private | signedUrl 1h 过期（review-report C-AR-1） |
| 配额计数 | 🟢 低 | DB quotas | RLS |
| Provider 内容安全拦截证据（verdict + provider code + reasons） | 🟡 中 | DB image_safety_audits（ADR-001 repurposed） | RLS + 90 天保留 |

### 9.4 已知安全风险与缓解

| 风险 | 概率 | 影响 | 缓解措施（架构层） | 实施层 |
|---|---|---|---|---|
| 无登录被薅羊毛 | 中 | 中 | anon uid + 30 张/日 UTC 配额 | tech-selection §3.7b + M16 配额 |
| Gemini 国内访问受限 | 高 | 中 | Provider 健康检查自动降级 | tech-selection §3.13a + §5.1 |
| 内容合规风险（ADR-001） | 中 | 中 | provider 网关拦截 + audit 表留证；Phase2 视拦截率决定是否补独立第三方 | tech-selection §3.12 + M17 `isProviderModeration` |
| checkpointer 删 thread 失败 | 低 | 低 | 主流程 warn + cron 兜底 | tech-selection §3.11a + §5.4 |
| 密钥泄漏 | 低 | 高 | 预提交钩子 + secret scanning | tech-selection §1.7 |
| 每请求 compile 50ms 开销 | 中 | 低 | 已确认可接受；Phase2 评估缓存 | §7.2 已知风险 |

---

## 10. 文档元信息

| 字段 | 值 |
|---|---|
| 文档版本 | 1.2（v1.1 + ADR-001 内容安全策略调整） |
| 生成日期 | 本会话 |
| 关联文档 | `requirements.md`（PRD） / `tech-selection.md`（技术选型） / `review-report-requirements-vs-tech.md`（req ↔ tech 审查） / `review-report-requirements-vs-architecture.md`（req ↔ arch 审查） |
| 模块粒度 | 细粒度（5 层 × 23 模块） |
| 受众 | 架构师 / 新入职工程师 / Code Reviewer |
| 本版本变更 | 见 §10.1（v1.1）/ §10.2（v1.2 ADR-001）|
| 下次更新触发 | Phase1 编码进入稳定期后（约第 4 周），补充实际部署拓扑与监控 dashboard 配置 |

### 10.1 本版本变更（review-report-requirements-vs-architecture 落地）

| # | 来源 | 章节 | 修改 |
|---|---|---|---|
| 1 | C-AR-1 | §1.1 M22、§2 M22 | 区分 `publicUrl` / `signedUrl` 双输出 |
| 2 | C-AR-2 | §2 M01、M06 | 各补一行 i18n |
| 3 | C-AR-3 | 新增 §3.8 | 工具触发路径图（3 种触发方式） |
| 4 | GAP-B1 | §6 SLO | 新增"聊天侧栏渲染 ≤ 200 ms" |
| 5 | GAP-L1 | §6 SLO | 新增"恢复率 100%（e2e 自动化）" |
| 6 | GAP-A2 | §3.2 | 新增"参考图上传与自动尺寸推断"前置步骤 |
| 7 | GAP-A1 | §3.4 | 新增"必填字段标红 + 预览"步骤 |
| 8 | GAP-C1 | §4.4 | 新增"API 端点全景"列表 |
| 9 | GAP-C2 | §9 | 新增"安全边界"专章（11 条约束矩阵 + 4 信任边界 + 数据敏感性分级） |
| 10 | GAP-C3 | §7.1 | 假设表新增 PR 模板 / CodeQL / secret scanning 行 |

### 10.2 本版本变更（v1.2 ADR-001 落地）

| # | 来源 | 章节 | 修改 |
|---|---|---|---|
| 1 | ADR-001 | §1.1 M17 | M17 改名为 Content Safety Adapter（委托 provider 网关） |
| 2 | ADR-001 | §2 M17 | 职责 / 输入 / 输出 / 失败模式 全文重写 |
| 3 | ADR-001 | §3.1 sequenceDiagram | 移除 M17 participant；改"工具调用 image_generation"分支写 audit 表 |
| 4 | ADR-001 | §3.2 sequenceDiagram | 移除 M17 participant；前/后置 preCheck/postCheck 同步调用全删 |
| 5 | ADR-001 | §3.7 | 内容安全段全文重写（provider 网关拦截 + adapter 归一 + 拦截模式覆盖） |
| 6 | ADR-001 | §4.2 通信矩阵 | #16 / #28 重写；#8、#9 端点删除标记 |
| 7 | ADR-001 | §4.3 同步链路 | 移除"内容安全校验"项 |
| 8 | ADR-001 | §4.4 端点 #9 | 标记 /api/image/safety-check 删除 |
| 9 | ADR-001 | §5.3 降级策略 | 内容安全拦截段全文重写 |
| 10 | ADR-001 | §5.9 总览表 内容违规行 | 更新触发条件 + 用户感知 + 系统行为 |
| 11 | ADR-001 | §6 SLO | 内容安全拦截率目标 99% → 95% provider 网关 |
| 12 | ADR-001 | §7.1 假设 内容安全行 | 删除"Phase1 第三周锁定" |
| 13 | ADR-001 | §7.2 风险 内容合规行 | 概率/影响 高→中；Phase1 必接供应商 替换为 网关 ≥ 95% |
| 14 | ADR-001 | §8.1 决策索引 Q11 | 改写 |
| 15 | ADR-001 | §9.1 安全约束 #10 | 改写 |
| 16 | ADR-001 | §9.2 信任边界 3 | 内容安全行改写 |
| 17 | ADR-001 | §9.3 数据敏感性 image_safety_audits | 改写（repurposed 为 provider 网关拦截证据） |
| 18 | ADR-001 | §9.4 风险 内容合规行 | 改写 |