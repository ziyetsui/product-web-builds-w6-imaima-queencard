# Payment Flow Spec

## 1. 文档信息

- 功能编号：`0003_payment-flow`
- 状态：已批准，待实现与验收
- 主支付渠道：Stripe
- 备用支付渠道：Creem，通过 `NEXT_PUBLIC_BILLING_PROVIDER=creem` 显式启用
- 运行应用：`ima ima queencard/src/`
- 关联验收标准：`../docs/0002_payment-flow_acceptance.md`

## 2. 背景与问题

网站已经具备产品目录、Stripe/Creem 下单接口、Webhook、订阅同步、积分发放和支付履约表，但入口与默认配置不一致：项目说明把 Stripe 定义为默认渠道，定价页按钮却固定调用 Creem 接口。结果是 Stripe 即使配置完整，用户也无法从页面进入 Stripe Checkout。

支付功能还必须证明“支付成功只发货一次”。仅能打开收银台不算链路跑通；成功标准是签名回调被接收、订单被幂等处理、订阅或积分状态正确落库，并能由用户接口读回。

## 3. 目标

1. 登录用户可以从 `/pricing` 为任一启用商品创建正确渠道的 Checkout。
2. Stripe 为缺省渠道；Creem 仅在环境变量明确选择时启用。
3. 一次性积分包支付成功后发放对应积分；订阅首期和每次成功续费发放对应周期积分。
4. 重复、乱序或重试的 Webhook 不得重复发放积分。
5. 订阅更新、取消、支付失败和退款均留下可追踪的履约状态。
6. 缺少密钥、商品映射、登录态或合法签名时快速失败，且不得产生错误发货。

## 4. 非目标

- 不在本功能中建设独立后端服务；API 继续由 Next.js Route Handlers 承担。
- 不让用户在页面上手动选择支付渠道。
- 不新增商品、折扣、优惠券、税务计算或多币种换算。
- 不自动执行生产环境真实扣款。
- 退款阶段只记录退款与履约状态，不自动扣回已经消费的积分；积分追偿需要独立业务规则。

## 5. 商品合同

商品唯一标识为 `productKey`。客户端只提交 `productKey`，价格、积分、有效期和渠道商品 ID 必须由服务端映射，禁止接受客户端传入的金额或积分。

| productKey | 模式 | 方案 | 周期 | 积分 | 有效期 |
| --- | --- | --- | --- | ---: | ---: |
| `creator_monthly` | subscription | PRO | 月 | 600 | 30 天 |
| `creator_annual` | subscription | PRO | 年 | 7,200 | 365 天 |
| `studio_monthly` | subscription | BUSINESS | 月 | 1,800 | 30 天 |
| `studio_annual` | subscription | BUSINESS | 年 | 21,600 | 365 天 |
| `credit_creator` | payment | 无 | 一次性 | 600 | 365 天 |
| `credit_studio` | payment | 无 | 一次性 | 1,800 | 365 天 |

所有 6 个商品均为启用状态。Stripe Price ID 必须以 `price_` 开头；Creem Product ID 必须以 `prod_` 开头。

## 6. 目标架构

### 6.1 渠道选择

`CheckoutButton` 读取 `NEXT_PUBLIC_BILLING_PROVIDER`：

- 值为 `creem`：请求 `/api/billing/creem/checkout`。
- 值为 `stripe` 或未设置：请求 `/api/billing/stripe/checkout`。

错误提示必须使用所选渠道名称，不能把 Stripe 配置错误显示成 Creem 错误。

### 6.2 下单链路

1. 用户在 `/pricing` 选择商品。
2. 客户端向渠道 Checkout Route 提交 `{ productKey }`。
3. Route 使用当前会话鉴权；未登录返回 `401`。
4. 服务端从商品目录解析模式、金额映射、积分和有效期。
5. 服务端校验渠道密钥与商品 ID，创建 Checkout Session。
6. 返回 `{ success: true, url }`，浏览器跳转到渠道托管收银台。
7. 支付完成或取消后返回同源 `/pricing`，成功 URL 携带 Checkout Session ID。

### 6.3 Stripe 支付参数

- 订阅商品使用 `mode=subscription`，把 `userId`、`productKey`、`mode`、`credits` 写入 Checkout 和 Subscription metadata。
- 一次性积分包使用 `mode=payment`，把同一组 metadata 写入 Checkout 和 PaymentIntent。
- 已存在 Stripe Customer 时使用 `customer`；否则使用当前登录用户邮箱作为 `customer_email`。
- 一次性商品允许 Stripe Dashboard 已启用且账户支持的支付方式；不支持的方式不得阻止银行卡测试链路。
- 已付费订阅用户再次选择订阅商品时进入 Stripe Billing Portal；购买一次性积分包仍进入 Checkout。

### 6.4 Webhook 与履约

Webhook 地址为 `/api/webhooks/stripe`，必须使用原始请求体、`Stripe-Signature` 和 `STRIPE_WEBHOOK_SECRET` 验签。验签失败返回 `400`，不得调用履约逻辑。

必须处理以下事件：

| 事件 | 行为 |
| --- | --- |
| `checkout.session.completed` | 一次性已支付订单发积分；订阅订单同步 Subscription |
| `checkout.session.async_payment_succeeded` | 异步支付成功后发积分 |
| `checkout.session.async_payment_failed` | 记录跳过原因，不发积分 |
| `invoice.payment_succeeded` | 同步订阅并按该账单发放周期积分 |
| `invoice.payment_failed` | 记录失败，不发积分 |
| `customer.subscription.updated` | 同步方案、Price、周期结束时间和取消状态 |
| `customer.subscription.deleted` | 将本地方案恢复为 FREE 并清除活动订阅字段 |
| `charge.refunded` | 将原履约记录标记为 REFUNDED，不重复创建积分包 |

### 6.5 幂等边界

- 一次性支付优先使用 `stripe:payment_intent:{paymentIntentId}` 作为 `fulfillmentKey`，缺少 PaymentIntent 时使用 Checkout Session ID。
- 订阅积分使用 `stripe:invoice:{invoiceId}` 作为 `fulfillmentKey`。
- `payment_fulfillments.fulfillment_key` 必须有唯一索引。
- 检查履约状态、创建积分包、写积分流水和标记 FULFILLED 必须在同一数据库事务中完成。
- 已处于 FULFILLED、REFUNDED、FAILED 或 SKIPPED 的履约记录不得再次发货。

## 7. 数据状态

支付履约使用 `payment_fulfillments` 记录渠道标识、事件 ID、用户、商品、金额对应积分、错误和状态；积分入账同时写入 `credit_packages` 与 `credit_transactions`；订阅状态写入 Customer 的 Stripe 和通用 Billing 字段。

履约状态语义：

- `PENDING`：已知订单或事件，尚未完成发货。
- `FULFILLED`：积分包与流水已在同一事务中创建。
- `SKIPPED`：事件合法但业务条件不满足，例如支付未成功。
- `FAILED`：事件合法但缺少用户、商品映射或处理异常。
- `REFUNDED`：渠道报告退款，保留原履约关联用于审计。

## 8. 错误处理与安全

- Checkout Route 只接受已登录用户和已启用的 `productKey`。
- 密钥与 Webhook Secret 只在服务端读取，日志和响应不得包含密钥、签名或完整支付载荷。
- 缺少 Stripe API Key、Webhook Secret 或 Price ID 时返回明确的配置错误，不调用渠道 API。
- Webhook 处理失败返回非 `2xx`，允许 Stripe 重试；幂等键保证重试安全。
- 成功返回页不能作为发货依据，发货仅由已验签 Webhook 驱动。
- 客户端不能决定价格、积分、方案、有效期或用户 ID。

## 9. 可观测性

每次 Webhook 处理至少可由以下字段定位：provider、eventId、eventType、fulfillmentKey、userId、productKey、status、errorMessage、fulfilledAt。日志不得记录密钥或支付卡信息。

验收证据保存在 `.gba/0003_payment-flow/docs/`，包括测试命令与结果、沙箱事件 ID、履约记录摘要和未满足的外部依赖。证据只保存脱敏值。

## 10. 配置合同

本地 Stripe 沙箱闭环需要：

- `NEXT_PUBLIC_APP_URL=http://localhost:8080`
- `NEXT_PUBLIC_BILLING_PROVIDER=stripe`，未设置时同样选择 Stripe
- `BETTER_AUTH_SECRET`
- `DATABASE_URL`
- `STRIPE_API_KEY`
- `STRIPE_WEBHOOK_SECRET`
- 6 个 `STRIPE_PRICE_*` 环境变量

生产环境必须使用生产密钥、生产 Price ID、HTTPS 应用地址，以及指向 `/api/webhooks/stripe` 的 Stripe Webhook Endpoint。测试与生产资源不得混用。

## 11. 验证策略

验证分为两层：

1. 仓库内闭环：单元测试、Route 测试、Webhook fixture、幂等与失败注入、lint、生产构建。该层不依赖真实扣款。
2. Stripe 测试模式闭环：真实创建 Checkout、使用测试支付方式、接收已签名事件、查询数据库与用户接口。该层依赖有效 Stripe 测试资源和可连接 PostgreSQL。

只有满足 `0002_payment-flow_acceptance.md` 的强制项，才可判定支付链路跑通。缺少外部配置时，结论必须是“代码闭环通过、沙箱闭环受阻”，不能写成全部通过。
