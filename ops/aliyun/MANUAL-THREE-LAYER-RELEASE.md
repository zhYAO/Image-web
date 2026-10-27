# 手动三层发布交接（未激活，禁止使用现有QA包）

生产目标为阿里云 `https://www.zimage.store`。用户已取消10MB硬门槛，允许完成检查后手动发布，禁止触发GitHub CI。临时OSS中转、Windows固定HTTP验收及一次性自动回退已批准；实际外部操作由主会话/服务器管理员协调。本文不执行上传、改Nginx、改凭据、切换或重启。

## 构建前公开配置接口

交付一个当前云环境可读、仓库外的临时UTF-8 JSON文件，顶层仅包含下列5个字符串键。不使用shell拼接、不回显值、不提交文件、不把JSON加入产物。Supabase密钥只允许公开publishable/anon，禁止service_role或其他服务秘密。

```json
{
  "NEXT_PUBLIC_SUPABASE_URL": "<actual-public-url>",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "<public-publishable-or-anon>",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY": "<actual-site-key>",
  "NEXT_PUBLIC_SENTRY_DSN": "<actual-public-dsn-or-approved-empty>",
  "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE": "<actual-rate-or-approved-empty>"
}
```

以上名称来自现有 `production` Environment variables或仓库Variables；公开值需逐项确认来源，不猜测、不使用QA配置。值只通过Python/Node子进程的结构化environment注入，不写入可执行shell文本。构建日志需受控，不主动记录完整值；可以记录键名、存在性和配置文件SHA。服务私密环境仍由既有 `/etc/zimage/environment` 提供，本任务不读取或复制。

固定构建配置：`NEXT_PUBLIC_DATA_MODE=http`、`NEXT_PUBLIC_PHASE2_AUTH=true`、`ZIMAGE_DEPLOYMENT_ENV=production`、`NODE_ENV=production`、`ZIMAGE_BUILD_SLIM=1`、`ZIMAGE_BUILD_SHA=<最终完整40位commit>`。清除QA的 `NEXT_DIST_DIR`，使用规范 `.next`；`VERCEL_ENV`须未设或production。使用现有Node24.19.0/pnpm11.19.0和冻结锁文件，不安装新版本。Webpack是本profile必需；不以Turbopack生成不同结果。

资源基址必须在编译前确定，当前字节未改变时为：

```text
NEXT_PUBLIC_STATIC_ASSET_BASE_URL=https://www.zimage.store/static-assets/e68a455dc6f5772f02711b87583162c146e441b099efdb1f0951b7f10a4323ef
```

资源manifest实际字节SHA即版本。若来源/清单改变，先重新打资源包，再以新SHA构建。`NEXT_PUBLIC_*`已被内联，不能运行时改写QA URL或build marker来代替生产构建。

## 平台和路径前提

在不读取秘密的条件下提供ECS运行Node完整版本/ABI、OS、arch、glibc版本和libstdc++导出符号版本，以及服务/Nginx UID与现有目录权限。当前云样本为Node24.19.0/ABI137/linux/x64/glibc2.41；装配器严格要求运行指纹一致。**符号兼容不等于已获准跳过严格指纹检查**；不同libc须选择匹配构建环境或另行经过审查的兼容机制，不能篡改manifest/二进制或关闭门禁。

已对实际保留的native二进制读取ELF版本需求：

| 文件 | GLIBC最高需求 | GLIBCXX最高需求 | CXXABI最高需求 |
| --- | --- | --- | --- |
| Sharp `.node` | 2.17 | 3.4.21 | 1.3.9 |
| libvips `.so.8.18.7` | 2.28 | 3.4.22 | 1.3.11 |

这只是静态必要条件；最终ECS仍必须实际加载Sharp并完成两款中文字体与JPEG/WebP/AVIF检查。包内JSON回报vips8.18.6不代表已加载.so版本；本次实际库为8.18.7。

需主会话确认服务器**最终共享cache绝对路径**（建议与现有 `/opt/zimage/cache` 图片缓存分开，如 `/opt/zimage/layer-cache`）。打包的 `--assembly-cache-root`绑定这个确切路径，不能把QA的 `/tmp`绑定直接搬上服务器。资产目录为 `CACHE/assets/<SHA>`，运行依赖为 `CACHE/runtime/<identity>`。运行依赖不得HTTP暴露。

## 最终生产构建和打包

1. 冻结最终commit，确认工作区业务源/锁文件无未记录修改，保存确切SHA、公开配置摘要和构建平台。检查旧构建不被活跃进程占用，保留所有旧QA及正式产物；必要时先移出已验证QA输出，不直接删除。
2. 用正确公开配置执行一次有目的的 `next build --webpack`，规范 `.next`。检查退出码、BUILD_ID和编译配置中的完整commit、HTTP/auth模式、精确资源URL；不泄漏私密runtime配置。
3. 从该产物staging完整standalone、client static和精确public清单；现有 `package-release.mjs`支持规范.next并把maps/NFT归档独立保留。保留本生产版本调试资料，不因尚未上传Sentry而声称线上符号化通过。原始5张PNG仅从发布清单排除，源码及来源manifest保留。
4. 使用 `three-layer-release.py pack`，传入真实production staging、不可变资源目录、项目、最终commit、新release ID及ECS精确cache根。省略 `--code-raw-budget`即无硬门槛。保存trusted release-manifest SHA、每层archive/index SHA和精确raw/transfer报告。禁止覆盖已有ID或修改旧QA包。
5. 本工具始终报告 `productionReady:false`，表示**未进行生产激活/验收的装配器产物**；assemble要求显式 `--allow-sample`。即使源是正确生产构建，也不能靠把该字段改true取得放行。主会话必须明确审核这一工具边界、实际路径权限与生产装配后独立验收；当前QA包任何时候均不允许上传部署。

打包/装配命令参数见 [THREE-LAYERS.md](THREE-LAYERS.md)。不能把code+runtime层归档直接交给旧 `release.py` 当完整自包含包：旧helper不认识共享层协议，且受控public外链需要新装配过程。若服务器仅允许原helper，先阻断切换并明确集成步骤；不得绕过其归档安全检查。

## 传输、装配与验收顺序

1. 已批准的临时OSS仅中转**最终生产**层包/索引/manifest及必要已审工具；使用批准连接，不创建凭据、不改变桶安全策略或付费服务。不要上传QA TLS私钥、QA配置、`.env`、用户数据、日志或缓存。OSS URL是受控临时传输，不是公开永久资源源站。
2. Windows固定验收脚本/Edge在正常支持的下载路径取得文件，通过 `Get-FileHash -Algorithm SHA256`核对可信清单，ECS落盘后再次校验；不能把内部 `/tmp`路径当下载链接。源commit和可信manifest SHA经独立文本交接。
3. 在ECS不激活的新目录运行assembler，严格核对平台、全部SHA、资源绑定、缺层/路径/链接和权限；输出必须 `activated:false`。保留旧应用current、previous、实际环境与资源。runtime与assets禁止可变全局安装，复用时逐文件校验。
4. 资产先装配校验，再按现有Nginx站点添加最小versioned公开alias（[模板](static-assets.nginx.example.conf)的根需指向实际 `CACHE/assets`，不是未创建的 `/srv`示例）。备份、`nginx -t`和确切服务UID读取测试均通过才reload。只暴露公开asset对象；CORS/MIME/nosniff/cache/CSP按精确域名验证，404不能缓存一年。旧资源不清理。
5. 运行期将assembler给出的 `ZIMAGE_SHARED_FONT_DIR=CACHE/assets/<SHA>/fonts` 和 `ZIMAGE_STATIC_ASSET_SHA256=<SHA>`绑定到该release；两字体与LICENSE须通过resolver，不使用系统fallback或临时HTTP下载。确认应用可经正常DNS/TLS访问自己的HTTPS资源URL，不使用测试transport、不关闭TLS、不开放localIP。
6. 独立新服务/回环验收真实BUILD_SHA、ready、全部公开路由/客户端URL、旧 `/commerce`、新versioned URL、Next Image远程优化器、字体中文/native编码，以及未登录account/session必须真实401 `unauthorized`（503必须失败）。原helper验收与Windows公网验收范围保持一致，不能只看首页200。无付费生图授权时不自动消费；登录/生成等未执行边界如实报告。
7. 只在上述通过后按主会话确认的既有原子切换/服务管理方式激活。Windows公网HTTP/证书/静态/版本以及资源检查失败，使用已批准的一次自动回退恢复切换前精确旧版本和旧环境；回退后再验公网恢复，不重新激活被拒版本。激活/回退均由主会话协调，不由本云分支执行。

回滚资源与运行依赖必须跟旧清单保留；不更新latest、不覆盖hash目录、不提前GC。原线上完整release可独立回退，不强迫它使用新共享层。首次部署共享层总量必须完整报告，日常复用层省传输不等于资源消失。

当前QA的实测、独立审核和未验证项见 [最终本地验证](../../doc/qa/2026-10-27-three-layer-validation.md)。
