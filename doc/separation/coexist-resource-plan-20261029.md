# 临时 B0+B1 同机：资源、批准范围与退出门槛

2026-10-29 UTC。本轮已授权继续本地分析和可逆暂存准备，本文将其具体化，**无需再为这些本地工作请求许可**；本文不是启动、切流或停止旧服务的执行许可。状态仍以 `doc/project-progress.md` 为准。本地分析子任务只写本文和 ignored 计算凭据，不改产品代码、既有 QA/源码包，不执行 SSH、生产请求、安装、Git 写入或收费操作。父任务独立完成的只读SSH取数在下文另行归属。

## 当前可作出的决定

**现有 ECS 不能按“两套均保留850 MiB服务预算”的方案放行：两套共1700 MiB，已超过实测物理内存1608.910 MiB，尚未计宿主其他工作。更小的 B1 方案也没有正式 Linux native/允许业务并发峰值支撑，目前不能证明可行；不得启动 B1 来试运气。** 可以继续完善既有资源内的本地暂存准备，取得真实数字后再判定。保留 B0 的目的，是让旧页面继续取得同版 Next Flight/静态资源/optimizer，并给已准入工作留下自然完成的机会；它既不迁移页面内存草稿，也不补造 B0 历史收尾凭据。

已获授权的本地准备按下表继续。真正仍需具体许可的是未来生产安装unit/helper、启动B1、改入口等动作；它们必须有精确目标、制品、限额、执行范围和取消/恢复材料。**当前ECS原预算共存不可启用，B1制品及峰值仍UNKNOWN，尚无可放行执行单，此刻不请求用“方向批准”替代这些材料。** 如有现存且已授权的匹配主机，可另作具体评估；否则保持B0。本轮未申请扩容或新资源。

| 范围 | 本轮已授权本地准备的具体含义 | 未来生产动作仍需满足的条件 |
| --- | --- | --- |
| 拓扑 | 固定 B0 精确 release、原 PID/start/boot、原端口和旧资源；B1 用另一受控 PID/端口及独立固定 release/生命周期身份，F1 静态入口单列 | 两个身份的精确路径/unit/端口、字节与取消方案完成审阅；不能直接使用单 unit/单 current helper 双跑 |
| RAM/CPU | 保持 B0 既有限额和业务行为；据真实 Linux B1/native 峰值填写候选内存与允许并发；为宿主其他进程和波动留预算 | 下文总量、增量及实际受限运行验证同时通过；不能因获准准备而开始生产共存或压测 |
| 磁盘 | 保留 B0、previous、旧命名空间、字体及被引用 store/cache；预算新增制品、暂存、解压、日志/cache 的最大同时占用 | 匹配 Linux 制品、完整清单、块占用、free/inode 和执行期增长上界已知；不得自动 GC 或删旧包凑空间 |
| 费用 | 使用既有 ECS/磁盘/原工具链；不新增实例、扩容、swap、付费 runner、安装 Docker、购买流量或发收费模型调用 | 任何额外收费选项需另给资源/费用上限并得到明确批准；本方案没有这种授权 |
| 启用/取消 | 准备绑定精确 B0/B1/F1 的执行单和恢复目标 | 实际安装 unit/helper、启动 B1、Nginx 传输/测试/reload、切流分别受现有授权及验证门槛约束；取消也不得强杀仍有未定工作的 B1 |

本轮本地准备不改变生产，生产保持当前B0。只有资源验证PASS，加上完整功能/旧页/API/认证/恢复及入口验证、具体生产动作授权都已成立，才可能进入执行阶段。准备已获授权；它与任何未来资源方向选择都不能替代这些执行条件。

## 已有测量与 UNKNOWN

以下是不同时间、不同范围的观测，不拼成同一次峰值测量。MiB 按 1,048,576 字节换算。

| 对象/时点 | 已有数字 | 能说明什么与不能说明什么 |
| --- | --- | --- |
| 生产 B0，16:52Z | available RAM 567 MiB；swap used 0；disk available 仅记为 13 GiB 概数 | `.design-qa/2026-10-29-separation/production-readonly-preflight.json`；单次主机快照，无 MemTotal、RSS 或历史峰值 |
| 生产 B0，18:41:52Z 索引 | available RAM 637 MiB；磁盘 available 13,416,656,896 bytes（12.495 GiB）；PID399199、current `9c5c3ea95e0c66193b23a2db50643530aa7d095a` | `resume-final-20261029/evidence-index.json`；索引时间不冒称底层每个读数的精确采样时间；不是持续余量保证 |
| 两个旧 release 的可信 Node Linux standby 启动检查 | `memoryCurrentBytes` 139,722,752（133.250 MiB）/98,029,568（93.488 MiB） | `.design-qa/2026-10-29-trusted-node/retained-app-checks.json`；两个串行临时旧应用、无生产 secrets、匿名 ready；不是生产 B0 峰值或本次 B1 native/业务峰值 |
| 修复后的 Mac B1 standalone，19:25:09Z 汇总 | 11 项 HTTP 检查、17 次计数采样；active HTTP 最大1，framework work 最大5 | `repair-standalone-qa/verification-summary.json`，darwin/x64、qaOnly、productionReady=false；这里的1/5是工作计数，**内存/RSS峰值 UNKNOWN**，不能重标 Linux |
| Mac 本地合成2K导出单测 | 已检索历史日志最高RSS250.6875 MiB；选定最终完整Web轮250.47265625 MiB | `test-web-stage01-final.log:1162`、`repair-full-quality-20261029/web-loopback-approved/web.log:27`及同目录`web.json`。`commerce-safe-export-budget.test.ts`每10ms采样、3轮顺序、无外部I/O；不是standalone服务、Linux或允许业务并发峰值 |
| 正式 Linux B1 候选 | 精确 clean commit 制品、允许并发下 cgroup/native峰值、磁盘最大同时增量 UNKNOWN | Mac/dirty 包、旧48e构建、旧release standby、MemoryMax不能填这个空缺 |

父任务已完成一次既有SSH通道的只读观测，原件为 `coexist-resource-readonly/observation.json`（SHA256 `403e14e88fbb075ee61323f1ae6a805fb89f8f182416f65dd1b44d7c33810881`）及 `capture-receipt.json`。服务器脚本记录19:45:27.189684–19:46:09.932005Z，15次间隔约2秒的自然流量内存样本，随后固定目录盘量；没有新增HTTP负载、B1进程或生产写入。本文作者仅本地读取原件。

| 19:45Z 新读数 | 结果 | 限定 |
| --- | --- | --- |
| 主机物理RAM | 1,647,524 KiB = 1,687,064,576 bytes = 1608.910 MiB | 不含swap |
| MemAvailable 15样本 | 612,540–617,420 KiB = 598.184–602.949 MiB | 约28秒样本窗，无合成业务负载；不是允许并发下最低长期余量 |
| B0 cgroup charge | 15样本均406,683,648 bytes = 387.844 MiB；服务后读数389,398,528 bytes = 371.359 MiB | `memory.current`/`MemoryCurrent`是占用快照，**不是峰值** |
| 同一B0进程RSS / HWM | VmRSS342,868 KiB = 334.832 MiB；VmHWM352,300 KiB = 344.043 MiB | HWM为PID399199自身RSS高水位，不覆盖全cgroup，也不证明业务负载覆盖 |
| cgroup历史峰值 | **UNKNOWN** | `memory.peak`和`memory.swap.peak` FileNotFound；systemd未返回MemoryPeak字段；不得以VmHWM替代 |
| B0限制及swap | MemoryMax891,289,600 bytes = 850 MiB；现有SwapTotal1,049,596 KiB，主机/该进程/该cgroup观测used均0 | 已有swap不是新增物理RAM，不承诺使用swap即可安全共存；未增改swap |
| 进程/版本 | PID399199、startTicks344889743、current9c5c3ea…、previous8cbb708…前后稳定；active/running、NRestarts0 | memory.events在15样本均low/high/max/oom/oom_kill=0，只表明这些读取值为0，不代表B1压力通过 |
| 文件系统容量 / available | total41,882,943,488 bytes（39.007 GiB）；available13,416,509,440 bytes（12.495 GiB）；available inodes1,979,068 | 该时刻statvfs；不拿reserved free与普通available混用，不是历史磁盘峰值 |
| 固定B0 / previous release已分配块 | 75,710,464 /240,001,024 bytes = 72.203/228.883 MiB | 独立`du -sx -B1`，不追随外部symlink；不等于包含外部共享依赖/资源的完整闭包，也不应加到releases总量再次计数 |
| releases / incoming / cache已分配块 | 4,355,133,440 /1,477,971,968 /1,875,968 bytes = 4.056/1.376/0.001747 GiB | 三个固定目录；全部release保留，不能以可删假设回收；layer-cache与frontend路径本次exists=false，不能据此把新建所需盘量填0 |
| 新增B1/F1的峰值盘量 | **UNKNOWN** | 本轮没传制品、暂存、解压或创建路径，不存在实测部署峰值 |

`ops/aliyun/zimage.service` 的 `--max-old-space-size=640` 只限 V8 old space；`MemoryMax=850M` 是单服务 cgroup 限制，按850 MiB作预算即891,289,600 bytes，**不是实测 RSS 或能完成业务的证明**。Sharp/libvips、Buffer/上传、字体渲染、ZIP、SDK/fetch、页缓存及子进程都不能被640 MiB代替。`TimeoutStopSec=30` 同样不是 drain 或退休证据。运行中属性仍须以只读实测核对，不能把仓库模板当已安装事实。

历史峰值、当前占用和平台必须分开记录：cgroup `memory.peak` 只代表该 cgroup 计量区间内最高 charge（含部分文件页/内核记账），未必只属于当前 PID，也不证明覆盖最大业务负载；`memory.current` 是同刻 charge，`VmRSS` 是当前单进程驻留，`VmHWM` 是该 PID 的进程高水位。没有接口或读不到时写 UNKNOWN，禁止以0代替。B0至今的历史峰值不是未来上界，更不是 B1 峰值。

## 可重算的资源门槛

预算计算及原输入哈希保存在 ignored `.design-qa/2026-10-29-separation/coexist-resource-plan/`。该目录只放非敏感数字、路径和摘要，不读 `.env`、credential 或 config 全内容。`calculate.py` 在缺少正式 Linux B1 峰值/制品盘量时必须输出 `BLOCKED_UNKNOWN`，不由当前空闲量生成 PASS。

总量先检查：

```text
M_total >= B0_budget + B1_budget + Other_host_budget + RAM_reserve
```

其中 `B0_budget` 至少保留现有850 MiB限制，不为B1下调；历史/业务证据若显示该限制本身不足，就停止本方案而非静默加限额。`B1_budget` 必须依据精确 Linux B1 在允许准入并发、真实 Sharp/字体/上传/ZIP及SDK收尾下的完整 charge 峰值，加经审阅余量，并在候选限额内能完成任务。共享runtime磁盘可复用不代表两个进程共享全部堆/native RSS。`Other_host_budget` 要覆盖 Nginx、原代理/其他服务、内核及正常波动，不能把剩余RAM全部交给Node。

再用同一次采样的增量校核：

```text
A_available_min >= B1_budget
  + max(0, B0_budget - B0_current)
  + max(0, Other_host_budget - Other_host_current)
  + RAM_reserve
```

`A_available_min` 是只读自然流量观察窗中的最低 MemAvailable；它已扣除当前 B0 和其他进程的实际占用，所以不能再把整个 B0 当前占用重复相加，也不能遗漏 B0 由当前值长到保留预算的空间。`Other_host_current` 与内核/可回收页的记账并不总能精确拆分；不能可靠计算就保留 UNKNOWN 并使总量校核失败。两式都是必要条件，短窗通过仍不代表未来业务足够。

建议审阅的暂存准备标准为 `RAM_reserve >= max(256 MiB, 20% M_total)`；这是**新提议的保守预算余量，不是测得峰值、平台承诺或已配置限额**。若需改小，应说明工作负载依据和影响，不能靠调小它把红灯改绿。新采样的定量结果为：

- 两个850 MiB预算共1700 MiB，比1608.910 MiB物理RAM多91.090 MiB，尚未加入宿主和余量；该具体预算不可放行。
- B0由样本current387.844 MiB增长到原850 MiB，需保留462.156 MiB；在对应样本最低available598.184 MiB中扣除后只剩136.027 MiB，**尚未放入任何B1或其他宿主增长**。
- 建议余量为321.782 MiB。单是该余量就比上述136.027 MiB多185.755 MiB，因此按此准备标准也没有可分给B1的预算。原637 MiB/后来的598 MiB余量都不能成为承载保证。

这些是上限预算/快照的保守门槛计算，不是断言B1实耗850 MiB；也不证明所有未研究配置永远不可行。正式 Linux B1业务峰值、其他宿主峰值预算仍UNKNOWN，不能凭压低B1限额宣布可用，或通过真实生产试跑补证。

磁盘使用**新增峰值**，不能拿源码tgz或前端payload当总盘量：

```text
D_available_now >= D_transport_archives + D_new_assembled_B1
  + D_new_F1_and_old_static_extra + D_new_runtime_assets_store_cache
  + D_validation_temp + D_log_cache_growth + Disk_reserve
```

每项须记录所在 filesystem、真实已分配块/逻辑字节、是否已包含于其他项和最大同时驻留阶段；hardlink按实际inode去重，不能仅凭“同锁文件”声明共享。已在 free 中扣除的 B0/previous 不重复加成新增量，但它们不可删，且仍需记录保留盘量。建议 `Disk_reserve >= max(1 GiB, 10% filesystem total)`，同样是待审阅预算提议；新读数对应余量3.901 GiB，12.495 GiB available扣除后尚有8.594 GiB可用于**全部新增项目**，不能在项目仍UNKNOWN时宣称够用。还需 inode 足够、临时目录位于哪个挂载点及日志/cache增长上界。旧包的13GiB free只说明该时刻存储余量，正式 B1制品、暂存复制及增长未知则仍不能放行。现有包不在生产构建，不能把 ECS 构建临时量默认为0然后在其上构建。

## 固定 B0 与取消边界

现有 service 的 WorkingDirectory 为 `/opt/zimage/current/apps/web`，字体 EnvironmentFile 也含 current；现有 backend helper采用单 unit/单后端 current，native检查刻意排在旧API安全停止后。它们没有现成共存能力。临时方案至少要审阅以下窄实现，本文没有安装或创建它：B0继续原PID但未来故障重启仍绑定原release；B1固定另一release/监听/私有生命周期目录；自动restart、current/previous和字体指针均不能把B0悄悄变成B1。只看现PID cwd不够，须核故障重启身份；也不能为固定身份先重启B0。

兼容路由按 `legacy-tab-migration.md`：旧Next协议/资源/image归固定B0，业务API归B1，F1用独立版本命名空间。B0历史detached任务可能继续消费Storage/续租/Sharp；B1新计数不覆盖它们。API失败不自动投回B0或重放计费请求。真实同owner/auth连续性、切换后新Flight路径、引用和已有session、optimizer、精确整组恢复及Linux入口验证仍是独立门槛。

资源或身份检查在启动前失败：不启动，不改B0、不切流。若后来另获授权启动但尚未切流，异常应保持旧入口，在B1关新准入后按其真实生命周期收尾；不能假设未公开即无内部/探测/native工作。若已切流，封闭新准入、精确记账恢复和旧页/API兼容必须按单独审阅执行单处理，不能由资源报警自动stop任一未知PID。不得通过放宽安全余量、降低B0并发、改swap或强杀使验证通过。

## B0 保留多久，如何退出

**目前无法承诺保留24小时、7天或任意固定天数后就安全退出。保留持续到以下两个条件分别有证据，且都成立。** 执行单应填写负责人和首次复核时点；复核到期是重新作决定，不是定时停止命令，也不允许无限期忘记容量与旧版本安全维护。

1. **旧页面条件**：所有仍依赖B0协议的旧页已完成用户确认的未发送草稿/引用/未定请求保存并离开，或完成经验证的迁移。当前没有部署到所有既有页面的升级确认/在线计数协议；安静访问日志、无连接、仅新F1访问和一段等待时间均不能证明没有休眠旧页。新JS不能追溯读取旧页内存。
2. **旧进程条件**：对同一B0 PID/start/boot/release封闭全部新应用准入（含HTTP2后续请求、GET/RSC/image、直连/内部来源）；所有已准入工作及离开HTTP后的graph/health、native/Storage、renewal、ZIP取消/finally和补偿都真正完成，固定观测自身也完成，有独立可信的历史闭合凭据。没有新lifecycle的B0不能假装返回新计数。账务终态、队列空、响应结束或systemd30秒都不能补齐缺口。

任一条件 UNKNOWN 就不停止、不删除B0 release/资源，也不声称无损退休。全部旧页关闭不等于服务端工作结束；服务端空闲也不等于用户草稿已保存。若无法补齐历史闭合材料，保留方案只是延后风险决策，不能把时间流逝称为门槛通过。

## 费用与替代选择

本轮没有创建资源、扩容、安装、业务调用或新增收费动作。按本方案只使用既有ECS不会创建另一份实例/磁盘订阅；现有ECS原账单继续，后续真实运行的流量、日志和存储使用是否影响按量费用取决于现有合同，**未读取账单，增量金额 UNKNOWN**。这里没有报价或“永远零增量费用”的承诺。任何新增付费资源/扩容仍不在范围内。

| 替代 | 用户/业务影响 | 现阶段能否执行 |
| --- | --- | --- |
| 保持当前B0，延后分离切换 | 新F1/B1不上线；原有体验和工作继续，最少生产变更 | 当前实际状态；可继续本地工作与已授权只读取证 |
| 单实例顺序短维护 | 无需双进程预算，但要关闭新准入并安全停止B0；旧页迁移和历史闭合仍必须解决 | 缺两个退出条件时不能执行，不能强杀凑维护窗 |
| 仅F1+B0 | 想省B1内存，但F1要求真实`/api/meta`和`/api/public-config`，B0没有这些新端点 | 现有代码不兼容，不能伪造元数据/跳过校验 |
| 复用另一台已存在且已授权的匹配主机 | 可隔离RAM和故障，仍需制品传递、路由、成本/安全及旧页退出验证 | 未有该资源证据，UNKNOWN；不得自行新建或借用 |
| 新增实例或扩容 | 可能放宽容量，但增加费用与运维；并不解决旧页或历史收尾证明 | 当前禁止；须独立具体选择和费用上限批准，本文不提出执行请求 |

远端源码目标仅记录父任务只读确认的 `https://github.com/zhYAO/Image-web.git`，owner `zhYAO`、name `Image-web`、private；push权限不是发布批准。冻结提交/push、Nginx配置上传到生产`/tmp`及`nginx -t`已经自动审批拒绝且未执行，保持暂停。本方案不重试、不换通道、不向用户重复询问这些已拒动作。正式Linux clean制品和入口验证仍被各自门槛阻塞。

## 最小只读观测建议与验收材料

父任务若在既有授权内读取，应只输出固定字段：同PID/start/release的`systemctl show`白名单、`/proc/PID/status`的VmRSS/VmHWM、该ControlGroup的memory.current/peak/events/swap.current及选定stat键、`/proc/meminfo`选定键、固定filesystem的`df -B1`/inode、固定release/frontend/store/cache/incoming路径的`du -sx -B1`。先后核PID和指针一致；自然流量短窗不发HTTP/压测，不启动B1，不清峰值或cache，不读Environment、credential/config全内容。接口缺失、权限不足和指针漂移均如实保存；不是换身份重试的许可。

资源放行最终材料必须能回答：精确B1制品是谁、何平台、允许怎样的准入并发、各类native/上传/导出/异步收尾是否覆盖；B0和其他服务保留多少；何时/何PID/cgroup读到什么；RAM两式和disk新增峰值是否同时成立；实际限额内无OOM/kill/失败且有取消与恢复证据。**只读取数可以减少UNKNOWN，不会自动给出启动或切换许可。**
