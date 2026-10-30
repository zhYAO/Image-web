# 精确源码进入既有 Linux 构建环境

仓库入口是 `python3 ops/aliyun/linux-handoff.py`，提供 `snapshot`、`verify-archive`、`preflight`、`build` 和 `return`。脚本由已审阅的本地交接适配器原样纳入；无需另传 `/tmp` 脚本、创建 package alias、安装工具或启动 CI。它不执行源码传输、Git 写操作、SSH、容器创建或生产激活。

**本文尚未绑定最终提交。所有 `FINAL_*` / `EXPECTED_*` 都是冻结后必须提供的真实输入，不是示例值或已完成证据。** 当前分支为 `codex/frontend-backend-separation-20261029`。旧 `48e35686e0e4d6b302a1940cb12f5ea1be84860e` 的成功构建发生于分离之前，不能改标签作为本次产物。dirty snapshot、源码解压目录或伪造 Git 身份也不能成为正式构建输入。

## 1. 父会话冻结并交付源码身份

先完成本次已授权改动的审阅与检查，冻结真实新 40 位 commit，并确认整个工作区 clean。由父会话把该 commit 推送到**现有仓库的既有分支和 remote**；不得顺带触发 GitHub Actions、改 remote、创建云资源或使用生产 SSH。本文不替代父会话对实际 push 结果的核验。

冻结后，在 clean checkout 运行下面的命令；`FINAL_SOURCE_INPUT` 必须是源码之外的全新目录，例如父会话在 `/tmp` 分配的唯一目录：

```sh
set -eu
: "${CLEAN_SOURCE:?必须指定冻结后的 clean checkout}"
: "${FINAL_COMMIT:?必须指定真实新40位commit}"
: "${FINAL_SOURCE_INPUT:?必须指定源码外的全新输出目录}"
test "$(git -C "$CLEAN_SOURCE" rev-parse HEAD)" = "$FINAL_COMMIT"
test -z "$(git -C "$CLEAN_SOURCE" status --porcelain=v1 --untracked-files=all)"
python3 "$CLEAN_SOURCE/ops/aliyun/linux-handoff.py" snapshot \
  --source "$CLEAN_SOURCE" --output "$FINAL_SOURCE_INPUT"
python3 "$CLEAN_SOURCE/ops/aliyun/linux-handoff.py" verify-archive \
  --archive "$FINAL_SOURCE_INPUT/source.tar.gz" \
  --manifest "$FINAL_SOURCE_INPUT/source-manifest.json"
```

每个 snapshot 写出完整 `source-manifest.json`（路径、长度、SHA256、mode）、`source.tar.gz`、delta 及 `source-receipt.json`。正式输入必须同时满足 `baseCommit=FINAL_COMMIT`、`sourceState=clean`、`formalBuildEligible=true`、`productionReady=false`。clean commit 的 dirty delta 为空；正式取源码仍用完整 Git commit。

父会话通过已有可信会话交付以下**非敏感身份记录**，并把完整索引/receipt 留在本地 `.design-qa/2026-10-29-separation/linux-handoff-entry/` 的最终证据子目录中：

| 输入 | 最终来源 |
| --- | --- |
| `FINAL_COMMIT` | 已推送且独立核验的完整 commit |
| `EXPECTED_GIT_TREE` | `source-manifest.json` 的 `gitTree` |
| `EXPECTED_SOURCE_FINGERPRINT_SHA256` | `source-receipt.json` 的 `fingerprintSha256`；绑定全部路径、每项 SHA/长度/mode |
| `EXPECTED_SOURCE_FILE_COUNT` / `EXPECTED_SOURCE_BYTES` | 同一 receipt 的 `fileCount` / `sourceBytes` |
| `EXPECTED_SOURCE_ARCHIVE_SHA256` | 同一 receipt 的 `artifacts["source.tar.gz"].sha256` |
| 父完整索引的 SHA256 / 长度 | 同一 receipt 的 `artifacts["source-manifest.json"]`，用于核验父索引本身 |

最终索引生成于提交之后，不提交回该 commit，避免索引或文档把自己的 SHA 写入自己的源码树。也不要为了填写本文再改动已冻结源码；真实值随外部 receipt 交付。`.design-qa` 只是 ignored 本地证据位置，不是云端可访问路径。父本地 snapshot 输出必须在源码树外，随后才可把证据副本放到上述位置。

源码归档的 Python 路径白名单在打开/哈希前排除 `.env*`、`.npmrc`、`.netrc`；其他凭据名、链接、构建输出、Mac/Windows `node_modules` 等会被排除或拒绝。扫描只覆盖明确高置信标记，不能声称穷尽检测。测试证明的是适配器的 Python 文件读取顺序；Git 自身的 status/diff 对已跟踪路径可能进行 stat/hash。Git 获取的是现有仓库 commit，不能据归档排除规则宣称 Git 历史中不存在这些名称。不要另传配置文件、用户 HOME、凭据目录或整机环境。

## 2. 既有云任务精确 fetch，建立新 checkout

复用既有任务“核验 Zimage 云构建环境”（thread `01a187a5-2eb4-7561-bec2-98c8c0e23027`）及已有仓库/remote。先确认当前可执行能力、原 `/workspace/zimage-release-20261029`、受控执行器、daemon、固定镜像、store、原字体与资源仍存在；只读检查，不自动拉镜像、安装工具、改网络或启动构建。历史成功不证明这些条件当前仍成立。

只有父会话已交付上节真实身份、现有 Git 通道获准使用后，云端才执行：

```sh
set -eu
: "${EXISTING_REPO:?必须指定云端已有可信仓库}"
: "${FINAL_COMMIT:?必须使用父receipt绑定的真实新40位commit}"
: "${SOURCE:?必须指定全新隔离checkout路径}"
SOURCE_BRANCH=codex/frontend-backend-separation-20261029
git -C "$EXISTING_REPO" fetch --no-tags origin "refs/heads/$SOURCE_BRANCH"
test "$(git -C "$EXISTING_REPO" rev-parse FETCH_HEAD)" = "$FINAL_COMMIT"
git -C "$EXISTING_REPO" worktree add --detach "$SOURCE" "$FINAL_COMMIT"
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$FINAL_COMMIT"
test -z "$(git -C "$SOURCE" status --porcelain=v1 --untracked-files=all)"
test -f "$SOURCE/ops/aliyun/linux-handoff.py"
python3 "$SOURCE/ops/aliyun/linux-handoff.py" --help
```

`origin` 必须是此前确认的现有仓库 remote；不要根据本文猜测 URL 或打印凭据。fetch 后分支 tip 与指定 commit 不一致就停止，由父重新核验，不能选择“最新”或回退旧 48e。不要覆盖旧 `source` 目录或其产物。新 checkout 的位置必须由实际执行器 mount/cwd 绑定确认，不能只把命令参数换新而仍在旧目录执行。

Git fetch 解决本次源码进入，不证明二进制 artifact 已可取回。正式 build 之前仍须使用现有获准文件通道完成非敏感小文件的双向字节/SHA 回环；失效 Library materialization、待提供的 presigned URL 或历史报告上传都不算二进制回传成功。不能因通道缺失而改用生产 SSH、新凭据或新资源。

## 3. 云端独立重算完整源码索引

在新 checkout 上生成独立 snapshot。`SOURCE_INPUT` 是源码之外的全新目录；所有 expected 值均来自父最终 receipt，而非云端自己生成后再当 expected：

```sh
set -eu
: "${SOURCE_INPUT:?必须指定源码外的全新目录}"
: "${EXPECTED_GIT_TREE:?必须来自父最终索引}"
: "${EXPECTED_SOURCE_FINGERPRINT_SHA256:?必须来自父最终receipt}"
: "${EXPECTED_SOURCE_FILE_COUNT:?必须来自父最终receipt}"
: "${EXPECTED_SOURCE_BYTES:?必须来自父最终receipt}"
: "${EXPECTED_SOURCE_ARCHIVE_SHA256:?必须来自父最终receipt}"
python3 "$SOURCE/ops/aliyun/linux-handoff.py" snapshot \
  --source "$SOURCE" --output "$SOURCE_INPUT"
python3 "$SOURCE/ops/aliyun/linux-handoff.py" verify-archive \
  --archive "$SOURCE_INPUT/source.tar.gz" --manifest "$SOURCE_INPUT/source-manifest.json"
python3 - "$SOURCE_INPUT" "$FINAL_COMMIT" "$EXPECTED_GIT_TREE" \
  "$EXPECTED_SOURCE_FINGERPRINT_SHA256" "$EXPECTED_SOURCE_FILE_COUNT" \
  "$EXPECTED_SOURCE_BYTES" "$EXPECTED_SOURCE_ARCHIVE_SHA256" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
manifest = json.loads((root / 'source-manifest.json').read_text())
files = manifest['files']
def require(condition, reason):
    if not condition:
        raise SystemExit('source identity mismatch: ' + reason)
require(manifest['baseCommit'] == sys.argv[2], 'commit')
require(manifest['gitTree'] == sys.argv[3], 'Git tree')
require(manifest['sourceState'] == 'clean' and manifest['formalBuildEligible'] is True, 'clean state')
require(manifest['productionReady'] is False and not manifest['deletedTrackedPaths'], 'source status')
require(len(files) == len({item['path'] for item in files}) == int(sys.argv[5]), 'file count/uniqueness')
require([item['path'] for item in files] == sorted(item['path'] for item in files), 'path ordering')
require(sum(item['bytes'] for item in files) == int(sys.argv[6]), 'source bytes')
body = ''.join(f"{x['path']}\0{x['sha256']}\0{x['bytes']}\0{x['mode']}\n" for x in files).encode()
actual = hashlib.sha256(body).hexdigest()
require(actual == manifest['fingerprintSha256'] == sys.argv[4], 'complete source fingerprint')
archive_sha = hashlib.sha256((root / 'source.tar.gz').read_bytes()).hexdigest()
require(archive_sha == sys.argv[7], 'source archive SHA256')
print(json.dumps({'commit': manifest['baseCommit'], 'files': len(files),
    'fingerprintSha256': actual, 'archiveSha256': archive_sha, 'productionReady': False}))
PY
```

`verify-archive` 对每个成员核路径、类型、mode、长度和实际字节 SHA，再核完整闭包。上面的独立公式把整份索引与父 expected 绑定。Mac 父快照在分支上，云快照可能 detached；manifest 中 `branch` 不同会使整份 manifest 文件 SHA 不同，因此不能错误地要求两份 manifest 字节相同。完整 `files`、其 mode/长度/SHA、整体指纹、commit/tree 和确定性 source 归档 SHA 必须一致。所有输出都是源码身份记录，不是新 Linux 构建通过证明。

## 4. 平台、真实输入和构建仍受门禁

继续遵循 [BUILD-PREREQUISITES.md](../../ops/aliyun/BUILD-PREREQUISITES.md)。只在已有受控 Ubuntu22.04/glibc2.35 容器中测量和构建：Node **24.19.0**、ABI **137**、Node-API **10**、linux/x64、pnpm **11.19.0**、GNU tar、Python >=3.10。Mac、Windows 或 glibc2.41 宿主均不满足正式目标，不能只改平台标签。固定历史镜像为 `ubuntu@sha256:98510ac07bb4545e389be502a8918b385c018bfe4ceeb5ac7e0375c782268b04`；仅当它已经存在并被重新核验时使用。

先只读核验既有 `run_container.py` 的实际 cwd、mount 和参数，确保绑定新 `SOURCE`。不要照抄未经验证的 runner 调用。以下 Python 命令均应由核验后的执行器在匹配容器内执行；预检报告、source input、构建输出必须在实际容器可访问的受控路径：

```sh
set -eu
: "${PREFLIGHT_REPORT:?必须指定源码外的新报告路径}"
python3 "$SOURCE/ops/aliyun/linux-handoff.py" preflight \
  --source "$SOURCE" --report "$PREFLIGHT_REPORT"
```

先审阅 fresh cgroup 内存上限/占用、RAM/swap、磁盘、CPU/并发负载及 Node/libstdc++ SHA/符号。隐藏祖先 quota 仍由操作者确认，不编造最低资源保证。Corepack shim 必须附 `--corepack-home` 指向已核验现存缓存，或 `--pnpm-executable` 指向已核验可独立执行的既有 pnpm；不下载缺失管理器。

五键公开 JSON 必须由管理员确认当前来源/版本、在仓库外为 0600，并以实际 SHA 绑定；只核键存在性、字符串类型、摘要，不回显值或全环境。不能把历史两个不同配置 SHA 当作当前认可。仅允许 Supabase URL / publishable key、Turnstile sitekey、Sentry DSN / traces sample rate 五键；server secrets、生产 SSH、Sentry 上传 token 均不进入构建。历史 always-pass Turnstile 测试 sitekey 不证明真实防机器人验收，也不能静默替换。

原字体仅复用可信现存的四项原件，固定 SHA 已写入脚本并在前置条件文档中定义；既有候选目录是 `/workspace/zimage-release-20261029/original-fonts`。完整公共资源由精确源码与这四项生成，不用 fonts-only 代替。依赖仅从既有可信 Linux `pnpm-store` 做 offline/frozen 安装；缺包立即停止，不能 force、重写 lock、带入 Mac node_modules 或隐式联网补齐。

只有源码、现有执行器/镜像、fresh 平台/资源、认可公开输入、字体/store 与回传通道全部通过后，才由父会话协调执行真实 build：

```sh
set -eu
: "${BUILD_ROOT:?必须指定源码外的全新构建输出目录}"
: "${APPROVED_PUBLIC_JSON:?必须指定获认可的仓库外0600五键文件}"
: "${APPROVED_PUBLIC_SHA256:?必须指定该文件实际SHA256}"
: "${FONT_SOURCE:?必须指定四项可信原字体目录}"
: "${TRUSTED_LINUX_STORE:?必须指定既有可信Linux pnpm store}"
python3 "$SOURCE/ops/aliyun/linux-handoff.py" build \
  --source "$SOURCE" --manifest "$SOURCE_INPUT/source-manifest.json" \
  --commit "$FINAL_COMMIT" --output "$BUILD_ROOT" \
  --public-config "$APPROVED_PUBLIC_JSON" --public-sha256 "$APPROVED_PUBLIC_SHA256" \
  --font-source "$FONT_SOURCE" --pnpm-store "$TRUSTED_LINUX_STORE"
```

脚本先拒绝 dirty manifest、错误 HEAD/commit、脏 checkout、源码差异和旧构建输出，再读取公开配置或安装。它使用隔离 HOME、空用户 npmrc、显式构建环境、4096MiB V8 heap 和单 Next worker，不继承 server secret / QA dist。`pnpm --filter @zimage/web exec next build --webpack` 后核真实 BUILD_ID、源码/lock 无漂移，再执行现有严格三层打包器。build 的网络隔离仍由既有受控执行器实施，Python 本身不创建网络 sandbox。

该入口当前生成后端原三层候选；它不替代前端 F1 的真实跨版本组合证据，不伪造 verifiedBackendReleases，不证明生产业务验收或激活成功。

## 5. 成功后仅组装受限 return 包

```sh
set -eu
: "${RETURN_ARCHIVE:?必须指定源码外的新return归档路径}"
python3 "$SOURCE/ops/aliyun/linux-handoff.py" return \
  --build-root "$BUILD_ROOT" --output "$RETURN_ARCHIVE"
```

return 包仅含 `transport.tgz`、`release-result.json`、`build-result.json`、`platform-preflight.json`、`source-manifest.json` 和记录各项字节/SHA 的 `return-index.json`，真实 commit 必须一致。外层 `<归档>.receipt.json` 绑定最终归档字节/SHA。公开 JSON 原文件、env、HOME、logs、source maps、debug-maps/build-traces、源码 checkout 与原字体输入不在回传白名单。组包不自动上传；Mac 经先前已验真的现有通道取回后，核外层 receipt、内层 index 和 commit，再进入既有 Mac 发布流程。

本地离线守卫测试：`python3 -B -m unittest discover -s ops/aliyun -p test_linux_handoff.py -v`。这些测试使用非敏感临时 fixtures 和模拟 Git 状态，不安装依赖、不运行真实 Node/Linux 构建。真实新 commit、Git 推送/fetch、现有云执行能力、fresh 预检与正式 build/return 均须由实际结果单独记录；本文及本地测试本身不把这些 pending 条件改为成功。
