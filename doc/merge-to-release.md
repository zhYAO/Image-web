> 2026-11-26：`main` 合并即发布到上海 ECS，人工「点 Merge」就是唯一闸门。本文是这条链路的最小可复用说明：日常只需「改代码 → 开 PR → 合并」，第 3 节是一次性准备，第 6 节是故障对照。

# 合并即发布：最小流程

## 1. 一句话流程

改代码 → 同仓库分支开 PR → 必过检查 `zimage-release-pr-required` 通过 → 点 Merge → `production.yml` 构建、签名、SSH 投递 → ECS 封闭入口、切换、自检、恢复 → 公网生效。

首发实测 3 分 51 秒（run #10），第二次 3 分 42 秒（run #11），都包含构建与切换。

## 2. 仓库侧

- `.github/workflows/pr-build.yml`：PR 必过检查，作业名固定为 `zimage-release-pr-required`。第一步就拒绝来自 fork 的 PR，只接受同仓库分支；文档类改动走快检，其他改动跑全量（领域、前端、Web、Worker、Python 接收器、本地 Supabase/pgTAP、生成类型比对）。
- `.github/workflows/production.yml`：只在受保护 `main` 的合并提交上运行。`merged-pr` 先确认该 SHA 确实是合并进 `main` 的 PR 合并提交，否则直接失败。触发条件带 `paths-ignore`（`doc/**`、`docs/**`、`**.md`、`LICENSE`）：只改文档的合并**完全不触发**工作流，既不构建也不发布；同一 PR 里只要有一处非文档改动就会正常触发。
- 分支保护：必须走 PR、必须通过上面的检查、分支需为最新（strict）、禁快进与删除；**所需批准数为 0**。
- 发布开关：仓库变量 `ZIMAGE_PRODUCTION_DEPLOY_ENABLED=1`。取其他值时只跑 `build-only`，构建、记录结果，但不签名、不投递。
- 只有第一次 push attempt 会发布（`github.run_attempt == 1`）；重跑只记录不投递，避免重复上线。
- 环境 `production` 的变量与密钥：`ZIMAGE_ECS_ADDRESS`、`ZIMAGE_ECS_HOST_KEY`（`ssh-ed25519 <公钥正文>`）、`ZIMAGE_PRODUCTION_RELEASE_KEY`（私钥 secret）。构建变量：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`（PR 用）与 `ZIMAGE_PRODUCTION_TURNSTILE_SITE_KEY`（发布用）。

## 3. 主机侧一次性准备

只在换机器、换发布密钥或改接收器时重做。

1. 系统 Node 与 `gh`：接收器用 `gh attestation verify` 验签，`gh` 必须装在 `/usr/bin/gh`。本机走官方 deb 安装并按官方 SHA-256 校验，因为 ECS 的出站 DNS 被代理劫持（见第 5 节）。
2. 接收器 kit：`python3 -I -B ops/aliyun/production/kit.py digest` 得到 `KIT_ID`，`kit.py stage "$KIT_ID" /usr/local/libexec/zimage-production/versions` 安装。当前为 `1b7853ddf2d1a4c153a58c0c801777affe69487627c69ddc149f2aaf2d77d3af`。
3. 目标策略 `/etc/zimage/production-target.json`：`{"instanceId":"i-uf6d3nsuz3l4f5goyo48","compatibleMigrationTrees":["04386967f003c2d6638558cd89fcdd722134e594","e5f52c2647048469bb929124b67eac0f33a6126e"]}`。迁移树变了就要同步改这里，否则发布会被拒。
4. 发布账户 `zimage-release`：密钥文件 `/etc/ssh/zimage-release.authorized_keys`（`restrict` 前缀、无逐键 command），sshd `Match User zimage-release` 里 `AuthorizedKeysFile`、`PermitTTY no`、`DisableForwarding yes`、`PermitUserRC no`，`ForceCommand /usr/bin/sudo -n -- /usr/bin/python3 -I -B .../versions/<KIT_ID>/kit.py`。
5. sudoers `/etc/sudoers.d/zimage-release`：
   ```text
   Defaults:zimage-release !use_pty
   zimage-release ALL=(root) NOPASSWD: NOSETENV: /usr/bin/python3 -I -B /usr/local/libexec/zimage-production/versions/<KIT_ID>/kit.py
   ```
   `!use_pty` 是必须的：默认 `use_pty` 会把二进制 stdin 送进伪终端，接收器读不到原始归档。
6. 账户 shell 必须是 `/bin/sh`，不能是 `nologin`：sshd 通过账户 shell 执行 `ForceCommand`，`nologin` 会立即退出，发送端只看到 broken pipe。
7. preload：`zimage.service` 的 drop-in 里 `ExecStart` 只替换 `--require` 指向 `.../versions/<KIT_ID>/backend/http-admission.cjs`，其余用户、工作目录、资源限制保持不变。切换后在维护窗口重启一次原版本，并跑 `kit.py check` 确认 kit、验签器、目标策略、在役单元与 preload 全部一致。

## 4. 判据与观测点

一次发布算成功，要三条同时成立：

1. Actions 里 `Attestation created for pair.tar@sha256:<DIGEST>` 的摘要，等于 ECS `/opt/zimage/production-release.json` 的 `pairSha256`；
2. 该文件的 `phase` 为 `committed`，`new[0]` 是本次合并 SHA，`old` 是上一个在役版本；
3. 公网 `https://www.zimage.store/version.json`、`/api/health/ready`、`/api/meta` 三处报同一个 SHA。

失败时 `phase` 会是 `restored`（已回退到旧 pair 并复验）或 `unconfirmed`（发送端没拿到结论）。看到 `unconfirmed` 先查 ECS 日志和上面的文件，不要直接重跑——重跑本身也不会投递。

## 5. 出站 DNS 的现实约束

这台机器的 `mihomo` 开了 fake-IP，整机所有域名都解析到 `198.18.0.0/15`，直连会超时；应用本身通过 `127.0.0.1:7890` 代理出网，不受影响。因此两处需要固定真实地址：

- `/etc/hosts` 里手工一行 `47.100.222.24 www.zimage.store`，否则接收器的公网探针打不开自己的域名；
- `# BEGIN zimage-acme` 标记块由 `/usr/local/sbin/zimage-acme-hosts.py` 维护，固定 ACME 与阿里云 DNS 的真实 IP。

代理本身对 GitHub 与部分站点不稳定，所以不要把发布链路建立在代理上。

## 6. 证书

- 签发者 Let's Encrypt，90 天。当前证书 2026-11-26 → 2027-02-24，`/etc/letsencrypt/live/www.zimage.store/`。
- 续期：`certbot.timer`（每天两次）→ `certbot.service` 的 `ExecStartPre` 先跑 `zimage-acme-hosts.py` 刷新真实 IP → `certbot -q renew --non-interactive` → `manual_auth_hook` 用阿里云云解析 API 写 `_acme-challenge` TXT → 成功后 `renew_hook` 执行 `systemctl reload nginx`。
- 钩子：`/usr/local/sbin/zimage-acme-dns.py`（新增/删除 TXT）、`/usr/local/sbin/zimage-acme-hosts.py`（刷新 hosts 块）。凭据在 `/etc/zimage/acme.env`（root 0700），对应 RAM 用户 `zimage-acme`，策略只允许 `zimage.store` 这一个域的解析记录增删改查。
- 手动验证：`certbot renew --dry-run --non-interactive --no-random-sleep-on-renew --cert-name www.zimage.store`。正常续期会随机延迟最多约 8 分钟，属于正常行为。
- 公共 CA 没有永久证书：LE 90 天（自动续期等于零维护），商业证书上限 398 天，Cloudflare Origin CA 15 年但只对回源有效。

## 7. 要改的时候改哪里

| 想改什么 | 改哪里 | 注意 |
| --- | --- | --- |
| PR 检查项 | `ops/aliyun/pr-checks.sh`、`.github/workflows/pr-build.yml` | 作业名不能改，分支保护按名字认 |
| 发布流程/校验顺序 | `.github/workflows/production.yml`、`ops/aliyun/production/send.py` | 改完先在 PR 上跑通 |
| 接收器行为 | `ops/aliyun/production/*`（kit 文件） | **KIT_ID 会变**，必须先在主机 stage 新版本并同步 sudoers/sshd 的 `ForceCommand`，否则合并后发布会被接收端拒绝 |
| 换机器 | 按第 3 节重做，再更新 `ZIMAGE_ECS_ADDRESS` / `ZIMAGE_ECS_HOST_KEY` | 旧机的 `versions/` 与 journal 不迁移 |
| 暂停自动发布 | 把 `ZIMAGE_PRODUCTION_DEPLOY_ENABLED` 改成 0 | 只构建不投递，随时可改回 |
| 回滚一次发布 | 合并一个 revert PR | 走同一条链路重新发布；失败自动回退只覆盖「切换失败」，不覆盖「上线后发现问题」 |

## 8. 故障对照

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `[Errno 32] Broken pipe`，`phase=unconfirmed` | 账户 shell 是 `nologin`，sshd 无法执行强制命令 | 改 `/bin/sh`，核对 `ForceCommand` 与 `sshd -T -C` |
| 接收器读不到归档或校验和不对 | sudoers 默认 `use_pty` 把二进制 stdin 送进伪终端 | 加 `Defaults:zimage-release !use_pty` |
| `gh attestation verify` 失败 | 验签器缺失、信任根过期或摘要不符 | 查 `/usr/bin/gh`、`/etc/zimage/production-trusted-root.jsonl` |
| 发布被拒：迁移树不匹配 | `production-target.json` 未包含新树 | 核对并更新 `compatibleMigrationTrees` |
| 公网探针超时 | 出站 DNS 被 fake-IP 劫持 | 检查 `/etc/hosts` 的域名行 |
| 证书续期失败 | hosts 块过期或 RAM 权限不足 | 跑 `zimage-acme-hosts.py`，再看 `/var/log/letsencrypt/letsencrypt.log` |
| PR 检查红在数据库 | 本地 pgTAP 与最新迁移不一致 | 按迁移改测试；生成类型用 CI 产物覆盖后提交 |
