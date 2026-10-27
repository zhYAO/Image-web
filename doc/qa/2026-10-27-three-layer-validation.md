# 三层发布最终本地验证与生产交接

用户已取消10,000,000字节硬门槛，保留非阻断精确报告；不再追加瘦身范围。目标为阿里云 `www.zimage.store`，手动发布、不使用GitHub CI。**本报告及所有现有层包仍是QA，未上传/部署；生产公开配置、平台和真实HTTP验收尚待交接。**

## 代码与实际产物

应用及三层工具实现提交 `dcd0e787eedc83839388da9a030de87922700813`。应用源码、domain、锁文件和工作区配置与第二轮构建源 `50f221311cc5ff7b70ef8d693fc67f5b82f0adc4` 相同。QA build marker为 `qa-assets-10m-51cc0a9-20261027`，编译测试URL，不能改标识后当作生产。

第二次QA Webpack构建98.556秒成功，Node24.19.0/ABI137/Linux x64/glibc2.41，Next16.4.1、Sharp0.35.5，锁文件未改。未压缩文件按互斥路径计量：

| 内容 | 字节 | 占运行文件 |
| --- | ---: | ---: |
| 服务端业务构建 | 9,997,004 | 9.8587% |
| 前端全部JS/CSS等 | 14,679,012 | 14.4759% |
| 业务入口/配置 | 135,972 | 0.1341% |
| 运行依赖 | 32,873,294 | 32.4184% |
| 字体/许可/说明 | 33,444,454 | 32.9816% |
| public资源 | 10,273,530 | 10.1314% |
| **运行文件合计** | **101,403,266** | **100%** |

三层真正打包、装配后加入索引、完整release清单、软链接target字节：

| 发布层 | 未压缩字节 | MiB | 仅传输gzip字节 |
| --- | ---: | ---: | ---: |
| 业务（全部server/client＋必要metadata） | 24,955,607 | 23.7995 | 5,757,702 |
| 共享runtime（含索引、原软链接） | 33,180,123 | 31.6430 | 11,645,134 |
| 静态资源（含原manifest） | 43,753,251 | 41.7264 | 37,951,444 |
| **首装全部层及metadata** | **101,888,981** | **97.1689** | **55,838,637** |

传输合计还含各索引/release清单；后续只有依赖/资源完全相同时才能复用，不保证每次业务包固定大小。完整业务没有迁进runtime。未压缩业务仍超过10MB，但该硬门槛已按用户要求取消。前端14.68MB不是首屏网络量，首屏需按路由、预加载、缓存和图片优化单独采样。

初始当前版本155,934,878普通文件字节降到101,403,266，净减54,531,612（34.9708%）；资源外置没有计入这个净减。剩余Sharp/libvips、两完整中文字体、全部Shiki语言主题及必要框架均保留。详细模块归因、官方来源、优化选择与拒绝项见[完整审计](2026-10-27-dist-10mb-audit.md)。

## 真实装配、复用与回退

清单SHA256：`97b4261c55ebf684129b15f09cf2fc5892cd2059e03741a3ada5ae7d85e3b159`，资源版本 `e68a455dc6f5772f02711b87583162c146e441b099efdb1f0951b7f10a4323ef`。
三次装配分别为冷缓存、暖缓存、再次选择可信旧QA清单到新目录。后两次runtime/assets均报告reused:true，987个runtime文件32,873,294字节全部hardlink，0文件复制。原始pnpm/workspace软链接保留，public只通过工具生成的受控链接访问资产缓存。所有原始archive symlink在生成public后再次验证最终解析边界。

冷装配和回退新目录各132项HTTP/native检查通过。实际回退证据是**同一QA清单重新装配**；不同代码版本复用/回退、缺层/损坏/并发/EXDEV等由独立fixture覆盖，没有声称恢复过线上旧版8cbb。

逻辑文件和inode分别报告：应用＋两缓存对象普通文件逻辑134,314,993字节，去重inode后101,441,699字节，软链接target共2,595字节。这不包含store归档/索引及其他release，不是du磁盘分配量。启动后Next生成的可变图片缓存不算构建文件；应另配缓存容量和清理策略，不能重测后冒充原始dist。

## 自动化与独立审查

- Web最终完整119文件、887/887通过；Domain106/106（源码未变）。Lint/typecheck通过，构建自动生成next-env路径已恢复。
- 原分层28/28＋新三层20/20通过；真实消费额度保护5/5通过。原图精确排除、source map/NFT分离及Markdown profile均已有专项回归。
- 132项真实Next/HTTPS fixture/native检查包含95资源逐SHA/尺寸/MIME/CORS/cache、13客户端URL、旧本地与新远端Image优化器、两字体中文及JPEG/WebP/AVIF。未改图像参数或原件。
- 不信任CA、错误hostname被TLS拒绝；private DNS被Next400拒绝且无资源抓取。HTTPS正向fixture只在QA子进程受控映射DNS/transport，TLS证书正常验证，不是公网/Nginx上线证明。
- 资源原型独立审查关闭域名glob及umask问题；三层审查关闭public链接逃逸、输入并发尺寸变化、编译资源版本绑定，当前离线QA范围无Critical/Important问题；最新实际大包独立复核也确认三archive/index摘要、181份诊断排除、全部业务chunks归属、冷/暖缓存与987个hardlink正确。暖缓存逐文件校验，不重复解码已验证archive header的边界已明确。
- 两个认证API因假Supabase RPC仍503，不能算真实401通过。没有付费生图、真实认证全流程、浏览器或线上Nginx验收，不能据单测断言全功能生产已验收。

第二QA诊断集独立保留：111份source maps 32,740,766字节、70份NFT 2,563,095字节，共35,303,861字节。不是独立“测试依赖包”，QA构建也不是给测试使用的不同依赖集合。原maps/trace仍在本地保留，尚未上传Sentry，不能称线上符号化已通过；生产构建必须保留或独立归档对应版本的maps。

## 当前前20大普通文件（运行文件分母101,403,266）

| 路径 | 类别 | 字节 | 占比 |
| --- | --- | ---: | ---: |
| `node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.7` | dependencies | 18,699,288 | 18.441% |
| `apps/web/server/apparel/fonts/NotoSansCJKsc-Bold.otf` | fonts | 17,002,248 | 16.767% |
| `apps/web/server/apparel/fonts/NotoSansCJKsc-Regular.otf` | fonts | 16,437,364 | 16.210% |
| `apps/web/<QA-dist>/server/instrumentation.js` | server | 1,590,597 | 1.569% |
| `apps/web/<QA-dist>/server/chunks/9060.js` | server | 1,572,395 | 1.551% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/next-devtools/index.js` | dependencies | 885,783 | 0.874% |
| `apps/web/<QA-dist>/server/app/api/chat/route.js` | server | 854,943 | 0.843% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/@edge-runtime/primitives/load.js` | dependencies | 800,754 | 0.790% |
| `apps/web/<QA-dist>/static/chunks/17bb598f.925ed1a58965d6dd.js` | client | 790,458 | 0.780% |
| `apps/web/<QA-dist>/static/chunks/303.b6bdced587610895.js` | client | 789,937 | 0.779% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/next-server/app-page-experimental.runtime.prod.js` | dependencies | 717,160 | 0.707% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js` | dependencies | 717,001 | 0.707% |
| `apps/web/<QA-dist>/server/chunks/2987.js` | server | 716,638 | 0.707% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js` | dependencies | 705,797 | 0.696% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js` | dependencies | 705,639 | 0.696% |
| `apps/web/<QA-dist>/static/chunks/b831ff4e.5e0fd36f027307a0.js` | client | 622,747 | 0.614% |
| `apps/web/<QA-dist>/server/middleware.js` | server | 606,359 | 0.598% |
| `node_modules/.pnpm/next@16.4.1_@babel+core@7.29.7_supports-color@8.1.1__@opentelemetry+api@1.9.1_@playwrig_62fda4f6f940aae71de6a99f431a5a74/node_modules/next/dist/compiled/edge-runtime/index.js` | dependencies | 525,791 | 0.519% |
| `apps/web/<QA-dist>/static/chunks/f9c96c1e.50363fe0f2509f28.js` | client | 502,264 | 0.495% |
| `apps/web/public/commerce/templates/xhs-retro-womenswear-v1.webp` | public | 491,816 | 0.485% |

## 交接与待完成事项

生产变量/平台接口及手动顺序见[发布交接说明](../../ops/aliyun/MANUAL-THREE-LAYER-RELEASE.md)。现有工具明确 `productionReady:false`，只负责离线未激活装配；`--allow-sample`是显式原型使用确认，不是生产批准或允许上传QA。最终生产来源必须重新按正确公开配置和规范.next构建，另出新release ID、精确commit、层hash、trusted manifest，保留本QA不可改写。

[机器证据](2026-10-27-three-layer-validation.json)包含真实pack/冷装配/暖装配/回退、smoke限制和native符号。内部临时路径仅用于本云环境复核，不是用户下载链接。最终交付采用已批准的临时OSS→Windows校验→ECS；本任务未上传或调用生产服务。
