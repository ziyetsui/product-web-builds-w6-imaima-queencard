# Waffo Pancake 实现与验收记录

## 已完成

- 安装官方 Pancake Skill 到本机 Codex skills 目录。
- 安装 `@waffo/pancake-ts@0.17.0`。
- 增加 Waffo checkout route、六商品映射和安全托管 URL 白名单。
- 增加原始请求体验签与十类事件处理。
- 复用现有 `payment_fulfillments` 唯一键和事务发放积分机制。
- 保留 Stripe 与 Creem，通过环境变量切换渠道。

## 外部待办

- 将 Merchant ID、PEM 私钥、六个 Product ID 和渠道开关写入 Zeabur。
- 完成一次性支付、订阅首期、重复 webhook 与取消订阅测试。

任何日志、文档和提交都不得保存真实私钥或完整 webhook 载荷。

## Waffo 测试资源（2026-08-04）

- Merchant ID：`MER_6FCSfEgP1oX6A5vmoYz0TS`
- Store：`ima ima queencard`（`STO_2bvXL7lJ3D2g4rc5shaRXs`）
- 测试 Webhook：`https://queencard-imaima.zeabur.app/api/webhooks/waffo`
- Webhook ID：`52007221-f820-4bb9-8f04-3f394194a724`

| productKey | Waffo 测试 Product ID |
| --- | --- |
| `creator_monthly` | `PROD_2dTpHDPfo5nBRRtyZZMIBW` |
| `creator_annual` | `PROD_5ZUfRCSaMhuzpsgkFLClKm` |
| `studio_monthly` | `PROD_4kikBFdByhS2SyZPgr8Srn` |
| `studio_annual` | `PROD_4HPnwuzvBMshUXJyqEKjBb` |
| `credit_creator` | `PROD_1ZrxNKSxJV0y2xM7ix0j8k` |
| `credit_studio` | `PROD_2Fg2b6EE1rvtCe1kpabtdV` |

上述资源均为测试环境资源，未调用 `.publish()`。

## CNY 固定期限会员（2026-08-04）

Waffo 返回 `Currency CNY is not supported for subscription payments`，因此
人民币月付、年付改为一次性购买固定期限会员，不自动续费。原订阅商品保留，
以下四个测试商品用于 CNY checkout：

| productKey | 有效期 | Waffo 一次性 Product ID |
| --- | ---: | --- |
| `creator_monthly` | 30 天 | `PROD_4QhrKp2eXclqdm4UUZQEQm` |
| `creator_annual` | 365 天 | `PROD_3pbe7YcY1cOYk5GZMyH4bP` |
| `studio_monthly` | 30 天 | `PROD_1FwRJKSoDnWF402udL9ADi` |
| `studio_annual` | 365 天 | `PROD_1uq1zYqgSLiQYWkyg5AV76` |

`order.completed` 对会员商品同时写入会员等级、固定到期时间和积分包；重复
webhook 使用同一事件时间计算到期日，并继续由 delivery ID 幂等保护。
