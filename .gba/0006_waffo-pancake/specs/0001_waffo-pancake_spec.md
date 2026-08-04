# Waffo Pancake MoR 接入规范

## 1. 目标

在不移除 Stripe 与 Creem 的前提下，把 Waffo Pancake 作为第三个可切换支付渠道，覆盖现有六个商品、托管收银台、已签名 Webhook、订阅状态同步和幂等积分发放。

本阶段只允许 Waffo 测试环境资源，不发布商品到生产环境，不产生真实扣款。

## 2. 技术选择

- SDK：`@waffo/pancake-ts@0.17.0`。
- SDK 仅在 Next.js Node.js 服务端运行；`WAFFO_PRIVATE_KEY` 不得进入客户端 bundle、日志或 API 响应。
- 客户端通过 `NEXT_PUBLIC_BILLING_PROVIDER=waffo` 选择渠道。
- Checkout Route：`POST /api/billing/waffo/checkout`。
- Webhook Route：`POST /api/webhooks/waffo`。
- 托管结账地址只允许 HTTPS 主机 `pancake.waffo.ai`，并使用 `window.open(url, "_blank", "noopener,noreferrer")` 打开。

## 3. 六个商品合同

| productKey | 类型 | 周期 | USD | 积分 | Waffo 环境变量 |
| --- | --- | --- | ---: | ---: | --- |
| `creator_monthly` | onetime membership | 30 天 | 14.90 | 600 | `WAFFO_PRODUCT_CREATOR_MONTHLY` |
| `creator_annual` | onetime membership | 365 天 | 149.00 | 7,200 | `WAFFO_PRODUCT_CREATOR_ANNUAL` |
| `studio_monthly` | onetime membership | 30 天 | 39.90 | 1,800 | `WAFFO_PRODUCT_STUDIO_MONTHLY` |
| `studio_annual` | onetime membership | 365 天 | 399.00 | 21,600 | `WAFFO_PRODUCT_STUDIO_ANNUAL` |
| `credit_creator` | onetime | 无 | 14.90 | 600 | `WAFFO_PRODUCT_CREDIT_CREATOR` |
| `credit_studio` | onetime | 无 | 39.90 | 1,800 | `WAFFO_PRODUCT_CREDIT_STUDIO` |

Waffo Product ID 必须为 `PROD_` 前缀。客户端只能提交 `productKey`；价格、商品 ID、积分、方案和有效期全部由服务端目录决定。

Waffo 不支持 CNY subscription checkout。Waffo 渠道的四个会员商品必须使用
一次性商品并固定 CNY 结账；月付、年付分别代表 30 天、365 天权益，到期后
由用户手动续费。Stripe 与 Creem 的商品模式保持原有 subscription 合同。

## 4. Checkout 合同

1. Route 先验证登录态和 `productKey`。
2. 服务端读取 `WAFFO_MERCHANT_ID`、`WAFFO_PRIVATE_KEY` 和对应 `WAFFO_PRODUCT_*`。
3. 使用 authenticated checkout，将当前用户 ID 作为 `buyerIdentity`，邮箱作为 `buyerEmail`。
4. `orderMerchantExternalId` 使用唯一请求 ID。
5. `orderMetadata` 写入 `userId`、`productKey`、`mode`、`credits` 和 `requestId`。
6. 在本地建立 `PENDING` 履约记录，再把 SDK 返回的托管 URL 交给客户端。
7. 返回页只展示支付结果，绝不作为发放积分依据。

## 5. Webhook 合同

- 必须读取 `request.text()` 原始请求体。
- 必须读取 `x-waffo-signature`，并通过官方 SDK `client.webhooks.verify()` 验签。
- 验签失败返回 `400`；验签成功立即返回 `200`，使用 Next.js `after()` 完成后续履约。
- 使用 Waffo delivery ID（事件 `id`）生成唯一 `fulfillmentKey`，重复投递不能重复发放积分。

| 事件 | 行为 |
| --- | --- |
| `order.completed` | 一次性商品发放积分 |
| `subscription.activated` | 同步订阅并发放首期积分 |
| `subscription.payment_succeeded` | 同步订阅并发放续期积分 |
| `subscription.canceling` | 保留权益至周期结束并同步状态 |
| `subscription.uncanceled` | 恢复并同步订阅 |
| `subscription.updated` | 同步产品、方案与周期结束时间 |
| `subscription.past_due` | 记录并同步，不立即扣回权益 |
| `subscription.canceled` | 清除活动订阅并恢复 FREE |
| `refund.succeeded` | 记录退款；本阶段不自动追回已消费积分 |
| `refund.failed` | 记录失败，等待人工处理 |

## 6. 必备配置

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_BILLING_PROVIDER=waffo`
- `WAFFO_MERCHANT_ID`
- `WAFFO_PRIVATE_KEY`
- 六个 `WAFFO_PRODUCT_*`
- 可用的 `DATABASE_URL` 与 `BETTER_AUTH_SECRET`
- Waffo Dashboard 中指向 `https://<域名>/api/webhooks/waffo` 的测试 webhook

Webhook 验签公钥由 SDK 内置解析；只有 Waffo 明确要求自定义公钥时才增加 `WAFFO_WEBHOOK_*_PUBLIC_KEY`。

## 7. 验收边界

仓库验收要求：专属单元测试、全量测试、生产构建均通过。外部验收要求：创建六个测试商品、配置测试 webhook、在 Zeabur 写入全部变量，并至少完成一次一次性订单和一次订阅测试支付。生产发布必须另行批准并完成 Waffo 商品发布与真实付款验证。
