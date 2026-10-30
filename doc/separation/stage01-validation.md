# 前后端分离阶段0/1本地集成验证 — 2026-10-29

结论：阶段0/1本地代码门槛通过，等待独立审查确认。生产仍暂停；没有commit/push、数据库迁移、生产连接或实际付费业务调用。阶段2及后续完整功能、静态入口、制品与回退门槛不由本报告代替。

## 冻结范围

- 分支`codex/frontend-backend-separation-20261029`，基线`48e35686e0e4d6b302a1940cb12f5ea1be84860e`。未提交的变更另以QA源码指纹绑定，不能当作该commit的生产产物。
- 隔离源码`/tmp/zimage-separation-s4-qa-20261029`，682文件，指纹`2dc028dbadd96fbbb46ad9e9fa26adca6e9a79a5bb1591d2921c3f5d4c6b4988`。前端会话继续修改的源码不进入这次冻结快照。
- S1严格运行合同及兼容函数冻结；S2两个公开只读接口；S3 API/OpenAPI与路由策略；S4精确Proxy例外及严格类型修复。原49个API文件/58个显式方法不变，增加后为51文件/60个显式方法。

## 实测结果

| 门槛 | 结果 |
| --- | --- |
| 完整domain | 13文件、195项通过；TypeScript通过 |
| 完整Web | 132文件、1079项通过，339.86秒 |
| 完整阶段0/1 lint | apps/web及domain通过，零规则错误/警告；保留Next预设无根pages目录提示 |
| Web类型 | 严格TypeScript通过；P1修复后standalone构建的TypeScript再次通过 |
| 预算保护 | 5项通过 |
| Worker回归 | 6文件、80项通过 |
| 实际Next16.4.1 Webpack standalone构建 | 成功，91.404秒；Mac Node25.9.0，本地QA，productionReady:false |
| 实际standalone HTTP | 三个启动环境共18项公开GET/HEAD/OPTIONS通过；受保护身份RPC故障对照返回503 |

首轮Web的1062通过/15失败保留，不覆盖历史。13项受Node25不完整原生Storage影响，2项受Mac临时路径别名影响；仅用命令环境`--no-experimental-webstorage`和`TMPDIR=/private/tmp`纠正，未放宽产品、字体或安全断言。相关4文件65项先通过，随后完整1079项通过。

## P1：配置来源闭环

新meta改用与ready相同的编译版本引用；公开模式、认证、Supabase配置与CAPTCHA使用和原Proxy/Auth/Supabase相同的静态命名NEXT_PUBLIC引用。法务版本继续逐请求读取运行期值，没有新增发布者必须手工重注入的假设。

同一份真实standalone分别启动：

1. 不重复注入版本与公开构建变量：ready/meta版本一致，公开配置正常。
2. 注入另一合法SHA及相反auth/data模式、不同公开Supabase/CAPTCHA值：版本与实际编译配置保持一致。
3. 运行期撤销法务版本：返回null、关闭注册，其余编译身份保持一致。

每个启动场景均验证两个公开接口的GET200/HEAD200/OPTIONS204、no-store、无Set-Cookie、HEAD/OPTIONS空body与允许方法头，身份夹具访问次数为0。身份RPC对照实际访问本地故障夹具，返回503；没有使用真实Supabase，也没有以此宣称认证刷新/撤销/并发会话等阶段2门槛通过。

首次对照使用过期合成会话，触发SDK原有约30秒刷新退避，超过夹具15秒期限；保留超时记录。之后复用同一构建，以未过期合成会话隔离验证身份RPC故障，没有修改SDK、延长产品超时或放宽503要求。真实刷新时序留给认证专项。

## 资源与副作用

字体来自本机已保留的原始Noto资源，字体、许可与来源字节严格符合既有固定hash；没有下载替换字体或修改校验。SDK故障夹具和standalone仅绑定127.0.0.1，所有自有服务器均已停止。

构建仅将QA副本的`next-env.d.ts`指向自有`.next-build-qa`类型目录，其余受索引文件未变。原工作区构建输出和用户产物未改。QA输出暂供独立复核；不作为Linux包、生产候选或verified生产组合。

共享依赖接入独立前端包已完成：根锁仍891包，原package版本与完整性未变；仅新增frontend importer和pnpm规范化optional标记。前端的真实模块迁移与其最新验证由该任务另行交付。

## 证据

`.design-qa/2026-10-29-separation/`：

- `stage01-integration-evidence.json`：源码/生成文件/验证器hash、完整测试、构建、18项HTTP观测及停止状态。
- `qa-source-snapshot.json`、`test-web-stage01-final-result.json`、`test-web-stage01-final.log`。
- `stage01-qa-build-result.json`、`stage01-qa-build.log`、`runtime-http-result.json`、`runtime-http-run.log`、`verify-runtime-http.mjs`。
- `runtime-http-result-expired-control-timeout.json`、`runtime-http-run-expired-control-timeout.log`：原超时证据。
- `stage01-independent-regressions.json`、`lint-stage01-final.log`、`frontend-install-evidence.json`、`stage4-checkpoint.json`。

下一步：独立审查P1闭环与冻结范围；继续真实前端/认证模块迁移、资源与入口HTTP状态校验、制品封存与协调恢复实现。真实Supabase/计费任务、旧标签页RSC/chunk/图片优化/草稿、Linux原生、首次排空、维护状态跨重启和生产精确回退仍分别验收。
