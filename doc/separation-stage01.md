# 前后端分离：执行基线与阶段0/1

日期：2026-10-29。批准范围见 `requirements.md` 最新修订；状态与验证结果只在 `project-progress.md` 维护。

## 基线与授权

- 起点为干净的 `48e35686e0e4d6b302a1940cb12f5ea1be84860e`，原分支 `codex/home-chat-react-bits-20261027`。本地开发分支 `codex/frontend-backend-separation-20261029` 从该精确提交创建，不从历史main重新开始。
- 已批准：保留后端/全部功能与UI、首页预渲染、前端不重启API、后端受保护短维护；用户“复核计划后，开干”授权本地分阶段实现与测试。首轮零schema迁移。
- 安全最终复核允许本地Task0/1，无Critical/Important阻断；不代表生产就绪或发布许可。规划原件是Library `libfile_b8ddc82d9d2c81919fe7d7e7cf24764c`，SHA256 `4834e7bb4f179141c322020915b963933984995fc48d179bdc7c3d08da585f0f`；原件保留其形成时的只读授权措辞，由本记录同步最新本地开发授权，不改写已交付原件。
- 生产发布继续暂停；不连接/变更生产、不重启/安装helper、不改生产入口或秘密、不部署Worker/迁移数据库、不合并/commit/push、不新增付费消费。

## 冻结清单与证据口径

- `separation/api-baseline.json` 固定49个API route文件、58个显式导出方法与源码hash。包含停用及本地mock入口；不是58个生产可执行功能。隐式HEAD/OPTIONS与真实HTTP/Proxy行为需要后续HTTP验证。
- `separation/route-policy.json` 固定页面/别名/退役/未知路径和query/hash范围，是迁移合同输入，尚不是已安装Nginx配置。9个现有合法scene ID全部保留，不能只因目录显示五类而删除兼容场景。
- API清单中的schema标识、状态和缓存字面量是route文件静态证据；委托helper、逐方法输入/输出/错误/权限仍由阶段1合同验证补齐，不把静态扫描称为完整OpenAPI或真实验收。
- 私有页面可以提供无私有数据的静态壳；鉴权仍由API。`/account` 当前服务端guest跳转与未来客户端检查需分别记录，不能把静态壳200误称为未授权数据访问或假称保留私有SSR。
- 已有公开ready仅为liveness/版本，无法证明DB、认证、队列、供应商或字体就绪。旧生产版本、约327MiB余量、Node drop-in未重启及云构建158.636秒均为既有交接记录，本轮未重新测量。

## 兼容矩阵（均不得冒称真实环境已通过）

| 组合 | 本地合同要求 | 后续真实证据 |
| --- | --- | --- |
| 当前F0 + 当前API A0 | 保留v1路径/方法/DTO/错误/SSE/计费Minor/幂等 | 原有证据按进度账本，不由本清单重新验收 |
| F0 + 兼容API A1 | 原客户端无新header仍正常，Cookie与旧请求身份保持 | 真正旧构建标签页跨构建RSC/chunk/图片优化/草稿 |
| 新静态F1 + A1 | 最小apiMajor/minor/capabilities满足，新功能不靠模拟通道 | 完整业务、认证/Storage/队列/账本与私有导出 |
| F1 + A0 | 不满足新前端要求就拒绝发布/独立退API | 若声明支持，必须有具体组合测试 |
| 回退F0 + A1 + 当前DB/Worker | 不倒退数据库、不重复生成/扣费、旧payload/fence兼容 | 精确组合回退与账务/队列状态 |

## 写入所有权与依赖

协调会话唯一修改：分支/台账、本文件、正式需求/技术/架构/进度记录、`doc/separation/*`基线及所有根/共享配置。S1的domain barrel作为明确例外由S1实施者独占，协调者不同时改这三份合同文件。阶段0/1不改package.json、workspace、lockfile、Next配置、数据库/Worker或现业务处理器。

### S1：纯运行期合同（先完成并冻结）

可分派给Sol 6.1 high，支持时请求Fast；实施者只写：

- 新 `packages/domain/src/runtime-contracts.ts`。
- 新 `packages/domain/tests/runtime-contracts.test.ts`。
- 修改 `packages/domain/src/index.ts`，仅增加新合同的导出。

不得修改任何web/API、auth/proxy/ready、OpenAPI、配置/依赖/文档。先观察新增边界测试失败再实现，验证domain专项与typecheck后报告精确导出和字段；未冻结前S2/S3不改实现。

合同基准：`publicConfigSchema` 输出schemaVersion=1、formalAuth:boolean、dataMode='http'、captchaSiteKey:string|null、approvedLegalVersion:string|null、registrationEnabled:boolean；只允许显式公开字段。缺法务版本保持registrationEnabled=false，非法/不完整HTTP配置不伪装就绪；注册仍由原后端强校验，不改现认证存储与CAPTCHA语义。Meta输出schemaVersion=1、backendRelease、api:{major:1,minor:非负整数}、capabilities；capability表示实现合同，不能声称DB/Provider/真实服务健康。生产版本不能静默回退development。

manifest纯schema区分构建前assetNamespace与构建后artifactId/treeFingerprint/index摘要，严格约束版本、相对路径、摘要和API需求；本阶段不实现制品生成/部署器。具体字段在实现前按规划固定并回报协调者，不扩展收费/模型/数据库合同。

### S2：两个只读接口（依赖S1冻结，可与S3互斥并行）

Sol 6.1 high，支持时请求Fast；只写新 `apps/web/server/runtime/public-config.ts`、`api-meta.ts`，新 `apps/web/app/api/public-config/route.ts`、`meta/route.ts`，新 `apps/web/tests/runtime-public-config.test.ts`、`runtime-api-meta.test.ts`。消费S1导出，不修改domain、原API、认证/Proxy、OpenAPI或共享配置。

两个GET显式运行期读取、no-store、统一安全错误，无Supabase/数据库/模型/网络调用、无全量process.env输出；在原mock应用下不假造HTTP模式。使用现有Zod/Vitest，无新依赖；先观察新增边界测试失败再实现。

### S3：API基线与OpenAPI合同覆盖（依赖S1冻结，可与S2互斥并行）

Sol 6.1 high，支持时请求Fast；只写：

- `apps/web/server/openapi.ts`、`apps/web/tests/openapi.test.ts`。
- 新 `apps/web/tests/api-compatibility.test.ts`、`apps/web/tests/route-policy.test.ts`及这两个测试独用的fixture。

只读消费冻结基线；核对逐方法鉴权/helper/schema/错误/状态/缓存/幂等。保留已有operationId与v1行为、410/本地mock限制、401/503区分、SSE结构和账本/价格版本，不用泛化object宣称完整合同。不改处理器或安全策略来迎合文档。新增S2的两个GET到位后总计51文件/60显式方法；全树扫描与集成验证待S2/S3停笔后运行。

依赖顺序：安全GO → S0冻结 → S1纯schema与barrel名字/字段冻结 → S2接口与S3文档/基线互斥推进 → 协调者S4全量集成 → 独立安全复核 → 阶段2。单测定向先各自执行，跨文件/全量测试与构建由协调者串行，避免读到另一会话半成品。父会话创建用户可见实施会话；本协调任务不自行新增实施会话。

## S1冻结合同与S4交接

S1已只修改其三份文件并冻结；协调者已读取源码及实际红/绿测试输出，证据在 `.design-qa/2026-10-29-separation/task1-contract-evidence.json`。新增89项、domain全套195项通过，配套domain TypeScript通过；S4不在S2/S3写入期间重复全量运行。

- `publicConfigSchema` / `PublicConfig` 为前述6字段严格对象；`registrationEnabled=true`必须同时具备formalAuth、非null法律版本和非null验证码公开键。未声明字段、缺字段、mock模式、空白/控制字符均拒绝；不包含Supabase URL/key。
- `apiMetaSchema` / `ApiMeta` 固定v1 major、非负安全整数minor、唯一合法capability，backendRelease为受限标识。生产环境不得静默development由S2编码器强校验；schema本身不代表健康或收费许可。
- `frontendManifestSchema` / `FrontendManifest` 冻结 `assetNamespace/artifactId/sourceSHA/treeFingerprint`、`build:{toolchainFingerprint,lockfileSha256,publicConfigFingerprint}`、`fileIndex:{path:'.release/file-index.json',sha256,fileCount,totalBytes}`、`apiRequirements:{major,minMinor,capabilities}`及非空唯一 `verifiedBackendReleases`。
- 另导出 `frontendApiRequirementsSchema`、`frontendFileIndexSchema`与类型。索引为 `{schemaVersion:1,files:[{path,bytes,sha256}]}`，排除隐藏元数据，拒绝越界/Windows危险路径及大小写/Unicode规范化冲突。实际文件类型、摘要、字节与namespace绑定留制品校验器，不把纯schema当文件完整性证明。
- `checkFrontendCompatibility(manifestInput:unknown,metaInput:unknown)` 返回 `{compatible,issues}`，区分非法输入、major不符、minor过低、缺能力、后端组合未经验证；不回显原始非法值。所有严格对象额外拒绝own `__proto__`，补足Zod复制时跳过该键的行为。

S4依赖前置：S1首次裸pnpm测试触发默认脚本前依赖核验/自动安装，联网ENOTFOUND后已停止。当前包管理器安装状态时间早于已变更manifest/lock；pnpm 11.19.0本地实现默认 `verify-deps-before-run=install`，不能让普通验证命令隐式改共享依赖。协调者统一处理，S2/S3只能用已有本地二进制定向验证，禁止安装/清理/改锁或全量构建。

协调只读检查已确认39个直接依赖的实际package manifest/版本、types/bin目标均存在；lock中891个包版本有769个本机实际存在、122个列于pnpm显式skipped列表，无未解释缺项。另有288个旧锁之外的版本仍在虚拟store；因此 `Packages: -288` 输出不能单独证明当前所需包损坏。该检查只证明名称/版本存在，不证明所有传递链接、原生加载或全量测试可用；S4停笔后仍需实测。未重新安装、未更改registry/锁/持久配置；本机实际Node为v25.9.0/darwin/x64，不能冒充固定Linux24.19.0发布环境。

## 当前与后续门槛

Task0只读核对和文档/JSON一致性验证不替代应用测试。Task1完成需新增失败→通过证据、原定向回归、lint/typecheck/完整单元/预算/构建的实际结果；不重建E2E，不调用真实账号或付费模型做合同fixture。

首次旧服务无drain计数的交接、root维护禁写跨重启、业务pendingFinalizers、root封存防TOCTOU、固定Linux单入口构建/取回、真实旧构建协议、原生字体/内存峰值、真实精确回退均是后续上线硬门槛，未完成时禁止宣称生产切换可用；不为开始本地Task1连接生产。
