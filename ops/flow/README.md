# ZImage Flow

## 质量检查试运行

独立验证流水线 `1414986` 使用 [quality.yml](quality.yml)、上海站 Codeup 镜像和既有服务连接。原流水线 `1414878` 的运行记录作为现有构建通道证据。

1. 核对 GitHub 与 Codeup 的完整分支 SHA。手工试运行时设置 `EXPECTED_COMMIT` 为该 SHA。
2. 为 `database` 任务启用独立、初始为空的 Docker daemon。执行器通过隔离验收后，才允许将 `ZIMAGE_FLOW_ISOLATED_DOCKER` 设为 `1`。任务在依赖安装前后检查容器和卷。
3. 确认 `quality` 与 `database` 对同一 SHA 均成功。用错误 SHA 和有类型漂移的提交复验失败路径。

Node `24.19.0` 归档经过摘要校验，pnpm 使用 `11.19.0`。质量任务无需下载字体，保留应用覆盖率、双端构建、Worker 和运维检查。标记为 `[apparel-fonts]` 的真实字体用例在后端候选构建时运行。数据库任务仅在隔离 daemon 内启动 Supabase，并比较生成的数据库类型。

## 受保护的同步与回写

仅从受保护的控制任务运行 `node ops/flow/reconcile.mjs`，设置流水线并发为 `1`。任务从 GitHub 读取 `main` 和本仓开放 PR，校验 Codeup 镜像后发起质量运行。GitHub 推送和 Flow 定时补查应调用同一个控制任务。

- 定时任务通过 `ZIMAGE_GITHUB_APP_CLIENT_ID`、`ZIMAGE_GITHUB_APP_INSTALLATION_ID` 和受保护的 `ZIMAGE_GITHUB_APP_PRIVATE_KEY` 在运行时获取短期令牌。已有的短期安装令牌也可通过 `ZIMAGE_GITHUB_APP_TOKEN` 传入。`ZIMAGE_GITHUB_APP_BOT_ID` 指定回写账号 ID。令牌只授权读取本仓内容及 PR 并写入提交状态。
- `ZIMAGE_FLOW_PAT` 需要读取 Codeup 分支及读写该质量流水线运行。`ZIMAGE_FLOW_QUALITY_PIPELINE_ID` 指向包含 `quality` 和 `database` 的试运行流水线。
- 受保护的执行器需要配置官方 `aliyun` CLI 的镜像同步授权。先在上海站核验 `TriggerRepositoryMirrorSync` 的实际支持、授权和响应，再启用自动触发。

控制器在提交 Flow 运行前回写 `pending`，收到运行 ID 后才开始追踪结果。已知失败运行可在 Flow 重试原运行中的失败任务，控制器按同一个运行 ID 重新核验。若提交响应丢失，先查 Flow 运行记录并对账，避免直接重复提交。分支保护生效前保留原合并流程。来自 fork 的分支需要先进入同仓受检分支，Codeup 镜像才会检出该提交。

## 前端候选构建

[frontend-candidate.yml](frontend-candidate.yml) 用于 Flow `1415019` 的 `main` 候选构建。控制器启用候选提交前，配置 `ZIMAGE_FLOW_FRONTEND_CANDIDATE_PIPELINE_ID=1415019` 和逗号分隔的 `ZIMAGE_FRONTEND_BACKEND_RELEASES` 完整 SHA 列表。控制器读取指定 App 的质量状态，再向 Flow 核验同一 SHA、同一次运行中的 `quality` 和 `database` 均成功。只为当前 `main` 预留一次候选提交，并通过独立的 `yunxiao/frontend-candidate` 状态记录流水线运行。提交响应丢失时先核对原预留和 Flow 运行，避免重复启动。

候选任务只接收 `EXPECTED_COMMIT`、待验收的后端 SHA 列表和 `ZIMAGE_GITHUB_APP_BOT_ID`，使用公开 API 读回质量状态。构建前和归档前都检查 GitHub `main` 与指定 App 的通过状态，并确认 Codeup 实际检出同一完整 SHA。固定工具链构建浏览器和 SSR 预渲染产物，每次运行以流水线 ID、运行号及源码 SHA 组成唯一 namespace。候选任务没有生产发布身份或 GitHub 回写凭据。

从组织内 `flow_generic_repo` 下载该运行的 `zimage-frontend-candidate` 制品。核对 `SHA256SUMS` 后解包 `frontend-candidate.tgz` 到独立验收目录。`candidate.json` 记录候选的源码身份和允许测试的后端集合。按[前端验收协议](../aliyun/frontend/README.md)固定公开配置和主体摘要，完成旧、新后端兼容性验收后，再用报告生成正式包及批准申请。Flow 的候选制品与正式生产包各有用途，生产激活必须经受限发布器校验管理员批准。

## 前端验收封包

在受保护的 Flow Linux 任务中使用干净的精确 `main` 检出。封包前用 `python3 -I -B ops/flow/frontend_operation.py --check-main "$EXPECTED_COMMIT"` 核验质量状态。准备固定版本的原始 Packages 归档、验收时取得的公开配置和[证据 JSON](../aliyun/frontend/README.md)。每份原始报告按 `<acceptanceSha256>.json` 保存。报告包含证据的四个主体字段，以及该次验收的 `sourceSHA`、`backendRelease` 和 `outerArchiveSha256`。

以普通用户执行以下命令，输出目录必须为全新目录。`CANDIDATE_SHA256` 是验收时核对过的原始 Packages 归档摘要。若执行器默认使用 root，在独立工作目录准备普通用户可读的干净检出和可写的输出父目录，封包成功后再将输出复制到归档步骤的工作区。

```bash
python3 -I -B ops/flow/frontend_review.py \
  --project "$PROJECT_DIR" \
  --candidate "$CANDIDATE_PACKAGE" --candidate-sha256 "$CANDIDATE_SHA256" \
  --public-config "$PUBLIC_CONFIG" --evidence "$ACCEPTANCE_EVIDENCE" \
  --reports "$ACCEPTANCE_REPORTS" --output-dir "$PROJECT_DIR/frontend-release-review"
```

封包校验两层候选归档、源码身份和各后端报告摘要，再由现有打包器独立解包复验。归档前再次执行 `--check-main`，成功后用 `ArtifactUpload` 将整个 `frontend-release-review/` 上传到私有 `flow_generic_repo` 的 `zimage-frontend-release-review`，固定版本且关闭 `includePathInArtifact`。目录包含 `frontend-review.tgz`、清单、审批申请和原始报告。审批申请需由独立管理员审查后在 ECS 放行。

## 前端发布与回退

[发布模板](frontend-deploy.yml)和[回退模板](frontend-rollback.yml)用于独立的手动触发流水线。安装前将 `__ZIMAGE_FRONTEND_REVIEWER_ID__` 替换为指定的云效审批人 ID，限制编辑、触发和私密变量权限，并将并发设为 `1`。保持来自 `main` 的受保护代码源。发布时选择 `zimage-frontend-release-review` 的精确 Packages 版本并传入相同的 `ZIMAGE_FRONTEND_PACKAGE_VERSION`。默认版本 `1415019-5` 是试验审查包，客户端会拒绝将试验分支提交发布到生产。

1. 在 ECS 按[服务端协议](../aliyun/frontend/README.md)准备独立、限时的操作批准和制品批准。运行参数提供操作 ID、批准文件 SHA-256、目标 namespace、当前后端完整 SHA 和目标制品源码完整 SHA。发布另提供正式包 SHA-256。回退只选已封存并批准的目标，使用新的操作 ID 和批准，通过 `ZIMAGE_FRONTEND_CONTROL_SHA` 固定运行回退命令的已审查 `main` 源码。
2. 仅向受保护的发布任务注入 `ZIMAGE_FLOW_FRONTEND_SSH_KEY` 和 `ZIMAGE_FLOW_FRONTEND_KNOWN_HOSTS`。后者为已核验的生产 ED25519 主机公钥行。发布另配置 `ZIMAGE_GITHUB_APP_BOT_ID`，使用公开 GitHub API 读回指定 App 的 `yunxiao/quality`，无需 PR 回写凭据。用户在 Flow 人工卡点审查同一批准文件摘要后放行。
3. Flow 回读操作状态后提交，随后从执行器核对公网版本和匿名认证接口。生产步骤禁用自动重试，连接中断时使用 `frontend_operation.py --query --operation ID --approval-sha256 SHA` 读取原结果。若服务端尚未登记操作，查询会返回 `absent`。此时同样先核对 ECS 日志和实际版本，之后按最新基线单独批准新的操作 ID。

## 后端候选构建

在与 ECS 匹配的 Linux 环境执行 `bash ops/flow/run-checks.sh backend`。传入 `EXPECTED_COMMIT`、`ZIMAGE_FLOW_TARGET_FILE`、`ZIMAGE_FLOW_FONT_SOURCE` 和仓库外的新目录 `ZIMAGE_FLOW_ARTIFACT_DIR`。构建配置使用项目文档列出的公开变量。

候选构建先校验已配置的原始字体和许可。使用同一份制品资源运行字体文件、服装渲染、服装服务、静态资源打包和原生探针测试，全部通过后才构建并打包。新增带 `[apparel-fonts]` 标记的测试文件时，将其加入后端测试命令。

交付制品选取 `transport.tgz` 与 `release-result.json`。打包输出包含预检及摘要，部署仍需生产审批、兼容性与独立验证回执。
