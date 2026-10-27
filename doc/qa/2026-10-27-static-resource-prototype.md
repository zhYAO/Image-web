# 静态资源分离原型与候选包验证

仅在隔离云分支实现和验证，未上传、部署、修改 Nginx 或生产。线上 `8cbb` 不由本任务改动。
所有体积均为普通文件逻辑字节，不是 gzip/XZ，不跟随软链接重复计量。用户现已取消10,000,000字节硬门槛；历史目标数据保留。[最终三层实装与测试](2026-10-27-three-layer-validation.md)为本轮最新状态。

## 第二轮最新实测：资源配置已构建验证

第二次明确批准的webpack QA构建98.556秒成功，锁文件未改。编译的是本地TLS测试域，不是生产www；仍不可直接上线。

| 类别 | 字节 | 占完整运行文件 |
| --- | ---: | ---: |
| 服务端 | 9,997,004 | 9.8587% |
| 前端 | 14,679,012 | 14.4759% |
| 入口/配置 | 135,972 | 0.1341% |
| 运行依赖 | 32,873,294 | 32.4184% |
| 字体/许可 | 33,444,454 | 32.9816% |
| public资源 | 10,273,530 | 10.1314% |
| **完整文件** | **101,403,266** | **100%** |

业务文件24,811,988字节（尚未加新三层code索引/release清单），比10MB多14,811,988。
独立资源含manifest后43,753,251，代码＋runtime为57,685,282，合计101,438,533字节。
这是把资源单独计入后的总量，不是净减少43MB。三层精确metadata预算及装配结果继续单独记录。

实际外置组装不复制public/font文件，仅生成受控public链接指向已验证的公开资源版本，保留旧/commerce路径及内部Image优化器。
该资源层只含公开图片/字体/许可，没有私有Storage。132项检查通过：95个HTTPS文件逐条SHA/MIME/CORS/cache，
真实Sharp/CJK/codec、13个客户端静态URL、旧本地与新HTTPS图片优化器、非允许域名拒绝。
测试CA不信任与hostname错配均被TLS拒绝；private DNS被Next400拒绝，未发生资源抓取。
HTTPS正向流程只在QA子进程注入模拟DNS/transport，并真实验证TLS证书，不能代替真实公网DNS/Nginx或浏览器验收。
两个认证API占位RPC仍503，继续明确未验证。

## 第一轮已验证的内容和占比

第一轮 Next16.4.1 / Sharp0.35.5 webpack 候选完成构建及真实本地启动，原始文件如下。
这份 QA 使用占位后端配置，不能冒充原正式 artifact12645402037。

| 内容 | 字节 | 占完整运行文件 |
| --- | ---: | ---: |
| 服务端输出 | 9,971,306 | 9.8361% |
| 前端 JS/CSS 等 | 14,676,931 | 14.4779% |
| 应用入口与配置 | 135,511 | 0.1337% |
| 运行依赖 | 32,873,294 | 32.4274% |
| 中文字体、许可、说明 | 33,444,454 | 32.9908% |
| public 图片及来源清单 | 10,273,530 | 10.1342% |
| **完整运行文件** | **101,375,026** | **100%** |

业务构建含前端和服务端共24,783,748字节。服务端单项已低于10MB，整体仍超14,783,748字节。
服务端由24,300,973减少58.97%；完整运行由155,934,878减少34.99%。
“业务构建”是发布层口径，包含编译进来的框架和第三方代码，不全是手写业务源码。

没有独立的“测试依赖包”。该次可归档诊断集为36,458,846字节：source maps32,775,402，
NFT清单2,558,953，8份JSON报告957,611，7份日志166,880。它们不在运行包中；
约1.89GB构建缓存也不进入运行包。首屏实际网络量另受路由、懒加载、缓存及优化器影响，
没有把完整客户端文件总量当作首屏下载量。第二轮资源配置构建的数据单独记录，不能混入这一时点。

完整目录分类、前20大文件和生成 webpack factory 模块见
[10MB分析报告](2026-10-27-dist-10mb-audit.md)及[测量记录](2026-10-27-dist-10mb-analysis.json)。

## 运行依赖为何大，服务端为何能减

生产 standalone 固定 `isDev:false`，但静态 NFT 看见条件分支中的开发依赖：

```text
start-server → router-server → setup-dev-bundler → hot-reloader-webpack → webpack-config
next.js → next-dev-server（另一条 options.dev 分支）
```

下游经 ReactRefresh/webpack 默认压缩插件引入可选 esbuild；构建字体 loader 引入 capsize
fallback metrics；Babel loader 引入编译器。只在 `next-server` 追踪中排除两个已核实的开发入口，
实际少了2157文件、36,797,636字节；保留依赖全部摘要不变。不是盲删整个 Next build 或 node_modules。

剩余依赖32,873,294字节中，libvips相关18,700,223（56.89%），Next11,559,339（35.16%），
ReactDOM1,312,879（3.99%），Sharp wrapper450,587、native415,112及其余必要模块。
libvips实际加载并用于图片优化、导出和中文字形渲染，不能直接删除。

服务端原本不执行 Shiki，hooks已有 `typeof window` 守卫和安全代码文本回退；
候选只给SSR保留完整语言/主题元数据，清除未运行的grammar/theme/WASM副本。
同时清理唯一Markdown入口本来就关闭的Mermaid/HTML预览、LaTeX、alerts等分支。
客户端全部260grammar精确哈希、65theme和WASM保持；没有删语言或改引擎。

## 资源方案：页面用HTTPS，Sharp用共享本地文件

浏览器使用 `/srv/...` 之类服务器磁盘绝对路径无法取得资源。页面使用稳定的
`https://www.zimage.store/static-assets/<manifestSHA>/commerce/...`；
Sharp 的 `fontfile` 继续使用本机共享目录的绝对路径，不在每次渲染时下载字体。

当前项目未使用 `next/font` 或自定义 `@font-face`；两款完整CJK OTF用于Sharp/Pango，
并非每次打开网页都下载33MB字体。因此没有把它们改成浏览器字体、裁剪字形、改变字重或fallback metrics。
如果未来增加网页字体，需单独处理fonts.css、相对URL、CSS变量/字重/metrics及跨域字体CORS。

新增的原型边界：

- `publicAssetUrl()`仅将规范 `/commerce/...` 公开示例/品牌资源映射到配置的不可变HTTPS版本。
  缺配置保留原本地URL；私有Storage、签名URL、API、blob/data URL均不改写。
  公共示例/模板getter以及直接图片调用和原始JPEG预览均已接入，现有宽高/fill/画质参数不变。
- `NEXT_PUBLIC_STATIC_ASSET_BASE_URL`严格要求HTTPS、精确DNS主机及64位摘要目录；拒绝
  credentials/query/fragment、`*`与`**`主机名，避免把Next `remotePatterns`放宽成通配域名。
  图片优化器继续工作，不设置全局unoptimized，不开启 `dangerouslyAllowLocalIP`。
- `resolveApparelFont()`在未配置时保留原本地两路径；共享模式要求字体目录和清单SHA成对，
  校验manifest实际字节、版本路径、两款固定字体摘要及LICENSE。缺层、错版、篡改明确报错，
  不静默改用系统字体；成功校验按inode/size/mtime/ctime缓存，避免每个字重复读33MB。
- 正常发布打包器仍默认生成完整自包含包。单独资源包及后续外置组装是默认关闭的原型，
  未擅自修改现有生产helper/CI协议，也未声称当前线上已移走图片或字体。

## 清单、实包与真实总量

原型打包器：`node ops/aliyun/package-static-assets.mjs --project REPO --output NEW_DIRECTORY`。
输出拒绝已有目录/覆盖、输入输出重叠和symlink来源；暂存全写、逐文件摘要复核后同父rename发布。
协作锁只协调该CLI，不承诺恶意非协作进程竞态安全。原件及5张原始PNG均保留。

版本号为实际 `asset-manifest.json` 字节SHA256：
`e68a455dc6f5772f02711b87583162c146e441b099efdb1f0951b7f10a4323ef`。
清单含95条（91 public、4字体/许可），85图的宽高/alpha/orientation、MIME、字节、摘要和来源引用。
当前没有静态import blur占位，因此 `blurDataURL:null`，没有伪造或删除原有占位信息。
图像只读取metadata、不旋转/缩放/重编码；字体LICENSE和README一起保存。

| 资源实包内容 | 字节 |
| --- | ---: |
| public原字节 | 10,273,530 |
| 字体/许可/说明原字节 | 33,444,454 |
| manifest | 35,267 |
| **资源集总计** | **43,753,251** |

显式umask0077子进程下复核11目录全部0755，96文件（含manifest）全部0644；
旧实包/源权限和字节均未改变。不会让应用或Nginx其他UID因新包默认0600而无法读取。
95个文件逐条与源相同。[原始清单](2026-10-27-static-assets-manifest.json)、
[原型证据](2026-10-27-static-resource-results.json)。

按第一轮已验证构建分层：代码24,783,748＋共享runtime32,873,294＋资源43,753,251
＝101,410,293字节，多出的35,267就是清单。分离减少重复发布/上传，不能被算成完整dist变小。
第二轮源配置变化后的实际结果将另列，不承诺重建仍是同一字节数。

## 开发、Next Image与部署/回滚

默认开发不配资源base，继续使用仓库public和本地字体，断外网也能展示。需要远端模式时显式配置
上述HTTPS摘要URL；不要通过忽略TLS、关闭图像优化或放开内网IP来绕过失败。
`NEXT_PUBLIC_`在编译时内联，切换资源版本需相应构建；它不是启动时随意改写的动态值。

推荐的发布绑定（仅配置示例，未执行）：

```text
NEXT_PUBLIC_STATIC_ASSET_BASE_URL=https://www.zimage.store/static-assets/<SHA>
ZIMAGE_SHARED_FONT_DIR=/srv/zimage-static-assets/<SHA>/fonts
ZIMAGE_STATIC_ASSET_SHA256=<SHA>
```

先把完整资源校验后原子发布到独立只读版本目录，再允许应用切换；不覆盖任何已存在hash目录。
启动前检查字体manifest、HTTPS每文件摘要/MIME、真实优化器和权限，失败阻断新版本切换。
保留旧应用、旧manifest、旧资源和独立备份；回滚同时使用旧应用编译URL与旧字体环境，不使用latest。
并发发布用各自hash目录，不能提前清理仍被任何保留release引用的资源。

提供的Nginx仅模板，尚未执行 `nginx -t` 或reload。它限hash路径，禁止目录索引和symlink，
设置字体/图片MIME、nosniff、GET/HEAD/OPTIONS、成功响应一年immutable及CORS/Vary。
私有Storage和上传目录永不放入alias。跨域开发/Canvas/fetch需CORS，生产同域直接展示不另需宽泛CORS。
不加credentials或任意origin。CSP部署时需确认允许确切资源源站，不无条件放宽策略。

本机Next Image优化器的内部请求不会自动经过外部Nginx alias。原型用绝对HTTPS URL和精确
remotePatterns走外部获取；还必须验证服务器自己能经正常TLS/DNS访问资源域名。
本地HTTPS fixture只模拟资产服务，并使用独立CA和hostname校验证书；受控DNS/transport注入
仅在QA子进程，不能替代真实公网连通性/SSRF/Nginx验证。生产选项保持原样。

## 测试与尚未通过的边界

资源URL19项、字体resolver27项、原渲染器8项、实际资源包共享字体8项、相关界面26项、
资源打包和既有发布15项均通过；真实Regular/Bold中文Sharp PNG字节与原字体相同。
lint/typecheck通过。独立审查发现并修复主机glob和umask权限两项P2；迁移遗漏的JPEG大图和getter已补齐。

第二次构建为明确批准的资源配置验证，已在98.556秒完成，不反复尝试架构。真实HTTPS/Nginx、
生产权限、CORS/缓存、全认证和付费生图/导出仍需独立授权及真实环境证据。
没有把模拟的200、占位RPC的503或普通文件摘要相同当作全功能生产验收。

## 官方资料

- [Next Image](https://nextjs.org/docs/app/api-reference/components/image)：精确remotePatterns与外部资源优化；
  本地16.4.1 `image-optimizer.js`核实了外部DNS检查和内部handleRequest路径。
- [Next output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)：standalone追踪及复制边界。
- [Nginx alias](https://nginx.org/en/docs/http/ngx_http_core_module.html#alias)：regex location的alias需正确使用captures。
- [CSS字体获取](https://www.w3.org/TR/css-fonts-4/#font-fetching-requirements)：网页字体的跨域获取要求；
  当前Sharp本地字体不走浏览器CSS字体下载。
