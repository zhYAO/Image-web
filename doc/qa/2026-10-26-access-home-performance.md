# 2026-10-26 访问诊断、未登录导航与首页性能交付

本地分支 `codex/home-performance-20261026`；基线 `8cbb708645e93d3d71d17641b860cc60301fa005`。本地验证已完成。用户于2026-10-26 03:37 UTC明确授权按原分支提交、推送、正常PR/CI、合并及既有流水线发布；本报告提交时这些远端步骤仍待完成，最终精确SHA、CI与发布结果以远端记录为准。无独立生产重启、DNS/安全/数据库/Worker改动或付费模型调用。

## 生产访问：已证明的范围

- 父会话实际查看了用户原始 `image(5).png`（Library 版本0、484×250、64781 bytes）：浅色背景，只有“暂时无法检查登录状态，请重试。”与“重新检查”。这是应用错误页，无浏览器 TLS/DNS 错误。本环境官方图片传输曾失败，未重试绕过；原图视觉证据明确归属父会话，未冒称本环境下载成功。
- 父会话本地 Edge 于 **2026-10-26 03:10:00.820 UTC** 发起真实同源 `GET /api/auth/session`；**15.009 秒**后 `net::ERR_ABORTED`、canceled=true，未收到响应头/体。performance responseStatus=0 **不是 HTTP 状态码**。无服务器 request ID；Edge 内部编号不能当服务器关联 ID。重试仍失败，未捕获重定向。
- 该取消时刻精确对应 `AuthStatusProvider.tsx` 的 **AbortSignal.timeout(15000)**。因此已证明的是“身份响应未在客户端截止前到达”，不是服务器返回401/500，也不是已证明的 OOM。
- 根文档已有加载记录为 HTTP200、TTFB **31.114秒**、完整加载31.750秒；不是本轮重新测量。首字节等待在客户端页面渲染之前，不能以 JS 拆包宣称解决。
- `/home` 两次普通导航遇到工具10秒超时，核实时仍为原 `/` 与新 about:blank；没有确认其生产 HTTP 状态。工具不支持的原始 CDP 导航被拒绝后已停止，没有绕过。
- 02:30 UTC 本环境 DNS 解析失败；站点 HTTPS 在环境代理 CONNECT 阶段被 Envoy 403 阻止，TLS未到源站；DoH和网页读取也受阻。它们是本环境边界，不能替代父 Edge 的真实应用证据或判定网站 DNS/TLS 故障。未改 IP/代理/身份绕过。

## 最窄故障链路与剩余根因

源码中：文档请求先经过 `proxy.ts → updateSupabaseSession → await getClaims()`；`/api/auth/session` 也先经过同一代理，再进入 `require_verified_user_id` RPC。身份检查 pending 时工作区只显示准备界面，error 时 FormalAuthGate 精确输出截图文案，**不挂载受保护编辑器**。

有界核对仓库与已安装 SDK：getClaims 可触发网络验证/刷新；刷新重试窗口常量为30秒，仓库 Nginx模板的 proxy_read_timeout 为300秒。它们与31秒等待相容，但**仅凭时长不能确定该请求发生了刷新、具体卡点或现网配置**。仍可能在浏览器至反代、应用调度/事件循环、代理层 Auth/JWKS/refresh 或后续 RPC 等环节等待。

GitHub API 于本次检查确认 main 仍为基线；最新 main [run #85](https://github.com/zhYAO/Image-web/actions/runs/39905889310) quality/database/production-build/deploy 成功，10/23 05:58 UTC 的回环及公网38项检查通过，回退点 `a9a88959d8d9778dc7288a47fb2933a3162e39b7`。这是最后部署证据，不是今日服务器 current 或健康证明。两次历史匿名账户检查各约10.5秒，支持检查身份依赖等待，但不证明本次原因。

本次 Supabase 元数据返回 ACTIVE_HEALTHY；02:15–02:35 UTC 指定窗口内、查询时已到达的21条 edge日志均为三个后台维护RPC的200，未见身份RPC。只读目录确认身份函数存在、authenticated 可执行、anon不可执行。这不证明网站至认证服务的链路可达，也不排除 schema cache 或服务器出口问题；没有读取用户记录或修改数据库。

需要已有可用只读运维通道，围绕03:10请求前后约5分钟检查当前 release、systemd/资源状态、现有 Nginx访问/错误日志（若有 upstream耗时一并读取）和应用日志。SSH未执行；`/root/.ssh`列举被OS拒绝，未再试或绕过。没有足够证据建议重启、回滚、改DNS或安全配置。前端修改**没有修复或证明解决生产身份无响应、31秒首字节等待**。

## 本地实现与安全边界

1. **明确未登录回公开 `/home`**：工作区、历史与场景编辑入口使用replace，账户服务端明确身份401、经独立身份检查确认的账户过期、成功退出同样返回品牌首页。显式 `/login`、`/auth` 仍可主动访问；不自动跳登录页。
2. **error/timeout不是guest**：503、网络失败、15秒超时、未知错误或无效身份载荷保留错误与重试；不伪装登出、不清Cookie、不展示编辑器。完整身份结果到达前仍须等待，不能根据网络失败猜测未登录。
3. **拒绝错误的401推断**：身份RPC仅将明确 SQL `P0001/unauthorized` 或HTTP401的PostgREST JWT/匿名权限拒绝识别为未登录；其他网络/数据库/配置异常、缺失函数或无效成功结果为503。所有失败仍拒绝访问，不增加任何成功通路。依据[官方错误码文档](https://supabase.com/docs/guides/api/rest/postgrest-error-codes)和安装包网络失败status0处理核对。
4. **账户服务与退出**：资料/getUser/写入服务错误在身份已验证后返回503；原有动作接口含糊401必须再经有界、no-store身份GET确认，200/503/网络失败均保留会话。退出须真实 `signedOut:true` 才清展示状态。
5. **账户缓存展示**：已登出、检查中或检查错误时立即隐藏缓存账户字段与操作；确认guest回首页，authorized owner与SSR账户不一致则隐藏旧资料并refresh。错误不触发登出，新合法会话不被清除。该守卫覆盖返回键缓存/账号切换的旧邮箱展示风险。
6. **公开首页双层独立**：首访 `/home` 不挂载身份/积分/工作区providers；正式模式精确 `/home` GET/HEAD在服务端也不读认证配置、不刷新或改Cookie。其他页面/API、子路径、POST和旧匿名模式保持验证。进入应用后保留原provider树，跨首页返回不丢草稿。
7. **按需加载**：品牌可见应用链接复用意图预取，富文本只在有助手消息时加载，身份未确认不预取编辑器。图片、动效、流式、Markdown/URL安全、邮箱和短信禁用占位保留。
8. **移动空白修复**：390px实际主列与输入框宽度为0，因Grid切Flex后主列无伸展；只补移动 `.main { flex:1 }`。它独立于生产登录检查超时。

取舍：未登录的受保护深链接统一回 `/home`，不再自动携带深链接送登录；主动登录的safeReturnTo仍保留。失败身份检查不自动回首页，这是保留有效会话和暴露服务故障所需。正常桌面工作区的就绪时间也没有改善，见实测。

## 可复现实测：baseline → 最近final测量快照

- Chromium **151.0.7922.173**、Linux共享云容器；Node24.19、pnpm11.19、Next16.4.1 **Webpack生产构建，Mock数据模式**。身份fixture500ms后返回合成uuid，外部请求阻止，无真实登录或模型调用。
- 桌面 **1440×1000 / DPR1**，无网络/CPU模拟；移动 **390×844 / DPR2 / 触摸**，**150ms RTT、下载200000 B/s（1.6Mbps）、上传93750 B/s、4×CPU降速**。
- 每路由每档前后各 **3次**；独立浏览器上下文，禁用浏览器缓存。服务端图片缓存未重置，测试进程可竞争共享CPU；数十毫秒差异不能当稳定收益或生产SLA。
- JS/CSS为观察窗口内URL后缀资源的encodedBodySize，**包括script和link预加载**，无重复URL；桌面就绪后观察6秒，移动10秒，包含轮播/预取。不是源码体积、Lighthouse或真实用户监测。
- 表中final是 **03:18构建、03:21:04 UTC完成采样** 的导航/严格身份/公开代理版本。末次账户缓存展示守卫随后追加，已另作定向测试及两构建，按要求没有重跑无关性能；**不将表冒称该末次补丁后的逐字节重新统计**。它不进入被测两个Mock首屏的UI执行路径。

| 路由与条件（各 n=3） | TTFB ms | FCP ms | LCP ms | CLS | JS bytes | CSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 品牌首页 /home · 桌面 | 21.7→19.4 | 404→392 | 752→532 | 0.00004584→0.00002292 | 500816→224812 | 19176→15076 |
| 品牌首页 /home · 移动弱网 | 19.8→16.2 | 724→712 | 776→768 | 0.00081548→0.00040774 | 488444→224812 | 15033→15076 |
| 空白工作区 / · 桌面 | 38.0→69.9 | 176→252 | 1264→1512 | 0.01858245→0.01858245 | 1742393→633815 | 42666→42711 |
| 空白工作区 / · 移动弱网 | 46.7→63.2 | 492→472 | 无有效内容基线→7088 | 空白无有效基线→0.02411547 | 1725100→623357 | 30117→34305 |

- 品牌：完整JS桌面约减少55%、移动54%；请求数39→20 /30→20；long-task累计432→246ms /1008→282ms。两版品牌FCP在该组样本都<0.8s，不能保证生产或所有设备网络达标。移动LCP776→768ms仅8ms，不能声称显著改善。
- 工作区：JS约减少64%，但桌面输入就绪1643→1741ms（final范围1678–1862），LCP1264→1512ms，明确记录取舍。long-task累计518→210ms。
- 原移动工作区空白的492ms FCP/LCP仅为加载提示，无有效内容基线，不能拿来声称修复后变慢。恢复后输入就绪中位数6551ms（6413–6681），LCP7088ms，仍有弱网关键链路成本；long-task累计2479→1181ms。
- 移动身份fetch启动约3799.7→3843.1ms，未改善；未独立仪表化完整React hydration，使用long-task、请求瀑布和功能就绪观测，不冒称测得hydration完整耗时。TTFB仅本地Mock，不能与生产31秒直接比较为收益。
- 无外部字体请求；品牌hero已用响应式Next图片与high/eager策略，未删图、降低画质或取消动效。辅助的旧503性能实验仅保留历史，不作为最终导航版本收益。
- 中间构建启动曾有空响应、无FCP，记录保留，未纳入最终样本。正式测量先确认构建exit0、readiness200与SSR标题，最终12样本均200、无pageerror/外部请求。

## 验证与独立审查

- 导航、严格身份与公开代理版本的**完整** `pnpm test:run`：Domain12文件/**106项**，Web115文件/**834项**全通过，Web429.31s、exit0。
- 随后最后账户展示守卫4项先失败后通过；最终相关8文件/**51项**全通过，13.05s。按父会话“不重跑已完成测试”要求，**没有把834项冒称为该末次小补丁后的再次全量**。新增4项包含在51项内。
- 最终代码lint、typecheck、预算5/5通过；最终WebPack编译24.5s、标准Turbopack编译4.2s，两次TypeScript均8.5s、48/48静态页、exit0。缓存命中会影响编译时间，不作为运行性能收益。
- 独立审查：性能部分无可操作问题；导航审查发现“动作401误当登出”和“账户服务401误当guest”，后续账户返回缓存审查发现旧owner字段展示风险；三项均有失败先行回归并修复。没有未经处理的已知审查问题；未声称审查者重新独立验收了修复后全部代码。
- 曾有6个完整测试使用不完整拒绝夹具而返回503；补齐真实P0001/unauthorized或42501+HTTP401，原401及无Storage/签名/admin/模型断言保留，相关87项通过，随后完整834项全绿。最初富文本异步断言失败也已保留并改等待实际内容，未延长超时或降低门槛。
- 实际浏览器：guest从 `/`、历史和场景深链接回 `/home`，刷新无循环；公开首页刷新在Auth故障时无身份请求；503/网络失败保持错误、合成Cookie未清、合法重试恢复；退出通知后返回及重新进入仍公开（先观察进入 `/` 再等回 `/home`，避免原URL已是首页导致提前通过）；主动登录与意图预取正常。真实生产退出/账户修改未执行。
- 390/767/768/1024px主列与输入框宽度、无横溢出，跨首页草稿保留通过。本地前后品牌页和移动工作区截图已实际查看；原用户截图像素归属父会话观察。
- 临时脚本没有进入E2E工程。原始日志、瀑布JSON和截图仅在 `/workspace/scratch/zimage-diagnostic/evidence/`；无用户凭据，不提交仓库。生成next-env按基线恢复，停止本地服务器/构建后清理本次.next-build-qa；原.next保留。

## 交付与下一步

本地补丁：`/workspace/scratch/zimage-diagnostic/home-performance.patch`。生产认证具体卡点仍需可用只读服务器通道与有界日志，不重试被拒SSH路径，不无限扩展探测。用户已明确批准本任务提交、推送、正常PR与CI、合并及既有流程发布；必须等待最终精确SHA门禁通过并核验生产版本/健康，保留实际回退点。发布不能被当作生产等待已经修复。

Actions存储90%提示：现有流水线仅保留必要的数据库类型产物与7天生产发布包，本轮不添加产物上传、不删除既有产物、不更改付费设置；若配额阻塞CI，将报告而不绕过。账户总额度及其他仓库占用未经核实。

修改清单（共34文件；仅代码、测试及文档）：

- `apps/web/app/account/page.tsx`
- `apps/web/app/anonymous-auth-gate.tsx`
- `apps/web/app/application-shell.tsx`
- `apps/web/app/client-workspace.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/workspace-providers.tsx`
- `apps/web/features/account/AccountPanel.tsx`
- `apps/web/features/brand/landing/LandingNav.tsx`
- `apps/web/features/brand/landing/PillNavCTA.tsx`
- `apps/web/features/workspace/WorkspaceTimeline.tsx`
- `apps/web/features/workspace/workspace.module.css`
- `apps/web/lib/supabase/proxy.ts`
- `apps/web/server/auth/account-service.ts`
- `apps/web/server/route-context.ts`
- `apps/web/tests/account-display-identity.test.tsx`
- `apps/web/tests/account-feedback.test.tsx`
- `apps/web/tests/account-page.test.tsx`
- `apps/web/tests/account-service.test.ts`
- `apps/web/tests/application-shell.test.tsx`
- `apps/web/tests/auth-session-route.test.ts`
- `apps/web/tests/auth-status.test.tsx`
- `apps/web/tests/business-session-read-guards.test.ts`
- `apps/web/tests/client-workspace-loading.test.tsx`
- `apps/web/tests/commerce-safe-download.test.ts`
- `apps/web/tests/creative-text-route.test.ts`
- `apps/web/tests/public-landing-proxy.test.ts`
- `apps/web/tests/reference-promotion-routes.test.ts`
- `apps/web/tests/unified-workspace.test.tsx`
- `apps/web/tests/verified-user.test.ts`
- `apps/web/tests/workspace-components.test.tsx`
- `apps/web/tests/workspace-renderer-loading.test.tsx`
- `doc/project-progress.md`
- `doc/qa/2026-10-26-access-home-performance.md`
- `docs/superpowers/plans/2026-10-26-home-performance.md`
