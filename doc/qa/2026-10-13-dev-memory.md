# 开发服务器内存调查（2026-10-13）

## 结论与交付边界

基线为 `880391e64a8796efec8c523a64aa0625578a2325`（main / PR12）。环境为 Node 24.19.0、Next 16.3.0、直接依赖 React 19.2.7、16 GiB Linux 容器；Next 自带的 React 为 `19.3.0-canary-cbb046ab-20260731`，RSC 源码来自 Next 的 compiled 包，不能只按直接依赖版本判断内部行为。已把 webpack 开发期旧 manifest VM 保留缩小到无业务代码、无 Sentry、无 Antd 的最小复现。模块顶层创建的 React 元素提供了通向旧请求的持有链；React 开发异步追踪和 webpack 模块生命周期共同参与保留。

这不是“13 GiB RSS 全由这一处泄漏造成”的结论。完整应用同时有显著编译缓存、external 内存和后台序列化活动。本调查没有证明生产泄漏，也没有排除它。此 PR 提供受控复现、反例、持有链和可验证的缓解边界；未修改框架私有追踪结构，也未宣称已修复全部开发内存增长。

## 取证方法

- 一次仅一个开发服务器；本地 mock，无真实 Supabase、模型或付费调用。
- 每次请求完整读取响应；编辑后请求同一路由。样本至少冷却 30 秒，且服务器连续 10 秒 CPU 安静；120 秒仍不满足则终止。
- 记录同一 PID 的 RSS、heapUsed、external、native contexts，以及 `vm.runInNewContext` 返回上下文的 WeakRef 存活数量。WeakRef 探针只返回数字、布尔值和字符串，未持有上下文本体。
- GC 后采样，并增加不编辑的冷却/GC 对照。补做完全不启用 inspector 的复现，排除仅由 CDP 调试连接触发的解释。
- 整体 cgroup 达 8 GiB 即停止；仅小复现且堆低于 800 MiB、余量充足时取堆快照。未对高占用完整应用取快照。
- 仓库只保留复现源码与本总结。日志、JSON、快照和图分析输出保存到 Library。

取证分两阶段：前期 `/tmp` 探索脚本使用注释编辑和 HTTP 200 校验，GC 两次；表中未标“无 inspector”的样本启用了 inspector，但未启用 allocation profiling。额外两轮不编辑的冷却/GC 仅用于明确列出的无 inspector 对照。最终提交脚本改为可见版本编辑、校验新版本 HTML、三次 GC 并让事件循环处理清理，再统一追加两轮冷却；其独立执行结果另列在验证部分，不能倒推前期样本已采用这些增强检查。

## 受控结果

下表的 VM 数量指探针追踪的 manifest 上下文，不等于 V8 全部 native contexts。不同 fixture 的堆大小不能当作仅一个变量的性能对比；无 inspector 对照复用了编译缓存。

| 样本 | 更新次数 | 存活 manifest VM（warm → 每次更新） | 结果 |
| --- | ---: | --- | --- |
| 完整应用 webpack / mock | 3 | 1 → 2 → 3 → 4 | 复现；后续 GET 阶段触发总内存预算，停止 |
| 纯 Next + 简单 Client | 3 | 1 → 1 → 1 → 1 | 旧 VM 可回收 |
| 简单 Client + Sentry | 3 | 1 → 1 → 1 → 1 | Sentry 不是必要触发条件 |
| Sentry + 空 proxy | 2 | 1 → 1 → 1 | proxy 不是必要触发条件 |
| 仅 StyleRegistry + antd-style ThemeProvider | 2 | 1 → 2 → 3 | 无业务代码仍复现 |
| 同上，关闭开发 vendor splitChunks | 3 | 1 → 2 → 3 → 4 | 候选配置被反证，不提交 |
| 只有模块顶层静态 React 元素的 vendor fixture | 3 | 1 → 2 → 3 → 4 | 最小触发场景成立 |
| 同一小 fixture，无 inspector | 2 | 1 → 2 → 3 | 额外两轮冷却/GC 后仍为 3 |
| 元素改在组件函数内创建，无 inspector | 2 | 1 → 1 → 1 | 额外两轮冷却/GC 后仍为 1 |
| 完整应用默认 Turbopack / mock，无 inspector | 2 | 1 → 2 → 2 | 额外两轮冷却/GC 后仍为 2；短样本不证明长期有界 |

完整应用四个已完成样本的 RSS 约 5642、6353、6253、5990 MiB，heapUsed 约 2463、3138、3048、2797 MiB，external 约 1378、1980、1980、1981 MiB。VM 保留与 RSS/堆的非单调变化同时存在。后续五次 GET 返回成功，但冷却中总 cgroup 达约 8.21 GiB，未产生有效的 GET 后样本；不能据此推断 GET 的泄漏斜率。

最小静态元素 fixture 的 GC 后堆约 244 → 268 → 269 → 272 MiB，VM 1 → 4。无 inspector 样本额外冷却/GC 后堆从约 178 降到 167 MiB，VM 仍为 3：释放部分缓存不等于释放所有旧上下文。

## 实际持有链

小复现和 Antd fixture 的快照均存在以下链。解析器跳过普通 weak 边，对 V8 的 `part of key ... pair in WeakMap` 边要求 **key 与 table 均已独立可达**，再遍历 value；不能把 WeakMap 的所有内部边当作普通强引用。

```text
global console 的 React wrapper
  → React RSC pendingOperations Map
  → operation.owner.props
  → jsxPropsParents WeakMap（props 为 key）
  → MetadataOutlet 函数
  → 旧 webpack runtime / __webpack_module_cache__
  → 模块顶层 React 元素
  → element._owner → owner.props.params → ReactPromise
  → ResponseInstance._moduleLoading → 旧 manifest 对象/VM
```

在本仓库固定版本的 `next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js` 中：

- `jsxPropsParents.set(props, type)`（约 1937 行）形成 props 到组件函数的 ephemeron 关系。
- `createHook(...).enable()`（约 6307–6479 行）在模块加载时无条件启用，不要求 inspector 或 React debug channel。
- `init` 强持有 owner / awaited / previous；Promise 本体用 WeakRef。
- `promiseResolve` 更新时序与关系，不删除 Map 项；`destroy` 才删除。不能安全地在应用层粗暴清空这个内部 Map，否则会改变 React 调试生命周期。

另有首代保留根：Node require.cache 中 vendor 模块的私有 `node:module_last_parent`，以及 Next manifests singleton 初次创建的 `serverModuleMap` 闭包。Next 清理 `.parent`/children 不足以处理所有私有引用。关闭 vendor 分块后，首代 singleton 根和后续 React 追踪根仍在，因此该配置没有解决问题。

Antd 的 message / notification `PurePanel` 在模块顶层建立 `TypeIcon` React 元素，其开发 `_owner` 提供了上述连接点。最小 fixture 用一个 `createElement('span', ...)` 即可替代整套 UI 库，证明业务 store、图片卡片、构图模板、真实请求均不是此复现的必要条件。该结果不意味着这些业务路径已全面排除其他泄漏。

## 经验证的缓解与复现入口

继续使用已有 `pnpm dev` 的默认 Turbopack 路径，不额外传 `--webpack`。同一完整应用的 Turbopack 样本 RSS 约 1782 → 1792 → 1794 MiB，GC 后堆约 192 → 193 → 194 MiB；额外两轮冷却/GC 后保持约 1794 / 194 MiB，manifest VM 为 2。具体代次为 `[0] → [0,1] → [0,2]`：中间代确已回收，首代仍保留。本次默认路径在预算内完成并回收中间代，可作为有限缓解证据，不能称为根因修复或长期稳定性保证；仍应单进程、保留资源余量、限制诊断次数。`--max-old-space-size` 只限制 V8 堆，不能代替 RSS/cgroup 预算。

完整应用的早期 webpack 样本启用了 inspector，Turbopack 样本没有，编译缓存状态也不同；这不是严格只替换 bundler 的 A/B，不能把全部占用差异归因于 bundler。缓解建议基于默认路径实际完成的小样本与代次回收证据，而非百分比性能承诺。

函数内创建元素的临时 fixture 对照证实了一个可消除触发条件的代码模式，但实际应用的元素来自第三方 UI 库。本 PR 不通过私有 loader、修改 React 内部 Map、批量剥除 `_owner` 或盲升大版本来改动第三方语义。后续上游修复应通过这里的正负对照再验证。

可提交脚本为 [`scripts/dev-memory/reproduce.mjs`](../../scripts/dev-memory/reproduce.mjs)，参数与边界见[说明](../../scripts/dev-memory/README.md)。它默认无需 inspector、不取快照，创建仓库外最小 fixture；限制循环次数、总时长和内存，校验每次新 HTML 版本，退出时清理自己的整个进程组。它不改变正常开发启动器或应用配置。

```sh
# 当前框架的负例：预期记录 retained，开启断言后非零退出。
node scripts/dev-memory/reproduce.mjs --cycles 2 --assert-collected --output /tmp/zimage-static-new
# 函数内创建元素的正例：应只剩当前 manifest VM。
node scripts/dev-memory/reproduce.mjs --element render --cycles 2 --assert-collected --output /tmp/zimage-render-new
node --test scripts/dev.test.mjs scripts/dev-memory/reproduce.test.mjs
```

输出目录必须是全新路径。此实验是 opt-in，未加入常规 CI；已知负例非零退出是复现结果，不能包装成已修复的绿灯。

## 验证与未测边界

最终 webpack 静态元素负例以 `--cycles 2 --assert-collected` 执行，PID 始终为 5702，warm / 两次更新的 live IDs 为 `[0] → [0,1] → [0,1,3]`，累计生成 4 代；两轮额外冷却/GC 后仍为 `[0,1,3]`，如预期退出 1 并清理进程。版本轮询可能产生额外 manifest，所以“每次编辑恰好一代”不是断言条件。

开发启动器与新脚本单元测试合计 8 项通过。独立审查发现的非 2xx 响应未消费问题已修复：现在始终读取 body，再判断状态和可见版本；500/503、旧版/新版响应的回归测试均通过。独立复审无遗留 critical / important 问题。

最终函数内创建元素正例以同样参数执行，PID 始终为 6411，live IDs 为 `[0] → [1] → [3]`，累计生成 4 代；两轮额外冷却/GC 后仅 `[3]`，退出 0 并清理进程。正负例的真实 Next 集成都已验证；新脚本的 Turbopack 选项尚未实际运行，完整应用 Turbopack 数据来自前述独立探索脚本。

`pnpm lint`、`pnpm typecheck` 已通过。首次 `pnpm test:run` 的领域测试 76/76 通过，Web 为 667/672，5 个失败源于本次验证脚本错误注入全局 mock 环境（HTTP fixture 和账号页被导向 mock 分支）。移除 `NEXT_PUBLIC_DATA_MODE` / `NEXT_PUBLIC_PHASE2_AUTH` 后，三个相关测试文件全部 6/6 通过；未改业务代码或原有测试。首次失败日志保留，不能将它写成全量本地绿灯。完整干净环境覆盖测试以本草稿 PR 对应精确 head SHA 的 CI 为准。

`pnpm --filter @zimage/web test:acceptance-budget` 5/5 通过；`pnpm build` 通过（`NEXT_DIST_DIR=.next-build-qa`、mock、`ZIMAGE_BUILD_CPUS=1`、V8 堆上限 4096 MiB）。构建生成的类型入口随后恢复，隔离构建目录清理。测试中出现 Fontconfig 无可写缓存目录警告，相关渲染器测试仍通过；未将警告隐藏或修改业务字体行为。

证据已打包并校验，未进入 Git。Library 标准 prepared-upload helper 在服务发现阶段连续两次返回 `hosted apps tools/list request failed: network`，尚未完成上传。当前阻塞是执行环境到 Library 的网络路径；不声称文件已存入 Library，也未绕过规定的大文件上传路径。需恢复上传通道后保存以下两个现成文件：

| 文件（当前位于 `/tmp`） | SHA-256 |
| --- | --- |
| `zimage-dev-memory-measurements-20261013.tar.gz`（约 294 MiB；测量、快照、持有链、原始探针） | `0e98a66c2e8b8ce0fb5c5c37f39aeb1f42999aaa49e5370a24ded3f2749879b2` |
| `zimage-dev-memory-validation-20261013.tar.gz`（验证日志、源码摘要，含首次失败及定向复测） | `7844bcf344af4b06cffbfa8689560ef89ceef2c6e488c1315aa27dd11b657d17` |

未进行浏览器自动化或真实浏览器 HMR、长时无界压力、生产 standalone 当前版本负载、原生分配分析、真实 Supabase/模型调用。GET-only 的完整应用样本因预算终止而不成立。未证明所有组件、路由、Node/Next 版本和平台都没有其他泄漏；脚本仅支持 Linux `/proc`。没有合并、部署、生产迁移或权限变更。
