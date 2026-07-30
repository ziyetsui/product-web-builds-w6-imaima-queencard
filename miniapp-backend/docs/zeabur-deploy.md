# Zeabur Deployment

This backend can run on Zeabur as a Docker service. Zeabur provides HTTPS for
the generated public domain and can bind a custom domain later.

## Required Zeabur Settings

Deploy from the repository root so Zeabur can detect the root `Dockerfile`.

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
