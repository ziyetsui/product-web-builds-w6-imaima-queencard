# Auth database environment compatibility

## Problem

The Zeabur PostgreSQL service exposes its linked connection as
`POSTGRES_URI`/`POSTGRES_CONNECTION_STRING`. The application only recognized
`DATABASE_URL`/`POSTGRES_URL`, so email/password authentication returned HTTP
500 after a clean deployment.

## Acceptance criteria

- Database initialization accepts all four supported PostgreSQL URL names.
- Server-side session helpers use the same environment resolution logic.
- Empty higher-priority variables fall through to a usable linked-service URL.
- Authentication no longer depends on an untracked local environment file.
