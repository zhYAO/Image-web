# 2026-11-06 Zimage 候选发布检查点

状态：真实正式构建及 Linux 封包通过，生产 Web 未激活。不是上线完成证明。

应用源码是原开发分支的真实本地提交 `7a811b326aa4b344cee08bc5a33c04e44a780fd4`，没有推送或触发 CI。独立 clean worktree 的946项源码在正式构建前后完全一致；保留用户原来的 next-env.d.ts 和23项 .env.local 元数据，未读取密钥值。后续运维工具/文档提交不得重标此应用产物。

Mac Node24.19.0、pnpm11.19.0，既有可信 store 的 frozen/offline 安装通过；标准 Next webpack 构建115.418秒、前端构建16.639秒均exit0。五键公开输入SHA为 `5fdc6d9e21747233462acc72095134b1ecb3aa596bd8646af945d14c981416d0`，没有供应商或service_role密钥。完整73项资源仍是线上相同的 bfb3e444 版本，未用仅字体的资源目录替代。

隔离 Linux 验证已使用现有 zimage 用户、可信 Node24.19.0/ABI137/glibc2.35，PrivateNetwork、NoNewPrivileges、ProtectSystem=strict、ProtectHome、只读/tmp，只允许新output写入，限制256MiB、无swap、CPU25%、180秒。没有安装依赖、Next构建或修改生产服务。3308处静态native导入解析无缺失，37个生成分块完整，Sharp JPEG/WebP/AVIF往返通过。不能据此声称所有动态分支、真实图片请求或浏览器体验已经验证。

正式Linux manifest SHA为 `282f0500d895f9beb97bfff81d9658708df61e754442297648591d20ad6cca37`；build ID/marker/source commit均为7a811。新code层4,580,033字节，归档SHA为 `81b9ffc5252891a63d684136e2454221123865ed815b2b92c9e031a3a2e14706`，已取回Mac独立验证。runtime索引身份 f8575be5、归档SHA e68ba834 与现有线上原件完全一致；完整资源层身份也相同。报告保留 `businessBuildOrigin=darwin`，Linux字段是组装和原生验证平台，没有伪造Linux编译来源。

保留的失败：第一次封包因资源输入与缓存父目录重叠被原工具拒绝；复制已验真资源到候选专属目录后通过，未放宽原守卫。启动检查第一次因无网络环境中的live-session RPC返回503而停止；此状态不能记作401或认证通过。下一轮又明确拒绝首轮启动新增的18项Next route-cache（既有文件无缺失或更改）；冻结归档未变化，后续启动必须使用独立工作副本，不得部署已启动的staging。

前端正式主体已生成：namespace `release-7a811b326aa4`，candidate SHA `78c970c3a53b6b188d323140546578159fee5605d72186dd42eb03ef88469f0d`，payload index SHA `1af7f99d4fb807ff6bdb742da407c377a981ffb323c7ae45e48d5446a8afa67a`。它仍明确 `acceptanceRequired=true`。没有构造虚假的authenticated或verifiedBackends验收材料来打正式包。

生产仍为fb4fb09，原服务active；第6项chat_usage_settlement未执行。03:43:58UTC数据库只读检查：141,749,395字节、41项迁移。没有重复迁移、备份、旧数据处理、生产指针切换、密钥变更、价格发布或付费模型调用。数据库仍低于Free500MB；组织的出站、Edge及Storage必须在实际切换前再看带延迟的用量，不能承诺以后永不超额。

有限启动验证最终通过：独立副本6个公开/页面响应200；两个规范地址/home?_rsc及/account?_rsc均200、text/x-component。/account是无身份依赖可用时的降级页面，并非真实账户验证。三个私有GET返回符合network/retryable/no-store契约的503，明确authenticatedPathsVerified=false、unauthenticatedBoundaryVerified=false、browserExperienceVerified=false。v3耗时17.316秒，固定RSC补验v4为14.900秒；子进程由各自finally清理，未停止生产PID。首轮未经规范query的RSC307仅记跳转，未当作组件响应通过。

下一步门禁：

1. 使用本人安全提供的既有测试登录态完成只读账户/会话/目录验证；现有verifier只接受本机 `ZIMAGE_AUTH_COOKIE`，代理不提取浏览器Cookie，不要求在聊天发送凭据。无网络隔离测试不能替代真实Supabase鉴权。
2. 第6项迁移SHA仍为 `e02af4ba32942e8718ed0a2de9b1598e1329fe62fd44f286f2992d437687b22f`，必须在真实封口、七项生命周期计数归零后与匹配Web/前端配对，不在旧Web开放时独立应用。
3. `/etc/zimage/backend-release-policy.json`仍缺失。现有独立backend事务只允许schema/Worker/catalog版本不变，不能伪造“相同版本”套用本次迁移。需先完成并审查迁移配对维护/恢复操作，再对准确root策略/协调器安装取得所需授权；不能复用已经opened的旧manual操作或仅改current。
4. 完成新旧前端组合、正式前端批准和真实浏览器验收后才能激活。新模型、令牌费率及套餐开关继续安全关闭；模型实调、最终价格及开启仍是单独事项。

本地完整运维Python套件在Mac仍存在Linux/glibc/GNU工具及sandbox依赖失败，未冒称全绿。新增运行层复用12项和源码交接28项单元测试通过；功能回归与真实构建的范围和原始失败证据保留在任务verification。

主要证据：任务 `verification/formal-mac-paths.json`、`formal-mac-build-summary.log`、`runtime-reuse-review-{red,green}.log`；其root下 `linux-acceptance/{isolation-result-v2,release-result,linux-import-resolution}.json`、正式manifest/code归档；`out/frontend-subject.json`、`out/isolated-linux-input-strict-v2.json`。独立审查确认复用权限/链接守卫及限定启动脚本修复；审查本身不替代实际运行结果。
