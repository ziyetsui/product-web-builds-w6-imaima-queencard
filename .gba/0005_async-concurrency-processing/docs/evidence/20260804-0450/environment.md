# Verification environment

- Timestamp: 2026-08-04 04:50 CST (Asia/Shanghai)
- Runtime: local macOS, Node.js/pnpm workspace runtime
- Database: disposable local PostgreSQL initialized with `initdb`; database name contained `test`
- Migrations: `src/db/migrations/0000` through `0006`, applied in order with `ON_ERROR_STOP=1`
- Worker count: 8
- Task count: 1,000
- Limits: global 4, per user 1, per provider/model 2
- Provider: deterministic fake provider; no production provider or billing account used
- Secrets: no credential values recorded

The disposable PostgreSQL process and data directory were stopped and deleted after each verification run.
