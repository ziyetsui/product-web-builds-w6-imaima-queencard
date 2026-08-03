# Complete Miniapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan one task at a time, with a fresh implementation agent and review agent for every task.

**Goal:** Deliver a production-oriented native WeChat mini-program and standalone backend that preserve the Queencard visual language, reproduce the approved Web-visible product capabilities, and remain independently deployable.

**Architecture:** Keep `app/` as a native mini-program and `backend/` as a thin HTTP adapter over explicit domain services. PostgreSQL is the production source of truth, S3-compatible object storage owns private binary assets, a database-leased worker executes generation, and WeChat Pay API v3 is implemented behind a disabled-by-default provider mode.

**Tech Stack:** WeChat native WXML/WXSS/JavaScript, Node.js CommonJS, Node test runner, PostgreSQL (`pg`), S3-compatible storage (`@aws-sdk/client-s3` and presigner), image metadata validation (`sharp`), Node `crypto`, Docker/Zeabur.

## Global Constraints

- Work only in `app/`, `backend/`, and `.gba/0001_complete-miniapp/`; do not edit the Web product.
- Keep Web and Mini independently deployable: separate servers, domains, databases, object storage, identities, credits, orders, and histories are valid. Template synchronization uses a pinned, checksummed artifact and creates no runtime dependency on the Web service.
- Preserve all existing template records and stable ids. The catalog import must produce the union of current Mini and reconciled Web data after deterministic deduplication.
- Keep real credentials out of source, fixtures, logs, snapshots, and commits.
- Production defaults: PostgreSQL required, S3-compatible storage required, development login disabled, mock payment disabled, payment provider `disabled`.
- Every write API accepts or derives an idempotency key; credits, order fulfillment, payment callbacks, and refunds are transactionally idempotent.
- Every task follows red-green-refactor: add a focused failing test, run it and capture the expected failure, implement the minimum coherent behavior, then run focused and full suites.
- An implementation task is not complete until `npm test` in `backend/`, `npm run validate` in `app/`, and `git diff --check` pass for its write scope.

---

## Task 1: Production Runtime Foundation

**Files:**
- Modify: `backend/package.json`
- Create: `backend/package-lock.json`
- Create: `backend/src/config.js`
- Modify: `backend/src/server.js`
- Modify: `backend/src/listen-options.js`
- Create: `backend/test/config.test.js`
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Modify: `backend/.env.example`
- Modify: `backend/.env.zeabur.example`

**Red test:** `config.test.js` must prove that production startup rejects missing `DATABASE_URL`, storage configuration, auth secret, and WeChat app credentials; secrets are redacted from diagnostics; non-production defaults remain usable. Run `cd backend && node --test test/config.test.js` and confirm failure before implementation.

**Implementation contract:** export `loadConfig(env)` with typed `server`, `database`, `wechat`, `storage`, `generation`, and `payment` sections. `server.js` constructs dependencies from that object and handles `SIGTERM`/`SIGINT` by stopping HTTP, workers, storage clients, and the database pool. Health output includes build SHA and dependency readiness but no secrets.

**Green verification:** `cd backend && npm install && npm test`; `docker build` when Docker is available; `cd ../app && npm run validate`; `git diff --check`.

**Commit:** `build: add production miniapp runtime foundation`

## Task 2: PostgreSQL Schema, Repository, and Legacy Import

**Files:**
- Create: `backend/migrations/001_initial.sql`
- Create: `backend/src/db/pool.js`
- Create: `backend/src/db/migrate.js`
- Create: `backend/src/repositories/postgres-store.js`
- Create: `backend/src/repositories/store-contract.js`
- Modify: `backend/src/store.js`
- Create: `backend/scripts/migrate-sqlite-to-postgres.js`
- Create: `backend/test/postgres-store.test.js`
- Create: `backend/test/legacy-migration.test.js`
- Modify: `backend/package.json`

**Red test:** repository contract tests must cover users, sessions, credit packages/holds/transactions, tasks/leases, assets, catalog versions/templates, orders, payment fulfillment/audit, and admin audit. Legacy import tests must fail on count, balance, or checksum mismatch. Run the two focused tests and capture the missing-module failure.

**Implementation contract:** `createPostgresStore({pool, clock})` uses parameterized SQL and transactions. `001_initial.sql` creates the approved tables, unique `(appid, openid)`, unique idempotency keys, immutable ledger constraints, and lease indexes. Production never silently falls back to SQLite. The migration script is one-way, dry-run by default, copies legacy ids into metadata, and requires `--apply` plus successful reconciliation to finalize.

**Green verification:** focused repository tests, optional `DATABASE_URL_TEST` integration against real PostgreSQL, full backend tests, app validation, and `git diff --check`.

**Commit:** `feat: add postgres store and legacy migration`

## Task 3: WeChat Identity and Revocable Sessions

**Files:**
- Modify: `backend/src/auth.js`
- Create: `backend/src/services/auth-service.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/auth.test.js`
- Create: `backend/test/auth-service.test.js`
- Modify: `app/services/api.js`
- Modify: `app/services/auth.js`
- Modify: `app/services/session.js`
- Modify: `app/app.js`
- Modify: `app/pages/account/index.js`

**Red test:** prove opaque random tokens are stored only as SHA-256 hashes, logout revokes the current session, expiration and disabled users return 401, `code2Session` appid/openid validation is enforced, and production development login is impossible. Add an app validator fixture that confirms a 401 clears local session and redirects to a login-capable page.

**Implementation contract:** `AuthService.loginWithCode`, `authenticate`, `touchSession`, and `logout` own session lifecycle. User identity is `wechat:{appid}:{openid}`; `(appid, openid)` is authoritative and `unionid` optional. API request errors have stable `code` values (`AUTH_REQUIRED`, `SESSION_EXPIRED`, `ACCOUNT_DISABLED`). The client performs one controlled login retry and never renders raw 401 text.

**Green verification:** auth tests, server tests, full suites, app validation, diff check.

**Commit:** `feat: add revocable wechat sessions`

## Task 4: Versioned Template Catalog and Complete Discovery UI

**Files:**
- Create: `backend/catalog/schema.json`
- Create: `backend/catalog/catalog.snapshot.json`
- Create: `backend/scripts/build-template-catalog.js`
- Create: `backend/src/services/catalog-service.js`
- Modify: `backend/src/templates.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/templates.test.js`
- Create: `backend/test/catalog.test.js`
- Modify: `app/services/templates.js`
- Modify: `app/pages/index/index.js`
- Modify: `app/pages/index/index.wxml`
- Modify: `app/pages/index/index.wxss`

**Red test:** prove imports preserve the union, reject duplicate conflicting ids and broken assets, calculate a stable checksum, and switch the active catalog only after a complete transaction. API tests cover `catalogVersion`, category, tags, keyword, deterministic `default/latest/hot/potential` sorts, and pagination without duplicated rows. Client validation covers version-aware caching and stale request cancellation.

**Implementation contract:** normalize the latest Web catalog from `origin/feat/prompt-replication` plus all current mini-program records into `id,title,author,category,tags,prompt,referenceImages,previewImages,source,metrics,createdAt,updatedAt`. The verified Web source contains 2,155 BO records (332 爆款图文, 1,000 梗图, 823 公众号配图) and combines them with 122 XHS records for 2,277 records before cross-source deduplication. The index UI keeps existing style but renders server categories, correct counts, deterministic card sequences, loading/empty/error states, and infinite pagination. No checked-in asset or existing record is dropped.

**Green verification:** build catalog twice and compare checksums; assert the generated catalog contains the complete 2,277-record Web union before any documented exact-id deduplication, validate every local asset reference, then run tests, validation, and diff check.

**Commit:** `feat: add versioned template catalog`

## Task 5: Private Uploads and S3-Compatible Asset Storage

**Files:**
- Create: `backend/src/storage/storage.js`
- Create: `backend/src/storage/local-storage.js`
- Create: `backend/src/storage/s3-storage.js`
- Create: `backend/src/services/asset-service.js`
- Modify: `backend/src/assets.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/assets.test.js`
- Create: `backend/test/storage.test.js`
- Modify: `app/services/api.js`
- Modify: `app/pages/generate/index.js`
- Modify: `app/pages/result/index.js`

**Red test:** reject oversize, mismatched MIME/magic bytes, unsupported formats, corrupt images, excessive dimensions, and cross-user downloads. Prove object keys never use client filenames, generated download URLs expire, and local development files are not publicly enumerable.

**Implementation contract:** `AssetStorage` exposes `put`, `head`, `getSignedDownloadUrl`, and `delete`. `AssetService` validates bytes with `sharp`, stores owner metadata, and returns asset ids rather than provider/public URLs. Local storage is non-production only; S3 supports Zeabur/MinIO and standard S3 endpoints. Mini uploads use asset ids and result saving requests an authorized short-lived URL.

**Green verification:** focused asset/storage tests, full tests, app validation, diff check.

**Commit:** `feat: secure miniapp asset storage`

## Task 6: Authoritative Model Registry and Provider Contracts

**Files:**
- Create: `backend/config/models.json`
- Create: `backend/src/services/model-registry.js`
- Modify: `backend/src/providers/index.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/providers.test.js`
- Create: `backend/test/model-registry.test.js`
- Modify: `app/services/generation.js`
- Modify: `app/pages/generate/index.js`
- Modify: `app/pages/generate/index.wxml`

**Red test:** cover GPT Image 2 as default plus Gemini 3.1 Flash Image Preview, Seedream 5.0, Doubao Seedream 5.0, and Vidu Q2 capability/price records. Reject unsupported model-mode-reference-count-aspect-resolution-output combinations before provider calls. Provider tests must preserve structured upstream errors and handle sync and async provider responses.

**Implementation contract:** registry fields include public label, provider, provider model id, enabled flag, generation capabilities, reference limits, aspect ratios, resolutions, output limit, estimated credits, timeout, and retry policy. `/api/miniapp/models` and estimate responses are authoritative. Disabled or unverified models are hidden. GPT Image 2 remains default.

**Green verification:** registry and provider tests, full suites, app validation, diff check.

**Commit:** `feat: add miniapp model registry`

## Task 7: Durable Generation Worker and Credit Holds

**Files:**
- Create: `backend/src/services/credit-service.js`
- Create: `backend/src/services/generation-service.js`
- Create: `backend/src/worker/generation-worker.js`
- Modify: `backend/src/app.js`
- Modify: `backend/src/server.js`
- Modify: `backend/test/store.test.js`
- Create: `backend/test/credit-service.test.js`
- Create: `backend/test/generation-worker.test.js`
- Create: `backend/test/generation-api.test.js`

**Red test:** prove submit creates task and hold atomically; same idempotency key returns the same task; concurrent submissions cannot overspend; completed output settles actual credits once; failed/canceled/permanently timed-out work releases holds; expired leases are reclaimed after restart; retryable provider errors back off within a capped attempt count.

**Implementation contract:** remove `setTimeout` generation and direct `store.charge`. Workers claim with a lease, persist provider ids/poll cursors, extend leases while active, and write completed assets before settling. HTTP submit returns 202. A task state endpoint exposes stable machine codes and retry timing without raw provider secrets.

**Green verification:** focused worker/credit/API tests including fake clocks and two workers, full suites, app validation, diff check.

**Commit:** `feat: make generation durable and credit-safe`

## Task 8: Complete Generate, Result, and History Flows

**Files:**
- Modify: `app/pages/generate/index.js`
- Modify: `app/pages/generate/index.wxml`
- Modify: `app/pages/generate/index.wxss`
- Modify: `app/pages/result/index.js`
- Modify: `app/pages/result/index.wxml`
- Modify: `app/pages/result/index.wxss`
- Modify: `app/pages/history/index.js`
- Modify: `app/pages/history/index.wxml`
- Modify: `app/pages/history/index.wxss`
- Modify: `app/services/generation.js`
- Modify: `app/tools/validate.js`

**Red test:** add pure exported helpers or validator fixtures for multi-reference restoration, result back-navigation to the exact prior input, stale poll cancellation, bounded polling with manual refresh, continuation using plural `referenceImagePaths`, history output thumbnails, generation failure messaging, and save authorization.

**Implementation contract:** preserve form state across submit/result/back; template and free-create modes share one request builder; users can replace/remove up to model limits; result supports refresh, save, regenerate, and continue editing; history has pagination, status filters, task detail, retry, and empty/error/login states. Never substitute input images as completed outputs.

**Green verification:** app validation plus backend API tests, then Developer Tools scripted/manual walkthrough for template -> edit -> submit -> result -> save -> back -> unchanged input -> history.

**Commit:** `feat: complete miniapp generation workflows`

## Task 9: Credits, Pricing, Orders, Billing, and Account UI

**Files:**
- Modify: `backend/src/app.js`
- Create: `backend/src/services/order-service.js`
- Modify: `backend/test/server.test.js`
- Create: `backend/test/orders.test.js`
- Modify: `app/services/credits.js`
- Modify: `app/services/billing.js`
- Modify: `app/services/account.js`
- Modify: `app/pages/credits/*`
- Modify: `app/pages/pricing/*`
- Modify: `app/pages/billing/*`
- Modify: `app/pages/account/*`

**Red test:** enforce product snapshot immutability, owner-only order access, correct nested billing DTO normalization, ledger pagination, account profile limits, disabled-user handling, and visible login state. App validation must catch the current billing nesting mismatch.

**Implementation contract:** credits show available/held/expiring balances and immutable transactions; pricing shows server products and payment availability; billing shows orders and payment/credit events; account shows WeChat identity-safe profile fields, role, logout, and admin entry only for admins. Maintain compact vertical Queencard styling with no overlapping logo/buttons/text.

**Green verification:** order/server tests, full suites, app validation, visual screenshots at iPhone 12/13 and a narrow Android viewport.

**Commit:** `feat: complete miniapp account and billing flows`

## Task 10: WeChat Pay API v3, Notifications, and Refunds

**Files:**
- Create: `backend/src/payments/payment-provider.js`
- Create: `backend/src/payments/disabled-provider.js`
- Create: `backend/src/payments/mock-provider.js`
- Create: `backend/src/payments/wechat-pay-v3.js`
- Modify: `backend/src/services/order-service.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/wechat-pay-v3.test.js`
- Create: `backend/test/payment-notify.test.js`
- Create: `backend/test/refunds.test.js`
- Modify: `app/services/billing.js`
- Modify: `app/pages/pricing/index.js`

**Red test:** use generated RSA fixtures to verify API v3 authorization canonical strings, mini-program pay signatures, notification signature verification, AES-256-GCM decryption, duplicate event idempotency, amount/appid/mchid/order checks, and refund reuse of the original merchant refund id. Prove `mock` is rejected in production and `disabled` cannot create a payable order.

**Implementation contract:** `wechat` mode calls `POST /v3/pay/transactions/jsapi`, returns `timeStamp`, `nonceStr`, `package=prepay_id=...`, `signType=RSA`, and `paySign`; client invokes `wx.requestPayment` then queries backend order status instead of trusting the front-end callback. Notify verifies WeChat signature using configured WeChat Pay public key/platform certificate, decrypts resource with API v3 key, and fulfills exactly once. Refund calls `POST /v3/refund/domestic/refunds`, persists state, and reconciles asynchronously. Production default stays `disabled` until merchant id, bound appid, API certificate private key/serial, API v3 key, WeChat Pay verification key, and HTTPS notify URL pass readiness checks.

**Green verification:** cryptographic fixture tests, payment/refund tests, full suites, app validation. Real payment remains an explicit staging acceptance gate, not a test claim.

**Commit:** `feat: implement gated wechat pay v3`

## Task 11: Role-Gated Administration and Audit

**Files:**
- Create: `backend/src/services/admin-service.js`
- Modify: `backend/src/app.js`
- Create: `backend/test/admin.test.js`
- Modify: `app/services/admin.js`
- Modify: `app/pages/admin/index.js`
- Modify: `app/pages/admin/index.wxml`
- Modify: `app/pages/admin/index.wxss`

**Red test:** non-admin routes return 403; every credit adjustment, user status change, task retry/cancel, order cancel/refund, and admin note creates an append-only audit record with actor, target, reason, and before/after summary. Refund cannot exceed paid value or run twice. Search/pagination filters are deterministic.

**Implementation contract:** admin UI exposes users, ledger, tasks, orders, payment events, refunds, and audit records in compact tabs. Dangerous actions require a reason and confirmation. No admin capability is inferred from client state or visible to ordinary users.

**Green verification:** admin tests, full suites, app validation, Developer Tools admin/non-admin screenshots and route checks.

**Commit:** `feat: add audited miniapp administration`

## Task 12: Release Hardening and End-to-End Acceptance

**Files:**
- Modify: `backend/README.md`
- Modify: `backend/docs/zeabur-deploy.md`
- Create: `backend/scripts/readiness-check.js`
- Create: `backend/scripts/reconcile-stuck-work.js`
- Create: `backend/test/readiness.test.js`
- Modify: `app/README.md`
- Modify: `app/project.config.json`
- Create: `.gba/0001_complete-miniapp/evidence/release-checklist.md`

**Red test:** readiness must fail for missing/weak production secrets, unavailable database/storage, unrun migrations, invalid public HTTPS URL, enabled payment without credentials, catalog count regression, and a disabled default model. It must not print secrets.

**Implementation contract:** document exact Zeabur services, build/start/migrate/worker commands, volumes, environment variables, health/readiness paths, rollback, object lifecycle, database backup, log redaction, WeChat request/upload/download domains, and payment staging gate. Reconcile command safely releases expired holds, requeues expired leases, checks payment states, and is idempotent.

**Green verification:**

1. `cd backend && npm test`
2. `cd app && npm run validate`
3. run catalog build twice and compare checksum/count
4. run readiness against local non-production configuration and a production-negative fixture
5. start backend, verify health, login fixture, templates, estimate, task, history, credits, orders, billing, account, and admin endpoints
6. open the project in WeChat Developer Tools and inspect all nine pages at two viewport sizes; save screenshots under `.gba/0001_complete-miniapp/evidence/`
7. verify no text overlap, blank images, raw 401, public private-assets, infinite polling, or stale state
8. `git diff --check` and secret scan

**Commit:** `chore: harden complete miniapp release`

## Final Integration Review

- A fresh review agent compares the complete branch to `0001_complete-miniapp-production-design.md` and this plan.
- Review findings are fixed with focused regression tests.
- Re-run all Task 12 verification commands from a clean process.
- Do not enable real payment or claim payment acceptance until a merchant test order produces a signed WeChat notification, exact amount/appid/mchid checks pass, credits are fulfilled once, order query confirms `SUCCESS`, and a test refund is reconciled.
