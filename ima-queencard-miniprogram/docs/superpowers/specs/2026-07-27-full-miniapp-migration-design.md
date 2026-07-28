# Full Miniapp Migration Design

## Goal

Build a complete WeChat Mini Program user product for ima ima queencard while
reusing the GitHub product backend for accounts, credits, generation tasks,
payments, storage, and history. The mini program must feel like a native,
polished product, not a web page wrapped into WeChat.

The migration includes payment. The admin console remains web-only unless a
separate admin mini program is approved later.

The primary user workflow is template-first: users scroll a dynamically loaded
template feed, tap a template, generate the matching image directly, save the
result to the phone album, and then publish it to Xiaohongshu manually.

## Current State

### GitHub Product

Source:

`/Users/a2/Documents/landing page wechat mini program/product-web-builds-w6-imaima-queencard/ima ima queencard`

Relevant existing web product capabilities:

- Web pages: landing, prompts, generated workspace, generated task detail,
  credits, pricing, login, register, forgot password, reset password, admin,
  admin recharges.
- API routes: auth, image generation, task detail, regenerate, image asset
  download, credit balance, credit history, user billing, user me, admin users,
  admin notes, admin recharges, Stripe checkout, Creem checkout, Stripe webhook,
  Creem webhook.
- Database: Better Auth tables, customers, credit packages, credit holds,
  credit transactions, payment fulfillments, generation tasks, generated assets,
  admin recharge orders, admin notes, audit logs.
- Services: image generation, image provider routing, GPTProto provider,
  credit service, billing service, payment fulfillment, customer service.
- Pricing config: creator/studio subscriptions and credit packs, including CNY
  prices and credit amounts.
- Template generation flow: prompt cases carry `templateId`, prompt,
  `referenceImages`, `sourceCaseId`, `sourceCaseCategory`, `sourceNoteUrl`,
  and `sourceAuthorUrl` into the generated workspace; the composer submits with
  `submitMode="create-task"`. Miniapp should reuse this seed-to-task pattern.

### Bovideo / Ancher Product

Source:

`/Users/a2/Desktop/ancherexplainfrontend`

Relevant existing product capabilities to synchronize:

- Auth: email login/register/reset, Google/Firebase login, Bearer token storage,
  user profile, logout, and device binding.
- API proxy: `/api/ancher/[...path]` already allows upstream `auth`,
  `diamonds`, `history`, `payment`, `reference-images`, `task`, `templates`,
  and `user`.
- Templates: `/api/templates` and `/api/templates/:id` proxy to upstream
  template data and normalize media URLs.
- Generation: `/api/task/generate`, `/api/ancher/task/:taskId`, reference image
  upload, history lookup, and task streaming.
- Payment and credits: `payment/catalog`, `payment/orders`,
  `payment/create-checkout`, `payment/session`, subscription APIs, and
  `diamonds/transactions`.
- Legal documents: BO / bo.video terms, privacy, refund/delivery, and public
  publishing rules already describe credits, AI generation, payment, generated
  content rights, and support.

### Current Mini Program

Source:

`/Users/a2/Documents/landing page wechat mini program/ima-queencard-miniprogram`

Implemented:

- Landing page with selected local assets.
- Generate page shell: upload reference image, prompt/topic input, model picker,
  output count picker.
- Result page shell: task polling and result image display.
- API wrapper under `services/api.js`.
- WeChat login wrapper under `services/auth.js`.
- Local session wrapper under `services/session.js`.
- Backend contract draft at `docs/miniapp-backend-contract.md`.

Missing:

- Real backend miniapp routes.
- Real account binding.
- Real upload storage.
- Real generation task creation and polling.
- Credit balance and history.
- Pricing page and WeChat payment.
- Order records and payment callback fulfillment.
- History/workspace page.
- User account page.
- Terms, privacy, support, and audit-facing copy.

## Non-Negotiable Boundaries

1. The mini program package must not contain database URLs, provider API keys,
   WeChat AppSecret, payment merchant keys, object-storage secrets, or internal
   service credentials.
2. API URLs are public by design. Every miniapp API must authenticate,
   authorize, validate, rate-limit, and audit server-side.
3. The GitHub product backend remains the source of truth for user id, credits,
   generation task state, generated assets, payments, and billing history.
4. WeChat login is an entry and binding method, not a separate account system.
5. Stripe and Creem remain web payment providers. The mini program uses WeChat
   payment for miniapp purchases.
6. Admin features stay out of the user mini program for the first full version.
7. Large prompt-library assets must not be bundled into the mini program package.
   Use paged backend data and CDN images.
8. WeChat payment category, virtual goods/payment eligibility, user agreement,
   privacy policy, and merchant account status must be verified in official
   WeChat/Merchant Platform before release.
9. Template browsing must be dynamic. The mini program package must not bundle
   all 1000+ templates; it should fetch paginated templates from backend storage
   and render CDN thumbnails on demand.
10. The full GitHub queencard product remains in scope. The priority changes:
    template browsing and one-click generation come first; bovideo/Ancher is
    preferred for production account, diamonds/credits, payment, deployed API
    bridging, and operational account continuity.

## Product Scope

### Mini Program Pages

The full user mini program should contain these pages:

1. `pages/index/index`
   - Template-first home feed.
   - Top area can keep a compact landing/product identity block, but the primary
     screen is a scrollable template list.
   - Main CTA on each card is "生成同款" or equivalent.
   - Secondary navigation to credits/account/history.
   - Lightweight proof/case sections are below the first template feed.

2. `pages/generate/index`
   - Template-seeded generation workspace.
   - Opens with selected template prompt, reference images, source metadata, and
     model defaults already filled.
   - Login-aware top summary: avatar/name, credits, current model.
   - Optional upload reference image when the template requires user input.
   - Prompt/topic input can be hidden behind "微调" for one-click templates.
   - Model picker.
   - Aspect ratio picker.
   - Output count picker.
   - Estimate credit cost before submit.
   - Submit task.
   - Navigate to result page after task creation.

3. `pages/result/index`
   - Poll task state.
   - Show queued/generating/completed/failed states.
   - Show credits charged/released when available.
   - Preview, save, and reuse generated images.
   - Regenerate task.
   - Continue with one output as reference.

4. `pages/history/index`
   - Paginated generation history.
   - Filter by status.
   - Search prompt text.
   - Open task result.
   - Empty/error/loading states.

5. `pages/prompts/index`
   - Dynamic template library equivalent of GitHub `/prompts` plus bovideo
     `/api/templates`.
   - Paged backend data from database/upstream API.
   - Category filter.
   - Search.
   - Case detail preview.
   - Infinite scroll / pull-to-refresh.
   - Start generation from selected case/template.
   - Card-level "生成同款" action.

6. `pages/account/index`
   - Current account profile.
   - WeChat binding status.
   - Email binding status.
   - Credits summary.
   - Links to billing history, credit history, terms, privacy, support.
   - Logout.

7. `pages/credits/index`
   - Credit balance.
   - Credit transaction history.
   - Active credit packages and expiry dates.
   - Link to buy credits.

8. `pages/pricing/index`
   - Miniapp-safe pricing cards.
   - One-time credit packs.
   - Subscription options only if WeChat/payment compliance allows them.
   - `wx.requestPayment` flow.
   - Order state feedback.

9. `pages/orders/index`
   - Miniapp purchase records.
   - Payment status.
   - Credits granted.
   - Failed/pending payment recovery.

10. `pages/bind/index`
    - Bind existing Ancher/web account by email code or web-generated binding
      code.
    - Explain clearly that credits and history merge into one account.

11. `pages/legal/privacy` and `pages/legal/terms`
    - Audit-facing privacy and terms copy.
    - Must match WeChat backend collection behavior.

12. `pages/template/index`
    - Optional template detail page.
    - Shows larger preview, reference images, tags, model, estimated credits,
      and direct generate button.
    - Use this only when a card needs details; the default path should remain
      card tap -> generate.

### Not Included In User Mini Program

- Admin dashboard.
- Admin recharge/refund tools.
- User notes.
- Admin audit log UI.
- Direct provider debug tools.
- Raw prompt-library crawler tools.

These remain web-only.

## Account And Identity Design

### Desired Behavior

Users should feel they have one ima ima queencard account:

- Existing web user opens mini program and can bind WeChat.
- New WeChat user can start through mini program.
- Credits, task history, and purchases belong to one backend `user.id`.
- If later the user logs into web, the account should be linkable by email or
  binding code.

### Backend Tables

Add a WeChat binding table:

```sql
wechat_openid_bindings (
  id text primary key,
  appid text not null,
  openid text not null,
  unionid text,
  user_id text not null,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  unique(appid, openid),
  unique(appid, unionid)
)
```

Add miniapp API sessions:

```sql
miniapp_sessions (
  id text primary key,
  user_id text not null,
  token_hash text not null unique,
  appid text not null,
  openid text not null,
  expires_at timestamp not null,
  last_seen_at timestamp,
  created_at timestamp not null default now(),
  revoked_at timestamp
)
```

Do not store raw miniapp bearer tokens. Store only hashes.

### Login Flow

1. Mini program calls `wx.login()`.
2. Mini program posts the temporary `code` to
   `POST /api/miniapp/auth/wechat-login`.
3. Backend calls WeChat `code2Session` server-side using AppID/AppSecret.
4. Backend receives `openid`, optional `unionid`, and session information.
5. Backend finds existing `wechat_openid_bindings`.
6. If found, backend creates a miniapp session token for the linked `user_id`.
7. If not found, backend creates a new backend user or returns `needsBinding`.
8. Mini program stores the returned miniapp token in local storage.

### Existing Account Binding

Support two binding modes:

1. Email code:
   - Mini program asks for email.
   - Backend sends email verification code.
   - User enters code.
   - Backend links openid to that existing user.

2. Web binding code:
   - User logs into web.
   - Web account page shows a short-lived binding code.
   - Mini program enters code.
   - Backend links openid to web user.

The initial implementation should support web binding code first because it
avoids email deliverability problems and reduces account takeover risk.

## Miniapp Backend API

All endpoints use:

`/api/miniapp/*`

All protected endpoints require:

`Authorization: Bearer <miniapp-session-token>`

### Auth

`POST /api/miniapp/auth/wechat-login`

Request:

```json
{
  "code": "wx-login-code"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "token": "miniapp-session-token",
    "expiresAt": "2026-08-26T00:00:00.000Z",
    "user": {
      "id": "user-id",
      "email": "optional@example.com",
      "name": "display name",
      "image": null,
      "credits": 600,
      "wechatBound": true
    }
  }
}
```

`GET /api/miniapp/auth/me`

Returns current user, binding state, credit balance, and minimal customer plan.

`POST /api/miniapp/auth/logout`

Revokes current miniapp session.

`POST /api/miniapp/auth/bind-code`

Links current WeChat identity to a web account using a short-lived web binding
code.

### Credits

`GET /api/miniapp/credit/balance`

Wrap existing credit balance service.

`GET /api/miniapp/credit/history?limit=20&cursor=...`

Wrap existing credit history service and return mobile-friendly rows:

```json
{
  "id": "txn-id",
  "type": "ORDER_PAY",
  "credits": 600,
  "balanceAfter": 1200,
  "remark": "创作者积分包",
  "createdAt": "2026-07-27T00:00:00.000Z"
}
```

### Generation

`POST /api/miniapp/uploads/reference-image`

Uploads one image to object storage. The backend must validate MIME type, size,
ownership, and scan/normalize the file before returning a URL or asset id.

`POST /api/miniapp/image-generations/estimate`

Wraps existing estimate route. Returns requested credits and model limits.

`POST /api/miniapp/image-generations`

Creates a task using existing `createImageGenerationTask`, then starts
`runImageGenerationTask`.

Request:

```json
{
  "source": "wechat-miniapp",
  "sourceCaseId": null,
  "prompt": "prompt",
  "referenceImages": ["https://cdn.example.com/reference.jpg"],
  "model": "doubao-seedream-5-edit",
  "capability": "image-edit",
  "aspectRatio": "3:4",
  "outputCount": 1,
  "resolution": "1k",
  "aiEnhance": false,
  "fastMode": false
}
```

`GET /api/miniapp/image-generations`

Lists the current user's generation history.

`GET /api/miniapp/image-generations/:taskId`

Returns one task with mobile-friendly status, reference images, assets, model,
credits, prompt, and error message.

`POST /api/miniapp/image-generations/:taskId/regenerate`

Wraps existing regenerate route. The backend must verify task ownership.

`GET /api/miniapp/image-assets/:assetId/download`

Returns a short-lived signed URL or proxied download. Do not expose storage
write credentials.

### Prompt Library

`GET /api/miniapp/templates`

Returns paginated templates from backend database or bovideo upstream template
APIs, not bundled assets.

Query params:

- `category`
- `query`
- `cursor`
- `limit`
- `media`
- `scenarioCategory`
- `language`

Response rows should include only the fields needed by miniapp UI:

- id
- title
- category
- media
- topics
- author
- source metadata
- thumbnail URL
- prompt seed
- reference image URLs
- source case id/category/note URL/author URL when the template originated from
  GitHub prompt cases
- template execution payload when the template originated from bovideo

`GET /api/miniapp/templates/:id`

Returns one template with enough information to generate from it.

`POST /api/miniapp/templates/:id/generate`

Creates a generation task directly from a template. This is the preferred
one-click path. The backend builds the request using the same principle as the
GitHub flow:

```json
{
  "templateId": "template-id",
  "prompt": "template prompt",
  "referenceImages": ["https://cdn.example.com/template-reference.jpg"],
  "sourceCaseId": "source-case-id",
  "sourceCaseCategory": "爆款图文",
  "sourceNoteUrl": "https://source.example/note",
  "sourceAuthorUrl": "https://source.example/author"
}
```

For bovideo templates, the backend should use the upstream template execution
payload and `buildTemplateRemixExecutionRequest`-equivalent behavior so fixed
template parameters and configured reference media are preserved.

### Template Storage

Use a backend database or upstream template service as the source of truth.

Recommended normalized table if local database storage is needed:

```sql
miniapp_templates (
  id text primary key,
  source text not null,
  source_id text not null,
  title text not null,
  category text,
  media text not null,
  language text,
  prompt text,
  thumbnail_url text,
  reference_images jsonb not null default '[]',
  source_note_url text,
  source_author_url text,
  execution_payload jsonb,
  tags jsonb not null default '[]',
  sort_score integer not null default 0,
  status text not null default 'ACTIVE',
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  unique(source, source_id)
)
```

Synchronization jobs can import:

- GitHub prompt cases.
- bovideo `/api/templates` records.
- bovideo landing prompt manifests.
- Future crawled/synced template batches.

The mini program fetches pages from this table/API. It never carries all
templates in `data/*.js`.

### Pricing And Payment

`GET /api/miniapp/pricing`

Returns miniapp-eligible products derived from `PRICING_PRODUCTS`.

Initial recommendation:

- Enable one-time credit packs first.
- Only enable subscriptions if WeChat payment/compliance confirms recurring
  behavior is allowed for the chosen category and product type.

`POST /api/miniapp/orders`

Creates a local order and returns WeChat payment parameters for
`wx.requestPayment`.

Request:

```json
{
  "productKey": "credit_creator"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "orderId": "local-order-id",
    "payment": {
      "timeStamp": "1722060000",
      "nonceStr": "nonce",
      "package": "prepay_id=wx...",
      "signType": "RSA",
      "paySign": "signature"
    }
  }
}
```

`POST /api/miniapp/payments/wechat/notify`

WeChat payment callback. The backend verifies signature, decrypts resource
payload, checks order amount/product/user, and calls `fulfillCreditGrantOnce`
with provider `wechatpay`.

`GET /api/miniapp/orders`

Lists current user's miniapp orders.

`GET /api/miniapp/orders/:orderId`

Returns payment and fulfillment state. Miniapp uses this after payment success
or uncertain close/cancel state.

## Payment Design

### Data Model

Add miniapp order table:

```sql
miniapp_orders (
  id text primary key,
  user_id text not null,
  product_key text not null,
  provider text not null default 'wechatpay',
  merchant_order_no text not null unique,
  prepay_id text,
  amount_cny integer not null,
  credits integer not null,
  status text not null,
  paid_at timestamp,
  fulfilled_at timestamp,
  closed_at timestamp,
  provider_transaction_id text,
  provider_payload jsonb,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
)
```

Status values:

- `PENDING`
- `PAYING`
- `PAID`
- `FULFILLED`
- `CLOSED`
- `FAILED`
- `REFUNDED`

Extend `paymentFulfillments` through existing generic provider fields:

- `provider = "wechatpay"`
- `providerOrderId = merchant_order_no`
- `providerTransactionId = wechat transaction id`
- `providerProductId = productKey`
- `productKey = productKey`
- `userId = user_id`
- `credits = product.credits`

### Payment Flow

1. User opens `pages/pricing/index`.
2. Miniapp calls `GET /api/miniapp/pricing`.
3. User selects a credit pack.
4. Miniapp calls `POST /api/miniapp/orders`.
5. Backend creates local `miniapp_orders` row.
6. Backend calls WeChat Pay JSAPI/prepay API with current user's openid.
7. Backend returns signed payment parameters.
8. Miniapp calls `wx.requestPayment`.
9. On success, miniapp navigates to order detail or credits page.
10. Backend receives WeChat payment notify.
11. Backend verifies payment and fulfills credits exactly once.
12. Miniapp polls `GET /api/miniapp/orders/:orderId` until `FULFILLED`.

### Payment Failure Handling

- If `wx.requestPayment` fails with user cancel, show cancel state and keep
  order pending/closed based on backend query.
- If miniapp sees success but backend fulfillment is delayed, show "到账处理中"
  and poll.
- If notify arrives twice, `fulfillCreditGrantOnce` prevents double crediting.
- If notify amount differs from product price, mark fulfillment failed and do
  not grant credits.
- If order is paid but fulfillment fails, show support copy and expose order id.

### Compliance Gate

Before implementing production payment, verify these in official WeChat
Merchant Platform and Mini Program settings:

- The mini program has a valid AppID and is owned by the same entity intended
  for payment.
- Merchant account is opened and associated with the AppID.
- Selected service category permits AI image generation/creative tooling.
- Selling AI generation credits is accepted under the selected category.
- If WeChat treats credits as virtual goods, confirm whether virtual payment or
  ordinary JSAPI payment is required for the target platform and product type.
- User agreement, privacy policy, refund policy, and customer support channel
  are ready.
- Production request domains, upload domains, download domains, and socket
  domains are configured.

If compliance is unclear, implement pricing UI behind a feature flag and keep
payment disabled for review builds.

## Data Storage

### Mini Program Local Storage

Allowed:

- Miniapp session token.
- User profile cache.
- Last selected model/aspect ratio/output count.
- Draft prompt.
- Last task id.
- Template feed cache for the most recent page only.
- Last selected category/filter.

Not allowed:

- Provider API keys.
- WeChat AppSecret.
- Payment merchant secrets.
- Database credentials.
- Permanent private image URLs.

### Backend Database

Use existing GitHub product database tables where possible:

- `user`
- `session`
- `account`
- `Customer`
- `credit_packages`
- `credit_holds`
- `credit_transactions`
- `payment_fulfillments`
- `generation_tasks`
- `generated_assets`

Add only miniapp-specific tables:

- `wechat_openid_bindings`
- `miniapp_sessions`
- `miniapp_orders`
- optional `account_binding_codes`
- optional `miniapp_templates` if templates are not fully served by upstream
  bovideo `/api/templates`

### Object Storage

Reference uploads and generated assets should be stored server-side in the same
storage strategy as the web product or a compatible bucket.

Use short-lived signed URLs or authenticated proxy download for private files.
CDN URLs are acceptable only for public case thumbnails and public marketing
assets.

## UI Design Direction

Keep the current visual language:

- Pale pink base background.
- Black 4rpx borders.
- 8px max radius.
- Lemon, pumpkin, seafoam, lavender accents.
- Dense but readable mobile workflows.
- No nested cards.
- No decorative gradient blobs.

Page-specific requirements:

- Generation page should feel like a tool, not a marketing page.
- Pricing page should be clear and audit-friendly: price, credits, validity,
  usage, refund/support copy.
- Credits/history pages should be quiet and scannable.
- Account page should make binding status obvious.
- Error states should be actionable and written in plain Chinese.
- Template feed cards must be visually reviewed on real miniapp/mobile
  screenshots before acceptance.
- During mini program review, use visual inspection with WeChat Developer Tools
  screenshots for at least: home template feed, template detail or seeded
  generate page, generating/result page, pricing page, and save-result flow.
- Check no text overlaps, template thumbnails are not distorted, the generate
  button is always reachable, and result images can be previewed/saved.

## Security Requirements

1. Do not trust openid or user id from client request body.
2. Never accept client-side credit amount, product price, or credits granted.
3. All credit changes must happen through server-side services.
4. All payment callbacks must verify signature and amount before fulfillment.
5. All task and asset reads must verify ownership.
6. Rate-limit login, upload, generation, payment order creation, and binding.
7. Uploaded files must be size-limited, type-validated, and stored outside the
   mini program package.
8. Tokens must expire and be revocable.
9. Use idempotency keys for payment notify and generation submission.
10. Log security-relevant events without storing raw secrets.

## Feature Flags

Add backend-controlled flags:

- `miniappAuthEnabled`
- `miniappGenerationEnabled`
- `miniappPricingEnabled`
- `miniappPaymentEnabled`
- `miniappPromptLibraryEnabled`
- `miniappSubscriptionsEnabled`

Miniapp should read these from `GET /api/miniapp/config` and hide or disable
features accordingly.

## Testing Strategy

### Backend

Add tests for:

- WeChat code login success.
- WeChat code login invalid code.
- New openid creates or requests binding.
- Existing binding returns linked user.
- Miniapp token auth.
- Credit balance route.
- Generation estimate route.
- Task create route requires auth and reference image.
- Task list only returns current user's tasks.
- Regenerate verifies ownership.
- Pricing returns only enabled miniapp products.
- Order creation rejects unknown product.
- Order creation uses server-side price and credits.
- WeChat notify fulfillment grants credits once.
- Duplicate notify does not double grant.
- Amount mismatch does not grant credits.

### Mini Program

Use local validation plus WeChat Developer Tools compile.

Add validation for:

- App pages are registered.
- No server-side secret keywords in miniapp source.
- No remote marketing assets bundled in landing data.
- Required miniapp services exist.

Manual simulator checks:

- Landing CTA enters generation page.
- Login button handles unconfigured backend.
- Upload preview works.
- Submit shows backend/config errors.
- Result page empty/running/completed states render.
- Pricing page handles disabled payment.
- Account page handles logged out/logged in states.

### End-To-End Staging

Before production:

1. Deploy backend staging.
2. Configure miniapp request/upload/download domains.
3. Use a real WeChat test user.
4. Login with `wx.login`.
5. Bind to an existing web account.
6. Upload a reference image.
7. Estimate credits.
8. Create generation task.
9. Confirm task consumes credits.
10. Confirm result appears in miniapp and web history.
11. Buy a test product through WeChat Pay sandbox/staging if available.
12. Confirm payment callback grants credits once.

## Implementation Phases

### Phase 1: Template Feed Foundation

- Add dynamic template API: `/api/miniapp/templates`.
- Add template detail API: `/api/miniapp/templates/:id`.
- Add optional template database/import schema for 1000+ templates.
- Normalize GitHub prompt-case seed fields and bovideo template execution
  fields into one miniapp template contract.
- Update miniapp home to dynamic scrollable template feed.

Deliverable: users can scroll 1000+ remotely loaded templates without bundling
them into the mini program.

### Phase 2: One-Click Template Generation

- Add `/api/miniapp/templates/:id/generate`.
- Use GitHub-style template seed flow for prompt cases.
- Use bovideo template execution payload for upstream templates.
- Create task through bovideo/Ancher generation where available.
- Poll task result and expose image save flow.

Deliverable: tap template -> generate image -> save to phone album.

### Phase 3: Account, Credits, And History Via Bovideo

- Add WeChat login -> Ancher token/account bridge.
- Add credits/diamonds balance and transactions.
- Add generated history linked to template id/source.
- Add history page.
- Add account page.
- Add credits page.

Deliverable: generated results, history, and paid balance stay consistent with
bovideo account state.

### Phase 4: WeChat Payment

- Add miniapp order table.
- Add WeChat Pay server client.
- Add pricing route.
- Add order creation route.
- Add payment notify route.
- Reuse `fulfillCreditGrantOnce` with provider `wechatpay`.
- Add pricing and orders miniapp pages.
- Add post-payment polling and recovery states.

Deliverable: paid WeChat order grants credits exactly once.

### Phase 5: Compliance And Release Hardening

- Verify WeChat category/payment eligibility.
- Add privacy and terms pages.
- Add support/refund copy.
- Configure production domains.
- Add rate limits and audit logs.
- Run staging E2E.
- Prepare review build with feature flags.

Deliverable: review-ready full mini program.

## Open Decisions

1. Whether miniapp subscriptions are allowed and worth including in first
   production release.
2. Whether new miniapp users should automatically receive new-user credits or
   only after binding email/web account.
3. Which object storage/CDN should serve uploaded references and generated
   assets in China.
4. Whether the Ancher deployed account database is the final source of truth or
   the GitHub Better Auth database should be connected to Ancher through an
   account bridge.
5. Exact WeChat Mini Program AppID, merchant id, merchant certificate setup,
   API v3 key, notify URL, and product category.

## Recommended First Implementation Slice

Build Phase 1 and Phase 2 first. The core first slice is not a generic
generator form; it is a dynamic template feed where users tap a template,
generate a matching image, save it locally, and post to Xiaohongshu. The rest of
the GitHub queencard product remains in scope after this slice: generated
workspace, prompt library depth, history, credits, pricing, account, legal, and
payment. Account and payment can follow bovideo once this template-to-result
loop works.

Because the user explicitly wants payment included, Phase 4 remains in scope;
it should not be implemented before compliance and merchant prerequisites are
verified.

## Acceptance Criteria

The migration is complete when:

1. The mini program dynamically loads 1000+ templates through backend pagination.
2. A user can scroll the template feed and tap "生成同款".
3. The backend creates a generation task from the selected template using
   GitHub-style seed metadata or bovideo template execution payload.
4. The generated image appears in the miniapp result page.
5. The user can preview and save the generated image to the phone album.
6. The saved result is suitable for manual Xiaohongshu upload.
7. A WeChat user can log in to the mini program.
8. The WeChat user can bind or resolve to one backend Ancher/bovideo user.
9. The mini program shows the same credit/diamond balance as bovideo.
10. The generated result appears in miniapp history and bovideo history.
11. Credits/diamonds are frozen/settled/released consistently.
12. The user can buy an enabled credit pack using WeChat Pay.
13. Payment callback grants credits once and only once.
14. The user can view order and credit history.
15. No secrets are present in the mini program package.
16. WeChat Developer Tools compile passes.
17. Visual UI review passes using screenshots for feed, generate, result, save,
    account, credits, and pricing pages.
18. Production request/upload/download domains are configured.
19. Privacy, terms, refund/support, and payment explanation pages are present.
20. Admin functionality remains protected in the web backend only.
