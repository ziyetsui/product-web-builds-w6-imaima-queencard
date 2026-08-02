# Payment Flow 验收标准

## 1. 验收结论规则

验收分为两个门槛：

- **代码闭环**：A 类全部通过，且测试、lint、生产构建退出码均为 `0`。
- **Stripe 沙箱闭环**：代码闭环通过，并且 B 类全部通过。

任何强制项失败，均不得写“支付链路已跑通”。缺少 Stripe 测试账户、测试密钥、Price、Webhook Endpoint 或 PostgreSQL 时，B 类标记为 `BLOCKED`，并逐项列出缺失资源；`BLOCKED` 不等于通过。

## 2. A 类：仓库内强制验收

| ID | 验收项 | 量化标准 | 验证方式 | 必须证据 |
| --- | --- | --- | --- | --- |
| A01 | 默认渠道 | 未设置或设置为 `stripe` 时，100% 请求 Stripe Checkout Route；设置为 `creem` 时，100% 请求 Creem Route | 组件测试，各运行 1 次 | 测试名称与 PASS 输出 |
| A02 | 商品覆盖 | 6/6 个启用商品可由 `productKey` 唯一解析，模式、积分、有效期与 Spec 完全一致 | 商品目录测试 | 6 行断言或快照 |
| A03 | Price ID 校验 | 6/6 个 Stripe 商品环境变量缺失或不是 `price_` 前缀时均在调用 Stripe 前失败 | 参数化单元测试 | Stripe mock 调用次数为 0 |
| A04 | 鉴权 | 未登录请求 Stripe 和 Creem Checkout Route 均返回 `401`，共 2/2 条路径通过 | Route 测试 | 状态码断言 |
| A05 | 输入防篡改 | 空值、未知 key、客户端伪造金额、客户端伪造积分均不能改变服务端商品合同；至少 4/4 个用例通过 | Route/服务测试 | 响应与服务端参数断言 |
| A06 | Stripe 订阅下单 | 4/4 个订阅商品使用 `mode=subscription`，携带 `userId/productKey/mode/credits` metadata 和正确 Price ID | 参数化服务测试 | Stripe Session 参数断言 |
| A07 | Stripe 积分包下单 | 2/2 个积分包使用 `mode=payment`，metadata 同时写入 Checkout 与 PaymentIntent | 参数化服务测试 | Stripe Session 参数断言 |
| A08 | 已付费用户分流 | 已付费用户选择订阅时只创建 Billing Portal；选择积分包时只创建 Checkout | 2 个服务测试 | 两个 Stripe mock 的互斥调用断言 |
| A09 | 返回地址 | success、cancel、portal 三个 URL 均使用 `NEXT_PUBLIC_APP_URL`，无双斜杠，成功 URL 保留 Session 占位符 | 单元测试 | 3/3 URL 精确相等 |
| A10 | Webhook 验签 | 缺少签名、错误签名、错误 Secret 共 3/3 个用例返回 `400`，履约函数调用 0 次 | Route 测试 | 状态码与零调用断言 |
| A11 | 一次性支付发货 | `checkout.session.completed` 且 `payment_status=paid` 时创建 1 个积分包、1 条积分流水、1 条 FULFILLED 记录 | Webhook/服务测试 | 三表写入断言 |
| A12 | 异步支付 | async succeeded 发货 1 次；async failed 发货 0 次并记录 SKIPPED，共 2/2 个用例通过 | Webhook 测试 | 状态与写入次数断言 |
| A13 | 订阅首期与续费 | 两个不同 Invoice ID 各发放 1 份周期积分；本地订阅方案与周期结束时间正确 | Webhook 测试 | 2 个履约键和 2 个积分包 |
| A14 | 幂等 | 同一成功事件串行投递 3 次和并发投递 3 次，各自都只能产生 1 个积分包、1 条积分流水、1 条 FULFILLED 记录 | 数据库集成测试 | 每组最终计数均为 1 |
| A15 | 事务原子性 | 在积分流水写入处注入 1 次失败后，积分包、流水、FULFILLED 状态新增数均为 0 | 数据库集成测试 | 回滚后的三项计数 |
| A16 | 订阅取消 | subscription deleted 后本地方案为 FREE，活动 Subscription ID、Price ID 与周期结束时间清空 | Webhook 测试 | Customer 更新断言 |
| A17 | 退款 | 同一退款事件投递 3 次，原履约最终为 REFUNDED，新增积分包与流水均为 0 | Webhook/服务测试 | 状态与零新增断言 |
| A18 | 失败事件 | invoice failed、未知商品、缺少 userId 共 3/3 个场景不发积分，并分别记录 SKIPPED 或 FAILED | Webhook 测试 | 状态与零发货断言 |
| A19 | 用户可读状态 | 发货完成后，余额接口增加精确积分数，历史接口出现 1 条对应 orderNo；订阅接口返回正确方案 | API/集成测试 | 三个接口响应断言 |
| A20 | 数据库约束 | `payment_fulfillments.fulfillment_key` 存在唯一索引；所需迁移全部在目标数据库执行成功 | schema 测试与迁移检查 | 索引检查和迁移退出码 0 |
| A21 | 全量测试 | `pnpm test` 通过，失败数为 0 | 命令执行 | 测试数、通过数、失败数 |
| A22 | 静态检查 | `pnpm run lint` 退出码为 0，error 数为 0 | 命令执行 | 退出码与摘要 |
| A23 | 生产构建 | `pnpm run build:prod` 退出码为 0 | 命令执行 | 构建退出码与路由摘要 |
| A24 | 敏感信息 | git diff 和验收文档中出现的真实 API Key、Webhook Secret、数据库密码数量为 0 | 密钥模式扫描与人工复核 | 扫描摘要 |

## 3. B 类：Stripe 测试模式强制验收

| ID | 验收项 | 量化标准 | 验证方式 | 必须证据 |
| --- | --- | --- | --- | --- |
| B01 | 测试资源一致性 | API Key、Webhook Secret 和 6/6 个 Price ID 均来自同一个 Stripe 测试账户；Price 金额、币种和 recurring/payment 类型与商品合同一致 | Stripe Dashboard/API 只读核对 | 脱敏资源清单 |
| B02 | Webhook 可达 | Stripe 测试事件到 `/api/webhooks/stripe` 的成功投递率为 100%，连续 5 次均返回 `2xx` | Stripe CLI 或测试 Endpoint | 5 个事件 ID 与状态码 |
| B03 | 一次性银行卡支付 | `credit_creator` 完成 1 笔测试支付；60 秒内出现 FULFILLED，余额精确增加 600 | 托管 Checkout + DB/API 核对 | Session、PaymentIntent、fulfillmentKey 脱敏摘要 |
| B04 | 大积分包支付 | `credit_studio` 完成 1 笔测试支付；60 秒内出现 FULFILLED，余额精确增加 1,800 | 托管 Checkout + DB/API 核对 | Session、PaymentIntent、fulfillmentKey 脱敏摘要 |
| B05 | 月订阅首期 | `creator_monthly` 完成 1 笔测试订阅；60 秒内方案为 PRO，余额增加 600 | Checkout + Invoice 事件 | Subscription、Invoice、履约摘要 |
| B06 | 年订阅首期 | `studio_annual` 完成 1 笔测试订阅；60 秒内方案为 BUSINESS，余额增加 21,600 | Checkout + Invoice 事件 | Subscription、Invoice、履约摘要 |
| B07 | 续费 | 使用 Test Clock 或测试订阅推进 1 个周期；每个新 Invoice 只增加一次对应积分 | Stripe Test Clock | 前后余额与 Invoice ID |
| B08 | 取消 | 从 Billing Portal 取消 1 个订阅；Webhook 到达后 60 秒内取消状态可读，周期结束后的 deleted 事件使方案变为 FREE | Portal + Webhook | 事件与用户账单响应 |
| B09 | 退款 | 对 1 笔积分包测试支付发起全额退款；60 秒内原履约变为 REFUNDED，积分包和流水新增数为 0 | Stripe Dashboard/API | Refund ID 与履约状态 |
| B10 | Webhook 重放 | 将同一成功事件额外重放 3 次；余额、积分包数和流水数相对首次处理均不再增加 | Stripe CLI resend | 重放前后计数 |
| B11 | 支付失败 | 使用 Stripe 失败测试卡完成 1 次尝试；产生 0 个积分包、0 条积分流水 | Checkout | 失败状态与零写入证据 |
| B12 | 返回页面 | 成功、取消、Portal 返回共 3/3 次均回到同一应用域名的 `/pricing`，无开放重定向 | 浏览器检查 | 3 个最终 URL |

## 4. 可选兼容验收

Creem 不是 Stripe 主链路通过的前置条件。若部署启用 `NEXT_PUBLIC_BILLING_PROVIDER=creem`，则必须额外执行：

- 6/6 个商品具有合法 `prod_` Product ID。
- Creem Checkout Route 鉴权、商品校验和错误处理通过。
- Creem Webhook 验签失败时零发货。
- 一次性支付、订阅首期、续费和退款分别至少完成 1 个沙箱用例。
- 同一 Creem 成功事件重放 3 次只发货 1 次。

未启用 Creem 时，这些项目记为 `N/A`，不能记为失败或冒充已验证。

## 5. 验收记录模板

每次执行后追加一条记录到实现说明或独立证据文档：

```text
执行时间：YYYY-MM-DD HH:mm Z
代码版本：<commit SHA>
环境：local / preview / production
支付模式：Stripe test / Stripe live / Creem test / Creem live
A 类：通过 <n>/24，失败 <n>，阻塞 <n>
B 类：通过 <n>/12，失败 <n>，阻塞 <n>
最终结论：代码闭环通过 / Stripe 沙箱闭环通过 / 未通过
失败或阻塞项：<ID + 原因 + 下一动作>
证据：<测试摘要、脱敏事件 ID、日志或截图路径>
```

## 6. 外部依赖清单

Stripe 沙箱闭环只允许被以下外部条件阻塞：

1. 可用的 Stripe 测试账户与 `sk_test_` API Key。
2. 同一测试账户中的 6 个 Price ID。
3. Stripe CLI 或可公网访问的测试 Webhook Endpoint，以及对应 `whsec_` Secret。
4. 可连接且已完成迁移的 PostgreSQL。
5. 可登录的测试用户。

除以上资源外，代码、测试、迁移、配置校验、错误处理和证据整理均属于仓库内闭环范围。
