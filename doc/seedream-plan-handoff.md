# Seedream Plan 配置交接

使用 Agent Plan 和精确模型名 `doubao-seedream-5.0-pro`。2026-10-12 用户已允许必要的生产接入，并确认现有套餐足够首轮最多四张且无额外按量费用；生产执行与质量验收状态以 `doc/project-progress.md` 为准。

## 请求和模型

- 图片新选择和默认值只提供此 Plan Pro；聊天保持独立。沿用 2K、五种比例和每张 30 minor 项目价格，注册与目录版本为 `2026-10-12.1`。
- 完整 POST 地址为 `https://ark.cn-beijing.volces.com/api/plan/v3/images/generations`，直接调用，不重复拼接。也接受官方 Base URL `https://ark.cn-beijing.volces.com/api/plan/v3`，只补一次后缀。其他源、按量路径、重复后缀、凭据和查询参数均拒绝。
- 单次一张，最多十张参考图，返回 `b64_json`；省略 Pro 不支持的组图、流式和搜索参数。不把套餐别名替换为标准按量模型 ID，也不自动回退到按量接口。

## 未来安全配置

图片生成由已连接 Supabase 项目 `klmiycyesxnpinxpeqep` 的 `generation-worker` 执行。用户已报告在 [Edge Function Secrets](https://supabase.com/dashboard/project/klmiycyesxnpinxpeqep/functions/secrets) 页面安全填写；当前工具不能独立列出 Secret 名称，不能将配置确认当成请求成功：

| 变量 | 用途 |
|---|---|
| `ZIMAGE_SEEDREAM_PLAN_API_KEY` | 必填，仅新 Plan 图片任务使用。当前示例留空；缺失时在供应商请求前拒绝，不借用其他密钥。 |
| `ZIMAGE_SEEDREAM_PLAN_IMAGE_ENDPOINT` | 可选非敏感地址。省略时使用上述完整 Plan URL，也接受官方 Plan Base URL。 |

模型名固定，不需要另填模型 Secret。示例见 `supabase/functions/.env.example`。真实密钥不能进入浏览器变量、仓库、聊天、命令、日志或发布包；不读回或复制现有生产密钥。

Web 服务端 `ARK_API_KEY` 仍供豆包聊天和文字优化使用，不能用新 Plan Key 覆盖。生成 Worker 原有 `ARK_API_KEY`、Gemini Key 和三项 Seedream 旧模型映射继续保留，供已排队旧任务完成。

## 历史与未来发布

新 Plan ID 与旧 `seedream-5.0-pro` 分开持久保存，避免旧 Pro 任务被更换模型或路由。旧 Flash、4.5、Pro、Gemini 任务仍走原配置；历史结果、冻结价格和旧目录不改写。旧草稿需主动更新模型并保存新版本；已提交请求按原身份恢复，不重复调用或扣款。

新增迁移只切换新准入与价格版本，保留旧价格行和结算。已授权的发布先准备独立 Plan 配置和兼容 Worker，再协调应用迁移与网站发布；迁移后旧 UI 可能收到模型更新提示。完成后另验实际版本、活跃价格目录及旧队列，不把部分上线当作完整完成。存在 Plan 任务时不能回退到无 Plan 支持的旧 Worker；优先保留兼容 Worker 并前向修复。

本地 Mock、隔离 SQL 和请求构造测试不能证明账户已具备 Plan 能力。生成前核验实际网站 SHA、新准入、原图链路和应用请求身份；仅做用户确认的四次，不自动重试或扩样。当前首页图片工具走 `/api/image`、`source=direct`；不能将其报告为后端 `/api/chat` 的 `chat_tool` 验收。

## 官方依据

- [Agent Plan 默认模型](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-shared/references/profile-defaults.md)：明确图片默认模型为点号别名。
- [Agent Plan 视觉接入](https://www.volcengine.com/docs/ark/agent-plan-personal-visual-models)：完整端点与 SDK Base URL。
- [官方 CLI 图片参数](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md)、[图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=en)：参考图、尺寸、Base64 和 Pro 限制。
- [Supabase 生产 Secrets](https://supabase.com/docs/guides/functions/secrets)：Dashboard 配置服务端变量，本次未执行。
