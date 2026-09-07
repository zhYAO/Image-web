# 账号子任务实施要求

先读 apps/web/AGENTS.md、doc/phase2-implementation.md、既有认证客户端、route-context、Supabase migrations/cleanup worker。用户已明确批准实施，不再停下来请求设计许可。使用 TDD，先失败测试再实现。不得派生子代理，不提交/切换分支，不改真实环境，不发送邮件，不调用真实 Provider。

## 文件所有权

你可修改/创建：apps/web/server/auth/**、features/auth/**、features/account/**、app/(auth)/**（或对应实际路由）、app/account/**、app/auth/**、app/api/auth/**、app/api/account/**、app/terms/**、app/privacy/**、lib/supabase/proxy.ts、server/route-context.ts、app/anonymous-auth-gate.tsx 的替代接入、认证测试；独立的 supabase auth migration 和 pgTAP；新增 account-cleanup worker 或对现有 cleanup worker 的最小账户清理扩展；supabase/config.toml 中认证配置；.env.example；packages/domain/src/auth-contracts.ts。避免编辑 domain 既有 types/api-contracts/index.ts；需导出或改公共错误码请通知父代理。不要编辑 UnifiedWorkspace/Composer、Gateway、Skill 代码、四份核心文档。

## 完整交付

- Supabase 原生邮箱密码注册、验证、登录、重发、找回/重置、主动改密、退出；自定义 SMTP 的本地/隔离配置说明，不写生产秘密。
- 邮件 1 小时/重发 60 秒；不自建 action token 数据库、不预哈希密码、不建 30/90 天 app_sessions。邮件确认 GET 不消费 token，避免邮件预抓取；显式继续动作验证 OTP，redirect 仅允许站内受控目标，保留 skill intent。
- 密码至少8个 Unicode code point、最多72 UTF8字节，不 trim/截断/归一化；本地常见表拒绝，HIBP k-anonymity 可注入 fetch 测试，故障允许设置但脱敏记录。原生验证码；IP+邮箱组合数据库原子限流，不全局锁邮箱。可信 IP 边界明确。
- 注册响应/登录错误不泄露邮箱存在性。法律页面提供明确未批准文本状态，公开发布门禁不伪造已批准；记录接受版本，缺正式批准不得宣称可发布。
- 正式身份守卫 requireVerifiedUserId：确认非匿名、邮箱已验证、JWT session_id 仍存在 auth.sessions、账户未注销；RLS/受控 RPC 同样验证。不仅客户端 cookie 清空。
- 账号 GET/PATCH 显示邮箱和可空显示名称；改密保留当前设备、撤销其他会话；重置后全撤销并强制重新登录；UI 对应。
- DELETE /api/account 或明确注销 API：重新验证密码并确认影响，原子标记 deleting 并阻止新请求，幂等排队清理。Worker 停止用户任务，Storage API 删除先于用户/业务级联删除；清理失败可重试，正式对照用户零误删，UI区分受理与完成。
- 认证恢复组件可嵌入现有工作区：同账号登录成功保持挂载；换账号通知父层清除原草稿。不卸载现场导致 File/ObjectURL 丢失。API GET /api/account 返回稳定账号ID供隔离。与父代理协商最小 props。
- mock 本地无密钥工作区继续可用于测试；新认证可使用显式隔离测试适配器，绝不能让 mock 身份通过生产 HTTP API。
- SQL migration 通过 CLI migration new 创建；只作用本地文件/隔离数据库，生成类型需告知父代理如何合并。
- 测试必须涵盖所有权、非匿名已验证、旧token拒绝、注销清理、限流并发、重复请求、密码边界、邮件重放/过期、输入与恢复。

## 报告

完成后写 doc/phase2-auth-report.md：改动、验证命令与真实结果、接口、待集成项、剩余限制。不要声称真实投递或云环境验证完成。向父代理先发接口/迁移依赖设计，之后继续实施。
