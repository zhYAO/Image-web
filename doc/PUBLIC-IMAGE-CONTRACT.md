# 公开图片制品契约：本地协议准备

此协议不启用线上路由、不授予发布权限、不代替公网62图验收。唯一用户配置仍是 `ZIMAGE_PUBLIC_IMAGE_BASE_URL`，改变后必须重建 Vite 和 Next；不能只改 ECS 运行环境。

## 独立前端

普通外置构建在全部62张真实响应通过既有HTTPS/MIME/字节/SHA门槛后输出普通载荷文件 `public-image-contract.json`。文件只记录schema1、canonical base、规范LF图片版本及62个精确相对路径/长度/SHA/MIME，不记录“已批准”或自行签发验收成功。

Python subject-only/pack/verify 与 JS check-dist 使用同一固定版本、同一62路径。Python独立可信常量绑定原始LF清单SHA256，按固定字段重建该清单再比较，不能由上传包自行选择新白名单。JS从受审源码清单生成同一描述。未知路径、外站、查询、协议相对URL、字体/代码远端资源、版本/哈希混用、预览/正式元数据冲突和改名图片副本均拒绝。既有精确Cloudflare验证码脚本例外保留，不推广为任意CDN例外。

契约文件本身进入完整文件索引；公开配置指纹计算为 `SHA256(canonical({schemaVersion:2, publicConfig, publicImages}))`。原有artifactId继续绑定文件索引与配置指纹；原有候选源码/工具链/后端约束和显式验收证据均未删改。配置、契约或载荷任一改变都使旧验收证据失配。未外置的旧包仍使用原来的配置摘要、manifest schema1及artifactId算法，不补写新字段或改旧字节。

显式离线external-preview仍输出 `.release/external-images.json` 与 `productionVerified:false`，Python正式打包继续拒绝，不能把合成响应当公网证明。普通正式描述不等于生产已上线；本轮pack正例的验收报告是明示的测试fixture。

新版Python verifier需一起审阅并安装受信 `public-image-contract.py` companion，不能从制品导入代码。当前服务器助手没有被修改/安装，不能把本地通过当作现网可消费。旧包路径不需要新companion。

## 测试边界

本地合成文件覆盖旧包往返、新62图subject/CLI入口/pack/unpack/verify、共同JS/Python矩阵和配置验收绑定。普通Vite构建入口通过62张离线fixture响应后才生成正式描述，失败仍停止。

D1M Python3.14的Windows lstat/fstat ctime语义不一致，测试fixture在Windows显式使用共同birth identity隔离该差异；生产signature、读取/链接/文件变化保护未改。结果不是Linux并发文件系统、真实TLS或已部署Next运行证明。

## Next图片专用模式（本地schema3）

Next从同一个BASE派生 `ZIMAGE_PUBLIC_IMAGE_CONTRACT` 编译标记；不是第二个用户配置。标记、规范基址和唯一remotePattern必须相互匹配，旧配置冲突即停。普通未外置构建仍使用原schema2；外置构建明确选择分层schema3/public-images，不能走旧full入口，也不能用schema1/2伪装接受。

图片专用清单SHA标识独立HTTPS目录；资源 `assetsVersion` 仍是包含旧字体/许可等剩余资源的完整manifest字节摘要。新资源manifest显式携带同一个图片描述，两种身份分别绑定，不能互换。新增schema3配置指纹绑定六个受审配置源文件和完整图片描述；runtimeBinding、代码层索引及assemble的真实compiled config再分别核对，不能信任上传包或首次运行自报的新白名单。

暂存的standalone和public两条拷贝路径、资源包生成均先验证62张原文件长度/SHA再排除它们。三层pack/assemble再次按原路径及文件哈希拒绝复制或改名副本；其他public继续保留。字体四件套、资源schema1及原生字形/六次编解码门保持原样。旧schema1/2合成manifest与d3117ac原实现逐字节对照相等；不改历史根路径或retained字节。

本地新增8项JS契约/拷贝测试、6项schema3合成打包/旧协议对照测试通过，原20项portable层绑定测试通过。拷贝测试有意令原生门返回固定失败，只证明两条实际拷贝路径及失败即停；没有把mock当作Sharp成功。schema3测试模拟Linux元数据，未执行真实Linux assemble、Next启动或旧版实际回滚。

已有package-release整组测试45通过、6失败、18因平台限制跳过；失败涉及本机缺少 `sharp/package.json` 的既有原生fixture，没有安装或绕过。Next/SWC冻结依赖仍未具备，不重试已失败安装，不宣称真实Next构建或完整资源包已验证。

生产适配器、候选workflow及其原有schema/助手闭包门未改，当前仍会拒绝新协议或助手摘要失配。启用前需独立审阅Linux真实构建/assemble/native/lifecycle，以及受信companion和消费方版本协商/闭包升级；不能只把本地三层打包器复制上服务器。

## 当前服务器阶段

用户随后批准专用公开示例图目录的Nginx受控变更，但现有Edge官方云助手连接返回 `Debugger unattached`。未提交任何服务器命令，未创建目录、写配置、nginx-t或reload。建议前缀尚无公网全量验收，应用外置未激活。没有推送、Actions或部署。
