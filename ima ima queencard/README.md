# imaima queencard

`w6/ima ima queencard/` is the project root for imaima queencard.

The runnable Next.js product lives in `frontend/`. The project root stays clean
and only carries project-level docs, rules, future backend boundary, and vendor
references.

Canonical W6 specs now live in the global 20-29 specs ledger:

```text
../../../specs/w6/
```

The local `docs/spec/` folder is a legacy source copy during migration. Do not
add new long-lived PRDs, design specs, implementation plans, reviews, or
acceptance specs there.

## Structure

```text
w6/ima ima queencard/
  README.md
  AGENTS.md
  CodeGuideline.md
  docs/
  backend/
  frontend/
  vendors/
```

Current status:

- `frontend/`: active Next.js App Router product.
- `backend/`: reserved for a future standalone backend; current API routes live in `frontend/src/app/api/`.
- `vendors/`: external integration/reference code.

## Local Development

```bash
cd frontend
pnpm install
pnpm run dev
```

The dev server runs on port `8080`.

## Useful Commands

```bash
cd frontend
pnpm test
pnpm run lint
pnpm run build:prod
```

## Environment

Start from `frontend/.env.example` and keep real values in `frontend/.env.local`
for local development or in the deployment provider's secret store for
production. Do not commit secrets.

Required local app/auth values:

```text
NEXT_PUBLIC_APP_URL=http://localhost:8080
BETTER_AUTH_SECRET=<local-secret>
DATABASE_URL=<postgres-url>
```

Stripe billing variables:

```text
NEXT_PUBLIC_BILLING_PROVIDER=stripe
STRIPE_API_KEY=<stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-secret>
NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID=<price-id>
NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID=<price-id>
NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY_PRICE_ID=<price-id>
NEXT_PUBLIC_STRIPE_BUSINESS_YEARLY_PRICE_ID=<price-id>
```

Email login uses Better Auth magic links. Production should use Zeabur
Email/ZSend unless a verified fallback is documented:

```text
EMAIL_PROVIDER=zeabur
ZEABUR_EMAIL_API_KEY=<zsend-api-key>
ZEABUR_EMAIL_FROM=<verified-sender>
ZEABUR_EMAIL_API_URL=https://api.zeabur.com/api/v1/zsend/emails
```

Optional/fallback email provider:

```text
EMAIL_PROVIDER=resend
RESEND_API_KEY=<resend-api-key>
RESEND_FROM=<verified-sender>
```

Google OAuth is optional. Keep email visible regardless of this flag:

```text
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Admin/debug:

```text
ADMIN_EMAIL=<operator-email>
IS_DEBUG=false
```

Leave Creem unset unless explicitly running the inherited Creem path:

```text
NEXT_PUBLIC_BILLING_PROVIDER=creem
CREEM_API_KEY=<creem-api-key>
CREEM_WEBHOOK_SECRET=<creem-webhook-secret>
```

## Database

Drizzle uses `frontend/drizzle.config.ts` and writes migrations to
`frontend/src/db/migrations/`.

Use `.env.local` explicitly when running Drizzle locally because the config's
plain `dotenv/config` import does not load `.env.local` by itself:

```bash
cd frontend
pnpm exec dotenv -e .env.local -- drizzle-kit generate
pnpm exec dotenv -e .env.local -- drizzle-kit migrate
```

Project scripts are still available if the database URL is provided by the
current shell or a `.env` file:

```bash
pnpm run db:generate
pnpm run db:migrate
pnpm run db:push
pnpm run db:studio
```

Before applying migrations to a shared or production database, take a backup
and confirm the target `DATABASE_URL`/`POSTGRES_URL`. The initial baseline keeps
the inherited legacy schema and does not clean Creem or old auth tables.

## Zeabur Deployment

Set production and preview variables in Zeabur, not in git:

```text
NEXT_PUBLIC_APP_URL=https://<zeabur-domain>
BETTER_AUTH_SECRET=<production-secret>
DATABASE_URL=<zeabur-postgres-url>
EMAIL_PROVIDER=zeabur
ZEABUR_EMAIL_API_KEY=<zsend-api-key>
ZEABUR_EMAIL_FROM=<verified-sender>
ZEABUR_EMAIL_API_URL=https://api.zeabur.com/api/v1/zsend/emails
NEXT_PUBLIC_BILLING_PROVIDER=stripe
STRIPE_API_KEY=<stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-secret>
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
ADMIN_EMAIL=<operator-email>
IS_DEBUG=false
```

After changing auth, email, Stripe, or URL variables, redeploy or restart the
frontend service. Then smoke test both `/login` and `/register` on the Zeabur
URL with a real mailbox and confirm the magic link callback stays on the same
Zeabur domain.

## Project Structure Map

See `docs/project-structure-map.md` for how this project maps the shared
backend/frontend/data structure rules into the current repository.

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui-style components
- GSAP and Framer Motion
