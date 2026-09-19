# 电商生图实施验证记录

日期：2026-09-08。工作分支 `codex/phase2`，实施基线 `bc05783d49645976cbfc54882c4ec8f7ae078e28`。当前交付状态以[项目进度](../project-progress.md)为准；本文件用于记录验证证据与运行边界。

## 实现范围

- `/create` 六个场景、三个国内平台、十二个原创模板；在 `/` 唯一工作台保存方案、确认选中图片、逐图重做、切换历史和按固定选图下载。
- 旧三个 Skill 合并进方案确认。方案、讨论和补资料不调用生图；真实商品图与风格引用分开；AI 整图文字，改字重生成。
- 服务端编译、版本与请求幂等、原子执行组、选图版本保护、归档与取消未派发项；复用现有模型、队列、额度和私有存储。
- 持久 Worker 租约、已知结果登记与恢复、未知结果隔离、跨日额度保留与清理补偿；生成样图经受保护的转换后才能作为风格参考。

## 已完成的独立回归

| 检查 | 当前证据 | 适用范围 |
| --- | --- | --- |
| Domain 全部测试 | 40 passed | 领域 schema、模型注册、规划与意图分类；末次文案测试格式调整不改变语义 |
| Web 全部测试 | 308 个用例均取得通过证据（全量 + 失败文件复验） | 全量先为 305 passed / 3 failed；三个用例过早读取异步完成结果。修正测试准备后，整个 commerce-ui 文件 24/24 通过；生产代码未因该修正变化 |
| 最终 lint / typecheck | 均 exit 0 | 使用声明的 Node/pnpm；lint 保留 Next 插件关于根目录无 Pages 目录的提示，没有 ESLint 违规 |
| 最终生产构建 | exit 0 | `NEXT_DIST_DIR=.next-commerce-build pnpm build`；编译、类型检查、页面与 API 路由生成通过 |
| 最终完整浏览器回归 | 53 passed / 25 skipped，exit 0，4.7 分钟 | Chromium 桌面、Edge 平板、Chromium 移动端；22 项为原有视口条件，3 项真实认证因未配置环境跳过；不是 Safari 验收 |
| Worker/Provider 聚焦测试 | 31 passed | 依赖注入的 Provider/Storage/RPC 故障、续租与恢复；没有真实图片调用 |
| 可靠性顺序 SQL | 64 passed | PGlite 中约束、权限、状态转换和参考顺序 |
| 历史数据升级 SQL | 4 passed | 先写旧未知/失败记录，再加载新迁移；仅重做明确失败项 |
| 可靠性双连接 SQL | 21 skipped | PGlite 没有 dblink，未执行真实锁竞争 |
| Commerce SQL | 131 passed（合并迁移后独立复验） | 授权、预检、原子回滚、幂等、版本、选图、写入预算与跨日取消 |
| Commerce 双连接 SQL | 8 skipped | 同键/异键提交竞争尚需真实 PostgreSQL |
| 本机视觉检查 | 目录与向导正常；缺商品图只问一项；无框架错误遮罩 | Chromium、本机 Mock 服务 |

当前三份迁移合并后已独立复验：**293 顺序断言 + 4 升级断言通过，29 并发断言跳过**。293 = commerce 131 + reliability/order/review 64 + reference 98。所有数据库数据都在临时 PGlite 内存实例中。

文档检查：正式文档、实施计划和进度账本的 7 份 Markdown 共检查 30 个本地链接与代码围栏；本轮新增链接正常。账本历史部分有 7 个已失效路径，确认在 Git 基线中已存在，未作为本次验收来源。

独立代码审查的 C02–C06、CS1–CS3、7 项 UI、2 项参考转换与 6 项领域/网关问题均已修复并复核关闭；Mock 原子提交修复衍生的并发写入隔离和旧子类转发问题也完成复核。Mock 内部使用单个持久化包、共享写入队列和显式内部请求标识；这不声称提供跨标签页事务。

最终 Web 全量运行耗时 463 秒，随后电商 UI 整文件复验耗时 110 秒。测试准备明确区分“提交已受理”和“异步图片已完成”，等待当前选图齐全后再检验重做、导出和旧方案恢复；没有删除或放宽功能断言。

浏览器最终整套 53/25 结果来自服务健康检查通过后的单次完整运行。较早在构建/单测竞争资源时出现两条长流程超时，长流程保留断言并改用 120 秒预算，独立复验通过；另一次启动时预览服务已退出，32 条错误均为 `ERR_CONNECTION_REFUSED`，重启并确认 `/create` 返回 200 后取得上述整套通过结果。最终浏览器运行没有其他构建或单测并行。本地通过不等于真实后端已验收。

## 运行方式与未执行项

使用项目声明的 Node 24.19.0、pnpm 11.19.0，已按 frozen lockfile 安装；未升级依赖。

常规检查：`pnpm lint`、`pnpm typecheck`、`pnpm test:run`、`pnpm build`、`pnpm e2e`。Worker 另运行 `pnpm exec vitest run supabase/functions/generation-worker supabase/functions/cleanup-worker`。本机已有服务时，E2E 使用 `PLAYWRIGHT_BASE_URL` 指向该服务，避免占用其他应用端口。

PGlite 0.5.8 / PostgreSQL 18.3 只用于临时内存模拟：Auth/Storage 是合成表，PGMQ 是事务模拟；没有 GoTrue、私有桶服务、真实队列调度、多连接或 Edge 平台上限。项目目标仍为 Supabase/PostgreSQL 17。实际数据库验收需在隔离环境依次加载三份新迁移，并运行仓库 `supabase/tests/database` 的相关测试；历史升级测试必须在加载可靠性迁移前写入对应 fixture。

当前未执行：真实 Supabase 迁移与 pgTAP、多连接锁竞争、真实上传/删除竞争、认证服务回跳、模型效果与消费预算评测、部署。没有对远端数据库、用户内容或付费生成作写入。

三份新迁移依赖顺序：

1. `20260908043010_phase2_generation_reliability.sql`
2. `20260908043031_commerce_tasks.sql`
3. `20260908044934_commerce_reference_history.sql`

上线前还须用目标数据库重新生成类型，并验证实际 Provider/Storage 请求和内存上限。已知结果的私有数据库暂存沿用 30 MiB 图片上限，最大负载尚未在真实平台测量。`ZIMAGE_COMMERCE_SUBMIT_ENABLED=false` 可暂停新增电商生图，保留历史读取与下载；不是回滚已执行迁移的替代。
