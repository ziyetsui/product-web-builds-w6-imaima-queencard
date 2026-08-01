# imaima queencard 代码审查

## 元数据

- 工作流：`w6`
- 产品目录：`w6/ima ima queencard/frontend/`
- 审查文件：`specs/w6/0002-imaima-queencard-code-review.md`
- 原文件：`specs/w6/0001-imaima-queencard-spec.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- Artifact type：`code-review`
- 审查日期：`2026-06-12`
- 状态：草稿，代码审查记录
- 范围：扫描现有代码并记录风险，不修改应用代码

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md`，手动维护的 workstream 文档应采用：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

其中 `code-review` 是合法 artifact type。

因此本文件使用：

```text
specs/w6/0002-imaima-queencard-code-review.md
```

备注：本轮先沉淀 `0001-imaima-queencard-instruction.md` 作为驱动提示，再沉淀本文件作为 `0002` code-review 结果。

## 审查结论

当前代码已经具备较完整的产品外壳：

- landing page
- `/prompts` 小红书案例与提示词库
- Better Auth 登录/注册
- Stripe checkout 入口
- Creem 积分发放配置
- credit ledger 服务与查询页面

但从代码审查角度看，它还不适合直接进入生产收费或本地生成闭环。主要风险集中在：

- Stripe webhook 对不同 event payload 的处理不正确
- checkout/portal 会返回不存在的 `/dashboard`
- Stripe 与 Creem 两套计费路径并存且没有统一开关
- Google 登录按钮与服务端 provider 配置不一致
- admin 测试积分接口缺少生产环境硬保护
- 当前生成能力仍是外部 URL bridge，本地积分账本没有被生成链路消费

## Findings

### P1 - Stripe `invoice.payment_succeeded` 分支会用错 payload 类型

证据：

- `w6/ima ima queencard/frontend/src/payment/webhooks.ts:10`
- `w6/ima ima queencard/frontend/src/payment/webhooks.ts:41`
- `w6/ima ima queencard/frontend/src/payment/webhooks.ts:42`
- `w6/ima ima queencard/frontend/src/payment/webhooks.ts:43`

问题：

`handleEvent` 一开始把所有 `event.data.object` 都 cast 成 `Stripe.Checkout.Session`。这对 `checkout.session.completed` 可以成立，但对 `invoice.payment_succeeded` 不成立。`invoice.payment_succeeded` 的对象是 invoice，不是 checkout session；当前分支再读取 `session.subscription`，可能拿到错误值或 `undefined`，导致续费 webhook 更新失败。

影响：

- 订阅续费成功后，用户的 `stripeCurrentPeriodEnd` 和 plan 可能不会更新。
- Stripe webhook 可能返回 400，导致 Stripe 重试。
- 用户已付款但应用内权限/套餐不同步。

建议：

- 按 `event.type` 后再收窄 payload 类型。
- `invoice.payment_succeeded` 应从 invoice 对象读取 subscription/customer 信息。
- 为 `checkout.session.completed`、`invoice.payment_succeeded`、`customer.subscription.updated` 分别建立 webhook fixture 测试。

### P1 - Stripe checkout 和 billing portal 返回不存在的 `/dashboard`

证据：

- `w6/ima ima queencard/frontend/src/services/billing.ts:40`
- `w6/ima ima queencard/frontend/src/services/billing.ts:41`
- `w6/ima ima queencard/frontend/src/services/billing.ts:42`
- 当前 `src/app` 路由扫描未发现 `src/app/dashboard/page.tsx`

问题：

`createStripeSession` 把 success、cancel 和 billing portal return URL 都指向 `/dashboard`，但应用中没有 `/dashboard` 页面。

影响：

- 用户支付成功后会进入 404 或无法承接的页面。
- 用户取消支付后也无法回到明确状态页。
- billing portal 返回后无法展示当前订阅状态或下一步动作。

建议：

- 短期可返回 `/pricing` 或 `/credits`，并带明确 query 状态。
- 若 `/dashboard` 是产品方向，应先定义 dashboard 范围，再实现路由。

### P1 - 非免费 plan 用户进入 billing portal 时可能因为缺少 Stripe customer 崩溃

证据：

- `w6/ima ima queencard/frontend/src/services/billing.ts:44`
- `w6/ima ima queencard/frontend/src/services/billing.ts:45`
- `w6/ima ima queencard/frontend/src/services/billing.ts:46`

问题：

只要 `customer.plan !== "FREE"`，代码就直接创建 Stripe billing portal，并对 `customer.stripeCustomerId!` 使用非空断言。当前代码同时存在 Creem 订阅和 Stripe 订阅路径，非免费 plan 不一定对应 Stripe customer。

影响：

- 通过 Creem 或人工方式产生非免费 plan 的用户点击 Stripe checkout 可能 500。
- 即使不是 Creem，数据迁移或手工修复后的 Customer 也可能缺少 `stripeCustomerId`。

建议：

- billing portal 分支必须同时要求 `stripeCustomerId` 存在。
- 非 Stripe 用户应走对应 provider 的管理路径，或显示可解释的错误。
- 在统一 billing provider 前，不要只用 `plan !== "FREE"` 判断 Stripe portal 资格。

### P2 - 计费 provider 配置与用户可见页面没有统一

证据：

- `w6/ima ima queencard/frontend/src/config/billing-provider.ts:5`
- `w6/ima ima queencard/frontend/src/config/billing-provider.ts:6`
- `w6/ima ima queencard/frontend/src/app/pricing/page.tsx:4`
- `w6/ima ima queencard/frontend/src/app/pricing/page.tsx:80`
- `w6/ima ima queencard/frontend/src/lib/auth/auth.ts:135`

问题：

`billing-provider.ts` 支持 `creem | stripe`，且默认不是 `stripe` 时会落到 `creem`。但 `/pricing` 页面直接引入 Stripe 套餐并渲染 Stripe checkout button。与此同时，Better Auth 中只要 `CREEM_API_KEY` 存在就会启用 Creem 插件。

影响：

- 环境变量宣称的 provider 与用户实际看到的支付路径可能不一致。
- Creem 与 Stripe 可能同时写入积分/订阅相关数据，形成难以解释的状态。
- 定价、积分赠送和订阅权限无法保证一致。

建议：

- 先做产品决策：Stripe-only、Creem-only，还是明确的双 provider 策略。
- `/pricing`、auth plugin、webhook、credit grant、billing portal 必须读同一个 provider 决策。
- 在双 provider 场景下，Customer/subscription 模型需要能明确区分 provider。

### P2 - Google 登录按钮无条件显示，但服务端 provider 是条件注册

证据：

- `w6/ima ima queencard/frontend/src/components/user-auth-form.tsx:121`
- `w6/ima ima queencard/frontend/src/components/user-auth-form.tsx:126`
- `w6/ima ima queencard/frontend/src/components/user-auth-form.tsx:127`
- `w6/ima ima queencard/frontend/src/lib/auth/auth.ts:124`
- `w6/ima ima queencard/frontend/src/lib/auth/auth.ts:125`
- `w6/ima ima queencard/frontend/src/lib/auth/auth.ts:133`

问题：

前端始终渲染“使用 Google 继续”，并调用 `authClient.signIn.social({ provider: "google" })`。服务端只有在 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 都存在时才注册 Google provider。

影响：

- 未配置 Google 的环境中，用户会看到一个不可用登录入口。
- 失败只在 console 中记录，没有用户可理解的 toast。
- 这会影响注册转化和用户信任。

建议：

- 前端根据公开配置隐藏 Google 按钮。
- 或者服务端提供 auth capability endpoint，让前端按实际 provider 列表渲染。
- Google 登录失败时应向用户显示明确反馈。

### P2 - Admin 测试加积分接口没有生产环境硬保护

证据：

- `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts:16`
- `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts:17`
- `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts:18`
- `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts:27`
- `w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts:43`

问题：

源码注释明确说该接口“仅用于开发/测试环境，生产环境应禁用”，但 route 本身没有检查 `NODE_ENV`、`IS_DEBUG` 或其他环境开关。它要求 admin 权限，这是必要条件，但不是生产环境禁用条件。

影响：

- 一旦 admin 账号或 session 出问题，该接口可以直接给任意用户加积分。
- 生产环境里测试接口常常是后续审计和合规风险点。

建议：

- 若只用于测试，生产环境直接返回 404 或 403。
- 若要作为正式运营能力，需要增加审计、原因字段、操作人记录、额度限制和管理后台确认流程。

### P2 - 当前生成入口完全绕过本地积分账本

证据：

- `w6/ima ima queencard/frontend/src/lib/tryUrl.ts:1`
- `w6/ima ima queencard/frontend/src/lib/tryUrl.ts:2`
- `w6/ima ima queencard/frontend/src/lib/tryUrl.ts:5`
- `w6/ima ima queencard/frontend/src/lib/tryUrl.ts:82`
- `w6/ima ima queencard/frontend/src/lib/tryUrl.ts:156`
- 当前 `src/app` 路由扫描未发现本地 generation API/page

问题：

本地应用已有 credit ledger、credit holds、credit history 和 `/credits` 页面，但可见生成入口最终只是构造 `https://imaimaqueencard.com/generated` URL。生成不会在本地冻结或扣减积分。

影响：

- 用户看到积分账户，但生成行为未必消耗这些积分。
- billing/credits 与核心生成价值链断开。
- 后续如果引入本地生成，需要重新定义任务、扣费和失败退款边界。

建议：

- 在产品层明确：本地 app 是营销/案例库 bridge，还是要承接生成闭环。
- 若要承接生成闭环，应新增本地 task/generation 模型，并把 freeze/settle/release 绑定到生成生命周期。
- 若继续 bridge，应在 UI 和规格中避免暗示“本地积分会用于当前生成”。

### P3 - 数据库 schema 存在，但 migrations 缺失

证据：

- `w6/ima ima queencard/frontend/drizzle.config.ts` 指向 `./src/db/migrations`
- 当前扫描 `w6/ima ima queencard/frontend/src/db` 只发现 `src/db`

问题：

项目有 Drizzle schema 和 db scripts，但没有迁移目录。

影响：

- 新环境无法用可追溯 migration 建库。
- schema 变更无法审计。
- 生产前很难保证数据库状态与代码一致。

建议：

- 在确定 schema 后生成初始 migration。
- 明确 `db:generate`、`db:migrate`、`db:push` 的使用边界。
- 生产环境避免只依赖 `db:push`。

### P3 - 应用仓库还没有建立稳定 git 基线

证据：

- 从 `w6/ima ima queencard/` 执行 git status，仓库显示 `No commits yet on main`
- `.DS_Store` 和 `w6/ima ima queencard/` 未跟踪

问题：

当前应用代码还没有 commit 基线。

影响：

- 后续 code review、diff、回滚和多 agent 协作都缺少稳定参照。
- Antigravity/Codex/其他 agent 解析 workspace 时也更容易遇到边界不清。

建议：

- 在继续实现前，先确认要跟踪的文件范围。
- 增加合适的 `.gitignore`。
- 建立初始 commit，作为后续 review 和 implementation 的基线。

## 当前非问题或已确认边界

- `/prompts` 页面不是占位页，已经有 122 个案例和完整交互。
- `CheckoutButton` 会在 `planId` 为空时禁用按钮并显示 toast，因此空 Stripe price ID 不会直接发起 checkout。
- welcome credits 使用 `NEW_USER` package 做幂等检查，方向正确。
- 本轮只记录审查结果，不做代码修复。

## 建议修复顺序

1. 修复 Stripe webhook payload 类型处理，并补 webhook fixture 测试。
2. 决定 `/dashboard` 是要实现，还是 checkout 返回 `/pricing`/`/credits`。
3. 统一 Stripe/Creem provider 策略。
4. 修复 Google 登录按钮的条件显示。
5. 为 admin credit API 添加生产环境保护或正式运营审计。
6. 明确生成闭环是否进入本 repo，再决定 credit ledger 如何接入。
7. 生成数据库初始 migration。
8. 建立 git 初始 commit。

## 验证状态

本轮执行的是只读代码审查与文档整理。

已检查：

- `src/app` 路由文件
- `src/payment/webhooks.ts`
- `src/services/billing.ts`
- `src/app/pricing/page.tsx`
- `src/components/checkout-button.tsx`
- `src/components/user-auth-form.tsx`
- `src/lib/auth/auth.ts`
- `src/lib/tryUrl.ts`
- `src/app/api/v1/admin/credits/add/route.ts`
- `.rules/spec-ledger-naming-rules.md`

未运行：

- `pnpm install`
- `pnpm run lint`
- `pnpm run build`
- local dev server
- browser QA
- database migrations
- payment webhook tests
- auth email delivery tests

## 后续开放问题

1. Billing 最终统一到 Stripe，还是 Creem？
2. `/dashboard` 是必须产品面，还是应临时返回 `/pricing`/`/credits`？
3. imaima queencard 是否要在本 repo 内实现生成闭环？
4. credits 是服务于 image-post generation、video generation，还是二者都支持？
5. Admin credit API 是正式运营能力，还是只保留本地测试能力？
6. 是否先建立 `w6/ima ima queencard/` 初始 commit，再进入下一轮实现？
