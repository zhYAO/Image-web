# 2026-10-30 明确授权后恢复执行

UTC。本检查点恢复原安全迁移方案，**完整迁移验收未通过，生产尚未发布**。临时删除旧数据/停止兼容的提议已撤回；没有删除业务数据、草稿、旧制品或回滚版本。

## 两项授权及执行边界

用户01:08明确批准：把当前迁移源码提交并push到私有仓库 `https://github.com/zhYAO/Image-web.git` 的 `codex/frontend-backend-separation-20261029`；上传候选Nginx到47.100.222.24的`/tmp`，仅`nginx -t`。此前两项自动审批拒绝保留为历史，新的明确授权允许按正常工具审批对已知未执行动作重试一次；不等于生产上线验收或任意数据删除授权。

只读核实仓库仍private、owner/name为zhYAO/Image-web；目标分支尚不存在，main仍9c5c3ea95e0c66193b23a2db50643530aa7d095a。提交候选保留已复审现状，仅明确变更源码、测试、文档与必要构建/部署配置，不含凭据、日志、构建产物和临时QA。原扫描器不弱化，凭据配置路径先剔除再读源；不合并main、不force、不创建PR或触发CI。现有唯一CI workflow的push只匹配main/setup2，但pull_request未过滤；同时使用`[skip ci]`消息，远端无本分支open PR。分支发布的实际commit、remote ref和完整源清单以提交后外部receipt为准，不把本检查点文字当push成功证明。

## 真实 Nginx 语法检查已通过

上传前修复两项真实候选问题：split与维护include重复`open_file_cache off`，以及map正则`{2}`量词未整段引号。维护include仍唯一持有关闭文件缓存指令，正则含义不变；新增回归先2失败，修复后18/18通过，没有放宽路由、安全或维护门禁。

在既有SSH连接上完成获批的一次上传/检查，隔离目录 `/tmp/zimage-nginx-syntax-20261030-81eff83d417e151f`。归档SHA256 `c7dc1bb5ba086b95a77e6130845d0db01b4068486c8ca0f0b0c75be8d88d226d`；4份原源码随束保留，派生仅改2个maintenance include和日志路径，保留真实TLS、证书/key引用及MIME。Nginx内部正常加载它们，不复制或输出私钥；1.18不支持`-e`，已披露早期bootstrap可能访问默认error log，未拦截、读取、清除该日志。

maintenance、legacy、split三次`/usr/sbin/nginx -t -p /tmp/.../ -c /tmp/.../<kind>-root.conf`均exit0、syntax ok/test successful。前后web/nginx服务PID、启动时间、重启计数、current/previous完全一致；B0仍PID399199/current9c、previous8cbb708645e93d3d71d17641b860cc60301fa005。没有安装到`/etc`、启用、监听、reload/restart或切换入口。

这证明目标二进制下的独立配置加载，包括TLS配置加载；不代表生产全局include冲突、TLS握手、真实路由、keep-alive封口、静态权限、SSE或真实业务通过。原source路径与沙盒改编、完整前后身份和输出在ignored QA `nginx-test-plan/`、`nginx-approved-once/`。

## Mac补验及正式构建仍有门槛

新独立nonce本地QA复用原harness与原B0字节，86项HTTP及5个语法检查通过；切前成功Flight0，切后原Flight3，无新document/凭据/mutation，独特未发送文本保留。原生Edge输入返回`-10005 noWindowsAvailable`，没有选图或真实focus，focus窗口authGET0，两项继续BLOCKED；不能从AX/截图可读推断原生输入可用。未绕过锁屏、注入JS/事件、上传图片、发送生成或真实登录。

自有PID29564按token核验SIGTERM，session47539退出0，01:24:44确认PID不存在、4184 ECONNREFUSED；没有停止生产进程。原失败和新最终证据保存在ignored `compat-resume/`，不进入提交。

原应用1636项及独立P1修复的验证范围仍见[修复验收](./repair-validation-20261029.md)。本次仅Nginx候选与其回归新增源变化；其余已审运行时与651相关应用输入需在提交前核对。正式Linux必须从实际新clean commit、完整白名单/指纹/归档SHA构建；旧48e产物和旧dirty包均不能替代。具体传递入口见[源码传递](./linux-source-transfer.md)，不把本地未上传文件称为云端可用。

当前ECS双850MiB预算仍不能放行；匹配Linux B1/native峰值、真实认证/Storage/SSE/账务、旧B0历史收尾与精确生产恢复门槛继续保留。新的两项批准不授权强杀、丢失未定计费/生成结果、扩容或增加凭据。[最小切换条件](./minimal-safe-cutover-20261029.md)
