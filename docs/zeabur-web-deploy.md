# Zeabur Web Deployment

This branch contains the Web application only.

- `Dockerfile.web`: Next.js web frontend image.
- `web/imaima-queencard/frontend/`: runnable Next.js app.

Create a Zeabur service from this repository and deploy branch
`chore/extract-web-20260731`.

## Zeabur Build Settings

Use one of these approaches:

```text
Service name: web
Dockerfile: Dockerfile.web
Port: 8080
```

If Zeabur does not auto-pick the Dockerfile, add this service variable:

```bash
ZBPACK_DOCKERFILE_NAME=web
```

or explicitly set:

```bash
ZBPACK_DOCKERFILE_PATH=Dockerfile.web
```

Set the Dockerfile path to `Dockerfile.web` and port to `8080`.

## Required Runtime Environment

Set these before production deployment:

```bash
NEXT_PUBLIC_APP_URL=https://your-web-zeabur-domain
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgres://user:password@host:port/database
IMAGE_PROVIDER=gptproto
GPTPROTO_API_KEY=your-gptproto-api-key
GPTPROTO_BASE_URL=https://gptproto.com
GPTPROTO_IMAGE_TIMEOUT_MS=300000
GPTPROTO_POLL_INTERVAL_MS=2000
GPTPROTO_MAX_POLL_ATTEMPTS=120
NEXT_PUBLIC_BILLING_PROVIDER=creem
CREEM_API_BASE_URL=https://test-api.creem.io/v1
```

`NEXT_PUBLIC_*` values are also declared as Docker build args in
`Dockerfile.web`, so Zeabur can pass them during the Next.js build. Keep server
secrets such as `BETTER_AUTH_SECRET`, `DATABASE_URL`, `GPTPROTO_API_KEY`, and
payment keys as runtime variables.

For a first non-payment preview, `CREEM_API_KEY` and product IDs can stay empty;
pricing pages render, but checkout will fail until billing credentials are set.

For real Creem payments, add:

```bash
CREEM_API_KEY=your-creem-api-key
CREEM_WEBHOOK_SECRET=your-creem-webhook-secret
CREEM_PRODUCT_CREATOR_MONTHLY=your-product-id
CREEM_PRODUCT_CREATOR_ANNUAL=your-product-id
CREEM_PRODUCT_STUDIO_MONTHLY=your-product-id
CREEM_PRODUCT_STUDIO_ANNUAL=your-product-id
CREEM_PRODUCT_CREDIT_CREATOR=your-product-id
CREEM_PRODUCT_CREDIT_STUDIO=your-product-id
```

For Google login, add:

```bash
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

For admin access, add:

```bash
ADMIN_EMAIL=owner@example.com
SUPERADMIN_EMAILS=owner@example.com
```

## Database

The web app uses Postgres through `DATABASE_URL`. After deployment, run the
frontend migration command once from Zeabur shell or another environment with
the same `DATABASE_URL`:

```bash
pnpm db:migrate
```

If Zeabur builds with the root `Dockerfile.web`, the app directory inside the
build container is `/app/frontend`.

## Smoke Checks

After Zeabur gives an HTTPS domain, open:

```text
https://your-web-zeabur-domain/
https://your-web-zeabur-domain/prompts
https://your-web-zeabur-domain/pricing
```

Then update `NEXT_PUBLIC_APP_URL` to the final HTTPS domain and redeploy so auth
callbacks and payment return URLs are correct.
