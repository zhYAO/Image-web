# ZImage 项目进度

## 2026-10-31 main 源码推送续接

- 用户在本地合并完成后独立授权推送代码。推送前 fetch 确认远端 main 无新增提交，本地领先17个提交且工作区干净。
- 本次只向 origin/main 正常推送，追加带 `[skip ci]` 的文档提交以遵守此前不触发 GitHub Actions 的要求；不强推、不重新部署。线上仍为 fb4fb09。
- 以下“未推送”描述为本地合并完成时的历史状态，后续推送以 Git 远端分支实际摘要为准。

## 2026-10-31 清理并合并本地 main

- 删除5处确认无调用的旧定义及独有辅助代码，保留有效 Next/API、共享工作区、运行环境适配、发布回退工具和历史验收资料；修复前端测试误占5173端口，改用真实随机回环端口。
- 清理代码提交 `341ce3c`：隔离 Node24.19/pnpm11.19 冻结锁文件安装；lint、类型检查、Domain209/前端190/Web1232共1631项单测、预算5项、Next及Vite生产构建均通过。首次依赖工具启动失败与修复后复验分别留档。
- 开发分支快进合并到本地 main，保留分支和提交历史；未推送、未触发Actions、未重新部署。线上仍为下节fb4fb09，旧构建和回退材料保留。
- [清理范围与合并验证记录](./separation/main-merge-cleanup-20261031.md)。本轮未新增真实模型调用、浏览器或数据库验收。

## 2026-10-31 21:38 上线完成（当前状态）

- https://www.zimage.store 已开放：后端/应用源码 `fb4fb09f909c0ae5dce98ebd0d9540386685ddb7`，前端 `release-fb4fb09f909c`；旧版9c5c3ea及原资源、配置保留。
- 用户明确接受旧未完成请求中断风险后执行维护；记录旧完整收尾未证明，未修改原guard。新后端开放前真实计数归零；未迁移数据库、自动退款或重放未知请求。
- Chrome（GPT-6.1 Terra）只读核对：首页三图、五项电商目录、既有账户和51条会话正常；服务器页面/API状态与版本匹配。用户暂停的生成、上传、下载及全面验收仍未完成，无新增模型请求。
- 发布工具公网IP回环探测问题已独立修复，4项定向复验及生产 `httpVerified=true`；不改变应用包或重启应用。
- 实际前端9.42 MiB、后端transport51.04 MiB，合计60.45 MiB。预算占用0.35积分、净消费0.30积分不变。
- [Agent上线操作和回退说明](./separation/agent-deployment-handoff-20261031.md)、[包体明细及优化点](./separation/release-candidate-20261031.md)、[验收记录](./separation/implementation-validation-20261031.md)已更新。以下候选/待决策条目为历史检查点。

## 2026-10-31 继续发布：候选已上传验真，切换待决策

- 本轮代码已保存本地提交 `fb4fb09f909c0ae5dce98ebd0d9540386685ddb7`，未推送。最后类型修复复验通过；从独立clean源码在Ubuntu22.04/amd64、Node24.19/pnpm11.19下完成后端185.3秒、前端21.6秒生产构建。pnpm入口/重复安装的初次失败与中断分别保留，不改写成一遍通过。
- 后端三层及前端正式封包已完成；Sharp、两字体和六项编解码通过，实际候选匿名ready/meta/public-config为200，认证/账号/会话为401。前端只绑定真实但有限的匿名发布检查，用户已暂停的最终Chrome UI、登录和业务复测仍未执行，没有安装生产批准。
- 候选上传到 `/opt/zimage/incoming/candidate-fb4fb09-20261031/`，六件包/报告SHA256全部一致；线上current仍9c5c3ea、MainPID399199且active。没有重启、改Nginx或切换。
- 实际前端压缩包9,873,452 B（9.42 MiB），后端完整transport53,516,727 B（51.04 MiB），两个归档合计60.45 MiB；各层及内容占比见[候选发布包报告](./separation/release-candidate-20261031.md)。这些是已上传未激活候选，不能称线上包。
- 原B0完整收尾证据仍缺失；已发单题卡片，询问用户是否接受维护中断未完成请求的风险。回复前不停止旧服务、不伪造completion或绕过现有guard。若接受，须先明确受控维护步骤与恢复条件再执行。预算占用35/实际消费30 minor不变。
- 本地本轮Supabase六个测试容器已停止，容器/卷保留；没有完成数据库测试。构建与产物证据持久保存在 `.design-qa/2026-10-31-release-handoff/fb4fb09/`。交接入口：[Agent文档](./separation/agent-deployment-handoff-20261031.md)。

## 2026-10-31 发布交接（尚未上线，用户已暂停进一步功能测试）

- 目标固定为 `https://www.zimage.store`，已有手工上线及现有 SSH 连接授权；用户最新要求停止后续模型测试，先处理上线，并交付供 Agent 阅读的项目内 Markdown。执行入口见[Agent 上线交接](./separation/agent-deployment-handoff-20261031.md)，含环境、实际状态、构建/封包、首装顺序、阻塞与回退。
- 已实现分离开发入口、显式运行环境、安全 GET 重查、登录回跳、结构化文案/模块/事实校验，以及生成终态积分/会话刷新与深链加载修复。修改尚未提交；当前 HEAD 不能代表最终修复源码。
- Domain209、Worker80、完整 Web 基线1207项通过。最后 lint 通过，Web定向55项通过；最后类型检查一处失败已在原仓库修正但未同步/复验，最后 Frontend188通过/2因5173端口冲突失败。Linux根Python267通过、后端168通过；前端55通过后余项定向1通过；Node运维181通过/2条件跳过。分别记录首轮和定向，不称最终全套通过。
- Chrome真实单张主图已生成、放大及刷新恢复；策划上游400/API503后退款，无可用结果。预算占用35 minor（0.35积分），实际消费30 minor（0.30积分）；下载文件及其余真实场景未完成。用户暂停后不再新增付费请求，不改模型或价格。
- Linux构建环境已可用，配置已备份到服务器 `/opt/zimage/backups/split-preflight-20261031-130532/`。线上最后核验仍为9c5c3ea；尚未安装新helper、构建本轮正式前后端包或切换版本。原B0历史完整收尾证据及最终精确候选验收仍有缺口，不能伪造或跳过。
- 用户新增要求：上线后提供前后端实际压缩/解包大小、分类占比，以及共享资源与首次/增量上传总量。统计口径和待填表已写入交接第9节；当前无正式包数据，不用旧QA包替代。非秘密摘要归档于 `.design-qa/2026-10-31-release-handoff/`；详见[实施验收记录](./separation/implementation-validation-20261031.md)。下方保留历史检查点。

## 2026-10-30 保存提交检查点（Linux依赖安装未完成，生产与安装重试暂停，UTC）

- 业务及可复用运维代码已保存于迁移分支提交`73c79955b78dc2015ccf4bce3543814ddfee6fca`，应用构建身份仍为`975f9e4c347fe0ee219abc5564cc53ea9cd0d749`。本轮按用户要求仅保存项目文档并核验指定分支推送，不合并main或发布。
- 七件后端输入共50,145,697字节已上传独立候选目录并逐件验真；可信Linux Node24.19/ABI137/N-API10/glibc2.35已核，不再将旧工具链的信任失败误作该独立工具链失败。详见[更新后的本地交付与边界](./separation/local-build-upload-20261030.md)。
- 三次受控准备均已终止且无候选后代残留，生产身份未变。既有代理继承修复后bootstrap与pnpm11.19版本检查通过；安装先触发严格内存守卫，降低堆需求后又达到期限。尚无成功Linux安装回执、canonical装配或原生/打包通过结果。保守累计预算761.027165/900秒，剩138.972835秒；未重置预算或启动第四次。
- 后续一次性执行脚本、针对性测试和回执保留在本地忽略目录，机器绑定实现不直接作为发布工具入库。最终73项本地针对性测试及独立复核通过，只证明该方案的本地边界。新增文档不包含环境配置、凭据、日志、构建产物或原始机器快照。
- 浏览器最新正常只读检查报告设备锁定；文件选择、真实focus和完整业务验收仍未完成。生产维护、准入封口、旧任务排空与切换未获本轮恢复，继续暂停；未删除业务数据或修改数据库。

## 2026-10-30 本地构建上传与纯观察工具（此前检查点，后续结果以上节为准，UTC）

- 用户明确改用本地构建后上传阿里云。精确975应用源已在Mac以Node24.19/pnpm11.19完成Next生产编译（119.838秒exit0），BUILD_ID/业务标记/822源码哈希一致；标准75NFT的23881引用闭合，另minimal根缺项保留。Darwin Sharp原生探针通过仅属Mac证据。详见[本地交付与边界](./separation/local-build-upload-20261030.md)。
- 新业务export/verify工具不改原Linux packager，不发Darwin node_modules，不重标旧runtime。最终b候选667文件/20,629,485原始字节，18单测及独立8项攻击样例通过；构建输出指纹和严格原始tar闭包已绑定。Linux安装/assembler/平台与真实组合验收仍待完成，不能把Mac业务候选称Linux可运行包。
- Mac前端候选9,959,007字节已一次上传到47.100.222.24全新`/tmp/zimage-local-candidates-975-20261030-a`，远端338成员/逐文件hash与CRC通过，原current/previous/PID399199前后同。没有解压、正式pack、安装或启用。旧runtime的lock/config与975不同，现有Node目录未过root路径信任检查，未运行该版本探针或改权限，不能宣称Linuxruntime已匹配。
- 纯observe/cancel/status工具已独立实现并关闭五项实证P1；本地工具59/backend144、独立安全59、原handoff23/ingress9/split9通过。工具只诊断与恢复同一旧准入，无stop/start/reload/DB/网络、无completion；异常需显式cancel，BUSY及300秒不保证故障恢复。应用仍绑定975，运维工具以本次提交和两源码rawhash单独标识，不重标应用。
- 用户解锁后Terra正常inventory已恢复，但原生选图仍`noWindowsAvailable`、reference0，真正focus/引用连续性未验证；新夹具HTTP96通过不能替代UI。自有PID57462已正常退出并核端口关闭，旧B0保留。云CONNECT403出口未重试；无DB迁移、删除、收费调用、生产门禁安装/reload/封口/stop或切换。

## 2026-10-30 静态资源构建/封包契约修复（完整本地回归通过，正式新源待Linux重建，未发布，UTC）

- 云端真实0b35 F1/B1构建成功；F1 subject-only发现17处七种原始commerce图片常量，运行时helper加前缀而build检查特许根路径，正式pack拒绝。已在四个受审模块的browser/SSR源码预转换中将allowlisted完整常量生成namespace URL，并收紧build检查；没有改dist或放松正式资源闭包。见[资源契约验证](./separation/asset-pack-validation-20261030.md)。
- 真构建还发现Emacs Lisp两个完整函数词项被sk-启发式误报；SECRETS原正则不变，仅两个严格完整标识符的窄例外，其他key/未知前后缀/同文件混入key和原始资源继续拒绝。语言字节与旧版本全同，无功能删减。新代码回归先red后绿，frontend176/domain195、Python前端工具52、预算5通过；typecheck/lint exit0（保留既有Next pages提示）。
- 新完整五步build→真实subject-only exit0，raw commerce常量0；QA338文件含candidate/337payload，dirty:true且formalAuth=false，仅acceptanceRequired，不是正式verified组合。Web首轮字体配对/loopback失败、取消轮和后续两项Mac临时路径别名失败均保留；使用原字体/manifest、正常测试权限及canonical TMPDIR后，单轮144文件/1189全通过，连同frontend176/domain195同一workspace完整命令exit0。新SHA、clean提交后构建与清单由外部receipt绑定，0b35云包不重标。
- B0真实只读快照已将问题缩到当前危险责任：text/apparel/upload pending和preview全状态均0；历史unknown3与needs_review2共60 minor保留。16选定函数13 exact+3仅CRLF、10表全权限可见已核。不再笼统索取每条历史GET/health/ZIP；当前仍缺封口时潜在mutation/pre-admission/断连链的可信边界，现有v1 gate未改、未签completion、未维护/stop/切生产。测试Turnstile为既有风险，未换键或制造安全配置。

## 2026-10-30 明确授权后恢复（候选语法通过，正式Linux待验，未发布，UTC）

- 用户明确批准当前私有迁移分支提交/push，以及47.100.222.24 `/tmp`候选上传仅nginx-t；此前拒绝由新授权允许正常流程重试。临时删除旧数据的提议已撤回，原数据/草稿兼容/排空/回滚全部保留，无删除。详见[恢复检查点](./separation/approval-resume-20261030.md)。
- 已实际完成获批的一次Nginx上传/检查：目标1.18下maintenance/legacy/split三份独立配置均exit0，保留TLS/MIME内部加载，前后web/nginx PID/启动时间/重启数和current/previous同；没有安装、启用、reload/restart或入口切换。上传前修复重复open_file_cache和未引号量词两个源问题，回归先red2后18/18通过。仍未代表生产全局路由/TLS握手/真实业务验收。
- 提交仅精确变更源码、测试、文档及必要配置，原scanner与凭据路径排除不弱化，不含QA/log/build产物；不main合并、force、PR或CI。提交后精确SHA/remote-ref/全源manifest由外部receipt绑定；源码发布不是生产发布，旧dirty包不重标正式输入。
- fresh本地86项HTTP通过，切前Flight0/切后原B0 Flight3/document0，文本保留；原生输入noWindowsAvailable使引用/focus继续BLOCKED，authGET0，不绕过。自有PID29564已exit0、PID不存在/端口拒绝；生产B0仍保留。正式Linux、原B0历史completion、资源、真实功能与安全切换门槛仍未过。

## 2026-10-29 资源受限架构收尾（报告完成，等待既有输入，未发布，UTC）

- 已完成[最小安全切换短报告](./separation/minimal-safe-cutover-20261029.md)：旧草稿在浏览器，不天然要求永久运行完整旧服务；原B0 PID是否能停止却取决于其历史已准入工作是否闭合。轻量层不接管Promise/native任务，也不能先从预算删掉原进程。若原完成记录不存在，当前无已证明的不丢业务首停路径。
- 公开静态/预渲染子集并非原理不可能，但真实B0账号SSR、Cookie/重定向、动态参数和具体session Flight不能用公共抓包代替；原server/app/rsc/segments库存尚未知，不能断言不存在。多构建旧renderer也不能假定零额外内存；不为赶期新增该架构、不伪造B0身份。79来源/5原Flight/435静态哈希离线核验exit0；最初对比8输入绑定保留，账本后续新增的预期漂移单独记录，不重标旧快照。
- 推荐现在保持B0；取得旧页保存退出与原进程全部收尾证据后，优先单实例顺序维护。低峰只降影响；既有匹配资源/有上限临时容量只解容量，不补退休证据。价格/实际规格/是否需停机/计费及恢复条件均未核价，不购买、不扩容，无生产动作。
- Mac解锁、私有分支提交/push及Nginx/tmp检查已由父会话统一询问，仍未答复；本轮未重试或绕过。完整交接保存`minimal-cutover-analysis/HANDOFF.md`（ignored QA目录），旧源码包保持原状、无正式Linux输入。报告独立复核后停止本轮，后续依赖上述输入及原操作证据，不宣称上线完成。

## 2026-10-29 切换兼容与共存资源补验（本地收尾，完整验收未通过，未发布，UTC）

- 继续实际补验，22份已复审运行时代码hash未变。新装置拒绝全部切前成功Flight；切F1后旧标签实际发出3条精确B0 Flight并200，零document/凭据/mutation，Terra确认home/Back后未发送文本完整。此轮关闭此前“仅切前缓存”的证据缺口，仍不代表完整业务/生产兼容。
- 干净nonce localhost origin与Host/marker归因排除旧127标签来源不明凭据布尔；不输出或转发值。新有限HTTP78、离线边界98、所有权16、日志对抗12通过，独立复核无P1。真实公共B0 optimizer单变体200/33768字节原样捕获，回放与拒绝4项通过；源文件/旧失败保留。
- 新F1原dist/命名空间、新开取消B0原文档与未刷新旧tab草稿已实证。已有session独立新页经真实B0 Flight后，切F1→旧home→Back回同UUID/标题/草稿；该轮home用切前缓存，明确独立于主轮新网络证据。503/401仅初加载控制，503恢复后真实重试200。Mac锁屏使引用选择、真实focus/visibility认证重检BLOCKED，不能将初加载GET当focus或在途状态迁移通过。详见[切换补验](./separation/cutover-compatibility-validation-20261029.md)。
- Terra本轮浏览器操作已完成；两个自有QA listener均按PID/token停止、exec退出0且独立确认PID不存在/端口拒绝，生产B0未停止。651相关应用输入与此前1636项基线全同，22复审源码全同；root最终HEAD48e、当前分支/index空、diff-check0。保留全部失败/锁屏/缺变体对照与最终证据，不把本地收尾当完整迁移完成。
- 生产仅只读资源观测：RAM总1608.910MiB，可用598.184–602.949MiB，B0当前cgroup387.844MiB；两个850MiB预算1700已超物理RAM，正式B1 Linux/native峰值及新增磁盘峰值UNKNOWN，当前共存不放行。未启动B1/新增资源/扩容，B0退出仍须旧页与旧进程分别闭合，无固定安全天数。具体授权/替代/费用边界见[资源方案](./separation/coexist-resource-plan-20261029.md)。
- Git私有目标仅核实为https://github.com/zhYAO/Image-web.git（zhYAO/Image-web）；提交/push与Nginx配置上传/nginx-t两项拒绝均保持暂停、未重试。旧dirty源码包和manifest校验和保持，未上传或重标Linux正式输入；生产current/服务/入口未切换，无DB/Worker或收费请求。下方均为历史检查点。

## 2026-10-29 首窗与全请求排空修复（本地代码复审通过，生产未发布，UTC）

- 接续上一节实证问题继续实现，未停在记录阻塞。Node HTTP同步准入+业务/HTTP/framework计数覆盖零快照后GET，以及锁定Next16.4.1的stale优化、缓存写入、磁盘init/eviction。缺hook/版本/hash/bridge失败关闭；维护错误保持原network/UUID/retryable合同。
- 独立first-window协调器解决真正无静态current/B0meta的首窗，恢复走真实B0身份与安全只读检查/单独钱包审计；不伪造历史收尾。复审发现的取消时前端漂移开门、未知PID收养、审批hash竞争与crash阶段遗漏均修复，最终独立复核无剩余Critical/P1。backend85、CLI34、Node24边界18、新入口8+split8通过；证据见[修复验收](./separation/repair-validation-20261029.md)。
- 实际新Mac Node24 standalone构建61.132秒成功，11项HTTP/优化器/检查准入通过，17次观察记录HTTP峰1/framework峰5，归零后停止自有进程并独立确认端口关闭。QA显式注入不等于Linux root文件/socket或真实业务验收；自建编译输出清理，失败拷贝轮保留。
- 新完整Web首轮1188/1失败为localhost fixture的sandbox EPERM，定向获准环境1/1后完整重跑单轮144文件/1189全通过；frontend167/domain195/Worker80/预算5，合计1636，lint510零诊断/三tsc通过。原失败、汇总排序元数据失败和宽输入/相关输入投影差异保留，不合并两轮冒充单轮成功。
- 旧B0草稿的可行候选为固定B0Flight/资源/optimizer与身份连续，不能补新JS影响已加载页面。Terra新对照同版预取缓存下草稿返回仍在、无document；切换后新Flight/全部业务未验。临时B0+B1限额共存取舍已明确提出待答复，未默开生产第二进程；旧B0历史收尾/退休仍有硬门槛。
- Linux guarded build/source/return适配器原样纳入仓库并23项守卫通过，具体父/云动作见[源码传递](./separation/linux-source-transfer.md)。最终真实commit/全索引/指纹/包SHA以提交后外部receipt为准；未上传本地包不称云可用，旧48e产物不重标。
- 新源码冻结动作（stage/commit并push到GitHub zhYAO/Image-web的当前codex分支）被自动审批在CreateProcess前拒绝，理由是具体外部目标/源码发布授权不明确；整条命令未执行，HEAD仍48e、无暂存，改动完整保留。已问明确批准，未重试/换通道；只读已核实该remote是当前账号的private仓库且具push/admin权限，这不代替授权答复。正式Linux clean提交输入因此尚未形成。
- Nginx候选上传47.100.222.24:/tmp和nginx-t仍为既有自动审批拒绝、未执行、待明确配置出站授权；本轮未重试或绕路。生产未改、无DB/Worker迁移或收费请求。下方旧检查点保留为历史，本节/修复报告优先。

## 2026-10-29 分离迁移接棒复验（完整测试通过，迁移验收未通过，未发布，UTC）

- 保留 `codex/frontend-backend-separation-20261029` 的全部未提交成果，HEAD 仍 `48e35686e0e4d6b302a1940cb12f5ea1be84860e`；未 reset/stash、最终 commit/push、合并 main 或运行 Actions。下方 Wave 2 本地检查点作为历史保留，本节及[接棒验收报告](./separation/resume-validation-20261029.md)是最新结论。
- 旧 `authenticated_health.py` 已移除可能初始化 wallet/welcome grant 的 `/api/credits`，只探测 account/sessions，成功输出移除账号 ID 和积分声明。两项准确失败对照之后 4/4 通过；未使用真实 Cookie 执行旧探针，不能用它代替 v2 verifier/账务审计。
- 最新完整测试 **Web143文件/1184、frontend167、domain195、Worker80、预算5，共1631项通过**；lint509文件0诊断，web/frontend/domain tsc全部exit0。651测试输入文件十快照一致；预算汇总器最初漏认Node24 spec字符导致的exit1与修正后的独立原始日志核验分别保留。证据 `resume-quality-20261029/verified-result.json`。
- 额外工具：backend48、frontend47、release CLI19通过；Node release/packaging合计22通过/1固定Node条件跳过。旧运维Python212项在Mac**未全绿**，规范tmp/localhost权限后仍50 fail/39 error，包含Linux/glibc/renameat2/GNU工具与Mac系统代理/连接行为；失败保留，不冒称Linux运维验收。
- 真实B0435静态文件/7原HTML逐字匹配，B1368静态与B0仅2同URL同字节、0冲突，localhost协议20/20。全部API仍是明确合成夹具，B1/F1仍Mac/dirty QA，不是正式产物。**Terra已复现旧B0未发送草稿经B1 Flight整页导航后丢失，组合兼容不通过。**
- 独立复审新增两项P1：①backend首次需要静态frontend/current，而frontend首次需要B0没有的meta，legacy恢复也缺分支；②维护只关写，新GET可在零快照后进入，`/_next/image`未被API计数覆盖。离线已复现stop时仍有activeStreams；需独立首窗/恢复状态机和覆盖所有新应用请求的持久准入封口。未用伪meta/零计数/重复采样或30秒stop绕过。详见 `resume-safety-review-20261029/REVIEW.md`。
- 本轮只读生产复核仍为current `9c5c3ea9…`、previous `8cbb7086…`、MainPID399199 active/running，TimeoutStop30秒/SendSIGKILL=yes；没有安装helper、上传配置、reload/restart、切换或回滚。真实B0最终收尾、fresh clean Linux候选/受控传递、真实认证/Storage/SSE/队列/账务、Windows和生产观察仍缺。
- **Nginx候选上传到47.100.222.24:/tmp并nginx-t仍为自动审批拒绝、未执行，待明确配置出站授权；本轮未重试或绕路。** 新P1及旧草稿失败未关闭前不最终冻结或上线，不将本次接棒验证当迁移完成。

## 2026-10-29 分离迁移 Wave 2 本地检查点（未上线，UTC）

- 当前分支仍为 `codex/frontend-backend-separation-20261029`，HEAD `48e35686e0e4d6b302a1940cb12f5ea1be84860e`；全部迁移改动未提交且保留，未 reset/stash、未 push/main 合并或触发 Actions。此节是最新状态，早期交接中的待安装/待构建描述保留为历史，不代表当前结果。
- **本地实现与代码验收通过，完整迁移/生产仍未完成。** 已补齐七项前端直接依赖和五步构建；原891包的版本、integrity、既有依赖图和原importer均不变。独立临时安装仅314包，没有Next/Supabase/Sharp/LangChain后端包，TypeScript和浏览器/SSR/素材/预渲染/资源闭包全部通过。主QA静态payload为336文件、17,406,204字节；独立无Git QA为336文件、17,406,540字节，均为dirty候选，不是正式Linux制品或已验证发布组合。
- Auth/API保留多批及同名不同scope的完整Set-Cookie、SDK响应头和旧Next页面Cookie行为；private/no-store、live RPC、401/503、Origin及owner核验已接通。已修复账号切换后的迟到草稿/POST/文案待核账/私有下载旁路，保留原requestId、未知账务恢复和单一workspace/store。S4原编译配置来源P1已独立复核清除。
- 上传采用实际body字节预算10MiB+256KiB、接收阶段30秒、每进程2个已准入处理名额至Storage收尾。Astra用锁定Next源码实证Proxy会整块截断，故精确排除`/api/uploads[/]`的预缓冲，路由名额内保留claims刷新和live RPC；不提高全局clone cap。单File违规保持原400，完整multipart越界413；挂起SDK仍持名额/计数，不能声称其也30秒返回或总RSS固定为2倍bodycap。
- **最终质量：Web142文件/1153项、frontend20文件/167项、domain195项、Worker80项、预算5项通过；完整lint及web/frontend类型通过。** 首轮Web1135通过/6失败保留：5个旧formData模拟夹具改真实multipart，1个原始byte-freeze改为只允许chat/uploads两个有精确hash的批准修订，原API基线JSON未改。前端来源专项45项通过；发布工具frontend47、backend43、CLI18、入口fixture8项通过，独立安全复审发现的本轮P1均已修复并复验。
- 最终Mac Node24.19.0 Next16.4.1 webpack standalone构建94.637秒成功；**39项真实编译HTTP+15次同PID只读计数观测通过**，包括4条Cookie、刷新单次、合法10MiB包络、无长度越界413、两名额占满及第三503、释放归零。均用本地合成Supabase服务，不是实Supabase/OTP/Storage/付费生成验收；自有API/fixture/浏览器服务器均已停止。来源指纹与历史失败分开保存。
- Terra在实际隔离dist上完成Edge桌面/窄屏访客、目录、认证表单不提交、未批准法律禁注册、回跳、history/query/hash及故障/不兼容场景检查；API为显式HTTP夹具。未把它称为真实认证、旧B0标签、Windows或Nginx验收。
- 发布/回退不再是空壳：已实现manifest/index/来源/工具链绑定、真实验收证据门禁、缺失blob传输、root私有stage封存、公开映射前批准、共享锁、原子前端指针、CAS/崩溃恢复和精确回退。后端有持久维护、完整收尾计数、超时取消、原native/font门禁、普通私有Unix socket的PID/UID核验、固定receipt摘要接收和常驻只读verifier；统一CLI采用既有受信root SSH身份，不增加账号/密钥/sudo。首个静态发布仅准入formalAuth=true/http，legacy源码/DB未删除或放宽。
- **生产未改。** 只读实测current为`9c5c3ea95e0c66193b23a2db50643530aa7d095a`、previous为`8cbb708645e93d3d71d17641b860cc60301fa005`，服务active，567MiB可用、13GiB磁盘余量（只读观测时点，不是持续监控）。可信Node24.19/ABI137/API10/glibc2.35匹配；没有在生产构建、安装helper、reload/restart或执行切换/回滚。
- **阻塞/剩余门槛：** 已保存隔离Linux构建入口尚未可调用，故没有本次精确提交的Linux产物/稳定build:backend取回；首次无drain的B0仍须安全排空方案及真实证据；真正B0旧标签RSC/chunk/图片/草稿与split→legacy整组恢复、Windows、实Supabase/私有Storage/SSE/账务及生产回退未验。pair/build命令不以空壳代替；当前无新正式commit/生产artifactId。
- **审批状态：** 上传候选Nginx配置到`47.100.222.24:/tmp`并运行`nginx -t`被自动审批拒绝，理由是配置出站传输缺少明确授权；该动作未执行，限定授权问题待回复，未改用其他通道重试。Linux入口问题也已提出；其余本地工作已继续完成。详见[Wave 2验收与交接](./separation/wave2-validation.md)。

## 2026-10-29 分离迁移接管与继续实现（UTC）

- 新执行会话接管 `codex/frontend-backend-separation-20261029`，基线仍为 `48e35686`，所有后续成果未提交且完整保留。旧协调与前端写入已结束；本会话独占共享 package/lock/配置及集成，分别划定 Auth 后端、静态发布、后端排空的互斥写入范围，另做只读安全复审。
- 用户后续“今天把本次迁移完工并上线”“继续任务，直到完成”“重新开会话执行任务”已授权继续实现，并在功能、安全、回滚验收全部通过后发布 `www.zimage.store`；旧规划和早期进度中的生产暂停/不提交措辞不再表示永远禁止发布，但任何 gate 未通过仍保持旧健康版本。禁止合并 main、强推、触发 Actions、新增付费资源/凭据或真实 OTP/收费生图。
- 接管时仅开始补齐前端七项直接依赖和 public copy/check 构建步骤；完成的后续结果见上方最新Wave 2检查点，完整迁移和生产切换仍须全部门槛通过。

## 2026-10-29 静态前端包接入（共享依赖已就绪，真实模块迁移待续）

- 已新增独立workspace包`@zimage/frontend`，固定Vite7.3.6、React19.2.7等现有版本；根`build:frontend`及lint接入，`pnpm-workspace.yaml`原有apps通配已覆盖，无需改写。前端构建仍要求显式namespace及有依据的兼容描述，不补造verified backend ID。
- 官方npm源、忽略生命周期脚本的显式安装已完成。首次沙箱DNS失败后已停止，获准的限定网络安装成功；未改registry持久配置/生产。锁文件891份package版本/完整性与原版逐字相同，只新增frontend importer，既有snapshots仅规范化optional标记，依赖图未变。证据：`.design-qa/2026-10-29-separation/frontend-install-evidence.json`。
- 新包实际命令TypeScript、首增量6文件81项专项通过；接入ESLint时移除了多余的全局图片规则覆盖，并覆盖前端mjs脚本。随后静态任务已开始新增auth模块，最新lint发现`auth-status.tsx`清理函数的ref依赖警告，由该文件所有者修复；不把并行中的源码称为全部lint通过。尚无完整Vite/预渲染产物、真实Auth/Account/Workspace迁移、业务或浏览器验收，不能替代旧Next上线。根package/lock/eslint及frontend/package.json继续由协调者独占。
- 下一波边界已保存仓库外`/tmp/zimage-frontend-backend-plan-20261029/wave2-ownership.md`：静态任务可继续写frontend内其余模块；独立Auth/API任务可接管明确列出的旧web认证文件；原runtime六文件仅由S2修P1。S4旧集成源码已冻结至QA副本，后续新Auth改动另行验证，不冒用旧快照结果。

## 2026-10-29 前后端分离 S4（本地验收通过，独立审查待确认）

- **S4本地代码门槛已通过，独立审查待确认**：P1修复后真实standalone构建91.404秒成功，同一产物在无重复构建env、残留另一合法SHA/公开flags、运行期撤销法务版本三个场景的18项HTTP全部通过；身份RPC故障对照实际访问本地夹具并返回503，所有自有服务器已停止。完整Web1079、domain195、预算5、Worker80、阶段0/1完整lint及严格类型通过。范围与历史失败说明见[集成验证报告](./separation/stage01-validation.md)。不把Mac QA或该范围通过当作前端真实模块、Linux发布或生产回退已完成。
- S2配置来源修复已冻结，协调者在隔离QA快照完成全量Web补跑：**132文件/1079项全通过，339.86秒**。快照指纹`2dc028dbadd96fbbb46ad9e9fa26adca6e9a79a5bb1591d2921c3f5d4c6b4988`，证据`.design-qa/2026-10-29-separation/test-web-stage01-final-result.json`；与首次1062/15历史失败分开保留。后续standalone/HTTP结论见本节首项。
- S2/S3已停笔，协调者补完两个公开runtime路径的精确GET/HEAD/OPTIONS Proxy例外及29项回归；其他路径/方法保持原认证刷新。domain冻结接口未改；完整项目类型检查发现OpenAPI/兼容测试的严格索引错误，已修复且未放宽TypeScript配置。完整lint、domain/web TypeScript和domain **195/195**通过。
- 首轮完整Web为 **1062通过/15失败，共1077项、132文件**，不计为通过。已定位13项由Node25原生不完整localStorage抢占jsdom引起，2项由Mac临时路径别名与realpath比较引起；仅用命令环境`NODE_OPTIONS=--no-experimental-webstorage`与规范`TMPDIR=/private/tmp`纠正，保持产品、字体及安全断言不变，相关4文件 **65/65**复验通过。完整Web须在修复后的冻结快照补跑一次。
- 独立安全代码审查发现1项P1、无Critical：新接口动态env来源可能与实际Next编译身份/auth/CAPTCHA不同。原S2六文件的写入所有权交还该会话，修复前不得将meta/config作为真实兼容准入。协调者负责随后构建时给值、启动不重复给值及启动残留合法旧SHA/flags的真实HTTP验证，不能只给测试补env。
- 必需字体从已有本地原件准备，原始字体及固定许可/来源hash均严格匹配；未联网下载或替换字体。独立预算/Worker结果见`.design-qa/2026-10-29-separation/stage01-independent-regressions.json`；完整阶段结果、历史失败与当前阻塞见`stage4-checkpoint.json`，未把测试夹具当真实业务通过。
- 阶段2允许仅新增`apps/frontend/**`的静态UI/路由适配并行；协调者独占共享package/workspace/lock/tsconfig与旧web集成，禁止并行安装/全量构建。生产仍暂停，无commit/push或真实外部业务调用。

## 2026-10-29 前后端分离 S1（纯契约已冻结，S2/S3并行中）

- S1仅新增 `packages/domain/src/runtime-contracts.ts`、`packages/domain/tests/runtime-contracts.test.ts`，并在 `index.ts`增加导出；协调者已读取冻结源码及S1实际命令输出。严格公开配置/API meta、前端manifest/独立payload索引、兼容判定已定义，未改既有业务schema或处理器。固定字段与写入边界见 [执行基线](./separation-stage01.md#s1冻结合同与s4交接)。
- S1新增测试先89项失败，首次实现剩1项own `__proto__`未拒绝，补严格对象边界后 **89/89**；domain完整 **13文件/195项**通过，domain TypeScript通过。S1三文件ESLint记录无规则错误、保留根目录React自动探测提示；完整web lint/类型/单元/预算/构建仍待S4，不据此宣称阶段1整体验收完成。已核查命令输出及冻结文件hash保留于 `.design-qa/2026-10-29-separation/task1-contract-evidence.json`，协调者未在S2/S3写入时重跑全量。
- **依赖异常已隔离，未重装**：S1首次裸pnpm测试因pnpm11.19.0默认脚本前核验发现安装状态过期，自动转install，访问现registry时报ENOTFOUND，随后中止；锁文件/manifest未改。输出 `Packages: -288` 先作为可能裁剪报告，协调只读复核39个直接依赖manifest/版本及types/bin均匹配；891个锁定包中769个实际存在、122个在显式skipped列表，无未解释缺项，另288个旧版本仍存在。完整传递链接/native/加载能力未验，不把这份存在性检查当S4通过，也不把后续缺依赖错误算业务回归。
- 依赖预检记录为 `.design-qa/2026-10-29-separation/dependency-manifest-preflight.json`、`dependency-lock-presence.json`。最初用require入口的探测会把纯types、CLI和仅ESM导出误报为missing，已用实际manifest/types/bin复核纠正，原记录保留。当前Node实读v25.9.0/darwin/x64，固定Linux发布工具链仍另验。
- S2新增只读配置/meta与S3清单/OpenAPI依互斥边界并行；两者停笔后协调者统一处理依赖和S4完整验证，不并行安装或全量构建。生产继续暂停，无commit/push、真实模型消费或生产操作。

## 2026-10-29 前后端分离 S0（本地基线冻结完成，S1待实施）

- 用户确认保留Next API/Supabase/Worker、首页预渲染及后端受保护短维护后，最新“复核计划后，开干”已授权本地分阶段开发/测试；安全最终复核对Task0/1为GO，无Critical/Important阻止开始。规划原件的旧只读措辞由 [执行基线](./separation-stage01.md) 同步覆盖；没有扩大为生产、付费或commit/push授权，旧发布继续暂停。
- 从已复核干净 `48e35686e0e4d6b302a1940cb12f5ea1be84860e` 创建本地分支 `codex/frontend-backend-separation-20261029`，未从旧main开始、未重置用户改动。首次普通Git元数据写被沙箱文件权限阻止，随后仅针对本地分支操作的权限审查通过并创建成功；不是生产操作。
- 冻结 [API源码基线](./separation/api-baseline.json) 的49个route文件/58个显式方法及逐文件SHA256、[页面路由策略](./separation/route-policy.json) 的9个既有合法scene与别名/退役/query/hash边界。包含停用和本地mock入口，不代表58项生产能力；隐式HEAD/OPTIONS、逐方法运行期行为和完整OpenAPI仍由S1合同/后续HTTP验证承担。
- 本地一致性检查通过：精确HEAD/分支、49份源码hash及导出方法、9个scene、既有应用/domain/DB/Worker/运维/依赖文件均未改；`git diff --check`通过。本阶段只改需求/选型/架构/进度和基线文档/JSON，没有为文档变更执行应用构建、真实账号/模型/Storage调用。验证记录位于 `.design-qa/2026-10-29-separation/task0-baseline-verification.json`。
- `ps`进程清单被当前Mac沙箱拒绝，未取得活动构建/缓存所有权；未停止进程或删除 `.next`/历史QA目录。进入构建阶段前仍需使用允许的通道确认自有进程与输出目录，不将该限制当作清理授权。
- 当前写入调度为S0→S1纯domain三文件→S2新只读接口∥S3清单/OpenAPI→S4协调集成/独立复核，边界见执行基线。未新增接口/框架、未安装、未改锁文件；真实排空/RSC/Linux构建取回/native/生产精确回退留后续门槛，不能以S0通过宣称分离完成。

## 2026-10-29 已批准的独立可信 Node（安装/兼容验证完成，未激活新应用）

- 用户明确批准新增部署专用root Node、固定helper路径及ExecStart-only drop-in，不修改旧www安装、不新增账号/密钥或扩大SSH/sudo。官方HTTPS固定版本归档31,633,904字节，SHA256 `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647`；仅提取node成员并核验SHA256 `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`。
- `/opt/zimage/trusted-toolchain/node-v24.19.0-linux-x64/bin/node`及新增祖先均root:root0755；实测Node24.19.0/ABI137/API10/linux/x64/glibc2.35。旧路径字节/SHA和www所有权保持，源码两helper的固定NODE及服务模板同步新路径，root祖先/非符号链接/不可组写门禁未放松。
- 配置备份为 `/var/backups/zimage-trusted-node-20261029`（root0700）；新增 `/etc/systemd/system/zimage.service.d/10-trusted-node.conf`（root0644），只重置ExecStart到新Node，原子发布并仅daemon-reload。User/Group、EnvironmentFiles及其顺序、隔离/出口相关属性、资源限制均逐项保持；线上PID399199及启动时间未变。新Node将用于下次服务启动，本轮没有restart或改current/previous。
- 以新Node在两个串行、只读、仅localhost、无生产秘密的限额临时单元启动保留应用，`9c5c3ea95e0c66193b23a2db50643530aa7d095a`和`8cbb708645e93d3d71d17641b860cc60301fa005`的真实ready均200且版本准确；192MiB/64MiB swap/40%CPU/75秒硬上限，单元已停止。该结果是旧应用启动兼容性预检，不是线上回滚；生产current/previous仍为这两个精确SHA。
- 两项固定路径回归先失败后通过，Mac定向10/10；新可信Node下实际Linux完整运维 **203/203**、66.524秒、exit0，独立复核无当前Critical/Important。临时管理脚本的部分写入和启动超时清理问题在执行前修复并经故障注入复核。证据在 `.design-qa/2026-10-29-trusted-node/` 及服务器临时目录；应用/依赖未改，不重复业务构建。
- 服务器现有root发布helper保留，未提前安装新版六文件闭包、启用三层target或激活新应用；正式发布前须按本轮新冻结SHA核验/安装整套helper与资源绑定，保留当前回滚能力。云构建必须fetch新提交并以其真实SHA重新构建，禁止给0f7adff3产物改标签。生产包仍未上传，Library消费失败由父会话按支持流程处理。

## 2026-10-29 正式构建前提与已保存云环境核对（文档补齐，通道待验真）

- 详细边界见 [生产构建输入与既有云通道判定](../ops/aliyun/BUILD-PREREQUISITES.md)：实测目标Node24.19.0/ABI137/linux/x64/glibc2.35，历史Node-API10须重新读取；pnpm11.19.0、Python3.10兼容工具、GNU tar及真实POSIX/native/字体门禁不变。固定HTTP/slim/Webpack/规范.next/同源资源，精确commit与构建标记一致。
- 纯云构建只需要源码、原始公开字体/许可、实际目标JSON、固定构建开关和五项真实公开配置；生产数据库/模型/认证/部署秘密及目标运行开关留在原存储和目标机。历史五键文件的验真不证明当前云环境仍持有；测试Turnstile sitekey风险仍需在激活前处置。
- 已保存Image-web Codex云环境仅由父会话报告可见，本Mac工具只列出本地项目，无法核实其OS/资源/工具/配置/费用。项目文档记录历史匹配容器与GitHub Actions，不足以证明现在存在无需新安装/额外付费的可用通道。建议由有访问能力的操作者先在该已保存环境只读核对；不创建新环境、不安装、不传秘密、不启动构建或发布。
- 若既有云环境不能满足严格条件且无已保留的匹配执行方式，停止依赖步骤，最小决策为指定已授权匹配Linux构建机，或另行批准具体临时资源/安装及费用上限。生产机约327MiB余量不用于全量构建，GitHub Actions仍不启动。本轮只补文档，未改应用或运维代码、未访问或修改生产。

## 2026-10-29 Mac 手动发布续接（Linux 运维验证通过，正式构建仍阻塞）

- Mac 当前分支 `codex/home-chat-react-bits-20261027` 从干净工作区安全快进至远端 `4e639c38dc11efe26ba0460d08b7b7ef753dae5d`，未合并 main、未触发 Actions、未 reset/stash/force push。本机配置为 `gpt-6.1-sol`、`service_tier=priority`。
- 复用现有 SSH 身份及已保存主机指纹恢复生产只读连接；实测 Ubuntu/Linux x64、Node24.19.0/ABI137/glibc2.35、Python3.10.12。服务 active，current 为 `9c5c3ea95e0c66193b23a2db50643530aa7d095a`，previous 为 `8cbb708645e93d3d71d17641b860cc60301fa005`。三层目标配置、store/cache 与安装闭包仍缺失；没有安装或启用它们。
- 实际 Linux 首轮200项发现27个错误，其中18项由新 transport 直接使用 Python3.11 的 `hashlib.file_digest` 引起，9项由测试夹具使用 Python3.11 的 `TestCase.enterContext` 引起。新增无该哈希API的真实归档回归先在服务器3.10失败，随后使用1MiB分块SHA-256，保留大小/哈希/路径/落盘/原子发布门禁；夹具改为等价 `ExitStack` 加 `addCleanup`，全部原断言保留。第二轮201项剩9个夹具错误，最终完整 **201/201**、75.394秒、exit0；独立代码审查通过。
- Linux 测试只上传870400字节运维源码归档及3个后续补丁至 `/tmp/zimage-4e639c38-preflight-20261029`，校验归档SHA256，使用现有zimage用户、断网、256MiB内存/128MiB swap/40%单CPU配额的临时systemd单元；未安装root helper或改线上服务。测试包含临时夹具和模拟服务调用，不能替代真实部署、字体/native、systemd激活与回滚验收。日志在 Mac `.design-qa/2026-10-29-mac-production/`，服务器原始日志保留。
- **发布仍 in_progress**：Mac 没有可运行的Docker/其他已发现Linux构建环境，现有Docker命令是指向已不存在应用的悬空链接；未安装新运行环境。生产机总内存1608MiB、可用约317–327MiB、swap1024MiB且swappiness0、磁盘可用13GiB，不足以据现有证据安全放行完整Next生产构建；历史构建已有约2GiB V8堆不足记录，不能将swap或cgroup上限当作资源保证。须提供资源充足且已授权的匹配Linux构建环境，再做精确新commit的正式HTTP/slim/same-origin构建与三层/native/字体验收后激活；没有使用Mac/Windows产物，没有上传生产包，生产包上传量0字节。
- Terra 经现有Edge会话访问公网HTTPS：首页、登录入口与ready正常，ready精确返回current SHA；未提交登录或付费请求。Mac独立curl随后以LibreSSL `SSL_ERROR_SYSCALL` 失败，未绕过TLS，不能宣称命令行公网门禁通过。旧版未切换，尚未执行新版本激活或实际回滚；回滚指针仍为上述精确previous SHA。

## 2026-10-28 阶段3表现层迁移（代码整合完成，浏览器及真实环境待验收）

- 本地参考 ZIP 大小/SHA256 与全部197个清单文件通过校验，来源 `2450e9a`；保留参考许可。未采用参考模拟 Provider、会话/模型数据或法务草稿。
- 全部功能视图已替换为原生控件与统一站内弹层/图片预览，移除 LobeHub UI、Ant Design、Emotion 主题注册及旧 Markdown 构建别名。依赖图1179→891个包记录，离线 frozen install及供应链校验通过；旧包解析/产品导入/构建边界2项测试通过。
- 独立 SafeMarkdown 专项58项通过并审查通过；原生控件修正后专项46项通过并审查通过；账号/主题22项通过。最终 lint/typecheck与预算5项通过，整合代码审查通过。全量单元测试首次被执行环境断连中断，已确认无残留测试进程后补跑，完整结果待登记；保留原有Windows字体symlink EPERM安全测试。
- 最终无密钥/禁止外网的Mock隔离Webpack构建通过（71.797秒）；运行时代码/配置/锁与快照一致，144份NFT中旧UI与仓库字体追踪均为0，产物字体文件0。该目录通过junction复用依赖，是本机QA编译证据，不作为Linux可部署发布包体积。
- 对照工作区与阶段2隔离副本确认两者均残留字体tracing glob；本轮已在真实配置删除并补断言。字体解析器、外部原件及原生安全校验边界未变。
- 未启动7788或其他服务，未做浏览器操作，未提交/推送/发布；原76项暂存补丁SHA256仍为3725d3c87bd0eacf9eca27a874276ded1621cf9d158b74eb4e67614a365d7188。临时7791 QA启动脚本已准备但未执行，后续由Terra验收并关闭。
- 浏览器布局/键盘/首滚动效、真实Supabase/SSE/provider/私有Storage/队列及真实扣费仍待对应环境验收；Mock与本地fixture通过不能证明生产就绪。最终产物占比由后续同口径发布包复核。


## 2026-10-28 阶段1前置统计与引用修复（本地定向验证通过）

- 保留用户确认的 ae8c332 及76项既有暂存变化，未重新暂存/提交；修复仅留工作区。
- 发布统计按最终覆盖结果计数，普通输入文件数不重复加诊断文件，链接目标按真实 UTF-8 字节另列；先复现3项失败，再通过8项统计及3项Markdown profile测试（含8种SSR对照）。
- 19处被删历史证据链接改指真实 ae8c332 Git对象，逐项校验存在；历史文档删除保持。完整包CI固定同源资源，测量测试并入原Node步骤，无新增job或资源发布。
- 本轮 Node24.19.0：定向lint、无输出typecheck、预算5/5、YAML/同源配置校验通过；lint保留既有Pages目录提示。未重跑业务全量、构建、浏览器或真实服务验收，不将先前Windows打包限制记为通过。
- 尚未开始字体外置或Lobe/AntD迁移；未启动7788、连接生产、付费调用、推送或部署。详细补丁与红/绿日志留仓库外本机任务目录，由父会话继续串行交接。

## 2026-10-28 首页与工作区功能分支交接

- 用户授权将已验收改动提交并推送到 `origin/codex/home-chat-react-bits-20261027`，供D1M自行拉取本地运行；不合并main、不创建PR、不部署、不操作D1M。
- 交接前核对71个既有改动文件，业务代码/测试自最终验收后未变；沿用Web911/911、Domain106/106、lint/typecheck、构建49/49及预算5/5。新增改动仅为README路由说明与交接文档，无需重复应用测试。
- 仓库唯一workflow的push分支为main/setup2，功能分支不匹配；提交附带 `[skip ci]`，不修改workflow、不手动触发CI。运行要求Node>=24.19.0、pnpm11.19.0；`pnpm install --frozen-lockfile` 后 `pnpm dev`，默认Mock、默认端口3000。提交与远程SHA以Git记录及本次推送核对结果为准。

## 2026-10-27 首页默认路由与聊天界面对齐（本地验收完成，未发布）

- 原始Mac仓库在最新origin/main `9c5c3ea95e0c66193b23a2db50643530aa7d095a` 新建 `codex/home-chat-react-bits-20261027`；只做本地开发，未push/PR/部署/生产操作或付费模型调用。`/` 与 `/home` 共用首页，唯一工作区 `/workspace`，登录回跳和旧深链同步。模型保持豆包、MiniMax聊天与Seedream生图，真实选择进入既有请求。
- 用户实测反馈的动画失效与折叠错乱已定位并修复：Reveal子控制器先于父ref运行；tooltip包装破坏直接子节点CSS。均先失败再通过回归。修复后的实际Edge有淡入中间帧、76px图标居中侧栏、展开无气泡；另修手机旧换行覆盖。底部CTA在opacity0.376678、translateY17.453px动画中首次点击进入登录；访客全部CTA与顶部登录、已登录响应隐藏登录、模型键盘/焦点/外部关闭及390px布局已实际核对。
- 最新产品代码独立QA构建49/49、typecheck、lint、预算5/5通过；字体canonical路径27/27，保留像素/安全断言。Node25实验storage使用官方关闭开关，让jsdom正常接管。独立审查滚动重置问题已回归修复，Reveal/tooltip复审无新实质问题。最终全量退出0：Web **911/911（124文件，495.66s）**、Domain **106/106（12文件）**，见 `/tmp/zimage-final-full-tests.log`；旧默认回跳预期迁移后安全断言保留，最终窄范围复审无新实质问题。
- 当前用户预览 `http://127.0.0.1:3100/`、`/workspace` 是当前未提交分支Mock，已恢复可用；认证UI专用3101/3102夹具验收后停止，已清理无打开文件的隔离QA输出，未使用真实账号。实际参考Site已读取截图，但所交接源码commit与Site v18未证明逐字一致，不宣称像素完全一致。真实Supabase、验证码、计费及模型就绪仍沿用既有边界。详见[本地QA记录（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-27-home-chat-local.md)。

## 2026-10-27 三层管理员适配与生产平台匹配（本地完成，已收生产公开配置，待最终构建）

- 用户要求的实际管理员适配器已实现：独立bundle、固定路径root deploy/rollback及systemd-template，旧完整包helper未修改。沿用同一部署锁、严格本机HTTP/TLS健康检查和精确原版本回退；root导入闭包/安全Node路径、有界7成员传输、真实生产SHA/.next/www资源门禁、逐release字体环境、nonroot字体/native与sameSHA完整重验均有回归。未安装到ECS或修改sudoers/Nginx/服务。
- 最终完整运维Python套件**114/114**、13.325s通过；Python3.10语法检查和缺新API摘要回归通过，未声称真实Python3.10运行。应用源码/锁文件与已验证第二QA一致，不重复887项应用回归或占位构建。独立审查无Critical/Important；额外验证7项用例、4类七成员恶意包及异UID拒绝。运维边界：helper任何非零都须核查current并按捕获oldSHA回退；新95资源HTTPS是外部硬门，失败必须精确恢复。
- 父会话CloudAssistant `t-sh0719pffua0buo`退出0：ECS Linux5.15 x64、Node24.19.0/ABI137/Node-API10、glibc2.35。官方固定摘要Ubuntu22.04容器已实际拉取/启动，真实Node元组与ECS一致；严格指纹未放宽。只读/非root/无网络/不privileged环境中现有pnpm、SWC、Sharp、两字体和JPEG/WebP/AVIF通过。复用预装Python隔离运行，49项分层测试6.754s通过，adapter原生JS实际返回fonts2/codecs6；未挂载主机凭据或敏感系统目录。详见[平台方案及证据（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-27-production-platform-plan.md)。
- 官方Python apt安装仅尝试一次，因容器DNS无法解析Ubuntu源失败，无包安装；已停止，不改DNS/代理/host网络/安全配置。随后使用现成可信Python并屏蔽site-packages，无需继续下载。基础镜像78,093,105字节；原有QA/正式产物保留。
- **公开配置已受控收到并验真**：Library物化download failed后没有重试，父会话另交付原始字节，387bytes及可信SHA完全匹配、仅5个公开键，文件0600置仓库外且未输出值。下一步锁定含新适配器的最终commit，做一次规范.next/glibc2.35正式候选构建。配置中的Turnstile key已确认是Cloudflare官方always-pass测试key；保留现存值/校验而不静默替换，后端secret/真实验证码未读未测，不能据候选构建宣称防机器人通过。详情见平台报告。Library报告保存network故障保留，不编造身份或链接；旧QA包绝不上传冒充生产。
- 用户已批准的生产安装/临时OSS表单中转、Windows严格验收和一次自动回退仍由主会话协调。当前没有可用的OSS API签名请求，不假定浏览器表单等同PUT URL、不创建凭据。Windows公网ConnectionReset仍未通过，所有生产安装/验收/切换待完成；没有把本地READY称为发布成功。

## 2026-10-27 独立资源与三层发布（本地验证完成，生产构建/发布待交接）

- 用户已取消10MB硬门槛，保留精确报告/可选预算；生产目标阿里云 `www.zimage.store`，完成检查后手动发布、不走GitHub CI。临时OSS中转、Windows固定HTTP验收、一次性自动回退已有明确授权；实际服务器操作由主会话协调。本分支未push/CI/上传/部署/改生产。
- 第二轮QA构建98.556秒成功；普通运行文件101,403,266字节，比基准155,934,878少54,531,612（34.97%）。业务24,811,988、runtime32,873,294、字体/public43,717,984；图像/字体原字节、许可、完整语法语言与安全能力保留。
- 真实三层冷/暖/回退目录已装配。含metadata未压缩业务24,955,607＋共享runtime33,180,123＋资源43,753,251＝101,888,981字节；gzip仅传输55,838,637。暖装配与可信同一QA清单重新装配均复用两层，987文件hardlink、无拷贝；不同代码回退由fixture覆盖，未恢复线上旧版。业务未移进runtime凑数。
- 最终Web887/887（119文件），Domain106/106（未改源码），原分层28/28＋三层20/20，真实额度保护5/5，lint/typecheck通过；原型独立审核无当前范围Critical/Important。冷与回退实际Next/HTTPS/static/Sharp/CJK各132项通过；CA/hostname/privateDNS拒绝保持。
- **仍in_progress的发布边界**：所有现有包为QA假Supabase＋test HTTPS域，productionReady:false，不能发布。两个认证API占位503未算真实401。等待5项公开生产变量、ECS共享cache路径和Node/ABI/glibc/libstdc++确认，才作规范.next的最终生产构建并输出新hash。真实公网/Nginx、服务UID、认证/业务、回退安全由正式发布验收；未用fixture替代。详见[最终验证报告（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-27-three-layer-validation.md)和[手动交接](../ops/aliyun/MANUAL-THREE-LAYER-RELEASE.md)。

## 2026-10-27 未压缩10MB继续瘦身（一次QA净减，整体未达标）

- 沿用隔离分支，完整分类/top20生成文件及模块、官方资料与引入链已记录。用户目标为10,000,000未压缩字节，保留所有功能/语言字体/画质/安全。显式默认关闭的`ZIMAGE_BUILD_SLIM=1` webpack候选清理原本禁用Markdown分支、SSR未执行Shiki实现及Next两个仅dev入口追踪，不做压缩/移层假达标。
- 唯一完整QA构建102.279秒成功、锁文件未变。业务42,545,964→**24,783,748字节**（-41.75%），全运行155,934,878→**101,375,026字节**（-34.99%）。服务端24,300,973→**9,971,306**，前端18,109,982→14,676,931，运行依赖69,670,930→32,873,294；字体/public原字节全部保留。整体仍超10MB，不宣称完成。
- 全套Web840/840、Domain106/106；末次测试补充后Markdown实际Python着色/复制3/3，SSR8样例字节相同，Node打包/预算/profile13/13、最新profile3/3、Python运维77/77，lint/typecheck通过。真实Next/static/Sharp/CJK33项通过；客户端260grammar/65theme/WASM内容与加载入口全留。认证两项503仍未验证，未付费生成、上传、CI或改生产；独立审查无当前版本P0/P1。
- 现有构建分层代码24,783,748+共享运行32,873,294+资源43,717,984=101,375,026，资源外置不改变总量。用户新增HTTPS版本化公共资源/共享本地字体原型继续在本分支推进；其配置需另作构建/真实域名验证，不能把本次QA冒充资源迁移验收。详见[完整报告（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-27-dist-10mb-audit.md)和[测量JSON（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-27-dist-10mb-analysis.json)。

## 2026-10-26 未压缩5MB约束（未达标，最小无损优化本地验证）

- 用户澄清约束的是未压缩完整业务产物，必须保留原始页面、生图/导出、语言字体、画质与安全。此前4MB是压缩传输，56MiB是解码峰值内存，均不能算dist达标；暂停编码探索，不通过迁移/拆层隐去依赖资源。
- 复用既有Next16.4.1/Sharp0.35.5匹配QA，未安装或重建。互斥原始文件业务45,297,593字节、全运行158,686,507字节。新增仅分离70份构建追踪清单2,751,629字节，原件/独立trace归档保留；业务降至**42,545,964字节（40.574993MiB）**，全运行**155,934,878字节（148.711088MiB）**。JS/CSS本身41,813,337字节；5,000,000字节目标尚未完成，不能靠打包参数保证。
- 新回归失败先行后通过，Node打包6/6、完整Python运维77/77通过；独立临时副本真实Next/静态/Sharp/中文字体33项通过，4287保留文件SHA与原索引一致。真实认证/付费生图仍未验证，两个认证接口占位RPC仍503，不放宽门禁，不宣称全功能验收完成。
- 原始源码/素材、旧10MB交付版及原产物保留。未push/Actions/上传/改生产/付费。现阶段可证预算业务50–60MB、全运行180–200MB；若坚持未压缩5MB，需要另定模块图/架构优化范围及验收，不擅自大重写。详见[未压缩测量与追踪清单优化（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-release-uncompressed-budget.md)。

## 2026-10-26 日常代码5MB可行性（本地编码原型，未启用部署）

- 基线`18ffbd3e`和既有当前版本QA构建保留，未重建/安装/裁剪语言或功能、未进一步拆出客户端JS/CSS。同一46,172,160字节代码tar经5种编码解码后SHA全部一致；XZ9归档3,799,552字节，含新索引/清单的本地格式候选**4,000,339字节（3.815021MiB）**。
- XZ9本机编码14.428秒、峰值521.71MiB，流式解码0.194秒、56.18MiB；64MiB字典，32MiB解码限额拒绝、96MiB通过。首次全部运行层仍64,084,474字节，独立debug另11,232,847字节。当前组装器主动拒绝候选schema2，生产helper仍仅gzip，未改默认10MB路径或发布协议。
- 931份JS静态分析识别语言/主题数据跨server/client重复，未以删除它们凑数。下一步最小边界是可选XZ编解码、目标能力/内存上限与组装回归；本轮只完成有数字和逐字节校验的可行性研究，原生产/CI均未触碰。详见[5MB研究（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-release-code-5mb-study.md)。

## 2026-10-26 当前版本瘦身QA（本地预算通过，未发布）

- 用户另行批准隔离环境按现有锁文件安装依赖；官方npm源frozen安装、生命周期脚本禁用，锁文件SHA保持`62b7a0a523438da5fad23d1a5be2926021ad566f6bde24d35ec2b1f425955d0c`。Next16.4.1/Sharp0.35.5单次webpack占位HTTP QA构建131.953秒通过，未读取生产密钥，buildId明确qa前缀。
- 当前webpack423个生成map共53,471,956原始字节，导致初次代码21,250,446字节超预算；map原件保留并独立调试归档，完整JS/CSS保留，代码gzip9后日常交付**9,977,498字节（9.515284MiB）**，含代码索引/release清单，余量22,502字节。首次全运行层70,061,633字节，独立debug归档11,232,847字节；完整运行tgz69,143,502字节，不混称10MB完整包。
- 本地组装与真实Next/静态/Sharp/中文字体33项通过，渲染器8/8、Node打包4/4、运维76/76通过；独立审查map目录边界已失败回归复现并修复。两项受保护API因占位RPC为503，保留为QA限制，不放宽生产401门禁；Sentry资料独立保留，未上传或声称在线符号化通过。
- 此为当前版本QA结果，不是原artifact或生产发布证明；未push/Actions/上传/迁移/Nginx/生产重启/发布，原工作区保持不变。目标主机兼容、真实构建配置、认证后台、调试归档私有留存/传输及发布仍待授权验证。详见[当前QA证据（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-release-slim-current-qa.md)。

## 2026-10-26 发布包瘦身（独立本地原型，正式体积待核验）

- 独立分支 `codex/release-slim-51cc0a9`，基线精确为 `51cc0a953c7582fe19663d8afc497cca9e8cfbf5`。仅从打包清单排除已核验的5张来源PNG，仓库原件、两份manifest及两版44张JPEG/WebP成品保留；精确清单与拒绝覆盖的Node回归3/3通过。
- 增加独立本地代码/依赖/静态/字体分层原型，日常代码预算包含服务端、`.next/static`、代码索引及release清单；未接入现有CI或生产部署。已有Next16.3/Sharp0.35.3/development旧样本日常8,822,577字节（8.413865MiB），首次全层60,616,131字节（57.808047MiB）；**不是当前16.4.1正式包达标证明**。正式artifact未取得且未重试被拒读取，内层tgz摘要未知。
- 本地运维75/75（含分层26项）、Node打包3/3通过。独立审查两项重要问题均以失败回归复现后修复：原型始终非生产且缺构建输出阻断；输入/输出重叠和存储子目录符号链接拒绝写入。非glibc指纹细分为后续边界，未宣称支持。
- 本轮未构建、安装、push/PR/Actions、上传、改Nginx、重启、发布或删除现有产物；匹配当前锁定依赖的正式测量、目标运行环境兼容及发布集成仍待验证。详见[瘦身原型证据（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-release-slim-prototype.md)和[本地使用边界](../ops/aliyun/LAYERS.md)。

## 2026-10-26 退役入口真实404与发布前HTTP回归（本地验证中）

- main `9993d2d` 的正常发布因 `/create/batch` 实际200、门禁预期404而失败回退，非本轮Actions额度错误；父Edge已确认原版8cbb708公网首页、ready和已有会话恢复。服务代理保留，root helper源码未改。
- 真实Next16.4.1 HTTP正式模式占位配置构建复现异步notFound流式软404：5种退役请求全200且GET有noindex。静态Route Handler明确404后5项全404，首页及有效场景仍200；新增实际standalone HTTP回归，打包前执行，不放宽404门禁。
- 公网验证增加安全底层错误分类和切换前原版公网预检，旧runner URLError内部原因仍未取得，不宣称已修复。正式HTTP占位配置及mock两次构建退出0、各HTTP7/7，运维49/49、lint/typecheck、预算5/5、独立复审通过；本轮全量本地测试Domain106/106、Web838/838（406.62秒）通过。
- 遵照节省额度要求，没有新push/CI/部署；占位QA构建不可发布。准备云开发环境构建、已授权控制台文件传输、原helper手动激活与严格检查/回退的方案，现有上传权限与临时OSS暂存同意待确认。不在2GB生产机全量构建，不新增网络/安全/凭据权限。详细证据见[HTTP复核（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-retired-route-http.md)。

## 2026-10-26 服务出口恢复与发布验证分离（代码待审安装/发布）

- 父Edge确认8cbb708的服务级代理修复08:49:33 UTC保留，首页、ready及已有登录工作台恢复；未改全机DNS/路由/Mihomo。服务器默认公网检查08:57仍6008ms超时、无HTTP响应，与应用/外部浏览器必须区分。
- 本地发布脚本改为服务器应用/严格TLS本机Nginx40项 + GitHub runner独立公网20路由和最多3项静态资源，任一失败仍回退精确原SHA；401需unauthorized JSON，真实依赖503不放宽。手动/失败恢复均补外部稳定接口及静态资源验证。独立审查发现的“恢复失败又选回被拒版本”已用真实symlink回归修复。
- 最终运维45/45（4.287s）、bash语法、diff检查通过，独立复审无新增问题；不重复未变化的Web全量，不把既有Web838 CI冒称新ops提交已远端验证。细节见[验证说明（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-release-validation-sources.md)。
- 生产保持8cbb708；本轮准备按正常草稿PR/CI交付，安装及部署未执行，远端门禁以最终PR SHA为准。安装新版root helper需管理员明确批准，固定SHA256 `28e4dad990be11ebcd3acc8d413b383a3c0f96ec0e20d9e91edf28d441a58d82`，仅替换 `/usr/local/sbin/zimage-release`、保留root:root0755和原备份；不重启Web、不读私密环境、不改sudoers/SSH/网络。激活前哈希预检不匹配即停止。新ops代码须正常PR/CI及新SHA产物，不能改标签复用旧包。

## 2026-10-26 访问诊断、公开首页导航与性能（本地完成，已获正常发布授权）

- 独立云会话/分支 `codex/home-performance-20261026`，基线与02:30 UTC重新查询main均为 `8cbb708645e93d3d71d17641b860cc60301fa005`。用户03:37 UTC明确授权原分支提交/推送/PR，经最终精确SHA的CI门禁后合并并用既有流水线发布；提交文档时远端步骤仍待完成。无独立生产重启/DNS/安全/数据库/Worker改动、付费模型调用；依赖按frozen lockfile同步，锁文件未改。
- 父实际查看用户原图，确认应用身份检查错误，非浏览器DNS/TLS页。父Edge真实同源 `/api/auth/session` 于03:10:00.820 UTC发起，15.009秒后被取消、无响应头/体，精确对应客户端15000ms截止；status0不是HTTP码，无服务器request ID。根文档已有HTTP200/31.114秒TTFB/31.750秒加载记录不是新测量。生产/home未取得HTTP状态。没有OOM证据，未把拆包当生产等待修复。
- 本环境代理CONNECT403与DNS失败不当作站点根因，拒绝后未绕过。最后main run #85与10/23两处38项成功仅是历史部署证据；Supabase健康元数据/后台RPC日志也不证明网站身份链路可达。仍需可用只读服务器通道围绕03:10前后约5分钟读已有日志/状态；未尝试SSH，/root/.ssh列举被OS拒绝后不再试。
- 最新用户要求已实现：明确guest回真实公开 `/home`，主动登录仍可进入/login/auth；错误/15秒超时不等同guest，不清有效Cookie。含糊账户401另查身份；身份RPC与账户资料服务的网络/未知错误保持503并拒绝访问；成功退出要求signedOut:true。公开首页首访不挂载身份provider，正式模式精确/home GET/HEAD服务端也不读认证配置、不刷新Cookie，其余路由/API/POST/旧匿名模式保留验证。
- 账户缓存展示风险已补守卫：guest/checking/error不显示旧账户字段/操作；guest回首页，authorized owner不匹配刷新SSR资料，不清新合法会话。独立审查三项风险（动作401、资料401、旧owner展示）均以失败先行回归修复。
- 性能：保留应用provider树跨首页状态；导航意图预取，助手富文本按需，认证未确认不预取编辑器。移动390px主列宽0的独立空白问题补flex:1，390/767/768/1024px与草稿/导航回归通过。设计、图片、动效、邮箱、短信禁用、计费/生成均保留。
- 最近性能快照（03:18构建、03:21采样；每档每路由3次；Chromium151，冷浏览器缓存；移动390×844/150ms RTT/1.6Mbps/4×CPU）：品牌桌面JS500816→224812bytes、FCP404→392ms、LCP752→532ms；移动JS488444→224812、FCP724→712、LCP776→768。空白工作区桌面JS1742393→633815，输入就绪1643→1741ms，LCP1264→1512；移动从空白恢复，输入就绪6551ms，LCP7088。完整计入link预加载，公开小幅时间波动与桌面取舍，不保证生产0.8秒。最后账户展示守卫随后追加并另测/构建，未冒称重新跑过全部性能；完整表/上下文见[报告（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-26-access-home-performance.md)。
- 完整导航/身份/公开代理版本：Domain12文件106项、Web115文件834项全过，Web429.31s/exit0。末次账户展示守卫后相关8文件51项（含新增4项）通过，按要求不重复无关全量，明确不将834冒称补丁后重跑。最终lint/typecheck/预算5项及两编译器构建通过；Webpack24.5s、Turbopack4.2s、48/48静态页（编译时间受缓存影响），既有ESLint Pages/Sentry建议未压制。
- 原始失败、日志、JSON、截图与临时脚本在 `/workspace/scratch/zimage-diagnostic/evidence/`，不入git；源码/测试/脱敏文档共34文件。基线next-env恢复，本次.next-build-qa清理，原.next保留。没有自动扩展生产修复；已授权正常发布，最终SHA、CI、部署、实际回退点与生产验证以远端终态为准。Actions存储90%警告期间不新增产物上传、不删除既有产物或改付费设置，若CI阻塞则报告。

## 2026-10-23 React Bits 整合（本地实现、自动化与桌面复核完成；数据库/真实环境待验）

- 本地分支 `codex/zimage-react-bits-integration-20261022`，基线 `a9a88959d8d9778dc7288a47fb2933a3162e39b7`；按已核验源 `4516d423803ab2923083610d75f2326c033984fe` 完成首页 `/home`、唯一工作区 `/`、五场景目录/表单/详情、会话资产 `/assets`、账户和邮箱认证界面整合；`/workspace` 重定向。真实网关、API、认证、权限、计费与生成保持，手机仅禁用占位。用户现已授权提交、推送该独立分支，并在发布门槛满足后按正常 PR 流程合并发布；本节本地证据保留，远端 CI 与生产结果将在取得后追加。映射和来源见[整合说明（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/plans/2026-10-22-react-bits-integration.md)。
- 最终依赖为 Next / eslint-config-next **16.4.1**、Sentry **10.75.2**、sharp **0.35.5**，React 19.2.7 保持。官方发布记录和 registry peers 确认兼容；不启用 Cache Components 或改业务架构。仅针对 fast-uri 3.1.6 → 3.1.8、brace-expansion 5.0.9 → 5.0.12 设置临时精确 overrides，lock 与实际依赖均核实；上游不再选择旧版本时移除 pin 并重审计。普通递归更新曾 exit 0 但未改变解析结果，原日志保留。安装默认目录 EROFS 后仅改用命令级可写 XDG 数据目录和项目 store，无全局配置或权限扩大。
- **完整自动化**：升级前、最终安全版本分别执行 `DEBUG_PRINT_LIMIT=100000 pnpm test:run --coverage`，均 exit 0；两轮各为 Domain **12 文件 / 106 测试**、Web **110 文件 / 796 测试**全过，Web 分别耗时 1760.72s / 1980.73s。最终 Web lines/statements **89.05%**、functions **71.61%**、branches **85.31%**；Domain **96.56% / 75% / 87.77%**，原覆盖率阈值全过且没有放宽等待条件。最终 lint / typecheck exit 0，预算 **5/5** / exit 0。主线程此前独立 Worker **80/80**、运维辅助 **20/20**、启动器 **3/3**，无后端变更。
- **历史失败保留**：源到位前首次标准全量 Web 787/788 / exit 1；电商入口重试未在原 10 秒窗口找到向导。原文件和基线定向复验均 4/4；本日两轮完整覆盖率也未复现，但根因仍未证实，不称已经定位修复。首轮日志、截断 DOM 限制和初始化/懒加载时序假设均保留于下方历史节。
- **生产依赖审计**：最终 `pnpm audit --prod --json` exit 1，**0 critical / 0 high / 0 moderate / 1 low**。未修复项为 KaTeX 0.16.47（GHSA-238p-pmpm-9mq7），Lobe UI → rehype-katex → katex 及 Lobe UI → remark-math → micromark-extension-math → katex（icons 亦引用同一 UI）。公告需结合已有原型污染触发；未验证实际可利用性，不称无风险。修复要求 >=0.18.2，跨 0.x 次版，需单独验证 Markdown/数学渲染兼容性后处理。升级前本日曾为 3 critical / 1 high / 1 low；该 JSON 和 10/22 更早计数保留为历史，不代表最终版本。
- `pnpm peers check` exit 1 的唯一报告是既有 @emoji-mart/react 1.1.1 仅声明 React 16/17/18；原始 HEAD lock 已有同一约束，React 19.2.7 未变。保留兼容性提示，不以宽泛 override 隐藏。
- **构建**：隔离 HTTP 标准 Turbopack `pnpm build` exit 0，编译 82s，48/48 静态页完成；无需密钥或虚假认证配置。新 Sentry 提示旧构建配置导入将在 v11 弃用，已仅改为受支持 `@sentry/nextjs/config`，其 lint / typecheck 再验 exit 0；按 CI 使用的 HTTP Webpack 路径 `pnpm --filter @zimage/web build --webpack` 复验 exit 0，编译 2.3min，48/48 静态页完成。均使用 `.next-build-qa`、单 CPU / 4 GiB heap；确认进程结束后清理产物，`next-env.d.ts` 逐字恢复。Sentry 全局错误页缺失建议与 ESLint 既有 Pages 目录提示保留，不压制或扩展错误处理架构。Next 16.4 生成器仅将 AGENTS 内自有规则标题由一级改为二级，按仓库要求保留生成块。编译不视作真实服务验收。
- **桌面证据**：10/22 系统 Chromium 1440×1000 检查 11 路由 HTTP 200 / 无 pageerror，9 个运行时页真正 ready 后无横溢出；1024×768 目录无横溢出且登录可滚到页脚，深色登录通过。本地 Mock 生成后资产页显示一张当前会话作品，无 `/api` 请求。10/23 最终依赖版本复核：`desktop-final/report.json` 11 路由均 200 / 无横溢出，pageerror、consoleErrors、blockedRequests 均为空；邮箱/手机切换保留草稿、注册/恢复入口、短信禁用通过，1024×768 登录右区 scrollTop 46 / clientHeight 678 / scrollHeight 724。另 `auth-routes.json` 的 `/auth`、`/auth/verify`、`/auth/reset` 3 路由全部 200 / 无页面或控制台错误 / 无外部或 API 请求；`account-loaded.json` 确认 Mock 网关余额读取完成后展示 10.00。主线程实际查看首页、工作区、目录、资产、登录/手机、账户及验证码/恢复截图，无新增布局问题；自有 dev 进程已停止 / exit 0。首次截图工具默认隐藏光标注入 `caret-color:transparent` 导致 hydration 属性提示，保留 `report-first.json` 和服务日志；仅将截图选项改为 caret initial、等待 hydration 后复验消失，无产品修改。账户补拍首轮定位器同时匹配余额与账本同值而失败，原 JSON 保留，限定余额 strong 后通过。没有恢复仓库 E2E 工程。开发模式对部分首屏示例图提示 eager/LCP 建议；已保留 sizes、按需加载和 intent 预取，但未运行 Lighthouse 或性能 benchmark，不声称量化性能达标。
- **未验收与边界**：数据库 CLI 在执行检查前尝试写 `/home/agent/.supabase`，EROFS / exit 1，数据库测试未执行；无扩权或数据库启动，不是自动审批拒绝。真实账号、Supabase/Storage、供应商生成、计费、短信和生产环境未验收；本地 Mock、单测和编译不替代这些证据。资产只展示所选会话已有生成记录，没有全局收藏/索引后端契约；完整电商结果和下载仍在原会话。剩余工作为远端数据库门禁与发布前条件核验、真实服务验收、KaTeX 兼容升级与首次超时根因后续定位。用户最新授权允许在门槛满足后发布，不能以授权代替验证。
- **发布准备（2026-10-23）**：已核对既有 `.github/workflows/ci.yml` 与阿里云不可变 release / 健康检查 / 自动回退流程；PR 先执行 quality 与 database，合并 main 后才进行 HTTP Webpack 生产构建与部署，不运行数据库迁移或 Worker 部署。远端 main 当前仍为基线 `a9a88959d8d9778dc7288a47fb2933a3162e39b7`；其 CI #82 成功。branch metadata 显示 `protected=false`，专用 protection 读取因 integration 权限 403、rulesets 因私有仓库套餐限制 403，未重试、改权限或绕过；仍以正常 PR 与两项 CI 成功为合并前置条件。现有 gh 环境 token 无效，GitHub connector 普通只读与 Git 远端查询成功，后续沿用这些正常通道，不创建凭据。交付清单 73 个源/样式/测试/许可证/文档/依赖文件，路径与内容扫描未发现秘密或输入 ZIP、部署身份、日志、截图、coverage、node_modules；原始证据仅在忽略目录。仓库没有 PR 预览部署 job，已有本地桌面 Mock 预览不能称为远端或真实服务预览。
- **远端交付与发布影响复核（2026-10-23）**：业务提交 `0e157ad8c17ee30b59e34540f6f96a77fe4f805f` 已推送至原独立分支，远端 head 逐字一致；[PR #19](https://github.com/zhYAO/Image-web/pull/19) 已创建，[首次 PR CI #83](https://github.com/zhYAO/Image-web/actions/runs/39896556453) 正在执行。该首次 SHA 的状态不替代后续提交门禁。KaTeX 当前展示路径额外核验：唯一 `AssistantMessageContent` 明确 `enableLatex=false` / `allowHtml=false`，已安装 Lobe remark/rehype hooks 据此不注册数学插件，流式/非流式一致；本轮未修改或打开该入口，不新增当前公告所需执行路径，但保留低危依赖与其他组合风险。最近成功 main [CI #82 deploy](https://github.com/zhYAO/Image-web/actions/runs/38519757005/job/115717909070) 2026-10-14 06:38 UTC 已验证 `a9a88959d8d9778dc7288a47fb2933a3162e39b7` 的回环/公网 ready 版本一致、account 401 与退役端点 410，main 完整 run 清单其后无 rollback/dispatch，记录为上次正常版本回退候选；不称今日实时读取了 current。当前执行环境直接生产 GET 遭环境代理 `Tunnel connection failed: 403 Forbidden`，未改 IP/代理/身份绕过，不能据此判定站点故障；本次生产状态需由正常发布流程核验后记录。
- **永久发布路由核验**：在既有 `ops/aliyun/verify-release.py` 追加 13 个匿名 GET（工作区、品牌首页、资产、目录/五场景、登录及邮箱认证/验证/恢复），保留拒绝跳转、ready 版本、no-store、account 401 和退役端点检查，不附带 Cookie/Authorization、不提交登录/上传/生成。原脚本先因漏检新路由而测试失败，再实施后完整运维辅助 **21/21** / exit 0；真实本地 HTTP 服务覆盖两处合计 38 项检查、新页面错误状态和意外跳转均失败，未发生产请求。原 root-owned release helper 不改。为覆盖激活后的新页面失败，既有 deploy job 在激活前通过受限 SSH 只读记录 current 的精确 40 位保留版本；读取或校验失败则不发布。`deployment-health.sh` 验证失败后仅在 current 仍为本次 SHA 时回退到记录的精确旧 SHA；同 SHA 重发不回退更老 previous；回退调用既有 helper 并用其原健康检查确认旧版，初始发布仍返回失败。新增 shell 边界测试先失败后通过，完整运维辅助现为 **29/29**，覆盖正常成功、精确回退、同 SHA、current 漂移、读取失败、回退失败和非法 SHA；Workflow YAML 与全部 run block / wrapper 的 bash 语法通过。无新 workflow、权限、凭据或服务器 helper 安装；最终远端质量/数据库与发布状态以 [PR #19 的当前 head checks](https://github.com/zhYAO/Image-web/pull/19/checks) 和后续 main 发布 run 为准，不能用旧 SHA 的结果替代。
- 日志目录 `.design-qa/2026-10-22-react-bits/`：`final-test-coverage.log`（升级前），`final-security-test-coverage.log`、`apps-web-coverage-final.json`、`packages-domain-coverage-final.json`、`final-security-lint.log`、`final-security-typecheck.log`、`final-security-budget.log`、`final-security-audit.json`、`final-security-peers.log`、`final-security-http-build.log`（Turbopack）、`final-security-http-webpack-build.log`（Webpack）、`final-config-lint.log`、`final-config-typecheck.log`（Sentry 入口调整后）。源传输与首轮失败历史证据不删除，历史真实验收目录保持。

## 2026-10-22 React Bits 界面整合（历史实施阶段；最终状态见 10/23）

- **该阶段更新**：用户授权独立输入分支后，主线程从 GitHub 提交 `178d651601861e2e40b9ec130e124ad23f691434` 正常提取源 ZIP，SHA-256、2,725,000 bytes、204 files 与 archive comment `4516d423803ab2923083610d75f2326c033984fe` 全部核验通过。未 merge 输入分支；下面 Git/Library/sediment 失败为保留的历史记录，不再阻塞源码读取。
- 已落地完整源首页 `/home`、唯一工作区 `/` 的视觉适配、五场景目录/真实配置与详情表面、会话生成记录资产页 `/assets`、真实账户两列布局及邮箱登录/验证/恢复视觉外壳；源 `/workspace` 仅重定向。没有导入演示会话、假验证码、假资产或源部署身份。手机号仍为不可提交占位。
- 资产页复用正式身份许可、现有会话列表和 `getTimeline` / `VisibleAsset`，每次只读取选中的当前账号会话；有列表加载/失败重试、时间线失败、空态、搜索、过期提示、owner 变更及迟到结果隔离。不存在全局索引/收藏契约，完整电商结果与下载继续在原会话处理。
- 本地桌面视觉复核已完成：系统 Chromium，1440×1000 下 11 路由 HTTP 200、无 pageerror，9 个运行时页等待实际 ready 后无水平溢出；1024×768 目录无横溢出，登录右区可滚到页脚；深色登录与减少动态样式复核。Mock 生成后资产页出现 1 张当前会话作品，检查期间无 `/api` 请求。已修轮播缺少标签/描述、手机标签悬停对比、服装刷新按钮、账户积分层次与示例图加载尺寸。证据目录 `.design-qa/2026-10-22-react-bits/desktop/`；这不替代真实账号、模型、收费、短信或移动端验收。原始脚本定位失败与修正版 JSON 都保留，未因检查脚本假设改产品。
- 源接入首轮检查：`pnpm typecheck` / `pnpm lint` exit 0；8 个定向测试文件 35/35，exit 0（44.70s），覆盖资产权限/范围与错误、邮箱/CAPTCHA/账户及导航。当时最终全量测试与 HTTP 构建待运行；桌面复核结果已记录在上一条，最终门禁以 10/23 节为准。
- 既有生产依赖审计最初为 3 critical / 8 high / 6 moderate / 2 low；兼容补丁更新 Next+eslint-config-next 16.3.8、sharp 0.35.5 后为 0 critical / 4 high / 2 moderate / 1 low（审计仍 exit 1）。当时 fast-uri/brace-expansion 兼容补丁尚待处理，后续 scoped 安装结果见 10/23 节；KaTeX 次版升级不纳入盲目覆盖。

### 源交付前的阶段记录（传输阻塞已解决，首轮失败证据保留）

- 基线：已获取最新 `origin/main`，SHA `a9a88959d8d9778dc7288a47fb2933a3162e39b7`；工作区起始干净，在 `/workspace/Image-web` 创建本地独立分支 `codex/zimage-react-bits-integration-20261022`。未修改 `clone-web`，未推送、合并或部署。
- 目标仓库审查与[页面/契约映射（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/plans/2026-10-22-react-bits-integration.md)已建立。保留现有 Next.js、唯一工作区、HTTP/Mock 网关、真实认证、会话、生图、私有资产及计费；不复制源部署身份或模拟后端。
- 源目标 SHA 为 `4516d423803ab2923083610d75f2326c033984fe`。普通 Git 读取因缺少认证失败，预览普通 HTTP 返回 403；后续正式 Library ZIP 的 `prepare_materialize` 返回授权 URL 但 `workspace_path=null`，消费端普通 GET 再次返回 HTTP 403 / curl exit 22，未取得 ZIP 字节。当时停止失败路线等待正式交付；文件摘要仅为预期值，尚未核验或移植。后续输入恢复与实施结果见上文。
- 用户已在本任务重新上传同名 ZIP（`file_00000000ed9482309263f5c4fc0b72c1`）；对新附件的一次受支持读取确认大小 2,725,000 bytes，但仍无本地路径，新 URL 普通 GET 同样 HTTP 403 / exit 22，未取得字节。当时无需用户再次上传，原路线停止等待；后续已通过授权 GitHub 输入分支解决，未重试旧票据或扩大权限。
- 已完成不依赖源视觉的手机号入口边界：邮箱登录/注册/找回/验证码继续原服务；手机号区域明确标注短信未接入，全部输入及按钮禁用，没有短信请求、演示认证或假会话，邮箱草稿在切换时保留。
- 本地独立阶段验证（2026-10-22）：手机号新增 2 项先失败再修复，与现有邮箱反馈/CAPTCHA 专项合计 22/22；追加隐藏表单提交与密码保留断言后手机号 2/2 复验通过。lint、typecheck、预算 5/5、隔离 Mock `pnpm build` 均 exit 0；构建目录 `.next-build-qa` 已在确认构建进程结束后清理，`next-env.d.ts` 已按原始字节恢复。主线程独立执行 Worker 80/80、运维辅助 20/20、开发启动器 3/3 通过。运行版本 Node 24.19.0 / pnpm 11.19.0。
- 完整 `pnpm test:run` exit 1：Domain 12 文件 / 106 项全部通过；Web 107 文件 / 788 项，787 通过、1 失败（1018.43 秒）。唯一失败为 `commerce-flow-regressions.test.tsx` 的 `keeps failed entry out of chat and retries the requested scene`，原 10 秒等待内未找到“商品套图向导”。相关业务代码、测试断言和超时均未改动，随后原文件全部 4 项定向复验 exit 0（原失败项 6.503 秒，整轮 38.92 秒）。未能稳定复现，尚未证明具体根因；不把跨轮复验称为单次全量全绿，不为过门禁修改业务或放宽断言。日志见 `.design-qa/2026-10-22-react-bits/`。
- 失败诊断与主分支对照：重试依次经过会话初始化、时间线读取、`CommerceWorkspace` 和 `React.lazy` 的 `CommerceWizard`，该用例是文件第一项，原测试已有独立 chunk 等待。上述业务文件、fixture 与测试均与基线逐文件无差异；本轮 AuthPanel/全局 CSS 不在该测试组件导入链。临时 detached 基线工作树用既有 Vitest 直接执行原文件 4/4 / exit 0（该项 9.245 秒，整轮 43.73 秒），之后移除临时工作树。最初基线 pnpm 命令因自动依赖检查尝试写 `/home/agent/.local/share/pnpm` 失败（exit 1，内层 install 254），未运行测试，单独保留日志；未改依赖或锁文件。冷加载/运行时序是待验证假设，首轮错误 DOM 被默认截断，不能判定卡在初始化还是 Suspense；尚未定位根因，不将对照通过作为“无问题”证明。
- 数据库未验收：本地 Supabase status 在查询前尝试写 `/home/agent/.supabase`，因 EROFS 失败；未启动数据库或扩大权限。该阶段没有真实短信、账号、模型、生产 Storage、生产部署或完整源视觉验收证据。
- 该早期阶段仅本地保留改动，独立审查无新增阻断项；当时未验覆盖率、数据库、桌面浏览器及真实环境，移植因输入未到位而暂停。输入恢复后已在同分支继续，当前结果见 10/23 节。

## 2026-10-13 普通生图预览延迟修复（独立草稿，未发布）

- 发布基线：PR #9 已按用户授权合并发布，main 与线上版本为 `4659d8aeccde752b8d96c06e784082e481204ad1`，发布流水线 #63 成功。本轮从该版本隔离为 `codex/direct-preview-delay-fix-20261013`；不包含 PR #10/#11 的服装优化或 Cron 归档改动。
- 本地复现：使用实际 `WorkspaceTimeline`、原工作区 CSS、原生 Chromium IntersectionObserver 和合成图片。完成时图片框仍有约 175px 位于滚动视口内，但旧内部观察点高度为 0、顶部已被裁切，因此签名请求为 0、图片未挂载；移到顶部后才出现。改为观察保留比例和尺寸的外层图片框后，同一位置首次完成即发起一次 URL 查询并显示图片，继续滚动没有新增查询。该机制与生产延迟现象一致，不能据此排除其他生产因素。
- 实现：共享生成卡片观察有尺寸的图片框；签名失败显示可单独重试的预览状态。隐藏页和离开视口期间不应用未完成结果；返回后复用现有网关缓存。账号/会话切换清理旧预览范围，过期观察回调和异步结果不会写入新范围；图片错误自动刷新每个范围最多一次。签名接口、鉴权、缓存、生成、结算和下载契约保持兼容。
- 本地验收完成（2026-10-13）：新增 9 项生命周期回归；旧实现的几何观察、预览重试、隐藏页/离开视口取消和范围隔离先失败，最终专项 44/44、单次完整 Domain 76/76、Web 672/672、Worker 80/80、预算保护 5/5、发布辅助测试 20/20、lint、typecheck 均通过。隔离 Mock Webpack 构建通过，使用 `.next-build-qa`、单 CPU 和 4GiB heap，生成的 `next-env.d.ts` 已还原。独立只读审查无可操作的 Critical/Important/Minor。分支完整 SHA 的覆盖率和数据库 CI 终态以此变更草稿 PR 的检查记录为准；本地验收完成不表示生产已修复。
- 边界：本轮无模型调用、生产 Storage 下载、Supabase 数据修改、迁移、调度或发布。保留 PR #10/#11 的独立状态及默认关闭的优化开关。原始诊断、日志和临时浏览器验证仅保存在工作区外和 Library，不进入 git；生产修复后复测仍需另行发布授权。

以下为此前发布与验收的历史快照；当前交付及阻碍以上述最新节为准。

## 2026-10-12 上传400兼容修复与首页三张分组轮播（独立分支，未发布）

- 最新生产与远程main均为 `1a3eba2891ff0c659a530eed01bcdde67e4f9ea6`。本轮独立分支 `codex/uploads-carousel-fix-20261012`，仅授权提交和推送代码；未合并、部署或触发生图。旧证据分支与原checkout改动保留。生产Worker v25的固定Plan地址、安全准入和旧批量退役保护均未回退。
- 用户原始报错位于 `/create/product-set` 点击“一键生成”。代码确认“保存草稿”与“一键生成”先执行同一个 `preparePlan()`、同一会话及参考图multipart上传；保存草稿为 `save(false)`，不会进入 `submitCommerceOnce()`。共享HTTP客户端仅给字符串JSON正文设置Content-Type，FormData保留浏览器自动boundary。
- 主会话已登录dot云浏览器于14:02:42.291 UTC对公开虚构WebP（175908字节、1024×1024）执行一次保存草稿，14:02:53成功。会话 `c465f554-1065-432b-b915-af05e170001f`，任务 `cd4d5c5d-d937-4760-a18d-5e000b3ef067`，v1待确认。脱敏Supabase日志确认会话及参考元数据201、Storage200、写入意图和方案RPC200；只读数据库确认参考active/ready，runs=0、generations=0、creditOperations=0。
- 用户随后提供原始400 JSON：`bad_request`、`details.field=file`，correlation ID `d688c7ad-bc04-4465-9b4d-6fb436445a61`，message为“仅支持内容与扩展名一致的 PNG、JPEG 或 WebP 图片。”主会话于14:55:13.466–14:57:07 UTC用用户原文件保存草稿重现同一错误。Library文件 `libfile_462dbd10920481919a94fe6d369f9df9` 的权威文件名为 `微信图片_20260831201450_3011_4.jpg`，MIME为PNG、2484415字节、1536×2048；主会话已完整解码为RGBA PNG。对应严格服务端校验在Storage或模型调用前拒绝PNG内容与JPG文件名/类型不一致。
- 当前执行环境官方Library材料化失败，未取得用户原图字节，不能宣称本容器已独立逐字节验证该原图，也不能证明上传到Library前文件名/编码未被转换。停止重复下载；此处原图解码和原失败来自主会话证据，本地修复回归使用明确标记的独立合成图片。
- 用户明确要求可读图片由应用处理，不需手动校验编码、重命名或改MIME。共享HTTP上传先检测PNG/JPEG/WebP内容并用浏览器完整解码，再创建仅修正上传文件名和MIME的副本；原始字节、EXIF和透明度不重编码。普通创建图片与电商/服装共享上传复用适配；后端所有权、大小、尺寸、静态图片和内容一致性校验保持原样，SVG、未知及损坏图片不能靠改名通过。服装照片必须JPEG、Logo必须透明PNG的既有排版规则仍保留。
- 电商与工作区选图入口不再把缺失/不支持的声明MIME直接当作不可读图片：对这类文件进行内容准备并补充参考元数据，保留原File/name及角色键。准备期间只禁用当前账号、会话和路由的提交；切换范围后旧解码不能附图、禁用新编辑器或修改新范围计数。两项并发边界均先RED后修复，独立最终静态复核无剩余Critical/Important。
- 首页五张卡片桌面按1–3、4–5不重叠分组，尾组保留两张，每六秒自动回到下一组；移除箭头、播放/暂停及卡片箭头。窄窗口单卡可访问全部五项，保留键盘Home/End/左右、横向手势，悬停/焦点/触摸/隐藏页暂停，减少动态偏好关闭自动播放。独立审查发现竖向触摸时过早恢复播放，补充先失败回归后修复；最终无剩余Critical/Important/Minor。
- 轮播提交 `69b6784fecd70719ceed2fcfba3fcd5204b687c8` 的完整单次Domain76/76、Web646/646、Worker80/80、预算5/5、lint、typecheck与构建通过；PR #9 的CI #56成功，生产构建/部署/回滚均跳过。此旧CI不替代新增上传代码的验证。
- 上传修复最终专项48/48、Worker80/80、预算5/5、lint、typecheck、运维20/20与标准构建通过；最终单次全量及新提交完整SHA的quality/database终态详见PR #9和本节保持身份的Library总报告，新CI通过前不得合并。曾有测试环境缺少URL API造成一项测试失败，修正测试桩后通过；迭代中为修复实际并发问题取消的全量不计通过，不修改检查门槛。
- 本地Chromium 151实际调用应用适配函数的8项验证全部通过：PNG/JPEG/WebP错误后缀、缺失MIME、Image兼容路径以及SVG/损坏拒绝。正常输出64×48，上传前后字节逐个一致并保留SHA256；仅有本地验证页和Blob访问，没有上传或模型请求。验证页Library `libfile_777f93658020819195143819e76d20ba` 可供主会话选择用户原图检查；该结果不等同生产HTTP上传/Storage或Plan质量验收。
- 本地桌面Chromium实看首组三张、尾组两张、无按钮、悬停与焦点暂停、减少动态、窄窗五项可达；无横向溢出，共七张截图，明确为mock前端预览，不代表真实模型质量或生产新UI。首组Library `libfile_05642112137c81919bcb5590a08b0612`，尾组 `libfile_a699fb16380481918e8cfb5a4983defe`，窄窗最后卡 `libfile_0a6e74369bf48191b6545c268f8d7597`。
- 合并与发布仍需这轮新批准；独立PR为 https://github.com/zhYAO/Image-web/pull/9 。最新SHA的CI及脱敏验证总报告按原Library身份 `libfile_bac0ef3ceeb8819180a5f110f6ffe25d` 更新。原用户图片的修复后生产上传仍待新代码发布后验证，Plan原图质量仍未获得，不因本次上传/轮播回归而判定合格。

以下为此前发布与验收的历史快照；当前交付及阻碍以上述最新节为准。

## 2026-10-12 今日完整生产整合与 Plan 故障定位（发布准备中）

- 用户明确授权今日剩余的液态玻璃、首页轮播、服装滚动和新版示例图发布生产。单一生产负责人在 `/workspace/Image-web-plan-diagnostic` 的 `codex/production-complete-20261012`，以已发布 main `b2cca96ea59bf53cecab9394a4508ba30dc7e8fa` 保留 Plan 接入，加入安全诊断 `0a8af926731a3787de1273393e57f53c4115ee44`、固定 Plan 地址修复 `99a4ccf`，整合已验收源分支 `5f4ae315c415c8832e2ceaf5c48e467c4d093335`。原 checkout 和 clone-web 改动保留。
- 已发布的 Plan 前端与 canonical 迁移 `20261012024930` 由 main CI #51 成功发布，生产迁移共 36 项；本轮不重复应用迁移，不改旧任务、价格、权限或调度。新整合 UI 的相关验证、CI、完整构建及部署结果尚待本轮取得。
- 真实 EC01 只提交一次：任务 `087af1c7-c6e0-492f-80b9-22861c869c4c`，生成 `d53fe146-fe08-4b5e-a1f2-9ce4d96314ef` 于 `2026-10-12T10:27:01.126075Z` 失败，not_submitted、没有供应商请求ID和原图。预占30 minor已全额释放，capture为0；其余三例未提交。5次是既有队列准备尝试，不是付费供应商重试。
- 首次只读运行时探针在10:53:00.800 UTC确认 provider_configuration / invalid_endpoint，尚未Storage下载，调用模型为0。不读取或输出配置值。修复只让新Plan模型始终使用官方完整Plan地址及独立必需Key；历史模型路由、重试和结算不变。两项回归先红后绿，Worker全80/80及定向TypeScript通过，独立审查无Critical/Important。
- 11:02:01.782 UTC，用户单独授权的零模型只读复验返回prepared，首例一张现有参考图成功下载并编码，当前准备阶段通过。临时探针已移除，稳定Worker v25 ACTIVE，五份运行/config逐字核对为固定地址修复，bundle SHA256 `c0ac485f62b1f59056a8def906f4682807338f9e257145393827a989bdb1b238`。自动审批曾拒绝未单独授权的重复临时探针，该拒绝未绕过，之后才取得明确一次验证授权。没有自动重新生成或改写已退款首例；实际模型认证、响应及输出仍未验证。
- 完整整合本地检查进行中：lint、typecheck、Domain76/76、Worker80/80、预算5/5、运维20/20已通过，Web全量及标准Mock构建待结束。生产PR #8保留全部已批准UI源码与样图，并以现有CI覆盖率/数据库/构建门禁后正常main发布；本轮没有新增迁移。临时运行时探针源码不在发布分支。
- 全轮图片质量仍未测到：暂无Seedream原图，不能以UI、Mock、单测或image_gen示例判断模型质量合格。普通首页创建图片实际走 `/api/image` source=direct；`/api/chat` chat_tool未测。测试使用同一AI参考，六颗可见门襟与两颗袋盖纽扣，只评图间一致性，不声称真实商品保真。原输入包Library `libfile_0224a18212648191afcc88eb99c07008`；首例原始提示、失败与退款证据Library `libfile_fc53c9c25a7481918cb98df3e1a78ec5`。

以下为此前独立分支的历史验收记录；生产是否发布及本轮故障以本节最新证据为准。

## 2026-10-12 服装示例审美迭代 v2（本地验收完成，真实 Plan 仍未测）

- 基线 `2dbdd059b930d5b61678594fda1b74e35b932de0`，继续同一 `codex/apparel-scroll-seedream5-20261012`；仅更新示例图片及路径。保留 v1、固定排版器、玻璃/滚动、输入和生成配置，不合并 main、不部署。
- 按用户要求用成年东亚模特、米白衬衫、垂感宽腿裤、小金耳饰、自然窗光和柔光影棚改善穿搭审美；分别生成四张 1024×1536 单图，主图等比缩小、面料近景 829×845 裁切到 790×741，不用拼图低像素放大。水印缩成 `ORIGINAL AI · 原创示例`。首图和坐姿初稿各少一颗门襟纽扣，经正式 image_gen 最小修正后均可见 7+2 纽扣；仍有细微衣袋轮廓/织纹变化，不声称真实商品保真。
- 新资源 `/commerce/apparel-v2/`：4 张原始 PNG、11 张 JPEG、11 张 WebP、联系表和完整来源/提示词/摘要。逐张像素检查及独立代码/资源审查通过；桌面浅深主题、1440×900/600、720×900 的 11 图、末图滚动、原图 750×1000 预览和空表单通过。lint、构建、预算 5/5 通过，首轮 typecheck 读到 Next 生成文件临时语法错误，顺序复验通过；本轮全量 Domain 10 文件 / 76 测试、Web 94 文件 / 643 测试单次通过，0 失败，Web 耗时 936.04 秒。初轮日志与最终复验均保留，自有预览服务已停止。
- Library 单文件联系表正式保存成功：`libfile_d19dd5ee6bc48191a4d2c80de3da88c5`，`/lookbook-contact-sheet.webp`。主会话需通过 Library 在自己的环境下载并实际查看像素，不能使用本容器路径代替传输。
- 用户确认 Supabase 配置已添加；只读复核 image-web / `klmiycyesxnpinxpeqep` 正常，线上 Worker 现在 v18，五份源码与初检 v16 完全相同，仍不读取新 Plan Key/模型。当前工具无 Secret 名称清单能力，变量存在性仅按用户确认记录，未读取/回显/复制/移动密钥值。添加配置不等于四张调用批准；真实电商/聊天仍未测。最小不影响生产的完整实测需另行批准四张已有套餐额度，以及兼容该分支的隔离测试环境；没有部署授权，不能擅自准备远程 Worker/迁移。见 [v2 样图及交接报告（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-12-apparel-lookbook-v2.md)。

## 2026-10-12 服装示例补齐与质量测试准备（本地验收完成，真实 Plan 未测）

- 沿用 `codex/apparel-scroll-seedream5-20261012`，精确基线 `dbceba77a71281b11f05a2036f0f8b17a94536bc`；保护此前滚动、玻璃和轮播改动。`clone-web` 仅阅读。未合并 main、部署、应用生产迁移或配置密钥。
- 使用正式 image_gen 生成原创 AI 米白女装照片，以现有 AI 衬衫为外观参考，再运行未经修改的服装排版器，得到 5 张 750×1000 JPEG 主图及 6 个 790px 详情模块。服装空预览补齐 11 张 WebP 缩略图，点击检查原始 JPEG，目录封面同步更新；虚构成分、尺码及文案明确为示例，不自动进入用户资料或引用。
- 本轮 lint、typecheck、标准 Mock 构建及 git diff 检查通过；预算保护 5/5，全量 Domain 76/76、Web 643/643 单次通过。新增表单不采用示例资料的回归先红后绿，服装工作区 6/6。Desktop Chromium 151 实际检查 1440×900/600、720×900 和深色桌面：11 图全部加载、末图可达、无横向溢出，保持既有宽屏双栏/窄窗口单区滚动；原图预览 750×1000，表单为空。浏览器仅有既有 favicon 404，lint 有既有 pages 检测提示。
- 排版示例展示合格；面料放大存在源分辨率柔化，AI 照片间衣袋/纽扣细节不能用于真实商品保真。其他 image_gen 工具和 Mock 输出不计入项目 Seedream 验收。电商和聊天两条 Plan 真实路径均未测，不能判定合格。
- 本地无 Plan/Supabase/账号安全配置。只读已连接项目 `klmiycyesxnpinxpeqep`：线上 generation-worker v16 不含新 Plan Key/模型分支，生产未应用 `20261012024930` 准入迁移；未读取 Secret 值。用户选在 Supabase 私有变量安全填写，但单设 Secret 不更新代码、数据库或本地 Next.js，当前禁止部署条件下仍无可执行的该分支端到端路径。
- 四张实测方案为电商白底/模特/中文细节各一张、普通聊天一张，指定 Plan Pro 和完整 Plan URL。项目静态报价 120 minor / 1.20 积分，供应商现有 Plan 实际额度未知；主会话确认卡尚待批准，限制仅现有套餐额度、不充值/额外按量/自动重试。安全交接与逐张示例结论见 [质量报告（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-12-apparel-examples-quality.md)、[安全配置交接（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-12-plan-safe-test-handoff.md)。
- Library 样图传输受环境连接阻碍，三项均 `transfer_failed`，无 finalize 或 Library ID，不宣称保存成功，不规避代理/网络策略。原图与资源来源摘要已保留；全部排版 JPEG 在该开发分支的 `apps/web/public/commerce/apparel-v1/`，报告与证据包可供继续安全交付。

## 2026-10-12 分层玻璃、浅深主题与首页轮播（本地验收完成，仅开发分支交付）

- 用户确认“分层精致”并授权开始改动。沿用 `codex/apparel-scroll-seedream5-20261012`，基线 `f35fe5b9cdb4a950fd1e6eb9e74392d927665d48`；本轮只提交推送该分支，不合并 main、发布网站/Worker 或应用生产迁移。此前服装滚动与 Seedream Plan 逻辑保留。
- 重写根 `DESIGN.md`，统一语义色、导航/短浮层/实色内容的材质层次及降级规则。导航局部背景折射借鉴本地 OpenDesign 的 `enhanceHeader` / `#nav-liquid-glass`，明确归因 Inspira UI，非 Apple 官方实现；参考仓库未修改。仅导航使用轻量本地 SVG，尺寸变化防抖 140ms，不引入依赖、全屏滤镜或每帧渲染。
- 浅深主题跟随系统偏好，CSS、AntD、Lobe 使用协调后的语义与相同派生算法；首绘主题属性脚本配合 SSR 组件别名。修正深色数字输入、说明文字、主按钮前景及禁用控件。真实 Provider 专项断言实际派生值相等；独立零脚本 SSR 样本复核 Button/Text/Disabled/Input/Select 及主按钮 hover/active。首页工作区本身是客户端渲染，不能据首页截图宣称全部业务页面 SSR 已验收。
- 五个场景链接稳定挂载；桌面三张、窄窗一张，每次移动一张，首尾停靠。默认手动，显式播放每 6 秒前进且末端停止；悬停、卡片聚焦、拖动、隐藏标签页暂停。补齐 React 提交后的焦点回返、指针离开/取消、键盘点击、窗口变化及减少动态效果回归。
- 最终全量单次通过 Domain **76/76（10 文件）**、Web **642/642（94 文件）**；新增/调整主题、材质、轮播专项 **17/17**，预算保护 **5/5**、lint、typecheck、`git diff --check` 通过。早期焦点断言失败及 Lobe/AntD 派生色不一致曾先 RED，修复后 GREEN，未将早期失败算作通过；eslint 既有 Pages 目录提示保留，进程退出 0。
- 标准 Next.js 16.3 **Turbopack Mock 构建通过**，45 个页面完成预渲染。隔离副本逐字节核对 **505 个源码文件**，复制既有依赖且所有依赖链接留在副本中；没有安装依赖或更改构建配置。仅使用命令级 Mock/禁用自动安装配置，构建缓存退出后按指导清理。
- 实际 Chromium 151 Desktop Mock：浅深首页、720px 单卡、减少动态/透明度与强制颜色、模型弹层、共享目录五入口及场景导航通过；下一张轨道 -292px、上一张回 0、拖动 140px 时轨道跟随 -140px 后吸附 -292px，卡片无整组淡出或卸载，播放末端停止。服装页 1440×900/720/600 左右独立滚动，1100×900、720×900、600×720 单区滚动；末尾输入/30 张合成预览可达，操作条不移位、外层不滚动且无横向溢出。没有提交真实生成，合成夹具不改变积分。
- 独立只读复审最终 **Critical 0 / Important 0 / Minor 0**；浅深组件派生值、SSR、原生按钮、数量字段、焦点/指针与高对比降级均完成复验。只覆盖本地 Mock/桌面窗口模拟，未覆盖生产 Auth/Storage、Safari/Firefox、真实触摸/触控板、原生 200% 缩放或 GPU 性能。
- 浅深首页最终截图保留在 `/workspace/scratch/ZImage-liquid-glass-implementation-20261012/`。Library 官方上传助手在 `tools/list` 阶段两次报 `network`，未进入创建；按用户补充指令改用运行时直接暴露的单文件保存动作，两张均返回 succeeded 并完成本地版本元数据写回。浅色 **`libfile_5c5f919f59b881919e73151c2488e12c`**，深色 **`libfile_a82b646499308191907da7c5a6f2c602`**；未改认证/网络配置或换用外部服务，原失败日志保留。
- 推送前读取远程分支仍为原基线，现有唯一 CI 的 push 仅匹配 `setup2`/`main`，生产构建限定 main 且非 PR；无活动 Git hook。验收记录见 [本轮 QA（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/doc/qa/2026-10-12-liquid-glass.md)。临时 Next/CDP 已停止，日志和失败记录保留；原工作树、历史真实验收证据及 clone-web 未修改。

## 2026-10-12 服装滚动与 Seedream Plan（本地验收完成，仅开发分支提交）

- 用户明确本轮先不上线，仅提交代码。以最新远程 main `e4fbb37c91bf3569d3812ac3d9c1327430feeb53` 为基线，在独立分支 `codex/apparel-scroll-seedream5-20261012` 实现；原工作树、上轮交付、历史价格和真实记录保留。未合并 main、发布网站/Worker、应用生产迁移或配置生产 Secrets。
- 真实复现服装页左侧滚动：1440×900/720/600 下表单被内容撑到约 1485px，自身 `overflow-y:visible`，外层隐藏溢出，滚轮不能到达下半部分。修复剩余 flex 高度和 grid/panel 最小尺寸，桌面左右独立滚动，既有窄屏断点统一滚动；把既有修改提示移到 sticky 操作区之前，末尾按钮位移从 31.64px 降为容差内 0.453px。
- 桌面 Chromium Mock 实验通过 3 种桌面高度、6 种窄窗口、连续小 delta、左右独立滚动及图片/积分弹层开关；最后输入和结果可达，外层不跟随滚动，积分不变。仅为桌面窗口缩放和模拟连续滚轮，不声称真实手机/触控板硬件、生产账号或私有 Storage 验收。临时 Next/CDP 已释放；证据在 `/workspace/scratch/Image-web-apparel-seedream-20261012/browser/`。
- 按用户选择保留 Plan，精确模型 `doubao-seedream-5.0-pro` 已由火山官方 Ark CLI 默认资源文档核实。新图片 UI、默认值和服务端/SQL 新保存提交仅此模型；聊天保留独立原契约。沿用 2K、五种比例、30 minor/张，新注册/价格目录 `2026-10-12.1`。旧草稿须显式更新并保存新版本；既有 direct、聊天生图和电商原请求恢复保持旧模型、注册版本、hash、批次及助手回执，不重复预占、扣费或调用。
- Plan 的新持久模型身份、独立 `ZIMAGE_SEEDREAM_PLAN_API_KEY` 与可选 `ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT` 区分旧队列。完整 Plan 端点直接使用，Base URL 仅补一次后缀；错误源、按量路径、凭据或重复后缀拒绝，不借用旧 Key、不回退到按量。旧 Seedream 4.5/Flash/Pro 与 Gemini 仅保留已排队执行映射和历史结算。空值示例与未来安全填写位置见 [配置交接](seedream-plan-handoff.md)，本轮不要求填写密钥。
- 最终固定源码全量单次验收：Domain **76/76（10 文件）**、Web **631/631（91 文件）**，使用命令级 `--maxWorkers=2`，仓库/CI 默认未改；Worker **70/70**、运维辅助 **20/20**、预算保护 **5/5**、lint、typecheck 与 `git diff --check` 通过。初始化 pnpm 依赖自检试图自动 install 并失败，之后仅命令级禁止自动 install，沿用现有依赖；满盘及并行修改期间的早期不完整测试不作为通过证据。旧聊天恢复和新准入专项先 RED 后 GREEN。
- 新迁移 `20261012024930_seedream_plan_only_image_admission.sql` 仅在自有 network-none 隔离库验证：29 SQL 文件/1005 TAP 为 **1001 pass + 4 明确 legacy fixture skip，0 fail**，所有进程退出 0；相同最新四条另用历史 fixture 验证 **4/4**，不冒充新的可靠性迁移前升级。新准入专项 **67/67**，真实旧 RPC 形成的 16 类记录迁移前后完全一致、补验 **16/16**；旧验收库摘要不变，原后台进程恢复。现有 service-only/空 search_path 权限保留，隔离 security advisors 无 WARN/ERROR。未连接生产数据库执行写入。
- 标准 Next.js 16.3 Turbopack Mock 构建通过。为核验云环境跨目录依赖链接，在临时隔离副本中逐字节核对 500 个源码文件、复制已有依赖并只在副本重定位链接；运行时源码摘要未变，没有安装依赖或修改项目构建配置。原链接失败日志和最终成功记录均保留在 `/tmp/zimage-apparel-seedream-20261012-final-qa/`，没有将环境失败隐瞒为项目通过。
- 独立全轮只读审查最终 Critical 0 / Important 0 / Minor 0；早期旧聊天生图恢复与 SQL 升级提示问题已补回归修复。新增行密钥模式扫描无命中；没有读取聊天新 Key、真实环境文件或进行付费生成。真实 Plan 账户能力/响应、生产迁移与上线仍未执行，本地构造/Mock/SQL 不能代替这些验收。
- 已核实唯一工作流 push 仅匹配 `setup2`/`main`，部署需 main 且非 PR；本轮 codex 开发分支推送不会触发该工作流。没有活动 Git 推送 hook，不改工作流，不合并或触发生产发布。

## 2026-10-10 可靠性、安全修复与专用批量创作退役（功能版本已激活，发布门禁修复）

- 在新的 Codex 云任务工作区以远程 `fef6089603e4397b45481cf7ea3fe95d6ed36450` 为基线实现；父对话原 dot 云电脑及原工作树保留。用户已确认暂停尚未提交的存量批次条目，并明确授权整批提交、发布及本轮三项生产权限收紧。
- 移除专用批量页面、目录入口、创建/推进及独占 Worker；三条旧 POST 返回 `410/no-store`。只读历史页保留子任务、生成进度及下载，精确匹配原 task/request run，显示未提交暂停和已提交图片失败数。保留普通创作、商品套图/复刻 20 张、高级 A+ 32 张及共享生成、清理、审计和积分结算；未知结果继续持款待人工核对。
- F1–F3：可信 commerce 报价与 position 支持 32 个独立单图，保留通用请求、价格与日配额；文本领取前 history 失败仅取消未领取预占；已确认图片拒绝先持久记录，再同事务完成审计/失败/退款，租约恢复只结算而不再调用供应商。F4–F6：历史、签名和子表读取校验活跃父会话与所有权，撤销客户端直接批次 SELECT；未知结果健康样本按 generation 单次记录且不回填旧未知。F7–F8：服装下载断流映射固定错误，历史部分/空 ZIP 附中文缺项说明；CI 包含全部生成及清理 Worker 回归。
- 最终完整本地运行：Domain 69/69（9 文件）、Web 610/610（88 文件）；Web 覆盖率语句/行 88.94%、分支 85.04%、函数 73.51%，原门槛保留。最终 lint、typecheck、预算保护 5/5、Worker 48/48、部署辅助与只读核验原 18/18 通过。标准 Turbopack 构建曾受依赖跨工作树 symlink 限制失败，既有生产 Webpack 构建通过；隔离构建缓存已清理，next-env 未改。随后 PR #5 的 [CI #47](https://github.com/zhYAO/Image-web/actions/runs/38043770658) 和 main CI #48 均通过标准构建及完整覆盖率；CI Web 610/610，覆盖率语句/行 89.04%、分支 85.07%、函数 73.48%，与本地记录分开保留。原失败日志保留。
- 隔离真实 PostgreSQL：六项迁移按序成功，最终全库 28 文件的 938 个 TAP 条目为 934 通过、4 legacy fixture 跳过，每项进程退出 0 并回滚；另以真实升级前 15 份迁移、原 fixture、20 份升级迁移完成 legacy 4/4 零跳过。额外跨连接积分竞争 70/70、批量退役后结算 119/119、Cron 保留 6/6；官方固定类型生成与仓库逐字节一致。成功只 capture 一次、明确拒绝只 release 一次；未知结果保留冻结，无自动重购，隔离测试不代表生产任务已结清。
- 桌面 Chromium Mock 实际检查目录、退役旧地址/POST、20/20/32 张草稿、历史暂停/精确投影/失败计数/结果链接与有效 PNG 下载，以及普通聊天、生图和服装表单；没有提交生成，批次与积分前后不变。真实 Auth、生产 Storage 和供应商付费端到端验收未执行。
- 生产发布前快照：原 29 个迁移、generation-worker v15、cleanup-worker v17，两个共享及专用 Cron 启用；活跃生成/批次租约与 pending 均 0。原有 3 条未知 journal、2 笔 needs_review 操作共 60 minor 保留匿名指纹，不能据此报告已结算。
- 实际后台发布：只停止专用批次 Cron，generation_enabled 从未关闭，两个共享 Cron 保持 active。按序应用 `20261010085155`、`20261010100000`、`20261010100100`、`20261010100150`、`20261010100200`、`20261010100300`，canonical 记录共 35 条，旧 29 条保留。generation-worker v16 ACTIVE，返回的五份运行/config 文件与提交逐字一致，六文件 payload 包含 deno.lock；cleanup-worker v17 metadata 未变。生产函数定义、active owner 策略、私有 helper/receipt 权限与隔离验收一致；旧 unknown 未回填，三条未知和两笔待核查操作的逐记录匿名指纹及 60 minor 总额未变。
- PR #5 已合并为 `33046418eb2af173386a524fbeafb0aade530aa4`。[main CI #48](https://github.com/zhYAO/Image-web/actions/runs/38045019538) quality、database、production-build 成功；10:49:58 UTC 网站激活及现有完整 SHA、登录、静态资源和未登录健康检查通过。新增门禁随后在首个回环就绪请求遇到 301，deploy 因该 step 失败，不能据激活成功称整批核验完成。真实本地代理夹具复现了相同错误；修复仅使固定 127.0.0.1 检查直接连接本地应用，公网保留环境 transport 和拒绝 redirect。回归先失败再通过，完整部署辅助 20/20；没有修改服务器认证/网络配置或 root helper。
- 此门禁修复走正常提交和发布流程，实际最终 main SHA、后续 CI、两地址 readiness/三条 POST 410/no-store/旧页 404/account 401 结果记录在 [PR #5](https://github.com/zhYAO/Image-web/pull/5) 的交付记录；按用户要求不为纯发布记录再触发文档部署。云命令行与 dot 浏览器某些 API 路径受限，使用现有流水线与支持的原生平台读取，不绕过被拒网络。旧网站回滚会恢复批量入口与旧读取行为，须修复版前向发布；新增私有表、列、历史和冻结款保留，未知结果继续人工核对，不自动退款或重购。

## 2026-10-09 /create 目录与生成设置精简（远程分支已推送，未发布）

- 在已发布的批次后台续跑和减流版本上合入当前工作区的界面改动；目录及六工具共用首页 WorkspaceFrame 与会话侧栏，公开目录对游客可见，旧草稿与附件在目录、工具及历史间保留。
- 精简商品套图、A+/详情、复刻、批量、AI 商品图和服装表单：默认使用当前可用模型、1:1／2K 等预设，隐藏逐图技术参数，保留流程必需输入、费用确认和旧草稿恢复。批量改为主内容区表单；批次提交和续跑仍由已上线的后台 Worker 负责，页面只读进度且保持可见任务的有界刷新。
- 原工作区界面改动先保存为 `e617f36`，再以远程 main 的 `543347a` 为基线整合为 `d0cb401`、`61e57d2`，推送到 `codex/create-catalogue-ui-release`。批次页保留生产版的 Worker 续跑、只读进度和有界刷新，旧客户端 POST 推进未合入；相应隐藏页面回归已更新。最终整合版本 Web 单测 561/561（86 文件）、Domain 69/69（9 文件）、lint、typecheck、预算保护 5/5、Mock Webpack 生产构建（45 页面）通过；本机 Node 25 测试临时关闭实验性 Web Storage，未更改仓库配置。未改数据库或供应商 Worker，未做付费调用；此界面分支尚未合并或部署生产。

## 2026-10-09 重复请求与批量后台续跑（已发布，待 24 小时观察）

- 基线为已上线的 `ff39584708d3d7e1a01f955de49a7389240b8a91`；在隔离工作树实现，原工作区未提交改动保持不动。后台第一阶段 `7e73dff` 和前端第二阶段 `c51f470` 均经完整 CI 发布。生产验收发现的批次进度权限错误及供应商“待核对”误算为运行中的问题已补丁修正。最终提交 `300869e` 的 [CI #45](https://github.com/zhYAO/Image-web/actions/runs/37822991458) 已通过 quality、database、production-build 和 deploy；公网就绪接口确认部署版本一致。
- 后台：到期领取、120 秒租约、每项固定请求 ID、30 秒／2 分钟／5 分钟／15 分钟有界重试、无法核对时停机；内部 Worker 每次最多 20 项或 45 秒。只有到期工作存在时，Supabase Cron 每分钟调用内部入口。历史批次不会因新 Cron 被自动推进。批次进度经所有权校验，只返回提交及生成计数和“待核对”数，不含图片 URL。
- 前端：批次只读取进度，不循环 POST 或逐项 GET；图片进入可见视图才按 ID 签名，同账号并发合并、有效期内缓存，切换账号清除；已加载图片不按签名到期时间主动换源。隐藏草稿与结果卡不请求图片；当前可见运行任务分段降频，满一小时停止自动刷新；积分按变动事件立即更新，五分钟兜底。
- 验证：Node 24.19.0 下本地 lint、typecheck、预算保护 5/5、供应商单测、部署脚本单测、HTTP Webpack 生产构建及 Mock 构建通过；完整 Domain 69/69、Web 542/542 通过（最终两处补丁另经专项 11/11），CI #45 在最终提交上所有门禁全绿。本机无 Docker，数据库迁移与 pgTAP 以 CI 为准。
- 生产两图验收：用户批准使用当前登录账号。报价为 Seedream 5.0 Flash 2K 每张 0.30 积分，共 0.60；批次 `bc0bd67a-50d2-41ed-80c6-308710020518` 两项均提交，第二项成功，第一项供应商请求结果不确定，已转 `provider_reconciliation_required` 并停止重放。账户新增一笔 0.30 结算和一笔 0.30 冻结，未重复扣款。第二项由后台 Cron 推进，但页面直到两项提交后才关闭，故真实操作没有单独证明关页前尚未提交项目的续跑；相关租约、崩溃重试和关页续跑由测试覆盖。待核对项须以供应商证据人工结清。
- 上线后监测：旧前端 15 分钟 `/api/credits` 59 次、定价 60 次；新前端首个含真实验收且批次页部分时间关闭的 15 分钟为两者各 3 次。最终 `300869e` 于 18:53:50–19:08:50 UTC 的连续可见终态页面窗口中，两者各 6 次，账本 3 次；批次进度、旧 POST、Storage 签名／GET 和内部 Worker HTTP 均为 0。该窗口 Cron 15/15 成功，Supabase Edge 网站来源 31 次、已识别本地来源 0 次、既有定时任务来源 17 次，均无 HTTP 错误；网站 journal 无 warning。旧后端批次进度曾有 19 次 500，补丁迁移后最终页面正确显示 2/2 已提交、1 待核对、1 成功，没有残留错误。生产数据库约 91.8 MB，Storage 对象约 29.6 MB，均低于 Free 容量；账单出站流量及订阅周期需控制台核实，不据此保证全部额度。
- 独立运维：历史 2 个待核对批次和 1 笔待核对积分没有自动重试、清理或结算。本轮新增的 1 笔待核对积分也保留。证书到期 2026-12-16 14:41:11 UTC；`certbot.timer` 虽启用，续期仍是无自动 hook 的 manual DNS，HTTP ACME 公网 403，dry-run 未能成功，证书未改。DNS API 最小权限凭据或备案／HTTP 验证路径需落实后再演练。新增登录后只读健康检查脚本，浏览器已用真实登录会话读取账号余额；Sentry 令牌缺失，监控回退到服务器与 Supabase 日志。已设置 2026-10-10 北京时间约 03:00 的一次性只读 24 小时复查。

## 2026-10-08 当前分支生产发布（已完成）

- 用户授权的电商重构、服装商品图、Seedream 5.0 和 apps 精简已提交、合入 main 并上线。PR [#4](https://github.com/zhYAO/Image-web/pull/4) 合并提交为 `524c9d7`；实际生产版本为 `ff39584708d3d7e1a01f955de49a7389240b8a91`，[生产流水线 37772879918](https://github.com/zhYAO/Image-web/actions/runs/37772879918) 完成全部检查和部署。北京时间 20:29:24，服务器确认 `Published and verified`；本机回环与 `https://www.zimage.store` 公网就绪接口均校验版本一致，登录页、静态资源及未登录账号接口的 401 检查通过。
- 精简结果：本轮删除 apps/web 下 28 个无用文件，释放 2,320,696 字节；清空原 .next 缓存释放 2,357,454,211 字节，隔离验证产物另释放 620,050,855 字节。10 个场景与 18 个模板预览资源、中文字体和许可证保留，next-env.d.ts 按原始字节恢复。原有 92 项暂存删除在检查期间由外部提交 `accdb0d` 提交并推送，本轮完整保留该提交。
- 最终固定发布版本 CI：Web 520/520（79 文件）、Domain 68/68、数据库 641/641（22 文件）及生成类型一致性、预算保护 5/5、部署辅助测试 6/6、图片供应商测试 14/14、lint、typecheck、Mock 构建与生产 HTTP 构建全部通过。Web 覆盖率为语句/行 88.48%、分支 84.02%、函数 70.26%，保留原有 70% 门槛；此前本地 Worker 单测 36/36 通过。
- 生产 Supabase 项目 `klmiycyesxnpinxpeqep` 已按顺序应用 `20261006133912_seedream_5_models`、`20261006133915_apparel_catalog`，迁移记录从插件生成的时间号规范为仓库原始版本号，历史总数由 23 变为 25，PostgREST 已重载。现行积分目录为 `2026-10-06.1`、共 8 项价格，Flash/Pro 的 2K 单价均为 30 minor；旧目录 `2026-09-15.1` 的 7 项价格保留。服装的五张表均启用 RLS，apparel_dispatch 仅 service_role 可执行，匿名和 authenticated 均无执行权。
- 用户确认已添加两个 Flash/Pro 模型 Secrets。generation-worker v15、cleanup-worker v17 均 ACTIVE，线上源文件与仓库一致，既有自定义双重鉴权和旧任务模型映射保留；未授权请求均为 401。迁移后的日志窗口 20:27:10–20:35:20 中，生成 Worker 有 5 次、清理 Worker 有 1 次 HTTP 200，两项 cron 保持启用。安全顾问检查未新增 WARN；新增三个 private 表无策略的 INFO 与仅服务端访问设计相符，既有警告仍保留。
- 切换窗口内约 20:26–20:33 暂停新生图；网站健康验证通过后恢复 generation_enabled=true，upload_enabled 始终为 true，并通过数据库再次确认。提前保留旧 Worker、数据库函数及权限备份和服务器旧发布版本，未删除业务数据或调整历史未决积分。
- 验证过程：补齐 Storage 测试所需的事务级 storage.allow_delete_query、从完整迁移 CI 补齐生成类型，并新增六项服装行为测试解决原 68.87% 函数覆盖率。首次 main 流水线 37764351050 两轮分别有 4 项和 8 项界面失败，多数触及 60 秒超时；未在失败时执行生产迁移。未能证明有效的查询缓存实验已撤回。最终 CI 串行执行完整 Web 覆盖率，覆盖率用例期限 120 秒、CI 异步控件就绪期限 30 秒；本地普通用例 60 秒、控件 10 秒期限保留，独立预算检查通过。最终全绿来自单次完整流水线。
- 网络差异：17:58 本机命令行曾返回阿里云 ICP 拦截页、HTTPS 连接重置；用户确认备案控制台正常且 Edge 首页可打开。最终部署服务器的公网检查通过，不能将此前单一访问路径的现象认定为全站备案异常。未执行付费生图，因此模型供应商权限、实际效果和扣费，以及真实账号的服装下载体验，不以本次自动化发布检查代替人工验收。
- 发布证据与原始失败日志保存在 `C:/Users/yao.zhao/.codex/visualizations/2026/10/08/01a11ab3-8fc0-7183-9f9c-0c3ad43a593a/apps-cleanup/`，含 production-quality-final.log、production-database-final.log、production-deploy-final.log。后续仅提交本节发布记录；生产运行代码版本仍为上述 ff39584。

## 2026-10-08 apps 无用文件精简（本地清理及验证完成）

- 范围：仅精简 `apps/web` 的闲置资源、样式及旧登录弹窗；不修改公开 API、Supabase、业务流程或部署配置。保留本轮开始时用户已有的 92 项暂存删除。
- 清理：删除 25 张无引用图片（18 张旧版 `*-v2.webp` 模板、4 张旧女装场景示例、3 张旧技能封面），以及无实际页面入口的 `AuthRecovery.tsx`、其专属测试和旧技能页样式；共 28 个文件、2,320,696 字节。验证码测试仅移除旧弹窗的专属用例，现行认证覆盖保留。
- 缓存：复核时本项目开发服务已停止，无需结束其他 Node 进程；已清空 `apps/web/.next`，释放 2,357,454,211 字节。隔离验证使用的 `.next-build-qa` 已清理，`next-env.d.ts` 按检查前的原始字节恢复；两类构建目录均未遗留。
- 已验证：使用项目要求的 Node.js 24.19.0 与 pnpm 11.19.0；领域单测 68/68、Web 单测 514/514（79 个文件）、预算保护测试 5/5、lint、类型检查及隔离生产构建全部通过。10 个场景及 18 个模板的预览资源全部存在；中文字体及许可证完整；无残留旧组件、旧样式或已删除图片引用；独立只读审查无可操作问题。lint 保留现有 Next.js 单仓根目录缺少 `pages` 的提示，命令退出码为 0。
- 证据：本地检查日志与删除清单位于 `C:/Users/yao.zhao/.codex/visualizations/2026/10/08/01a11ab3-8fc0-7183-9f9c-0c3ad43a593a/apps-cleanup/`。本轮不提交、发布、执行远程迁移或付费生图；自动化检查不代表真实浏览器或生产环境验收。

## 2026-10-06 Seedream 5.0 与服装商品图片（本地实现及验证完成）

- 基线：已拉取、切换并跟踪 `origin/codex/meitu-commerce-refactor`，以 `--ff-only` 同步至 `f397841`。实现提交为 `7b6fff3`；本轮保留同名分支和工作区，不推送、合并或发布。
- Seedream 默认 Flash，可切换 Pro；分别使用 `doubao-seedream-5-0-flash-260915`、`doubao-seedream-5-0-pro-260628` 与独立部署配置。仅 2K、原五种比例，参考图最多十张，每次一张且不发送流式/组图参数。新积分目录两款均 0.30/张，管理命令按版本目录验证完整价格集合。4.5 历史模型、提示词和费用保留；旧入队任务继续原映射，新生成需显式选择新模型并保存新版本。
- 新增“服装商品图片”目录/导航与共享工作区表单，上传五张 JPEG 主图、1–20 张 JPEG 展示图及透明 PNG Logo。Sharp 按固定版式输出 11–30 张 JPEG：五张 750×1000 主图、790px 详情页，跳过 `_02`。EXIF、比例、透明度、自然排序、文字容量、裁切先校验；照片仅规范内缩放/裁切/Logo 合成，中文字体与 OFL 许可证随应用打包。文字溢出指出字段，动态页面高度上限 40000px。
- 排版复用电商任务/修订与 HTTP 创建、保存、读取、执行、私有资产和 ZIP 入口，独立记录整套执行与 `layout` 资产，不调用模型、不冻结积分、不扣图片额度。同账号执行互斥、原请求重试、修订及续租围栏、90 天保留、会话/账号删除和到期清理已接入。ZIP 保留 `主图/`、`images/` 和原始 JPEG 字节。
- 唯一共享附件、资料与待恢复请求按账号/会话保存；修改创建整套新版本，旧套图可预览/下载。已覆盖旧标签页版本冲突、创建/保存响应丢失、刷新恢复、Mock 过期租约与迟到响应；修复共享 Mock 状态刷新导致旧电商历史一次性导入丢失。
- 独立只读整分支审查发现两项 Important 问题，均经 RED→GREEN 回归修复：Storage 路径意图独立于业务级联删除保留，并重复发现迟到上传；无鉴权 Mock 排版只允许显式本地启用、loopback 和非部署环境，云端预览及生产部署关闭。审查范围、限制与处理记录在本轮 QA `review.md`。
- 最终固定代码完整复跑：Domain **68/68**、Web **516/516（80 文件）** 单次全绿，Worker **36/36**、本地 PostgreSQL **280 项断言及真实双连接竞争**、预算保护 **5/5**、开发启动器 **3/3**、lint、typecheck 均通过。Node 24.19.0 / pnpm 11.19.0；全量单测临时使用 `--maxWorkers=2`，仓库默认配置未改。早期旧断言及 Mock 导入失败原始日志保留，最终通过不由定向结果拼接。隔离 Webpack 生产构建通过，44/44 页面；排版执行与演示路由的运行依赖含两个中文字体、许可证和溯源说明。
- 人工检查实际 Sharp 联系表及详情 03/04/05/06/07；本地桌面 Mock 走通七个文件上传、全部资料刷新恢复、保存/排版 v1 与 v2（各 11 张）、旧版预览、最终构建刷新恢复与 1440×900 两栏页面。输入主图为已有女装示例转成 3:4，展示图使用宽幅耳机素材检查动态比例，不能据此宣称真实服装照片验收。Native HTTP multipart 排版/ZIP 均 200，11 个文件的编号、UTF-8 目录、CRC 与 JPEG 字节一致性通过。内置浏览器 Blob 下载未返回完成事件，页面和控制台无错误；普通浏览器实际落盘下载留待真实环境验收，不将 HTTP 通过冒充该项通过。
- 本轮证据保存在 `.design-qa/2026-10-06-apparel-upgrade/`（完整日志、审查、联系表、JPEG、ZIP、页面截图）；临时预览服务与隔离 `.next-build-qa` 清理，`next-env.d.ts` 还原，日常 `.next` 未改动。本工作区与主仓库当前均无 `.design-qa/2026-09-16-real-acceptance/` 副本，未对历史证据执行删除或修改，不能复核其内容。未恢复 E2E 工程，未更改依赖版本。
- 尚未执行：生产数据库迁移、Flash/Pro 部署配置及 Worker 发布、真实账号私有 Storage/到期清理与浏览器下载验收、两款付费生图质量/额度/费用验收。以上须另行安排，不能以本地 PostgreSQL 兼容测试、Mock 或构建替代。

## 2026-10-06 提交前复验

- 范围：美图电商五流程重构、草稿与附件恢复、地区／语言文案约束、原创示例素材及开发启动链路修复。
- 使用 Node 26.3.0 / pnpm 11.19.0；lint、typecheck、开发启动器单测 3/3、预算保护 5/5、Domain 62/62 通过。Web 全量首轮 488/489，唯一失败是旧测试在 AI 商品图上传首屏寻找隐藏的“取消方案”。测试改为先从可见预览区上传商品图，再取消并验证恢复普通创作；该文件定向复验 2/2 及相关文件 lint 通过。未将首轮与复验表述为单次全量全绿。
- 隔离 Mock 生产构建通过（Webpack，42/42 页面）；临时构建目录清理并恢复 next-env.d.ts，现有开发服务保留。原始日志保存在 `.design-qa/2026-10-06-precommit/`。
- 本轮仅本地提交前检查；未新增浏览器验收、真实供应商调用、迁移或生产发布。

## 2026-09-27 开发启动链路修复（晚间复查）

- 用户再次报告无法访问／dev 失败。21:08 检查时 3000 无监听进程，未出现新的 Next panic 文件；上次服务日志持续成功响应但没有退出原因，因此不能将本次故障直接归因于缓存，也不能确认进程为何停止。系统 Terminal 不在当前工具可读范围，已向用户请求本次错误末行；尚未取得。
- 实际交互式 shell 为 Node 24.16.0 / pnpm 9.15.9，低于项目声明；兼容的 Node 26.3 已安装但不在优先 PATH。原命令会再次嵌套全局 pnpm。新增 `scripts/dev.mjs`，根项目和 web 项目共用入口，依据 `.node-version` 校验实际 Node，从当前运行时、PATH 和已有 Homebrew 安装选择兼容版本，也支持显式 `ZIMAGE_NODE_BIN`。直接解析已安装 Next CLI，避免嵌套旧 pnpm；不下载软件、不改全局 shell、不放宽版本要求。
- 默认显式使用 3000 或 PORT，阻止端口冲突时自动跳到别的端口；完整传递 CLI 参数和退出信号，子进程异常退出码继续传给终端。依赖安装仍需声明的 pnpm 11；旧全局 pnpm 在进入启动器前的 engine 警告仍可能出现，启动日志会另行显示实际 Next 使用的兼容 Node。
- 已验证：启动器单测 3/3、相关文件 eslint、git diff --check；默认旧终端直接 `pnpm run dev`，实际 Next 使用 `/usr/local/opt/node@26/bin/node` v26.3.0，首页及详情 HTTP 200。第二次同时启动按预期 EADDRINUSE / exit 1；停止首实例后 3000 释放、父子进程均退出，再次原命令启动 Ready。重启后的批量页面 HTTP 200；最后测试服务已停止，3000 无监听进程。
- 本轮仅改变开发启动器及脚本，未执行完整业务单测／生产构建，未部署、未改环境密钥或模型调用。记录见 `.design-qa/2026-09-27-dev-bootstrap/`。前台开发服务需由用户终端持续运行，代理临时进程不等于常驻服务；此次交付前停止测试服务，让用户启动时不与测试进程争用端口。

## 2026-09-27 开发启动缓存崩溃修复

- 用户报告 `pnpm run dev` 报错。读取本机 13:30 的 `next-panic-7e43a694421ff258ae4b874ab6c99212.log`：`ProjectContainer::project` 在恢复磁盘缓存时出现 `Every task must have a task type TaskGuard`，状态包含 `persistent_task_type: None` 与 `meta_restored: true`。随后重新启动，Next 自动清除异常缓存，首页、目录和详情均返回 HTTP 200。
- 依据已安装 Next 16.3 本地文档，在 `apps/web/next.config.ts` 将 `experimental.turbopackFileSystemCacheForDev` 设为 false，规避开发缓存恢复路径；保留 Turbopack、内存缓存、热更新及原有构建参数。代价是每次重启后的首次编译较慢。
- 系统默认 Node 24.16.0 / pnpm 9.15.9 低于项目声明，启动会出现 engine 警告；此次崩溃证据指向缓存恢复，未将版本警告误作已证实根因，也未更改用户全局运行环境。
- 验证：配置 lint、全项目 typecheck、git diff --check 通过；修复后首页、商品套图、批量页返回 HTTP 200，完整退出后再次执行原命令 `pnpm run dev`，启动 Ready，详情页返回 200，未再出现 TaskGuard panic。此次仅改开发缓存选项，未重复运行完整单测和生产构建。未改业务逻辑、依赖版本或生产缓存配置。崩溃证据保存在 `.design-qa/2026-09-27-dev-cache-fix/`。

## 2026-09-27 美图电商五流程重构（本地实现与桌面 Mock 验收）

- 分支：从最新 `origin/main`（`e1f0404`）建立 `codex/meitu-commerce-refactor`；保留原 `codex/phase2`。clone-web 已同步 `05c9c01`。以 designkit-clone 为主参考，OpenDesign 不混入电商视觉。
- 已实现商品套图、A+/详情页、爆款图复刻、批量生成、AI 商品图的独立流程视图，共用唯一 UnifiedWorkspace、附件和任务运行时。白色顶部栏、68px 工具导航、浅灰蓝背景、蓝色主操作；历史收进抽屉，普通创作保留原界面。
- 新任务默认淘宝／中国／简体中文；套图 1/3/2/1、最多 20 张，详情 16 模块及普通／高级双版本，复刻独立商品／参考图、逐图要求与链接导入，批量最多 20 商品及逐项覆盖，AI 商品图上传首屏、场景／描述／参考图和最多 4 候选。详情结果增加模块顺序与长图预览，沿用单图修改、版本、下载和导出服务。
- 草稿保存当前步骤和场景状态。批量缓存按账号、标签页和草稿身份隔离，旧无归属缓存不导入；附件继续保存 File 字节。丢失创建响应时重放原批次请求，未知付费结果不重复提交。浏览器发现的保存后立即刷新遗留旧素材编号已修复：新本地草稿重新上传保留字节，防止跨会话引用；新增回归通过。
- 文字 productContext 增加可选地区／语言；图中文字和模块策划遵循选定语言，跨语言文案仍保护型号、数字、规格。文字优化、策略和上架文案由用户触发并单独报价。
- 内置 imagegen 生成 18 张原创图片，版本化 WebP 合计约 1.6 MB。暖橙耳机、冷蓝耳机、杯子复刻对照和浅色香水摄影以真实布局组合，示例不自动加入请求。来源与提示词见 [素材清单](assets/meitu-commerce-v1.md)。
- 自动化：lint、typecheck、预算保护 5/5、最终隔离生产构建通过（42 页面）。完整单测首轮 Domain 61/61、Web 483/487；4 项旧 UI 断言经修正与定向复验全部通过。最终 Domain 62/62，语言及新流程专项 15/15，相关流程 26/26；最后素材归属修复后新增流程 8/8、原一键流程 7/7。中间新增回归曾因测试使用非 UUID 素材编号失败，修正测试数据后 8/8 通过。没有宣称最终代码单次全量全绿。
- 浏览器：本机 Mock 生产构建，CUA 走查 1280×650、1440×900、1920×1080，五流程配置及 AI 上传后状态；无横向页面溢出。已走通套图、复刻、详情、AI 商品图、批量的模拟提交，详情文案／排序／步骤刷新恢复，批量附件／参数恢复、逐项进度和历史抽屉。单张编辑、历史版本、长图预览及导出反馈已核对。Mock 导出沿用逐图模拟下载，不能据此宣称真实 ZIP／长图文件端到端验收完成；真实导出契约由现有专项单测覆盖。
- 验收证据：[设计 QA（历史提交）](https://github.com/zhYAO/Image-web/blob/ae8c332ec6aa55a80b21a752d152275e58ed797e/design-qa.md)，截图与原始自动化日志在 `.design-qa/2026-09-26-meitu-commerce/`。旧真实验收目录保持不动。未恢复 Playwright/E2E 工程。最终隔离构建目录已清理，next-env.d.ts 已还原，本轮临时服务已停止。
- 边界：未发布生产、未执行数据库迁移或 Worker 部署、未调用本项目供应商付费效果验收。浏览器结果是本地 Mock；真实图片质量、真实账号积分与真实存储导出仍需另行授权验收。

## 2026-09-22 首页、输入框与侧栏改造

- 状态：本地实现及自动化跨轮验证完成；浏览器视觉验收待人工执行，整体视觉验收仍为 `in_progress`。本轮没有部署、数据库迁移、付费生图或新增依赖。
- 导航：工作区顶部使用独立材质参数（模糊 12px、通透 85% / 底色 alpha .15、边缘高光 .32），保留文字清晰及减少透明度/高对比/不支持背景模糊时的实色回退。
- 首页：仅保留“你好，想创作什么？”和电商轮播，复用七种类型与现有封面；桌面分组 1–3、4–6、7+1+2，窄屏单卡，5 秒自动播放，支持箭头、指针横滑与触控板横滑；悬停、聚焦、隐藏标签页暂停，减少动态效果关闭自动播放。
- 输入框：参考图和文本位于上方，模型/图片参数独立入口位于下方；参考图轻微旋转放大。普通生图新草稿、旧草稿恢复、费用预估及新请求统一为一张；电商套图和历史批次重做规则保留。
- 会话：侧栏展开约 248px、收起约 72px，原创柔紫色 SVG 图标与稳定会话配色，保留名称气泡、选中/处理中状态、筛选、重命名及删除确认。首次发送立即显示消息与等待状态；延迟创建完成或失败后不抢走其他会话导航，不覆盖其草稿，也不清除其他会话参考图。
- 独立只读审查指出的首次发送等待/互斥、参数弹层裁切、轮播焦点卡片卸载后停止自动播放均已修正；针对首次创建跨会话成功/失败补充回归。
- 已验证：lint、typecheck、acceptance-budget 5/5、最终生产构建通过（40 个静态页面生成进度完成）。初次 Turbopack 构建因沙箱禁止编译子进程绑定端口失败；清理本次隔离缓存后重新构建通过，最终修正后再次构建通过。已恢复自动生成的 next-env.d.ts 并删除本次 .next-build-qa 构建产物。
- 自动化结果：完整单测 Domain 57/57、Web 473/475（70 个文件），耗时约 19 分钟。全量进程在跨会话修正前已启动，两项新增跨会话创建用例失败；使用最终代码重新启动对应文件后 3/3 通过，覆盖全部失败项。首页轮播 6/6、折叠侧栏 3/3 均在全量运行通过。本轮为跨轮复验，未再次运行全部用例到最终单次全绿；保留首轮真实结果，没有放宽断言或增加超时。
- 人工视觉验收尚未执行，清单见 [工作区界面验收](qa/2026-09-22-workspace-ui.md)。未恢复 Playwright/E2E 或截图基线，不据单测和构建宣称真实浏览器视觉或生产环境已验收。
- 本轮日志：`.design-qa/2026-09-22-workspace-ui/`。


## 2026-09-19 性能、润色与自动发布（已发布，部分人工验收待补）
本文件是 ZImage **唯一的当前交付进度事实源**。需求定义仍以 [`requirements.md`](./requirements.md) 为准；架构、技术选型和历史交付文档用于解释范围与保留审计证据，不代表当前任务已经完成。

## 2026-09-19 电商一键生图与独立页面（本地实现、真实文字优化验收）

- 已实现上传素材与商品描述后一键保存并提交，保留可选分图调整、草稿、任务版本、重做、下载与归档。数量/费用持续可见，其余配置收进高级设置；新主图默认无字，完整描述进入提示词，旧方案兼容。
- 已修复优化原文不变仍提示成功：区分实际改写、格式调整和未修改，保护名称/事实，保留取消、撤销和异步回填隔离。高级设置可明确选择豆包或 MiniMax 文字优化。
- 已接入真实 `/create/[scene]`、`/sessions/[sessionId]` 页面与 task/view，共享运行状态和附件，草稿按用户/标签页/场景隔离；浏览不建空会话。会话创建、任务创建和提交均保留幂等恢复身份。分类统一为全部/普通创作/电商生图，小红书归入电商，重命名保留分类，缺失分类先核查任务。
- 本地桌面检查覆盖 1280/1440/1920 宽、600/900/1080 高，长表单、错误状态、Mock 多任务结果和前进后退；左右面板撑满剩余高度，内部分别滚动。真实旧海报任务刷新恢复、旧入口替换跳转、不存在会话提示通过。
- 真实文字：用户登录 Chrome 后，豆包描述/卖点、MiniMax 卖点均实际改写并回填；三次浏览器验收合计 0.20 积分，最后可用 7.36、冻结 0.30、累计消费 2.34。普通创作的文字模型是会话配置，第一次切回电商仍使用豆包，已明确核账并补上电商内模型选择，不将该次误计为 MiniMax。
- 验证：Node 26.3.0 / pnpm 11.19.0；最终 Lint、Typecheck、Turbopack 生产构建通过，预算保护 5/5、Worker 31/31 通过。首轮全量 Domain 57/57、Web 449/452；完整复跑 Domain 57/57、Web 451/453（取消按钮旧断言及运行中修改的历史视图断言）。最终固定代码串行复验相关 3 文件 **10/10 通过**，含此前并行检查超时的草稿恢复；不宣称单次全量全绿。隔离构建目录已清理。
- 边界：未发布生产，未修改数据库结构或 Worker，未恢复 E2E 工程；保留既有部署改动与真实验收目录。历史未知图片结果未核对完，本轮没有真实图片调用，不能宣称真实一键图片生成或生产验收完成。真实历史访问曾有一次临时 401，重访与刷新恢复，已如实记录。[实现与验收记录](./audits/2026-09-19-commerce-one-click.md)。

## 2026-09-17 阿里云部署（服务器部署完成，公网备案接入阻塞）

- 用户授权部署当前 Image-web 到 `47.100.222.24`，绑定 `www.zimage.store`，并明确允许经 SSH 传输现有应用凭据。凭据保存在 `/etc/zimage/environment`（root:root、0600，目录 0700），本机与服务器的临时运行凭据副本已清理；发布包排除全部环境文件，3,888 个构建文件扫描未发现服务端凭据。
- DNS 原有 `www A 47.100.222.24` 已验证，无需修改；经用户行动时确认，在安全组 `sg-uf616pvvmjwql7p6cn4t` 新增公网 IPv4 TCP 80/443 两条规则。开放后 HTTP 返回阿里云 `Non-compliance ICP Filing` 403；最终公网 HTTPS 握手被中断。备案或接入尚未满足，不能宣称公网网站可用。
- 部署基于 `83cb890` 工作区及本次 standalone 配置：本机 Node 24.19.0 / pnpm 11.19.0 的 Webpack 构建成功，发布到 `/opt/zimage/releases/83cb890-20260917`，`/opt/zimage/current` 指向该版本。产物保留 `.next-build-qa` 目录名；替换为服务器锁文件安装的 Linux x64 Sharp 0.35.3 / libvips 1.3.2 原生包，已在 Linux 实际调用 PNG 编码及 Next 图片优化验证。应用使用独立 Node 24.19.0，不替换原系统 Node。
- `zimage.service` 使用无登录权限的 zimage 用户、回环地址 `127.0.0.1:3100`，已启用开机启动和失败重启，堆上限 640 MiB、服务内存上限 850 MiB。Nginx 已绑定 www 域名、启用 HTTPS、覆写可信代理头并关闭流式响应缓冲；原 8080 站点及 SSH 隧道保持配置。
- Let's Encrypt 证书通过新增 `_acme-challenge.www` TXT 验证签发，有效期至 **2026-12-16 14:41:11 UTC**。当前为手动 DNS 验证，**尚不支持自动续期**；已准备签发后的 Nginx reload hook，备案接入完成后应切换并验证 HTTP 自动续期，或配置独立的最小权限 DNS 自动续期。没有为此创建新的云账户凭据。
- 本机 TLS 首页和登录页 200，未登录账户接口 401；三条 CSS/JS 静态资源 200、实际女装图片优化 200；服务器到 Supabase `/auth/v1/settings` 返回 200。服务无自动重启，检查时应用约 135 MiB、系统可用内存约 1 GiB，磁盘约 20 GiB 可用。以上不等同真实登录、SSE、上传、生图、计费及 Worker 的完整验收。
- 本地 Lint / Typecheck 最终通过；Domain 56/56、Web 438/439，唯一 commerce UI 用例因 60 秒超时失败，保持原断言和超时的专项复跑 1/1 通过；预算保护 5/5；隔离 Webpack 生产构建通过（39 个静态页面）。不称完整 Web 单次全绿；隔离本地构建缓存已清理、next-env.d.ts 已恢复。未新增 E2E、未做数据库测试或付费模型调用，也未修改 Supabase 数据库或 Worker。
- 首次云端 Turbopack 构建期间 SSH 和云助手失去响应。VNC / 前一启动日志显示当日更早的 OpenClaw OOM 和内核阻塞，不能仅据此确定本次根因。经用户授权正常重启；重启停止阶段的强制停止尝试被 `InvalidOperation.Conflict` 拒绝，随后原重启任务完成。SSH、宝塔、Mihomo、Nginx 与 3000/7788/8648 隧道已恢复；重新停止自动拉起的 OpenClaw。其原开机启用状态仍保留。
- 恢复后尝试受限 Linux Webpack 构建仍造成资源压力，已主动停止，没有宣称该构建通过；最终采用上述本机构建加 Linux 原生包的产物。额外 3 GiB swap 已撤销，恢复原 1 GiB；不再在当前生产实例上构建。
- 后续阻塞：完成 zimage.store 的备案/接入；核验生产 Turnstile 域名和 Supabase 认证回跳；现有 `APPROVED_LEGAL_VERSION` 未设置，保留注册关闭门禁。部署路径、验证和回退见 [部署说明](../ops/aliyun/README.md)。

## 2026-09-17 项目清理（本地清理与验证完成）

- 按用户授权移除 E2E、真实环境 E2E、截图基线、三份 Playwright 配置、相关命令和 CI 浏览器任务；保留 Web / Domain / Worker 单元测试、数据库测试及真实验收预算脚本和测试。当前不再具备浏览器自动回归覆盖。
- 已清理 25 个闲置 `.next*` 目录、历史测试报告及运行结果、10 个历史 `.design-qa` 子目录和三个 `.DS_Store`；删除前确认未运行 Next.js / Playwright。删除项原占用共 19,112,604 KiB（约 18.23 GiB）。
- `.design-qa/2026-09-16-real-acceptance/` 整体保留，含付费预算、未知结果核对记录与真实验收证据；旧预览素材和历史文档继续保留。下方历史测试结论不改写，但指向本次清理产物和已移除 E2E 源码的旧路径不再可用，不作为当前验收依据。
- E2E 文件及未提交修改备份在 `/private/tmp/image-web-cleanup-20260917-071749/`；目录内保存删除清单和验证日志。原有业务改动保持不变，未部署、未执行数据库变更或付费模型调用。
- 构建目录约定：日常 `.next`；隔离验证统一复用 `.next-build-qa` 并在结束后清理。本轮构建缓存已清理，自动改写的 `next-env.d.ts` 已还原；真实验收目录 132 个文件的 SHA-256 与清理前完全一致。
- 验证环境为 Node 26.3.0 / pnpm 11.19.0。Lint、Typecheck、Worker 31/31、预算脚本 5/5 通过；Domain 56/56，Web 首轮 437/439。首轮验证脚本误将 Mock 模式覆盖应用于单测，导致账户页两项用例进入模拟分支；移除该环境覆盖后专项复验 2/2 通过，未改业务或测试断言。本轮不是完整 Web 单测单次全绿。
- 生产构建首轮受沙箱本地端口权限限制，直接重试仍复用失败缓存；清除该缓存后，在允许本地端口的环境重新执行同一 Mock / Turbopack 构建，退出码 0。没有运行 E2E 或数据库测试，保留数据库 CI 门禁；本地结果不替代真实环境验收。
- 通过 pnpm 正常更新锁文件并完成 frozen-lockfile 安装校验，没有新增或升级依赖包版本；保留此前的 Emotion 显式依赖改动。项目已移除 Playwright 直接依赖，锁文件仍含 Next.js 的可选 Playwright peer 记录。清理期间检测到的外部 `.env.example` 新增说明已原样保留。

## 2026-09-16 全站浅色紫系改造（本地实现与自动化完成，原生缩放待验）

- 按根目录 [DESIGN.md](../DESIGN.md) 落实近白背景、紫色主操作、淡紫选中态与轻玻璃导航；正文、输入、方案、结果和账户使用实色。统一控件高度、圆角、字体、键盘焦点及动画/透明度/强制颜色降级。
- 主题提升到根布局，保留 AuthStatusProvider → CreditsProvider 单实例；共享配置覆盖 LobeHub 与 Ant Design，内层使用标准算法保持精确色值，Emotion 流式样式注册避免首屏水合不一致。两项已有 Emotion 包提升为同版本显式依赖，无版本升级。
- 目录在 1280/1440/1920px 分别为 3/4/5 列，女装封面采用 4:5 容器完整显示；电商资料宽 320/340/380px，编号与图片分开。登录为最大 440px 单列表单，账户最大 1040px，协议最大 760px。旧技能路由继续跳转目录，素材库保留既有未开放提示。
- Node 24.19.0 / pnpm 11.19.0；最终 Lint、Typecheck、生产构建通过。完整单测 Domain 56/56、Web 439/439 单次全绿；首轮全量桌面 E2E 59 通过、1 条真实认证条件跳过、2 项预期截图差异。主题颜色和关闭按钮焦点避让专项 2/2 通过，两张现有截图基线经人工审查后更新，保持原差异阈值；最终不更新基线的完整桌面 E2E **61 通过、1 条真实认证条件跳过、0 失败**（8.9 分钟）。
- 使用独立 Mock 服务 3141 与 `.next-purple-build`，保留用户现有服务；未修改 API、领域类型、数据库、计费、认证和任务恢复逻辑，未部署或执行真实付费生成。原生 Chrome 200% 缩放受浏览器工具能力限制尚未验证，窄视口回流不算原生缩放验收；真实环境状态仍以上下文独立记录为准。
- 改造前后截图、实施文件、各轮检查及未验证项见 [本轮验收报告](./plans/2026-09-16-purple-design-validation.md)。

## 2026-09-16 真实环境验收与修复（进行中，生图待核对）

- 已按用户授权同步海报、摘要、积分迁移并启用真实积分；两个符合条件账号各获赠 10.00。新增单例安全更新修复迁移，未重发 Worker；同步前后旧业务记录指纹一致，既有 5 条未知任务不重发、不补扣。此项替代下方 9 月 15 日“云端待审批”的当时状态。
- 真实 Seedream 已提交 **5/24**：4 成功、1 新增 `provider_reconciliation_required`。按约定暂停后续图片，不盲目重试；待 Worker/供应商脱敏日志核对。首轮已返回图接受率 3/4，蓝柄要求生成白柄的普通图不接受；女装、电商、文字质量及编辑复测仍缺真实输出证据。未调用 Gemini。
- 真实豆包/MiniMax 聊天、豆包优化、上传、预览下载、主图资料校验/免费保存及目录三档桌面宽度已验。MiniMax 优化首次失败退款，分离推理内容后真实 API 复测和同 ID 幂等重放通过。最新可用 8.26、冻结 0.30、已扣 1.44；未上调每日额度。
- 修复会话草稿/参数刷新丢失、批量图片顺序随完成顺序变化、MiniMax 字段优化解析失败、本地 IP 开发脚本加载，以及图片预览关闭后透明遮罩残留；新增正式账号只读验收入口和跨复跑持久图片预算。保留此前未提交工作，未提交 Git 或公开发布。
- 验证：基线 Domain 56/Web 429 全量单测通过；后续相关 48 项、预算 5 项、PostgreSQL 238 断言及双连接竞争通过；最终 Lint/Typecheck、Webpack 生产构建通过（Turbopack 受环境端口权限阻塞）。真实只读 E2E 首轮 3/4、完整复跑 4/4；Mock 桌面全量 55 通过、1 失败、1 跳过，预览关闭问题独立复跑复现后修复，原用例 1/1、Chrome 真实图片关闭复测通过。不宣称一次全绿。
- 模板表单真实入口补验 6/18 通过，余下 12 项因主账号当日 10 个新会话额度耗尽暂停；不提高额度、不重新提交。10:34 UTC 最终核账仍为 8.26 可用、0.30 冻结、1.44 已扣，队列为空，历史未知 5 条加本轮 1 条不变。
- 11:37 UTC 起续验：未知任务、余额与日额度未变化。修复已有会话本地附件硬刷新丢失，Chrome 女装缩略图恢复、会话隔离、移除后刷新均通过；不支持格式、超过 10MB 和超出四张的客户端交互也通过。未新增模型调用；尚无服务器会话的首屏草稿及只有远端 ID 的参考图不在本次附件恢复范围。
- 续验回归：Web 全量 **64 文件、439 项通过**（含 5 项附件异步竞态），Lint、仓库 Typecheck、最终 Webpack 生产构建通过；最终附件/预览桌面专项 E2E **2/2 通过**。构建保留第三方动态依赖/Sentry 配置建议警告。11:54 UTC 只读核账确认积分、云端上传和生成记录无新增。
- 未完成：对照账号注册被未配置服务条款版本阻止；真实跨账号隔离、邮件/密码/注销流程、原生 200% 缩放及剩余图片路径均不得标记通过。主账号样本全部保留，永久删除未执行。详细逐项状态、图片评分与证据见 [真实验收报告](./audits/2026-09-16-real-acceptance.md)。


## 2026-09-15 电商报错修复与积分闭环（本地完成，云端待审批）

- 根因：云端缺少 9 月 13 日海报迁移，旧校验器拒绝 `xhs-poster`/`contentMode`，通用资料提示掩盖了部署差异。已加入能力检查与明确的未更新提示。
- 本地已接入积分钱包、七项试行价格、逐项冻结/结算/退款、未知结果待核对、文本请求回执、账号流水和工作台费用显示；每日 30 张额度独立保留，旧任务不补扣。
- 验证：Lint、Typecheck、隔离生产构建通过。完整单测首轮 Domain 56/56、Web 415/417；两项失败修正后相关 65/65 通过，新增恢复/Mock 并发 10/10 通过，最终定向复验 41/41、前端恢复 2/2、Domain 56/56。桌面 E2E 首轮 53 通过、3 失败、1 条条件跳过，复跑 3/3，累计 56 条有效通过路径，最终积分交互复跑 2/2；不宣称一次全绿。
- PostgreSQL 232 项 SQL 断言、真实双连接锁/竞争/幂等测试通过；三份迁移前后 9 张业务表的旧记录一致，未知任务保留且未补扣。Chrome Mock 已验证聊天 0.03、无图海报 0.80、改分辨率报价 0.60、保存免费、钱包/流水持久化，控制台无 error。
- 云端只读复核仍缺迁移；查询时存在 35 条生成记录（其中 5 条未知），2 个符合赠送条件账号。未执行云端迁移、发布、启用计费或真实付费模型调用。[验收与迁移差异](./audits/2026-09-15-credits.md)、[部署与运维](./credits-operations.md)。

## 2026-09-13 登录验证与 MiniMax 普通聊天修复

- 本轮任务 `done`（本地代码、桌面回归及当前 MiniMax 真实文本链路验收）：真实流使用 `finish_reason: stop` 正常结束但没有 `[DONE]`，旧解析器误判中断；现已接受明确结束信号及 EOF 尾帧，真正截断仍保留失败提示。
- 拆分模型调用、健康统计与回复保存；统计失败不阻止保存，保存失败明确提示且不提供可能重发模型的重试。路由、gateway、工作区锁定首次终态，完成后不再追加失败；Mock 图片工具排队事件也在完成事件之前发送。
- 聊天去重独立匹配本轮唯一新增的服务端用户消息，不再要求同时存在错误行；稳定映射可跨刷新保留，历史同文和并发歧义仍保留证据。登录验证码统一为浅色、表单宽度及独立外围样式，加载/成功/过期/失败文案与 token 状态一致。
- 验证：Domain 46/46、Web 408/408；Lint、Typecheck、隔离生产构建通过。桌面 E2E 首轮 53 通过、1 条认证条件跳过、1 条新增用例失败；修正该用例提前刷新中断请求的等待条件后，专项复跑通过，合计 54 条有效通过路径。构建曾受内置运行时子进程端口限制影响，使用项目已有 Node 26.3.0 / pnpm 11.19.0 完成；未为此修改依赖。
- 真实 Chrome / localhost:3000：MiniMax 短消息、多轮暗号追问、约 1000 字长回复均成功；刷新后三条问题、三条回复保留且无重复或服务不可用提示。登录、注册及找回密码的浅色测试验证码展示与状态已检查。详见[本轮验收记录](./audits/2026-09-13-login-minimax.md)。
- 保留已有未提交工作；未修改公共 API、数据库迁移、模型配置或 Worker，未提交/部署。仅桌面 Web；当前验证码是官方测试 key，生产反机器人验证不在本轮验收范围。独立 3112 测试服务已停止，原有服务保留。

## 2026-09-13 桌面全站 Liquid Glass 与电商预览确认重构（前序）

- 按用户确认方案在原工作区实施，保留已有未提交修复。共享玻璃材质覆盖悬浮导航、按钮、主要面板、AntD 弹层及认证/账户/条款外壳；冷白、淡蓝与淡紫环境色，输入区保持高不透明度与键盘焦点。
- `/create` 收紧标题区，六类图片卡片明确标记示例。统一工作区增加双栏、示例/方案/结果及当前会话任务选择；保留每个缓存任务的组件状态，混合聊天及普通图片通过会话历史展开访问。
- 电商主流程改为预览 → 逐图编辑 → 明确确认；保留仅保存、失败编辑内容与原任务重试。已同步需求 11.2，以下 2026-09-08 “默认直接生成”仅为历史记录，不再代表现行要求。
- 本轮仅前端与桌面验收，不修改公共 API、领域枚举、数据库、Worker、计费或认证配置。无 Git 提交、发布或部署。
- 实现与本地自动化完成：Lint、Typecheck、隔离生产构建通过；最终完整单测领域 41/41、Web 345/345。桌面 E2E 累计 44 条有效路径通过，1 条认证条件跳过（完整运行 42 通过、两项失败复跑通过）；两张视觉基线已更新并人工审查。真实 Chrome 原生 200% 缩放仍待验证，等效桌面重排已通过。真实页面及隔离 Mock 工作台分开检查；自动化清单和结果记录于 [本轮验收记录](./audits/2026-09-13-liquid-glass-workbench.md)。用户已手动登录，真实目录/工作台/账户已打开检查；本地测试图上传被浏览器扩展权限限制，未提交真实付费生成。

## 2026-09-08 桌面体验重构第二批（前序）

- 用户确认“继续”后完成共享规范批次（本地 `done`）：统一现有 `--z-*` 与 AntD 色彩/文字/控件状态，新增圆角、间距、字号、动效、层级规范；清理已确认覆盖规则。B06 占位文字在黑色背景透过 .96 外壳的最不利合成对比度约 5.30:1（改前约 2.30:1）。[变量规范和验收截图](./audits/2026-09-08-desktop-batch2.md)。
- 键盘焦点为独立 3px 蓝色外圈，组合控件外框承接；禁用/危险状态保持各自语义。减少透明度使用实色且完全关闭滤镜，减少动画保留状态反馈。修复前缀声明顺序导致编译产物丢失 `backdrop-filter:none` 的问题；浏览器最终计算值已验证。
- 2026-09-08 本地验证：Lint、Typecheck、隔离生产构建通过；领域 41/41、Web 333/333 全量通过。Chromium 151.0.7922.34 / 1440×900 E2E 首轮 32 通过、1 认证条件跳过及 1 个新增焦点终态断言失败；使用条件等待避开组件过渡中间色后，该完整用例复跑通过。合计 33 条通过路径、1 条跳过。两张桌面基线人工审查并同步，未放宽阈值。
- 保留第一批全部改动；未提交/部署，未改业务、接口、依赖或数据库/Worker。仅浅色桌面验收，未做响应式、移动平板或跨浏览器检查，无严格性能提升结论。整体重构仍 `in_progress`；下一批为工作台样板及长文本、放大、图片工具、性能对比验收。

## 2026-09-08 桌面体验重构第一批（前序）

- 用户确认方案 B 后完成第一批核心正确性（本地 `done`）：T01 测试 Storage 兼容、B01 原请求重试与草稿保护、B02 失败去重与歧义保留、B04 预览隔离、B05 重新生成额度协调。范围、文件、复现和截图见[批次验收记录](./audits/2026-09-08-desktop-batch1.md)及[原始审计](./audits/2026-09-08-desktop-liquid-glass-audit.md)。整体渐进重构仍 `in_progress`，下一批为共享设计变量和组件状态规范。
- 2026-09-08 本地验证：Node 26.3.0 / pnpm 11.19.0；Lint、Typecheck、隔离生产构建通过。Vitest 全量领域 41 通过、Web 332 通过及 1 项异步断言失败；修正等待 UI 条件后唯一失败用例复跑通过。桌面 Chromium 151.0.7922.34 / 1440×900 的 E2E 首轮 29 通过、1 认证条件跳过及 1 新选择器失败，修正中文按钮空格后该完整恢复路径复跑通过；预览路径另复验通过。原始失败日志保留，不称首轮全绿。
- T02 仅更新经人工确认过期的参数面板截图，原空工作台基线继续通过，未放宽截图阈值。新增 12 项纯逻辑/组件测试及 3 项桌面 E2E；审查发现的两项归属问题均补测试并关闭。
- 未部署、未提交 Git、未改依赖/接口/数据库/Worker；没有真实模型调用或真实额度变动。响应式、移动平板、其他浏览器、真实认证和严格性能前后基准未验证。B03/B06/B07、S01/S02 及视觉样板留在后续已规划批次；生产验收边界保持下文记录。

## 2026-09-08 电商体验与女装示例修复（前序）

- 用户确认默认“填写资料后直接生成”，后续明确示例统一改为女装详情相关；同步修订 requirements 11.2。保留旧方案的逐图编辑/保存待确认入口和普通聊天零生图规则。
- 登录展示共用根级 AuthStatusProvider，登录/退出/认证失效与页面焦点刷新同步；`/create` 不再固定渲染登录链接。工作区初始化在同一加载界面完成，显式电商场景隐藏普通聊天与无关骨架，初始化失败提供错误/重试而不回落聊天。
- 会话删除采用 Ant Design Popconfirm；确认后列表 busy 并保留原行，服务端成功后更新。删除成功但列表刷新失败时按已确认结果移除该行，不再次删除。电商配置换为 Ant Design Select 与现有玻璃样式，繁复字段折叠，静态文本隐藏浏览器插入光标，编辑控件与真实流式文本保留必要光标。
- 提示词新增逐角色成品要求，区分白底主图、卖点海报、面料/工艺特写、真实场景、说明模块、模特/种草与参考排版；明确参考图顺序、商品一致性、文字留白和禁止虚构事实，编译版本 `commerce-2`。依据 Senyu 和 awesome-gpt-image-2 的主体/构图/光线/字体方法原创编写，未增加 Provider 或替换用户模型。
- 已用内置 imagegen 生成并目视检查 8 张同款米杏色衬衫女装示例：主图、详情首屏、卖点、面料、通勤场景、尺码说明、种草封面、模特图。资产位于 `apps/web/public/commerce/examples/womenswear/`；[提示词与来源清单](./research/senyu-zimage/womenswear-examples.json)保留生成记录。尺码明确标为示例数据；新路径避免图片优化缓存继续显示旧陶瓷杯示例。
- 真实异常排查：只读核对 `klmiycyesxnpinxpeqep` 中用户 2026-09-08 15:23:58 UTC 的五张白色杯子生成，4 张成功；第 5 张 `7d70d960-a539-49ca-8ffb-40d176d6ee0a` 的 `provider_submission_state=unknown`、`error_code=provider_reconciliation_required`，无 provider request id 与结果 checkpoint，执行工作记录停在 unknown。现有记录不足以判定上游是否已计费/出图，不能通过重发声称恢复。前端现已区分正常提交等待与真正未知结果；未知项显示待核对、禁止普通重试，并降低无效轮询频率。该历史图片尚未恢复。
- 验证：Domain 41/41；全量 Web 318 通过、1 条旧文案断言失败，修正后专项 5/5 通过（包含新入口失败恢复）；删除/入口回归另为 4/4，包括删除成功但列表刷新失败。最终 lint、typecheck 与隔离生产构建通过。浏览器回归发现并修复资料区固定操作栏遮挡点击；复跑的 chromium-desktop 项目 27 通过、1 条真实认证条件跳过。用户随后要求仅测试桌面 Web，已停止尚未完成的移动端执行，不能将原 84 项全量报告记为完成。
- 后续默认回归仅桌面 Web：Playwright 保留 chromium-desktop 1440×900；两条原本在测试内部切换手机尺寸的用例已改为桌面，并重新运行 2/2 通过。该范围写入 Web AGENTS.md；不再默认回归移动和平板。Chrome 真实页面已检查登录展示、资料页、下拉菜单、删除气泡及女装目录；创建会话限流时的入口错误恢复已修复，没有提升额度或删除真实会话。
- 用户明确授权以杯子进行 1 张跨品类实测。通过正常界面复用已有上传参考的“白色杯子”待确认方案，保存 revision 2，仅选择详情首屏一张：`task=8114724f-af82-456d-8aa3-17f58638fe09`、`run=89bd680f-2f58-43e8-add0-3a2b2fe33a0b`、`generation=1d9b9ada-3e86-4f88-9e13-4b94a3e9c382`。Seedream 4.5 于 2026-09-08 16:46:35 UTC 成功，提交状态 submitted、error_code=null；该 run 仅 1 项。实际存储的 commerce-2 提示词未混入女装/衬衫内容。目视成图为完整白色陶瓷杯、米白/浅咖啡背景，标题“白色陶瓷杯”、副标题“日常一杯，自在时光”，无服装或模特污染。这仅证明该单例通过，不代表各品类均已验证。
- 自动化日志归档于本地忽略目录 `.design-qa/2026-09-08/experience-*`；执行 `pnpm lint`、`pnpm typecheck`、`pnpm test:run`、隔离 `NEXT_DIST_DIR=.next-commerce-build pnpm build` 与指向 3110 的 Playwright；最终两项复验使用 `pnpm e2e --workers=1 --grep 'keeps the image composer usable on desktop|keeps the commerce catalogue scrollable'`。
- 本轮未部署站点/Worker、未直接修改云数据库结构或账号配置、未提交 Git。真实写入仅含正常 UI 保存的测试方案及上述授权的一张生成；前序生产验收缺口仍保留，历史未知项待上游核对。内置 imagegen 示例图与 Seedream 单例结果分别记录，不据此声明全站生产就绪。

## 2026-09-08 电商云端同步（前序）

- 本次同步任务 `done`：用户明确回复“开始同步”，已按[同步清单](./plans/2026-09-08-commerce-cloud-activation.md)更新现有项目 `klmiycyesxnpinxpeqep`（PostgreSQL 17.6）。电商功能的付费生成、完整多连接和清理副作用验收仍为 `in_progress`，不据本次同步声明全站可发布。
- 迁移按顺序应用：`20260908043010_phase2_generation_reliability`、`20260908043031_commerce_tasks`、`20260908044934_commerce_reference_history`。MCP 初始生成的远端时间编号已精确对齐本地文件编号，避免后续 CLI 重复判定待迁移；原有 15 份迁移未改动。
- 生成 Worker 从 v11 更新至 v12，清理 Worker 从 v14 更新至 v15，均 ACTIVE；保留既有 `verify_jwt=false` 与函数内 `withSupabase({ auth: ['secret'] })`、`x-worker-secret` 双重入口验证。发布包含各自锁定依赖和相对 `_shared` 文件。
- 发布前队列为空、没有 processing 生成或清理任务。临时暂停 job 1/2，配套更新后恢复既有每分钟生成/每 15 分钟清理调度，两项均 `active=true`。数据库同步前后现有会话 20、批次 18、生成 20、额度记录 36，数量一致。
- 权限核对：新增电商/执行/参考图表启用 RLS；电商 RPC 仅 service_role 可执行，anon/authenticated 不可直接执行。两个 Worker 的无凭据 HTTP 请求均返回 401；领取 RPC 在回滚事务中检查通过，生成领取为空，清理领取返回可清理的旧参考图候选但事务已回滚，未执行 Storage 或账号删除。
- 自动审批拒绝手动 HTTP 触发两个生产 Worker，理由是潜在不可逆的 Storage/账号清理副作用。改用无凭据 HTTP 与回滚事务验证；没有通过其他方式手动触发。原有定时调度已正常恢复，不留维护停用状态。
- Chrome 真实验收：任务 GET 从 503 恢复为 200；继续用户页面现有“白色杯子”资料，参考图上传 `POST /api/uploads` 为 201，`POST /api/creative-tasks` 为 200，保存为任务 `8114724f-af82-456d-8aa3-17f58638fe09`、版本 1、五张分图方案。刷新后仍显示待确认，底部无聊天框，任务加载错误消失。数据库核对 `runs=0`、生成队列为 0、生成总数 20/额度记录 36 未变，保存方案没有触发付费生成。原有橘猫 Seedream 图片仍可读取，浏览器保留在已保存电商方案。
- 验证：正确的 Worker/Provider Vitest 命令 31/31 通过，两个生产入口 `deno check` 通过，`git diff --check` 通过。初次误用 Deno 执行 Vitest 文件失败，已改用 Vitest，不为通过测试修改代码或跳过生产类型检查。本轮只同步既有代码及更新文档；上轮 Web 静态检查、构建与 Chrome 56/25 的证据保留，不重复声明为本轮新跑结果。
- Supabase advisors 未报告新增公开表未启用 RLS：private 表无策略为服务端封装用途。另报告 [public.vector 扩展](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)、[既有账号校验/注销 definer 入口](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) 和[泄露密码防护未开启](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)，本轮没有改动这些既有配置。
- 同步前 Worker 源码快照、部署清单与检查日志保存在本地忽略目录 `.design-qa/2026-09-08/cloud-*` / `zimage-cloud-*`。未部署 Vercel，未提交 Git，未更改账号密码；本次同步没有新增付费图片调用。

## 2026-09-08 电商生图实施（前序本地记录）

- 用户已授权按 v0.2 开始修改；[实施计划](./plans/2026-09-08-commerce-implementation.md)与[验证记录](./plans/2026-09-08-commerce-validation.md)覆盖领域模板、原子执行、统一工作台、底座可靠性与正式文档。此节覆盖下面历史记录中的“未开发/todo”描述，不改变历史验收日期。
- 当前状态：`in_progress`，本地实现与可用的自动化验证已完成，必需真实数据库/模型证据尚未闭环。Node 24.19.0 / pnpm 11.19.0；按 frozen lockfile 安装成功，没有升级 package/lockfile。
- 已实现 `/create` 六场景/三平台/十二原创模板、同工作台向导/旧 Skill 方案确认、逐图修改与版本选图、冻结下载、归档、取消未派发项、受保护的样图转参考；同时补齐任务事务、额度保留、Worker 租约与结果恢复、迟到对象清理。正式 requirements/architecture/tech-selection 已同步。
- 最新已取得证据：Domain 40 项、Worker/Provider 31 项通过；当前三份迁移的 PGlite 顺序回归 293 项与独立旧数据升级 4 项通过。29 项 dblink 并发明确跳过。PGlite 为 PostgreSQL 18.3 + 合成 Auth/Storage/PGMQ，不是目标 Supabase/PostgreSQL 17 验收。
- 最终 lint、typecheck 与隔离目录生产构建通过。Web 全量先为 305 通过/3 测试准备失败；修正异步完成等待后，整个电商 UI 文件 24/24 复验通过，308 个 Web 用例全部取得通过证据。最终完整浏览器回归单次为 53 通过/25 条件跳过（22 项视口条件、3 项真实认证），覆盖桌面、平板与移动端；此前超时和服务连接失败及其复验过程见验证记录。
- 数据库环境仍缺失：Docker daemon socket 不存在，未取得可用的隔离 Supabase 项目；已逐题询问选择。真实认证、迁移/pgTAP、多连接竞争、Storage/Auth 联调、模型效果仍待验。没有远端迁移、发布、付费生成或用户内容删除，也未提交 Git。

## 2026-09-07 电商生图方案与项目复审

- 审查交付：`done`。[挑剔者审查](./research/senyu-zimage/critical-review.md)基于 `bc05783d49645976cbfc54882c4ec8f7ae078e28`，记录 6 项现有代码问题和 3 项方案缺口，逐项给出触发、代码依据、后果与验收要求。代码结论来自静态审查，未在生产复现。
- 用户新增决策：D08 旧三个 Skill 合并为先方案后确认；D09 AI 整图生成、改字重生成；D10 默认采用重做新图、旧图可切回；D11 销售主图/套图/详情图必须上传真实商品图。PRD/技术方案更新 v0.2；首版移除独立文字排版与长图合成，撤回原工期估算，补充选图/导出快照及底座修复前置条件。
- 代码修复与功能开发：`todo`。本轮仅修改研究文档和本账本，正式需求待实施前同步；没有代码、迁移、依赖、部署或线上数据改动。
- 测试边界：四个定向 Vitest 文件因本地缺少 Vitest 未能启动，0 个测试执行；没有新的应用/数据库/真实模型通过证据。既有 236 项通过和 E2E 40 通过/20 条件跳过仍仅为上一轮记录。本地 Node/pnpm 与项目声明版本不一致，未更改工具链。
- 文档验证：6 份研究 Markdown 的 28 个本地链接、31 组表格、代码围栏、敏感内容规则检查通过；`git diff --check` 通过。仅研究文档与本账本发生变化。

## 2026-09-07 Senyu 与 awesome 电商生图调研

- 文档交付：`done`。[文档包](./research/senyu-zimage/README.md)包含 Senyu 产品/技术分析，以及 ZImage 电商生图 PRD/融合技术方案。实际阅读登录后的图片场景、经用户授权的空资产/作品管理、公开前端资源和指定 GitHub 仓库；核实 541 个案例、22 个模板及来源提交。
- 用户已确认：只做生图，面向淘宝、抖音、小红书；新增 Senyu 式电商生图入口，采用场景向导与对话修改，共用现有工作台；先复用现有模型。本次先完成文档再评审开发。
- 功能实施：`todo`。本次没有修改业务代码、迁移或部署配置，没有导入第三方图片、调用收费生成或发布应用。具体 PRD 与技术设计为待评审建议，不替代正式需求，也不提升 Phase 2 的既有交付状态。
- 验证：新增 Markdown 的本地链接、代码围栏、表格列数、来源数据统计、敏感内容检查和 whitespace 检查通过。未重跑应用测试、数据库测试或真实 Provider 验收；不能据此宣称新增入口已可用。

## 审计基线

| 项目 | 当前值 |
| --- | --- |
| 审计日期 | 2026-08-27 |
| Git 基线 | `setup2@64eab6d874a6` |
| 远端对齐 | 本轮不以远端分支或部署状态作为验收前提 |
| 工作区 | 基线干净；本文件与同批实现变更尚未提交 |
| 审计边界 | 本地代码、自动化检查、主/恢复 Supabase 受控写入与现有免费 Provider 验收；不操作 Vercel、不测试真实 Safari、不创建阿里云资源、不升级或充值 |

## 状态与 Done 定义

| 状态 | 定义 |
| --- | --- |
| `todo` | 尚未开始，或仅完成范围确认、没有可验证交付物。 |
| `in_progress` | 已有实现或部分证据，但仍缺少必需验收。 |
| `blocked` | 已有明确前置条件、授权或环境证据缺口，当前不能安全闭环。 |
| `done` | 当前代码、必需自动化验证，以及适用的真实环境证据均已闭环。 |

执行规则：

- 阶段仅在该阶段全部必需任务均为 `done` 后才能标记 `done`。
- 需求矩阵中的 `covered` 只说明需求与实现/验证项建立了映射，不能据此推断交付任务为 `done`。
- 提交标题、已有实现、一次历史测试或本地 mock 结果均不能单独作为 `done` 证据。
- 当代码变化、自动化结果过期、环境漂移或真实证据失效时，状态必须从 `done` 降级。
- 完成任务验收的同一批变更必须同步更新本文件，记录日期、验证命令和适用的真实环境证据。

## 阶段汇总

| 阶段 | 状态 | 当前结论 |
| --- | --- | --- |
| Phase 1A：统一工作区与 mock | `done` | 2026-08-27 静态检查、98/98 Web 与 27/27 Domain Vitest、四项覆盖率 ≥70%、Chromium/Edge/Playwright WebKit mock E2E 全部闭环。 |
| Phase 1B：真实运行链路 | `done` | 2026-08-28 恢复项目迁移、142 条 pgTAP、HTTP/RLS、Doubao、MiniMax 工具路径、Seedream 三单图及 Sentry 三端脱敏事件全部闭环。Free 联合恢复已按用户决定从本阶段移除。 |
| Phase 1C：零费内测门禁 | `done` | 2026-08-28 需求矩阵、全部零费链路、最终回归、临时入口撤销和测试产物检查完成；此状态不代表生产就绪。 |
| Phase 2 | `todo` | 必须在 Phase 1C 全部必需任务 `done` 后重新立项。 |

## 阶段结束判定与剩余工期

| 阶段 | 结束判定 | 当前剩余开发量 |
| --- | --- | --- |
| Phase 1A | lint、typecheck、普通 Vitest、Web/Domain 四项覆盖率均 ≥70%、Chromium/Edge/Playwright WebKit mock E2E 全绿，且测试产物可清理。 | 已完成；无剩余开发。 |
| Phase 1B | 主/恢复项目均为 13 个迁移，8 套/142 条 pgTAP 与生成类型一致；本地真实 HTTP 身份、RLS、上传、Doubao、MiniMax 工具、Seedream 三单图、signed URL 与 cleanup 通过；moderation 与 Sentry 三端脱敏事件通过。Free 联合恢复不属于本阶段。 | 已完成；无剩余开发。 |
| Phase 1C：零费内测 | Phase 1A/1B 均完成，最终证据账本、环境开关、临时诊断入口撤销、工作区与测试产物检查通过。 | 已完成；无剩余开发。 |
| 后续生产门禁 | 真实 Safari、Gemini、1000 条/95% 安全集、双图片 Provider 各 30 次及 P95、Supabase Pro 自动备份、每日独立对象备份、生产部署与回滚全部取得证据。 | 不属于本轮；需在阿里云部署方案确定后另行估算。 |

## 任务账本

### Phase 1A：统一工作区与 mock

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1A-01 | 统一工作区与 mock | `done` | 2026-08-27：测试 Gateway 注入立即完成 delay，生产 mock 的 180/700/900ms 语义未改；`pnpm test:run` 为 Web 98/98、Domain 27/27；`unified-workspace.test.tsx` 为 20/20。Web 覆盖率 89.75/85.64/76.30/89.75，Domain 为 95.83/82.60/72.72/95.83（statements/branches/functions/lines）。 | 代码或测试基线变化时重新运行全部门禁。 |
| P1A-02 | 浏览器矩阵 | `done` | 2026-08-27 `pnpm e2e`：Chromium desktop、Edge tablet、Playwright WebKit mobile 共 15 passed，6 个桌面专属用例按设计跳过。 | 真实 Safari 已移入后续生产门禁，不影响本轮状态。 |

### Phase 1B：真实运行链路

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1B-01 | 主项目迁移同步 | `done` | 2026-08-26 只读复核：本地与主 Supabase 项目均为 13 个迁移。 | 若本地迁移或主项目迁移历史发生变化，立即重新核验并按证据降级。 |
| P1B-02 | 恢复项目同步 | `done` | 2026-08-27 仅向恢复项目依次应用仓库已有的 3 个迁移；主/恢复项目均为 13 个迁移。恢复项目 8 套 pgTAP 共 142 条断言全绿；两项目实时生成类型字节一致，仓库类型仅同步 PostgREST 14.17 版本标记。两项目 Advisor 均无 ERROR，WARN 已按暴露面记录。 | 迁移或项目配置漂移时重新核验；本项不等于联合恢复演练完成。 |
| P1B-03 | 运行基础设施 | `done` | 主项目存在 LangGraph 表、`uploads`/`generated` 两个私有 bucket、`generation-worker`/`cleanup-worker` 两个 ACTIVE Worker；generation/cleanup Cron 最近运行成功。真实图片、Storage cleanup 与 Sentry Edge helper 已分别由 P1B-05/06 完成联合验收；`cleanup-worker v14 ACTIVE`。 | Worker、Cron、Vault/Edge Secret 或 Provider 开关变化时重新核验。 |
| P1B-04 | 匿名身份与聊天 | `done` | 2026-08-27 本地生产模式 HTTP：匿名身份建立/刷新、第二身份跨用户读取与重命名拒绝、1×1 PNG 上传所有权/MIME/尺寸、Doubao 短 SSE 首块/完成/持久化/清理均通过；另取得一次真实 MiniMax 普通聊天响应。 | 身份、RLS 或聊天路由变化时重新验收。 |
| P1B-05 | 图片生成与 Storage | `done` | 2026-08-27 真实 Seedream：MiniMax 显式工具 `source=chat_tool`、直接无参考图、直接带 16×16 受控 PNG 三个单图场景成功；均验证批次/active 资产/signed URL/所有权拒绝/刷新恢复与 cleanup。累计硬上限 5/5：1 次明确未提交、3 张成功、1 次因 1×1 参考图不满足 Provider 最小边长而明确失败；未发生未知结果重试。结束后验收会话、批次、生成、Storage 对象和待处理 cleanup 均为 0。 | 真实图片预算已封顶，本轮禁止再调用；双图片 Provider 各 30 次及 P95 属后续生产门禁。 |
| P1B-06 | 安全与脱敏 | `done` | 2026-08-28 Provider moderation 归一化与原始 prompt/URL/token 不泄漏测试通过。Sentry Developer Free 三端真实事件通过：浏览器 `87022e71135d446e91b11a72452eaf72` / `16b6d502-ae83-44fb-a29b-45eca4bfb98e`，Next 服务端 `d387fa02d7534a54b51f766e94e5ac44` / `41a9db0f-6577-4d3e-b7f4-2e9fab90e3e9`，Edge helper `52f32dc230a5490d88e4a8aaac952cd1` / `b5352834-4ff3-41a6-a718-4ffbf607513e`（event ID / correlation ID）。三者均验证统一脱敏正文、无原始诊断文本、请求、身份或 Geo；组织级 IP/`user.geo` 清理开启，应用与 Edge 使用不可定位地址阻断 Relay 自动推导。临时入口已删除，云端 `cleanup-worker v14 ACTIVE` 且无诊断分支。 | 1000 条/95% 安全集属于后续生产门禁；Sentry 项目/组织清理规则或 DSN 变化时重新验收。 |

### Phase 1C：零费内测门禁

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P1C-01 | 需求状态矩阵 | `done` | 147 个需求 ID 均已归入 `covered`、`deferred` 或 `non-goal`；当前统计为 127 / 5 / 15。 | 需求或映射变化时重新审核；`covered` 不自动提升其他交付任务状态。 |
| P1C-02 | 零费内测证据收口 | `done` | 2026-08-28 本地 lint、typecheck、普通 Vitest、覆盖率、生产构建、三引擎 mock E2E、真实 HTTP/Provider 链路及 Sentry 三端脱敏事件已取得证据；诊断入口已撤销，最终构建路由与测试产物检查通过，不依赖 Vercel 或真实 Safari。 | 代码、云端配置或验收口径变化时重新运行对应门禁。 |

### 后续生产门禁（不计入 Phase 1A/1B 完成）

| ID | 门禁 | 状态 | 完成条件 |
| --- | --- | --- | --- |
| PROD-01 | 浏览器与安全规模证据 | `todo` | 真实 Safari、Gemini、1000 条安全集且准确率 ≥95%、双图片 Provider 各 30 次及 P95。 |
| PROD-02 | 备份、恢复与发布 | `todo` | Supabase Pro 自动备份、每日独立对象备份、数据库与 Storage 联合恢复、阿里云 ECS/Docker/TLS/反向代理、生产发布与回滚演练。Free 项目联合恢复不作为零费内测门禁。 |

### Phase 2

| ID | 任务 | 状态 | 当前证据 | 缺口 / 下一验收 |
| --- | --- | --- | --- | --- |
| P2-00 | 重新立项 | `todo` | 当前没有已批准的 Phase 2 交付范围。 | Phase 1C 全部必需任务 `done` 后再讨论目标、需求、架构和验收计划。 |

### 2026-08-29 Web 统一会话与图片交互改造

- 会话体验：Web 按 `sessionId` 隔离时间线加载、流式回复、临时生图回合和 busy 状态；切换即时高亮并展示消息骨架，失败可原位重试，慢请求不能覆盖当前会话，后台任务在侧栏保留进行中标记。
- 统一输入：移除聊天/生图双模式，单一输入框默认聊天；启用“创建图片”或图片技能后展示参考图与图片设置并调用既有图片接口；Enter 发送、Shift+Enter 换行，输入法合成期间不误发送。
- 会话式生图：提交后立即展示用户提示词和按数量、比例生成的骨架；入队成功无闪烁替换为真实批次并立即恢复输入，失败在原回合重试；直接生图和历史工具生图不重复提示词。
- 图片预览：生成图、助手 Markdown 图片和输入框参考图统一使用 Lobe UI 图片查看器，技能封面不进入会话预览组；保留原有 URL 安全、签名 URL、过期状态和对象 URL 回收规则。
- 范围：本次仅修改和验证 `apps/web` 及对应 Web 说明；未修改或验证 Supabase、Edge Functions、数据库、Provider、共享领域包和其他客户端，也未调用真实图片 Provider 或部署环境。
- 自动化：`pnpm exec eslint apps/web --max-warnings=0`、Web typecheck、Web 生产构建均通过；Web Vitest 20/20 个文件、126/126 个测试通过；Playwright 在 Chromium 桌面、Edge 平板和 Chromium 移动视口下 22 passed / 8 个按设备条件跳过。移动 Web 使用 Chromium 项目，避开当前本机 Playwright WebKit 与 macOS 浏览器二进制的协议不兼容；不据此声明 Safari 或其他客户端已验证。

### 2026-08-30 React 19 element.ref 警告修复（替换 Lobe UI Image 为 antd Image）

- 现象：浏览器控制台持续报 React 19 警告 `Accessing element.ref was removed in React 19. ref is now a regular prop.`，根因是 `@lobehub/ui@5.30.0` 的 `TooltipStandalone`/`TooltipInGroup` 通过 `cloneElement` 读取 `children.ref`，新版 React 已无该 getter（lobe-ui master 分支截至 2026-08-18 5.32.2 仍未修复）。任何渲染 Lobe UI 图片查看器或预览组的页面都会触发。
- 修复：将工作区中三处 Lobe UI 图片（生成图、助手 Markdown 图片、输入框参考图）与对应的 `PreviewGroup` 全部替换为 antd `Image` / `Image.PreviewGroup`（`rc-image@7.12.0` + `rc-dialog@9.6.0`，均已适配 React 19），保留遮罩关闭、`rootClassName` 与样式语义；`UnifiedWorkspace` 中 `PreviewGroup` 改为从 `antd/es/image/PreviewGroup` 直接导入，避免影响 `Image.PreviewGroup` 的复合类型导出。
- 测试调整：`unified-workspace.test.tsx` 原本依赖 lobe-ui 在 Dialog.Popup 上挂 `aria-label={currentEntry.element.alt}` 的实现细节；antd 的 `Image.PreviewGroup` 不会向 dialog 写入 alt，因此把“打开预览”断言改为按 `role="dialog"` 等待并校验 dialog 内 `<img>` 的 `src`，关闭预览同步改为按 `role="dialog"` 等待消失。
- 范围：仅修改 `apps/web/features/workspace/{WorkspaceTimeline,AssistantMessageContent,UnifiedComposer,UnifiedWorkspace}.tsx` 与 `apps/web/tests/unified-workspace.test.tsx`；未改 Supabase、Edge、Provider、共享领域包或部署。
- 自动化：`pnpm typecheck`、`pnpm lint`（eslint `--max-warnings=0`）、`pnpm build` 均退出码 0；`pnpm test:run` 在 `tests/unified-workspace.test.tsx` 上 33/34 通过，唯一超时用例 `clears image inputs and re-enables submission before post-queue refresh completes` 在 15 秒默认 `testTimeout` 下因累计执行时间触发，单跑 8.2 秒通过，属于先前就存在的时间预算问题，与本次变更无关，不阻塞本次修复。

### 2026-08-28 聊天生图与单图重建缺陷修复

- 实现：初始化时从健康状态非 `unavailable` 的图片 Provider 中选择首项；聊天图片工具只在明确出图意图时预检图片 Provider，普通聊天仍只受聊天 Provider 约束；时间线单图重建完整透传 `generationId`；HTTP Gateway 不再显示 Mock 场景控件。
- 浏览器验收额外发现并修复：`recreate_image_generation` RPC 已成功创建批次后，严格公开响应 schema 因内部 `deduplicated` 字段返回 400；现统一摘取 `{ batchId, sessionId, status }`，未修改数据库、迁移或公开 API schema。
- 自动化：`pnpm lint`、`pnpm typecheck`、`pnpm test:run`、`pnpm build`、`pnpm e2e` 均退出码 0；Web Vitest 108/108、Domain Vitest 27/27；Playwright 15 passed / 6 个按设备条件跳过。
- 内部浏览器（`http://localhost:3000`，HTTP 模式）：Mock 控件计数为 0；聊天工具请求携带 `imageProvider=seedream` 并生成 1 张 `seedream-4.5` 图片；普通聊天前后图片批次卡片保持 4→4；单图重建请求携带具体 `generationId` 且返回 HTTP 202；控制台 error 为 0。Gemini 未进行真实调用，既有 Next Image LCP 警告按范围保留。
- 验收副作用：原计划最多新增 2 个真实 Seedream 任务；第一次单图重建的 HTTP 400 发生在数据库已写入批次之后，修复后重试又创建一批，因此本轮实际新增 3 个成功任务，额度显示由 29 降至 26。未擅自删除这些验收数据，后续禁止继续调用图片 Provider。

## 高优先级风险

> **费用硬停止：** 2026-08-28 用户批准的缺陷验收已结束；因一次“数据库成功、HTTP 响应序列化失败”的隐藏写入，本轮实际新增 3 个 Seedream 成功任务，额度由 29 降至 26。后续不得继续调用 Seedream 或新增图片 Provider；Gemini 必须保持 disabled。

## 下一阶段执行顺序

1. Phase 1A、Phase 1B 与零费 Phase 1C 已完成；后续代码或云端配置变化时按对应门禁复验。
2. 阿里云 ECS、Docker、TLS、反向代理、生产联合恢复与回滚另立计划。
3. Phase 2 可以重新立项，但不得把后续生产门禁误报为已完成。

## 2026-08-27 零费内测证据快照

- 本地门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test:run`、`pnpm test:coverage`、`pnpm build` 均退出码 0；Web 98/98、Domain 27/27，四项覆盖率均 ≥70%。
- 浏览器：`pnpm e2e` 在 Chromium desktop、Edge tablet、Playwright WebKit mobile 上 15 passed / 6 skipped；不要求真实 Safari。
- Worker/Provider：图片 Provider adapter 9/9，Chat adapter 与 Edge 依赖 9/9；moderation 归一化与脱敏用例通过。
- Supabase：主/恢复项目均 13 个迁移；恢复项目 8 套/142 条 pgTAP 全绿；实时类型字节一致；Advisor 无 ERROR。
- 真实 HTTP：身份/RLS、1×1 上传、Doubao SSE、MiniMax 普通聊天与显式工具路径、Seedream 三个单图场景取得证据；所有验收实体与 Storage 对象清理为 0。
- 2026-08-28 Sentry 三端真实脱敏事件已通过，事件 ID 与 correlation ID 见 P1B-06；临时本地/Edge 诊断入口均已撤销。
- 2026-08-28 用户决定从零费内测范围移除 Free 联合恢复；未安装 Docker/`pg_dump`、未配置恢复项目服务端密钥不再阻塞 Phase 1B/1C，但不得据此声明生产恢复、RTO 或 RPO 已验证。
- 2026-08-28 永久代码回归：`pnpm lint`、`pnpm typecheck`、`pnpm build` 均退出码 0；最终路由清单无诊断入口；Web 99/99、Domain 27/27 Vitest 全绿。

## 2026-08-26 证据快照

以下是本次账本初始化使用的快照，不替代后续任务自己的验收记录。

### 本地仓库

- Git：`setup2@80db326d8c34`，审计开始时与 `origin/setup2` 一致且工作区干净。
- 代码清单：13 个数据库迁移、13 个 API route、Web 97 条 Vitest、Domain 27 条 Vitest、142 条 pgTAP 断言。
- 2026-08-26 本次实现验证：`pnpm lint`、`pnpm typecheck`、`pnpm test:run` 和 `pnpm build` 退出码为 0；普通 Vitest 为 Web 97/97、Domain 27/27。
- `pnpm test:coverage` 退出码为 1：Domain 27/27 通过且语句/行覆盖率为 95.83%；Web 为 87/97，通过前 17 个文件，`unified-workspace.test.tsx` 在覆盖率插桩下 10/20 失败，主要原因是测试超时。因此没有形成完整 Web 覆盖率结果。
- `pnpm e2e` 退出码为 1：Playwright 的 3100 mock 服务器因同目录已有 Next dev（PID 74688、端口 3000）占用单实例锁而无法启动；未结束用户现有服务器，也未形成浏览器测试结果。
- 当前没有任何被 Vitest、Playwright、pgTAP 或 CI 发现机制使用的测试文件符合删除条件。

### Supabase（只读复核）

- 主项目 `image-web` 为 13 个迁移；恢复项目 `image-web-restore-drill` 为 10 个迁移，落后 3 个。
- 主项目存在 LangGraph 表、两个私有 bucket、两个 ACTIVE Edge Worker 和两个最近成功的 Cron。
- 匿名用户 16 个、会话 3 个、时间线消息 13 条；generation batch、generation、reference upload 和相关 Storage object 均为 0。
- Provider 健康样本不足：Doubao 1 个、MiniMax 1 个、Seedream 2 个且包含错误，不能作为 Provider 验收完成证据。

### Vercel 与外部验收（只读复核）

- 当前团队下未发现 Vercel 项目，因此 Preview 和远端发布验收保持 `blocked`。
- 本次审计未取得可关闭任务的 Sentry replay、真实 Safari、远端 CI、性能、备份或联合恢复证据。

## 历史证据索引

以下文件继续保留为范围、设计或历史交付证据；当前状态以本文件为准。

- 产品与技术边界：[`requirements.md`](./requirements.md)、[`tech-selection.md`](./tech-selection.md)、[`architecture.md`](./architecture.md)
- Phase 1 运维入口：[`delivery/phase1/operations-runbook.md`](./delivery/phase1/operations-runbook.md)
- Phase 1 历史快照：[`project-survey.md`](./delivery/phase1/project-survey.md)、[`technical-design.md`](./delivery/phase1/technical-design.md)、[`review.md`](./delivery/phase1/review.md)、[`verification-report.md`](./delivery/phase1/verification-report.md)、[`change-log.md`](./delivery/phase1/change-log.md)
- 已批准实施计划：[`2026-08-24-phase1-web.md`](../docs/superpowers/plans/2026-08-24-phase1-web.md)

## 维护要求

- 任务证据闭环时，在同一批变更中更新任务状态、验证日期、命令/运行记录和适用的真实环境证据。
- 阻塞项解除后先完成验收，再将 `blocked` 改为 `in_progress` 或 `done`；不得只因开始工作而移除阻塞记录。
- 保留历史交付记录用于审计，不在历史文档中维护“当前状态”。发现历史描述与运行现状冲突时，以本文件和最新可复核证据为准。
- 不从需求覆盖率、提交标题、文件存在、资源存在或旧报告推断 `done`。

## Phase 2（本轮实现审计，2026-09-06）

| 任务 | 状态 | 证据与缺口 |
| --- | --- | --- |
| 会话隔离、幂等提交、分页恢复、断流保留 | `in_progress` | Domain 27/27、Web 154/154，包含 `session-drafts`、gateway reliability 与组件回归；真实 HTTP 与浏览器全量证据仍待补。 |
| Supabase 原生账号闭环、注销与清理 | `in_progress` | 认证路由、账户页、迁移、worker 和 pgTAP 草案已实现；目标 Node 类型检查通过。Docker 不可用、Supabase CLI 二进制缺失，数据库隔离验收暂不能执行；真实 SMTP 不在本轮。 |
| 官方 Skill 页面与自然语言方案 | `in_progress` | 公开 `/skills` 列表/详情、版本化公开 registry、发送前可编辑方案已实现；视觉识别、持久待补充任务、事务入队和跨设备恢复仍待实现。 |
| 冗余参考资料整理 | `todo` | 已识别 `doc/lobehub` 与 `doc/LangGraphPj`，待记录版本/hash 后移至项目外参考目录。 |
| BUG 清单 | `in_progress` | 见 `doc/phase2-implementation.md` 与新增回归测试；浏览器全量回归、真实权限和窄屏验收待补。 |

本轮不将“代码存在”视为完成；只有完整静态检查、测试、构建、浏览器回归及隔离数据库权限证据齐全，才可标记 Phase 2 代码与隔离验收完成。

### 2026-09-07 邮箱验证码修复（Edge，找回邮件收件已验证）

- 根因已复现：21:11:32 的 Supabase Auth `POST /recover` 返回 HTTP 400，日志为 `captcha protection: request disallowed (no captcha_token found)`（日志 ID `6cc8003f-29f8-4cba-ad61-a4e0f38bb008`）。正式邮箱页面未渲染 Turnstile、请求契约及服务层没有传递 CAPTCHA，错误又被误报为普通发信失败。
- 已修复登录、注册、找回、注册验证码重发及工作区登录弹窗的 CAPTCHA 链路；缺少验证时先阻止请求、不消耗应用尝试额度，令牌在发送后清除，过期可重新验证。Supabase `captcha_failed` 统一返回安全验证提示，保留中性账号响应和云端安全防护。
- Edge 真实验证：向用户指定的 QQ 邮箱发起找回请求后，21:23:05 的 Supabase `/recover` 返回 HTTP 200 `User recovery requested: request completed`（日志 ID `ebb42f30-beeb-452e-8b56-7970500b1e5c`）；阿里云杭州 DirectMail 同时间记录为「成功 / 250 Send Mail OK」，21:30 刷新查询仍成功。发件人为 `zimage@auth.zimage.store`，标题 `Reset your password`。用户起初反馈暂未收到，随后按发件人查找后明确确认已找到含验证码的邮件，实际收件已验证；验证码未写入日志或项目文件，未用它修改密码。
- 云端核对：SMTP 为 `smtpdm.aliyun.com:465`，发件人及用户名正确，真实投递已验证 SMTP 可用；发信域名 `auth.zimage.store` 验证通过。注册和找回模板均包含 `{{ .Token }}`，OTP 为 6 位、有效期 3600 秒。没有保存 Supabase 或阿里云配置修改，也没有修改用户密码。回信地址使用未验证的 `.com` 域名，未发现它导致本次失败的证据。
- 独立注册阻塞：本地缺少 `APPROVED_LEGAL_VERSION`，注册入口禁用、接口返回 HTTP 503（correlation ID `fa49089f-9e86-49bf-8715-6f5dffdfd2aa`）；条款和隐私页面仍为未批准草案，未伪造批准版本。指定测试邮箱已验证，不能用它重发注册确认来证明新注册投递。新账号注册验收尚未进行。
- 当前本地 Turnstile 公钥为官方测试公钥，页面明确显示「仅用于测试」；该配置在此次真实发信中被云端接受，不能据此宣称生产人机防护已验收。正式上线需要匹配的生产公钥和云端密钥。
- 自动化：新增 CAPTCHA 接口与组件回归共 18 项，修复前全部失败、修复后通过；加上既有认证回归，共 7 个文件 48/48 通过。`pnpm lint`、`pnpm typecheck` 通过。全量 `pnpm test:run` 的 Domain 27/27 通过；Web 暴露既有 `verified-user.test.ts` 1 项失败（缺失 RPC 期望 503，实际 401），单独重跑复现，相关实现和测试无本次变更；工作区组件测试持续运行超过 5 分钟后中止，未取得全量通过结果。
- 浏览器全量回归 `pnpm e2e`：3 通过、6 跳过、12 失败；失败快照停在登录页，而既有用例期待可直接进入匿名工作区，与当前正式认证配置不符。未通过修改登录门禁来使旧用例通过。生产构建在清除本次沙箱错误缓存并允许本地子进程后通过（`NEXT_DIST_DIR=.next-build-auth pnpm build`），共生成 31 个静态页面。
- 当前状态：应用漏传 CAPTCHA 的缺陷已修复，找回邮件的真实发信、服务器投递和用户收件闭环已完成；新注册、生产 CAPTCHA 及整站发布门禁仍为 `in_progress`，不宣称全部账号流程或工作区可发布。


### 2026-09-07 整站回归与浅色毛玻璃优化

- 本轮本地功能修复与样式验收通过；Phase 2 真实环境全量验收仍为 `in_progress`，不据本地 Mock 结果宣称云端全部就绪。
- 已修复：身份 RPC 缺失错误从误导性 401 改为可重试 503；账号页区分过期登录与服务故障；账号网络失败/退出失败反馈及重复提交保护；Skill 方案编辑时重复追加用户要求；公开技能“立即使用”忽略技能参数；无会话首次提交重置生图设置；公开长页面被全局滚动锁截断。
- 下载修复：跨域图片的 `download` 属性会被浏览器忽略，旧实现可能离开工作台。现先读取 Blob，再触发本地下载，限制重复点击、30 秒请求超时、回收临时 URL，失败给出重试提示。浏览器使用拦截的跨域测试图片验证下载事件、文件名和工作台 URL；没有借此访问真实 Storage 地址。
- 样式：用户选择浅色毛玻璃。已统一暖白背景、半透明侧栏/输入区、细灰边框、Apple 系统字体及蓝色强调；根据 Superdesign 参考稿调整紧凑图标卡片。共享变量覆盖工作台、技能、登录及账号页，并保留减少动态效果及减少透明度偏好；修正手机资产库按钮图标被文字隐藏规则连带隐藏的问题。
- Superdesign：已登录，项目 `6a07303a-f366-4c42-aa30-53b2566c8106`，参考稿 `beb81171-33cc-4800-9b03-b6dd3864adc7` v1，消耗 3 credits。源码上传被自动审批拒绝后，改用通用布局与用户风格描述生成参考稿，无源码附件；这不是当前页面的精确还原。设计画布：https://superdesign.dev/teams/53a46930-4221-468b-be52-83154fabc708/projects/6a07303a-f366-4c42-aa30-53b2566c8106 。
- 浏览器自动化：Chromium 1440×900、Edge 1024×768、Chromium 390×844，全量 40 通过、20 按设备范围跳过；随后跨域下载及最终视觉截图专项 3/3 通过（其中 2 项为重复视觉检查）；最终未更新基准的桌面截图与手机图标专项再验 3/3 通过。覆盖聊天/换行、图片数量 1–4、参数、参考图、会话增删改、失败重试、刷新恢复、技能入口、公开页面滚动与未登录跳转。Mock 服务显式关闭正式认证开关并使用独立构建目录，没有修改实际登录门禁。图片 Esc 检查等待入场动画结束后单次按键通过。
- 测试稳定性：原同文件 35 项工作区测试在长序列中逐步变慢，完整运行剩 4 项超时；其中最慢两项独立复测通过（21.4/30.1 秒，原整组中 87.1/116.9 秒）。现按功能分成 5 个隔离文件，35 项测试正文逐字校验未删改；共享测试夹具，最终并发上限降为 1、统一单项预算 60 秒。另将流式中间帧测试的 100 毫秒定时等待改为可手动释放的帧屏障，保留原有断言；最终全量 `pnpm test:run` 退出 0：Domain 27/27、Web 209/209（Web 38 个文件），合计 236 项；本机 Web 运行耗时 789 秒。没有通过删除断言或放宽业务预期来取得通过结果。
- 最终静态检查：`pnpm lint`、`pnpm typecheck` 已通过；最终 `NEXT_DIST_DIR=.next-build-qa pnpm build` 退出 0。构建与测试的输出目录隔离于用户正在运行的 3000 服务，已还原生成的 `next-env.d.ts`。
- 真实环境：在现有登录态通过 Edge 完成 1 次聊天，收到“聊天连接正常”；完成 1 张 Seedream 4.5、1:1、2K 陶瓷杯测试图，状态成功，额度从 30 到 29；预览及刷新后聊天/图片记录保留已验证。未额外生成更多真实图片。
- 尚未闭环：真实图片下载的 Supabase 域名访问被自动审批拒绝，已发交互卡片等待授权；新账号注册按用户交互卡片确认，本轮记录为“待验收”；缺少已批准法律版本配置的前置条件仍保留，后续具备批准版本后再验收（延续上一条认证记录）；本轮没有真实 Safari、数据库隔离、所有服务商或远端发布验收。资产库入口仍为既有规划占位，不计为已实现功能。

本轮验证日志保存在本地忽略目录 `.design-qa/2026-09-07/`；最终界面截图在 `apps/web/e2e/unified-workspace.spec.ts-snapshots/`。本轮未发布、未修改真实账号资料/密码，也未删除真实验收会话。


### 2026-09-08 普通生图路由修复与 Superdesign 浅色玻璃改版

- 用户确认本轮仅完善浅色风格，隐藏官方 Skill，并明确授权向 Superdesign 传输列出的 10 个前端文件/片段。未传输环境文件、密钥、用户数据或电商服务端代码。
- 修复普通工作区误进入电商流程：初始化不再依赖官方 Skill registry；旧 `?skill=...` 参数和残留 Skill 状态不再影响聊天/图片提交。电商向导只由有效 `?scene=...` 显式入口启动；没有电商任务或草案时，普通编辑文字不会被电商编辑器拦截。保留电商任务的上下文修改和生成前确认。
- 隐藏工作台、输入区、移动配置中的官方 Skill；旧 `/skills` 与详情页跳转到 `/create` 场景目录，不自动创建任务。保留底层兼容契约与用户会话数据。
- Superdesign 在既有项目中创建源码支撑的基线，再迭代并导入最终参考稿；活动设计 `9e610844-ad0f-4286-98cb-527ad9bbc05f` v3。参考预览：https://p.superdesign.dev/draft/9e610844-ad0f-4286-98cb-527ad9bbc05f 。本地实现统一蓝白玻璃变量、浮动侧栏、输入区、消息气泡、电商目录和向导；增加可编辑灵感气泡、弹窗入场/按压反馈、关闭按钮与 Escape 焦点恢复，保留减少动态和透明度偏好。
- 浏览器预览遵循用户选择，使用 Codex 侧边栏；已检查实际工作台、灵感填入、设置弹窗和电商目录/显式场景向导。Mock 服务运行在独立的 3108 端口与 `.next-glass-review` 目录，未改变实际登录门禁或进行付费生图。
- 自动化证据：最终 `pnpm lint`、`pnpm typecheck`、`NEXT_DIST_DIR=.next-glass-build pnpm build` 均退出 0；首轮完整单测 Domain 40/40、Web 304/309，5 项失败包含 3 项超时、1 项参数关闭实现尚未加载、1 项灵感点击的初始化竞态，另有 worker 通信超时。独立复测 42/43 通过，唯一保留失败定位到初始空态先于会话加载呈现；已改为初始化期间展示加载状态并禁用输入，补充延迟初始化断言后专项 3/3 通过。完整浏览器回归首轮 53 通过、25 按设备/后端条件跳过、3 项超时/加载等待失败；单进程专项随后 11 通过、4 按设备范围跳过，包含全部失败用例及最终桌面截图更新。未放宽业务断言、超时或登录门禁。本轮未重跑完整 309 项单测至单次全绿；所有首轮失败项均已有独立通过记录。真实 HTTP、账号和云端任务全量验收延续既有状态，不据本地 Mock 结果声明全站可发布。
- 本轮日志与实际桌面/手机截图保存在本地忽略目录 `.design-qa/2026-09-08/`，最终视觉基准在 `apps/web/e2e/unified-workspace.spec.ts-snapshots/`。未部署、未改动真实账号资料或删除真实会话。
- 最终未更新截图基准的浏览器复验 4/4 通过（普通聊天、旧 Skill 链接下普通生图、桌面空态、参数弹窗），退出 0；生产构建生成的 `next-env.d.ts` 已还原。

### 2026-09-08 Seedream 真实排查与电商表单交互

- 原 3108 是上一轮的 Mock 预览。用户在其中看到的 Seedream 标签不代表真实 Provider 调用；已明确告知并添加仅在 Mock 环境显示的“模拟预览 · 不调用真实模型”标识。按用户指示将 `apps/web/.env(1).local` 改名为忽略的 `.env.local`，3108 改为 HTTP 与真实登录，Mock 回归独立使用 3109。没有记录或传输配置密钥。
- 修复生图分流：开启创建图片后，普通画面描述直接进入图片队列；明确只讨论、写提示词、规划或否定生图的内容保留聊天路径。新增 Seedream 4.5 参数和电商模式隔离测试先失败后通过（2/2）。
- 来源错误实证：浏览器 Origin 为 `http://127.0.0.1:3108`，Next.js 的 Request URL Origin 被标准化为 `http://localhost:3108`，导致登录/找回在账号验证前返回 403。本地精确白名单补入 127.0.0.1:3108；同源空请求从来源错误进入参数校验，外部来源仍返回 403。示例配置补充说明，来源校验逻辑未放宽。临时来源诊断日志代码已移除。
- Chrome 使用用户指定的 `http://localhost:3108/`，已有有效登录态，无需更改密码。真实 Seedream 4.5 / 1:1 / 2K / 1 张生成成功，提示为窗边橘猫摄影；`POST /api/image` 返回 202，额度 30 → 29，刷新后图片仍可查看。批次 `6f9890bd-d5bf-4067-8f99-955d59ef9b87`，生成 `9307917f-ab5f-46db-b96b-5e25ada0906f`，云端只读核对 `status=succeeded`、`asset_status=active`。本轮仅新增这一张真实图，保留验收会话与结果。
- 根据 Chrome 实际浏览的 Senyu 商品套图交互，电商模式移除底部聊天输入框和“在对话中修改”入口，采用左侧资料/步骤/操作区、右侧分图结构与方案编辑区；取消草案或进入普通新对话恢复输入框。保留逐图修改、保存后确认、只重做所选图片和历史导出。关闭电商表单的聊天自动跟随滚动，首次进入停在顶部，保留普通聊天跟随逻辑；滚动专项 6/6。
- 真实云端电商仍未就绪：当前项目迁移停在 `20260907111328`，`public.commerce_tasks` 和 `public.commerce_dispatch` 均不存在，`GET /api/creative-tasks` 实际返回 503。界面错误补充电商上下文，不阻断普通生图。尚未应用数据库迁移或发布 Worker；具体待同步范围见 [`2026-09-08-commerce-cloud-activation.md`](./plans/2026-09-08-commerce-cloud-activation.md)。
- 自动化结果：Domain 40/40；完整 Web 单测 310/312，包含电商 UI 24 项与新增分流测试通过。两项失败分别为依赖初始化空态闪现的旧会话用例、全量进程已加载的旧滚动实现；已修正等待条件并在最终实现上专项复验 7/7（另外 6 项按筛选跳过）。本轮未重跑全部 312 项到单次全绿，不据专项结果改写首轮记录。
- 最终 `pnpm lint`、`pnpm typecheck`、`NEXT_DIST_DIR=.next-glass-build pnpm build` 和 `git diff --check` 通过；完整 `pnpm e2e` 使用单进程 Google Chrome 覆盖桌面/平板/手机，共 56 通过、25 按设备/后端条件跳过、0 失败。日志沿用项目名 `edge-tablet`，但本轮通过临时配置将所有项目 channel 改为 `chrome`，不计 Edge 验收。最终桌面截图不更新基准复验 2/2 通过。
- 日志及当次 Chrome 配置归档于本地忽略目录 `.design-qa/2026-09-08/`（`zimage-form-*`、`zimage-modes-*`、`zimage-scroll-*`）。临时测试配置移除，构建生成的 `next-env.d.ts` 还原。真实 HTTP 服务保留在 3108，未部署站点、未修改账号密码、未删除真实验收数据。

### 2026-09-13 会话分类、模板一致性、小红书海报与文字优化

- 状态：代码、原创预览与本地桌面功能验收已完成（跨轮复验，非全量单次全绿）；真实模型效果、生产迁移及发布仍为 `in_progress`。本次保留现有未提交改动，没有创建提交或修改生产环境。
- 会话：新增批量类型摘要、全部/聊天/普通生图/电商生图/小红书海报筛选，按记录识别混合类型；新增图标与轻玻璃徽标，沿用共享焦点及减少透明度变量。缺少新 RPC 的旧部署仍可读取旧会话列表。
- 模板：18 个模板升级 2.0.0，编译器 `commerce-3` 按任务、事实、参考职责、角色布局、模板、准确文案和限制组织提示。白底主图只显示白底模板；缺少角色样图时显示布局说明。保存编辑创建新版本，历史提示词、执行记录和结果保留。
- 海报：新增 `/create` 及侧栏入口，复用 `/`；通用内容可无图，商品种草必需商品图。默认 3:4/2K/1，支持 1–8 张，按原文拆分并保留自定义逐图文案；不足内容或单图超 1000 字符给出补充/精简提示。
- 文字优化：新增 `/api/creative-text/optimize`，使用当前聊天模型（默认豆包），验证登录/来源/模型/长度及聊天预览额度；不产生会话消息或图片请求。逐字段优化、建议应用、一次撤销、取消及旧请求保护。审查后补齐字段语义切换隔离、上游启动后失败/取消不退回预览额度。
- 资源：18 张原生 imagegen 原创预览，6 张经视觉复查重新生成修正。完整提示词、版本、尺寸与 SHA-256 见 [预览资源清单](assets/creative-previews/README.md)。预览总大小约 1.5 MB；预览不是应用内模型质量通过的证据。
- 数据库：新增 `20260913082732_commerce_xhs_poster.sql` 和 `20260913090000_session_activity_summary.sql`，不修改历史迁移；隔离 PGlite 18.3 / PostgreSQL 测试 166 项通过，含原电商 131、海报 29、会话摘要 6。使用合成 Auth/Storage/PGMQ，不等同真实 Supabase 双连接、Worker 或生产兼容性验收。
- 本地检查：最终 lint、typecheck 通过。完整单测 Domain 46/46、Web 381/387，6 项失败集中于运行期间新增的文字优化测试；取消信号改为 Node 原生后，最终代码专项 30/30（包含全部 6 项失败）通过，Domain 46/46 复验通过。没有再次运行全量单测到单次全绿。
- 桌面 Chromium E2E：首轮 42 通过、1 因真实认证后端范围跳过、6 失败。修正目录数量/文案、显式选择商品模式、多卡先切换编辑项；桌面定位断言改为等待有限入场动画结束，仍要求操作区位置完全不变。全部 6 项失败经专项复验通过，终轮 4/4 通过，含 1280/1440/1920 与海报单张完整流程；三卡逐图重做、旧版本切换及三张下载也已通过。保留原截图基准，未放宽比对阈值。最终工作台截图已人工查看，侧栏类型与按钮可见。
- 构建：首次沙箱编译停滞，核对父进程与 cwd 后只终止本轮进程；允许本地子进程后生产构建退出 0。最后文字修正后的生产构建复验同样退出 0，构建自动生成的 `next-env.d.ts` 路径已还原。日志与截图保存在 `.design-qa/2026-09-13-creative/`。运行环境 Node 24.16.0 / pnpm 9.15.9，低于仓库声明 Node >=24.19.0 / pnpm 11.19.0，未更改依赖或掩盖版本警告。
- 下一步：本地通过后审阅两项迁移和前后端改动，另行确认生产迁移/发布；登录后的应用内真实模型按输入、模板预览、输出三者对照检查商品还原、构图、配色和字级，保留单独证据。

### 2026-09-13 统一电商入口与女装预览

- 状态：本次入口合并与女装预览的本地实现及桌面专项验收 `done`（2026-09-13）；全量 E2E 为跨轮复验，非最终单次全绿。生产发布与真实模型效果不属于本次验收，未修改生产环境。
- 入口：侧栏仅保留电商生图，`/create` 使用“选择生图类型”，提供七类入口并区分照片套图与图文海报。海报仍支持通用内容和商品种草，原场景链接兼容。
- 会话：前端将 `poster` 投影到电商分类，合并筛选和徽标去重；底层活动类型、任务场景及数据库保持兼容。
- 资源：七类封面恢复原女装套图；18 张模板预览统一米杏色衬衫题材（1 张复用、17 张原生 imagegen 生成，其中 3 张视觉复查后重生成），共 3,416,096 字节。版本化 WebP 与提示词见 [女装预览清单](assets/creative-previews/womenswear-manifest.json)。模板规则不改，样图不进入用户生成请求。
- 验证：最终 lint、typecheck 通过；全量单测 Domain 46/46、Web 387/387 单次全绿。首轮桌面 E2E 50 通过、1 个真实认证后端用例按范围跳过、1 个新增导航用例因顶栏/侧栏同名链接定位不唯一失败，已限定侧栏定位。生产构建退出 0（编译 35.4s，TypeScript 25.8s）。第二轮完整桌面 E2E 50 通过、1 跳过、2 失败：新增导航测试误断言启动参数永久保留（工作台初始化后按既有逻辑清除），以及既有预览关闭动画在 3 worker 并行时超时。导航改为检查启动链接与实际表单，保持清除参数行为；预览关闭未改产品代码或放宽断言。最终串行专项 5/5 通过，包含七类完整导航、全部女装资源与放大、陶瓷杯方案无女装污染、三宽度编号不遮图、跨会话预览关闭/切换及草稿保留。未再次将全量 E2E 跑到最终单次全绿；并行动画偶发超时保留为稳定性观察项。
- 视觉：已人工查看 1280/1440/1920 目录截图与工作台截图；全部 18 张模板加载、contain、放大与陶瓷杯方案不含女装内容的 E2E 通过。发现工作台编号遮挡图片顶部后增加 44px 独立编号区，并新增三种宽度下编号不覆盖图片的测试，终轮通过；已人工查看修正后的三宽度海报预览截图。
- 日志目录：`.design-qa/2026-09-13-unified-commerce/`。运行环境仍为 Node 24.16.0 / pnpm 9.15.9，低于仓库声明版本；没有更改依赖。

- 收尾：保留原截图基准，未放宽截图阈值；还原构建/测试自动生成的 `next-env.d.ts` 路径。最终截图与日志位于上述目录的 `e2e-focused-results/`、`e2e-second-results/`，完整单测日志为 `test.log`，构建为 `build.log`。保留现有全部无关未提交改动，未创建提交。

### 2026-09-24 五条电商生图流程重构

- 状态：五条流程已合并并发布至生产站点，数据库迁移、Worker 发布和云端权限核对完成；真实模型输出与生产端到端结算仍为 `in_progress`。本轮没有消耗本项目的真实生图积分。参考站调研另记：Edge 实测 AI 商品图得到 4 张候选，消耗 8 美豆；套图失败并退款。详情策划、复刻、批量与下载配置已观察，未把未生成的效果标为验证通过。
- 实现：五条主入口接入现有工作台；旧七场景及历史任务保留在“更多创作”。方案契约扩展平台/地区/语言、最多 6 张商品图、20 张复刻图、20 张套图结果、16 模块／32 张双版本 A+、卖点版式及文案。复刻按单参考图调用；独立任务保留版本选择、重做、失败处理及积分确认。新增公开 HTTPS 图片导入、精确尺寸裁切、单图／长图／ZIP 导出和最多 20 商品的即时批量契约及幂等推进接口。批量沿用每会话 64 张历史参考图和现有每日上传 guard，提交前检查当前会话容量；不能将 20 项都按单项最大图片数叠加。
- Edge 桌面本地 Mock：套图 7 张生成、单改第 3 张保留旧版本；普通 A+ 六模块策划、编辑文案、结果与导出入口；两参考图复刻独立要求；AI 商品图 2 候选、背景参考与原图对比；即时批量报价确认、逐项进度、刷新恢复；缺图提示与公开链接失败后的保留链接／手工上传提示。另在现有本地真实账号页面验证批量第二商品单独改用 Gemini 3 Pro Image 后，预计费用由 4.20 变为 7.70 积分，第一商品仍继承 Seedream 4.5。Mock 结果不证明真实模型效果或结算。
- 自动化：Domain 61/61、Web 完整复跑 480/480、Worker 27/27、预算保护 5/5，Lint、Typecheck 和本地 Webpack 生产构建通过。PR #2 的 CI 质量与数据库检查全绿；主分支 [发布流水线 #29](https://github.com/zhYAO/Image-web/actions/runs/35952647357) 的质量、数据库、生产构建及部署四个作业全部通过。
- 发布：生产 Supabase 应用了 `20260923154547_ecommerce_workflows` 迁移；`creative_batches` 表已存在且启用 RLS，认证用户可读自身记录、不可直接插入，服务角色可写。`generation-worker` 更新至 v13 并保持原入口鉴权。主分支合并提交 `ae52814` 经阿里云不可变发布流程部署成功。Edge 桌面实测生产站点五个入口均可打开，商品套图可上传项目公开示例图，显示 7 张／2.10 积分报价，平台、地区、语言和四类数量设置可展开；未按下付费生成。
- 验收边界：本机无 Docker／Podman、PostgreSQL 或 Deno 运行时；隔离数据库检查由 CI 完成，生产 RLS 已核对。未执行本项目真实付费模型输出、失败退款、批量下载及长图像素检查；这些仍需按实际消费和结果分别验收。浏览器仅用 Edge 桌面端，未恢复已移除的浏览器 E2E 工程。


## 2026-10-28 字体外置阶段（本地实现，未发布）

- 网页保持系统字体；服装 Sharp 保留原 Noto Regular/Bold 字节、字体族、字重和布局。OTF 已从工作区移除，原许可/来源移至 doc/licenses/apparel-noto/；既有暂存改动保持不变，未提交。
- 运行时仅接受成对 ZIMAGE_SHARED_FONT_DIR / ZIMAGE_STATIC_ASSET_SHA256，校验版本目录、实际清单、两字体和原许可/来源；缺失时给出 ops/aliyun/FONTS.md 指引，不自动下载或回退。
- 独立资源打包需显式 --font-source，支持本地 fonts-only 清单；完整清单继续带全部 public 与字体。Next 字体 tracing 已移除，普通应用打包拒绝旧字体残留。三层 adapter 原生探针增加原资源 SHA 校验，旧四层协议明确提示使用三层。
- 本地验证：类型检查和 lint 无代码错误；验收预算 5/5；真实原生探针 4/4（字体和六项编解码、篡改失败）；Windows 可执行资源打包用例 11/11、应用包保护用例 4/4。完整业务测试与隔离构建结果见本轮仓库外交接记录，尚不能据此宣称 Linux 发布就绪。
- 完整独立资源：71 文件、62 图片，public 8,089,791 B + 字体 33,444,552 B + 清单 25,460 B = 41,559,803 B。字体只是退出应用载荷，首次完整部署仍需这些字节；不能把转移量当作总量消失。
- 待验证/交接：Windows 文件 symlink 权限、POSIX 模式、GNU tar 和 Linux fcntl/runuser/systemd 阻碍对应正式验证。旧全包自动部署尚无等价外部字体预检，发布前须接通已支持版本绑定资源的三层 adapter 或补齐预检并验证。此阶段未启动 7788、未做 UI 迁移、未触及生产或凭据。

- 最终本地结果：Domain 106/106；Web 全量 908/911，3 项字体越界 symlink 夹具因 Windows EPERM 失败（不标为全绿）；最终字体定向回归 29 通过、3 项 symlink 待 Linux。隔离无凭据/禁网络 Webpack slim 构建退出 0，171.893 秒；QA standalone 中 Noto 文件及 tracing 条目均为 0。QA 使用审计依赖绝对 junction，不是可部署 Linux 包，未据其总量/压缩量作发布减重结论。

- 字体外置补充闭环（2026-10-28）：全包及三层 deploy/rollback 统一在 release.py.activate() 切换前执行外部字体预检，自动恢复前也检查目标旧版。全包读取专用 /etc/zimage/font-assets.env，验证成功后才固定到每版 .runtime-assets.env；已有绑定不回退全局配置。检查服务 User/Group 及最后 EnvironmentFile，复用原生 Sharp/清单/固定 SHA payload。缺失或错误在 current/previous/restart 前失败。基础 service 模板已补绑定，未安装到服务器；上述旧全包预检代码缺口已在本地补齐，Linux 实际验证仍未完成。

- 预检补充验证：离线 Python 门禁 8/8、真实 Sharp 原生 payload 10/10、既有归档/标识安全定向 2/2、新脚本 lint/Python AST/diff 检查通过；仅定向验证，无真实服务调用。Windows 空 fcntl 导入占位不模拟锁，Linux flock/UID/systemd 集成继续未验证。

## 2026-10-29 default three-layer release integration (local, not activated)

Default packaging/CI now prepare code, immutable versioned runtime and complete original resources, then obtain bounded fixed-root inventory and publish one missing-only transport. Explicit full packaging remains an operator-selected fallback. Schema 2 binds same-origin resources and exact Node/ABI/Linux/glibc/toolchain/config/actual trace identity; old schemas retain their original gates. The privileged adapter revalidates every omitted immutable object, complete closure and actual caches, supports a separate manual empty-install path, and validates exact retained layered rollback bindings. No release/layer/cache GC exists.

The workflow requires a supplied measured target, a compatible trusted runner, reviewed installed six-file helper closure, enabled administrator target config and externally provisioned verified original fonts. Missing evidence stops; Ubuntu labels do not establish compatibility. Current external/service/credential policies remain. Portable Windows mocked/fixture evidence is recorded in task-3-report.md outside the repository; Linux/POSIX locking/symlink/assembly, runuser/systemd/SSH/Actions/ingress/external acceptance remain unexecuted. No build, install, service, server connection, deployment, Git submission or enablement occurred. One retired PATH-based shell fixture selected real SSH for a read-only hash request to reserved deploy.invalid; DNS failed before connection. Exact evidence is retained outside the repository, and the replacement uses readonly same-shell absolute fixture functions with unknown-call proofs. See ops/aliyun/THREE-LAYERS.md and MANUAL-THREE-LAYER-RELEASE.md for future commands and administrator prerequisites.
