# zhao Mac 本人完成只读登录验证

仅在主会话确认配对维护准备就绪时执行。现在不需要发送任何Cookie或密钥。已核实这台Mac安装了Chrome和Terminal。

## 用户本人操作

1. 在 **zhao Mac 的 Chrome** 使用既有专用测试账号登录 https://www.zimage.store/auth ，本人完成密码、验证码及网站要求的验证。Supabase管理后台登录不能代替Zimage网站登录；不新建账号或充值。
2. 在该浏览器中打开开发者工具的Network，重新打开网站账户页，选中网站自己的GET /api/auth/session或GET /api/account请求。在Request Headers中由本人复制**Cookie字段的值**。不复制整份请求，不在聊天、卡片、截图或文件中提供它；代理不查看请求头或剪贴板。登录态等同于该测试账号的临时访问权，建议使用独立测试窗口。
3. 在同一台Mac的 **Terminal** 中运行下方无秘密的命令（不用sudo），仅在终端出现隐藏提示后本人粘贴Cookie值并回车。输入不会显示，也不进入命令历史；不要把值拼到命令后或写入.env。若提示无法隐藏输入、目录已存在或范围有误，停止并只报告错误状态。
4. 看到ready=true后保持终端运行。主会话只投递非敏感nonce请求、取回脱敏回执。完成后本人按Ctrl-C结束。授权检查窗口默认20分钟，最多8轮不同nonce，每轮7个固定只读GET；已发出的GET不能撤回，网络阻塞可能延后返回，但到期后不再发下一请求或发布成功回执。

以下operation和目录名是本次草案，正式开始前主会话须确认没有被使用；若已存在，选择一个全新的、已审核operation及目录，不复用旧发布记录。

```sh
/Users/zhaoyao/.local/bin/python3.12 -I -B \
  /Users/zhaoyao/Desktop/work_space/Image-web/ops/aliyun/backend/verify-session.py \
  --session-dir /private/tmp/zimage-readonly-paired-7a811b3-20261106 \
  --operation paired-7a811b3-20261106 \
  --release fb4fb09f909c0ae5dce98ebd0d9540386685ddb7 \
  --release 7a811b326aa4b344cee08bc5a33c04e44a780fd4 \
  --duration 1200
```

这个命令不是发布器，不会迁移、切版本、开模型或收费。Cookie只进入本地固定GET验证器的内存CookieJar，不进入环境变量、argv、磁盘、SSH/SCP或回执。工具拒绝非TTY及隐藏输入降级；用户不愿复制登录态时停止，另行协调验证方式，不能由代理读取浏览器Cookie库代替。

## 主会话操作与回执边界

- 只读ready.json并核对operation、允许的两个后端和期限。它只证明本地验证进程就绪，**不证明账号有效**；在关闭生产入口之前，先要求当前精确版本的一轮真实只读基线成功。
- 从受信root协调流程经既有SSH读取新的verification-request：operation、release、PID、nonce及最多120秒TTL。校验原样JSON，使用当前Mac用户、0600临时文件加原子替换写入上方私有0700目录/request.json，不把Cookie交给任何工具。
- 工具拒绝错operation、错版本、过期、重复/冲突nonce、JSON重复字段、链接/硬链接、弱权限或并发被替换的请求；同nonce失败也不自动重复。需要重试只读验证时由root重新生成新nonce，并保持维护门禁。
- 只有receipt-<nonce>.json是候选成功回执；failure-<nonce>.json只是失败。独立复验文件类型、权限、SHA及原始root请求绑定，再通过既有受控receipt安装边界处理。不同的配对协议需要对应已审查root协调器；本地工具不能让现有root helper接受一个不认识的operation。
- 7个GET仅包括ready、meta、auth/session、account、sessions、带严格只读marker的credits/pricing，再读meta防漂移。没有wallet/ledger GET、上传、登录POST、生成、充值或模型调用。会话和账户身份在进程内检查，回执不包含用户ID、邮箱、Cookie或私有响应正文。
- 会话期限在每个GET前后、验证完成后及回执临时文件fsync后的原子发布前复核，同时使用单调时钟。已发出请求的服务端工作无法撤回；urllib的12秒timeout不是整个网络请求的绝对总时限，不能声称物理网络会在20分钟整瞬间终止。
- 网站可能刷新该测试会话的Cookie，更新只留本地CookieJar。建议独立测试会话；结束验证器不进行账户登出、撤销或其他身份写操作。

本工具通过19项合成测试（未使用真实登录态）；最终后台发布目录189项回归通过。独立审查的两个到期边界缺口已先RED后修复；真实授权输入和公网认证尚未执行。
