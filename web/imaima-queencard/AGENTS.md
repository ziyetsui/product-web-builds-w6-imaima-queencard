# Agent Instructions

## Project Shape

This directory is the project root for `web/imaima-queencard`.

The runnable app lives in:

```text
frontend/
```

Run Next.js commands from `frontend/`, not from the project root.

The root directory exists to keep project-level context clean:

```text
web/imaima-queencard/
  README.md
  AGENTS.md
  CodeGuideline.md
  docs/
  backend/
  frontend/
  vendors/
```

Current backend status:

- There is no standalone backend service yet.
- Backend-like responsibilities are currently implemented through Next.js route handlers in `frontend/src/app/api/`.
- Keep the empty `backend/` boundary for future FastAPI/service extraction.

Before large structure changes, read:

- `docs/project-structure-map.md`
- `CodeGuideline.md`

## Tech Stack

The active app in `frontend/` uses:

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 3
- shadcn/ui-style components with Radix UI primitives
- GSAP and Framer Motion for animation
- Better Auth / Creem auth integration
- Drizzle ORM with Postgres
- Stripe billing
- Resend email
- Zustand and TanStack Query where state/query helpers are needed
- `@enter-pro/analytics-sdk` for analytics

## Common Commands

From `frontend/`:

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build:prod
```

The dev server is configured in `frontend/package.json` to use port `8080`.

## Structure Map

Backend-like responsibilities live inside the Next.js app:

- `frontend/src/app/api/**/route.ts`: API route handlers.
- `frontend/src/services/`: Business workflows and use-case orchestration.
- `frontend/src/db/`: Drizzle client and schema.
- `frontend/src/payment/`: Billing provider, plans, subscriptions, and webhooks.
- `frontend/src/lib/api/`: API auth, response, error, and dashboard helpers.
- `frontend/src/lib/auth/`: Better Auth setup and auth clients.
- `frontend/src/mail/` and `frontend/src/lib/emails/`: Email components and email utilities.

Frontend responsibilities live in:

- `frontend/src/app/**/page.tsx`: Route-level pages.
- `frontend/src/components/layout/`: App shell, navigation, and footer components.
- `frontend/src/components/landing/`: Landing-page sections.
- `frontend/src/components/common/`: Shared product components such as auth and checkout UI.
- `frontend/src/components/ui/`: shadcn/Radix-style UI primitives.
- `frontend/src/hooks/`: React hooks.
- `frontend/src/stores/`: Client state stores.
- `frontend/src/types/`: Shared frontend and app types.
- `frontend/src/index.css`: Global styles and Tailwind layers.

Data and assets live in:

- `frontend/src/data/`: Landing page data, prompt cases, and case metrics.
- `frontend/public/`: Static assets served directly.
- `frontend/public/xhs-cases/`: Static RedNote/XHS reference images.

Generated slide or carousel outputs should use root-level `slides/<slug>/` when
they become runtime/generated project artifacts. Do not mix generated media into
source code folders.

## Current Product Surface

Routes currently include:

- `/`: Main landing page.
- `/prompts`: Prompt and case library page.
- `/pricing`: Pricing and checkout page.
- `/credits`: Credits page.
- `/login`: Login page.
- `/register`: Registration page.
- `not-found.tsx`: Not-found route.

Important API routes include auth, Stripe checkout/webhook, user billing, credit
balance/history, and admin credit adjustment routes under `frontend/src/app/api/`.

## Coding Rules

Follow the global AI coding principles:

- YAGNI: implement only what the current request needs.
- KISS: prefer simple functions and straightforward branching.
- Naming is design: avoid vague names such as `data`, `temp`, `helper`, `util`, and `manager`.
- Fail fast: do not silently catch or ignore invalid states.

Keep changes narrowly scoped. Do not add new abstractions, state managers, or
compatibility layers unless the task clearly requires them.

## UI Rules

- Preserve the existing landing-page visual language before inventing new styles.
- Prefer existing components from `frontend/src/components/ui/` before adding new UI primitives.
- Use `lucide-react` icons when an icon is needed.
- Keep landing sections responsive across mobile and desktop.
- Avoid adding explanatory text about how the UI works inside the UI itself.
- Do not use decorative gradients, oversized cards, or nested card layouts unless they already match the existing design.

## Editing Guidance

- Before editing a feature, inspect the route, component folder, and nearby styles first.
- Keep route-specific logic close to its `frontend/src/app/<route>/` folder.
- Put reusable product UI in `frontend/src/components/common/`.
- Put shared shell components in `frontend/src/components/layout/`.
- Put landing sections in `frontend/src/components/landing/`.
- Put reusable non-React helpers in `frontend/src/lib/`.
- Put reusable hooks in `frontend/src/hooks/`.
- Put business workflows in `frontend/src/services/`.
- Put database schema and Drizzle setup in `frontend/src/db/`.
- Avoid touching generated/dependency output such as `frontend/.next/`, `dist/`, and `frontend/node_modules/`.
- Do not edit large media/reference collections unless the user explicitly asks.

## Verification

For code changes, run the narrowest useful check first from `frontend/`:

```bash
pnpm run lint
pnpm run build:prod
```

For visual changes, start the dev server and inspect the affected page in a browser.

## Notes For Agents

- `frontend/` is the active runtime app.
- `backend/` is intentionally present as a future standalone backend boundary.
- `vendors/goya-auth-payment-kit/` is an integration reference/source kit, not active runtime code.
- `docs/project-structure-map.md`, `CodeGuideline.md`, `frontend/package.json`, and `frontend/next.config.ts` are the source of truth for the current project structure.
