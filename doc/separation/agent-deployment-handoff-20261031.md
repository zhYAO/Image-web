# ZImage 上线 Agent 操作记录与后续接手说明

> 最终状态：**2026-10-31 21:38:30（Asia/Shanghai）已上线并开放 https://www.zimage.store**。以下当前状态优先于后半部分明确标记的历史检查点。用户已暂停进一步功能/模型复测，接手时不要自动重放付费请求。

后续源码已清理无引用定义并合并本地 main，未推送或重新部署；见 [合并记录](main-merge-cleanup-20261031.md)。下列是实际线上身份，不随本地分支移动而改变。

## 当前版本与证据

| 项目 | 实际值 |
| --- | --- |
| 应用源码 / 后端版本 | `fb4fb09f909c0ae5dce98ebd0d9540386685ddb7` |
| 前端 namespace | `release-fb4fb09f909c` |
| 前端 artifact ID | `463f3941ed68204bbbfc828407aaec8bb82dd8cc620d6a9efb0e6c09f16abf06` |
| 资源 SHA | `bfb3e444b4b032f43ba6d977c33ba72922eea253f34c7d7fe222cb820c4dd23b` |
| 旧后端 / 回退目标 | `9c5c3ea95e0c66193b23a2db50643530aa7d095a`，配套原 Next 页面入口 |
| 更早版本 | `8cbb708645e93d3d71d17641b860cc60301fa005`，保留 |
| 切换后 MainPID | `456496`（历史采样；接手重新查询） |
| 发布 operation | `manual-fb4fb09-20261031`，sequence 90，`phase=opened` |
| 当前写入状态 | 已开放；`writesMayHaveOpened=true` |
| 实际部署包 | 前端 9.42 MiB，后端 transport 51.04 MiB，合计 60.45 MiB |

应用归档未因后续文档/运维修复改变；不要拿后续仓库 HEAD 冒充应用构建版本。本轮只本地提交，未推送、未触发 Actions。详情见 [上线结果与包体](release-candidate-20261031.md)。

服务器权威材料：

- `/opt/zimage/backups/manual-fb4fb09-20261031/operation.json`：操作阶段、实际失败与恢复、风险接受；`postopen-check.json`：开放后只读结果。
- 同目录 `preopen-drained.json`、`opened-status.json`、`backend-observed.json`、`frontend-result.json`、`legacy-original-resource-check.json`、`frontend-helper-postfix.json`。本地非秘密副本在 [.design-qa 证据目录](../../.design-qa/2026-10-31-release-handoff/fb4fb09/server/)。
- `/opt/zimage/backups/split-preflight-20261031-130532/config.tar` 及其 manifest；这是配置备份，**不是数据库备份**。归档 SHA256 `fb8b7ef98e671dfc3544c25c7628295159ca2b196f8ff10ff2ba53151ea68a54`。不要下载、展示或提交其中环境秘密。
- 本次目录保留 `original-nginx.conf`、`frontend-release-before-loopback.py`；新旧 release、资源层、上传包均保留。
- `/usr/local/libexec/zimage-manual-fb4fb09.py`：本次唯一协调器，SHA256 `0cb44f256b17b373be491d6773e128ddcfa5a127571e43b222990585bcdf6baf`。原始 25 文件工具闭包在 `/usr/local/libexec/zimage-manual-fb4fb09-source/`，它是历史安装基准，不覆盖下述后续 helper 修复。

## 已实际执行的维护切换

1. 已完成 Node24.19 / pnpm11.19、Ubuntu22.04 linux/amd64 的干净源码构建、封包和六件上传摘要验证；原生 Sharp、两字体、六项编解码与匿名 API 检查通过。源应用 commit 固定为上述 fb4fb09，未上传 Mac 原生运行依赖。
2. 用户明确回复“接受上述中断风险，继续维护切换”。旧版本缺少完整收尾记录，协调器如实记录 `legacyCompletionProven=false` 和 `acceptedPotentialRequestInterruption=true`。这是本次人工风险接受，不是历史任务全部完成，也不是以后绕过 first-window 的通用许可。原有 first-window 守卫不变。
3. 保存配置、旧指针及资源；安装受信任工具闭包、精确平台目标配置、前端批准和同域 Nginx 维护入口。`/etc/zimage` 从700改755前逐件确认原两秘密文件均为root0600，并保持权限。
4. 封闭入口并确认实际维护响应后停止旧 systemd 服务；旧 MainPID 已归零，但没有宣称旧请求全部优雅完成。安装新生命周期 drop-in、精确资源绑定，激活并核对 fb4fb09 后端。
5. 保持 checking 模式，真实检查新进程身份及生命周期计数；安装 immutable 前端 namespace，通过版本、摘要、MIME/资源和兼容检查后切换前端。未虚构旧静态前端 F0。
6. Terra 在 Chrome 对公网版本、页面做只读检查；开放前新后端七项计数归零。先记录可能开放写入，再开放后端和入口，21:38:30记录opened。
7. 服务器页面/API/资源检查通过；Chrome 开放后首页三图、五项电商目录、现有账户及51条会话可见。没有新增业务提交。未升级 Worker、改模型/价格、迁移数据库、退款或重放旧未知任务。

初次准备因旧资源 LICENSE/README 原始 LF 字节与新校验器预期不同而停止；协调器固定旧两份元数据摘要并重新验证全部旧资源与原生渲染，不改旧资源。Nginx reload 老 worker 时序导致初次封口探测见200，已确认503且增加新 worker 生效检查后才继续。服务器公网回环超时发生在前端映射前，使用本机真实 TLS 入口探测并追加公网 Chrome 证据后续接。初次失败过程分别记录于本文；最终 operation 保留最近一次失败项，不写成一次成功。

## 发布探测工具的独立修复

安装 `/opt/zimage/frontend-tools/release.py` SHA256 `6d1300b2aa330055955b1a1951f1c1165f0879688cb6dbbd5eb5a9eeaf1fa854`；与本仓库 `ops/aliyun/frontend/release.py` 一致。未重启应用、未改部署包。依赖 `manifest.py` 为 `e20ef928a105c845ce63a2a5ba7b4f99d09d94535ffdf55c36bfa37cd7d57231`，`transport.py` 为 `20bc0a02bc1f8f1977a9409ae1cc471abf2adb48b624377e03edba916ffe2274`，均未修改。

服务器内 HTTPS 连接固定到127.0.0.1:443，仍用 `www.zimage.store` 的 SNI、默认可信证书和主机名校验，拒绝其他域、端口、URL凭证及重定向，禁用环境代理。该结果证明本机 Nginx 入口；独立公网 DNS/路由验证仍需要 Chrome。3项 TLS 安全测试首次通过，真实 HTTP fixture 首次沙箱 EPERM；获准同码重跑4/4通过。生产正式 `status` 已返回 `httpVerified=true`。

接手先只读核对，命令不会建立计费请求：

```sh
ssh -T -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 \
  -i /Users/zzz/.ssh/image-web-aliyun-ed25519 root@47.100.222.24 \
  '/usr/bin/python3 -I -B /opt/zimage/frontend-tools/release.py status'
```

随后读 operation、current/previous、systemd PID、实际准入及生命周期状态；不根据文档里的旧 PID 直接发信号。现有 SSH 已获授权，连接失败可重连；不要关闭 known-host 检查。浏览器仍须 GPT-6.1 Terra + Chrome。

## 开放后的回退步骤与停止条件

**现在不能运行一次性协调器的 `recover`，也不能仅把后端 current 改回 previous。** `writesMayHaveOpened=true` 后该 recover 有意拒绝；F1 只验收过 fb4fb09，旧后端缺少新兼容接口。现阶段是配对回退，且先核对新产生的写入和未结算结果。

1. 记录当前准确版本/PID/准入与最新操作日志，保留故障日志、数据库记录、两套归档及资源；若发现身份与此文不符，停止按此旧版本操作。
2. 以新的 operation 和当前 Nginx 摘要关闭新任务及入口准入；等待真实维护响应。使用已安装的生命周期工具核对精确 B1 进程，等待 HTTP/framework/business 七项计数归零。不得将空队列或等待若干秒视为完成。
3. 核对开放以来实际请求、任务及未结算状态；结果未知时停止新提交，不自动重试、退款或以旧数据库快照覆盖。若仍有不能解释的活动/账务状态，保留封口并提出具体异常；本次接受旧版中断风险不自动授权以后中断新请求。
4. 准备并审阅一个绑定新 operation 的配对恢复计划：旧后端9c5c3ea、其原资源绑定、受控 legacy Nginx 模板与 backend-legacy 生命周期配置。先真实校验原旧资源与原生库，不能修改旧 LICENSE 使其“通过”新摘要。
5. 在封口下停已排空 B1，恢复旧后端和匹配 legacy 入口，处理精确 F1 current 指针及 B1 drop-in；保留 F1 目录、objects、层缓存和全部数据。不要把原始 ungated Nginx 提前恢复导致流量绕过维护门。
6. 先在维护下验证旧 ready、页面/资源、匿名401，再由 Terra Chrome 核对既有登录/会话及必要账务状态；失败保持封口。确认组合和结算状态后，先持久化开放意图再恢复入口，记录真实版本与结果。

这是回退操作顺序和停止条件，**不是已演练的开放后自动回退工具**。原 `recover` 只适用于尚未开放的同一操作，不可删其守卫来套用。正常未来发布应遵循已安装生命周期及前后端协议；首次风险例外不应复制为常规发布路径。

## 验收范围与余额

详见 [Chrome 记录](../../.design-qa/2026-10-31-release-handoff/fb4fb09/chrome-postopen.md) 与 [完整实施记录](implementation-validation-20261031.md)。截图只在工具内目视验证，没有可交付本地截图文件。上线后未重测登录动作、上传、生成、下载或全部窄屏/错误路径；前端单测最后两项端口冲突、数据库测试未完成仍如实保留。

本轮真实测试预算占用35 minor（0.35积分）、实际净消费30 minor（0.30积分），退款不回补本轮预算额度。线上账户可用3.11/冻结0.60积分是已有钱包快照，不是本轮消费；历史未结算记录未改变。

---

下列为此前实施与交接材料；涉及“尚未上线/待用户回复/尚未构建”的段落仅作历史，当前执行以以上最终记录为准。

## 1. 用户要求及执行边界

- 发布到 **https://www.zimage.store**，使用现有阿里云服务器；手工发布，不触发 GitHub Actions。
- 用户最新要求：**先不继续测试，仅执行上线操作；将操作整理为项目内、供 Agent 阅读的 Markdown；上线后展示前后端打包大小和内容占比。** 停止新的真实模型请求和全面功能测试。必要的构建、原生依赖、发布门禁及上线健康检查仍需真实完成，不能伪造验收材料。
- 已允许短时维护、旧页面刷新；保留已保存的会话、图片、任务、积分。不得自动重试未知计费请求或自动处理历史退款。
- 已允许现有 SSH 密钥连接及失败重连。浏览器操作必须由 **GPT-6.1 Terra 在 Chrome** 执行；不能改用其他模型/浏览器，也不能恢复已删除的 Playwright/E2E 工程。
- 不购买云资源，不改裸域 DNS，不做破坏性数据库迁移，不改模型价格、计费规则。豆包模型保持现有配置；用户没有批准换模型。
- 需要用户补充时使用交互卡片，一次一题。已有授权不要重复询问；遇到无法满足的真实门禁，应说明具体缺口，不以普通上线授权推定允许移除门禁。
- 不清理历史验收资料，尤其 `.design-qa/2026-09-16-real-acceptance/`。不输出或提交环境变量值、密钥、登录密码、完整账号数据。

## 2. 开始前先读与核对

按以下顺序阅读；仓库文档中的旧“未连接服务器”等描述属于相应历史阶段，不能覆盖本次有时间标记的事实。参数和 schema 以接手时实际源码为准。

1. [项目进度](../project-progress.md)、[本轮实施及验收记录](implementation-validation-20261031.md)。
2. [Web 约束](../../apps/web/AGENTS.md)。继续单一工作区、状态和网关。
3. [Backend 首装与恢复协议](../../ops/aliyun/backend/README.md)，特别是 first-window 和 frontend bootstrap。
4. [Frontend 正式打包/验收协议](../../ops/aliyun/frontend/README.md)。
5. [三层产物协议](../../ops/aliyun/THREE-LAYERS.md)、[管理员安装流程](../../ops/aliyun/MANUAL-THREE-LAYER-RELEASE.md)、[字体要求](../../ops/aliyun/FONTS.md)。只使用当前协议，不能采用后半部分已标记 superseded 的历史命令。

```sh
cd /Users/zzz/Desktop/work_space/Image-web
git status --short
git branch --show-current
git rev-parse HEAD
git diff --check
```

**首次交接历史**：分支 `codex/frontend-backend-separation-20261029`，HEAD `3eb5b24a54df3d9f66bcbb154cbc313ecf9ceb9b`；业务、测试、运维和文档修改尚未提交或推送。**此 HEAD 不包含当前修复，不能用它冒充最终构建源码。** 先审阅并保留全部修改；正式封包必须来自包含最终修改的真实 clean 提交。不得为满足 clean 检查删除用户修改、修改身份标记或推送触发 CI。

## 3. 已完成的代码工作

- Vite 静态前端 + Next API + Supabase/Worker + 同域 Nginx 架构不变。
- `dev:split` 验证后端身份并提供同源 Cookie/Origin/SSE 代理；前端进程过滤服务端秘密。
- 显式 client runtime 替代源码字符串替换；故障只重查安全 GET，不重放生成请求；版本不兼容保持阻止。
- 登录回跳、账号返回应用内导航；电商结构校验移入 domain，支持可选 `expectedModules`，计费完成前拒绝缺失/重复/未知模块。
- 策划和文案的型号、数字、单位保护；自动/指定/不显示文字三种模式兼容旧存储。
- 电商及普通生图终态刷新积分与会话状态；深链等待会话及任务加载后再判不存在。专项验证见下表。
- 首装只读前后端组合检查、开放前成对恢复工具已补齐；**工具实现不等于已安装或已取得真实上线证明**。

## 4. 首次交接验证状态（后续变化见顶部续接）

隔离目录 `/private/tmp/zimage-20261031-validation`，日志在其 `.qa/`。Node 24.19.0、pnpm 11.19.0，按锁文件安装；原工作区依赖没有覆盖。

| 项目 | 已有结果 | 接手注意 |
| --- | --- | --- |
| Domain / Worker | 209/209；80/80 | 本轮基线 |
| Web 完整基线 | 145 文件，1207/1207 | 在最后终态刷新等修改之前，不能覆盖最终全部源码 |
| 最后 lint | exit 0 | `final-app-quality-summary.json` |
| 最后类型检查 | exit 2，一处 `string \| undefined` | 原仓库 `creative-text-service.ts` 已改为 `quantity?.[1]` 守卫；尚未同步隔离/Linux、尚未复验 |
| Frontend 首次 | 188 通过、2 个沙箱端口 EPERM；原码定向复验 2/2 | 与最后一次失败原因不同 |
| 最后 Frontend | 188 通过、2 失败 | `dev-server.test.ts` 与正在运行的 5173 冲突；不能标绿，不盲目杀真实页面服务 |
| 最后 Web 定向 | 7 文件，55/55 | 含文案36及终态/深链19；新增问题有先失败记录 |
| Linux Python 基础 | 267/267 | Mac 平台失败另保留，不混算 |
| Linux Backend 发布工具 | 普通用户复验 168/168 | 首次错误包括 Node 路径与执行身份 |
| Linux Frontend 发布工具 | 55 通过、1 Git 所有权失败；修复容器工作区所有权后该项 1/1 | 分轮覆盖，非单次全绿 |
| Linux Node 运维 | 181 通过、2 平台条件跳过、0 失败 | 共183项，不把跳过当通过 |
| 数据库 | 本地启动多次尝试；未取得 pgTAP/typegen 完成证据 | 不做生产迁移；接手时先查残留进程/容器 |
| 正式 Linux 前后端构建、封包 | **未完成** | 不复用 Mac 原生依赖或旧 QA 身份 |

临时目录可能被系统清理。选定非秘密摘要已归档至仓库忽略目录 [release-handoff evidence](../../.design-qa/2026-10-31-release-handoff/README.md)；原始日志仍在隔离 `.qa/`，不整体拷贝私密数据库日志、环境文件。

## 5. 构建环境与恢复位置

| 对象 | 实际位置/身份 |
| --- | --- |
| Mac Node | `/Users/zzz/.local/share/zimage-build-tools/node/node-v24.19.0-darwin-x64/bin/node` |
| Mac pnpm | `/Users/zzz/.cache/node/corepack/v1/pnpm/11.19.0/bin/pnpm.cjs` |
| Colima | `/Users/zzz/.local/share/zimage-build-tools/colima-0.10.3/colima`；profile `zimage-build` |
| Docker | context `colima-zimage-build`，显式指定，不切换系统默认 context |
| Linux 镜像/容器 | `zimage-build:node24.19-ubuntu22` / `zimage-linux-validation` |
| Linux 工具链 | Ubuntu22.04、amd64、glibc2.35、Node24.19.0/ABI137；`/opt/node/bin/node`、`/opt/pnpm/bin/pnpm.cjs` |
| Linux 工作目录 | **`/build`**，容器内部磁盘；普通用户 UID501:GID50，已安装锁定依赖 |
| 不能作为构建输入 | `/work` 是旧共享副本及中断安装；`/build` 也须同步最终 clean 源码后才能正式构建 |
| 共享 I/O | 容器 `/io` 对应隔离目录 `.qa/` |
| 目标指纹 | `.qa/linux-target.json`；cache root `/opt/zimage/layer-cache` |
| 公开构建配置 | `.qa/production-public.json`，0600；不打印/提交，不能直接当严格 API public-config DTO |

本地真实开发服务曾占用前端5173/API7788。先根据 cwd、argv、端口和创建记录确定是否仍运行；不要按进程名批量终止。最后源代码修复尚未进入隔离构建目录。

完整共享资源已生成，**仍未激活**：

- manifest SHA256 `bfb3e444b4b032f43ba6d977c33ba72922eea253f34c7d7fe222cb820c4dd23b`。
- 主机 `.qa/linux-complete-assets/<上述SHA>`，容器 `/io/linux-complete-assets/<上述SHA>`。
- 73文件、62图片；原始合计 **41,562,420 B**，其中 public **8,091,974 B**、字体 **33,444,552 B**、清单 **25,894 B**。
- 字体来源 `.qa/font-source/`，原许可/来源字节必须符合 [FONTS.md](../../ops/aliyun/FONTS.md)。不能使用 fonts-only 清单替代完整资源。
- 构建成对绑定 `ZIMAGE_SHARED_FONT_DIR=<完整资源目录>/fonts` 和 `ZIMAGE_STATIC_ASSET_SHA256=<实际资源SHA>`。最终源码资源改变时重新生成，不沿用旧 SHA。

## 6. 已核实的服务器及备份

以下为上一轮快照，**上线前重新只读核实**。无 `aliyun-lian` SSH alias；已有密钥通过 root 成功，`zimage-deploy` 连接失败。可用命令：

```sh
ssh -T -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o ConnectTimeout=15 -i /Users/zzz/.ssh/image-web-aliyun-ed25519 \
  root@47.100.222.24 'readlink /opt/zimage/current; readlink /opt/zimage/previous; df -h /opt/zimage; systemctl is-active zimage.service'
```

保持 known_hosts 校验。失败可重连，不创建新密钥或关闭校验。统一发布 CLI 若硬编码不存在的 alias，先审阅连接配置，不盲目执行。

- Ubuntu22.04/linux amd64；内存约1.6GiB、swap1GiB、磁盘约13GiB可用。原服务 MemoryMax850MiB；不要并跑两个850MiB应用进程。
- 可信 Node `/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node`；24.19.0、ABI137、glibc2.35。
- current `9c5c3ea95e0c66193b23a2db50643530aa7d095a`，previous `8cbb708645e93d3d71d17641b860cc60301fa005`。
- `zimage.service` User/Group=zimage，WorkingDirectory `/opt/zimage/current/apps/web`。原进程快照 PID399199/startTicks344889743/bootId `6aa2f828-d198-435e-9dd7-232503b0f750`；不得当作永久有效值。
- 环境文件 `/etc/zimage/environment`、`/etc/zimage/web-egress-20261026.env`、每版可选 `.runtime-assets.env`。保留顺序和隔离参数，不输出内容。
- Nginx `/etc/nginx/sites-available/zimage.conf`。新 frontend/backend/三层 helper 尚未安装，静态 `frontend/current` 尚不存在。
- 本轮未上传正式候选、未重启应用、未切换 current 或 Nginx。10月30日旧候选目录不属于本轮正式产物。

配置备份已经完成，秘密只在服务器：

```text
/opt/zimage/backups/split-preflight-20261031-130532/
config.tar: 20480 B
SHA256: fb8b7ef98e671dfc3544c25c7628295159ca2b196f8ff10ff2ba53151ea68a54
manifest.json SHA256: e99a866bad03b7590561979e701bcfd26d39c8ccbaea60ebc74fa3428022b488
```

目录0700/文件0600，包含原Nginx、systemd及drop-ins、环境/egress、原runtime assets绑定。**这是配置备份，不是数据库备份。** 核验旧release/资源仍可用；备份后若配置变化，要新建备份，不覆盖旧材料。不要直接整包覆盖 `/etc` 来回退。

## 7. 历史异常及消费边界

- 状态汇总曾有3个 processing、7个 unknown 相关记录；3个 processing 均为历史需核对请求，分别9月8日、9月16日、10月8日，不是本轮新增。
- 用户只授权这些异常的请求编号/时间/结算状态核查，不读其他账号图片、文案或资料。此前全账号账本读取被自动审批拒绝，未执行；不能重试扩大读取范围。
- 当前测试账号只读 audit 曾确认 available311/frozen60/spent629 minor、consistent=true；两笔历史 needs_review 各30 minor。保持原样，不自动退款/重试。直连数据库失败不构成改RLS的理由。
- 本轮单张主图报价30 minor并成功扣30；策划报价5 minor，上游400/API503后退款，无可用结果。**预算占用35 minor（0.35积分），实际消费30 minor（0.30积分）**；退款不恢复预算。
- 用户已停止后续测试，不能因还有预算而继续生成。单图Chrome结果和刷新恢复通过；下载仅UI提示，真实文件未核验。套图/详情仅保存草案，风格复刻/重做等未真实完成。
- 当前豆包 `doubao-seed-2-0-lite-260215` 没有改动。上游400的具体原因未证明；不能自行认定模型下线就是原因，也不能在发布时顺带换模型。

## 8. 执行顺序及明确阻塞（A的构建封包现已完成）

### A. 形成可封包的源码和候选

1. 审阅所有差异，确认最后类型修复进入最终源；完成必要的类型/构建检查。前端端口冲突应通过夹具隔离或确证后停止本任务服务解决，不把失败记录抹掉。用户暂停全面测试，额外业务验证不自动扩张。
2. 保存最终真实源码提交，得到实际40位SHA、tree、锁文件摘要。在独立 clean 检出构建；QA日志放项目外。没有最终提交身份就不能正式封包。
3. 用匹配Linux工具链、最终公开配置、完整资源绑定构建Next canonical `.next`；设置 HTTP/formal auth、production、实际 build SHA、slim、同域静态资源。前端构建固定唯一namespace、真实源码/工具链identity及允许的实际后端SHA。不要把服务端密钥传给Vite。
4. 参考构建参数（**占位符不是可执行默认值**）：

   ```text
   NEXT_PUBLIC_DATA_MODE=http NEXT_PUBLIC_PHASE2_AUTH=true
   ZIMAGE_DEPLOYMENT_ENV=production ZIMAGE_BUILD_SHA=<实际源码SHA>
   ZIMAGE_BUILD_SLIM=1 NEXT_PUBLIC_STATIC_ASSET_BASE_URL=''
   ZIMAGE_SHARED_FONT_DIR=<完整资源目录>/fonts
   ZIMAGE_STATIC_ASSET_SHA256=<资源SHA>
   NODE_OPTIONS=--max-old-space-size=4096
   /opt/node/bin/node /opt/pnpm/bin/pnpm.cjs --filter @zimage/web exec next build --webpack
   ```

5. 后端准备：`node ops/aliyun/package-release.mjs apps/web/.next <全新输出目录> --assets <完整资源目录> --release-id <实际SHA> --target /io/linux-target.json --prepare-only`。校验Sharp、原字体、ELF/ABI/glibc和完整运行依赖；不上传Mac node_modules。
6. 前端 `pnpm build:frontend` 的精确候选需与实际后端形成真实兼容证据。`pack.py --subject-only` 只是读取身份，不是批准；开发服务器测试或合成evidence JSON不能替代正式候选报告。按照 frontend README 使用 `package.mjs --dist ... --output ... --options ... --public-config ... --evidence ... --project ...` 封包。

**当前缺口：没有正式构建/封包，也没有最终精确候选组合的验收报告。** 若现有门禁要求的检查与用户暂停测试冲突，具体说明必要检查与缺口，一次一题沟通，不自动放宽门禁或新发付费请求。

### B. 先完成可恢复的准备，再进入维护

1. 复核服务器指纹、当前版本、空间、配置备份与保留release；统计首次上传完整对象及临时装配空间。
2. 从最终源码审阅/安装后端完整closure（含 `frontend_bootstrap.py`）、前端三个helper与三层六文件closure；固定root所有权及不可写祖先，不递归chown业务数据。
3. 精确绑定资源与systemd模板，保留User/Group、原环境和内存限制；每版资源EnvironmentFile最后生效。安装审批/target配置只能依据实际证据，不凭安装成功启用业务。
4. 使用真实inventory生成缺失对象transport；上传后逐件核对摘要、manifest和候选身份，保留旧版本。前端目标为 `incoming/frontend-<OP>.tgz`；其他路径遵守当前helper协议。
5. 在旧服务B0尚未停止时，预先绑定不可随意变更的first-window policy，含 F1 namespace/manifest、split ingress和两个maintenance include摘要。设置真实已封口边界，再获取原B0历史完整收尾证据。

**当前最关键阻塞：尚无原B0历史完整收尾证明。** 协议要求原进程启动以来覆盖六种入口：public-http/public-https/existing-http2/loopback/direct-bind/internal-callers；七类完成项：http-responses/nonbilled-graphs/billed-provider-health/sharp-storage/inflight-renew/zip-cancel-finally/upload-compensation-preview。completion有效期最长600秒。计数为零、等待一段时间、日志安静或先重启B0，都不能补出历史证明。若原始材料不足，保持现有服务，不制造证明或绕过guard；向用户说明无法切换的具体原因。

### C. 只有真实前提全部成立后才能切换

以下是协议命令形状，**未执行**。全部占位符须由已审阅真实产物/证据填充，不能随机生成摘要；具体签名以源码为准。

```text
/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py run <B1_SHA> <OUTER_SHA256> <MANIFEST_SHA256> <RUN_NUMBER> <EXPECTED_B0_SHA> <OP> <POLICY_SHA256> <COMPLETION_SHA256>
/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py prepare-frontend <OP> <POLICY_SHA256> <COMPLETION_SHA256>
```

`run`只得到封口状态下的 `backend_ready`，不是开放成功。`prepare-frontend`要求原带门禁legacy site仍在、静态current不存在；不能提前换split site。之后安装、`nginx -t`并reload精确批准的split ingress，核实已加载generation、include及旧worker退场；取得六入口确实封口的 `/etc/zimage/frontend-bootstrap-ingress.json`（最长600秒），再执行：

```text
/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py frontend-deploy <OP> <POLICY_SHA256> <COMPLETION_SHA256> <FRONTEND_OUTER_SHA256>
/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py frontend-open <OP> <POLICY_SHA256> <COMPLETION_SHA256>
```

开放前复核前后端精确组合、HTTPS/资源/API身份及只读认证行为；401与503不得混淆。开放后执行用户范围内的必要健康/页面检查，记录未执行的上传、生成、下载等场景。用户已停付费测试，不能把“上线完成”写成“全部功能已真实复验”。

### D. 回退边界

**尚未有开放可能性时**，同一操作的 F1 可按协议撤销：

```text
/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py frontend-rollback <OP> <POLICY_SHA256> <COMPLETION_SHA256>
# 恢复、测试、reload精确原带门禁legacy site，继续封口。
/usr/bin/python3 -I /usr/local/libexec/zimage-backend/first-window.py recover <OP> <POLICY_SHA256> <COMPLETION_SHA256>
```

只移除该操作的精确F1指针，保留产物/资源/数据；B0恢复仍需新的真实只读回执及单独账本audit，恢复后仍封口等待核实。

**已持久化开放intent或有任何写入可能性后**，不得自动B0回退。先停止新任务准入，查实际写入/未结算状态，再根据DB/Worker/模型和前后端兼容性恢复精确上一组合；不只回退一个指针，不重放计费请求。任何失败先记录 `first-window.py status` 和操作journal，不盲目重新run。

## 9. 包体统计口径（实际候选数值见发布报告）

**统计对象必须是实际上传且已校验的产物。最新候选测量已见[发布报告](release-candidate-20261031.md)，下表为原始交接模板。** 在切换前生成统计并保存摘要，上线后把实际激活身份与统计绑定后发给用户。

### 统计口径

1. 每个包记录文件名、source SHA、artifact/namespace、SHA256、压缩包实际字节数、文件数、解包文件逻辑字节数；显示 B 和 MiB（1 MiB = 1,048,576 B）。`du`磁盘占用另列，不能替代文件字节。
2. 前端分类互斥且穷尽：JS/MJS、CSS、图片/图标、HTML、字体、版本/清单及其他；按实际归档成员分类，不按整个源码或node_modules估算。未传输的sourcemap单列“保留调试资料”，不计入上传包。
3. 后端按实际三层清单分别统计业务代码、运行依赖（标出Sharp/libvips等原生依赖）、共享资源、清单/索引/封装开销。业务内残留Next静态资源据实列出，不假定分离后自动消失。
4. 共享资源单列图片/public、字体、清单；同一SHA对象在总体首次上传中只计一次。硬链接/符号链接不跟随重复累计内容；同时区分逻辑载荷、唯一对象字节、磁盘占用。
5. **内容占比 = 分类解包字节 / 对应包全部解包文件字节 ×100%。** 整体gzip无法准确拆出每个目录的压缩贡献；不能把解包比例标成“压缩占比”。可独立计量的层归档可按各自真实归档字节给传输占比。
6. 总体报告分别列“首次完整上传总量”和“本次inventory确认缺失的实际上传总量”。复用层需给远端核验依据；字体外置不等于总量消失。外层transport若包含内层归档，不再把两者相加造成重复。
7. 本地与服务器 `sha256sum`一致后才归入最终表；不要临时重新压缩一个不同包来代表上线包。可只读遍历已验证manifest/归档，统计时不执行未知包内容。

### 最终表格（当前待填）

| 实际产物 | 压缩传输 MiB | 解包逻辑 MiB | 文件数 | 摘要/线上身份 |
| --- | ---: | ---: | ---: | --- |
| 前端F1 | 待测 | 待测 | 待测 | 未构建/未发布 |
| 后端业务层 | 待测 | 待测 | 待测 | 未构建/未发布 |
| 运行依赖层 | 待测 | 待测 | 待测 | 未构建/未发布 |
| 共享资源 | 待测 | 待最终复核 | 73（现有候选） | 当前资源候选未激活 |
| 本次完整/缺失对象上传合计 | 待测 | 单独说明去重口径 | — | 未上传 |

另附前端/后端各自分类的“字节、MiB、占比”表，按体积降序，列出主要大文件及可优化点。不要把首次资源包与后续增量包直接比较成“减重百分比”；需要同口径基线才计算节省。

## 10. 完成标准与交接更新

- 更新本页与项目进度：最终source SHA、前后端身份、资源SHA、上线时间、准确URL、操作journal、备份位置和回退命令中真实参数。
- 保存构建/封包/传输/原生检查/健康回执及上述大小明细；无秘密的摘要可进项目文档，私密材料保持原受控位置。
- Chrome截图若拿不到可交付文件，标记“仅工具内联”，不能编造路径；如取得文件，保存至该轮验收目录并索引。
- 分别列出通过、失败、修复后定向通过、用户暂停/未执行；预算保留占用35/消费30 minor，不重置本轮账本。
- **只有公网实际版本、对应资源/身份、准入和健康确认成功后才能写“已上线”。** 若停在门禁，明确写“未上线及具体阻塞”，仍交付已完成文档和真实测量，不能以文档替代发布成功。
