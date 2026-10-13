# Free Plan 用量优化：实现与验收

范围：独立分支 `codex/free-plan-safe-optimizations-20261013`，基线 main `1a3eba2`。三个工作树在开始时均干净，没有可补交的未提交代码，不创建空提交。上传/轮播 PR #9 (`c274e14`) 保留独立、未合并。

## 运维查询预算

Log Query 计量是日志查询扫描字节，普通 PostgreSQL 查询数不是该指标。生产业务请求、日志写入和日志扫描须分开核对。当前截图周期为 10/06–11/06，已报告扫描 64.31/100 GB，写入 0.09/1 GB；调用来源仍未知。10/08 扫描峰值不能凭代码搜索归因。官方当前文档标示 Log Query 尚未强制执行，宽限至 2027 年开始；额度记录不能描述为已被强制限制。[官方计量说明](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query)

日常运维目标：扫描预算 1 GB/日、下一周期 30 GB/月；事故调查另记预算和原因。本周期约剩 35.69 GB、24 日，只作预算估算，不自动修改账号或创建告警。每次查询在运维记录填写：问题、UTC 起止、服务、筛选字段、返回投影、LIMIT、调用来源及可用扫描字节元数据。

1. 先检查仪表盘已有用量及应用 correlation ID；同一问题避免重复扫描。
2. 首次单服务查询最多 15 分钟时间窗，仅选 timestamp/服务/状态/correlation ID 等必要字段，最多返回 50 行。LIMIT 控制结果数量，不保证扫描字节下降。
3. 确需扩窗时记载理由，逐步到 1 小时；避免 `SELECT *`、跨服务全量原始消息和旧 `logs.all` 查询。使用当前受支持的日志表/ClickHouse SQL；时间条件和投影是预算纪律，实际节省仍以平台计量验证。
4. 不读取 Secret、Vault 值、Cron command 或原始 return_message；公开排查报告只保留脱敏证据。重复查询没有可假定的服务端结果缓存。
5. 把 70/85/95% 作为建议告警点，现阶段未安装告警或自动任务。

Free 的 cached/uncached egress 各有独立 5 GB 额度，不能合并视为可互换的 10 GB 池。Storage 为 1 GB，数据库为 500 MB，分别计量；Smart CDN 和 Storage Image Transformations 不作为 Free 优化依赖。[Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)、[Storage 计量](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)、[Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)、[变换](https://supabase.com/docs/guides/storage/serving/image-transformations)

2026-10-13 约 02:58 UTC 只读 Storage 聚合：generated 39 对象/26087167 字节、uploads 8 对象/4199354 字节，共约 30.29 MB；这不是按 GB-hours 计费的账单，也不能用混合平均大小保证未来 2K 图片大小。此前 9.016/5 GB egress 与 9/16 Storage 峰值的具体调用/对象仍无法确认，不能声称已定位或已消除历史超额。

## 第一阶段实现

- 原图复用只在一次已授权 dispatch claim 内存活。每 claim 上限 8 MiB，单 Node 进程仅共享数字计量、合计 32 MiB；不保存共享原图或身份索引。先读入且能容纳的素材保留，不用 LRU 驱逐造成二次渲染阶段抖动。缓存命中检查租约/允许的素材 ID；失败不缓存，异步结束后再检查；执行结束 finally 释放，包括失败/失租。过大素材回到原读取路径。总 RSS 还包含 Buffer 复制、Sharp 原生解码和像素内存，不由该上限保证。
- 来源明确 404/空成功结果按过期处理；临时 Storage 故障返回 503、可重试，不在当前请求自动重试。独立复核用已安装 SDK 的合成响应复现了 download() 直接拒绝和 HTTP404 携带 NoSuchKey；分别经 RED→GREEN 修正，数字 HTTP 状态优先。模型、积分、发布围栏不变。
- 实际结果使用原生 IntersectionObserver 的视口和祖先裁切共同判定可见：覆盖桌面滚动 aside 与窄屏文档滚动；可见前没有 `<Image src>`，避免 AntD 内部预取。账号/任务/run/asset key 隔离挂载；过期图不进入预览组。预览组保留全部可访问原图导航，打开/翻页按需加载。暂无派生缩略图，首次可见仍传输完整原图；全部浏览后总原图字节并未缩小。
- 既有私有原图 API 每次身份/所有权校验、`private, no-store`、到期与删除撤销，以及 ZIP 原 JPEG 字节不变。

## Cron 历史机制与发布门禁

此前只读快照：数据库约 116.94 MB，Cron 历史约 81.60 MB、77473 行；大约占数据库 69.8%。每分钟生成与每 15 分钟清理合计每天 1536 次，不修改调度。历史增长估算不是连续实测；仅准备保留机制，不据此降低生成服务响应。

迁移 `20261013033300_cron_history_approved_retention.sql` 仅创建私有归档和 SECURITY INVOKER 函数，并撤销默认执行/表访问权限；不新增 grant，不清理历史，不安装 schedule，也不授予 service_role 执行权限。apply 本迁移本身不能减小现有历史。函数需要明确当前 jobID 白名单、具体 runID、冻结 UTC 截止时间、准确条数和审批记录引用；一次最多 500 行。成功结束至少保留 14 天，失败至少 30 天。运行中、未知状态、end_time 空、近期、无当前 job 映射、其他 job 或非批准 IDs 全部排除，任何批准范围变化整批中止。

实际执行前另行提供一份可审阅清单并获得批准：

- 当前 jobID/jobname 映射；停用/删除且已无映射的旧 jobID 不自动纳入。
- UTC 截止时间、总候选数、每批准确 runID/条数及清单哈希；不得用实时 `now()` 不断扩大批准范围。
- 脱敏归档字段 runid/jobid/status/start/end/archived_at/approval_reference；**不保留 command 和原始 return_message**，删除后无法恢复这些敏感原始字段，须明确接受这一限制。
- 独立批准迁移应用与实际 DELETE；本轮的代码批准不包含上述生产执行。
- 管理员每批独立事务，调用前设置 `SET LOCAL statement_timeout='5s'`；函数 lock_timeout 500ms、事务 advisory lock 串行、遵循原生 SELECT/DELETE 权限，以 DELETE 重核当前映射、归档元数据并取得行锁。归档与删除同一事务、条数一致；归档失败全部回滚。归档最多 100000 行，达到上限停止，需另行审阅外部归档/迁出；不安装自动归档删除。
- 标准 VACUUM 是否回收可复用空间需另行测量；不执行 VACUUM FULL，不承诺文件大小/数据库账单即时下降。

## 验收证据与限制

执行环境：本工作区、Node 24.19、Sharp 0.35.3；仅合成 JPEG/透明 PNG。没有模型调用、用户商品图或生产数据写入。

- 来源/cache/service/renderer/私有下载单测：包括读取去重、每次命中租约检查、claim/进程预算、超限回退、失败不缓存、pending 后释放及输出 SHA-256 对照。
- 原生 Chromium 151 + 实际 ApparelResultImage/AntD 合成 harness：30 张图，1280×720 首屏 2 请求、滚到末尾累计 4；600×720 首屏 5、末尾累计 10，末图可达、隐藏图未预取。此证据不代表已登录生产整页验收。
- 本地 PostgreSQL 17.6 + 真 pgTAP 31 项全部通过。因本地 pg_cron 安装源不可达，使用官方形状和原生 SELECT/DELETE/RLS 的 Cron 表 fixture；真实 Supabase/pg_cron 与全迁移/类型检查由 PR CI 执行。CLI 2.115.0 migration-new 因 `/home/agent/.supabase` 只读失败，文件名使用 UTC 时间戳手工创建；没有绕过凭据或连接生产。
- 原图传输性能：每读取注入 25ms，仅为可重复的延迟 fixture。记录 P50/P95、读取次数/字节、fresh-process maxRSS 和逐页 SHA-256；缓存计量不是 RSS。首轮并行构建/全量单测干扰了时间，不能据此宣称 P95 通过；最终串行对照另附结果。
- 最终自动检查：lint/typecheck、Domain 76、Web 656、Worker 80、运维 20、预算 5、隔离构建全部通过。单独最终服装相关 31 项通过；输出哈希等价及 ZIP 原字节校验通过。独立复核无剩余 Critical/Important 或 actionable Minor。真实 pg_cron/全迁移/生成类型仍以 PR CI 为门禁。

后续独立阶段：派生预览需要单独资产存储/授权/清理，不可混入 apparel_assets 完成计数或 ZIP 清单；不在响应中启动昂贵背景任务。ETag 须在新鲜授权后处理 304，短 Cron 包装器须核对 Vault/角色与现有调度后单独批准。当前没有上述功能的生产性能或收费效果结论。

### 串行合成性能对照（每路径 10 次，构建/单测结束后）

| 输入 | 原图读取 | P50 ms | P95 ms | 进程峰值 RSS MiB | 输出哈希 |
|---|---:|---:|---:|---:|---|
| 1 张展示，小型素材 基线 | 14 | 1117 | 1686 | 227.8 | 一致 |
| 1 张展示，小型素材 复用 | 7 | 946 | 984 | 237.7 | 一致 |
| 20 张展示，照片 10 MiB 超限 基线 | 52 | 4297 | 4777 | 329.7 | 一致 |
| 20 张展示，照片 10 MiB 超限 复用 | 52 | 4303 | 5071 | 328.0 | 一致 |

小素材读取减半；超限照片不缓存，读取数和原路径一致。本轮超限 P95 上升约 6.1%，小样本不能判断真实负载的延迟变化，不承诺线上 SLA。小素材峰值 RSS 上升约 4.3%，超限约下降 0.5%；这是进程观测值，含 Sharp/字体/输入 fixture，不是缓存占用。超限 fixture 是带尾部填充的合法 600×800 JPEG，用于验证字节预算回退，不代表大像素图的解码内存。P95 使用 nearest rank，10 次中包括各进程首张字体初始化。所有 11/30 张输出逐页 SHA-256 完全一致，未改变输出编码、尺寸或 ZIP。

### CI #58 发现并修正的原生权限差异

上游 pg_cron 默认授予 job 表 SELECT、历史表 SELECT/DELETE；普通 postgres 不能直接 INSERT 或使用需要 UPDATE 权限的 FOR KEY SHARE/FOR UPDATE。[pg_cron job 定义](https://github.com/citusdata/pg_cron/blob/v1.6.7/pg_cron.sql)、[历史表定义](https://github.com/citusdata/pg_cron/blob/v1.6.7/pg_cron--1.2--1.3.sql)

原 CI58 的新测试在直接插入 job fixture 时失败，旧 29 文件/1005 项通过。没有放宽权限。样本仅由隔离 CI 的 supabase_admin 初始化，job inactive，username=postgres；测试和实际函数以普通 postgres 执行，只依赖 SELECT/DELETE，不变更既有权限。函数在归档之后的 DELETE 中重新匹配当前 job 和所有归档元数据，改变或不可见的行导致条数不符并整批回滚；不再请求额外 UPDATE/行锁权限。归档事务/advisory串行/lock_timeout/500条上限和权限撤销均保留。

以无额外 UPDATE 权限的普通角色复现原函数 42501 RED，再验证修正后的 31 项 GREEN；本地最小权限角色确认 job/history 均无 UPDATE，平台测试确认所需 SELECT/DELETE，元数据不匹配时保留原行。CI59 的真实函数/其余1035项通过，仅“历史无UPDATE”平台假设断言失败：Supabase既有历史UPDATE权限保留，断言改为验证必需SELECT/DELETE。CI60再次验证真实扩展、全迁移和生成类型。生产迁移/权限/调度均未改变。
