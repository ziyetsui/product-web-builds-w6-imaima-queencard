# Repository Reconciliation Design

Status: proposed for user review

## Purpose

Reconcile the current `origin/main` and `lemonricebal` histories without losing
either team's work, normalize the repository to the GBA feature-first contract,
and establish a stable base for the later shared Web and mini-program Core API.

This work is structural integration. It does not deploy production, change
production environment variables, migrate production data, or implement the
shared Core API.

## Verified Starting State

- Integration branch: `chore/repo-reconciliation`
- Integration worktree: `.trees/repo-reconciliation`
- Base commit: `origin/main` at `3bc238f75ea0e6994fd7f88c11b6d3ad7bf9f424`
- Product branch to integrate: `lemonricebal` at
  `e96bc21a91438883b707594793b7b6e2b94aee40`
- `lemonricebal` and `origin/main` have diverged. Each contains commits absent
  from the other.
- `origin/main` contains the latest merged payment, admin, Model Lab, and GBA
  work.
- `lemonricebal` contains the mini-program, mini-program backend, BO template
  data, Zeabur deployment, CDN, authentication, generation, account, billing,
  and history work.
- The original `lemonricebal` checkout contains an untracked
  `ima ima queencard/frontend/pnpm-workspace.yaml`. It is user-owned and must
  remain untouched.

## Goals

1. Preserve the Git ancestry of both `origin/main` and `lemonricebal`.
2. Preserve the active Web product, its static assets, its database migrations,
   and both branches' product features.
3. Restore the native mini-program and mini-program backend as tracked,
   top-level projects.
4. Establish one canonical Web runtime directory.
5. Establish one canonical GBA feature-first documentation tree at repository
   root.
6. Keep deployment paths deterministic for later Web and backend projects.
7. Leave a clean base for a separate shared-resource/Core API feature.

## Non-Goals

- Do not deploy or reconfigure Zeabur.
- Do not modify production PostgreSQL, SQLite, object storage, CDN, or secrets.
- Do not unify Web and WeChat identities in this work unit.
- Do not merge unreviewed feature branches such as
  `feat/prompt-replication` or `feat/async-concurrency-processing`.
- Do not redesign Web or mini-program UI.
- Do not implement new Core API endpoints.
- Do not move or delete the older outer workspace copies at
  `/Users/a2/Documents/landing page wechat mini program/ima-queencard-miniprogram`
  or `/Users/a2/Documents/landing page wechat mini program/miniapp-backend`.

## Safety Invariants

1. Create immutable backup refs for the exact starting commits before merging.
2. Perform all work in `.trees/repo-reconciliation`.
3. Never use a repository-wide `ours` or `theirs` merge strategy.
4. Resolve conflicts by product behavior and tests, not only by path.
5. Do not overwrite an existing `AGENTS.md`; edit it deliberately after the
   final layout is verified.
6. Do not delete duplicate documentation until every source file has a verified
   destination and content comparison.
7. Do not modify production configuration or copy real secrets.
8. Do not push to `main` or `lemonricebal` from this work unit.
9. Push only the integration branch until review is complete.

## Canonical Repository Layout

```text
/
  .agents/skills/{research,spec,impl}/
  .gba/{sequence}_{feature}/
  .trees/                         # ignored linked worktrees
  AGENTS.md
  ima ima queencard/
    AGENTS.md
    frontend/                     # canonical Next.js runtime
      src/
      public/
      package.json
      pnpm-lock.yaml
    docs/
    vendors/
  ima-queencard-miniprogram/      # native WeChat client
  miniapp-backend/                # current mini-program API
  Dockerfile                     # mini-program backend image
  Dockerfile.web                 # Web image
```

The final tree must not retain `ima ima queencard/src/` as a second runtime.
Business source remains outside `.gba/`; `.gba/` contains only specs and docs.

## Business File Mapping

### Web Runtime

- Canonical target: `ima ima queencard/frontend/`.
- Merge runtime content currently under `origin/main:ima ima queencard/src/`
  into `ima ima queencard/frontend/`.
- Preserve `ima ima queencard/frontend/public/`, including XHS and landing
  assets, unless a file is byte-identical and intentionally deduplicated.
- Preserve `lemonricebal` deployment support such as external asset/CDN
  configuration and Docker build paths.
- Preserve `origin/main` payment, admin, Model Lab, and prompt changes through
  semantic conflict resolution and tests.
- Update package, lockfile, TypeScript, Next.js, test, and Docker paths so all
  commands run from `ima ima queencard/frontend/`.

### Mini-Program and Mini-Program Backend

- Restore `ima-queencard-miniprogram/` from `lemonricebal` as a top-level
  project.
- Restore `miniapp-backend/` from `lemonricebal` as a top-level project.
- Preserve the provider adapter, template feed, account, credits, billing,
  history, admin, and generated-image flows.
- Do not copy runtime SQLite files, uploads, or secrets into Git.
- Keep the older copies outside the inner Git repository unchanged until a
  separate cleanup is explicitly approved.

### Deployment Files

- Reconcile root `Dockerfile`, `Dockerfile.web`, `.dockerignore`, and
  `.zeaburignore` against the canonical paths.
- Do not change live service branches, domains, volumes, environment variables,
  or databases as part of this merge.

## GBA Documentation Mapping

The repository root `.gba/` is the canonical feature documentation location.
The duplicate `ima ima queencard/features/` tree is migrated as follows:

| Current application feature folder | Canonical root GBA destination |
| --- | --- |
| `0009_prompt-replication` | merge into `.gba/0001_prompt-replication` |
| `0010_model-lab` | merge into `.gba/0002_model-lab` |
| `0004_pricing-payment`, `0011_payment-upgrade` | merge into `.gba/0003_payment-flow` |
| `0007_admin-recharge-management`, `0012_admin-console` | merge into `.gba/0004_admin-console` |
| `0001_product-bootstrap` | `.gba/0006_product-bootstrap` |
| `0002_design-system` | `.gba/0007_design-system` |
| `0003_registration-login` | `.gba/0008_registration-login` |
| `0005_image-generation-core` | `.gba/0009_image-generation-core` |
| `0006_dual-mode-workbench` | `.gba/0010_dual-mode-workbench` |
| `0008_agent-reverse-engineering` | `.gba/0011_agent-reverse-engineering` |
| `0000_archive-other-projects` | `.gba/9999_archive-other-projects` |

Rules for migration:

- Preserve every non-identical document.
- Rename colliding files descriptively rather than overwriting them.
- Compare content before removing the old application-level folder.
- Update indexes and links after the destination tree is complete.
- Remove `ima ima queencard/features/` only after verification proves no
  document was lost.

## Agent Skills and Contracts

- Install the original `research`, `spec`, and `impl` skills at repository root
  under `.agents/skills/` after verifying source hashes.
- Do not overwrite non-identical skill content.
- Keep the root `AGENTS.md` as the repository workflow contract and the product
  `ima ima queencard/AGENTS.md` as the application contract.
- Correct stale references only after the final directory layout exists.
- Both contracts must identify `frontend/` as the active Web runtime and root
  `.gba/` as the only feature documentation tree.

## Integration Sequence

1. Create backup refs for `origin/main` and `lemonricebal` starting commits.
2. Record a pre-merge file, asset, migration, and test inventory.
3. Merge `lemonricebal` into `chore/repo-reconciliation` with an explicit merge
   commit and no global conflict preference.
4. Resolve the Web runtime into `frontend/` while preserving both branches'
   behavior.
5. Restore and verify the mini-program and mini-program backend.
6. Reconcile deployment files against final paths.
7. Migrate application-level feature documents into root `.gba/` according to
   the table above.
8. Install root agent skills and repair repository contracts.
9. Run the full verification matrix.
10. Commit and push only the integration branch for review.

## Verification Matrix

### Git and Structure

- `origin/main` is an ancestor of the final branch.
- `lemonricebal` is an ancestor of the final branch.
- No unmerged paths remain.
- `git status --short` is clean after the integration commit.
- `ima ima queencard/src/` no longer exists as a runtime root.
- `ima ima queencard/features/` no longer exists after verified migration.
- `.trees/` remains ignored and untracked.

### Web

- Install dependencies from `ima ima queencard/frontend/` under the approved
  pnpm build-script policy.
- Run unit tests.
- Run lint.
- Run the production build.
- Verify landing, prompts, generation, generated history, pricing, credits,
  login, admin, payment, and Model Lab routes.
- Verify static assets and external CDN paths.

### Mini-Program

- Run `npm run validate` in `ima-queencard-miniprogram/`.
- Verify all pages in `app.json` resolve.
- Verify template, generation, result, history, credits, pricing, account,
  billing, and admin API contracts.
- Perform visual review in WeChat Developer Tools after implementation.

### Mini-Program Backend

- Run `npm test` in `miniapp-backend/`.
- Verify SQLite and upload paths remain ignored.
- Verify health, auth, template, generation, history, credits, billing, admin,
  and download routes.
- Verify no provider or WeChat secret is committed.

### Data and Deployment

- Compare database migration inventories before and after integration.
- Compare template record counts and source IDs.
- Compare tracked static asset counts and paths.
- Build both Docker targets without changing live services.
- Scan tracked files for likely credentials and oversized generated artifacts.

## Baseline Evidence

- The integration branch starts clean at `origin/main` commit `3bc238f`.
- Direct Vitest execution on the base passed 161 tests with 2 skipped across
  23 test files, one of which was skipped.
- `pnpm install` currently exits with `ERR_PNPM_IGNORED_BUILDS` for `esbuild`,
  `msw`, and `sharp`. The integration must define an explicit allow/deny policy
  rather than committing the placeholder file generated by pnpm.

## Rollback

- The original `lemonricebal` checkout remains untouched.
- Backup refs preserve both starting commits.
- The integration worktree can be removed without deleting either source
  branch.
- No deployment or data migration occurs before a reviewed integration commit.
- If verification fails, reset only the disposable integration branch to its
  backup ref; never reset `main` or `lemonricebal`.

## Follow-Up Feature

After repository reconciliation is accepted, create a separate GBA work unit for
the shared Core API. That feature will define shared templates, assets, model
catalog, generation rules, PostgreSQL data ownership, object storage, Web BFF,
mini-program authentication, and later cross-platform identity mapping.

