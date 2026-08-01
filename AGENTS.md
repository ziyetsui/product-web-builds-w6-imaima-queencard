# ima ima queencard — Agent Instructions

## Operating Model (Tyr Chen / GBA)

This repo uses the GBA feature-first structure (rule
`wiki/.rules/0026_gba_feature_first_structure.md`): one feature → one numbered
folder under `.gba/` holding all of that feature's specs and docs; worktrees
live under `.trees/`; colleague code enters `main` only through merge/PR,
never by copying folders.

## Layout

```text
ima ima queencard/     the product (Next.js full-stack app in frontend/;
                       backend/ is a reserved empty boundary)
.gba/
  0001_prompt-replication/   prompt contract v1→v4 specs + version record
  0002_dual-mode-workbench/  generation workbench SPEC, acceptance, modules,
                             smoke + raphael evidence
  0003_auth-payment/         trustmrr audit + auth/trustmrr screenshots
  0004_project-structure/    project-structure-map.md
  0005_db-migration/         db-migration-baseline.md
.trees/                git worktrees, one per feature slug (gitignored)
  prompt-replication/  feat/prompt-replication — pattern engine v4
```

New features: next sequence under `.gba/` + `.trees/{slug}` worktree on a
`feat/{slug}` branch.

## Key Facts

- Package manager: pnpm. Dev server: `pnpm dev` in the app's `frontend/`
  (port 8080). Verify with `pnpm vitest run` and `pnpm build`.
- This repo lives in iCloud Drive: full-tree `git status`, recursive grep,
  and bulk checkouts can stall on cloud-evicted files. Prefer targeted paths;
  rsync to a local directory before test/build loops; run long git operations
  in the background.
- Prompt-card library is static data in `frontend/src/data/`; accounts,
  credits, and generation tasks live in PostgreSQL (`DATABASE_URL` in
  `frontend/.env.local`).
- The app folder keeps its own `AGENTS.md` for code-level rules; this file
  governs repo-level structure and workflow.

## Discipline

- Never commit `.trees/`.
- Never mix another branch's files into `ima ima queencard/` by hand — merge
  through git.
- Push after committing: unpushed local commits have been lost once already
  when a folder was deleted.
