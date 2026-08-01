# imaima queencard 定价与支付规格

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 需求来源：`specs/w6/0001-imaima-queencard-instruction.md`
- 本文件：`specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-14`
- Artifact role：`pricing-payment-spec`
- 状态：已按当前实现更新（Stripe-first，4 个订阅 + 2 个一次性积分包；GPTProto 实际 5 模型）

## 命名说明

当前工作流采用人工维护的 spec ledger 形式：

```text
specs/{scope}/{optional-project}/000N-{project-slug}-{artifact-type}.md
```

本文件开启独立的定价与支付子链：

```text
specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md
```

## 决策摘要

imaima queencard v1 应采用“付费后生成”的商业模式：

- 匿名用户可以浏览首页、价格页和提示词案例，但在结账、生成、下载前必须登录。
- 已登录但没有可用积分的用户可以浏览和准备提示词，但必须先购买一次性积分包或自动续费订阅，才能使用生成。
- 图片生成成功后，按输出图片张数扣积分。用户重复下载自己已生成的图片，不额外扣积分。
- v1 支付供应商使用 Stripe。
- 银行卡、Link 等可复用支付方式可以使用真正的 Stripe 自动续费订阅。
- 支付宝和微信支付只用于 Stripe Checkout 的 `payment` 模式一次性积分包。原因是标准 Stripe Checkout `subscription` 模式对支付宝和微信支付的支持有限，不能把它们视为稳定的自动续费方式。
- 最终商品结构为：Creator/Studio 月付年付订阅 + Creator/Studio 一次性积分包；`Mini Pack` 不进入 v1 销售入口。
- GPTProto 图片模型密钥只能作为服务端环境变量放在 `frontend/.env.local`；任何图片供应商密钥都不能暴露为 `NEXT_PUBLIC_*`。

## Clarifications

### Session 2026-06-15

- Q: Stripe webhook 履约幂等应使用独立表还是复用积分包订单号？ → A: 新增 `payment_fulfillments` 表，专门记录 Stripe 对象、产品 key、履约状态和幂等键。
- Q: 最终一次性积分包是否保留 Mini/高价 Pack 梯度？ → A: 不保留 Mini Pack；一次性积分包只保留创作者/工作室两档，价格和积分分别对应月付订阅：`¥99/600`、`¥269/1,800`，用于不想自动续费的用户手动补充。
- Q: 价格页默认展示哪个 Tab？ → A: 默认展示“一次性”Tab，同时保留“月付/年付”订阅 Tab。

## 外部资料记录

定价和支付假设核对日期：`2026-06-16`。

人民币价格口径：v1 面向中文用户的前台展示和 Stripe Price 以人民币/CNY 为主；美元价格保留为成本测算和海外支付参考。历史人民币约价按 `1 USD ≈ ¥6.76` 估算，但最终展示价以本 spec 的 `¥99/¥269/¥999/¥2,699` 为准。

- VideoFly 定价模型：https://docs.videofly.app/docs/pricing
- VideoFly 积分系统：https://docs.videofly.app/docs/credits
- GPTProto 模型价格页：https://gptproto.com/model
- GPTProto GPT-Image-2 图像编辑模型页：https://gptproto.com/model/openai/gpt-image-2/image-edit
- GPTProto Gemini 3.1 Flash Image 图像编辑模型页：https://gptproto.com/model/google/gemini-3.1-flash-image-preview/image-edit
- GPTProto Seedream 5.0 图像编辑模型页：https://gptproto.com/model/bytedance/seedream-5-0-260128/image-edit
- GPTProto Doubao Seedream 5.0 图像编辑模型页：https://gptproto.com/model/bytedance/doubao-seedream-5-0-260128/image-edit
- GPTProto Vidu Q2 图生图模型页：https://gptproto.com/model/vidu/viduq2/image-to-image
- GPTProto 文档索引：https://docs.gptproto.com/llms.txt
- GPTProto 认证说明：https://docs.gptproto.com/docs/get-started/get-started/authentication
- GPTProto GPT-Image-2 文生图：https://docs.gptproto.com/docs/allapi/OpenAI/gpt-image-2/official-format/text-to-image
- GPTProto GPT-Image-2 图像编辑：https://docs.gptproto.com/docs/allapi/OpenAI/gpt-image-2/official-format/image-edit
- GPTProto Gemini 3.1 Flash Image 文生图：https://docs.gptproto.com/docs/allapi/Google/gemini-3.1-flash-image-preview/openai-format/text-to-image
- GPTProto Gemini 3.1 Flash Image 图像编辑：https://docs.gptproto.com/docs/allapi/Google/gemini-3.1-flash-image-preview/openai-format/image-edit
- GPTProto Seedream 5.0 图像编辑：https://docs.gptproto.com/docs/allapi/Doubao/seedream-5-0-260128/gptproto-format/image-edit
- GPTProto Vidu Q2 图生图：https://docs.gptproto.com/docs/allapi/Vidu/viduq2/gptproto-format/image-to-image
- APIYI 文档仅保留为历史参考和 fallback：https://docs.apiyi.com/pricing
- Stripe Checkout Sessions：https://docs.stripe.com/api/checkout/sessions
- Stripe 订阅集成设计：https://docs.stripe.com/billing/subscriptions/design-an-integration
- Stripe Webhooks：https://docs.stripe.com/webhooks
- Stripe Customer Portal：https://docs.stripe.com/customer-management/integrate-customer-portal
- Stripe Dynamic payment methods：https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods
- Stripe 支付宝：https://docs.stripe.com/payments/alipay
- Stripe 微信支付：https://docs.stripe.com/payments/wechat-pay
- Stripe 支付方式支持矩阵：https://docs.stripe.com/payments/payment-methods/payment-method-support

## 用户状态

| 用户状态 | 可浏览提示词 | 可创建生成任务 | 可下载生成图片 | 下一步动作 |
|---|---:|---:|---:|---|
| 匿名用户 | 是 | 否 | 否 | 登录 |
| 已登录，无积分 | 是 | 否 | 否 | 购买积分或套餐 |
| 已登录，有一次性积分 | 是 | 是，直到积分耗尽 | 是，仅限自己拥有的输出 | 积分耗尽后充值 |
| 已登录，自动续费订阅 | 是 | 是，直到积分耗尽且订阅有效 | 是，仅限自己拥有的输出 | 默认自动续费，除非取消 |

v1 按 VideoFly 积分系统方法论保留低成本新用户试用赠送：新用户赠送 `2` 积分，有效期 `30` 天。该额度只能覆盖低价试错或工具型能力，不能让用户免费完成一次 `5` 积分及以上的主力模型生成。

## 积分账本

积分是内部账本单位。它的作用是把不同模型的供应商成本标准化，让后续切换模型或调整模型价格时，不必直接修改 Stripe 产品。

核心公式：

```text
credit_unit_price = product_price / product_credits
retail_value_per_image = credit_unit_price * image_credits_charged
gross_margin = (retail_value_per_image - provider_cost_per_image) / retail_value_per_image
credits_charged = model_credits_per_image * output_image_count
```

积分生命周期：

- 一次性积分包有效期为 `365` 天。
- 月度订阅赠送积分有效期为 `30` 天。
- 年度订阅赠送积分有效期为 `365` 天。
- 积分按最早过期优先消耗，也就是 FIFO。
- 生成任务在调用供应商前必须先创建 credit hold。
- 生成成功后，hold 结算为实际消耗。
- 供应商失败、超时、内容审核失败或没有可计费输出时，释放 hold。
- Webhook 履约和积分发放必须按 `payment_fulfillments.fulfillmentKey` 保证幂等，不能只依赖 Stripe event ID。

### VideoFly 积分系统适配口径

VideoFly credits 方法论适合 imaima queencard，但需要从“视频时长/画质”改成“图片模型/输出张数/垫图能力”：

| VideoFly 积分概念 | imaima queencard 适配 |
|---|---|
| 积分为整数账本单位 | 继续使用整数积分，所有发放和扣除都写入不可变流水 |
| 注册赠送积分 | `NEW_USER_GIFT = 2`，有效期 `30` 天，只做低成本试用，不覆盖主力 5 积分模型 |
| 订阅每周期发放积分 | Creator/Studio 订阅在 Stripe paid invoice 后发放周期积分 |
| 一次性购买积分包 | 创作者积分包/工作室积分包通过 Stripe `payment` Checkout 发放，支付宝/微信只走此路径；Mini Pack 下线 |
| 模型消耗规则 | 从视频的 `base + perExtraSecond` 改为图片的 `modelCreditsPerImage * successfulOutputCount` |
| 生成前扣费保护 | 供应商调用前创建 credit hold；成功按实际成功图片数结算，失败或无可计费输出释放 |
| 积分有效期 | 订阅积分随周期过期，月付 `30` 天；年付和一次性积分包 `365` 天 |
| FIFO 消耗 | 按最早过期积分包优先消耗，减少用户可用积分浪费 |
| 管理员积分工具 | v1 至少保留管理员加积分能力；查询和重置可用后台接口或脚本补齐，重置必须只允许管理员显式确认 |

配置分层：

- `src/config/pricing-products.ts` 是销售商品 source of truth：产品 key、Stripe mode、Price env、价格、积分、有效期和订阅 plan 映射。
- `src/config/credits.ts` 是积分经济 source of truth：新用户赠送、过期策略、模型扣积分、积分包视图和扣费计算。
- 这相当于把 VideoFly 的单一 `credits.ts` 拆成“支付商品目录”和“积分账本规则”两层，避免 Stripe Price ID、商品 mode 等支付细节污染模型扣费逻辑。

管理员操作要求：

- 手动赠送积分必须写入 `CreditTransType.SYSTEM_ADJUST` 流水，并包含管理员、原因和过期时间。
- 查询用户积分时必须展示积分包明细、剩余/冻结/已用、过期时间和最近流水。
- 重置用户积分属于危险操作，只允许管理员在测试、迁移或异常处理时显式确认；生产环境优先使用调整流水而不是直接删除历史账本。

## GPTProto 接入与模型成本

v1 图片生成供应商改为 GPTProto-first。APIYI 保留为历史参考和未来 fallback，不作为本 spec 的默认接入路径。

GPTProto 有三类接口形态，但本轮实际接入优先使用用户提供且已在 GPTProto 模型页核对的 v3 JSON endpoint。OpenAI-compatible 路径仅作为 GPT 图像模型的兼容 fallback。

| 接口形态 | 适用模型 | HTTP 接口 | 请求格式 | 返回处理 |
|---|---|---|---|---|
| OpenAI-compatible 文生图 | GPT 图像路径 fallback | `POST https://gptproto.com/v1/images/generations` | JSON，包含 `model`、`prompt`、`size` | 优先读取 `data[].b64_json`，如返回 URL 则下载后入库 |
| OpenAI-compatible 图像编辑 | GPT 图像路径 fallback | `POST https://gptproto.com/v1/images/edits` | `multipart/form-data`，包含 `model`、`prompt`、`image[]` 或模型文档指定图片字段 | 优先读取 `data[].b64_json`，保存为图片资产 |
| GPTProto v3 异步任务 | 本轮实际 5 模型：`gpt-image-2`、`gemini-3.1-flash-image-preview`、`seedream-5-0-260128`、`doubao-seedream-5-0-260128`、`viduq2` | `POST https://gptproto.com/api/v3/{provider}/{model}/{capability}` | JSON，包含 `prompt`、`images`、`aspect_ratio`、`size`、`resolution`、`output_format` 等模型字段 | 保存 task id，轮询查询接口，成功后下载输出 URL 入库 |

常用 GPTProto v3 endpoint：

| 能力 | Endpoint | 核心字段 |
|---|---|---|
| GPT Image 2 图像编辑 | `POST /api/v3/openai/gpt-image-2/image-edit` | `images[]`、`prompt`、`n`、`quality`、`size`、`enable_sync_mode`、`response_format` |
| Gemini 3.1 Flash Image 图像编辑 | `POST /api/v3/google/gemini-3.1-flash-image-preview/image-edit` | `images[]`、`prompt`、`size`、`aspect_ratio`、`output_format`、`enable_sync_mode`、`enable_base64_output` |
| Seedream 5.0 图像编辑 | `POST /api/v3/doubao/seedream-5-0-260128/image-edit` | `images[]`、`prompt`、`size`、`enable_base64_output`、`enable_sync_mode` |
| Doubao Seedream 5.0 图像编辑 | `POST /api/v3/doubao/doubao-seedream-5-0-260128/image-edit` | `images[]`、`prompt`、`size`、`enable_base64_output`、`enable_sync_mode` |
| Vidu Q2 图生图 | `POST /api/v3/vidu/viduq2/image-to-image` | `images[]`、`prompt`、`aspect_ratio`、`resolution`、`seed` |

GPTProto v3 任务返回后，服务端应保存 `data.id`，并优先使用 `data.urls.get` 或 `GET /api/v3/predictions/{id}/result` 轮询结果。

认证规则：

- 所有 GPTProto 请求必须在服务端发起。
- 请求头使用 `Authorization: Bearer ${GPTPROTO_API_KEY}`。
- GPTProto 部分模型页示例写作 `Authorization: GPTPROTO_API_KEY`，但认证页和常规 bearer token 约定应以 `Bearer` 形式实现；如实际测试发现不一致，再在 adapter 层兼容两种格式。
- 不允许存在 `NEXT_PUBLIC_GPTPROTO_API_KEY`。

GPTProto v3 图像编辑示例：

```bash
curl --location 'https://gptproto.com/api/v3/google/gemini-3.1-flash-image-preview/image-edit' \
  --header "Authorization: Bearer $GPTPROTO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "prompt": "把两张参考图的人物融合到同一个办公室场景，做成搞怪扑克牌海报",
    "images": ["https://example.com/reference-1.png", "https://example.com/reference-2.png"],
    "size": "1K",
    "aspect_ratio": "3:4",
    "output_format": "jpeg",
    "enable_sync_mode": false
  }'
```

GPTProto v3 Seedream 图像编辑示例：

```bash
curl --location 'https://gptproto.com/api/v3/doubao/seedream-5-0-260128/image-edit' \
  --header "Authorization: Bearer $GPTPROTO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "prompt": "保持人物身份，替换成复古杂志封面构图",
    "images": ["https://example.com/reference.png"],
    "size": "1024x1360",
    "enable_base64_output": false,
    "enable_sync_mode": false
  }'
```

GPTProto v3 图生图示例：

```bash
curl --location 'https://gptproto.com/api/v3/vidu/viduq2/image-to-image' \
  --header "Authorization: Bearer $GPTPROTO_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{
    "prompt": "保持人物身份，改成夸张、电影感、扑克牌封面构图",
    "images": ["https://example.com/reference.png"],
    "aspect_ratio": "3:4",
    "resolution": "1080p"
  }'
```

模型 adapter 必须把三类返回统一成内部格式：

```ts
type NormalizedImageGenerationResult = {
  provider: "gptproto";
  providerTaskId?: string;
  model: string;
  capability: "text-to-image" | "image-edit" | "image-to-image" | "tool";
  images: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    providerCostUsd?: number;
  };
  raw: unknown;
};
```

下表采用 GPTProto 当前模型页价格作为成本基准。核对日期：`2026-06-16`。由于模型价格会变化，上线前必须重新核对一次。

扣积分校准目标：以最低单积分价格的 `Studio 年付` 为基准，把模型毛利率控制在约 `55%`。由于积分只能取整数，允许最低路径落在 `55-65%` 区间；月付和一次性积分包因为单积分价格更高，毛利会自然高于 55%。

| 产品模型名 | GPTProto 模型/能力 | 实际 endpoint | GPTProto 当前成本 | 人民币成本约 | 每张扣积分 | 说明 |
|---|---|---|---:|---:|---:|---|
| GPT Image 高级 | `gpt-image-2/image-edit` | `/api/v3/openai/gpt-image-2/image-edit` | input `$6.4/M tokens`、output `$24/M tokens`；毛利测算先按 `$0.030/张` 保守预留 | input `¥43.26/M`、output `¥162.24/M tokens`；保守 `¥0.20/张` | `4` | 实际成本必须按返回 `usage.input_tokens` 和 `usage.output_tokens` 记录；如平均成本高于 `$0.033/张`，提高到 `5-6` 积分 |
| Nano Banana 2 主力 | `gemini-3.1-flash-image-preview/image-edit` | `/api/v3/google/gemini-3.1-flash-image-preview/image-edit` | 1K `$0.0402`、2K `$0.0606`、4K `$0.0906`/次 | 1K `¥0.27`、2K `¥0.41`、4K `¥0.61`/次 | 1K `5`、2K `8`、4K `11` | 旧 spec 只写 `5` 积分不够覆盖 4K；本次按分辨率分档 |
| Seedream 5.0 经济 | `seedream-5-0-260128/image-edit` | `/api/v3/doubao/seedream-5-0-260128/image-edit` | `$0.0298/次` | `¥0.20/次` | `4` | 默认经济模型，适合中文图文和高频改图 |
| Doubao Seedream 5.0 | `doubao-seedream-5-0-260128/image-edit` | `/api/v3/doubao/doubao-seedream-5-0-260128/image-edit` | `$0.0298/次` | `¥0.20/次` | `4` | 与 Seedream 5.0 同价，作为可用性 fallback |
| Vidu Q2 图生图 | `viduq2/image-to-image` | `/api/v3/vidu/viduq2/image-to-image` | 1080p `1-3` 图 `$0.032`、`4-7` 图 `$0.040`；2K `1-3` 图 `$0.048`、`4-7` 图 `$0.080`；4K `1-3` 图 `$0.056`、`4-7` 图 `$0.120` | 约 `¥0.22-¥0.81/次` | 1080p `4/5`、2K `6/10`、4K `7/15` | 按分辨率和参考图数量分档；当前 app 最多 3 张参考图，先命中低档 |

接入判断：

- 默认推荐模型顺序：`gemini-3.1-flash-image-preview` 主力、`gpt-image-2` 高级、`seedream-5-0-260128` 经济、`doubao-seedream-5-0-260128` fallback、`viduq2` 图生图。
- 所有按次计费模型上线前都必须做同一提示词、同一参考图、同一尺寸的 API 实测，确认失败是否计费、一次调用是否稳定返回一张图、返回格式是否包含 `b64_json` 或 URL。
- GPT-Image-2 是 token 计费，不能在账本中硬编码为永久 `$0.030/张`；`$0.030/张` 只是当前毛利测算的保守预留值。
- 对用户扣积分保持按张固定档或分辨率固定档，后台另外记录真实 GPTProto 成本，用于 1-2 周后调整模型积分。

下载规则：

- 每张成功输出图片，对应授予一个用户拥有的可下载资产。
- 用户重复下载或导出自己拥有的资产，额外扣 `0` 积分。
- 重新生成、升级到 4K、生成更多变体，属于新的可计费生成任务。

## 最终产品定价

上线套餐保持和当前 `FREE`、`PRO`、`BUSINESS` 业务模型接近，并以 `w6/ima ima queencard/frontend/src/config/pricing-products.ts` 为实现 source of truth：

- `Creator` 映射到当前 `PRO` 业务计划。
- `Studio` 映射到当前 `BUSINESS` 业务计划。
- 一次性积分包允许任何已登录用户购买。
- `Mini Pack` 不进入 v1 销售入口；避免低客单价带来支付手续费占比过高和产品梯度变复杂。

### 自动续费订阅

自动续费订阅适合银行卡、Link、Apple Pay 等 Stripe 支持的可复用支付方式。

| 套餐 | 内部产品 key | Stripe 模式 | 美元参考价 | 人民币价格 | 积分 | 计费周期 | GPT/Seedream 4 积分 | Gemini 1K 5 积分 | Gemini 2K 8 积分 | Gemini 4K 11 积分 | Vidu 2K 6 积分 |
|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|
| Creator 月付 | `creator_monthly` | `subscription` | `$14.90` | `¥99` | `600` | 30 天 | `150` | `120` | `75` | `54` | `100` |
| Creator 年付 | `creator_annual` | `subscription` | `$149` | `¥999` | `7,200` | 365 天 | `1,800` | `1,440` | `900` | `654` | `1,200` |
| Studio 月付 | `studio_monthly` | `subscription` | `$39.90` | `¥269` | `1,800` | 30 天 | `450` | `360` | `225` | `163` | `300` |
| Studio 年付 | `studio_annual` | `subscription` | `$399` | `¥2,699` | `21,600` | 365 天 | `5,400` | `4,320` | `2,700` | `1,963` | `3,600` |

年付价格采用 `月付价格 * 10`，积分采用 `月付积分 * 12`。

### 一次性积分包

一次性积分包用于不想自动续费的用户手动补充积分。v1 为了降低选择成本，只保留与月付订阅对应的两档。

| 积分包 | 内部产品 key | Stripe 模式 | 美元参考价 | 人民币价格 | 积分 | 有效期 | GPT/Seedream 4 积分 | Gemini 1K 5 积分 | Gemini 2K 8 积分 | Gemini 4K 11 积分 | Vidu 2K 6 积分 | 谁可以买 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 创作者积分包 | `credit_creator` | `payment` | `$14.90` | `¥99` | `600` | 365 天 | `150` | `120` | `75` | `54` | `100` | 任意已登录用户 |
| 工作室积分包 | `credit_studio` | `payment` | `$39.90` | `¥269` | `1,800` | 365 天 | `450` | `360` | `225` | `163` | `300` | 任意已登录用户 |

一次性积分包与对应月付订阅同价同积分，但不会自动续费，积分有效期为 `365` 天。订阅仍然通过年付折扣和自动续费便利性成为长期使用的推荐路径。

## 毛利分析

最重要的毛利地板是最便宜的 Studio 年付路径。目标不是把所有销售路径都压到 55%，而是用 Studio 年付这个最低单价路径校准模型积分，保证最低路径约等于或高于 55%；月付和一次性积分包会自然高于 55%。

| 产品路径 | 单积分美元价格 | 单积分人民币约价 | Seedream/Doubao 4积分 | GPT Image 4积分预留 | Gemini 1K 5积分 | Gemini 2K 8积分 | Gemini 4K 11积分 | Vidu 分档最低 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Creator 月付 | `$0.02483` | `¥0.165` | `70.0%` | `69.8%` | `67.6%` | `69.5%` | `66.8%` | `67.8%` |
| Creator 年付 | `$0.02069` | `¥0.139` | `64.0%` | `63.8%` | `61.1%` | `63.4%` | `60.2%` | `61.3%` |
| Studio 月付 | `$0.02217` | `¥0.149` | `66.4%` | `66.2%` | `63.7%` | `65.8%` | `62.8%` | `63.9%` |
| Studio 年付 | `$0.01847` | `¥0.125` | `59.7%` | `59.4%` | `56.5%` | `59.0%` | `55.4%` | `56.7%` |
| 创作者积分包 | `$0.02483` | `¥0.165` | `70.0%` | `69.8%` | `67.6%` | `69.5%` | `66.8%` | `67.8%` |
| 工作室积分包 | `$0.02217` | `¥0.149` | `66.4%` | `66.2%` | `63.7%` | `65.8%` | `62.8%` | `63.9%` |

毛利底线：

- 目标毛利率：`55%`，以 Studio 年付的最低单积分价格为校准口径。
- 上线最低可接受毛利率：`55%`；如果某个默认模型在 Studio 年付路径低于 `55%`，必须先提高该模型扣积分。
- 如果某个核心模型在 Studio 年付路径长期高于 `65%`，并且供应商成本稳定，可以考虑下调该模型扣积分，优先让用户感知到价格优势。
- 如果 GPTProto 实际成本或失败计费率让毛利比预估低超过 `5` 个百分点，优先提高模型扣积分，不要第一时间改 Stripe 售价。
- 不要直接修改已经上线的 Stripe Price。价格调整必须创建 `v2` 产品或 Price，然后逐步迁移。

## Stripe 产品映射

自动续费订阅和一次性积分包需要分别创建 Stripe Price。自动续费 Price 不能复用于 `payment` 模式 Checkout。

推荐 lookup key：

| 内部产品 key | Stripe 模式 | Lookup key |
|---|---|---|
| `creator_monthly` | `subscription` | `imaima_queencard_creator_monthly_v1` |
| `creator_annual` | `subscription` | `imaima_queencard_creator_annual_v1` |
| `studio_monthly` | `subscription` | `imaima_queencard_studio_monthly_v1` |
| `studio_annual` | `subscription` | `imaima_queencard_studio_annual_v1` |
| `credit_creator` | `payment` | `imaima_queencard_credit_creator_v1` |
| `credit_studio` | `payment` | `imaima_queencard_credit_studio_v1` |

创建 Checkout 时，客户端只能传内部产品 key。服务端负责把内部产品 key 映射到 Stripe Price ID 或 lookup key，并且在 webhook 确认付款后，根据本地定价配置发放积分。

## Stripe 支付规则

集成方式：

- 订阅和一次性支付都使用 Stripe Checkout Sessions。
- 真正的自动续费计划使用 Stripe Billing APIs。
- 订阅管理使用 Stripe Customer Portal。
- 订阅 Checkout 不硬编码 `payment_method_types`，优先由 Stripe Dashboard 的 dynamic payment methods 和账号能力决定可用方式。
- 一次性积分包 Checkout 显式请求 `card`、`alipay`、`wechat_pay`，并为微信支付设置 `payment_method_options.wechat_pay.client = "web"`。
- 在 Stripe Dashboard 的 payment method settings 中启用支付宝和微信支付。

币种：

- v1 前台展示和目标 Stripe Price 以 CNY/RMB 为主，美元价格仅作为海外参考和毛利测算辅助。
- 如果某个账号地区或支付方式不支持 CNY，则为对应商品创建同积分的本地币种镜像 Price，但服务端仍用同一个内部产品 key 发放相同积分。
- 不直接修改已经上线的 live Price；任何币种或金额调整都创建新的 Price，并更新对应 `STRIPE_PRICE_*` 环境变量。

Webhook 履约：

| 事件 | 必须执行的动作 |
|---|---|
| `checkout.session.completed` 且 `mode=subscription` | 同步 Stripe customer/subscription 和套餐权益 |
| `invoice.payment_succeeded` | 为已支付周期发放自动续费订阅积分 |
| `customer.subscription.updated` | 同步取消状态、当前周期结束时间和套餐变更 |
| `customer.subscription.deleted` | 结束自动续费权益；不要删除历史积分记录 |
| `checkout.session.completed` 且 `mode=payment` 且 `payment_status=paid` | 发放一次性积分包积分 |
| `checkout.session.async_payment_succeeded` | 如果尚未发放，则发放积分 |
| `checkout.session.async_payment_failed` | 标记支付失败；不发放积分 |
| `charge.refunded` 或 `refund.updated` | 撤回未消耗积分，或创建退款调整记录 |

幂等性：

- 保存每一个已经履约的 Stripe event ID 或 payment object ID。
- 同一个 Stripe session、invoice、payment intent 或 subscription period 绝不能重复发放积分。
- 每一次积分发放都必须包含 `orderNo`、产品 key、权益周期窗口和来源 payment ID。

退款：

- 如果购买的积分完全未使用，移除或过期对应剩余积分包。
- 如果积分已经部分使用，自动退款只退未使用部分，或进入人工审核。
- 如果订阅 invoice 被退款，撤回对应周期中未使用的订阅积分。
- 已经交付的生成图片继续保留在用户历史中，除非账号被判定为欺诈封禁。

## 支付配置 Spec

本节是 imaima queencard 接入 Stripe 的可执行配置规格。当前 w6 代码已经改成 productKey 驱动：客户端只提交内部产品 key，服务端根据 `pricing-products.ts` 映射 Stripe Price ID、Checkout mode、积分和有效期。

### 环境变量

生产和本地都使用同一套服务端环境变量。真实 key 只能放在 `.env.local`、Zeabur/Vercel secrets 或 Stripe/部署平台的 secret 管理里，不能写入前端代码或 `NEXT_PUBLIC_*`。

```dotenv
NEXT_PUBLIC_APP_URL=https://your-domain.com

STRIPE_API_KEY=replace_with_real_stripe_secret_key
STRIPE_WEBHOOK_SECRET=replace_with_real_webhook_secret

STRIPE_PRICE_CREATOR_MONTHLY=price_xxx
STRIPE_PRICE_CREATOR_ANNUAL=price_xxx
STRIPE_PRICE_STUDIO_MONTHLY=price_xxx
STRIPE_PRICE_STUDIO_ANNUAL=price_xxx
STRIPE_PRICE_CREDIT_CREATOR=price_xxx
STRIPE_PRICE_CREDIT_STUDIO=price_xxx
```

本地开发默认 URL：

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:8080
```

Webhook URL：

| 环境 | URL |
|---|---|
| 本地 w6 | `http://localhost:8080/api/webhooks/stripe` |
| 生产 | `${NEXT_PUBLIC_APP_URL}/api/webhooks/stripe` |

### Stripe 商品配置

每个 Price 必须单独创建。订阅 Price 不能复用于一次性 `payment` 模式，一次性积分包也不能复用于 `subscription` 模式。

| 内部产品 key | 商品名 | Stripe 模式 | Stripe Price 类型 | 人民币价格 | 美元参考价 | 发放积分 | 权益天数 | 推荐 env |
|---|---|---|---|---:|---:|---:|---:|---|
| `creator_monthly` | 创作者版月付 | `subscription` | recurring monthly | `¥99` | `$14.90` | `600` | `30` | `STRIPE_PRICE_CREATOR_MONTHLY` |
| `creator_annual` | 创作者版年付 | `subscription` | recurring yearly | `¥999` | `$149` | `7,200` | `365` | `STRIPE_PRICE_CREATOR_ANNUAL` |
| `studio_monthly` | 工作室版月付 | `subscription` | recurring monthly | `¥269` | `$39.90` | `1,800` | `30` | `STRIPE_PRICE_STUDIO_MONTHLY` |
| `studio_annual` | 工作室版年付 | `subscription` | recurring yearly | `¥2,699` | `$399` | `21,600` | `365` | `STRIPE_PRICE_STUDIO_ANNUAL` |
| `credit_creator` | 创作者积分包 | `payment` | one-time | `¥99` | `$14.90` | `600` | `365` | `STRIPE_PRICE_CREDIT_CREATOR` |
| `credit_studio` | 工作室积分包 | `payment` | one-time | `¥269` | `$39.90` | `1,800` | `365` | `STRIPE_PRICE_CREDIT_STUDIO` |

当前代码行为核对：

| 文件 | 当前行为 | 配置影响 |
|---|---|---|
| `w6/ima ima queencard/frontend/src/config/pricing-products.ts` | 维护 6 个可售商品的 key、mode、price、credits、validityDays、stripePriceEnv | 这是定价和积分发放的代码 source of truth |
| `w6/ima ima queencard/frontend/src/env.mjs`、`src/payment/env.mjs` | 声明 6 个 `STRIPE_PRICE_*` 服务端变量 | 生产缺任一已展示商品的 Price ID 会导致无法创建支付链接 |
| `w6/ima ima queencard/frontend/src/services/billing.ts` | `createStripeSession(userId, productKey)` 只接受内部产品 key；服务端解析 Price ID 和 Checkout mode | 客户端不能传 raw `price_`，降低篡改风险 |
| `w6/ima ima queencard/frontend/src/services/billing.ts` | 订阅用 `subscription` Checkout；一次性积分包用 `payment` Checkout | 一次性包可以显示支付宝/微信，订阅依赖 Stripe 可复用支付方式 |
| `w6/ima ima queencard/frontend/src/services/billing.ts` | `payment` 模式显式设置 `payment_method_types = ["card","alipay","wechat_pay"]` 和 `wechat_pay.client = "web"` | 若 Stripe 账号未开通支付宝/微信，创建链接或展示方式会受账号能力限制 |
| `w6/ima ima queencard/frontend/src/payment/subscriptions.ts` | 价格页订阅数据从 `pricing-products.ts` 派生 | 前端展示价格、积分和后端发放一致 |
| `w6/ima ima queencard/frontend/src/payment/webhooks.ts` | 处理订阅同步、订阅 invoice 发积分、一次性付款发积分、异步钱包成功/失败、退款事件 | `STRIPE_WEBHOOK_SECRET` 必须来自同一个 webhook endpoint |
| `w6/ima ima queencard/frontend/src/services/payment-fulfillment.ts` | 用 `payment_fulfillments` 做履约幂等 | 重放 webhook 不应重复发积分 |

### Dashboard 配置清单

Stripe Dashboard 需要完成：

- 截至本次配置核对，当前连接的 Stripe 账号没有可直接复用的 `active=true` Product/Price；上线前必须重新核对 live 模式商品状态。
- 创建 `imaima queencard` 产品和上表 6 个 Prices。订阅 Price 与一次性支付 Price 分开创建，不能复用。
- 为每个 Price 设置稳定 lookup key，参考“Stripe 产品映射”章节中的 `imaima_queencard_*_v1`。
- 不直接修改已经上线的 live Price；调价时创建 `v2` Price，再迁移新用户入口。
- 在 Payment method settings 中启用 dynamic payment methods，并开启银行卡、Link、支付宝、微信支付等符合账号地区和币种条件的支付方式。
- 支付宝/微信的自动续费能力不可当作默认假设。支付宝 recurring 需要审批，微信支付官方属性为不支持 recurring，所以本 spec 只把它们放在 `payment` 模式的一次性积分包里。
- 配置 Customer Portal，允许用户管理订阅、取消订阅、更新支付方式，并把 Creator/Studio 自动续费订阅 Price 加入 Portal 产品目录。
- 创建 Webhook endpoint：`${NEXT_PUBLIC_APP_URL}/api/webhooks/stripe`，复制 signing secret 到 `STRIPE_WEBHOOK_SECRET`。

### Webhook 事件与履约规则

生产 Webhook 至少监听：

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
invoice.payment_succeeded
invoice.paid
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
charge.refunded
refund.updated
refund.failed
```

事件处理规则：

| 事件 | 目标处理 |
|---|---|
| `checkout.session.completed` + `mode=subscription` | 获取 subscription，保存 Stripe customer/subscription/price，初始化当前周期权益 |
| `invoice.payment_succeeded` 或 `invoice.paid` | 对订阅周期幂等发放积分；`orderNo` 建议使用 `invoice.id + subscription.current_period_start` |
| `invoice.payment_failed` | 标记续费失败，保留历史积分，不发放新周期积分 |
| `customer.subscription.updated` | 同步套餐、取消状态、`current_period_end`；用户降级/升级时按 Stripe 当前 Price 决定后续权益 |
| `customer.subscription.deleted` | 结束自动续费权益，把用户计划回落到 `FREE`，历史未过期积分仍按账本规则处理 |
| `checkout.session.completed` + `mode=payment` + `payment_status=paid` | 对一次性积分包幂等发放积分 |
| `checkout.session.async_payment_succeeded` | 处理支付宝/微信等异步钱包最终成功；如果 session 或 payment intent 已履约则跳过 |
| `checkout.session.async_payment_failed` | 标记付款失败，不发放积分 |
| `charge.refunded`、`refund.updated` | 根据退款状态撤回未使用积分或写入退款调整流水 |
| `refund.failed` | 标记退款失败，保持原积分状态，进入人工处理队列 |

幂等键优先级：

| 支付对象 | 幂等键 |
|---|---|
| Checkout Session | `cs:{session.id}:{productKey}` |
| Payment Intent | `pi:{payment_intent}:{productKey}` |
| Subscription invoice | `in:{invoice.id}:{subscriptionId}:{periodStart}` |
| Refund | `re:{refund.id}` |

每次 Stripe 履约必须先写入 `payment_fulfillments`，再发放积分并关联 `credit_packages.orderNo`。只依赖 Stripe event ID 不够，因为 Stripe 可能用不同事件报告同一笔付款。

### 当前实现状态

当前代码已经完成 Stripe-first 的核心支付与积分履约链路：

- `src/env.mjs` 和 `src/payment/env.mjs` 已声明 6 个目标 `STRIPE_PRICE_*` server env。
- `src/config/pricing-products.ts` 已统一维护产品 key、mode、price、credits、validityDays、stripePriceEnv 和订阅 plan 映射。
- `src/services/billing.ts` 的 checkout 入参已从 raw Price ID 改为 `productKey`，服务端根据 product key 决定 `mode`、`price` 和 metadata。
- `src/services/billing.ts` 已支持 `payment` 与 `subscription` 两种 Checkout Session；一次性积分包显式启用 `card`、`alipay`、`wechat_pay`。
- `src/payment/plans.ts` 已把 Stripe Price ID 映射到 Creator/Studio 对应的 `PRO`/`BUSINESS` 计划。
- `src/payment/webhooks.ts` 已处理一次性支付、异步钱包、订阅续费、取消订阅、退款事件。
- `src/services/payment-fulfillment.ts` 和 `payment_fulfillments` 表承担 Stripe webhook 履约幂等。
- 价格页和 checkout 按钮已传内部产品 key，不传 raw `price_`。

上线前剩余工作主要是填入真实 live Price ID、配置 live webhook secret、用 Stripe CLI/Dashboard 重放事件验证到账和幂等。

### Stripe MCP 边界

当前 Stripe MCP/连接器适合做核对，不应被当成完整 Dashboard 替代：

| 能力 | 状态 |
|---|---|
| 读取当前 Stripe 账号信息 | 可用 |
| 查询现有 Products、Prices、Customers、Subscriptions、Invoices | 可用 |
| 根据产品名或 Price ID 核对后台是否已创建 | 可用 |
| 查 Stripe 官方文档和生成集成建议 | 可用 |
| 获取某个已知 `prod_` 或 `price_` 的详细信息 | 可用 |
| 直接创建 Product、Price、Webhook endpoint、Customer Portal 配置 | 当前不作为 MCP 可依赖能力 |
| 启用支付宝/微信、修改 Dashboard 支付方式 | 需要 Dashboard 或明确的 Stripe API 脚本 |
| 写入 `.env.local` 的真实密钥 | 不应由 MCP 执行；由本地 secret 或部署平台 secret 管理 |

上线前核验：

- Stripe live 模式下 `active=true` 的目标 Product/Price 都已存在。
- 每个 Price 的 currency、interval、amount、lookup key 与本 spec 一致。
- Webhook signing secret 来自同一个 live endpoint。
- 使用 Stripe CLI 或 Dashboard 重放测试事件时，重复事件不会重复发放积分。
- 支付宝和微信支付在目标账号地区、币种、Checkout 模式下实际可见；一次性积分包至少要实测 `card`、`alipay`、`wechat_pay` 三条路径。

## GPTProto 环境变量要求

`frontend/.env.local` 必须包含服务端 GPTProto 配置：

```dotenv
IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=replace_with_real_key
GPTPROTO_BASE_URL=https://gptproto.com
GPTPROTO_IMAGE_TIMEOUT_MS=300000
GPTPROTO_POLL_INTERVAL_MS=2000
GPTPROTO_MAX_POLL_ATTEMPTS=120
```

不要使用 `NEXT_PUBLIC_GPTPROTO_API_KEY`。

APIYI 可保留为隐藏 fallback，但不能作为默认供应商：

```dotenv
APIYI_API_KEY=
APIYI_BASE_URL=https://api.apiyi.com
APIYI_IMAGE_TIMEOUT_MS=300000
```

Stripe 配置见“支付配置 Spec”。完整目标态应包含服务端产品映射或 Price ID：

```dotenv
NEXT_PUBLIC_APP_URL=https://your-domain.com
STRIPE_API_KEY=replace_with_real_key
STRIPE_WEBHOOK_SECRET=replace_with_real_secret

STRIPE_PRICE_CREATOR_MONTHLY=
STRIPE_PRICE_CREATOR_ANNUAL=
STRIPE_PRICE_STUDIO_MONTHLY=
STRIPE_PRICE_STUDIO_ANNUAL=
STRIPE_PRICE_CREDIT_CREATOR=
STRIPE_PRICE_CREDIT_STUDIO=
```

真实供应商 key 不应写入本 spec。任何新增 GPTProto key 都只放在本地 `.env.local` 或生产 secret 管理系统中。

## 生成与下载需求

### 用户故事 1：生成前先购买积分

作为已登录创作者，我需要先购买积分包或套餐再生成图片，这样每一次供应商调用都有对应付费来源。

验收场景：

1. 给定匿名访客，当他点击生成时，系统应把他送到登录页，并保留返回路径。
2. 给定已登录但积分为 0 的用户，当他点击生成时，系统应展示定价购买入口，并且不能启动供应商调用。
3. 给定已登录用户完成钱包支付购买积分包，当 Stripe 确认付款后，积分余额应且仅应更新一次。

### 用户故事 2：生成前明确模型成本

作为付费用户，我需要在生成前看到扣积分预估，这样我能判断自己还能生成多少图片。

验收场景：

1. 给定用户选择 GPT Image 2 并生成 `3` 张，当系统估算成本时，UI 应显示 `12` 积分。
2. 给定用户选择 Nano Banana 2 `1K` 并生成 `3` 张，当系统估算成本时，UI 应显示 `15` 积分。
3. 给定用户选择 Nano Banana 2 `4K` 并生成 `2` 张，当系统估算成本时，UI 应显示 `22` 积分。
4. 给定用户选择 Seedream 5.0 或 Doubao Seedream 5.0 并生成 `4` 张，当系统估算成本时，UI 应显示 `16` 积分。
5. 给定用户选择 Vidu Q2 `2K` 且参考图不超过 `3` 张并生成 `2` 张，当系统估算成本时，UI 应显示 `12` 积分。
6. 给定用户选择 Vidu Q2 `4K` 且参考图超过 `3` 张并生成 `1` 张，当系统估算成本时，UI 应显示 `15` 积分。

### 用户故事 3：下载已付费输出

作为付费用户，我需要不重复付费地下载已生成图片，这样我可以正常使用自己已经生成的资产。

验收场景：

1. 给定生成成功并返回 `n` 张图片，当结果展示时，用户应获得 `n` 个自己拥有的可下载资产。
2. 给定同一用户多次下载自己拥有的资产，系统不应额外扣积分。
3. 给定另一个用户尝试下载不属于自己的资产，系统应拒绝访问。

### 用户故事 4：公平处理失败任务

作为用户，我需要失败任务不消耗积分，这样供应商不稳定不会造成不公平扣费。

验收场景：

1. 给定供应商在产生可计费输出前失败，当任务结束时，系统应释放 credit hold。
2. 给定供应商返回的图片数量少于请求数量，系统只应结算成功输出的图片。
3. 给定相同 webhook 或重试回调被接收两次，系统不应重复扣积分。

## 功能需求

- FR-001：系统必须在结账、生成和图片下载前要求用户登录。
- FR-002：系统必须要求用户有正数可用积分，才能启动生成任务。
- FR-003：系统必须在生成前展示预估扣积分。
- FR-004：系统必须根据模型积分表，按成功输出图片张数扣积分。
- FR-005：系统必须在调用 GPTProto 前创建 credit hold，并在任务结束后结算或释放 hold。
- FR-006：系统必须支持适用于银行卡/Link 等支付方式的 Stripe 自动续费订阅。
- FR-007：系统必须支持用于一次性积分包的 Stripe `payment` 模式，并让支付宝/微信只出现在该路径中。
- FR-008：系统必须只在 Stripe 确认付款成功后发放积分。
- FR-009：系统必须保持 Stripe checkout 产品选择由服务端权威决定。
- FR-010：系统必须让用户在积分历史中看到积分发放、扣除、退款和过期。
- FR-011：系统必须允许用户重复下载自己拥有的生成图片，且不额外扣积分。
- FR-012：系统必须阻止用户下载不属于自己的资产。
- FR-013：系统必须确保 GPTProto API key 只存在于服务端。
- FR-014：系统未来调价时必须创建新的 Stripe 产品或 Price，不能直接修改已上线 Price。
- FR-015：系统必须使用 `payment_fulfillments` 表作为 Stripe webhook 履约幂等的唯一权威记录。
- FR-016：系统必须支持新用户低成本试用赠送，默认 `2` 积分、`30` 天有效，并确保赠送逻辑幂等。
- FR-017：系统必须支持管理员手动加积分、查询积分明细和危险重置流程；所有手动调整必须有审计原因。

## 关键实体

| 实体 | 含义 | 关键字段 |
|---|---|---|
| 定价产品 | 可售卖的套餐或积分包 | product key、Stripe price ID、mode、金额、积分、权益天数 |
| 积分包/积分发放 | 用户拥有的积分桶 | user ID、来源、初始积分、剩余积分、过期时间、payment ID |
| 积分流水 | 不可变账本记录 | user ID、类型、积分增减、变更后余额、order ID、task ID |
| 管理员积分操作 | 人工赠送、查询、重置或异常处理 | admin user ID、目标 user ID、操作类型、原因、确认标志 |
| 生成任务 | 一次图片生成尝试 | user ID、模型、提示词、输入图片、请求张数、状态、credit hold |
| 图片资产 | 已生成且可下载的图片 | user ID、task ID、供应商 URL 或存储 URL、尺寸、下载权限 |
| 支付履约记录 | Stripe webhook 幂等履约记录 | provider、object type、object ID、fulfillment key、product key、credits、status、fulfilledAt |

## 实现影响范围

预计会影响的现有区域：

- `frontend/src/config/pricing-products.ts`：维护 Stripe-first 的图片产品配置。
- `frontend/src/config/credits.ts`：实现真实图片模型扣积分计算，不再只返回输出数量。
- `frontend/src/payment/subscriptions.ts`：把当前 Pro/Business 定价改名映射为 Creator/Studio，并增加年付和积分包映射。
- `frontend/src/services/billing.ts`：同时支持 `subscription` 和 `payment` 两种 Checkout Sessions。
- `frontend/src/payment/webhooks.ts`：增加一次性积分包履约、订阅续费积分发放和幂等记录。
- `frontend/src/services/credit.ts`：把 `videoUuid` hold 泛化为 task/image hold，或先建立兼容层。
- `frontend/src/services/gptproto.ts` 或 `frontend/src/services/image-provider.ts`：封装 GPTProto OpenAI-compatible、GPTProto v3 异步任务和返回格式归一化。
- `frontend/src/db/schema.ts`：增加支付履约记录和图片生成任务/资产实体，或把现有 video 表迁移为通用 generation 表。
- `frontend/.env.example`：增加 GPTProto、可选 APIYI fallback 和 Stripe Price ID/lookup key 占位。

## 成功标准

- SC-001：已登录用户可以在 `3` 分钟内完成积分购买或订阅结账。
- SC-002：`100%` 已确认的 Stripe 付款，都按配置精确发放一次积分。
- SC-003：匿名用户或积分不足的已登录用户，产生 `0` 次供应商调用。
- SC-004：`100%` 在产出前失败的生成任务都会释放已冻结积分。
- SC-005：Webhook 成功接收后，用户应在 `10` 秒内看到积分余额变化。
- SC-006：至少 `95%` 的生成尝试在提交前展示正确的扣积分预估。
- SC-007：在保守模型成本表下，最便宜的 Studio 年付路径上线毛利率保持高于 `55%`。

## 当前假设

- 目标 Stripe 账号可以为对应业务所在地启用支付宝和微信支付。
- GPTProto key 可以访问图片模型页列出的 image-edit、text-to-image、image-to-image 能力。
- v1 展示和目标 Stripe Price 以人民币/CNY 为主；如果账号地区限制导致部分支付方式不支持 CNY，则为同积分商品创建对应地区可用币种的镜像 Price。
- 生成资产的存储和 CDN 流量作为运营成本处理，不单独向用户收取下载费用。
- GPTProto 生产环境仍需要配置服务端 secret；APIYI 只作为 fallback，不影响默认模型路由。

## 附录 A：GPTProto 实际接入模型核对

调研目标：按当前要接入的 GPTProto 实际模型核对价格、接口路径和扣积分策略，替换旧版候选模型池。

调研方法：

- 使用 GPTProto 模型页和 curl 示例核对 endpoint、价格和分辨率梯度。
- 核对日期：`2026-06-16`
- 人民币约价：按 `1 USD ≈ ¥6.76` 估算，仅用于内部毛利感知，实际账务以 USD 成本为准。

重要说明：

- GPTProto 页面多数模型展示当前平台价和市场原价。本规格按平台当前价制定积分。
- `gpt-image-2` 是 token 计费，不能按固定每张成本直接等价；当前按 `$0.030/张` 保守成本储备配置 `4` 积分，并要求记录真实 token usage。
- `gemini-3.1-flash-image-preview` 和 `viduq2` 存在分辨率或参考图数量阶梯，扣积分必须随用户选项变化。
- 真实供应商 key 只放 `.env.local` 或生产 secret，不写入 spec、代码、测试 fixture。

### A.1 实际模型清单

| 模型 | GPTProto endpoint | 当前价 | 市场原价 | 人民币约价 | v1 积分 |
|---|---|---:|---:|---:|---:|
| `gpt-image-2/image-edit` | `/api/v3/openai/gpt-image-2/image-edit` | input `$6.4/M tokens`、output `$24/M tokens` | input `$8/M`、output `$30/M` | input `¥43.26/M`、output `¥162.24/M` | `4`/张，按 usage 复核 |
| `gemini-3.1-flash-image-preview/image-edit` | `/api/v3/google/gemini-3.1-flash-image-preview/image-edit` | `1K $0.0402`、`2K $0.0606`、`4K $0.0906`/次 | `1K $0.067`、`2K $0.101`、`4K $0.151`/次 | `¥0.272`、`¥0.410`、`¥0.612`/次 | `5`、`8`、`11`/张 |
| `seedream-5-0-260128/image-edit` | `/api/v3/doubao/seedream-5-0-260128/image-edit` | `$0.0298`/次 | `$0.035`/次 | `¥0.201`/次 | `4`/张 |
| `doubao-seedream-5-0-260128/image-edit` | `/api/v3/doubao/doubao-seedream-5-0-260128/image-edit` | `$0.0298`/次 | `$0.035`/次 | `¥0.201`/次 | `4`/张 |
| `viduq2/image-to-image` | `/api/v3/vidu/viduq2/image-to-image` | `1080p $0.032-$0.040`、`2K $0.048-$0.080`、`4K $0.056-$0.120`/次 | `1080p $0.040-$0.050`、`2K $0.060-$0.100`、`4K $0.070-$0.150`/次 | `¥0.216-¥0.811`/次 | `4/5`、`6/10`、`7/15`/张 |

### A.2 v1 接入优先级

| 层级 | 模型 | 推荐积分 | 原因 |
|---|---|---:|---|
| 默认均衡 | `gemini-3.1-flash-image-preview` | `5/8/11` | 成本和效果平衡，按分辨率定价，适合作为默认参考图编辑模型 |
| 高质量 GPT | `gpt-image-2` | `4` 起 | 复杂提示词和文字能力强，但必须记录 token usage，平均成本超过 `$0.033/张` 后升到 `5-6` |
| 低成本中文 | `seedream-5-0-260128`、`doubao-seedream-5-0-260128` | `4` | 单次成本低，适合中文图文和高频改图 |
| 图生图专项 | `viduq2` | `4-15` | 参考图数量和分辨率影响成本，适合单独作为 image-to-image 入口 |

### A.3 API 实测清单

正式上线前，对上述 5 个模型做同一组样本测试：

| 测试组 | 模型 | 测试目的 |
|---|---|---|
| 中文人物海报 | GPT-Image-2、Nano Banana 2、Seedream 5.0、Doubao Seedream 5.0 | 测中文文字、人物一致性、构图稳定性 |
| 多图融合 | GPT-Image-2、Nano Banana 2、Vidu Q2 | 测两到三张参考图融合能力 |
| 商品图换背景 | Nano Banana 2、Seedream 5.0、Doubao Seedream 5.0 | 测主体保持、边缘、材质、品牌文字 |
| 高分辨率成本 | Nano Banana 2 `2K/4K`、Vidu Q2 `2K/4K` | 验证分辨率阶梯和积分扣减是否匹配真实账单 |

每个模型至少记录：

- 成功率。
- 平均耗时。
- 实际扣费和返回 usage。
- 失败是否扣费。
- 输入图片数量上限。
- 输出尺寸上限。
- 中文文字可读性。
- 人物/商品身份保持。
- 生成结果是否有水印。
- API 返回格式是否适合保存到本地资产库。
