# imaima queencard Implementation Plan

## 元数据

- 工作流：`w6`
- 项目目录：`w6/ima ima queencard/`
- 前端应用目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/0005-imaima-queencard-implementation-plan.md`
- 来源方案：`specs/w6/0003-imaima-queencard-refactor-analysis.md`
- 前置测试计划：`specs/w6/0004-imaima-queencard-test-safety-net.md`
- 结构映射：`w6/ima ima queencard/docs/project-structure-map.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-12`
- Artifact role：`implementation-plan`
- 状态：已执行，收尾验证中

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md` 的手动 spec chain 公式：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

本文件命名为：

```text
specs/w6/0005-imaima-queencard-implementation-plan.md
```

命名含义：

- `w6`：所属 workstream。
- `0005`：当前 `specs/w6/` 已有 `0001-0004`，本文件顺延编号。
- `imaima queencard`：当前项目名。
- `implementation-plan`：把 `0003` 的 refactor analysis 转成可执行改造计划。

本项目当前采用 `specs/w6/000N-*` 的人工 spec chain，不使用 `specs/001-feature-slug/plan.md` 形式。

## 一句话策略

本轮改造是 **止血和收口**：先建立测试安全网，再修支付、登录、安全口、外部生成 bridge，并补齐 Zeabur 登录与邮箱交付验收；不在本轮实现本地生成闭环。

## 本轮范围

### 本轮必须完成

1. 建立测试安全网，确保后续改业务逻辑前有 characterization tests。
2. 收敛 Billing Provider 到 Stripe-first，并隔离 Creem runtime path。
3. 修复 Stripe checkout、return URL、webhook payload 处理、Customer 同步和 portal guard。
4. 修复登录可用性：普通邮箱注册/登录保持主路径，Google 只按配置作为可选入口显示。
5. 给 Admin credit API 加生产保护。
6. 固化 `tryUrl` external generation bridge contract。
7. 建立数据库 migration baseline，或明确记录暂缓原因。
8. 补齐 Zeabur 部署前置：操作者 Zeabur 登录状态、生产域名、环境变量和邮箱服务可用性。
9. 完成 lint、build、测试、Zeabur 邮箱登录 smoke 和手动 QA。

### 本轮明确不做

1. 不实现本地 AI image generation task。
2. 不把 `credit_holds.videoUuid` 改成通用 `taskUuid`。
3. 不做完整会员中心 / Dashboard。
4. 不深度重构 Prompt Library 和 122 个案例数据。
5. 不删除全部 Creem 代码和历史 schema。
6. 不迁出独立 `backend/` 服务。

## 当前结构映射

命令运行目录：

```text
w6/ima ima queencard/frontend/
```

当前没有独立后端服务。后端职责仍在 Next.js app 内：

```text
frontend/src/app/api/
frontend/src/services/
frontend/src/db/
frontend/src/payment/
frontend/src/lib/api/
frontend/src/lib/auth/
```

本轮所有运行时代码改动应发生在 `frontend/` 下；根目录 `backend/` 只作为未来边界保留。

重要真实路径：

```text
frontend/src/config/billing-provider.ts
frontend/src/lib/auth/auth.ts
frontend/src/lib/auth/env.mjs
frontend/src/lib/email.ts
frontend/src/app/pricing/page.tsx
frontend/src/components/common/checkout-button.tsx
frontend/src/components/common/user-auth-form.tsx
frontend/src/services/billing.ts
frontend/src/services/customer.ts
frontend/src/payment/webhooks.ts
frontend/src/app/api/webhooks/stripe/route.ts
frontend/src/app/api/v1/admin/credits/add/route.ts
frontend/src/lib/tryUrl.ts
frontend/src/components/landing/HeroSection.tsx
frontend/src/components/landing/FinalCta.tsx
frontend/src/app/prompts/page.tsx
frontend/src/app/credits/page.tsx
frontend/src/db/schema.ts
frontend/drizzle.config.ts
frontend/.env.example
frontend/package.json
w6/ima ima queencard/README.md
w6/ima ima queencard/docs/refactor-verification.md
```

## 执行前门禁

在改业务逻辑前必须完成：

1. 从 `w6/ima ima queencard/frontend/` 安装依赖：

```bash
pnpm install
```

2. 确认基线命令通过或记录现有 blocker：

```bash
pnpm run lint
pnpm run build:prod
```

3. 执行 `0004-imaima-queencard-test-safety-net.md`：

- 增加测试框架和必要配置。
- 增加第一批 characterization tests。
- 只允许测试和极小可测试性导出，不改业务行为。
- 新增测试必须在当前代码下通过。

4. 确认 git 基线：

```bash
git status --short
git branch --show-current
```

若工作树已有用户变更，不得回滚；只在自己的改动范围内继续。

## 技术上下文

| 项 | 当前选择 | 本轮处理 |
|---|---|---|
| App framework | Next.js 16 App Router | 保持 |
| UI | React 19, Tailwind, Radix/shadcn-style components | 保持 |
| Auth | Better Auth magic link as email login/register, optional Google, Creem plugin | 邮箱主路径不可被 Google 配置影响 |
| Email | Transactional email supports `zeabur` or `resend` provider | Zeabur Email/ZSend 作为生产优先路径，Resend 仅作为 fallback |
| Billing | Stripe + inherited Creem path | Stripe-first，Creem gate |
| Credits | Drizzle/Postgres credit ledger | 本轮只做安全和测试，不改通用 task 模型 |
| Generation | 外部 `https://imaimaqueencard.com/generated` | 固化 bridge contract |
| Deployment | Zeabur target environment | 部署前确认 Zeabur 登录、生产 URL、env vars 和 magic link delivery |
| Tests | 当前缺少稳定测试框架 | 加 Vitest / Testing Library |
| Database | Drizzle schema exists, migrations 不稳定 | 建 migration baseline 或记录暂缓 |

## 阶段计划

### Phase 0：基线和测试安全网

目标：

- 先锁住现状，避免后续重构破坏旧功能。

改动文件：

```text
frontend/package.json
frontend/vitest.config.ts
frontend/tests/**
frontend/src/**/*.test.ts
frontend/src/**/*.test.tsx
```

任务：

1. 增加 `test` / `test:watch` scripts。
2. 安装并配置 Vitest、Testing Library、jsdom 和 test setup。
3. 覆盖 `buildPromptTryUrl` characterization tests。
4. 覆盖 `CheckoutButton` 空 price id、401、成功 URL、失败 toast。
5. 覆盖 Pricing Page 的套餐渲染和空 price id disabled 行为。
6. 覆盖 Auth Form 的邮箱注册/登录入口、magic link 成功/失败提示。
7. 对已知 bug 使用 `test.todo` 或文档记录，不锁成旧正确行为。

验收：

```bash
pnpm test
pnpm run lint
pnpm run build:prod
```

回滚：

- 只回滚测试配置和测试文件，不动业务逻辑。

### Phase 1：Billing Provider 收口

目标：

- 默认 Stripe-first。
- Creem 不删除，但只有 provider 明确为 `creem` 时才启用。
- Pricing 不在 provider 不匹配时展示可点击的 Stripe checkout。

改动文件：

```text
frontend/src/config/billing-provider.ts
frontend/src/lib/auth/auth.ts
frontend/src/lib/auth/env.mjs
frontend/src/app/pricing/page.tsx
frontend/src/components/common/checkout-button.tsx
frontend/.env.example
```

任务：

1. 在 `billing-provider.ts` 增加 `normalizeBillingProvider`。
2. `NEXT_PUBLIC_BILLING_PROVIDER` 未设置时默认 `stripe`。
3. 非法 provider 在服务端 fail fast；前端只拿到安全枚举。
4. `auth.ts` 中 Creem plugin 增加 `isCreemProvider && env.CREEM_API_KEY` gate。
5. `pricing/page.tsx` 根据 provider 渲染 Stripe pricing 或 provider mismatch 状态。
6. 保留空 Stripe price id disabled 行为。
7. 更新 `.env.example`，明确 Creem only-if-provider-creem。

验收：

- `NEXT_PUBLIC_BILLING_PROVIDER=stripe` 时不会加载 Creem plugin。
- `NEXT_PUBLIC_BILLING_PROVIDER=creem` 时 Stripe checkout 不可触发。
- 非法 provider 有明确错误，不静默退回 Creem。
- 相关 unit tests 通过。

回滚：

- 可单独回滚 provider gating，不影响 magic link 登录。

### Phase 2：Stripe checkout、Customer 和 webhook 修复

目标：

- 付款后 Customer、plan、period、subscription 能稳定同步。
- return URL 不再指向不存在的 `/dashboard`。
- portal 不因缺少 `stripeCustomerId` 500。

改动文件：

```text
frontend/src/services/billing.ts
frontend/src/services/customer.ts
frontend/src/payment/webhooks.ts
frontend/src/payment/plans.ts
frontend/src/payment/subscriptions.ts
frontend/src/app/api/billing/stripe/checkout/route.ts
frontend/src/app/api/webhooks/stripe/route.ts
frontend/src/app/pricing/page.tsx
```

任务：

1. `createStripeSession(userId, planId)` 开始前调用 `ensureCustomer(userId)`。
2. checkout success URL 改为 `/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`。
3. checkout cancel URL 改为 `/pricing?checkout=cancelled`。
4. billing portal return URL 改为 `/pricing?billing=return`。
5. portal 创建条件必须同时满足：
   - provider 是 Stripe
   - plan 非 FREE
   - `stripeCustomerId` 存在
6. `webhooks.ts` 按 Stripe event type 拆 handler：
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
7. `invoice.payment_succeeded` 不读取 checkout session 字段。
8. webhook 找不到本地 Customer 时执行 upsert 或明确创建策略。
9. `pricing/page.tsx` 显示 checkout success/cancel/billing return 状态。

验收：

- checkout session 创建前本地 Customer 存在。
- webhook fixtures 覆盖 checkout、invoice、subscription updated、subscription deleted。
- `/pricing?checkout=success&session_id=...` 显示同步中/成功提示。
- billing portal 缺少 `stripeCustomerId` 时返回结构化错误，不 500。
- `pnpm test`、`pnpm run lint`、`pnpm run build:prod` 通过。

回滚：

- webhook handler 可单独回滚，但必须暂停生产 webhook 或保持旧 handler。
- return URL 可临时回到 `/pricing`。

### Phase 3：登录可用性修复

目标：

- 登录页只显示真实可用的 provider。
- 普通邮箱注册/登录保持主路径。
- Magic link 是当前邮箱注册/登录实现方式，本轮不改成密码登录。
- Google 失败给用户明确反馈。

改动文件：

```text
frontend/src/components/common/user-auth-form.tsx
frontend/src/lib/auth/auth.ts
frontend/src/lib/auth/env.mjs
frontend/.env.example
```

任务：

1. 将 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` 纳入前端可读 env schema。
2. false 时隐藏 Google button 和 social divider，但保留邮箱输入和 magic link submit。
3. true 时要求 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 同时存在，同时保留邮箱输入和 magic link submit。
4. 确保 `/login` 和 `/register` 都有普通邮箱注册/登录入口。
5. Google sign-in 失败时 toast：

```text
Google 登录暂不可用，请使用邮箱登录。
```

6. 保留 magic link 成功后的检查邮箱提示。

验收：

- Google disabled 时登录和注册页不显示 Google。
- Google disabled 时普通邮箱注册/登录仍可见、可提交。
- Google enabled 时普通邮箱注册/登录仍可见、可提交。
- Google enabled 但服务端配置缺失时有明确错误。
- Google sign-in rejected 时用户看到 toast。
- Magic link tests 保持通过。

回滚：

- 可只回滚 Google button 条件化，不影响 magic link。

### Phase 4：Admin Credit API 生产保护

目标：

- 测试加积分能力不默认暴露到生产。

改动文件：

```text
frontend/src/app/api/v1/admin/credits/add/route.ts
frontend/src/lib/api/auth.ts
frontend/src/lib/auth/admin.ts
frontend/src/lib/auth/env.mjs
frontend/.env.example
```

任务：

1. production 且未开启 debug 时返回 404。
2. 非 admin 返回 403。
3. invalid credits 返回 400，不写入数据库。
4. 成功时返回 `packageId`、`targetUserId`、`credits`。
5. 不把此接口扩展成正式运营后台。

验收：

- `NODE_ENV=production` + `IS_DEBUG=false` 返回 404。
- debug/admin 可加测试积分。
- 非 admin 不可加积分。
- invalid credits 没有 ledger write。

回滚：

- 可回滚 route guard，但生产上线前必须重新加保护。

### Phase 5：External Generation Bridge Contract

目标：

- 明确当前 `tryUrl` 是跳外部生成页，不是本地扣积分生成。
- URL 参数保持兼容，只追加必要 source metadata。

改动文件：

```text
frontend/src/lib/tryUrl.ts
frontend/src/components/landing/HeroSection.tsx
frontend/src/components/landing/FinalCta.tsx
frontend/src/app/prompts/page.tsx
frontend/src/app/credits/page.tsx
```

任务：

1. 在 `tryUrl.ts` 增加 contract 注释：
   - target origin
   - prompt 兼容字段
   - reference image 上限
   - 本地路径归一化规则
   - 冗余字段删除条件
2. 给 prompt case 生成链接补充非敏感 source metadata：
   - `source_case_id`
   - `source_case_category`
   - `source_note_url`
   - `source_author_url`
3. 保留旧参数，不删除外部 generated 可能依赖的字段。
4. UI 文案避免暗示本地积分已扣除。
5. URL 构造失败时显示 toast。

验收：

- 每个 prompt case 仍能打开外部 generated URL。
- 最多 3 张 reference images。
- 重复图片去重。
- 本地路径归一化到 `https://imaimaqueencard.com/...`。
- 文案不暗示本地扣费生成。

回滚：

- 若外部 generated 解析失败，只回滚新增参数；旧参数必须保留。

### Phase 6：数据库 Migration Baseline

目标：

- 让 schema 状态可复现。
- 不在本轮清理 inherited schema。

改动文件：

```text
frontend/drizzle.config.ts
frontend/src/db/schema.ts
frontend/src/db/migrations/**
frontend/package.json
frontend/README.md
```

任务：

1. 确认当前 `schema.ts` 是否作为 initial baseline。
2. 运行：

```bash
pnpm run db:generate
```

3. 如果生成 migration 风险过大，记录暂缓原因和下一步 baseline 策略。
4. 在 README 或 docs 写明：
   - local database prerequisite
   - `db:generate`
   - `db:migrate`
   - rollback/restore 注意事项

验收：

- 存在 `frontend/src/db/migrations`，或有明确暂缓记录。
- 新数据库可从 migration 创建，或 documented blocker 清楚。
- 不删除 Creem/legacy schema。

回滚：

- 如果 migration diff 不可信，只撤销 migration 文件并保留文档 blocker。

### Phase 7：整体验证和收尾

目标：

- 证明本轮止血完成，可以进入后续 code review 或 test plan。

命令：

```bash
pnpm test
pnpm run lint
pnpm run build:prod
pnpm run dev
```

手动 QA 页面：

```text
/
/prompts
/pricing
/login
/register
/credits
```

手动 QA 重点：

- mobile / tablet / desktop 文案不重叠。
- prompt modal 可打开。
- 生成链接可跳外部 generated。
- checkout 空 price id disabled。
- checkout success/cancel query 有提示。
- Google disabled 时登录页不显示 Google。
- 普通邮箱注册/登录在 `/login` 和 `/register` 都可见、可提交。
- `/credits` 未登录重定向正常。
- Admin credit API production disabled 返回 404。

收尾文档：

- 更新 `w6/ima ima queencard/README.md` 的运行和验证说明。
- 若实现完成并通过 Zeabur 登录/邮箱 smoke，追加 code review 或 test-plan：

```text
specs/w6/0008-imaima-queencard-code-review.md
```

### Phase 8：Zeabur 登录和邮箱部署验收

目标：

- 操作者在部署前已登录 Zeabur，能访问目标 project/service。
- 生产环境使用 Zeabur Email/ZSend 或等价已配置 provider 发送 Better Auth magic link。
- `/login` 和 `/register` 的邮箱 magic link 在 Zeabur 生产/预览环境可真实送达，回调 URL 指向当前 `NEXT_PUBLIC_APP_URL`。
- 不把 Zeabur token、邮箱 API key、Stripe key 或 magic link 明文写入 repo。

部署前置：

```text
Zeabur account/session is available to the operator.
Zeabur project/service is selected and reachable.
Production domain or preview URL is known before setting auth callback URLs.
```

Zeabur 相关环境变量：

```text
NEXT_PUBLIC_APP_URL=https://<zeabur-domain>
BETTER_AUTH_SECRET=<production-secret>
EMAIL_PROVIDER=zeabur
ZEABUR_EMAIL_API_KEY=<zsend-api-key>
ZEABUR_EMAIL_FROM=<verified-sender>
ZEABUR_EMAIL_API_URL=https://api.zeabur.com/api/v1/zsend/emails
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
IS_DEBUG=false
```

说明：

- `ZEABUR_EMAIL_API_URL` 可省略，代码默认使用 Zeabur ZSend API。
- 如果临时使用 Resend，必须显式设置 `EMAIL_PROVIDER=resend`、`RESEND_API_KEY`、`RESEND_FROM`，并在 `refactor-verification.md` 记录原因。
- Zeabur 登录是部署操作者权限前置，不改变应用内用户登录；应用用户登录仍以 Better Auth email magic link 为主路径。

验收：

- Zeabur 登录状态、目标 project/service、域名和部署时间写入 `w6/ima ima queencard/docs/refactor-verification.md`，但不记录任何 secret。
- Zeabur env vars 设置后服务已重启或重新部署。
- 在 Zeabur URL 上测试 `/login` 和 `/register`：输入真实邮箱后能收到 magic link。
- Magic link 打开的 callback URL 使用 Zeabur 生产/预览域名，不回到 `localhost:8080`。
- 点击 magic link 后会话建立，登录后 `/credits` 能看到当前账号。
- 邮件发送失败时，用户看到明确错误；服务端日志能定位 provider/config 问题。

## 任务拆分

| ID | 模块 | 任务 | 风险 | 验收 |
|---|---|---|---|---|
| T001 | Safety Net | 加 Vitest/Testing Library 配置 | 中 | `pnpm test` 可运行 |
| T002 | Safety Net | `buildPromptTryUrl` characterization tests | 中 | URL 参数测试通过 |
| T003 | Safety Net | `CheckoutButton` characterization tests | 中 | disabled/401/success/error 通过 |
| T004 | Billing | `normalizeBillingProvider` + env 默认 Stripe | 中 | provider tests 通过 |
| T005 | Billing | Creem plugin 加 provider gate | 中 | Stripe provider 不加载 Creem |
| T006 | Billing | Pricing provider mismatch UI | 低 | creem provider 下无 Stripe checkout |
| T007 | Stripe | checkout 前 ensure customer | 高 | session 前本地 customer 存在 |
| T008 | Stripe | return URL 改 `/pricing` query | 中 | 不再跳 `/dashboard` |
| T009 | Stripe | portal guard | 中 | 缺 stripeCustomerId 不 500 |
| T010 | Stripe | webhook 按 event 拆 handler | 高 | fixture tests 通过 |
| T011 | Auth | 邮箱注册/登录主路径 + Google button/env gate | 低 | 邮箱入口始终可用；disabled 时 Google 按钮隐藏 |
| T012 | Auth | Google failed toast | 低 | 用户看到明确错误 |
| T013 | Admin | production 404 guard | 中 | production 默认不可用 |
| T014 | Bridge | `tryUrl` contract 注释和 source metadata | 中 | 旧 URL 兼容 |
| T015 | DB | migration baseline 或 blocker 文档 | 中 | baseline 可复现或风险记录 |
| T016 | QA | lint/build/test/manual QA | 中 | 完成定义全部满足 |
| T017 | Zeabur | 登录状态、project/service 和生产 URL 验收 | 中 | Zeabur 目标环境可访问且证据已记录 |
| T018 | Email | Zeabur Email/ZSend magic link smoke | 高 | `/login` 和 `/register` 邮件可送达并完成回调 |

## 依赖顺序

```text
T001-T003 Safety Net
-> T004-T006 Billing Provider
-> T007-T010 Stripe Checkout/Webhook
-> T011-T012 Auth UI
-> T013 Admin Guard
-> T014 Generation Bridge
-> T015 DB Baseline
-> T016 QA
-> T017 Zeabur Login/Deploy Readiness
-> T018 Zeabur Email Smoke
```

不能倒置：

- 不要在测试安全网前改 webhook。
- 不要在 provider 策略明确前改 pricing 主路径。
- 不要在 return URL 明确前上线 checkout。
- 不要在 webhook fixture 前改生产 webhook。
- 不要在 generation bridge contract 明确前改 credit hold schema。
- 不要在 migration baseline 稳定前删除 inherited schema。
- 不要在 Zeabur 登录、生产 URL 和邮箱 provider 未确认前标记生产部署完成。

## 环境变量决策

本轮推荐默认：

```text
NEXT_PUBLIC_BILLING_PROVIDER=stripe
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
IS_DEBUG=false
NEXT_PUBLIC_APP_URL=http://localhost:8080
```

Stripe 必要变量：

```text
STRIPE_API_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID
NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID
NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY_PRICE_ID
NEXT_PUBLIC_STRIPE_BUSINESS_YEARLY_PRICE_ID
```

Google 只有在启用时才必须存在：

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

Creem 只有 provider 为 `creem` 时才进入 runtime：

```text
CREEM_API_KEY
CREEM_WEBHOOK_SECRET
```

Zeabur Email/ZSend 生产推荐：

```text
EMAIL_PROVIDER=zeabur
ZEABUR_EMAIL_API_KEY
ZEABUR_EMAIL_FROM
ZEABUR_EMAIL_API_URL=https://api.zeabur.com/api/v1/zsend/emails
BETTER_AUTH_SECRET
NEXT_PUBLIC_APP_URL=https://<zeabur-domain>
```

部署注意：

- `NEXT_PUBLIC_APP_URL` 必须和 Zeabur 实际访问域名一致，否则 magic link 和 Stripe return URL 会回到错误域名。
- `BETTER_AUTH_SECRET` 必须在生产设置，不能使用默认 secret。
- Zeabur/Stripe/Email secrets 只能写入 Zeabur 环境变量，不写入 spec、README 或 git。

## 风险与回滚

| 风险 | 触发点 | 回滚 |
|---|---|---|
| 测试框架引入导致 build 变慢或冲突 | Vitest/React 19/jsdom 配置不兼容 | 先保留纯函数 tests，组件 tests 延后 |
| Provider gate 影响 Creem 用户 | provider 默认从 Creem 变 Stripe | 显式设置 `NEXT_PUBLIC_BILLING_PROVIDER=creem` |
| Stripe webhook handler 出错 | 订阅状态同步失败 | 回滚 `frontend/src/payment/webhooks.ts` 并暂停 webhook endpoint |
| return URL 文案误导 | webhook 同步有延迟 | 显示同步中，不显示失败 |
| Google 被误隐藏 | 已配置 Google 但 public flag false | 设置 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` |
| Admin 测试受阻 | production guard 命中 | preview/local 设置 `IS_DEBUG=true` |
| tryUrl 追加参数影响外部服务 | external generated 解析异常 | 保留旧参数，只移除新增参数 |
| migration diff 不可信 | inherited schema 过多 | 暂缓 migration，单独开 baseline plan |
| Zeabur 未登录或 project 选错 | 部署/改 env 操作失败 | 先停止部署，重新确认 Zeabur session 和目标 service |
| Zeabur Email 未配置 | magic link 无法送达 | 回滚到已验证 provider，或补齐 ZSend key/from/domain 后重启 |
| `NEXT_PUBLIC_APP_URL` 错误 | magic link/Stripe return 回 localhost 或旧域名 | 修正 Zeabur env 并重新部署 |

## 完成定义

本轮完成必须满足：

- `pnpm test` 通过，或记录无法运行的明确 blocker。
- `pnpm run lint` 通过。
- `pnpm run build:prod` 通过。
- `/`、`/prompts`、`/pricing`、`/login`、`/register`、`/credits` 可打开。
- Google disabled 时登录页不显示 Google。
- 普通邮箱注册/登录在 `/login` 和 `/register` 始终可用。
- Stripe checkout return URL 指向存在页面。
- Stripe webhook fixture 覆盖 checkout + invoice + subscription update/delete。
- production 下 admin credit API 默认 404。
- `tryUrl` contract 清楚，旧外部生成参数保持兼容。
- migration baseline 存在，或暂缓原因写入文档。
- Zeabur 登录、目标 project/service、生产 URL 和部署状态已记录。
- Zeabur Email/ZSend 或 fallback provider 已能发送 magic link。
- `/login` 和 `/register` 在 Zeabur URL 上可完成邮箱 magic link 登录。
- `specs/w6/` 追加下一步 review/test 文档。

## 下轮交接

本轮结束后，下轮再做：

1. 本地 image generation task。
2. 生成状态和结果页。
3. 通用 task credit hold。
4. 扣费/退款闭环。
5. 用户 Dashboard：套餐、积分、订单、生成历史、订阅管理。
6. Prompt Library 数据结构、分类、搜索、推荐、收藏、复用工作流。

下轮开始前应先生成新的 design/implementation plan，不要直接在本轮代码上扩范围。
