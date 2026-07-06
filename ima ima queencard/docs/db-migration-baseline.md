# imaima queencard DB Migration Baseline

## Metadata

- Date: 2026-06-14
- App root: `w6/ima ima queencard/frontend/`
- Config: `frontend/drizzle.config.ts`
- Schema: `frontend/src/db/schema.ts`
- Migration output: `frontend/src/db/migrations/`
- Related tasks: `specs/w6/0007-imaima-queencard-implementation-tasks.md` T012, T067

## Inspection Result

Current Drizzle config points migrations to:

```text
frontend/src/db/migrations/
```

Current DB files:

```text
frontend/src/db/index.ts
frontend/src/db/schema.ts
```

The baseline migration now exists:

```text
frontend/src/db/migrations/0000_smart_lord_tyger.sql
frontend/src/db/migrations/meta/0000_snapshot.json
frontend/src/db/migrations/meta/_journal.json
```

## Dry-Run Status

Checked:

```bash
pnpm exec drizzle-kit generate --help
```

`drizzle-kit generate` does not expose a dry-run flag in the installed version
(`drizzle-kit@0.31.10`). Because of that, this phase did not run
`pnpm run db:generate`; generating migration files is deferred to T067.

## T067 Baseline Generation

First attempted:

```bash
pnpm run db:generate
```

Result:

```text
Missing DATABASE_URL/POSTGRES_URL env var
```

Reason: `drizzle.config.ts` imports `dotenv/config`, which loads `.env` but not
`.env.local`.

Then generated the baseline with local env loaded explicitly:

```bash
pnpm exec dotenv -e .env.local -- drizzle-kit generate
```

Result:

```text
15 tables
[✓] Your SQL migration file ➜ src/db/migrations/0000_smart_lord_tyger.sql
```

The generated SQL contains only schema DDL for enums, tables, constraints, and
indexes. It does not include secrets or runtime env values.

## Decision

Keep the generated initial baseline migration.

Notes:

- The current schema includes inherited/legacy tables.
- `0005` and `0006` explicitly say not to clean legacy schema in this round.
- No database migration was applied during this task; only migration files were
  generated.

## Next Step

- Before running `db:migrate` against any shared or production database, verify
  the target `DATABASE_URL`/`POSTGRES_URL` and take a backup.
