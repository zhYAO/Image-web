# 电商云端同步范围（已授权并执行）

2026-09-08。目标：现有 Supabase 项目 `klmiycyesxnpinxpeqep`。

用户在本任务中回复“开始同步”后执行。当前结果见 `../project-progress.md` 的“电商云端同步”记录。

## 同步前确认的差异

- 云端迁移停在 `20260907111328_phase2_auth_runtime_fixes`。
- `public.commerce_tasks` 不存在，`public.commerce_dispatch` 不存在；真实工作区 `GET /api/creative-tasks` 返回 503。
- 普通生图独立可用：本轮 Chrome 的 Seedream 4.5 单图已成功，刷新后可恢复。不能通过普通生图成功推断电商后端已安装。

## 需同步的现有代码

按依赖顺序应用以下本地迁移：

1. `supabase/migrations/20260908043010_phase2_generation_reliability.sql`：生成执行记录、领取令牌、额度历史与清理恢复；包含现有额度记录的升级。
2. `supabase/migrations/20260908043031_commerce_tasks.sql`：电商任务、版本、执行组及仅供服务端调用的任务入口。
3. `supabase/migrations/20260908044934_commerce_reference_history.sql`：参考图写入、历史图转参考图及对应清理入口。

配套发布 `supabase/functions/generation-worker/index.ts` 与 `supabase/functions/cleanup-worker/index.ts`，连同各自引用的 `_shared` 文件。应用页面仍运行本地，不包含 Vercel 部署。

## 执行与验收边界

- 执行前再核对目标项目、迁移差异、在途生成与清理任务，完成当前 SQL/Worker 兼容性复核；不要在存在无法确认的 Provider 结果时重放任务。
- 数据库与 Worker 按依赖顺序同步，保留用户、既有会话、图片与额度，不重置数据库或删除验收数据。
- 验证任务入口权限、创建/保存方案不生成图片、刷新恢复及既有普通图片读取。付费电商生成验证需明确预算。
- 失败时暂停新增电商提交，保留现有结果读取；不得通过删除任务表或重试未知 Provider 请求进行回退。
- 本地 Mock/PGlite 历史证据不替代此目标数据库的实际验收。

## 执行结果

- 三份迁移已应用，远端历史编号与上述本地文件一致。生成 Worker v12、清理 Worker v15 均 ACTIVE，原有定时调度已恢复。
- Chrome 真实验证参考图上传 201、方案保存 200、任务加载 200；五张“白色杯子”方案刷新后仍为待确认。未提交付费图片生成。
- Worker/Provider Vitest 31/31、两个生产入口 Deno check 通过。无凭据 Worker 请求均 401；数据库领取接口在回滚事务中验证，未执行清理。
- 自动审批拒绝了手动触发两个生产 Worker，理由是可能删除 Storage/账号数据。没有改走间接手动触发；恢复原有调度是部署维护的收尾步骤。
- 付费电商出图与实际清理副作用尚未作为本次同步验收内容执行。
