# 上海 ECS 自动发布计划复核

复核对象：[小项目 PR 合并发布计划](../plans/2026-11-25-1506-fix-aliyun-merge-release-plan.md)。审计基线：`origin/main@a0de637f8aa3d59ac873c8db6c9e3d7b1f7f08db`，2026-11-25。

**结论：建议按两个工作流实施；现在不要启用生产发布。** GitHub 已经能处理受保护分支的合并并构建前后端，缺口在 ECS 的接收和首次切换。简化的收益是去掉另外两个入口，日常不需要挑候选包或手动发送。下面区分哪些结论经过在线核对，哪些仍是待实施、待验证的设计。

## 复核时发现并修订的事项

| 问题 | 已写入计划的处理 |
| --- | --- |
| 直接删两个 YAML 会使原门禁失败。生产测试读取 SSH 诊断 YAML，旧候选工具及测试读取 `ci.yml`，部分测试还固定了旧组装器的字节。 | 先迁移仍有价值的快检、深检和发送端验证，退役 ZIP 的生产者及远端选择器，再删除两个 YAML。同一实施 PR 验证，保留 `zimage-release-pr-required` 名和生产签名工作流路径。 |
| 外部 fork 被 job 条件跳过时，GitHub 可把必需检查视作成功；仅看 run 顶层状态也不能区分构建与发布。 | 来源不符合策略，在 checkout 之前明确失败；被选中的强制检查必须实际成功。生产分别报告未发送、结果待对账、已恢复和已提交。 |
| Linux 上反复创建硬链接会改共享文件的 `ctime`。现有事务夹具替换了部分原生预检，单靠它不能排除健康候选和旧版被一起拒绝。 | 永久与临时组装都隔离 Next 文件，保留原字节/身份检查及只读模式。新回归从**真正使用旧式硬链接**的前任开始，覆盖准备后继、切换及恢复。此发现来自代码审阅，尚未在本轮运行 Linux 修复用例。 |
| SSH 身份验证成功不代表账户能执行接收器；`kit.py check` 也不能证明停止前已排空。 | 分别验固定公钥、有效强制命令、精确 sudoers 及账户 shell。先确认原 PID 排空再停；冷启动时保持 Nginx 外层封闭，在应用门禁 `open` 时检查新的真实 PID，最后才重新对外。 |
| 发送后断线时，服务器可能已准备文件，但还没写 `switching`。 | 不用“没看到日志”推断“没发”。由管理员在同一部署锁下对账 SHA、包摘要、实际进程、前后端指针和公网版本；`restored` 计作恢复成功、发布失败。 |

## 实测、依据及其边界

- **GitHub：** 核过生效 ruleset、`production` 的允许分支、配置项名称和最近的 job 结论。[合并运行](https://github.com/zhYAO/Image-web/actions/runs/45539467107) 的 `build-only` 为 137 秒，`publish` 跳过；[SSH 运行](https://github.com/zhYAO/Image-web/actions/runs/45534241885) 仅证实认证。两者都不是线上发布回执。
- **阿里云：** 在匹配的上海 Ubuntu 实例，通过云助手取得实际执行结果。07:02 UTC：旧应用 active，旧前后端在位，已安装 kit 的入口通过字节核对；管理员检查因 `/usr/bin/gh` 缺失退出 1。验签根、目标策略和绑定该 kit 的已加载 preload 当时都未就绪。07:03 UTC：复核了发布账户和精确 sudo 许可的缺口。这是只读观察，不是首装或切换演练。
- **公网：** 在客户端正常校验证书和主机名，6 个匿名契约检查通过，观察到旧后端 `7a811b3` 和旧前端 `release-7a811b326aa4`。只读服务正常不证明真实登录、付费生成、生产 DB 兼容或备份可恢复。当前证书有效至 **2026-12-16 14:41 UTC**；未验证续期能否自动成功。
- **代码：** 对照了 `production.yml`、`pr-build.yml`、`ci.yml`、独立 SSH 诊断、成对构建动作和接收器的准备/激活/回退分支；还查找了工作流文件名、`candidate-build` 及旧候选工件的消费者。GitHub 的[跳过检查语义](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)、[离线验签](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline)和阿里云的[命令实际执行结果](https://help.aliyun.com/zh/ecs/user-guide/check-execution-results-and-troubleshoot-common-issues)用于校核相应判断。
- **文档一致性：** 已从 `origin/main` 的 Git 对象解析四份工作流定义，核对必需检查名、生产触发分支、旧候选 job 和两棵迁移树；计划、复核记录及新增进度条目的本地链接均可解析。

## 什么情况下可以说“打通”

先让实施 PR 在开关关闭时过 Ubuntu 门禁，完成一次性 ECS 准备和数据库兼容复核，再在维护窗口通过新的受保护合并首发。最后一笔必须同时具备 **Actions 合并 SHA 与包摘要、ECS `committed` 的同一 SHA 与摘要、外网实际提供的新前后端版本**。本轮完成的是计划与复核；工作流删除、Linux 回归、主机配置及首发仍待实施。
