# 前后端分离 Wave 2 本地验收与恢复交接

2026-10-29 UTC。当前交付是本地实现、构建与隔离验收；迁移及生产发布尚未完成。最新状态以 `../project-progress.md` 为准。

接棒新增的完整1631项验证、旧健康脚本修复、首窗/准入竞态P1及真实旧标签草稿失败见 [接棒验收报告](./resume-validation-20261029.md)。本报告下列旧计数和门槛保留为历史，不能覆盖新的失败结果或作为上线依据。

## 精确输入与运行边界

- 工作区 `/Users/zhaoyao/Desktop/work_space/Image-web`；分支 `codex/frontend-backend-separation-20261029`，HEAD仍是 `48e35686e0e4d6b302a1940cb12f5ea1be84860e`。全部后续源码未提交，未重置/藏起/覆盖原成果。
- 正常审批执行；本机原Node25.9.0保留。官方固定Node24.19.0 Darwin x64归档仅提取至 `/tmp/zimage-node24.19.0-darwin-x64/node`，归档SHA `d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316`，二进制SHA `1052eb9c7d6c60a79b968e09f75af55a73462b0f6dff0964336d63b5e13eb63c`，未系统安装。
- 正式构建仍须匹配Linux x64 Node24.19/ABI137/API10/glibc2.35/pnpm11.19。Mac standalone不能上传生产；旧48e云构建不是本次分离制品，不改标签复用。
- 执行/安全使用Sol6.1 Ultra，根因复核Astra Ultra，浏览器Terra6.1 Ultra；工具未提供可核验Fast开关，不声称已开启。

## 已实现并验证的范围

独立前端复用原UI、单一gateway/store/workspace与HTTP/SSE协议，适配导航、认证/CAPTCHA、账户、公开预渲染、资源和browser Sentry。旧Next入口保留。source bridge逐项限制，不包含mock/server/native/字体；未为了分离新增浏览器Supabase凭据。

已修复跨owner迟到草稿、旧请求续发POST、文案优化待核账和私有下载旁路。运行期允许后端列表只表示候选身份，不冒称组合验收；正式manifest的verifiedBackendReleases只能来自绑定候选payload的真实验收。browser/SSR/公媒/copy/prerender/check共用实际source/toolchain快照，dirty和无GitQA不能正式封包。

API保持原49路由/58显式方法，增加两个runtime GET后51/60。原 `api-baseline.json` 不改；`api-source-amendments.json` 只记录chat和uploads的批准源码摘要，47条其余路由仍逐字核验。上传保留单File错误400；新增完整HTTP包络413、接收超时408及并发503契约已有OpenAPI与测试。

Next Proxy默认clone发生在上传名额/计时器前，而且超限时丢弃整个跨界chunk。Astra实证cap+1仍可遗漏实际越界字节。最终仅matcher排除规范uploads，路由名额内先claims处理刷新故障，再live RPC；完整Cookie、Origin和维护检查保持。两个名额覆盖已准入处理直到Storage收尾，未宣称全进程RSS等于2倍bodycap或SDK依赖有30秒截止。

静态发布工具位于 `ops/aliyun/frontend/`：完整封包、file-index/秘密/闭包/来源校验，缺失blob库存与传输，root私有stage重验，批准/兼容/baseline之前不生成公开namespace映射，封存、共享锁、原子current、精确回退、崩溃恢复及世代CAS。没有GC。正式pack和实时public-config必须formalAuth=true/http；原匿名分支未删除，不能把bootstrap API当作绕过现有restrictive RLS的办法。

后端工具位于 `ops/aliyun/backend/`：持久root维护文件、SSE/ZIP/Sharp/续租/断连后收尾计数、300秒排空超时取消、原Linux/native/font校验、精确版本恢复。普通私有Unix socket不触发systemd activation，root校验kernel peer PID/UID及MainPID。GET-only verifier以常驻内存CookieJar处理候选和恢复；固定accept-receipt把受信操作者传入的实际字节SHA、nonce、请求、版本、PID、阶段、gate和独立root policy绑定后原子安装。JSON不是针对恶意root的密码学执行证明，未新增账号、签名密钥或sudo权限。

统一命令见根package与 `scripts/release.mjs --help`：release/rollback frontend、release/rollback backend、status。前端发布不重启Node。backend只消费经严格门禁的Linux三层制品；没有虚构build:backend或pair实现。

## 实测结果与证据

所有原始结果在 `.design-qa/2026-10-29-separation/`，保留失败轮，不覆盖为成功。

| 项目 | 结果 | 主要证据 |
| --- | --- | --- |
| 完整Web | 142文件/1153通过，386.006秒 | `wave2-quality-web.log`、`wave2-quality-result.json` |
| domain / Worker / 预算 | 195 / 80 / 5通过 | `wave2-quality-{domain,worker,budget}.log` |
| 完整lint / web及frontend类型 | exit0；lint只有既有Next根pages提示 | `wave2-lint.log`、`wave2-typecheck-*.log` |
| 前端整套 | 20文件/167通过；配置来源专项45项通过 | `frontend-final-full-tests.log`、`frontend-finalize/verification.json` |
| 主前端五步实际构建 | exit0；336文件/17,406,204字节 | `frontend-build-result.json`、`frontend-build-step*.log` |
| 独立安装及构建 | 314依赖，无Next/Supabase/Sharp/LangChain；类型及五步exit0；336文件/17,406,540字节 | `frontend-isolated-install-result.json`、`frontend-isolated-result.json` |
| 发布工具 | frontend47、backend43、CLI18、入口fixture8通过 | 工具自有测试；独立Sol安全复审 |
| 最终Next standalone | Node24.19 Mac x64 webpack exit0，94.637秒 | `wave2-next-build-result.json` |
| 编译HTTP与真实计数 | 39/39；同PID15次只读观测；已停全部自有服务 | `wave2-http-result.json`、`wave2-final-summary.md` |
| Terra浏览器 | 实际dist的Edge访客/窄屏/导航/故障检查；API为显式本地夹具 | `browser-guest-qa.md` |

完整Web首轮为1135通过/6失败：5个旧上传夹具改用真实multipart，原durable intent/补偿/64张断言保持；1个byte-freeze测试改为两个精确批准修订。历史在 `wave2-quality-web-initial.log`。Next合法10MiB包络截断失败与本地Host/Origin夹具修正分别保留，最终全部HTTP门槛才计通过。

最终Next输入快照797文件，指纹 `589b4438bfee8af5346070c5e5e6188b86bef4ae9c0555b9919f8a6c2aee178b`；188个compiled server JS指纹 `3078d0ad5c3844ca56d6d943f199986d85d0c9b1d4ada42cbfce86c6d4ccda4b`。`wave2-evidence-binding.json` 记录核验时点源码、文件集合、构建输入无漂移；本交接后只有文档检查点更新，未改运行时代码。原S4快照和证据保持。

39项编译HTTP使用本地合成Supabase服务，包括完整4条Set-Cookie、单次刷新、刷新503不降成401、live RPC撤销401、account/private/no-store、Origin、公有6读零身份调用、10MiB合法包络、chunked总长413、单File400、两名额挂起/第三503及全部计数归零。不是实际Supabase token rotation、邮件/CAPTCHA、Storage、供应商或账务验收。

## 明确未完成与阻塞

1. **Linux构建入口待提供/复核。** 当前只有Mac与现有生产SSH；已保存云环境此前成功的方式尚无可调用入口，已询问。未在567MiB余量的生产机全量构建，未新增付费资源或安装Mac Ubuntu/Docker。
2. **B0首次排空仍硬阻断。** 旧9c5没有计数/管理协议，不能以新collector、队列空或访问日志静默证明旧SSE/Sharp/ZIP/账务收尾已排空。需要审查过的首次维护交接方案与真实证据，不能强停后把它称为无损。
3. **跨版本/真实环境尚未通过。** 真正B0旧标签RSC/chunk/图片优化/草稿、F0+A1/F1+A1及精确退回旧组合、真实Supabase/私有Storage/SSE/队列/账务、Linux/systemd/socket/断电恢复、Windows/深色和生产15分钟/24小时观察均未验。保留legacy upstream不等于证明跨构建协议兼容。
4. **Nginx动作被拒，限定授权待回复。** 把候选配置上传到 `47.100.222.24:/tmp` 并运行 `nginx -t` 的请求被自动审批以“内部配置出站传输没有明确授权”拒绝；整个动作未执行，未绕路重试。当前只有8项本地入口策略fixture，不能声称真实nginx语法/HTTP已通过。

生产最后只读观测仍为current `9c5c3ea95e0c66193b23a2db50643530aa7d095a`、previous `8cbb708645e93d3d71d17641b860cc60301fa005`、PID399199、active、567MiB可用/13GiB磁盘。没有安装helper、改入口、reload、restart、切换或真实回滚；没有DBschema/Worker/真实OTP/收费生成。当前无新提交、正式Linux产物、生产frontend artifactId或生产回滚结果。

恢复执行先读本报告、最新progress、各工具README和QA摘要，再只读确认实际branch/status及部署状态。代码已冻结时先复用精确范围证据；只有新增改动/环境差异才补测，禁止reset/stash/复用旧SHA改标签。任何生产gate失败继续保留旧健康版。
