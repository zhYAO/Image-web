# 开发内存：导入边界修正与未解决的回收问题（2026-10-14）

基线为 `d8dc3d04e33334049f9e1e845200ab97881520ec`，包含 PR15 的持有链报告与最小复现。本次只审查并验证应用能够安全控制的导入边界，不修改 React/Antd 私有实现，不升级依赖。

本次没有验证出内存根因修复，也没有证明候选降低默认开发内存。保留的业务改动是一行公开子路径导入，使真实主题测试无需绕过总入口的 mock；完整 Turbopack 对照没有实质改善，webpack 对照均在首个有效空闲样本前终止。PR15 已确认的框架持有链仍未解除。

## 候选与语义边界

应用源代码审查未找到可以把模块级 React 元素直接移入函数的业务实例。导航配置保存的是组件函数，主题配置保存的是普通对象，不能据此套用最小 fixture 的变更。

`AppProviders` 原来从 `@lobehub/ui` 总入口导入 `ThemeProvider`，改为 `@lobehub/ui/es/ThemeProvider/ThemeProvider` 的 default 导出。固定版本 `5.30.0` 的 `package.json` 明确公开 `./es/*`；总入口 `es/index.mjs` 也从该文件转出同一个组件。应用其它 Lobe 运行时导入已经使用 Markdown 子路径。这个变更避免主题提供者经过包含 FluentEmoji、CodeEditor 等无关组件的总入口。

它仍然加载 Lobe ThemeProvider、Antd App 和 antd-style ThemeProvider。后者无条件依赖 message/notification，已知模块级 `TypeIcon` 元素仍然存在。因此导入减量不能被表述为修复 React `pendingOperations` / `_owner` 持有链。

先删除原主题测试对总入口的 mock：基线因无关 FluentEmoji ESM 目录导入而无法加载 suite；主题配置的两项测试仍通过。替换生产导入后，不恢复 mock，真实 Lobe/Antd 亮暗主题与配置测试共 4/4 通过。这个红/绿检查验证导入边界和主题行为，内存效果另由实际应用对照判断。

## 实际应用对照方法

- Node `24.19.0`、Next `16.3.0`、直接依赖 React `19.2.7`；Next 内置 React 为 `19.3.0-canary-cbb046ab-20260731`。
- 每轮从同一基线 `git archive` 提取实际应用和 domain 源码到仓库外的新目录。依赖链接至同一安装；候选只替换上述一行导入。没有复制 `.env.local` 或继承凭据，显式使用 mock、关闭鉴权与遥测，监听 loopback。
- 两组都从各自空的 `.next` 开始。仅测量副本统一把 `outputFileTracingRoot` 和 `turbopack.root` 设为 `/workspace`，使链接的依赖位于根目录内；原仓库配置与缓存不变。Turbopack 开发磁盘缓存仍使用仓库已有的关闭设置。
- 不启用 inspector，不抓快照；使用 PR15 WeakRef 探针。首页临时返回版本标记，其余真实应用布局、providers、workspace 保持基线内容。修改后等待两秒，再进行固定请求。
- 正式每轮计划八次 GET：冷启动两次、同版本重复两次、每次更新两次；两次更新后再追加两轮不发请求的空闲采样。完整消费响应，记录每次 HTTP 状态和版本匹配结果；第二次请求必须为新版本，否则整轮失败。
- Turbopack 每次采样至少冷却 30 秒，且进程组连续 10 秒 CPU 安静。正式 webpack 两组统一加强为至少 60 秒冷却、连续 20 秒 CPU 与写入活动安静；写入活动来自进程组 `/proc/PID/io` 的 `wchar`，用于识别异步序列化等工作。之后三次 GC，每次间隔 500 毫秒。记录同一 worker PID 的 RSS、heap、external、native contexts、累计及存活 manifest 代次。这些是操作性的安静判据，不保证未来没有延迟任务。
- 一次只运行一个开发服务器。V8 堆上限 4096 MiB；每个进程 RSS 达 6 GiB、容器总量达 10 GiB 即停止。Turbopack 单阶段上限 120 秒，正式 webpack 为 180 秒；整轮均最多十分钟。16 GiB 容器保留至少约 6 GiB 总量余量，不在高压状态取堆。结束后 TERM/KILL 清理自己的进程组。
- 退出且确认 worker 不再存在后，保存构建文件数量/字节摘要并清理该测量副本生成的 `.next`。原仓库 `.next` 未改动。cgroup 包含共享容器和文件页缓存，不能把其差值当作应用节省。

这是 HTTP 触发的开发重编译与空闲试验，不是浏览器 WebSocket HMR。操作系统页缓存没有被强制清空，不能把启动时长差当作纯导入性能收益。

首个隔离副本因 tracing root 与 Turbopack root 不同而退出，没有有效样本；修正后的探索轮使用版本轮询，产生一次额外 GET。两者均保留原始日志，但不用于正式等负载比较。

首轮 webpack 候选沿用 30 秒冷却，在第二次更新后的空闲阶段触发 10 GiB 总预算；只有四个有效阶段，不能算完整空闲结果。随后核验旧测量压缩包的既有 SHA-256，并逐一对比包内六份快照与本地散文件的字节哈希，只移除可恢复的重复散副本，释放约 1.62 GiB 临时占用；旧压缩包原始字节仍完整保留。正式 webpack 基线和候选均在此之后运行，使用相同的加强冷却协议；先前候选轮仅列为探索，预算没有提高。

## 测量结果

Turbopack 正式对照先运行子路径候选，再运行总入口基线；两者均完成全部八次 HTTP 200，八次版本校验全部匹配。同一轮始终使用同一个 PID。

| Turbopack 样本 | 采样观察到的峰值 RSS（MiB） | 最后空闲/GC 后 RSS（MiB） | 最后 heapUsed（MiB） | 生成 JavaScript 文件数 |
| --- | ---: | ---: | ---: | ---: |
| 总入口基线 | 1885.76 | 1819.03 | 196.21 | 516 |
| 公开子路径候选 | 1893.87 | 1817.95 | 196.20 | 516 |

两组 warm / repeat GET / HMR1 / HMR2 的累计代次均为 `2 → 4 → 6 → 8`，存活 ID 均为 `[0,1] → [0,3] → [0,5] → [0,7]`。最后两轮空闲/GC 均保持 `[0,7]`。最后 RSS 约 1 MiB 的差异不能作为实质收益，峰值方向也没有改善；本次没有证明该改动降低默认 Turbopack 开发内存。JavaScript 文件数与堆也基本一致。

Webpack 正式对照先运行总入口，再运行子路径，均从空缓存开始并采用相同的加强协议。两组服务日志都只有两次成功 GET；首次冷却采样均未完成，没有有效的 GC 后堆、存活代次或完整空闲结果。

| Webpack 样本 | 截断前采样观察到的峰值 RSS（MiB） | 有效阶段数 | 停止原因 |
| --- | ---: | ---: | --- |
| 总入口基线 | 6187.78 | 0 | 单进程 RSS 超过 6 GiB，watchdog 停止 |
| 公开子路径候选 | 5041.18 | 0 | 首阶段 180 秒内未取得安静窗口，超时停止 |

上表峰值来自每秒轮询，不是连续分配跟踪；两组观察窗口和终止原因不同，不能用其差值计算节省比例。候选只证明在这次截断运行内未触发 RSS 上限，不能推出完整 HMR 周期的收益。两组截断时都生成了 585 个 JavaScript 文件；生成文件数同样不能证实编译模块图缩小。没有提高预算或在边界附近取快照来凑齐比较。

候选的 JSON 错误为通用 `The operation was aborted`；首阶段超时的判断结合了执行时间、脚本的阶段 `AbortSignal.timeout(180000)` 和未发出人工终止的执行记录，并非该错误字符串单独给出原因。

首轮较短冷却的 webpack 候选曾在两次更新后观察到存活代次 `[0,4,6,7]`，但随后总预算终止，不能据此宣称它经过充分空闲仍泄漏。已确认的持有链证据仍来自 PR15 的最小对照与快照分析，而不是本轮未完成的 webpack 空闲测量。

## 验证与证据状态

本地检查均于 2026-10-14 完成，退出码均为零：

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test:run` | domain 12 文件 / 106 项；web 102 文件 / 725 项通过 |
| `pnpm --filter @zimage/web test:acceptance-budget` | 5/5 通过 |
| `node --test scripts/dev.test.mjs scripts/dev-memory/reproduce.test.mjs` | 8/8 通过 |
| `pnpm build` | mock 隔离构建通过；`NEXT_DIST_DIR=.next-build-qa`，单 build CPU、4096 MiB 堆上限 |

测试没有注入全局 mock/鉴权开关，以免覆盖测试自身的环境控制；只有构建显式设置 mock 和关闭鉴权。构建沿用仓库的隔离输出目录，完成后清理本次产物并恢复其生成的 `next-env.d.ts` 路径。独立只读审查核对了公开导出、真实测试、原始指标与最终结论，没有未解决的重要问题。

精确提交 SHA 的 CI 结果在草稿 PR 与任务交付中记录，避免以修改报告的后续提交替代实际受检 SHA。本地检查不替代 CI 的覆盖率和本地数据库容器检查。

原始日志、指标与临时测量脚本只保留在仓库外。本轮遵守旧上传通道的停止指示，没有再次调用 Library 上传：此前服务发现阶段遭执行环境代理隧道 HTTP 403，尚未恢复，也不声称本轮证据已进入 Library。

本机 `/tmp/zimage-memory-20261014/` 保存两个正式协议版本的脚本与执行日志；`/workspace/zimage-memory-20261014-*` 保存各轮 `metrics.json`、服务日志和构建清单。脚本不属于通用产品测试入口，CLI 的 `--element static|render` 在这个临时应用版本中分别表示总入口/子路径，不能与 PR15 最小 fixture 的同名选项混用。Library 上传恢复前，这些复核材料仅在当前执行环境可用。外部辅助读取 `/proc/12661/io` 曾被权限拒绝；未绕过该限制，没有将外部读取当作采样结果。

本轮证据归档为 `/tmp/zimage-dev-memory-mitigation-20261014.tar.gz`，同名 `.sha256` 文件及包内 `manifest.json` 记录完整性。包内保留测量脚本、固定基线上的候选补丁、各轮指标/日志和本地验证输出，不包含构建缓存或生产环境文件。旧快照原始字节继续保存在已核验的上一轮压缩包中。

未验证生产 standalone、真实浏览器 HMR、长期负载或原生分配。没有新生图、生产数据库操作、生产凭据访问、部署或合并。

## 后续框架升级验收

根因修复应在独立升级分支验证，先确认候选补丁/次版本是否包含相关上游修复，不以直接依赖 React 版本代替 Next compiled React 版本。大版本与生产架构改动需另行协调。

1. 保留当前 lockfile 基线。记录 Node、Next、直接及 compiled React 版本，重新检查探针对 Next worker 的握手条件。
2. 用新输出目录运行 PR15 静态负例与函数内创建正例，各四次更新：`node scripts/dev-memory/reproduce.mjs --bundler webpack --element static --cycles 4 --assert-collected --output /tmp/upstream-static-new`，正例改为 `--element render` 和另一新目录。负例必须从当前预期非零转为真实回收，正例仍通过；`untracked` 不算修复。
3. 重新执行本报告的实际应用等负载冷启动/重复 GET/两次更新/空闲流程，对照逐代存活，而不只比较 RSS。若首代或旧代仍保留，需重新定位其根，不宣称链已修复。
4. 通过主题真实组件测试、完整单元/覆盖率、类型/lint、mock 构建、预算和数据库 CI；单列未做的浏览器及生产验证。禁止以升级后能够启动或短测低 RSS 代替这些证据。
