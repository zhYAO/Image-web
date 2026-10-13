# 本地 Next 开发服务内存诊断（阶段交付）

阶段观测时间：2026-10-13 07:08 UTC。以下状态为当时快照；后续PR收尾/本地服务状态以 `doc/project-progress.md` 为准。执行环境 `/workspace` 的测试容器；主工作树 `/workspace/Image-web-plan-diagnostic`，分支 `codex/free-plan-safe-optimizations-20261013`，当时已提交 HEAD `0773a7cb9409ba23b139cf119292df973aef9d58`，包含未提交的独立开关与基准准备代码。对照 main 为 `1a3eba2891ff0c659a530eed01bcdde67e4f9ea6`。诊断阶段没有提交、推送、合并、生产写入、部署或模型请求。

## 结论及其边界

1. 约 12.6 GiB 是本地一个 `next-server` 进程的 RSS，来自长时间运行的 `pnpm dev --webpack`，不是生产服务器的数值，也不是浏览器或整个容器的合计。容器只有 16 GiB 上限，当时余量约 0.6 GiB，因此独立性能基准无法安全继续。
2. 当前项目的开发编译链会占用大量内存：重启后的首次 `/` 编译即可把 RSS 推到约 6.13 GiB；不需要上传、模型、Sharp 渲染或开启素材复用。样本分配栈集中在 Webpack、Buffer 转字符串、文件读取与缓存反序列化，支持优先排查开发编译/缓存的方向。
3. 8 次源码注释变更触发重新编译，排除第 1 次较大初始化后，第 2–8 次每次留下约 20 MiB 的 GC 后 heap，native contexts 每轮多 1。旧 main 与当前分支均复现，且两组关闭 allocation sampling。存在开发热更新保留增长迹象；没有对象保留链证据，不能证明无限增长，也不能确定原 15 小时进程占用的唯一根因。
4. 没有取得生产业务泄漏证据。已有本地 standalone 构建在 `/` 一次预热、20 次 GET、60 秒空闲后 RSS 约 122 MiB；这只是旧构建、单路由、短时样本，不是当前未提交代码或真实生产负载的无泄漏证明。
5. 记录中的 cgroup `oom` / `oom_kill` 一直为 0；`max=302367` 是累计边界事件，不是当前 OOM 证据。06:38 环境断连通知之后仍可读取环境，不能直接将断连归因于内存杀进程。

## 原进程与容器

| 项目 | 观测 |
|---|---|
| 占用进程 | PID 14601，`next-server (v16.3.0)`，父进程 Next CLI 14589、dev launcher 14581、pnpm 14563 |
| 命令、端口 | `pnpm dev --webpack`，`apps/web/scripts/dev.mjs --webpack`，3015 |
| 运行时 | Node 24.19.0、Next 16.3.0、Webpack；本轮 Sharp 0.35.3 |
| 启动时间 | launcher 为 2026-10-12 13:59:44 UTC；停止前约 15 小时 37 分。未保存原 next-server 精确启动时刻 |
| 进程 RSS | 初次 13,188,684 KiB = 12.58 GiB；后续 13,747,028 KiB = 13.11 GiB |
| cgroup | current 16,543,592,448 B；max 17,179,869,184 B = 16 GiB；余量 636,276,736 B = 0.593 GiB |
| 宿主可用内存 | MemAvailable 3,180,388 KiB ≈ 3.03 GiB；不能替代更小的容器余量 |
| 停止后的容器 | 一次观测 current 2,002,219,008 B ≈ 1.86 GiB，明显回落 |

这些初始数值来自停止前工具观测，独立 JSONL 采样在重启之后才开始。原进程 PSS、heap、external 和完整进程树 PSS 未在停止前保存，不能事后补造；也不把初始 RSS 的约 79%/容器上限当作严格可相加的内存占比。浏览器及其他进程、文件缓存、内核记账也占用 cgroup。诊断末次停止状态 current 约 4.32 GiB，包含仍留存的文件缓存与其他工作；这不等于 Next 仍运行。

RSS 包含进程内 JS、C++、代码和驻留页；PSS 按共享页比例计入，避免多个进程 RSS 简单相加。heapUsed/heapTotal 是 V8；external 是与 V8 管理对象关联的外部内存；arrayBuffers（含 Buffer）已包含在 external，禁止再次相加。有 Worker 线程时，RSS 为整个进程，其他字段只代表采样线程。RSS 在 GC 后不完全下降也可能与分配器驻留/碎片有关，但本轮未验证分配器为根因。参见 [Node 24 官方说明](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage)。

## 受限实验与原始证据

原始目录：`/workspace/free-plan-perf-acceptance-20261013`。摘要 `memory-diagnosis-summary.json` 保存 SHA256、数字阶段、PSS 采样范围、GC/context 指标及最终端口状态；每组 `*-actions.jsonl` 记录操作，`*-memory.jsonl` 保存约 2 秒一次的数字观测。Inspector 仅回环开放，结束时关闭；不读环境变量、凭据或对象内容，没有完整 heap snapshot。

| 实验 | 范围与结果 | 限制 |
|---|---|---|
| 重启原工作树 PID55032 | 空闲约 1.45 GiB RSS；首次 `/` 编译约 6.13 GiB，heap约2.18 GiB、external约3.50 GiB | 默认 mock，无生成或 Sharp 操作；没有复原旧进程全部历史 |
| 多路由 | `/`、`/create`、product-set、apparel-catalog、terms、privacy；首轮6次+重复7次后中止，HMR未执行 | 超安全界限，不能声称120次完成；重复编译/路由淘汰影响状态 |
| 多路由后 GC | RSS 8,800,546,816→7,210,647,552 B；heap 3,505,989,872→2,581,705,064；external 5,249,304,165→1,938,267,763 | 可回收编译临时量显著；仍有驻留/保留量 |
| 旧 main 无 allocation sampling | 临时 checkout、独立缓存；预热后20次GET `/`；8次注释重编译、恢复源码、空闲60秒 | 冷编译已在之前短暂采样阶段完成；共享同一安装依赖，不是独立历史部署 |
| 当前 PR10 无 allocation sampling | 临时 checkout、独立缓存；同样20次GET、8次注释重编译、恢复、空闲 | app代码为0773+当时未提交快照；首次编译后台工作尚未结束，预热阶段不同 |
| 本地 standalone | 既有 `.next-build-qa/standalone/apps/web/server.js`，回环3021，1+20次GET `/` | BUILD_ID `REcV9qjWf8wS_PkqK-Gni`，mtime03:49:21 UTC；没有新构建，早于最新开关准备，确切源码SHA未绑定 |

所有临时 HMR 注释已逐字恢复，原样文件与最终文件比较为 true，恢复哈希写入各 actions。普通 GET 不执行模型或素材排版。模拟数据的用途只限本地内存诊断，不能代替真实 Plan 质量或应用全链验收。

### GC 后观测（MiB，1 MiB = 1048576 B）

| 场景/阶段 | RSS | heapUsed | external | native contexts |
|---|---:|---:|---:|---:|
| main 预热后 | 5688.71 | 2519.89 | 1390.35 | 17 |
| main 20次GET后 | 5693.56 | 2524.73 | 1392.14 | 17 |
| PR10 预热阶段 | 5230.51 | 2622.68 | 2500.21 | 16 |
| PR10 20次GET后 | 5709.83 | 2523.41 | 1390.16 | 17 |
| main HMR第2次 | 5997.55 | 2783.61 | 1993.59 | 27 |
| main HMR第8次 | 6045.07 | 2904.87 | 1996.96 | 33 |
| PR10 HMR第2次 | 6037.71 | 2782.07 | 1991.60 | 27 |
| PR10 HMR第8次 | 6090.80 | 2901.62 | 1995.04 | 33 |
| main 恢复源码后 | 6069.88 | 2925.96 | 1997.53 | 34 |
| PR10 恢复源码后 | 6094.07 | 2922.93 | 1995.48 | 34 |
| standalone 预热后 | 112.83 | 59.39 | 4.33 | 2 |
| standalone 20次GET后 | 122.02 | 63.22 | 4.33 | 2 |
| standalone 空闲60秒后 | 122.02 | 63.12 | 4.33 | 2 |

main 20次GET的 heap 增加 4.834 MiB，contexts不变；PR10该段 heap 下降99.280 MiB、external下降1110 MiB，说明仍有后台编译/回收，不能称两者具有相同的稳态基线。HMR第2→8次平均每间隔保留20.209/19.924 MiB，contexts27→33；只代表8次内的开发保留现象，不外推15小时。

两组最后60秒内出现 Webpack 缓存序列化背景工作，最终 main/PR10 RSS 为7984.22/8236.09 MiB、external为4652.36/4696.34 MiB。所谓“空闲”仍有编译缓存工作，不能称完全静止的泄漏测量。PR10数字采样器在cgroup超过12 GiB时退出；阶段脚本仍保存最终数字动作，然后服务停止。该采样阈值是退出采样的边界，不是保证硬终止整个Next进程；原始动作与采样峰值必须分别看。2秒采样也可能漏过短峰。

开发主进程PSS接近RSS，显示大部分为自身私有页，并非浏览器共享页的重复计数：main采样最高PSS约7967.83 MiB、PR10约8031.70 MiB；不与动作快照的后续更高RSS混为同一时刻。standalone采样最高RSS145.08 MiB，最终122.02 MiB，不把最终值当峰值。

分配样本只保存函数帧与估算量，没有对象内容或retainer图。第一次profile因连接中断丢失；保留的样本中 Webpack / node:buffer / node:fs 占据前列，是排查线索，不是完整RSS来源证明。[Next官方说明](https://nextjs.org/docs/app/guides/memory-usage)也明确编译依赖和缓存需要内存，`--experimental-debug-memory-usage`针对build，不将它当作本轮dev泄漏结论或自动修改生产配置。

## 素材复用与生命周期审查

新代码的两个开关独立、默认关闭。字节Map/pending/excluded均在已授权claim内创建，跨claim只有数字预算；finally调用dispose清空并释放。单claim8 MiB/模块实例共享32 MiB是**编码素材留存**准入，不是进程RSS、Sharp解码或输出峰值上限；HMR下多个模块实例的合计上限未实测。关闭素材复用时，不构造source reader。首个普通页面编译已达数GiB，因此本轮现象不能归因于这32 MiB缓存。

仍有原有生命周期边界：请求断开信号未贯穿排版，断开不立即取消；租约错误等到下一检查点才退出；失败路径await fail RPC后才进入finally，挂起RPC可能延迟释放；clearInterval不取消已在途续租；跨账号同时解码未设统一并发上限。这些是后续受控渲染/失败实验应覆盖的风险，不是本轮已证明的生产泄漏；没有扩大本轮到业务行为修改。Sharp/libvips缓存设置限制的是操作缓存，不能当成RSS上限，见 [Sharp官方说明](https://sharp.pixelplumbing.com/api-utility/#cache)。

原性能pilot只完成三类各1对、原120正常配对受到旧高占用服务竞争，已隔离在 `contended-before-restart/`、标记accepted=false。不合并到新基准。三个pilot的输出哈希相同、留存结束0，只支持那些成功样本的正确性；不证明挂起、断开、全并发内存或性能验收通过。

## 当前状态与后续

- 用户批准的本地重启已执行；所有本轮诊断dev/standalone及Inspector均已停止。07:08左右验证3015、3019、3020、3021、9229关闭；浏览器登录态未清除。原3015开发页面当前暂停，避免自动编译再次占用资源。生产服务不受影响；恢复本地页面时应由拥有该服务的会话按原命令启动，不能把此旧standalone构建替换为正式开发服务。
- 内存阶段已交付，**泄漏根因未完全定位、没有修复声明**。应在资源独占窗口用最新源码建立已知构建、分离重复路由与Sharp渲染，记录成功/失败/失租/断开及2/5并发的heap/external/RSS/Sharp数字。若需retainer证明，使用较小隔离复现并比较GC后对象保留，避免在剩余内存不足环境产生巨大snapshot。
- 如进一步试验Webpack缓存策略、内存优化开关、依赖减量或Turbopack，先作独立A/B对照，不直接改生产配置/升级依赖。开发热更新保留需要定位到具体retainer，不能依据版本相同或一条函数名确定框架唯一根因。
- 原PR10完整性能系列、最新组件浏览器对照、全量lint/typecheck/test/build、最新CI、隔离PR9组合尚未完成。当前变更仍未提交；已有[CI61](https://github.com/zhYAO/Image-web/actions/runs/38345855741)只对应0773，不覆盖这些未提交变更。[PR10](https://github.com/zhYAO/Image-web/pull/10)保持draft，PR9独立。
- 基准安全助手8项通过；已拒绝空资源计数/字面Infinity，并以独立randomUUID JSONL避免重跑混样，完成输入/代码fingerprint保护。这些是测试准备，不是性能通过证据。
- 真正 `doubao-seedream-5.0-pro` 的电商/聊天原图质量仍未取得；没有新增调用、自动重试或消费套餐。

阶段包包含本文、原始数字记录、受限诊断脚本、代码快照、性能未完成状态和校验和。无凭据、环境值、浏览器截图、供应商样图或完整heap snapshot。
