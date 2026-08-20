# zimage 技术选型文档

> ZImage — 面向设计师的电商图片处理工作台的技术选型与实现路径。
>
> 本文按"页面功能需求"组织结构，每项选型包含：① 需求来源（`requirements.md` 条号 + 摘要）② 技术实现方案（伪代码 + 参考实现路径）③ 选型依据（含备选对比）④ 实施步骤。
>
> 实施原则：**先前端后后端、仅 web 端**。本文 §1-§2 是前端/工程基础，§3 是后端，§4 按页面串起来，§5 给出阶段化实施路径。

---

## 0. 引言

### 0.1 文档目的

承接 `requirements.md`（已通过 12 项用户拍板 + 13 项代决策固化），将"产品需求"转译为"工程实现的技术选型与实施路径"。本文不重复产品需求，只回答"用什么实现 + 怎么落地 + 为什么这个选择"。

### 0.2 决策来源

- 来自 `requirements.md` 决策记录表（§1.4）：12 项用户拍板 + 13 项代决策（Q12 聊天 LLM provider 为本轮新增，已回填到 requirements.md §1.4）。
- 本轮新增 31 项技术选型问答（Q16 ~ Q54）。
- 既有定性结论（聊天 LLM、Gemini + Seedream 双 provider、匿名登录等）。
- **本轮审查补充**（参见 `doc/review-report-requirements-vs-tech.md §0`）：
  - **C1**：聊天 LLM provider 锁定为 `Doubao + MiniMax`（双 provider），见 §3.9。
  - **C2**：parametersSchema 数据格式锁定为 `JSON Schema`，见 §3.8。

### 0.3 实施原则

- **先前端后后端**：先把页面骨架 + UI 跑通（mock 数据），再接入真实后端。
- **仅 web 端**：不做 iOS / Android / 桌面端适配；响应式 Web 即可。
- **少自创、多复用**：优先复用 lobehub-canary / LangGraphPj 中现成的封装与机制。

---

## 1. 工程基础栈

### 1.1 Monorepo：pnpm workspaces + Turborepo

**需求来源**：[`requirements.md` §4.2 目录结构（pnpm monorepo）](requirements.md#42-directory-structurepnpm-monorepo)

**技术实现**：

根目录 `pnpm-workspace.yaml`：

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

根目录 `turbo.json`：

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "outputs": [] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "type": { "dependsOn": ["^build"], "outputs": [] }
  }
}
```

**参考代码**：
- lobehub-canary 用 pnpm workspaces，未引 Turborepo（推断会因 apps×3 + 30+ 包导致构建慢）。
- LangGraphPj `pnpm-workspace.yaml` 仅 `.`（单包，未用 workspaces），不能直接复用。

**选型依据**：
- Turborepo 提供增量构建 + 远程缓存 + 跨包依赖图，monorepo 越大收益越高。
- LangGraphPj/lobehub 未引是因为 apps 不多，但 zimage 计划有 `apps/web` + `packages/{image-providers, chat-providers, skills, shared, fetch-sse, observability}` 多个包，引入 Turborepo 收益显著。

**实施步骤**：
1. 根目录建 `pnpm-workspace.yaml` + `turbo.json`。
2. 根 `package.json` 加 `packageManager: "pnpm@9.x"` + 顶层 scripts：`pnpm dev`、`pnpm build`、`pnpm lint`、`pnpm test`、`pnpm type`（委托 Turborepo）。

---

### 1.2 包管理：pnpm 9 + Node 24 LTS

**需求来源**：`requirements.md` §1.4 + §4.2（pnpm monorepo 基础）

**技术实现**：

`.nvmrc`：
```
24
```

`package.json`：
```json
{
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=24.0.0", "pnpm": ">=9.0.0" }
}
```

**参考代码**：lobehub-canary `.nvmrc` = `lts/krypton`（Node 24）。

**选型依据**：
- Node 24 LTS 直接对齐 lobehub，避免后续升级踩坑。
- pnpm 9.x 为当前稳定（pnpm 10 生态未完全成熟）。

**实施步骤**：
1. 根目录建 `.nvmrc` + `package.json` 字段。
2. CI 跑 `pnpm install --frozen-lockfile`。
3. 本地：`nvm use` → `corepack enable` → `pnpm install`。

---

### 1.3 TypeScript：strict + project references

**需求来源**：`requirements.md` §4.6 禁 `any`、严格类型

**技术实现**：

根 `tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./apps/web/*", "./packages/*/src/*"] }
  },
  "references": [
    { "path": "./apps/web" },
    { "path": "./packages/image-providers" },
    { "path": "./packages/chat-providers" },
    { "path": "./packages/skills" },
    { "path": "./packages/shared" },
    { "path": "./packages/fetch-sse" }
  ]
}
```

每个 `packages/*/tsconfig.json` 独立，使用 `composite: true`。

**参考代码**：LangGraphPj `tsconfig.json` strict + paths `@/*` -> `./*`（但单包，未用 references）。

**选型依据**：
- 修复 LangGraphPj 大量 `any` 的类型安全弱点（requirements.md §4.6 禁 any）。
- monorepo 多包用 `project references` 是行业标准（pnpm 官方推荐）。

**实施步骤**：
1. 根目录建 `tsconfig.json` + references 列表。
2. 每个 packages/* 加 `tsconfig.json`（composite:true）。
3. CI 跑 `turbo run type` 全量类型校验。

---

### 1.4 Lint / Format：ESLint 9 flat config + Prettier

**需求来源**：`requirements.md` §4.6 禁 `any`、§4.9.4 变更管理

**技术实现**：

根 `eslint.config.mjs`（flat config）：
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import next from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./apps/*/tsconfig.json', './packages/*/tsconfig.json'] },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react/prop-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
```

`.prettierrc`：
```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 80,
  "trailingComma": "all",
  "arrowParens": "always"
}
```

**参考代码**：LangGraphPj `eslint.config.mjs`（flat config + typescript）。

**选型依据**：
- ESLint 9 + flat config 是当前规范（LangGraphPj 风格，v9 兼容）。
- Biome 速度快但 React/Next 插件不成熟，Phase1 不冒险。
- 禁 `any` 是 requirements.md §4.6 强约束。

**实施步骤**：
1. 根目录装 ESLint 9 + Prettier + Next/React plugin。
2. 写 flat config + Prettier 配置。
3. CI 跑 `turbo run lint`。

---

### 1.5 Pre-commit：husky + lint-staged

**需求来源**：`requirements.md` §4.9.4 变更管理

**技术实现**：

`.husky/pre-commit`：
```bash
pnpm exec lint-staged
```

`package.json`：
```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml}": ["prettier --write"]
}
```

**参考代码**：lobehub-canary 根目录 `.husky/` 目录（实际使用 Git hooks）。

**选型依据**：
- 提交时跑 lint+format，减少 CI 失败。
- 修复 LangGraphPj 已知坑（无 lint-staged，提交无前置检查）。

**实施步骤**：
1. `pnpm dlx husky init`。
2. 配 `.husky/pre-commit` + `lint-staged`。
3. CI 兜底：lint+test 通过才合并。

---

### 1.6 CI/CD：GitHub Actions

**需求来源**：`requirements.md` §4.9.3 灰度发布 + §4.9.4 变更管理

**技术实现**：

`.github/workflows/ci.yml`：
```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint type test
      - run: pnpm turbo run build
```

`.github/workflows/deploy.yml`：
```yaml
name: Deploy
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm i -g vercel
      - run: vercel deploy --prod --yes --token=${{ secrets.VERCEL_TOKEN }}
```

**参考代码**：lobehub-canary `.github/workflows/auto-i18n.yml`（GitHub Actions 风格）。

**选型依据**：
- GitHub Actions 与 GitHub 原生集成，免费层足够。
- Vercel CLI 走 GitHub Actions 部署与 Vercel 平台原生集成一致。

**实施步骤**：
1. 写 `.github/workflows/ci.yml` 跑 lint/test/build。
2. 写 `deploy.yml` 部署到 Vercel（或自托管）。
3. 配 secrets：`VERCEL_TOKEN`、`SUPABASE_*`、`ARK_API_KEY`、`MINIMAX_*`。

---

### 1.7 Secrets 管理：平台原生

**需求来源**：`requirements.md` §4.5 集成点 + §4.6 安全

**技术实现**：

`.env.example`（入仓）：
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
# Image + Chat providers（火山方舟平台：Seedream + Doubao 共用，review-report C-1 锁定 ARK_*）
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_API_KEY=xxx
DOUBAO_MODEL=doubao-pro
GOOGLE_API_KEY=xxx
# Chat providers (MiniMax，Anthropic 兼容)
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_API_KEY=xxx
MINIMAX_MODEL=minimax-...   # 接入时确认
# Content safety
CONTENT_SAFETY_API_KEY=xxx
CONTENT_SAFETY_ENDPOINT=https://api.example.com/v1/check
# Monitoring
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=xxx
LANGSMITH_PROJECT=zimage
SENTRY_DSN=xxx
```

**参考代码**：LangGraphPj `.env.example`（同样有变量名错配坑——已修复）。

> **C-1 命名统一说明**（review-report C-1 用户拍板）：Seedream（图像生成）与 Doubao（聊天）同为火山方舟 Ark 平台，env 命名统一以平台术语 `ARK_BASE_URL` / `ARK_API_KEY` 为权威。`DOUBAO_MODEL` 仅保留作为聊天模型 ID 字符串（不携带密钥）。

**选型依据**：
- 修复 LangGraphPj `SUPABASE_URL` vs `NEXT_PUBLIC_SUPABASE_URL` 错配（requirements.md §4.6 + AGENTS.md 已知坑）。
- 本地 `.env.local` 不入仓；生产走 Vercel Encrypted Env 或自托管 PM2 secrets。

**实施步骤**：
1. 写 `.env.example` 完整版（**变量名与代码读取的严格一致**）。
2. `.env.local` 入 `.gitignore`。
3. CI lint 校验：执行 `node -e "require('dotenv').config({path:'.env.example'})"` 并 assert 代码中引用的 env 名都在模板里。

---

## 2. 前端栈（先实现）

### 2.1 Next.js 16 App Router

**需求来源**：`requirements.md` §4.1 架构、§4.2 目录

**技术实现**：

`apps/web/next.config.ts`：
```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
  transpilePackages: [
    '@lobehub/ui',
    '@lobechat/fetch-sse',
    '@zimage/image-providers',
    '@zimage/chat-providers',
    '@zimage/skills',
    '@zimage/shared',
  ],
};

export default config;
```

**参考代码**：
- LangGraphPj `next.config.ts`（`reactStrictMode:false`、`typescript.ignoreBuildErrors:true` —— 我们**不**沿用这两个）。
- lobehub-canary `next.config.ts`（SPA 模式，不直接复用）。

**选型依据**：
- 修复 LangGraphPj 关闭构建期类型检查的弱点（requirements.md §4.6）。
- App Router 与 LangGraph Route Handler + Supabase 同栈。

**实施步骤**：
1. 初始化 `apps/web/`：`pnpm create next-app@latest --typescript --eslint --app --no-tailwind --src-dir=false`。
2. 调整 `next.config.ts`（去掉 ignoreBuildErrors、typedRoutes 开启）。
3. 删 默认 Tailwind 依赖（用 antd+antd-style）。

---

### 2.2 构建：Next.js 默认

**需求来源**：`requirements.md` §4.1 + Q24 决策

**技术实现**：直接用 Next.js 16 默认构建（Webpack）；不显式开启 Turbopack（避免某些插件不兼容）。

**选型依据**：
- 用户 Q24 选"Next.js 默认构建"。
- Turbopack 在某些 next.config 兼容上有坑，Phase1 稳为先。

**实施步骤**：无需额外配置；后续如需切 Turbopack 再调整 `next dev --turbo`。

---

### 2.3 UI 组件库：@lobehub/ui ^5.x + antd 5

**需求来源**：`requirements.md` §1.2（首页采用 lobehub Home 交互）+ D1（明示借鉴范围）

**技术实现**：

`apps/web/src/app/layout.tsx`：
```tsx
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import '@lobehub/ui/css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider theme={{ token: { colorPrimary: '#5B5FED' } }}>
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
```

**参考代码**：
- lobehub-canary 全仓使用 `@lobehub/ui` + antd + antd-style 统一。
- LangGraphPj 用 Tailwind 4 自绘，无 antd 组件复用。

**选型依据**：
- 用户 Q18 选"antd + antd-style 统一"。
- @lobehub/ui 提供 ChatInput / ModelSwitch / GenerationWorkspace 等关键 UI，与 §1.2 的"首页参考 lobehub Home 交互"对接。
- 自绘 ChatInput 工作量大，且与"观感接近 lobehub"目标冲突。

**实施步骤**：
1. 装 `@lobehub/ui`、`antd`、`@ant-design/cssinjs`、`@ant-design/nextjs-registry`。
2. 根 layout 注入 `AntdRegistry` + `ConfigProvider`。
3. 验证 `<ModelSwitchPanel>`、`<ChatInput>` 在 Next.js App Router 客户端组件下可渲染。

---

### 2.4 CSS：antd + antd-style 统一

**需求来源**：`requirements.md` §1.2 + Q18 决策

**技术实现**：见 §2.3，主题通过 `ConfigProvider` 集中配置；不使用 Tailwind。

**参考代码**：lobehub-canary 全局主题：`packages/ui/src/theme`。

**选型依据**：
- 用户 Q18 选"antd + antd-style 统一"——antd 自带 css-in-js + @lobehub/ui 内部用 antd-style，零冲突。
- LangGraphPj 风格（Tailwind + 自绘）会与 lobehub 观感冲突。

**实施步骤**：见 §2.3。

---

### 2.5 图表：@lobehub/charts

**需求来源**：`requirements.md` §4.9.1 监控；Q29 决策

**技术实现**：
```tsx
import { LineChart } from '@lobehub/charts';

export function GenerationTrend({ data }: { data: Array<{ date: string; count: number }> }) {
  return <LineChart data={data} xAxis="date" yAxis="count" />;
}
```

**参考代码**：lobehub-canary `package.json` 依赖 `@lobehub/charts ^5.4.0`（封装 recharts）。

**选型依据**：
- 用户 Q29 选"@lobehub/charts（复刻 lobehub 生态）"。
- 与 antd 主题一致、lobehub 已在生产验证。

**实施步骤**：
1. 装 `@lobehub/charts`。
2. 在 `/image` 工作台的"今日出图"卡片中接入 `LineChart` / `BarChart`（监控 dashboard）。

---

### 2.6 状态管理：zustand

**需求来源**：`requirements.md` §4.1 架构（zustand store）

**技术实现**：

`apps/web/src/store/image/slices/createImage/index.ts`（参考 lobehub 分层）：
```ts
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export const useImageStore = create<ImageStore>()(
  devtools(
    (set, get) => ({
      isCreating: false,
      generations: [],
      createImage: async () => { /* ... */ },
    }),
    { name: 'imageStore' },
  ),
);
```

**参考代码**：
- lobehub-canary `src/store/image/slices/createImage/action.ts`（class + flattenActions 模式）。
- LangGraphPj 不用 zustand（用 React Context）。

**选型依据**：
- lobehub 已用 zustand 多年，模式成熟。
- 我们用 zustand v4（与 lobehub 一致），不引 v5（生态未稳）。

**实施步骤**：
1. 装 `zustand@^4`。
2. 仿 lobehub `src/store/image/` 创建 `store/image/{slices,selectors}`。
3. 组件用 `useImageStore(selector)` 精确订阅。

---

### 2.7 数据获取：SWR

**需求来源**：`requirements.md` §4.1（轮询 /api/image/[taskId]）+ Q19 决策

**技术实现**：

`apps/web/src/features/ImageWorkspace/useGenerationStatus.ts`：
```ts
import useSWR from 'swr';
import { openapi } from '@/libs/openapi';

export function useGenerationStatus(taskId: string | null) {
  return useSWR(
    taskId ? ['/api/image/{taskId}', taskId] : null,
    ([url, id]) => openapi.GET(url, { params: { path: { taskId: id } } }),
    { refreshInterval: 2000, revalidateOnFocus: true },
  );
}
```

**参考代码**：lobehub-canary `src/hooks/useFetchAiImageConfig.ts`（SWR 包 fetcher）。

**选型依据**：
- 用户 Q19 选"SWR"（lobehub 风格）。
- SWR 轮询、revalidate、focus refresh 内置。

**实施步骤**：
1. 装 `swr@^2`。
2. 写 `libs/openapi.ts`（见 §2.8）+ fetcher 封装。
3. 在 `/image` 工作台、`/chat` 用 SWR 替换裸 fetch。

---

### 2.8 API 客户端：openapi-fetch + openapi-typescript

**需求来源**：`requirements.md` §4.4 API 契约 + Q35 决策

**技术实现**：

`apps/web/libs/openapi.ts`：
```ts
import createClient from 'openapi-fetch';
import type { paths } from '@/libs/api-types'; // 由 openapi-typescript 生成

export const openapi = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE ?? '',
  headers: { 'Content-Type': 'application/json' },
});
```

CI 任务 `gen:api-types`：
```json
"gen:api-types": {
  "command": "openapi-typescript http://localhost:3000/api/openapi.json -o apps/web/libs/api-types.d.ts"
}
```

**参考代码**：
- lobehub-canary `openapi-fetch ^0.14.1` + `openapi-typescript ^7.13.0`（已在生产使用）。
- LangGraphPj 手写 client（`utils/api.ts`，我们不沿用）。

**选型依据**：
- 用户 Q35 选"openapi-fetch + openapi-typescript"。
- 后端 zod schema → OpenAPI → 客户端类型唯一来源，零漂移。

**实施步骤**：
1. 装 `openapi-fetch` + `openapi-typescript`。
2. 后端用 `zod-to-openapi` 在 `/api/openapi.json` 暴露 OpenAPI 文档。
3. CI 跑 `pnpm gen:api-types` 重新生成 `apps/web/libs/api-types.d.ts`。

---

### 2.9 SSE 客户端：packages/fetch-sse（lobehub 风格）+ 事件名协议

**需求来源**：`requirements.md` §4.1 + §4.4.1 SSE 事件 + Q24 决策 + D4 决策；review-report GAP-12

> requirements §4.4.1 列出 6 类 SSE 事件名（session / chunk / tool_calls / tool_result / tool_error / end），但 tech-selection 此前仅泛指「行截断/多事件/心跳」。本节给出明确的事件名映射表，前后端共遵。

**技术实现**：

`packages/fetch-sse/src/index.ts`（从 lobehub `@lobechat/fetch-sse` 抽出）：
```ts
export interface FetchSSEOptions {
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  onMessage: (data: string, event: string) => void;
  onError?: (err: unknown) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

// SSE 事件名枚举（review-report GAP-12，对齐 requirements §4.4.1 + D4）
export const SSE_EVENT = {
  SESSION: 'session',         // 首事件：返回 thread_id
  CHUNK: 'chunk',             // 增量文本（LangGraphPj 命名沿用，D4）
  TOOL_CALLS: 'tool_calls',   // 模型发起工具调用
  TOOL_RESULT: 'tool_result', // 工具返回成功结果
  TOOL_ERROR: 'tool_error',   // 工具返回错误（含 6 个错误码）
  END: 'end',                 // 流结束
  // 心跳：单独走 comment: heartbeat（不计入 onMessage）
} as const;
export type SSEEvent = (typeof SSE_EVENT)[keyof typeof SSE_EVENT];

export async function fetchSSE(opts: FetchSSEOptions) {
  const res = await fetch(opts.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = parseSseEvents(buffer);
    buffer = events.remainder;
    for (const ev of events.events) {
      // 心跳跳过
      if (ev.event === 'heartbeat' || ev.event === '') continue;
      if (ev.event === SSE_EVENT.END) { opts.onDone?.(); return; }
      opts.onMessage(ev.data, ev.event);
    }
  }
}

function parseSseEvents(buffer: string): { events: Array<{ event: string; data: string }>; remainder: string } {
  // 行截断 + 多事件 + 心跳容错（参考 LangGraphPj parseSseEvents）
  // 每行格式：event: <name>\ndata: <payload>\n\n
  ...
}
```

**事件名映射表**（前后端共同契约，review-report GAP-12）：

| 事件名 | 触发时机 | data payload | 前端处理 |
|---|---|---|---|
| `session` | 首事件（流开头唯一一次） | `{ threadId: string }` | 写入 `useChatStore.activeThreadId` |
| `chunk` | LLM 增量文本 | `{ text: string }` | 追加到当前消息气泡 |
| `tool_calls` | 模型决定调用工具 | `{ toolId: string, args: any }` | UI 显示「正在调用 X 工具」 |
| `tool_result` | 工具返回成功 | `{ toolId: string, result: any }` | 渲染结果（如 `<imagecard>`） |
| `tool_error` | 工具返回错误 | `{ toolId: string, error: { code: ErrorCode, message: string } }` | 渲染 `<ErrorCard>` |
| `end` | 流结束 | `{}` | 关闭 loading、刷新 SWR 缓存 |
| `:heartbeat` (注释行) | 每 15 秒 | — | 客户端忽略，仅保活 |

**服务端事件发送（`apps/web/app/api/chat/route.ts`）**：

```ts
import { SSE_EVENT } from '@zimage/fetch-sse';

function emitSession(threadId: string) {
  return `event: ${SSE_EVENT.SESSION}\ndata: ${JSON.stringify({ threadId })}\n\n`;
}
function emitChunk(text: string) {
  return `event: ${SSE_EVENT.CHUNK}\ndata: ${JSON.stringify({ text })}\n\n`;
}
function emitToolCalls(toolId: string, args: unknown) {
  return `event: ${SSE_EVENT.TOOL_CALLS}\ndata: ${JSON.stringify({ toolId, args })}\n\n`;
}
function emitToolResult(toolId: string, result: unknown) {
  return `event: ${SSE_EVENT.TOOL_RESULT}\ndata: ${JSON.stringify({ toolId, result })}\n\n`;
}
function emitToolError(toolId: string, error: { code: ErrorCode; message: string }) {
  return `event: ${SSE_EVENT.TOOL_ERROR}\ndata: ${JSON.stringify({ toolId, error })}\n\n`;
}
function emitEnd() {
  return `event: ${SSE_EVENT.END}\ndata: {}\n\n`;
}

// 每 15 秒发心跳保活（Vercel serverless 60s 上限内）
setInterval(() => controller.enqueue(encoder.encode(`:heartbeat\n\n`)), 15000);
```

**前端订阅（`apps/web/src/hooks/useChatMessages.ts`）**：

```ts
import { fetchSSE, SSE_EVENT } from '@zimage/fetch-sse';

fetchSSE({
  url: '/api/chat',
  body: { message, threadId, tools, model, skillId },
  onMessage: (data, event) => {
    switch (event) {
      case SSE_EVENT.SESSION:
        const { threadId } = JSON.parse(data);
        store.setActiveThread(threadId);
        break;
      case SSE_EVENT.CHUNK:
        const { text } = JSON.parse(data);
        store.appendChunk(text);
        break;
      case SSE_EVENT.TOOL_CALLS:
        const { toolId, args } = JSON.parse(data);
        store.markToolCalling(toolId, args);
        break;
      case SSE_EVENT.TOOL_RESULT:
        const { toolId: tId, result } = JSON.parse(data);
        store.renderToolResult(tId, result);  // e.g. <imagecard>
        break;
      case SSE_EVENT.TOOL_ERROR:
        const { toolId: eId, error } = JSON.parse(data);
        store.renderToolError(eId, error);    // e.g. <ErrorCard>
        break;
    }
  },
  onDone: () => store.finishStream(),
});
```

**Phase1 验收对齐**：

- D4「SSE 事件协议对齐 LangGraphPj（chunk 命名）」—— `CHUNK = 'chunk'` 沿用
- requirements §4.4.1「事件：`session | chunk | tool_calls | tool_result | tool_error | end`」—— 6 事件名 1:1 落地

**参考代码**：
- lobehub-canary `packages/@lobechat/fetch-sse/src/`（项目内 fetch-sse 包）。
- LangGraphPj `app/hooks/useSendMessage.ts` 的 `parseSseEvents`（手写解析）。

**选型依据**：
- 用户 Q24 选"抽 lobehub fetch-sse 为 packages"。
- lobehub 的 fetch-sse 已调试过行截断、多事件、心跳。
- GAP-12：事件名映射表单一权威，前后端共用 `@zimage/fetch-sse` 的 `SSE_EVENT` 常量，避免字符串拼写漂移。

**实施步骤**：
1. 建 `packages/fetch-sse/`，从 lobehub-canary 复制 fetch-sse 源码 + 新增 `SSE_EVENT` 常量。
2. 写单元测试（覆盖 5+边界场景 + 6 类事件名解析）。
3. 在 `apps/web/app/api/chat/route.ts` 用 `emit*` 函数封装。
4. 在 `apps/web/src/hooks/useChatMessages.ts` 用 `SSE_EVENT` switch 订阅。
5. e2e 测试：触发 `image_generation` 工具调用，验证 `tool_calls` → `tool_result` → `end` 顺序。

---

### 2.10 i18n：react-i18next

**需求来源**：`requirements.md` §4.7 + Q28 决策

**技术实现**：

`apps/web/src/i18n.ts`：
```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '@zimage/shared/i18n/zh-CN';

i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN } },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export default i18n;
```

`packages/shared/i18n/zh-CN.ts`：
```ts
export default {
  home: { title: '设计你的电商图', subtitle: '与 AI 协作生成服饰图' },
  image: { title: '生图工作台', generate: '生成', ... },
  skill: { 'white-bg': '白底图', 'model-image': '模特图', 'scene': '种草图' },
  ...
};
```

**参考代码**：lobehub-canary `packages/locales/src/default/agent.ts`（结构化 key）。

**选型依据**：
- 用户 Q28 选"react-i18next"，与 lobehub 一致。
- Phase1 仅 zh-CN，但结构预留 en-US 切换入口。

**实施步骤**：
1. 装 `i18next` + `react-i18next`。
2. `packages/shared/i18n/zh-CN.ts` 集中所有 keys。
3. 组件用 `const { t } = useTranslation()`。

---

### 2.11 表单：react-hook-form + zod resolver

**需求来源**：`requirements.md` §3.1.1 schema（Zod 校验）+ §2.2 US2（10MB/MIME，review-report GAP-1）

**技术实现**：

`apps/web/src/features/ImageWorkspace/GenerationForm.tsx`：
```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// 与后端 §3.7 validate.ts 共享常量（review-report GAP-1）
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// 参考图客户端校验：上传后立刻检查（不等后端拒绝）
const referenceImageSchema = z.object({
  file: z.instanceof(File),
  previewUrl: z.string(),
  mimeType: z.enum(ALLOWED_MIME, {
    errorMap: () => ({ message: '仅支持 PNG / JPEG / WebP' }),
  }),
  sizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES, {
    message: `单文件超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
  }),
});

const formSchema = z.object({
  prompt: z.string().min(1, '提示词不能为空'),
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']),
  resolution: z.enum(['1K', '2K']),
  referenceImages: z.array(referenceImageSchema).max(4, '参考图最多 4 张').optional(),
  num: z.number().int().min(1).max(4),
});

export function GenerationForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(formSchema),
  });
  return (<form onSubmit={handleSubmit(onSubmit)}>...</form>);
}
```

上传组件联动：

```tsx
// apps/web/src/features/ImageWorkspace/UploadDropzone.tsx
async function handleFile(file: File): Promise<Result<ReferenceImage, string>> {
  if (!ALLOWED_MIME.includes(file.type as any)) {
    return { ok: false, error: '仅支持 PNG / JPEG / WebP' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `单文件超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
  }
  // 上传到 Supabase Storage（§3.5），拿 signed URL 注入 imageUrls
  const { url } = await storage.uploadImage(file, userId, batchId, genId, file.type);
  return { ok: true, value: { file, previewUrl: url, mimeType: file.type as any, sizeBytes: file.size } };
}
```

**代决策依据**：
- RHF + zod 是 2024+ 主流模式（最小 re-render + 强校验）。
- 校验 schema 与后端 zod schema 共享（`packages/shared/schemas/imageGeneration.ts` 单一权威，DRY）。
- GAP-1：客户端预校验避免上传后才被拒；后端 §3.7 二次校验防绕过。

**实施步骤**：
1. 装 `react-hook-form`、`@hookform/resolvers`、`zod`。
2. 在 `/image` 工作台生成表单、聊天输入框使用。
3. 复用 `packages/shared/schemas/imageGeneration.ts`（DRY；含 ALLOWED_MIME / MAX_IMAGE_BYTES 共享常量）。
4. 上传组件先校验 MIME + 大小，再上传到 Storage。

---

### 2.12 浏览器兼容：Chrome / Edge 最新

**需求来源**：`requirements.md` §1.3 测试环境 + Q32 决策

**技术实现**：
- 不写 polyfill；用现代浏览器原生 API（`fetch`、`ReadableStream`、`AbortController`）。
- `browserslist`：
  ```json
  "browserslist": ["last 2 Chrome versions", "last 2 Edge versions"]
  ```

**选型依据**：
- 用户 Q32 选"Chrome / Edge 最新"。
- 90%+ 设计师覆盖（兼容性要求最低）。

**实施步骤**：
1. 根 `package.json` 加 `browserslist` 字段。
2. CI 装 `browserslist` 校验。

---

### 2.13 错误监控：Sentry

**需求来源**：`requirements.md` §4.6 + Q26 决策

**技术实现**：

`apps/web/sentry.client.config.ts`：
```ts
import * as Sentry from '@sentry/nextjs';
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});
```

`apps/web/sentry.server.config.ts`：
```ts
import * as Sentry from '@sentry/nextjs';
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
});
```

**参考代码**：lobehub-canary 用 Sentry（具体略，in `packages/`）。

**选型依据**：
- 用户 Q26 选"Sentry"。
- session replay、source map 联动、React ErrorBoundary 集成最佳。

**实施步骤**：
1. 装 `@sentry/nextjs`。
2. 写 `sentry.{client,server,edge}.config.ts`。
3. 注入 `next.config.ts` 的 `withSentryConfig` 包装。

---

### 2.14 LLM Tracing：LangSmith

**需求来源**：`requirements.md` §4.9 + Q52 决策

**技术实现**：

`packages/chat-providers/src/index.ts`：
```ts
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

export function createChatModel(provider: string) {
  if (provider === 'doubao') {
    return new ChatOpenAI({
      apiKey: process.env.ARK_API_KEY,         // review-report C-1 锁定：共用 ARK_* env
      baseURL: process.env.ARK_BASE_URL,      // review-report C-1 锁定：共用 ARK_* env
      model: process.env.DOUBAO_MODEL ?? 'doubao-pro',
    });
  }
  if (provider === 'minimax') {
    return new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
      model: process.env.MINIMAX_MODEL ?? 'MiniMax-...',
    });
  }
  throw new Error(`Unknown provider: ${provider}`);
}
```

`.env`：
```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=xxx
LANGSMITH_PROJECT=zimage
```

**参考代码**：LangGraphPj `app/utils/models.ts` `createModel` + `LANGSMITH_*` env。

**选型依据**：
- 用户 Q52 选"LangSmith"。
- LangGraph agent 默认开启 LangSmith tracing（设置 env 即可）。

**实施步骤**：
1. 装 `langsmith`。
2. 写 env，写 `langchain` 调用代码（自动透传 trace）。
3. 打开 LangSmith dashboard 验证。

---

### 2.15 开发调试：LangGraph Studio

**需求来源**：`requirements.md` §4.1 + Q53 决策

**技术实现**：

`apps/web/agent/chatbot.ts`：
```ts
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';

const workflow = new StateGraph(MessagesAnnotation)
  .addNode('chatbot', chatbotNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'chatbot')
  .addConditionalEdges('chatbot', shouldContinue, { tools: 'tools', [END]: END })
  .addEdge('tools', 'chatbot');

export const graph = workflow;
```

`langgraph.json`：
```json
{
  "graphs": {
    "zimage_chat": "./apps/web/agent/chatbot.ts:graph"
  },
  "env": "./apps/web/.env"
}
```

开发命令：
```bash
langgraph dev    # 启动 LangGraph Studio
```

**参考代码**：LangGraphPj `app/agent/chatbot.ts` + `chatbotNode` + `shouldContinue`。

**选型依据**：
- 用户 Q53 选"LangGraph Studio"。
- LangGraph 自带开发工具，可视化 graph + tool binding。

**实施步骤**：
1. 装 `langgraph-cli`（含 `langgraph dev`）。
2. 写 `langgraph.json` 注册 graph。
3. CI/CD 不打包 Studio；仅本地 dev。

---

### 2.16 测试栈：vitest + RTL + Playwright

**需求来源**：`requirements.md` §3.4 评估 + Q20 决策

**技术实现**：

`apps/web/vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

`apps/web/playwright.config.ts`：
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'pnpm dev', port: 3000 },
});
```

**参考代码**：LangGraphPj `package.json` 有 `vitest` scripts（但无测试文件——我们补全）。

**选型依据**：
- 用户 Q20 选"vitest + RTL + Playwright"。
- vitest 与 Turborepo 协作顺畅；Playwright 支持 SSE 与跨页面。

**实施步骤**：
1. 装 `vitest` + `@testing-library/react` + `@playwright/test`。
2. 写 `vitest.config.ts` + `playwright.config.ts`。
3. 先补 provider adapter 与 store slices 单测。

---

## 3. 后端栈（后实现）

### 3.1 Node runtime + Next.js Route Handler

**需求来源**：`requirements.md` §4.4 + Q36 决策

**技术实现**：

`apps/web/app/api/chat/route.ts`：
```ts
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';  // 显式声明
export const dynamic = 'force-dynamic';  // 关闭预渲染
export const maxDuration = 60;  // Vercel 60s

export async function POST(req: NextRequest) {
  // ... SSE 逻辑
}
```

**参考代码**：LangGraphPj `app/api/chat/route.ts`（无 runtime 显式声明，使用默认 Node）。

**选型依据**：
- 用户 Q36 选"Node runtime"。
- LangGraph/SDK 不可在 Edge 运行（fs / crypto 子集限制）。

**实施步骤**：
1. 所有 routes 加 `export const runtime = 'nodejs'`。
2. 长任务 routes 加 `export const maxDuration = 60`。

---

### 3.2 Supabase 客户端：@supabase/ssr

**需求来源**：`requirements.md` §4.5 + Q37 决策；修复 LangGraphPj 已知坑

**技术实现**：

`apps/web/libs/supabase/server.ts`：
```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => cookieStore.set(cookies),
      },
    },
  );
}
```

`apps/web/libs/supabase/browser.ts`：
```ts
import { createBrowserClient } from '@supabase/ssr';
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
);
```

**参考代码**：
- LangGraphPj `app/database/supabase.ts` 用 `@supabase/supabase-js`（无 ssr helper）——已知坑。
- Supabase 官方文档推荐 `@supabase/ssr` for Next.js App Router。

**选型依据**：
- 用户 Q37 选"@supabase/ssr 官方 helper"。
- 修复 LangGraphPj 鉴权薄弱 / cookie 处理不严的坑。

**实施步骤**：
1. 装 `@supabase/ssr`（替代 LangGraphPj 风格）。
2. 写 `libs/supabase/{server,browser,middleware}.ts`。
3. 所有 DB 操作走这两个 client。

---

### 3.3 Auth：匿名登录静默

**需求来源**：`requirements.md` §4.6 + Q38 决策

**技术实现**：

`apps/web/src/components/AuthBootstrap.tsx`：
```tsx
'use client';
import { useEffect } from 'react';
import { supabaseBrowser } from '@/libs/supabase/browser';

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!data.session) {
        await supabaseBrowser.auth.signInAnonymously();
      }
    })();
  }, []);
  return <>{children}</>;
}
```

**参考代码**：LangGraphPj `app/contexts/AuthContext.tsx`（有 OAuth + 邮箱登录，但 anon 是 Supabase 原生）。

**选型依据**：
- 用户 Q38 选"首次访问静默 anon 登录"。
- 用户零感知、Phase2 换真登录零迁移。

**实施步骤**：
1. 在 `app/layout.tsx` 包裹 `<AuthBootstrap>`。
2. 验证 RLS 用 anon uid 生效。

---

### 3.4 数据库：Supabase Cloud + 迁移文件

**需求来源**：`requirements.md` §4.3 + 既有 §4.3.1 表定义

**技术实现**：

`supabase/migrations/0001_init.sql`（参考 `requirements.md` §4.3.1）：
```sql
-- topics / generation_batches / generations / sessions / image_safety_audits
-- 完整 SQL 见 requirements.md，此处复用
```

CI 校验：
```yaml
- name: Validate migrations
  run: |
    supabase db diff --schema public > /tmp/diff.sql
    if [ -s /tmp/diff.sql ]; then
      echo "未迁移的 schema 差异：$?"; exit 1
    fi
```

**参考代码**：
- LangGraphPj 没有 migrations 文件（已知坑）。

**选型依据**：
- 修复 LangGraphPj 无迁移的坑（requirements.md §4.6）。
- 迁移命名 `NNNN_description.sql`（升降序 + 同 commit 提交 `.down.sql`）。

**实施步骤**：
1. 写 `supabase/migrations/0001_init.sql`（含 requirements.md §4.3.1 全部表）。
2. 写 `0002_rls.sql`（含 §§4.3.3 完整 RLS）。
3. 写 `0003_checkpointer.sql`（按 `@skroyc/langgraph-supabase-checkpointer` 库要求）。
4. CI 跑 `supabase db diff` 校验。

---

### 3.5 Storage 上传：storage 客户端

**需求来源**：`requirements.md` §4.3.2 + Q41 决策

**技术实现**：

`apps/web/services/storage.service.ts`：
```ts
import { supabaseBrowser } from '@/libs/supabase/browser';

export class StorageService {
  async uploadImage(buffer: ArrayBuffer, userId: string, batchId: string, generationId: string, mimeType: string = 'image/png') {
    const path = `generated/${userId}/${batchId}/${generationId}.${mimeType.split('/')[1]}`;
    const { error } = await supabaseBrowser.storage
      .from('generated-images')
      .upload(path, buffer, { contentType: mimeType, upsert: false });
    if (error) throw error;
    const { data } = supabaseBrowser.storage.from('generated-images').getPublicUrl(path);
    return { url: data.publicUrl, storage_path: path };
  }
}
```

**参考代码**：LangGraphPj `app/services/storage.service.ts`（使用 `@supabase/supabase-js` 风格）。

**选型依据**：
- 用户 Q41 选"直连 Cloud + storage 客户端"。
- 与 LangGraphPj 风格一致；RLS 自动生效。

**实施步骤**：
1. 写 `services/storage.service.ts`。
2. 在 `apps/web/agent/tools/image_generation.ts` 调用上传。
3. 写 §3.5a 的清理 cron job。

---

### 3.5a Storage 生命周期清理

**需求来源**：`requirements.md` §4.3.2 Storage Buckets + §4.9.2 + D10 决策；review-report GAP-15

> requirements 明确规定 `generated-images` 90 天 / `uploads` 30 天保留，但 tech-selection 此前未实现 DB 调度清理任务。本节给出 cron job 实现。

**技术实现**：

`supabase/migrations/0009_storage_lifecycle.sql`：

```sql
-- 启用 pg_cron（Supabase Cloud 内置扩展）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 任务 1：每日清理 90 天前的 generated-images
SELECT cron.schedule(
  'cleanup-generated-images',
  '0 4 * * *',  -- 每日凌晨 4 点 UTC
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'generated-images'
      AND created_at < now() - interval '90 days';
  $$
);

-- 任务 2：每日清理 30 天前的 uploads
SELECT cron.schedule(
  'cleanup-uploads',
  '0 4 * * *',  -- 每日凌晨 4 点 UTC
  $$
    DELETE FROM storage.objects
    WHERE bucket_id = 'uploads'
      AND created_at < now() - interval '30 days';
  $$
);

-- 任务 3：跨 bucket 校验（防御性兜底——DB 行已删但 Storage 残留）
SELECT cron.schedule(
  'orphan-storage-sweep',
  '0 5 * * 0',  -- 每周日凌晨 5 点 UTC
  $$
    -- generated-images 中 path 不在 generations.storage_path 集合内的
    DELETE FROM storage.objects
    WHERE bucket_id = 'generated-images'
      AND name NOT IN (
        SELECT storage_path FROM generations WHERE storage_path IS NOT NULL
      );
  $$
);
```

**手动触发与监控**：

```ts
// apps/web/app/api/admin/cron/run/route.ts（仅运维 token 可访问）
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-cron-token');
  if (token !== process.env.CRON_TOKEN) {
    return new Response('forbidden', { status: 403 });
  }
  const { job } = await req.json();
  await supabase.rpc(`cron_run_${job}`);
  return Response.json({ ok: true, ranAt: new Date().toISOString() });
}
```

`apps/web/monitoring/storage-cleanup.ts`（健康检查）：

```ts
// 每次清理后写 Sentry metric：清理条数 / 失败条数 / 耗时
export async function monitorCleanup(jobName: string, deletedCount: number, errorCount: number, durationMs: number) {
  Sentry.metrics.distribution('storage.cleanup.duration', durationMs, { tags: { job: jobName } });
  Sentry.metrics.distribution('storage.cleanup.deleted', deletedCount, { tags: { job: jobName } });
  if (errorCount > 0) {
    Sentry.captureMessage(`${jobName} had ${errorCount} errors`, { level: 'warning' });
  }
}
```

**Phase1 验收对齐**：

- requirements §4.3.2「`generated-images` 90 天 / `uploads` 30 天（DB 调度清理 + 跨 bucket 校验）」—— 三个 cron job 落地
- D10「历史数据保留：generated-images 90 天 / uploads 30 天；删会话同步删 Storage 对象」—— 主流程删会话（§3.11a）+ 兜底清理（§3.5a）
- requirements §5.2 风险表「迁移文件漂移」无关；本节新增风险「cron 漂移」需 CI 校验迁移文件存在

**实施步骤**：

1. 写 `0009_storage_lifecycle.sql`（含三个 cron 任务）。
2. 写 `app/api/admin/cron/run/route.ts`（手动触发）。
3. 写 `monitoring/storage-cleanup.ts`（Sentry 指标）。
4. CI 校验迁移文件存在（防误删迁移）。
5. 演练：手动跑 cron 验证清理条数。

---

### 3.6 生图执行：lambda 同步入库 + async fire-and-forget

**需求来源**：`requirements.md` §4.1 + Q43 决策

**技术实现**：

`apps/web/app/api/image/route.ts`（lambda）：
```ts
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const body = await req.json();

  // 1. 配额 + 内容安全前置
  await checkQuota(supabase, user.id);
  await contentSafety.preCheck(body.prompt, body.params.imageUrls);

  // 2. 同步事务建 batch + generations
  const { batch, generations } = await supabase.rpc('create_generation_batch', {
    p_user_id: user.id,
    p_provider: body.provider,
    p_model: body.model,
    p_config: { ...body.params, prompt: body.prompt },
    p_num: body.params.num ?? 1,
  });

  // 3. fire-and-forget 派发到 async generate
  process.nextTick(() => {
    generateImages(supabase, batch, generations, body).catch((err) => {
      console.error('async generate failed', err);
      // 失败更新 generation.status='failed'+error_code
    });
  });

  return Response.json({ taskId: batch.id, batchId: batch.id, generations });
}
```

`apps/web/services/async-image.ts`（async executor）：
```ts
async function generateImages(supabase, batch, generations, body) {
  for (const gen of generations) {
    try {
      const buffer = await imageProvider.generate({ ...body.params, prompt: body.prompt });
      const contentSafe = await contentSafety.postCheck(buffer);
      if (!contentSafe) throw new Error('moderation');
      const { url, storage_path } = await storage.uploadImage(buffer, ..., mimeType);
      await supabase.from('generations').update({
        status: 'succeeded', image_url: url, storage_path,
      }).eq('id', gen.id);
    } catch (err) {
      await supabase.from('generations').update({
        status: 'failed',
        error_code: classifyError(err),  // 6 个枚举之一
        error_message: String(err).slice(0, 80),
      }).eq('id', gen.id);
    }
  }
}
```

**参考代码**：
- lobehub-canary `apps/server/src/routers/lambda/image/index.ts`（同步事务 + fire-and-forget）。
- lobehub-canary `apps/server/src/routers/async/image.ts`（实际执行器）。

**选型依据**：
- 用户 Q43 选"lambda 同步入库 + async fire-and-forget"。
- 客户端立即拿到 batchId 不阻塞；后续可换 Supabase Edge Function。

**实施步骤**：
1. 写 `app/api/image/route.ts`（lambda）。
2. 写 `services/async-image.ts`（async executor）。
3. 写 `supabase/migrations/0004_create_generation_batch_rpc.sql`（`create_generation_batch` RPC）。
4. 写 `app/api/image/recreate/route.ts`（三模式重生成，review-report GAP-4）。

**附：重生成三模式路由**（review-report GAP-4）

`apps/web/app/api/image/recreate/route.ts`：

```ts
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/libs/supabase/server';
import { checkAndIncrementQuota } from '@/middleware/quota';

const bodySchema = z.object({
  batchId: z.string().uuid(),
  mode: z.enum(['single', 'failed', 'all']),
  generationId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: { code: 'unauthorized', message: '未授权' } }, { status: 401 });

  const body = bodySchema.parse(await req.json());

  // 1. 取 batch + 关联 topic 验证 owner
  const { data: batch } = await supabase
    .from('generation_batches')
    .select('*, topics!inner(user_id)')
    .eq('id', body.batchId)
    .eq('topics.user_id', user.id)
    .single();
  if (!batch) return NextResponse.json({ error: { code: 'bad_request', message: 'batch 不存在或无权访问' } }, { status: 400 });

  // 2. 按 mode 选出要重生成的 generations
  const targets = await pickTargets(supabase, batch, body.mode, body.generationId);
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, regenerated: 0 });
  }

  // 3. 配额扣减（只算要重生成的张数）
  try {
    await checkAndIncrementQuota(supabase, user.id, targets.length);
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      return NextResponse.json({ error: { code: 'quota_exceeded', message: err.message } }, { status: 429 });
    }
    throw err;
  }

  // 4. 复用原 config（requirements §3.1.1 + US5 AC）
  for (const gen of targets) {
    await supabase.from('generations').update({ status: 'processing', error_code: null, error_message: null }).eq('id', gen.id);
    process.nextTick(() => regenerateOne(supabase, batch, gen, user.id));
  }

  return NextResponse.json({ ok: true, regenerated: targets.length, batchId: batch.id, taskId: batch.id });
}

async function pickTargets(supabase, batch, mode, generationId) {
  if (mode === 'single') {
    if (!generationId) throw new Error('single mode 必传 generationId');
    const { data } = await supabase
      .from('generations')
      .select('*')
      .eq('id', generationId)
      .eq('batch_id', batch.id)
      .single();
    return data ? [data] : [];
  }
  if (mode === 'failed') {
    const { data } = await supabase
      .from('generations')
      .select('*')
      .eq('batch_id', batch.id)
      .eq('status', 'failed');
    return data ?? [];
  }
  // mode === 'all'
  const { data } = await supabase
    .from('generations')
    .select('*')
    .eq('batch_id', batch.id);
  return data ?? [];
}

async function regenerateOne(supabase, batch, gen, userId) {
  try {
    const config = batch.config;  // 复用原 config jsonb
    const params = { ...config, prompt: config.prompt };
    const buffer = await imageProvider.generate(params);
    const contentSafe = await contentSafety.postCheck(buffer);
    if (!contentSafe) throw new Error('moderation');
    const { url, storage_path } = await storage.uploadImage(buffer, userId, batch.id, gen.id, 'image/png');
    await supabase.from('generations').update({
      status: 'succeeded', image_url: url, storage_path,
    }).eq('id', gen.id);
  } catch (err) {
    await supabase.from('generations').update({
      status: 'failed',
      error_code: classifyError(err),
      error_message: String(err).slice(0, 80),
    }).eq('id', gen.id);
  }
}
```

**三模式语义对照表**：

| mode | 必传 generationId | 选中规则 | 参数复用 |
|---|---|---|---|
| `single` | 是 | 仅替换该 generation；其他成功项保留 | 原 batch.config |
| `failed` | 否 | SELECT batch 内 `status='failed'` 的所有项 | 原 batch.config |
| `all` | 否 | SELECT batch 内全部 generations | 原 batch.config |

---

### 3.7 生图 provider：Seedream + Gemini

**需求来源**：`requirements.md` §3.1.2（既有 Seedream+Gemini 双 provider）+ §2.2 US2（10MB/MIME 校验，review-report GAP-1）

**技术实现**：

`packages/image-providers/src/types.ts`：
```ts
export interface ImageProvider {
  name: 'seedream' | 'gemini';
  defaultModel: string;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  maxReferenceImages: number;
  schemaPath: string;
  generate(params: ImageGenerationParams): Promise<ImageResult[]>;
}
```

`packages/image-providers/src/seedream.ts`：
```ts
import { ImageProvider, ImageGenerationParams, ImageResult } from './types';

export const seedream: ImageProvider = {
  name: 'seedream',
  defaultModel: 'doubao-seedream-3-0',
  supportedAspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
  supportedResolutions: ['1K', '2K'],
  maxReferenceImages: 4,
  schemaPath: './parameters/seedream/3.0.schema.json',
  async generate(params: ImageGenerationParams): Promise<ImageResult[]> {
    // 上游校验：参考图 MIME 与大小（review-report GAP-1）
    validateReferenceImages(params.imageUrls);

    const res = await fetch(`${process.env.ARK_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model: params.model ?? this.defaultModel,
        prompt: params.prompt,
        image: params.imageUrls,
        size: ratioToSize(params.aspectRatio ?? '1:1'),
        n: params.num ?? 1,
        ...params.providerSpecificParams,  // 透传 seed / watermark
      }),
    });
    if (!res.ok) throw mapError(res);  // 错误码 6 枚举
    const data = await res.json();
    return data.data.map((d) => ({ url: d.url, storagePath: '', width: 0, height: 0 }));
  },
};
```

> **命名统一说明**（review-report C-1 已锁定为 `ARK_*`）：Seedream 是火山方舟平台上的图像生成模型，env 命名沿用平台官方术语 `ARK_API_KEY` / `ARK_BASE_URL`（而非「豆包 Doubao」品牌名）。与 requirements.md §4.5 集成点表格对齐。

`packages/image-providers/src/gemini.ts`：用 `@google/genai` SDK，model=`gemini-3-pro-image-preview`，`responseModalities=['IMAGE']`；同样在 `generate()` 入口调 `validateReferenceImages()`。

`packages/image-providers/src/validate.ts`（新增，review-report GAP-1）：

```ts
import { z } from 'zod';

export const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  // 10 MB

const referenceImageSchema = z.object({
  url: z.string().url(),
  mimeType: z.enum(ALLOWED_MIME),
  sizeBytes: z.number().int().positive(),
});

// 上游校验失败抛 bad_request（review-report GAP-1 + GAP-13）
export class ReferenceImageValidationError extends Error {
  constructor(public reason: string) {
    super(`bad_request: ${reason}`);
  }
}

export async function validateReferenceImages(imageUrls?: string[]) {
  if (!imageUrls || imageUrls.length === 0) return;
  if (imageUrls.length > 4) {
    throw new ReferenceImageValidationError('参考图最多 4 张（当前 ' + imageUrls.length + ' 张）');
  }
  // HEAD 请求获取 Content-Type 与 Content-Length
  await Promise.all(imageUrls.map(async (url) => {
    const res = await fetch(url, { method: 'HEAD' });
    const mime = res.headers.get('content-type') ?? '';
    const len = parseInt(res.headers.get('content-length') ?? '0', 10);
    const parsed = referenceImageSchema.safeParse({ url, mimeType: mime, sizeBytes: len });
    if (!parsed.success) {
      throw new ReferenceImageValidationError(parsed.error.issues[0].message);
    }
    if (len > MAX_IMAGE_BYTES) {
      throw new ReferenceImageValidationError(`单文件 ${(len / 1024 / 1024).toFixed(1)}MB 超过 10 MB 上限`);
    }
  }));
}
```

`apps/web/middleware/error-handler.ts`：把 `ReferenceImageValidationError` 映射为 `bad_request` HTTP 400。

**参考代码**：
- LangGraphPj `app/agent/tools/google-image-generation.tool.ts`（Gemini 实现）。
- lobehub-canary `packages/builtin-tool-image-generation/`（多 provider 模式）。

**选型依据**：
- requirements.md 决策 D + 双 provider 验收。
- 抽象层封装差异，UI 侧无需感知。
- GAP-1：上游校验在 adapter 入口统一拦截，前后端双重保护（zod schema 在 §2.11 同步落地）。

**实施步骤**：
1. 写 `packages/image-providers/src/{types,seedream,gemini,index}.ts`。
2. 写 `packages/image-providers/src/validate.ts` + `ReferenceImageValidationError`。
3. 写单测覆盖参数映射 + MIME/大小边界（PNG 9.9MB 通过 / 10.1MB 拒绝 / webp 通过 / svg 拒绝）。
4. 在 `services/async-image.ts` 调用 `imageProvider.generate(...)`，由 adapter 内部校验。
5. 前端 §2.11 formSchema 同步加 `imageUrls: z.array(z.string()).max(4)` 与上传时 size/MIME 检查。

---

### 3.7a SKILL.md 加载器与模板填充

**需求来源**：`requirements.md` §3.2 Skills 机制 + D5 决策；review-report GAP-2（阻塞 US3 验收）

> §3.7 实现了 ImageProvider，但 SKILL.md 的加载、frontmatter 解析、占位符填充机制未明示。本节补齐。

**技术实现**：

`packages/skills/src/types.ts`：

```ts
export interface SkillFrontmatter {
  name: string;                  // e.g. 'white-bg'
  title: string;                 // e.g. '白底图'
  description: string;
  version: string;
  whenToUse: string;
  triggers: {
    tools: string[];             // 自动启用的工具 ID 列表
    providerHints: string[];     // 推荐 provider 列表
  };
  params: string[];              // 必填字段名（用于 UI 标红）
}

export interface Skill {
  meta: SkillFrontmatter;
  promptTemplate: string;        // SKILL.md 正文（去 frontmatter），含 {prompt}/{imageUrls} 占位符
  source: 'builtin' | 'user' | 'market';  // Phase1 仅 builtin
}

export interface SkillRenderInput {
  prompt: string;
  imageUrls?: string[];
  // 后续可扩展：aspectRatio / resolution / skill 必填字段值
}

export interface SkillRenderOutput {
  systemPrompt: string;          // 完整系统提示词（含 base + skill）
  effectiveProvider: string;     // 来自 providerHints[0]，缺省 seedream
  enabledTools: string[];        // 来自 triggers.tools
  requiredFields: string[];      // 来自 params，用于 UI 标红
}
```

`packages/skills/src/loader.ts`：

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import type { Skill, SkillFrontmatter } from './types';

const SKILLS_DIR = join(process.cwd(), 'packages/skills/skills');

export function loadBuiltinSkills(): Skill[] {
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return dirs.map(loadSkill);
}

export function loadSkill(name: string): Skill {
  const path = join(SKILLS_DIR, name, 'SKILL.md');
  const raw = readFileSync(path, 'utf-8');
  return parseSkill(raw);
}

export function parseSkill(raw: string): Skill {
  const match = raw.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid SKILL.md: missing frontmatter');
  const [, fmRaw, body] = match;
  const meta = yaml.parse(fmRaw) as SkillFrontmatter;
  // 校验必填字段
  for (const k of ['name', 'title', 'description', 'version', 'whenToUse']) {
    if (!meta[k]) throw new Error(`Invalid SKILL.md: missing field '${k}'`);
  }
  return { meta, promptTemplate: body.trim(), source: 'builtin' };
}
```

`packages/skills/src/render.ts`：

```ts
import type { Skill, SkillRenderInput, SkillRenderOutput } from './types';

export function renderSkillPrompt(skill: Skill, input: SkillRenderInput): SkillRenderOutput {
  // 1. 占位符替换：{prompt} / {imageUrls} / 其他自定义字段
  const rendered = skill.promptTemplate
    .replace(/\{prompt\}/g, input.prompt)
    .replace(/\{imageUrls\}/g, JSON.stringify(input.imageUrls ?? []));
  // 2. 拼系统消息（base + skill prompt + tool usage prompt）
  const systemPrompt = [
    '[base system prompt]',
    rendered,
    skill.triggers.tools.length > 0
      ? `[tool usage] 已启用工具：${skill.triggers.tools.join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');
  return {
    systemPrompt,
    effectiveProvider: skill.triggers.providerHints[0] ?? 'seedream',
    enabledTools: skill.triggers.tools,
    requiredFields: skill.params,
  };
}

export function getMissingFields(skill: Skill, input: SkillRenderInput): string[] {
  return skill.params.filter((field) => {
    if (field === 'prompt') return !input.prompt;
    if (field === 'imageUrls') return !input.imageUrls?.length;
    return !(input as any)[field];
  });
}
```

**目录结构**：

```
packages/skills/
├── src/
│   ├── types.ts
│   ├── loader.ts
│   ├── render.ts
│   └── index.ts
└── skills/
    ├── white-bg/SKILL.md
    ├── model-image/SKILL.md
    └── scene/SKILL.md
```

**示例 SKILL.md**（`packages/skills/skills/white-bg/SKILL.md`）：

```markdown
---
name: white-bg
title: 白底图
description: 将服饰图处理为纯白背景的电商标准图
version: 1.0.0
whenToUse: 用户希望处理服饰为白底图时
triggers:
  tools: [image_generation]
  providerHints: [seedream]
params:
  - imageUrls
---

你是一个电商服饰图处理助手。请将以下图片处理为纯白背景（RGB #FFFFFF）的电商标准白底图。

商品描述：{prompt}

参考图：{imageUrls}

要求：
1. 背景必须为纯白（无渐变、无阴影、无杂物）
2. 商品居中，保留原始细节
3. 比例与原图一致
4. 避免出现人物、模特
```

**集成点**：

- `app/api/skills/route.ts`：GET 返回 `Skill[]`（meta 已解析，promptTemplate 由前端按需渲染）
- `app/api/chat/route.ts`：body 含 `skillId` 时调 `loadSkill(skillId)` + `renderSkillPrompt()` 拼系统消息
- `services/async-image.ts`：`skillId` 存在时记录到 `generation_batches.config.skillId` 并写入 `provider`（来自 effectiveProvider）
- `<SkillSelector>` 选中技能时调 `getMissingFields()` 标记必填字段为红色

**Phase1 验收对齐**：

- US3 AC「选中技能后系统提示词被替换为该技能的 SKILL.md 内容」—— `renderSkillPrompt` 落地
- US3 AC「必填字段缺失表单字段标红」—— `getMissingFields` 落地
- US3 AC「提示词预览直接显示 SKILL.md 模板填充结果」—— 前端在 `useSkillPrompt` hook 中调 `renderSkillPrompt`，预览渲染

**实施步骤**：

1. 写 `packages/skills/src/{types,loader,render,index}.ts` + 3 个内置 SKILL.md 文件。
2. 单测覆盖 frontmatter 解析、占位符替换、缺失字段检测。
3. 在 `app/api/skills/route.ts` 暴露列表。
4. 在 `app/api/chat/route.ts` + `services/async-image.ts` 接入渲染。
5. 前端 `<SkillSelector>` + `<GenerationForm>` 接入必填标红 + 预览。

---

### 3.7b 配额计数表 + 中间件

**需求来源**：`requirements.md` §1.3 指标 4 + §4.6 配额；review-report GAP-6

> §4.4 仅占位「quotas 表 + 中间件」，本节给出具体 schema + 中间件实现，明确 30 张/日 配额与 HTTP 429 返回。

**技术实现**：

`supabase/migrations/0006_quotas.sql`：

```sql
CREATE TABLE quotas (
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  quota_date   date NOT NULL,                        -- UTC 日
  used_count   int  NOT NULL DEFAULT 0,
  last_reset_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quota_date)
);
CREATE INDEX quotas_user_idx ON quotas (user_id, quota_date DESC);
```

`apps/web/middleware/quota.ts`：

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

const DAILY_LIMIT = 30;  // requirements §1.3 指标 4
const TZ = 'UTC';

export class QuotaExceededError extends Error {
  constructor(public usedCount: number, public limit: number) {
    super(`quota_exceeded: ${usedCount}/${limit}`);
  }
}

export async function checkAndIncrementQuota(
  supabase: SupabaseClient,
  userId: string,
  count: number = 1,
): Promise<{ used: number; limit: number; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD UTC

  // 1. 用 RPC 保证原子性（避免并发越界）
  const { data, error } = await supabase.rpc('increment_quota', {
    p_user_id: userId,
    p_quota_date: today,
    p_increment: count,
    p_limit: DAILY_LIMIT,
  });

  if (error) throw error;
  if (data.status === 'exceeded') throw new QuotaExceededError(data.used, DAILY_LIMIT);
  return { used: data.used, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - data.used };
}
```

`supabase/migrations/0007_increment_quota_rpc.sql`：

```sql
CREATE OR REPLACE FUNCTION increment_quota(
  p_user_id uuid,
  p_quota_date date,
  p_increment int,
  p_limit int
) RETURNS TABLE(used int, status text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_used int;
BEGIN
  -- UPSERT 并加锁
  INSERT INTO quotas (user_id, quota_date, used_count)
  VALUES (p_user_id, p_quota_date, 0)
  ON CONFLICT (user_id, quota_date) DO NOTHING;

  SELECT used_count INTO v_used
  FROM quotas
  WHERE user_id = p_user_id AND quota_date = p_quota_date
  FOR UPDATE;

  IF v_used + p_increment > p_limit THEN
    RETURN QUERY SELECT v_used, 'exceeded'::text;
    RETURN;
  END IF;

  UPDATE quotas
  SET used_count = used_count + p_increment, last_reset_at = now()
  WHERE user_id = p_user_id AND quota_date = p_quota_date;

  RETURN QUERY SELECT v_used + p_increment, 'ok'::text;
END;
$$;
```

**集成点**：

`apps/web/app/api/image/route.ts`：

```ts
try {
  await checkAndIncrementQuota(supabase, user.id, body.params.num ?? 1);
} catch (err) {
  if (err instanceof QuotaExceededError) {
    return Response.json(
      { error: { code: 'quota_exceeded', message: `今日配额已用完（${err.usedCount}/${err.limit}）` } },
      { status: 429, headers: { 'Retry-After': '86400' } },
    );
  }
  throw err;
}
```

`apps/web/app/api/chat/route.ts`：

```ts
// 在工具调用 image_generation 之前同样校验
if (toolName === 'image_generation') {
  await checkAndIncrementQuota(supabase, user.id, 1);
}
```

`apps/web/app/api/quotas/route.ts`（GET）：

```ts
// 返回 { used, limit, remaining, resetAt } 用于前端配额卡片实时显示
```

**Phase1 验收对齐**：

- Success Criteria 指标 4「匿名账户每日配额内可完成出图数 ≥ 20 张 / 30 张配额」—— `DAILY_LIMIT = 30` 落地
- requirements §4.6「越界返回 quota_exceeded HTTP 429」—— `Response.json(..., { status: 429 })` 落地
- 模拟 24h 跑测：自动化脚本模拟 anon uid 在 24h 内调 `/api/image` 31 次，第 31 次应返回 429

**实施步骤**：

1. 写 `supabase/migrations/0006_quotas.sql` + `0007_increment_quota_rpc.sql`。
2. 写 `apps/web/middleware/quota.ts` + 错误类型。
3. 在 `/api/image`、`/api/chat` 的 image_generation 工具路径接入。
4. 写 `/api/quotas` GET endpoint 供前端配额卡片。
5. 自动化脚本 `scripts/quota-e2e.ts` 跑 24h 模拟。

---

### 3.8 per-model parametersSchema：JSON Schema

**需求来源**：`requirements.md` §3.1.2 + Q44 决策 + Q-C2（review-report §0）

**技术实现**：

`packages/shared/parameters/seedream/3.0.schema.json`：
```json
{
  "name": "seedream-3.0",
  "displayName": "Seedream 3.0（火山方舟）",
  "provider": "seedream",
  "supportedParams": {
    "aspectRatio": { "type": "enum", "enum": ["1:1", "3:4", "4:3", "9:16", "16:9"], "default": "1:1" },
    "resolution": { "type": "enum", "enum": ["1K", "2K"], "default": "2K" },
    "num": { "type": "int", "min": 1, "max": 4, "default": 1 },
    "imageUrls": { "type": "string[]", "maxItems": 4 },
    "seed": { "type": "int", "optional": true },
    "watermark": { "type": "boolean", "optional": true }
  }
}
```

`packages/shared/parameters/gemini/pro-preview.schema.json`：类似。

前端 `isSupportedParam`：
```ts
import seedreamSchema from '@zimage/shared/parameters/seedream/3.0.schema.json';

export function isSupportedParam(provider: string, model: string, param: string) {
  const schema = loadSchema(provider, model);
  return param in schema.supportedParams;
}
```

**选型依据**：
- 用户 Q44 选"JSON Schema"。
- 与 OpenAPI 兼容；后续可生成 OpenAPI 文档。

**实施步骤**：
1. 写两个 schema 文件。
2. 前端 `isSupportedParam` + 后端 zod-to-openapi 校验。
3. CI 校验 schema 与 provider SDK 字段一致。

---

### 3.9 聊天 LLM 抽象：ChatProvider 接口

**需求来源**：`requirements.md` §4.5 + Q16-Q17 决策

**技术实现**：

`packages/chat-providers/src/types.ts`：
```ts
export interface ChatProvider {
  name: 'doubao' | 'minimax';
  defaultModel: string;
  createModel(): BaseChatModel;
}
```

`packages/chat-providers/src/doubao.ts`（字节火山，用 OpenAI 兼容）：
```ts
import { ChatOpenAI } from '@langchain/openai';
export const doubao: ChatProvider = {
  name: 'doubao',
  defaultModel: process.env.DOUBAO_MODEL ?? 'doubao-pro',
  createModel() {
    return new ChatOpenAI({
      apiKey: process.env.ARK_API_KEY!,         // review-report C-1 锁定：共用 ARK_* env
      baseURL: process.env.ARK_BASE_URL!,      // review-report C-1 锁定：共用 ARK_* env
      model: this.defaultModel,
    });
  },
};
```

> **说明**：review-report C-1 已锁定 Seedream 与 Doubao chat 共享 `ARK_API_KEY` / `ARK_BASE_URL` env（同为火山方舟平台）。Seedream 与 Doubao 是同一平台的两个模型产品线，env 命名统一以平台为单位。

`packages/chat-providers/src/minimax.ts`（MiniMax，用 Anthropic 兼容）：
```ts
import { ChatAnthropic } from '@langchain/anthropic';
export const minimax: ChatProvider = {
  name: 'minimax',
  defaultModel: process.env.MINIMAX_MODEL ?? 'MiniMax-...',  // 接入时确认
  createModel() {
    return new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      baseURL: process.env.ANTHROPIC_BASE_URL!,  // https://api.minimaxi.com/anthropic
      model: this.defaultModel,
    });
  },
};
```

**参考代码**：
- LangGraphPj `app/utils/models.ts`（google/openai 双 provider）。
- lobehub-canary `packages/business-model-runtime/`（多 provider 抽象）。

**选型依据**：
- 用户 Q16-Q17 选"字节火山 + MiniMax 双 provider"。
- 抽象层封装 SDK 差异，UI 与 LangGraph agent 只需关心 `provider` 字段。

**实施步骤**：
1. 装 `@langchain/openai` + `@langchain/anthropic`。
2. 写两个 adapter + index。
3. 在 LangGraph agent 中按 provider 切换。

---

### 3.10 LangGraph agent：每请求 compile

**需求来源**：`requirements.md` §4.1 + Q10 决策

**技术实现**：

`apps/web/agent/chatbot.ts`：
```ts
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { SupabaseSaver } from '@skroyc/langgraph-supabase-checkpointer';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createChatModel } from '@zimage/chat-providers';
import { createLangChainTools } from './tools';
import { createServerSupabase } from '@/libs/supabase/server';

export async function buildChatGraph(opts: { provider: string; toolIds: string[]; userId: string }) {
  const supabase = await createServerSupabase();
  const model = createChatModel(opts.provider).createModel();
  const tools = await createLangChainTools(opts.toolIds);
  const modelWithTools = tools.length > 0 ? model.bindTools(tools) : model;
  const checkpointer = new SupabaseSaver(supabase, undefined, opts.userId);

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('chatbot', (state) => /* 拼系统提示 + modelWithTools.invoke */)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'chatbot')
    .addConditionalEdges('chatbot', shouldContinue, { tools: 'tools', [END]: END })
    .addEdge('tools', 'chatbot');

  return workflow.compile({ checkpointer });
}
```

**参考代码**：
- LangGraphPj `app/agent/chatbot.ts`（StateGraph + SupabaseSaver + module-level cache）。
- 我们**不**沿用 module-level 缓存（每请求 compile，避免 Vercel 串数据）。

**选型依据**：
- 修复 LangGraphPj `workflowCache`/`appCache` 单例在 Vercel serverless 多实例下串数据的坑。
- 每请求 + 50ms 延迟可接受。

**实施步骤**：
1. 写 `agent/chatbot.ts`（每请求构建）。
2. 写 `agent/tools/index.ts`（统一注册表）。
3. 写 `agent/chatbotNode.ts`（拼系统提示词）。

---

### 3.11 工具注册表：四类

**需求来源**：`requirements.md` §4.1 + D2 决策

**技术实现**：

`apps/web/agent/config/unified-tools.config.ts`：
```ts
export const unifiedToolsConfig = {
  custom: [
    { name: 'image_generation', factory: () => import('./tools/image-generation') },
  ],
  langchain: [
    { name: 'web_search', factory: () => import('@langchain/community/tools/websearch') },
  ],
  mcp: [
    // Phase2: 接入 MCP server
  ],
  canvas: [
    // Phase2: Canvas 工具
  ],
};
```

`apps/web/agent/tools/image-generation.ts`：
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const schema = z.object({
  prompt: z.string(),
  provider: z.enum(['seedream', 'gemini']).optional(),
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
  resolution: z.enum(['1K', '2K']).optional(),
  imageUrls: z.array(z.string().url()).max(4).optional(),
  num: z.number().int().min(1).max(4).optional(),
  providerSpecificParams: z.record(z.unknown()).optional(),
});

export const imageGenerationTool = tool(
  async (params) => { /* 调 ImageProvider → Storage → 返 ImageCard 标签 */ },
  { name: 'image_generation', description: '...', schema },
);
```

**参考代码**：LangGraphPj `app/agent/config/unified-tools.config.ts`（已有四类模式）。

**选型依据**：
- 复用 LangGraphPj 模式，避免自定义。
- 选择性 `bindTools(toolIds)` —— US6 触发机制。

**实施步骤**：
1. 写 `config/unified-tools.config.ts`。
2. 写 `tools/image-generation.ts`（Zod schema）。
3. `createLangChainTools(toolIds)` 按需加载。

---

### 3.11a DELETE session 同步清理

**需求来源**：`requirements.md` §4.4.1 DELETE session + §4.3.1 US6 + D3 决策；review-report GAP-5（阻塞 US6 AC）

> 删会话时需同步清理 LangGraph checkpointer 记录（`thread_id = sessions.id`）与 `generated-images`/`uploads` 中对应对象。失败告警但不阻塞主流程。

**技术实现**：

`apps/web/app/api/chat/sessions/[id]/route.ts`（DELETE）：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/libs/supabase/server';
import { logger } from '@/libs/logger';
import * as Sentry from '@sentry/nextjs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthorized', message: '未授权' } }, { status: 401 });
  }

  const errors: Array<{ stage: string; error: string }> = [];

  // 阶段 1：删 LangGraph checkpointer 记录（thread_id = sessionId）
  try {
    const { error } = await supabase
      .from('checkpoints')  // @skroyc/langgraph-supabase-checkpointer 默认表
      .delete()
      .eq('thread_id', sessionId)
      .eq('user_id', user.id);
    if (error) throw error;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ stage: 'checkpointer', error: msg });
    logger.warn({ sessionId, userId: user.id, err: msg }, 'checkpointer delete failed');
    Sentry.captureException(err, { tags: { stage: 'checkpointer-delete' } });
  }

  // 阶段 2：删关联 generations 涉及的 Storage 对象（按 batches.id 关联）
  try {
    const { data: generations } = await supabase
      .from('generations')
      .select('storage_path, batch_id, generation_batches!inner(topic_id, topics!inner(user_id))')
      .eq('generation_batches.topics.user_id', user.id)
      .not('storage_path', 'is', null);
    if (generations && generations.length > 0) {
      const paths = generations.map((g) => g.storage_path!).filter(Boolean);
      if (paths.length > 0) {
        const { error } = await supabase.storage.from('generated-images').remove(paths);
        if (error) throw error;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ stage: 'storage-generated', error: msg });
    logger.warn({ sessionId, err: msg }, 'storage generated-images delete failed');
    Sentry.captureException(err, { tags: { stage: 'storage-delete' } });
  }

  // 阶段 3：删 DB session（关键记录，最后删）
  const { error: dbError } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', user.id);
  if (dbError) {
    return NextResponse.json(
      { error: { code: 'provider_error', message: 'DB delete failed: ' + dbError.message } },
      { status: 502 },
    );
  }

  // 阶段 4：返回（errors 数组让前端展示警告但不视为失败）
  return NextResponse.json({
    ok: true,
    sessionId,
    warnings: errors,
  });
}
```

**前端集成**：

`apps/web/src/features/Chat/ChatSessionList.tsx`：

```tsx
async function handleDeleteSession(id: string) {
  const confirmed = await Modal.confirm({ title: '确认删除会话？相关生成图与历史将一并清理' });
  if (!confirmed) return;
  const res = await openapi.DELETE('/api/chat/sessions/{id}', { params: { path: { id } } });
  if (res.data?.warnings?.length > 0) {
    message.warning('部分资源清理失败，已上报');
  }
  // 触发 SWR 缓存刷新
  mutate('/api/chat/sessions');
}
```

**孤儿数据兜底**：

```ts
// supabase/migrations/0008_orphan_cleanup.sql
-- 每日 cron job：清 90 天前 generated-images 表记录对应的 Storage 对象（防御性兜底）
SELECT cron.schedule('orphan-storage-cleanup', '0 3 * * *', $$
  DELETE FROM storage.objects
  WHERE bucket_id = 'generated-images'
    AND created_at < now() - interval '90 days';
$$);
```

**Phase1 验收对齐**：

- US6 AC「删除会话时同步清理 LangGraph checkpointer 记录与 Storage 对象（清理失败告警但不阻塞主流程）」—— DELETE handler 落地
- requirements §5.2 风险表「checkpointer 删 thread 失败」—— 主流程 warn + Sentry + cron 兜底

**实施步骤**：

1. 写 `apps/web/app/api/chat/sessions/[id]/route.ts`（DELETE）。
2. 写 `0008_orphan_cleanup.sql` cron job。
3. 前端 `<ChatSessionList>` 接入 Modal 二次确认 + 警告提示。
4. e2e 测试：创建会话 + 3 张生成图 → DELETE → 验证 checkpointer + Storage + DB 全部清理。

---

### 3.12 内容安全：Phase1 国内合规必接

**需求来源**：`requirements.md` §4.6 + Q11 决策

**技术实现**：

`apps/web/middleware/content-safety.ts`：
```ts
export class ContentSafety {
  async preCheck(prompt: string, imageUrls?: string[]): Promise<{ verdict: 'pass' | 'block' | 'review'; reasons: string[] }> {
    const res = await fetch(process.env.CONTENT_SAFETY_ENDPOINT + '/text-check', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CONTENT_SAFETY_API_KEY}` },
      body: JSON.stringify({ text: prompt }),
    });
    return (await res.json()).verdict ?? 'review';
  }
  async postCheck(imageBuffer: ArrayBuffer): Promise<boolean> {
    const res = await fetch(process.env.CONTENT_SAFETY_ENDPOINT + '/image-check', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.CONTENT_SAFETY_API_KEY}` },
      body: imageBuffer,
    });
    const { verdict } = await res.json();
    return verdict === 'pass';
  }
}
```

**参考代码**：无参考项目；自实现。

**选型依据**：
- 用户 Q11 选"Phase1 国内合规必接"。
- 数美 / 火山 / 阿里云绿网 任选其一（接入时确认）。

**实施步骤**：
1. 写 `middleware/content-safety.ts`。
2. 在 `services/async-image.ts` 与 `api/chat/route.ts` 调用。
3. 失败返回 `moderate_rejected` 错误码。

---

### 3.13 监控告警渠道：Phase2

**需求来源**：`requirements.md` §4.9.1 + Q27 决策

**状态**：用户选"Phase2"，本文只占位，不实现。

**实施步骤**：（Phase2）接入 Lark / 钉钉 / PagerDuty webhooks。

---

### 3.13a Provider 健康检查机制

**需求来源**：`requirements.md` §1.3 指标 7 + §4.9.1 + §3.4 评估；review-report GAP-7（阻塞 Success Criteria 指标 7 验收）

> §3.13 仅覆盖**告警渠道**，本节补充**健康检查机制本身**（5 分钟滚动窗口、错误率 > 50% 触发降级）。告警渠道的发送仍 Phase2 推迟；Phase1 阶段把告警写到本地日志 + Sentry，等 Phase2 再外发到 Lark/钉钉/PagerDuty。

**技术实现**：

`apps/web/monitoring/provider-health.ts`：

```ts
// 5 分钟滚动窗口，按 provider 分桶统计
interface ProviderHealthBucket {
  provider: 'seedream' | 'gemini';
  totalCalls: number;
  errorCalls: number;
  windowStart: number;  // Date.now() 5 分钟对齐
}

const buckets = new Map<string, ProviderHealthBucket>();

export function recordProviderCall(provider: string, isError: boolean) {
  const now = Date.now();
  const windowStart = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000);
  const key = `${provider}:${windowStart}`;
  const b = buckets.get(key) ?? { provider: provider as any, totalCalls: 0, errorCalls: 0, windowStart };
  b.totalCalls++;
  if (isError) b.errorCalls++;
  buckets.set(key, b);
  // 清理过期桶（保留 1 个完整窗口）
  for (const [k, v] of buckets) {
    if (v.windowStart < now - 5 * 60 * 1000) buckets.delete(k);
  }
}

export function isProviderHealthy(provider: string): boolean {
  const now = Date.now();
  const windowStart = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000);
  const b = buckets.get(`${provider}:${windowStart}`);
  if (!b || b.totalCalls < 10) return true;  // 样本不足默认健康（避免冷启动误判）
  return b.errorCalls / b.totalCalls <= 0.5;
}

export function getUnhealthyProviders(): string[] {
  return ['seedream', 'gemini'].filter((p) => !isProviderHealthy(p));
}
```

集成点：

```ts
// 在 services/async-image.ts 中
try {
  const buffer = await imageProvider.generate({ ... });
  recordProviderCall(params.provider ?? 'seedream', false);
  // ...
} catch (err) {
  recordProviderCall(params.provider ?? 'seedream', true);
  // ...
}

// 在 app/api/chat/route.ts 调 LLM 时同样调用
```

**API 暴露**：

`GET /api/health/providers` → `{ providers: Array<{ name: string, healthy: boolean, errorRate: number, sampleSize: number }> }`

前端 `<ModelSwitchPanel>` 在组件挂载时请求此 endpoint，命中 unhealthy provider 时：
- 列表项显示禁用态 + tooltip「近 5 分钟错误率 XX%，限上不可用」
- 当前选中 provider 若变为 unhealthy，UI 顶部 toast「Gemini 不可用，已自动切换 Seedream」
- 同步走 §3.11 agent 路径：chatbotNode 接 `unhealthy_providers` 后跳过该 provider

**告警写日志 + Sentry**：

```ts
// apps/web/monitoring/alert-writer.ts
export function emitHealthAlert(provider: string, errorRate: number, sampleSize: number) {
  logger.warn({ provider, errorRate, sampleSize, source: 'provider-health' }, 'provider unhealthy');
  Sentry.captureMessage(`provider unhealthy: ${provider}`, {
    level: 'warning',
    extra: { errorRate, sampleSize },
  });
}
```

**验收对齐**：

| Success Criteria 指标 7 | 测量方法 | 落地 |
|---|---|---|
| 误报 < 5% | 模拟 5 分钟内 49% 错误率应**不**触发 | `errorRate <= 0.5` 阈值 |
| 漏报 < 1% | 模拟 5 分钟内 51% 错误率应触发 | 阈值边界人工测试 |
| 5 分钟滚动窗口 | 每次统计对齐 5 分钟边界 | `Math.floor(now / 5min) * 5min` |

**Phase1 验收口径**：

- 机制本身（§3.13a）必须 Phase1 上线前实现并接入调用路径
- 告警渠道（外发 Lark/钉钉/PagerDuty）维持 §3.13 现状 Phase2 推迟
- Phase1 验收包含「Provider 健康检查告警准确率：误报 < 5% / 漏报 < 1%」（requirements §1.3 指标 7）

**实施步骤**：

1. 写 `monitoring/provider-health.ts` + `monitoring/alert-writer.ts`。
2. 在 `services/async-image.ts` + `agent/chatbotNode.ts` 调用 `recordProviderCall()`。
3. 写 `app/api/health/providers/route.ts`。
4. 前端 `<ModelSwitchPanel>` 与聊天顶部 toast 接入。
5. CI 单测覆盖 4 个边界：样本不足 / 错误率 = 50% / 错误率 > 50% / 跨窗口清理。

---

### 3.14 日志：pino + 本地

**需求来源**：`requirements.md` §4.6 + Q30 决策

**技术实现**：

`apps/web/libs/logger.ts`：
```ts
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.prompt', '*.apiKey'],
});
```

**选型依据**：
- 用户 Q30 选"pino + 本地"。
- 结构化 JSON，Vercel/PM2 默认展示。

**实施步骤**：
1. 装 `pino`。
2. 写 `libs/logger.ts`，各 service / route 用 `logger.info({...})`。
3. 错误日志脱敏（requirements.md §4.6）。

---

### 3.15 API 契约：REST + Zod

**需求来源**：`requirements.md` §4.4 + Q21 决策

**技术实现**：

`apps/web/app/api/image/route.ts`：
```ts
import { z } from 'zod';

const bodySchema = z.object({
  prompt: z.string().min(1),
  provider: z.enum(['seedream', 'gemini']).optional(),
  model: z.string().optional(),
  params: z.object({
    aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']).optional(),
    resolution: z.enum(['1K', '2K']).optional(),
    imageUrls: z.array(z.string().url()).max(4).optional(),
    num: z.number().int().min(1).max(4).optional(),
    providerSpecificParams: z.record(z.unknown()).optional(),
  }),
  topicId: z.string().uuid().optional(),
  skillId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = bodySchema.parse(await req.json());  // 失败抛 400
  // ...
}
```

**OpenAPI 暴露**（前端 type 生成）：
```ts
// apps/web/app/api/openapi/route.ts
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
// 注册所有 schema，生成 OpenAPI 文档
```

**参考代码**：
- LangGraphPj `app/api/chat/route.ts`（手写 body 校验，不严格）。
- lobehub-canary `apps/server/src/routers/lambda/image/index.ts`（Zod 严格）。

**选型依据**：
- 用户 Q21 选"REST/JSON + Zod"。
- 严格校验、统一错误码映射。

**实施步骤**：
1. 所有 routes 用 zod parse 输入。
2. 装 `zod-to-openapi`，注册 schema，生成 `/api/openapi.json`。
3. CI 跑 `openapi-typescript` 重新生成前端 types。

---

### 3.16 错误码：6 个枚举 + HTTP 状态映射

**需求来源**：`requirements.md` §4.4.2 + Q4 决策 + §4.6「quota_exceeded → 429」；review-report GAP-13

**技术实现**：

`packages/shared/errors.ts`：
```ts
export const ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  QUOTA_EXCEEDED: 'quota_exceeded',
  PROVIDER_ERROR: 'provider_error',
  NETWORK: 'network',
  MODERATION: 'moderation',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  bad_request: '请求参数错误',
  unauthorized: '未授权',
  quota_exceeded: '今日配额已用完',
  provider_error: '生图服务异常',
  network: '网络异常',
  moderation: '内容违规',
};

// HTTP 状态码映射（review-report GAP-13，落地 requirements §4.6）
export const ERROR_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,        // 客户端参数错误（zod 校验失败、MIME/大小超限、缺 generationId 等）
  unauthorized: 401,       // 鉴权失败（anon 登录未生效、JWT 过期）
  quota_exceeded: 429,     // 配额越界（requirements §4.6 强约束）
  provider_error: 502,     // Seedream/Gemini 上游 5xx
  network: 503,            // 网络层中断（fetch failed / timeout）
  moderation: 403,         // 内容安全拦截（语义上属"被拒绝"而非"不可用"）
};

// 统一响应构造器
export function errorResponse(code: ErrorCode, message?: string, extra?: Record<string, unknown>) {
  return Response.json(
    { error: { code, message: message ?? ERROR_MESSAGES[code], ...extra } },
    {
      status: ERROR_STATUS[code],
      headers: code === 'quota_exceeded' ? { 'Retry-After': '86400' } : {},
    },
  );
}
```

**使用示例**：

```ts
// apps/web/app/api/image/route.ts
import { errorResponse, ERROR_CODES } from '@zimage/shared/errors';

// 配额越界
if (quotaErr.name === 'QuotaExceededError') {
  return errorResponse(ERROR_CODES.QUOTA_EXCEEDED, `今日配额已用完（${quotaErr.usedCount}/${quotaErr.limit}）`);
}

// provider 上游错误
if (!res.ok) {
  if (res.status === 429) {
    return errorResponse(ERROR_CODES.QUOTA_EXCEEDED, '上游 provider 配额耗尽');
  }
  if (res.status >= 500) {
    return errorResponse(ERROR_CODES.PROVIDER_ERROR, `Seedream 返回 ${res.status}`);
  }
  return errorResponse(ERROR_CODES.BAD_REQUEST, `参数被 provider 拒绝: ${await res.text()}`);
}
```

**前端错误卡片**：

```tsx
// apps/web/src/components/ErrorCard.tsx
import { ERROR_MESSAGES, ERROR_STATUS, type ErrorCode } from '@zimage/shared/errors';

export function ErrorCard({ code, message, onRetry }: { code: ErrorCode; message: string; onRetry: () => void }) {
  const isQuota = code === 'quota_exceeded';
  return (
    <Card>
      <p>{message || ERROR_MESSAGES[code]}</p>
      <code>HTTP {ERROR_STATUS[code]} · {code}</code>
      {!isQuota && onRetry && <Button onClick={onRetry}>重试</Button>}
    </Card>
  );
}
```

**参考代码**：LangGraphPj 未定义统一错误码（已知问题）。

**选型依据**：
- 用户 Q4 选"API 权威并补齐到 6 个"。
- 全栈统一枚举，UI 渲染与国际化集中。
- GAP-13：HTTP 状态映射让前端能基于 status 触发不同 UX（429 → 不显示重试按钮；502 → 自动重试）。

**实施步骤**：
1. 写 `packages/shared/errors.ts`（含 ERROR_STATUS + errorResponse）。
2. 所有 routes 改用 `errorResponse()` 替换原 `Response.json({ error }, { status: ... })`。
3. 前端 `<ErrorCard>` 接入新结构，禁用重试按钮当 `code === 'quota_exceeded'`。
4. e2e 测试覆盖 6 个 status code。

---

### 3.17 Mock/Seed：Supabase seed.sql

**需求来源**：`requirements.md` §5.3 + Q39 决策

**技术实现**：

`supabase/seed.sql`：
```sql
-- 3 个示例 topic（仅本地 dev 启用）
INSERT INTO topics (id, user_id, kind, title) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'image', '示例：白底图练习'),
  -- ...
ON CONFLICT DO NOTHING;
```

**选型依据**：
- 用户 Q39 选"Supabase seed.sql"。
- 贴近生产、本地演示直接可用。

**实施步骤**：
1. 写 `supabase/seed.sql`。
2. 文档指示：本地 dev 跑 `supabase db reset` 后自动 seed。
3. CI 不跑 seed（仅本地）。

---

## 4. 页面级实现路径（先前端后端后接入）

### 4.1 首页（lobehub Home 风格聊天 hero）

**前端先行**：
- 文件范围：`apps/web/app/page.tsx` + `apps/web/src/features/Home/{HomeContent,HomeInput,HomeSuggestion}.tsx`
- 关键组件：
  - `<ChatInput>`（@lobehub/ui）+ 模型选择器（`<ModelSwitchPanel>`）+ 技能选择器（`<SkillSelector>`）
  - `<HomeSuggestion>` 列出 3 个技能（白底图 / 模特图 / 种草图）
- 状态：本地 React state（mock）
- 流程：用户输入提示词 → 选技能 → 点击"生成" → 进入 `/image?topic=new&prompt=...`

**后端接入**：
- `app/api/topics` POST 创建空 topic
- `app/api/image` POST 同步入库 + async fire-and-forget 生成
- 跳转 `/image?topic=<id>` 展示进度

**参考代码**：lobehub-canary `src/features/Home/index.tsx` + `src/routes/(main)/home/index.tsx`（薄页面段 + features）。

**实施步骤**：
1. 前端：写 `app/page.tsx` + HomeContent（mock）。
2. 前端：跑通"输入 → 跳转 `/image`"路径。
3. 后端：接 `app/api/topics` + `app/api/image`。
4. 端到端：完整生成链路跑通。

---

### 4.2 /image 工作台（lobehub 生图风格）

**前端先行**：
- 文件范围：`apps/web/app/image/page.tsx` + `apps/web/src/features/ImageWorkspace/{ImageWorkspace,GenerationFeed,SideBar,ConfigPanel,PromptInput}.tsx`
- 关键组件：
  - `<SideBar>` 话题列表（mock 数据）
  - `<GenerationFeed>` 批次卡片（loading/error/success）
  - `<ConfigPanel>` 模型/比例/分辨率/张数（按 parametersSchema 显隐）
  - `<PromptInput>` 提示词 + 参考图上传
  - `<InlineImageReference>` 参考图卡片
- 状态：zustand `useImageStore`
- 轮询：`useGenerationStatus(taskId)`（SWR 2s 间隔）

**后端接入**：
- `app/api/image` POST 创建生成
- `app/api/image/[taskId]` GET 轮询状态
- `app/api/image/recreate` POST 重生成三模式
- `app/api/topics` GET 列表

**参考代码**：
- lobehub-canary `src/routes/(main)/(create)/image/{index.tsx, _layout/index.tsx, features/}`（完整生图工作台）。
- `src/store/image/slices/{createImage, generationTopic, generationConfig, generationBatch}/`。

**实施步骤**：
1. 前端：写 `app/image/page.tsx` + 各 feature（mock 数据）。
2. 前端：跑通"输入 → 批次卡片显示"（mock）。
3. 后端：接入 `api/image` POST + GET 轮询。
4. 端到端：从空白到生成完成的全流程。

---

### 4.3 聊天（嵌入首页 + /chat 路由）

**前端先行**：
- 文件范围：`apps/web/src/features/Chat/{ChatList,ChatInput,MessageBubble,ImageCard,ToolSelector,SkillSelector}.tsx`
- 关键组件：
  - `<ChatList>` + `<MessageBubble>` + `<ImageCard>`（@lobehub/ui）
  - `<ChatInput>`（@lobehub/ui）+ 工具选择器（`<ToolSelector>`）
  - `<SkillSelector>`（3 个内置技能）
- 状态：zustand `useChatStore`
- SSE：用 `packages/fetch-sse` 订阅 `/api/chat`

**后端接入**：
- `app/api/chat` POST SSE 流式
- `app/api/chat/sessions` CRUD
- `app/api/skills` GET 列表

**参考代码**：
- LangGraphPj `app/hooks/useSendMessage.ts`（SSE 解析）与 `app/api/chat/route.ts`（事件映射）。
- lobehub-canary `src/features/Conversation/`（ChatList / MessageBubble）。

**实施步骤**：
1. 前端：写 ChatList + MessageBubble（mock）。
2. 前端：跑通"用户输入 → mock 回复 + 增量渲染"。
3. 后端：接入 `api/chat` SSE 真实流。
4. 端到端：图片工具调用 + ImageCard 渲染。

---

### 4.4 共享能力：登录态 / 配额 / 内容安全 / 监控

**前端**：
- 配额卡片：每日剩余次数（实时拉取）
- 错误监控：Sentry 集成
- 国际化：所有文案 i18n key
- **Provider 降级 UI**（review-report GAP-3，requirements §3.3）：`/api/health/providers` 轮询 + `<ModelSwitchPanel>` 禁用态 + 顶部 toast

**后端**：
- 配额：每 UID + UTC 日计数器（Supabase 表，详见 §3.7b）
- 内容安全：preCheck + postCheck（详见 §3.12）
- 错误码：统一 6 枚举 + HTTP 状态映射（详见 §3.16）
- 监控：Sentry server-side + LangSmith tracing + Provider 健康检查（详见 §3.13a）

**Provider 降级 UI 实现**（review-report GAP-3）：

`apps/web/src/features/ProviderStatus/useProviderHealth.ts`：

```ts
import useSWR from 'swr';

export function useProviderHealth() {
  return useSWR('/api/health/providers', openapi.GET, {
    refreshInterval: 60_000,  // 每分钟轮询
    revalidateOnFocus: true,
  });
}
```

`apps/web/src/features/ProviderStatus/ModelSwitchPanel.tsx`：

```tsx
import { useProviderHealth } from './useProviderHealth';

export function ModelSwitchPanel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useProviderHealth();
  const providers = data?.providers ?? [];

  return (
    <Select value={value} onChange={onChange}>
      {providers.map((p) => (
        <Select.Option
          key={p.name}
          value={p.name}
          disabled={!p.healthy}
          title={!p.healthy ? `近 5 分钟错误率 ${(p.errorRate * 100).toFixed(0)}%，限上不可用` : undefined}
        >
          {p.name === 'gemini' ? 'Gemini' : p.name === 'seedream' ? 'Seedream (火山方舟)' : p.name}
          {!p.healthy && <Tag color="red">限上</Tag>}
        </Select.Option>
      ))}
    </Select>
  );
}
```

**自动降级 hook**（chat 流内）：

```ts
// apps/web/src/hooks/useAutoDegrade.ts
import { useEffect } from 'react';
import { useProviderHealth } from '@/features/ProviderStatus/useProviderHealth';

export function useAutoDegrade(currentProvider: string, onSwitch: (newProvider: string) => void) {
  const { data } = useProviderHealth();

  useEffect(() => {
    if (!data) return;
    const unhealthy = data.providers.find((p) => p.name === currentProvider && !p.healthy);
    if (unhealthy) {
      const fallback = data.providers.find((p) => p.name !== currentProvider && p.healthy);
      if (fallback) {
        message.warning(`${currentProvider} 不可用，已自动切换到 ${fallback.name}`);
        onSwitch(fallback.name);
        Sentry.captureMessage(`auto-degrade: ${currentProvider} → ${fallback.name}`, { level: 'info' });
      }
    }
  }, [data, currentProvider, onSwitch]);
}
```

**Phase1 验收对齐**：

- requirements §3.3「Provider 降级：Gemini 健康检查失败时，UI 提示『限上不可用』并自动切换到 Seedream；模型选择器中 Gemini 项显示禁用态」—— `<ModelSwitchPanel>` 禁用态 + toast 自动切换 双轨落地
- US4 AC「Gemini 不可用时（健康检查失败）UI 提示『限上不可用』，并自动降级到 Seedream」—— 完整覆盖

**实施步骤**：
1. 前端：接配额卡片 + Sentry 初始化 + Provider 降级 UI。
2. 后端：建 `quotas` 表 + 中间件校验 + Provider 健康检查（§3.13a + §3.7b）。
3. 后端：内容安全集成 + 错误码映射 + HTTP 状态（§3.16）。
4. 端到端：
   - 内容违规场景 → 拒绝生成（moderation 错误码）
   - Provider 故障场景 → 5 分钟后自动降级 UI
   - 配额耗尽场景 → HTTP 429 + 禁用重试按钮

---

## 5. 实施路径（分阶段）

### 阶段 1：前端骨架（先实现）

**DoD**：
- 三页（首页 / /image / 聊天）UI 完整渲染。
- Mock 数据跑通"输入 → 跳页 / 展示卡片"。
- vitest 单测覆盖 ≥ 60%。
- ESLint 0 错误，TypeScript 0 错误。
- Sentry 接入前端（dry run）。

**回滚**：
- Vercel 自动回滚到前一个 deploy。
- DB 迁移未涉及（仅 mock）。

**步骤**：
1. §1.1-1.7 工程基础。
2. §2.1-2.16 前端栈。
3. §4.1-4.4 前端骨架（mock 数据）。
4. §2.15 测试栈补 60% 覆盖。

### 阶段 2：后端接入

**DoD**：
- 真实 Supabase + 生图 + 聊天跑通。
- 6 个错误码覆盖。
- 内容安全拦截率 ≥ 99%。
- 备份策略上线。
- requirements.md §1.3 指标全部达成。

**回滚**：
- Vercel 一键回退。
- Supabase 迁移 `NNNN_*.down.sql` 回滚。

**步骤**：
1. §3.1-3.4 后端基础 + DB 迁移。
2. §3.5-3.8 生图链路。
3. §3.9-3.11 聊天 + LangGraph agent。
4. §3.12-3.18 内容安全 + 监控 + 错误码。
5. §4.4 共享能力接入。
6. §5.1 Phased Rollout MVP 验收。

---

## 6. 决策与依据索引

### 6.1 前期决策（来自 requirements.md §1.4）

| ID | 决策 | 章节 |
|---|---|---|
| Q1 | 人工盲评 | §3.4 |
| Q2 | 极简集 + provider 透传带 | §3.1.1 |
| Q3 | 双 provider 交付 | §3.1.2, §1.3 |
| Q4 | 错误码 6 个 | §4.4.2 |
| Q5 | taskId=batchId | §4.3, §4.4.2 |
| Q6 | sessions.id=thread_id | §4.3.1 |
| Q7 | 简化版 parametersSchema | §3.1.2 |
| Q8 | 4K 挪 Phase2 | §1.3, §3.1.1 |
| Q9 | 监控/备份纳入 MVP | §4.9 |
| Q10 | 每请求 compile | §4.1 |
| Q11 | 内容安全 Phase1 必接 | §4.6 |
| D1 | 借鉴范围明示 | §1.2 |
| D2 | 工具注册表四类 | §4.1 |
| D3 | 删会话清理 checkpointer | §4.4.1 |
| D4 | SSE 事件对齐 LangGraphPj | §4.4.1 |
| D5 | SKILL.md 新增 triggers | §3.2 |
| D6 | 重生成三模式 | §4.4.2 |
| D7 | 命名 snake_case | §4.3 |
| D8 | 术语统一 | §4.3.1 |
| D9 | generations.provider 冗余 | §4.3.1 |
| D10 | 90/30 天保留 | §4.3.2 |
| D11 | i18n 仅 zh-CN | §4.7 |
| D12 | OAuth PKCE | §4.6 |
| D13 | 禁 any | §4.6 |

### 6.2 本轮新增（Q16-Q54）

| ID | 决策 | 章节 |
|---|---|---|
| Q16,Q17 | 多 provider 抽象 + MVP 字节火山 + MiniMax | §3.9 |
| Q18 | antd + antd-style 统一 | §2.4 |
| Q19 | SWR | §2.7 |
| Q20 | vitest + RTL + Playwright | §2.16 |
| Q21 | REST/JSON + Zod | §3.15 |
| Q22 | pnpm + Turborepo | §1.1 |
| Q23 | ESLint + Prettier | §1.4 |
| Q24 | Next.js 默认构建 | §2.2 |
| Q25 | pnpm 9 + Node 24 | §1.2 |
| Q26 | Sentry | §2.13 |
| Q27 | 告警渠道：Phase2 | §3.13 |
| Q28 | react-i18next | §2.10 |
| Q29 | @lobehub/charts | §2.5 |
| Q30 | pino + 本地 | §3.14 |
| Q31 | 平台原生 secrets | §1.7 |
| Q32 | Chrome / Edge 最新 | §2.12 |
| Q33 | 不引 Storybook | （代决策）|
| Q34 | 抽 lobehub fetch-sse | §2.9 |
| Q35 | openapi-fetch + openapi-typescript | §2.8 |
| Q36 | Node runtime | §3.1 |
| Q37 | @supabase/ssr | §3.2 |
| Q38 | 首次访问静默 anon | §3.3 |
| Q39 | Supabase seed.sql | §3.17 |
| Q40 | storage 客户端 | §3.5 |
| Q41 | 直连 Cloud + storage 客户端 | §3.5 |
| Q42 | 生图执行：lambda + async | §3.6 |
| Q43 | lambda 同步入库 + async fire-and-forget | §3.6 |
| Q44 | JSON Schema | §3.8 |
| Q45 | 手写 SSE 解析 | §2.9 |
| Q46 | 抽 lobehub fetch-sse | §2.9 |
| Q47 | 单一 Next.js 全栈 | §0.3 |
| Q48 | TS project references | §1.3 |
| Q49 | GitHub Actions | §1.6 |
| Q50 | husky + lint-staged | §1.5 |
| Q51 | react-i18next | §2.10 |
| Q52 | LangSmith | §2.14 |
| Q53 | LangGraph Studio | §2.15 |
| Q54 | 仅 LangSmith + Sentry | §2.14 |

### 6.2a 审查交互确认（review-report C1/C2）

| ID | 决策 | 章节 | 来源 |
|---|---|---|---|
| **Q-C1** | 聊天 LLM provider 锁定 `Doubao + MiniMax` | §3.9 | review-report §0 C1 用户拍板（requirements.md §1.4 Q12 已回填） |
| **Q-C2** | parametersSchema 数据格式锁定 `JSON Schema` | §3.8 | review-report §0 C2 用户拍板（requirements.md §5.3 已标记「已确认」） |

### 6.3 代决策（无需询问）

| ID | 决策 | 章节 |
|---|---|---|
| 代-1 | 认证 Cookie：HttpOnly + Secure + SameSite=Lax | §3.3 |
| 代-2 | MSW：Phase1 不引 | §2.16 |
| 代-3 | @lobehub/ui ^5.x | §2.3 |
| 代-4 | antd ^5.x | §2.3 |
| 代-5 | 默认字节火山：doubao-pro | §3.9 |
| 代-6 | Supabase 区域：ap-northeast-1 | §3.4 |
| 代-7 | Playwright e2e 用独立 anon uid | §2.16 |
| 代-8 | a11y 测试：axe-core | §3.13 |
| 代-9 | 备份：Supabase 自动 + 季度演练 | §4.9.2 |
| 代-10 | 流量治理：仅配额 + UA/IP 软限速 | §1.6 |
| 代-11 | 单租户（无 workspace） | §0.3 |
| 代-12 | 错误码国际化：6 枚举 + 中文常量 | §3.16 |

---

## 7. 假设与边界

- 仅做 web 端，不做 iOS / Android / 桌面端。
- 单一 Next.js 全栈部署（Vercel 优先 / 自托管 PM2 兜底）。
- Phase1 单租户，无 workspace / 团队 / 多租户概念。
- 公开 Supabase Cloud + Supabase Storage + Auth 匿名登录，不引 WAF / Flow Control。
- 模型接入以官方 SDK 优先（豆包 OpenAI 兼容 / MiniMax Anthropic 兼容）。
- Content safety 供应商选型（数美 / 火山 / 阿里云绿网）于接入时确认。
- 后端生图执行走 Next.js Route Handler（Node runtime），不引 Supabase Edge Function（Phase1 同步即可）。
- 监控告警渠道（lark / 钉钉 / PagerDuty）推迟到 Phase2。
- 单租户 + 匿名登录意味着每浏览器实例一个 anon uid，跨设备不同。

---

## 8. 兼容性 / 重用映射

| zimage 文件 | 复刻源 | 复用内容 |
|---|---|---|
| `apps/web/agent/chatbot.ts` | LangGraphPj `app/agent/chatbot.ts` | StateGraph + SupabaseSaver（每请求改造） |
| `apps/web/agent/config/unified-tools.config.ts` | LangGraphPj `app/agent/config/unified-tools.config.ts` | 四类注册表 |
| `apps/web/services/storage.service.ts` | LangGraphPj `app/services/storage.service.ts` | 风格一致 |
| `packages/image-providers/` | LangGraphPj `app/agent/tools/google-image-generation.tool.ts` | 抽象 + 多个 adapter |
| `packages/fetch-sse/` | lobehub-canary `packages/@lobechat/fetch-sse/` | 抽出复用 |
| `apps/web/libs/supabase/*` | LangGraphPj `app/database/supabase.ts`（修复） | @supabase/ssr 替代 |
| `apps/web/src/store/image/` | lobehub-canary `src/store/image/` | 分层结构 |
| `apps/web/src/features/ImageWorkspace/` | lobehub-canary `src/routes/(main)/(create)/image/features/` | 组件布局 |
| `apps/web/src/features/Chat/` | LangGraphPj `app/hooks/useSendMessage.ts` + lobehub `src/features/Conversation/` | 合并最佳实践 |
| `packages/shared/i18n/zh-CN.ts` | lobehub-canary `packages/locales/src/default/` | i18n key 结构 |
| `packages/shared/parameters/*.schema.json` | lobehub-canary `model-bank/imageParameters` | per-model 参数 |
| `apps/web/middleware/content-safety.ts` | （无参考） | 自实现 |
| `turbo.json` | （无参考） | 自定义 |
| `langgraph.json` | LangGraph Studio 官方 | 标准模板 |
