# Verification

- Unit tests cover URL precedence, whitespace, Zeabur aliases, and missing URLs.
- Run `pnpm vitest run src/db/config.test.ts`.
- Run `pnpm build`.
- After deployment, a sign-in request for a nonexistent diagnostic user must
  return an authentication rejection instead of HTTP 500.
