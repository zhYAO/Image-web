# 独立服装字体资源

网页继续使用系统字体栈。Sharp 服装排版使用原 Noto Sans CJK SC Regular/Bold 文件，字体族、字重、布局版本不变；不使用系统字体回退，不在开发/测试时自动下载。

二进制字体不再保存在仓库或应用发布包。原 SIL OFL 许可与下载来源保留在 `doc/licenses/apparel-noto/`，独立资源也必须同时携带原始 LICENSE.txt 和 README.md。原四文件总计 **33,444,552 字节**，外置不代表这些资源消失。

## 离线准备

从已保留的原始资源目录提供两份 OTF、LICENSE.txt、README.md（仅这四项）。在仓库根运行：

```powershell
node ops/aliyun/package-static-assets.mjs --font-source 'C:/external/original-fonts' --fonts-only true --output 'C:/external/new-font-assets'
```

输出必须为尚不存在的仓库外目录。工具校验四个文件的固定 SHA-256，生成 schema 1 清单，再按清单实际字节 SHA 命名版本目录，并回读全部输出。不会覆盖已存在资源。此 fonts-only 清单仅用于本地字体，不得冒充生产的完整图片资源版本。

把输出中的 `versionDirectory` 和 `manifestSha256` 成对配置到启动 dev/test 的进程：

```powershell
$env:ZIMAGE_SHARED_FONT_DIR='C:/external/new-font-assets/<manifestSha256>/fonts'
$env:ZIMAGE_STATIC_ASSET_SHA256='<manifestSha256>'
pnpm test:run
# 需要开发服务时再由用户启动 pnpm dev
```

也可在用户自行管理的本地环境文件配置同名变量；勿提交环境文件。路径必须绝对、以 `<manifestSha256>/fonts` 结尾，同级必须有 `asset-manifest.json`。缺失/不匹配会给可操作错误，禁止静默回退或在线取字体。临时目录可能被系统清理，长期开发应使用用户管理的持久资源目录。

## 完整资源与生产

去掉 `--fonts-only true` 即组装当前 `apps/web/public` 和外部四个字体文件，保持现有完整资源清单格式、来源与图片元数据：

```powershell
node ops/aliyun/package-static-assets.mjs --font-source 'C:/external/original-fonts' --output 'C:/external/new-complete-assets'
```

同源图片仍由应用包的 public 提供；字体 resolver 的版本指纹不会自动修改浏览器图片 URL。若使用三层资源协议，必须给 `three-layer-release.py pack --assets` 提供这次完整资源版本，不能用 fonts-only 版本替代。三层组装继续返回版本绑定的运行环境，并由 non-root 原生探针检查清单、原字体/许可/来源 SHA 和真实 Sharp 编解码。旧四层原型只支持内置字体，字体外置应用请使用三层协议；不得删除其检查伪装兼容。

普通应用打包器拒绝旧 standalone 内残留的 Noto 载荷，请重新构建；不要复用迁移前的 standalone。Next 不再 tracing 仓库字体。应用构建不需要字体，但服装渲染必须有上述运行配置。

生产发布前，管理员必须独立核对现有服务器资源版本、服务 UID 的读权限、运行环境注入及原生探针。全包与三层 deploy/rollback 现在共用 release.py.activate() 的字体预检：失败发生在修改 current、previous 和 restart 之前，自动恢复旧版前也重新检查旧版资源。三层仍保留组装、root 所有权及候选检查；低层 pack/assemble 只生成文件、不启动服务。

### 全包部署准备（仅管理员后续手动执行）

全包新版本尚无绑定时，helper 只读取专用的 /etc/zimage/font-assets.env（不读取含凭据的 /etc/zimage/environment）。该文件由 root 管理，不可被组/其他用户写入；严格只有以下两个裸值，不支持 shell 语法或其他环境变量：

    ZIMAGE_SHARED_FONT_DIR=/opt/zimage/layer-cache/assets/<manifestSHA>/fonts
    ZIMAGE_STATIC_ASSET_SHA256=<manifestSHA>

可使用已验证的现有资源目录，不要重复部署。路径必须绝对并匹配版本，指纹取实际 asset-manifest.json 字节 SHA。helper 以 zimage 身份运行相同的 Sharp/清单/原字体/许可/来源预检；成功后才以 0600 创建版本自己的 .runtime-assets.env，记录精确资源版本。已有绑定的版本（含三层版本）只使用自身绑定，损坏时拒绝，绝不回退当前全局配置。

必须更新受审查的 helper 与 systemd 模板，使服务保留 User/Group=zimage，并且最后一个 EnvironmentFile 为 /opt/zimage/current/.runtime-assets.env。基础 zimage.service 已补这一可选项，三层的既有 drop-in 也加载同一路径；检查针对 systemctl 实际元数据，若其后存在其他环境文件则拒绝。全包 deployment-health.sh 原有 helper SHA 检查会拒绝未升级的脚本。历史回滚版本若没有绑定，也须先完成专用全局配置和预检；此为明确的 fail-fast 门禁，不绕回仓库字体。

这些只是本地脚本与模板变更；没有创建服务器配置、读取凭据、调用 systemctl、上传资源或发布应用。Linux 的 root/服务 UID 权限、flock、systemd 实际元数据及完整发布/回滚仍需在已有授权验证环境验证。

Flow 的通用 quality 任务无需下载字体。真实字体用例由后端候选任务使用已校验的原始资源执行，通过后才打包。过渡期的 GitHub quality 任务仍会从官方 HTTPS 源准备测试字体并校验固定 SHA。

## 核算

分别报告应用包、独立资源、首次完整部署总量、复用资源时的后续增量。应用去掉 33,444,552 字节重复字体载荷，独立资源仍有同样的字体字节，外加清单。不要用旧构建目录推断当前发布大小；Linux 上需重新构建、组装及测量实际归档。
