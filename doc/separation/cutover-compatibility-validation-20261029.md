# 切换兼容补验与共存资源核验

2026-10-29 UTC。此轮可独立执行的本地兼容与资源核验已收尾；**完整迁移验收未通过，生产未发布**。两项已修复 P1 的运行时代码未再修改，22 份复审源码及651份相关应用输入 SHA256 仍全部一致；此前 1636 项应用检查和首窗/CLI 回归的范围见 [修复验收](./repair-validation-20261029.md)。本轮新增的是 ignored QA 装置、证据和本文档，不重新包装旧源码包。

## 已消除“切前缓存”误证的文本对照

旧轮同版草稿保留使用了切换前预取，本轮保留原结果，不将其重标。新装置先拒绝全部切前 Flight，再切普通文档为 F1；旧 Next 协议始终只回放精确 B0 原始字节。API、认证与元数据全部是显式合成夹具，无业务上游，不能作真实业务验收。

旧本地 127.0.0.1 地址带来源未确认的 Cookie/Auth 布尔标记，该轮不计干净正对照。未输出或转发值，旧日志保留。新轮改用独立 nonce localhost origin，按确切 Host 与操作 marker 排除旧标签后台流量。

新正对照中，切前成功 Flight 为零。19:56:14.688Z 切 F1 后，19:57:00Z 的真实浏览器请求 #224/#226/#227 才分别取得 284、18071、18895 字节的原 B0 Flight，build 均为 `9c5c3ea95e0c66193b23a2db50643530aa7d095a`，SHA256 与原捕获完全一致。切后无 document 请求、无凭据标记、无 mutation；Terra 观察从原 `/home` 返回后独特未发送文本完整。此结果不依赖切前成功预取，也没有改 Flight 的 build ID 或既有 B0 JavaScript。

证据在 `.design-qa/2026-10-29-separation/legacy-switch-clean-origin/`。78 项有限本地 HTTP、98 项离线路径/匹配边界、16 项所有权控制 mock、12 项日志判据对抗检查通过。独立复核未发现 P1，并确认启动源码绑定与原 B0 HTML/static/Flight 字节；运行身份与关闭仍由装置 owner 的证据核验，独立 reviewer 的额外 `ps` 被默认 sandbox 拒绝，未重试。浏览器原文见该目录 `terra-observations.md`，以下逐场景限定结论，不用网络前提宣称完整保留。

| 场景 | 实测结果与边界 |
| --- | --- |
| 无会话未发送文本 | 上述3条真实切后Flight、无document、原文本完整；这一具体路径通过 |
| 已有会话未发送文本 | 独立新页经真实B0 session Flight进入合成会话，切F1→旧home→Back回相同完整UUID、标题、原草稿；home用切前缓存，是独立缓存路径控制，不冒称此轮切后新网络 |
| 新F1页面 | 原F1文档与namespaced JS/CSS被新标签实际加载，属于合成API组合，不是正式Linux或真实业务 |
| 取消回B0 | 新标签加载原B0文档/静态/同owner，原未刷新旧标签文本仍在；仅本地拓扑取消，不是生产整组回滚 |
| 503/401认证错误 | 分别新页初加载；503显示错误，恢复后实际点击重新检查得到200并回工作台；401进入带登录入口的旧home。不证明已有草稿/引用在认证错误中保持 |
| 引用图片 | 原生选择器受Mac锁屏阻塞，没有选择文件；引用数量、blob身份、预览及往返保留未通过 |
| focus/visibility身份重检 | 文档化getTab切回未触发认证GET，接口没有activate/bring-to-front，原生UI被锁屏阻塞；未注入事件，不计通过 |

已有会话 discovery 的初次缺变体/文档404保留，无草稿输入。随后仅增加精确合成会话UUID路径的公共GET捕获；真实B0 `SessionPage` 仅return null，所有权/缺失状态由认证运行时解决，没有该页面服务端会话查询。原响应200/2005字节、SHA256 `00ac6abeaf26481c0d24850d60b4c00183e3327ac2434d932eba4ceffd2c28e2`，ready/current前后严格绑定原9c。新manifest第5条按原字节加入，原4条保持；精确请求及NextUrl/HEAD两个拒绝对照3项通过。合成列表/timeline另按15份真实B0 Git源绑定的完整schema验证，6项合法及8项反例通过。没有伪造真实用户会话或请求生产私有会话。

缺失记录是历史集合：主正向窗口有13种其他scene预取缺变体；全场景共26种历史拒绝，其中上述session已补齐，当前manifest仍未捕获25种。原历史503不删除，未知变体继续严格503；不能把有限回放当全部旧路由可用。最终151文件snapshot只绑定当时列出的文件，后加root文档摘要及终审补充作为独立结果，不声称整个QA目录无新增输出。

## 真实公共图片优化器补证

按新浏览器实际 target 与 Accept，仅抓取一张公共 `kit-scene.webp` 的 640/q75 优化响应：既有 SSH 内只向固定 loopback3100、Host `www.zimage.store` 发 GET，未带 Cookie/Auth/body；前后严格解析 ready 的 `status=ok/version=9c5c…`，并核对 current 真正指向该 B0 release。未上传配置、改服务或入口；图片请求可能自然产生派生缓存，此限制已记入 receipt。

响应为 200、33768 字节，SHA256 `328bbe2dc2d2db85dc05465a65cf9ed6e2f8799f78a25e343a89d65b9c901667`。原件保存在新目录 `actual-b0-optimizer-capture/`；只原子扩展新 QA 的精确 GET/target/Accept manifest，原 body 不改。精确回放及三个拒绝对照 4/4 通过。它仅证明这一公共变体，不代表所有图片、私有资源或生产路由验收。

## 当前 ECS 不放行双进程方案

只读 15 样本自然流量观测中，物理 RAM 1608.910 MiB、MemAvailable 598.184–602.949 MiB，B0 cgroup 当前约 387.844 MiB、PID 自身 RSS 高水位 344.043 MiB；完整 cgroup 历史峰值接口不可用，正式 Linux B1 业务/native 峰值未知。两个现有 850 MiB 服务预算共1700 MiB，已超过物理 RAM，未计宿主其他工作，不能启用共存。当前可用磁盘约12.495 GiB，只是快照，新增制品/解压/cache 的最大同时占用仍未知。

完整数值、可重算公式、费用与具体动作边界见 [资源方案](./coexist-resource-plan-20261029.md)。本地准备已获准，不再索要该许可；本轮未申请新资源、扩容、swap 或收费操作，也未启动生产 B1。原有订阅继续，未读取账单，不承诺真实运行永远零增量费用。

B0 不承诺固定保留24小时或7天后退出。须同时证明旧页面完成草稿/引用与未定请求保存并离开，以及同一旧进程全部已准入工作及 detached finalizer 真正收尾。当前两者均未闭合；等待、日志安静、账务终态、队列空或30秒 stop 不能替代。暂不切换保留当前 B0；顺序维护仍受旧页/旧进程门槛约束，F1+B0 又缺真实新元数据端点。复用另一台既存且已授权匹配主机需具体资源证据，不自行创建或借用。

## 尚未执行与阻塞

- Mac 锁屏阻止原生引用图片选择器，也没有通过已文档化浏览器能力触发可证的真实 focus/visibility 认证重检；无新 auth GET 就不计通过，不注入事件或修改产品 JS。
- Git 目标已由 `git remote` 及 GitHub 只读元数据核实为 private：`https://github.com/zhYAO/Image-web.git`，owner `zhYAO`、name `Image-web`。提交当前迁移并 push 到当前 codex 分支此前被自动审批在执行前拒绝，仍暂停；不重试、不换上传通道，HEAD 仍为 `48e35686e0e4d6b302a1940cb12f5ea1be84860e`，无 stage/commit/push。
- 候选 Nginx 配置上传 `47.100.222.24:/tmp` 并 `nginx -t` 仍为既有自动审批拒绝、未执行、待明确配置出站授权；本轮未重试或自行重复询问。
- `/tmp/zimage-linux-source-20261029-repair-final-c` 原 dirty 包与 manifest SHA256 保持，未上传、未改为正式输入；新增文档/QA 与它分开。正式 Linux 输入仍须真实 clean commit、完整新索引和可达传递，不能用旧48e产物冒充。
- 真实认证、Storage/SSE/生成/账务、Windows、实际 Nginx、B0 历史收尾及完整生产恢复仍不由本地合成试验替代。本轮无 DB/Worker 改动、生产切换或服务停止。

本轮没有新增生产配置/服务动作。所有场景失败与锁屏限制均保留；引用、真实focus/在途身份连续性及其他scene/真实业务仍不能宣称通过。自有QA装置在Terra完成后按同一PID20637/token核验SIGTERM，exec session7917退出0，20:07:24Z独立确认PID不存在且4184端口ECONNREFUSED61；关闭证据见 `stop-verification.json`。前一来源未确认凭据轮的自有PID19230也已按身份正常停止并核端口关闭，不影响真实生产B0 PID399199，更不能替代其历史收尾证据。

root最后只读核验记录在 `root-final-verification.json`：22份复审源码未漂移、HEAD/分支不变、index为空、`git diff --check` exit0；相关651输入核验另在 `application-inputs-no-drift.json`。不为纯文档与QA补证重复运行无变化的应用全量测试。正式Linux输入、真实业务和生产执行门槛仍未通过。
