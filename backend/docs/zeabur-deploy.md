# Zeabur Deployment

The backend Docker service is defined under `backend`. Zeabur provides HTTPS
for the generated public domain and can bind a custom domain later. The server
uses PostgreSQL, S3-compatible storage, durable workers, and the checked-in
template catalog in production; it remains fail-closed when required settings
are absent or inconsistent.

## Required Zeabur Settings

Set the Zeabur service root to `backend`. Zeabur must discover
`backend/Dockerfile` and use the `backend` directory as its Docker build
context. The repository root has no Dockerfile. The image packages `src`,
`public`, `template-data`, `catalog`, and `migrations`.

The equivalent local command, run from the repository root, is:

```bash
docker build -t ima-miniapp-backend backend
```

Expose the HTTP port Zeabur injects as `PORT`. The container already reads
`process.env.PORT`.

For a local-storage preview only, add a persistent Volume:

```text
/data
```

This keeps local development data after restarts. Production should use the
PostgreSQL and S3-compatible settings below instead of relying on a container
filesystem.

## Production Profiles

The tracked example is `backend/.env.zeabur.example`. Copy its keys into
Zeabur's environment settings and replace every placeholder through the
deployment secret manager. Never commit the resulting values.

For a payment-disabled internal smoke deployment, use:

```bash
NODE_ENV=production
BUILD_SHA=the-deployed-source-commit
PORT=8080
MINIAPP_BACKEND_HOST=0.0.0.0
MINIAPP_DEV_LOGIN=0
WECHAT_MINIAPP_APP_ID=your-miniapp-appid
WECHAT_MINIAPP_APP_SECRET=your-miniapp-appsecret
DATABASE_URL=postgres://...
DATABASE_SSL=1
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=https://your-s3-endpoint
STORAGE_BUCKET=your-bucket
STORAGE_ACCESS_KEY_ID=your-storage-access-key
STORAGE_SECRET_ACCESS_KEY=your-storage-secret
MINIAPP_ASSET_SIGNING_SECRET=your-asset-signing-secret
MINIAPP_PUBLIC_ASSET_BASE_URL=https://replace-with-your-zeabur-domain
MINIAPP_IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=your-gptproto-key
GENERATION_WORKER_MODE=durable
PAYMENT_PROVIDER=disabled
DEPLOYMENT_SMOKE_PROFILE=payment-disabled
```

Run the static gate before the deployment and after updating environment
settings:

```text
cd backend
npm ci
npm run preflight
```

The preflight prints only variable names and exits non-zero for missing or
invalid settings. `MINIAPP_DEV_LOGIN` must be `0`, the host must be
`0.0.0.0`, the build SHA must be real, and production generation must use
`gptproto` or `openai` with its matching key.

For a payment-enabled direct-merchant deployment, keep the same production
runtime settings and use this payment block:

```bash
PAYMENT_PROVIDER=wechat
MINIAPP_PAYMENT_MODE=wechat
WECHAT_PAY_MERCHANT_ID=your-merchant-id
WECHAT_PAY_CERTIFICATE_SERIAL=your-merchant-certificate-serial
WECHAT_PAY_API_V3_KEY=your-exactly-32-byte-api-v3-key
WECHAT_PAY_PRIVATE_KEY=your-pkcs8-private-key
WECHAT_PAY_PLATFORM_PUBLIC_KEY=your-platform-public-key
WECHAT_PAY_PUBLIC_KEY_ID=your-platform-public-key-id
WECHAT_PAY_NOTIFY_URL=https://your-domain/api/miniapp/payments/wechat/notify
WECHAT_PAY_REFUND_NOTIFY_URL=https://your-domain/api/miniapp/payments/wechat/refund-notify
WECHAT_PAY_REQUEST_TIMEOUT_MS=10000
```

The direct-merchant preflight requires the six merchant credential and callback
fields shown above, plus one response-verification configuration. The APIv3 key
must be exactly 32 UTF-8 bytes and both notification URLs must be HTTPS. Keep
the merchant private key, APIv3 key, and platform verification material only
in Zeabur secrets. Single public-key verification requires a separate
`WECHAT_PAY_PUBLIC_KEY_ID`; `WECHAT_PAY_PUBLIC_KEYS` is a serial/id-keyed map
and does not require one global key ID. Certificate-only compatibility requires
`WECHAT_PAY_PLATFORM_CERTIFICATE_SERIAL` with its certificate material.
The payment and refund callbacks must use different URL pathnames.
`WECHAT_PAY_REQUEST_TIMEOUT_MS` defaults to 10000 and must not exceed 30000 so
a stalled WeChat request cannot outlive the reconciliation lease.

For real image generation, choose exactly one matching provider key:

```bash
MINIAPP_IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=your-gptproto-key
```

After switching from development login, old local `wx-dev` tokens are rejected
by the backend. Users must log in again through the mini program so the backend
can exchange the current `wx.login` code for the real WeChat `openid`.

## Smoke Verification

Run the default payment-disabled deployment smoke check against the public
HTTPS domain:

```text
cd backend
npm run smoke -- https://your-zeabur-domain
```

Run the strict payment-enabled profile only after the WeChat provider is
configured:

```text
cd backend
DEPLOYMENT_SMOKE_PROFILE=payment-enabled npm run smoke -- https://your-zeabur-domain
```

Both profiles validate production health, build identity, dependency
readiness, the non-empty catalog, GPT Image 2, and the unauthenticated `401`
boundary. The payment-disabled profile requires unavailable payment; the
payment-enabled profile requires `payment.available=true` and
`payment.mode=wechat`.

The smoke profile does not create a real payable order. Before release, use a
real device to complete one small-amount JSAPI payment, verify one credit grant,
then issue a full refund and verify the separate refund callback, one credit
reversal, and the complete payment audit trail.

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
