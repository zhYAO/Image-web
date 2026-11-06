# zhao Mac 本人完成只读登录验证

当前交接已改为[浏览器内只读验证](./20261106-browser-readonly-verifier.md)：本人在 zhao Mac 的 Chrome 正常登录 https://www.zimage.store ，在同一顶层页面运行已审查、固定范围的可读 Sources Snippet。浏览器仅为固定7个同源GET自动附带正常凭据，主会话只传入公开nonce请求、读取脱敏回执及字节SHA。

**不再要求本人复制Cookie、会话、请求头或其他凭据，不使用Network取登录态，也不把凭据交给Terminal。** 原verify-session.py保留兼容和历史测试，旧操作说明可从git历史查阅；它不是本次推荐或已安排的登录交接。

浏览器出现self-XSS拦截必须停止，不能输入覆盖文本、改设置/启动参数/配置或改走其他执行入口。是否能在既有Chrome配置中执行仍未真实验证；没有安装新扩展或要求提供浏览器私有状态。

本人现在无需操作。待协调器安装范围、隔离Linux测试、正式策略及维护窗口达到条件后，由主会话统一安排。协调器及准确root边界见[实际配对协调器](./20261106-actual-paired-coordinator.md)。只读回执不证明模型调用、价格批准、完整A+流程或已上线。
