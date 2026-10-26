# 退役入口真实 HTTP 状态复核（2026-10-26）

## 生产证据

PR21 已合并为 `9993d2d8614540270431b6467f9acb5850617d1e`。main run `40302650087` 的 quality、database、production-build 成功；10:17:17 UTC 验证新版本机 ready 版本正确、三个退役 POST 为410，但 `/create/batch` 为200而非404，正常门禁失败并回退。10:17:28 root helper 已选择并本机验证 `8cbb708`，runner 外部恢复仅记录 `URLError`，无法从旧日志恢复内部异常。父 Edge 后续确认原版公网 ready、公开首页及已有登录工作台正常。

## 根因与真实构建对照

Next16.4.1 文档 `not-found.md` 明确：流式输出后调用 `notFound()` 保留200。当前根 layout 的 Suspense 包含异步 `/create/[scene]` 页面，旧单测只模拟并断言抛出404异常，没有检查 HTTP。

在独立 `.next-build-qa` 用同版 Next、Node24.19、Webpack、正式 HTTP 模式构建；Supabase 使用 `127.0.0.1:9` 和测试占位公钥、正式认证标志，不使用真实凭据或付费服务。真实 standalone 请求的基线：浏览器 HTML、JSON、Googlebot、HEAD、带 query 的 `/create/batch` 均200，GET含 noindex；`/home`、有效 `/create/product-set` 均200。新增静态 `app/create/batch/route.ts` 明确404后，同一7项 HTTP 检查全部通过，退役5项均404，两个有效页面仍200。退役历史记录读取和鉴权逻辑未改。

`verify-built-retired-route.mjs` 启动实际 standalone 子进程、只请求回环、失败退出并清理自建子进程。quality 和正式生产构建后均增加该检查，正式包上传前即发现这类状态回归；没有恢复浏览器自动化。

## 公网错误与切换保护

验证器保留拒绝重定向、TLS/主机名验证和全部状态门禁。传输失败只增加异常类型、底层类型、固定分类、数值 errno/证书验证码和耗时；不输出异常原文、响应体、密钥或任意 URL。真实 TLS 证书错配、受控 DNS 异常、真实连接拒绝和超时回归覆盖这些信息。

`record` 在输出原版 SHA 前先由 runner 验证原版公网稳定接口及静态资源。检查失败时不输出可用于激活的 SHA、不切换生产。后续完整新版本验证与失败恢复不减少。旧 runner 的 URLError 是否为暂态、DNS或TLS仍未知，不能当成已修复。

## 当前验证与发布边界

- 真实 HTTP 修复前失败、正式HTTP占位配置构建修复后7/7通过；另执行 `NEXT_DIST_DIR=.next-build-qa NEXT_PUBLIC_DATA_MODE=mock pnpm build --webpack` 退出0，mock构建的相同7项HTTP也通过，覆盖两个新增CI调用位置。运维49/49（4.317s）、lint、typecheck、预算5/5、bash/node语法、diff检查通过；独立复审无新增可执行问题。
- 本轮全量本地 `pnpm test:run` 已退出0：Domain106/106、Web838/838，Web耗时406.62秒；未重复本轮已通过测试。未变化的 main CI Worker80/数据库成功仅作既有证据。
- 用户要求节省 Actions：本轮没有推送、触发 CI、合并或部署。当前 HTTP QA 构建使用占位配置，只供验证，不能发布。
- root helper 源码未变，已安装哈希保持 `28e4dad990be11ebcd3acc8d413b383a3c0f96ec0e20d9e91edf28d441a58d82`，不需要新一次 helper 安装。
- 手动发布备选：在云开发环境使用已确认的六项公开生产构建配置、精确新提交和 frozen lockfile，重新构建/打包/校验；不在2GB生产机全量构建。通过现有控制台文件上传传输到唯一新 incoming 路径，不覆盖其他文件，然后沿已安装 helper 激活、本机应用/TLS验证、独立 Edge 公网与会话验收；失败回退精确8cbb708。上传入口需核实现有权限，官方功能要求临时OSS暂存同意，不自行授予RAM权限或改网络。尚未执行该方案。
- 重要：helper 的 RUN_NUMBER 是单调防旧发布计数。手动调用必须先只读取得现有 `last-deployment-run`，在明确批准手动来源后保留该计数，不用时间戳/大数推进，否则会阻止以后正常CI。不得删除或重置计数。独立公网必须达到既有路由/静态资源及TLS验收，Edge若无法执行等价检查则停在切换前，不缩减门禁。
- 传输尚未确证：GitHub连接器返回可信产物12642920937的文件引用；官方Library resolved-reference落地助手及一次有界重试均返回 `download failed`，最终本地ZIP不存在。无明确HTTP/权限原因，不能称为权限拒绝或已下载；未改用其他URL/公开服务。Windows端还须独立确认Library下载/本地文件选择能力，不能共用云端路径。
- 现有workflow的 `action=deploy` 仍完整运行quality/database；重跑旧run只使用旧SHA，不能包含此次修复。当前不存在只构建新SHA+部署的受控现有入口。若手动传输不可行，需要另行明确批准精简手动入口的流程调整，不能擅自跳过现有CI或重标旧产物。
