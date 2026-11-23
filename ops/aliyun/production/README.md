# 上海 ECS 的前后端成对发布

维护者把 PR 合并到受保护的 `main` 后，`production.yml` 检查合并提交对应的 PR 和目标分支。GitHub 托管的 Ubuntu 22.04 runner 校验实际 Node、ABI、架构和 glibc，按锁文件构建静态前端、Next standalone 和资源层。默认只执行构建和测试，使用仓库级的三项公开构建变量；缺少必填值会使构建失败。验收完成后，管理员显式将仓库级 Actions 变量 `ZIMAGE_PRODUCTION_DEPLOY_ENABLED` 设为 `1`，后续符合条件的合并才进入 `production` 环境。缺省及其他值均不签发、不发送。启用后，同一 SHA 的前后端封入一个 `pair.tar`，由 `actions/attest` 签发整包 provenance，再检查 main 最新提交。包和证明经一次 SSH 连接直送 ECS。GitHub 保存证明，生产包不上传至 Actions artifacts。旧的手动 CI 仍可检查或构建候选，其 ZIP 按仓库可见性处理。

启用发布后，构建及发送位于同一个受保护的 production 作业，避免跨作业公开传包。这个 runner、被合并的构建代码及锁定依赖都属于信任边界。专用 SSH 私钥只供发送步骤使用。ECS 按管理员独立安装的信任根离线验证仓库、工作流路径、main ref、源码 SHA、工作流 SHA、托管 runner 和实际归档摘要，然后才解包。[GitHub Environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments) · [官方 attest Action](https://github.com/actions/attest) · [离线验证](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline) · [CLI 验证参数](https://cli.github.com/manual/gh_attestation_verify)

## 一次性启用条件

1. 在已有上海实例的可信控制台核对实例 ID、地址和 Ed25519 SSH 主机公钥。GitHub 的 `production` 环境限 main，填 `ZIMAGE_ECS_ADDRESS` 和 `ZIMAGE_ECS_HOST_KEY`（后者格式为 `ssh-ed25519 <公钥正文>`）。沿用已确认的三项公开构建变量，见 [构建输入](../BUILD-PREREQUISITES.md)。让新专用密钥成为环境 secret `ZIMAGE_PRODUCTION_RELEASE_KEY`，生产主机上保留系统 Node 22。
2. 为专用账户 `zimage-release` 仅授权下面这一把强制命令密钥。账户无其他登录途径、sudo 授权、可写启动脚本或可修改的 authorized_keys。用管理员管理的 `AuthorizedKeysFile`，确认 sshd 对该账户禁用密码、用户环境和其他身份认证入口。账户不能写代码、助手、信任根或配置。先核对正常登录不可取得终端、端口转发、任意命令或 SFTP；sender 固定检查主机密钥。[OpenSSH authorized_keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)

   ```text
   restrict,command="/usr/bin/sudo -n /usr/bin/python3 -I -B /usr/local/libexec/zimage-production/receive.py" ssh-ed25519 <新发布公钥>
   ```

   对应 sudoers 规则仅含 `zimage-release ALL=(root) NOPASSWD: /usr/bin/python3 -I -B /usr/local/libexec/zimage-production/receive.py`。默认 `env_reset`，不授予 SETENV。接收端忽略原始 SSH 命令和任意远程路径参数。

3. 由管理员核对、安装本提交的 `receive.py`、`check.py` 到上述 production 目录。核对三层助手目录 `/usr/local/libexec/zimage-three-layer` 的完整文件集（`release-three-layer.py:TOOLS`），其中需要新版 `prepare_archive`、schema 3 与 `public-image-contract.py`。在 `/usr/local/libexec/zimage-backend` 核对 `release.py`、`transaction.py`、`http-admission.cjs`、`next-source-profiles.json`。文件和祖先目录须 root 管理。确认现有 split Nginx 路由及有效的 ingress-maintenance 配置、前后端 current、命名空间 assets、缓存及可用磁盘。核对已加载的 `zimage.service` 专用 Node 24.19.0、服务身份、每版资源 EnvironmentFile、三层目标配置和业务排空 preload。实际 MainPID、cwd、私有状态 socket、原生运行时任一不符即停止。[服务模板](../zimage.service) · [现有后端服务前置条件](../backend/README.md)

4. 目标机的 `/usr/bin/gh` 需要支持本实现使用的验证参数（本地验证使用 2.83.2）。管理员从独立可信机器执行 `gh attestation trusted-root`，将结果安装为 root 管理的 `/etc/zimage/production-trusted-root.jsonl`，按官方轮换指引更新。发布发送方不能提供或更改该文件。
5. 由数据库负责人核实**同一真实生产数据库**支持当前代码、候选代码以及切回旧代码。对照 `git diff 7a811b3..a3f43a6 -- supabase/migrations` 的两份 SQL，分别涉及 OpenAI 聊天计量与提供方诊断。核对实际已应用的修订、RPC/权限、Worker 和计量兼容后，由管理员把实际实例 ID 和已批准的迁移树写入 `/etc/zimage/production-target.json`。字段为 `instanceId` 和 `compatibleMigrationTrees`（Git tree SHA 字符串数组）；通过 `git rev-parse <commit>:supabase/migrations` 取值。一次发布要求候选、保留版两棵树同时获准。静态树值是审查索引，不能替代检查生产数据库。此流程不访问数据库或执行 SQL。
6. 先确认真正的公网 DNS、证书、首页及版本接口已经恢复。当前首次基线要求后端 `7a811b326aa4b344cee08bc5a33c04e44a780fd4`、前端 `release-7a811b326aa4`、对应源 SHA 和健康原进程。首次启用仍需由维护者在授权窗口验证真实服务、SSH 权限及真实恢复。演示样例或本机回环 200 都不足以满足这些条件。

构建复用优化开发分支 `68e71973dc2f6295d1d33206728f460c79e4f832` 的前后端与锁文件，使用 `model-only-jsquash` 运行层。两个构建都按固定 HTTPS 地址、响应策略、字节数和 SHA-256 验证全部 62 张公开图。接收端在服务停止后按该版本的 profile 探测模型版 WASM 或旧版原生字体，然后才切换。先在变更窗口核对整套助手、preload、Next profile 和旧版恢复能力。

## 切换与失败

GitHub concurrency 保留正在运行的作业。ECS 使用现有 `/opt/zimage/deploy.lock` 串行化接收、验签、准备、切换和恢复，拒绝旧运行号及未对账的事务。它保留所有正式版本及旧静态资源。发布期间由本助手独占生产切换，暂停旧人工发布工具。[GitHub 并发语义](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

在切换前，本机 TLS 和外部 runner 分别检查现网精确版本、API 契约、首页与实际版本化 JS。排空同一 PID 的 HTTP、后台工作及业务计数后，临时移走已有 Nginx open 标记，并实测静态首页和 API 一致返回维护 503。随后停止该服务、检查原生依赖、分别原子替换两个 current，再以原 systemd 单元启动。Nginx 保持封闭直至新进程的 PID、cwd、私有 socket 与排空门禁都通过检查；此时才还原原标记。单机重启有短暂不可用窗口。候选先处于只读检查模式，本机和外部均通过后才开放业务，并再次检查双方。生产业务登录、付费生成、数据库内容等不在这套只读探测的验证范围。

- `committed` 才会让工作流成功。
- 候选启动或验收失败时，事务选回本次记录的旧前后端，实际启动旧进程，并核对 PID、路径、版本和公网服务。完整恢复后写 `restored`，返回 20，本次发布仍失败。
- 恢复或公网确认失败，记录 `needs_attention` 并尝试封闭业务入口；SSH 中断后也可能留下非终态。先读 `/opt/zimage/production-release.json`（含签名整包 SHA-256）、两个 current、Nginx open/saved-open 标记、Node 门禁、MainPID 和实际本机/公网版本，再决定人工恢复。不得凭客户端断线、指针已切回或本机 200 宣告恢复或重发。进程被杀或主机掉电时需要人工对账。

本地回归命令为 `python3 -B -m unittest discover -s ops/aliyun/production -v`。用临时目录、真实进程、文件锁、符号链接验证事务，GitHub 签发和生产服务链路需在授权合并后验收。
