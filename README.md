# imaima queencard Web

This branch is the Web-only working copy of the Queencard project.

## Layout

```text
web/imaima-queencard/
  frontend/   Next.js application and API routes
  backend/    Reserved Web backend boundary
  vendors/    Shared authentication, payment, and email references
  docs/       Web specifications and verification records
Dockerfile.web
```

The WeChat Mini Program and its backend are intentionally kept out of this
branch. Their source remains available on the original `lemonricebal` branch.

## Local development

```bash
cd web/imaima-queencard/frontend
pnpm install
pnpm dev
```

## Validation

```bash
cd web/imaima-queencard/frontend
pnpm test
pnpm build
```

## Deployment

Use `Dockerfile.web` with port `8080`. See
`docs/zeabur-web-deploy.md` for the required environment variables.
