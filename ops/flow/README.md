# ZImage Flow

## 质量检查试运行

独立验证流水线 `1414986` 使用 [quality.yml](quality.yml)、上海站 Codeup 镜像和既有服务连接。原流水线 `1414878` 的运行记录作为现有构建通道证据。

1. 核对 GitHub 与 Codeup 的完整分支 SHA。手工试运行时设置 `EXPECTED_COMMIT` 为该 SHA。
2. 为 `database` 任务启用独立、初始为空的 Docker daemon。执行器通过隔离验收后，才允许将 `ZIMAGE_FLOW_ISOLATED_DOCKER` 设为 `1`。任务在依赖安装前后检查容器和卷。
3. 确认 `quality` 与 `database` 对同一 SHA 均成功。用错误 SHA 和有类型漂移的提交复验失败路径。

Node `24.19.0` 归档经过摘要校验，pnpm 使用 `11.19.0`。质量任务运行应用、Worker 和运维检查。数据库任务仅在隔离 daemon 内启动 Supabase，并比较生成的数据库类型。

## 受保护的同步与回写

仅从受保护的控制任务运行 `node ops/flow/reconcile.mjs`，设置流水线并发为 `1`。任务从 GitHub 读取 `main` 和本仓开放 PR，校验 Codeup 镜像后发起质量运行。GitHub 推送和 Flow 定时补查应调用同一个控制任务。

- 定时任务通过 `ZIMAGE_GITHUB_APP_CLIENT_ID`、`ZIMAGE_GITHUB_APP_INSTALLATION_ID` 和受保护的 `ZIMAGE_GITHUB_APP_PRIVATE_KEY` 在运行时获取短期令牌。已有的短期安装令牌也可通过 `ZIMAGE_GITHUB_APP_TOKEN` 传入。`ZIMAGE_GITHUB_APP_BOT_ID` 指定回写账号 ID。令牌只授权读取本仓内容及 PR 并写入提交状态。
- `ZIMAGE_FLOW_PAT` 需要读取 Codeup 分支及读写该质量流水线运行。`ZIMAGE_FLOW_QUALITY_PIPELINE_ID` 指向包含 `quality` 和 `database` 的试运行流水线。
- 受保护的执行器需要配置官方 `aliyun` CLI 的镜像同步授权。先在上海站核验 `TriggerRepositoryMirrorSync` 的实际支持、授权和响应，再启用自动触发。

控制器在提交 Flow 运行前回写 `pending`，收到运行 ID 后才开始追踪结果。已知失败运行可在 Flow 重试原运行中的失败任务，控制器按同一个运行 ID 重新核验。若提交响应丢失，先查 Flow 运行记录并对账，避免直接重复提交。分支保护生效前保留原合并流程。来自 fork 的分支需要先进入同仓受检分支，Codeup 镜像才会检出该提交。

## 后端候选构建

在与 ECS 匹配的 Linux 环境执行 `bash ops/flow/run-checks.sh backend`。传入 `EXPECTED_COMMIT`、`ZIMAGE_FLOW_TARGET_FILE`、`ZIMAGE_FLOW_FONT_SOURCE` 和仓库外的新目录 `ZIMAGE_FLOW_ARTIFACT_DIR`。构建配置使用项目文档列出的公开变量。

交付制品选取 `transport.tgz` 与 `release-result.json`。打包输出包含预检及摘要，部署仍需生产审批、兼容性与独立验证回执。
