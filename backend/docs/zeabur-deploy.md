# Zeabur Deployment

The backend Docker service is defined under `backend`. Zeabur provides HTTPS
for the generated public domain and can bind a custom domain later.

The production entrypoint remains fail-closed until the PostgreSQL and S3
adapters from Tasks 2 and 5 are wired. The settings below define the correct
service and build context; they do not make the current foundation deployable.

## Required Zeabur Settings

Set the Zeabur service root to `backend`. Zeabur must discover
`backend/Dockerfile` and use the `backend` directory as its Docker build
context. The repository root has no Dockerfile.

The equivalent local command, run from the repository root, is:

```bash
docker build -t ima-miniapp-backend backend
```

Expose the HTTP port Zeabur injects as `PORT`. The container already reads
`process.env.PORT`.

Add a persistent Volume:

```text
/data
```

This keeps the SQLite database and uploaded reference images after restarts and
redeploys.

## Environment Variables

For a first preview deployment:

```bash
PORT=8080
MINIAPP_BACKEND_HOST=0.0.0.0
MINIAPP_DEV_LOGIN=1
WECHAT_MINIAPP_APP_ID=wx-dev
MINIAPP_AUTH_TOKEN_SECRET=replace-with-long-random-secret
MINIAPP_INITIAL_CREDITS=10
MINIAPP_DB_PATH=/data/miniapp.sqlite
MINIAPP_UPLOAD_ROOT=/data/uploads
MINIAPP_TEMPLATE_SOURCE=github
MINIAPP_PUBLIC_ASSET_BASE_URL=https://replace-with-your-zeabur-domain
MINIAPP_PAYMENT_MODE=mock
MINIAPP_ADMIN_OPENIDS=dev_openid
MINIAPP_IMAGE_PROVIDER=preview
```

For this real mini program deployment, use:

```bash
MINIAPP_DEV_LOGIN=0
WECHAT_MINIAPP_APP_ID=wx5949306a2777910c
WECHAT_MINIAPP_APP_SECRET=your-wechat-miniapp-secret
```

After switching to `MINIAPP_DEV_LOGIN=0`, old local `wx-dev` tokens are rejected
by the backend. Users must log in again through the mini program so the backend
can exchange the current `wx.login` code for the real WeChat `openid`.

For real image generation, change one provider:

```bash
MINIAPP_IMAGE_PROVIDER=openai
OPENAI_IMAGE_API_KEY=your-openai-key
```

or:

```bash
MINIAPP_IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=your-gptproto-key
```

For a production payment flow, keep miniapp order creation in this backend and
switch the payment adapter only after the WeChat merchant prepay service is
ready:

```bash
MINIAPP_PAYMENT_MODE=wechat
MINIAPP_ADMIN_OPENIDS=real-admin-openid-1,real-admin-openid-2
```

`MINIAPP_WECHAT_PAYMENT_PARAMS_JSON` is only a development bridge for fixed
`wx.requestPayment` params. Real deployments should generate those params per
order server-side and then fulfill credits from the payment notify callback.

## After Deployment

Open:

```text
https://your-zeabur-domain/health
https://your-zeabur-domain/api/miniapp/templates?page=1&limit=3&category=image&language=zh
```

Then update the mini program client:

```js
API_BASE_URL: "https://your-zeabur-domain"
```

Finally, add the same HTTPS domain to the WeChat mini program console as a
legal `request`, `uploadFile`, and `downloadFile` domain before formal release.
