# 上海 ECS 的前后端成对发布

日常只有两个入口：PR 看 `Check ZImage` 的 `zimage-release-pr-required`，合并后看 `Publish merged ZImage pair` 的步骤摘要。前者也支持在 `main` 手动运行完整检查，包括临时本地数据库；它不接触生产。后者检查同仓 PR 的合并 SHA，在 GitHub 托管 Ubuntu 22.04 上匹配 Node、ABI、架构及 glibc，按锁文件构建静态前端、Next standalone 和资源层。生产服务器不构建。

仓库级 Actions 变量 `ZIMAGE_PRODUCTION_DEPLOY_ENABLED` 默认关闭。满足下列首次启用条件后才设为 `1`；用一个新的合并投递。未启用或重跑时仅构建，不能提升旧 run。启用后，签发同一 SHA 的 `pair.tar`，记录摘要，发送前复查 `main`，再通过一次固定身份的 SSH 连接交给 ECS。GitHub 保存签名证明，不上传生产包，也不从旧 ZIP 提升发布。

启用发布后，构建及发送位于同一个受保护的 production 作业，避免跨作业公开传包。这个 runner、被合并的构建代码及锁定依赖都属于信任边界。专用 SSH 私钥只供发送步骤使用。ECS 按管理员独立安装的信任根离线验证仓库、工作流路径、main ref、源码 SHA、工作流 SHA、托管 runner 和实际归档摘要，然后才解包。[GitHub Environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments) · [官方 attest Action](https://github.com/actions/attest) · [离线验证](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline) · [CLI 验证参数](https://cli.github.com/manual/gh_attestation_verify)

## 一次性启用条件

1. 在已有上海实例的可信控制台核对实例 ID、地址和 Ed25519 SSH 主机公钥。GitHub 的 `production` 环境限 main，填 `ZIMAGE_ECS_ADDRESS` 和 `ZIMAGE_ECS_HOST_KEY`（后者格式为 `ssh-ed25519 <公钥正文>`）。沿用已确认的三项公开构建变量，见 [构建输入](../BUILD-PREREQUISITES.md)。让新专用密钥成为环境 secret `ZIMAGE_PRODUCTION_RELEASE_KEY`，生产主机上保留系统 Node 22。
2. 为专用账户 `zimage-release` 仅授权下面这一把强制命令密钥。账户无其他登录途径、sudo 授权、可写启动脚本或可修改的 authorized_keys。用管理员管理的 `AuthorizedKeysFile`，确认 sshd 对该账户禁用密码、用户环境和其他身份认证入口。账户不能写代码、助手、信任根或配置。先核对正常登录不可取得终端、端口转发、任意命令或 SFTP；sender 固定检查主机密钥。[OpenSSH authorized_keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)

   ```text
   restrict,command="/usr/bin/sudo -n /usr/bin/python3 -I -B /usr/local/libexec/zimage-production/versions/<KIT_ID>/kit.py" ssh-ed25519 <新发布公钥>
   ```

   对应 sudoers 规则仅含 `zimage-release ALL=(root) NOPASSWD: /usr/bin/python3 -I -B /usr/local/libexec/zimage-production/versions/<KIT_ID>/kit.py`。默认 `env_reset`，不授予 SETENV。接收端忽略原始 SSH 命令和任意远程路径参数。

3. 从独立审阅的提交运行 `python3 -I -B ops/aliyun/production/kit.py digest` 记录 `KIT_ID`。该 SHA-256 标识接收器、preload、Next profile 和所有依赖助手的名称及字节。可先在私有临时目录执行 `python3 -I -B ops/aliyun/production/kit.py stage "$KIT_ID" "$EMPTY_PARENT"` 核对布局。经单独授权后，管理员在可信控制台创建 root 管理、模式 0755 的 `/usr/local/libexec/zimage-production/versions`，从独立核对过的管理员只读源码目录执行同一条 stage 命令，父目录改为上述绝对路径。目标版本已存在时命令退出。密钥强制命令与 sudoers 中的 `<KIT_ID>` 均须替换为完整的同一摘要。每次进入接收器前，入口检查完整目录清单、UID、权限、链接和摘要。发送方从实际合并提交计算相同摘要。接收端比较固定安装目录的摘要后才读取归档；只有接收器文件变化才需要审批新版本。

   先保留原助手、原 systemd 配置和旧应用。单独批准维护窗口后，为现有 `zimage.service` 添加新的独立 drop-in，沿用现有用户、工作目录、资源 EnvironmentFile 和专用 Node。只替换 ExecStart 中的 preload。下例的 `<KIT_ID>` 由管理员写为字面摘要。

   ```ini
   [Service]
   ExecStart=
   ExecStart=/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node --require /usr/local/libexec/zimage-production/versions/<KIT_ID>/backend/http-admission.cjs server.js
   ```

   在业务已排空且现有版本可恢复的窗口重载单元、重启当前旧应用。管理员运行 `/usr/bin/python3 -I -B /usr/local/libexec/zimage-production/versions/<KIT_ID>/kit.py check`。该操作只读，检查实例、gh 验签能力、信任根、Node 目标、已加载的单元、真实 MainPID/UID 私有 socket、进程 cwd 及可执行文件。运行中 preload 在状态响应中返回自身路径，预检再用版本化 profile 独立检查当前 Next 文件。仅重载 systemd、旧进程仍在运行时检查会失败。若旧应用无法用新 preload 通过检查，应在同一窗口恢复原 drop-in 和旧进程，核对服务健康并保持发布开关关闭。检查真实 SSH 限权、同 SHA 签发和公网链路仍需各自的外部证据。

4. 目标机的 `/usr/bin/gh` 至少为 **2.102.0**。管理员从独立可信机器执行 `gh attestation trusted-root`，将结果安装为 root 管理的 `/etc/zimage/production-trusted-root.jsonl`，按官方轮换指引更新。离线验签还检查已验签证书中的仓库数字 ID（`1329578390`）。发布发送方不能提供或更改信任根。
5. 由数据库负责人核实**同一真实生产数据库**支持当前代码、候选代码以及切回旧代码。当前生产库及 Edge 采用 M6 合同；诊断迁移 M8 已按实际时间戳应用，M7 尚未应用，新计量开关关闭。复核候选和旧版在这个真实合同下的请求及回滚行为。核对实际已应用的修订、RPC/权限、Worker 和计量兼容后，由管理员把实际实例 ID 和已批准的迁移树写入 `/etc/zimage/production-target.json`。字段为 `instanceId` 和 `compatibleMigrationTrees`（Git tree SHA 字符串数组）；通过 `git rev-parse <commit>:supabase/migrations` 取值。一次发布要求候选、保留版两棵树同时获准。静态树值是审查索引，不能替代检查生产数据库。此流程不访问数据库或执行 SQL。
6. 先确认真正的公网 DNS、证书、首页及版本接口已经恢复。当前首次基线要求后端 `7a811b326aa4b344cee08bc5a33c04e44a780fd4`、前端 `release-7a811b326aa4`、对应源 SHA 和健康原进程。首次启用仍需由维护者在授权窗口验证真实服务、SSH 权限及真实恢复。演示样例或本机回环 200 都不足以满足这些条件。

构建复用优化开发分支 `68e71973dc2f6295d1d33206728f460c79e4f832` 的前后端与锁文件，使用 `model-only-jsquash` 运行层。两个构建都按固定 HTTPS 地址、响应策略、字节数和 SHA-256 验证全部 62 张公开图。接收端在服务停止后按该版本的 profile 探测模型版 WASM 或旧版原生字体，然后才切换。先在变更窗口核对整套助手、preload、Next profile 和旧版恢复能力。

## 切换与失败

GitHub concurrency 保留正在运行的作业。ECS 使用现有 `/opt/zimage/deploy.lock` 串行化接收、验签、准备、切换和恢复，拒绝旧运行号及未对账的事务。它保留所有正式版本及旧静态资源。发布期间由本助手独占生产切换，暂停旧人工发布工具。[GitHub 并发语义](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

在切换前，本机 TLS 和外部 runner 分别检查现网精确版本、API 契约、首页与实际版本化 JS。排空同一 PID 的 HTTP、后台工作及业务计数后，临时移走已有 Nginx open 标记，并实测静态首页和 API 一致返回维护 503。随后停止该服务、检查原生依赖、分别原子替换两个 current，再以原 systemd 单元启动。Nginx 保持封闭直至新进程的 PID、cwd、私有 socket 与排空门禁都通过检查；此时才还原原标记。单机重启有短暂不可用窗口。候选先处于只读检查模式，本机和外部均通过后才开放业务，并再次检查双方。生产业务登录、付费生成、数据库内容等不在这套只读探测的验证范围。

- `committed` 才会让工作流成功。
- 候选启动或验收失败时，事务选回本次记录的旧前后端，实际启动旧进程，并核对 PID、路径、版本和公网服务。完整恢复后写 `restored`，返回 20，本次发布仍失败。
- 恢复或公网确认失败，记录 `needs_attention` 并尝试封闭业务入口；SSH 中断后也可能留下非终态。先读 `/opt/zimage/production-release.json`（含签名整包 SHA-256）、两个 current、Nginx open/saved-open 标记、Node 门禁、MainPID 和实际本机/公网版本，再决定人工恢复。不得凭客户端断线、指针已切回或本机 200 宣告恢复或重发。进程被杀或主机掉电时需要人工对账。

Linux 回归命令为 `python3 -B -m unittest discover -s ops/aliyun/production -v` 和 `python3 -B ops/aliyun/test_release_three_layer.py -v`。首次切换及恢复要同时对账工作流 run number、合并 SHA、`pairSha256` 和本机/公网实际前后端版本。签名成功或密钥认证成功都不等于已发布。

生产从 `production` 环境变量 `ZIMAGE_PRODUCTION_TURNSTILE_SITE_KEY` 注入 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`；检查缺失、格式及 Cloudflare 测试值，不输出键值。PR 和仅构建使用仓库级公开配置。首发登录须在实际 `committed` 的版本上单独验证。

已确认恢复旧版本时，修复后走新提交的受保护合并流程。若 SSH 中断或恢复结果不明，先读 ECS 发布日志、当前两端版本和真实公网结果，不重放，也不凭旧指针或本机健康宣告已恢复。
