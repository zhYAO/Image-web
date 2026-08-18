# Zima

Zima 是面向中国大陆电商设计师的 AI 商品图生产工作台。本仓库当前只包含 Phase 1 的阶段 0 工程与质量基线；认证、业务表、图片 Tool、积分和供应商调用尚未实现。

产品与工程真相源：

- [`doc/requirements.md`](./doc/requirements.md)
- [`doc/architecture.md`](./doc/architecture.md)
- [`doc/tech-selection.md`](./doc/tech-selection.md)
- [`AGENTS.md`](./AGENTS.md)

## 环境要求

- Node.js `24.19.0`
- pnpm `11.22.0`
- Docker Desktop 或兼容容器运行时（仅数据库、Mailpit 与 pgTAP 验证需要）

## 开始使用

```bash
pnpm install --frozen-lockfile
pnpm dev
```

阶段 0 的完整命令、数据库流程和外部门槛见 [`doc/development.md`](./doc/development.md)。
