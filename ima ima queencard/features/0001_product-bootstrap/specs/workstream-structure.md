# imaima queencard Workstream Structure Spec

## Purpose

Define the W6 workstream structure.

## Product Frame

```text
imaima queencard
```

W6 is a Xiaohongshu visual creation product centered on prompt/case selection,
dual-mode generation, task results, credit context, and reuse.

## Object Model

```text
Reference Case
Prompt Seed
Generation Mode
Model Capability
Credit Estimate
Generation Task
Result Asset
History Item
Reuse Action
```

## Folder Model

```text
w6/
  README.md
  docs/
    MEMORY.md
    VISION.md
    manual-test-checklist.md
  app/
    README.md
  tests/
    README.md
  skills/
    README.md
    PRD/
  reference/
    README.md
  evidence/
    README.md
    acceptance/
    screenshots/
  product-web-builds-w6/
    ima ima queencard/
      backend/
      frontend/
      vendors/
```

## Rules

- The current runnable app is
  `w6/product-web-builds-w6/ima ima queencard/frontend/`.
- `product-web-builds-w6/ima ima queencard/` is the current nested project root.
- Do not move the nested project until its git repository layout is reviewed.
- Specs live in global `specs/w6/`.
- `docs/spec/` inside the nested project is legacy during migration. Do not add
  new stable specs there.
- Evidence belongs in `w6/evidence/` or global acceptance folders, not hidden
  inside app docs once it becomes stable workstream proof.
- `frontend/` owns the active Next.js app; `backend/` is only a future boundary
  until standalone backend code exists.
