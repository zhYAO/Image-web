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
