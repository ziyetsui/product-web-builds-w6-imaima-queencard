# Copy Map

## Core auth

- `copy-src/src/lib/auth` -> Better Auth server/client setup.
- `copy-src/src/app/api/auth` -> Auth route handler.
- `copy-src/src/lib/api/auth.ts` -> `requireAuth` and `requireAdmin` helpers.
- `copy-src/src/lib/email.ts`, `copy-src/src/lib/emails`, `copy-src/src/mail` -> Resend and email templates.

## Database

- `copy-src/src/db` -> Drizzle schema and db client.
- `copy-src/drizzle.config.ts` -> Drizzle CLI config.

## Payment and credits

- `copy-src/src/payment` -> Stripe client, plan helpers, webhook handlers.
- `copy-src/src/services/billing.ts` -> Checkout/session/subscription service.
- `copy-src/src/services/customer.ts` -> Customer lookup and update service.
- `copy-src/src/services/credit.ts` -> Credit balance/history/mutation service.
- `copy-src/src/actions/stripe.ts`, `copy-src/src/actions/customer.ts` -> Server actions.
- `copy-src/src/app/api/webhooks` -> Stripe webhook route.
- `copy-src/src/app/api/v1/credit` -> Credit API routes.
- `copy-src/src/app/api/v1/user` -> User billing/profile API routes.
- `copy-src/src/app/api/v1/admin/credits` -> Admin credit adjustment route.

## Config

- `copy-src/src/config/billing-provider.ts` -> Stripe/Creem switch.
- `copy-src/src/config/credits.ts` -> Credit package display helpers.
- `copy-src/src/config/pricing-user.ts` -> Product IDs, prices, credit rules.
- `copy-src/src/config/price` -> Pricing page copy/config.
- `copy-src/src/config/site.ts` -> Site metadata used by auth emails.

## Optional UI

- `copy-src/src/components/user-auth-form.tsx` -> Login/register form.
- `copy-src/src/components/sign-in-modal.tsx` -> Modal login.
- `copy-src/src/components/billing-form.tsx` -> Stripe billing form button.
- `copy-src/src/components/price` -> Pricing cards.
- `copy-src/src/components/credits` -> Credits page components.
- `copy-src/src/components/billing` -> Billing settings components.
- `copy-src/src/hooks` -> Client hooks for billing, credits, sign-in modal.
- `copy-src/src/stores/credits-store.ts` -> Zustand credit store.

## Optional locale support

- `copy-src/src/i18n`
- `copy-src/src/messages`
- `copy-src/src/middleware.ts`
- `copy-src/src/app/[locale]/(auth)`
- `copy-src/src/app/[locale]/(dashboard)/credits`
- `copy-src/src/app/[locale]/(marketing)/pricing`

imaima queencard can skip these if it wants simple non-locale routes.
