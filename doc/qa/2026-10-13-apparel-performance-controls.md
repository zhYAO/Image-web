# 服装优化开关与性能验收补正

执行范围：独立分支 `codex/free-plan-safe-optimizations-20261013`（PR10），基线 `0773a7c`。本轮不部署、不合并 main、不操作生产数据/权限/调度，也不调用任何模型。PR9 保持独立未合并；组合兼容性只在临时 checkout 验证。

## 两个独立关闭路径

| 配置 | 默认/有效值 | 关闭行为 | 生效方式 |
|---|---|---|---|
| `ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED` | 默认关闭，仅字符串 `true` 开启 | 同一授权 loader 直接读取，不创建 source reader；保留下载前后租约/来源检查、404/503 分类 | 服务端运行时配置，修改后重启服务，随后新 claim 生效；已有 claim 不切换。不需重建，但首次安装代码需要发布 |
| `NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED` | 默认关闭，仅字符串 `true` 开启 | 使用既有 AntD Image，恢复立即挂载，不创建 IntersectionObserver | Next 在构建时内联；修改后重新构建、发布才生效，仅重启不生效 |

关闭一个配置不改变另一个。模板明确为 `false`；生产构建只新增公共布尔变量转发，没有配置实际环境或部署。后续关闭可见加载应从当时完整已审核源码重新构建，以保留同版本其他修复；整体回滚旧 release 不保证保留 PR9。原图鉴权、到期、`private, no-store`、原 JPEG/ZIP 字节与积分/队列契约不变。

**默认关闭时没有素材复用或首屏请求减少的收益。** 只有显式开启对应开关才进入优化路径；当前没有真实负载的尾延迟、吞吐、账单或RSS收益证明。开启路径的单测/合成pilot不构成性能放行，后续启用需要单独完成相应性能与真实页面证据。

复用仍限一次已授权 claim：8 MiB/claim、32 MiB/Node 进程的**编码留存字节**。这不是 RSS 上限。成功但不能放入本 claim 的不可变素材仅记录 ID，后续串行读取直接回退，跳过 promise/cache 记账；下载失败不记录，临时进程预算竞争不永久排除。finally 释放，包括失租和失败。

## 可重现测量方法

```sh
pnpm --filter @zimage/web test:apparel-performance
node apps/web/scripts/run-apparel-performance.mjs /absolute/private/task-directory prepare
node apps/web/scripts/run-apparel-performance.mjs /absolute/private/task-directory pilot
node apps/web/scripts/run-apparel-performance.mjs /absolute/private/task-directory measure
```

使用仓库锁定的 Node24.19、Sharp0.35.3、真实 apparel service/renderer；RPC 与 Storage 为离线合成实现，每次下载延迟25ms，返回一次精确 ArrayBuffer 副本。开关关闭路径是本轮保留鉴权/错误分类的 baseline loader，不是整个历史 main 的性能基线。没有真实 Storage 网络、数据库、模型、付费预算或 ZIP 操作；ZIP 字节由独立单测覆盖。

固定种子20261013、输入 SHA256/编码字节/Sharp 实际尺寸在 `fixtures/manifest.json`。正常750×1000、1展示；超预算750×1000 JPEG 尾部填充至10MiB、20展示；真实大像素3000×4000、12MP、1展示，编码约7MiB。照片为确定性独立RGB噪声，是合成纹理压力场景，不代表真实商品照片。六个照片文件分别固定；超预算的20个展示ID重复同一展示图字节，内容多样性有限。大像素被真实解码，不用文件填充代替像素；12MP不是渲染器最大允许尺寸。

每类3对排除预热后120对测试，两路径各120次，AB/BA各60次并以固定随机序交错；同进程、每次测量前强制GC，不同时跑本地构建/测试。保存时间顺序、每次读取/字节、输出哈希及RSS，按原顺序三等分与AB/BA分组检查漂移。Nearest-rank P95每路径约6个尾部观测；5000次配对bootstrap及长度5循环块bootstrap报告95%区间，属于单场景探索性区间，不是多场景联合保证。三次预热与块长度5不能证明平稳。

冷启动每路径/类5个独立进程，无预热；单独报告第一套渲染时间、进程年龄与launch-to-completion，后者包含写结果和退出。仅报告冷启动min/median/max，不把5次最大值视为可信冷P95，也不声称操作系统文件缓存已冷却。

RSS每20ms及RPC/Storage边界采样；同进程样本不用于单路径因果归因。另做各路径独立新进程3套内存观测；过程maxRSS包含模块加载/输入预载、字体/Sharp原生缓存等，分别记录startup/preload。输入制作不在测量子进程。并发2/5各一波、不同合成owner，进程预算确实共享；逐张哈希要等于串行参考，完成后留存应为0。以串行留存估算候选编码量，再通过实际额外读取确认竞争；不把估算当作实测admission。

每个子进程启动前核对cgroup及MemAvailable：至少768MiB，并根据pilot峰值RSS预留`1.3×峰值×并发+256MiB`。250ms监控剩余内存，低于128MiB仅终止本脚本的子进程并记录aborted证据。不能保证防止其他进程突发增长；被阻断/中止是未完成证据。环境原有Next dev服务占约12.6GiB，用户随后单独批准重启；旧资源竞争系列已归档，不合并到新条件。pilot与measure绑定输入、bundle及runner SHA；变更后必须重做pilot。部分结果以独立run标识的JSONL保存，重跑不混样。

## 判定与当前状态

两开关继续默认关闭。目标是尾延迟无退化，未引入任意10%容差；区间跨越正数、明显顺序/时段漂移或边界未覆盖均不能证明通过。合成25ms结果不证明低延迟Storage无额外开销，更不证明线上负载/SLA、登录整页或真实设备性能。

后续有界补验见 [ZImage 计划复核](2026-10-13-zimage-readiness.md)：与 PR9 组合后的单测/构建通过；三类输入各一对输出哈希一致，一次五 claim 预算竞争验证了额外读取回退及最终释放。它补上隔离组合与一次并发正确性证据，不替代完整性能门槛；本轮未执行 120 对长测、冷启动/稳态系列或整页生产验证，两开关仍关闭。以下长测/内存诊断记录为此前历史状态。

试运行三类各1对完成，11/30张哈希一致；读取14→7、52→52、14→13。它只验证脚本正确性，不用于性能验收。正常120配对受旧dev竞争，后续冷进程准入失败；`contended-before-restart/status.json`为accepted=false。完整稳态/冷启动/并发、最新组件浏览器与隔离PR9组合仍暂缓，保留 `in_progress`。内存阶段结论与限制见 `2026-10-13-local-next-memory-diagnosis.md`，不声称性能通过。

用户随后授权只收尾原草稿PR10。2026-10-13必要针对性5文件/34项、基准助手8项、预算5项、lint/typecheck通过；独立复核无阻断项。最新完整覆盖、构建、真实pg_cron/数据库/生成类型以[PR10正常CI](https://github.com/zhYAO/Image-web/pull/10/checks)为准，不触发生产作业，不恢复长时间性能基准。原始诊断脚本/JSONL/合成图片不入提交。
