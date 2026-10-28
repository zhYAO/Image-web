# 阿里云单机部署

目标：`www.zimage.store` → `47.100.222.24`，Next.js standalone 由 systemd 运行，Nginx 代理到 `127.0.0.1:3100`。

## 路径

- `/opt/zimage/toolchain/node-v24.19.0-linux-x64`：独立 Node 24.19.0，不替换服务器原 Node。
- `/opt/zimage/toolchain/pnpm`：pnpm 11.19.0。
- `/opt/zimage/build/<release>`：构建源码和依赖。
- `/opt/zimage/releases/<release>`：standalone 发布产物。
- `/opt/zimage/current`：当前发布符号链接。
- `/etc/zimage/environment`：systemd 加载的应用凭据，root:root、0600，目录 0700。不要提交到仓库或输出到日志。
- `/etc/nginx/sites-available/zimage.conf`：网站配置。

## 构建与发布

使用锁定版本执行 `pnpm install --frozen-lockfile` 和 `pnpm build`。构建环境必须设置 `NEXT_PUBLIC_DATA_MODE=http`、`ZIMAGE_DEPLOYMENT_ENV=production`；所有 `NEXT_PUBLIC_*` 必须在构建前确定。小内存实例使用 `ZIMAGE_BUILD_CPUS=1 pnpm --filter @zimage/web exec next build --webpack`，并通过 systemd 构建单元限制内存、CPU 和交换空间，避免同时进行其他构建。V8 的堆上限不能限制 Turbopack 的全部原生内存。

发布构建必须同时设置 `ZIMAGE_BUILD_SLIM=1`，并且只能用 `next build --webpack`：该开关通过 `NormalModuleReplacementPlugin` 和 `outputFileTracingExcludes` 生效，Turbopack 不会应用。它去掉 Next 静态追踪进来的开发入口（esbuild、`next-dev-server`、`setup-dev-bundler`、babel bundle 等约 37 MB），以及 SSR 从不执行的 Markdown 分支（Shiki、ELK、KaTeX、Octicons 等）。别名由 `apps/web/build/markdown-profile.mjs` 生成，该文件对 `@lobehub/ui` / `next` / `shiki` 有版本断言，升级依赖必须先更新 profile，否则构建直接失败。构建完成后执行 `node apps/web/scripts/measure-dist.mjs --assert-slim`，它会按 `package-release.mjs` 的同一输入集统计字节，并在发现开发入口残留时以退出码 1 阻断打包。

将 `apps/web/.next/standalone/` 的内容复制到独立 release 目录，再将 `apps/web/public/` 和 `apps/web/.next/static/` 分别复制到 release 中的 `apps/web/public/` 和 `apps/web/.next/static/`。发布目录由 zimage 用户运行；不要复制构建时的 `.env.production`。检查产物不含服务端凭据后，再切换 current 并启动 `zimage.service`。

`zimage.service` 和 `nginx.conf` 是部署模板；HTTPS 模板须在真实证书签发后才能启用。应用仅监听回环地址，Nginx 覆写可信代理头，关闭响应缓冲以支持流式聊天。

## 验证与回退

检查 `systemctl status zimage`、回环首页与登录页、未登录接口拒绝访问、静态资源、公网域名及证书。不要用首页返回 200 代替 Supabase 登录、上传、生图和 Worker 的真实验收。备案接入、Turnstile 域名和 Supabase 认证重定向需分别核验；未配置 `APPROVED_LEGAL_VERSION` 时保留现有注册关闭行为。

后续版本保留前一 release，回退时切换 current 到前一目录并重启 zimage；修改 Nginx 前先备份，执行 `nginx -t` 后 reload。首次部署没有前一应用版本，回退为停止 zimage 并恢复部署前的 Nginx 配置，不改其他站点、数据库或 Worker。

本次执行结果和未完成项以 `doc/project-progress.md` 为准。

## 本次发布与续期

2026-09-17 发布版本为 `83cb890-20260917`。服务器内构建未成功并已停止，最终使用本机已通过的 Webpack standalone 产物，排除所有 `.env*`、macOS Sharp 二进制，再复制服务器 frozen-lockfile 安装的 `@img/sharp-linux-x64@0.35.3`、`@img/sharp-libvips-linux-x64@1.3.2` 并在 Sharp 的 `node_modules/@img` 中建立相对链接。Linux 编码和 Next 图片优化均已验证。

此版本的构建目录实际为 `apps/web/.next-build-qa`，静态文件也在该目录下；不要直接改名，因为 server.js 嵌入了同一 distDir。发布产物已包含 public 和 static，不依赖本机构建目录或服务器源码 node_modules。当前实例只运行网站，后续构建应放在资源充足的独立 Linux 构建环境完成。

证书到期时间为 `2026-12-16 14:41:11 UTC`，当前 manual DNS 模式**不能自动续期**。`certbot.timer` 的存在不代表可以成功续期。备案完成后配置 webroot 自动验证，并通过 `certbot renew --dry-run` 后才可宣布续期自动化完成。`/etc/letsencrypt/renewal-hooks/deploy/zimage-nginx` 仅负责成功续期后的 Nginx reload。

已确认公网 HTTP 被阿里云备案拦截，HTTPS 握手被中断；服务器回环 TLS 和应用健康检查通过。注册门禁保持关闭；真实登录、验证码、流式聊天、上传和模型生成未在该生产域名验收。

## 2026-09-19 起：GitHub main 自动发布

`.github/workflows/ci.yml` 在 PR 执行质量与本地数据库检查；`main` 更新且两项检查全部成功后，在 Ubuntu 24.04、Node 24.19.0、pnpm 11.19.0 上构建 HTTP standalone，连同 Linux 原生依赖、public、static 打包。生产服务器不构建，不自动迁移数据库或发布 Worker。上文 2026-09-17 为历史记录。

GitHub `production` 环境只允许 `main`：公开构建变量为 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、可选 Sentry DSN/采样率；连接变量 `DEPLOY_HOST`、`DEPLOY_PORT`；Secrets 为独立的 `DEPLOY_SSH_KEY` 和已核验指纹的 `DEPLOY_KNOWN_HOSTS`。模型与数据库私密配置继续由 `/etc/zimage/environment` 提供，所有 `.env*` 排除在产物之外。

### 2026-10-26 发布验证职责分离（待安装新版 helper 后启用）

服务器的公网 DNS/出口不等于应用服务或外部浏览器的访问路径。发布 helper 先验证回环应用及本机 Nginx TLS：HTTPS 的 TCP 连接固定为 `127.0.0.1:443`，Host/SNI 仍为 `www.zimage.store`，证书和主机名正常验证，不改 DNS、代理或安全设置。流送的 `verify-release.py` 默认执行这两处共40项检查；随后同一 GitHub job 在 runner 执行 `--public-only`，独立访问真正公网的20个路由及最多3个登录页静态资源。不能以本机成功替代公网验收，任何一处失败仍使 job 失败并执行精确原版本回退。

`/api/account` 与 `/api/auth/session` 不仅要求401，还要求 JSON `code=unauthorized`；新应用的真实身份依赖故障必须保持503，不能为了发布将其改成401。匿名门禁和CI不能代替已有登录会话的真实浏览器验收，也不调用付费模型。

激活前 `deployment-health.sh record` 会比对服务器 `/usr/local/sbin/zimage-release` 与本提交 `release.py` 的 SHA256；不同则停在切换版本之前。root helper 必须经管理员明确批准安装，保持 `root:root 0755`，保留原文件备份；工作流不安装或修改sudo入口。安装不修改服务代理drop-in，普通切换及版本回退仍重启同一 `zimage.service` 并保留该覆盖配置。

外部验证失败的恢复及手动回退都使用 runner 的 `--public-recovery`：检查精确SHA、登录页/静态资源、账户和身份拒绝，不要求旧版本包含新增页面。自动流程只接受40位保留版本；`previous` 在切换前解析并固定为精确SHA，无版本号历史目录会停止。若恢复检查本身失败，保留所选精确原版本并报告失败，绝不再次激活刚被拒绝的版本。没有外部恢复通过证据时不报告恢复成功。

这些验证脚本变更需要新的提交SHA及其正常CI/生产构建，不能把旧 `10bae820` 的包改标签作为新版本发布。复用未变化的应用代码验证证据，不额外上传日志或测试产物；新增发布包沿用7天保留。

`zimage-deploy` 仅能上传 incoming，并通过 sudo 调用 root 拥有的 `/usr/local/sbin/zimage-release`（源码 `ops/aliyun/release.py`）；不能修改 helper。helper 校验 SHA-256、拒绝路径穿越/外部链接/凭据文件，将版本放入 `/opt/zimage/releases/<commit SHA>`，原子切换 current 后重启。GitHub 部署串行，发布前核对 main SHA，服务端工作流序号拒绝过期任务。Next 缓存独立放在 `/opt/zimage/cache`。

健康检查包含 `/api/health/ready` 的构建版本、登录页、静态资源与未登录 `/api/account` 的 401，分别检查回环和公网 HTTPS。 随后的 `verify-release.py` 在同两处还核验 `/`、`/home`、`/assets`、`/create` 与五个场景，以及登录/邮箱认证/验证/恢复页面均返回 200；全部为不带 Cookie 或 Authorization 的 GET，不提交登录、上传或生成，任何意外重定向均失败。失败自动切回原版本并再次检查。部署工作流在激活前还通过同一受限 SSH 只读记录 `current` 的精确 40 位保留版本 SHA，无法读取或路径不符则停在发布前。若后续完整路由验证失败，`deployment-health.sh` 仅在 current 仍为本次发布 SHA 时调用既有 helper 回退到该精确原版本；同 SHA 重发不回退更老版本。回退使用 helper 原有健康检查，不要求旧版存在新页面；初始发布 job 始终保留失败状态。`/opt/zimage/previous` 仍记录上次正常版本，手动回滚入口保留。单实例发布和回滚均有短暂重启。

手动重发：Actions → ZImage CI and Deploy → Run workflow → 分支 `main`、action=`deploy`。同一 SHA 重发复用已验证的不可变产物。手动回滚：同一入口 action=`rollback`、release=`previous` 或已保留版本目录名。回滚不撤销代码历史或数据库。回滚后恢复最新版可再次运行 deploy。

更新 helper 时必须由管理员安装 root:root 0755 并运行 `python3 -m unittest discover -s ops/aliyun -p 'test_*.py'`；工作流不能自行更新其 sudo 入口。部署及真实回滚的结果见本轮验收记录，不以配置完成代替发布成功。

### CI 构建内存

正式 HTTP Webpack 构建设置 `NODE_OPTIONS=--max-old-space-size=4096`。首次 Linux runner 运行已证明默认约 2GB V8 堆不足；此设置仅作用于构建 job，不改变生产服务运行内存或在服务器执行构建。

## 批量后台续跑发布顺序（2026-10-10 已退役，仅供历史查阅）

以下第 1–4 项记录旧版发布过程；专用批次页面、POST 与 Cron 已退役，当前状态以 `doc/project-progress.md`、现行 CI 及本次 PR 交付记录为准。

1. 先通过 CI 的数据库测试及类型生成检查，再应用 `20261008152649_creative_batch_worker.sql` 兼容迁移。迁移不会开启新 Cron，也不会自动推进历史批次。
2. 第一版网站只发布批次服务、进度接口和内部 Worker；保留旧页面。服务器 `/etc/zimage/environment` 设置独立的 `ZIMAGE_BATCH_CRON_SECRET`，Supabase Vault 存储同值 `zimage_batch_cron_secret` 及完整 HTTPS Worker URL `zimage_batch_worker_url`。不要在 GitHub 构建变量或客户端公开密钥。先用内部请求验证 401/200，再调用 `schedule_creative_batch_worker()`；只有到期工作存在时才会发送 HTTP 请求。
3. 核对 `cron.job_run_details`、`net._http_response`、应用日志和批次检查点，确认租约与固定请求 ID 生效。第二版网站再发布前端减流修改。发布前先核对图片报价；测试账号最多提交两张真实图片，关闭页面后验证后台推进、积分只结算一次。
4. 发布 15 分钟和 24 小时检查批次请求、Storage 签名与 GET、Cron 和错误日志，按来源区分本地开发与网站流量。异常时先调用 `unschedule_creative_batch_worker()`，再使用现有 GitHub 发布回滚网站；保留兼容迁移与数据。历史待核对批次须依据供应商证据人工处理。

登录后只读健康检查：在可信机器上将测试账号当前会话的完整 Cookie 放入 `ZIMAGE_AUTH_COOKIE` 环境变量，然后执行 `python3 ops/aliyun/authenticated_health.py`。它检查账号、会话列表和积分接口，不创建任务或消耗图片额度；脚本不会输出 Cookie。会话过期会返回失败，需用测试账号重新登录。不要将 Cookie 写入命令历史、工单或仓库。

证书续期演练：先检查 `/etc/letsencrypt/renewal/www.zimage.store.conf` 的 authenticator；若仍为 manual DNS，不应把 `certbot.timer` 视为自动续期成功。备案和公网 HTTP 验证可用后切换为 webroot，运行 `certbot renew --dry-run`，再核对 Nginx reload hook 和公网证书到期日期。`dry-run` 成功与配置记录应写入项目进度；演练前证书自动续期状态仍为待完成。
