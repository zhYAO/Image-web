# ZImage 本地交接检查点（2026-11-18）

状态：仅本地保存，未推送、合入 main、触发 Actions 或部署。D1M20251119094。用户最新决定先提交，稍后换机器继续；此前压缩/传输分析要求已撤回，后续只统计未压缩实际文件内容（1 MB = 1,000,000 B）。

## 本分支实际包含

1. 基于 main `a3f43a6a43a76142782e5a2de126611d73bf96a8` 的 Sentry 移除提交 `df734aff1cbaea199193ede50b3dcd777a8af3c3`：SDK/初始化/构建直连移除；通用脱敏日志和 Node lifecycle register 保留；既有环境变量兼容，无外部变量或账号修改。
2. 浏览器默认字体提交 `7536a00b9bbda5feb25cc61f2f9c051b7a35d6dd`：Vite/Next 共用 CSS 不声明家族或字体栈；移除 mock SVG Arial，保留字号/字重/布局与 pre/code 浏览器原生默认。没有浏览器字体文件、CDN 或预加载。
3. 从 `d78677355fb76579bd93b851c2e3b12932dae975` / `586065a466555ef54941fea8096b84eb852de43c` 精确保留的七份 image-only 迁移与 release-side 缺失层原型文件：`PUBLIC-IMAGE-MIGRATION.md`、`public-images.json`、`public-images.py`、`test_public_images.py`、`DERIVED-CANDIDATE-TRANSPORT.md`、`derive-candidate-transport.py`、`test_derive_candidate_transport.py`。内容与原提交逐 blob 相同，未强行合并互异台账。原两条分支保留。

迁移清单严格限定既有 62 张公开示例 JPEG/WebP，合计 8,067,881 B；不含用户上传、非图片、环境、源码或禁发原图。它尚未接入应用 URL 或当前 privileged resource schema。

差量工具仅为离线本地原型：完整冻结候选、独立 provenance pins、原 manifest/digest 与有界库存快照绑定；派生包另算身份，不重构建；闭包重验失败即停。没有连接真实 SSH、修改 workflow 或生产助手。既有合成结果不代表真实应用大小。

## 已有验证与真实未压缩体积

精确 `7536a00` 在独立工作树完成：frontend 冻结锁离线安装、TypeScript 检查、正常完整 Vite client/SSR/prerender/资源闭包构建成功；3 项新源码政策测试通过；14 份 CSS 的 PostCSS AST 对照确认其他选择器和声明语义保留。六份生成 CSS、六份 HTML 无字体家族/加载声明，字体发布文件为零。未做浏览器视觉验收。

| Vite 项目 | 文件数 | 实际内容 B | MB |
| --- | ---: | ---: | ---: |
| JS（含动态语言块） | 256 | 9,069,322 | 9.069322 |
| CSS | 6 | 293,284 | 0.293284 |
| 公开示例图 | 62 | 8,067,881 | 8.067881 |
| HTML | 6 | 72,722 | 0.072722 |
| 其他公共文件/许可 | 6 | 8,196 | 0.008196 |
| 字体 | 0 | 0 | 0 |
| payload 合计 | 336 | 17,511,405 | 17.511405 |
| 内部 candidate 元数据（独立） | 1 | 531 | 0.000531 |

最大代码文件：emacs-lisp 790,007 B、cpp 785,490 B、入口 JS 369,286 B、wolfram 262,391 B；前两语言块不在首页静态 eager import 闭包。不能由此认定可安全删库。首页静态入口 JS/CSS 合计 451,277 B，不是浏览器首屏请求总量。

昨日外置前端参考原始内容 2,453,124 B，来自父线程历史记录；D1M 没有对应旧对象或同源构建。当前未完成外置链接，因此不能物理删除图片后把损坏闭包冒称同构对照，也未证明与昨日差异全部来自 Shiki。

Next 完整冻结安装在正常官方 registry 访问中超时；已确认缺少精确 `next@16.4.5` 和 `@next/swc-win32-x64-msvc@16.4.5` 的可信可用内容。最近一次有界尝试仍 exit 1 / `[23] The operation was aborted due to timeout`，不再重复同招或换源。故当前没有新的 Next 生产构建、server/browser/runtime/native 分项实测；旧 `.next` development 不可替代。旧 Sentry-only frontend 追加测试为 47 通过、1 因 Windows symlink fixture 的 EPERM 失败，未到安全断言。

本分支只是整合原有内容与交接说明；整合后未做新生产构建或完整回归，只做快速 Git/语法/来源一致性核验。以后构建须使用本分支新的精确 SHA，不能把 `7536a00` 的产物重新贴标。

## 明确未完成、不可当作上线前提的部分

- 服务端字体改造未实现：`codex/zimage-host-fonts` 仍指向 7536a00，没有新增实现。现行 Sharp/OTF/许可、资源四件套、启动及 rollback 门槛保持。当前服务 UID 的 DejaVu 默认选择中文覆盖失败。昨天核心字体对象 `fe18dae420c9ddb0f1c16ce8e17b6038f70b7e3d` 在 D1M 不存在；不要走失效 Library 传输。
- 后续 system 模式应为 Pango lang=zh-cn + generic sans-serif、不传 fontfile；编译标记、资源 manifest、pack/assemble、服务 UID 字形/Sharp regular-bold/三编解码预检需严格配对。旧 retained 包仍用原 OTF/许可固定哈希，缺字必须阻止切换，不能静默 fallback。不得仅删除资源检查。
- 图片生产 URL 尚未核实可用：官方 ECS 只读结果仅证明目标配置有 static-assets 引用、current 使用版本缓存和 root-owned 可并存父目录；两个 HTTPS GET 都 unverified。没有获得 62 张逐项 HTTP 200/MIME/SHA 证明，没有已核可写 staging 路径或可复用版本结论。最新核验草稿已取消，**没有执行新命令**、上传或服务器写入。
- 最新用户希望示例图使用自有 ECS 的 `www.zimage.store` 不可变 HTTPS 链接；后续仅经已授权可信通道核实已有对象与路径，全部校验后才能接共享 URL/构建物理排除；不得猜基址、未知 SSH 或自行改 Nginx/ACL。原 image-only 工具只是准备，不代表映射已生效。
- Linux candidate、preload/bridge、出图与保留版回滚需要真实隔离验证；若只能使用 GitHub，先取得明确候选授权，不能自动触发。

## 其它保留分支

- `codex/zimage-remove-sentry` → df734aff1cbaea199193ede50b3dcd777a8af3c3
- `codex/zimage-browser-native-fonts` → 7536a00b9bbda5feb25cc61f2f9c051b7a35d6dd
- `codex/zimage-font-image-assets` → d78677355fb76579bd93b851c2e3b12932dae975
- `codex/zimage-release-delta-prototype` → 586065a466555ef54941fea8096b84eb852de43c
- 可选启动诊断 `codex/zimage-startup-diagnostics` → 342a2f9850e69a256a4025b8883f096d974f781b，未混入本分支。

本检查点可在得到远端授权后只推 handoff 分支，再在另一台机器正常 clone/fetch 接手；当前尚未推送，另一台机器不能直接从 GitHub 取得它。无需携带本机 node_modules、构建日志、环境或生成归档。原用户两个 worktree 和两处未提交改动须继续保护。
