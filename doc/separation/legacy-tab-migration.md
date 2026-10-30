# B0 旧标签页与首窗迁移的最小方案

2026-10-29 UTC。本报告是本地设计与证据索引，**不是迁移验收通过或生产执行单**。当前状态及门槛仍以 `doc/project-progress.md`、`resume-validation-20261029.md` 为准；本任务没有改它们。B0 是真实 `9c5c3ea95e0c66193b23a2db50643530aa7d095a`，B1 是候选新后端，F1 是静态前端。新源码不能追溯修改已经加载的 B0 JavaScript。

## 结论与建议

最值得继续验证的方案是：**保持原 B0 进程及其精确版本资源不动，把所有旧 Next 协议请求固定交给 B0；F1 文档/版本命名空间使用静态前端，新业务 API 才交给 B1。** F1 本身不发 Flight，因此无需猜测旧标签页身份，也无需给此前未收到版本 Cookie 的旧页面补标。

该方案只消除“旧运行时收到另一构建 Flight”的已知原因，不自动证明草稿、旧 API、图片优化或完整业务兼容。它还需要 B0+B1 同机资源可行性及独立进程身份，当前没有这些证据。保留 B0 可以延后首次停机；**不能补造其未记录的历史 finalizer 完成信号，也不能给出安全退休时间。** 未完成这些门槛前，最小安全动作是维持当前生产 B0，不切换、不停止。

首轮本地交付为本文、原始请求规格和来源绑定；随后父任务明确授权的独立 LOCAL QA 装置见末尾附录。没有修改产品路由、产品 JS、helper、数据库、环境或生产配置。后续任何产品实现仍应由父任务选择并收窄范围。

## 已知失败与同版保留机制

Terra 的原始观察位于 `.design-qa/2026-10-29-separation/resume-terra-20261029/browser-observations.md`：旧 B0 输入未发送草稿后，B0→B1 的请求 #94/#97，以及 B0→F1 的 #234/#237，均收到 `b=48e35686…` 的 B1 Flight，随后出现完整 document 导航，草稿为空。静态 chunk union 没有阻止该导航。

真实 B0 源码提供了值得复验的保留基础，而非凭空假设“SPA 一定保留草稿”。以下行号均相对于 B0 Git 对象，不是当前 dirty B1 源码：

| B0 文件 | 原行为及含义 |
| --- | --- |
| `apps/web/app/application-shell.tsx:18-21` | 首次进入后保持 WorkspaceProviders，即使到 `/home`；注释明确意图保留身份、草稿、在途 UI。 |
| `apps/web/app/workspace-host.tsx:13-17` | 已访问且仍 authorized 的 ClientWorkspace 以 `hidden` 保持挂载；不是卸载后重建。owner/status 变化仍可能改变 key。 |
| `apps/web/features/workspace/UnifiedWorkspace.tsx:358-360` | 到 outside 路由（含 `/home`）提前返回，不切换 composer。 |
| 同文件 `:390`、`apps/web/store/workspace-store.ts:92-99` | 回根页激活 undefined composer；如果原来也是无 session 的 composer，`:93` 直接返回，不清空输入。已有 session 走原会话切换/缓存语义，不能把“回根页”误当作“回原 session”。 |
| `apps/web/features/workspace/UnifiedWorkspace.tsx:422-430` | 引用图 object URL 释放及聊天 abort 在卸载 cleanup；同树仅隐藏提供保留的源码依据。 |
| `apps/web/store/workspace-store.ts:146-149`、`apps/web/store/composer-storage.ts:10-15` | 只有已有 session ID 才保存 composer 到 sessionStorage；首条无 session 草稿没有该持久化兜底。 |

**认证连续性是同等必要条件。** B0 `apps/web/features/auth/AuthStatusProvider.tsx:40-58` 在 `/api/auth/session` 503/无有效 UUID 时进入 error；`:46-49,74-91` 对 401、身份变化或 auth-required/auth-changed 清草稿。`apps/web/features/credits/CreditsProvider.tsx:47` 以 owner/guest 作为 key，认证错误也可能重建子树；`workspace-host.tsx:17` 在 `/home` 仅 authorized 保持旧工作台。即使某种暂时错误没有直接 reset 纯文本 store，卸载仍会撤销引用预览并 abort UI 请求。不能使用 401、503 或业务失败作为“升级通知”。B1 接管 API、切换取消与恢复必须保留同一有效 owner，并避免通过认证检查向旧页暴露短暂维护错误。

十个原始文件按确切 Git 对象只读取出，副本与 SHA256 在 `resume-legacy-strategy-20261029/b0-source/`、`b0-ui-source-binding.json`；没有 checkout、重写或修改 Git。上述依据仍须由真实 B0 HTML/JS 与原样 B0 Flight 在浏览器验证。只有“无额外 document 导航、同一 owner、原工作台树保持、回到正确 composer 后草稿/引用仍在”的联合实测才能关闭对应场景。

## 候选路由边界

现有 `ops/aliyun/split.nginx.conf` 的 API、`/_next/` 和 `@zimage_split_legacy` 都指向同一个 `127.0.0.1:3100`，不构成两个版本的固定路由。单纯把该端口切成 B1 会重现失败。候选必须分开两个独立、不可混淆的 upstream 身份；这里不指定未经确认的生产端口或 unit。

| 请求类别（按既有路径验证与优先级处理） | 候选目标 | 必须保持 |
| --- | --- | --- |
| `/api`、`/api/**` | B1；旧 B0 客户端也会使用它 | 原方法、body、Cookie、同一 owner、幂等请求 ID、错误/SSE/下载语义；认证状态无切换错误断层。不能失败后自动转投 B0 或重试。新元数据/public-config 必须来自真实 B1。 |
| `/_next/static/**` | 精确 B0 资源，或其按原 URL/字节验证的只读副本 | 旧 hash/字节、真实缺失 404；不能以 B1 chunk、HTML 或“同名可用”替代。 |
| `/_next/image` 及其查询 | B0 原 optimizer | 原 query/Accept/授权边界、真实图片响应；B1 对某张公共图片成功不能替代此门槛。 |
| 其他 `/_next/**` | B0，已无效入口维持真实拒绝 | 不引入 F1 index fallback，不让 B1 猜测旧协议。 |
| 文档路径中出现 RSC / Next-Router-State-Tree / Next-Router-Prefetch / Next-Router-Segment-Prefetch / Next-Url / Next-Action / Next-HMR-Refresh，或 `_rsc` query | B0 | 原 path/query/header 值及完整响应；prefetch 与导航有不同响应。合法旧业务状态仍按原协议处理；不篡改 Flight 的 build ID。 |
| 旧 scene/query 需要 Next 原解析的入口 | B0 | 保持现有编码、重复参数、平台及跳转语义；不得因切成 F1 而悄悄换解析规则。 |
| `/static-assets/**` 旧版本命名空间 | 原 namespace 及精确资源（按已验证部署方式） | 不改字节、不清理旧命名空间、missing 为真 404。 |
| `/frontend-assets/<F1-release>/**`、F1 文档、`/version.json` | 精确静态 F1 | 只允许明确文档表/命名空间；未知路径、缺失 chunk、缺失版本文件均真实 404。 |

API 路径先匹配 API，不因伪造的 Flight header 绕到旧业务后端。Next 协议判定应覆盖所有受支持文档路径，不能让某个精确 location 提前返回 F1；原本明确退休的路径继续按已批准产品策略拒绝。沿用原安全路径检查、Vary/no-store、SSE 无缓冲及无代理重试，不在本文引入新发布策略。

观察到的旧请求没有可靠的 B0 build ID：`Next-Url: /`、state tree 和 `_rsc` 值也不是可据以识别版本的凭据。事后设 Cookie 不能区分切换前已打开的页面，且 Cookie 通常跨同源标签页共享。保守地把全部旧 Next 协议留给 B0，比以这些字段猜版本更可核验。**普通 document 刷新/地址栏导航没有这个信号，会进入 F1；未发送内存草稿不能因此被声称已迁移。** 保留旧 Flight 只保证候选路由选择，不许诺主动刷新、用户退出或浏览器自身卸载后的自动恢复。

## 最小浏览器复验与真实响应捕获

忽略目录 `resume-legacy-strategy-20261029/capture-requests.json` 仅描述请求；首轮研究未发网络请求。后续只有获准的本地 4184 HTTP 检查，见附录。父任务只能在其现有明确授权内获取公开 GET 响应，不能把本报告当作 SSH/配置上传许可。

真实旧页面已产生的两种 `/home` 请求如下，均无 Cookie、Authorization 或 body：

1. `GET /home?_rsc=5CB68i4pnAekjehf`；`RSC: 1`，`Next-Router-Prefetch: 1`，`Next-Router-Segment-Prefetch: /_tree`，`Next-Url: /`。
2. `GET /home?_rsc=2Md0sTUZcnjCijMr`；`RSC: 1`，`Next-Router-State-Tree: %5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D`，`Next-Url: /`。

原日志中这两个请求的响应来自 B1；请求规格可复用，响应绝不能冒充 B0。真正捕获需保存 origin/transport/time、status、端到端 headers、原始 body、长度及 SHA256，并核对 `b=9c5c3ea95e0c66193b23a2db50643530aa7d095a`。不改字符串、不包装 B1 为 B0、不把静态 HTML 冒充 Flight。

公共 optimizer 对照请求为 `GET /_next/image?url=%2Fcommerce%2Fmeitu-v1%2Fkit-scene.webp&w=640&q=75`。原日志 #61 的 503 是缺少夹具；它不是实际 B0 失败。原 B0 真实 optimizer 响应仍缺失，且应按实际 Accept 变体核验。

夹具必须按 method + pathname + 完整 Flight header 变体匹配；不能仅按 `/home` 匹配而把 segment-tree prefetch body 用作完整导航 body。原查询保留在证据中，缺少变体明确 unavailable；它不应静默转发到 B1。返回 `/home`→原 composer 的请求形状需由真正 B0 runtime 产生后再捕获；原日志 #119/#121 等是全页切到 B1 后的新 runtime 所发，不能重标成 B0 证据。

本地复验最少覆盖：

1. 负对照保留已复现的 B1 Flight→整页 document→草稿丢失。
2. 独立旧 B0 标签页输入独特未发送草稿，切 F1 后只给 B0 Flight；点击原 `/home` 链接，再回原无 session composer。记录完整请求序列，验证没有新 document、没有 B1 Flight、原草稿仍在。不发送草稿。
3. 另验证已有 session 草稿返回相同 session URL/历史，以及引用图片未因隐藏被释放。切换后 focus/visibilitychange 会重新读取身份（B0 AuthStatusProvider `:99-105`），也必须保持同一 owner 和旧树。另做认证错误的本地负对照，不能仅验证一直返回固定身份的成功夹具。不同 composer 的正常切换不得误报丢失，也不得误报已迁移。
4. 新开 F1 页面仍使用 F1 namespaced bundle 与真实目标 API；纯夹具测试不得报告真实认证、业务或账务通过。精确回 B0 仍需独立恢复证据。

本任务不操作浏览器；仅由父任务指定的 Terra 执行。真实响应回放只能证明该本地组合/路径，不能证明生产 upstream、所有受保护路径或最终停机。

## 首窗、资源与 B0 退休

“让 B0 继续运行”需要明确区分浏览器运行时与服务端旧进程。旧标签页可继续调用 B1 业务 API；B0 仍负责 RSC/optimizer，也可能存在切换前已准入业务的后续 Sharp、Storage、续租和 detached health。B1 的新计数不覆盖这些 B0 工作。

`/tmp/zimage-b0-first-window-audit/FIRST-WINDOW-REVIEW.md` 已按真实 B0 源码列出未观测边界：非计费 graph/health、计费终态之后 health、服装已发 renew/native/Storage、ZIP cancel/finally，以及上传补偿和 preview。账务终态、队列空、访问日志空、TCP 消失、等待 300 秒或 systemd 30 秒停止预算均不能补齐它们。保留 B0 使这些任务有机会自然结束；**没有最终凭据时仍无法证明何时全部结束。**

当前唯一已记录主机事实是某时刻 available RAM 637 MiB；仓库 `ops/aliyun/zimage.service:14-19` 的单服务约束为 V8 640 MiB、MemoryMax 850M、TimeoutStopSec 30。上限不是 RSS，637 MiB 也不是可用给第二进程的保证；两者都不包含足够的实际并发 native 峰值证据。不得静默增开 B1、降低 B0 内存/并发、增加 swap/付费资源或在 Mac 安装 Docker 来制造“可行”。

共存候选至少需要匹配 Linux B1 制品，两个独立 PID/start/release/监听身份，B0 固定 release/静态目录/原进程不被 current 指针和自动重启改成 B1，真实 cgroup/主机预算及业务允许并发下 native 峰值证据。B1 独立使用新 lifecycle；B0 不伪装成支持 `/api/meta`/drainProtocol 的新实例。现有单 unit、单端口、单 backend current 的 helper 不能直接承担共存，需要专门审查的窄实现及取消/恢复步骤。

若无法在既有资源证明共存，单实例顺序切换仍受真实 B0 首窗停机门槛阻塞。修改已加载 JS、虚构 drain 零计数、强杀后重启或声明用户“接受迁移”均不构成解法。F1+B0 也不能作为现有代码的直接退路：`apps/frontend/src/platform/public-config.ts:29-32` 要求真实 `/api/public-config` 与 `/api/meta`，`runtime-provider.tsx:20-21` 据此开放受保护内容；真实 B0 没有这两个新运行时端点。保留校验，不能凭旧 SHA 合成通过。

B0 退休有两个独立条件：

- 浏览器方面：所有原 B0 页面均完成用户确认的草稿/引用保存并离开，且没有仍依赖旧协议的页面。当前没有已部署的旧页升级确认/在线计数协议，日志安静或固定保留天数不能证明这一点。
- 进程方面：封闭所有新应用准入（含旧 HTTP2 下一请求、GET/RSC/image、直连/内部来源），所有旧准入和离开 HTTP 的子操作真正收尾，固定探测自身也完成；再按同一 PID/start/release 核验。浏览器全部关闭仍不证明后台 finalizer 全部完成。

任何一个为 UNKNOWN 就不声称无损退休。无限期保留也不是已验证长期运维方案：仍要处理容量、故障重启、旧安全版本和原主机限制，不能隐藏这些成本。

## 用户可见迁移与本地实现边界

当前可诚实告知用户：“旧页面还在使用旧版运行时。请保留未发送内容和未确认请求，完成原任务后再主动打开新版。”但这句话必须经已有获授权且确实可触达的沟通渠道送达。普通新增 banner、localStorage 写入或 beforeunload guard 需页面实际加载并执行；不能声称已作用于所有既有 B0 标签页。即使另建 service worker 后能接管某些旧请求，也不因此获得旧 composer、保存能力或用户确认；不得替换不可变 B0 脚本来绕过这一限制。本任务不向用户以外的人发消息，也没有批准把草稿丢失视为可接受。

本次 B0 源码审查未发现已部署的升级通知、版本轮询、service worker、BroadcastChannel 或 beforeunload 保存通道。已见 transport 是认证/积分/任务读取与按请求启动的聊天 fetch SSE；聊天只解析 `packages/domain/src/api-contracts.ts:295-316` 的既有事件，`apps/web/gateways/http-workspace-gateway.ts:209-219` 会忽略不符合 schema 的新事件。这个运输通道不覆盖所有闲置旧页，也不能让新服务端凭空读取旧 composer。不能把附加一个新 SSE 事件当成已送达、已保存或用户已确认。

若现有资源与原收尾证据不足，父任务所需的最小产品决定应具体到：继续保持生产 B0 并延后迁移，还是另行选择有明确覆盖范围、确认方式与取消条件的维护过渡。用户尚未明确放弃保留草稿/既有业务；不能默认强制刷新、清草稿或中断未定请求。即便用户同意主动刷新，仍须单独处理服务端未定操作；用户确认草稿不等于证明旧进程安全停止。

父任务可先整合的窄本地范围：真实 B0 响应的按变体夹具、固定 B0 Next upstream 的纯路由选择模型/候选配置，以及 Terra 的同版保留对照。生产多进程、helper 安装/改端口、Nginx 传输与 reload、任何 stop/restart 仍需各自已有授权和当前证据。此前候选 Nginx 上传 + `nginx -t` 已遭自动审批拒绝且未执行；本文不改变该状态，也不重试该操作。

首轮证据目录：`.design-qa/2026-10-29-separation/resume-legacy-strategy-20261029/`。`source-bindings.json` 绑定该轮输入；它只是本地证据哈希，不是生产身份或验收 receipt。首轮没有新增 HTTP；完整任务均没有 SSH、生产 HTTP、数据库、付费调用、环境读取、产品运行时修改或 Git 写入。

首次离线一致性复核发现父任务并行修改 `split.nginx.conf`（增加外部维护 gate 引用），其余 11 份输入、10 份原 B0 源码副本及 3 份原请求规格一致。初次失败记录 `verification.json` 保留。重读后 API、`/_next/`、`@zimage_split_legacy` 仍共用 3100，上述版本分流结论未变；后续快照独立记录在 `source-bindings-followup.json` 与 `verification-followup.json`，不重标原快照。这只是来源/请求一致性核验，没有运行产品测试或关闭迁移门槛。

## 附录：已执行的本地固定 B0 对照

父任务随后明确授权仅在 `.design-qa/2026-10-29-separation/legacy-preserved-upstream/` 创建 LOCAL QA 装置、监听 127.0.0.1:4184 并留给 Terra。父任务已通过其原受信 SSH loopback GET 捕获真实 B0 `/home` 两种响应，ready 前后同为原 9c5c3ea；本子任务没有执行该捕获或访问生产。

- prefetch：200、284 字节，SHA256 `6a9ce2bc0f8638e500af400f8d8cd92af41854aaa4c883bebb83082625e89bef`。
- navigation：200、18,895 字节，SHA256 `b9eb6f1867da9fce0ee15e6320a081f55951cc88ce79f30c533dd24159951c1a`。

`harness.mjs` 由前轮 ignored harness 派生，原文件及 lineage SHA 保留。已移除全部 B1/upstream 客户端路径；只有本地 server，所有 `/api`/`/api/**` 为合成固定 owner 的 GET/HEAD 或明确 503；mutation 405、不转发 Cookie/Authorization、不返回 Set-Cookie、CSP 阻外联。phase b0/f1 只改变普通文档，旧 Flight 和 435 个原始 B0 静态文件始终保留。96 份公共文件（21,337,471 字节）为 B0 确切 Git 对象副本，明确标注 Git 来源，不伪称生产 HTTP 捕获；普通公共资源优先这些旧字节，因此本装置不能当全量 F1 视觉验收。

Flight 匹配包含原 method、完整 request target（含原 `_rsc` query）及七项 header 的全部值/缺省状态；未知/重复协议 header、改 query/header、HEAD 复用 GET 或缺失变体均不会命中。响应 body 不改字节或 build ID。每次请求重新读取 manifest，验证原 SHA、长度与 B0 `b`；新增变体用临时文件加原子 rename，可保留同一运行 PID。真实 optimizer 响应仍缺失并 503，F1 原 dist 不存在 version.json 仍 404。

2026-10-29T19:04:16Z，`http-verification.json` 记录 **43/43** 有限本地 HTTP 检查通过：七份原文档、两种真实 Flight 在 b0/f1 均逐字一致，navigation 引用的七个 JS/CSS 逐个匹配，真实 F1 文档/命名空间 bundle、同 owner 合成身份、严格变体拒绝、缺失资源和 mutation/CSP 边界均符合预期。最终 phase 恢复 b0。初次 verifier 的 raw 重复 header 请求遗漏 Host，Node 在到达 harness 前返回 400；原失败、原脚本与 body 独立保留。补齐测试请求 Host 后仍保持 503 断言，没有修改产品或放宽门禁。

启动默认 sandbox 实际 EPERM 的证据保留；随后按父任务已授权的窄 loopback 范围获准启动。已核验的自有 harness PID **11872**，Node24.19，入口 `http://127.0.0.1:4184/`，身份以 `owned-processes.json` 与 `/__qa/status` 的 PID/token/script/start 联合核对。服务已留给 Terra，后续 phase 可能由父任务改变。`stop-owned.mjs` 只在命令与本机状态身份匹配后向该 PID 发 SIGTERM；本任务未停止它，也未启动 B1 或其他服务。

浏览器交接详见该目录 `HANDOFF.md`。先在 b0 原 `/` 输入草稿但不提交，切 f1 后点击旧 `/home`，再优先浏览器返回原 cached composer；若真正 B0 runtime 产生新的根返回 Flight 变体，父任务需按 `requests.jsonl` 的完整形状捕获后才能验该导航。缺失变体保持 503，不能以它导致的 fallback 认定保留成功。当前只证明这组 HTTP 路径和字节；**Terra 草稿/引用与原树保持仍待浏览器实证，真实认证/业务 API、生产共存资源与 B0 退休门槛均未关闭。**

### 后续变体补齐与进程续验记录

Terra 首次保留对照实际产生此前未捕获的 `/home` #123/#124 变体，收到明确 503 后进入 F1 document #131；该次仍是失败，不能重标通过。父任务随后按其原授权原样捕获两个真实 B0 响应，并原子扩展 manifest 至四项，SHA256 `7764a62c9a1c9a93e833749f0540fb09b3dddd54aabb5454a7fb77492dd8de95`。`four-variant-integrity.json` 核对四份 body 的长度、SHA256 及原 B0 build ID 全部一致。

续验前，原 PID11872 的 `ps` 无匹配、原 exec session 不存在、4184 ECONNREFUSED，且没有 stopped receipt；退出原因 UNKNOWN，不称自然或优雅停止。父任务明确授权在确认 not-running 后，用同一源码/配置重启一次；仅旧 runtime 输出移入 `first-attempt/`，包括原请求日志、ownership、phase 和 43 项 HTTP 结果，原捕获与源码均未覆盖。`first-attempt/listener-loss.json` 保留上述未知退出与原浏览器失败。

新 owned run 为 PID **14680**、session80152，仍仅监听 127.0.0.1:4184；`restart-input-binding.json` 绑定六个未改的脚本/配置 SHA 与四份原 body。2026-10-29T19:15:06Z 的 `additional-variants-http-verification.json` 确认新增两种精确请求均本地 200：#123 为18,071字节、SHA256 `0dee50d1948ed3f23c49fd7d3abca21dc266d4401585004c99e711ff53e16a8f`；#124 为18,895字节、原 navigation SHA 不变。前后均核对新 PID/token、phase b0 和四变体 manifest。未改 harness 或响应来通过测试，未新增生产访问。

新轮仅交给 Terra 用全新 B0 页面复验；原失败保留。Terra 随后确认：切 f1 后点击旧 `/home` 并用 Back 返回原 composer，确切未发送草稿仍在。日志独立核对 `/home` B0 Flight #41/#49 于19:17:09Z、切换前已预取；19:18:16Z 切 f1 后没有后续 document 请求。**这是同一 B0 运行时/原缓存路径保留草稿的正向对照，不是浏览器切换后新 Flight 网络路径或全量兼容通过。** 切换后其他未捕获路径仍有21项预取503；没有把它们删除或改绿。`browser-http-corroboration.json` 保留完整范围；引用、已有 session、真实认证/业务和 optimizer 等门槛不由此关闭。

执行代理保持任务运行并轮询原 session，直到 Terra 明确 done，再以现有 `stop-owned.mjs` 核对新 PID14680 的 ps 命令和本机 token/script/start，仅向该自有进程发 SIGTERM。原 exec session80152 实际 exit0，`stopped.json` 同 PID/token、listening=false；19:19:22Z 的独立检查为 known PID 不存在、4184 ECONNREFUSED，`stop-verification.json` passed=true。未停止其他进程。此新轮可证明已完成受控停止；原 PID11872 的退出原因仍是 UNKNOWN，未追溯重标。
