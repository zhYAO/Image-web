# 公共示例图片：自有 ECS 与单一配置

用户要求仅将已审阅的62张公开 JPEG/WebP 示例图置于自己的同站 ECS，以链接引用。白名单为 `ops/aliyun/public-images.json`，总计8,067,881个未压缩文件内容字节。不得迁移用户上传、私有图片、签名URL、字体或禁止发布的原图。新增示例也必须经过白名单、逐文件长度/SHA256、共同路径集和版本审阅，不自动外发用户图片。

## 唯一配置

只配置 `ZIMAGE_PUBLIC_IMAGE_BASE_URL`，包含受信 HTTPS 域名和完整版本路径。例如下面是**建议但尚未启用**的基址，当前不可作为可用生产地址：

`https://www.zimage.store/static-assets/6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24`

缺省保留本地/旧安全模式。新配置拒绝其他域名、端口、凭据、查询、片段、尾斜杠和非规范化路径，版本必须等于图片清单的规范 LF SHA256，不能用 Windows CRLF 原始字节生成另一版本。源代码只存62张图片相对路径；共同 helper 只追加一次 `/commerce/...`，拒绝重写未知路径、API、上传、私有URL和查询。

Vite 从该值生成内部 `__ZIMAGE_PUBLIC_IMAGE_BASE__`；Next 从该值生成同名 `process.env.ZIMAGE_PUBLIC_IMAGE_BASE_URL` 编译期常量。用户不需要配置这两个派生常量。**改这一处配置后需要重建 Vite 和 Next；只更新 ECS 的运行环境变量并不能改已编译静态文件。** Next `env` 会将值内联，不可承载秘密。

旧 `NEXT_PUBLIC_STATIC_ASSET_BASE_URL` 的通用 HTTPS/完整资源清单语义保持，其他静态资源不改为新图片命名空间。新值未设置时 Next 维持旧逻辑；两者同时非空且规范化后不同时报冲突，不静默覆盖。无需把同值配置两遍；旧完整资源模式必须另行协调迁移。

## 构建门槛与正式发布边界

普通带新配置的 Vite/Next 构建会逐一 GET 62 张固定同源 HTTPS URL，禁止重定向和认证，核验 HTTP200、JPEG/WebP MIME、精确长度/SHA256、nosniff、public/immutable长缓存；响应体和时间有界，任一失败停止构建。只复用本进程真实完成的校验，不信任自报持久化成功文件。

已有 `ZIMAGE_IMAGE_DELIVERY=external-preview` 仅作显式离线预览后备；可用 `assets.zimage.test` 合成映射，不能当作公网证据。预览通过同样的本地白名单/哈希检查，Vite 物理排除这62张副本，保留其他 public、许可和元数据。它仍记录 `.release/external-images.json` 的 `productionVerified:false`，不得删除该标记伪装可发布。

**正式发布尚未完成**：本地新增的普通 `public-image-contract.json` 已纳入 Python subject-only/pack/verify、文件索引和配置指纹，JS check-dist 使用相同62路径/哈希与拒绝规则，原有显式验收证据仍必须匹配。预览元数据继续不能正式发布。详见 [PUBLIC-IMAGE-CONTRACT.md](PUBLIC-IMAGE-CONTRACT.md)。服务器新版可信companion尚未安装，公网路由也未验收，因此本地协议通过不等于现网可发。

旧 Next schema1/2 资源协议保持。新增的本地schema3/public-images模式分别绑定图片专用版本与完整资源manifest，先验62张原文件再从暂存/资源包排除，pack/assemble拒绝混用和改名副本；字体、许可及原生门不删改。详见契约文档。生产消费方和workflow门仍未升级，不能宣称发布包已在真实Next/Linux验证。新的冻结构建仍受既有依赖阻挡。

## 已核实服务器证据

官方 ECS Cloud Assistant 只读核验：62张文件已存在于完整资源版本 `bfb3e444b4b032f43ba6d977c33ba72922eea253f34c7d7fe222cb820c4dd23b`，逐文件长度/SHA匹配；不需重新上传。服务 UID 的既有系统字体没有中文，这次没有修改字体或削弱字形门槛。

有效 Nginx 配置中的 `/static-assets/` 实际转发到现有应用，而不是静态 alias。建议图片版本 URL 的 ECS 本机严格TLS GET和上游同URI GET均404；普通 `/commerce/...` 示例图200且字节匹配，但依赖当前 release 的 public 指针，不能代替不可变路径。D1M外网请求连接重置，ECS外网请求超时；没有62张公网验收成功的证据。

精确路由审阅、配置前后摘要、最小写入与回滚步骤见 [PUBLIC-IMAGE-ROUTE-REVIEW.md](PUBLIC-IMAGE-ROUTE-REVIEW.md)。没有写入、上传、重载、重启、推送、Actions或部署。

## 只读工具

`ops/aliyun/public-image-hosting.py --verify-base <base> --output <仓库外报告>` 使用正常TLS逐张验收，任一失败停止；图片验收不等于应用/发布验收。

`--review-resource-directory /opt/zimage/layer-cache/assets/<已核版本> --output <仓库外报告>` 只生成62个精确 URL/源文件/SHA/MIME映射，不安装路由。资源版本与图片版本含义不同：前者含完整旧资源，后者只标识规范图片清单；禁止混用它们的hash或改动旧资源版本字节。
