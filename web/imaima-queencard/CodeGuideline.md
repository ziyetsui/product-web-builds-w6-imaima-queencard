# Code Guideline

## Screenshot Replication Requirements

根据截图复刻界面时，遵循下面规则。

1. 使用 Next.js + Tailwind + shadcn/ui。
2. 优先使用 `@/components/ui/button`、`dialog`、`input`、`form`、`card`。
3. 如果组件不存在，先用 shadcn CLI 添加。
4. 不要手写复杂弹窗/表单控件。
5. 保持组件可复用。

## Project Structure Overview

`web/imaima-queencard/` is the project root. `frontend/` is the active Next.js app root.

```text
project-root/
  AGENTS.md
  CodeGuideline.md
  README.md
  docs/
    project-structure-map.md

  backend/
    README.md

  frontend/
    package.json
    next.config.ts
    tsconfig.json
    tailwind.config.ts
    drizzle.config.ts
    public/
      xhs-cases/
    src/
      app/
      actions/
      components/
        common/
        landing/
        layout/
        ui/
      config/
      data/
      db/
      hooks/
      lib/
      mail/
      payment/
      services/
      stores/
      types/

  vendors/
    goya-auth-payment-kit/
```

## Directory Responsibilities

| Directory | Responsibility |
|---|---|
| `backend/` | Reserved for a future standalone backend; current backend-like code remains in `frontend/src/app/api/` |
| `frontend/` | Active Next.js App Router product |
| `frontend/src/app/` | Next.js route-level pages, layouts, metadata, providers, and route handlers |
| `frontend/src/app/api/` | API route handlers; this maps to the global `backend/api/routes/` idea |
| `frontend/src/actions/` | Server actions and action wrappers |
| `frontend/src/components/layout/` | Navigation, footer, and app shell components |
| `frontend/src/components/landing/` | Home/marketing landing sections |
| `frontend/src/components/common/` | Shared product components such as auth, checkout, and billing UI |
| `frontend/src/components/ui/` | shadcn/Radix-style UI primitives |
| `frontend/src/config/` | Product, site, price, billing, and credit configuration |
| `frontend/src/data/` | Prompt cases, case metrics, and other curated display data |
| `frontend/src/db/` | Drizzle database client and schema |
| `frontend/src/hooks/` | Reusable React hooks |
| `frontend/src/lib/api/` | API auth, error, response, and dashboard helpers |
| `frontend/src/lib/auth/` | Better Auth setup, clients, and auth DB integration |
| `frontend/src/lib/emails/` | Email rendering utilities and templates shared by app code |
| `frontend/src/mail/` | Email templates, email components, and email types |
| `frontend/src/payment/` | Billing provider, subscription plans, Stripe integration, and webhooks |
| `frontend/src/services/` | Business workflows and use-case orchestration |
| `frontend/src/stores/` | Client state stores |
| `frontend/src/types/` | Shared app/frontend types |
| `frontend/src/index.css` | Global CSS and Tailwind layers |
| `frontend/public/` | Static files served directly |
| `frontend/public/xhs-cases/` | Static XHS/RedNote reference images used by the gallery and prompt examples |
| `vendors/goya-auth-payment-kit/` | Integration reference kit; not active runtime code |

## Global Rule Mapping

This project follows `../../.rules/project-code-structure-rules.md`.

Physical root mapping:

```text
backend/   -> future standalone backend boundary
frontend/  -> active Next.js app
vendors/   -> external integration/reference material
```

Backend responsibilities currently map into the Next.js app:

```text
backend/api/routes/     -> frontend/src/app/api/**/route.ts
backend/api/schemas/    -> future frontend/src/lib/api/schemas/
backend/services/       -> frontend/src/services/
backend/repositories/   -> future backend/repositories/ or frontend/src/repositories/
backend/models/         -> frontend/src/db/schema.ts, frontend/src/types/, frontend/src/lib/types/
backend/clients/        -> frontend/src/payment/, frontend/src/lib/auth/, frontend/src/mail/, frontend/src/analytics.ts
backend/utils/          -> frontend/src/lib/

frontend/src/api/       -> frontend/src/lib/api/
frontend/src/stores/    -> frontend/src/stores/
frontend/src/components/layout/  -> frontend/src/components/layout/
frontend/src/components/common/  -> frontend/src/components/common/
frontend/src/hooks/     -> frontend/src/hooks/
frontend/src/types/     -> frontend/src/types/
frontend/src/styles/    -> frontend/src/index.css and frontend/tailwind.config.ts
```

`frontend/src/components/landing/` is a imaima queencard-specific extension for
marketing page sections.

Generated slide or carousel assets should use:

```text
slides/<slug>/
  outline.yml
  images/style/<hash>.jpg
  images/<sid>/<blake3_hash>.jpg
```

Use `frontend/public/` only for static assets that must be directly served by Next.js.

## How To Add New Code

### 1. Adding A New Page

- Create a subdirectory under `frontend/src/app/` for each new route.
- Place the route entrypoint at `frontend/src/app/<route>/page.tsx`.
- Add route-specific components in the same route folder if they are not reusable.
- Use `layout.tsx`, `loading.tsx`, `error.tsx`, or `not-found.tsx` only when the route needs them.

### 2. Adding A New API Route

- Create or update `frontend/src/app/api/**/route.ts`.
- Keep route handlers thin.
- Put business workflows in `frontend/src/services/`.
- Put shared API response/error/auth helpers in `frontend/src/lib/api/`.
- Add explicit schemas under `frontend/src/lib/api/schemas/` when request/response validation becomes complex.

### 3. Adding A New Component

- Use `frontend/src/components/ui/` for UI primitives.
- Use `frontend/src/components/layout/` for shell/navigation/footer components.
- Use `frontend/src/components/landing/` for landing-page sections.
- Use `frontend/src/components/common/` for reusable product components.
- If a component is only used by one route, keep it near that route under `frontend/src/app/<route>/`.

### 4. Adding A New Hook

- Create a new file in `frontend/src/hooks/` named after the hook.
- Each file should export one focused hook.
- Hooks should not hide business workflows that belong in `frontend/src/services/`.

### 5. Adding Utilities Or Clients

- Add reusable non-React helpers to `frontend/src/lib/`.
- Add external service clients to the closest domain folder, such as `frontend/src/payment/`,
  `frontend/src/lib/auth/`, or `frontend/src/mail/`.
- Keep database schema and Drizzle setup in `frontend/src/db/`.

## Coding Best Practices

- One module, one responsibility.
- High cohesion, low coupling.
- Prefer precise names over comments that explain vague names.
- Keep page-specific logic close to the page.
- Share code only when it is actually reused.
- Do not add compatibility layers or factories unless the current task needs them.
- Update `CodeGuideline.md` and `docs/project-structure-map.md` after structural moves.

## Verification

For code changes, run from `frontend/`:

```bash
pnpm run lint
pnpm run build:prod
```

For visual changes, run the dev server from `frontend/` and inspect the affected page:

```bash
pnpm run dev
```
