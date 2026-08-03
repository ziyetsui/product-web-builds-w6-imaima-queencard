# ima ima queencard Miniapp Backend

Standalone WeChat mini program backend substitute for local development and
first-release staging. It is paired with `../app` and does
not require the web frontend at runtime.

## What It Provides

- `POST /api/miniapp/auth/wechat-login`
- `GET /api/miniapp/auth/me`
- `POST /api/miniapp/auth/logout`
- `GET /api/miniapp/account/me`
- `PATCH /api/miniapp/account/me`
- `GET /api/miniapp/credit/balance`
- `GET /api/miniapp/credit/history`
- `GET /api/miniapp/pricing`
- `POST /api/miniapp/orders`
- `GET /api/miniapp/orders`
- `GET /api/miniapp/orders/:id`
- `POST /api/miniapp/orders/:id/mock-pay`
- `GET /api/miniapp/billing`
- `GET /api/miniapp/admin/users`
- `GET /api/miniapp/admin/users/:id`
- `POST /api/miniapp/admin/users/:id/credits`
- `GET /api/miniapp/admin/orders`
- `POST /api/miniapp/admin/orders/:id/refund`
- `POST /api/miniapp/admin/orders/:id/cancel`
- `GET /api/miniapp/admin/payment-audit`
- `POST /api/miniapp/uploads/reference-image`
- `GET /api/miniapp/templates`
- `GET /api/miniapp/templates/:id`
- `POST /api/miniapp/templates/:id/generate`
- `POST /api/miniapp/image-generations`
- `GET /api/miniapp/image-generations`
- `POST /api/miniapp/image-generations/estimate`
- `GET /api/miniapp/image-generations/:taskId`
- `POST /api/miniapp/image-generations/:taskId/regenerate`
- `GET /api/miniapp/image-assets/:assetId/download`

Accounts are standalone WeChat accounts keyed by:

```text
wechat:{appid}:{openid}
```

## Local Run

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/backend"
MINIAPP_DEV_LOGIN=1 \
WECHAT_MINIAPP_APP_ID=wx-dev \
MINIAPP_DB_PATH=./data/miniapp.sqlite \
MINIAPP_UPLOAD_ROOT=./data/uploads \
MINIAPP_TEMPLATE_SOURCE=github \
MINIAPP_PUBLIC_ASSET_BASE_URL=http://127.0.0.1:8787 \
MINIAPP_IMAGE_PROVIDER=preview \
MINIAPP_PAYMENT_MODE=mock \
npm start
```

The mini program currently points to:

```text
http://127.0.0.1:8787
```

For local WeChat Developer Tools testing, turn off domain verification in the
tool if localhost requests are blocked.

## Zeabur HTTPS Deployment

The repository root contains a `Dockerfile` for Zeabur. Deploy from the
repository root, add a persistent Volume mounted at `/data`, and use the
environment variables in `.env.zeabur.example`.

Detailed steps are in `docs/zeabur-deploy.md`.

## Template Source

`MINIAPP_TEMPLATE_SOURCE=github` reads the local files in
`miniapp/backend/template-data/` and exposes them through
`/api/miniapp/templates`. Template images are served from
`miniapp/backend/public/`, so the miniapp backend can be built and deployed
without copying files from the web frontend.

Set `MINIAPP_GITHUB_CASES_FILE=/absolute/path/to/xhsPromptCases.ts` only if you
need to override the bundled miniapp template data.

## Database

The backend uses SQLite by default:

```text
MINIAPP_DB_PATH=./data/miniapp.sqlite
```

It stores standalone WeChat users, credit transactions, generation tasks, and a
synced copy of the GitHub templates. The first `/api/miniapp/templates` or
generation request syncs templates into the local database; later pagination and
search read from SQLite.

Generation tasks persist the reusable request metadata needed by the native
mini program history/result pages: `prompt`, `topic`, `referenceImages`,
`model`, `outputCount`, `aspectRatio`, and `resolution`.

Task history is available at:

```text
GET /api/miniapp/image-generations?page=1&limit=20&q=keyword&status=completed
```

`q` searches prompt, topic, model, and template id. The response shape is:

```json
{
  "success": true,
  "data": {
    "records": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 1
    }
  }
}
```

Credit history uses the same paginated shape:

```text
GET /api/miniapp/credit/history?page=1&limit=20
```

Generation cost estimation is intentionally simple in this standalone backend:

```text
POST /api/miniapp/image-generations/estimate
```

with JSON like:

```json
{
  "model": "gpt-image-2-edit",
  "outputCount": 2
}
```

It returns `requestedCredits = outputCount * 1`. Regeneration clones the
original task metadata into a new pending task:

```text
POST /api/miniapp/image-generations/:taskId/regenerate
```

Reference uploads are stored under:

```text
MINIAPP_UPLOAD_ROOT=./data/uploads
```

and served back through `/uploads/reference/*` for local preview and provider
requests.

## Image Provider

`MINIAPP_IMAGE_PROVIDER=preview` completes the task immediately with the
selected template preview image. This is intentional for local development: it
verifies login, credits, task creation, result polling, and save-to-album flow
without provider credentials.

Available providers:

- `preview`: no external call, returns the template preview image.
- `mock`: no external call, returns `MINIAPP_MOCK_IMAGE_URL` or the template
  preview image.
- `openai`: calls the OpenAI image generation endpoint with
  `OPENAI_IMAGE_API_KEY`.
- `gptproto`: calls a configurable GPTProto-compatible JSON endpoint with
  `GPTPROTO_API_KEY`.

Provider keys stay on the backend:

```text
OPENAI_IMAGE_API_KEY=...
GPTPROTO_API_KEY=...
```

Do not put provider API keys, WeChat AppSecret, payment keys, or upstream
service tokens in the mini program client.

## Account, Billing, Orders, and Admin

`GET /api/miniapp/pricing` returns miniapp-ready product groups:

```json
{
  "success": true,
  "data": {
    "currency": "CNY",
    "packs": [],
    "subscriptions": []
  }
}
```

Override the defaults with `MINIAPP_PRICING_JSON` using the same shape. Each
product needs `id`, `type`, `title`, `credits`, `amountCents`, and `currency`.

Create an order with:

```text
POST /api/miniapp/orders
```

```json
{
  "productId": "credits_20",
  "channel": "wechat"
}
```

The response includes `order` plus either `paymentParams` for
`wx.requestPayment` or a local/manual `payment` status. Real WeChat payment
params are only returned when:

```text
MINIAPP_PAYMENT_MODE=wechat
MINIAPP_WECHAT_PAYMENT_PARAMS_JSON={"nonceStr":"...","package":"prepay_id=...","paySign":"...","signType":"RSA","timeStamp":"..."}
```

Local development can use:

```text
MINIAPP_PAYMENT_MODE=mock
POST /api/miniapp/orders/:id/mock-pay
```

`mock-pay` is idempotent: it marks the order paid and grants credits once even
if the endpoint is retried. Without mock mode, it is only available while
`MINIAPP_DEV_LOGIN=1` is enabled.

Billing is user-visible:

```text
GET /api/miniapp/billing
```

It returns the current user, balance, paginated orders, credit transactions,
and that user's payment audit events. `GET /api/miniapp/orders`,
`GET /api/miniapp/orders/:id`, and `GET /api/miniapp/credit/history` are also
scoped to the authenticated user.

Admin endpoints require the authenticated user's openid or user id to be listed
in one of:

```text
MINIAPP_ADMIN_OPENIDS=openid-1,openid-2
MINIAPP_ADMIN_USER_IDS=wechat:wx-dev:openid-1
```

Admins can list users/orders, inspect a user, add credits, cancel pending
orders, refund paid orders, and read payment audit events. Refunds revoke
granted credits where the user's current balance makes that feasible.

Generated image downloads are ownership-checked:

```text
GET /api/miniapp/image-assets/:assetId/download
```

`assetId` can be the SHA-256 hex hash of an owned generated image URL, the
SHA-256 base64url hash, or the base64url-encoded URL itself. The endpoint
returns `302 Location: <image-url>` only when the image URL appears in one of
the current user's completed generation tasks.
