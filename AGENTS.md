# complete-miniapp

IMPORTANT: Continue until the requested outcome is complete and verified, or report a concrete blocker. Do not present an unverified scaffold as finished work.

## Operating Model

This project uses Tyr Chen's GBA feature-first workflow:

```text
research -> spec -> implementation -> verification -> learning
                    all within one feature folder
```

Reusable agent workflows live in:

```text
.agents/skills/research/
.agents/skills/spec/
.agents/skills/impl/
```

These are Chen Tian's original local skills. Do not replace them with summaries or project-specific rewrites.

## Feature-First Structure

One feature or work unit owns one numbered folder:

```text
.gba/
  0001_feature-slug/
    specs/   intent, PRD, design, verification plan, acceptance criteria
    docs/    research, implementation notes, decisions, runbooks, evidence, handoff
.trees/      optional Git worktrees, always gitignored
```

If material belongs to one feature, keep it inside that feature folder. Do not create top-level type-first `research/`, `spec/`, or `impl/` folders.

Stable cross-feature documentation may remain in the existing root `docs/`. Product code stays in the project's existing application/source folders.

## Artifact Routing

Before substantial work, identify the active `.gba/{sequence}_{feature-slug}/` folder.

- The `research` skill writes feature-specific memos and evidence beneath the active feature's `docs/`, normally `docs/research/`.
- The `spec` skill writes product intent, architecture, plans, contracts, verification design, and acceptance criteria beneath the active feature's `specs/`.
- The `impl` skill reads the active feature's specs and records decisions, verification evidence, deferred findings, and handoff material beneath its `docs/`.
- If no feature folder exists for the requested work, create the next unused four-digit sequence and a short lowercase hyphenated slug before producing artifacts.

When an original skill mentions a default top-level `./specs` or `./docs` path, this routing rule takes precedence for feature-specific work.

## Workflow

1. Read this `AGENTS.md` and inspect the project before editing.
2. Select or create the active numbered GBA feature folder.
3. Research expensive assumptions and prior art before locking design.
4. Write or refine specs before implementation when behavior or architecture changes.
5. Implement one reviewed, dependency-ordered slice at a time.
6. Run the lightest reliable verification for every changed surface.
7. Record decisions, evidence, deferred findings, and handoff notes in the active feature's `docs/`.

If implementation exposes a design gap, update the spec before continuing. If code and spec disagree, reconcile them explicitly.

## Safety

- Preserve existing product files and local modifications.
- Never move, rename, or delete existing files without explicit approval for the exact mapping.
- Never overwrite an existing `AGENTS.md` during initialization.
- Never overwrite an existing local skill folder during initialization.
- Never commit `.trees/` or manually edit `.git/worktrees` metadata.
- Avoid destructive Git commands such as `git reset --hard`.

## Verification

Before reporting completion:

- Inspect the active feature's `specs/` and `docs/` tree.
- Run formatter, linter, typecheck, build, and tests appropriate to the changed codebase.
- For documentation-only work, check links, paths, and formatting where tooling exists.
- Report which checks ran, their results, and anything that could not be verified.

## Learning Capture

Record reusable lessons deliberately:

- Project-specific intent and design belong in the active feature's `specs/`.
- Implementation evidence and handoffs belong in the active feature's `docs/`.
- Stable cross-feature guidance belongs in root documentation or this file.
- Reusable workflows belong in a dedicated local skill.

The goal is to make the same mistake only once.

## Hand Off

Final updates should state:

- active feature and sequence
- specs and docs changed
- product files changed
- verification evidence
- deferred findings or blockers
