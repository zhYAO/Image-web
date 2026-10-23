# ZImage React Bits 界面整合

## 状态与输入

本轮目标是把独立 Sites 前端界面移入现有 Next.js 应用，并保留真实业务服务。页面移植、完整测试、HTTP 构建和最终桌面复核已完成；数据库与真实环境尚未验收，本地成果不代表生产发布就绪。源 ZIP 已经用户授权的新 GitHub 输入分支取得并完成完整性核验。下列早期传输失败保留为历史证据，不再是当前源码阻塞。

- 目标基线：`origin/main`，`a9a88959d8d9778dc7288a47fb2933a3162e39b7`（2026-10-22 已 fetch）。开始时工作区干净。
- 本地独立分支：`codex/zimage-react-bits-integration-20261022`，路径 `/workspace/Image-web`。不修改参考仓库 `/workspace/clone-web`。
- 指定源版本：`4516d423803ab2923083610d75f2326c033984fe`；旧 `2f0aaac` 不作为移植基线。
- 源仓库：`https://git.chatgpt-team.site/06eedea4-8beb-4918-bedb-ab6dc478e572/appgprj_6ad0906b15f081919cc90064aff8acf5.git`。
- 主线程普通只读 `git ls-remote` 返回 exit 128，要求用户名，禁用终端认证提示后无法读取。预览地址普通 HTTP HEAD 返回 403。未重试认证、创建凭证或绕过访问限制。当时未能读取源码；后续已通过核验 ZIP 读取源 `AGENTS.md`、`DESIGN.md`、`README.md`、`docs/phone-login.md` 与 `docs/review-fixes.md`。
- 后续正式 Library 源 ZIP 已由提供方准备，但消费端 `prepare_materialize` 未返回本地文件路径；对工具给出的授权 URL 普通读取返回 HTTP 403 / curl exit 22，没有取得字节。提供方声明 ZIP 为 2,725,000 bytes / 204 个源文件，预期 SHA-256 为 `2bf618aa998bf27dd07c372c8f43ce7f419f6efd2c6019fd5180cc467009cd19`；这些在该传输失败阶段均为待核验信息，当时不能作为已下载、完整性或源版本确认的证据；最终核验结果见下文。
- 消费端正式物化 helper 不可用：主线程核对 cloud/executor 技能列表为空，在可读工作目录及常用安装目录未发现 `library_file_transfer.py` 或 Library `materialization.md`。实际读取使用工具明确支持的普通 GET；没有过期或无效路径证据，不刷新票据或重试同一路线。文档不记录授权下载 URL。该失败是传输受阻，不是自动审批拒绝。
- 用户随后已在本任务重新上传同名源码 ZIP（附件 ID `file_00000000ed9482309263f5c4fc0b72c1`）。主线程对这一新确切附件执行一次受支持读取：`prepare_materialize` 识别 2,725,000 bytes，但 `workspace_path` 仍为 null，新授权 URL 的唯一普通 GET 仍返回 HTTP 403 / curl exit 22，`/workspace/zimage-source-upload` 无 ZIP。该操作是新附件的一次读取，不是旧票据重试；未扩大权限。当时无需用户重复上传，原路线停止等待；后续已通过下述授权 GitHub 输入分支解决。
- 后续要求改用原生 sediment 附件下载，但主线程重新发现工具后仍未找到该能力，本地也无附件挂载；原生下载动作无法启动，不再走 Library 失败路线。403 的具体原因尚无证据，不推断为签名过期、权限配置或网络白名单问题。

- 已解决：按用户明确授权，主线程正常 fetch 输入分支 `codex/zimage-source-transfer-20261022`，精确输入提交 `178d651601861e2e40b9ec130e124ad23f691434`，通过 git show 提取 ZIP（blob `c53c424c8294b83e02b39fcfaba7d38311f40234`），未 merge 该分支。实测 2,725,000 bytes / 204 files、SHA-256 `2bf618aa998bf27dd07c372c8f43ce7f419f6efd2c6019fd5180cc467009cd19`，git archive comment 为指定完整源 SHA；无绝对路径、父目录穿越或符号链接。只读参考根 `/workspace/zimage-react-bits-source-4516d423/zimage-react-bits`，不复制部署身份。

## 页面与真实业务映射

下表经逐文件核对源页面后实施；源展示组件与目标业务状态分开接入。

| 源界面范围 | 现有承接位置 | 必须保留的服务与状态 |
| --- | --- | --- |
| 品牌首页 | `/home`；`features/brand/landing` | 完整源导航、画廊、滚动介绍、场景卡、FAQ 与页脚；明确静态示例，CTA 进入 `/` |
| 工作台、聊天 | `/`、`/sessions/[sessionId]`；`WorkspaceHost` / `WorkspaceApplication` / `UnifiedWorkspace` | 单一运行时；会话加载、SSE、时间线、请求恢复；`/chat`、`/image` 和源兼容地址 `/workspace` 重定向到唯一工作区 |
| 电商工具目录 | `/create`；`PublicCommerceCatalogue` / `CommerceCatalogue` | 访客可读目录与登录后共享运行时；现有 scene 契约和入口 |
| 工具表单、详情、生成结果 | `/create/[scene]`、会话 task/view 参数；`CommerceWorkspace` / `ApparelWorkspace` | 单一附件所有者、草稿恢复、版本编辑、报价确认、真实提交、精确 run 结果与安全导出 |
| 资产 | `/assets`；同一 `WorkspaceHost` / `SessionAssets` | 当前账号选择会话后仅一次 `getTimeline`，从真实 generation 取成功记录、搜索、过期提示、预览；复用 `VisibleAsset` 按可见性签名/单次自动刷新。没有全局库或收藏契约，不伪造合集和收藏；完整电商结果与下载回到原会话 |
| 账户 | `/account`；`AccountPanel` / `CreditAccount` | 原有账号读取、资料保存、密码、注销、退出、积分报价及账本 |
| 登录、注册、恢复 | `/login`、`/auth`、`/auth/verify`、`/auth/reset` | 原有邮箱密码和邮箱验证码流程、CAPTCHA、合法版本及安全 returnTo；手机号仅明确未接入占位 |

## 分层与冲突处理

1. 按 `apps/web/AGENTS.md` 保留现有网关、领域契约、后端 API、Supabase、队列、权限与计费。源项目的演示状态、假登录、演示验证码、模拟生成服务都不导入真实业务层。
2. 源视觉只能进入展示组件、样式和明确标注的示例资源。保留液态玻璃及已有减少动态、减少透明度、高对比降级；长表单和费用确认使用清晰实色面板。
3. 不新建聊天或生成状态容器；Zustand 仍仅承载 UI 与请求暂态。`AuthStatusProvider → CreditsProvider` 顺序、账号切换的范围隔离及私有资产 URL 生命周期保持。
   资产入口已复用 `catalogueRuntimeAllowed` 和真实认证边界，不能只判断 `status === 'authorized'`：正式认证开关关闭时该状态及 `ownerId=local` 可能只是合成 UI 状态，在 HTTP 模式中不证明已经登录。资产读取复用 `clearWorkspaceAssetCaches` 与账号切换失效机制，不持久化 signed URL，不让迟到结果进入新账号范围。
4. 已加入邮箱/手机号入口切换。手机号区域没有 form、fetch、会话写入或认证事件，全部字段及按钮禁用，并说明短信服务尚未接入；邮箱表单保持挂载以保留用户草稿，入口切换在现有认证请求期间禁用。
5. 不复制 `.openai/hosting.json`，不触碰 Flow2API/gflow、生产凭据、权限、计费或数据库结构。原本本地实施边界已由用户 2026-10-23 最新授权更新为：提交推送既有独立分支，核验 PR CI / 发布前条件后可按既有流程合并并发布到现有生产项目；不创建新项目，不跳过门禁。
6. 不恢复 Playwright / E2E 工程。已执行的授权浏览器检查只记录实际桌面范围，不能把本地 Mock 当成真实接口、模型质量或生产验收。

## 源未到位阶段的历史验证

本轮日志保存在本地忽略目录 `.design-qa/2026-10-22-react-bits/`。最终命令结果及未验收项同步至 `doc/project-progress.md`。

- 手机号回归先因缺少入口失败，再与现有邮箱反馈、CAPTCHA 专项共 22 项通过；覆盖禁用发送/登录、无网络请求/导航/认证事件、邮箱草稿保留及注册/恢复入口。
- 主线程独立执行 Worker 80/80、运维辅助 20/20、开发启动器 3/3 通过，均为本地测试。
- 数据库未验收：本地 Supabase status 在启动状态查询前尝试写 `/home/agent/.supabase`，因只读文件系统 EROFS 失败；未启动数据库、下载镜像或申请扩大权限。此阻塞不是自动审批拒绝。
- `pnpm lint`、`pnpm typecheck`、预算 5/5、隔离 Mock `pnpm build` 均 exit 0；构建目录清理，生成的 `next-env.d.ts` 已还原。
- `pnpm test:run` exit 1：Domain 106/106；Web 787/788，唯一失败为电商入口重试后 10 秒窗口找不到“商品套图向导”。业务代码、原断言和等待门槛均未修改，随后该文件 4/4 定向通过 / exit 0。原因尚未证实，不宣称单次全量全绿；具体证据及计数以唯一进度账本为准。
- 进一步诊断核对初始化 → 时间线 → `CommerceWorkspace` → `React.lazy(CommerceWizard)` 链路，与基线源码和 fixture 无差异。临时原始 main 工作树直接用已安装 Vitest 对照 4/4 / exit 0；最初 pnpm 自动依赖检查的目录写入失败另记环境日志，不算测试结果。首轮截断 DOM 无法指明加载卡点，冷加载/时序假设仍未证实；该非稳定失败保持未定位，不以重跑通过关闭问题，不猜测性改动业务或放宽门槛。
- 该早期阶段未执行覆盖率、数据库、桌面浏览器及真实环境验收；后续桌面检查已完成，最终覆盖率与数据库状态以下文和进度账本为准。
- 输入传输现已解决；最终移植验证记录以下阶段为准。没有真实账号、短信、模型、资产下载或生产验收证据。

## 源接入实施与本地验证

- 展示代码进入 `features/brand`，保留源 GlassSurface/FadeContent/PillNav 所需 LICENSE/NOTICE；已有公共示例图片复用 `/commerce`，不重复资源，不引入远程字体或动画框架。
- 工作台保留既有 Sidebar/Composer/Timeline，接入源比例、玻璃层次、欢迎标识与低开销光斑；光斑失焦可见时运行，隐藏页/离屏/减少动态暂停，不接管输入或 IME。
- 电商五场景目录移入源卡片层次；真实 `CommerceEditor`、`CommerceWizard`、服装/保存结果组件保留全部字段与提交事件，以源双栏配置/预览表面适配。桌面独立滚动、移动连续布局继续沿用。
- 登录/验证/恢复使用源视觉壳和原表单；账号页采用两列账户/积分布局，资料与安全操作仍走原 API。Mock 账号明确不提供真实资料修改。
- Next 与 sharp 发现既有依赖风险后更新至兼容补丁 `16.3.8` / `0.35.5`，eslint-config-next 对齐；无跨主要版本升级。fast-uri 3.1.6 与 brace-expansion 5.0.9 的普通递归更新（含显式补丁版本）均 exit 0，但 lockfile 未选择修复版本，保留两次日志，不将 exit 0 当成漏洞已修复。核验 registry 存在 3.1.8/5.0.12，父依赖范围分别为 ^3.0.1/^5.0.8 后，仅在 pnpm-workspace.yaml 添加匹配旧精确版本的临时 overrides；不影响 brace-expansion 1.x/2.x。未来上游解析不再选择这两个旧版本时移除 pin 并重新审计。首次 pnpm 因默认 `/home/agent` 写入失败，使用可写临时 XDG 数据目录和仓库既有 pnpm store 完成，不改全局配置。
- 新增资产读取/失败/账号范围回归与正式身份入口测试；原资产入口占位断言更新为真实 `/assets` 导航契约。最终通过数、audit 余项、浏览器及构建结果见进度账本。

- 本地桌面源/目标对照：1440×1000 主页面及 1024×768 窄桌面登录/目录；源截图来自独立参考副本，目标截图及交互 JSON 保存在 `.design-qa/2026-10-22-react-bits/desktop/`。复核修正了源卡片标签/说明、登录状态色、资产标题、服装工具栏及账户余额层次。浏览器只使用系统已有能力和临时脚本，没有恢复仓库 E2E 工程。

- 2026-10-23 最终安全更新：核对 [Next 16.4.1 发布说明](https://github.com/vercel/next.js/releases/tag/v16.4.1)、[16.4 兼容范围](https://nextjs.org/blog/next-16-4) 与 [Sentry 10.75.2 发布说明](https://github.com/getsentry/sentry-javascript/releases/tag/10.75.2) 及 registry peers 后更新 Next / eslint-config-next 至 16.4.1、Sentry 至 10.75.2；保留 React、业务架构和缓存配置。更新后审计仅余 KaTeX 低危，具体传递链和未修复原因见进度账本。

- 最终自动化（2026-10-23）：安全更新前后两轮完整 coverage 均 Domain 106/106、Web 796/796 / exit 0，最终 Web 89.05% lines/statements、71.61% functions、85.31% branches；lint、typecheck、预算 5/5 通过。标准 HTTP Turbopack 与 CI 对应 HTTP Webpack 构建均 exit 0、48/48 静态页。仅将 Sentry 构建导入改为受支持 `/config` 入口后针对复验 lint/types/Webpack；该配置不进入业务 Vitest 链。产物已清理、next-env 逐字还原。仍保留首轮标准测试的单项超时历史，根因未证实。

- 最终桌面复核（2026-10-23）：11 主路由及 3 个认证路由均 200，无页面/控制台错误、外部或 API 请求；主路由无横溢出，邮箱/手机号草稿与入口、禁用短信、1024 登录滚动和加载完成的账户余额通过。证据位于 `desktop-final/`。首轮截图默认隐藏光标造成的 hydration 属性提示及账户定位器歧义保留原记录，仅修检查脚本后通过，未为检查改产品。主线程实际查看截图，dev 服务已退出。数据模式为 Mock，没有真实服务或手机硬件验收。
