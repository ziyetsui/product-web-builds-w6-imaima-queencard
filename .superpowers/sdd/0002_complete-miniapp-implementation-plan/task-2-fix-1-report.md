# Task 2 Fix Round 1 Report

## Status

Complete. All P0/P1 review findings and the requested PostgreSQL test-boundary correction are implemented. Production still fails closed on object storage because S3 remains explicitly deferred to Task 5.

## Review Finding Resolution

### Async store contract

- Converted `backend/src/app.js` authentication, current-user, template sync, orders, billing, credits, tasks, generation, regeneration, admin, and asset paths to await store methods.
- Made generation submission asynchronous and attached rejection handling to background generation work.
- Added an API suite backed by a genuinely deferred async store. It verifies concrete DTOs across the route surface and verifies that rejected store promises reach the normal sanitized error response.

### Transactional credit accounting

- Added checked, conditional user-balance updates. Missing users and insufficient balances no longer pass through unchecked `UPDATE` statements.
- Made package creation retry-safe and tied every spendable package remainder to the matching user balance. Intentional grants without caller IDs remain independent.
- Made charges, negative admin adjustments, refunds, holds, settlements, and releases update package remainder/frozen credits and user balance in the same transaction.
- Fixed multi-package settlement to release the residual once across the allocation list.
- Strengthened the production package constraint to require `remaining_credits + frozen_credits <= initial_credits`.

### Atomic idempotency and concurrency

- Holds reserve the idempotency key before changing balances and return the committed existing hold on conflict.
- Tasks use the `(owner_id, idempotency_key)` unique constraint for idempotent creation and return the existing task on conflict.
- Orders use the `(user_id, idempotency_key)` unique constraint and return the existing order on conflict.
- Added `Promise.all` retry tests plus concurrent overspend tests. The optional real PostgreSQL test uses two store instances so database constraints, rather than only in-process coalescing, own cross-request concurrency.

### Verified payment fulfillment

- Direct `fulfillOrder` is no longer a credit-granting path in the PostgreSQL repository.
- Credit grant requires `fulfillPayment` with an explicit verified WeChat event, provider transaction ID, fulfillment status, and an order created in WeChat payment mode.
- Fulfillment record insertion, order locking, package grant, balance grant, transaction ledger entry, and order verification update share one transaction.
- Manual/mock/imported orders, record-only fulfillment rows, and admin audit events cannot grant credits. Replay is idempotent, while conflicting replay identities are rejected.
- Refunds revoke only the still-unspent package remainder associated with the verified order.

### Legacy import reconciliation

- The one-way migration remains dry-run by default and still requires `--apply` for writes.
- Imported payment state remains explicitly unverified and cannot use direct/manual fulfillment.
- Reconciliation now hashes canonicalized complete relevant user, transaction, generation task request/image, template prompt/asset, order amount/status/credit/payment-verification, and payment-audit content.
- Reconciliation checks all table counts, total user balance, and the deep checksum before committing.
- Added same-ID/count/balance corruption cases for transaction amounts, task request/images, template prompts/assets, order payment fields, and audit content.

### PostgreSQL test boundary

- Removed pg-mem SQL parameter substitution. Repository tests pass bindings through the pg-compatible driver unchanged.
- pg-mem loads only the supported pre-trigger schema and explicitly relaxes its unsupported package check. It is not claimed to validate the production trigger or complete PostgreSQL DDL.
- Added static production invariant assertions and a fake-client assertion proving the migration runner submits the raw migration SQL unchanged.
- Added `npm run test:postgres:integration`. It creates an isolated schema and exercises the raw migration, immutable trigger, driver binding, accounting, and cross-store concurrency when `DATABASE_URL_TEST` is configured.
- The real integration was not run because `DATABASE_URL_TEST` is absent. Calling the explicit command without it fails with `DATABASE_URL_TEST is required for the explicit PostgreSQL integration test`; the normal suite reports one visible skip.

## TDD Evidence

- Async API red: login returned a Promise as `{}` and downstream `user.id` was undefined. Green: async route DTO and rejection tests pass.
- Accounting red: package remainder drifted from balance, duplicate grants credited incorrectly, holds could outspend balance, multi-package release was repeated, and concurrent charges could overspend. Green: focused package/hold/settle/concurrency tests pass.
- Independent grant red: two package grants without IDs returned the same generated package. Green: generated grants remain independent while explicit-ID retries remain idempotent.
- Fulfillment red: direct/manual/mock paid state could reach the credit grant path. Green: only a verified WeChat event can grant, and replay/refund behavior is covered.
- Reconciliation red: deep-content comparison helpers and corruption detection were absent. Green: complete-content checksum and corruption tests pass.
- Binding red: the pg-mem helper silently rewrote a missing bind parameter to `NULL`. Green: the driver rejects the missing parameter and round-trips quoted bind values.

## Verification

- `cd backend && npm test`: 86 tests, 85 passed, 0 failed, 1 visible skip for absent `DATABASE_URL_TEST`; natural process exit in 610 ms.
- Post-test process scan: no surviving `npm test`, `node --test`, or `runtime.test.js` process.
- `cd app && npm run validate`: 53 files, 24 backend assets, passed.
- `node --check` on all changed JavaScript implementation and test files: passed.
- `cd backend && npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: passed.
- `env -u DATABASE_URL_TEST npm run test:postgres:integration`: intentionally failed with the required missing-URL message, proving the explicit release gate cannot silently skip.

## Concerns

- No real PostgreSQL server URL was available, so production DDL, trigger execution, and cross-connection concurrency still require `DATABASE_URL_TEST` before release. No real PostgreSQL pass is claimed.
- pg-mem does not execute the production immutable-ledger trigger or package sum check; those are owned by raw migration assertions and the optional real integration test.
- S3/object storage remains fail-closed and deferred to Task 5 as required.
