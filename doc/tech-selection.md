# zimage 技术选型文档

> **版本**：v2.1（纳入电商生图 v0.2）
> **状态**：历史选型保留；电商 v0.2 已批准、实施中，尚待独立验证
> **需求基线**：`doc/requirements.md` v2.1 第 10–11 节
> **更新日期**：2026-09-08
> **适用发布口径**：面向中国大陆用户的公开 Beta，非生产就绪

## 1. 文档边界与追溯规则

### 1.1 唯一需求来源与状态口径

本文件以 `doc/requirements.md` 为唯一产品需求来源。原 Phase 2 设计保留作历史追溯：2026-09-06 修订覆盖原自建认证方案；第 13 节电商 v0.2 覆盖旧 Skill 授权、目录、任务与接口设计，第 2/4 节同步现行行为。未被本次修订的认证伪代码、表与门禁仍须按 2026-09-06 修订核对，不能因保留在正文就恢复已覆盖的方案。

用户已授权按 v0.2 实施；本次仅将批准的实际选型写入正式文档。路径、数据表、图示和伪代码描述实施目标，不代表迁移已部署、测试已通过、真实模型效果可用或公开 Beta 已完成。主任务维护进度与验证证据，本次不引用旧账本“未开始”作为当前状态。

Phase 2 共追溯 83 个稳定 ID（需求第 10.9 节矩阵 74 项 + 第 10.7 节 9 类 P2-AT）：6 个成功指标、47 个用户故事验收条目、8 个非目标、6 个发布依赖、7 个风险和 9 个编号验收场景。其中以下 6 项为 `withdrawn`，只保留撤销原因，不创建实现任务，也不得复用 ID：

- `P2-US5-AC01`、`P2-US5-AC02`、`P2-US5-AC03`：撤销匿名历史归入及其去重、失败、重试行为。
- `P2-US5-AC05`：撤销匿名进行中任务归入正式账号。
- `P2-DEP04`：撤销“匿名历史保持可识别和可归入”的依赖。
- `P2-RISK03`：撤销匿名归入中断或重复触发风险。

电商 v0.2 另有 17 个 EC 验收 ID；合计 100 个去重 P2/EC ID，其中原 6 个 withdrawn 保留。83/100 是需求覆盖数，不是测试数或通过数。

### 1.2 Phase 1 历史基线与 Phase 2 覆盖

Phase 1 的 Next.js 16、React、TypeScript strict、Zod、Zustand、LangGraphJS、Supabase Postgres/Auth/Queues/Storage、private bucket、SSE、持久队列、配额账本、RLS/显式 `GRANT`、清理任务和 provider adapter 继续作为回归基线。除下表列出的覆盖项外，不改变既有生成、费用、安全、删除、到期和可观察性行为。

| Phase 1 决策/行为 | Phase 2 处理 | 对应需求 |
| --- | --- | --- |
| `TS-AUTH-01/02`：自动建立匿名身份并恢复同浏览器历史 | 被正式邮箱账号和 `requireFormalSession` 覆盖；关闭匿名注册并永久清理匿名数据 | `P2-US3-AC01`、`P2-US5-AC06`～`AC09`、`P2-NG08` |
| `TS-FE-04/09`：Skill 固定字段、必填校验和提示词预览 | 原 Phase 2 改为自然语言/追问；现电商 v0.2 使用结构化向导、对话及逐图方案确认 | `P2-US2-AC02`、`AC11`、`AC12` |
| `TS-FE-08`：取消 Skill 后恢复旧图片工具偏好 | 被按会话持久化的“创建图片”开关覆盖；任务结束后不自动关闭 | `P2-US2-AC07`、`P2-RISK04` |
| Phase 1 提交后保留 Skill | Skill 只选择当前场景；确认绑定方案版本/选中项，历史固化名称和版本 | `P2-US2-AC03` |
| `TS-SCOPE-02`：账号绑定与跨设备同步延后到 Phase 2 | 不做匿名绑定；仅正式账号按 `auth.uid()` 跨设备恢复 | `P2-US5-AC04`、`AC06` |
| `TS-SCOPE-03`：外部告警延后到 Phase 2 | 本期不实施，移至未来阶段 | `P2-NG07` |
| `TS-I18N-01` 中为 Phase 2 预留 en-US | 本期仍只提供 zh-CN，en-US 移至未来阶段 | `P2-NG05` |

### 1.3 Phase 2 技术决策索引

| 决策 ID | 决策摘要 | 主要页面/能力 |
| --- | --- | --- |
| `P2-TS-SCOPE-01` | 原三 Skill 保留；电商扩至六场景/12 原创模板，邮箱账号、zh-CN、中国大陆公开 Beta | 全局 |
| `P2-TS-SKILL-01` | 版本化只读 registry 作为三个 Skill 的唯一内容源 | `/skills`、`/skills/[skillId]` |
| `P2-TS-SKILL-02` | 公开安全 DTO；Skill 页面不依赖用户会话 | `GET /api/skills` |
| `P2-TS-AUTH-01` | 复用 LangGraphPj 的页面流程和职责分层，底层保留 ZImage `@supabase/ssr` + PKCE cookie + Proxy + `getClaims` | 认证页面与保护边界 |
| `P2-TS-AUTH-02` | Supabase Free Auth；应用生成并编排邮件 action，阿里云 DirectMail SMTP 投递 | 注册、验证、找回 |
| `P2-TS-AUTH-03` | 8～64 Unicode 字符、常见密码表、HIBP k-anonymity；HIBP 不可用时拒绝设置新密码 | 注册、改密、重置 |
| `P2-TS-AUTH-04` | `v1:` + SHA-384 Base64URL 预哈希后交给 Supabase，所有密码入口仅在 ZImage 服务端调用 | 注册、登录、改密、重置 |
| `P2-TS-AUTH-05` | HMAC 邮箱键记录全局失败；5 次后 Turnstile + 15 分钟等待 | 登录 |
| `P2-TS-SESSION-01` | `app_sessions` 强制 30 天闲置和 90 天绝对期限 | 所有受保护入口 |
| `P2-TS-WORKSPACE-01` | 向导/旧 Skill/对话共用 CommercePlan/Task，先保存方案再确认 | 工作区/输入框 |
| `P2-TS-WORKSPACE-02` | 每次确认幂等创建一个 run，原子创建选中 count=1 子批次；允许明确重做 | 工作区/生成服务 |
| `P2-TS-WORKSPACE-03` | 图片开关按会话持久化，仅能力许可；关闭不丢方案、不构成执行授权 | 工作区/会话 |
| `P2-TS-ACCOUNT-01` | 独立 `profiles` 保存可选显示名称，不参与授权 | `/account` |
| `P2-TS-ACCOUNT-02` | 主动改密保留当前应用会话；找回重置撤销全部会话 | `/account`、`/reset-password` |
| `P2-TS-CUTOVER-01` | 正式账号仍以 `auth.uid() = user_id` 恢复，不复制数据 | 跨设备恢复 |
| `P2-TS-CUTOVER-02` | 先关闭匿名入口和执行链，再按匿名用户清单永久删除对象、任务、用户和级联业务数据 | Phase 2 切换 |
| `P2-TS-DATA-01` | 新增 `profiles`、`app_sessions`、`auth_action_requests`、`auth_login_guards`、`skill_tasks`；扩展 `sessions`、`timeline_items` | 数据与安全 |

### 1.4 页面与访问边界

| 页面/入口 | 访问级别 | 页面责任 | 技术决策 |
| --- | --- | --- | --- |
| `/create`、`/skills`、`/skills/[skillId]` | 公开 | 六场景发现；三个旧 Skill 说明与兼容入口 | `P2-TS-SKILL-01/02` |
| `/login`、`/register`、`/auth/check-email`、`/auth/confirm`、`/forgot-password`、`/reset-password` | 公开；确认/重置携带一次性 action | 注册、验证、登录、找回 | `P2-TS-AUTH-01`～`05` |
| `/terms`、`/privacy` | 公开 | 展示经审批的正式文本和 Beta 边界 | `P2-TS-SCOPE-01` |
| `/`、会话/生成/Skill 执行 API | 正式已验证账号 | 工作区、会话、上传、方案保存、确认执行、历史和导出 | `P2-TS-SESSION-01`、`P2-TS-WORKSPACE-01`～`03` |
| `/account` | 正式已验证账号 | 账号资料、主动改密、退出 | `P2-TS-ACCOUNT-01/02` |

Proxy 只负责刷新 Supabase Auth cookie 和快速重定向；每个受保护 Route Handler、服务方法及 RLS 都必须在数据源附近再次验证正式应用会话。Worker 使用 server-only 凭证执行已提交任务，不要求浏览器会话持续有效，但必须重新验证任务属于正式非匿名账号、任务未取消且未被匿名退场 tombstone 阻断。公开 Skill 页面及其 API 不触发匿名登录，也不读取用户、会话、消息、生成或额度数据。

## 2. 官方 Skill 列表与详情页

### 2.1 需求来源

| 需求 ID | 内容摘要 | 技术覆盖 |
| --- | --- | --- |
| `P2-US1-AC01`～`AC03` | 列表与详情公开；保留三个旧 Skill，新增六场景目录；详情包含用途、场景、建议信息、预期产出、限制和立即使用 | 公开路由、版本化 registry、公开 DTO |
| `P2-US1-AC04` | 白底图、模特图、种草图具有明确且不同的产出语义 | registry 中固化 `purpose`、`expectedOutput` 和版本 |
| `P2-US1-AC05` | 公共导航、工作区导航和输入框指向同一 Skill 内容 | 三处入口仅引用 registry 的 `id` 与详情路由 |
| `P2-US1-AC06` | 立即使用在唯一工作台预选对应场景；登录前选择需恢复 | 签名/白名单化登录意图 `returnTo` + `skillId` |
| `P2-US1-AC07`、`P2-NG01`、`P2-NG02` | 六场景/平台筛选/经审核示例允许；收藏、安装、市场、在线 Skill 编辑、第三方或多 Skill 仍不提供 | 公开元数据与私有指令分离；未验证效果不标成通过 |
| `P2-SC03` | 发现并发送形成草案 ≤3 动作；就绪方案额外 1 次确认 | 资料补充/上传/编辑另计，确认前零入队 |
| `P2-DEP03` | 三个 Skill 内容经产品审核且各入口口径一致 | registry 作为单一事实源，版本变更须评审 |
| `P2-AT01`、`P2-AT07` | 验证公开访问、登录回跳、内容一致和非目标缺失 | 公开/登录态 E2E 固定场景 |

### 2.2 技术方案与关键伪代码

`packages/domain/src/model-registry.ts` 中现有 `PHASE1_SKILLS` 将演进为 `OFFICIAL_SKILLS`。旧 Skill 的内部 `promptTemplate` 不公开；v0.2 允许面向用户的商品字段和可编辑方案，执行指令仍仅服务端可达。版本、说明、默认方案、来源与限制可作为安全元数据返回。

```text
OfficialSkillPublic = {
  id, version, name, coverImageUrl,
  purpose, applicableScenarios[], suggestedInputs[],
  expectedOutput, limitations[], requiresImageTool: true
}

OfficialSkillInternal = OfficialSkillPublic + {
  executionPolicy, minimumInputPolicy, defaultProposalPolicy
}

GET /api/skills
  registry = loadVersionedOfficialSkillRegistry()
  return PublicSkillsResponse.parse(registry.map(toPublicSkill))
  // 不创建 Supabase client，不读取 cookie，不返回内部执行提示词

GET /skills/[skillId]
  skill = registry.findByControlledId(skillId)
  if missing -> notFound()
  render purpose/scenarios/suggestedInputs/expectedOutput/limitations/useNow

useNow(skillId, currentUser)
  assert registry.contains(skillId)
  intent = { returnTo: "/", skillId, mode: "new-session" }
  if currentUser is absent:
    redirect /login?intent=sealAndEncode(intent)
  else:
    session = POST /api/sessions { title?, preselectedSkillId: skillId }
    redirect /?sessionId=session.id

afterLogin(intent)
  verified = verifySealedIntent(intent)
  allow only path "/" and registry skill ID
  create new blank session; restore one preselected Skill; redirect
```

登录意图不得接受任意外部 URL，避免开放重定向；一次成功消费后从地址栏清除。新会话只预选映射场景，发送自然语言只创建/修改 CommercePlan，不生图、不预占；明确确认保存版本和选中 slot 才创建执行组。上方旧 skillId 登录伪代码按 scene 映射兼容，受控场景参数不得包含商品资料或图片地址。

### 2.3 文件与模块范围

| 根目录 | 计划修改/新增 | 责任 |
| --- | --- | --- |
| `apps/web` | 新增 `app/skills/page.tsx`、`app/skills/[skillId]/page.tsx`、`features/skills/*`；修改导航、`app/api/skills/route.ts`、会话创建入口 | 公开页面、立即使用、登录意图恢复 |
| `packages/domain` | 修改 `src/model-registry.ts`、`src/api-contracts.ts`、`src/types.ts` 及对应测试 | 版本化 registry、公开/内部 DTO 分离 |
| `supabase` | 本页面无新增公开内容表 | 防止把三个固定 Skill 扩展成动态 CMS |

### 2.4 选型依据与备选方案

| 方案 | 优点 | 缺点/风险 | 结论 |
| --- | --- | --- | --- |
| 版本化 TypeScript registry | 与现有 registry 和构建流程一致；单一事实源；可代码审查、回滚和固化历史版本 | 内容更新需要发布 | 选择；保留三个旧 Skill 与 12 个原创电商模板的版本化内容 |
| Supabase 动态内容表/CMS | 运营可即时更新 | 引入编辑、发布、权限和缓存治理，容易演变为 Skill 平台 | 不选；首版静态精选内容无须动态 CMS，仍不建设 Skill 平台 |
| 第三方 Skill 市场 | 扩展快 | 内容、权限、供应链和可用性不可控 | 禁止；与明确非目标冲突 |

### 2.5 实施步骤

1. 先定义公开/内部 Skill schema 和三个固定 ID，迁移现有内容并补 registry 快照测试。
2. 将 `GET /api/skills` 改为无认证、无用户数据依赖的安全 DTO，并增加字段泄漏负向测试。
3. 实现列表、详情及三处统一入口；所有页面显示公开 Beta、非生产就绪。
4. 实现受控登录意图与“新空白会话 + 预选 Skill”。
5. 以 `P2-AT01`、`P2-AT07` 覆盖登录前后、三个 Skill、桌面与窄屏路径。

## 3. 注册、登录、验证与找回页面

### 3.1 需求来源

| 需求 ID | 内容摘要 | 技术覆盖 |
| --- | --- | --- |
| `P2-US3-AC01`～`AC03` | 受保护功能必须登录；仅邮箱密码；注册字段为邮箱、密码、确认密码和协议同意 | Auth 页面组、服务端 Route Handlers、正式会话守卫 |
| `P2-US3-AC04`、`AC05` | 验证 24 小时、找回 1 小时、60 秒重发、同类新链接废止旧链接、过期可重申 | 私有 `auth_action_requests` + 单次 app action |
| `P2-US3-AC06` | 8～64 Unicode 字符，允许空格/中文/符号，拒绝常见或泄露密码 | Unicode 计数、本地表、HIBP、SHA-384 预哈希 |
| `P2-US3-AC07` | 注册和登录防邮箱枚举；已注册邮箱收到登录/找回指引 | 统一页面响应和时序预算，内部按账号状态发送不同邮件 |
| `P2-US3-AC08` | 连续失败 5 次后跨环境 Turnstile + 15 分钟等待；重置/登录成功清除 | HMAC 邮箱 guard |
| `P2-US3-AC09` | 主动同意正式条款与隐私政策 | 不预勾选 checkbox；服务端验证版本号 |
| `P2-US3-AC10` | 30 天闲置、90 天最长；无记住我；按原目标/最近会话/空白会话落点 | `app_sessions` 与受控 intent |
| `P2-US3-AC11` | 中国大陆公开 Beta，任何已验证邮箱可进入；不得声称生产就绪 | 公开页面统一 Beta 标识和发布门禁 |
| `P2-NG03`、`P2-NG05` | 不做手机号、第三方、MFA、无密码、en-US、客户端扩张或完整无障碍认证 | API/UI 不暴露对应入口 |
| `P2-DEP01`、`P2-DEP02`、`P2-DEP06` | 正式法律文本、邮件文案和实际投递、Beta/地域/匿名删除/无账号删除审批 | 发布阻断证据 |
| `P2-RISK01`、`P2-RISK02`、`P2-RISK07` | 短密码无 MFA、法律文本缺失、Beta 被误认为生产 | 泄露检查、登录保护、审批和页面标识 |
| `P2-SC01`、`P2-SC05` | 访问拦截与登录回跳 100%；关键任务全通过 | `P2-AT01`～`P2-AT03`、全场景门禁 |
| `P2-AT01`～`P2-AT03` | 公开/受保护边界、完整邮箱闭环、失败锁定与会话期限 | E2E、集成测试、目标邮箱投递测试 |

### 3.2 LangGraphPj 参考边界

本期可完全参考 `doc/LangGraphPj` 的页面流和职责分层：`AuthContext` 负责客户端认证状态，`AuthForm` 负责交互，`auth.service` 负责调用认证 API，`ProtectedRoute` 的加载/跳转体验用于工作区恢复边界。以下底层实现不得复制：

- 不复制其浏览器手工写入 `sb-access-token` cookie、implicit OAuth、仅 access token 或无 refresh token 的实现。
- 不复制 OAuth、姓名必填、6 位密码等超出/冲突行为。
- ZImage 继续使用当前 `@supabase/ssr` browser/server client、PKCE access+refresh cookie、Proxy `getClaims()` 刷新；服务端授权不信任 `getSession()` 中未经重新验证的用户对象。
- `AuthContext` 只是 UI 状态和恢复协调器，不是授权边界；真正授权由 `requireFormalSession` 和 RLS 完成。

### 3.3 密码兼容与泄露检查

Supabase Auth 当前密码实现按字节限制最大 72 字节，64 个中文字符会超过限制。为同时满足 `P2-US3-AC06`，所有设置和校验密码的入口都由 ZImage 服务端执行下列一致算法：

```text
validateNewPassword(rawPassword)
  length = countUnicodeCodePoints(rawPassword)  // 不 trim，不做 Unicode 归一化
  require 8 <= length <= 64
  reject if localCommonPasswordSet.contains(rawPassword)

  sha1 = SHA1(UTF8(rawPassword)).toUpperHex()
  suffixes = GET https://api.pwnedpasswords.com/range/{sha1[0:5]}
             with Add-Padding: true
  if request unavailable/invalid -> reject with retryable password-check error
  if suffixes contains sha1[5:] -> reject as leaked

deriveSupabaseCredential(rawPassword)
  digest = SHA384(UTF8(rawPassword))
  return "v1:" + base64urlWithoutPadding(digest)  // 67 个 ASCII 字节，小于 72
```

原始密码和派生凭证都属于高敏感凭证：禁止日志、指标、Sentry、数据库和队列记录；响应只返回稳定错误码。预哈希不替代 Supabase 的 bcrypt，而是在其前面提供固定长度输入；Supabase 仍负责带盐慢哈希。算法版本前缀为未来迁移保留辨识能力，切换版本时必须采用“成功登录后升级”或强制重置方案，不能直接改变 `v1` 算法。

浏览器不得直接调用 `supabase.auth.signUp`、`signInWithPassword` 或 `updateUser({ password })`；否则会绕过 Unicode、HIBP、枚举保护和锁定策略。HIBP 仅在注册、主动改密和找回重置等“设置新密码”路径调用，普通登录只派生凭证，不把每次登录可用性绑定到外部 HIBP。

### 3.4 邮件 action 与 DirectMail

使用 Supabase Free Auth 保存正式用户与密码；应用服务端以 Admin `generateLink` 生成 `signup`/`recovery` token，不使用 Supabase 默认 SMTP 直接投递。`auth_action_requests` 位于不暴露给 Data API 的 `private` schema，记录：

```text
id, purpose(confirm_email | recover_password), email_key_hmac,
public_secret_hash, supabase_token_hash_encrypted,
expires_at, resend_after, superseded_at, consumed_at,
created_at, correlation_id
```

邮件只包含应用链接 `/auth/confirm?action=<id>&secret=<random>`。服务端校验 public secret 的哈希、用途、有效期、未消费且未被替代，再用受保护的 Supabase token hash 完成 `verifyOtp`。同一邮箱同一用途生成新 action 时，在事务中把旧 action 标记为 `superseded_at`；点击成功时条件更新 `consumed_at is null`，保证单次消费。Supabase Auth 的 email token 有效期配置为 24 小时，避免 provider token 早于验证需求过期；应用 action 再把找回用途收紧为 1 小时。`resend_after` 固定 60 秒。

阿里云 DirectMail 采用独立发信子域名，通过杭州地域 SMTP 地址 `smtpdm.aliyun.com` 的 SSL 465 端口投递，并配置 SPF、DKIM、DMARC 和必要 MX。Nodemailer 只运行在服务端，SMTP 用户名和密码进入部署 secret，禁止 `NEXT_PUBLIC_*`。发布前必须用真实 QQ、163 和至少一个企业邮箱验证收件、链接、过期、重发和退信行为。

### 3.5 核心流程伪代码

```text
POST /api/auth/register
  assertSameOriginAndJson(request)
  input = RegisterRequest.parse(body)
  verifyTurnstile(input.captchaToken)
  require input.termsAccepted == true
  require input.termsVersion == approvedTermsVersion
  require input.password == input.confirmPassword
  validateNewPassword(input.password)
  credential = deriveSupabaseCredential(input.password)

  outcome = prepareRegistrationMailInternally(input.email, credential)
    normalize email only for identity lookup; emailKey = HMAC(serverKey, normalizedEmail)
    if account does not exist:
      link = supabaseAdmin.generateLink(type=signup, email, password=credential)
      create superseding confirm action (24h, resend 60s)
      send verification mail through DirectMail
    else:
      create superseding recovery action (1h, resend 60s) when policy permits
      send existing-account login/recovery guidance
  audit only outcome class and correlationId; never expose account existence
  return 202 { status: "accepted", next: "/auth/check-email" }

POST /api/auth/resend
  parse purpose + email; verify Turnstile/rate limit
  lookup by HMAC email key without exposing existence
  if before resend_after -> keep same public response
  supersede old same-purpose action; generate and send replacement if eligible
  return same 202 accepted response for every account state

GET /auth/confirm?action=<id>&secret=<secret>
  action = private.loadForSingleUse(hash(secret), expectedPurpose)
  if expired/superseded/consumed -> render auth_email_action_expired + reapply action
  result = supabase.verifyOtp(token_hash=decrypt(action.tokenHash), type)
  atomically mark consumed; reject races
  if confirm_email:
    require result user is verified and non-anonymous
    register app session from JWT session_id; redirect by validated intent
  if recover_password:
    mark recovery flow cookie; redirect /reset-password

POST /api/auth/login
  input = LoginRequest.parse(body)
  emailKey = HMAC(serverKey, normalizeEmail(input.email))
  guard = load auth_login_guards[emailKey]
  if guard.lockedUntil > now:
    require valid Turnstile token
    return auth_login_locked with remaining seconds
  if guard.failureCount >= 5: require valid Turnstile token

  credential = deriveSupabaseCredential(input.password)
  result = ssrClient.auth.signInWithPassword(email, credential)
  if failure or user anonymous or user unverified:
    record failure using the same path for nonexistent and existing email
    after fifth failure set lockedUntil = now + 15m and captchaRequired = true
    return auth_invalid_credentials or auth_login_locked without account details

  register app_sessions(session_id from verified claims, user_id, now)
  clear guard
  destination = consume validated intent
                ?? mostRecentOwnedSession
                ?? create new blank session
  return destination

POST /api/auth/recover
  validate origin/schema/Turnstile and purpose-specific rate limit
  do not consult or change login lockedUntil; recovery remains available while locked
  if a verified account exists, supersede old recovery action and send a new one
  always return the same 202 accepted response

requireFormalSession(request)
  claims = ssrClient.auth.getClaims()
  require claims.sub exists and claims.is_anonymous != true
  sessionId = UUID(claims.session_id)
  appSession = private.app_sessions[sessionId, claims.sub]
  require not revoked
  require now < createdAt + 90 days
  require now < lastSeenAt + 30 days
  update lastSeenAt at most once per 15 minutes
  otherwise revoke and throw auth_session_expired
  return { userId: claims.sub, sessionId }
```

注册/重发/找回对外使用相同状态码、结构和近似时序预算；内部邮件可因账号状态不同而不同。精确限流还需覆盖 IP、邮箱 HMAC 和 action purpose，但日志不得写明文邮箱或密码。

### 3.6 文件与模块范围

| 根目录 | 计划修改/新增 | 责任 |
| --- | --- | --- |
| `apps/web` | 新增认证页面组；`contexts/auth-context.tsx`、`features/auth/*`、`server/auth/{auth-service,password-service,hibp-service,login-guard,formal-session}.ts`、`server/mail/{mail-service,directmail-transport,templates}.ts`；认证 Route Handlers；修改 `proxy.ts` 与 Supabase clients | 页面流、服务编排、cookie、密码、邮件、会话守卫 |
| `packages/domain` | 新增认证/账号 schema、错误码和安全响应 DTO | 浏览器与服务端契约 |
| `supabase` | 新增 `private.auth_action_requests`、`private.auth_login_guards`、`private.app_sessions`、相关受控函数与 pgTAP | 单次 action、全局失败保护、应用会话期限 |

### 3.7 选型依据与备选方案

| 决策 | 选择方案 | 备选方案 | 选择依据 |
| --- | --- | --- | --- |
| Auth UI/分层 | 参考 LangGraphPj 页面职责，保留 ZImage SSR 底层 | 整体复制 LangGraphPj | 复用成熟交互但避免 implicit flow、手工 token cookie 和需求外 OAuth |
| 邮件 | Admin `generateLink` + app action + Nodemailer + DirectMail | Supabase 默认 SMTP；Supabase 直连自定义 SMTP；Send Email Hook | 应用层才能统一执行 24h/1h、60s、单次消费、旧链接废止和枚举保护；DirectMail适配国内目标邮箱 |
| 泄露密码 | 本地常见表 + HIBP k-anonymity，设置密码时安全失败 | 仅 Supabase 弱密码检测；仅本地表；允许外部失败时放行 | Free 计划不提供泄露密码保护；组合方案覆盖常见与真实泄露，失败时不降低安全基线 |
| Unicode 兼容 | 版本化 SHA-384 预哈希 + Supabase bcrypt | 限制 72 字节；浏览器直连；自建密码库 | 满足 8～64 Unicode 字符并保留 Supabase 会话/RLS生态；自建密码存储风险更高 |
| 30/90 天期限 | `app_sessions` 补偿层 | 升级 Supabase Pro 原生 timeout；只依赖 refresh token | 暂用 Free 且需求要求精确期限；默认 Supabase session 可长期存在 |

### 3.8 实施步骤

1. 先实现认证 schema、错误码和失败测试，确认所有外部响应不泄露账号存在性。
2. 实现密码计数、常见表、HIBP、`v1` 派生及测试向量；所有密码入口改走服务端。
3. 建立 action、guard、app session 表与私有函数，完成 RLS/权限负向测试。
4. 实现 `generateLink`、单次 app action、DirectMail 模板与目标邮箱投递测试。
5. 按 LangGraphPj 职责实现页面和 Auth Context，再接入 ZImage SSR/PKCE/Proxy。
6. 将 `requireFormalSession` 接入所有受保护 API、服务和 RLS；验证 30/90 天边界。
7. 完成 `P2-AT01`～`P2-AT03` 及法律/邮件/Beta 发布审批证据。

## 4. 受保护工作区与统一方案确认（v0.2 覆盖）

### 4.1 需求来源与技术覆盖

| 需求 | 当前技术决策 |
| --- | --- |
| P2-US2-AC01–AC03、EC-01–07 | 旧 Skill 单选映射 scene；向导、自然语言和参考图写入同一个 CommercePlan/Task；历史固化版本，标签不授权。 |
| P2-US2-AC04–AC06、EC-07–11 | 草案/补充不入队；每次明确确认一个 revision/slotIds，幂等创建 run；版本不覆盖，替换保留草稿，允许后续明确重做。 |
| P2-US2-AC07、P2-RISK04 | 会话图片开关只表示能力许可，可关闭并保留草案；普通讨论不生图。 |
| P2-US2-AC08–AC12、EC-04/05/12/13 | 1–8 产物、合计四张参考图、销售真实商品图、能力校验、一次一题与可编辑默认值；文字更改须重新确认生成。 |
| P2-SC03/04、P2-AT08/09、EC-17 | 发现/草案 ≤3 动作，就绪方案额外 1 次确认；补充/上传/编辑单记。三旧 Skill 质量 ≥80% 与逐项保真仍须真实评测。 |

### 4.2 方案、执行和选择分离

采用 `CommercePlan` 与扩展的 `CommerceTask`，独立记录 revision、slots、runs、selections、slotHashes 和 archived。用户可见“待补充/待确认”由当前方案缺项及提交情况推导；运行状态按 run.items 聚合，不能用旧 run 成功表示新 revision 已执行。

原 `skill_tasks` 一任务最多一 batch、缺省值才确认、`awaiting_input` 可直接执行及专属 confirm/cancel/replace 状态机为历史方案，全部由第 13 节多版本/多 run 替代，不再创建第二套电商任务事实源。旧 Skill 名称、版本和作品继续可读。

每个未删除 slot 的标识稳定；编译快照和兼容哈希逐图保存。改第三张只使该 slot 待更新，其余选择继续使用。默认选择新成功图须同时核对当前 slotHashes、最新重做和选择版本；手选后旧在途结果只进入候选历史。exactText 表示模型整图生成文案，不是独立文本层。

### 4.3 关键分支伪代码（实现目标）

```text
onWizardOrLegacySkillOrTargetedEdit(input)
  validate schema and owned session/references
  map legacy skillId to commerce scene
  create/save structured plan with expectedRevision and requestId
  compile trusted template on server; persist immutable revision
  return task, one blocking question or confirmable plan
  // never enqueue or reserve image quota

onOrdinaryDiscussion(message)
  return normal chat text; image switch alone never authorizes generation

onExplicitCommerceConfirmation(taskId, revision, slotIds, requestId)
  require verified formal user and owned active session
  call submit through CommerceGateway -> protected API -> commerce_dispatch
  recover same idempotency key/result first; different content -> conflict
  lock and validate current revision, inputs, model, slot eligibility and quota
  in one transaction: run/items + count=1 children + quota + queue
  return HTTP 202 and task with stable run/item mappings

onRecreate(slotIds)
  save edited plan if necessary; show affected slots and new image units
  wait for explicit confirmation; submit with recreate=true

onManualSelection(slotId, generationId, expectedSelectionVersion)
  select verified candidate; increase selection version; fence old in-flight result

onSceneOrProductReplacement()
  retain original draft; make replacement/new-task choice explicit
  never overwrite an already submitted revision
```

通用明确生图仍保留原直接入口；电商及旧 Skill 必须经过方案确认。销售主图、套图、详情图缺真实 product 引用时不能借通用入口、风格图或旧 Skill 标识执行同一销售任务。

### 4.4 恢复与模块责任

`features/commerce/` 承载三步向导、逐图编辑、运行与选图；`UnifiedWorkspace` 负责场景入口、会话和时间线协调。领域 schema/编译负责确定性与校验；独立可选 `WorkspaceGateway.commerce?: CommerceGateway` 连接 mock/HTTP；第 13 节给出实际 API 与 RPC。未接入网关的宿主不开放不可执行的电商按钮，不能回退到旧发送即生图。

登录失效停止新受保护请求并保留未发送文字、未保存方案、参考图/设置和原目标。重新登录后 list/get 恢复服务端版本、run、选图，再协调本地草案；未上传文件在浏览器主动刷新后不能伪称已持久化。已提交任务继续按 Worker 安全规则核对，归档不代表取消已提交 Provider。

### 4.5 选型理由与验证责任

持久版本与受限数据库事务支持刷新恢复、明确授权、不同 slot 的独立目标和全组原子性；仅 React 状态、LangGraph checkpoint 或循环 HTTP 提交都不能替代。使用既有单图 Worker，无需新增整套图 Provider 或长图排版 Worker。模板确定性编译可单元验证，但商品保真与文字效果必须另作真实模型验收。

### 4.6 实施顺序

按批准实施计划：先可靠性修复与领域契约，再持久化/原子执行和 HTTP/mock，同步六场景与三旧 Skill 入口，最后验证旧发送零生图、明确确认、恢复/重做/导出与权限。主任务运行 lint/typecheck/tests/build/E2E、数据库/Worker 与隔离 HTTP 验证并记账；本次文档修改不执行或认领这些测试。

## 5. 账号页与会话管理

### 5.1 需求来源

| 需求 ID | 内容摘要 | 技术覆盖 |
| --- | --- | --- |
| `P2-US4-AC01`、`AC02` | 显示邮箱、可选显示名称、修改密码、退出；空名称使用脱敏邮箱 | `/account` + `profiles` |
| `P2-US4-AC03` | 主动改密保留当前设备，撤销其他设备 | 按当前 `session_id` 撤销其他 app session |
| `P2-US4-AC04` | 找回重置撤销全部设备并要求重新登录 | 全局 app session + Supabase refresh session 撤销 |
| `P2-US4-AC05` | 登录失效保留完整未发送现场和原目标；已提交任务继续 | Workspace 恢复边界 + 服务端任务 |
| `P2-US4-AC06` | 有草稿/参考图/Skill 标签/待补充任务时退出确认 | 客户端统一 dirty-state 判定 |
| `P2-US4-AC07` | 退出后受保护内容不可返回；不恢复匿名身份；Skill 页面仍公开 | cookie 清理 + 正式会话守卫 + no-store |
| `P2-US4-AC08`、`P2-NG04` | 不做头像、改邮箱、注销/删除、多账号、设备管理、组织角色或删除支持渠道 | DTO 与页面不定义对应入口 |
| `P2-RISK06`、`P2-DEP06` | 无账号删除途径是 Critical 发布风险，必须明确审批 | 页面/条款/Beta 文案门禁 |
| `P2-SC05`、`P2-AT04` | 账号、改密、重置、失效、退出任务 100% 通过 | 固定 E2E 与多浏览器会话夹具 |

### 5.2 技术方案与伪代码

`profiles` 只保存 `user_id`、`display_name`、时间戳。邮箱来自经服务端验证的 Supabase user，不在 `profiles` 重复作为授权依据；显示名称可为空，输出前按长度和控制字符规则验证，仅用于 UI。

```text
GET /api/account
  auth = requireFormalSession()
  user = supabaseAdmin.getUserById(auth.userId)
  profile = load owned profile
  return { email: user.email, displayName: profile.displayName,
           accountLabel: displayName ?? maskEmail(user.email) }

PATCH /api/account { displayName }
  auth = requireFormalSession()
  normalize empty string to null; validate length/control characters
  upsert profile by auth.userId

POST /api/auth/change-password
  auth = requireFormalSession()
  validate current password through server sign-in/re-auth policy
  validateNewPassword(newRaw); derive v1 credential
  supabaseAdmin.updateUserById(userId, password=credential)
  transaction revoke app_sessions
    where user_id=userId and session_id != auth.sessionId
  revoke other Supabase refresh sessions through auth.signOut(scope="others")
  rotate/refresh current session; clear login guard

POST /api/auth/reset-password
  require valid, unconsumed recovery action/session
  validateNewPassword(newRaw); derive v1 credential
  update Supabase password
  revoke every app_session for user; auth.signOut(scope="global")
  consume action; clear login guard; clear recovery cookie
  return { next: "/login", reauthenticationRequired: true }

requestLogout()
  dirty = draft not empty OR referenceImages not empty
          OR selectedSkillId exists OR activePendingSkillTask exists
  if dirty and user does not confirm -> keep workspace unchanged
  if confirmed or clean:
    discard unsubmitted uploaded references through the existing Storage cleanup path
    POST /api/auth/logout with current formal session
    clear local draft/references/skill/settings and auth cookies
    replace navigation to /login; protected responses use Cache-Control: no-store
```

主动改密与 Supabase 自身“改密可能撤销 session”的默认行为必须通过集成测试确认。若 Admin 更新密码会撤销当前 Supabase refresh session，则服务端必须在验证当前身份后创建新的当前设备会话并更新 cookie，最终产品行为仍是“当前设备继续、其他设备失效”。不在 UI 提供设备列表或逐设备管理。

### 5.3 文件与模块范围

| 根目录 | 计划修改/新增 | 责任 |
| --- | --- | --- |
| `apps/web` | 新增 `app/account/page.tsx`、`features/account/*`、account handlers/service；修改 Auth Context、Workspace dirty-state 和 logout handler | 资料、改密、退出确认、状态恢复 |
| `packages/domain` | 新增 account DTO、display name schema、change/reset/logout schema | 契约与错误 |
| `supabase` | 新增 `profiles`、完善 `app_sessions` 撤销函数/RLS/pgTAP | 可选资料与多会话强制失效 |

### 5.4 选型依据与备选方案

| 方案 | 优点 | 缺点/风险 | 结论 |
| --- | --- | --- | --- |
| 独立 `profiles` | 不污染 auth metadata；RLS 清晰；显示名称不参与授权 | 增加一张表 | 选择 |
| `user_metadata.display_name` | 表少 | 用户可编辑 metadata 不适合作授权，审计与 schema 较弱 | 不选为业务事实源 |
| Supabase Pro 原生 session timeout | 平台原生 | 与“暂用 Free”冲突且仍需产品级当前/其他设备语义 | 后续可替换部分补偿层，Phase 2 不采用 |
| 只清浏览器 cookie 退出 | 简单 | 已签发 token 仍可能访问，无法满足返回/刷新边界 | 不选；同时撤销服务端应用会话 |

### 5.5 实施步骤

1. 建立 `profiles` 和 account DTO/RLS，完成空名称与脱敏邮箱测试。
2. 实现主动改密的当前/其他会话语义和跨浏览器集成测试。
3. 实现找回重置的全会话撤销和强制重新登录。
4. 将 Workspace dirty-state 收敛为单一选择器，接入退出确认与清理。
5. 用 `P2-AT04` 验证账号页、失效恢复、有/无现场退出及非目标缺失。

## 6. 跨设备恢复与匿名身份退场

### 6.1 需求来源

| 需求 ID | 内容摘要 | 技术覆盖 |
| --- | --- | --- |
| `P2-US5-AC04` | 同一正式账号跨设备恢复全部自身会话、消息和保留期生成记录 | 继续使用 `auth.uid() = user_id` 所有权查询 |
| `P2-US5-AC06` | 注册、验证、登录、刷新和跨设备均不关联匿名数据 | 不提供迁移代码或映射表 |
| `P2-US5-AC07`～`AC09` | 切换时关闭匿名访问并永久删除匿名数据/任务/资产；无通知/下载/恢复；正式账号零误删 | 分阶段 cutover、Storage API、固定夹具负向验证 |
| `P2-US5-AC01`～`AC03`、`AC05` | 已撤销匿名历史/任务归入 | 仅记录撤销，不实现 |
| `P2-NG08` | 不做匿名迁移、只读、下载、恢复或继续创作 | 不建立恢复副本与入口 |
| `P2-DEP04`、`P2-RISK03` | 已撤销匿名归入依赖和风险 | 仅保留稳定 ID |
| `P2-DEP05` | 切换前形成匿名范围清单并证明完整删除、正式数据未误删 | 盘点报告与前后对账 |
| `P2-RISK05` | 无通知永久删除带来不可逆损失 | 已批准接受；以清单与零误删证据控制 |
| `P2-SC02`、`P2-SC06` | 正式账号跨设备恢复 100%；匿名拦截/删除 100%，正式误删 0 | `P2-AT05`、`P2-AT06` |

### 6.2 跨设备恢复方案

正式账号的 `sessions.user_id`、`generation_batches.user_id`、Storage 路径和现有 RLS 所有权边界保持不变。不同浏览器登录后查询同一 `auth.uid()` 即恢复数据，不复制、不合并、不改写所有者。进行中的正式任务仍由持久 queue/worker 推进；新设备只重新获取 timeline、批次状态和短期 signed URL。

RLS 从“`TO authenticated` + 所有权”加强为“正式活动应用会话 + 所有权”。Supabase 匿名用户也拥有 `authenticated` Postgres role，因此禁止仅依赖 `TO authenticated` 判断正式账号。

```text
private.has_active_formal_session()
  uid = auth.uid(); sid = UUID(auth.jwt()->>'session_id')
  return uid is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and exists app_sessions where user_id=uid and session_id=sid
        and revoked_at is null
        and now < created_at + 90d
        and now < last_seen_at + 30d

RLS USING (
  private.has_active_formal_session()
  and user_id = (select auth.uid())
)
```

如使用 `SECURITY DEFINER` 读取 private 表，该函数必须位于非暴露 schema、固定 `search_path`、显式校验 `auth.uid()`，并撤销 `PUBLIC EXECUTE` 后只授予所需角色；不能把 `SECURITY DEFINER` 当作跳过 RLS 的通用手段。

### 6.3 匿名退场顺序与伪代码

匿名删除是不可恢复的发布操作，只能在审批窗口内使用固定脚本/管理任务执行，禁止页面或普通 API 暴露。

```text
Stage 0: inventory and freeze
  snapshot IDs/counts for auth.users where is_anonymous = true
  derive owned sessions, timeline, batches, generations, uploads,
         storage paths, queue/cleanup jobs and quota entries
  record separate formal-account control fixture and hashes/counts
  approve irreversible runbook

Stage 1: close every anonymous ingress
  remove AnonymousAuthGate and Proxy signInAnonymously bootstrap
  disable anonymous sign-ins in Supabase Auth configuration
  requireFormalSession in workspace/session/generation/upload/asset APIs
  generation worker and result writer reject anonymous-owned jobs
  deploy and prove anonymous protected-entry rejection = 100%

Stage 2: stop anonymous work
  mark anonymous pending/processing tasks cancelled by owned anonymous user IDs
  archive/remove queue messages so no later visible result or quota mutation occurs
  add worker tombstone guard checked immediately before provider call and before commit

Stage 3: delete objects before metadata
  for each inventory storage path:
    delete through Supabase Storage API; retry idempotently; verify object missing
  never delete storage.objects rows directly

Stage 4: delete identities and business rows
  delete only auth.users where id in frozen anonymous ID set
    and is_anonymous = true at execution time
  rely on reviewed foreign-key cascades for owned business rows
  explicitly clean non-cascading operational rows by frozen anonymous IDs

Stage 5: prove outcome
  assert every anonymous fixture row/object/task is absent
  assert no anonymous task can create visible result or quota change
  compare every formal fixture row, task, asset and quota hash/count unchanged
  retain only non-content audit evidence required to prove execution
```

清理条件必须同时使用冻结的匿名用户 ID 集合和执行时 `is_anonymous = true`，不得按日期、邮箱为空、路径前缀或“非正式用户”等宽泛条件删除。由于需求禁止恢复副本，盘点证据只能保存 ID、数量、哈希和状态等最小审计信息，不能备份匿名正文或图片内容。

### 6.4 文件与模块范围

| 根目录 | 计划修改/新增 | 责任 |
| --- | --- | --- |
| `apps/web` | 删除 `anonymous-auth-gate.tsx` 接入；修改 `lib/supabase/proxy.ts`、根布局、所有受保护 handlers/services/tests | 关闭匿名创建和访问，正式会话守卫 |
| `packages/domain` | 移除匿名额度/身份对外语义，保留正式账号契约 | 阶段边界 |
| `supabase` | 新增匿名盘点/清理 runbook 与固定夹具；修改 RLS、generation/cleanup worker；通过 Storage API 执行对象删除 | 冻结、取消、清理、零误删证明 |

### 6.5 选型依据与备选方案

| 方案 | 优点 | 缺点/风险 | 结论 |
| --- | --- | --- | --- |
| 关闭入口后按冻结匿名 ID 永久清理 | 范围可审计；能阻止删除过程中继续写入；可证明零误删 | 操作不可逆，需严格审批与演练 | 选择；符合已批准需求 |
| 登录时迁移/绑定匿名数据 | 用户历史保留 | 与 4 个撤销 AC 和 `P2-NG08` 冲突，合并复杂且有越权风险 | 禁止 |
| 保留只读/下载窗口或恢复备份 | 降低用户损失 | 与 `P2-US5-AC08` 明确冲突 | 禁止 |
| 直接删除 `storage.objects` 或先删用户 | 操作少 | 可能留下对象、任务或孤儿数据，违反 Storage API 边界 | 不选 |

### 6.6 实施步骤

1. 用生产等价只读查询形成匿名/正式固定夹具范围清单和前置对账。
2. 先部署匿名入口关闭、正式会话 RLS、API/Worker/结果落库守卫。
3. 在隔离环境演练取消任务、Storage API 删除、用户删除和级联清理。
4. 通过审批后执行正式切换；每一阶段满足断言后才进入下一阶段。
5. 完成 `P2-AT05` 的匿名 100% 删除与正式零误删证据，以及 `P2-AT06` 跨设备隔离证据。

## 7. 公共接口、领域契约与数据模型

### 7.1 认证、账号与 Skill 接口

所有接口使用 Zod 严格对象，拒绝未知字段；认证和账号响应设置 `Cache-Control: no-store`。Route Handler 只做来源、schema、认证和错误映射，业务事务进入 server service/domain service。

| 方法与路径 | 访问级别 | 计划职责 |
| --- | --- | --- |
| `POST /api/auth/register` | 公开 + Turnstile/限流 | 注册编排、统一 accepted 响应、发送验证或账号指引邮件 |
| `POST /api/auth/login` | 公开 + 条件 Turnstile | HMAC guard、服务端密码派生、Supabase SSR 登录、登记 app session |
| `POST /api/auth/resend` | 公开 + Turnstile/限流 | 按 `confirm_email`/`recover_password` 重发并废止旧 action |
| `POST /api/auth/recover` | 公开 + Turnstile/限流 | 统一响应，存在账号时创建 1 小时 recovery action |
| `POST /api/auth/reset-password` | 有效 recovery action | 设置新密码、撤销全部会话、要求重新登录 |
| `POST /api/auth/change-password` | 正式活动会话 | 主动改密，保留当前应用会话并撤销其他会话 |
| `POST /api/auth/logout` | 正式活动会话 | 撤销当前 app/Supabase session 并清 cookie |
| `GET /api/account` | 正式活动会话 | 返回邮箱、显示名称和脱敏账号标签 |
| `PATCH /api/account` | 正式活动会话 | 添加、修改或清空显示名称 |
| `GET /api/skills` | 公开 | 仅返回三个 Skill 的公开安全 DTO |

`/auth/confirm` 是服务端页面/动作入口，消费邮件 action 后完成 Supabase token 验证；它不接受浏览器提供任意 redirect URL。服务条款与隐私政策内容不经 API 动态生成，只有经过审批的版本才能发布至 `/terms`、`/privacy`。

### 7.2 工作区契约调整（v0.2）

工作区保持 session/timeline、按会话图片开关和历史 Skill 名称/版本快照；电商能力作为独立可选 CommerceGateway 挂载，具体请求 schema 见第 13.3 节。list/get 返回 CommerceTask，页面按服务端事实恢复方案/执行/选择，不能只在类型中增加 activeTasks 而丢弃恢复数据。

原 `pendingSkillTaskId`、`activeSkillTask`、`skill.confirmation_required` 及 `/api/skill-tasks/{id}/confirm|cancel|replace` 是被覆盖的旧契约，不能当成当前电商必需接口。任何兼容转换都只读/映射旧记录，不恢复发送自动授权。聊天增量只用于显示；明确目标编辑先保存方案，不因聊天工具已开启而提交图片。

通用直接生图仍保留每批 1–4 张；电商为 1–8 个 count=1 子批次。1K/2K、比例、引用上限均以当前模型 capability 为准，禁止静默替换；业务数量扩展不修改底层单图 Provider 协议。

以下认证错误为旧设计记录，按文末 2026-09-06 修订复核；旧 skill_* 专属状态错误不构成恢复旧任务模型的要求。电商实际错误沿用项目统一 schema/registry，对冲突、资料缺失、所有权、模型和过期返回可行动的脱敏错误。

新增稳定错误码至少包括：

| 错误码 | HTTP 建议 | 对外语义 |
| --- | --- | --- |
| `auth_invalid_credentials` | 401 | 邮箱或密码无效，不区分不存在、未验证或密码错误 |
| `auth_login_locked` | 429 | 登录等待未结束，details 仅含剩余秒数和是否需 CAPTCHA |
| `auth_email_action_expired` | 410 | action 过期、已消费或被新链接替代，可重新申请 |
| `auth_session_expired` | 401 | app session 闲置/绝对期限到达或已撤销，工作区进入恢复边界 |
| `auth_password_check_unavailable` | 503 | 泄露检查暂不可用；设置新密码安全失败并可重试 |
| `skill_input_required` | 409 | 最低执行条件不足，返回缺少信息而不创建生成任务 |
| `skill_confirmation_required` | 409 | 默认值、非还原提示或实际设置等待确认 |
| `skill_task_conflict` | 409 | 重复执行、过期确认、跨会话任务或未确认替换冲突 |

错误体继续沿用 `{ code, message, retryable, correlationId, details? }`；`details` 必须逐码白名单化，不含邮箱、密码、action secret、Supabase token、内部提示词或 Storage signed URL。

### 7.3 数据模型（原 Phase 2 历史设计）

本表中的自建认证结构按 2026-09-06 修订覆盖；`skill_tasks`、`skill_task_id unique` 与一任务一 batch 为被电商第 13 节替代的历史设计，不再作为新 commerce 迁移要求。表后对应实施规则仅在适用对象上延续最小权限原则。

| Schema/表 | 计划字段与约束 | 暴露与权限 |
| --- | --- | --- |
| `public.profiles` | `user_id PK/FK auth.users`、`display_name nullable`、时间戳 | 仅正式活动会话读取/更新本人；显式 `GRANT` + RLS |
| `private.app_sessions` | `session_id PK`、`user_id`、`created_at`、`last_seen_at`、`revoked_at`、`revoke_reason` | 不暴露 Data API；仅受控函数/server role 访问 |
| `private.auth_action_requests` | purpose、email HMAC、public secret hash、加密 Supabase token hash、期限/重发/替代/消费状态 | 不暴露 Data API；最小审计与定期过期清理 |
| `private.auth_login_guards` | email HMAC PK、失败次数、`locked_until`、`captcha_required`、更新时间 | 不暴露 Data API；不存在与存在邮箱走相同记录路径 |
| `public.skill_tasks` | user/session、Skill 名称/版本快照、输入/补充、参考图、设置、缺失项、默认值、确认指纹、状态、batch FK、时间戳 | 仅正式活动会话读取本人；写入经受控服务/RPC |
| `public.sessions` 扩展 | `image_creation_enabled boolean not null default false` | 现有所有权 RLS 再叠加正式活动会话 |
| `public.timeline_items` 扩展 | Skill ID/名称/版本快照或结构化 metadata；可关联 `skill_task_id` | 快照字段写入后不可改写 |
| `public.generation_batches` 扩展 | `skill_task_id unique nullable`、Skill 名称快照；保留现有 `skill_id/version` | 一任务最多一个 batch；保留现有幂等和快照保护 |

数据库实施规则：

- 所有 `public` 表先 `REVOKE ALL FROM anon, authenticated`，再显式授予实际需要的最小权限并启用 RLS；`TO authenticated` 不能替代所有权和正式会话判断。
- `profiles` 和 `skill_tasks` 的 UPDATE policy 同时提供 `USING` 与 `WITH CHECK`，阻止更改 `user_id`/`session_id` 越权。
- 浏览器不得直接 INSERT `skill_tasks`、`generation_batches` 或认证私有表；受控 Route Handler/RPC 负责验证和事务。
- 所有 private 函数固定 `search_path`、撤销默认 `PUBLIC EXECUTE` 并显式授权；迁移后运行 Supabase advisors 与 pgTAP。
- 生成数据库类型并提交 diff，避免手写类型与迁移漂移。

### 7.4 安全与运行约束

```text
受保护请求
  -> Proxy 刷新 cookie/快速跳转
  -> Route Handler requireFormalSession
  -> service 校验资源所有权与状态
  -> Postgres RLS 再校验 active formal session + auth.uid ownership
  -> Worker 在 provider 前、结果提交前再检查匿名 tombstone/任务状态
```

`service_role`、DirectMail SMTP、HMAC key、action 加密 key 和 provider key 仅存在于 server/worker secret。HMAC key 与 action 加密 key 分离并带版本；轮换时允许短期双读，禁止把 email HMAC 当作可逆邮箱存储。公开页面和 CDN 不缓存带 `Set-Cookie` 的认证响应，受保护页面不做用户间共享缓存。

## 8. 分阶段实施路径

以下顺序是后续开发依赖顺序，不代表本次文档更新已经实施这些功能。

### 8.1 第 1 阶段：契约、迁移和失败测试

1. 增加 Phase 2 DTO、错误码、Skill registry 和状态机测试。
2. 新建数据库迁移，定义 private/public 表、扩展字段、索引、唯一约束、显式权限和 RLS。
3. 先写失败用例：匿名/未验证访问、跨用户、重复 Skill 执行、未确认默认值、登录锁定、action 重放、30/90 天边界。
4. 生成数据库类型并核对 OpenAPI/应用契约。

### 8.2 第 2 阶段：认证、邮件与正式会话

1. 实现 Unicode 密码、常见密码、HIBP 和版本化预哈希。
2. 实现 HMAC 登录 guard、Turnstile、统一枚举保护响应。
3. 实现 app action、Admin `generateLink`、DirectMail 和确认/找回页面。
4. 实现 `requireFormalSession` 并接入 Route Handler、RLS 和已提交任务边界。
5. 使用新/已注册/未验证邮箱及真实 QQ、163、企业邮箱完成集成证据。

### 8.3 第 3 阶段：公开 Skill 页面

1. 发布版本化公开 registry 和无认证 `GET /api/skills`。
2. 实现列表、详情、三处统一入口和受控登录意图。
3. 验证旧 Skill 到对应场景的恢复；发现/草案 ≤3 动作，就绪方案额外 1 次确认，资料步骤另记。

### 8.4 第 4 阶段：统一电商任务（覆盖旧 Skill 任务）

1. 实现 CommercePlan/Task、不可变修订、slots/runs/selections/slotHashes，与按会话开关和时间线关联。
2. 实现六场景、手工资料/模板、单项追问、明确方案确认和旧 Skill 映射。
3. 通过 service_role-only commerce_dispatch 在同一事务创建所有 count=1 子批次、额度与 queue，单次请求幂等，允许明确重做。
4. 验证新旧图切换、迟到结果阻断、固定导出、归档、仅待提交子项取消、设置/权限失败、登录恢复与会话切换。

### 8.5 第 5 阶段：账号和会话撤销

1. 实现 `/account`、显示名称和脱敏邮箱。
2. 实现主动改密保留当前会话与找回重置撤销全部会话。
3. 实现 Workspace dirty-state 退出确认和退出后保护边界。

### 8.6 第 6 阶段：匿名退场

1. 形成匿名范围清单和正式对照夹具。
2. 关闭匿名 Auth、前端 gate、API、Worker 与结果提交入口。
3. 隔离演练后执行任务取消、Storage API 对象删除、匿名用户删除与级联清理。
4. 证明匿名删除率 100%、匿名入口拦截率 100%、正式数据误删 0。

### 8.7 第 7 阶段：发布证据

1. 完成 `P2-AT01`～`P2-AT09`，所有固定场景必须全部满足通过条件。
2. 完成三 Skill 可用率和逐项保真盲评、桌面/窄屏任务。
3. 完成法律文本、Beta 文案、邮件文案、目标邮箱投递、匿名不可逆删除与无账号删除风险审批。
4. 只有证据齐全后才能更新 `doc/project-progress.md` 和 `doc/architecture.md`；Phase 2 验收不能替代后续生产门禁。

## 9. 验证与发布门禁

### 9.1 自动化验证

| 层级 | 必须覆盖 |
| --- | --- |
| 单元 | Unicode 代码点计数、SHA-384 固定向量、常见/泄露密码、email HMAC、action 状态、Skill 状态机、dirty-state |
| 组件 | 认证表单、Beta 标识、Skill 页面/标签、追问/确认卡、登录恢复覆盖层、退出确认 |
| API 集成 | 防枚举、锁定跨浏览器、action 过期/替代/重放、正式会话期限、确认请求幂等、同键异内容冲突、无扣额追问/草案、原子 1–8 子项 |
| pgTAP | private 表不可达、显式 `GRANT`、正式活动会话 + 所有权 RLS、跨用户/匿名拒绝、唯一约束、正式夹具零误删 |
| Worker | 匿名 tombstone 历史清理边界；电商用户取消仅作用于 pending + not_submitted 子项，release 一次、user_cancelled、运行中继续；重复 queue 消费幂等 |
| E2E | `P2-AT01`～`P2-AT08` 的页面和跨浏览器路径 |
| 盲评/可用性 | `P2-AT09`：三 Skill 分别 ≥80%，有参考图逐项保真；销售无图拦截，通用纯文字提示；发现/草案 ≤3 动作 + 就绪方案 1 次确认，资料步骤另记 |

### 9.2 发布阻断条件

下列任一项未满足均不得发布公开 Beta，也不得将状态写为已完成：

- `P2-SC01`～`P2-SC06` 没有全部取得可复核证据。
- 任一 planned 用户故事或 `P2-AT01`～`P2-AT09` 未通过。
- `P2-DEP01`、`P2-DEP02`、`P2-DEP03`、`P2-DEP05`、`P2-DEP06` 任一未完成。
- 法律文本没有明确中国大陆公开 Beta、非生产就绪、匿名数据无通知永久删除和无正式账号删除途径。
- 邮件未在真实 QQ、163 和企业邮箱验证，或 SPF/DKIM/DMARC/链接期限不符合要求。
- 匿名清理不能证明正式账号数据、任务、资产和额度逐项不变。
- Phase 1 既有生成、状态、费用、安全、删除或到期回归失败。

### 9.3 文档自身验收

本文件交付时执行以下静态核对：

1. 从 `requirements.md` 第 10.9 节提取 74 个矩阵 ID，加第 10.7 节 9 个 P2-AT 得 83 个；另核对第 11.4 节 EC-01–EC-17，共 100 个去重 ID，其中原 6 个 withdrawn 保留。
2. 确认 6 个 withdrawn ID 只标记撤销，不出现在实施任务中。
3. 确认第 2～6 节每个页面功能章节都包含需求来源、技术方案/伪代码、文件模块范围、选型依据和实施步骤。
4. 确认接口、错误码、表名、状态名和文件范围前后一致。
5. 确认文档只声明 v0.2 已批准、实施中，未声称测试/迁移/部署/真实效果通过；本次仅同步 requirements、architecture、tech-selection 三份正式文档。

## 10. Phase 2 全量需求追溯矩阵

| 需求 ID | 内容摘要 | 技术决策/处理 | 设计章节 | 状态 |
| --- | --- | --- | --- | --- |
| `P2-SC01` | 受保护入口拦截和登录回跳 100% | `P2-TS-AUTH-01`、`P2-TS-SESSION-01` | 3、7、9 | planned |
| `P2-SC02` | 正式账号跨设备恢复 100% | `P2-TS-CUTOVER-01` | 6 | planned |
| `P2-SC03` | 发现/草案 ≤3 动作 + 就绪方案 1 次确认 | `P2-TS-SKILL-01`、`P2-TS-WORKSPACE-01` | 2、4 | planned |
| `P2-SC04` | 三 Skill 可用率与逐项保真 | `P2-TS-WORKSPACE-01/02` | 4、9 | planned |
| `P2-SC05` | Phase 2 九类关键任务 100% 通过 | 全部 Phase 2 决策 | 8、9 | planned |
| `P2-SC06` | 匿名拦截/删除 100%，正式误删 0 | `P2-TS-CUTOVER-02` | 6、9 | planned |
| `P2-US1-AC01` | Skill 列表/详情公开且不泄露用户数据 | `P2-TS-SKILL-02` | 2 | planned |
| `P2-US1-AC02` | 保留三旧 Skill；六场景另见 EC-02 | `P2-TS-SKILL-01` | 2 | planned |
| `P2-US1-AC03` | 独立详情含六类说明和立即使用 | `P2-TS-SKILL-01` | 2 | planned |
| `P2-US1-AC04` | 三 Skill 的产出语义 | `P2-TS-SKILL-01` | 2、4 | planned |
| `P2-US1-AC05` | 三处入口使用同一内容 | `P2-TS-SKILL-01` | 2 | planned |
| `P2-US1-AC06` | 立即使用映射场景和登录选择恢复 | `P2-TS-SKILL-01`、`P2-TS-AUTH-01` | 2、3 | planned |
| `P2-US1-AC07` | 不提供市场/编辑/安装等入口 | `P2-TS-SCOPE-01`、`P2-TS-SKILL-01` | 2 | planned |
| `P2-US2-AC01` | 输入框单选 Skill 标签 | `P2-TS-WORKSPACE-01` | 4 | planned |
| `P2-US2-AC02` | 结构化向导、自然语言/参考图和逐项追问 | `P2-TS-WORKSPACE-01` | 4 | planned |
| `P2-US2-AC03` | 确认版本/选中项授权和历史快照 | `P2-TS-WORKSPACE-01`、`P2-TS-DATA-01` | 4、7 | planned |
| `P2-US2-AC04` | 每次确认幂等；草案/补充不入队 | `P2-TS-WORKSPACE-02` | 4 | planned |
| `P2-US2-AC05` | 待补充任务可续接且不得重复 | `P2-TS-WORKSPACE-01/02` | 4 | planned |
| `P2-US2-AC06` | 替换 Skill 前确认取消 | `P2-TS-WORKSPACE-01` | 4 | planned |
| `P2-US2-AC07` | 图片开关按会话持久化 | `P2-TS-WORKSPACE-03` | 4、7 | planned |
| `P2-US2-AC08` | 图片设置可见且不静默修改 | `P2-TS-WORKSPACE-01` | 4 | planned |
| `P2-US2-AC09` | 参考图逐项保真、销售无图拦截与通用纯文字提示 | `P2-TS-WORKSPACE-01` | 4、9 | planned |
| `P2-US2-AC10` | Skill 失败可重试且不替代 | `P2-TS-WORKSPACE-01` | 4、7 | planned |
| `P2-US2-AC11` | 最低执行条件 | `P2-TS-WORKSPACE-01` | 4 | planned |
| `P2-US2-AC12` | 默认值执行前展示并确认 | `P2-TS-WORKSPACE-01` | 4 | planned |
| `P2-US3-AC01` | Skill/电商目录公开，保存/执行等能力需登录 | `P2-TS-AUTH-01`、`P2-TS-SESSION-01` | 1、3 | planned |
| `P2-US3-AC02` | 仅邮箱密码注册/验证/登录/找回 | `P2-TS-AUTH-01/02`、`P2-TS-SCOPE-01` | 3 | planned |
| `P2-US3-AC03` | 注册四字段，显示名称非必填 | `P2-TS-AUTH-01` | 3 | planned |
| `P2-US3-AC04` | 验证 24h、60s 重发、旧链失效 | `P2-TS-AUTH-02` | 3 | planned |
| `P2-US3-AC05` | 找回 1h、60s 重发、旧链失效 | `P2-TS-AUTH-02` | 3 | planned |
| `P2-US3-AC06` | 8～64 Unicode 且拒绝常见/泄露密码 | `P2-TS-AUTH-03/04` | 3 | planned |
| `P2-US3-AC07` | 注册/登录防邮箱枚举 | `P2-TS-AUTH-02/05` | 3 | planned |
| `P2-US3-AC08` | 5 次失败、Turnstile、15 分钟全局等待 | `P2-TS-AUTH-05` | 3 | planned |
| `P2-US3-AC09` | 主动勾选正式条款和隐私 | `P2-TS-SCOPE-01`、`P2-TS-AUTH-01` | 3 | planned |
| `P2-US3-AC10` | 30 天闲置/90 天最长和登录落点 | `P2-TS-SESSION-01`、`P2-TS-AUTH-01` | 3、7 | planned |
| `P2-US3-AC11` | 中国大陆公开 Beta、非生产就绪 | `P2-TS-SCOPE-01` | 1、3、9 | planned |
| `P2-US4-AC01` | 基础账号页 | `P2-TS-ACCOUNT-01` | 5 | planned |
| `P2-US4-AC02` | 显示名称可增改清空 | `P2-TS-ACCOUNT-01` | 5、7 | planned |
| `P2-US4-AC03` | 主动改密只退出其他设备 | `P2-TS-ACCOUNT-02` | 5 | planned |
| `P2-US4-AC04` | 找回重置退出全部设备 | `P2-TS-ACCOUNT-02` | 5 | planned |
| `P2-US4-AC05` | 登录失效保留完整现场 | `P2-TS-SESSION-01`、`P2-TS-WORKSPACE-01` | 4、5 | planned |
| `P2-US4-AC06` | 有未发送现场时退出确认 | `P2-TS-ACCOUNT-02` | 5 | planned |
| `P2-US4-AC07` | 退出后保护内容不可恢复且不匿名化 | `P2-TS-AUTH-01`、`P2-TS-SESSION-01` | 5、6 | planned |
| `P2-US4-AC08` | 无扩展账号管理和删除途径 | `P2-TS-SCOPE-01`、`P2-TS-ACCOUNT-01` | 5、9 | planned |
| `P2-US5-AC01` | 撤销匿名历史自动归入 | 不实现；保留撤销记录 | 1、6 | withdrawn |
| `P2-US5-AC02` | 撤销归入去重/覆盖/顺序行为 | 不实现；保留撤销记录 | 1、6 | withdrawn |
| `P2-US5-AC03` | 撤销归入失败和重试入口 | 不实现；保留撤销记录 | 1、6 | withdrawn |
| `P2-US5-AC04` | 正式账号跨设备历史 | `P2-TS-CUTOVER-01` | 6 | planned |
| `P2-US5-AC05` | 撤销匿名进行中任务归入 | 不实现；保留撤销记录 | 1、6 | withdrawn |
| `P2-US5-AC06` | 全流程不关联匿名数据 | `P2-TS-CUTOVER-01/02` | 6 | planned |
| `P2-US5-AC07` | 切换时永久删除匿名数据/任务/资产 | `P2-TS-CUTOVER-02` | 6 | planned |
| `P2-US5-AC08` | 无通知、只读、下载、迁移或恢复 | `P2-TS-CUTOVER-02` | 6 | planned |
| `P2-US5-AC09` | 正式账号数据/任务/额度零改变 | `P2-TS-CUTOVER-02` | 6、9 | planned |
| `P2-NG01` | 六场景/平台筛选/审核示例覆盖旧限制；无 Skill 市场 | `P2-TS-SCOPE-01`、`P2-TS-SKILL-01` | 2 | planned |
| `P2-NG02` | 不做 Skill 平台或多 Skill | `P2-TS-SCOPE-01`、`P2-TS-SKILL-01` | 2 | planned |
| `P2-NG03` | 不新增登录方式 | `P2-TS-SCOPE-01`、`P2-TS-AUTH-01` | 3 | planned |
| `P2-NG04` | 不做扩展账号管理/删除 | `P2-TS-SCOPE-01`、`P2-TS-ACCOUNT-01` | 5 | planned |
| `P2-NG05` | 不扩语言、客户端、浏览器或完整无障碍认证 | `P2-TS-SCOPE-01` | 1、3 | planned |
| `P2-NG06` | 需求不规定技术方案且技术不得改产品行为 | 本文件第 1.1 节边界 | 1 | planned |
| `P2-NG07` | 不做外部告警 | `P2-TS-SCOPE-01` | 1 | planned |
| `P2-NG08` | 不做匿名迁移/只读/下载/恢复/继续创作 | `P2-TS-CUTOVER-02` | 6 | planned |
| `P2-DEP01` | 经批准的条款与隐私正式文本 | `P2-TS-SCOPE-01`、`P2-TS-AUTH-01` | 3、9 | planned |
| `P2-DEP02` | 邮件文案审核和目标邮箱可达 | `P2-TS-AUTH-02` | 3、9 | planned |
| `P2-DEP03` | 三 Skill 内容审核且口径一致 | `P2-TS-SKILL-01` | 2、9 | planned |
| `P2-DEP04` | 撤销匿名历史可识别/可归入依赖 | 不实现；保留撤销记录 | 1、6 | withdrawn |
| `P2-DEP05` | 匿名范围清单、完整删除与零误删 | `P2-TS-CUTOVER-02` | 6、9 | planned |
| `P2-DEP06` | Beta/地域/匿名删除/无账号删除审批 | `P2-TS-SCOPE-01` | 3、5、9 | planned |
| `P2-RISK01` | 8 位无 MFA 的猜测/填充风险 | `P2-TS-AUTH-03/05` | 3 | planned |
| `P2-RISK02` | 法律文本缺失或不完整 | `P2-TS-SCOPE-01` | 3、9 | planned |
| `P2-RISK03` | 撤销匿名归入中断/重复风险 | 不实现；保留撤销记录 | 1、6 | withdrawn |
| `P2-RISK04` | 图片开关持续开启导致额度风险 | `P2-TS-WORKSPACE-03` | 4 | planned |
| `P2-RISK05` | 匿名永久删除的不可逆损失 | `P2-TS-CUTOVER-02` | 6、9 | planned |
| `P2-RISK06` | 无正式账号删除途径 | `P2-TS-SCOPE-01`、`P2-TS-ACCOUNT-01` | 5、9 | planned |
| `P2-RISK07` | 公开 Beta 被误认为生产服务 | `P2-TS-SCOPE-01` | 1、3、9 | planned |
| `P2-AT01` | 公开 Skill、保护入口和登录落点场景 | `P2-TS-SKILL-02`、`P2-TS-AUTH-01` | 2、3、9 | planned |
| `P2-AT02` | 注册/验证/重发/找回/密码/邮件场景 | `P2-TS-AUTH-02/03/04` | 3、9 | planned |
| `P2-AT03` | 登录锁定、重置清除和 30/90 天场景 | `P2-TS-AUTH-05`、`P2-TS-SESSION-01` | 3、9 | planned |
| `P2-AT04` | 账号、改密、失效恢复与退出场景 | `P2-TS-ACCOUNT-01/02` | 5、9 | planned |
| `P2-AT05` | 匿名切换删除与正式零误删场景 | `P2-TS-CUTOVER-02` | 6、9 | planned |
| `P2-AT06` | 正式账号跨设备及负向隔离场景 | `P2-TS-CUTOVER-01` | 6、9 | planned |
| `P2-AT07` | 三 Skill 入口、详情和立即使用场景 | `P2-TS-SKILL-01/02` | 2、9 | planned |
| `P2-AT08` | Skill 状态、设置、失败、历史和切换场景 | `P2-TS-WORKSPACE-01/02/03` | 4、9 | planned |
| `P2-AT09` | 三 Skill 质量、保真、提示和可用性场景 | `P2-TS-WORKSPACE-01/02` | 4、9 | planned |

## 11. Phase 1 已实施技术基线索引

本节保留 v1.4 的历史决策语义，用于 Phase 2 回归。状态以实际代码和 `doc/project-progress.md` 证据为准；本次只重编技术文档，不重新声明 Phase 1 的交付结论。

### 11.1 基础栈与前端

| 历史决策 ID | 保留基线 |
| --- | --- |
| `TS-BASE-01` | Next.js 16 App Router、React、TypeScript strict、pnpm workspace；应用位于 `apps/web/app` |
| `TS-DB-01` | SQL migration、生成数据库类型、pgTAP、公开表显式 `GRANT` 和 RLS |
| `TS-TYPE-01` | Zod/等价运行时 schema、`unknown` 和判别联合；请求、SSE、provider、queue 先验证后使用 |
| `TS-I18N-01` | 结构化 zh-CN key；Phase 2 仍不开放 en-US |
| `TS-PERF-01` | 以固定夹具区分生图端到端 P95、SSE、队列等待和侧栏渲染性能 |
| `TS-FE-01`～`TS-FE-03` | `UnifiedWorkspace`、`UnifiedComposer`、统一 `Timeline/GenerationCard`，聊天和生图共享会话/时间线 |
| `TS-FE-04`、`TS-FE-09` | 图片设置浮层、参考图上传与批量下载继续保留；固定 Skill 表单和模板预览先被 Phase 2 覆盖，现按电商向导与逐图方案交互 |
| `TS-FE-05`～`TS-FE-07` | `/chat`、`/image` 重定向统一工作区；SessionSidebar；Zustand 只保存 UI/请求瞬态，服务端是事实源 |
| `TS-FE-08` | 显式图片工具许可继续保留；Skill 取消恢复旧偏好的部分被按会话开关覆盖 |
| `TS-FE-10`～`TS-FE-12` | 受控标签安全 Markdown、智能滚动、高级图片设置和生成轮次布局继续回归 |
| `TS-IMG-01`～`TS-IMG-03` | 1～4 张、服务端 capability manifest、五种比例、1K/2K、PNG/JPEG/WebP、单图 10 MB、1～4 张参考图 |

### 11.2 API、AI 与数据

| 历史决策 ID | 保留基线 |
| --- | --- |
| `TS-API-01` | `POST /api/chat` 使用 SSE，事务创建/验证 session 与用户消息，完整 assistant 消息后持久化 |
| `TS-API-02`～`TS-API-04` | 图片提交、重建和批次查询继续走事务、HTTP 202、轮询和短期资产地址 |
| `TS-API-05` | sessions/timeline 是唯一历史 API，删除先返回 202 并进入异步清理 |
| `TS-API-06` | 应用代码维护 `GET /api/openapi.json`，不读取 Supabase anon OpenAPI spec |
| `TS-API-07` | 统一错误体、稳定错误码和 details 白名单；Phase 2 在同一 registry 扩展认证/Skill 错误 |
| `TS-AI-01` | LangGraphJS + Postgres checkpointer，`sessions.id` 作为 `thread_id` |
| `TS-AI-02`、`TS-AI-05` | Seedream/Gemini 图片 adapter 与显式用户选择；不自动付费切换 provider |
| `TS-AI-03` | 版本化 Skill 定义并记录 `skill_id/version`；Phase 2 扩展为公开/内部 registry 和历史名称快照 |
| `TS-AI-04` | provider 原生内容安全与统一审计映射，固定数据集验证 |
| `TS-AI-06` | Doubao/MiniMax 聊天 adapter 与图片 provider 独立选择、健康和故障边界 |
| `TS-RETRY-01` | 聊天仅在首个内容块前对瞬时失败重试一次；图片可能已提交后不自动重放 |
| `TS-DATA-01`～`TS-DATA-03` | sessions、timeline_items、generation_batches/generations 及唯一序列、幂等、批次状态继续作为事实源 |
| `TS-DATA-04` | 版本化 Skill 与 timeline/batch 快照；Phase 2 明确 registry 为三 Skill 内容源 |
| `TS-SEC-01`～`TS-SEC-03` | RLS/所有权、server-only secrets、上传 MIME/扩展名/magic bytes/大小/像素/数量校验 |
| `TS-PRIVACY-01` | 日志/审计白名单脱敏，不保存思维链或 signed URL |

### 11.3 队列、Storage、运维与测试

| 历史决策 ID | 保留基线 |
| --- | --- |
| `TS-QUEUE-01`～`TS-QUEUE-04` | 数据、配额和 queue 在事务中创建；消息版本化；条件更新抢占；重复消费幂等；未知 provider 提交不自动重试 |
| `TS-QUOTA-01` | 生成前原子预占、成功结算、确定未提交失败释放、未知结果待对账；匿名每日额度随匿名退场而失效 |
| `TS-STORAGE-01`～`TS-STORAGE-05` | uploads/generated private bucket、受控路径、短期 signed URL、生成图 90 天/参考图 30 天、Storage API 删除 |
| `TS-DELETE-01` | 会话先标记 deleting 并入清理队列，UI 隐藏；checkpoint、对象、子记录和 session 可重入清理 |
| `TS-HEALTH-01` | provider 共享健康窗口及 warning/unavailable 阈值 |
| `TS-OBS-01`～`TS-OBS-03` | Sentry、结构化日志、correlation ID 和 API/SSE/queue/provider/Storage/配额/清理指标 |
| `TS-OPS-03`～`TS-OPS-07` | 数据库/Storage 独立备份、季度恢复、制品回滚、expand/contract、secret/type/migration/pgTAP CI 门禁仍属生产边界 |
| `TS-AUTH-01`、`TS-AUTH-02` | 匿名 bootstrap 与同浏览器恢复是历史行为，Phase 2 被 `P2-TS-AUTH-01`、`P2-TS-CUTOVER-02` 明确覆盖 |
| `TS-SCOPE-01`～`TS-SCOPE-04` | Web、无协作/精修/训练/市场/4K/付费/原生客户端等边界继续保留；账号绑定、外部告警延后表述按第 1.2 节修正 |
| `TS-TEST-01`～`TS-TEST-03` | 单元/组件/集成/pgTAP/E2E、零费内测浏览器矩阵和统一错误/恢复/模型路径回归继续保留 |

Phase 2 必须继续验证：SSE 分片/断流、图片工具许可、1～4 张原子入队与部分成功、参考图限制、生成重建、private URL 续签、到期、删除重试、配额并发、provider 隔离、内容安全、日志脱敏、RLS/GRANT、备份恢复等 Phase 1 行为。唯一批准的破坏性变化是匿名身份永久退场，且必须按第 6 节取得证据。

## 12. 参考依据

以下资料用于验证技术可行性，不替代 `requirements.md` 的产品行为：

- [Supabase：Next.js SSR client、Proxy 与 getClaims](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase：用户会话、session_id 与 Pro 才提供的会话期限配置](https://supabase.com/docs/guides/auth/sessions)
- [Supabase：密码安全](https://supabase.com/docs/guides/auth/password-security)
- [Supabase Auth 源码：72 字节密码上限](https://github.com/supabase/auth/blob/master/internal/api/password.go)
- [Supabase Admin generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink)
- [Supabase：自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Have I Been Pwned：Pwned Passwords k-anonymity API](https://haveibeenpwned.com/API/V3)
- [阿里云 DirectMail：SMTP 服务地址与端口](https://help.aliyun.com/en/direct-mail/smtp-endpoints)
- [阿里云 DirectMail：计费方式](https://help.aliyun.com/zh/direct-mail/billing-methods)
- [Supabase：匿名身份](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase：Storage 删除对象](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Supabase：Data API 安全与显式授权](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase：Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Next.js 16 升级说明](https://nextjs.org/docs/app/guides/upgrading/version-16)

Supabase 相关实现开始前还应复核当日 changelog。2026-09-01 复核到的变更中，没有要求改变本文的托管 Auth/SSR 方案；自托管 Auth URL 变更与本项目无关，Data API 默认暴露和 OpenAPI 匿名访问收紧进一步支持显式 `GRANT`、RLS 及应用自维护 OpenAPI 的既有决策。
## Phase 2 选型修订（2026-09-06）

本节覆盖旧版 Phase 2 方案中与当前批准行为冲突的内容。认证采用 Supabase 原生邮箱认证与会话撤销；应用不自建邮件令牌、密码预哈希、30/90 天期限；旧认证二次确认状态不引入。电商方案确认是生成授权，按第 13 节独立实施。Skill 公共 registry 只返回名称、版本、说明、默认方案和限制，服务端执行指令不进入公开响应。该日期的“信息足够时一次发送即排队”已由 D08 撤销：发送只生成/修改方案，缺项追问，所有旧 Skill 都在明确确认当前版本/选中项后才入队。图片开关只表示允许图片能力，普通问题和闲聊不创建生成任务。


## 13. 电商 v0.2 实施选型（2026-09-08，尚待验证）

### 13.1 批准范围与决策

本节纳入 D01–D11 和批准的 v0.2 实施计划，替代研究技术方案的建议命名与接口。用户已授权开发，但真实 Provider 调用预算、线上迁移和发布证据不由本次文档同步产生。

| 技术决策 ID | 选型及原因 | 需求 |
| --- | --- | --- |
| EC-TS-01 | `/create` 六场景目录，唯一 `/` 工作台三步向导/对话/结果；旧三 Skill 映射同方案，避免第二套会话与发送授权。 | EC-01/02/03/07/17 |
| EC-TS-02 | `CommercePlan`、`CommerceTask`、slots/runs/selections/slotHashes；独立可选 CommerceGateway 挂载 WorkspaceGateway，mock/HTTP 共用 schema。 | EC-04/05/06/09/10/11 |
| EC-TS-03 | 12 个原创模板、人工确认事实和确定性服务端编译；公开元数据/私有指令分离；不开放未验证视觉分析。 | EC-05/06/12/14 |
| EC-TS-04 | service_role-only `commerce_dispatch` 保存不可变版本，原子创建 run 与 count=1 子批次/队列/预占；保留现有 Worker 与日限额/preview guard。 | EC-07/08/09/15/16 |
| EC-TS-05 | slot 哈希、最新重做和选择版本共同阻断迟到覆盖；默认新成功图、手选旧图、固定导出清单。 | EC-10/11/13/15 |
| EC-TS-06 | 现有 Provider、整图文字；1–8 slot、单方案/模型合计 4 张 ×10 MB 参考；同会话历史内部上限 64，显式样图采用；销售 product 引用必需；不增加独立排版/长图合成。 | EC-04/06/12/13/17 |
| EC-TS-07 | 租约/领取版本、持久结果登记、完成补写、在途删除补偿及清理重领；配额账本与内容级联删除分离。 | EC-08/09/15/16 |

### 13.2 领域与网关

当前领域使用 `CommerceBrief`（name/facts/sellingPoints/platform/placement/productReferenceIds/styleReferenceIds）、`CommercePlan`（scene/brief/templateId/slots）和 `CommerceTask`（Plan + id/sessionId/revision/createdAt/updatedAt/runs/selections/slotHashes/archived）。slot 包含稳定 id、role、instruction、exactText、referenceIds 和 provider/model/aspectRatio/resolution。run 包含 id/revision/requestId/createdAt/items，item 关联 slotId/batchId/generationId/status/compatibilityHash/selectionVersion；selection 保存 slotId/generationId/compatibilityHash/version。研究中的 CreativeTask/CreativeRevision 为概念草案，正式 TypeScript 以 Commerce 命名，持久版本用 commerce_revisions。

`WorkspaceGateway.commerce?: CommerceGateway` 是独立可选能力，方法包含 list/get/create/save/submit/select/export/upload，以及 `archive(taskId, {requestId, revision})`、`cancel(taskId, {requestId, revision, runId})`。后二者均返回 `Promise<CommerceTask>`；领域 schema、API、网关和 SQL 已接入。HTTP/mock 共用领域 schema，并从 list/get 恢复保存事实；UI 表单不能成为确认方案或选图的第二份数据库。接入状态不等于运行时/数据库测试通过。

场景固定为主图、套图、详情、种草、参考风格、现有模特六类。12 模板固定为白底主图、柔光棚拍、材质特写、核心卖点、参数版式、日常场景、手持展示、品牌主视觉、种草封面（含小红书用途）、生活方式拼贴、详情首屏、详情模块。首版人工确认事实，商品事实/保真约束优先于文案目标、平台用途、风格和装饰。版本、原创/来源、权利、审核与模型验证状态独立记录，未验证标明待验，禁止全量导入第三方案例或复制其内部执行指令为授权。

### 13.3 实际接口选型

所有路径为实施契约，是否完整接通由主任务验证；失败沿用项目统一错误 schema 和 details 白名单。

| 接口 | 请求/返回要点 |
| --- | --- |
| `GET /api/creative-templates` | 公开安全模板元数据；无私有指令或用户数据。 |
| `GET /api/creative-tasks?sessionId=…` | 正式账号/活动会话所有权；返回 CommerceTask[]。 |
| `POST /api/creative-tasks` | requestId、sessionId、plan；返回初始 CommerceTask，不入队。 |
| `GET /api/creative-tasks/{id}` | 返回有权任务、当前方案、slotHashes、runs/selections。 |
| `PATCH /api/creative-tasks/{id}` | requestId、expectedRevision、plan；新不可变修订，冲突 409。 |
| `POST /api/creative-tasks/{id}/submit` | requestId、revision、slotIds、recreate?、source?；202 CommerceTask，含稳定 run/item 映射；source 仍为 direct/chat_tool。 |
| `POST /api/creative-tasks/{id}/select` | requestId、revision、slotId、generationId、expectedSelectionVersion；所有权/候选校验，选择竞争 409。 |
| `POST /api/creative-tasks/{id}/export` | requestId、revision、selections（slotId/generationId）；返回 id/revision/createdAt/items 的固定清单，短期 URL 按权限签发。 |
| `POST /api/creative-tasks/{id}/archive` | requestId、revision；返回 CommerceTask。幂等归档，保留历史/导出并阻止新提交；不是删除资产、取消在途或退款。 |
| `POST /api/creative-tasks/{id}/cancel` | requestId、revision、runId；返回 CommerceTask。只取消目标 run 中 pending 且 not_submitted 子项，释放一次额度，running 继续。 |

研究建议的 `/analyze`、`/quote`、独立 `/recreate`、`PATCH /selection`、研究的 `creative-runs/{id}/cancel` 路径不作为当前公开接口承诺；现行取消使用 `POST /api/creative-tasks/{id}/cancel`。确认卡估算 `slotIds.length` 图片额度；未知价格保持未知，不引入另一套人民币计费。重做用 submit 的 recreate 标志；详情改字先保存新方案再确认受影响 slot。

### 13.4 持久化、授权与原子性

选择 `commerce_tasks`、`commerce_revisions`、`commerce_runs`、`commerce_run_items`、`commerce_selections`、`commerce_exports` 及私有编译快照、操作幂等结果。任务归属正式账号与活动 session；版本不可覆盖，slot 哈希来自可信服务端编译，既有 skill/prompt 客户端输入不能冒充已确认模板。正式服务验证身份/Origin/所有权后调用 `public.commerce_dispatch` 包装和 `private.commerce_dispatch`，二者仅向 service_role 授予 EXECUTE，撤销 PUBLIC/anon/authenticated，固定 search_path。客户端可读表须最小 GRANT + RLS，客户端不可直接写版本、run 或队列。

幂等按 user/operation/requestId 与规范化内容哈希；身份和所有权先验证，同键同内容先返回原结果，即使当前 revision 后来变化也不新执行，同键异内容拒绝。新请求锁定任务/目标 slot，校验当前版本、1–8 去重选中项、全部引用、模型/Provider 启用、每日额度、preview guard 与 emergency stop；活跃或已有有效结果不得被不同 requestId 隐式重复生成，明确重做例外仍受活跃执行保护。

同一数据库事务调用既有内部单图提交逻辑，为每 slot 创建 count=1 batch/generation、run item、配额预占与 queue；第 N 项失败时全部回滚，不能循环 HTTP 获得部分入队。执行组只汇总额度，子任务预占一次。通用直接生图仍为同 prompt 的 1–4 张，不扩大单次模型能力。

### 13.5 选图、结果与清理

`slotHashes` 逐图反映当前商品事实、引用、模板、文案和设置；未修改 slot 的有效选择跨 revision 延续。自动采用新成功图必须匹配当前哈希、最新在途重做和 selectionVersion；手动切图递增版本并清理旧候选获胜资格。迟到、失败、未知或缺图不能替换旧选择。用户可明确选回不兼容旧图，但显示旧版/待更新，不冒充符合新方案。

export 固定有序 slot/generation 映射，后续完成和手选不会改写；单图重做后其余 slot 仍可参与完整集合。查询/签发校验正式所有权、同任务候选、成功与保留期，部分失效明确反馈，不能只下载可用子集却称完整。归档保留读取、历史和导出，阻止保存/新提交，不承诺上游取消。

Worker 以租约版本和续租协调领取，已提交未知先核对不盲重放。Provider 结果或上传成功需持久登记，以便完成写库失败后幂等补写、仅重试存储步骤。删除与在途写入协调，拒绝完成的对象进入持久补偿清理；账号清理崩溃后重领。配额账本保留不可变业务标识，不随会话内容级联删除；删除不恢复消费。这些目标仍须 SQL/Worker 故障证据验证。

归档/取消输入分别使用 `commerceArchiveSchema`（requestId/revision）与 `commerceCancelSchema`（另加 runId），沿用正式账号所有权、当前 revision、请求幂等和 RPC 事务边界。cancel 校验 run 属于任务，仅在锁保护下处理 `status=pending` 且 `provider_submission_state=not_submitted` 的可取消子项；已 processing/running 的子项继续，其他 run 不受影响。取消落为子项 `failed` + `error_code=user_cancelled`，不伪装 Provider 错误或影响其健康统计；release 按既有业务唯一键只写一次，同事务归档对应 queue 消息、清除在途候选关联并刷新批次，旧选图保留。相同幂等请求返回原结果；新请求无可取消子项返回 `commerce_cancel_conflict`，不能重复返额或声称整组停止。

#### 13.5.1 历史参考上限与显式样图采用（新增集成裁定）

单个 CommercePlan 及模型提交仍最多 4 张参考，每张 ≤10 MB，商品/风格/采用样图合计计数；模型更低能力上限优先。既有同会话历史参考文件可保留最多 64 个，属于内部资源上限，继续受现有上传/每日字节 guard 约束；不把历史文件数量当作模型输入数量，也不因旧草案占用四张选中引用而阻止新商品资料或样图转换。

新增参考迁移与对应实现负责 generated sample → reference 的受保护转换。仅明确“采用为参考”触发；校验正式身份、生成所有权、同会话、成功/有效期与目标会话资源保护，再幂等创建引用，保存 `source_generation_id`。不能将 generationId 或 signed URL 直接提交为 referenceId。满四张时先明确替换当前方案的引用，保留旧草案历史；生成首张样图不自动修改后续方案。

转换须在写对象前建立持久对象意图，记录来源与目标关联，以便复制失败、写库失败、重复请求或在途删除后可恢复登记/补偿清理；数据库和 Storage 不被假定为同一事务。复用现有上传安全、字节保护、私有存储及清理机制，不能用样图转换绕过限制。本次 main 持有的是功能实施范围，未获得公共付费调用预算；真实生成/评测费用仍不得从该资源上限或功能授权推导。

### 13.6 验证分层与实施边界

正式验收为 requirements 第 11.4 节 17 个 EC，原 83 个 P2 ID 保留且相关 Skill 语义已修订；第 10 节技术追溯表保留原 ID，对第 4/7 节的映射按本节覆盖。六场景、12 模板和 17 验收条目均不是通过数。发现/草案 ≤3 动作、就绪方案额外 1 次确认；上传/补充/编辑单记，不用缩减确认来达标。

必须分别记录：领域编译和模板、mock/HTTP 契约、权限/RLS/RPC、并发与全组回滚、Worker/清理故障、浏览器/窄屏恢复、真实 Provider 保真/文字、迁移与发布。main 负责运行 lint/typecheck/domain+web tests/build/mock E2E，并据环境记录数据库/Worker 与隔离 HTTP；本次仅正式文档同步，未执行也未声称这些验证通过。研究中的 12 商品素材包/36 评测任务及 ≥90% 保真是评测建议，未转换为消费授权或已达标结论。

首版保持 4 张合计参考（PNG/JPEG/WebP，每张 ≤10 MB）和当前模型支持尺寸；销售主图/套图/详情必须真实 product 引用。纯文字走通用生图入口。AI 整图文字改字需重新确认生成，无独立文字排版或长图合成，无未验证视觉分析按钮；新 GPT-Image-2、视频、A+、模特专项增强、支付与自动发布均另行安排。关闭新 commerce 提交时仍保留历史读取、固定导出和在途核对，不通过清表/清队列或重放未知请求回退。


### 13.7 电商验收追溯（全部待验证）

| 需求 ID | 技术落点 | 证据类型 |
| --- | --- | --- |
| EC-01 | EC-TS-01/02；架构 M19/M21、F10 | 导航、登录返回、桌面/移动恢复 |
| EC-02 | EC-TS-01；架构 M19/M20 | 六场景覆盖、输入/产物文案 |
| EC-03 | EC-TS-01/02；架构 M19/M20 | 平台与用途保存/切换 |
| EC-04 | EC-TS-02/04/06；架构 M13/M22/M23 | 单方案/模型四图、会话历史内部 64、类型/大小、字节 guard、权限/到期与显式样图采用 |
| EC-05 | EC-TS-02/03；架构 M19/M20 | 手填闭环、单项追问、事实与分析边界 |
| EC-06 | EC-TS-02/03/06；架构 M20/M23 | 1–8 稳定 slot、参数与选中项 |
| EC-07 | EC-TS-01/04；架构 F10 | 草案零入队、明确授权版本 |
| EC-08 | EC-TS-04/07；架构 M23、F10 | 幂等、并发、冲突与全组回滚 |
| EC-09 | EC-TS-02/04/07；架构 F11 | 刷新/未知提交、上传后落库失败恢复 |
| EC-10 | EC-TS-02/05；架构 M19、F11 | 单图目标与整套变更确认 |
| EC-11 | EC-TS-02/05；架构 F11 | 默认新图、切旧图、迟到阻断与五图完整导出 |
| EC-12 | EC-TS-03/06；架构 M08/M20 | 模型 capability 与拒绝静默替换 |
| EC-13 | EC-TS-05/06；架构 M19/M22、F11 | AI 整图文字、改字确认与独立图片交付 |
| EC-14 | EC-TS-03；架构 M20 | 12 原创模板、版本/审核/模型验证元数据 |
| EC-15 | EC-TS-04/05/07；架构 M13/M22/M23、F11 | 所有权、固定导出、失效、归档保留历史/导出、目标 run 取消边界、样图 source_generation_id 与持久对象意图清理 |
| EC-16 | EC-TS-04/07；架构 M10/M23、F10 | 额度仅预占一次、取消只释放一次、日限额/preview guard、删内容不返额 |
| EC-17 | EC-TS-01/06；架构 M01–M06、F10 | 聊天/直接生图/认证/历史及旧 Skill 新授权回归 |
