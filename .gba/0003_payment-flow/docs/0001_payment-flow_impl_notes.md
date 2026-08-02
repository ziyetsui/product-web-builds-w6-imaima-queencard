# Payment Flow 实现与验收记录

## 1. 结论

- 执行时间：2026-08-02（Asia/Shanghai）
- 代码版本：`feat/payment-flow`，本轮验收代码基线 `a5015e3`
- 环境：本地 Next.js + 隔离 PostgreSQL + Stripe Test Mode + Stripe CLI Webhook 转发
- 主支付渠道：Stripe；Creem 仅在 `NEXT_PUBLIC_BILLING_PROVIDER=creem` 时启用
- A 类：**通过 24/24，失败 0，阻塞 0**
- B 类：**通过 12/12，失败 0，阻塞 0**
- 最终结论：**代码闭环与 Stripe Test Mode 全量沙箱闭环均通过。**

已实际闭环的主链路为：登录 → 选择商品 → 创建 Stripe Checkout → 成功或拒付 → 签名 Webhook → 幂等发货或失败审计 → 余额/历史/订阅状态可读 → 退款 → Billing Portal 周期末取消 → Test Clock 到期删除。一次性大小积分包、月/年订阅首期、续费、失败卡以及成功/取消/Portal 三类返回地址均有真实 Stripe 沙箱证据。

## 2. 发现并修复的问题

| 问题 | 影响 | 修复 | 验证 |
| --- | --- | --- | --- |
| 页面支付按钮固定请求 Creem | Stripe 配置正确时仍无法进入 Stripe Checkout | 默认及 `stripe` 配置请求 Stripe；仅显式 `creem` 请求 Creem | 组件测试与真实 Checkout |
| Stripe Checkout 固定声明支付方式 | Dashboard 支付方式配置无法生效，部分地区可能创建失败 | 由 Stripe Dashboard 决定支付方式 | 实际 Checkout 显示银行卡、支付宝、微信支付 |
| Checkout 商品/配置错误信息不完整 | 缺少 Price、用户或 Session URL 时难以定位 | 对 6 个商品、鉴权、Price 和 Session URL 做服务端强校验 | 参数化测试 |
| Webhook Secret/签名缺失时处理不够明确 | 可能进入业务处理或产生模糊错误 | 缺签名或 Secret 立即返回 400，履约零调用 | Route 测试 |
| 幂等检查与发积分不在同一锁定事务 | 并发 Webhook 有重复发货窗口 | 插入 PENDING 后 `FOR UPDATE` 锁行，在同一事务完成积分包、流水和 FULFILLED | 真实 PostgreSQL 三并发测试 |
| Stripe 2026 Invoice 移除了旧字段位置 | 订阅支付成功但日志显示 `Invoice paid without subscription`，首期积分未发放 | 同时兼容旧字段和 `parent.subscription_details`、`pricing.price_details`、line parent | 真实 Invoice 重放 3 次后只发 1 次 |
| 失败 PaymentIntent 没有履约审计记录 | 拒付虽未发货，但无法由数据库证明事件已被安全处理 | 对终态失败事件写入 SKIPPED fulfillment，保留失败原因且不创建积分包/流水 | `card_declined` / `generic_decline` 真实拒付，零发货 |
| 前端可接受服务端返回的任意绝对 URL | 被篡改的 Checkout 响应可能造成开放重定向 | 只允许同源应用 URL、Stripe Checkout 与 Stripe Billing Portal 的 HTTPS 域名 | URL allowlist 回归与三类真实返回地址 |
| 账单 API 只返回本地历史，缺少当前订阅状态 | Portal 周期末取消后用户无法确认 `cancel_at` 与状态 | 正式 billing API 合并 Stripe 当前订阅状态并保留本地账单记录 | Test Clock Portal 取消前后 API 实读 |
| Pricing 成功参数可由用户自行拼接 | 页面会把未经 Stripe 验证的查询参数描述为付款完成 | 文案改为“正在确认”，不再把 URL 参数当作支付成功证明 | 页面回归测试 |
| Billing Portal 域名被 Checkout allowlist 拒绝 | 创建 Portal 成功但浏览器不能跳转 | 加入 Stripe Billing Portal HTTPS 域名，同时继续拒绝非 Stripe 外域 | Portal UI 真实打开并正常返回 |
| Stripe 2026 计划取消只提供 `cancel_at` | 旧逻辑只读取 `cancel_at_period_end`，导致 API 漏报待取消 | 同时识别 `cancel_at_period_end` 和非空 `cancel_at` | Test Clock 周期末取消、到期删除与本地清理 |

## 3. 自动化证据

最终验证命令均在 `ima ima queencard/src/` 执行：

| 检查 | 结果 |
| --- | --- |
| `PAYMENT_TEST_DATABASE_URL=… pnpm test` | 22/22 test files；162/162 tests；0 failed |
| PostgreSQL 并发幂等 | 同一履约键并发 3 次，积分包/流水/FULFILLED 最终均为 1 |
| PostgreSQL 原子回滚 | 人为制造流水数值溢出，积分包和完成态新增均为 0 |
| `pnpm run lint` | exit 0，0 errors |
| `pnpm run build:prod` | exit 0；24/24 静态页生成；Stripe/Creem Checkout 与 Webhook 路由均进入构建产物 |
| 迁移 | 隔离数据库执行 0000–0005 全部成功；`payment_fulfillments.fulfillment_key` 唯一约束生效 |
| 敏感信息扫描 | 真实 API Key、Webhook Secret、数据库密码命中 0 |
| 本轮定向回归 | 失败 PaymentIntent、Checkout/Portal URL allowlist、账单状态、成功提示防伪、Stripe 2026 `cancel_at` 均有自动化测试通过 |

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

### 5.3 大积分包

- 商品：`credit_studio`，`unit_amount=26900`（CNY 269.00）
- Stripe Checkout、PaymentIntent 与 fulfillment key 均已核对，标识仅在内部证据中保留脱敏后缀
- 支付前余额 1202，支付后余额 3002，精确增加 1800
- 60 秒内履约变为 FULFILLED；对应积分包新增 1、ORDER_PAY 流水新增 1

### 5.4 年订阅首期

- 商品：`studio_annual`，`unit_amount=269900`（CNY 2699.00 / year）
- Checkout 成功后方案变为 BUSINESS，Subscription、Invoice 与 fulfillment 均可关联
- 支付前余额 3002，首期发放后余额 24602，精确增加 21600
- 60 秒内 Invoice 履约变为 FULFILLED；对应积分包新增 1、SUBSCRIPTION 流水新增 1

### 5.5 Test Clock 续费

- 使用独立 Test Clock 客户与 `creator_monthly` 订阅，避免与前述购买样本混合计数
- 首期 Invoice 与推进一个账期后的续费 Invoice 为两个不同标识；每个 Invoice 精确发放 600
- 最终余额 1202（欢迎积分 2 + 两期各 600）
- 订阅发放计数：积分包 2、SUBSCRIPTION 流水 2、FULFILLED 2；同一 Invoice 重复投递未增加任何计数

### 5.6 Billing Portal 周期末取消

- 从 Stripe Billing Portal 对 Test Clock 订阅选择周期末取消，Portal 会话标识与 URL token 均未记录
- 取消后正式 `/api/v1/user/billing` 可读到计划取消状态与 `cancel_at`，本地方案在周期结束前保持原方案
- 将 Test Clock 推进至 `cancel_at` 后，Stripe 订阅状态为 `canceled`，删除事件成功到达
- 60 秒内本地方案变为 FREE；Subscription ID、Price ID、周期结束时间 3/3 清空

### 5.7 失败银行卡

- 通过 Stripe 托管 Checkout 使用官方拒付测试卡完成一次真实失败尝试
- PaymentIntent 最终状态：`requires_payment_method`；错误类型：`card_declined`；decline code：`generic_decline`
- 失败前后积分包新增 0、积分流水新增 0、余额增量 0
- 对应 fulfillment 审计新增 1，终态为 SKIPPED；该记录只证明失败事件已安全消费，不代表发货

### 5.8 用户可读状态

使用同一测试用户登录后读取正式 API：

| API | HTTP | 摘要 |
| --- | --- | --- |
| `/api/v1/credit/balance` | 200 | 各测试节点余额与 DB 一致；Test Clock 取消到期后 plan=FREE |
| `/api/v1/credit/history?limit=10` | 200 | 成功订单与订阅流水可读；拒付没有新增积分流水 |
| `/api/v1/user/billing?limit=10` | 200 | 本地账单历史与 Stripe 当前订阅状态可读；包含计划取消状态与 `cancel_at` |

### 5.9 退款

- Refund：`re_…Tnq61Bj`
- `refund.created`、`charge.refunded`、`refund.updated` 均由 Stripe CLI 转发并返回 HTTP 200
- 原支付履约最终状态：REFUNDED
- 同一 `charge.refunded` 事件额外重放 3 次：3/3 HTTP 200
- 重放后积分包 3、积分流水 3、原支付履约行 1：均无新增
- 当前业务合同为“记录退款状态，不反向扣减已发积分”，因此退款不改变已发积分余额

### 5.10 立即取消回归

- 在 Stripe Test Mode 立即取消订阅
- `customer.subscription.deleted` 事件 `evt_…WCSygIsd` 返回 HTTP 200
- 60 秒内本地方案变为 FREE；Subscription ID、Price ID、周期结束时间 3/3 清空
- 该样本与 5.6 的 Portal 周期末取消共同覆盖立即删除和计划取消两条分支

### 5.11 三类返回地址

浏览器最终落点 3/3 均为本地应用同一 origin，且路径均为 `/pricing`：

- Checkout success：`http://localhost:8081/pricing?checkout=success&session_id=cs_test_…`
- Checkout cancel：`http://localhost:8081/pricing?checkout=cancel`
- Billing Portal return：`http://localhost:8081/pricing`

服务端返回非 Stripe 外域 URL 时前端拒绝导航；完整 Session ID 与 Portal token 未写入本文。

### 5.12 Webhook 可达性

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
| B04 | PASS | `credit_studio` CNY 269.00（`unit_amount=26900`）支付成功，60 秒内 +1800，余额 1202 → 3002 |
| B05 | PASS | `creator_monthly` 首期；修复 2026 Invoice 字段后 +600 |
| B06 | PASS | `studio_annual` CNY 2699.00（`unit_amount=269900`）首期成功，方案 BUSINESS，余额 3002 → 24602，精确 +21600 |
| B07 | PASS | Test Clock 首期与续费两个不同 Invoice 各 +600；最终余额 1202、订阅积分包 2、流水 2，重复发放 0 |
| B08 | PASS | 从 Billing Portal 选择周期末取消；正式 API 可读 `cancel_at`；推进至到期后 Stripe canceled、本地 FREE 且 3 个订阅字段清空 |
| B09 | PASS | 全额退款后 REFUNDED，积分包/流水零新增 |
| B10 | PASS | Checkout、Invoice、退款事件分别额外重放 3 次均无重复写入 |
| B11 | PASS | 真实拒付 PI 为 `requires_payment_method` / `card_declined` / `generic_decline`；积分包、积分流水新增均为 0，SKIPPED 审计 1 |
| B12 | PASS | success、cancel、Portal return 3/3 精确回到 `http://localhost:8081` 同源 `/pricing`，外域返回被 allowlist 拒绝 |

## 7. 验收后说明

本轮没有遗留的强制验收项。以下属于上线前环境操作，不影响 Stripe Test Mode 的 12/12 结论：

1. 在生产 Stripe 账户重新核对 6 个生产 Price、Webhook Endpoint 与签名 Secret，禁止复用测试资源。
2. 部署后用最小金额商品完成一次受控生产 smoke test，并从监控确认 Webhook 与履约延迟。
3. 对 SKIPPED/FAILED fulfillment、Webhook 非 2xx 和订阅状态漂移设置告警。

当前 Stripe 主支付、Webhook、发货、拒付审计、幂等、退款、续费、Portal 周期末取消和返回地址均已实际跑通。
