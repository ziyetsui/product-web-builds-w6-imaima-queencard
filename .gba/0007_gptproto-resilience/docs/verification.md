# 验证记录

- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：通过。
- `pnpm test`：41 个测试文件通过，2 个跳过；267 个测试通过，7 个跳过。
- `pnpm build:prod`：通过。未提供本地 `BETTER_AUTH_SECRET` 时构建期间有既有 Better Auth 警告，不影响产物生成。
- 新增迁移：`0008_generation_provider_health.sql`。
