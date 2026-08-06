# WeChat Direct Merchant Payment Completion Plan

## Goal

Ship the native WeChat mini-program with production-ready direct-merchant payment, payment recovery, atomic credit fulfillment, refunds, auditability, and deployment gates while preserving the existing Queencard UI.

## Global Constraints

- Direct merchant mode only. Use `/v3/pay/transactions/jsapi`.
- Never trust the mini-program payment callback as proof of payment.
- Credits are fulfilled only after a verified WeChat notification or a verified order query.
- Payment and refund processing must be idempotent and PostgreSQL-safe.
- Prefer WeChat Pay public-key verification keyed by `Wechatpay-Serial`; retain platform-certificate compatibility.
- Secrets belong only in deployment environment variables and must never be committed.
- Preserve unrelated dirty worktree changes, especially template and prompt migration work.
- Use test-driven development for every behavior change.

## Task 1: Payment Provider

- Extend the WeChat Pay v3 provider with response signature verification.
- Support WeChat Pay public key ID separately from merchant certificate serial.
- Add direct-merchant order query by `out_trade_no`.
- Add refund query by `out_refund_no`.
- Include refund notification URL in refund requests.
- Cover signing, public-key routing, queries, malformed responses, and compatibility with focused tests.

Write scope: `backend/src/payments/**`, `backend/test/wechat-pay-v3.test.js`.

## Task 2: Production and Deployment Gates

- Permit `PAYMENT_PROVIDER=wechat` in production preflight.
- Require and validate all direct-merchant payment fields, HTTPS notification URLs, APIv3 key length, and public-key/certificate verification material.
- Add a payment-enabled deployment-smoke profile without weakening the payment-disabled profile.
- Update environment examples and Docker catalog packaging.

Write scope: `backend/src/services/production-preflight.js`, `backend/test/preflight.test.js`, `backend/test/deployment-smoke.test.js`, `backend/.env*.example`, `backend/Dockerfile`, deployment documentation only.

## Task 3: Mini-program Payment UX

- After `wx.requestPayment` resolves, ask the backend to reconcile the order instead of only polling local state.
- Preserve clear states for user cancellation, paid-but-syncing, fulfilled, failed, canceled, and refunded.
- Never expose mock payment controls in production.
- Preserve current Queencard styling and compact portrait layout.

Write scope: `app/pages/pricing/**`, `app/pages/billing/**`, `app/services/billing.js`, focused app tests.

## Task 4: Server Reconciliation, Refunds, and Audit

- Add an authenticated user order-reconcile endpoint and an admin reconcile endpoint.
- Verify queried transaction AppID, merchant ID, amount, order number, and success state before atomic fulfillment.
- Add a bounded stale-order reconciliation worker using leases or equivalent single-worker safety.
- Model refund acceptance separately from refund success.
- Add refund callback/query reconciliation and payment audit events.

Write scope: `backend/src/app.js`, order/payment services, repositories/store contract and migrations, focused payment application/store tests. Do not edit the payment provider implementation owned by Task 1.

## Integration and Release Gates

- Review and combine all task patches without reverting unrelated changes.
- Run focused tests after every integration, then all backend and app tests.
- Run real PostgreSQL integration tests when `DATABASE_URL_TEST` is available.
- Run production preflight and payment-enabled deployment smoke with placeholder-safe test credentials.
- Open the mini-program in WeChat Developer Tools and visually inspect pricing, order, account, and payment status screens.
- Real-device one-cent payment and refund remain mandatory before public release.
