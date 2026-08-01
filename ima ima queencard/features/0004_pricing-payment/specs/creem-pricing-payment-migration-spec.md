# imaima queencard Creem 定价与支付迁移规格

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 输入规格：`specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md`
- 历史计划：`specs/w6/pricing-payment/0002-imaima-queencard-pricing-payment-impl-plan.md`
- 历史任务：`specs/w6/pricing-payment/0003-imaima-queencard-pricing-payment-implementation-tasks.md`
- 本文件：`specs/w6/pricing-payment/0004-imaima-queencard-creem-pricing-payment-migration-spec.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`creem-pricing-payment-migration-spec`
- 状态：本地 test 环境已开始实现

## 命名说明

当前项目使用 Workstream Manual Spec Chain，而不是标准 Spec Kit feature package。

本文件是 `pricing-payment` 子链的第 4 个文档，用于替代前 3 个文档中的 Stripe-first 支付供应商决策，同时保留已经确认的定价、积分、GPTProto 成本、积分账本和履约幂等原则。

```text
specs/w6/pricing-payment/
├── 0001-imaima-queencard-pricing-payment-spec.md
├── 0002-imaima-queencard-pricing-payment-impl-plan.md
├── 0003-imaima-queencard-pricing-payment-implementation-tasks.md
└── 0004-imaima-queencard-creem-pricing-payment-migration-spec.md
```

## 背景与结论

Stripe 已经在当前代码中跑通，但 Stripe 不适合当前大陆主体上线约束，因此 v1 支付供应商改为 Creem。

新的核心结论：

- `Creem` 成为默认且唯一上线支付供应商。
- Stripe 相关实现保留为历史参考，不再作为 v1 上线依赖。
- 定价和积分经济不重做，沿用 `0001` 已确认的 Creator/Studio 订阅 + Creator/Studio 一次性积分包。
- 前端仍以内部 `productKey` 驱动商品选择，服务端或履约层必须把 Creem Product ID 映射回内部商品配置。
- 积分发放仍由本地账本决定，不能信任前端传入的积分数量，也不能依赖支付跳转成功页发积分。
- 支付成功、订阅续费、退款、争议处理都必须走 webhook 或 Creem/Better Auth 插件回调，并写入 `payment_fulfillments` 做幂等。
- Creem 当前官方资料列出的常见支付方式不包含支付宝/微信支付；v1 不再承诺支付宝/微信路径，除非在 Creem Dashboard live/test 实测确认可用。

## 资料记录

核对日期：`2026-06-15`。

- 现有 Stripe 版 spec：`specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md`
- Goya Creem setup skill：`w5/goya/videofly-template/.claude/skills/pricing-setup/SKILL.md`
- Goya Creem 配置参考：`w5/goya/videofly-template/src/config/pricing-user.ts`
- Goya Better Auth Creem 回调参考：`w5/goya/videofly-template/src/lib/auth/auth.ts`
- Goya Creem 指南：`w5/goya/videofly-template/docs/CREEM-SETUP-GUIDE.md`
- Creem 官方 CLI：https://docs.creem.io/code/cli
- Creem Quickstart：https://docs.creem.io/getting-started/quickstart
- Creem Better Auth 插件：https://better-auth.com/docs/plugins/creem
- Creem Webhooks：https://docs.creem.io/code/webhooks
- Creem One Time Payments：https://docs.creem.io/features/one-time-payment
- Creem Subscriptions：https://docs.creem.io/features/subscriptions/introduction
- Creem Account Reviews：https://docs.creem.io/merchant-of-record/account-reviews/account-reviews
- Creem AI skill 文件说明：https://docs.creem.io/llms-full.txt
- 用户提供教程：https://scys.com/course/detail/146?chapterId=9572

说明：本次浏览 `scys.com` 教程页未返回可读正文，暂只记录为外部参考链接；实现前如需使用其中细节，需要用户提供截图、文字摘录或可访问页面内容。

## Creem CLI 与相关 skill 判断

Creem 官方当前提供 CLI：

```bash
brew tap armitage-labs/creem
brew install creem
creem --version
creem login --api-key creem_test_YOUR_KEY_HERE
creem whoami
```

CLI 能力包括：

- `creem products list|get|create`
- `creem customers list|get|billing`
- `creem subscriptions list|get|cancel|pause|resume`
- `creem checkouts create|get`
- `creem transactions list|get`
- `creem discounts list|get`
- `creem config show|set|get|list`

用于自动化时必须加 `--json`，并先运行 `creem whoami` 确认当前是 test 还是 live 环境。

本机已通过 Homebrew 安装并登录 Creem CLI test 环境。`creem products list --json`
已确认当前 test 环境有 6 个 active 产品，Product ID 已回填到本 spec 和
`frontend/.env.example`/本地 `.env.local`。

2026-06-15 实现记录：

- 已新增 `/api/billing/creem/checkout`，前端购买按钮改为调用该 route。
- 已新增 `/api/webhooks/creem`，使用 `creem-signature` + HMAC-SHA256 校验。
- 已让 `payment_fulfillments` 和 `Customer` 支持 Creem/generic provider 字段。
- 已生成 Drizzle migration：`frontend/src/db/migrations/0002_cultured_doctor_spectrum.sql`。
- 本地 DB 由于已有表但 Drizzle migration ledger 为空，无法直接重放旧 migration；已用幂等 SQL 手动补齐当前 Creem 所需表/列。
- 已用 Creem test API 创建临时 checkout，确认 REST `POST /v1/checkouts` 请求字段可用。
- 待补：在 Creem Dashboard 创建 webhook endpoint 后，把 secret 写入 `CREEM_WEBHOOK_SECRET`。

Creem 官方也提供 AI agent skill 文件：

- `https://creem.io/SKILL.md`
- `https://creem.io/HEARTBEAT.md`

当前 Codex 会话可用技能列表里没有内置 Creem skill。后续如果需要长期维护 Creem，可以把官方 `SKILL.md` 保存为本地项目 skill，但本次迁移不依赖它已经安装。

## 保留的业务模型

以下业务事实从 `0001` 继承，不因支付供应商变化而改变：

- 匿名用户可以浏览首页、价格页和提示词案例。
- 结账、生成、下载前必须登录。
- 已登录无积分用户不能发起供应商生成调用。
- 新用户赠送 `2` 积分，有效期 `30` 天。
- 图片生成前冻结积分，成功按成功输出图片张数结算，失败释放。
- 重复下载自己已经生成的图片不额外扣积分。
- 积分按最早过期优先消耗。
- GPTProto key 只存在服务端环境变量中，不能使用 `NEXT_PUBLIC_*`。

## Creem 商品结构

v1 仍然销售 6 个商品。

Creem Product ID 是商品 ID，不是 Stripe Price ID。它不是 secret，但仍不应作为前端唯一可信输入；履约时必须用 Product ID 反查内部 `productKey`，并以本地配置发放积分。

### 自动续费订阅

| 套餐 | 内部 productKey | Creem billing type | Creem period | USD 价格 | 前台人民币展示 | 积分 | 有效期 | 业务计划 |
|---|---|---|---|---:|---:|---:|---:|---|
| Creator 月付 | `creator_monthly` | `recurring` | `every-month` | `$14.90` | `¥99` | `600` | `30` 天 | `PRO` |
| Creator 年付 | `creator_annual` | `recurring` | `every-year` | `$149` | `¥999` | `7,200` | `365` 天 | `PRO` |
| Studio 月付 | `studio_monthly` | `recurring` | `every-month` | `$39.90` | `¥269` | `1,800` | `30` 天 | `BUSINESS` |
| Studio 年付 | `studio_annual` | `recurring` | `every-year` | `$399` | `¥2,699` | `21,600` | `365` 天 | `BUSINESS` |

### 一次性积分包

| 积分包 | 内部 productKey | Creem billing type | USD 价格 | 前台人民币展示 | 积分 | 有效期 | 谁可以买 |
|---|---|---|---:|---:|---:|---:|---|
| 创作者积分包 | `credit_creator` | `onetime` | `$14.90` | `¥99` | `600` | `365` 天 | 任意已登录用户 |
| 工作室积分包 | `credit_studio` | `onetime` | `$39.90` | `¥269` | `1,800` | `365` 天 | 任意已登录用户 |

### 币种口径

当前 Creem/Goya 模板和 Creem CLI 示例都以 USD 创建产品。v1 默认：

- Creem 后台商品以 `USD` 创建。
- 中文前台继续展示人民币锚定价 `¥99/¥269/¥999/¥2,699`。
- Checkout 页最终显示币种以 Creem 实际配置为准。
- 如果 Creem Dashboard 明确支持 CNY 且 test/live 实测通过，可以创建 CNY 镜像产品；否则不要在 spec 或 UI 中承诺 CNY 结算。

## Creem Product ID 配置

推荐把 `src/config/pricing-products.ts` 从 Stripe 专用改为支付供应商中立配置。

目标字段：

| 字段 | 类型 | 规则 |
|---|---|---|
| `key` | string | 内部稳定 productKey |
| `title` | string | UI 名称 |
| `description` | string | UI 描述 |
| `mode` | `subscription` 或 `payment` | 内部销售模式 |
| `plan` | `PRO`、`BUSINESS` 或 `null` | 本地业务计划 |
| `billingPeriod` | `month`、`year` 或 `null` | 订阅周期 |
| `creemProductId` | string | Creem Product ID，创建商品后回填 |
| `creemBillingType` | `recurring` 或 `onetime` | Creem 商品类型 |
| `creemBillingPeriod` | `every-month`、`every-year` 或 `null` | Creem 周期 |
| `priceUsd` | number | Creem 后台美元价格 |
| `priceCny` | number | 中文 UI 展示锚定价 |
| `credits` | number | 本地发放积分 |
| `validityDays` | number | 积分有效期 |
| `popular` | boolean | 推荐标记 |
| `enabled` | boolean | 禁用旧商品时不删除 |
| `features` | string[] | UI 权益 |

建议移除或废弃：

- `stripePriceEnv`
- `resolveStripePriceId`
- `getProductByStripePriceId`
- `STRIPE_PRICE_*` 依赖

新增或替换：

- `resolveCreemProductId(productKey)`
- `getProductByCreemProductId(creemProductId)`
- `getSubscriptionPricingProducts()`
- `getCreditPackPricingProducts()`

## Creem 后台创建清单

可以用 Dashboard 手动创建，也可以用 CLI 创建。首次迁移建议先使用 test API key 创建 test 产品并回填，完整跑通后再切 live。

CLI 示例：

```bash
creem whoami

creem products create \
  --name "Creator Plan" \
  --description "600 credits/month for imaima queencard creators" \
  --price 1490 \
  --currency USD \
  --billing-type recurring \
  --billing-period every-month \
  --tax-category saas \
  --tax-mode inclusive \
  --json

creem products create \
  --name "Creator Credit Pack" \
  --description "600 credits, one-time purchase for imaima queencard" \
  --price 1490 \
  --currency USD \
  --billing-type onetime \
  --tax-category saas \
  --tax-mode inclusive \
  --json
```

待创建产品：

| 内部 productKey | Creem 名称 | CLI price | billing type | billing period | Product ID |
|---|---|---:|---|---|---|
| `creator_monthly` | `Creator Plan` | `1490` | `recurring` | `every-month` | `prod_5oY1tymF5Z1BVzSf6senQ9` |
| `creator_annual` | `Creator Plan (Yearly)` | `14900` | `recurring` | `every-year` | `prod_3Vp6IL6sR9WcILqBmjJJQY` |
| `studio_monthly` | `Studio Plan` | `3990` | `recurring` | `every-month` | `prod_2WqxlnsxI13bcwFVj0dDJx` |
| `studio_annual` | `Studio Plan (Yearly)` | `39900` | `recurring` | `every-year` | `prod_5rdfSAfjwkc4c0v3WuvW5e` |
| `credit_creator` | `Creator Credit Pack` | `1490` | `onetime` | `null` | `prod_MpQpZNBEIqYQLDWlqOWXp` |
| `credit_studio` | `Studio Credit Pack` | `3990` | `onetime` | `null` | `prod_55Wb84h6LVWyXfH9ABlnwu` |

回填规则：

- test 环境 Product ID 只用于本地和测试部署。
- live 环境 Product ID 用于生产部署。
- 不要把 test Product ID 和 live API key 混用。
- 如果需要同时保留 test/live，使用不同配置文件或环境分支，不要在同一个运行时自动猜测。

## Checkout 规则

目标体验：

- 未登录用户点击购买时进入登录。
- 已登录用户点击商品时创建 Creem checkout。
- 支付成功后返回 `/pricing?checkout=success` 或 `/credits?payment=success`。
- 积分余额只在 webhook/插件回调完成后变化；成功页只展示等待或刷新提示，不直接发积分。

优先实现路径：

1. 安装并启用 `@creem_io/better-auth` 和 `@creem_io/better-auth/client`。
2. 在 Better Auth server 配置中加入 `creem()` 插件。
3. 在 auth client 中加入 `creemClient()`。
4. 价格按钮调用 Creem checkout。
5. 回调中用 `product.id` 反查本地商品配置并发积分。

安全约束：

- 前端不传积分数。
- 前端不传价格。
- 如果前端必须传 `productId`，履约时仍必须以本地 `getProductByCreemProductId(product.id)` 为准。
- 更理想的路径是保留 w6 现有 `productKey` API：前端只传 `productKey`，服务端验证登录和商品状态后创建 Creem checkout。
- metadata 必须包含 `userId` 或 Creem/Better Auth 可识别的 `referenceId`，还应包含 `productKey` 方便排查。
- 如果 metadata 中的 `productKey` 与 webhook product id 反查结果不一致，必须拒绝履约并标记 `FAILED`。

## Webhook 与履约规则

Creem 官方事件至少包括：

```text
checkout.completed
subscription.active
subscription.paid
subscription.canceled
subscription.scheduled_cancel
subscription.past_due
subscription.expired
subscription.trialing
subscription.paused
subscription.update
refund.created
dispute.created
```

v1 目标处理：

| 事件/回调 | 动作 |
|---|---|
| `checkout.completed` + `onetime` | 幂等发放一次性积分包 |
| `subscription.active` | 同步 Creem customer/subscription/product 和本地计划；不单独重复发放已由 `subscription.paid` 发放的积分 |
| `subscription.paid` | 按已支付周期幂等发放订阅积分 |
| `subscription.update` | 同步产品、周期结束时间、状态 |
| `subscription.scheduled_cancel` | 标记订阅将在周期末取消；用户保留当前周期权益 |
| `subscription.canceled` | 结束自动续费权益；未过期积分仍按账本规则保留 |
| `subscription.past_due` | 标记续费失败；不发放新周期积分 |
| `subscription.expired` | 将本地计划回落到 `FREE`，保留历史流水 |
| `subscription.paused` | 暂停自动续费权益；不删除积分历史 |
| `refund.created` | 撤回未使用积分或写入退款调整流水 |
| `dispute.created` | 标记风险订单，暂停后续自动权益，进入人工审核 |

如果使用 Better Auth Creem 插件：

- `onCheckoutCompleted` 只处理 `onetime` 商品。
- `onGrantAccess` 只处理订阅授权/续费，并且必须能构造稳定的周期级幂等键。
- 不允许使用 `Date.now()` 作为最终履约幂等键。
- 如果插件回调无法提供稳定的 order、transaction、subscription period 信息，则必须改用 Creem webhook route 或 SDK 事件对象处理。

## 幂等键规则

`payment_fulfillments.fulfillmentKey` 仍是唯一履约权威。

推荐键：

| 支付对象 | 幂等键 |
|---|---|
| 一次性订单 | `creem:order:{orderId}:{productKey}` |
| Checkout fallback | `creem:checkout:{checkoutId}:{productKey}` |
| 订阅周期付款 | `creem:subscription-paid:{subscriptionId}:{transactionId}:{productKey}` |
| 订阅周期 fallback | `creem:subscription-period:{subscriptionId}:{periodStart}:{productKey}` |
| 退款 | `creem:refund:{refundId}` |
| 争议 | `creem:dispute:{disputeId}` |

稳定字段优先级：

1. Creem event id 或 transaction id。
2. order id。
3. checkout id。
4. subscription id + period start。

不得使用：

- `Date.now()`
- 随机数
- 只包含 `userId + productKey` 的键

## 数据库迁移要求

当前 w6 已有 `payment_fulfillments`，但字段偏 Stripe。Creem 迁移应把它泛化，而不是重新创建一个平行表。

建议新增字段：

| 字段 | 用途 |
|---|---|
| `provider_customer_id` | Creem customer id |
| `provider_subscription_id` | Creem subscription id |
| `provider_checkout_id` | Creem checkout id |
| `provider_order_id` | Creem order id |
| `provider_transaction_id` | Creem transaction id |
| `provider_refund_id` | Creem refund id |
| `provider_dispute_id` | Creem dispute id |
| `provider_product_id` | Creem Product ID |

保留字段：

- `provider`
- `event_id`
- `event_type`
- `fulfillment_key`
- `product_key`
- `user_id`
- `credits`
- `credit_package_id`
- `status`
- `metadata`

Stripe 字段可暂时保留为 legacy，不在 Creem 路径写入。

本地用户订阅状态建议从 Stripe 专用字段泛化：

| 当前字段 | 目标 |
|---|---|
| `stripeCustomerId` | 保留 legacy，新增 `billingCustomerId` 或 `creemCustomerId` |
| `stripeSubscriptionId` | 保留 legacy，新增 `billingSubscriptionId` 或 `creemSubscriptionId` |
| `stripePriceId` | 保留 legacy，新增 `billingProductId` 或 `creemProductId` |
| `stripeCurrentPeriodEnd` | 保留 legacy，新增 `billingCurrentPeriodEnd` |

如果使用 Better Auth Creem 插件的 `persistSubscriptions: true`，必须确认 Drizzle schema/migration 中包含插件需要的 Creem subscription 表。当前历史迁移里曾有 `creem_subscriptions`，后续 Stripe 迁移又 `DROP TABLE`；Creem 迁移需要重新生成或手写对应 migration，不能假设表还存在。

## 环境变量

目标 `.env.local`：

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:8080
NEXT_PUBLIC_BILLING_PROVIDER=creem

CREEM_API_KEY=creem_test_xxx
CREEM_WEBHOOK_SECRET=whsec_xxx

IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=replace_with_real_key
GPTPROTO_BASE_URL=https://gptproto.com
GPTPROTO_IMAGE_TIMEOUT_MS=300000
GPTPROTO_POLL_INTERVAL_MS=2000
GPTPROTO_MAX_POLL_ATTEMPTS=120
```

生产环境：

```dotenv
NEXT_PUBLIC_APP_URL=https://your-production-domain.com
NEXT_PUBLIC_BILLING_PROVIDER=creem

CREEM_API_KEY=creem_xxx
CREEM_WEBHOOK_SECRET=whsec_xxx
```

废弃：

```dotenv
STRIPE_API_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_CREATOR_MONTHLY=
STRIPE_PRICE_CREATOR_ANNUAL=
STRIPE_PRICE_STUDIO_MONTHLY=
STRIPE_PRICE_STUDIO_ANNUAL=
STRIPE_PRICE_CREDIT_CREATOR=
STRIPE_PRICE_CREDIT_STUDIO=
```

废弃变量不要立即删除生产配置，先确保代码不再读取它们；上线稳定后再清理。

## 代码改造范围

| 文件/模块 | 目标变化 |
|---|---|
| `package.json` | 新增 `@creem_io/better-auth`；如采用 SDK 路线，再新增 `creem_io` 或 `@creem_io/nextjs` |
| `src/lib/auth/auth.ts` | 加入 Creem plugin、onGrantAccess、onCheckoutCompleted/onRevokeAccess |
| `src/lib/auth/client.ts` | 加入 `creemClient()` 并导出 `creem` |
| `src/env.mjs`、`src/lib/auth/env.mjs` | 新增 `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`NEXT_PUBLIC_BILLING_PROVIDER` |
| `src/config/billing-provider.ts` | 默认 provider 改为 `creem` |
| `src/config/pricing-products.ts` | 从 Stripe Price env 改成 Creem Product ID/catalog |
| `src/components/common/checkout-button.tsx` | 调用 Creem checkout 或新的 Creem checkout API |
| `src/components/pricing/pricing-panel.tsx` | 保持 productKey 入口，展示文字不变 |
| `src/services/billing.ts` | 重命名或新增 `createCreemCheckout`；Stripe session 创建变 legacy |
| `src/app/api/billing/stripe/checkout/route.ts` | 废弃或替换为 `/api/billing/creem/checkout` |
| `src/payment/webhooks.ts` | Stripe webhook 变 legacy；Creem webhook/plugin 回调成为主路径 |
| `src/services/payment-fulfillment.ts` | provider 字段支持 `creem`，写入 generic provider ids |
| `src/services/customer.ts` | 新增 Creem/generic customer/subscription 更新方法 |
| `src/db/schema.ts`、migrations | 泛化 payment fulfillments，必要时恢复 Creem subscription persistence |
| tests | 重写 Stripe checkout/webhook 测试为 Creem checkout/webhook/插件回调测试 |

## 测试要求

单元测试：

- `pricing-products` 能通过 `productKey` 找到 Creem Product ID。
- 未配置 Product ID 时不会创建 checkout。
- 一次性积分包 checkout 成功后 metadata 包含 `userId/referenceId` 和 `productKey`。
- `checkout.completed` 重放不会重复发放积分。
- `subscription.paid` 重放不会重复发放积分。
- 同一订阅不同周期会分别发放积分。
- `subscription.past_due` 不发积分。
- `refund.created` 对未使用积分撤回或写入退款流水。
- metadata productKey 与 Creem product id 不一致时拒绝履约。

集成/手工测试：

- Creem test key 下 6 个产品都能创建 test checkout。
- 测试卡 `4242 4242 4242 4242` 可完成一次性积分包购买。
- 测试订阅购买后，用户计划更新为 `PRO` 或 `BUSINESS`。
- Creem Customer Portal 能打开，用户能取消订阅。
- Webhook endpoint 返回 200，重复发送同一事件不重复发积分。
- Zeabur 生产环境变量配置后，checkout success URL 和 webhook URL 都使用生产域名。

上线前合规检查：

- 产品公开页面能清楚说明 imaima queencard 在卖什么。
- 定价可见。
- Terms、Privacy、Refund policy 可访问。
- 支持邮箱在官网和 Dashboard 中可见。
- 用户能从产品内进入 Customer Portal 或取消订阅入口。
- AI 图像/视频产品需要按 Creem account review 要求确认是否接入 Creem Moderation API；若暂未接入，必须在上线风险中标注。

## Zeabur 配置提示

使用 Zeabur 时，环境变量应通过 Zeabur service variables 配置。

需要新增/更新：

```text
NEXT_PUBLIC_BILLING_PROVIDER=creem
CREEM_API_KEY=...
CREEM_WEBHOOK_SECRET=...
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

注意：

- 不要用 Zeabur CLI 的 `variable env` 覆盖整套变量，除非确认 `.env` 包含服务所需全部变量。
- 生产 webhook URL 目标应为 `${NEXT_PUBLIC_APP_URL}/api/auth/creem/webhook`，如果采用自定义 route 则为 `${NEXT_PUBLIC_APP_URL}/api/webhooks/creem`。
- 更新变量后需要重启服务。

## 迁移非目标

本迁移不做：

- 重新设计积分经济。
- 修改 GPTProto 模型扣积分。
- 引入 seat-based billing。
- 引入 affiliate、coupon、license key。
- 自动把 Stripe live 用户迁移到 Creem 订阅。
- 保证支付宝/微信支付可用。
- 在 spec 阶段安装、登录或操作 Creem CLI。

## 验收标准

1. 用户可以在 Creem test 环境完成 Creator/Studio 订阅 checkout。
2. 用户可以在 Creem test 环境完成 Creator/Studio 一次性积分包 checkout。
3. 支付成功后，积分只由 webhook/插件回调发放，重复事件不会重复发放。
4. 订阅续费按周期发放积分，取消或过期不会删除历史积分。
5. 退款和争议有可追踪的 fulfillment 记录，并不会让用户余额变成不可解释的负数。
6. 前端不再调用 Stripe checkout route。
7. 生产环境不再要求 `STRIPE_API_KEY` 或 `STRIPE_PRICE_*` 才能完成 checkout。
8. `pnpm test` 和 `pnpm run lint` 通过。
9. Creem Dashboard 或 CLI 中 6 个 live 产品的价格、周期和 Product ID 与本 spec 一致。
10. Zeabur 生产环境配置了 `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET` 和正确 `NEXT_PUBLIC_APP_URL`。

## 实现顺序建议

1. 安装 Creem 依赖并接入 Better Auth client/server 插件。
2. 将 `pricing-products.ts` 改为 Creem Product ID 驱动。
3. 用 Creem test API key 创建 6 个 test 产品并回填 Product ID。
4. 改造 checkout button 和 checkout API。
5. 改造 fulfillment 服务为 provider-generic。
6. 写 Creem onetime/subscription/refund/dispute 履约测试。
7. 本地跑通 checkout + webhook。
8. 在 Zeabur 配置 test 环境变量，跑 staging。
9. 通过 Creem account review 后创建 live 产品。
10. 切换生产到 live key 和 live Product ID。
