# 首窗与全请求排空修复执行计划

> 使用已有获准分离计划和本轮实证继续本地实施；用户已明确要求修复、独立复审及回归，不重复申请本地开发许可。

**目标：** 关闭首窗初始化/精确 B0 恢复的代码互锁，封闭零计数后的新 GET，并覆盖 Next 图片优化脱离响应后的任务；旧页草稿另以真实旧运行时兼容路径验证。

**依据：** `resume-validation-20261029.md`、`legacy-tab-migration.md` 和原获准架构计划第 3.4/6 节及 Task 5–7。生产审批与真实证据不能由本地代码替代。

## 固定边界

- 保留全部业务/UI、Next API/Supabase/Worker，不改 DB schema、计费语义或供应商调用；不 reset/stash，不合并 main、强推或启动 CI。
- Node24.19.0、Next16.4.1 和匹配 Linux 原生/字体门禁保持；任何框架内部边界探针必须绑定锁定源码 hash，不静默容忍升级。
- Nginx 候选上传/nginx-t 的既有拒绝未解除，不重试、不换路径；仅编辑本地候选、执行本地夹具。
- B0 没有历史生命周期证据，不能伪造 socket/meta/drain、用队列空/日志安静/时间/stop 代替。首次实际停机仍须真实完整材料。
- 新代码不能保存已经加载 B0 JS 的内存草稿。维护 503 或另一 build 的 Flight 不是安全更新提示。

## Task 1 — Node HTTP 与 Next 后台任务边界

文件：`ops/aliyun/backend/http-admission.cjs`、其 Node 测试，`apps/web/server/lifecycle/**` 和相应认证/信用生命周期夹具。

- [ ] 先复现新 GET 在零快照后进入、断连时异步优化器仍运行。
- [ ] 固定 root preload 在原 standalone 启动前安装 HTTP gate；同步读控制文件并登记准入，模式为 schema2 `open/draining/checking`。draining 拒绝全部新 HTTP/tunnel；checking 仅固定 GET/HEAD 探测和审阅过的静态路径。
- [ ] HTTP 计数到监听器 Promise 与响应 terminal 两者都结束。已准入业务/finalizer 继续执行，不因 gate 关闭而中断。
- [ ] 按实际 Next 源码覆盖 ResponseCache stale handoff、异步 generator/fetch/Sharp/cache-write/失败保留，以及 disk-LRU 初始化与未 await 的 eviction。仅检查 listener Promise 不够；需精确框架 hook 和完整性标记，缺失/篡改/版本不符失败关闭。
- [ ] 管理 socket 同时报告业务、HTTP、framework 计数和有效 hook 身份；drained 必须处于 draining 且全部为零。缺 preload 不得报告已排空。
- [ ] 实际 Node HTTP/Next ResponseCache/Sharp/磁盘缓存延迟测试、类型和现有认证/信用断言通过；独立复核微任务、调度、异常、断连和模块缓存边界。

## Task 2 — 首窗与正常后端事务

文件：`ops/aliyun/backend/{transaction.py,release.py,first_window.py,first-window.py,legacy-verify.py}`、固定服务模板及 Python 测试。

- [ ] 正常切换和恢复在每次 stop 前均先切 draining，再等待业务/HTTP/framework 完成。checking 的探测在恢复前也须收齐。失败/超时保留旧进程或 sealed 状态，不强杀。
- [ ] 首窗使用独立真实 legacy 前端身份、B0 PID/start/release 和入口/原生/兼容来源，不依赖尚不存在的静态 current 或 B0 meta。
- [ ] run 在任何写入前核验 root 审阅的 policy、入口封口和历史准入/最后收尾完成材料；未知/过期/缺项拒绝。材料是受信操作者审阅边界，不是程序创造的历史事实或恶意 root 下的密码学证明。
- [ ] B1 保持真实 socket/meta/native/fonts/v2 回执；成功只到 backend_ready sealed，不能自行开写或把静态入口也称为完成。
- [ ] 恢复 B0 走独立旧版路径：活 B1 先全计数排空，准确停机、选择、启动，验证真实 old ready、新 PID/start、安全 account/sessions 和独立只读账务审计，不要求假 B0 v2 marker。
- [ ] 候选/原 legacy 服务模式均绑定 root 审阅模板；仅 stopped 状态可原子替换固定 drop-in 并 daemon-reload。原 UID、环境来源/字体、可信 Node 与资源限制不变。
- [ ] 缺前端/B0 meta、各失败点、漂移/过期/崩溃、开写不确定、重放、身份错配和未完 finalizer 均有定向测试。

## Task 3 — 固定入口与 CLI

文件：`ops/aliyun/ingress-maintenance-{maps,server}.conf`、`legacy-gated.nginx.conf`、`split.nginx.conf`、`test_ingress_maintenance.py`、`scripts/release{,.test}.mjs`。

- [x] 本地候选为 legacy 与 split 都增加固定入口 gate，不更换旧代理业务语义。
- [ ] 使用固定 root open/maintenance/checking 标记；默认缺失/无法 stat/矛盾状态关闭，显式 open 才开放；禁文件 stat 缓存。Nginx 只判断存在性，root helper 负责非符号链接/保护祖先/内容/epoch 校验。关门先撤 open，开门最后创建 open，崩溃保持关闭。
- [ ] 每个新请求均判断，覆盖 keep-alive 后续请求；draining 全拒绝，checking 仅固定探测。503 保持 network/retryable、Retry-After30、private/no-store；不代理重试、不给收费请求重放。
- [ ] 首窗 CLI 是独立固定 helper/协议；保持普通 backend/front-end 严格 schema，不扩任意远端路径/主机。先验证 root 预先审阅状态及本地 verifier，再准备/上传候选；不传 Cookie/凭据到 SSH、argv 或 journal。
- [ ] 结果不确定只读 reconciliation；旧版安全回执单独校验，不假用 candidate v2；失败恢复仍返回原失败。
- [ ] 本地策略/CLI 夹具通过；真实 Linux Nginx 语法/HTTP、所有直连/内部入口覆盖另验，不能以夹具替代。

## Task 4 — 真实 B0 标签页兼容对照

- [x] 已准确证明 B1 Flight 导致旧 B0 整页导航和未发送草稿丢失，负对照保留。
- [x] 按真实旧页面发出的 prefetch/navigation 变体，以无 Cookie 的只读请求捕获原 B0 `/home` Flight，ready 前后绑定 9c5；不改 b 字段或将 B1 重标成 B0。
- [ ] 本地 harness 按完整 Flight header 变体选择真实原响应，保持固定 B0 上游、同一身份和旧静态资源。缺变体明确 503，不自动转投 B1。
- [ ] Terra 在真实 B0 标签输入未发送草稿，导航 `/home` 再回原 composer，核验同一运行时/owner、无额外 document、草稿仍在；固定身份夹具与真实业务验收分开。
- [ ] 不改已加载旧 JS。需要保留 B0 与 B1 共存时，先获得该拓扑/资源取舍的明确答复，再以实际 Linux 候选/内存与独立 PID/端口验证；不能把 637MiB 快照当承载保证。此问题已提出，未答复不执行依赖生产动作。

## Task 5 — 独立审查、全量复验与精确源码交接

- [ ] 对四部分做独立安全复核，修复仍可独立处理的 Critical/P1；重复检查真实案例而非仅信 fixture。
- [ ] 停笔后统一 lint/类型、相关 Python/Node、完整业务/前端/domain/Worker/预算；按源码哈希绑定，不覆盖失败轮。Node preload 在真实 QA standalone 验证。
- [ ] 更新唯一进度账本及证据，保持未完成生产门槛明确。必要最终提交/push 只在当前获准分支，不触发 CI，不合并 main。
- [ ] 新 clean commit 用明确 Git 白名单重包，排除 env/凭据/依赖/QA，验证完整清单与包 hash；提交、树、build ID、工具链及产物一致。旧 dirty 包作历史，不重标。
- [ ] 给父会话具体源传递动作/真实附件和校验和；未上传本地路径不得称云可用。云端必须检出真实新 commit、全清单比对后在原匹配隔离 Linux 环境构建。
