# Payment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stripe the default end-to-end payment path, retain Creem as an explicit fallback, and prove checkout, signed webhook handling, and exactly-once credit fulfillment with automated and sandbox evidence.

**Architecture:** The pricing UI chooses one provider endpoint from `NEXT_PUBLIC_BILLING_PROVIDER`, defaulting to Stripe. Server routes authenticate the user and resolve the submitted `productKey` against the server-owned catalog before creating a provider checkout. Signed Stripe webhooks drive subscription synchronization and credit fulfillment; `payment_fulfillments.fulfillment_key` plus a row lock protect exactly-once delivery.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library, Stripe Node SDK, Drizzle ORM, PostgreSQL, pnpm.

## Global Constraints

- Stripe is the default provider when `NEXT_PUBLIC_BILLING_PROVIDER` is unset or `stripe`.
- Creem is used only when `NEXT_PUBLIC_BILLING_PROVIDER=creem`.
- The runnable app for this feature is `ima ima queencard/src/`; run all pnpm commands there.
- The client submits only `productKey`; price, credits, plan, validity, and user identity remain server-owned.
- Only a verified webhook may trigger fulfillment; the browser success return never grants credits.
- A fulfillment key grants at most one credit package and one credit transaction, including concurrent webhook delivery.
- Do not commit secrets, real webhook payloads, database credentials, `.next/`, or `node_modules/`.
- Preserve unrelated user changes and never add `.trees/` to git.

---

## File Map

- `src/src/components/common/checkout-button.tsx`: Resolve the selected billing provider, call the matching route, and show provider-specific errors.
- `src/src/components/common/checkout-button.test.tsx`: Prove Stripe defaulting, explicit Creem selection, authentication redirect, and error copy.
- `src/src/config/pricing-products.test.ts`: Prove the six-product server contract and all Stripe Price mappings.
- `src/src/services/billing.ts`: Build safe Stripe Checkout/Portal requests and avoid forcing unsupported wallets.
- `src/src/services/billing.test.ts`: Parameterize all six products and validate metadata, modes, Price IDs, and return URLs.
- `src/src/app/api/billing/stripe/checkout/route.test.ts`: Prove authentication, input validation, and response behavior for Stripe checkout.
- `src/src/app/api/billing/creem/checkout/route.test.ts`: Prove equivalent authentication and input validation for the fallback route.
- `src/src/app/api/webhooks/stripe/route.ts`: Fail fast on missing signature/secret and keep signed payload processing explicit.
- `src/src/app/api/webhooks/stripe/route.test.ts`: Prove raw-body verification, invalid-signature rejection, and zero fulfillment on rejection.
- `src/src/services/payment-fulfillment.ts`: Serialize each fulfillment key inside the database transaction before granting credits.
- `src/src/services/payment-fulfillment.test.ts`: Prove terminal-state idempotency and the lock-before-grant contract.
- `src/src/services/payment-fulfillment.integration.test.ts`: Run concurrent and rollback checks when a PostgreSQL test database is available.
- `.gba/0003_payment-flow/docs/0001_payment-flow_impl_notes.md`: Record implementation decisions, verification output, blockers, and sandbox evidence.

---

### Task 1: Provider-Aware Checkout Entry

**Files:**
- Modify: `ima ima queencard/src/src/components/common/checkout-button.test.tsx`
- Modify: `ima ima queencard/src/src/components/common/checkout-button.tsx`

**Interfaces:**
- Consumes: `process.env.NEXT_PUBLIC_BILLING_PROVIDER?: "stripe" | "creem"`.
- Produces: `getCheckoutEndpoint(provider?: string): "/api/billing/stripe/checkout" | "/api/billing/creem/checkout"` and provider-aware checkout behavior.

- [ ] **Step 1: Write failing provider-selection tests**

Add tests that isolate environment variables and assert the endpoint:

```tsx
it.each([
  [undefined, "/api/billing/stripe/checkout"],
  ["stripe", "/api/billing/stripe/checkout"],
  ["creem", "/api/billing/creem/checkout"],
])("uses %s billing provider", async (provider, endpoint) => {
  vi.stubEnv("NEXT_PUBLIC_BILLING_PROVIDER", provider ?? "");
  // Render, click, and assert fetch(endpoint, { body: JSON.stringify({ productKey }) }).
});
```

Also assert that a failed Stripe request mentions Stripe and a failed Creem request mentions Creem.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm vitest run src/components/common/checkout-button.test.tsx`

Expected: the unset and `stripe` cases fail because the component still calls the Creem route.

- [ ] **Step 3: Implement the minimal provider resolver**

```ts
export function getCheckoutEndpoint(provider = process.env.NEXT_PUBLIC_BILLING_PROVIDER) {
  return provider === "creem"
    ? "/api/billing/creem/checkout"
    : "/api/billing/stripe/checkout";
}
```

Use the same resolved provider for the fetch URL and toast description. Preserve the existing `401` redirect and loading reset.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `pnpm vitest run src/components/common/checkout-button.test.tsx`

Expected: all checkout-button tests pass.

- [ ] **Step 5: Commit the entry fix**

```bash
git add src/src/components/common/checkout-button.tsx src/src/components/common/checkout-button.test.tsx
git commit -m "fix: route checkout through configured provider"
```

---

### Task 2: Stripe Checkout Contract for All Products

**Files:**
- Modify: `ima ima queencard/src/src/config/pricing-products.test.ts`
- Modify: `ima ima queencard/src/src/services/billing.test.ts`
- Modify: `ima ima queencard/src/src/services/billing.ts`

**Interfaces:**
- Consumes: `getPricingProduct(productKey)`, `resolveStripePriceId(productKey)`, authenticated user, and customer billing state.
- Produces: `createStripeSession(userId: string, productKey: string): Promise<CheckoutSessionResult>` with catalog-owned Stripe parameters.

- [ ] **Step 1: Write the six-product contract table**

```ts
const stripeCases = [
  ["creator_monthly", "subscription", "price_creator_monthly", 600],
  ["creator_annual", "subscription", "price_creator_annual", 7200],
  ["studio_monthly", "subscription", "price_studio_monthly", 1800],
  ["studio_annual", "subscription", "price_studio_annual", 21600],
  ["credit_creator", "payment", "price_credit_creator", 600],
  ["credit_studio", "payment", "price_credit_studio", 1800],
] as const;
```

Parameterize catalog and billing tests over this table. For every row assert the mode, Price ID, `userId`, `productKey`, and `credits`. For subscription rows assert `subscription_data.metadata`; for payment rows assert `payment_intent_data.metadata`.

- [ ] **Step 2: Write a failing unsupported-wallet safety test**

Assert that one-time Checkout creation does not hard-code `alipay` or `wechat_pay`; Stripe Dashboard configuration may expose those methods, but unsupported wallets must not prevent card checkout.

- [ ] **Step 3: Run the contract tests and confirm RED**

Run: `pnpm vitest run src/config/pricing-products.test.ts src/services/billing.test.ts`

Expected: the wallet-safety assertion fails against the current hard-coded payment methods; newly added product cases may expose missing test setup.

- [ ] **Step 4: Make Stripe checkout provider-safe**

Remove forced `payment_method_types` and `payment_method_options` from one-time Checkout parameters. Keep `payment_intent_data.metadata`, server-side Price IDs, and existing customer reuse. Return explicit errors for missing product, invalid Price ID, missing user, missing email, and a Stripe response without a URL.

- [ ] **Step 5: Run the contract tests and confirm GREEN**

Run: `pnpm vitest run src/config/pricing-products.test.ts src/services/billing.test.ts`

Expected: 6/6 product cases and all failure cases pass.

- [ ] **Step 6: Commit the server checkout contract**

```bash
git add src/src/config/pricing-products.test.ts src/src/services/billing.ts src/src/services/billing.test.ts
git commit -m "fix: harden stripe checkout product contract"
```

---

### Task 3: Checkout Route Authentication and Validation

**Files:**
- Create: `ima ima queencard/src/src/app/api/billing/stripe/checkout/route.test.ts`
- Create: `ima ima queencard/src/src/app/api/billing/creem/checkout/route.test.ts`
- Modify only if tests expose a defect: the adjacent `route.ts` file.

**Interfaces:**
- Consumes: `requireAuth(request)`, JSON `{ productKey?: unknown }`, and the provider service.
- Produces: `401` for unauthenticated callers, `400` for invalid product keys/configuration, and `{ data: { success: true, url } }` for success.

- [ ] **Step 1: Write Stripe Route tests**

Mock `requireAuth`, `getPricingProduct`, and `createStripeSession`. Cover unauthenticated, malformed JSON, blank key, unknown key, ignored extra `amount/credits/userId`, provider failure, and success.

- [ ] **Step 2: Write Creem Route parity tests**

Repeat the authentication and input cases against the Creem route and assert that only the server-resolved `productKey` and authenticated user ID reach `createCreemCheckout`.

- [ ] **Step 3: Run both Route tests and confirm RED or characterize existing behavior**

Run: `pnpm vitest run src/app/api/billing/stripe/checkout/route.test.ts src/app/api/billing/creem/checkout/route.test.ts`

Expected: any response-shape, authentication, or malformed-body mismatch is captured before editing the routes.

- [ ] **Step 4: Apply the minimum Route fixes**

Keep authentication first, trim string keys, reject missing/unknown keys with `400`, ignore all non-contract fields, and pass `user.id` from the session. Do not add a new validation library for this single-field body.

- [ ] **Step 5: Run Route tests and confirm GREEN**

Run: `pnpm vitest run src/app/api/billing/stripe/checkout/route.test.ts src/app/api/billing/creem/checkout/route.test.ts`

Expected: both providers pass all authentication and validation cases.

- [ ] **Step 6: Commit Route coverage**

```bash
git add src/src/app/api/billing/stripe/checkout src/src/app/api/billing/creem/checkout
git commit -m "test: cover payment checkout routes"
```

---

### Task 4: Signed Stripe Webhook Boundary

**Files:**
- Create: `ima ima queencard/src/src/app/api/webhooks/stripe/route.test.ts`
- Modify: `ima ima queencard/src/src/app/api/webhooks/stripe/route.ts`

**Interfaces:**
- Consumes: raw request text, `Stripe-Signature`, `STRIPE_WEBHOOK_SECRET`, `stripe.webhooks.constructEvent`, and `handleEvent`.
- Produces: `200 { received: true }` only after successful verification and handling; otherwise `400` and zero handling calls.

- [ ] **Step 1: Write failing boundary tests**

Cover missing signature, missing webhook secret, invalid signature, handler failure, and a valid signed event. Assert `request.text()` content is passed unchanged to `constructEvent`. Assert `handleEvent` is never called in the first three cases.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `pnpm vitest run src/app/api/webhooks/stripe/route.test.ts`

Expected: explicit missing-header/secret behavior fails against the current non-null assertions.

- [ ] **Step 3: Implement fail-fast verification**

```ts
const signature = req.headers.get("Stripe-Signature");
if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
  return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 400 });
}
```

Keep raw-body reading before verification, catch verification/handling errors, return `400` for retries, and avoid logging payloads, secrets, or signatures.

- [ ] **Step 4: Run route and webhook-domain tests**

Run: `pnpm vitest run src/app/api/webhooks/stripe/route.test.ts src/payment/webhooks.test.ts`

Expected: all tests pass; no webhook-domain behavior regresses.

- [ ] **Step 5: Commit the signed boundary**

```bash
git add src/src/app/api/webhooks/stripe/route.ts src/src/app/api/webhooks/stripe/route.test.ts
git commit -m "fix: harden stripe webhook verification"
```

---

### Task 5: Concurrent Exactly-Once Fulfillment

**Files:**
- Modify: `ima ima queencard/src/src/services/payment-fulfillment.ts`
- Modify: `ima ima queencard/src/src/services/payment-fulfillment.test.ts`
- Create: `ima ima queencard/src/src/services/payment-fulfillment.integration.test.ts`

**Interfaces:**
- Consumes: `FulfillCreditGrantParams` with a stable `fulfillmentKey`.
- Produces: `fulfillCreditGrantOnce(params)` that returns `{ fulfilled: true }` once and `{ fulfilled: false }` for every duplicate without throwing a uniqueness error.

- [ ] **Step 1: Write failing lock-order and terminal-state tests**

Extend the service mock so the test proves the transaction first inserts the PENDING row with `onConflictDoNothing`, then selects that row `FOR UPDATE`, then checks status. Add one case for each terminal status: FULFILLED, REFUNDED, FAILED, and SKIPPED; all must return without package or transaction inserts.

- [ ] **Step 2: Add a PostgreSQL integration test**

When `PAYMENT_TEST_DATABASE_URL` is present, create isolated rows for a test user and call `Promise.all` with the same fulfillment parameters three times. Assert one fulfilled result, one credit package, one credit transaction, and one FULFILLED record. Add a failure-injection case that throws before transaction completion and assert all three tables remain unchanged. If the variable is absent, report this test as an explicit external blocker in implementation notes rather than counting it as evidence.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run: `pnpm vitest run src/services/payment-fulfillment.test.ts src/services/payment-fulfillment.integration.test.ts`

Expected: the lock-order test fails because the current code selects a PENDING row without a row lock and races when no row exists.

- [ ] **Step 4: Serialize by fulfillment row**

Inside one Drizzle transaction:

1. Insert the PENDING fulfillment with `onConflictDoNothing`.
2. Select the row by `fulfillmentKey` with `FOR UPDATE`.
3. Return immediately when status is not PENDING.
4. Validate positive credits.
5. Insert the credit package and credit transaction.
6. Mark the same fulfillment row FULFILLED.

Do not use a process-local mutex; correctness must hold across server instances.

- [ ] **Step 5: Run fulfillment and webhook tests and confirm GREEN**

Run: `pnpm vitest run src/services/payment-fulfillment.test.ts src/services/payment-fulfillment.integration.test.ts src/payment/webhooks.test.ts`

Expected: all available tests pass; the PostgreSQL test either passes or is recorded as BLOCKED with the missing variable.

- [ ] **Step 6: Commit exactly-once fulfillment**

```bash
git add src/src/services/payment-fulfillment.ts src/src/services/payment-fulfillment.test.ts src/src/services/payment-fulfillment.integration.test.ts
git commit -m "fix: serialize payment fulfillment"
```

---

### Task 6: Full Verification and Evidence Loop

**Files:**
- Modify: `.gba/0003_payment-flow/docs/0001_payment-flow_impl_notes.md`
- Modify: `.gba/0003_payment-flow/docs/index.md`
- Modify only when a check exposes a root cause: the smallest relevant source/test file.

**Interfaces:**
- Consumes: acceptance IDs A01–A24 and B01–B12.
- Produces: a truthful final conclusion of `代码闭环通过`, `Stripe 沙箱闭环通过`, or `未通过`, with command output and blockers.

- [ ] **Step 1: Run the narrow payment suite**

Run:

```bash
pnpm vitest run \
  src/components/common/checkout-button.test.tsx \
  src/config/pricing-products.test.ts \
  src/services/billing.test.ts \
  src/app/api/billing/stripe/checkout/route.test.ts \
  src/app/api/billing/creem/checkout/route.test.ts \
  src/app/api/webhooks/stripe/route.test.ts \
  src/payment/webhooks.test.ts \
  src/services/payment-fulfillment.test.ts \
  src/services/payment-fulfillment.integration.test.ts
```

Expected: zero failures. For each failure, use systematic-debugging to find the root cause, write or preserve a reproducing test, make the smallest fix, and rerun this step.

- [ ] **Step 2: Run repository checks**

Run in order:

```bash
pnpm test
pnpm run lint
pnpm run build:prod
```

Expected: all three commands exit `0`. Repeat diagnose → test → fix → verify until clean or until the same external blocker has been proved three times.

- [ ] **Step 3: Audit local sandbox prerequisites without exposing values**

Record only presence/absence and safe prefixes for `DATABASE_URL`, `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, the six `STRIPE_PRICE_*` variables, `BETTER_AUTH_SECRET`, and `NEXT_PUBLIC_APP_URL`. Check availability of Stripe CLI and a test user. Never print full values.

- [ ] **Step 4: Execute B01–B12 when prerequisites exist**

Start the app on port 8080, forward Stripe test webhooks to `/api/webhooks/stripe`, complete the specified test payments/subscription/refund/replay cases, and record only redacted event/resource IDs plus before/after counts. Never run a live-mode charge.

- [ ] **Step 5: Write the evidence record**

Fill `.gba/0003_payment-flow/docs/0001_payment-flow_impl_notes.md` with changed files, decisions, exact commands, pass/fail counts, acceptance ID mapping, redacted sandbox evidence, and each external blocker with its next action. Do not claim B-class success from mocks.

- [ ] **Step 6: Perform completion verification**

Invoke `superpowers:verification-before-completion`, rerun every command cited in the final evidence, run `git diff --check`, and scan changed files for secret patterns. The final response must match fresh output.

- [ ] **Step 7: Commit and push verified implementation**

```bash
git add \
  'ima ima queencard/src/src/components/common/checkout-button.tsx' \
  'ima ima queencard/src/src/components/common/checkout-button.test.tsx' \
  'ima ima queencard/src/src/config/pricing-products.test.ts' \
  'ima ima queencard/src/src/services/billing.ts' \
  'ima ima queencard/src/src/services/billing.test.ts' \
  'ima ima queencard/src/src/app/api/billing/stripe/checkout/route.ts' \
  'ima ima queencard/src/src/app/api/billing/stripe/checkout/route.test.ts' \
  'ima ima queencard/src/src/app/api/billing/creem/checkout/route.ts' \
  'ima ima queencard/src/src/app/api/billing/creem/checkout/route.test.ts' \
  'ima ima queencard/src/src/app/api/webhooks/stripe/route.ts' \
  'ima ima queencard/src/src/app/api/webhooks/stripe/route.test.ts' \
  'ima ima queencard/src/src/services/payment-fulfillment.ts' \
  'ima ima queencard/src/src/services/payment-fulfillment.test.ts' \
  'ima ima queencard/src/src/services/payment-fulfillment.integration.test.ts' \
  .gba/0003_payment-flow/docs/0001_payment-flow_impl_notes.md \
  .gba/0003_payment-flow/docs/index.md
git commit -m "fix: complete stripe payment flow"
git push origin feat/payment-flow
```

Expected: push succeeds. Merge into `main` only through git merge or PR; never copy files from the worktree.
