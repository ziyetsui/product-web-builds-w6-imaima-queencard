# WeChat Mini Program Backend Contract

This mini program keeps API keys out of the client. The client only handles
WeChat login code, reference image upload, task submission, and task polling.
The backend owns account binding, credits, image provider calls, and storage.

## Account Strategy

The mini program uses a standalone WeChat account in the first release. The
backend uses WeChat `openid` as the miniapp user identity and can later map
credits, orders, and generation history to that identity.

Recommended binding flow:

1. Mini program calls `wx.login()` and sends the temporary `code` to backend.
2. Backend calls WeChat `auth.code2Session` with server-side AppID/AppSecret.
3. Backend finds `wechat_openid_bindings.openid`.
4. Return an opaque, cryptographically random miniapp session token for
   `wechat:{appid}:{openid}`; persist only its SHA-256 hash server-side.
5. Optional later: allow account binding if a user wants to merge web and
   miniapp credits/history.

Suggested table:

```sql
users(id, provider, appid, openid, unionid, name, balance, created_at, updated_at)
credit_transactions(id, user_id, amount, reason, balance_after, created_at)
generation_tasks(id, owner_id, status, images_json, template_id, provider, provider_task_id, mode, raw_provider_result_json, created_at, updated_at)
templates(id, title, category, scenario_category, source, thumbnail_url, preview_url, reference_images_json, prompt, seed_json, updated_at)
```

For standalone login, the miniapp session is independent from any web product
account. The `/api/miniapp/*` backend looks up the SHA-256 session hash, checks
expiry/revocation and account status, then checks credits, persists generation
tasks, and calls the configured image provider with server-side credentials.

Required backend environment:

```text
WECHAT_MINIAPP_APP_ID=wx...
WECHAT_MINIAPP_APP_SECRET=...
MINIAPP_DB_PATH=./data/miniapp.sqlite
MINIAPP_IMAGE_PROVIDER=preview
OPENAI_IMAGE_API_KEY=optional
GPTPROTO_API_KEY=optional
```

## Client Config

Set:

```js
// config/env.js
API_BASE_URL: "https://your-api-domain.com"
TEMPLATE_API_BASE_URL: ""
```

For local standalone backend development:

```js
API_BASE_URL: "http://127.0.0.1:8787"
```

The standalone backend should expose templates from the cloned GitHub
queencard product by default. The mini program should prefer
`{API_BASE_URL}/api/miniapp/templates`.

The client will call all endpoints under:

```text
{API_BASE_URL}/api/miniapp
```

## Endpoints

### GET /api/miniapp/templates

Query:

```text
page=1&limit=20&category=image&scenario_category=xhs-cover&language=zh
```

Response:

```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "template-id",
        "title": "Template title",
        "category": "image",
        "scenarioCategory": "xhs-cover",
        "thumbnailUrl": "https://cdn.example.com/template.jpg",
        "referenceImages": ["https://cdn.example.com/reference.jpg"],
        "prompt": "Template prompt",
        "seed": {
          "templateId": "template-id",
          "prompt": "Template prompt",
          "referenceImages": ["https://cdn.example.com/reference.jpg"],
          "sourceCaseId": "template-id",
          "sourceCaseCategory": "xhs-cover"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1000,
      "totalPages": 50
    }
  }
}
```

This endpoint must be paginated. Do not ship the whole template library inside
the mini program package.

### GET /api/miniapp/templates/:id

Returns one normalized template record with the same fields as the list item,
plus server-side execution metadata when available.

### POST /api/miniapp/templates/:id/generate

Headers:

```text
Authorization: Bearer opaque-miniapp-session-token
```

Request:

```json
{
  "referenceImages": ["https://cdn.example.com/optional-user-reference.jpg"],
  "prompt": "optional override prompt"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "taskId": "task-id",
    "status": "pending"
  }
}
```

The backend should build the generation request from the template seed and keep
provider credentials, request payloads, account ownership, and credit checks on
the server.

### POST /api/miniapp/auth/wechat-login

Request:

```json
{
  "code": "wx.login temporary code",
  "profile": {
    "source": "miniapp"
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "token": "opaque-miniapp-session-token",
    "user": {
      "id": "wechat:wx-appid:openid",
      "provider": "wechat",
      "appid": "wx-appid",
      "openid": "openid",
      "unionid": "optional-unionid",
      "name": "微信用户"
    }
  }
}
```

### GET /api/miniapp/auth/me

Headers:

```text
Authorization: Bearer opaque-miniapp-session-token
```

Response:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "wechat:wx-appid:openid",
      "provider": "wechat",
      "appid": "wx-appid",
      "openid": "openid",
      "unionid": "optional-unionid",
      "name": "微信用户"
    }
  }
}
```

### POST /api/miniapp/uploads/reference-image

Multipart upload field:

```text
file
```

Response:

```json
{
  "success": true,
  "data": {
    "url": "https://cdn.example.com/reference.jpg"
  }
}
```

### POST /api/miniapp/image-generations

Request:

```json
{
  "source": "wechat-miniapp",
  "model": "doubao-seedream-5-edit",
  "capability": "image-edit",
  "prompt": "generation prompt",
  "topic": "optional topic",
  "referenceImages": ["https://cdn.example.com/reference.jpg"],
  "outputCount": 1,
  "aspectRatio": "3:4",
  "resolution": "1k"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "taskId": "task-id"
  }
}
```

### GET /api/miniapp/image-generations/:taskId

Response while running:

```json
{
  "success": true,
  "data": {
    "id": "task-id",
    "status": "running",
    "images": []
  }
}
```

Response when complete:

```json
{
  "success": true,
  "data": {
    "id": "task-id",
    "status": "completed",
    "images": [
      "https://cdn.example.com/result-1.jpg"
    ]
  }
}
```
