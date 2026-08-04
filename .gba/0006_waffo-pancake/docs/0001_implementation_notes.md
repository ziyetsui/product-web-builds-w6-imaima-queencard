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
