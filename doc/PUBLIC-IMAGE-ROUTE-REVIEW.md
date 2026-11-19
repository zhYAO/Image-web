# 62张公开图：待审批的最小路由变更

本文件仅为2026-11-19 D1M只读实查后的审阅方案，未执行服务器写入、nginx-t、reload、应用发布或上传。现有62图已匹配，无需重传。线上状态可能变化，实际执行前必须重查，任何漂移停止。

**后续修正**：用户已批准使用专用公开示例图目录，不直接开放release或资源缓存。本文件下方旧“从bfb缓存文件直接alias”的审阅件保留供追溯，不能按旧件执行。新本地方案固定到 `/opt/zimage/public-examples/6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24`，只复制62张核验图（不放清单、字体或其他文件），建议root:root、版本目录0555/图片0444、worker只读，无目录列表或符号链接。该目录存在性/当前权限尚未刷新核验。原版本HTTPS前缀不变，新include摘要见任务目录 `zimage-nginx-dedicated-images-review-20261119/review-status.json`。Edge官方云助手工具当前返回Debugger unattached，未提交预检命令或任何写入、nginx-t、reload。恢复正常通道后先刷新实例/全部配置摘要/源62图/目标父目录元数据，不能用旧证据代替新预检。原有应用、链接和回滚资源不改。

## 端到端证据

| 环节 | 实查结果 | 证据边界 |
| --- | --- | --- |
| 本地清单 | 62张JPEG/WebP，8,067,881字节，逐文件长度/SHA/MIME | 非用户图；LF版本下述6cec |
| ECS已安装资源 | /opt/zimage/layer-cache/assets/bfb3e444b4b032f43ba6d977c33ba72922eea253f34c7d7fe222cb820c4dd23b 内62张全匹配 | root拥有，非组/其他可写；非新上传 |
| Nginx读权限 | 实际worker UID/GID33、附属组33；只读子进程用同身份读取并哈希62图成功 | 不改账号权限；未证明未来GC保留 |
| 有效虚拟主机 | 实际加载的443 TLS server仅www.zimage.store，真实源文件/etc/nginx/sites-available/zimage.conf | 不是仓库模板推断 |
| 有效location | location ^~ /static-assets/ { proxy_pass http://127.0.0.1:3100; }，原文件第140行 | 没有新图片namespace静态映射；不以模板regex断言线上根因 |
| 建议版本GET | ECS本机真实Host/严格TLS404；应用上游同URI404 | 确证现有转发链没有该版本路径；不是版本hash错或少了图片 |
| 普通图片GET | /commerce/apparel-v2/main-1.webp 本机严格TLS200，MIME/长度/SHA匹配 | public指针依赖current release，缓存no-store；不能冒充不可变URL |
| 外网GET | D1M连接重置，ECS外网超时 | 未忽略TLS、未绕DNS/代理；没有全量公网验收 |
| URL构造 | 新全局BASE两端共用，62路径仅追加一次，拒绝重复prefix/查询/外站；规范LF版本 | 合成离线测试，不代表线上可访问 |
| Vite产物 | 未配置仍带62图；显式离线外置不带62图，其他public保留 | 原始实测报告单列，预览正式发布仍被拒绝 |
| Next产物 | 共同helper与编译常量已接线，旧完整资源契约未改 | 无新Next完整构建/物理排除证明，不能声称可发布 |
| 旧回滚 | 不改原public、current、旧URL、资源/字体/schema/助手 | 必须继续保留bfb资源目录，不能新增GC假设 |

只读调用证据：t-sh073k2cdqgtbls、t-sh073k2nl1u3r40、t-sh073k5b4ay6io0、t-sh073k5tbieuneo。这些是既有官方Cloud Assistant通道的有界查询，不是生产部署。

## 确认参数

- 唯一应用配置名：ZIMAGE_PUBLIC_IMAGE_BASE_URL。本轮不设置线上变量。
- 建议基址：https://www.zimage.store/static-assets/6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24
- 白名单示例：上述基址加 /commerce/apparel-v2/main-1.webp。
- 图片版本：清单规范LF SHA256 6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24；旧Windows CRLF预览版本未发布，不能沿用。
- 实际源目录固定为上表bfb版本字面路径，绝不绑定/opt/zimage/current；图片版本不同于含字体的完整资源版本。
- Nginx1.18.0，二进制/usr/sbin/nginx，主配置/etc/nginx/nginx.conf，当前主配置SHA256 4869cddce1030ceffb99bf88b1a64a0ec2b5d51c0c2377958f48533bae320522。
- vhost修改前SHA256 30140cabb433acc1ab86f9337e12459d73dba982b58e448ef034f3171ea9cc8b，8507字节、LF、root:root0644、无xattr。仅在原第140行前插入include后的预期SHA256 06dc42392dcaeb4aa880d94566808439d1d2a521c7c43941e3d585c3d52a148f，8637字节。保留sites-enabled符号链接。

## 最小配置方案（未安装）

现有http层实际按顺序加载mime.types、conf.d/*.conf、sites-enabled/*。新增一份http map文件，不改主配置；在已验证的目标TLS server内插入一条include。两个新增路径当前均不存在：

- /etc/nginx/conf.d/zimage-public-images-cache-6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24.conf
- /etc/nginx/sites-available/zimage-public-images-6cec0b9f8a13b1523e3d52c0e95947234fb81028ad91a46721071cb41cfb7e24.inc

包含62个location = 精确URL路径，各自alias到固定资源版本内唯一普通图片文件，不是整个目录alias。精确location优先于已有^~ /static-assets/。新版本根路径及未知子路径单独404，旧namespace/旧URL照旧。拒绝非www Host、非精确原始URI（含查询/编码变体）、非GET/HEAD；禁止目录列表、符号链接和类型推断，固定JPEG/WebP MIME。只映射公开图片，不映射字体、清单、用户文件。

现有server头为no-store、nosniff及RSC相关Vary。Nginx1.18不能用新版本header继承选项；新location显式保留nosniff/Vary，通过$status map仅对200/206/304设置public/max-age31536000/immutable，其他状态no-store，expires off避免继承额外缓存头。现有server维护限制及TLS配置保持，未改维护map或保护。

本地三份审阅文件及摘要位于任务目录zimage-nginx-image-review-20261119，只做本地结构核对，不是实际Nginx解析通过。官方规则：[location优先级](https://nginx.org/en/docs/http/ngx_http_core_module.html#location)、[add_header继承](https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header)。

## 后续需明确批准的动作与回滚

1. 再只读核对全部有效配置摘要/文件集合、目标server、metadata、两个新增文件不存在、62源文件与worker可读性，确认固定资源版本保留。漂移即停止。外网通道正常前不能承诺完成公网验收。
2. 经授权后独占创建vhost备份 /etc/nginx/sites-available/zimage.conf.before-public-images-6cec0b9f8a13-30140cabb433.bak（当前不存在，root0600），验证原摘要。仅独占新增上述两文件root0644，核对批准字节与摘要；原子替换真实vhost、保留metadata与enabled链接，不改目录/账号/ACL/网络。
3. 先/usr/sbin/nginx -t -c /etc/nginx/nginx.conf；失败则恢复原vhost、仅删除本次已知摘要新文件，不reload。成功才执行一次平滑reload。共享Nginx会更新worker，虽然只改此站配置，不能声称其他vhost完全没有进程层影响。无应用重启。
4. 正常公网严格TLS逐一GET62图核验200、MIME、长度/SHA和响应头，再HEAD及未知图片/字体/非白名单/查询/方法负例；分开本机TLS与公网证据。未全部通过不得切应用外置默认或宣告可用。
5. reload后失败时，只有当前vhost仍等于批准after摘要且新文件仍等于批准摘要才恢复；遇并发修改停止，不覆盖。恢复原vhost和本次新文件，旧配置nginx-t成功后条件性执行一次回滚reload。审批必须明确包含“正常一次reload，失败必要时一次回滚reload”，不能把回滚说成没有第二次reload。

响应不确定先只读核对，不盲重试。这里没有执行这些步骤；不包含应用激活、源码推送、CI、数据库、凭据或Sentry操作。路由上线也不替代两种正式制品契约后续协调。
