> 2026-11-05 最新追加：图片按模型/规格和成功张数固定售价，聊天按可信 token 结算；供应商密钥只由 Supabase Edge 读取。本文早期固定次数计费或 Web 直接读取供应商 key 的描述已被后续改造取代。当前操作边界与关闭条件见 [操作说明](commerce-package-operations.md)，估算见 [价格情景](openai-price-estimates-2026-11-05.md)，最终状态见 [项目进度](project-progress.md)。

# A+整套与OpenAI本地交接（2026-11-05）

本轮仅交付原分支的本地候选。没有生产迁移、密钥修改、付费调用、提交、推送或发布。

## 已确认的产品规则
- 商品实拍与可选风格参考分开分析，推断不能自动成为商品事实；用户检查并确认后再策划。
- 一次授权覆盖分析、策划和用户选择的整套图片张数。先展示并冻结最高金额，按可核实的实际成本加价结算，多余退回。
- 加价初始100%（成本×2），与供应商成本分别版本化配置。至少一张成功时整单最低0.5积分，全部分析/策划成本由成功图片共同承担。
- 出图前取消全退；明确失败不收图片成本；未知结果、用量缺失、实际模型不符、超过授权上限都保持待核对，不猜测扣款或自动重买。
- 浏览器草稿用于继续操作；服务端订单保留财务依据。积分账户可发现当前账号未结算订单，在关闭新购买时仍可读取、核对及出图前取消。

## 开关与成本配置
Web服务端 ZIMAGE_COMMERCE_PACKAGES_ENABLED 默认false；数据库 commerce_package_settings 默认禁用且没有成本版本。没有已批准的实际费率、用途和回执验证，不应启用。
成本使用nano元字符串（1元=1,000,000,000），钱包使用Minor（1积分=100Minor）。固定成本证据、精确返回模型白名单、文本输入/输出预算、图片尺寸档位与额外参考图成本都在报价快照冻结。
当前仅实现已核实的单一文本输入价格档位，输入预算不超过32,000 token；返回cachedInputTokens必须明确为0。缓存命中或无法核实缓存时停止自动结算，后续需要缓存费率方案才能开放该场景。
Seedream Plan的套餐摊销或公开按量价都不能擅自当作本项目生产实际成本。配置须依据用户账户对应计价证据；没有预置生产售价或供应商成本。
SQL迁移仅在隔离127.0.0.1 PostgreSQL执行；兼容shim不能证明真实Supabase扩展、Storage、队列或真实账单已验收。

## OpenAI接入边界
- 普通聊天：gpt-6-astra、gpt-6.1-sol，固定官方Chat Completions端点。
- 普通图片：gpt-image-2.6-sunburst、gpt-image-2.6-flare，固定官方Images API。当前明确1K正方形、medium、PNG；有参考图用multipart edits提交私有图片字节，无公共图片URL。每个生成任务只调用一次上游，仍复用原Worker持久结果和未知结果语义。
- 当前A+套餐成本与尺寸适配仍限定Seedream Plan，不能把OpenAI方图报价套用为A+任意尺寸套餐。
- Web和Worker分别读取自身服务端OPENAI_API_KEY与ZIMAGE_OPENAI_ENABLED，默认false；不可配置为NEXT_PUBLIC_变量。用户自行通过安全服务端入口填写，勿在聊天中发送密钥。
- 新数据库provider记录默认禁用；未预置四模型价格。显式价格版本可通过既有审计管理员入口配置，保留旧身份、请求幂等和数值类型检查。价格发布本身不会启用模型。
- 尚未进行真实OpenAI或视觉调用，模型账户可用性、地域、最终成本和实际供应商回执仍待另行验收。

## 主要验收与运行器
- packages/domain/tests/commerce-package-*.test.ts：高精度报价、事实确认依赖、实际用量、上限、未知状态及快照回放。
- apps/web/tests/commerce-package-*.test.ts*：接口身份与来源检查、单次抢占、响应丢失恢复、用户确认、向导连接和账号发现。
- supabase/tests/run-commerce-packages.mjs：仅临时本机数据库，包/模型/价格SQL断言、旧数据保护及双连接并发守恒；LOCAL_PG_MODULE可指定已安装的embedded-postgres，不接收远程数据库URL。
- supabase/functions/generation-worker：供应商字节、私有参考、请求身份、未知结果、已保存结果恢复及清理回归。
- 不添加浏览器/E2E自动化；未声称浏览器或生产验收完成。

官方接口参考：
https://developers.openai.com/api/docs/guides/image-generation
https://developers.openai.com/api/docs/models/gpt-6-astra
https://developers.openai.com/api/docs/models/gpt-6.1-sol
https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst
https://developers.openai.com/api/docs/models/gpt-image-2.6-flare

## 交付前逐项核对与用户安全配置步骤

四个精确模型ID已逐一检查模型注册、Web解析器或Worker解析器，并对照官方模型页面；这证明代码使用的ID及接口映射，不证明用户账号已有模型权限。

| 用途 | model参数原样传递 | API与运行环境 |
| --- | --- | --- |
| 聊天 | gpt-6-astra | Web服务端，https://api.openai.com/v1/chat/completions |
| 聊天 | gpt-6.1-sol | Web服务端，同上 |
| 普通图片 | gpt-image-2.6-sunburst | Supabase generation-worker，官方Images generations / edits |
| 普通图片 | gpt-image-2.6-flare | Supabase generation-worker，同上 |

电商向导和逐图编辑已排除尚未适配电商输出规格的OpenAI选项；普通生图保留两个OpenAI模型。当前OpenAI普通图片仅支持1024×1024、medium、PNG；A+整套仍使用Seedream Plan。

用户自行安全配置的具体步骤（本轮未执行）：
1. 在自己的OpenAI Platform项目中自行创建或选用API key，不发送到聊天。官方要求把凭据留在服务端环境变量或密钥管理器：[API安全配置](https://developers.openai.com/api/docs/guides/production-best-practices)。
2. zhao Mac本地Web：用自己的编辑器打开 /Users/zhaoyao/Desktop/work_space/Image-web/apps/web/.env.local，仅新增/更新服务端OPENAI_API_KEY，保留既有配置，不用模板覆盖整份文件。git check-ignore已确认该路径被忽略。先保持ZIMAGE_OPENAI_ENABLED=false；不要创建NEXT_PUBLIC_OPENAI_API_KEY。由用户通过原开发服务管理方式重新加载后端环境，本轮没有重启原服务。
3. 图片Worker：确认正确Supabase目标项目，再进入Dashboard的Edge Functions → Secrets，用私密Value输入框添加OPENAI_API_KEY，并保持ZIMAGE_OPENAI_ENABLED=false。该Secret属于项目Edge Function运行环境，不会从本地Web自动同步；本轮没有读取、列出、写入或验证云端Secret。官方说明保存生产Secret会立即生效，无需为Secret本身重新部署；因此这是后续明确授权的配置动作，不在本次执行范围：[Supabase Secrets步骤](https://supabase.com/docs/guides/functions/secrets)。
4. 若后续部署阿里云Web，仓库现有systemd模板指向 /etc/zimage/environment；不要把密钥放进前端产物或GitHub公开构建变量。实际目标服务有效EnvironmentFiles和项目连接本轮未远程核实，不能把模板路径当成已确认的生产现状。
5. 只有用户确认模型权限、批准成本/售价、审核迁移并安排真实验收后，才分别决定Web、Worker、数据库Provider和生成总开关的启用；本轮未自动启用。

关闭条件逐层独立：
- OpenAI聊天：ZIMAGE_OPENAI_ENABLED非true、服务端key缺失/模板值、数据库相应gpt-6-astra或gpt-6.1-sol Provider未启用/不可用、启用积分时缺价格或确认，都会阻止新调用。
- OpenAI图片：Worker的ZIMAGE_OPENAI_ENABLED非true、key缺失、模型/参数不受支持会阻止派发；新迁移把数据库openai Provider初始化为关闭；全局generation_enabled也必须允许生成，其实际既有状态本轮未核实。新模型没有默认价格。
- A+套餐：Web ZIMAGE_COMMERCE_PACKAGES_ENABLED非true、空/禁用的数据库套餐配置、无效/超32000输入预算的费率配置、独立视觉模型映射不符，不能创建新付费套餐。界面通过已授权availability接口判断，不依赖NEXT_PUBLIC编译开关。
- 缓存用量缺失或非零、实际返回模型/用量无法核实、未知结果和超上限会暂停后续付费阶段/自动结算。已有订单读取、发现和出图前取消不要求开启新购买。
以上是代码及迁移默认行为；本轮未读取实际环境文件内容或远端开关，未声称生产当前运行配置已经核实。

尚待审核的本次新增迁移（未应用生产）：
1. 20261105035525_retire_minimax_preserve_history.sql
2. 20261105140000_commerce_package_orders.sql
3. 20261105170000_openai_models_disabled.sql
目标库已应用版本未核实，不能直接盲推全部迁移。应先核对目标项目、备份与当前schema，再按既定受控流程审批实施。

供应商成本配置待办：
- 经核实的图片尺寸档位、额外参考图费用、视觉/策划输入输出费率和真实返回模型白名单，录入private.commerce_package_cost_versions的独立不可变版本。
- 按已确认产品规则发布销售版本：markupBps=10000、minimumMinor=50、actual_capped、include_once_if_any_success、whole_order、successful_images；未来加价变更发布新版本，不重算旧订单。
- 经过审核再绑定private.commerce_package_settings的成本/销售版本；enabled先保留false。当前没有成本发布UI/专用管理命令，需要受控数据库操作；不应直接修改旧版本。
- OpenAI普通聊天/图片的积分单价仍待批准。既有apps/web/scripts/credits-admin.mjs是受控入口，新增身份的price预览及发布应使用完整旧身份、唯一requestId、actor/reason；发布价格不会启用Provider。不得把离线测试中的合成数字当作真实价格。

体验与改动保留：
- 未执行真实浏览器人工操作，也未运行浏览器/E2E自动化；界面证据为React/jsdom单元及集成测试、编译和静态构建。真实浏览器流程、真实模型返回、私有Storage和队列仍未验收。
- 原分支和HEAD未变化；原先未提交的next-env.d.ts两条dev/types导入保留。没有提交、推送、生产变更、实际密钥修改或付费调用。
- 本次最终核验使用verification/final-candidate-before.json与after.json比较代码指纹，并在final-candidate-evidence.json记录exit code和是否变化；实际密钥env文件被排除。最终通过后以该证据替代早期分批测试计数。

最终代码验证：领域257、前端195、Web1289、Worker92、SQL67及全部构建门槛通过；代码指纹3908e6091f602e6aefec99853654beee6b0eff684b9c9fd12d7303d3933b144d前后一致，证据见本任务verification/final-candidate-evidence.json。
