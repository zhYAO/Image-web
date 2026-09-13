# 第二批：共享设计变量与控件状态

用户在第一批交付后确认“继续”，本批落实原审计方案 B 的第二批。范围为 `apps/web/app/globals.css`、`app/providers.tsx`、`features/workspace/workspace.module.css` 和桌面浏览器回归；保留第一批未提交修改。业务、接口和依赖不变。

## 变量维护规范

CSS 以现有 `--z-*` 为唯一命名体系；AntD 需要根据颜色推导色板，`providers.tsx` 保留对应字面量并标注同步关系。修改主题时两处一起检查，不传 CSS 变量给颜色运算，不增加第二套组件框架。

| 用途 | 变量和值 | 使用规则 |
| --- | --- | --- |
| 主/次级/占位文字 | `--z-text #1d1d1f`、`--z-muted/placeholder #65656c` | 启用输入不使用禁用色；占位 opacity 1 |
| 禁用 | `--z-disabled #8b8b92`、`--z-disabled-bg #ececef` | 保留语义 disabled；无 hover/active 色或键盘焦点圈 |
| 品牌 | primary `#0066cc`、hover `#005bb5`、active `#004f9e` | 主操作、选中和链接；不以颜色独自表达状态 |
| 语义 | success `#237449`、warning `#995400`、error `#b42318` | 同步组件库语义色，沿用现有文字和图标 |
| 玻璃/实色 | panel 白 .86、strong 白 .96、control-bg 白 | 文字密集或输入区域用 strong / 实色；blur 20px |
| 圆角 | control 12、content 18、shell 24 | `sm/md/lg` 为兼容别名；既有特殊图片/消息形状后续样板再迁移 |
| 焦点 | focus `#0066cc`、键盘外圈 3px | Native/AntD 一致；组合控件外框承接，内输入不重复画圈 |
| 间距/字号 | space 4/8/12/16/24/32；body 14、description 12 | 后续样板的选择范围，本批不批量改变桌面布局 |
| 时长 | fast 160ms、overlay 220ms | 控件反馈/浮层；reduced-motion 抑制到达动画 |
| 层级 | sidebar 8、dock 10、affordance 12、popover 30、feedback 40 | 保留原相对顺序；AntD portal 默认 1000 不变 |

## 状态规则与修复

- B06：删除两处冲突的淡色 placeholder 声明，统一可读的 placeholder token；输入外壳提高至 .96 不透明度。测试从真实计算样式取得颜色，用黑色背板合成最不利情况，要求至少 4.5:1。
- 保留一个 Composer focus-within 定义与一个发送禁用定义；清除完全被覆盖的旧 commerceNav 声明。合并 globals 的 `.glass-card` 重复规则，未大规模重排工作台 CSS。
- hover/active 不命中 disabled；启用输入、链接、按钮、下拉和组合输入提供清楚的键盘焦点；Escape 关闭参数面板后仍回到触发按钮。
- 减少透明度和不支持 backdrop-filter 时回退至不透明表面；减少动画时保留可用状态、抑制装饰到达效果。减少透明度分支已实测；无 backdrop-filter 支持的分支仅完成源码/编译规则检查，未在旧浏览器实测。支持现代滤镜的 Chromium 不等于旧浏览器兼容性已验收。

## 验证

Node 26.3.0、固定 pnpm 11.19.0、Mock/认证关闭、Chromium 151.0.7922.34。Lint、Typecheck 通过；`pnpm test:run` 领域 41/41、Web 333/333（51 文件）通过。所有浏览器检查固定桌面 1440×900，不进行响应式或手机/平板检查。

B06 原实现失败：最暗合成背景对比度约 2.30:1，低于 4.5；原截图 `.design-qa/liquid-glass-batch2/screenshots/before-placeholder.png`。最初脚本错误定位 CSS 模块祖先，已依据真实 DOM 修正，再取得以上实际失败；不将脚本错误算作产品 Bug。

修复后相同最暗合成背景约 5.30:1。`shared-controls.spec.ts` 三项浏览器检查通过：占位文字、键盘外圈与禁用动作、减少透明度/动画下的 Composer 和参数面板。下拉组合控件焦点也已验证；测试等待过渡后的真实终态，不使用固定延时。

审查补充修复：danger hover/active 的选择器权重、禁用 Composer placeholder 的启用覆盖；最终只读复核没有剩余可操作问题。减少透明度检查也复现了编译后 CSS 丢失 `backdrop-filter:none`，将 vendor prefix 放在标准声明之前后，浏览器实际滤镜为 `none`。

截图：[改造前](../../.design-qa/liquid-glass-batch2/screenshots/before-placeholder.png)、[改造后](../../.design-qa/liquid-glass-batch2/screenshots/after-placeholder.png)、[键盘焦点](../../.design-qa/liquid-glass-batch2/screenshots/keyboard-focus.png)、[实色和减少动画](../../.design-qa/liquid-glass-batch2/screenshots/solid-reduced-motion.png)。前后均为新 Mock 空会话、桌面 1440×900、无焦点输入，禁用截图动画。

执行命令（使用上一批 Corepack shim / Node 26 PATH，日志在 `.design-qa/liquid-glass-batch2/logs/`）：

```sh
pnpm lint
pnpm typecheck
pnpm test:run
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 pnpm e2e --workers=1 --grep 'enabled composer placeholder|shared controls expose|reduced transparency uses'
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 pnpm e2e --workers=1 --grep 'matches the desktop empty|opens image parameters' --update-snapshots=all
```

两张原有截图先按原 2% 阈值通过；为使基线反映本批新主题，随后只对空工作台和参数面板执行 `--update-snapshots=all`，逐图检查后保存。其余基线和阈值不变。相同默认数据的参数对比：[之前](../../.design-qa/liquid-glass-batch2/screenshots/before-parameters.png)、[之后](../../.design-qa/liquid-glass-batch2/screenshots/after-parameters.png)。

最终检查：

- `pnpm build` 通过，使用 `.next-liquid-batch2-build`、Mock、认证关闭和空 Sentry DSN/token；编译、类型检查、静态页面生成成功。已恢复生成器改写的 `next-env.d.ts`。
- 完整桌面 `pnpm e2e --workers=1`：32 通过、1 认证条件跳过、1 个新增下拉焦点断言失败。核对浏览器 CSSOM 后确认外框规则有效，但同步取色读到了 AntD outline 过渡的中间色；改用 `expect.poll` 等待终态后完整共享控件用例复跑通过（7.8 秒）。累计 33 条通过路径，1 条跳过；不称首次全量全绿。
- 全量 E2E 中占位对比度、减少透明度/动画、第一批恢复路径、两张桌面视觉基线均通过。新焦点断言修改不影响生产代码；构建、完整 Vitest 对应同一最终生产代码。
- `git diff --check` 通过；最终代码审查无未解决事项。没有改动测试阈值或依赖/锁文件。

构建及最后复验命令：

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 pnpm e2e --workers=1
NEXT_DIST_DIR=.next-liquid-batch2-build NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_PHASE2_AUTH=false NEXT_TELEMETRY_DISABLED=1 SENTRY_AUTH_TOKEN='' SENTRY_DSN='' NEXT_PUBLIC_SENTRY_DSN='' pnpm build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 pnpm e2e --workers=1 --grep 'shared controls expose'
```

## 边界

本批不是完整页面视觉样板，尚未迁移所有局部硬编码颜色或间距。没有新增深色模式，现有产品固定浅色。严格性能前后比较、200% 页面放大、明暗图片工具及长文本布局属于下一批样板验收；本批不据 blur 半径缩小宣称性能提升。生产认证、支付模型、数据库/Worker、跨浏览器未验证；无部署和 Git 提交。
