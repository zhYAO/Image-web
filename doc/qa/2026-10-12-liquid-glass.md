# 2026-10-12 分层材质与轮播验收

本轮用户选择“分层精致”并授权实施；交付范围为 `codex/apparel-scroll-seedream5-20261012` 的提交推送，未合并或发布。基线为 `f35fe5b9cdb4a950fd1e6eb9e74392d927665d48`，此处为新的 Codex 云任务工作区，独立于父会话原 dot 云电脑文件系统。设计规范见根 `DESIGN.md`，当前交付状态以 `doc/project-progress.md` 为准。

## 自动化结果

| 检查 | 终态结果 | 证据 |
| --- | --- | --- |
| 全量单测 | Domain 76/76（10 文件），Web 642/642（94 文件） | `logs/final-complete-tests.log` |
| 主题 / 材质 / 轮播专项 | 17/17 | `logs/all-regressions.log` |
| 预算保护 | 5/5 | `logs/budget.log` |
| lint / typecheck | 退出 0 | `logs/final-lint.log` / `logs/final-types.log` |
| 标准构建 | Next.js 16.3 Turbopack Mock，退出 0，45 页面 | `logs/final-build.log` |
| 源码一致性 | 浏览器与构建副本各核对 505 文件 | `runtime-source-verification.json` / `build-source-verification.json` |

证据目录为 `/workspace/scratch/ZImage-liquid-glass-implementation-20261012/`。完整检查不新增依赖；命令级关闭 pnpm 自动安装，隔离构建仅复制已有依赖并确保链接留在副本内。构建使用已屏蔽外部访问的 Mock 环境，不代表生产服务就绪。早期未修复的单测失败和主题派生不一致记录保留，最终结果来自修复后的单次全量运行。

## 实际浏览器结果

使用 Chromium 151、1440×900 桌面及窄窗口模拟。服务器只允许本地 Mock，浏览器只允许本地资源，没有提交真实生成或连接生产数据库。

- 最终首页：`after-light-1440.png`、`after-dark-1440.png`；五张图片均加载、三张可见，首端禁用上一张，默认静止。720px 单卡见 `after-narrow-720.png`。
- 运动证据 `interaction-evidence.json`：轨道节点和五条链接身份不变，下一张 -292px、上一张 0；拖动 140px 跟随 -140px，释放吸附 -292px，opacity 保持 1，无误导航。显式播放按 6 秒前进并在末端停止。
- 减少动态、透明度与强制颜色见 `after-reduced-1440.png`、`after-opaque-1440.png`、`after-forced-1440.png`；减少动态停播放且去除缓动，减少透明度/高对比/强制颜色关闭导航、侧栏与短浮层滤镜和高光。
- 深色模型浮层在视口内，见 `after-dark-model-popover.png`。目录保留五条真实入口，商品套图实际导航成功，见 `catalogue-navigation.json`、`after-dark-catalogue.png`。
- 最终服装回归见 `apparel-scroll-regression.json`：1440×900/720/600 左右分别滚动，1100×900、720×900、600×720 使用现有单滚动拥有者，末尾输入与30张本地合成预览可达，操作条位移小于2px，body/外层无跟随滚动且无横向溢出。预览夹具仅写临时浏览器 Mock 数据，未调用排版或付费渲染，积分保持不变。

## 独立复审

最终 Critical 0 / Important 0 / Minor 0，范围限定已检查的改动。审查证据位于 `/workspace/scratch/ZImage-liquid-glass-review-20261012/`：`recheck-evidence.json`、`fixture-metadata.json`、`ssr-light-controls.png`、`ssr-dark-controls.png`、`quantity-evidence.json`。

复验包含焦点提交时机、窗口收敛、指针离开/取消后拖动、播放末端停靠；Lobe/AntD 实际12项派生令牌浅深一致；无脚本真实 SSR 样本及运行页面的主按钮正常/hover/active、Text/Disabled/Input/Select 颜色；深色数量字段及更多说明文字、高对比关闭高光。首页 `WorkspaceApplication` 使用客户端渲染，所以首页首绘属性采样与控件 SSR 夹具各自保留，未扩大为全站 SSR 结论。

## 截图交付与边界

代表性截图另存为 `ZImage-liquid-glass-light-Mock-20261012.png`、`ZImage-liquid-glass-dark-Mock-20261012.png`。Library 官方批量上传助手在读 `tools/list` 时两次报 `network`，未进入准备、传输或创建。Library 原生只读查询成功；按用户补充指令逐一使用运行时直接暴露的 `create_library_file`，两张均返回 `succeeded`，本地文件已写回返回的版本元数据。

| 截图 | Library ID |
| --- | --- |
| 浅色首页 Mock | `libfile_5c5f919f59b881919e73151c2488e12c` |
| 深色首页 Mock | `libfile_a82b646499308191907da7c5a6f2c602` |

成功记录见 `library-saved.json`；助手原失败日志私有保留，未打印 URL/凭据或修改认证/网络配置，没有使用其他外部服务。

本轮未执行生产 Auth/Storage、Safari/Firefox、真实触摸/触控板、原生200%缩放或 GPU 性能验收。没有部署、生产迁移、供应商付费请求或生产 Secrets 改动；暂存验收脚本位于仓库外，没有恢复 Playwright/E2E 工程。临时 Next/Chromium 已停止。现有 CI 的 push 匹配 setup2/main，生产构建限定 main 非 PR，不为此次开发分支交付创建发布任务。
