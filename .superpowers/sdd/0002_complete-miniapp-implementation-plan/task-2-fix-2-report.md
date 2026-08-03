# Task 2 Fix Round 2 Report

## Status

Complete for the fix-round rulings. Provider payment identity, development PostgreSQL mock fulfillment, package/hold retry ownership, and legacy user timestamp reconciliation are implemented. Generation durability and production WeChat notification handling remain explicitly outside Task 2.

## Implemented

### Provider payment identity

- Added migration `002_payment_and_retry_identity.sql` with database-backed unique `(provider, provider_transaction_id)` and `(provider, event_id)` indexes.
- Fulfillment lookup now resolves conflicts through the caller key, provider transaction, and provider event.
- An identical replay with another fulfillment key returns the original fulfillment and associated `orderId` without another grant.
- A provider transaction or event associated with another order returns a generic HTTP/repository 409 without exposing the original order.
- Fulfillment insert, identity resolution, order lock, package/balance grant, ledger append, and order update remain in one explicit transaction.
- Verified WeChat fulfillment still requires provider `wechat`, `paymentVerified: true`, a fulfilled event, provider event and transaction IDs, and an order persisted in WeChat mode.

### Development PostgreSQL mock fulfillment

- Added the explicit `fulfillMockOrder` store contract and implemented it for PostgreSQL, memory, and SQLite compatibility.
- The HTTP mock route now requires a non-production environment, resolved mock provider/mode, and a persisted mock-mode order.
- PostgreSQL independently requires its construction environment to be non-production plus explicit mock provider/mode/verification fields.
- Mock fulfillment uses deterministic per-order event, transaction, and fulfillment identities, so HTTP and repository replay are idempotent.
- Manual orders, imported legacy orders, and production PostgreSQL stores are rejected without a balance grant.
- No production WeChat notify route, signature verification, decryption, or payment API was added; those remain Task 10.

### Package and hold retry identity

- Added immutable request fingerprints to new credit packages and credit holds through migration `002`.
- Package fingerprints include owner, initial/starting allocation, transaction type, order, initial status/expiry, and metadata. Mutable remainder/status changes no longer invalidate a legitimate retry.
- Hold fingerprints include owner, task, idempotency key, credits, and requested package allocation.
- In-process single-flight keys include owner and the complete normalized request fingerprint.
- Sequential and concurrent owner/payload collisions return generic 409 errors before balance/package mutation; retries for rows predating the fingerprints fail closed.

### Legacy users.updated_at

- Added legacy and imported `users.updated_at` to canonical reconciliation content.
- Imported snapshots now select the field and inserts preserve it, falling back to source `created_at` only when absent.
- Added target corruption and canonical checksum mutation tests for this field.

### Optional real PostgreSQL gate

- The optional test now requires migration version 2.
- Added a failed hold allocation after insertion and balance update, then asserts the real transaction restores balance and removes the hold.
- Added provider-transaction replay through two store instances, including identical alternate-key replay and different-order rejection.
- The normal suite visibly skips this test when `DATABASE_URL_TEST` is absent. The explicit command fails clearly when the URL is absent.

## TDD Evidence

- Payment identity red: an alternate fulfillment key created another fulfillment, and the same provider transaction fulfilled a second order. Green: one authoritative row remains and mismatched order/event/transaction replay returns 409.
- Mock path red: PostgreSQL HTTP mock-pay returned 409 because it called strict direct fulfillment, and the repository had no mock method. Green: development mock HTTP/repository fulfillment is idempotent while manual/imported/production cases are rejected.
- Retry identity red: concurrent cross-owner package/hold collisions both reported success. Green: one succeeds, one receives generic 409, and the losing balance is unchanged.
- Payload mutation checks were verified by temporarily removing package field comparison and hold fingerprint comparison; each focused test failed at its expected missing rejection, then passed after restoration.
- Mutable package replay red: replaying an identical package request after one credit was spent returned 409. Green: the stored original request fingerprint accepts the retry without re-crediting.
- Legacy timestamp red: import replaced source `updated_at`, and changing that timestamp did not alter the checksum. Green: the timestamp is preserved and corruption fails reconciliation.

## Verification

- `cd backend && npm test`: 93 tests, 92 passed, 0 failed, 1 visible skip for absent `DATABASE_URL_TEST`; natural process exit in 766 ms.
- Post-test process scan: no surviving `npm test`, `node --test`, or `runtime.test.js` process.
- `cd app && npm run validate`: 53 files, 24 backend assets, passed.
- `node --check` on all changed JavaScript implementation and test files: passed.
- `cd backend && npm audit --omit=dev`: 0 vulnerabilities.
- Runtime store-call audit: all value-producing calls remain awaited directly or through `Promise.all`; async `close()` remains promise-adopted by the async app close path.
- `git diff --check`: passed.
- `env -u DATABASE_URL_TEST npm run test:postgres:integration`: intentionally failed with `DATABASE_URL_TEST is required for the explicit PostgreSQL integration test`.

## Concerns

- No real PostgreSQL URL was available. Raw DDL, unique-index conflict behavior, trigger execution, rollback, and cross-connection replay remain a release gate; no real PostgreSQL pass is claimed.
- Generation charge/task atomicity, detached completion durability, worker retry/observability, and credit recovery remain unresolved Task 7 work as ruled.
- Production WeChat notification HTTP handling and cryptographic verification remain unresolved Task 10 work as ruled.
- pg-mem still does not substantiate rollback, trigger, or true database concurrency behavior; normal tests cover repository logic only.
- S3/object storage remains deferred and fail-closed until Task 5.
