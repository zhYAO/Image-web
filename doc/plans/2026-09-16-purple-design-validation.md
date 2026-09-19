# ZImage 浅色紫系改造与本地验收

日期：2026-09-16。范围：现有桌面 Web 页面、共享主题与展示结构。状态：本地实现与自动化验证完成；原生 200% 缩放待验，不代表真实环境或生产验收。

## 实施范围

- 根布局统一使用 AppProviders；AuthStatusProvider → CreditsProvider 的单实例与依赖关系不变。
- CSS 变量、LobeHub 紫色预设与 Ant Design 精确主题共用同一色板。普通按钮 40px，表单及主操作 44px；圆角 12/18/24px，动效 160/220ms。
- 导航、侧栏外壳保留轻玻璃；聊天输入、正文、方案、结果、登录和账户改为实色。图片使用中性白灰背景，完整显示。
- 目录按 1280/1440/1920px 使用 3/4/5 列；女装封面在 4:5 容器内完整展示并明确标注。旧技能路由继续跳转目录。
- 电商资料宽度 320/340/380px，结果按实际容器宽度排列；长表单滚动、操作区、编号、选择、旧图与版本入口保留。
- 登录改为最大 440px 的单列表单；账户最大 1040px、协议最大 760px；危险操作保留确认机制。
- 键盘焦点独立紫色外圈，组合控件只绘制一圈；减少动画、减少透明度、模糊不支持和强制颜色模式提供样式降级。
- 模型健康与生成状态标签使用语义色；截图审查发现的浅绿预设已改为规范中的深绿文字。待核对和部分完成使用警告色，同时保留原状态文字。
- 浏览器颜色断言发现继承的 LobeHub 算法会重新改写种子色。内层 Ant Design 显式采用标准算法，继续共用同一组精确色值与组件配置；不通过放宽对比度要求消除失败。
- 素材库当前仍未开放。本次保留原提示，统一已有的生成结果网格；没有新增素材库流程。

## 主要实现位置

| 范围 | 文件 |
| --- | --- |
| 主题与根布局 | [theme.ts](../../apps/web/app/theme.ts)、[providers.tsx](../../apps/web/app/providers.tsx)、[style-registry.tsx](../../apps/web/app/style-registry.tsx)、[layout.tsx](../../apps/web/app/layout.tsx)、[globals.css](../../apps/web/app/globals.css) |
| 工作台与状态 | [workspace.module.css](../../apps/web/features/workspace/workspace.module.css)、[GenerationConfig.tsx](../../apps/web/features/workspace/GenerationConfig.tsx)、[WorkspaceTimeline.tsx](../../apps/web/features/workspace/WorkspaceTimeline.tsx) |
| 电商目录与创作 | [commerce.module.css](../../apps/web/features/commerce/commerce.module.css)、[CommerceCatalogue.tsx](../../apps/web/features/commerce/CommerceCatalogue.tsx)、[CommerceTaskCard.tsx](../../apps/web/features/commerce/CommerceTaskCard.tsx) |
| 认证与账户 | [AuthPanel.tsx](../../apps/web/features/auth/AuthPanel.tsx)、[AccountPanel.tsx](../../apps/web/features/account/AccountPanel.tsx) |
| 桌面新增检查 | [purple-design.spec.ts](../../apps/web/e2e/purple-design.spec.ts) |

## 首屏与依赖处理

将主题移到根布局后，LobeHub 的 Emotion 全局样式曾造成 SSR 与浏览器首屏不一致。新增 `StyleRegistry`，按已安装 Next.js 文档使用 `useServerInsertedHTML` 收集样式，保持服务端页面输出。新增水合错误的浏览器回归断言。

`@emotion/cache`、`@emotion/react` 均为已经安装的 11.14.0 传递依赖，本次提升为显式依赖，未升级版本。离线锁文件校验期间发生本地依赖链接缺失，导致第一轮全量单测中断；按原锁文件恢复依赖后重新验证，不能将中断的单测算作通过。

## 验证记录

- 使用 Node 24.19.0、pnpm 11.19.0。
- 独立 Mock 开发服务：3140，构建目录 `.next-purple-mock`；保留原有服务。
- 规划阶段全量 Web 单测主动中止；领域单测 56 项通过。该记录不替代实施后回归。
- 第一轮实施检查 lint、typecheck 通过。实施期间全量单测因依赖链接缺失中断；其中一项生成完成等待出现超时，已将反复扫描整棵可访问树改为先等待终态文本，再检查原按钮可用性，未放宽断言或超时时间。
- 首轮完整桌面 E2E：59 通过、1 个真实认证后端用例按范围跳过、2 个预期截图差异；功能流程无失败。专项中新增侧栏宽度断言曾同时匹配两处 `aside`，已限定会话栏；完整回归中的三档布局通过。
- CSS 变量引用检查：63 个共享变量，无未定义引用。图片、交互和截图检查在独立 Mock 生产服务 3141 执行，构建目录 `.next-purple-build`。
- 最终完整单测单次全绿：Domain 6 文件 / 56 项，Web 64 文件 / 439 项，共 495 项。Web 耗时 1348 秒；没有跳过失败用例或放宽单测超时。
- 最终 `pnpm lint`、`pnpm typecheck`、`git diff --check` 通过；独立 Mock 生产构建通过，已还原自动生成的 `next-env.d.ts`。
- 最终完整桌面 E2E：**61 通过、1 项真实认证后端用例按范围跳过、0 失败**，耗时 8.9 分钟。最后一轮未更新截图基线；仍使用原 `maxDiffPixelRatio: 0.02`。
- 最终浏览器抽样合成色检查：普通文字 ≥4.5:1，必要输入边界 ≥3:1；模型健康标签实测使用 `#237449`，满足 4.5:1。关闭按钮为焦点圈预留至少 6px，三档布局、完整图片、门户弹层焦点与遮罩清理、首屏水合、减少动画/透明度、强制颜色测试均通过。
- 两张原有工作区截图基线经人工查看实际图和差异图后更新；最终空态与参数弹层截图在不更新基线的全量运行中通过。额外四项设计回归测试保留在仓库。

运行日志保存在本地忽略目录 `.design-qa/2026-09-16-purple/`：`unit-final.log`、`lint-final.log`、`typecheck-final.log`、`build-final.log`、`e2e-final.log`。中断轮次及主题颜色修正前后的日志保留，未以最终通过覆盖它们的失败结论；可分享截图另存于 `doc/assets/design-purple/`。

## 截图

规划阶段截图来自改造前页面；视口与页面状态不同，只用于视觉参考，不作为像素级对照。以下改造后截图来自最终 Mock 生产构建；结果图片为 Mock 数据，不是实际模型生成效果。

| 页面 | 改造前 | 改造后 |
| --- | --- | --- |
| 创作目录 | [原目录](../assets/design-purple/before-catalogue.jpg) | [四列目录](../assets/design-purple/after-catalogue-1440.png) |
| 工作区 | [原工作区](../assets/design-purple/before-workspace.jpg) | [统一工作区](../assets/design-purple/after-workspace.png) |
| 登录 | [原双栏登录](../assets/design-purple/before-login.jpg) | [居中实色表单](../assets/design-purple/after-login.png) |
| 账户 | — | [积分账户](../assets/design-purple/after-account.png) |
| 电商创作 | — | [方案编辑](../assets/design-purple/after-plan-editor.png)、[结果](../assets/design-purple/after-results.png) |
| 参数弹层 | — | [参数与状态标签](../assets/design-purple/after-settings.png) |

| 桌面视口 | 目录 | 工作台 |
| --- | --- | --- |
| 1280px | [3 列](../assets/design-purple/after-catalogue-1280.png) | [320px 资料栏](../assets/design-purple/after-workbench-1280.png) |
| 1440px | [4 列](../assets/design-purple/after-catalogue-1440.png) | [340px 资料栏](../assets/design-purple/after-workbench-1440.png) |
| 1920px | [5 列](../assets/design-purple/after-catalogue-1920.png) | [380px 资料栏](../assets/design-purple/after-workbench-1920.png) |

## 明确的验收边界

- 原生 Chrome 200% 缩放尚未验证。浏览器工具的缩放快捷键未改变页面缩放，设置页被工具安全策略禁止访问；未通过替代途径绕过，不把窄视口测试等同原生缩放。
- 浏览器验收限桌面 Chromium；减少透明度、减少动画和强制颜色模式已实测。不支持模糊效果的 `@supports` 降级规则已静态核查，未在缺失该特性的浏览器中实测。
- Mock 覆盖不等于真实认证、Storage、Worker、模型效果、真实计费或线上验收。
- 未执行真实付费生成、数据库迁移或部署。保留真实业务状态和确认生成、恢复、版本、下载规则。
