# 独立前端制品与原子发布

这些工具已实现本地封包和受控目录发布；**本轮未安装 helper、未连接生产、未执行 root/SSH、未修改 Nginx/systemd**。真实 Cookie/账号、旧 Next 标签页、生产入口和 Windows 验收仍是独立门禁。测试生成的 backend ID、报告摘要和 approval 都只属于 fixture，不能用于上线。

本目录只使用 Node/Python 标准库。服务器无需安装前端依赖；发布和回退不运行 Node、构建、上传脚本、包管理器、systemd 或数据库命令。发布保留所有旧目录，不包含 GC。

## 本地打包

只从普通用户运行，Node 固定 `24.19.0`、pnpm 声明固定 `11.19.0`、Python `3.9+`。不要求服务器 ABI/glibc 与本地相同。发布封包要求实际 Git 源码干净（含未跟踪文件），SHA/tree/lock 与显式输入一致；不会清理当前工作区。

```text
node ops/aliyun/frontend/package.mjs --dist apps/frontend/dist --output /absolute/path/frontend.tgz --options /absolute/path/options.json --public-config /absolute/path/public-config.json --evidence /absolute/path/acceptance.json --project /absolute/path/clean-project
```

`packageFrontend(argv)` 也可由统一 CLI 调用。只返回一个 JSON，包含 `archive`、`archiveSha256`、`manifestSha256`、`assetNamespace`、`artifactId`、文件/字节数和三个 sidecar 路径：`manifestPath`、`approvalRequestPath`、`resultPath`。任何现存目标都会拒绝，原 dist 不修改。打出的 USTAR gzip 包会独立解包复验后再返回成功。包/sidecar 失败残留不会自动作为成功结果使用，应先检查，再选择新的输出名。

`options.json` 严格只有以下字段：

```json
{
  "assetNamespace": "<构建前固定的唯一ID>",
  "sourceSHA": "<真实40位Git SHA>",
  "treeFingerprint": "<sha256(git ls-tree -r --full-tree HEAD原始stdout)>",
  "build": {
    "toolchainFingerprint": "<下述canonical toolchain JSON的SHA256>",
    "lockfileSha256": "<实际pnpm-lock.yaml的SHA256>"
  },
  "apiRequirements": {"major": 1, "minMinor": 0, "capabilities": []},
  "verifiedBackendReleases": ["<真实组合验收通过的后端ID>"]
}
```

Canonical JSON 是 UTF-8、键排序、无多余空格、末尾一个 LF；toolchain JSON 为 `{"node":"24.19.0","packageManager":"pnpm@11.19.0"}` 加 LF。完整最终 manifest 与 domain 的 `frontendManifestSchema` 对齐。

`public-config.json` 必须严格符合 domain 的公开配置契约，只有 `schemaVersion/formalAuth/dataMode/captchaSiteKey/approvedLegalVersion/registrationEnabled`；不接受任意 VITE/NEXT_PUBLIC 环境透传。注册缺必需批准配置仍关闭。该文件只参与摘要，不原样复制到包。

首轮静态发布另有功能准入条件：正式 pack 与激活时读取的后端公开配置都必须为 `formalAuth=true`、`dataMode=http`。当前静态私有页面只支持这条认证 bootstrap 流程，已知不能使用的匿名/legacy 组合会在公开 namespace 映射和 current 切换前拒绝。通用 domain/public-config 契约仍可表达 false 模式，subject-only 也可检查此类 QA 候选；这不授权正式静态发布。既有 Next legacy 路径保留，不由发布工具删除或自动改数据库/配置。真实生产是否满足该模式须由授权环境的实际证据确认，fixture 不代替实证。

## 候选构建不能自行成为已验收版本

构建必须包含唯一内部输入 `.release/candidate.json`：

```json
{
  "schemaVersion": 1,
  "namespace": "<ID>",
  "apiRequirements": {"major":1,"minMinor":0,"capabilities":[]},
  "allowedBackendReleases": ["<候选后端ID>"],
  "sourceIdentity": {"sourceSHA":"<真实SHA40>","treeFingerprint":"<真实tree SHA256>","lockfileSha256":"<真实lock SHA256>","dirty":false},
  "buildToolchainFingerprint": "<真实构建Node+pnpm声明canonical SHA256>"
}
```

`allowedBackendReleases` 只是允许测试的候选集合。Vite 在构建开始与写 candidate 前复核真实源码/Git/lock/工具链身份；dirty 或无 Git 的隔离 QA 只能生成明确的 dirty 候选。pack 要求 sourceIdentity.dirty=false，且候选 source/tree/lock 身份与 options、再次检查的 clean Git 精确一致；候选 toolchain 摘要也必须等于实际固定 Node24/pnpm 声明与 options。旧 dist 不能重标到新源码或新工具链。通过下面的只读命令获得验收所绑定的主体：

```text
python3 -I -B ops/aliyun/frontend/pack.py --dist apps/frontend/dist --public-config /absolute/path/public-config.json --subject-only
```

主体包含 `candidateSha256`、`payloadIndexSha256`、`publicConfigFingerprint`。payload index 包含封包将生成的最小 `version.json`，排除 candidate/内部正式 metadata，不形成递归摘要。应对这个精确候选完成真实隔离环境验收，保存可审查报告，再提供如下 evidence：

```json
{
  "schemaVersion": 1,
  "candidateSha256": "<主体摘要>",
  "payloadIndexSha256": "<主体摘要>",
  "publicConfigFingerprint": "<主体摘要>",
  "backendReleases": [{"backendRelease":"<验收后端ID>","acceptanceSha256":"<真实验收报告SHA256>"}]
}
```

pack 要求 namespace/API requirements 与候选精确一致；verified 集合必须在候选 allowlist 内、且每个后端都有 evidence。修改任意 payload、candidate 或公开配置会拒绝旧证据。candidate 不进入正式包。摘要只能绑定材料，不能证明测试确实执行；本工具不会把构造 JSON 当作真实验收。

生成的 `.approval.json` 是**批准申请**。生产 helper 还要求管理员在独立审查真实报告后，将该精确申请保存到固定 root 管理位置 `/etc/zimage/frontend-acceptances/<artifactId>.json`。未安装此批准、摘要/后端集合不符、或文件/祖先可被 deploy 写入，均拒绝激活。上传者的 incoming 不能提供或替换批准。回退目标也必须保留有效批准。

## 固定服务器协议（仅实现，尚未安装）

管理员未来另行审查安装 `release.py`、`manifest.py`、`transport.py` 到 `/opt/zimage/frontend-tools/`，并保证工具、所有祖先和配置 root 所有且无 group/world 写权限。Python `-I -B` 必须保留。helper 在动态加载模块前就校验这些权限，生产 CLI 没有 `--root`、`--url`、任意路径或任意命令参数。

固定启用配置 `/etc/zimage/frontend-release.json` 必须精确为：

```json
{"schemaVersion":1,"enabled":true,"origin":"https://www.zimage.store","root":"/opt/zimage"}
```

该配置只是启用已审查工具，不代替每个 artifact 的批准。沿用既有身份与主机验证；不新增账号、凭据、签名密钥或 sudo 泛化规则。

上传者只能写 `/opt/zimage/incoming/frontend-<operationId>.tgz`，先完整上传，再调用固定 helper。统一 CLI 负责既有授权主机/known_hosts/传输与结果查询；本目录不自行猜主机或恢复旧发布。

```text
/usr/bin/python3 -I -B /opt/zimage/frontend-tools/release.py deploy OP NAMESPACE ARCHIVE_SHA256 MANIFEST_SHA256 EXPECTED_CURRENT
/usr/bin/python3 -I -B /opt/zimage/frontend-tools/release.py rollback OP EXPECTED_CURRENT TARGET_NAMESPACE
/usr/bin/python3 -I -B /opt/zimage/frontend-tools/release.py status
/usr/bin/python3 -I -B /opt/zimage/frontend-tools/release.py inventory OP
```

`EXPECTED_CURRENT` 首次为空时写字面量 `none`，该值保留，不能作为前端 namespace。operation/namespace 规则为 `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`。相同 operation 只能对应相同请求；terminal 重发返回原结果，实时状态另查 status。`artifactId` 是 payload index/public config 的内容 SHA256；目录 ID 是构建前确定的 namespace，不能拿 Git SHA 为不同包重复贴标签。

目录固定如下：

```text
/opt/zimage/deploy.lock                       # 与后端共享flock
/opt/zimage/frontend/current -> releases/<namespace>
/opt/zimage/frontend/previous -> releases/<namespace>
/opt/zimage/frontend/releases/<namespace>/index.html
/opt/zimage/frontend/releases/<namespace>/app.html
/opt/zimage/frontend/releases/<namespace>/version.json
/opt/zimage/frontend/releases/<namespace>/assets/...
/opt/zimage/frontend/releases/<namespace>/commerce/...
/opt/zimage/frontend/releases/<namespace>/.release/{manifest,file-index}.json
/opt/zimage/frontend/assets/<namespace> -> ../releases/<namespace>
/opt/zimage/frontend/objects/<sha256>           # root封存内容对象，仅增量复用
/opt/zimage/frontend/.stage/<unique-private-stage>/...
/opt/zimage/frontend/journal/<operationId>.json
/opt/zimage/frontend/sequence.json
```

stage、journal 为 root 控制；封存文件 `0444`、目录 `0555`，Nginx/站点身份只能读。所有 payload 必须是 nlink=1 的普通文件；输入 symlink/hardlink/设备/FIFO/额外文件、重复/大小写或 Unicode 冲突、隐藏文件、私有 map、OTF/native/server 文件都会拒绝。只允许明确的网页/公开图片/许可扩展；密钥标识/私钥/数据库连接串等拒绝且不打印原值。静态资源要求同 namespace 闭包（含 lazy import、预加载表、inline module、CSS、srcset、SVG），找不到的静态文件不能以 HTML 补齐。Vite 动态运行期 URL 仍需功能验收，静态扫描不是 JavaScript 执行的形式化证明。

incoming 使用目录 FD + O_NOFOLLOW 打开，检查单硬链接和前后 inode/大小/mtime/ctime，从该 FD 复制后核对期望 SHA；验证和解包只读 root 私有副本。严格流式 USTAR 在消费 body 前拒绝 PAX/GNU/link/特殊头，避免扩展头绕过膨胀预算。上限为 512 MiB 压缩、512 MiB payload、20,000 文件、单文件64 MiB、文本16 MiB；保留64 MiB空间，并为解包/组装/缓存预留两份完整最大 payload 预算，加上私有 archive 副本。磁盘不足停止，不删除旧版本。媒体流式 hash，测试20 MiB媒体的 server unpack/verify峰值低于12 MiB（Python tracemalloc）。

完整 payload index、实际文件大小/SHA、manifest SHA、artifact identity、version marker 与资源闭包都在封存后复验。相同 namespace 只能复用同一个精确 manifest，不能修改已封存资源。文件/directory fsync、原子 rename 和 journal 记录用于崩溃恢复；极早期封存中断若留下不完整目录会 fail closed，需要管理员只对未激活残留作独立审查，不会就地修补线上资源。

## 激活、失败与回退

先获取共享锁、记录 exact current/backend、验证 API major/minor/capabilities/verified 组合和 root 批准，再做独立 HTTPS baseline。只有这些门禁通过后才创建公开 namespace 映射并原子切 `current`；未批准、不兼容或 baseline 失败的私有封存目录不能经 `/frontend-assets/` 公开访问，封存重试也必须重新过门禁。通过后才更新 previous；整个过程不会重启后端。

生产检查已实现：loopback `/api/meta` 严格契约，每次准入实时 GET 固定 `/api/public-config` 并校验严格 DTO 和上述正式认证 HTTP 模式、独立公网 HTTPS `/api/meta` backend 身份、首页 HTML MIME/no-store、最小 `version.json` 精确 namespace/no-store、代表性 JS/CSS 真实 SHA/MIME/immutable、缺 chunk 真实404且不带 immutable；忽略代理环境，禁止重定向，正常 TLS 验证。公开配置 503、无效 JSON/DTO、错误 MIME 或不支持模式均拒绝准入；动态法律版本/CAPTCHA 值可由后端更新，不要求整份运行期配置摘要与构建时相同。完整资源闭包另在磁盘逐文件检查。ready/PID、所有媒体 HTTP、真实账号只读、退役状态和旧 RSC/`_next`/草稿在途请求仍需整合层/真实环境验收，不能将这些标记为已经完成。

失败只在 current 仍为本事务候选、且全局 sequence 仍属于本事务时恢复捕获的旧目录；不猜 previous。namespace 相等不能绕过 B→C→B 的世代检查。恢复最多一次，复验失败或 current 漂移记 `needs_attention`，保持最初失败；不会反选坏版本或循环重试。`recovered` 的 `success` 仍为 false，CLI 非0退出。掉线/不确定结果先用 status/journal 查询，不用新的 operation 重放。

统一 CLI、Nginx split 模板与入口兼容由父任务整合，不在本目录改旧文件。Linux 文件系统/断电恢复、生产内存/磁盘余量、完整真实组合与性能仍须在上线前验证。

## 缺失 blob 增量传输

正式 manifest 与 file-index 不因传输方式改变。完整包留在本地；仅增量 USTAR 包增加独立 `.transport.json`，包含原 manifest/index、库存命中声明与缺失 `blobs/<sha256>`。服务器不公开这些传输元数据。

```text
node ops/aliyun/frontend/transport.mjs request --archive FULL --manifest-sha256 SHA
node ops/aliyun/frontend/transport.mjs bundle --archive FULL --manifest-sha256 SHA --inventory INVENTORY_JSON --output DELTA
```

两个命令也要求已有 Node24.19.0，不会安装工具。request 会完整解包验证源包，输出 `{schemaVersion,assetNamespace,artifactId,manifestSha256,objects:[{sha256,bytes}]}`。将该 JSON 以 stdin 交给固定 `inventory OP`（上限4 MiB），返回同一主体加 `found:[{sha256,bytes}]`。本地保存返回值作为 bundle 输入；bundle 再次核验整个源包，校验 hints 属于同一主体，输出缺失对象包及 archive SHA/大小、`uploadBlobBytes/reusedBlobBytes/uploadBlobCount/reusedBlobCount`。JSON输出上限8 MiB。上传 DELTA 到既有 `incoming/frontend-OP.tgz`，deploy 参数里的 archive SHA 换成 DELTA 的实际 SHA，manifest SHA 保持原值。完整包输入仍兼容。

库存只对 root 既有封存对象逐个检查 owner/mode/nlink/size/SHA；未封存incoming与其他任意路径不能成为命中。hints 即使被伪造也不能授权激活：root 私有 stage 会重新核验传输描述、原 manifest/index、完整对象集合和每个 blob，在组装时重新 hash 被复用的封存对象。每个最终 payload 文件使用新建普通文件独立复制，不链接 cache/旧版本。多路径相同内容只传一份blob，但按原index恢复所有路径与原资源质量。

cache 中损坏、可写或硬链接对象不复用，也不就地修复/删除。上传有效替代字节仍可构造和激活新版本；异常旧cache保留待独立排查。已封存 release 的文件始终独立，不会随 cache 损坏或后续发布改变。发布中断后先查 journal/status；没有 GC，也不自动删旧资源以腾空间。

## 本地验证

```text
python3 -B -m unittest discover -s ops/aliyun/frontend -p 'test_*.py'
node --test ops/aliyun/frontend/package.test.mjs
ZIMAGE_TEST_NODE=/absolute/path/existing-node24 python3 -B -m unittest discover -s ops/aliyun/frontend -p 'test_*.py'
```

测试通过 Python API 注入临时目录、当前普通用户 UID、fixture meta/approval/HTTP探针，不给生产 CLI 添加可控根路径开关。完整CLI测试只读克隆已有本地Git对象到临时稀疏checkout，用fixture包验证pack/request/bundle/sidecar与脏源码拒绝，不创建commit；未指定已有Node24时只跳过这一项，不下载安装。它们不联系真实服务，不消费模型，不创建账号，不构造生产批准。
