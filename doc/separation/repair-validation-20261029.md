# 首窗及全请求排空修复验收

2026-10-29 UTC。本报告接续 `resume-validation-20261029.md`。**本地代码缺陷已经修复并独立复核；迁移/生产验收仍未完成。** 未执行此前被拒的 Nginx 上传/nginx-t，没有生产变更、数据库迁移或收费调用。

## 已关闭的代码缺陷

1. **零快照后新读准入。** 可信 Node preload 在原 Next standalone 创建 HTTP server 前安装同步准入边界。schema2 gate 为 `open/draining/checking`；draining 拒绝全部新 HTTP/upgrade/CONNECT，checking 仅固定 GET/HEAD 探测和审阅静态路径。已准入工作继续，HTTP 计数到 listener Promise 与响应终结两者均结束；不能因 TCP close 先归零。
2. **Next 图片优化的脱离响应工作。** 实测发现 stale ResponseCache 可在后台优化前返回旧响应，另有 disk-LRU 提前初始化及未 await 的淘汰。preload 对锁定 Next16.4.1 的 get/handleGet/revalidate/handleRevalidate、disk-LRU init/eviction 做透明计数；绑定九个实际源码文件 hash、模块/函数身份，缺失/升级/提前加载/篡改时关闭。保留原 fetch、Sharp、cache-write 和失败保留的返回/异常语义，不改框架文件、业务 payload 或 build ID。
3. **首窗初始化与真实 B0 恢复互锁。** 新独立 `first-window.py` 及 `first_window.py` 使用 root 审阅的真实 legacy 前端身份，允许静态 current 真正不存在，不要求 B0 假 meta/socket/drain。原通用发布 helper 继续严格要求新协议。只有原 SHA/PID/start/boot、服务/入口/兼容来源和外部历史完成材料齐全才可开始；程序不创造这些历史事实。
4. **恢复/崩溃/审批竞争。** 每次 stop 前均先关新读，再等业务+HTTP+framework 全零；取消前重核前端和兼容策略，漂移不能开门。未知新候选或新 legacy PID 不被收养/停止，需已持久记录的精确身份；丢失启动结果保持 sealed。run/recover 把明确期望 policy/completion 摘要传到固定 root helper，在同锁下、任何准备/写入之前比较，并绑定 journal、后续 stop。审批刷新不被静默采用。CLI 阶段表与 root 真实阶段一致。

新维护响应保持 domain API error：network、UUID correlationId、retryable、Retry-After30、private/no-store。生产启用生命周期时必须存在有效 production bridge；测试 installer 的 qaOnly bridge 不能被当作生产证明。普通 Unix 管理 socket 仍不触发 systemd activation，没有新增公网管理入口。

## 首窗执行边界

`first-window run/status/recover` 是独立固定 CLI。历史 completion、legacy 前端、候选 manifest、兼容、原入口和服务模板均由 root 预先审阅并绑定。新后端仍须真实 v2 verifier/native/fonts；B0 恢复只走真实旧 ready、PID/start、安全 account/sessions，加独立 nonce/process/policy 绑定的纯 SELECT 钱包/账本审计，不请求 wallet/ledger GET，不要求 B0 冒充 v2。

候选成功只达到 **backend_ready 且内外入口仍 sealed**，不自动开写、公开 F1 或声称整组迁移完成。legacy 恢复也保持 sealed，保留最初失败。固定候选/legacy drop-in 只在服务已停止后原子安装、fsync、daemon-reload；原可信 Node、UID、环境来源/字体及资源限制不变。没有默认双跑或新增生产 unit。

本地 Nginx 候选同时覆盖 legacy/split。固定 open/maintenance/checking 三标记默认缺失/无法 stat/矛盾则关闭，显式 open 才正常开放；禁 stat 缓存。Nginx 只判断存在性，root helper 验证非符号链接、受保护祖先、内容和操作 epoch；它不是恶意 root 下的安全隔离。新候选未上传/安装，真实 Linux Nginx 语法、HTTP2/直连/内部覆盖仍待验。

## 新鲜验证

| 范围 | 结果 |
| --- | --- |
| backend Python | 85/85；包含实际 wrapper 审批 CAS、服务模板原子替换及首窗/恢复子场景 |
| CLI Node24 | 34/34；固定参数/协议、阶段对齐、秘密隔离、结果不确定仅查状态 |
| HTTP/Next hook Node24 | 18/18；实际 Next ResponseCache、Sharp、延迟 fetch/write、磁盘 init/eviction |
| 聚焦 Web 生命周期 | 50/50；真实 localhost 503 用 domain apiErrorSchema 校验 |
| Nginx 策略夹具 | 新入口8+原split8通过；不等于 nginx-t |
| Linux 交接适配器 | 23项离线守卫；脚本逐字节继承既有审阅适配器，未实际 Linux 构建 |
| 独立安全复核 | 无剩余 Critical/P1；9个独立后端反例、2个实际框架反例、其余边界测试通过 |
| 最新完整业务/前端/domain/Worker/预算及 lint/类型 | 单轮 Web144文件/1189，frontend167、domain195、Worker80、预算5，合计1636通过；lint510文件零诊断，三项tsc通过 |

初轮 Web 1188通过/1失败停在新 HTTP fixture 的 sandbox listen EPERM，未进入业务断言；定向相同测试获准 localhost 环境1/1通过后，重新执行整套 Web，单轮1189/1189、374.771秒、exit0，不把两轮拼成单轮成功。CLI 在复审中修改时仅宽输入快照不同，实际 lint/类型/业务输入投影（包含 preload）保持一致；原快照及排除范围完整保留。独立汇总曾因 Path 组件排序与字符串排序混用而报元数据失败，保留原报告，按原有序清单精确重建摘要后核验；不是源漂移，也没有重跑或改绿业务断言。

实际 Node24 Mac standalone 新构建：第一次 QA 拷贝漏 worker 类型依赖，TypeScript 失败如实保留；补齐完整 Git 白名单后 exit0、61.132秒。实际启动 11 项检查通过：图片优化200、观察 HTTP 峰值1/framework峰值5、checking允许/拒绝、draining后20个新GET均503。17次观察后全部计数归零才停止自有PID16474；独立允许环境确认4186 ECONNREFUSED。仅移除自建隔离 `.next-build-qa`，保留来源、日志和编译文件摘要。该检查使用显式 qaOnly 注入、生命周期禁用，**不证明 Linux root 控制文件/权限/socket 或真实业务环境**。

证据目录均在 `.design-qa/2026-10-29-separation/`：`repair-safety-review/REVIEW-FINAL.md`、`backend-window-fix/`、`first-window-cli/`、`http-admission-fix/`、`repair-full-quality-20261029/`、`repair-standalone-qa/` 和 `linux-handoff-entry/`。失败轮、修复前反例和源码指纹不覆盖为成功。

## 旧 B0 草稿：选择与证据边界

可继续验证的最小方案是保留固定 B0 上游的真实 Next Flight、旧资源/optimizer 和身份连续性，F1 与新 API 使用独立候选。不能把另一 build 的 Flight 给旧运行时，也不能用 401/503 作为升级提示；B0 身份错误可能卸载工作台。新 JS 无法追溯保存原页面内存草稿。

真实 B0 `/home` 的四个请求变体已无 Cookie 地捕获，ready 前后绑定 `9c5c3ea…`，原字节/请求头变体保存。local harness 的43项有限检查通过，并补验新增两个原样200变体；没有重写 b 字段或将 B1 响应重标成 B0。

Terra 的新对照中，旧 B0 草稿经 `/home` 和 Back 返回仍在，且没有 document 请求。**该轮实际使用切换前的 B0 预取缓存**，不能称切换后新 Flight 请求、所有页面、引用、真实认证或业务已经通过。此前 missing-variant 导致整页导航的失败单独保留。原夹具PID11872退出原因 UNKNOWN；确认它不在后才获准新 owned run，PID14680最终按身份核验SIGTERM、session exit0、端口4184拒绝连接。详细原始记录见 `legacy-preserved-upstream/`。

保留 B0+B1 需专门拓扑、独立 PID/端口、取消/恢复及真实资源验证；637MiB 快照不是承载保证，也不能静默降低 B0 限额。是否允许准备临时限额共存已提出，**未答复前不执行依赖生产动作**。保留 B0 仍不能补造其历史收尾信号或自动确定退休时间。单实例方案只有在旧页保存/离开及真实旧工作最终收尾均有证据时才可停机，不能强杀凑窗口。

## Linux 并行输入及剩余外部门槛

仓库新增实际受门禁入口 `ops/aliyun/linux-handoff.py`，无需云端访问本机 `/tmp` 脚本。流程见 [精确源码传递](./linux-source-transfer.md)：最终真实 commit → 仅 push 当前获准分支 → 云端现有 repo 精确 fetch/FETCH_HEAD 比对 → clean detached checkout → 独立完整索引/归档与父 expected 指纹比对 → 原受控匹配容器 fresh preflight → 原五键/字体/store/回传通道核验 → build/return。

最终 commit、tree、完整文件数/字节/逐项mode+SHA、总指纹与确定性归档 SHA 放在提交后的外部 receipt，避免源码自引用。实际执行结果和可访问性独立记录；本地包不称云端可用。正式 Linux 输入不复用48e旧构建、不用dirty包或Mac native重标。

本轮尝试冻结提交并 push 当前获准分支时，自动审批在 CreateProcess 前拒绝整项命令：认为写入 GitHub 的具体目标/源码发布授权不明确。**没有执行 stage/commit/push**，只读核对 HEAD 仍48e、index无暂存，全部工作树改动保留。已提出明确批准 `https://github.com/zhYAO/Image-web` 的 `codex/frontend-backend-separation-20261029` 分支提交推送问题；未答复前不重试，也不改用 Library/API 传源码绕过。随后只读连接器确认该 remote 对应当前账号 zhYAO 的 private 仓库且有 push/admin 权限；这只是目标核验，不冒称发布授权已解除。因此此刻只能生成最新 dirty 本地源码交接，正式 Linux clean 输入仍等待该冻结动作获准。

真实 B0 历史闭合、临时共存许可/资源、Nginx审批与实际入口、匹配 Linux/Windows、Supabase/Storage/SSE/队列/账务、精确组合恢复、15分钟/24小时观察仍未通过。此前 `47.100.222.24:/tmp` 配置上传及 nginx-t 仍为**自动审批拒绝、未执行**，缺少明确配置出站授权；本轮未重试、未换路径。全部新增远程操作仅固定公开 GET 的只读证据，不是配置传输或发布。
