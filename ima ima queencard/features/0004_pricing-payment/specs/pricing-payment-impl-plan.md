# imaima queencard 定价与支付实现计划

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 输入规格：`specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md`
- 本文件：`specs/w6/pricing-payment/0002-imaima-queencard-pricing-payment-impl-plan.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`impl-plan`
- 状态：实现前计划

## Setup 记录

本仓库当前使用 `.rules/spec-ledger-naming-rules.md` 中的 Workstream Manual Spec Chain，而不是标准 Spec Kit feature package。

已执行：

```bash
bash .specify/scripts/bash/setup-plan.sh --json
```

结果：脚本未找到 `.specify/feature.json` 或 `SPECIFY_FEATURE_DIRECTORY`，无法生成标准 `specs/{NNN-feature}/plan.md`。因此本计划按手工 spec ledger 生成到：

```text
specs/w6/pricing-payment/0002-imaima-queencard-pricing-payment-impl-plan.md
```

## Summary

本计划实现 imaima queencard 的 Stripe-first 定价、支付、积分发放和 GPTProto 图片模型扣积分体系。

核心目标：

- 用服务端产品 key 替代客户端 raw Stripe Price ID。
- 保留 Creator/Studio 自动续费订阅。
- 支持 Mini/Creator/Studio 一次性积分包，支付宝/微信只出现在积分包路径。
- 新增 `payment_fulfillments` 表，作为 Stripe webhook 履约幂等的唯一权威记录。
- Stripe webhook 成功后按产品配置精确发放一次积分。
- 图片生成前冻结积分，成功结算，失败释放。
- GPTProto key 只存在于服务端环境变量。

## Technical Context

| 项目 | 决策 |
|---|---|
| Language/Version | TypeScript 5.9，React 19，Next.js 16 App Router |
| Primary Dependencies | `stripe@14.15.0`、`drizzle-orm@0.45.2`、`@t3-oss/env-nextjs`、Better Auth、Vitest |
| Storage | PostgreSQL，通过 Drizzle schema/migrations 管理 |
| Testing | `pnpm test` 使用 Vitest；必要时补 API route/service/webhook 单元测试 |
| Target Platform | Next.js web app，开发端口 `8080` |
| Project Type | Web app with server API routes and background-style webhook fulfillment |
| Performance Goals | Webhook 成功接收后 `10` 秒内用户可见积分变化；生成前 `0` 次无积分供应商调用 |
| Constraints | 不暴露供应商 secret；不让客户端传 raw Price ID；Stripe 重放事件不能重复发放积分 |
| Scale/Scope | v1 商品 6 个：4 个订阅 Price，2 个一次性积分包 Price；图片模型按 GPTProto 实际 5 模型积分表上线 |

## Constitution Check

`.specify/memory/constitution.md` 当前仍是模板占位内容，没有可执行 gate。

计划采用以下本地 gate：

- 定价与扣积分规则必须由一个服务端 source-of-truth 配置驱动。
- 支付履约必须幂等，不能依赖 Stripe event ID 单独判断。
- 真实 key 和 webhook secret 不进入 spec、代码和 `NEXT_PUBLIC_*`。
- 先补服务/route/webhook 测试，再实现对应行为。
- 价格调整不能修改 live Price，必须创建新 Price 或 lookup key 版本。

Post-design gate：通过。没有新增额外服务或新框架，复杂度来自支付幂等和积分账本，是业务正确性所需。

## Project Structure

### Documentation

```text
specs/w6/pricing-payment/
├── 0001-imaima-queencard-pricing-payment-spec.md
└── 0002-imaima-queencard-pricing-payment-impl-plan.md
```

### Source Code

```text
w6/ima ima queencard/frontend/
├── src/
│   ├── app/
│   │   ├── api/billing/stripe/checkout/route.ts
│   │   ├── api/webhooks/stripe/route.ts
│   │   └── pricing/page.tsx
│   ├── components/common/checkout-button.tsx
│   ├── config/
│   │   ├── billing-provider.ts
│   │   ├── credits.ts
│   │   ├── pricing-products.ts
│   │   └── pricing-user.ts
│   ├── db/schema.ts
│   ├── payment/
│   │   ├── env.mjs
│   │   ├── plans.ts
│   │   ├── subscriptions.ts
│   │   └── webhooks.ts
│   └── services/
│       ├── billing.ts
│       ├── credit.ts
│       ├── gptproto.ts
│       ├── image-provider.ts
│       └── payment-fulfillment.ts
├── drizzle/
├── package.json
└── drizzle.config.ts
```

Structure decision：保持单个 Next.js app，不拆新 package。新增的共享逻辑放在 `src/config` 和 `src/services`，数据库实体继续放在 `src/db/schema.ts`。

## Phase 0 Research Decisions

### R1: Stripe checkout 输入

Decision：checkout API 只接受内部 `productKey`，不接受 raw Stripe Price ID。

Rationale：Price ID 是服务端配置，不应由客户端决定；这能避免用户构造任意 Price ID 或过期 Price ID。

Alternatives considered：

- 客户端继续传 Price ID：实现最小，但不满足 FR-009。
- 客户端传 lookup key：比 raw Price ID 好，但仍把支付供应商细节泄漏给前端。

### R2: 支付宝/微信范围

Decision：支付宝/微信只用于 `payment` 模式一次性积分包，不提供月/年预付套餐。

Rationale：用户已明确不要月/年预付套餐；商品结构保持“订阅 + 积分包”两层。

Alternatives considered：

- 钱包支付镜像月/年套餐：已拒绝，商品体系复杂。
- 尝试钱包 recurring：风险高，微信不适合作 recurring。

### R3: Stripe webhook 幂等

Decision：新增 `payment_fulfillments` 表作为唯一履约幂等记录，使用 `fulfillmentKey` 唯一约束。

Rationale：同一付款可能通过 `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`invoice.paid` 等不同事件到达。积分发放必须按业务付款对象幂等，而不是按 event ID 幂等。

Alternatives considered：

- 复用 `credit_packages.orderNo`：会把支付履约状态和积分桶混在一起，退款和重复事件难处理。
- 只记录 Stripe event ID：不能防止不同事件报告同一付款。

### R4: 订阅积分发放

Decision：订阅首次 checkout 与后续 invoice 都通过 invoice/period 级 `fulfillmentKey` 发放积分。

Rationale：订阅的权益本质属于一个已支付 billing period。`checkout.session.completed` 只负责同步 customer/subscription；发积分以 paid invoice 为准，避免 checkout 和 invoice 双发。

Alternatives considered：

- checkout completed 立即发订阅积分：用户体验快，但和 invoice 事件容易双发。
- 只同步订阅，不发积分：不满足付费后生成。

### R5: 部分退款

Decision：自动撤回未使用积分；已使用部分不允许负积分，进入人工审核或写入人工调整流水。

Rationale：不让用户余额变负，避免已经消耗供应商成本的部分被自动冲销。

Alternatives considered：

- 允许负积分：实现简单，但影响用户体验和账务解释。
- 所有退款都人工处理：安全但运营成本高。

### R6: GPTProto 接入形态

Decision：新增 provider adapter，把 GPTProto v3 JSON 任务接口和少量 OpenAI-compatible 兼容接口归一成 spec 中的 `NormalizedImageGenerationResult`。

Rationale：模型接口形态不一致，必须把鉴权、轮询、输出保存和成本记录隔离在服务端。

Alternatives considered：

- 在 UI 或生成 route 里直接调用不同 endpoint：短期快，但难测试和替换模型。

## Phase 1 Data Model

### 定价产品

Source of truth 建议新建 `src/config/pricing-products.ts`。

字段：

| 字段 | 类型 | 规则 |
|---|---|---|
| `productKey` | string | 唯一，如 `creator_monthly`、`credit_creator` |
| `name` | string | UI 展示名 |
| `mode` | `subscription` 或 `payment` | 决定 Checkout Session mode |
| `stripePriceEnv` | string | 服务端 env 变量名 |
| `lookupKey` | string | Stripe Dashboard lookup key |
| `priceUsd` | number | 美元展示价 |
| `priceCnyApprox` | number | 人民币约价展示 |
| `credits` | number | 发放积分，整数 |
| `validDays` | number | 月付 30，年付/积分包 365 |
| `plan` | `FREE`、`PRO`、`BUSINESS` 或 `null` | 订阅计划映射；积分包为 null |
| `enabled` | boolean | 历史产品可禁用不删除 |

### `payment_fulfillments`

新增 Drizzle table。建议字段：

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | serial | primary key |
| `provider` | text | 固定 `stripe` |
| `objectType` | text | `checkout_session`、`payment_intent`、`invoice`、`refund` |
| `objectId` | text | Stripe object id |
| `fulfillmentKey` | text | unique，业务幂等键 |
| `userId` | text | 本地用户 id |
| `stripeCustomerId` | text nullable | Stripe customer |
| `stripeSubscriptionId` | text nullable | Stripe subscription |
| `stripePriceId` | text | Stripe price |
| `productKey` | text | 内部产品 key |
| `mode` | text | `subscription` 或 `payment` |
| `credits` | integer | 本次发放或调整积分 |
| `status` | text | `PENDING`、`FULFILLED`、`SKIPPED`、`REFUNDED`、`FAILED` |
| `creditPackageId` | integer nullable | 关联 `credit_packages.id` |
| `stripeEventId` | text nullable | 最近一次触发该履约的 event id |
| `raw` | jsonb nullable | 精简 Stripe payload，避免保存敏感数据 |
| `fulfilledAt` | timestamp nullable | 完成时间 |
| `createdAt` | timestamp | default now |
| `updatedAt` | timestamp | default now |

索引：

- `uniqueIndex(payment_fulfillments_fulfillment_key_idx).on(fulfillmentKey)`
- `index(payment_fulfillments_user_id_idx).on(userId)`
- `index(payment_fulfillments_object_idx).on(provider, objectType, objectId)`

状态流：

```text
PENDING -> FULFILLED
PENDING -> SKIPPED
PENDING -> FAILED
FULFILLED -> REFUNDED
```

### 积分包/积分流水

沿用 `credit_packages` 和 `credit_transactions`。

变更规则：

- `credit_packages.orderNo` 只保存业务流水关联，比如 `cs:...` 或 `in:...`。
- webhook 幂等不看 `credit_packages.orderNo`，只看 `payment_fulfillments.fulfillmentKey`。
- 订阅积分使用 `CreditTransType.SUBSCRIPTION`。
- 一次性积分包使用 `CreditTransType.ORDER_PAY`。
- 退款调整使用 `CreditTransType.REFUND`。

### 图片生成资产

本计划不强制立即迁移 `videos` 表，但实现图片生成时应新增或泛化：

- `generation_tasks`
- `generated_assets`

如果为降低首轮风险选择兼容层，可以先复用 `videos.uuid` 作为 generation task id，但新增字段必须避免继续扩大视频命名。

## Phase 1 Contracts

### `POST /api/billing/stripe/checkout`

Request：

```json
{
  "productKey": "creator_monthly"
}
```

Response success：

```json
{
  "success": true,
  "data": {
    "success": true,
    "url": "https://checkout.stripe.com/..."
  }
}
```

Rules：

- Requires login.
- Reject unknown or disabled `productKey`.
- Server resolves `mode` and Stripe Price ID.
- `subscription` products create `mode: "subscription"` sessions.
- `payment` products create `mode: "payment"` sessions.
- Metadata must include `userId` and `productKey`.
- Client must never send raw Stripe Price ID.

### `POST /api/webhooks/stripe`

Input：raw Stripe webhook body with Stripe signature.

Required events：

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
invoice.payment_succeeded
invoice.paid
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
charge.refunded
refund.updated
refund.failed
```

Rules：

- Validate `STRIPE_WEBHOOK_SECRET`.
- Route events to `payment/webhooks.ts`.
- For each successful payment fulfillment, create or find `payment_fulfillments` by `fulfillmentKey`.
- If already `FULFILLED`, return success without new credit package.
- For `payment` mode, grant one-time package credits after payment is paid.
- For subscription invoices, grant subscription period credits after invoice is paid.

### `GET /api/v1/credit/balance`

Existing contract remains. Expected outcome after webhook fulfillment:

```json
{
  "availableCredits": 600,
  "frozenCredits": 0
}
```

### `GET /api/v1/credit/history`

Existing contract remains. New records must include:

- `ORDER_PAY` for one-time credit packs.
- `SUBSCRIPTION` for paid subscription period grants.
- `REFUND` for refund adjustments.

### GPTProto service contract

Internal service, no public API required in this plan.

```ts
type ImageGenerationRequest = {
  userId: string;
  model: string;
  prompt: string;
  inputImages?: Array<{ url?: string; b64Json?: string; mimeType?: string }>;
  outputCount: number;
  aspectRatio?: string;
  size?: string;
};

type NormalizedImageGenerationResult = {
  provider: "gptproto";
  providerTaskId?: string;
  model: string;
  capability: "text-to-image" | "image-edit" | "image-to-image" | "tool";
  images: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    providerCostUsd?: number;
  };
  raw: unknown;
};
```

## Implementation Phases

### Phase 1: Pricing source of truth

Files:

- `src/config/pricing-products.ts`
- `src/config/credits.ts`
- `src/config/pricing-user.ts`
- `src/env.mjs`
- `src/payment/env.mjs`

Tasks:

- Create product config for 6 products from spec.
- Add server env variables:
  - `STRIPE_PRICE_CREATOR_MONTHLY`
  - `STRIPE_PRICE_CREATOR_ANNUAL`
  - `STRIPE_PRICE_STUDIO_MONTHLY`
  - `STRIPE_PRICE_STUDIO_ANNUAL`
  - `STRIPE_PRICE_CREDIT_CREATOR`
  - `STRIPE_PRICE_CREDIT_STUDIO`
- Keep old `NEXT_PUBLIC_STRIPE_*` as temporary compatibility only.
- Replace video-era model credit defaults with image model credit rules.

Acceptance:

- Product lookup by `productKey` returns mode, credits, expiry, and Stripe Price ID.
- No `STRIPE_PRICE_*` value is exposed through `NEXT_PUBLIC_*`.

### Phase 2: Database and fulfillment service

Files:

- `src/db/schema.ts`
- `src/services/payment-fulfillment.ts`
- Drizzle migration output

Tasks:

- Add `payment_fulfillments` table and indexes.
- Implement helpers:
  - `createPendingFulfillment`
  - `markFulfilled`
  - `markSkipped`
  - `markFailed`
  - `markRefunded`
  - `getFulfillmentByKey`
- Wrap credit grant and fulfillment insert/update in one DB transaction.

Acceptance:

- Replaying the same fulfillment key creates one credit package.
- Different Stripe event IDs for the same payment object do not double grant.

### Phase 3: Checkout routing

Files:

- `src/app/api/billing/stripe/checkout/route.ts`
- `src/services/billing.ts`
- `src/components/common/checkout-button.tsx`
- `src/app/pricing/page.tsx`

Tasks:

- Change request body from `{ planId }` to `{ productKey }`.
- Validate product exists and is enabled.
- Resolve Stripe Price server-side.
- Create Checkout Session by product mode.
- Add metadata: `userId`, `productKey`, `mode`, `credits`.
- For paid subscription customers, keep Customer Portal behavior for subscription actions, but allow credit pack purchases.
- Update pricing UI to show Creator/Studio subscriptions and Mini/Creator/Studio packs.

Acceptance:

- Subscription buttons create `mode: "subscription"`.
- Credit pack buttons create `mode: "payment"`.
- Auth failures redirect to `/login?from=/pricing`.
- Missing Stripe Price env fails before calling Stripe.

### Phase 4: Webhook fulfillment

Files:

- `src/payment/webhooks.ts`
- `src/payment/plans.ts`
- `src/services/credit.ts`
- `src/test/fixtures/stripe-events.ts`

Tasks:

- Treat `checkout.session.completed` for `payment` as immediate grant only when `payment_status=paid`.
- Treat `checkout.session.async_payment_succeeded` as final grant path for async wallets.
- Treat `invoice.payment_succeeded` and `invoice.paid` as subscription-period grant path.
- Keep subscription sync on checkout/subscription events.
- Implement `invoice.payment_failed`, async failed, refund events.
- Use `payment_fulfillments.fulfillmentKey` for all grant/refund operations.

Acceptance:

- One-time pack grants exact configured credits once.
- Subscription renewal grants exact configured credits once per paid period.
- `customer.subscription.deleted` downgrades plan but does not delete unexpired credits.
- Refund adjustment never creates negative credit balance.

### Phase 5: GPTProto image adapter and generation credits

Files:

- `src/services/gptproto.ts`
- `src/services/image-provider.ts`
- `src/config/credits.ts`
- generation route/components to be identified during implementation

Tasks:

- Add GPTProto env schema.
- Implement GPTProto v3 JSON generation/edit/image-to-image call path for the actual 5 models.
- Keep OpenAI-compatible generation/edit path only where a model endpoint requires it.
- Normalize output to `NormalizedImageGenerationResult`.
- Estimate credits before provider call.
- Freeze credits before call, settle only successful outputs, release failures.
- Record provider cost when available.

Acceptance:

- Anonymous/no-credit users trigger `0` provider calls.
- Failed provider calls release holds.
- Partial output settles only successful images.

### Phase 6: Tests and validation

Files:

- `src/services/billing.test.ts`
- `src/payment/webhooks.test.ts`
- `src/services/payment-fulfillment.test.ts`
- `src/config/credits.test.ts`
- `src/app/pricing/pricing-page.test.tsx`

Tasks:

- Update existing checkout tests from `planId` to `productKey`.
- Add one-time pack checkout tests.
- Add webhook replay tests across same session/payment intent/invoice.
- Add async wallet success/failure tests.
- Add refund tests.
- Add model credit calculation tests.

Acceptance:

- `pnpm test` passes.
- `pnpm lint` passes.
- `pnpm build` passes, unless blocked by unrelated existing issues documented in final report.

## Quickstart Validation Guide

### Prerequisites

```bash
cd "w6/ima ima queencard/frontend"
pnpm install
```

`.env.local` must include placeholders or real test values:

```dotenv
NEXT_PUBLIC_BILLING_PROVIDER=stripe
NEXT_PUBLIC_APP_URL=http://localhost:8080
STRIPE_API_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=replace_with_webhook_secret
STRIPE_PRICE_CREATOR_MONTHLY=price_xxx
STRIPE_PRICE_CREATOR_ANNUAL=price_xxx
STRIPE_PRICE_STUDIO_MONTHLY=price_xxx
STRIPE_PRICE_STUDIO_ANNUAL=price_xxx
STRIPE_PRICE_CREDIT_CREATOR=price_xxx
STRIPE_PRICE_CREDIT_STUDIO=price_xxx
IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=replace_with_real_key
GPTPROTO_BASE_URL=https://gptproto.com
```

Do not commit real keys.

### Local checks

```bash
pnpm test
pnpm lint
pnpm build
```

### Manual checkout smoke

1. Start app:

   ```bash
   pnpm dev
   ```

2. Open `http://localhost:8080/pricing`.
3. Click Creator monthly subscription.
4. Confirm Checkout Session redirects to Stripe and returns to:

   ```text
   http://localhost:8080/pricing?checkout=success&session_id=...
   ```

5. Click Creator Pack.
6. Confirm Checkout Session uses one-time payment mode and returns to pricing.

### Webhook replay smoke

Use Stripe CLI or Dashboard event replay for:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
invoice.payment_succeeded
customer.subscription.deleted
refund.updated
```

Expected:

- Same event replay returns HTTP 200.
- Same payment object replay does not add credits twice.
- `payment_fulfillments` has one `FULFILLED` row per business payment.
- `credit_transactions` shows the expected `ORDER_PAY` or `SUBSCRIPTION` record.

## Risks

| Risk | Mitigation |
|---|---|
| Stripe account cannot show Alipay/WeChat for USD Price | Create CNY one-time Price mirrors for credit packs only |
| Existing Creem plugin still fires credit grants | Keep provider gating via `NEXT_PUBLIC_BILLING_PROVIDER`; add tests for Stripe mode |
| User buys credit pack while subscribed and current code opens Portal | Change portal rule so payment-mode products still create Checkout |
| Subscription checkout and invoice both grant credits | Invoice/period fulfillment key is the only subscription credit grant key |
| GPTProto token model cost exceeds estimate | Store provider cost and adjust model credits after real usage review |
| Existing `videos` naming leaks into image feature | Plan a generation task/asset abstraction; use compatibility layer only for first delivery |

## Out of Scope

- Creating Stripe Products/Prices directly from code.
- Enabling Dashboard payment methods.
- Customer Portal Dashboard configuration.
- Replacing all video-era table names in one refactor.
- Implementing a full image generation UI redesign beyond payment/credit gating.

## Completion Checklist

- [ ] Seven Stripe product keys resolve server-side.
- [ ] `payment_fulfillments` table and migration exist.
- [ ] Checkout uses `productKey`, never raw Price ID from client.
- [ ] One-time credit packs grant credits once.
- [ ] Subscription invoices grant credits once per paid period.
- [ ] Async wallet success/failure events are handled.
- [ ] Refund adjustment avoids negative balances.
- [ ] GPTProto key is server-only.
- [ ] Generation freezes, settles, or releases credits correctly.
- [ ] Pricing page shows subscription and credit pack paths.
- [ ] Tests cover checkout, webhook idempotency, credit grants, refunds, and model credit calculation.
