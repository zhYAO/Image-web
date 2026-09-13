# ZImage 桌面 Web 体验审计与渐进改造方案

审计日期：2026-09-08（America/Los_Angeles；证据目录使用 UTC 日期 2026-09-09）。

**阶段：第一阶段，供方向确认。尚未修改业务或样式，尚未修复下述问题。** 按本次追加要求，仅处理桌面 Web；不做手机、平板或响应式断点检查。

## 1. 结论与建议

现有应用已经具备浅色玻璃界面、普通对话、显式图片生成和电商任务工作流。应该保留这些业务边界，优先修复失败恢复和会话状态问题，再整理共享材质与组件。无需重建应用或替换组件库。

优先处理：聊天错误的“重试”按钮没有行为；未提交的普通与电商草稿刷新后消失；图片预览混入其他已访问会话；重新生成后的额度显示未同步。已保存的 Mock 会话、电商方案和完成结果能够刷新恢复，本轮没有发现已保存记录被删除或跨账号访问的证据。

推荐方向是 **“稳定内容表面 + 克制的玻璃操作层”**：保留 ZImage 的浅色中性底与蓝色强调色，玻璃主要用于侧栏、工具栏、输入操作区和浮层外壳；消息、表单、任务结果和图片保持清晰稳定。

## 2. 项目认知与保护边界

### 仓库与技术栈

- 工作目录：`/Users/zzz/Desktop/work_space/Image-web`；审计起点 Git 工作区干净，HEAD 为 `b17faba`。
- 已读项目规范、README、需求、架构/技术选型相关章节、`doc/project-progress.md`、依赖与锁文件、启动脚本、组件/状态/网关及现有测试。当前状态以进度文档与本次代码、运行证据交叉判断。
- pnpm monorepo：`apps/web`、`packages/domain`、`supabase`。Next.js 16.3.0、React 19.2.7、Ant Design 6.3.5、Lobe UI 5.30.0、Lucide 1.31.0、Zustand 5.0.4、Zod 4.4.3。
- 样式为 CSS Modules + 全局 CSS + 组件库主题，未使用 Tailwind。`app/providers.tsx` 固定浅色，当前没有对用户开放的主题切换。
- 接口经 `WorkspaceGateway` 隔离 Mock/HTTP；后者连接现有服务、Supabase/Storage 与异步生成体系。本轮浏览器生成使用隔离的 Mock 数据，未调用付费模型。

### 页面、状态和接口关系

| 真实入口 | 用户任务 | 主要代码和边界 |
|---|---|---|
| `/` | 会话、聊天、普通图片创建、参考图、结果预览/下载 | `UnifiedWorkspace` 协调会话 runtime、网关与轮询；`UnifiedComposer`、`WorkspaceTimeline`、`SessionSidebar`、`GenerationConfig` 展示与输入 |
| `/create` → `/?scene=…&platform=…` | 选择电商场景/平台，进入明确的电商创作 | 6 个场景：商品主图、商品套图、详情页、社交种草、风格参考、模特展示；平台为淘宝、抖音、小红书 |
| `/` 中的电商工作流 | 录入商品、参考图、逐图计划、保存、确认生成、版本/下载 | `CommerceWorkspace`、`CommerceWizard`、`CommerceTaskCard`、`use-commerce-tasks`；`/api/creative-templates`、`/api/creative-tasks` 及子操作 |
| `/login`、`/auth/*` | 登录、注册、验证与密码恢复 | 认证表单与 CAPTCHA；仅完成未登录页面与禁用/验证状态观察，未提交真实账号或邮件操作 |
| `/account` | 账号信息、安全操作 | 未登录实际重定向至 `/login?returnTo=/account`；已登录流程本轮未实测 |
| `/terms`、`/privacy` | 法律信息 | 路由存在；不作为本轮主要改造样板 |
| `/chat`、`/image`、旧 `/skills` | 兼容旧入口 | 普通入口回工作台；旧 Skills 转 `/create`，不恢复旧 Skill 展示 |

状态分工：已提交会话/任务由网关持久化；普通输入配置在 `store/workspace-store.ts` 的内存 Zustand 中；电商未保存编辑在组件 state 中；单个会话的异步 runtime 与资源清理由工作台持有。普通对话、显式普通生图、电商启动不得因关键词而混路由。

### 可复用基础与维护风险

应继续复用现有按钮/输入/弹窗/图片预览、Lucide 图标、网关契约和测试工具。已有时间线请求版本检查、提交禁用、参考图资源释放、任务版本和确认请求恢复逻辑，需要保留。

工作台协调组件 852 行、工作台 CSS 1,598 行，电商 CSS 1,089 行；工作台 CSS 有 68 处 `!important`、14 条包含厂商前缀在内的 `backdrop-filter` 声明。这些数字是维护线索，不代表 14 个同时合成的模糊层，也不能直接证明性能瓶颈。样式后段存在重复覆盖，应按组件逐步合并，避免继续追加全局压制。

## 3. 实际运行基线

### 环境与测量条件

- 地址：`http://127.0.0.1:3110/`；显式 `NEXT_PUBLIC_DATA_MODE=mock`、`NEXT_PUBLIC_PHASE2_AUTH=false`，独立 `.next-liquid-audit` 构建目录。
- 手动浏览器：Codex 内嵌 Chromium，UA 报告 Chrome **152.0.0.0**，macOS；固定 **1440 × 900**。本轮没有改变为手机/平板视口。
- 使用全新 3110 origin 的 Mock 数据；参考图是本地生成的 1 像素 PNG。无私有代码或图片上传，无部署、推送、依赖升级、数据库迁移、真实删除或付费调用。认证页自动加载已有 CAPTCHA 服务，未提交账号信息。
- 默认 Node 为 24.16.0，低于仓库 `>=24.19`；Corepack 尝试取得固定 pnpm 11.19.0 时受缓存权限限制。采用机器已有 Node **26.3.0** 及仓库已安装 CLI 运行等价检查，没有重新安装依赖。固定 pnpm 11.19.0 下的同命令结果不能据此宣称已验证。
- Dev 首次 GET 约 20.9 秒，其中 Next 编译约 18.6 秒；这不是生产页面性能。服务 ready 日志约 917 毫秒。
- 一次暖刷新浏览器 Navigation/Paint 读数：TTFB **99.1 ms**、DOMContentLoaded **162.4 ms**、load **421 ms**、FCP **204 ms**、资源记录 **75**。条件为本机开发模式、缓存暖、同时仍有单 worker 单元测试；仅为可复测的起点，不能推导生产性能或交互流畅度。LCP、INP、CLS、GPU 合成开销和前后对比尚未测量。
- 普通聊天、生图、刷新和额度复核期间读取到的浏览器 warn/error 日志为空；这不是全站、所有失败路径的零错误保证。

### 命令与结果

检查使用实际安装的 CLI，命令工作目录分别注明。所有命令的 Node 均来自 `/usr/local/opt/node@26/bin`。审计日志位于 `.design-qa/liquid-glass-audit-2026-09-09/logs/`。

| 检查 | 实际命令 | 本轮结果 |
|---|---|---|
| Lint（根目录） | `node node_modules/eslint/bin/eslint.js apps/web packages/domain --max-warnings=0` | exit 0；有未找到根 `pages` 目录的配置提示，无 lint 失败 |
| Domain 类型（根目录） | `node node_modules/typescript/bin/tsc --noEmit -p packages/domain/tsconfig.json` | exit 0 |
| Web 类型（根目录） | `node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` | exit 0 |
| Domain 单测（packages/domain） | `node node_modules/vitest/vitest.mjs run` | 4 文件，41 测试通过 |
| Web 单测（apps/web） | `node node_modules/vitest/vitest.mjs run` | exit 1；49 文件中 48 通过、1 失败；321 测试中 320 通过、1 失败；988.72 秒 |
| Web 环境诊断（apps/web） | `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run tests/mock-workspace-gateway.test.ts` | exit 0；相关文件 10/10 通过；2.96 秒；未在此环境参数下重跑全量 |
| 桌面 E2E（apps/web） | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 node node_modules/@playwright/test/cli.js test --workers=1` | exit 1；26 通过、1 截图失败、1 账号集成跳过；7.3 分钟；仅 chromium-desktop 1440×900 |
| Build（apps/web） | `NEXT_DIST_DIR=.next-liquid-audit-build-fresh NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_PHASE2_AUTH=false NEXT_TELEMETRY_DISABLED=1 SENTRY_AUTH_TOKEN='' SENTRY_DSN='' NEXT_PUBLIC_SENTRY_DSN='' node node_modules/next/dist/bin/next build` | exit 0；编译 71 秒、内置 TypeScript 47 秒，静态页与路由输出完成 |

Web 原始失败是 `mock-workspace-gateway.test.ts` 的共享 Mock 注入用例：`window.localStorage` 为 undefined，`MockWorkspaceGateway.load:524` 读取 `getItem` 抛错。单独给父进程传 Node flag 仍失败；通过 `NODE_OPTIONS` 传入测试子进程后 10/10 通过，说明与 Node 26 默认 Web Storage / jsdom 环境交互有关。未修改业务或测试代码，不能把这次诊断写为原始全量 321/321 通过。日志分别是 `tests-web.log`、`tests-web-storage-diagnostic.log`、`tests-web-storage-child-diagnostic.log`。

测试基线维护项（不计入 7 项产品 Bug）：

- **T01 / P2 / 测试环境兼容**：上述 Web Storage 问题应在后续统一受支持 Node 与 Vitest 子进程配置；验收必须跑完整套件，不以这次 10 项诊断代替全量。
- **T02 / P2 / 视觉预期过期**：`opens image parameters without exposing legacy skills` 的功能断言完成后，`parameters-open.png` 截图断言失败，差异 27,654 像素（约 3%，超过现有 2% 阈值）。实际/预期/差异图已逐张检查：仓库预期仍包含旧“官方 Skill”、旧侧栏和旧卡片，而实际为当前 ZImage 电商入口；不是本轮引入的样式回归。方向确认、当前行为审查通过后，单独更新这张视觉预期；不放宽阈值或恢复旧入口来过关。

Playwright 首次在沙箱内启动浏览器发生 SIGTRAP，未进入页面步骤，故停止重复的启动失败；获准运行后用相同测试与隔离 Mock 服务重跑。原始环境失败日志保存在 `e2e.log`，实际可执行的桌面测试日志在 `e2e-authorized.log`。首次 Build 同样因 Turbopack 处理 loader 需要启动子进程/绑定本地端口而被沙箱拒绝（`Operation not permitted`）；获准后沿用原构建目录仍出现相同错误。更换为全新的 `.next-liquid-audit-build-fresh` 并保持相同源码与配置后完整构建 exit 0，支持“先前环境错误被构建缓存保留”的判断，而非源码编译故障。三个尝试分别保留 `build.log`、`build-authorized.log`、`build-fresh.log`，未删除缓存或替换编译器来掩盖失败。

自动化浏览器来自已安装 Playwright Chromium revision 1234（包内版本记录 151.0.7922.34）；与手动内嵌浏览器版本分开记录。26 项通过覆盖了完整电商保存/生成/刷新/单图修改/旧版本选择/多文件下载/归档，普通 1–4 张生成、预览初始焦点和 Escape、失败图片重建、参考图格式校验与切换恢复、隔离会话重命名/删除、键盘换行/发送、普通与电商路由边界及跨域模拟下载。账号集成用例缺少显式 `PHASE2_AUTH_E2E=true` 的可用认证环境而跳过；本轮未打开该开关。

主要日志：[Web 全量](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/logs/tests-web.log) · [环境诊断复测](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/logs/tests-web-storage-child-diagnostic.log) · [桌面 E2E](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/logs/e2e-authorized.log) · [成功构建](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/logs/build-fresh.log) · [视觉差异](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/visual-baseline-diff/parameters-open-diff.png) · [性能采样条件](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/performance-baseline.json)。

现有测试运行时间主要在真实 Ant Design/Markdown 组件渲染，部分用例 10–30 秒；重型检查串行执行。未修改测试断言或更新视觉基线掩盖失败。

## 4. 五条核心路径与状态检查

| 路径和步骤 | 观察结果 / 健康度 | 证据 |
|---|---|---|
| ① 空工作台 → 输入提示词讨论 → 发送 → 流式等待 → 回答 → 刷新 | 主路径可用；输入空时禁用，提交反馈可见，完成消息可恢复；失败恢复存在 B01/B02 | 01、02、13 |
| ② 创建图片 → 参数浮层 → 16:9/1 张 → 发送 → 结果 → 完整预览 → 重新生成 | 普通生图可用，未进入电商表单；浮层 Escape 关闭且焦点回到触发按钮；预览 Escape 可关闭；跨会话范围和额度有 B04/B05 | 03、04、05、18、19、20 |
| ③ 电商目录 → 抖音/商品套图 → 商品信息/参考图 → 逐图设置 → 保存待确认 → 确认 5 张 → 完成 → 刷新 | 保存与确认分离，5 张 Mock 结果恢复、导出按钮可用；空参考图有校验；未保存草稿与操作层级待改进 | 09、10、11、12、16、17 |
| ④ 历史会话切换 → 回到普通会话 → 浏览结果 / 刷新 | 已提交记录可恢复；普通未发送文本刷新丢失，隐藏会话图片混入预览 | 07、08、18 |
| ⑤ 账号入口 → 登录 → 注册 / 找回密码 | 未登录重定向正确；可观察验证、禁用状态；验证码完成后的提示有歧义；真实登录/邮件/账号修改未验证 | 14、15 |

桌面键盘已实际验证参数浮层的 Escape 和焦点恢复，以及图片预览的 Escape；E2E 另验证预览初始焦点、Shift+Enter 换行、Enter 发送和空白提交禁用。完整 Tab 顺序/预览焦点闭环、200% 页面放大、极长文本、关闭 backdrop-filter 的效果、减少动态/透明偏好和其他浏览器兼容性尚未完成实测，应在样板验收中补齐。没有将源码中的媒体查询写成实测通过。

## 5. 已确认问题

P0：本轮无已确认项。以下草稿丢失局限于尚未提交/保存的编辑，未发现持久化数据丢失，按恢复和误操作成本列 P2。

### B01 · P1 · 聊天失败的“重试”按钮无行为

- 页面/类型：普通工作台 `WorkspaceTimeline`，功能 Bug。
- 复现：Mock 选“服务不可用”→发送聊天→出现失败→恢复“正常”→点击“重试”。
- 当前：无加载、无新回复，点击不能恢复；截图 13、`logs/retry-dom.txt`。
- 预期：用户可以按明确语义重试原请求，并看到提交和结果状态。
- 根因：[WorkspaceTimeline.tsx:238](/Users/zzz/Desktop/work_space/Image-web/apps/web/features/workspace/WorkspaceTimeline.tsx:238) 仅渲染带文字的 Button，没有 `onClick`；工作台没有把失败消息关联到可重试的请求上下文。
- 修复方向：建立失败 turn 与原提示/模型/会话的关联，传递重试回调并限制重复提交；保留已收到的部分内容，明确重试是新尝试还是原请求恢复，不能盲目复用会产生错误副作用的接口。
- 验证：失败→恢复→点击后恰好一次请求；连点、切换会话、部分流中断、不可重试错误分别验证。

### B02 · P2 · 同一次聊天失败显示两条相同错误

- 页面/类型：工作台错误时间线，状态一致性 Bug。
- 复现：按 B01 触发一次聊天失败，等待时间线刷新；出现两条相同错误。整页刷新后仅剩持久化的一条。
- 当前/预期：当前把本地临时错误与已保存错误同时显示；预期一次失败只有一个明确反馈和恢复入口。
- 证据/原因：截图 13；`UnifiedWorkspace.tsx:528` 创建随机本地错误 ID 并保留，`:177` 仅按 ID 去重，无法识别同一次服务端失败。
- 修复方向：用稳定 turn/request 身份协调本地与持久化反馈；不能通过清空所有本地错误丢掉尚未保存的部分内容。
- 验证：错误到达前后顺序、刷新、跨会话返回、部分回复均只保留对应的一次反馈。

### B03 · P2 · 未发送文本与未保存电商草稿刷新后丢失

- 页面/类型：普通 Composer、电商 Wizard，编辑状态恢复 Bug。
- 复现 A：输入“审计草稿：尚未发送的陶瓷杯描述”→刷新，输入变空（07→08）。
- 复现 B：`/?scene=product-main` 输入“未保存商品草案审计”→启动 query 被消费→刷新，电商表单消失，回到普通空会话（16→17）。
- 当前/预期：当前无恢复或离开提醒；预期保留必要草稿，或明确提示即将丢弃。已保存方案能恢复，不混为持久化任务丢失。
- 原因：普通 composer 是内存 store；电商 `CommerceWizard.tsx:71` 及 `CommerceWorkspace.tsx:106` 使用局部 state；工作台启动时 `replaceState` 清理 scene。
- 修复方向：先定义会话/账号隔离的草稿结构和恢复标记，版本化存储必要字段，登出清理、过期处理；不序列化 File、blob URL 或敏感信息，不自动提交；参考图根据有效 ID 恢复，无法恢复的本地文件明确要求重新选择。
- 验证：普通/电商输入、参数、导航、刷新、切换账号、过期草稿、失效参考图；保存成功后草稿清理且已保存任务不重复创建。

### B04 · P2 · 图片预览混入其他已访问会话

- 页面/类型：图片 PreviewGroup，会话范围 Bug。
- 复现：电商会话完成 5 张→切到含 2 张结果的普通会话→打开第二张预览，显示 7/7→向前切至 5/7，出现电商图。
- 当前/预期：预览可跨入另一会话的图片；预期只浏览当前可见会话/明确选定的结果集合。没有跨账号访问证据。
- 证据/根因：截图 18；[UnifiedWorkspace.tsx:773](/Users/zzz/Desktop/work_space/Image-web/apps/web/features/workspace/UnifiedWorkspace.tsx:773) 外层共享 PreviewGroup，[CommerceWorkspace.tsx:339](/Users/zzz/Desktop/work_space/Image-web/apps/web/features/commerce/CommerceWorkspace.tsx:339) 等隐藏容器保留已挂载图片，仍参与预览注册。
- 修复方向：给预览显式当前会话 items 或合理组边界，保留隐藏草稿的编辑状态；不要用无差别卸载解决局部预览问题。
- 验证：A→B→A、普通↔电商、版本切换后数量/顺序正确；关闭后焦点恢复到来源图片。

### B05 · P2 · 重新生成后额度显示陈旧

- 页面/类型：普通图片重新生成、Composer 额度，数据展示 Bug。
- 复现：剩余 23 张→重新生成一张→第三个结果已完成，仍显示 23→刷新变为 22。
- 当前/预期：结果已更新，额度未同步；预期在服务端受理/状态协调后显示权威额度，失败时说明刷新状态。
- 证据/根因：19→20，Mock 数据；[UnifiedWorkspace.tsx:641](/Users/zzz/Desktop/work_space/Image-web/apps/web/features/workspace/UnifiedWorkspace.tsx:641) 的 recreate 路径没有像普通提交/聊天一样刷新额度，轮询也不负责额度同步。
- 修复方向：复用权威额度刷新机制，处理终态/退款后协调，避免前端猜测扣费或每帧请求。
- 验证：受理成功、提交拒绝、生成失败、退款以及多次重建时显示与网关一致；真实计费正确性需单独后端证据。

### B06 · P2 · 可用输入框占位文字对比不足

- 页面/类型：Composer，占位文字可访问性 Bug。
- 证据：真实计算样式为 `rgb(137,145,158)`、15px、opacity 1；`workspace.module.css:1515` 硬编码 `#89919e`。它与白色约 3.18:1，与 `#f5f5f7` 约 2.92:1；即使用当前浅色表面的最亮白底，仍低于普通文字 4.5:1。
- 当前/预期：启用的输入提示偏淡；预期在实际合成背景上达到适用文本标准，不用提高饱和度或发光补救。
- 修复方向：新增/规范 placeholder token，并检测玻璃表面最不利的背景；禁用内容与可操作字段分开，不混用同一个淡色。
- 验证：启用输入、长提示、不同内容背景的合成对比；普通文字 4.5:1、大字 3:1，标准依据见 [WCAG 2.2 对比度说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。本轮并非全站 WCAG 合规审计。

### B07 · P2 · CAPTCHA 完成后仍提示“请完成安全验证”

- 页面/类型：登录/密码恢复，状态文案 Bug。
- 复现：已有测试验证组件自动显示成功，提交控件解除 CAPTCHA 限制，下方仍显示“请完成安全验证后提交”。未进行人工解题或提交真实表单。
- 当前/预期：成功状态与帮助文案冲突；预期成功、未完成、过期、加载失败分别准确表达。
- 证据/原因：14、15；`use-auth-captcha.tsx:32` 只区分 scriptFailed / failed，成功回调未驱动帮助文案。
- 修复方向：在现有 hook 中同步验证状态，仅调整表现，不放宽 token 或服务端校验。
- 验证：加载、成功、过期、失败、重试；保留邮箱输入，token 失效时按钮再次禁用。

## 6. 待验证风险、交互建议和视觉问题

| ID / 类型 / 优先级 | 页面与证据 / 当前情况 | 预期、可能原因与处理方向 | 验证方式 |
|---|---|---|---|
| S01 疑似 P1 | 普通重新生成没有明显提交锁；每次调用构造新 request 对象。一次实际双击仅观察到一个新批次，**未确认重复提交或重复计费** | 用延迟网关检验新 request ID 与连续点击；如复现，再补齐提交锁与幂等身份，避免不必要改协议 | 可控延迟、双击/键盘连按、响应丢失后恢复，断言实际调用和批次数 |
| S02 疑似 P1 | 普通批次轮询 `UnifiedWorkspace.tsx:286` 对错误静默 catch，未看到 in-flight/响应顺序保护；正常 Mock 路径可完成 | 验证慢请求重叠、旧响应回写与持续失败；根据证据加取消/序号/可恢复状态，不能只吞异常 | 可控乱序、离页、连续 503、终态之后旧 processing 回来 |
| U01 交互 P2 | 顶部“资产库”看似可进入，点击仅提示尚未开放；现有测试明确把它当占位 | 明确“即将开放”或移出主操作区；本轮不新增资产库业务 | 点击/键盘都不承诺不存在的功能，已上传图入口保持可达 |
| U02 交互 P2 | 空工作台侧栏、页头、中心同时出现电商入口（01） | 保留固定导航与空态任务引导，减少顶部重复。属于局部入口整理，无需改造整站 IA | 新用户能找到普通/电商创建，进入返回不丢上下文 |
| U03 交互 P2 | 电商计划“开始生成”和“保存方案待确认”均为强蓝主操作（11） | 一个区域一个主操作；生成作为主按钮，保存待确认为次按钮，费用/张数靠近确认操作，不合并保存与生成 | 保存仍为零生成；确认张数准确，忙碌/禁用状态覆盖 |
| U04 交互 P2 | 目录“平台筛选”改变启动参数，但当前 6 场景数量不变；状态只在局部 state | 更准确命名为“发布平台”，并考虑 URL 保留选择；不虚构无结果筛选逻辑 | 每个平台对应启动参数正确，返回/刷新保留选择 |
| V01 视觉 P3 | 消息/任务/表单和外壳均有玻璃处理；后段 CSS 重复硬编码与覆盖 | 建立内容/操作/浮层三类表面，正文稳定，减少叠加模糊；逐组件迁移现有规则 | 同一数据/视口截图对比，真实明暗图片不改变本体色彩/锐度 |
| V02 视觉与兼容 P2 | 已有 reduced-motion / reduced-transparency 查询，未见可靠的实色优先增强方案；禁用效果未实测 | 先实色可读，再 `@supports` 增强；降低透明偏好是额外能力，不能作为唯一回退 | 关闭 blur 支持、减少透明/动态偏好、浮层层叠/点击/焦点分别检查 |

减少透明度查询的浏览器支持仍有限，参考 [MDN prefers-reduced-transparency](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)。实际模糊能力参考 [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)。本方案是 CSS 的 Web 材质启发实现，不宣称复刻 Apple 原生材质系统。

环境问题另记：注册页因当前法律版本配置不完整无法完成注册；这不是已确认前端 Bug。生产 HTTP、真实 Auth/Storage/Provider、跨连接并发、真实额度和当前线上电商基础设施本轮均未验收，不沿用旧记录推断当前状态。

## 7. 推荐设计方案

| 方案 | 收益 | 代价与判断 |
|---|---|---|
| A：只调整全局皮肤 | 视觉改动少 | 难解决按钮语义、状态恢复和 CSS 叠加；不推荐作为本次完整方案 |
| **B：共享规范 + 核心页面样板 + 逐页迁移** | 同时改善操作清晰度、可访问性与一致性，保留现有业务 | 需要小批次回归，最符合此次渐进改造，推荐 |
| C：整体重排信息架构与工作台 | 可重新组织复杂功能 | 牵涉用户习惯与流程，风险/范围明显变大；本轮不采用 |

### 材质与设计变量草案

优先整理已有 `--z-*`，不引入第二套并行主题。以下数值是待样板验证的提案，不是已验收样式。

| 类别 | 提案 | 用途与验收 |
|---|---|---|
| 页面底 / 内容面 | 延续 `#f5f5f7`；内容 `#fff` 或近实色 | 消息、表单和任务清楚可读，不对每张卡片独立 blur |
| 操作玻璃 / 浮层 | 中性白约 .82–.9；菜单近实色；blur 16–20px 起步 | 只作用于必要外壳，模糊量按实际背景/性能调节 |
| 文字 | 主 `#1d1d1f`；次级/占位优先收敛到现有 `#65656c` 一档；禁用另设 | 对实际合成背景验证，避免占位文字再硬编码淡灰 |
| 品牌与语义 | 保留 `#0066cc`；成功/警告/错误复用并校准组件库 token | 状态始终配文字/图标，不单靠颜色；完成状态不靠弱紫小标签 |
| 圆角 / 间距 | 控件 10–12、内容 16–18、操作外壳 24；间距 4/8/12/16/24/32 | 用途分级，保留桌面信息密度；不把所有内容都做胶囊 |
| 字号 / 图标 | 正文 14–15，说明 12–13；标题分级；图标 16/18/20 | 次级文本不以缩小和降低对比同时弱化 |
| 边框 / 阴影 / 焦点 | 内容用细边界，浮层用克制阴影；焦点用独立清晰外圈 | 检查淡底/图片背景/层叠裁切，不以阴影代替焦点 |
| 动效 | 操作反馈 120–160ms、浮层 180–220ms；沿用现有 ease 统一收敛 | 可中断、无持续闪烁；reduced-motion 下即时/淡化处理 |
| 层级 | 内容 → 固定操作区 → 菜单 → 模态 → 通知，统一维护 | 沿用 Ant Design portal 体系，避免负 z-index 或任意大数字互压 |

仅整理当前桌面布局所需变量；既有断点规则不作为本轮重写或验收范围。保持图片的真实呈现，缩略图统一明确的裁切规则，完整预览保持 contain，并检查明亮/深色/复杂图片上工具的可辨认性。

### 共享组件和样板

样板选 `/` 普通对话与图片结果：同时覆盖导航、输入、参数浮层、任务状态、图片与失败恢复，验证通过后再迁移电商和认证页。

优先规范 `UnifiedComposer`、`GenerationConfig`、`WorkspaceTimeline` 中的按钮、输入、状态提示、预览和工具栏。复用现有 Ant Design 组件的默认/hover/active/focus/disabled/loading/error 能力，必要时增加很薄的语义封装，不另建通用 UI 框架。电商表单保留逐图计划、保存、确认、版本选择和下载能力。

## 8. 确认后的实施顺序与退出条件

| 批次 | 具体范围 / 主要文件 | 回归和完成条件 | 主要风险 |
|---|---|---|---|
| 1 核心正确性 | 先稳定 T01 与构建环境，再处理 B01/B02/B04/B05；`UnifiedWorkspace`、`WorkspaceTimeline`、`CommerceWorkspace`、对应测试 | 先建立失败测试，再逐项最小修复；失败恢复一次请求，当前会话预览正确，额度协调准确；现有普通/电商路径继续通过 | 请求身份、部分流恢复和缓存表单不能相互破坏 |
| 2 共享规范 | `app/globals.css`、`app/providers.tsx`、工作台 CSS 与共享控件；B06 | 建立 token/状态表，清理已确认重复的规则；对比度、焦点、实色回退可用 | 组件库权重、portal 和层叠上下文 |
| 3 工作台样板 | 导航/Composer/参数浮层/结果；U01/U02，先不扩展资产库 | 1440×900 同数据截图；键盘、长文本、200% 页面放大、模态焦点、明暗图片工具；同条件性能比较 | 桌面空间和交互密度，不为装饰牺牲操作 |
| 4 草稿与电商迁移 | B03；Wizard/TaskCard/Catalogue；U03/U04 | 草稿隔离恢复；保存不生成，确认/部分选择/版本/导出保持契约；电商共享材质迁移 | 本地草稿寿命、失效参考图、重复创建 |
| 5 认证与全路径回归 | B07，认证相关共享样式，V02；复核 S01/S02 | CAPTCHA 所有状态；现有测试、build/typecheck/lint/E2E；输出剩余未验证项 | 真实账号和外部服务验收需独立授权与测试环境 |

每批独立报告改变的行为、涉及文件、验证结果和风险；不做依赖/框架/后端更换。只有证据确认后才将疑似项转为 Bug，不用等待时间或假进度掩盖后端状态。

## 9. 证据索引

截图均为改造前，保存在本地忽略目录；不会随文档自动进入 Git。以下为桌面 1440×900 当前视口截图，电商长页面通过滚动逐步检查，没有拼接冒充单屏。01–20 中选取的证据已视觉检查。

普通创建：主任务和输入区清楚，电商入口重复；内容卡片与操作外壳的材质仍需分层。

![改造前：普通工作台空状态](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/01-workspace-empty.png)

电商计划：逐图控制有效，但两个强主操作争夺注意力，保存与生成需要更清楚的层级。

![改造前：电商逐图计划](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/11-commerce-plan.png)

失败恢复：同一请求出现重复错误，唯一“重试”按钮未绑定行为。

![问题证据：重复错误与无效重试](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/13-chat-retry-no-effect.png)

历史图片浏览：普通会话中的预览切换到另一电商会话的图片，范围与当前上下文不一致。

![问题证据：跨会话图片预览](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/18-cross-session-preview.png)

| 编号 | 内容 | 本地文件 |
|---|---|---|
| 01 | 空工作台 / 重复入口 | [截图](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/01-workspace-empty.png) |
| 02 | 普通聊天完成 | [截图](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/02-chat-complete.png) |
| 03 | 图片参数浮层 | [截图](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/03-image-settings.png) |
| 04 / 05 | 普通结果 / 完整预览 | [结果](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/04-image-result.png) · [预览](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/05-image-preview.png) |
| 07 / 08 | 普通草稿刷新前后 | [前](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/07-unsent-draft-before.png) · [后](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/08-unsent-draft-after.png) |
| 09 | 电商场景目录 | [截图](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/09-commerce-catalogue.png) |
| 10 / 11 / 12 | 商品录入 / 逐图计划 / 完成结果 | [录入](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/10-commerce-wizard.png) · [计划](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/11-commerce-plan.png) · [结果](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/12-commerce-result.png) |
| 13 | 两条重复错误与无效重试 | [截图](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/13-chat-retry-no-effect.png) |
| 14 / 15 | 登录 / 密码恢复 | [登录](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/14-login.png) · [恢复](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/15-recovery.png) |
| 16 / 17 | 电商未保存草稿刷新前后 | [前](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/16-commerce-draft-before.png) · [后](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/17-commerce-draft-after.png) |
| 18 | 普通会话预览出现其他会话电商图 | [截图](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/18-cross-session-preview.png) |
| 19 / 20 | 重新生成完成后 23 张 / 刷新后 22 张 | [前](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/19-recreate-quota-stale.png) · [后](/Users/zzz/Desktop/work_space/Image-web/.design-qa/liquid-glass-audit-2026-09-09/screenshots/20-recreate-quota-after-reload.png) |

当前只请求确认：采用方案 B，按第 8 节顺序开始桌面 Web 小批次实施。确认前保持业务、样式与接口代码不变。


实施跟进：用户随后确认“开始”，第一批核心正确性结果见[批次验收记录](./2026-09-08-desktop-batch1.md)。以上审计结论为修改前快照，当前状态以 `doc/project-progress.md` 为准。
