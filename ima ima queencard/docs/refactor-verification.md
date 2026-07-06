# imaima queencard Refactor Verification

## Metadata

- Date: 2026-06-12
- App root: `w6/ima ima queencard/frontend/`
- Task source: `specs/w6/0007-imaima-queencard-implementation-tasks.md`
- Current checkpoint: T001-T064

## Git Baseline

Command:

```bash
git -C w6/ima ima queencard status --short
git -C w6/ima ima queencard branch --show-current
```

Result:

```text
branch: main
status: project files are currently untracked at repo root
```

Observed untracked root entries:

```text
.gitignore
AGENTS.md
CodeGuideline.md
README.md
backend/
docs/
frontend/
vendors/
```

No existing user changes were reverted.

## DB Baseline Inspection

See:

```text
w6/ima ima queencard/docs/db-migration-baseline.md
```

Summary:

- `drizzle-kit generate` has no dry-run flag in the installed version.
- No migration was generated during T012.
- Formal migration baseline decision is deferred to T067.

## Verification Commands

### Test

Command:

```bash
pnpm test
```

Result:

```text
5 test files passed
16 tests passed
```

### Lint

Command:

```bash
pnpm run lint
```

Result:

```text
passed
```

### Production Build

Command:

```bash
pnpm run build:prod
```

Result:

```text
passed
```

Known warning:

```text
BetterAuthError: You are using the default secret. Please set BETTER_AUTH_SECRET.
```

This warning existed before this checkpoint and does not currently fail the
build. It should be fixed before production deployment by setting
`BETTER_AUTH_SECRET`.

## T017/T018 Notes

- T017 required test-safe exports for `tryUrl` only if needed. No additional
  runtime export was needed because `buildPromptTryUrl` and `DEFAULT_TRY_URL`
  were already public.
- T018 required CheckoutButton testability adjustments only if needed. No
  runtime change was needed; tests use public UI behavior and mocked
  `next/navigation`.

## T020-T039 Stripe Billing Checkpoint

Implemented:

- Stripe checkout success URL now returns to:

```text
/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}
```

- Stripe cancel URL now returns to:

```text
/pricing?checkout=cancelled
```

- Stripe billing portal return URL now returns to:

```text
/pricing?billing=return
```

- Paid-plan portal creation now requires an existing `stripeCustomerId`.
- Checkout now calls `ensureCustomer(userId)` before creating Stripe sessions.
- Existing `stripeCustomerId` is reused for checkout sessions.
- Creem auth plugin is gated by active billing provider.
- Stripe webhook handler is split by event type:
  - `checkout.session.completed`
  - `invoice.payment_succeeded`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Stripe webhook `GET` now returns `405`.
- Pricing page renders checkout/billing query messages.

Added tests:

```text
frontend/src/services/billing.test.ts
frontend/src/payment/webhooks.test.ts
frontend/src/test/fixtures/stripe-events.ts
```

Verification after T039:

```text
pnpm test           passed: 7 files / 25 tests
pnpm run lint       passed
pnpm run build:prod passed
```

Note:

- Stripe MCP was not used for this checkpoint because the current work is
  fixture/code-level verification and the active Codex tool list did not expose
  a callable Stripe MCP tool.

## T040-T048 Auth Email-First Checkpoint

Implemented:

- `/login` and `/register` continue to use the shared email magic link form.
- No password field was added.
- Google OAuth is hidden when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` is not `"true"`.
- Email input and magic link submit remain visible when Google is disabled.
- Email input and magic link submit remain visible when Google is enabled.
- Google sign-in failure now shows:

```text
Google 登录暂不可用
请使用邮箱登录。
```

- Server auth now requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only
  when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
- Site config default auth provider is now email.

Added tests:

```text
frontend/src/components/common/user-auth-form.test.tsx
```

Verification after T048:

```text
pnpm test           passed: 8 files / 31 tests
pnpm run lint       passed
pnpm run build:prod passed
```

## T049-T055 Admin Guard Checkpoint

Implemented:

- Admin credit API returns `404` in production unless `IS_DEBUG=true`.
- Production disabled guard runs before admin auth, so the test route is hidden.
- Invalid `credits` now returns a real `400` error response.
- Non-admin users return `403`.
- Success response now includes `packageId`, `targetUserId`, and `credits`.

Added tests:

```text
frontend/src/app/api/v1/admin/credits/add/route.test.ts
```

## T056-T064 External Bridge Checkpoint

Implemented with a parallel worker, then verified and supplemented locally:

- `tryUrl.ts` now documents the external generation bridge contract.
- `buildPromptTryUrl` supports non-sensitive source metadata.
- New query params:
  - `source_case_id`
  - `source_case_category`
  - `source_note_url`
  - `source_author_url`
- Existing generated URL params remain compatible.
- Prompt Library generation links now pass case id/category/note/author metadata.
- Source URLs are sanitized to remove query/hash when sent as source metadata.
- `prompts-bridge.test.ts` verifies prompt case metadata mapping.

Changed files:

```text
frontend/src/lib/tryUrl.ts
frontend/src/lib/tryUrl.test.ts
frontend/src/app/prompts/page.tsx
frontend/src/app/prompts/prompts-bridge.test.ts
```

## Verification After T064

Command:

```bash
pnpm test
pnpm run lint
pnpm run build:prod
```

Result:

```text
pnpm test           passed: 10 files / 38 tests
pnpm run lint       passed
pnpm run build:prod passed
```

Known warning remains:

```text
BetterAuthError: You are using the default secret. Please set BETTER_AUTH_SECRET.
```

## Login Send Failure Fix

Issue observed:

```text
Email magic link submit showed "发送失败".
```

Root cause found locally:

```text
frontend/.env.local missing
RESEND_API_KEY missing
RESEND_FROM missing
```

Fix:

- In non-production environments, missing Resend config no longer fails the
  magic link request.
- Instead, the auth server prints the magic link to the dev server terminal.
- In production, missing Resend config still fails because real email delivery
  must be configured.

Developer flow:

```text
Submit email on /login or /register
-> UI shows success
-> Read the dev server terminal
-> Open the printed magic link
```

Production requirements:

```text
BETTER_AUTH_SECRET
RESEND_API_KEY
RESEND_FROM
NEXT_PUBLIC_APP_URL
```

Verification after fix:

```text
pnpm test           passed: 10 files / 38 tests
pnpm run lint       passed
pnpm run build:prod passed
```

## Local Env Migration From W5

Issue:

```text
w6/ima ima queencard/frontend/.env.local did not exist.
w5/goya/Goya/.env.local already contained working local provider settings.
```

Decision:

- Created ignored local env file at `frontend/.env.local`.
- Copied only runtime-needed values from `w5/goya/Goya/.env.local`.
- Overrode app/auth origin to local dev:

```text
NEXT_PUBLIC_APP_URL=http://localhost:8080
BETTER_AUTH_URL=http://localhost:8080
BETTER_AUTH_BASE_URL=http://localhost:8080
```

- Kept email as the main login path by migrating:

```text
DATABASE_URL
BETTER_AUTH_SECRET
RESEND_API_KEY
RESEND_FROM
ADMIN_EMAIL
```

- Kept Google hidden locally:

```text
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- Kept Stripe as active billing provider and migrated available Stripe values.
- Disabled Creem by omitting `CREEM_API_KEY` and `CREEM_WEBHOOK_SECRET`.

Important env schema note:

```text
CREEM_API_KEY='' fails validation because the schema means:
unset OR non-empty string.
```

So Creem must be disabled by leaving the key unset, not by setting an empty
value. `frontend/.env.example` was updated to reflect this.

Verification after local env migration:

```text
pnpm test           passed: 10 files / 38 tests
pnpm run lint       passed
pnpm run build:prod passed with .env.local
```

## T065-T066 Final Command Verification

Command:

```bash
pnpm test
pnpm run lint
pnpm run build:prod
```

Result:

```text
pnpm test           passed: 10 files / 38 tests
pnpm run lint       passed
pnpm run build:prod passed with .env.local
```

## T071 Local Dev Server Verification

Port check:

```text
localhost:8080 is served by next-server v16.2.7
cwd: w6/ima ima queencard/frontend
```

HTTP smoke:

```text
/         200
/prompts 200
/pricing 200
/login   200
/register 200
/credits 200
```

Login page read-only check:

```text
/login fetched successfully
email entry present: yes
Google entry hidden with NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false: yes
```

Note:

- Browser visual smoke could not be completed in this pass because the in-app
  Browser tab timed out while loading. Treat T072/T073 desktop/mobile visual
  checks as still pending.

## T067-T070 DB And README Handoff

Project path note:

```text
Previous spec path: w6/ima ima queencard/
Current local path: w6/ima ima queencard/
```

DB baseline:

```bash
pnpm run db:generate
```

Result:

```text
failed: Missing DATABASE_URL/POSTGRES_URL env var
```

Reason:

```text
drizzle.config.ts imports dotenv/config, which loads .env but not .env.local.
```

Successful baseline generation:

```bash
pnpm exec dotenv -e .env.local -- drizzle-kit generate
```

Result:

```text
15 tables
src/db/migrations/0000_smart_lord_tyger.sql generated
```

Generated files:

```text
frontend/src/db/migrations/0000_smart_lord_tyger.sql
frontend/src/db/migrations/meta/0000_snapshot.json
frontend/src/db/migrations/meta/_journal.json
```

No database migration was applied. The SQL is an initial schema baseline that
keeps the inherited legacy tables.

Docs updated:

```text
README.md
frontend/.env.example
docs/db-migration-baseline.md
```

`frontend/README.md` does not exist, so the root README remains the source of
truth for run/test/db instructions.

## T072-T073 Local Smoke Status

Local production server:

```bash
pnpm run start
```

HTTP smoke:

```text
/          200
/prompts   200
/pricing   200
/login     200
/register  200
/credits   307 -> /login?from=/credits
```

Read-only HTML checks:

```text
/login     email entry present: yes
/register  email entry present: yes
/prompts   external generated links present: yes
/          external generated links present: yes
```

Visual smoke attempts:

- In-app Browser: connected, but repeated navigation/evaluate calls timed out.
- Next dev server during Browser testing: routes returned 200, but Turbopack
  repeatedly logged `Failed to write app endpoint ... Next.js package not found`.
- Chrome headless fallback: produced a valid desktop home screenshot, then
  timed out on subsequent pages in this environment.

Valid screenshot artifacts:

```text
docs/smoke-screenshots/desktop-home.png
docs/smoke-screenshots/desktop-prompts.png
docs/smoke-screenshots/desktop-pricing.png
```

Conclusion:

- HTTP and build-level smoke passed.
- Desktop visual smoke is partially covered by screenshots for `/`, `/prompts`,
  and `/pricing`.
- `/login`, `/register`, and `/credits` desktop rendering were covered by HTTP
  checks only.
- Mobile visual smoke remains a follow-up because both browser automation
  surfaces were unstable in this environment.

## T074-T081 Zeabur Readiness Status

Zeabur auth status:

```text
logged in: yes
account email: xczvsdf189@gmail.com
plan: DEVELOPER
credit: $5.01
```

Zeabur Email/ZSend status:

```text
status: healthy
daily quota: 100
daily sent: 4
monthly quota: 3000
monthly sent: 4
```

Verified sender/domain state:

```text
imaimaqueencard.com  verified
imaimaqueencard.com    pending
```

Email API key state:

```text
imaima-queencard-production  send_only key exists
```

Current Zeabur project:

```text
project: goya-ai
project id: 69d7ada8df52fa5684fb1aee
```

Services discovered:

```text
goya-ai-corry
users-ziye-downloads-projects-streamify-xhsgrowth-main
users-ziye-downloads-projects-streamify-xhsgrowth-main-backend
xhs-backend
```

Likely frontend service:

```text
service: goya-ai-corry
service id: 69d7b169df52fa5684fb1c51
domain: goya-ai.zeabur.app
deployment repo: ziyeprompttheworld/goya-aivideo-generator
current deployed title: Goya.ai
```

Important blocker:

```text
No Zeabur service currently matches the local imaima queencard project.
The closest service is an older Goya deployment, so no production variables
were changed and no service was restarted.
```

Deployment variable gap on the likely frontend service:

```text
EMAIL_PROVIDER is not present
ZEABUR_EMAIL_API_KEY is not present
ZEABUR_EMAIL_FROM is not present
RESEND_API_KEY and RESEND_FROM are present
```

Code support:

```text
frontend/src/lib/email.ts supports EMAIL_PROVIDER=zeabur and defaults to
https://api.zeabur.com/api/v1/zsend/emails.

frontend/src/lib/auth/env.mjs includes EMAIL_PROVIDER, ZEABUR_EMAIL_API_KEY,
ZEABUR_EMAIL_FROM, and ZEABUR_EMAIL_API_URL.
```

Production smoke:

```text
https://goya-ai.zeabur.app/login    200  title: Login | Goya.ai
https://goya-ai.zeabur.app/register 200  title: Create an account | Goya.ai
```

Conclusion:

- T074 evidence is available.
- T075 docs were added to README.
- T076 code path is confirmed.
- T077-T081 are blocked until the actual imaima queencard Zeabur service or
  deployment target is selected. No secrets, magic links, or API tokens were
  written to the repository.

## Final Verification - 2026-06-14

Commands:

```bash
pnpm test
pnpm run lint
pnpm run build:prod
```

Result:

```text
pnpm test           passed: 10 files / 42 tests
pnpm run lint       passed
pnpm run build:prod passed
```

Final git status:

```text
?? .gitignore
?? AGENTS.md
?? CodeGuideline.md
?? README.md
?? backend/
?? docs/
?? frontend/
?? vendors/
```

The project files are still untracked from the project-root repository
perspective, matching the initial baseline recorded at T001.

Key files changed or added during this continuation:

```text
README.md
docs/db-migration-baseline.md
docs/refactor-verification.md
docs/smoke-screenshots/desktop-home.png
docs/smoke-screenshots/desktop-pricing.png
docs/smoke-screenshots/desktop-prompts.png
frontend/.env.example
frontend/src/db/migrations/0000_smart_lord_tyger.sql
frontend/src/db/migrations/meta/0000_snapshot.json
frontend/src/db/migrations/meta/_journal.json
../../specs/w6/0004-imaima-queencard-test-safety-net.md
../../specs/w6/0005-imaima-queencard-implementation-plan.md
../../specs/w6/0007-imaima-queencard-implementation-tasks.md
../../specs/w6/0008-imaima-queencard-code-review.md
```
