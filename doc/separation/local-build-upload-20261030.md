# 本地业务构建、隔离运行层与观察工具（2026-10-30 UTC）

## 版本和执行边界

最新状态：用户要求先保存提交并推送当前迁移分支，生产发布和依赖安装重试继续暂停。业务及可复用运维实现已保存于 `73c79955b78dc2015ccf4bce3543814ddfee6fca`；后续机器绑定的候选执行脚本仅保留在本地忽略目录，不作为可复用发布工具入库。下述实测更新不构成安装成功、生产验收或切换批准。

应用源固定为 `975f9e4c347fe0ee219abc5564cc53ea9cd0d749`，822 文件、22,295,204 字节，源码指纹 `e6a048d4d7180d2a30e624a29cf8e37b10075df355d94baeff14de4f9a1c8588`。运维实现提交73c只增运维工具、测试和文档，不改应用源码、锁文件、Next/Vite 配置、原三层 packager 或原 first-window。运维版本由真实 Git 提交与工具原始文件摘要单独确定；不把旧应用制品改标成运维提交，也不因单独 ops 变更重新构建应用。

云端此前已对同一975完成 F1/B1、subject、1560应用测试及原生/组装检查；这些云端证据继续保留。用户随后选择本地构建并上传阿里云，因而不再依赖云端制品出口。云官方导出曾在准备/写入前遇 CONNECT403，无 Library ID，没有重试或绕代理。下述 Mac 字节有独立身份，不能与云包摘要混用。

## 真实 Mac 构建与业务导出

从已验证的精确975源码包在全新目录提取；没有复制工作区的 node_modules、伪造 Git 提交或读取服务端秘密。Node24.19.0 / ABI137 / Darwin x64、pnpm11.19.0 已核。初次隔离安装遗漏独立 metadata cache，pnpm11 的安全元数据复核访问官方 registry 时失败并被中止；记录保留。补入原官方 metadata，正常审批后完成 frozen 安装：包内容下载0、锁及822源码原字节未变，保留默认1440分钟发布年龄策略，没有关闭检查或替换 registry。

真实 Next webpack 生产构建119.838秒、exit0；BUILD_ID与业务标记为975。standalone 的1832个普通文件、46个内部相对链接已审计；75份标准服务/app/middleware NFT 的23,881引用闭合。另一个非标准 minimal-server NFT 有1缺项，原结果保留，不把所有 NFT 根写成全闭合。候选内 Sharp 的 JPEG/WebP/AVIF 在 Mac 原生探针通过；这是 Darwin 证据。Next 默认不复制 public/static，字体亦需外部绑定，因此原始 standalone 不是完整可分发 Linux 包。

`ops/aliyun/business-transfer.py` 仅有 `export/verify`。它绑定精确源码清单、最终构建回执、standalone/static指纹和原字节配置，只导出严格业务文件；全部 node_modules、native、NFT、诊断与独立public/fonts不进入业务载荷。验证对原始 USTAR 头、完整成员/大小/hash、padding/双零结尾和 JSON/路径作保守检查，拒绝 GNU/PAX 隐藏数据、链接、额外条目与原生二进制。独立审查发现的原始source图误拒、构建后输出未绑回执、透明tar元数据漏洞均先复现再修复。

最终本地业务候选b：667文件、20,629,485原始字节、4,498,424压缩字节；归档SHA256 `094e1da1931de5648c447185bba3555c5b615be11260c497276c757e4d81aed8`，候选清单SHA256 `04522c26f49950d983c8d08a0daaa94673b2745e91c9bf4ad6f556cd8b32c142`。最终构建回执SHA256 `714616552b58c276b3c009f43f55165693bd379c1cbe1ab4901aca2ac7830d68`。旧候选a保留为未最终复核记录。b的真实CLI离线验证、18单测及独立8项攻击样例通过；`linuxRunnable:false`、`productionReady:false`。

## 阿里云候选路径与运行层缺口

前端使用既有 Mac clean975 dist，独立ZIP 9,959,007字节，SHA256 `eb218f26015e9cd47273de1e585a3c27ebbb76a01661898dac709b08fd9219f5`。用户明确授权后，经原固定SSH别名一次上传至新 `/tmp/zimage-local-candidates-975-20261030-a`；远端338成员、逐文件SHA/CRC及精确集合验证通过，SCP/postcheck均0。未解压、未正式pack、未发布；原current、previous、PID399199和启动/重启元数据前后一致。ZIP没有version、正式manifest或验收receipt，内部candidate不能被HTTP发布。

可信工具链核验已纠正早期路径混淆：旧服务使用的工具链路径不能作为候选的 root 信任依据；独立的 `/opt/zimage/trusted-toolchain/` 路径已通过所有权、模式、原始摘要及实际版本检查，Node24.19.0、ABI137、N-API10、Linux x64、glibc2.35匹配。未改变旧工具链权限。此结论只证明 Node 工具链，旧两版的lock/config仍与975不同，不能直接重标成新运行层。

后端七件输入共50,145,697字节，已获明确授权上传至独立候选目录并逐件校验通过；仅上传和准备候选，没有覆盖在线目录。用户批准的运行依赖准备累计预算为900秒、RAM256MiB、swap128MiB、CPU为半个核心；不在服务器运行Next build，不改registry、包发布年龄或完整性策略，不关闭optional包。

累计三次候选准备均已退出并确认无候选后代残留。首次bootstrap失败，隔离环境未继承既有代理；仅传递既有标准代理配置后，pnpm11.19.0的官方TLS/SRI bootstrap及版本检查通过，未新增地址、凭据或系统设置。原失败未捕获具体传输异常，不能补写为已确认的超时类型。第二次安装触发严格实际内存守卫而停止；第三次降低Node堆需求并设置提前回收阈值，采样内存未越256MiB、OOM与swap均为0，但安装仍达到截止时间。没有成功安装回执、canonical standalone、原生字体或原Linux packager通过结果，不把Mac业务候选称为Linux可运行包。

第二次外层`UNIT_PROPERTIES`未保存初始失败属性，不能断言具体字段或仅为格式误差；事后选定配置均正确，第三次启动观测也全部通过。一次性脚本的本地修复保留固定窗口内启动等待、失败属性记录、代理值不进入argv/持久配置、安装原始输出不落盘及中断清理。最终本地73项针对性测试和独立复核通过，只覆盖该执行方案，不替代真实依赖安装或发布验收。

暂停时按保守账本累计761.027165秒，剩余138.972835秒；完整控制开销及未完整计时的只读步骤按上界计入，worker/子阶段不重复累加。预算没有重置，第四次未启动，缓存恢复方案未实施。后续须先审阅剩余预算及最小恢复方案；增加资源或时间需要新的授权。安装成功后仍须原Linux包/ELF、workspace链接、完整资源闭包、原生探针及真实组合验收，不能手写成功回执替代。

## 独立纯观察/取消工具

`ops/aliyun/backend/{observer.py,ingress-observe.py}` 为独立两文件闭包，仅 `observe/cancel/status`，不导入旧控制器，不含stop/start/reload/部署/DB/网络或发信号能力。未来批准后安装位置固定 `/usr/local/libexec/zimage-observer`，不是旧backend目录。用既有deploy.lock、持久单journal、原OPEN准确字节、no-replace marker、PID/start/boot/current及helper/config摘要绑定；策略与真实A阶段loaded-generation/六入口回执分离。

五项实证P1已修复并独立复验：漂移误报关闭、配置闭包遗漏、预算耗尽后封口、已存在OPEN的持久屏障、未认证pycache执行。59工具测试、完整backend144通过；独立安全审查59通过、冻结hash稳定。原handoff23、ingress9、split9在已有Python3.12通过；低于要求的Python3.9平台fixture失败及一次错误的isolated模块路径调用保留，不改测试或门槛。

正常到期/捕获信号会尝试取消；普通异常保守needs_attention，新SSH显式cancel。BUSY不代表取消，300秒不是故障恢复上界；每轮最多等待1秒、单snapshot检查3秒预算，不保证硬实时采样。没有生成completion，也不推导当前危险continuation已结束。固定五配置图以外的include/glob/变量均拒绝；生产实际配置、旧worker退出、六入口、真实Nginx行为和当前危险mutation边界仍须独立证据。具体手顺见[OBSERVER.md](../../ops/aliyun/backend/OBSERVER.md)。本轮未安装或运行该工具，未维护、stop、切换生产。

## 解锁后浏览器结果

Terra正常inventory恢复，新nonce夹具有限HTTP96/96通过；新Edge tab里有唯一草稿且创建图片开启。参考图语义点击未出picker，选中新QA tab后原生点击返回 `-10005:noWindowsAvailable`，reference=0；未提交/生成，没有注入FileList或focus事件。未切F1，真实focus与引用连续性仍未验证，不能继续泛称锁屏。自有夹具PID57462已SIGTERM、exec0、PID不存在/4196拒绝；新QA标签随后不在清单，旧B0标签保留。UI和Linux真实组合验收仍待完成。

后续一次独立只读inventory明确报告Mac已锁定、原生应用列表为空，旧B0标签仍通过浏览器扩展可见。该新结果不倒推前次`noWindowsAvailable`的原因，也不证明文件选择或真实focus通过；未操作旧页或绕过锁屏。生产门禁安装、维护、排空和切换均继续暂停。
