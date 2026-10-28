# 首页与工作区本地验收（2026-10-27）

范围：原始 Mac checkout `/Users/zhaoyao/Desktop/work_space/Image-web`，分支 `codex/home-chat-react-bits-20261027`，base `9c5c3ea95e0c66193b23a2db50643530aa7d095a`。2026-10-27验收阶段只做本地开发，未push、PR、部署、修改生产或调用付费模型。2026-10-28用户另行授权仅提交/推送本功能分支，其他限制保留。状态：本地验收完成，未发布；真实服务就绪边界见下文。

## 行为与实现

- `/` 与 `/home` 共用品牌首页，空白工作区只有 `/workspace`；旧 scene 查询、会话/任务深链及登录回跳同步。品牌链接仍回首页。
- 首次访问首页不载入编辑器 provider/store；轻量认证导航只读取 `/api/auth/session`，失败时仍提供登录入口。
- 共用白色选择控件保留键盘、焦点、点击外部关闭、禁用项与弹窗 portal；现有豆包、MiniMax、Seedream 注册表、价格、健康状态、请求契约保持。未移入参考站的演示模型。
- 工作区沿用真实状态、上传、会话与计费链路；侧栏、内容容器、composer 适配参考几何和材质。

## 用户反馈两项回归的原因与验证

1. 动画失效：旧 Reveal 的子控制器 layout effect 先于父 host ref 挂载，直接返回。实际 Reveal 回归先失败，改为同一 FadeContent 组件拥有 host 与 hook 后通过。屏外元素预先准备，已显示/晚水合内容不重新归零；保留 no-JS、reduced-motion 与键盘焦点兜底。
2. 折叠错乱：tooltip 新包装 span 破坏原有直接子节点 CSS 选择器。改为 clone 原触发器并合并事件，不增加布局 DOM；回归先失败后通过。
3. CTA 焦点边界：运行中动画不因鼠标聚焦被取消而突然移动；键盘焦点仍立即可见。回归先失败后通过，并补实际浏览器点击。
4. 手机旧 header 的 flex-wrap 覆盖新固定高度，导致第二行压住提示。最终样式收紧为单行，工具条以两行保留价格与额度。

## 实际浏览器证据

通过已授权 Edge 扩展完成，未重试此前被拒的原生 App 读取。下表截图均在验收工具输出中展示；没有伪造本地图片路径。

| 项目 | 结果 |
| --- | --- |
| 当前参考 Site | 新标签成功读取 `https://zimage-react-bits-preview.kylethree5.chatgpt.site/workspace/` 并截图；1796px 下侧栏 left28/width256 |
| 首次滚动场景 | 实测 opacity 0.164241→0.378763→0.500413，translateY 23.4013→17.3946→13.9884；第二卡保留延迟，动画仍实际运行 |
| 底部 CTA 动画中首次点击 | opacity0.376678、translateY17.453px 时立即单击，实际进入 `/login?returnTo=%2Fworkspace` |
| 展开侧栏 | 聚焦新对话，tooltip 数量0；截图正常 |
| 折叠侧栏 | width76，导航40/42px、图标17/18px居中；Tab 聚焦显示 tooltip，left=侧栏右边界+10 |
| 模型键盘 | Enter 打开、End/Enter 选 MiniMax、价格同步0.03、焦点归还触发器；点击输入框关闭下拉且保留输入焦点 |
| 手机390×844 | 首页与工作区无横向溢出；顶部51px单行，输入与工具可用；抽屉和图片配置、Seedream 下拉截图检查通过；视口覆写已恢复 |
| 访客首页 | 三个开始创作与顶部登录逐个实点，全部到 `/login?returnTo=%2Fworkspace` |
| 已登录响应首页 | 虚构合法UUID会话响应后登录链接数量0，三个CTA均为 `/workspace` |
| 旧入口 | 浏览器实际 `/chat`、`/image` 均到 `/workspace`；dev流式响应可能为HTTP200，未将其误报307 |

认证浏览器验收使用单独本地编译（formal auth=true、data mode=mock），3101夹具只替换会话身份响应，其他 `/api/` 全部阻断，3102只监听回环。它验证真实编译的导航，不代表真实Supabase登录、验证码、余额或模型服务已经验收。用户预览3100一直使用明确标识的Mock。

参考代码来自 `2450e9a5a95639a0f465534c920e27dc6027abd1`，不能证明与 Site v18 `2f0aaac25e6e85d785b39c50adff497606139f47` 逐字一致；实际页面已核对结构，不宣称像素完全一致。保留 React Bits MIT + Commons Clause 许可。

## 自动检查与环境

- 最终产品代码构建退出0，49/49静态页面：`/tmp/zimage-delivery-build.log`。
- 最终typecheck退出0：`/tmp/zimage-final-typecheck.log`；最终lint退出0：`/tmp/zimage-restored-lint.log`。
- 预算保护5/5：`/tmp/zimage-delivery-budget.log`，未发生真实付费请求。
- 字体27/27：`/tmp/zimage-canonical-font-tests.log`。Mac `/var` 与 `/private/var` 路径别名曾触发字符串比较差异；使用真实canonical TMPDIR后像素和安全断言原样通过。
- Node25.9.0 的实验localStorage为不完整对象。通过官方 `NODE_OPTIONS=--no-experimental-webstorage` 让现有jsdom存储接管；未删除断言、放宽阈值或修改生产storage。
- 独立审查发现空白新会话未重置文档滚动，已用先失败后通过回归修复；用户反馈后的 Reveal/tooltip 专项复审未发现新实质问题。后续指针焦点边界有独立回归与浏览器证据。
- 最终全量退出0：Web **911/911、124文件**（495.66s），Domain **106/106、12文件**；合计1017项通过。日志 `/tmp/zimage-final-full-tests.log`。命令为 `env NODE_OPTIONS=--no-experimental-webstorage TMPDIR=/private/var/folders/m9/8qcc1f1x5278r2bzf8kqn_j80000gn/T pnpm test:run --maxWorkers=2`；只调整本次worker并发，未改测试超时、阈值或断言强度。
- 断连后的旧进程已核实结束。全量曾暴露客户端/服务端旧默认回跳预期，现迁移到已批准的/workspace；恶意地址、私有路由及退出保护断言完整保留。
- 最终窄范围复审未发现新实质问题（指针焦点、手机工具条、账号与登录工作区回链）。测试完成后没有再改产品源码。
- 认证3101/3102临时服务已停止，确认无打开文件后删除 `.next-build-qa`；用户3100的 `.next` 保留，生成的next-env恢复正常dev引用。

## 当前本地预览

`http://127.0.0.1:3100/`、`http://127.0.0.1:3100/workspace`，原始checkout当前未提交代码，Mock模式。公开路由HTTP记录 `/tmp/zimage-delivery-routes.json`：根/home/workspace/login/create/assets200，有效旧scene307，退役batch查询和路径404。
