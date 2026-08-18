# Zima 本地开发基线

## 运行时与安装

仓库通过 `.node-version`、根 `engines` 和 `packageManager` 固定 Node.js 24.19.0 与 pnpm 11.22.0。依赖必须使用精确版本并提交 `pnpm-lock.yaml`。

```bash
pnpm install --frozen-lockfile
```

复制 `.env.example` 为未提交的 `.env`，只填写本地或受控环境值。浏览器变量只能包含 Supabase URL 和 publishable key；secret/service-role、SMTP 与供应商凭证只能由服务端环境读取。

## 根命令

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm check:secrets
```

`pnpm dev` 启动 Web 与 Worker 开发进程。Worker 只验证环境并输出脱敏启动事件，不消费 Queue。

## Supabase 与数据库测试

本地 Supabase 需要 Docker。迁移必须使用项目内 CLI 创建：

```bash
pnpm exec supabase migration new <descriptive_name>
```

完整验证顺序：

```bash
pnpm db:start
pnpm db:reset
pnpm test:db
pnpm db:types
git diff --exit-code -- packages/supabase/src/database.types.ts
pnpm db:stop
```

浏览器可访问表必须在同一 migration 中显式 `GRANT`、启用 RLS 并增加匿名/本人/跨用户负向测试。RLS 不替代 Data API 权限，Data API 权限也不替代 RLS。

阶段 0 的 pgTAP 只在回滚事务内创建测试夹具，不留下业务表。Docker 不可用时，不得把数据库迁移、pgTAP 或类型生成标记为已验证。

## Mailpit

```bash
pnpm mail:start
pnpm mail:stop
```

SMTP 监听 `127.0.0.1:1025`，Web UI 与健康检查位于 `http://127.0.0.1:8025`。阶段 0 不实现 OTP 发送。

## 外部门槛

EXT-001～005 仍为 `external-gated`。本地配置和 Mock 不代表 SMTP、Supabase Cloud、阿里云图片能力、合规审批或生产价表已经可用。

