# 2026-10-31 无用代码清理与 main 合并

用户要求：清理无用代码后合并 main。范围为本地仓库，不推送、不触发 Actions、不重新部署线上。

## 清理依据与范围

清理前工作区干净；`git fetch origin` 后本地 main 与 origin/main 均为 `9c5c3ea`，main 是开发分支的祖先，可快进合并。没有丢弃或重写既有提交。

对仓库代码、测试、构建别名、动态导入和文档搜索后，确认下列定义没有调用；清理提交为 `341ce3c1830199b0ce7e8ced952de686eafdb0e4`：

| 删除项 | 理由与保留入口 |
| --- | --- |
| `FadeContentEffect` 及独有 Props | 无调用；保留实际使用的 FadeContent 和共享动画 hook |
| `initLiquidGlass` 及独有选择器 | 无调用；GlassSurface 动态加载实际调用的是 enhanceLiquidGlass，保留该入口 |
| `buildSkillPromptPreview` | 无调用的旧预览函数；没有改写真实提示词构建流程 |
| `sceneForSkill` | 无调用的旧技能到场景映射；保留实际目录和 templatesForScene |
| `taskActionSchema` | 私有 domain 包中无消费者的独立 schema；不改变实际路由校验和持久化数据 |

保留实际 Next/API 路由、mock/HTTP 网关、前端平台别名、对外类型、原生库、字体许可、发布及回退工具。未做整目录搬迁或删除验收资料，`.design-qa/2026-09-16-real-acceptance/` 保留。此次不是磁盘缓存清理，不声称节省了部署包体积。

同时修复前端 `dev-server.test.ts` 的端口冲突：Vite7 将配置端口0解析到默认5173，fixture改为 Vite middleware 加 Node 分配的真实随机回环端口，关闭无关HMR，保留真实资源限制、Origin/Host/Cookie/SSE检查。没有停止现有 dev:split 服务或改生产端口。

## 验证方法及首次失败

独立检出 `/private/tmp/zimage-main-merge-20261031`，固定 Node24.19.0、pnpm11.19.0；按冻结锁文件离线安装，未修改锁文件、升级依赖。

首次复用依赖链接时，pnpm 的自动依赖检查调用了不匹配的默认子进程入口，lint 尚未执行即遇到 lockfile config mismatch。随后固定 pnpm 子进程入口并为新检出安装独立依赖；旧验证目录被自动检查移除的链接已通过原锁文件离线安装恢复。首次失败日志保留，不将复验写成一次成功。

所有结果原件在 `.design-qa/2026-10-31-main-merge/`，以下最终结果由实际退出码填写；本轮不进行真实模型/浏览器/数据库复测，不新增积分消费。构建是本地 darwin-x64 编译验证，不能上传为 Linux 运行包。

## 自动验证结果

| 检查 | 结果 |
| --- | --- |
| lint | 通过，27.0秒；框架有 pages 目录提示，退出码0 |
| 类型检查 | 三个工作区均通过，22.7秒 |
| Domain 单测 | 14文件，209/209 |
| 独立前端单测 | 22文件，190/190；原两个端口冲突用例已实际通过 |
| Web 单测 | 148文件，1232/1232 |
| 单测总计 | 1631/1631，整体399.6秒 |
| 验收预算工具 | 5/5 |
| Next 生产构建（webpack） | 通过，138.4秒；49个静态页面，依赖追踪完成 |
| Vite 前端生产构建 | 通过，16.3秒；5个公开页面预渲染和静态资源校验通过 |

本轮全套前端通过更新了此前188通过/2端口冲突的状态；此前失败仍留在历史报告。数据库、Worker专项、真实上传/生成/下载以及浏览器流程没有因这次单测通过而自动成为新的验收结论。


## 合并与发布状态

本地 `main` 采用 `git merge --ff-only codex/frontend-backend-separation-20261029`，保留开发分支和完整提交历史，不创建冲突合并、不强推、不触发 Actions。最终文档提交只记录结果；全部代码检查对应清理提交 `341ce3c`，隔离构建后源码仍为 clean。

本次没有更新线上：`www.zimage.store` 仍是已发布的后端/应用源码 `fb4fb09`、前端 `release-fb4fb09f909c`。Mac 构建输出仅用于合并验证，不是可上传的 Linux 部署包；既有上线包、大小统计及回退材料不变。Next 构建的 Sentry 全局错误处理器建议提示保留在日志中，构建退出码为0。
