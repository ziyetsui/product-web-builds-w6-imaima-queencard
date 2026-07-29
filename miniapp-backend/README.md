# ima ima queencard Miniapp Backend

Standalone WeChat mini program backend substitute for local development and
first-release staging. It treats the cloned GitHub queencard project as an
independent source product.

## What It Provides

- `POST /api/miniapp/auth/wechat-login`
- `GET /api/miniapp/auth/me`
- `POST /api/miniapp/auth/logout`
- `GET /api/miniapp/credit/balance`
- `GET /api/miniapp/credit/history`
- `POST /api/miniapp/uploads/reference-image`
- `GET /api/miniapp/templates`
- `GET /api/miniapp/templates/:id`
- `POST /api/miniapp/templates/:id/generate`
- `POST /api/miniapp/image-generations`
- `GET /api/miniapp/image-generations`
- `POST /api/miniapp/image-generations/estimate`
- `GET /api/miniapp/image-generations/:taskId`
- `POST /api/miniapp/image-generations/:taskId/regenerate`

Accounts are standalone WeChat accounts keyed by:

```text
wechat:{appid}:{openid}
```

## Local Run

```bash
cd "/Users/a2/Documents/landing page wechat mini program/miniapp-backend"
MINIAPP_DEV_LOGIN=1 \
WECHAT_MINIAPP_APP_ID=wx-dev \
MINIAPP_AUTH_TOKEN_SECRET=change-this-dev-secret \
MINIAPP_DB_PATH=./data/miniapp.sqlite \
MINIAPP_UPLOAD_ROOT=./data/uploads \
MINIAPP_TEMPLATE_SOURCE=github \
MINIAPP_PUBLIC_ASSET_BASE_URL=http://127.0.0.1:8787 \
MINIAPP_IMAGE_PROVIDER=preview \
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

`MINIAPP_TEMPLATE_SOURCE=github` reads the cloned GitHub product's
`frontend/src/data/xhsPromptCases.ts` and exposes it through
`/api/miniapp/templates`. Template images are served from the cloned product's
`frontend/public` directory through this backend for local miniapp testing.

Set `MINIAPP_GITHUB_CASES_FILE=/absolute/path/to/xhsPromptCases.ts` only if the
GitHub project moves.

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
