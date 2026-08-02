# Payment Flow 实现与验收记录

## 1. 结论

- 执行时间：2026-08-02（Asia/Shanghai）
- 代码版本：`feat/payment-flow`，代码验收基线 `f8baa4c`
- 环境：本地 Next.js + 隔离 PostgreSQL + Stripe Test Mode + Stripe CLI Webhook 转发
- 主支付渠道：Stripe；Creem 仅在 `NEXT_PUBLIC_BILLING_PROVIDER=creem` 时启用
- A 类：**通过 24/24，失败 0，阻塞 0**
- B 类：**通过 6/12，部分通过 2/12，未执行 4/12**
- 最终结论：**代码闭环通过；Stripe 核心沙箱链路通过；严格定义的全量 Stripe 沙箱闭环尚未完成。**

已实际闭环的主链路为：登录 → 选择商品 → 创建 Stripe Checkout → 测试支付 → 签名 Webhook → 幂等发货 → 余额/历史可读 → 退款 → 取消订阅。未执行的是大积分包、年订阅、Test Clock 续费和失败卡；Portal 取消/返回页面只验证了后端删除事件，没有完成 Portal UI 操作。

## 2. 发现并修复的问题

| 问题 | 影响 | 修复 | 验证 |
| --- | --- | --- | --- |
| 页面支付按钮固定请求 Creem | Stripe 配置正确时仍无法进入 Stripe Checkout | 默认及 `stripe` 配置请求 Stripe；仅显式 `creem` 请求 Creem | 组件测试与真实 Checkout |
| Stripe Checkout 固定声明支付方式 | Dashboard 支付方式配置无法生效，部分地区可能创建失败 | 由 Stripe Dashboard 决定支付方式 | 实际 Checkout 显示银行卡、支付宝、微信支付 |
| Checkout 商品/配置错误信息不完整 | 缺少 Price、用户或 Session URL 时难以定位 | 对 6 个商品、鉴权、Price 和 Session URL 做服务端强校验 | 参数化测试 |
| Webhook Secret/签名缺失时处理不够明确 | 可能进入业务处理或产生模糊错误 | 缺签名或 Secret 立即返回 400，履约零调用 | Route 测试 |
| 幂等检查与发积分不在同一锁定事务 | 并发 Webhook 有重复发货窗口 | 插入 PENDING 后 `FOR UPDATE` 锁行，在同一事务完成积分包、流水和 FULFILLED | 真实 PostgreSQL 三并发测试 |
| Stripe 2026 Invoice 移除了旧字段位置 | 订阅支付成功但日志显示 `Invoice paid without subscription`，首期积分未发放 | 同时兼容旧字段和 `parent.subscription_details`、`pricing.price_details`、line parent | 真实 Invoice 重放 3 次后只发 1 次 |

## 3. 自动化证据

最终验证命令均在 `ima ima queencard/src/` 执行：

| 检查 | 结果 |
| --- | --- |
| `PAYMENT_TEST_DATABASE_URL=… pnpm test` | 21/21 test files；136/136 tests；0 failed |
| PostgreSQL 并发幂等 | 同一履约键并发 3 次，积分包/流水/FULFILLED 最终均为 1 |
| PostgreSQL 原子回滚 | 人为制造流水数值溢出，积分包和完成态新增均为 0 |
| `pnpm run lint` | exit 0，0 errors |
| `pnpm run build:prod` | exit 0；24/24 静态页生成；Stripe/Creem Checkout 与 Webhook 路由均进入构建产物 |
| 迁移 | 隔离数据库执行 0000–0005 全部成功；`payment_fulfillments.fulfillment_key` 唯一约束生效 |
| 敏感信息扫描 | 真实 API Key、Webhook Secret、数据库密码命中 0 |

## 4. Stripe 测试资源核对

6/6 个 Price 均为同一 Stripe 测试账户、`livemode=false`、`active=true`：

| 商品 | 金额/周期 | Price 脱敏后缀 |
| --- | --- | --- |
| creator_monthly | CNY 99 / month | `…ul4frZK` |
| creator_annual | CNY 999 / year | `…ko6peiah` |
| studio_monthly | CNY 269 / month | `…stHoPHW2` |
| studio_annual | CNY 2699 / year | `…chGfF1Kp` |
| credit_creator | CNY 99 / one-time | `…ZPPkDbXG` |
| credit_studio | CNY 269 / one-time | `…MkjqgxpL` |

## 5. 真实沙箱证据

### 5.1 一次性积分包

- 商品：`credit_creator`
- Stripe Checkout：`cs_test_…6a4HZzwB`
- PaymentIntent：`pi_…srLtv9T`
- Checkout 事件：`evt_…WQYZsVtR`
- 支付结果：成功返回 `/pricing?checkout=success&session_id=…`
- 数据结果：欢迎积分 2 + 积分包 600 = 602；ORDER_PAY 流水 1；FULFILLED 1
- Webhook 重放：同一成功事件额外 3 次均为 HTTP 200；余额、积分包、流水均无新增

### 5.2 月订阅

- 商品：`creator_monthly`
- Stripe Checkout：`cs_test_…jOF7qC40D`
- Subscription：`sub_…Z27mpCSz`
- Invoice：`in_…l7aYsJT9`
- 兼容修复后重放同一 Invoice 3 次：3/3 HTTP 200
- 数据结果：余额由 602 变为 1202；SUBSCRIPTION 流水 1；Invoice FULFILLED 1；重复发放 0
- 发放后客户状态：PRO，Subscription ID 与 Price ID 已同步

### 5.3 用户可读状态

使用同一测试用户登录后读取正式 API：

| API | HTTP | 摘要 |
| --- | --- | --- |
| `/api/v1/credit/balance` | 200 | availableCredits=1202；取消订阅后 plan=FREE |
| `/api/v1/credit/history?limit=10` | 200 | 3 条；subscription、order_pay、new_user 各 1 |
| `/api/v1/user/billing?limit=10` | 200 | 2 条；stripe_subscription、stripe_credit_pack 各 1 |

### 5.4 退款

- Refund：`re_…Tnq61Bj`
- `refund.created`、`charge.refunded`、`refund.updated` 均由 Stripe CLI 转发并返回 HTTP 200
- 原支付履约最终状态：REFUNDED
- 同一 `charge.refunded` 事件额外重放 3 次：3/3 HTTP 200
- 重放后积分包 3、积分流水 3、原支付履约行 1：均无新增
- 当前业务合同为“记录退款状态，不反向扣减已发积分”，因此余额保持 1202

### 5.5 取消订阅

- 在 Stripe Test Mode 立即取消订阅
- `customer.subscription.deleted` 事件 `evt_…WCSygIsd` 返回 HTTP 200
- 60 秒内本地方案变为 FREE；Subscription ID、Price ID、周期结束时间 3/3 清空
- 本次使用 Stripe CLI 触发，不计为 B08 的 Portal UI 全通过

### 5.6 Webhook 可达性

以下连续事件均返回 HTTP 200，满足至少连续 5 次成功：

- `evt_…uAMm4gsz` invoice_payment.paid
- `evt_…eTXlJGc` refund.created
- `evt_…8WBgzo1` charge.refunded
- `evt_…UukKwus` refund.updated
- `evt_…zlAcIgT` charge.refund.updated
- `evt_…WCSygIsd` customer.subscription.deleted

## 6. 验收矩阵

### A 类

| 状态 | ID | 证据摘要 |
| --- | --- | --- |
| PASS | A01–A09 | 默认/显式渠道、6 商品、Price、鉴权、防篡改、模式、Portal 分流与 URL 测试 |
| PASS | A10–A13 | 验签、一次性/异步、首期/不同 Invoice 续费键测试；Stripe 2026 真实 Invoice 已验证 |
| PASS | A14–A15 | 真实 PostgreSQL 串行重放、三并发、事务回滚 |
| PASS | A16–A18 | 取消、退款三重放、失败/未知商品/缺 userId 零发货 |
| PASS | A19–A20 | 三个登录态 API 200；迁移与唯一约束通过 |
| PASS | A21–A24 | 全测、lint、生产构建、敏感信息扫描通过 |

### B 类

| ID | 状态 | 说明 |
| --- | --- | --- |
| B01 | PASS | 6/6 Stripe 测试 Price 核对通过 |
| B02 | PASS | 连续 6 个真实事件 6/6 返回 200 |
| B03 | PASS | `credit_creator` 银行卡测试支付，60 秒内 +600 |
| B04 | NOT RUN | 未重复购买 `credit_studio`，代码商品映射已覆盖 |
| B05 | PASS | `creator_monthly` 首期；修复 2026 Invoice 字段后 +600 |
| B06 | NOT RUN | 未创建 `studio_annual` 真实订阅，代码商品映射已覆盖 |
| B07 | NOT RUN | 未建立 Test Clock 推进完整账期；不同 Invoice 幂等键已有自动化覆盖 |
| B08 | PARTIAL | 删除事件和 FREE 同步通过；未从 Billing Portal UI 发起 |
| B09 | PASS | 全额退款后 REFUNDED，积分包/流水零新增 |
| B10 | PASS | Checkout、Invoice、退款事件分别额外重放 3 次均无重复写入 |
| B11 | NOT RUN | 未使用失败测试卡走托管 Checkout；失败事件零发货已有自动化覆盖 |
| B12 | PARTIAL | 登录跳转与成功返回通过；取消和 Portal 返回未执行 |

## 7. 剩余工作

如果要求达到本文严格定义的“B 类 12/12”，仍需在 Stripe Test Mode 补四组真实操作：

1. 购买 `credit_studio`，验证 +1800。
2. 订阅 `studio_annual`，验证 BUSINESS 与 +21600。
3. 使用 Stripe Test Clock 推进一个续费周期。
4. 用失败测试卡验证零写入，并从 Billing Portal 完成取消、cancel URL 和 Portal return URL。

这些项目不再是代码断点；当前 Stripe 主支付、Webhook、发货、幂等、退款和取消同步均已实际跑通。
