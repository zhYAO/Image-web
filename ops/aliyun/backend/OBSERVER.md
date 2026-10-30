# 独立准入观察工具：待批准的运维手顺

本工具仅提供 `observe`、`status`、`cancel`：限时关闭新的准入，读取固定系统身份与配置，随后恢复同一旧 B0 的准入。它不访问 DB、不执行构建、不切换 current、不修改服务或 Nginx 配置，不产生 completion、停机许可或业务 drain 证明。

这份说明不是生产安装或执行授权。本次只完成本地实现、测试和独立复核；以下安装、文档与 marker 准备、真实 A 阶段审阅及窗口操作，均须未来取得明确管理员批准。

## 安装与身份边界

唯一安装目录为 `/usr/local/libexec/zimage-observer`，工具源码闭包仅含 `observer.py`、`ingress-observe.py`。CLI 要求 root、isolated Python、固定安装路径，以及受保护的 root-owned 文件与全部祖先。policy 的 `helperFiles` 按这两个精确名称绑定各自 raw SHA-256。执行库前，bootstrap 从受保护 fd 读取并核对两份源码摘要，再 compile/exec 认证源码字节；不通过可能读取未认证 `.pyc` 的源码 loader 执行库。

运维工具的源码 Git SHA 与已构建应用 `975f9e4c347fe0ee219abc5564cc53ea9cd0d749` 分开记录。提交或安装本工具不重标该应用，不要求重新构建应用，也不表示本工具已安装或生产可用。

未来管理员还须分别准备并审阅以下固定资源；工具不会安装它们，也不会生成真实 A 阶段证据：

| 固定资源 | 用途 |
| --- | --- |
| `/etc/zimage/observer-policy.json` | 精确 operation、进程/current、配置闭包、两文件源码摘要、receipt/OPEN 摘要及有效期 |
| `/etc/zimage/observer-loaded-receipt.json` | A 阶段真实 loaded-generation 与六入口可封口边界的独立审阅回执 |
| `/etc/zimage/ingress-open.json` | A 阶段预先安装的本 operation 精确 OPEN 内容；观察前必须已存在 |
| `/etc/zimage/ingress-maintenance.json` | 工具仅以独立 observer 协议发布本 operation 的准确 token，不兼用旧 token |
| `/etc/zimage/ingress-checking.json` | 全程必须不存在；意外出现按漂移处理，工具不会顺手删除 |
| `/opt/zimage/backend-operations/observer-current.json` | 单一持久权威 journal，记录阶段、意图及恢复绑定 |
| `/opt/zimage/deploy.lock` | 必须已存在的共用锁；工具不创建、删除或重建它 |

所有文档、marker、journal 及其目录的所有权、权限、非链接/单链接等约束必须通过工具检查。这里不提供缺乏有效现场证据的示例 policy 或 receipt JSON。

## A 阶段仍需真实证据

磁盘配置摘要和 PID/startTicks/bootId 不能单独证明 Nginx 实际加载的 generation。进入窗口前仍须独立确认真实 loaded-generation、旧 worker generation 已自然退出，以及下列六类入口的准确可封口边界：`public-http`、`public-https`、`existing-http2`、`loopback`、`direct-bind`、`internal-callers`。receipt 的 `reviewed-gate-boundary` 表示已审阅可封口边界，不表示 OPEN 阶段已经封口。本工具核对回执绑定与现场身份，不自动证明其审阅事实。

当前版本只接受下列精确五文件集合，且实际 include 图须使它们全部从 `nginx.conf` 可达：

- `/etc/nginx/nginx.conf`
- `/etc/nginx/mime.types`
- `/etc/nginx/sites-available/zimage.conf`
- `/etc/nginx/zimage-ingress-maintenance-maps.conf`
- `/etc/nginx/zimage-ingress-maintenance-server.conf`

额外 include、glob、变量路径以及含反斜杠的配置文本会被保守拒绝。真实生产 layout 若超出这一闭包或解析能力，必须另行审阅实现与手顺；不得省略文件、站点或入口来通过检查。精确五文件检查仍不能替代实际 loaded-generation 和六入口证据。

当前危险 continuation/cut-set 的可靠现场来源仍缺少，本工具的系统身份快照不会补出这项证据。既有准入已放行的 continuation 与 Worker 可以继续运行。不得要求补全全部历史来替代当前来源，也不得用空快照、相同计数或经过 300 秒签发 completion；原有 unknown/needs_review 的责任不因窗口结束而消失。

## 仅供未来批准后调用的命令模板

以下三行是固定安装位置的调用模板，本次未执行；`observe` 的参数必须是 1–300 的整数，无其它路径或 shell 参数：

```sh
/usr/bin/python3 -I /usr/local/libexec/zimage-observer/ingress-observe.py observe 300
/usr/bin/python3 -I /usr/local/libexec/zimage-observer/ingress-observe.py status
/usr/bin/python3 -I /usr/local/libexec/zimage-observer/ingress-observe.py cancel
```

`observe` 全窗持有现有 deploy.lock。初始 journal 持久化后，先以 no-replace 发布自己的 MAINTENANCE，再删除准确原 OPEN。首次 MAINTENANCE link 可见前会重查预算、取消 flag 和 policy freshness。MAINTENANCE 已可见后若预算或 policy 到期，直接走取消，不继续删除 OPEN。

`cancel` 允许 policy 已过期，但原 policy/receipt 摘要、全部控制身份和 token 归属必须仍准确。恢复仅接受准确 `O/noM`、`O/M`、`noO/M` 且 CHECKING 不存在的状态。先还原或确认原 OPEN 的精确字节，无论 OPEN 已存在还是刚创建，都完成文件与 marker 父目录 fsync 屏障，再删除自己的 MAINTENANCE。`noO/noM`、foreign token、链接或身份不明均拒绝猜测恢复。

`status` 是只读诊断，不改 journal/marker，也不产生停机凭据。已有 journal 时再次 `observe` 会拒绝，包括已 cancelled 的 journal；下一 operation 的归档与准备属于另行审阅的 A 阶段管理员动作，CLI 没有重置或清理入口。

## 返回、取消与故障责任

正常结果包含 `code`、`phase`、`lastIntent`、`operationId`、`policySha256`、`markers`（open/maintenance/checking 存在状态）、`needsAttention`、`admissionMayBeOpen` 和固定为 false 的 `completionAuthorized`。CLI 在 `needsAttention:true` 时返回非零。启动权限/闭包拒绝等早期错误只返回固定错误 JSON，字段可能少于正常结果；不输出任意异常原文、命令 stdout 或环境内容。

正常 `cancelled` 后，`markers` 为 OPEN 有、MAINTENANCE/CHECKING 无，`admissionMayBeOpen:true`、`needsAttention:false` 是预期：旧 B0 的新准入已恢复。`admissionMayBeOpen:false` 仅在当前控制核验成功且完整 marker tuple 可信时才允许报告；控制、policy、receipt 或 marker 漂移时必须按不确定处理。marker 状态不能升级为真实业务完成或全部入口覆盖证明。

`BUSY` 表示未取得锁，**不表示已经取消**。另一个 SSH 会话的 cancel 不会给活 observer 发送取消请求。若 observer 活着但不响应，合法操作者仍须核对现场；工具不提供强制解除锁或终止进程的替代动作。

普通异常通常保留当前 seal 并报告 `needsAttention`。若删除 MAINTENANCE 可能已成功而后续持久化失败，工具尽力安全重封并报告实际 tuple；失败时可能已经恢复准入，不能把所有非零都理解为 closed。操作者需从新 SSH 会话重新读取现场，并在取得锁且原身份/归属仍准确时显式 `cancel`。若仍 BUSY、身份漂移或 token 不明，保留 needs_attention，转合法操作者核对；不得删除异 operation 文件、盲目重放或换用旧发布/切换工具冒充取消。

到期和捕获的 HUP/INT/TERM 仅触发尽力取消；signal handler 只设置 flag。SSH 断线未必向该进程传递 HUP。硬终止、主机/存储故障、进程卡住或恢复失败都没有自动 OPEN 保证。no-replace link 发布若硬崩在临时链接清理前，还可能留下多链接文件，需要合法操作者核对，工具会拒绝猜测删除。

至多 300 秒是观察停止预算，**不是恢复或总维护时长上界**。每轮等待至多 1 秒；完整双快照另有 3 秒进度预算及固定子进程 timeout，不能宣称每秒必完成一轮。`/proc` 流式枚举还受 32768 总 entry 上限约束。截止检查与文件可见之间不构成硬实时事务；不能承诺断线或故障后五分钟必然恢复。

## 验证与保留限制

本地工具测试 59 项通过；root 汇总后端回归 144 项通过；独立最终安全复审 PASS，并独立复跑 59 项通过。测试包括真实受控临时文件与 flock、分离的 marker/journal 目录、故障边界和只读 OS adapter fixture。源码编译检查通过。

五类独立复核问题已修复并保留 red→green 反例：控制漂移下 marker 导致的误报、配置闭包遗漏、预算/取消后仍新封口、既有 OPEN 缺持久化屏障、未认证 `.pyc` 被执行。

真实 Linux `/proc`/systemctl、Nginx 实际行为与生产 A 阶段证据均未运行或取得。这些本地通过结果不表示已完成生产验收。本次未执行安装、reload、服务动作、DB、网络或 SSH。

## 本次冻结源码 raw SHA-256

以下仅覆盖两份工具源码，不对本文档作循环摘要：

| 文件 | SHA-256 |
| --- | --- |
| `observer.py` | `bfd4df1da49786599e6204c9d48964a321559177c466aec23f8e9a298d9b1424` |
| `ingress-observe.py` | `bbfa48758b7a56d1a24122dd8d53c05e799ed4f6a87a091947cc6abbbeb98fa7` |
