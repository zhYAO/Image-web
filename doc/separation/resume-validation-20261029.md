# 分离迁移接棒验收 — 2026-10-29 UTC

当前结论：**完整业务测试和静态检查通过，迁移验收未通过，生产未发布。** 本报告接续 Wave 2，不把代码测试、只读夹具或本地 Mac 构建替代生产门槛。

工作区分支仍为 `codex/frontend-backend-separation-20261029`，HEAD `48e35686e0e4d6b302a1940cb12f5ea1be84860e`。此前所有未提交内容均保留，没有 reset/stash、最终 commit/push、main 合并、Actions、DB schema 迁移或 Worker 发布。子任务选择 ultra；浏览器仅由 gpt-6.1-terra 执行。工具没有可核验 Fast 开关，不声称已开启。

## 已修复及重新核验

`ops/aliyun/authenticated_health.py` 已移除 `/api/credits`，只访问 account/sessions，成功文案不再输出账号 ID 或积分健康声明。wallet/ledger GET 在旧 SQL 中都会先调用 `credit_wallet`，可能创建钱包和 welcome grant，故不能用于无写账务探测。该脚本不具备 nonce/PID/release 绑定，不能代替 backend v2 verifier 或独立账务审计；本轮没有使用真实 Cookie 执行它。

先在原实现准确复现额外 wallet 请求和身份输出两项失败，随后 4/4 通过。旧 HEAD 源码的负对照在独立临时副本保留，未回滚 live 文件。证据：`.design-qa/2026-10-29-separation/resume-ops-20261029/probe-{red-baseline,green}.log`。

本轮全量实际结果：

| 项目 | 结果 |
| --- | --- |
| Web | 143 文件，1184/1184 |
| frontend | 20 文件，167/167 |
| domain | 13 文件，195/195 |
| Worker | 6 文件，80/80 |
| 预算 | 5/5 |
| lint | 509 文件，0 error/warning/fatal；仅保留既有 Next 根 pages 目录提示 |
| web/frontend/domain TypeScript | 三项 exit 0，noEmit、禁用增量缓存 |

合计 1631 项测试，零失败/跳过/todo。651 个测试输入文件十份快照一致，聚合 SHA256 `eab590d2457f60242af8436067873f1312db485c839462b3eb1f721c524451a3`；静态检查的 618 文件八份快照一致。原始日志及独立重解析结果在 `resume-quality-20261029/verified-result.json` 和 `summary.md`。初始汇总器漏认 Node24 的 `ℹ` 预算输出而 exit1，初始 JSON/日志保留；五个实际测试进程均 exit0，没有重跑或放宽测试来改绿。

本轮额外运维结果：backend Python 48/48，frontend Python 47/47，Node release/packaging 23 项中 22 通过、1 项按固定 Node24 条件跳过（其中 release CLI 19 通过）。完整旧运维 Python 212 项在 Mac 未全绿，不能以此宣称 Linux 运维通过：首轮受 `/var` 临时路径符号链接和 sandbox 监听限制影响；规范 `/private/tmp` 并获准 localhost 夹具后仍 50 fail/39 error，包含 Linux/glibc、renameat2、GNU 工具依赖及 Mac 系统代理/连接拒绝行为。失败日志完整保留于 `resume-ops-20261029/`；没有修改产品门禁或测试断言来适配 Mac。

## B0/B1/F1 本地兼容证据与限制

真实 B0 `9c5c3ea95e0c66193b23a2db50643530aa7d095a` 的 435 个静态文件（14,677,720 字节）和 7 份原始 HTML/redirect body 与原库存/传输逐字匹配；归档 SHA256 `61ac175958745bf407dd03f12514855467c21f86f7c6094a2da6ce2bc6215cef`。B1 为已有 Node24.19 Mac QA standalone 的 368 个静态文件。二者同 URL 2 个且同字节，0 冲突；B0 独有 433 个、B1 独有 366 个。

这不等于正式源码冻结。B1 原 QA 快照指纹为 `40e13fea1e869f9799480537d9cc7120936c378085efdf70fd00222e805ccc25`，QA `next-env.d.ts` 由 Next 改为 `.next-build-qa/types`，当前 live 的 health/运维文档补丁另有差异；原快照未重标。F1 使用实际隔离构建 336 文件/17,406,540 字节，候选全零 SHA、dirty=true，`version.json` 不存在且保持真实 404。

localhost harness 已通过 20 项 HTTP 协议检查，包括真实 HTML、旧/新静态资源、B1 Flight、缺失 chunk 404、保留/移除旧 chunk 对照和退回 B0 状态。它禁 POST，不转发业务 API、不转发 Cookie/Authorization、CSP 禁外联；全部 API 都是明确的本地只读合成夹具。B0 捕获没有真实 RSC 或优化图片响应，不能宣称真实认证、Storage、图片优化、SSE/队列/账务通过。证据在 `resume-compat-20261029/{static-audit.md,phase-verification.json,HANDOFF.md}`。

Terra 已复现两条失败：B0→B1 和独立旧页 B0→F1 均在未发送草稿后通过页面链接收到 B1 Flight（build ID `48e35686…`），随后整页 document 导航；再进入各自工作区时草稿为空。请求序号分别为 B1 Flight #94/#97→document #100，以及 F1 Flight #234/#237→document #242。回 B0 的 #275 与原 HTML SHA256 `c2929ce69b678b516e31a7a378079981adbb85c402f83d0a29ec39ecdbd64e4f` 一致，工作台可见，但只是捕获回放，不是生产回滚。两条草稿场景均不计组合兼容通过。原始操作记录在 `resume-terra-20261029/browser-observations.md`、请求日志在 `resume-compat-20261029/requests.jsonl`；截图仅在 CUA 工具输出显示，没有虚称已保存本地截图。

Terra 确认检查结束后，自有 supervisor/B1/harness/身份夹具均正常停止，没有强杀；PID 已消失，4182/4183/57110 均 ECONNREFUSED。`resume-compat-20261029/stop-verification.json` 的 passed=true 已核验。没有停止其他进程。

## 新复审阻塞：代码/协议与真实证据分开关闭

1. **P1-1 首窗初始化及 legacy 恢复无闭环。** backend 强制已有正式静态 frontend/current，frontend 又要求真实 B0 没有的 `/api/meta`；通用切换/恢复还要求 B0 不具备的 socket/meta/drainProtocol。普通 fixture 的旧版本支持新协议，不是实际 B0。需要独立首窗协调器：保持真实 legacy ingress/身份，只有外部封口和真实 B0 收尾闭合后才停旧进程；B1 用真实新协议检查，恢复 B0 用真实旧版流程，不伪造元数据或计数。
2. **P1-2 零快照后仍准入新读。** 维护关写但 GET 可在计数归零后进入，离线反例已捕获 activeStreams 存在时 stop；保留的 `/_next/image` 不受这些 API 计数覆盖。每次 stop（含恢复）都需要持久的全部新应用准入封口，覆盖 GET/RSC/优化图片/旧 HTTP2 后续请求/直连/内部入口，并在 checking 阶段精确开放且收齐探测请求。重复零快照不能消除竞态。
3. **旧标签页未发送草稿兼容失败。** 已有真实浏览器反例，不能把静态 union 或保留 legacy upstream 作为通过依据。需解决迁移/恢复策略后重新验收。
4. **真实 B0 首次收尾证据缺失。** 非计费 graph/health、计费终态后 health、Sharp/Storage/已发 renew、ZIP cancel/finally、上传补偿/preview 没有闭合材料。combined 日志、账务终态、队列空、连接消失、等 300 秒、stop 30 秒或强杀都不能替代。原材料不存在时不能证明无损停机。
5. **Linux 和真实环境门槛仍待执行。** 本次 clean 新提交、匹配 Linux 三层产物、受控源码/制品传递、真实 Supabase/Storage/SSE/队列/账务、Windows、systemd/socket/重启/断电恢复、精确退回旧组合及生产 15 分钟/24 小时观察未完成。旧云任务 `01a187a5-2eb4-7561-bec2-98c8c0e23027` 的 48e 构建不是本次迁移产物；旧 handoff 源包已过期，不可重标。新正式冻结前不提交最终 release 或生成正式 verified 组合。

详细源码行号、最小首窗方案和离线复现在 `resume-safety-review-20261029/REVIEW.md`、`targeted-results.json`。3 项既有控制流测试通过，并复现初始化互锁及新读竞态；这些只是离线证据。本轮没有放松 helper 或写入伪造 gate。

## 生产与审批状态

本轮只读 SSH 复核：current `9c5c3ea95e0c66193b23a2db50643530aa7d095a`，previous `8cbb708645e93d3d71d17641b860cc60301fa005`；MainPID 399199，启动 `Tue 2026-10-27 21:32:19 CST`，active/running；TimeoutStopUSec=30s、KillMode=control-group、SendSIGKILL=yes；可用内存 637 MiB、磁盘 13,416,656,896 字节（该次快照）。没有新增生产 HTTP/DB/OTP/付费调用，没有安装 helper、配置上传、reload/restart、指针切换或回滚。不能把 30 秒 systemd stop 当 drain。

候选 Nginx 上传到 `47.100.222.24:/tmp` 并执行 `nginx -t` 的既有请求仍为**自动审批拒绝、未执行**，理由是配置出站传输缺少明确授权；本轮没有重试或换路径。限定授权仍待父会话/用户回复。仅为本地 localhost 测试监听和上述生产只读固定字段请求获得了各自执行许可，它们不解除该 Nginx 拒绝，也不补齐停机证据。

Linux 输入准备继续使用 `/tmp/zimage-linux-handoff-20261029-a/handoff.py` 的明确 Git 文件白名单：在打开/哈希前排除 `.env*`、npm/SSH/cloud 配置，排除 Git、依赖和 ignored QA/产物；不复用旧源码包。新输出路径 `/tmp/zimage-linux-source-20261029-resume-b`，是否完整及精确字节/SHA 以其中 `source-receipt.json` 和 `verify-archive` 结果为准。此树尚 dirty，仅用于精确本地交接/后续 Linux QA，不能正式 build；没有向云发送或生成可访问的云附件。关闭新 P1/草稿门槛并最终冻结真实新 commit 后，仍必须在新目录重包，不能改此 manifest 的身份。
