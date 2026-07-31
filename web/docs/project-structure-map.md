# imaima queencard Project Structure Map

## Purpose

This document maps the global project code structure rule into the current
imaima queencard repository.

Global rule:

```text
../../../.rules/project-code-structure-rules.md
```

imaima queencard is currently a Next.js App Router product. To keep the project root
clean, the runnable app lives under `frontend/`.

## Current Root Shape

```text
w6/product-web-builds-w6/web/
  README.md
  AGENTS.md
  CodeGuideline.md
  docs/
  backend/
  frontend/
  vendors/
```

Commands run from:

```text
w6/product-web-builds-w6/web/frontend/
```

```bash
pnpm install
pnpm run dev
pnpm run lint
pnpm run build:prod
```

## Backend Boundary

There is no standalone backend service yet.

The root-level `backend/` directory is intentionally present as a future
boundary. Current backend-like code lives inside the Next.js app:

```text
frontend/src/app/api/
frontend/src/services/
frontend/src/db/
frontend/src/payment/
frontend/src/lib/api/
frontend/src/lib/auth/
frontend/src/mail/
```

## Backend Responsibility Mapping

| Global Template | Current Location | Notes |
|---|---|---|
| `backend/main.py` | Future standalone backend | Not present yet |
| `backend/config.py` | Future standalone backend or `frontend/src/env.mjs` | Environment config currently lives in frontend |
| `backend/api/routes/` | `frontend/src/app/api/**/route.ts` | API route handlers |
| `backend/api/schemas/` | Future `frontend/src/lib/api/schemas/` | Add when request/response validation needs explicit schemas |
| `backend/services/` | `frontend/src/services/` | Business workflows |
| `backend/repositories/` | Future `backend/repositories/` or `frontend/src/repositories/` | Add only when persistence outgrows `frontend/src/db/` |
| `backend/models/` | `frontend/src/db/schema.ts`, `frontend/src/types/`, `frontend/src/lib/types/` | Persistence and shared type models |
| `backend/clients/` | `frontend/src/payment/`, `frontend/src/lib/auth/`, `frontend/src/mail/`, `frontend/src/analytics.ts` | External SDKs and service integrations |
| `backend/utils/` | `frontend/src/lib/` | Small shared helpers |

## Frontend Responsibility Mapping

| Global Template | imaima queencard Location | Notes |
|---|---|---|
| `frontend/src/api/` | `frontend/src/lib/api/` | API helpers and frontend-facing request helpers |
| `frontend/src/stores/` | `frontend/src/stores/` | Client state stores |
| `frontend/src/components/layout/` | `frontend/src/components/layout/` | `Navbar`, `Footer`, and future shell components |
| `frontend/src/components/preview/` | Future `frontend/src/components/preview/` | Add when preview panes become a standalone surface |
| `frontend/src/components/player/` | Future `frontend/src/components/player/` | Add when playback/timeline UI exists |
| `frontend/src/components/style/` | Future `frontend/src/components/style/` | Add when style controls/presets become UI |
| `frontend/src/components/common/` | `frontend/src/components/common/` | Auth, checkout, billing, and shared product components |
| `frontend/src/hooks/` | `frontend/src/hooks/` | Reusable React hooks |
| `frontend/src/types/` | `frontend/src/types/` | Shared app/frontend types |
| `frontend/src/styles/` | `frontend/src/index.css`, `frontend/tailwind.config.ts` | Global styles and Tailwind tokens |

imaima queencard also has:

```text
frontend/src/components/landing/
```

This is a project-specific extension for home/marketing sections.

## Data And Asset Mapping

| Data Type | imaima queencard Location | Notes |
|---|---|---|
| Curated prompt/case data | `frontend/src/data/` | Data imported by UI and routes |
| Static served images | `frontend/public/` | Files that must be served directly by Next.js |
| XHS/RedNote reference images | `frontend/public/xhs-cases/` | Gallery and prompt example assets |
| Generated slide/carousel outputs | Future `slides/<slug>/` | Use for generated media artifacts |

Future generated asset shape:

```text
slides/<slug>/
  outline.yml
  images/style/<hash>.jpg
  images/<sid>/<blake3_hash>.jpg
```

## Vendor Mapping

External reference and integration material lives in:

```text
vendors/
  goya-auth-payment-kit/
```

This code is not active runtime code unless it is explicitly copied or imported
into `frontend/` or a future `backend/` service.

## Move Policy

- Keep project-level docs and rules at the root.
- Keep the runnable Next.js app under `frontend/`.
- Keep future standalone backend code under `backend/`.
- Keep external reference kits under `vendors/`.
- Keep Next.js App Router files under `frontend/src/app/`.
- Keep API route handlers in `frontend/src/app/api/**/route.ts`.
- Move real workflows out of route handlers into `frontend/src/services/`.
- Keep Drizzle schema and DB setup in `frontend/src/db/`.
- Keep external integration boundaries in domain folders such as `frontend/src/payment/`,
  `frontend/src/lib/auth/`, and `frontend/src/mail/`.
- Keep shared UI primitives in `frontend/src/components/ui/`.
- Keep reusable product components in `frontend/src/components/common/`.
- Keep page sections in `frontend/src/components/landing/` unless they become reusable across multiple surfaces.

## Migration Notes

The project has been reorganized so `w6/product-web-builds-w6/web/` is a clean project root and
`w6/product-web-builds-w6/web/frontend/` is the Next.js app root.

Top-level landing and shared components have been grouped:

```text
frontend/src/components/layout/
  Navbar.tsx
  Footer.tsx

frontend/src/components/landing/
  HeroSection.tsx
  ContrastSection.tsx
  ProcessSection.tsx
  MarqueeBand.tsx
  GallerySection.tsx
  UseCases.tsx
  FinalCta.tsx

frontend/src/components/common/
  user-auth-form.tsx
  checkout-button.tsx
```
