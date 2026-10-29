# 生产构建输入与既有云通道判定（2026-10-29）

本文记录正式 Linux 构建的前提，不是构建或发布成功证据。当前代码修复提交为 `ef8cbd57fae0563abe53c6d807f714ada8bdb38c`，该提交的运维脚本已在实际 Ubuntu/Python3.10 环境通过201项测试。后续正式构建应冻结所选择源码的完整40位提交，不能复用旧包后改版本标记。当前没有已验证可用的远程生产构建通道；依赖该通道的构建、打包和激活继续暂停。

## 已实测目标与严格匹配

| 项目 | 已实测生产条件 | 构建约束 |
| --- | --- | --- |
| OS / 架构 | Ubuntu22.04，Linux x86_64 | Node报告必须为 `platform=linux`、`arch=x64`；发行版名称不能代替测量 |
| Node | `24.19.0` | 完整版本精确一致；仓库engines下限不能代替发布指纹 |
| Node modules ABI | `137` | 精确一致 |
| Node-API | 历史目标预检记录为 `10` | 构建前与目标重新读取；当前schema指纹不单列此字段，不能擅自加入target JSON |
| glibc | `2.35` | 清单写 `glibc-2.35`；2.39/2.41等不能直接打包给该目标 |
| 包管理器 | `pnpm@11.19.0` | 使用冻结锁文件，不换版本、不重写lock |
| Python | 目标 `3.10.12`，修复后201项通过 | 构建/打包工具需要已有Python3.10或兼容更新版本；最终目标仍须实测 |
| 归档与文件系统 | Linux GNU tar、POSIX权限/链接 | 须支持当前脚本的 `--hard-dereference`、实际原子发布/硬链接/锁；BSD tar不能替代 |
| 依赖 | 锁定Next16.4.1、Sharp0.35.5等 | 必须在匹配Linux环境按锁安装/复用经过核实的缓存，不能复制Mac/Windows node_modules |

可安全交付给构建任务的目标JSON如下，来自实际目标测量，仍应在构建前重新核对：

```json
{"schema":1,"runtime":{"node":"24.19.0","abi":"137","platform":"linux","arch":"x64","libc":"glibc-2.35"},"toolchain":{"packageManager":"pnpm@11.19.0"},"assemblyCacheRoot":"/opt/zimage/layer-cache"}
```

使用现有工具先执行 `node ops/aliyun/package-release.mjs --check-target --target <仓库外目标JSON路径>`；失败就停止，不能覆盖平台参数或修改清单。另记录 `process.versions.napi`、GNU tar/Python版本、实际libstdc++及所需GLIBC/GLIBCXX/CXXABI符号。ELF头和符号只是必要条件，不能代替Sharp、原字体及JPEG/WebP/AVIF的真实加载。

构建主机不需要安装systemd、root发布helper或访问生产SSH。root所有权、服务UID、有效EnvironmentFiles、原生探针、严格本机TLS、公网验证及精确回退仍属于目标机后续验收。

## 固定构建配置与资源

使用精确源码、`pnpm install --frozen-lockfile` 和 `pnpm --filter @zimage/web exec next build --webpack`。依赖准备与构建分开记录，不让HTTP/auth构建变量进入普通单元测试进程。

| 构建进程变量 | 值或来源 |
| --- | --- |
| `NODE_ENV` | `production`；依赖准备仍需安装构建所需devDependencies，不先以production-only模式裁剪 |
| `NODE_OPTIONS` | 现行正式profile为 `--max-old-space-size=4096`，不是进程/整机峰值承诺 |
| `NEXT_PUBLIC_DATA_MODE` / `NEXT_PUBLIC_PHASE2_AUTH` | `http` / `true` |
| `ZIMAGE_DEPLOYMENT_ENV` | `production` |
| `ZIMAGE_BUILD_SHA` | 所选择源码的真实完整40位commit，与BUILD_ID及编译配置标记一致 |
| `ZIMAGE_BUILD_SLIM` | `1` |
| `NEXT_PUBLIC_STATIC_ASSET_BASE_URL` | 空字符串，同源公共资源；不用历史原型的绝对资源URL |
| `NEXT_DIST_DIR` | 清除QA覆盖，使用规范 `.next` |
| `VERCEL_ENV` | 未设置或 `production` |
| `ZIMAGE_BUILD_CPUS` | 若选单CPU内存优化则设 `1`；不能据此假定低内存构建必成 |

独立资源输入只有两份原始OTF及原始LICENSE.txt/README.md，并带完整当前public资源；按 [FONTS.md](FONTS.md) 和代码内固定SHA校验。可使用已保留的可信原件/Git历史对象，不需要模型、数据库或生产秘密。正式 `package-static-assets.mjs --font-source ... --output ...` 不使用 `--fonts-only`；完整清单实际字节SHA产生资源版本。`ZIMAGE_SHARED_FONT_DIR=<构建机资源版本目录>/fonts` 和 `ZIMAGE_STATIC_ASSET_SHA256=<实际清单SHA>` 供构建后本地原生检查，不是生产凭据，也不能把构建机路径原样注入目标服务。

资源预算必须读取云任务的实际cgroup内存上限/当前占用、可用RAM、swap、磁盘与并发负载，不能只看宿主机 `free`。4096MiB V8上限之外还须容纳native/worker和系统开销；当前代码没有已验证的最低RAM/磁盘门槛，不编造保证值。项目历史曾在约2GiB默认V8堆上限下失败。生产机仅1608MiB总内存、约327MiB可用，明确不承担全量构建；不改全局swappiness、不新增swap、不安装本地Docker/Ubuntu。

## 可以进入临时云任务的公开配置

仅需要以下五个经过来源确认的字符串键。可作为直接环境变量，或置于仓库外0600的UTF-8 JSON中，再由Python/Node以结构化子进程environment注入；不拼接shell、不回显值、不提交配置文件、不把文件或全部环境加入产物。

| 键 | 可接受内容 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 真实生产项目HTTPS URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 真实公开publishable key或角色确为anon的旧公开JWT；拒绝 `sb_secret_` 和service_role等服务秘密 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 来源确认的公开sitekey；不是secret key |
| `NEXT_PUBLIC_SENTRY_DSN` | 真实公开客户端DSN，或已确认的空值 |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | 已确认的实际采样率/允许空值，不能自行猜测 |

历史记录的受控五键文件为387字节、SHA256 `6179525465d0edd265a532944ac6bb61693d5492515dd8a912090cdb853e5eff`；这只证明当时交付，不证明当前保存的云环境仍有该文件或变量。历史Library物化失败不能当作成功，也不重试旧失效路线。若复用文件，先确认它仍是管理员认可的生产公开配置，再核实当前字节、键白名单与值类型，只记录存在性/配置摘要。历史Turnstile值是官方always-pass测试sitekey：它虽公开且可编译，却不能作为真实防机器人验收；激活前仍须明确处置此既有风险，不静默换key或关闭验证。

`NEXT_PUBLIC_*`会在编译期固化：不能把QA URL、占位配置或云平台代理的secret替代占位符编译进去，再期待目标机运行时改正。公开值无需使用网络secret替代机制；必须让构建进程取得真实公开字节。

## 留在目标机或原秘密存储的输入

- Supabase服务秘密（`SUPABASE_SECRET_KEY`/service_role）、数据库URL/密码、供应商密钥（Ark/Gemini/MiniMax等）、`AUTH_RATE_LIMIT_PEPPER`、Worker/Cron秘密及Turnstile secret均不需要进入纯构建任务。Edge Function自身的秘密继续留在既有Edge秘密存储。
- 生产SSH私钥/密码、宝塔凭据、云账号/OIDC新增权限和部署身份不交给云构建；产物可经核实过的既有文件交付能力返回，再由已有Mac SSH通道部署。文件交付能力本身也需核实，不能编造下载URL或忽略历史下载失败。
- 模型映射、积分/提交开关、批准法务版本、可信代理和允许来源等运行配置继续由目标机既有 `/etc/zimage/environment` 及原受控配置注入；不为了构建更改它们。服务端Sentry运行配置也留在原处；纯构建无需Sentry上传token或上传source maps。
- 每个release的字体目录/资源SHA由目标安装器绑定为 `/opt/zimage/current/.runtime-assets.env`，加载顺序须最后；保留现有凭据与出口环境文件。云构建不读取或复制 `/etc/zimage/environment`。

代码依据：公开校验在 `apps/web/lib/supabase/env.ts`，服务端凭据由 `createSupabaseAdminClient()` 运行时读取，聊天provider在解析请求时读取API key；现行workflow的正式构建段也只注入公开配置和构建开关。按现行契约应只需公开配置，但此次最终提交的正式构建尚未执行成功。若实际编译意外要求私密值，应定位构建期执行边界并暂停，不能添加真实或假秘密来过门禁；即使纯公开配置编译成功，也不证明真实认证、SSE、模型或数据库健康。

## 既有远程通道：证据与未知项

| 候选 | 已有证据 | 当前判定 |
| --- | --- | --- |
| 历史Codex云任务/匹配容器 | 进度记录曾验证Ubuntu22.04固定镜像中Node24.19.0/ABI137/Node-API10/glibc2.35及现有pnpm、SWC、Sharp/字体；基础云主机曾为glibc2.41 | 历史证据，不证明任务/daemon/镜像/工具/公开配置现在仍可复用 |
| 父会话可见已保存的Image-web Codex云环境 | 父会话报告环境存在；本Mac `list_projects` 只返回本地项目，当前工具没有读取该云环境规格/配置/费用的接口 | **候选未验真**；不能据名称、默认镜像或已保存状态宣布可用/免费/兼容 |
| GitHub Actions | 仓库有正式workflow | 用户禁止启动；默认runner标签也不保证glibc2.35，不选此路线 |
| 生产ECS/Mac | SSH现有通道可用，但ECS余量不足；Mac无可用Linux运行环境 | 生产机不构建；不新装本地环境 |

当前官方[Cloud environments文档](https://learn.chatgpt.com/docs/environments/cloud-environments)只证明已发布环境可提供隔离任务、保存准备状态和直接变量配置；不证明此账号环境的OS、资源、实际变量、网络权限或费用。新旧云环境机制有差异，不把旧文档的secret行为套用到未辨认的保存环境。

最小下一步：由能访问该已保存环境的父会话/操作者，选择它做**仅只读预检**，不先安装工具、拉镜像、修改网络/权限或启动构建。核对实际源码commit、Node/ABI/Node-API/glibc、已有pnpm/Python/GNU tar、cgroup/RAM/磁盘、原字体来源、五个公开键的存在性及可信产物取回方式；不要运行 `env`/`printenv` 全量输出。若宿主glibc不同，仅在已有可信匹配容器和执行能力均能实测时才继续评估，不自动下载或扩大权限。

若这些条件均满足，可以用上述**公开输入**在云端隔离构建，目标机秘密继续只在运行时注入。若现有环境不满足且没有已保留的匹配执行方式，最小用户决策是：指定另一台已授权且匹配的现有Linux构建机，或另行批准具体的临时构建资源/安装及其费用上限；批准前停止依赖步骤。不会因此改用生产机327MiB余量、GitHub Actions或不兼容产物。
