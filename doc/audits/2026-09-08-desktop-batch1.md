# 桌面 Web 渐进重构：第一批核心正确性

范围来自[体验审计第 8 节](./2026-09-08-desktop-liquid-glass-audit.md)：用户确认“开始”后，在当前 `codex/phase2` 本地 checkout 实施 T01、B01、B02、B04、B05。保留现有业务、接口与依赖，仅验证桌面 1440 × 900。本批不包含后续共享设计变量、视觉样板、草稿持久化与认证改造。

## 变更及验收要点

| 问题 | 根因与修复 | 文件 | 回归证据 |
| --- | --- | --- | --- |
| T01 Node 26 下测试失败 | 原生 localStorage 的 undefined 遮蔽 jsdom；只在测试启动环境恢复 jsdom 自己的 Storage | `apps/web/vitest.setup.ts` | 原 Mock 网关测试 9 过 1 失败 → 10/10 通过；不替换生产网关 |
| B01 聊天重试无行为 | 错误按钮缺少回调；会话运行时保存原模型和提示词，失败重试使用原请求并同步防重复；当前未发送草稿不受影响 | `UnifiedWorkspace.tsx`、`WorkspaceTimeline.tsx`、`chat-recovery.ts` | 点击两次只增加一次请求；切换模型后仍使用原模型；重试后回复可见且草稿保留 |
| B02 同一次失败重复展示 | 本地错误随机 ID 与持久化错误 ID 不同；按会话、已知历史、请求内容及服务器 turn 对应，优先稳定 ID | 同上 | 单次失败仅展示一次；部分流文本保留，SSE ID 去重；相同内容存在歧义时保留证据，不猜测归属 |
| B04 跨会话预览串图 | 隐藏但挂载的电商卡片/向导注册进外层 PreviewGroup；分别隔离预览集合 | `CommerceWorkspace.tsx` | 先访问 5 张电商图，再生成 2 张普通图：预览仅 2/2，左右键可用；切换回隐藏草稿仍保留商品名称 |
| B05 重新生成后额度陈旧 | 重新生成成功后未重新读取额度；新增提交后及终态协调，响应版本防止旧额度覆盖新值 | `UnifiedWorkspace.tsx` | 重新生成后无需刷新，29 → 28；延迟旧响应返回也不覆盖终态额度 |

刷新后的错误历史缺少原模型快照，因此提供“重新编辑”恢复文本供用户审阅；输入已有其他草稿时保留草稿并提示，不自动发送。运行时快照不写入 API、数据库或持久化存储。

新增回归：`apps/web/tests/chat-recovery.test.ts`（8 项纯逻辑）、`unified-workspace-recovery.test.tsx`（4 项组件集成）、`apps/web/e2e/chat-recovery.spec.ts`（2 项桌面路径）、`preview-scope.spec.ts`（1 项跨场景路径）。原实现的失败日志和复核报告保存在 `.design-qa/liquid-glass-batch1/`。

## 检查记录

运行环境：Node 26.3.0、Corepack 固定 pnpm 11.19.0、Mock 数据模式、认证关闭；Chromium 151.0.7922.34，1440 × 900；重型检查串行。

全量检查暴露原电商测试的异步断言竞态：任务卡片由子层加载出现，聊天框须等 `onModeChange` effect 通知父层后才隐藏。`commerce-ui.test.tsx` 保留原断言，改用 `waitFor` 等待真实 UI 条件；不增加固定延时。

实际命令（在仓库根目录，PATH 使用 `.design-qa/liquid-glass-batch1/bin` 的 Corepack shim 与 Node 26）：

```sh
pnpm lint
pnpm typecheck
pnpm test:run
# 全量唯一失败是上述异步断言；修改后单独复跑该用例：
node apps/web/node_modules/vitest/vitest.mjs run --root apps/web tests/commerce-ui.test.tsx -t 'commerce uses explicit five-slot'
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 pnpm e2e --workers=1 --grep 'opens image parameters' --update-snapshots
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3110 pnpm e2e --workers=1
NEXT_DIST_DIR=.next-liquid-batch1-build NEXT_PUBLIC_DATA_MODE=mock NEXT_PUBLIC_PHASE2_AUTH=false NEXT_TELEMETRY_DISABLED=1 SENTRY_AUTH_TOKEN='' SENTRY_DSN='' NEXT_PUBLIC_SENTRY_DSN='' pnpm build
```

- Lint、Typecheck：通过（含最终新增测试）。Lint 保留既有 Next pages 目录提示，退出码 0。
- `pnpm test:run`：领域 41/41；Web 332 通过、1 个异步断言失败，共 333。仅修改该测试等待边界后，该用例单独复跑通过，其他 25 项因 `-t` 过滤未执行；全量中的其他 332 项证据仍保留。没有声称修改后重新执行了整套 Vitest。
- Build：通过；隔离 `.next-liquid-batch1-build`，编译 29.5 秒，Next 类型检查和页面生成成功；恢复构建改写的 `next-env.d.ts`。
- T02：单独更新 `parameters-open-chromium-desktop-darwin.png`，人工检查为当前电商入口而非旧 Skill UI；没有放宽 2% 差异阈值。

- 桌面 E2E：首次 29 通过、1 跳过、1 新测试选择器失败。Ant Design 两字按钮的可访问名称为“重 试”，选择器改为匹配中间空白后，完整聊天恢复用例复跑通过。另复跑预览用例通过并关闭截图动画，归档清晰终态截图。综合覆盖 30 个通过路径、1 个认证条件跳过；未声称全量首次全绿。

## 截图证据

截图目录：`.design-qa/liquid-glass-batch1/screenshots/`。下列是同一桌面视口下的功能前后证据，提示词、会话数量等并非严格相同，不作为像素或性能比较。

| 场景 | 修改前（审计目录） | 修改后（本批目录） |
| --- | --- | --- |
| 失败与重试 | `../liquid-glass-audit-2026-09-09/screenshots/13-chat-retry-no-effect.png` | `single-failure.png`、`retry-preserves-draft.png` |
| 跨会话预览 | `../liquid-glass-audit-2026-09-09/screenshots/18-cross-session-preview.png` | `isolated-preview.png`（2/2） |
| 重新生成额度 | `../liquid-glass-audit-2026-09-09/screenshots/19-recreate-quota-stale.png` | `recreate-quota.png`（无需刷新显示 28） |

原有空工作台截图断言通过；参数面板在相同默认数据、视口的截图已人工审查并更新基线。未改变其他截图阈值或基线。

## 边界与后续

- 不修改请求协议、数据库、Worker、模型计费规则或依赖版本；没有部署、提交或推送。
- 无响应式、移动/平板或跨浏览器兼容性结论；真实认证、付费模型及生产并发未在本批验证。
- 极端相同文本且缺少服务器身份的失败可能暂时保留两份证据，这是可见的保守降级，避免丢失未保存请求。未来若需完全消除此歧义，应单独评审请求身份协议。
- B03 草稿持久化、B06 对比度、B07 CAPTCHA 和 S01/S02 待后续批次；未将已有疑点宣称为已修复。
- 本批没有新增设计变量；后续统一变量与组件仍按审计方案 B 进行。

性能：未执行严格同条件的前后基准。审计旧记录为不同浏览器版本、开发模式、竞争负载下的单次导航，不能与本批比较。此次新增内存内失败映射和预览 Context，重新生成及批次终态新增额度读取；大量失败历史和多批次同时完成的开销未量化，不宣称性能提升。

可直接查看：[单次失败](../../.design-qa/liquid-glass-batch1/screenshots/single-failure.png)、[重试后保留草稿](../../.design-qa/liquid-glass-batch1/screenshots/retry-preserves-draft.png)、[预览范围](../../.design-qa/liquid-glass-batch1/screenshots/isolated-preview.png)、[额度更新](../../.design-qa/liquid-glass-batch1/screenshots/recreate-quota.png)。
