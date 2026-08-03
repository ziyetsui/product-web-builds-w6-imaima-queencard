# Complete Miniapp Production Design

Status: approved in conversation on 2026-08-03

## 1. Purpose

Turn the existing native WeChat mini-program and standalone backend into a
production-oriented product that matches the current ima ima Queencard Web
product's functional scope and visual language while remaining independently
deployable.

The mini-program keeps a standalone WeChat identity system in this delivery.
It does not claim that Web and mini-program accounts, credits, orders, or works
are shared. The architecture must make a later identity mapping possible
without rewriting generation, ledger, asset, or order records.

## 2. Verified Baseline

The implementation branch starts from `origin/miniapp-standalone` at commit
`029fac8f390d5ed7cee7931331fa74ab420056e0` and contains two products:

```text
app/       native WeChat mini-program
backend/   standalone mini-program BFF and business service
```

Baseline verification on 2026-08-03:

- `app/npm run validate`: passed, 53 source files and 24 backend assets.
- `backend/npm test`: passed, 39 tests and 0 failures.
- The deployed mini backend health and template endpoints were reachable, but
  the deployed SHA was not proven and the template endpoint returned 122
  records.
- The reconciled Web source contains 210 prompt cases, so template data has
  diverged.
- The current backend uses SQLite and local files, runs generation through an
  in-process timer, charges credits before generation, and does not release
  credits when generation fails.
- The current WeChat payment path is a configured placeholder or mock path. It
  does not implement WeChat Pay API v3 order creation, notification handling,
  or refunds.

## 3. Goals

1. Preserve the native mini-program UI style and existing product data.
2. Match the Web product's user-visible capabilities where WeChat permits:
   template discovery, generation, history, credits, pricing, billing, account,
   and administration.
3. Replace SQLite as the production source of truth with PostgreSQL.
4. Replace local public uploads with an S3-compatible object-storage boundary.
5. Make generation durable across process restarts and safe under concurrency.
6. Use credit holds, settlement, and release so failed work does not consume
   credits.
7. Implement real WeChat Pay API v3 code behind a disabled-by-default feature
   gate.
8. Keep all provider, WeChat, database, payment, and storage secrets on the
   backend.
9. Keep Web and mini-program deployments independent.

## 4. Non-Goals

- Binding a WeChat user to a Web Better Auth account.
- Sharing balances, orders, subscriptions, or generation history with the Web
  product in this delivery.
- Replacing or redeploying the upper-level Web service.
- Claiming real payment acceptance before merchant credentials and a signed
  notification round trip are verified.
- Migrating Web Stripe or Creem subscriptions into WeChat subscriptions.
- Reproducing desktop-only motion or layout that is unsuitable for a vertical
  native mini-program.

## 5. Chosen Architecture

### 5.1 Deployment Shape

Use an independent mini-program branch and two separately testable products:

```text
WeChat mini-program app
        |
        | HTTPS + Bearer session
        v
Mini BFF / business service
        |---- PostgreSQL
        |---- S3-compatible object storage
        |---- image provider adapters
        |---- WeChat code2Session
        `---- WeChat Pay API v3 adapter (disabled by default)
```

The mini BFF owns WeChat-specific authentication, response DTOs, uploads,
payment calls, and payment notifications. It must not depend on Web cookies or
write directly through Web route handlers.

### 5.2 Repository and Branch Boundary

- Development branch: `lemonricebal-miniapp`.
- Base: `origin/miniapp-standalone`.
- Mini-program code remains under `app/`.
- Backend code remains under `backend/`.
- Feature specifications and evidence live under
  `.gba/0001_complete-miniapp/`.
- No Web product file is copied into this branch at runtime.
- Shared template data uses a neutral catalog contract rather than importing
  React, Next.js, or Web-only modules.

### 5.3 Backend Modules

The existing monolithic request handler will be split only along business
boundaries required by this feature:

- `auth`: WeChat login, revocable sessions, current user, logout.
- `catalog`: template import, versioning, filtering, sorting, pagination.
- `credits`: packages, holds, transactions, settlement, release.
- `generation`: request validation, estimation, durable task state machine.
- `worker`: task leases, retries, provider polling, restart recovery.
- `assets`: upload validation, object storage, authorized download.
- `orders`: product snapshots, order state, fulfillment, refunds.
- `wechat-pay`: API v3 signing, JSAPI order creation, notification decrypt,
  refund calls.
- `admin`: role checks, users, ledger adjustments, tasks, orders, audit.

No general framework rewrite is required. Modules expose explicit service
interfaces and the HTTP layer remains a thin adapter.

## 6. Identity and Session Design

### 6.1 User Identity

The stable identity key remains:

```text
wechat:{appid}:{openid}
```

The database stores `appid`, `openid`, optional `unionid`, display name,
avatar URL, status, role, and timestamps. `openid` is unique only within an
`appid`; the unique constraint is `(appid, openid)`.

### 6.2 Sessions

- `wx.login()` code is exchanged server-side through WeChat `code2Session`.
- The backend creates a random opaque session token.
- Only a token hash is stored in PostgreSQL.
- Sessions are revocable, expire after a configured lifetime, and record last
  use.
- Logout revokes the current session.
- A 401 response clears the local token and returns the user to a visible
  WeChat-login state; pages must not expose a raw 401 error.
- Development login is allowed only when both `NODE_ENV != production` and an
  explicit development flag are set.

## 7. PostgreSQL Data Model

Production tables use UUID or collision-resistant string primary keys and
database timestamps. Monetary values are stored as integer cents.

### 7.1 Core Tables

- `miniapp_users`: WeChat identity and profile.
- `miniapp_sessions`: hashed, revocable session tokens.
- `credit_packages`: purchased, granted, or migrated credit lots with expiry.
- `credit_holds`: credits reserved for an in-flight generation.
- `credit_transactions`: immutable ledger entries with resulting balance.
- `generation_tasks`: request, model, state, lease, attempt, cost, and error.
- `generated_assets`: owner, task, object key, MIME, dimensions, and size.
- `reference_assets`: private user uploads and lifecycle metadata.
- `template_catalog_versions`: catalog checksum and source metadata.
- `templates`: normalized template records for the active catalog version.
- `miniapp_orders`: immutable product and amount snapshots.
- `payment_fulfillments`: provider event idempotency and fulfillment state.
- `payment_audit_events`: append-only payment and refund evidence.
- `admin_audit_logs`: actor, target, action, before/after summary, and reason.

### 7.2 Credit Invariants

- Available credits equal unexpired package remainder minus active holds.
- A generation request creates a hold and task in one transaction.
- A completed task settles only the actual successful output cost.
- A failed, canceled, or permanently timed-out task releases its remaining
  hold.
- Retrying a request with the same idempotency key must not create another hold
  or task.
- Admin adjustments are ledger transactions, never direct balance updates.
- Concurrent requests must lock or atomically update the relevant packages so
  credits cannot be overspent.

### 7.3 SQLite Migration

SQLite remains a development fallback only until migration is complete. A
one-way migration command will:

1. export users, transactions, tasks, orders, templates, and audit events;
2. import each user balance as an explicit `legacy_migration` credit package;
3. preserve old transaction and task identifiers in migration metadata;
4. copy referenced local files into object storage;
5. compare user counts, task counts, order counts, and total balances;
6. refuse to finalize when checksums or totals differ.

The migration never treats mock/manual orders as verified real payments.

## 8. Template Catalog

### 8.1 Neutral Contract

Templates use a versioned JSON-compatible record independent of Web and native
UI code. Required fields include:

```text
id, title, author, category, tags, prompt, referenceImages,
previewImages, source, metrics, createdAt, updatedAt
```

Existing XHS cases, BO landing cases, metrics, and image references are all
ingested. No current record is removed merely because a new source is added.

### 8.2 Synchronization

- The branch retains a checked-in catalog snapshot for reproducible builds.
- An import script accepts a Web catalog export or configured HTTPS catalog
  endpoint and produces the neutral snapshot plus checksum.
- The backend imports a new catalog version transactionally and switches the
  active version only after validation succeeds.
- The template API exposes `catalogVersion`, pagination, category, tags,
  keyword search, and deterministic sort modes.
- The mini-program caches the catalog version and refreshes only when it
  changes.

The first acceptance target is at least the union of the existing 122 mini
records and the 210 reconciled Web records after deduplication by stable id.

## 9. Generation and Model Registry

### 9.1 Model Registry

The backend is authoritative for model capability and pricing. The first
registry mirrors the upper product's five routes:

- GPT Image 2, the default.
- Gemini 3.1 Flash Image Preview.
- Seedream 5.0.
- Doubao Seedream 5.0.
- Vidu Q2.

Each model record defines provider adapter, supported generation modes,
reference-image count, aspect ratios, resolutions, maximum output count,
estimated credits, timeout, and whether it is enabled. The client renders only
server-enabled options.

Seedream and Doubao defaults must use a provider-supported size; a model is not
declared enabled until its default request passes a real staging test.

### 9.2 Request Contract

Generation supports:

- template-based generation and free creation;
- text-to-image, image-to-image, and image edit where the selected model allows;
- one to three reference images where supported;
- model, output count, aspect ratio, resolution, fast mode, and AI enhancement
  only when allowed by the registry;
- an idempotency key generated by the client;
- a server estimate returned before submission.

### 9.3 Durable Task State Machine

Task states are:

```text
pending -> leased -> processing -> completed
                             |-> retryable
                             |-> failed
                             `-> canceled
```

- Workers claim tasks with a database lease and expiration time.
- Expired leases are reclaimable after a process restart.
- Provider task ids and poll cursors are persisted.
- Retries use bounded exponential backoff and a maximum attempt count.
- Client polling distinguishes pending, completed, permanent failure, 401, and
  not-found states and has a maximum wait duration.
- Partial provider success settles successful outputs and releases the
  remainder.

## 10. Asset Storage and Download Security

Production uses an S3-compatible `AssetStorage` interface. Local filesystem
storage is allowed only for development and tests.

Upload rules:

- accept only configured image MIME types;
- verify magic bytes and decode the image;
- enforce per-file size, pixel dimension, and reference-count limits;
- generate server-owned object keys;
- keep reference and generated objects private by default;
- reject remote user-supplied URLs unless they pass an explicit allowlist and
  SSRF-safe fetch policy.

Download rules:

- look up the asset by id and authenticated owner;
- return a short-lived signed URL or stream the authorized object;
- never expose storage credentials or arbitrary filesystem paths;
- preserve correct MIME type, file extension, and content length;
- allow `wx.downloadFile` and `wx.saveImageToPhotosAlbum` after authorization.

## 11. Orders and WeChat Pay API v3

### 11.1 Modes

```text
disabled   production default until credentials are present
mock       tests and explicit non-production development only
wechat     real JSAPI payment
```

The application must fail closed: selecting `wechat` without every required
credential prevents startup or returns a configuration error. It never falls
back to mock payment.

### 11.2 Real Payment Code

The `wechat` adapter implements:

- JSAPI prepay order creation using the authenticated user's openid;
- server-side signing of `wx.requestPayment` parameters;
- API v3 notification signature verification and resource decryption;
- merchant order id, amount, currency, appid, and mchid validation;
- transactional, idempotent fulfillment keyed by provider event and order;
- payment failure and close-order audit events;
- refund request and refund-notification handling;
- duplicate notification safety.

Required credentials are referenced by environment-variable names only and are
never committed. Real-payment acceptance remains blocked until one signed
staging payment and notification round trip is captured as evidence.

Subscriptions are not presented as automatic WeChat recurring subscriptions
unless an approved recurring-payment product exists. Until then, recurring Web
plans are shown as non-purchasable information or replaced by compliant
one-time mini-program products.

## 12. Mini-Program Product Surface

The existing Queencard palette, borders, typography hierarchy, and compact
cards remain the visual source of truth. Layout changes are limited to vertical
screen ergonomics, safe areas, text fit, and native controls.

### 12.1 Pages

1. `index`: landing, template catalog, search, category, sort, pagination, and
   generation CTA.
2. `generate`: template-prefilled or free generation with registry-driven
   controls and up to three references.
3. `result`: durable polling, completion/failure states, save, regenerate, and
   continue with this image.
4. `history`: server history, filters, pagination, task status, save, and reuse.
5. `credits`: available/held/expiring credits and paginated ledger.
6. `pricing`: one-time products, disabled-payment messaging, and real payment
   entry only when enabled.
7. `billing`: orders, transactions, payment events, pagination, and status.
8. `account`: WeChat login, profile, logout, and navigation.
9. `admin`: role-gated users, adjustments, tasks, orders, refunds/cancel,
   notes, and audit views.

### 12.2 Required Behavior Fixes

- A result reused for generation populates the same plural reference-image
  state consumed by submission.
- A template keeps up to three reference images.
- Billing reads the backend's paginated nested records correctly.
- Failed and pending tasks never display an input reference as a generated
  result.
- Search and pagination ignore stale responses.
- Admin navigation is hidden for non-admin users and every admin API enforces
  the role server-side.
- Old task-number placeholder copy is removed.

## 13. API Compatibility

The public client boundary remains `/api/miniapp/*`. Existing response shapes
are preserved where they are correct; incompatible fixes are versioned or
normalized in the client during migration.

Required route groups:

- `/auth`, `/account`
- `/config`, `/models`, `/pricing`
- `/templates`
- `/uploads`
- `/image-generations`, `/image-assets`
- `/credit`
- `/orders`, `/billing`
- `/payments/wechat/notify`
- `/admin`

Every mutation supports an idempotency key where duplicate client retries can
change money, credits, tasks, or assets.

## 14. Security and Operational Requirements

- HTTPS is required outside local development.
- Request, upload, and download domains must be configured in the WeChat
  platform.
- Secrets never appear in `app/`, logs, task error messages, or API responses.
- Authentication, generation, upload, payment, and admin endpoints have
  separate rate limits.
- Structured logs include request id, user id, task/order id, state transition,
  duration, and sanitized error class.
- Health checks distinguish process health from database, storage, and worker
  readiness.
- Schema migrations run explicitly before application rollout.
- A deployment reports source commit SHA and catalog version.
- Admin and payment audit logs are append-only.

## 15. Delivery Slices

Each slice must be independently reviewable and testable:

1. Repository/GBA baseline and reproducible Docker build.
2. PostgreSQL schema, repository layer, and SQLite migration tooling.
3. WeChat identity, revocable sessions, profile, and login guard.
4. Versioned template catalog and complete template UI.
5. Object storage, secure uploads, and authorized downloads.
6. Model registry, durable generation worker, and credit holds.
7. Result, history, continuation, save, and billing correctness.
8. Orders, disabled/mock/WeChat payment adapters, and admin audit.
9. Full regression, WeChat Developer Tools visual review, staging smoke, and
   release documentation.

## 16. Verification Strategy

### 16.1 Automated

- Preserve all 39 existing backend tests.
- Add PostgreSQL repository and migration tests.
- Add concurrent credit hold and idempotency tests.
- Add restart recovery, lease expiry, retry, partial success, and failure
  release tests.
- Add model capability and cost-contract tests for all enabled models.
- Add upload MIME, size, dimensions, ownership, traversal, and SSRF tests.
- Add WeChat session revocation and expired-session tests.
- Add payment signing fixtures, notification verification/decryption,
  duplicate delivery, amount mismatch, fulfillment rollback, and refund tests.
- Extend the mini-program validator for page routes, DTO contracts, login
  guards, stale request protection, and prohibited secrets.

### 16.2 Staging

- PostgreSQL migration succeeds on a clean database and on a SQLite export.
- Template total and catalog checksum match the exported source.
- Real WeChat login succeeds on a physical or developer-tool device.
- Every enabled model produces an accessible image using its default settings.
- A failed generation releases its credit hold.
- A generated asset can be saved by its owner and denied to another user.
- Real WeChat payment is not marked accepted until merchant credentials exist
  and the signed notification round trip succeeds.

### 16.3 Visual

Use WeChat Developer Tools to inspect every page at narrow and wide phone
viewports. Verify safe areas, no overlapping text, stable card sizes, visible
loading/error/empty states, and correct assets. Visual inspection is required;
source validation alone is not UI acceptance.

## 17. Acceptance Criteria

The feature is complete when:

1. `app/npm run validate` and the complete backend test suite pass.
2. A clean Docker build starts the backend without referring to Web-only paths.
3. PostgreSQL is the production source of truth; SQLite is not required at
   runtime.
4. The catalog contains the preserved union of current mini and reconciled Web
   templates, with deterministic pagination and no dropped stable ids.
5. WeChat login, logout, expiration, and relogin work without raw 401 screens.
6. Template and free generation work with valid model capabilities and one to
   three references where supported.
7. Tasks survive backend restart, concurrent requests cannot overspend, and
   failed tasks release credits.
8. Results are privately stored, securely downloadable, reusable, and saved to
   the photo album.
9. History, credits, pricing, billing, account, and admin pages read real
   persisted data and enforce ownership/roles.
10. Payment defaults to disabled; mock is impossible in production; complete
    WeChat Pay v3 code and automated fixtures pass.
11. Real-payment acceptance is explicitly marked externally blocked until
    merchant credentials and a signed staging transaction are available.
12. Every page passes Developer Tools visual review with the existing
    Queencard visual language intact.

## 18. Deferred Cross-Platform Integration

A later feature may map `miniapp_users` to Web Better Auth users and migrate
credits, works, and orders into a shared principal. This design prepares for
that by using stable user ids, immutable ledgers, explicit asset ownership, and
provider-neutral task/order records. No automatic mapping is performed now.
