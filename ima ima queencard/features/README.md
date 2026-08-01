# imaima queencard Features

This folder uses a GBA-style feature-first structure: one work unit, one numbered folder, with that unit's specs and docs kept together.

## Layout

```text
features/
  0001_product-bootstrap/
    specs/
    docs/
  0002_design-system/
    specs/
    docs/
```

## Rule

- Put PRDs, design specs, acceptance criteria, task plans, and reviews in `specs/`.
- Put evidence, checklists, diagrams, screenshots, runbooks, and handoff notes in `docs/`.
- Do not add new top-level type folders such as `design/` or `evidence/`.
- If a new work unit appears, create the next numbered feature folder.

## Feature Index

- `0001_product-bootstrap`: initial planning, implementation reviews, testing safety net, and project structure notes.
- `0002_design-system`: component specs, visual tokens, and UI reference assets.
- `0003_registration-login`: registration and login requirements.
- `0004_pricing-payment`: pricing, payment, and Creem migration work.
- `0005_image-generation-core`: image generation core specs, v2 PRD, checklists, and interaction notes.
- `0006_dual-mode-workbench`: dual-mode workbench specs, module breakdown, routing, credits, and acceptance.
- `0007_admin-recharge-management`: admin recharge management PRD, design, and implementation plan.
- `0008_agent-reverse-engineering`: reverse-engineering method spec.
- `0009_merge-deployment`: merge/deployment spec and live smoke evidence.
- `9999_archive-other-projects`: unrelated legacy notes kept as archive material.
