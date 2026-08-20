# zimage 需求文档（PRD）

> ZImage — 面向设计师的电商图片处理工作台。本文档遵循 PRD Strict Schema（Executive Summary / UX & Functionality / AI System Requirements / Technical Specifications / Risks & Roadmap），并新增"决策记录""非功能与运维""Traceability 矩阵"三个补充章节，作为产品与工程的"双方约定单一来源"。所有未在此处列出的功能视为未规划。

---

## 1. Executive Summary

### 1.1 Problem Statement

电商设计师日常处理商品图（白底图、模特图、种草图、卖点图、A+图、尺码图）时，需在多个工具间切换（PS / 模型平台 / 套图编排），流程非线性、难以复用、无法用对话方式协作；通用 AI 画图产品缺乏服饰专业预设，对中文提示词与国内模型（Seedream 等）支持分散。

### 1.2 Proposed Solution

一个**以"电商服饰图片处理"为核心、以对话为统一入口**的工作台：

- **首页**：居中聊天输入 + 历史话题侧栏 + 技能快捷入口（参考 lobehub Home 交互自建，不复制其 SPA/react-router 架构）。
- **聊天内生图**：以 LangGraph tool 形式调用，模型可在 Seedream 与 Gemini 间切换。
- **专用 /image 生图工作台**：话题侧栏 + 生成流 + 提示词区 + 配置面板（按 per-model parametersSchema 动态显隐）+ 参考图拖拽 + 批次结果。
- **服饰技能预设**：白底图 / 模特图 / 种草图（MVP 首批），以 SKILL.md 注入系统提示词，规定何时与如何调用生图工具。
- **后端**：Next.js 16 App Router（route handler 同时承载 API 与 LangGraph agent）+ LangGraphJS（每请求 compile）+ Supabase Cloud（DB + Storage + Auth 匿名登录 + 内容安全 + 监控告警）。

### 1.3 Success Criteria（可量化）

| 指标 | 目标值 | 测量方法 |
| --- | --- | --- |
| 设计师从打开到产出第一张服饰图的操作步数 | ≤ 3 步 | 任务脚本：登录 → 进入首页 → 输入提示词 → 点击生成（≤ 3 用户级别动作） |
| 白底图 / 模特图 / 种草图 技能可用率 | ≥ 80% | **人工盲评**：2-3 名服饰设计师独立盲评，每技能 10 组 seed prompt（5 随机 + 5 高频场景），二分类判决，10 中 ≥ 8 可用即达标；Phase1 每周抽检 1 次 |
| 单张生成 p95 端到端延迟（2K） | ≤ 60 s | Seedream 2K ≤ 60s、Gemini 2K ≤ 60s 双路各 n ≥ 30 样本分统计；测量端：API 入参到 Storage URL 返回 |
| 匿名账户每日配额内可完成出图数 | ≥ 20 张 / 30 张配额 | 模拟匿名账户 24h 跑测，覆盖配额扣减 / 复位 / 越界拒绝 |
| 刷新 / 重开浏览器后会话与生成历史恢复率 | 100% | 自动化 e2e：创建会话 → 刷新 → 验证 sessions + generations 完整 |
| API 调用失败必有可解析错误结构 | 100% | Zod schema 校验后端所有错误响应 |
| Provider 健康检查告警准确率 | 误报 < 5% / 漏报 < 1% | 5 分钟内某 provider 错误率 > 50% 触发告警；人工验证 |
| 内容安全拦截率 | ≥ 99% | 1000 条已知违规样本每日回归 |
| 备份 RPO / RTO | RPO ≤ 1h / RTO ≤ 4h | Supabase 自动备份策略 + 季度恢复演练 |

### 1.4 决策记录（12 项用户拍板 + 13 项代决策）

> 完整依据与影响见文末附录 §6.1；此处摘要便于评审与变更追溯。
> Q12 为 `doc/review-report-requirements-vs-tech.md §0` 交互式卡片确认后回填。

**用户拍板（12 项）**：

1. 可用率评估 = 人工盲评（2-3 名设计师，10 组 8 组可用即达标）
2. ImageGen 参数集 = 极简集 7 字段 + provider 透传带
3. Phase1 Gemini = 双 provider 交付（均验收）
4. 错误码枚举 = 6 个（API 权威）
5. taskId = batchId 复用
6. sessions.id = thread_id（共用 uuid）
7. 引入简化版 parametersSchema（Phase1 覆盖 Seedream 3.0 + Gemini pro preview）
8. 4K 挪 Phase2，Phase1 默认 2K
9. 监控/备份纳入 MVP 验收
10. workflow/checkpointer 每请求 compile
11. 内容安全 Phase1 国内合规必接
12. **聊天 LLM provider = Doubao（字节火山）+ MiniMax 双 provider**（review-report C1 确认；tech-selection §3.9 落地）

**代决策（13 项）**：

D1 删除"完全照搬 lobehub"措辞，明示借鉴范围（复用 `@lobehub/ui` UI 组件，其余自建）。
D2 工具注册表照搬 LangGraphPj 四类（custom/langchain/mcp/canvas），按 `toolIds` 选择性 bindTools。
D3 删会话同步清理 checkpointer 与 Storage。
D4 SSE 事件协议对齐 LangGraphPj（`chunk` 命名）。
D5 SKILL.md 新增 `triggers.tools` 与 `triggers.providerHints` 字段。
D6 重生成语义：API 区分 `recreate-single` / `recreate-failed` / `recreate-all` 三模式。
D7 命名统一：snake_case (`storage_path`)；bucket 路径前缀对齐 `generated/{user_id}/{batch_id}/{generation_id}.{ext}`。
D8 术语统一：`Seedream/Gemini` 产品名；`user_id` 与 `userId` 与 `anonUid` 映射关系在 §4.3.1 注释化。
D9 generations.provider 冗余存（便于单 generation 查询）。
D10 历史数据保留：generated-images 90 天 / uploads 30 天；删会话同步删 Storage 对象。
D11 i18n：Phase1 仅 zh-CN，en-US 切换入口 Phase2。
D12 OAuth PKCE（Phase2 引入，不沿用 LangGraphPj implicit flow）。
D13 禁 `any`（strict TS + ESLint `@typescript-eslint/no-explicit-any: error`）。

---

## 2. User Experience & Functionality

### 2.1 User Personas

- **P1 电商设计师 / 美工**（主要）：日常生产商品图、套图、活动页素材；中文工作环境；熟练 PS + AI 工具。会用一句话描述"我要什么"。
- **P2 电商运营 / 店主**（次要）：临时需要修图、做种草图，使用频次低于 P1，对工具原理不关注。

### 2.2 User Stories

> 每条故事附"验收标准（AC）"，quantitative + behavioral。可追溯映射见 §6.1。

#### US1 通用文生图

- **作为** P1 设计师，**我想要** 在首页/聊天输入框直接输入中文描述、点击生成得到图片，**以便** 快速产出可用素材。
- AC：
  - 输入空白提示词时，"生成"按钮禁用。
  - 单张生成在 60 s 内完成（p95，2K），超时则显示可重试的失败状态。
  - 提供 5 种比例（1:1 / 3:4 / 4:3 / 9:16 / 16:9），2 种分辨率（1K / 2K，详见 §3.1.1）。
  - 生成结果以图片卡（缩略图 + 原始 URL + 下载按钮）展示。
  - 任意失败必有错误码（6 个枚举之一），UI 显示对应文案与重试按钮。

#### US2 通用图生图（参考图）

- **作为** P1 设计师，**我想要** 上传 1~4 张参考图后生成新图，**以便** 在保留风格/主体特征下做变体。
- AC：
  - 支持单张（容量 1，imageUrl）与多张（容量 1~4，imageUrls）；超出容量 toast 提示当前上限。
  - 上传文件类型限定 `image/png | image/jpeg | image/webp`；单文件 ≤ 10 MB。
  - 上传成功后状态置为 `ready`；失败状态置为 `error` 并可重试。
  - 首张上传的图片自动设置生成尺寸（可手动覆盖）。
  - 透传带根据 parametersSchema 自动显隐高级字段。

#### US3 服饰技能出图（首批 3 个）

- **作为** P1 设计师，**我想要** 选择"白底图 / 模特图 / 种草图"技能后按其约定出图，**以便** 直接得到符合电商规范的图。
- AC：
  - 技能选择器展示 3 个内置技能（白底图 / 模特图 / 种草图），每个带图标 + 中文名 + 一句话描述。
  - 选中技能后系统提示词被替换为该技能的 `SKILL.md` 内容；聊天内模型判断何时调用生图工具。
  - 技能 SKILL.md 规定的必填字段（如"目标人群"）在 UI 显式列出，缺失项表单字段标红（user-facing 可判定）。
  - 工作台使用同一技能时，提示词预览直接显示 SKILL.md 模板填充结果（可二次编辑）。

#### US4 聊天内置生图

- **作为** P1 设计师，**我想要** 在聊天中要求"做一张白底图"或上传参考图后被模型自动触发生图，**以便** 用对话完成多步骤创作。
- AC：
  - 聊天工具选择器显式列出"图片工具"，未勾选时模型不调用。
  - 勾选图片工具后，模型依据工具描述判断是否调用；显式提示词（如"生成"、"画一张"）必须被识别并触发。
  - 工具返回结果以 `<imagecard>` 伪标签（或等价结构）渲染在消息流中，可下载。
  - 失败时，工具错误按 §4.4.2 错误码枚举显示对应卡片并附重试按钮。
  - Gemini 不可用时（健康检查失败）UI 提示"限上不可用"，并自动降级到 Seedream。

#### US5 工作台批量与重生成

- **作为** P1 设计师，**我想要** 在 /image 工作台一次生成最多 4 张、可单独重生成、批量下载，**以便** 一次拿到多张候选。
- AC：
  - 单次生成张数 1~4，可在配置面板选择。
  - 批次中每张的状态独立显示（pending / processing / succeeded / failed）。
  - **重生成 API 区分三模式**：`recreate-single`（仅替换指定 generation，保留其他成功项）、`recreate-failed`（批量重试 failed 状态）、`recreate-all`（全部替换，参数复用原 `config` jsonb）。
  - 失败项错误码（6 个枚举之一）显式展示，可一键复制错误详情。

#### US6 持久化与历史

- **作为** P1 设计师，**我想要** 刷新页面后仍能找回昨天的会话与生成历史，**以便** 跨设备/跨时段继续工作。
- AC：
  - 聊天会话列表在刷新后完整保留（侧栏渲染耗时 ≤ 200 ms，测量环境：Chrome/Safari 最新版 + 千兆网络）。
  - 工作台话题列表按最近活跃倒序，话题内批次按时间正序。
  - 任何受配额限制的生成记录必须在 UI 中保留直到主动删除。
  - **删除会话时同步清理** LangGraph checkpointer 记录（`thread_id` = `sessions.id`）与 `generated-images`/`uploads` 中对应对象（清理失败告警但不阻塞主流程）。

#### US7 模型切换

- **作为** P1 设计师，**我想要** 在聊天/工作台切换 Seedream 与 Gemini，**以便** 比较效果或规避一方不可用。
- AC：
  - 模型选择器在聊天输入框和工作台配置面板均可见，选项列表来自 `packages/shared/parameters/` 目录下的 schema 列表；当前模型不可用时显示禁用态。
  - 切换不改变历史生成的展示与归属（generations 表冗余存 `provider`，单 generation 查询无需 JOIN batch）。
  - 历史生成记录显示当时的 provider（不可改写）。

### 2.3 Non-Goals（Phase1 不做）

为了保护时间线与 MVP 验收，Phase1 **明确不做**：

- 登录 / 注册 / OAuth / 找回密码（Phase2 引入 OAuth PKCE + 邮箱/密码）
- 用户自定义技能编辑与发布（Phase2）
- 技能市场 / 共享 / 评分（Phase2）
- 套图全自动批量编排（多类型任务并发规划，v1.2 与 Supabase Edge Function 队列一同引入）
- 视频生成 / Canvas / 文档生成（Phase2）
- 4K 批量出图（v1.1）
- 积分 / 付费 / 订阅 / 短信验证码（Phase2）
- 多租户 / 团队 / 工作区 / 资源共享（Phase2）
- 移动端 App / 桌面端（响应式 Web 即可，Phase2+）
- 离线模式 / PWA
- en-US 语言切换入口（Phase2）

---

## 3. AI System Requirements

### 3.1 Tool Requirements

#### 3.1.1 `image_generation` 工具

聊天链路中的生图工具，由 LangGraph 通过 `bindTools` 注入；handler 后端调用 `ImageProvider` 抽象（见 §3.1.2）。

**Schema（Zod）**：

```ts
ImageGenerationParams {
  prompt: string                  // 必填，最终生成提示词
  provider?: 'seedream' | 'gemini'  // 缺省 seedream
  model?: string                  // 缺省按 provider 取默认 (seedream-3.0 / gemini-3-pro-image-preview)
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9'  // 缺省 '1:1'
  resolution?: '1K' | '2K'        // 缺省 '2K'（4K 挪 Phase2）
  imageUrls?: string[]            // 图生图参考图，0~4 个（由 provider capability 决定上限）
  num?: number                    // 1~4，缺省 1
  providerSpecificParams?: Record<string, unknown>  // 透传带：seedream 的 seed/watermark；gemini 的 promptExtend/imageSize 等
}
```

**返回结构**（handler → 模型上下文）：

```ts
{
  ok: boolean,
  results: Array<{ url: string, storagePath: string, width: number, height: number }>,
  error?: { code: 'bad_request' | 'unauthorized' | 'quota_exceeded' | 'provider_error' | 'network' | 'moderation', message: string }
}
```

**`isSupportedParam` 显隐规则**：前端通过 `packages/shared/parameters/<provider>/<model>.schema.json` 中的字段白名单决定 UI 显隐；如 Seedream 3.0 schema 含 `seed`/`watermark`，则 config 面板显隐对应输入项；Gemini pro preview schema 含 `promptExtend`/`imageSize`，则对应显隐。

#### 3.1.2 `ImageProvider` 抽象

```ts
interface ImageProvider {
  name: 'seedream' | 'gemini'
  defaultModel: string
  supportedAspectRatios: string[]
  supportedResolutions: string[]  // Phase1: ['1K', '2K']
  maxReferenceImages: number
  schemaPath: string  // 指向 parametersSchema 路径
  generate(params: ImageGenerationParams): Promise<ImageResult[]>
}
```

- **Seedream 实现**（`packages/image-providers/seedream/`）：调用火山方舟 Ark API（`POST /api/v3/images/generations`），鉴权用 `ARK_API_KEY`；按官方参数映射 `prompt` / `imageUrls` / `size` / `n` / `quality` 等；`providerSpecificParams` 透传 `seed` / `watermark`。
- **Gemini 实现**（`packages/image-providers/gemini/`）：调用 `@google/genai` `models.generateContent`（model=`gemini-3-pro-image-preview`，`responseModalities=['IMAGE']`），`imageConfig.aspectRatio` / `imageSize`；`providerSpecificParams` 透传 `promptExtend` / `safetyLevel`。
- 两个 adapter 输入参数归一到 ImageGenerationParams，输出归一到 ImageResult；provider 间的差异只在 adapter 内部处理。
- **per-model parametersSchema**（Phase1 简化版）：
  - `packages/shared/parameters/seedream/3.0.schema.json`
  - `packages/shared/parameters/gemini/pro-preview.schema.json`
  - 未来 provider 接入时需新增 schema，无需改前端代码。

### 3.2 Skills 机制

- **格式**：SKILL.md + YAML frontmatter（参考 lobehub `src/utils/skillMarkdown.ts` 校验规则）。
  ```yaml
  ---
  name: white-bg
  title: 白底图
  description: 将服饰图处理为纯白背景的电商标准图
  version: 1.0.0
  whenToUse: 用户希望处理服饰为白底图时
  triggers:
    tools: [image_generation]   # 自动启用的工具列表
    providerHints: [seedream]   # 推荐 provider
  params:
    - imageUrls
    - aspectRatio
  ---
  ```
  正文为该技能的"系统提示词模板"，用 `{prompt}` / `{imageUrls}` 等占位符。
- **来源**：Phase1 仅 `builtin`；Phase2 增加 `user` / `market`。
- **内置首批 3 个**：
  - `white-bg` 白底图（隐形模特）
  - `model-image` 模特图
  - `scene` 种草图
- **Phase2/v1.1 扩展**：卖点图、A+图（高级/普通/手机）、尺码图。
- **注入**：在 chatbotNode 中拼系统消息——`[base system] + [skill prompt if selected] + [tool usage prompt if skill.triggers.tools 启用]`，同时按 `toolIds` 选择性 `bindTools`。
- **存储**：`packages/skills/skills/<name>/SKILL.md`（文件加载），Phase2 引入 DB 表 `agent_skills`（source 字段）。

### 3.3 工具触发机制（决策）

图片工具默认关闭。三种打开路径：

1. **手动勾选**：聊天输入框旁的 ToolSelector，列出可用工具（Phase1 仅 image_generation）。
2. **技能自动启用**：选中任一服饰技能时自动勾选 image_generation 工具（从 `skill.triggers.tools` 读取）。
3. **意图识别**：模型凭工具描述（"用于生成图片；当用户明确要求出图且提示词含人物 / 场景 / 商品 / 服饰等关键信息时调用"）判断是否调用。

`/image` 工作台**不**走 agent，直接调用后端 API。

**Provider 降级**：Gemini 健康检查失败时，UI 提示"限上不可用"并自动切换到 Seedream；模型选择器中 Gemini 项显示禁用态。

### 3.4 Evaluation Strategy

| 维度 | 方法 | 周期 | 责任 |
| --- | --- | --- | --- |
| 功能回归 | vitest 单测：provider adapter 参数映射、skill loader、store slices、API zod 校验、parametersSchema 加载 | 每次 PR | 工程 |
| 模板质量 | **人工盲评**：2-3 名服饰设计师独立盲评，每技能 10 组 seed prompt（5 随机 + 5 高频场景），二分类判决，10 中 ≥ 8 可用即达标 | 每周 | 设计 |
| 模型稳定性 | 双 provider 同 prompt 多轮回归：各 n ≥ 30 样本，成功率 ≥ 95% | 每次依赖更新 | 工程 |
| 性能 | 单张生成 p95 ≤ 60s（仅 2K；Seedream/Gemini 分统计） | 每周 | 工程 |
| 配额 | 模拟匿名账户 24h 跑测，覆盖 30 张配额扣减 / 复位 / 越界拒绝 | 每次配额配置改动 | 工程 |
| Provider 健康检查 | 5 分钟内 provider 错误率 > 50% 触发告警；误报 < 5% / 漏报 < 1% | 实时 | 运维 |
| 内容安全 | 1000 条已知违规样本每日回归，拦截率 ≥ 99%；月误杀率 < 5% | 每日 | 运维 |
| 备份恢复 | 季度恢复演练，RPO ≤ 1h / RTO ≤ 4h 验证 | 季度 | 运维 |

---

## 4. Technical Specifications

### 4.1 Architecture Overview

```
                ┌──────────────────────────────────────────────────────────┐
                │  Browser (Next.js Client Components)                    │
                │  - HomePage (chat hero) · /image workspace · chat page │
                │  - zustand store · @lobehub/ui + antd · react-i18next │
                └──────────────────────┬───────────────────────────────────┘
                                       │  fetch / SSE (chunked)
                ┌──────────────────────▼───────────────────────────────────┐
                │  Next.js 16 (App Router) — apps/web                       │
                │  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐ │
                │  │ /api/chat   │  │ /api/image     │  │ /api/skills   │ │
                │  │ (SSE stream)│  │ (sync + 轮询) │  │ /api/topics   │ │
                │  └──────┬───────┘  └────────┬───────┘  └───────────────┘ │
                │  ┌──────▼────────────────────────────────────────────┐  │
                │  │ agent/ (LangGraph) — 每请求 compile              │  │
                │  │ providers/ (ImageProvider) + parametersSchema    │  │
                │  │ middleware/content-safety (国内违禁检测)        │  │
                │  └──────┬────────────────────────────────────────────┘  │
                └──────────┼───────────────────────────────────────────────┘
                           │  RLS(uid) · Storage (signed URL or public)
                ┌──────────▼───────────────────────────────────────────────┐
                │  Supabase Cloud + 内容安全供应商                          │
                │  Postgres · Storage (generated-images / uploads) · Auth  │
                │  anonymous sign-in (Phase1) → OAuth PKCE (Phase2)        │
                │  内容安全 (数美/火山/阿里云绿网 任选其一)               │
                └─────────────────────────────────────────────────────────┘
```

**聊天链路**（每请求 compile）：

```
ChatInput → useSendMessage → POST /api/chat (withAuth)
  → chatService.streamChatResponse
  → 每次都 new StateGraph + compile({checkpointer: new SupabaseSaver(client, undefined, anonUid)})
  → 拼系统消息: base + (skill.triggers.providerHints 触发的 skill prompt) + (toolIds 触发的 tool usage prompt)
  → model.bindTools(createLangChainTools(toolIds)) → model.invoke
  → tools: image_generation (调 ImageProvider → content-safety → Storage 上传 → 返 ImageCard 标签)
  → streamEvents(v2, {configurable: {thread_id: sessions.id}}) → SSE 事件
  → 前端手写 parseSseEvents → 增量渲染 + UI 错误码 → 错误卡片
```

**工作台链路**：

```
/image 页面 → POST /api/image {prompt, params, topicId?, skillId?}
  → withAuth → SigninAnonymously → 配额校验 → 同步建 topic/batch/generations(pending)
  → content-safety.preCheck(prompt, imageUrls)
  → ImageProvider.generate() → content-safety.postCheck(imageBuffer)
  → Storage 上传 → 更新 generations(succeeded | failed, error_code)
  → 任务整体返回 {taskId: batchId, batchId, generations}
前端用 SWR 轮询 GET /api/image/[taskId] 获取最新状态（v1.2 改为异步队列时仍兼容同一接口）。
```

### 4.2 Directory Structure（pnpm monorepo）

```
zimage/
├── apps/
│   └── web/                                 # Next.js 16 App Router 单仓
│       ├── app/
│       │   ├── page.tsx                     # 首页（chat hero，参考 lobehub Home 交互自建）
│       │   ├── image/page.tsx               # /image 生图工作台
│       │   ├── api/
│       │   │   ├── chat/route.ts            # SSE 聊天（每请求 compile）
│       │   │   ├── chat/sessions/route.ts
│       │   │   ├── chat/sessions/[id]/route.ts   # DELETE 同步清理 checkpointer
│       │   │   ├── image/route.ts
│       │   │   ├── image/[taskId]/route.ts
│       │   │   ├── image/recreate/route.ts       # recreate single/failed/all 三模式
│       │   │   ├── image/safety-check/route.ts  # 内容安全实时预览
│       │   │   ├── topics/route.ts
│       │   │   ├── topics/[id]/batches/route.ts
│       │   │   └── skills/route.ts
│       │   ├── layout.tsx · globals.css
│       ├── components/                      # 复用 @lobehub/ui（ChatInput 等）+ 自绘
│       ├── features/                        # chat / image / skills / home / layout
│       ├── hooks/                           # useChatMessages / useSendMessage / useImageWorkspace
│       ├── store/                           # zustand（image / chat / skill slices）
│       ├── services/                        # SSE / fetch / trpc-like
│       ├── libs/                            # supabase client（browser+server）、sse parser
│       ├── agent/                           # LangGraph chatbot.ts + 工具 + 模型初始化
│       ├── middleware/                      # withAuth + content-safety
│       ├── monitoring/                      # 告警 SDK 封装、provider 健康检查 worker
│       └── ...
├── packages/
│   ├── image-providers/                     # ImageProvider 抽象 + seedream/gemini adapters
│   ├── skills/                              # 内置 SKILL.md + loader
│   ├── shared/                              # types / zod schemas / i18n keys / constants
│   │   └── parameters/                      # parametersSchema:
│   │       ├── seedream/3.0.schema.json
│   │       └── gemini/pro-preview.schema.json
│   └── observability/                       # 监控 SDK 封装（告警/埋点）
├── supabase/
│   └── migrations/                          # SQL 迁移文件 + seed
│       ├── 0001_init.sql
│       ├── 0002_rls.sql
│       ├── 0003_checkpointer.sql
│       └── ...
├── docs/
│   └── requirements.md                      # 本文档
└── package.json · pnpm-workspace.yaml · tsconfig.json
```

### 4.3 Data Model（Supabase）

#### 4.3.1 Tables

```sql
-- 通用话题（工作台/聊天共用，kind 区分）
-- 注意：kind='chat' 时 sessions.id == thread_id（与 LangGraph checkpointer 共用 uuid）
CREATE TABLE topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  kind        text NOT NULL CHECK (kind IN ('image', 'chat')),
  title       text NOT NULL,
  visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topics_user_updated_idx ON topics (user_id, updated_at DESC);

-- 生成批次（一次用户的"创建生成"动作）
CREATE TABLE generation_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('seedream','gemini')),
  model       text NOT NULL,
  config      jsonb NOT NULL,                -- 完整参数（含 prompt、aspect、resolution、imageUrls、num、skillId、providerSpecificParams）
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 单张生成记录（provider 冗余存，便于 US7 单 generation 查询）
CREATE TABLE generations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  provider      text NOT NULL,                      -- 冗余自 batch，便于查询
  status        text NOT NULL CHECK (status IN ('pending','processing','succeeded','failed')),
  prompt        text NOT NULL,
  params        jsonb NOT NULL,
  image_url     text,
  storage_path  text,                              -- snake_case 命名
  width         int,
  height        int,
  error_code    text CHECK (error_code IN ('bad_request','unauthorized','quota_exceeded','provider_error','network','moderation')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generations_batch_idx ON generations (batch_id);
CREATE INDEX generations_status_idx ON generations (status);

-- 聊天会话（id 与 LangGraph checkpointer thread_id 复用）
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- == LangGraph thread_id
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_updated_idx ON sessions (user_id, updated_at DESC);

-- 内容安全审计（每条 generation 调用前后都记录）
CREATE TABLE image_safety_audits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id uuid NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  verdict       text NOT NULL CHECK (verdict IN ('pass','block','review')),
  reasons       jsonb NOT NULL,                  -- 内容安全供应商返回的原因列表
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- LangGraph checkpointer（SupabaseSaver 默认表）
-- 由迁移文件按 @skroyc/langgraph-supabase-checkpointer 库要求生成
```

#### 4.3.2 Storage Buckets

- `generated-images`：**public** 读；路径前缀 `generated/{user_id}/{batch_id}/{generation_id}.{ext}`；生命周期 **90 天**（DB 调度清理）。
- `uploads`：**private**；路径前缀 `uploads/{user_id}/{uuid}.{ext}`（参考图）；生命周期 **30 天**（DB 调度清理）。

#### 4.3.3 RLS（所有业务表，含 JOIN 路径策略）

```sql
-- 1. topics：owner 隔离
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY topics_user ON topics
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2. generation_batches：经 topic_id JOIN 验证 owner
ALTER TABLE generation_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY batches_via_topic ON generation_batches
  FOR ALL USING (
    EXISTS (SELECT 1 FROM topics t WHERE t.id = generation_batches.topic_id AND t.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM topics t WHERE t.id = generation_batches.topic_id AND t.user_id = auth.uid())
  );

-- 3. generations：经 batch_id JOIN topics 验证 owner
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY generations_via_batch ON generations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM generation_batches b
      JOIN topics t ON t.id = b.topic_id
      WHERE b.id = generations.batch_id AND t.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM generation_batches b
      JOIN topics t ON t.id = b.topic_id
      WHERE b.id = generations.batch_id AND t.user_id = auth.uid()
    )
  );

-- 4. sessions：owner 隔离
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_user ON sessions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5. image_safety_audits：经 generation_id JOIN 验证 owner（同 generations 策略）
ALTER TABLE image_safety_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY audits_via_generation ON image_safety_audits
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM generations g
      JOIN generation_batches b ON b.id = g.batch_id
      JOIN topics t ON t.id = b.topic_id
      WHERE g.id = image_safety_audits.generation_id AND t.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM generations g
      JOIN generation_batches b ON b.id = g.batch_id
      JOIN topics t ON t.id = b.topic_id
      WHERE g.id = image_safety_audits.generation_id AND t.user_id = auth.uid()
    )
  );
```

匿名用户通过 `signInAnonymously()` 获得真实 `auth.uid()`，Phase2 引入 OAuth PKCE 真实登录时数据迁移零成本。

### 4.4 API Contract

#### 4.4.1 聊天

- `POST /api/chat`（SSE，事件：`session | chunk | tool_calls | tool_result | tool_error | end`）
  - 请求：`{ message: string, thread_id?: string, tools?: string[], model?: string, skillId?: string, images?: Attachment[] }`
  - 响应事件流：首事件 `session` 给 `thread_id`；之后 `chunk` 增量文本；工具调用期间 `tool_calls` / `tool_result` / `tool_error`；流结束 `end`。
- `GET /api/chat?thread_id=` → 会话历史（来自 LangGraph checkpointer + sessions 表）。
- `GET/POST /api/chat/sessions` · `PATCH /api/chat/sessions` · `DELETE /api/chat/sessions/[id]`（同步清理 checkpointer `thread_id` + Storage 对象）。

#### 4.4.2 生图工作台

- `POST /api/image`
  - 请求：`{ prompt: string, provider?: 'seedream'|'gemini', model?: string, params: { aspectRatio?, resolution?, imageUrls?, num?, providerSpecificParams? }, topicId?: string, skillId?: string }`
  - 响应：`{ taskId: string, batchId: string, generations: Generation[] }`（`taskId === batchId`）
  - 失败结构：`{ error: { code: 'bad_request' | 'unauthorized' | 'quota_exceeded' | 'provider_error' | 'network' | 'moderation', message: string } }`
- `GET /api/image/[taskId]` → `{ taskId, batchId, status, generations: Generation[] }`
- `POST /api/image/recreate` → `{ batchId: string, mode: 'single' | 'failed' | 'all', generationId?: string }`（mode=single 必传 generationId；参数复用原 `config` jsonb）

#### 4.4.3 话题 / 技能 / 内容安全

- `GET /api/topics?kind=image|chat&limit=50` → `Topic[]`
- `POST /api/topics` `{ kind, title }` → `Topic`
- `GET /api/topics/[id]/batches` → `GenerationBatch[]`
- `GET /api/skills` → `Skill[]`（meta + SKILL.md 正文已解析）
- `POST /api/image/safety-check` `{ prompt, imageUrls? }` → `{ verdict: 'pass' | 'block' | 'review', reasons: string[] }`（前端实时预览）

### 4.5 Integration Points

| 依赖 | 用途 | 关键 env / 接入 |
| --- | --- | --- |
| Supabase Cloud | Postgres + Storage + Auth | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `SUPABASE_SERVICE_ROLE_KEY`（仅服务端，匿名登录由 RLS 替代） |
| `@supabase/supabase-js` | 客户端 SDK | browser + server（anon + service） |
| `@skroyc/langgraph-supabase-checkpointer` | LangGraph 历史持久化 | **每请求新建** `new SupabaseSaver(client, undefined, userId)`；表名按库默认，迁移 SQL 入库 |
| `@google/genai` + Gemini API | Gemini 图片生成 | `GOOGLE_API_KEY` |
| 火山方舟 Ark API | Seedream 图片生成 | `ARK_API_KEY` + endpoint |
| 内容安全供应商 | 违禁检测（数美/火山/阿里云绿网 任选其一） | `CONTENT_SAFETY_API_KEY` + `CONTENT_SAFETY_ENDPOINT` |
| 监控告警 | provider 健康检查 + 配额告警 | `MONITORING_WEBHOOK_URL` |
| `@langchain/*` | LangGraph / 模型适配 | — |

接入时确认 Seedream 与 Gemini 在接入时支持的最新模型版本与参数；本文档以 3.0 与 pro-preview 为默认基线。

### 4.6 Security & Privacy

- **密钥**：所有 key 走 env，不入代码库；`.env.example` 与 `app/...` 读取的变量名严格一致（修复 LangGraphPj 的 `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` 错配）。
- **RLS**：所有业务表按 §4.3.3 启用且策略完整；匿名用户有效；禁用 `service_role` 走前端。
- **构建类型检查**：`next.config.ts` 不开 `ignoreBuildErrors:true`；`tsconfig` strict；ESLint `@typescript-eslint/no-explicit-any: error`（禁止 `any`）。
- **SSE 解析**：服务端用 Next.js `ReadableStream` 标准封装；前端手写 `parseSseEvents` 容错（行截断 / 多事件 / 心跳）。
- **第三方代码执行**：禁止 `eval` / `Function` 执行 AI 生成代码（修复 LangGraphPj `CodePreviewPanel` 风险）。
- **每请求 compile**：LangGraph workflow 与 SupabaseSaver 每次请求都新建，避免模块级单例在 Vercel serverless 多实例下串数据/失效。
- **OAuth PKCE**：Phase2 引入真实登录时采用 OAuth PKCE（不沿用 LangGraphPj implicit flow）。
- **迁移文件**：所有表结构变更以 `supabase/migrations/*.sql` 入库，CI 校验 `supabase db diff` 与迁移一致。
- **配额**：服务端按 `user_id` + UTC 日计算使用量，DB 计数器；越界返回 `quota_exceeded` HTTP 429。
- **内容安全**：所有生图调用前后过国内内容安全供应商；`moderation` 错误码独立于其他错误码；审计落 `image_safety_audits`。
- **日志**：不打印原始提示词与全量 base64；错误日志脱敏（仅保留错误码与首 80 字符）。

### 4.7 i18n

- 中文优先（默认 zh-CN），i18n key 结构化（`packages/shared/i18n/zh-CN.ts`）；新增文案必须先有 zh-CN key。
- en-US 切换入口 Phase2；Phase1 不实现。

### 4.8 部署假设（Phase1）

- 首选 Vercel（Next.js 友好 + Supabase Cloud 同生态）。若国内访问受限，回退自托管（PM2 + Node 24 + 反向代理），与 LangGraphPj 一致。
- 本地开发：`pnpm dev`（App Router 默认 3000），Supabase Cloud 直连。

### 4.9 非功能与运维（新增）

#### 4.9.1 监控指标

- **API 层**：成功率（2xx 比例）、错误率（按 code 分桶）、p95 延迟（按 provider/endpoint 分统计）、QPS。
- **生图层**：单张成功率（按 provider/model 分）、平均生成时长、provider 健康检查（5 分钟滚动窗口）。
- **配额**：每日使用量、剩余配额、越界次数。
- **告警**：provider 错误率 > 50%（5 分钟窗口）触发 PagerDuty/钉钉；配额 > 80% 触发警告。

#### 4.9.2 备份与灾备

- **Postgres**：Supabase 自动备份（每日），RPO ≤ 1h；季度恢复演练，RTO ≤ 4h。
- **Storage 生命周期**：generated-images 90 天、uploads 30 天（DB 调度清理 + 跨 bucket 校验）。
- **配置备份**：env 模板入仓（`.env.example`），CI 校验实际 env 与模板一致。

#### 4.9.3 灰度发布与回滚

- **Vercel**：每个 PR 自动 preview deploy；prod 经手动 promote；回滚通过 Vercel 一键回退到前一个 deploy。
- **自托管**：蓝绿部署（PM2 + 端口切换）；回滚通过保留前 3 个 release artifact。
- **DB 迁移**：所有迁移文件命名规范 `NNNN_description.sql`（升序）；回滚 SQL 命名 `NNNN_description.down.sql` 同 commit 提交。

#### 4.9.4 变更管理

- PR 模板：变更类型 / 关联 US / 验收标准 / 影响范围 / 回滚方案。
- 评审清单：安全（RLS/密钥/SSE）、性能（p95）、可观测性（监控指标）、数据（迁移/索引）。
- 安全门禁：secret scanning、ESLint 禁 `any`、迁移文件存在性校验。

#### 4.9.5 可访问性（Phase2+）

- 关键流程达 WCAG 2.1 AA（键盘可达、对比度、aria 标签）。

---

## 5. Risks & Roadmap

### 5.1 Phased Rollout

| 阶段 | 范围 | 完成定义（DoD） |
| --- | --- | --- |
| **MVP（Phase1）** | 首页聊天 + /image 工作台 + 3 个服饰技能 + Seedream/Gemini 双 provider（均验收）+ 配额 + 匿名登录 + 内容安全必接 + 监控/备份 + 2K 默认 + 每请求 compile | §1.3 全部指标达成；Non-Goals 全部未做；RTM 完整；测试覆盖率 ≥ 70% |
| **v1.1** | 4K 支持 + 卖点图/A+图/尺码图三个技能 + 用户自定义技能编辑（AgentSkillEdit 类） | 6 个技能全部可用率 ≥ 80%；4K p95 ≤ 120s |
| **v1.2** | 套图批量编排（多类型并发规划 + Supabase Edge Function 队列） | 套图任务平均完成率 ≥ 95%；队列 P99 延迟 < 5 min |
| **v2.0** | OAuth PKCE 真实登录 + 积分 / 付费 + 技能市场 + 多租户 / 团队 | 登录流程 e2e 通过；计费闭环 |

### 5.2 Technical Risks

| 风险 | 概率 | 影响 | 触发阈值 | 缓解 | Owner |
| --- | --- | --- | --- | --- | --- |
| Seedream 4K 单张 ≥ 60s 与 p95 ≤ 60s 冲突 | 取消 | 取消 | — | 4K 挪 Phase2，Phase1 仅 2K | 工程 |
| Gemini 国内访问受限 | 高 | 中 | 5 分钟错误率 > 30% | 调度降级到 Seedream；UI 提示限上不可用 | 工程 |
| Seedream 服饰效果未达可用率 80% | 中 | 高 | 周盲评 < 80% | 模板调优回归；临时降级空白模板 | 设计 |
| 无登录被薅羊毛 | 中 | 中 | 同一 UID 24h 出图 > 30 | 每日配额 + 并发限制 + UA/IP 软限速 | 工程 |
| 内容合规（国内上线） | 高 | 高 | 违规样本拦截率 < 99% | Phase1 必接供应商；违规告警 P0 | 运维 |
| serverless 长任务超时 | 低 | 中 | Vercel 10s/60s 超时 | 每请求 compile + 同步生成 ≤ 60s；超长任务降级 Next 配置 | 工程 |
| checkpointer 删 thread 失败 | 低 | 低 | 每次删除告警 | 主流程 warn 仅；定期 job 清理孤儿 | 工程 |
| parametersSchema 与 provider 版本漂漂 | 中 | 中 | provider SDK 升级 | schema 入仓，CI 校验 schema 与 adapter 字段一致 | 工程 |
| 监控告警误报/漏报 | 中 | 中 | 误报 > 5% / 漏报 > 1% | 阈值季度回归；人工验证 | 运维 |
| 备份恢复失败 | 低 | 高 | RPO/RTO 超阈值 | 季度演练 + 演练报告 | 运维 |
| 迁移文件漂移 | 中 | 中 | 手工改 Supabase 控制台 | 迁移一律入库；CI `supabase db diff` 校验 | 工程 |
| 密钥泄漏 | 低 | 高 | 代码中提交 key | 预提交钩子 + secret scanning + GitHub Push Protection | 工程 |

### 5.3 Open Items（待开发时确认）

| 待确认项 | 解决时间窗 | Owner | 状态 |
| --- | --- | --- | --- |
| Seedream 4K 实际生成时长（v1.1 前实测） | Phase1 末 | 工程 | 待确认 |
| 国内访问 Gemini 的代理方案（v1.1 前） | Phase1 末 | 工程 | 待确认 |
| 内容安全供应商选型（数美 / 火山 / 阿里云绿网） | Phase1 第三周 | 运维 | 待确认 |
| 与公司既有"服饰出图方法论"SKILL.md 模板对接 | Phase1 第二周 | 设计 | 待确认 |
| **parametersSchema 数据格式（JSON Schema vs Zod）** | Phase1 第一周 | 工程 | **已确认：JSON Schema**（review-report C2 确认；tech-selection §3.8 落地） |
| provider 健康检查告警渠道（PagerDuty / 钉钉 / Lark） | Phase1 第一周 | 运维 | 待确认（告警渠道 Phase2 推迟，机制见 tech-selection §3.13a） |

---

## 6. 附录

### 6.1 决策记录（详解）

| ID | 决策 | 选项 | 选 | 理由 |
|---|---|---|---|---|
| Q1 | 可用率评估方法 | 人工盲评 / LLM 评测 / 生产埋点 / 双轨 | 人工盲评 | Phase1 无真实用户反馈，设计师盲评是唯一可信的客观数字 |
| Q2 | ImageGen 参数集 | 极简集 / 极简+透传带 / lobehub 完整集 | 极简+透传带 | 平衡通用性与扩展性，Seedream/Gemini 独有能力有出口 |
| Q3 | Phase1 Gemini | 仅 Seedream / 双 provider 交付 / 隐性预留 | 双 provider 交付 | 双路均验收，确保 Seedream/Gemini 路径在 Phase1 跑通 |
| Q4 | 错误码枚举 | API 权威 / US AC 权威 / 并集+预留 | API 权威（6 个） | API 契约是前后端共同契约；snake_case + REST 必需字段 |
| Q5 | taskId 语义 | batchId 复用 / 新增 tasks 表 | batchId 复用 | 避免多余实体，与 lobehub 习惯一致 |
| Q6 | sessions↔thread_id | 复用 / 独立主键 / 取消 sessions | 复用 | 主题列表与历史同 id，零 JOIN |
| Q7 | parametersSchema | 简化版 / 不引入 / lobehub 完整 | 简化版 | Phase1 覆盖两个固定 model 即可，不做动态注册 |
| Q8 | 4K 留 Phase1 | 挪 Phase2 / 选 4K 但双 p95 / 选 4K 单 p95 | 挪 Phase2 | 规避 serverless 10-60s 超时与 p95 冲突 |
| Q9 | 监控/备份纳入 MVP | 纳入 / 仅最小告警 / 后补 | 纳入 | 子代理报告 P0 必接，避免 Phase1 上线事故无察觉 |
| Q10 | workflow 缓存 | 每请求 compile / Map 缓存 / 轻量解析 | 每请求 compile | Vercel serverless 多实例下最安全 |
| Q11 | 内容安全时点 | Phase1 必接 / Phase2 / 仅海外 | Phase1 必接 | 国内合规要求，避免上线后被动补 |
| Q12 | 聊天 LLM provider | Doubao+MiniMax / Gemini+OpenAI / 仅 Doubao / 暂不锁 | Doubao + MiniMax | review-report §0 C1 确认：国内合规 + 双供应商隔离；MiniMax 走 Anthropic 兼容 baseURL 适配 LangChain |
| Q-C2 | parametersSchema 数据格式（Q7 子决策） | JSON Schema / Zod / 双 schema / 暂不锁 | JSON Schema | review-report §0 C2 确认：与 OpenAPI 生态兼容，后续经 zod-to-openapi 生成 API 文档；CI 独立校验 |
| D1 | 架构借鉴边界 | — | 复用 @lobehub/ui + 自建 | lobehub SPA/Hono/drizzle 不能复刻，明示借鉴范围 |
| D2 | 工具注册表 | — | 照搬 LangGraphPj 四类 | 选择性 bindTools、统一管理 |
| D3 | 删会话清理 | — | 同步清 checkpointer + Storage | 避免孤儿数据 |
| D4 | SSE 事件名 | — | 对齐 LangGraphPj（chunk） | 实现不漂移 |
| D5 | SKILL.md 字段 | — | 新增 triggers.tools / providerHints | 支持技能自动启用工具 |
| D6 | 重生成语义 | — | 三模式 API | 单图替换 / 失败项重试 / 全部重试 |
| D7 | 命名 | — | snake_case + bucket 路径对齐 | 跨章节一致性 |
| D8 | 术语 | — | Seedream/Gemini + userId/user_id/anonUid 映射 | 文档一致 |
| D9 | generations.provider | — | 冗余存 | US7 单 generation 查询无需 JOIN |
| D10 | 历史保留 | — | 90/30 天 | 合规与成本平衡 |
| D11 | i18n Phase1 | — | 仅 zh-CN | 范围控制 |
| D12 | OAuth | — | Phase2 PKCE | 不沿用 LangGraphPj implicit flow |
| D13 | 禁 any | — | strict + ESLint | 修复 LangGraphPj 类型安全弱点 |

### 6.2 Traceability Matrix（US ↔ Success Criteria ↔ Risk ↔ Tech）

| US | Success Criteria | 主要风险 | 涉及技术章节 |
|---|---|---|---|
| US1 通用文生图 | "操作步数 ≤ 3"、"p95 ≤ 60s"、"可用率 ≥ 80%" | Seedream 服饰效果 / 性能超阈 | §3.1 ImageProvider / §4.4.2 API / §4.6 安全 → tech-selection §3.7、§3.16、§4.1 |
| US2 通用图生图 | "p95 ≤ 60s"、"可用率 ≥ 80%" | 上传文件超限 / content safety | §3.1 图片工具 / §4.3 Storage / §4.6 内容安全 → tech-selection §3.7（含 10MB/MIME 校验，review-report GAP-1）、§3.5、§3.12 |
| US3 服饰技能出图 | "可用率 ≥ 80%"（每技能） | SKILL.md 模板质量 | §3.2 Skills / §4.2 packages/skills → tech-selection §3.7a SKILL.md loader（review-report GAP-2）、§4.3 SkillSelector |
| US4 聊天内置生图 | "p95 ≤ 60s"、"Gemini 降级 UI" | Gemini 不可用 / 工具误触发 | §3.3 触发机制 / §4.1 chat 链路 → tech-selection §3.10、§3.11、§3.13a Provider 健康检查（review-report GAP-3/GAP-7）、§3.9 Doubao+MiniMax |
| US5 工作台批量与重生成 | "p95 ≤ 60s"、"错误码 100% 覆盖率" | 重生成语义混淆 | §3.1.1 / §4.4.2 recreate API → tech-selection §3.6（三模式 recreate，review-report GAP-4）、§3.16 错误码 + HTTP 状态映射（review-report GAP-13） |
| US6 持久化与历史 | "恢复率 100%"、"清理" | checkpointer 删 thread 失败 | §4.3 sessions / §4.4.1 DELETE → tech-selection §3.11a DELETE session 同步清理（review-report GAP-5）、§2.7 SWR、§3.4 sessions 表 |
| US7 模型切换 | "切换不破坏历史" | 历史 provider 标注 / 降级 | §4.3 generations.provider / §4.5 监控 → tech-selection §3.4 generations.provider 冗余、§3.7 ImageProvider 接口、§3.13a 健康检查 |

### 6.3 修订摘要（与原版对比）

**解决的 Critical 问题**：
- C1（taskId 无表）：taskId = batchId 复用，删除冗余语义。
- C2（错误码冲突）：统一为 6 个 API 权威枚举，US/AC/API/SQL 全对齐。
- C3（sessions↔thread_id 断裂）：sessions.id == thread_id，主题列表即历史。
- C4（工具注册表缺失）：照搬 LangGraphPj 四类注册表，按 toolIds 选择性 bindTools。
- C5（workflow 单例缓存）：每请求 compile + 每请求 SupabaseSaver。
- C6（架构错配认知）：明示借鉴范围（@lobehub/ui UI 复用 + 自建路由/状态/后端）。
- C7（parametersSchema 缺失）：Phase1 引入覆盖 Seedream 3.0 与 Gemini pro preview 的 schema。

**解决的 Major 问题**：
- M1 监控/备份：新增 §4.9（含监控指标、备份、灰度、变更管理）。
- M2 p95 测量方法：明确 Seedream/Gemini 分统计、n ≥ 30 样本、2K 限定。
- M3 度量口径：操作步数/可用率/200ms/配额 全部定义测量方法。
- M4 阶段口径：统一 Phase1/v1.1/v1.2/v2.0；内容安全明确为 Phase1 国内上线必接。
- M5 分辨率冲突：统一 1K/2K（4K 挪 Phase2）。
- M6 provider 字段：generations.provider 冗余存。
- M7 评估责任：§3.4 表格中"责任"列明确 owner。
- M8 可追溯性：新增 §6.2 RTM 矩阵。
- M9 团队/时间：列于 §5.1 DoD 与 §5.3 Owner 列。
- M10 风险四要素：§5.2 风险表补齐概率/影响/owner/触发阈值。
- M11 RLS 完整：补全 5 张表的完整 SQL。
- M12 重生成语义：API 三模式明示。

**解决的 Minor 问题**：
- m1-m6 命名/术语：统一。
- US5 "不得遗漏"改为可判定条件（UI 显式标红）。
- bucket 路径前缀与命名对齐。
