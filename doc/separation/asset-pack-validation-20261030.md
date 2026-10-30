# 静态资源构建与封包契约修复

2026-10-30 UTC。当前结论为本地修复与候选验证；未执行生产安装、维护、stop、入口切换、DB/Worker 修改或收费调用。最新全局状态以 [项目进度](../project-progress.md) 为准。此前 `0b35fa4bdf9713583bb0ede4a43f081d2195d0e8` 的云产物保持原身份；本轮新提交、正式完整源清单及提交后 clean 构建由外部 receipt 绑定，不给旧包换 SHA。

## 实证问题与修复

云端原 `0b35…` 的 Linux F1/B1 已成功构建，但 F1 subject-only 拒绝两个 JS 内七种 `/commerce/*.webp` 常量，共 17 处。它们都是存在且已允许的图片。原 `publicAssetUrl` 仅在运行时添加 namespace，Vite 字符串常量仍是根路径；build 的 check-dist 特许该路径，而正式 pack 静态闭包拒绝。构建绿并不代表封包契约成立。

新增 frontend build-only AST 转换，只处理 HeroGallery、WorkflowReel、CommerceEditor、commerce-examples 四个已审查模块内、完整匹配 public allowlist 的字符串或无插值模板字面量。browser/SSR 在同一预转换阶段生成实际 namespace URL；既有 helper 对已版本化输入不重复加前缀。动态、用户、远端、API、带 query/转义/穿越或未允许输入、范围外源码保持原处理。移除 check-dist 的 raw-commerce 例外，正式 pack 的资源路径、namespace 和闭包规则未放松，也未修改 dist 修补输出。

真实构建继续暴露另一处独立误报：原密钥启发式从 Emacs Lisp 词项 `ask-user-about-supersession-threat` 与 `userlock--ask-user-about-supersession-threat` 内匹配 `sk-…`。SECRETS 正则原样保留；只识别这两个完整、有严格两侧标识符边界的已知语法词项，不豁免语言、chunk 或同一文件的其他匹配。不采用会放过 ASCII 前缀紧贴真实 key 的一般左边界。原 grammar 790007 字节不变，SHA256 `3781ad56dc7351e3002090ecb5da37a5da738b922592e397f8a9d000afa9641f`；没有删语言或编码隐藏词项。新发布工具 helper 必须交付相同受审实现，不能只更新 Mac 校验器。

## 本地验证

- 固定已有 Node24.19.0、pnpm11.19.0，不安装依赖，不更改 lock。前端新增回归先观察到 7 fail/37 pass，再 44/44；完整 frontend 176、domain 195 已通过。
- 旧本地 dirty48e dist 与 .prerender 完整复制并逐文件验证保留；其真实 subject exit1，资源错误与云端同型。不是云337文件候选，摘要不混用。
- 新语法误报先以断言观察到失败；最终 frontend Python 工具 52/52、无 skip，通过真实文件系统、Node24 wrapper 和 loopback 夹具。三类 key 的独立、Bearer/query、分隔符、ASCII 紧贴前缀继续拒绝；未知词项前后缀、同文件另一个 key、同文件未版本化图片继续拒绝。
- 修复后重新完整执行 browser → SSR → copy → prerender → check → 真正 Python subject-only，全部 exit0。QA namespace `qa-20261030-asset-pack-fix-02`；338 文件含 candidate、337 payload，分别 17864829 / 17864239 字节；raw `/commerce` 完整图片常量 0。subject 没有修改 dist。
- QA 使用明确 `formalAuth=false/http` 的六字段 DTO，只证明资源/身份主体可生成；输出 `acceptanceRequired:true`，不是 verified 组合、正式包或生产批准。QA candidate 如实 dirty:true，未手改身份。提交后另跑 clean 精确候选，不把本页 QA 摘要换成新 SHA 的验收。
- 全 workspace typecheck、lint exit0；lint 保留既有 Next 根 pages 路径提示。预算 5/5。Web 首轮缺字体配对并有 loopback EPERM，第二轮未补字体而取消，配对后又有两项 Mac `/var`/`/private/var` 别名断言失败；全部原输出保留。canonical TMPDIR 下该字体文件33/33通过，再以同样正确环境完整运行 workspace：Web144文件/1189、frontend176、domain195，单轮命令exit0（Web382.84秒），不是拼接多轮计数。
- 原源码交接工具按完整旧测试文件 SHA 认可既有假钥负向 fixture，本轮新增回归使该 SHA 失效并实际阻断 scan。测试改用显式重复字符构造完全相同的假钥字节；原交接工具及规则逐字未改，源码 scan 通过、生成的负向字节仍被拒绝，最终52项回归再次通过。
- 独立源码/安全复核已覆盖 17 处实际图片引用、SSR/二次转换、原样 grammar、未知边界与同文件交叉拒绝；未发现剩余 P1/P2。浏览器锁定的引用/focus 仍 blocked，未绕过。

原始证据在 ignored `.design-qa/2026-10-30-separation/asset-pack-fix/` 和 `/tmp/zimage-assets-*-20261030.log`，包含失败轮、成功五步日志、完整旧/新索引、subject stdout/stderr 及独立复核。正式源不得包含这些日志/构建产物或凭据。

## B0 现场门槛复核

本轮已有官方连接真实 READ ONLY RR 快照及元数据：文本非终态、apparel processing/全 intent、reference pending、preview 全状态均 0；历史 unknown 并集 7 条，其中 work unknown3、image needs_review2 共60 minor。对应原历史账本的数量/金额，未结清、重发或删除。16 个选定函数13项原字节匹配，3项 apparel 只差 CRLF，独立 raw/quoted-literal 核验无语义变化；reader bypass RLS，10张目标表 SELECT 可见。Worker metadata generation v25/cleanup v19 ACTIVE，不推导调度/完整配置验证。

“从原 PID 启动补齐每条历史 GET/health/ZIP”不是保全业务的唯一必要证明。已确认只余 health、终态 fenced renew、允许中断的纯读/cache 可降级；剩余要闭合的是封口前已进入、仍可能首次建持久义务或继续业务写入的 mutation/pre-admission/断连链及未排除的非计费内存结果。无 socket、表暂零或固定等待不能单独排除。preview admission 的真实函数及可见性已核，可以进一步用当前责任边界缩小非计费范围，但不能伪造完成证明。

当前 v1 first-window 的启动 ticks 等式和七类 completed 合同未修改；现场观察式替代仍是已保存的评审方案。冻结未批准/未实现/未执行，普通 systemd stop 的 SIGCONT 还会破坏其假设。本轮没有 maintenance、生产信号、stop 或 attestation。既有 always-pass Turnstile 是原生产风险，不是本迁移新引入；没有换键、读取 secret 或冒称真实 challenge 通过。

## 后续正式门槛

新 clean SHA/完整清单需重新传给原云任务构建 F1/B1；旧 `0b35…` 包保留证据。Linux/native、精确返回包校验、真实账户/Storage/SSE/计费/兼容、B0 当前责任边界、资源与安全恢复均保持。云官方上传当前在准备/写入前网络失败、无新 Library ID，不宣称已可下载大包，不改走未知第三方或把构建产物塞进源码提交。Mac 已通过原非敏感 Library 回传探针，不代表云上传自动恢复。
