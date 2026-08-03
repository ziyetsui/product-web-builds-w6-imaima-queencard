# Task 2 Fix Round 4 Report

## Status

Implemented the three findings from `task-2-re-review-3.md`. Memory and SQLite now share the PostgreSQL order replay contract. SQLite mock fulfillment is exactly-once across independent processes. PostgreSQL mock fulfillment now requires the deterministic `mock:<orderId>` identity tuple and persisted pending state before the first grant.

## Order Creation And Replay

- Added the same canonical SHA-256 request fingerprint shape used by PostgreSQL: owner, idempotency key, product, channel, initial order/payment state, amount, currency, fixed credits, product snapshot, and metadata.
- Memory now scopes idempotency by `userId`, rejects changed payloads with the generic 409 conflict, and rejects explicit order-id collisions owned by another user.
- SQLite now persists nullable `idempotency_key` and `request_fingerprint` columns, upgrades existing databases with `ensureColumn`, and adds a partial unique `(user_id, idempotency_key)` index. Creation/replay is protected by `BEGIN IMMEDIATE`.
- Both adapters return a non-enumerable `created` marker. The HTTP route therefore returns 201 and creates one `create` audit for insertion, then returns 200 without another audit for a valid retry.
- Added direct adapter tests for immutable replay, canonical key order, payload mismatch, and cross-owner collision; added HTTP tests for status and audit behavior; added SQLite reopen coverage.

## SQLite Exactly-Once Mock Fulfillment

- Moved the persisted order-state check, balance read, balance update, deterministic ledger insert, and guarded pending-to-paid transition into one `BEGIN IMMEDIATE` transaction.
- Added `PRAGMA busy_timeout = 5000` so a competing SQLite connection waits for the writer and then re-reads the completed order.
- Mock credit transactions use the deterministic primary key `mock-grant:<orderId>`. The order transition remains guarded by pending mock state and `fulfilled_at IS NULL`.
- Added a real `child_process.spawn` regression test with two independent Node processes sharing one SQLite file. It asserts one `fulfilled: true`, one idempotent replay, one credit grant, and one ledger row.

## PostgreSQL Mock Boundary

- `fulfillMockOrder` now requires `fulfillmentKey`, `eventId`, and `providerTransactionId` all to equal `mock:<orderId>`, with mock provider/mode, fulfilled status, and payment verification enabled.
- The locked order must be a persisted pending mock order (`status = pending`, `payment_status = mock_pending`, no `fulfilled_at`, and not already payment-verified) for the first fulfillment.
- Completed matching mock orders remain idempotent replays; inconsistent completed-looking rows and mismatched identities are rejected.
- Added focused pg-mem tests for arbitrary identities, completed replay, tuple mismatch, and inconsistent persisted state.

## TDD Evidence

- RED: before implementation, local replay tests observed fresh creation instead of 200 replay, the new PostgreSQL boundary test reported `Missing expected rejection`, and the two-process SQLite test exposed a lock/error result instead of an idempotent replay.
- GREEN: the focused adapter/server/PostgreSQL suite passed 55/55 after the implementation; the final full suite also covers the added reopen and worker-diagnostic tests.

## Verification

- `cd backend && npm test`: 109 tests, 108 passed, 0 failed, 1 skipped because `DATABASE_URL_TEST` is unset.
- `cd app && npm run validate`: passed, 53 files, 24 backend assets.
- `cd backend && npm audit --omit=dev`: 0 vulnerabilities.
- `node --check` passed for all backend JavaScript files.
- `git diff --check`: passed.
- `cd backend && npm run test:postgres:integration`: intentionally executed with the explicit required gate; blocked at `DATABASE_URL_TEST is required for the explicit PostgreSQL integration test`. No real PostgreSQL pass is claimed.

## Scope And Concerns

- No work was done on Tasks 5, 7, or 10.
- pg-mem verifies repository behavior but does not replace the accepted real PostgreSQL release gate.
- `backend/node_modules` was installed only for verification and is removed before final status.
