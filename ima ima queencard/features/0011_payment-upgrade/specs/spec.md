# 0011 支付链路升级 · Payment Upgrade

| 字段 | 内容 |
| --- | --- |
| 状态 | 规格草案，**开放问题较多，动工前必须评审** |
| 建议分支 | `feat/payment-upgrade` → `.trees/payment-upgrade/` |
| 风险等级 | 高（碰钱）。单独 PR、单独细审、可独立回滚 |

## 目标

把支付链路从「测试可用」推进到「生产可靠」：真实收款、webhook 不丢单、
积分结算强一致、退款有据可查。

## 背景（现状）

- 主通道 Creem（当前配置为 **test API**：`test-api.creem.io` + 测试
  Product ID），Stripe 作为 legacy 兜底
- 积分体系已有：credit_packages / credit_holds / credit_transactions /
  payment_fulfillments 表，admin 有手工充值和退款接口
- 关联历史：`features/0004_pricing-payment`（定价与 Creem 迁移）

## 非目标

- 不改定价（价格/档位变动另立 feature）
- 不做发票/税务
- 不动订阅逻辑的产品形态

## 设计

### 1. 测试 → 生产切换

- Creem 生产环境 API key、生产 Product ID 全部走环境变量，代码零硬编码
- 环境自检：启动时校验「生产域名 + 测试 key」这类错配并告警

### 2. Webhook 可靠性

- Creem/Stripe webhook 验签必须强制（拒绝未签名请求）
- 幂等：同一事件重复投递不重复发积分（以 provider 事件 id 去重）
- 失败补偿：webhook 处理失败要可重放（记录原始 payload + 状态机）

### 3. 积分结算一致性

- 下单 → hold → 成功入账 / 失败释放，全链路对账：任何路径都不能出现
  「扣了钱没积分」或「没扣钱有积分」
- 对账脚本：payment_fulfillments 与 credit_transactions 定期核对

### 4. 退款路径

- admin 退款接口打通 provider 端真实退款（当前是否只改本地账？待确认）
- 退款必须写 admin_audit_logs，扣回对应积分（不足则记负）

## 开放问题（评审必答）

- [ ] Creem 生产账号/KYC 是否已就绪？收款主体是谁？
- [ ] Stripe 是保留兜底还是本期下线？
- [ ] 是否需要支持支付宝/微信（决定是否引入新 provider，范围变化巨大）
- [ ] webhook 重放的存储与触发方式（表 + admin 按钮？）
