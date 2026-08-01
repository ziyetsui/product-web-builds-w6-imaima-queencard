# imaima queencard Implementation Tasks

## 元数据

- 工作流：`w6`
- 项目目录：`w6/ima ima queencard/`
- 前端应用目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/0007-imaima-queencard-implementation-tasks.md`
- 输入计划：`specs/w6/0005-imaima-queencard-implementation-plan.md`
- 输入评审：`specs/w6/0006-imaima-queencard-implementation-plan-review.md`
- 前置测试计划：`specs/w6/0004-imaima-queencard-test-safety-net.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-12`
- Artifact role：`implementation-tasks`
- 状态：等待执行

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md` 的手动 spec chain 公式：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

本文件命名为：

```text
specs/w6/0007-imaima-queencard-implementation-tasks.md
```

命名含义：

- `w6`：所属 workstream。
- `0007`：紧随 `0006-imaima-queencard-implementation-plan-review.md`。
- `imaima queencard`：当前项目名。
- `implementation-tasks`：可执行任务清单，供后续实现 Agent 逐项勾选。

## 输入与范围

**Input**: `0005` implementation plan + `0006` implementation plan review。

**本轮目标**：止血和收口。先建立最小测试安全网，再修复 Stripe-first billing、邮箱主路径登录、Admin credit API 保护、external generation bridge contract、DB baseline inspection，并补齐 Zeabur 登录/邮箱部署验收。

**本轮不做**：

- 不实现本地 AI image generation task。
- 不改 `credit_holds.videoUuid` 为通用 `taskUuid`。
- 不做完整 Dashboard / 会员中心。
- 不删除 Creem 全部代码和 legacy schema。
- 不重构 Prompt Library 数据结构和 122 个案例数据。

## Execution Log

- 2026-06-12: Started implementation from `w6/ima ima queencard` branch `main`.
- 2026-06-12: Initial git status showed project root entries as untracked:
  `.gitignore`, `AGENTS.md`, `CodeGuideline.md`, `README.md`, `backend/`,
  `docs/`, `frontend/`, `vendors/`.
- 2026-06-12: Completed T001-T019 safety-net checkpoint. Verification details:
  `w6/ima ima queencard/docs/refactor-verification.md`.
- 2026-06-12: Completed T020-T039 Stripe billing checkpoint. Verification:
  `pnpm test`, `pnpm run lint`, and `pnpm run build:prod` passed from
  `w6/ima ima queencard/frontend/`.
- 2026-06-12: Completed T040-T048 auth email-first checkpoint. Verification:
  `pnpm test`, `pnpm run lint`, and `pnpm run build:prod` passed from
  `w6/ima ima queencard/frontend/`.
- 2026-06-12: Completed T049-T055 admin guard locally and T056-T064 external
  bridge with a parallel worker, then added `prompts-bridge.test.ts` locally for
  T057 coverage. Integrated verification passed: `pnpm test`, `pnpm run lint`,
  and `pnpm run build:prod` from `w6/ima ima queencard/frontend/`.
- 2026-06-12: Migrated local env from `w5/goya/Goya/.env.local` into ignored
  `w6/ima ima queencard/frontend/.env.local`, keeping email login as the main path and
  Google disabled locally. Completed T065-T066 and T071 command/HTTP
  verification. T072-T073 visual desktop/mobile smoke remain pending because
  the in-app Browser tab timed out.
- 2026-06-13: Added Zeabur login/email deployment readiness scope. New US7
  tasks require operator Zeabur session verification, Zeabur Email/ZSend env
  configuration, and production/previews magic link smoke evidence without
  recording secrets.

## User Stories

### US1 - Maintainer Can Refactor Safely (Priority: P1)

维护者可以在改业务逻辑前运行最小测试安全网，确认 env normalization、`tryUrl`、checkout button 的旧行为被锁住。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm test
```

### US2 - Paying User Can Complete Stripe Billing Path (Priority: P1)

已登录用户可以从 `/pricing` 发起 Stripe checkout，支付后返回存在页面，webhook 能按事件类型同步 Customer/subscription/plan，portal 不因缺少 `stripeCustomerId` 500。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm test -- --run stripe billing webhook
pnpm run build:prod
```

### US3 - User Can Register/Login With Email First (Priority: P1)

用户在 `/login` 和 `/register` 都能使用普通邮箱 magic link 注册/登录；Google OAuth 只作为可选入口，不能替代或弱化邮箱入口。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm test -- --run auth
pnpm run build:prod
```

### US4 - Admin Credit API Is Production-Safe (Priority: P1)

测试加积分接口在 production 默认不可见，只有 debug/admin 条件满足时可用，并且 invalid credits 不写入数据库。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm test -- --run admin credits
```

### US5 - Prompt User Can Use External Generation Bridge (Priority: P2)

用户从首页或 `/prompts` 点击生成时仍跳转外部 `https://imaimaqueencard.com/generated`，URL 参数兼容旧字段，同时带非敏感 source metadata，UI 不暗示本地扣积分生成。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm test -- --run tryUrl
pnpm run build:prod
```

### US6 - Operator Can Verify Baseline And Smoke QA (Priority: P2)

操作者可以复现 lint/build/test，确认 schema baseline 状态，并完成 desktop/mobile smoke QA。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm test
pnpm run lint
pnpm run build:prod
```

### US7 - Operator Can Deploy On Zeabur With Email Auth (Priority: P1)

操作者可以确认 Zeabur 登录状态、目标 project/service、生产 URL 和邮箱 provider 配置，并在 Zeabur 生产/预览域名上完成 `/login` 与 `/register` 的真实 magic link 登录 smoke。

Independent test：

```bash
cd w6/ima ima queencard/frontend
pnpm run build:prod
```

Manual Zeabur smoke：

```text
Open https://<zeabur-domain>/login
Submit a real email address
Verify magic link email delivery
Open the magic link
Confirm authenticated session and /credits user email
Repeat the email-submit path from /register
```

## Phase 1: Setup

**Purpose**: 准备测试框架和实施边界。本阶段只改测试/配置/文档，不改业务行为。

- [X] T001 Inspect current git state and record branch/status in `specs/w6/0007-imaima-queencard-implementation-tasks.md`
- [X] T002 Add Vitest and Testing Library dev dependencies and scripts in `w6/ima ima queencard/frontend/package.json`
- [X] T003 Update lockfile after test dependency install in `w6/ima ima queencard/frontend/pnpm-lock.yaml`
- [X] T004 Create Vitest config in `w6/ima ima queencard/frontend/vitest.config.ts`
- [X] T005 [P] Create shared test setup in `w6/ima ima queencard/frontend/src/test/setup.ts`
- [X] T006 [P] Create test fixtures directory with README in `w6/ima ima queencard/frontend/src/test/fixtures/README.md`

**Checkpoint**: `pnpm test` exists and can run, even before full test coverage is added.

## Phase 2: Foundational

**Purpose**: 阻塞所有业务改动的前置任务。完成后才能进入 user story phases。

- [X] T007 Add env boolean normalization helper in `w6/ima ima queencard/frontend/src/config/env-flags.ts`
- [X] T008 Add tests for `IS_DEBUG`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, and boolean parsing in `w6/ima ima queencard/frontend/src/config/env-flags.test.ts`
- [X] T009 Update billing provider normalization to default Stripe and fail fast for invalid values in `w6/ima ima queencard/frontend/src/config/billing-provider.ts`
- [X] T010 Add billing provider normalization tests in `w6/ima ima queencard/frontend/src/config/billing-provider.test.ts`
- [X] T011 Update env schema for public Google flag and debug flag usage in `w6/ima ima queencard/frontend/src/lib/auth/env.mjs`
- [X] T012 Run DB baseline inspection and record result/blocker in `w6/ima ima queencard/docs/db-migration-baseline.md`
- [X] T013 Run baseline lint/build/test commands and record blocker notes in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: env normalization and DB baseline inspection are known before touching payment/auth/admin logic.

## Phase 3: US1 - Maintainer Can Refactor Safely (Priority: P1)

**Goal**: 最小测试安全网可运行，保护本轮高风险改造。

**Independent Test**: `cd w6/ima ima queencard/frontend && pnpm test`

### Tests for US1

- [X] T014 [P] [US1] Add characterization tests for `buildPromptTryUrl` in `w6/ima ima queencard/frontend/src/lib/tryUrl.test.ts`
- [X] T015 [P] [US1] Add minimum CheckoutButton tests for empty `planId` and 401 redirect in `w6/ima ima queencard/frontend/src/components/common/checkout-button.test.tsx`
- [X] T016 [P] [US1] Add smoke test for pricing plan render and empty price disabled state in `w6/ima ima queencard/frontend/src/app/pricing/pricing-page.test.tsx`

### Implementation for US1

- [X] T017 [US1] Make only test-safe exports needed by `tryUrl` tests in `w6/ima ima queencard/frontend/src/lib/tryUrl.ts`
- [X] T018 [US1] Adjust CheckoutButton testability without changing runtime behavior in `w6/ima ima queencard/frontend/src/components/common/checkout-button.tsx`
- [X] T019 [US1] Run `pnpm test` from `w6/ima ima queencard/frontend` and record result in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: 业务改造开始前，US1 tests 必须通过或记录明确 blocker。

## Phase 4: US2 - Paying User Can Complete Stripe Billing Path (Priority: P1)

**Goal**: Stripe-first billing 主路径可用，checkout return/webhook/customer/portal 全部收口。

**Independent Test**: checkout URL、portal guard、webhook fixture tests 可单独跑通。

### Tests for US2

- [X] T020 [P] [US2] Add tests for Stripe checkout success/cancel URL and portal guard in `w6/ima ima queencard/frontend/src/services/billing.test.ts`
- [X] T021 [P] [US2] Add webhook fixtures for checkout/invoice/subscription events in `w6/ima ima queencard/frontend/src/test/fixtures/stripe-events.ts`
- [X] T022 [P] [US2] Add webhook handler tests for checkout then invoice in `w6/ima ima queencard/frontend/src/payment/webhooks.test.ts`
- [X] T023 [P] [US2] Add webhook handler tests for invoice before checkout and repeated invoice delivery in `w6/ima ima queencard/frontend/src/payment/webhooks.test.ts`
- [X] T024 [P] [US2] Add webhook handler tests for metadata missing but `stripeCustomerId` matched in `w6/ima ima queencard/frontend/src/payment/webhooks.test.ts`
- [X] T025 [P] [US2] Add webhook handler tests for subscription deleted downgrade to FREE in `w6/ima ima queencard/frontend/src/payment/webhooks.test.ts`

### Implementation for US2

- [X] T026 [US2] Gate Creem plugin by active billing provider in `w6/ima ima queencard/frontend/src/lib/auth/auth.ts`
- [X] T027 [US2] Render provider mismatch state and checkout query messages in `w6/ima ima queencard/frontend/src/app/pricing/page.tsx`
- [X] T028 [US2] Ensure checkout creates or reuses local Customer before Stripe session in `w6/ima ima queencard/frontend/src/services/billing.ts`
- [X] T029 [US2] Change checkout success URL to include `{CHECKOUT_SESSION_ID}` in `w6/ima ima queencard/frontend/src/services/billing.ts`
- [X] T030 [US2] Change checkout cancel and portal return URLs to existing `/pricing` query states in `w6/ima ima queencard/frontend/src/services/billing.ts`
- [X] T031 [US2] Add Stripe portal guard requiring provider Stripe, non-FREE plan, and `stripeCustomerId` in `w6/ima ima queencard/frontend/src/services/billing.ts`
- [X] T032 [US2] Add customer lookup/upsert helpers for auth user id, Stripe customer id, and subscription id in `w6/ima ima queencard/frontend/src/services/customer.ts`
- [X] T033 [US2] Split Stripe webhook handling by event type in `w6/ima ima queencard/frontend/src/payment/webhooks.ts`
- [X] T034 [US2] Implement `checkout.session.completed` Customer/subscription sync in `w6/ima ima queencard/frontend/src/payment/webhooks.ts`
- [X] T035 [US2] Implement `invoice.payment_succeeded` resolution via metadata first, then `stripeCustomerId` in `w6/ima ima queencard/frontend/src/payment/webhooks.ts`
- [X] T036 [US2] Implement `customer.subscription.updated` and `customer.subscription.deleted` handling in `w6/ima ima queencard/frontend/src/payment/webhooks.ts`
- [X] T037 [US2] Make Stripe webhook GET return non-success while keeping POST handling in `w6/ima ima queencard/frontend/src/app/api/webhooks/stripe/route.ts`
- [X] T038 [US2] Update Stripe checkout route error shape for structured failures in `w6/ima ima queencard/frontend/src/app/api/billing/stripe/checkout/route.ts`
- [X] T039 [US2] Run Stripe-focused tests and record result in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: US2 can be validated without implementing auth UI/admin/bridge changes.

## Phase 5: US3 - User Can Register/Login With Email First (Priority: P1)

**Goal**: 邮箱 magic link 始终是 `/login` 和 `/register` 的主路径，Google 只是可选入口。

**Independent Test**: Google disabled/enabled 下，邮箱入口都可见、可提交。

### Tests for US3

- [X] T040 [P] [US3] Add Auth Form tests for email input validation and magic link success/failure in `w6/ima ima queencard/frontend/src/components/common/user-auth-form.test.tsx`
- [X] T041 [P] [US3] Add Auth Form tests for Google disabled hiding button/divider while email remains visible in `w6/ima ima queencard/frontend/src/components/common/user-auth-form.test.tsx`
- [X] T042 [P] [US3] Add Auth Form tests for Google enabled keeping email visible and showing Google button in `w6/ima ima queencard/frontend/src/components/common/user-auth-form.test.tsx`

### Implementation for US3

- [X] T043 [US3] Read normalized public Google flag in `w6/ima ima queencard/frontend/src/components/common/user-auth-form.tsx`
- [X] T044 [US3] Hide Google button and social divider when Google disabled in `w6/ima ima queencard/frontend/src/components/common/user-auth-form.tsx`
- [X] T045 [US3] Add Google sign-in failure toast while preserving email magic link submit in `w6/ima ima queencard/frontend/src/components/common/user-auth-form.tsx`
- [X] T046 [US3] Require Google server credentials only when Google public flag is true in `w6/ima ima queencard/frontend/src/lib/auth/auth.ts`
- [X] T047 [US3] Confirm `/login` and `/register` use email magic link without adding password fields in `w6/ima ima queencard/frontend/src/app/login/page.tsx` and `w6/ima ima queencard/frontend/src/app/register/page.tsx`
- [X] T048 [US3] Run auth-focused tests and record result in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: Google config cannot remove or block ordinary email registration/login.

## Phase 6: US4 - Admin Credit API Is Production-Safe (Priority: P1)

**Goal**: Admin test credit route is hidden in production unless debug is explicitly enabled.

**Independent Test**: production + `IS_DEBUG=false` returns 404; invalid credits returns 400; non-admin returns 403.

### Tests for US4

- [X] T049 [P] [US4] Add Admin credit API tests for production disabled 404 in `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.test.ts`
- [X] T050 [P] [US4] Add Admin credit API tests for invalid credits 400 and no write in `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.test.ts`
- [X] T051 [P] [US4] Add Admin credit API tests for non-admin 403 in `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.test.ts`

### Implementation for US4

- [X] T052 [US4] Add production/debug guard before `requireAdmin` in `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts`
- [X] T053 [US4] Return real 400 response for invalid credits in `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts`
- [X] T054 [US4] Ensure successful response returns `packageId`, `targetUserId`, and `credits` in `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts`
- [X] T055 [US4] Run admin API tests and record result in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: Production cannot expose test credit mutation by default.

## Phase 7: US5 - Prompt User Can Use External Generation Bridge (Priority: P2)

**Goal**: `tryUrl` contract is explicit, compatible, and does not imply local credit consumption.

**Independent Test**: `buildPromptTryUrl` tests pass; `/prompts` links still open external generated URL.

### Tests for US5

- [X] T056 [P] [US5] Extend `tryUrl` tests for `source_case_id`, `source_case_category`, `source_note_url`, and `source_author_url` in `w6/ima ima queencard/frontend/src/lib/tryUrl.test.ts`
- [X] T057 [P] [US5] Add Prompt Library bridge test for case metadata mapping in `w6/ima ima queencard/frontend/src/app/prompts/prompts-bridge.test.ts`

### Implementation for US5

- [X] T058 [US5] Add external generation contract comment to `w6/ima ima queencard/frontend/src/lib/tryUrl.ts`
- [X] T059 [US5] Extend `PromptTryUrlOptions` with non-sensitive source metadata in `w6/ima ima queencard/frontend/src/lib/tryUrl.ts`
- [X] T060 [US5] Preserve old generated URL parameters while appending source metadata in `w6/ima ima queencard/frontend/src/lib/tryUrl.ts`
- [X] T061 [US5] Pass prompt case id/category/note/author metadata from `w6/ima ima queencard/frontend/src/app/prompts/page.tsx`
- [X] T062 [US5] Update landing CTA copy only if it implies local credit consumption in `w6/ima ima queencard/frontend/src/components/landing/HeroSection.tsx`
- [X] T063 [US5] Update final CTA copy only if it implies local credit consumption in `w6/ima ima queencard/frontend/src/components/landing/FinalCta.tsx`
- [X] T064 [US5] Run bridge tests and record result in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: External generation bridge remains backward compatible.

## Phase 8: US6 - Operator Can Verify Baseline And Smoke QA (Priority: P2)

**Goal**: 完成 migration baseline 决策、README 更新和本地 smoke QA。

**Independent Test**: lint/build/test + desktop/mobile smoke checklist complete.

### Tests for US6

- [X] T065 [P] [US6] Run full test suite and record output summary in `w6/ima ima queencard/docs/refactor-verification.md`
- [X] T066 [P] [US6] Run lint and build commands and record output summary in `w6/ima ima queencard/docs/refactor-verification.md`

### Implementation for US6

- [X] T067 [US6] Generate Drizzle migration baseline or document why it is deferred in `w6/ima ima queencard/docs/db-migration-baseline.md`
- [X] T068 [US6] If generated, add migration files under `w6/ima ima queencard/frontend/src/db/migrations/`
- [X] T069 [US6] Update run/test/db instructions in `w6/ima ima queencard/README.md`
- [X] T070 [US6] Update frontend-specific run/test/db instructions in `w6/ima ima queencard/frontend/README.md` if that file exists, otherwise keep the root README as source of truth
- [X] T071 [US6] Start dev server from `w6/ima ima queencard/frontend` and verify `http://localhost:8080`
- [ ] T072 [US6] Smoke test `/`, `/prompts`, `/pricing`, `/login`, `/register`, and `/credits` on desktop viewport and record result in `w6/ima ima queencard/docs/refactor-verification.md`
- [ ] T073 [US6] Smoke test `/`, `/prompts`, `/pricing`, `/login`, `/register`, and `/credits` on mobile viewport and record result in `w6/ima ima queencard/docs/refactor-verification.md`

**Checkpoint**: This phase produces the evidence needed for implementation code review.

## Phase 9: US7 - Operator Can Deploy On Zeabur With Email Auth (Priority: P1)

**Goal**: Zeabur deployment readiness is explicit: operator session, target service, env vars, production URL, and magic link delivery are verified before handoff.

**Independent Test**: Zeabur login/session evidence exists; `/login` and `/register` can send magic links through Zeabur Email/ZSend or a documented fallback provider.

### Tests for US7

- [X] T074 [P] [US7] Verify Zeabur operator login/session and target project/service access, then record non-secret evidence in `w6/ima ima queencard/docs/refactor-verification.md`
- [X] T075 [P] [US7] Document required Zeabur deployment env vars in `w6/ima ima queencard/README.md`: `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_SECRET`, `EMAIL_PROVIDER=zeabur`, `ZEABUR_EMAIL_API_KEY`, `ZEABUR_EMAIL_FROM`, optional `ZEABUR_EMAIL_API_URL`, Stripe vars, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, `ADMIN_EMAIL`, and `IS_DEBUG=false`
- [X] T076 [P] [US7] Confirm app email code path supports Zeabur Email/ZSend through `w6/ima ima queencard/frontend/src/lib/email.ts` and `w6/ima ima queencard/frontend/src/lib/auth/env.mjs`, documenting any gap instead of writing secrets to repo

### Implementation for US7

- [ ] T077 [US7] Configure Zeabur service environment variables for production/preview, ensuring secrets stay only in Zeabur and `NEXT_PUBLIC_APP_URL` matches the deployed URL
- [ ] T078 [US7] Restart or redeploy the Zeabur frontend service after env changes and record the deployment URL in `w6/ima ima queencard/docs/refactor-verification.md`
- [ ] T079 [US7] Smoke test `/login` on the Zeabur URL with a real mailbox; verify magic link delivery, callback domain, session creation, and `/credits` authenticated state
- [ ] T080 [US7] Smoke test `/register` on the Zeabur URL with a real mailbox; verify the same email-submit path and first-login registration behavior
- [ ] T081 [US7] Record Zeabur email/auth smoke results, selected sender/from domain, and any DNS/provider blockers in `w6/ima ima queencard/docs/refactor-verification.md` without including magic links or secrets

**Checkpoint**: Production handoff is not complete until Zeabur login/session, env, and email magic link delivery are verified.

## Final Phase: Polish And Handoff

**Purpose**: 收口文档、清理风险和准备 review。

- [X] T082 Update `specs/w6/0005-imaima-queencard-implementation-plan.md` with accepted `0006` review corrections if not already reflected in implementation notes
- [X] T083 [P] Update `specs/w6/0004-imaima-queencard-test-safety-net.md` with any tests deferred during implementation
- [X] T084 [P] Add implementation notes and known blockers to `w6/ima ima queencard/docs/refactor-verification.md`
- [X] T085 Run final `git status --short` and list changed files in `w6/ima ima queencard/docs/refactor-verification.md`
- [X] T086 Prepare next review document `specs/w6/0008-imaima-queencard-code-review.md`

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 Setup
-> Phase 2 Foundational
-> Phase 3 US1 Safety Net
-> Phase 4 US2 Stripe Billing
-> Phase 5 US3 Email/Auth
-> Phase 6 US4 Admin Guard
-> Phase 7 US5 External Bridge
-> Phase 8 US6 Baseline/Smoke
-> Phase 9 US7 Zeabur Auth/Email
-> Final Phase Polish/Handoff
```

### Blocking Rules

- Do not modify Stripe webhook business logic before T014-T019 are complete.
- Do not implement provider gate before T007-T011 are complete.
- Do not expose Admin credit changes before T049-T055 are complete.
- Do not modify prompt case data or `public/xhs-cases/**` in this round.
- Do not add password login fields; email login/register is Better Auth magic link.
- Do not remove Creem or legacy schema in this round.
- Do not mark production deployment ready before Zeabur login/session, `NEXT_PUBLIC_APP_URL`, and email provider smoke are verified.

### Parallel Opportunities

- T005-T006 can run in parallel after T002-T004.
- T014-T016 can run in parallel after Phase 2.
- T020-T025 can run in parallel before T026-T039.
- T040-T042 can run in parallel before T043-T048.
- T049-T051 can run in parallel before T052-T055.
- T056-T057 can run in parallel before T058-T064.
- T065-T066 can run in parallel during final verification.
- T074-T076 can run in parallel once the Zeabur target service is known.

## Parallel Examples

### Stripe Story

```text
Task: T020 Add billing service tests
Task: T021 Add Stripe event fixtures
Task: T022 Add checkout then invoice webhook test
Task: T023 Add invoice before checkout and repeated invoice tests
Task: T024 Add metadata missing fallback test
Task: T025 Add subscription deleted test
```

### Auth Story

```text
Task: T040 Add email magic link tests
Task: T041 Add Google disabled tests
Task: T042 Add Google enabled tests
```

### Bridge Story

```text
Task: T056 Extend tryUrl metadata tests
Task: T057 Add prompt bridge metadata mapping test
```

### Zeabur Story

```text
Task: T074 Verify Zeabur operator login/session
Task: T075 Document Zeabur deployment env vars
Task: T076 Confirm Zeabur Email/ZSend code path
```

## Implementation Strategy

### MVP First

MVP is Phase 1 + Phase 2 + US1 + the smallest Stripe path:

```text
T001-T019
T020-T021
T026-T031
T039
```

This gets the repo into a safer state and fixes the most visible payment return/portal issues before the full webhook refactor.

### Recommended Incremental Delivery

1. Complete Setup/Foundation.
2. Complete US1 safety net.
3. Complete US2 Stripe return URL + portal guard.
4. Complete US2 webhook fixture and handler split.
5. Complete US3 email-first auth UI.
6. Complete US4 admin guard.
7. Complete US5 bridge contract.
8. Complete US6 verification and handoff.
9. Complete US7 Zeabur login/email smoke before final handoff.

### Review Cadence

Stop for review after:

- T019: safety net established.
- T031: Stripe return URL and portal guard complete.
- T039: webhook handlers complete.
- T048: auth email/Google behavior complete.
- T073: smoke QA complete.
- T081: Zeabur email auth smoke complete.

## Format Validation

- Total tasks: 86.
- Setup tasks: 6.
- Foundational tasks: 7.
- US1 tasks: 6.
- US2 tasks: 20.
- US3 tasks: 9.
- US4 tasks: 7.
- US5 tasks: 9.
- US6 tasks: 9.
- US7 tasks: 8.
- Final/handoff tasks: 5.
- All tasks use checkbox + sequential ID.
- All user story tasks include `[USx]`.
- Parallelizable tasks use `[P]`.
- Each task references an exact file or command evidence target.
