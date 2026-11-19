# 构建代码包优化：2026-11-19 本地验证

本次从精确 `3b209c93ce424079675c7848f06eaf0e63c24ae2` 独立分支继续，只修改共享 Markdown 的高亮构造入口及其测试。D1M20251119094 / Windows x64 / Node 24.19.0 / pnpm 11.19.0。依赖和锁文件不变，不安装软件，不操作 GitHub、Actions、ECS、数据库或发布。既有 `5be6af2` 方案保留，未推送或运行。

## 实际改动与功能边界

`SafeMarkdown.tsx` 之前构造 `createHighlighterCore()`，其返回对象同时绑定 codeToHtml/codeToHast。实际模块审计发现，这使仅消费 token 的界面也携带 hast-util-to-html、stringify-entities 及 HTML 实体表。

新增 `token-highlighter.ts` 仅组合固定 Shiki 4.4.3 已导出的公开 `createShikiPrimitiveAsync` 和 `codeToTokens`。它们也是原 createHighlighterCore 实际调用的同一套实现。不改依赖源码，不替换正则引擎，不复制或改写语言定义；保留 loadLanguage/dispose、14 种语言、github-dark、按需加载、未知 fence 的完整转义文本与复制行为。原 UI、字号/字重及浏览器不声明字体的策略不变。

## Vite 实测，未压缩普通文件内容

同图默认模式，同 namespace `local-images-raw`，同合成兼容描述；不是外置图片模式。完整执行类型检查、Vite client、Vite SSR、公共资源复制、5 页预渲染、app shell 和 check-dist。1 MB = 1,000,000 B；不计目录/链接对象，不报告压缩或网络传输量。

| 分类 | 3b209c9 文件数 / B | 本次文件数 / B |
| --- | ---: | ---: |
| JS | 27 / 2,120,008 | 27 / 2,087,876 |
| CSS | 6 / 293,284 | 6 / 293,284 |
| 示例图片 | 62 / 8,067,881 | 62 / 8,067,881 |
| HTML | 6 / 72,884 | 6 / 72,884 |
| 其他公共资源/许可 | 6 / 8,196 | 6 / 8,196 |
| 字体 | 0 / 0 | 0 / 0 |
| payload | 107 / 10,562,253 | 107 / 10,530,121 |
| 内部候选元数据（单列） | 1 / 534 | 1 / 534 |
| dist 全部普通文件 | 108 / 10,562,787 | 108 / 10,530,655 |

实际 JS 和 payload 均减少 **32,132 B**。CSS、62 图及许可文件的逐文件 SHA256 与基线完全一致；HTML 的入口 URL 随 chunk hash 改变，文件数/字节相同。元数据仍绑定真实本地提交，不能用于宣称正式生产准入。

大块按实际落盘字节：React DOM/Zod 等主入口 371,897 B；TypeScript 181,080 B；Markdown/消息块 178,798 B；JSX 177,792 B；TSX 175,536 B；JavaScript 174,827 B；Workspace 173,577 B。四个 JS/TS 家族块分别是不同的上游完整语法，并非同一模块被重复发布；没有为缩小体积删语法。原高亮 core 块 95,404 B，token-only 块为 63,706 B；其余差值来自相关 import/preload 代码。

临时模块图对照确认 24 个模块节点退出，包括 HTML 序列化链及部分零字节再导出节点；这不等于删除 24 个依赖包。Rollup renderedLength 只用于归因，表内数字全部取最终实际文件，而非模块长度相加。

## 后端独立审查：确证和未证范围

只读查看原工作区既存 Windows `.next`：BUILD_ID 是历史随机标记，配置 ZIMAGE_BUILD_SHA=development、依赖 Next 16.4.1，不是本候选。73 份 NFT 清单解析得到 1,234 个去重实际目标；Shiki、Sentry、setup-dev-bundler、next-dev-server、esbuild、vitest 的目标均为 0。因此没有证据支持从新后端运行依赖中额外删除这些包。

历史 NFT 目标按真实解析文件去重归属，最大依赖为 @img/sharp-win32-x64 19,796,406 B/5 文件，Next 11,559,339 B/800 文件，react-dom 1,312,879 B/14 文件，sharp 450,587 B/27 文件。这里是历史 Windows 追踪输入，不是本次发布体积或 Linux 尺寸；不与前端相加。原生图像库是有效运行依赖，未裁剪。

精确官方 Next 16.4.5 本地源码包 `dist/build/collect-build-traces.js:185-219` 证实 `next-server` 排除键被生产 NFT ignore 使用；`:437` 起再次应用路由排除。当前 slim 规则只有两个经审查的开发根。上游自身已排除 dev/webpack/CLI upgrade/testmode parser 等明确路径，不能据目录名继续扩大排除。当前 Next 配置与打包/原生探针未改。

共享的 token-only 源码也供 Next 消费，但没有新的 Next 冻结构建，因此不宣称 server/browser/runtime 层已减少任何字节。已确认缺 next@16.4.5 及 @next/swc-win32-x64-msvc@16.4.5 的可信完整安装，原标准下载已超时；本轮没有重复安装、重用旧包冒充或规划新 CI。

保留 measure-dist 原有 release-relative path 去重与 static/public 后覆盖逻辑，已有 8 项计数回归全部通过，覆盖分类互斥、诊断/禁发原图排除、开发入口拒绝、部分输入拒绝、UTF-8 链接文本不当作文件内容和真实复制结果对照。没有重写测试或放宽生产保护。

## 验证与证据位置

- frontend typecheck 通过。
- 4 项高亮测试通过：14 语法加载；全部 token 的位置/颜色/样式/文本与原构造器一致（含空文本、Unicode/CRLF、转义内容）；未知 fence 回退与精确复制。
- measure-dist 既有 8 项回归通过；夹具只是计数测试，不是应用大小实测。
- 完整 Vite 生产流程通过，未使用生产密钥；产物 CSS/HTML 无 font-family、font-face、字体 CDN 或字体预加载，字体文件为 0。
- 临时审计 JSON 和精确文件 SHA 位于 task 根目录的 `zimage-code-size-module-*.json`、`zimage-code-size-historical-trace-audit.json`、`zimage-token-only-final-20261119-raw.json`；最终真实 dist 快照为 `zimage-token-only-final-20261119-dist/`。生成物、模块缓存和机器路径不入 Git。

未验证真实浏览器视觉、最新 Next 生产闭包、Linux 生命周期或 ECS/业务就绪。ECS 中文宿主字形和图片 HTTPS 映射的既有未完成前提没有变化；本次没有去除后端 retained OTF 或切换图片默认模式。
