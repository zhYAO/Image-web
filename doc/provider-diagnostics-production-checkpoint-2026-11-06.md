# 独立诊断生产检查点（2026-11-06，已部署未测试）

目标image-web/main，项目klmiycyesxnpinxpeqep。用户明确批准诊断部署、service_role执行权限、一次最长15分钟活动、Astra和Sol各一次及0.50元非硬上限预算；第一项失败/未知立即停止，不自动重试。Seedream0.002元/AFP估值基准同时获批，正式模型/售价保持关闭。

- 只应用迁移isolated_provider_diagnostics，实际历史版本20261106123202；源码20261106110341_isolated_provider_diagnostics.sql，SHA256 7fc3d2c1144692d25d52e0f50e57b3ad05bf4b8131c0bc8545b2efee9c830923。不得重放。
- provider-diagnostics v1，函数ID07d98059-eecf-447e-b25d-774f6cc5afec，部署摘要c63ddbda73c7ed2d2cf407fc847ced63d993bb643ea96c80914a0e036fba49ef。源提交bba2787e7d3e02ee6b01f6b00cb8ac2b633e76ab。get_edge_function返回的入口、处理器、deno.json与审查源码逐字节相同；源码API未返回lock和纯类型文件，不伪称已远端逐字节核对它们。
- public.provider_diagnostic(uuid,text,text,jsonb) owner=postgres，SECURITY DEFINER，空search_path；service_role execute=true，anon/authenticated=false；两张私有表RLS=true，service_role无直接INSERT活动权限。
- 12:36:53UTC活动0、尝试0，正式聊天启用费率0，packages_enabled=false。没有创建活动或修改诊断开关，缺省关闭且无有效调用资格；真实推理0次。无凭据GET实际返回401 INVALID_CREDENTIALS，证明公开请求未绕过服务鉴权；尚未完成真实服务身份验证。
- 部署前Free面板：函数741/500000、Storage0.032/1GB、Egress0.001/5GB、cached0/5GB；组织仍Free。面板可延迟1小时。SQL数据库部署前142486675B，部署后142544019B，本次增加57344B。
- Mac执行通道曾短暂不可用，已恢复。浏览器API仍报调试未附着，原生窗口发生用户操作中断，已停止发送原生输入避免冲突。既有CLI2.115无远程invoke命令，secrets list报告无已保存AccessToken。没有提取/复制密钥、创建令牌、变更认证或使用替代授权绕过。
- 后续先由主会话协调短暂的浏览器操作窗口，在现有已登录Supabase控制台完成非秘密配置与默认服务身份验证，再创建本次活动；当前未启动15分钟计时。测试授权及次数没有消耗，不需要重复泛化批准。若需要新的凭据/权限，则另行精确确认；不得降低鉴权。
- 真实模型用量与实付费用尚未验证，不能把目录估值当已发生账单。Astra完成且可信才可Sol，遇未知只查询记录不重发。最后关闭独立运行门并核验，无正式价格/模型启用。

本检查点取代旧说明中的“诊断未部署”，但不改变原始本地验证证据。源码与用户next-env改动均保留，.env.local没有更改。
