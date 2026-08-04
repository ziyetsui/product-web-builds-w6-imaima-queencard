# Waffo Pancake 实现与验收记录

## 已完成

- 安装官方 Pancake Skill 到本机 Codex skills 目录。
- 安装 `@waffo/pancake-ts@0.17.0`。
- 增加 Waffo checkout route、六商品映射和安全托管 URL 白名单。
- 增加原始请求体验签与十类事件处理。
- 复用现有 `payment_fulfillments` 唯一键和事务发放积分机制。
- 保留 Stripe 与 Creem，通过环境变量切换渠道。

## 外部待办

- 登录 Waffo Dashboard，确认唯一目标 Store；如果存在多个 Store，必须由用户明确选择。
- 在测试环境创建或匹配六个商品，记录六个 `PROD_` ID。
- 创建测试 webhook，地址为 `/api/webhooks/waffo`，订阅规范列出的十类事件。
- 将 Merchant ID、PEM 私钥、六个 Product ID 和渠道开关写入 Zeabur。
- 完成一次性支付、订阅首期、重复 webhook 与取消订阅测试。

任何日志、文档和提交都不得保存真实私钥或完整 webhook 载荷。
