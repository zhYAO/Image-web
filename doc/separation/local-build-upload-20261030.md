# 本地业务构建、隔离运行层与观察工具（2026-10-30 UTC）

## 版本和执行边界

应用源固定为 `975f9e4c347fe0ee219abc5564cc53ea9cd0d749`，822 文件、22,295,204 字节，源码指纹 `e6a048d4d7180d2a30e624a29cf8e37b10075df355d94baeff14de4f9a1c8588`。本次提交只增运维工具、测试和文档，不改应用源码、锁文件、Next/Vite 配置、原三层 packager 或原 first-window。运维版本由本次真实 Git 提交与工具原始文件摘要单独确定；不把旧应用制品改标成运维提交，也不因单独 ops 变更重新构建应用。

云端此前已对同一975完成 F1/B1、subject、1560应用测试及原生/组装检查；这些云端证据继续保留。用户随后选择本地构建并上传阿里云，因而不再依赖云端制品出口。云官方导出曾在准备/写入前遇 CONNECT403，无 Library ID，没有重试或绕代理。下述 Mac 字节有独立身份，不能与云包摘要混用。

## 真实 Mac 构建与业务导出

从已验证的精确975源码包在全新目录提取；没有复制工作区的 node_modules、伪造 Git 提交或读取服务端秘密。Node24.19.0 / ABI137 / Darwin x64、pnpm11.19.0 已核。初次隔离安装遗漏独立 metadata cache，pnpm11 的安全元数据复核访问官方 registry 时失败并被中止；记录保留。补入原官方 metadata，正常审批后完成 frozen 安装：包内容下载0、锁及822源码原字节未变，保留默认1440分钟发布年龄策略，没有关闭检查或替换 registry。

真实 Next webpack 生产构建119.838秒、exit0；BUILD_ID与业务标记为975。standalone 的1832个普通文件、46个内部相对链接已审计；75份标准服务/app/middleware NFT 的23,881引用闭合。另一个非标准 minimal-server NFT 有1缺项，原结果保留，不把所有 NFT 根写成全闭合。候选内 Sharp 的 JPEG/WebP/AVIF 在 Mac 原生探针通过；这是 Darwin 证据。Next 默认不复制 public/static，字体亦需外部绑定，因此原始 standalone 不是完整可分发 Linux 包。

`ops/aliyun/business-transfer.py` 仅有 `export/verify`。它绑定精确源码清单、最终构建回执、standalone/static指纹和原字节配置，只导出严格业务文件；全部 node_modules、native、NFT、诊断与独立public/fonts不进入业务载荷。验证对原始 USTAR 头、完整成员/大小/hash、padding/双零结尾和 JSON/路径作保守检查，拒绝 GNU/PAX 隐藏数据、链接、额外条目与原生二进制。独立审查发现的原始source图误拒、构建后输出未绑回执、透明tar元数据漏洞均先复现再修复。

最终本地业务候选b：667文件、20,629,485原始字节、4,498,424压缩字节；归档SHA256 `094e1da1931de5648c447185bba3555c5b615be11260c497276c757e4d81aed8`，候选清单SHA256 `04522c26f49950d983c8d08a0daaa94673b2745e91c9bf4ad6f556cd8b32c142`。最终构建回执SHA256 `714616552b58c276b3c009f43f55165693bd379c1cbe1ab4901aca2ac7830d68`。旧候选a保留为未最终复核记录。b的真实CLI离线验证、18单测及独立8项攻击样例通过；`linuxRunnable:false`、`productionReady:false`。

## 阿里云候选路径与运行层缺口

前端使用既有 Mac clean975 dist，独立ZIP 9,959,007字节，SHA256 `eb218f26015e9cd47273de1e585a3c27ebbb76a01661898dac709b08fd9219f5`。用户明确授权后，经原固定SSH别名一次上传至新 `/tmp/zimage-local-candidates-975-20261030-a`；远端338成员、逐文件SHA/CRC及精确集合验证通过，SCP/postcheck均0。未解压、未正式pack、未发布；原current、previous、PID399199和启动/重启元数据前后一致。ZIP没有version、正式manifest或验收receipt，内部candidate不能被HTTP发布。

只读现场观测：current仍9c5、previous仍8cbb，glibc2.35，Next16.4.1、Sharp0.35.5、libvips1.3.4、React19.2.7；当时可用内存621592kB、磁盘13,415,034,880字节。目录名为Node24.19并不足以证明受信运行层；现有 `/opt/zimage/toolchain/...` 没通过root路径信任检查，版本探针在执行前停止，未更改权限。旧两版的lock/config绑定也与975不同，不能直接重标复用。

推荐下一步在全新候选目录按975 frozen锁准备Linux生产依赖，保留optional包、受限并发/内存与原安全策略；不在服务器运行 Next build。经真实安装回执、Linux Node/ABI/glibc/包/ELF、workspace链接与资源闭包核验后，才装配canonical standalone，并调用未修改的原Linux packager。现无assembler/安装成功/原packager实测回执，不把导出候选当Linux包。实际安装、峰值资源、原生字体与真实组合验收尚未完成；不能用手写JSON替代这些证据。

## 独立纯观察/取消工具

`ops/aliyun/backend/{observer.py,ingress-observe.py}` 为独立两文件闭包，仅 `observe/cancel/status`，不导入旧控制器，不含stop/start/reload/部署/DB/网络或发信号能力。未来批准后安装位置固定 `/usr/local/libexec/zimage-observer`，不是旧backend目录。用既有deploy.lock、持久单journal、原OPEN准确字节、no-replace marker、PID/start/boot/current及helper/config摘要绑定；策略与真实A阶段loaded-generation/六入口回执分离。

五项实证P1已修复并独立复验：漂移误报关闭、配置闭包遗漏、预算耗尽后封口、已存在OPEN的持久屏障、未认证pycache执行。59工具测试、完整backend144通过；独立安全审查59通过、冻结hash稳定。原handoff23、ingress9、split9在已有Python3.12通过；低于要求的Python3.9平台fixture失败及一次错误的isolated模块路径调用保留，不改测试或门槛。

正常到期/捕获信号会尝试取消；普通异常保守needs_attention，新SSH显式cancel。BUSY不代表取消，300秒不是故障恢复上界；每轮最多等待1秒、单snapshot检查3秒预算，不保证硬实时采样。没有生成completion，也不推导当前危险continuation已结束。固定五配置图以外的include/glob/变量均拒绝；生产实际配置、旧worker退出、六入口、真实Nginx行为和当前危险mutation边界仍须独立证据。具体手顺见[OBSERVER.md](../../ops/aliyun/backend/OBSERVER.md)。本轮未安装或运行该工具，未维护、stop、切换生产。

## 解锁后浏览器结果

Terra正常inventory恢复，新nonce夹具有限HTTP96/96通过；新Edge tab里有唯一草稿且创建图片开启。参考图语义点击未出picker，选中新QA tab后原生点击返回 `-10005:noWindowsAvailable`，reference=0；未提交/生成，没有注入FileList或focus事件。未切F1，真实focus与引用连续性仍未验证，不能继续泛称锁屏。自有夹具PID57462已SIGTERM、exec0、PID不存在/4196拒绝；新QA标签随后不在清单，旧B0标签保留。UI和Linux真实组合验收仍待完成。
