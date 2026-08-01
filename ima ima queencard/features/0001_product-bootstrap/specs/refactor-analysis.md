# imaima queencard Refactor Analysis

## 元数据

- 工作流：`w6`
- 产品目录：`w6/ima ima queencard/frontend/`
- 方案文件：`specs/w6/0003-imaima-queencard-refactor-analysis.md`
- 关联 instruction：`specs/w6/0001-imaima-queencard-instruction.md`
- 关联 code review：`specs/w6/0002-imaima-queencard-code-review.md`
- 创建日期：`2026-06-12`
- Artifact role：`refactor-analysis`
- 状态：手术方案，未进入实现

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md` 的手动 spec chain 公式：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

本文件命名为：

```text
specs/w6/0003-imaima-queencard-refactor-analysis.md
```

命名含义：

- `w6`：所属 workstream
- `0003`：位于 instruction 与 code-review 之后的第三份沉淀文件
- `imaima queencard`：当前项目名
- `refactor-analysis`：针对既有代码的重构分析和手术方案

## 手术目标

本方案的目标不是重写 imaima queencard，而是用小切口把当前“不稳定但已有雏形”的产品整理成可继续演进的状态。

当前应用已经有：

- Landing page
- `/prompts` 小红书案例库
- 外部生成 URL bridge
- Better Auth magic link
- 可选 Google OAuth
- Stripe checkout 入口
- Creem auth/plugin/credit 配置
- credit ledger 服务
- `/credits` 余额页
- admin test credit API

但它还没有形成稳定闭环：

- 生成在外部 `imaimaqueencard.com/generated`
- 本地积分没有接入生成消耗
- Stripe 与 Creem 并存
- webhook 有事件类型处理错误
- checkout 返回不存在的 `/dashboard`
- Google 登录按钮和服务端 provider 状态不一致
- admin 测试接口没有生产硬保护
- schema 存在但 migrations 缺失

本手术方案的核心是：

```text
先止血：修正支付、登录、返回路径和环境保护。
再分流：明确外部生成 bridge 与本地生成闭环的边界。
最后固化：补迁移、测试、基线 commit 和后续实现入口。
```

## 总体策略

### 推荐方向

短期推荐使用 **Stripe-first / external-generation-bridge** 策略：

- 继续让 `/prompts` 和 landing page 跳转到 `https://imaimaqueencard.com/generated`
- 不在第一轮实现本地生成
- 先修复 Stripe checkout/webhook/account return
- 暂时隔离 Creem，避免双计费路径同时生效
- 让积分系统可被展示和维护，但不暗示当前外部生成必然消耗本地积分

原因：

- 可见用户界面已经是 Stripe pricing。
- `.env.example` 默认 `NEXT_PUBLIC_BILLING_PROVIDER='stripe'`。
- `/prompts` 当前已经围绕外部 generated URL 设计。
- 本地生成闭环需要新增任务模型、生成 API、扣费时序、失败退款、结果页，范围明显更大。

### 不推荐第一刀直接做的事

- 不要同时修 Stripe、Creem、本地生成和 dashboard 大改版。
- 不要先改 case library 数据结构。
- 不要先做完整会员中心大后台。
- 不要先重构所有 inherited schema。
- 不要为了“看起来干净”删除大量暂时未用代码。

## 当前业务流程地图

### 公开访客流程

```text
访问 `/`
-> 阅读参考图驱动的产品承诺
-> 点击 CTA
-> 跳转 `https://imaimaqueencard.com/generated?...`
```

涉及文件：

- `src/app/page.tsx`
- `src/components/HeroSection.tsx`
- `src/components/FinalCta.tsx`
- `src/lib/tryUrl.ts`

当前问题：

- CTA 直接跳外部生成页。
- 本地不知道用户是否生成成功。
- 本地积分不参与本次生成。

### Prompt Library 流程

```text
访问 `/prompts`
-> 搜索/筛选/排序案例
-> 打开案例详情
-> 查看 prompt、来源、指标、参考图
-> 点击生成
-> 使用 `buildPromptTryUrl` 构造外部 generated URL
```

涉及文件：

- `src/app/prompts/page.tsx`
- `src/data/xhsPromptCases.ts`
- `src/data/xhsCaseMetrics.ts`
- `src/lib/tryUrl.ts`
- `public/xhs-cases/**`

当前问题：

- 这是最完整的产品面，但定位还不清：是产品核心，还是 demo/marketing surface。
- 生成 URL 参数非常多，缺少版本化或 contract 注释。
- 本地无法追踪哪次生成来自哪个案例。

### 登录/注册流程

```text
访问 `/login` 或 `/register`
-> 输入 email
-> Better Auth magic link
-> Resend 发邮件
-> 用户点击链接
-> session 创建
-> after hook 尝试发 welcome credits
```

产品约束：

- 普通邮箱注册/登录是必选主路径。
- 当前实现方式是 Better Auth magic link；本轮不改成密码登录。
- Google OAuth 只是可选增强，不得替代或弱化邮箱注册/登录。
- 即使 Google disabled、未配置或登录失败，邮箱 magic link 仍必须可见、可提交、可收到明确反馈。

涉及文件：

- `src/components/user-auth-form.tsx`
- `src/app/login/page.tsx`
- `src/app/register/page.tsx`
- `src/lib/auth/auth.ts`
- `src/lib/auth/client.ts`
- `src/services/credit.ts`

当前问题：

- Google 按钮无条件显示。
- 服务端 Google provider 只有 env 完整时才注册。
- welcome credits 写入逻辑在 auth hook 内，正确方向是幂等，但失败只记日志。

### Stripe checkout 流程

```text
访问 `/pricing`
-> 点击月付/年付
-> `CheckoutButton` POST `/api/billing/stripe/checkout`
-> `createStripeSession`
-> Stripe checkout
-> Stripe webhook 回写 Customer
-> 用户返回 `/dashboard`
```

涉及文件：

- `src/app/pricing/page.tsx`
- `src/components/checkout-button.tsx`
- `src/app/api/billing/stripe/checkout/route.ts`
- `src/services/billing.ts`
- `src/payment/webhooks.ts`
- `src/app/api/webhooks/stripe/route.ts`

当前问题：

- `/dashboard` 不存在。
- `invoice.payment_succeeded` payload 类型处理错误。
- `Customer` 不存在时 webhook 不会创建 customer。
- 非免费 plan 直接进 Stripe portal，但不保证有 `stripeCustomerId`。

### 积分流程

```text
新 session 创建
-> welcome credits

访问 `/credits`
-> requireAuth
-> creditService.getBalance
-> creditService.getHistory
-> 显示余额和最近记录
```

涉及文件：

- `src/app/credits/page.tsx`
- `src/services/credit.ts`
- `src/app/api/v1/credit/balance/route.ts`
- `src/app/api/v1/credit/history/route.ts`
- `src/stores/credits-store.ts`

当前问题：

- freeze/settle/release 以 `videoUuid` 为核心，不符合当前图文生成主叙事。
- 没有本地 generation task 消费积分。
- 计费配置里仍有 video model pricing 语言。

## 手术范围

### 本轮应做

1. Billing provider 决策与代码路径隔离。
2. Stripe checkout return path 修正。
3. Stripe webhook 类型处理修正。
4. Customer 创建/更新策略修正。
5. Google 登录按钮条件化。
6. Admin credit API 生产保护。
7. 外部生成 bridge 的产品文案和参数 contract 固化。
8. 初始 migration 方案。
9. 最小测试矩阵。
10. git 基线整理。

### 本轮不做

1. 不实现本地 AI 图像生成。
2. 不重做 `/prompts` 大 UI。
3. 不重写 Better Auth。
4. 不删除 Creem 全部代码。
5. 不清空 legacy schema。
6. 不改 122 个案例数据。
7. 不重构所有 shadcn/ui 组件。

## Phase 0：术前准备

### 目标

建立一个可以安全动刀的基线，避免重构途中不知道哪些变化来自哪里。

### 操作

1. 确认 `w6/ima ima queencard/` 的 git root。
2. 确认 `.gitignore` 不跟踪 `.next/`、`node_modules/`、`.env.local`、`.DS_Store`。
3. 将 `w6/ima ima queencard/` 应用目录纳入 git。
4. 做初始 commit。
5. 在 specs 中记录本轮 refactor branch 名称。

### 验收

- `git status` 只有预期变更。
- 可以通过 git diff 清楚看到每一刀修改。
- Antigravity/Codex 打开项目时有稳定 git 边界。

### 回滚

- 任意阶段可回到初始 commit。

## Phase 1：统一 Billing Provider 策略

### 推荐决策

本轮设为 Stripe-first：

```text
NEXT_PUBLIC_BILLING_PROVIDER=stripe
```

Creem 不删除，但必须进入隔离状态：

- 只有明确配置 provider 为 `creem` 时才启用 Creem plugin。
- Stripe pricing 页只在 provider 为 `stripe` 时显示 Stripe checkout。
- 不允许 Stripe pricing + Creem credit grant 同时作为用户主路径。

### 涉及文件

- `src/config/billing-provider.ts`
- `src/lib/auth/auth.ts`
- `src/app/pricing/page.tsx`
- `src/components/checkout-button.tsx`
- `src/services/billing.ts`
- `.env.example`

### 技术方案

#### 1. Provider 配置收口

现状：

```ts
const providerEnv = process.env.NEXT_PUBLIC_BILLING_PROVIDER;

export const billingProvider: BillingProvider =
  providerEnv === "stripe" ? "stripe" : "creem";
```

问题：

- 任何非 `stripe` 值都会变成 `creem`。
- `.env.example` 默认是 `stripe`，但代码默认行为偏 `creem`。

目标：

```ts
export const billingProvider = normalizeBillingProvider(
  process.env.NEXT_PUBLIC_BILLING_PROVIDER
);
```

行为：

- 未设置时默认 `stripe`。
- 非法值在 server 侧 fail fast。
- client 侧只暴露安全枚举。

#### 2. Creem plugin 条件化

现状：

```ts
if (env.CREEM_API_KEY) {
  plugins.push(creem(...));
}
```

目标：

```ts
if (isCreemProvider && env.CREEM_API_KEY) {
  plugins.push(creem(...));
}
```

影响：

- 配了 Creem key 但 provider 为 Stripe 时，不会意外启用 Creem。
- 双 provider 后续可以明确设计，而不是隐式并存。

#### 3. Pricing 页面按 provider 渲染

Stripe-first 阶段：

- provider 为 `stripe`：渲染当前 Starter/Pro/Business。
- provider 为 `creem`：显示“当前计费方式暂未接入此价格页”，或跳到 Creem 专用购买组件。

不要让同一页在 provider 不明时继续展示 Stripe checkout。

### 交互细节

#### Pricing 页面

空 Stripe price ID：

- 当前 `CheckoutButton` 已禁用按钮。
- 保留 toast：“套餐暂未配置”。
- 可在卡片上额外显示小字：“价格暂未开放”。

Provider 不匹配：

- 不渲染会失败的按钮。
- 页面显示明确状态：

```text
当前计费通道未启用 Stripe。请切换配置或使用当前启用的购买方式。
```

### 验收

- `NEXT_PUBLIC_BILLING_PROVIDER=stripe` 时，只走 Stripe。
- `NEXT_PUBLIC_BILLING_PROVIDER=creem` 时，Stripe checkout 不可被点击触发。
- 配置了 `CREEM_API_KEY` 但 provider 为 Stripe 时，不加载 Creem plugin。

### 回滚

- 保留原 `pricing-user.ts` 和 Creem config。
- 只回滚 provider gating，不影响 auth magic link。

## Phase 2：修复 Stripe Checkout 和 Webhook

### 目标

确保用户付款后，Customer、plan、period、portal 都能稳定同步。

### 涉及文件

- `src/services/billing.ts`
- `src/payment/webhooks.ts`
- `src/app/api/webhooks/stripe/route.ts`
- `src/services/customer.ts`
- `src/payment/plans.ts`
- `src/payment/subscriptions.ts`

### 技术方案

#### 1. Checkout 前确保 Customer 存在

现状：

- `createStripeSession` 查询 `customers`。
- 如果没有 customer，仍可以创建 Stripe session。
- webhook 回来后只 update 已存在 customer；如果不存在就什么都不写。

方案：

- `createStripeSession(userId, planId)` 开头调用 `ensureCustomer(userId)`。
- webhook 中如果找不到 customer，应 upsert customer。

建议 contract：

```ts
type BillingCustomer = {
  authUserId: string;
  provider: "stripe";
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  plan: "FREE" | "PRO" | "BUSINESS";
}
```

本轮可以先不加 provider 字段，但逻辑上要按 provider 分支。

#### 2. 修复 return URL

两种方案：

方案 A：短期低风险。

```text
success_url = `${APP_URL}/pricing?checkout=success`
cancel_url = `${APP_URL}/pricing?checkout=cancelled`
portal return_url = `${APP_URL}/pricing?billing=return`
```

方案 B：补最小 dashboard。

```text
/dashboard
```

展示：

- 当前套餐
- 当前积分
- 最近交易
- 继续生成按钮
- 管理订阅按钮

推荐本轮采用方案 A，除非明确要做 account dashboard。

#### 3. Webhook 按事件类型收窄 payload

目标结构：

```ts
export async function handleEvent(event: Stripe.DiscriminatedEvent) {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(event.data.object);
    case "invoice.payment_succeeded":
      return handleInvoicePaymentSucceeded(event.data.object);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event.data.object);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event.data.object);
    default:
      return;
  }
}
```

`checkout.session.completed`：

- session object
- read `session.subscription`
- retrieve subscription
- get metadata userId
- upsert Customer

`invoice.payment_succeeded`：

- invoice object
- read `invoice.subscription`
- retrieve subscription
- update period end and plan

`customer.subscription.updated`：

- subscription object
- read metadata userId
- update cancel status, price id, period end

`customer.subscription.deleted`：

- set plan FREE
- clear or mark subscription inactive

#### 4. Portal 进入条件

现状：

```ts
if (customer?.plan && customer.plan !== "FREE") {
  stripe.billingPortal.sessions.create({
    customer: customer.stripeCustomerId!,
  });
}
```

目标：

- 必须同时满足：
  - plan 非 FREE
  - provider 是 stripe
  - `stripeCustomerId` 存在

否则：

- 如果没有 Stripe customer：创建新 checkout 或返回可解释错误。
- 不允许非空断言触发 500。

### 交互细节

#### `/pricing?checkout=success`

页面顶部显示成功状态：

```text
支付已完成，我们正在同步你的订阅状态。通常几秒内完成。
```

附动作：

- 查看积分
- 回到提示词库

#### `/pricing?checkout=cancelled`

显示：

```text
你已取消支付，套餐没有变更。
```

#### webhook 同步延迟

如果用户支付后立刻回来但 webhook 尚未完成：

- 不要显示“失败”。
- 显示“同步中”。
- 提供刷新按钮。

### 验收

- checkout session 创建前 Customer 已存在。
- `checkout.session.completed` 能写入 Stripe customer/subscription/price。
- `invoice.payment_succeeded` 不再读取 checkout session 字段。
- billing portal 不因缺少 `stripeCustomerId` 500。
- 返回 URL 不再指向不存在页面。

### 回滚

- 可先只改 return URL 和 portal guard。
- webhook handler 可单独回滚到旧版本，但必须暂停生产 webhook。

## Phase 3：认证交互修复

### 目标

让登录界面只展示真实可用的登录方式。

普通邮箱注册/登录必须始终保留为主路径；Google OAuth 只是可选 provider。

### 涉及文件

- `src/components/user-auth-form.tsx`
- `src/lib/auth/auth.ts`
- `src/lib/auth/env.mjs`
- `.env.example`

### 技术方案

#### 1. 增加前端可读开关

使用现有：

```text
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
```

前端行为：

- false：隐藏分隔线和 Google 按钮，保留邮箱输入和 magic link submit。
- true：显示 Google 按钮，同时保留邮箱输入和 magic link submit。

服务端行为：

- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` 时，必须同时存在 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。
- 如果不满足，在启动或 auth 初始化时报明确错误。

#### 2. Google sign-in 失败 toast

当前 `.catch` 只 console.error 并停止 loading。

目标：

```text
Google 登录暂不可用，请使用邮箱登录。
```

### 交互细节

Magic link 单路径：

- email input
- submit
- toast success
- no social divider
- `/login` 和 `/register` 都可用

Magic link + Google：

- email input
- submit
- divider
- Google button
- Google 是附加入口，不是唯一入口

### 验收

- Google disabled 时 UI 不出现 Google。
- Google disabled 时普通邮箱注册/登录仍可见、可提交。
- Google enabled 时普通邮箱注册/登录仍可见、可提交。
- Google enabled 但 provider 配置缺失时，本地启动或 auth 初始化给出明确错误。
- Google 登录失败时用户能看到 toast。

### 回滚

- 只需恢复按钮常显，但不建议。

## Phase 4：Admin Credit API 安全收口

### 目标

防止测试能力进入生产暴露面。

### 涉及文件

- `src/app/api/v1/admin/credits/add/route.ts`
- `src/lib/api/auth.ts`
- `src/lib/auth/admin.ts`
- `src/env.mjs`
- `.env.example`

### 技术方案

#### 1. 增加生产保护

本轮推荐：

```ts
if (process.env.NODE_ENV === "production" && env.IS_DEBUG !== true) {
  return Response.json({ error: "Not found" }, { status: 404 });
}
```

策略：

- 生产默认不可见。
- debug 明确打开才可用。
- 404 比 403 更适合隐藏测试接口存在。

#### 2. 如果要正式化为运营能力

需要额外字段：

- operatorUserId
- targetUserId
- credits
- reason
- ticketId
- createdAt
- ipAddress
- userAgent

本轮不建议直接正式化。

### 交互细节

如果保留测试接口：

- 成功返回 packageId、targetUserId、credits。
- 非 admin 返回 403。
- production disabled 返回 404。
- invalid credits 返回 400，而不是包装在 success response 内。

### 验收

- production + IS_DEBUG false 时接口不可用。
- admin + debug 环境可加积分。
- 非 admin 不可加积分。
- 无效 credits 不写入数据库。

## Phase 5：生成 Bridge 边界固化

### 目标

明确当前应用是 external generation bridge，避免本地积分和生成体验产生误导。

### 涉及文件

- `src/lib/tryUrl.ts`
- `src/components/HeroSection.tsx`
- `src/components/FinalCta.tsx`
- `src/app/prompts/page.tsx`
- `src/app/credits/page.tsx`

### 技术方案

#### 1. 给 `tryUrl` 增加 contract 注释

记录：

- 目标 origin
- 参数用途
- reference image 上限
- 兼容字段为什么重复设置
- 何时可以删除冗余字段

#### 2. 给外部生成入口加来源标识

当前已有：

```text
source=prompt-library
```

建议补充：

- `source_case_id`
- `source_case_category`
- `source_note_url`
- `source_author_url`

不要发送用户敏感信息。

#### 3. UI 文案边界

当前可保留“生成”按钮，但在需要处避免表达为“本地已扣费生成”。

Prompt modal 可以显示：

```text
将带着当前案例结构和参考图前往生成页。
```

而不是：

```text
立即扣积分生成。
```

### 交互细节

点击生成：

1. 构造 try URL。
2. 新窗口或当前窗口打开外部 generated。
3. 若参考图缺失，仍允许只带 prompt。
4. 若 URL 构造失败，toast 提示“生成链接创建失败，请稍后再试”。

### 验收

- 每个 prompt case 的生成链接仍能打开。
- 最多 3 张参考图。
- 本地路径被归一化为 `https://imaimaqueencard.com/...`。
- UI 不暗示本地积分被消耗。

## Phase 6：为未来本地生成预留切口

### 目标

不在本轮实现本地生成，但提前规定如果下一轮要做，切口在哪里。

### 最小未来模型

建议新增 image generation 任务，而不是复用 `videos`：

```text
image_generations
  id
  uuid
  user_id
  source_case_id
  prompt
  reference_images jsonb
  status
  provider
  external_task_id
  output_images jsonb
  credits_used
  error_message
  created_at
  updated_at
  completed_at
```

信用点应从 `videoUuid` 抽象为 `taskUuid`：

```text
credit_holds
  task_uuid
  task_type: image_generation | video_generation
```

### 本轮只做的准备

- 不新增表。
- 不改 credit hold schema。
- 在 refactor docs 中记录未来切口。
- 若代码需要轻微命名，可新增 wrapper，但不破坏现有 video logic。

### 未来本地生成交互

```text
用户点击生成
-> 检查登录
-> 估算积分
-> 展示确认弹窗
-> 创建 generation task
-> freeze credits
-> 调 provider
-> 成功 settle
-> 失败 release
-> 展示结果页
```

本轮不做该闭环。

## Phase 7：数据库迁移策略

### 目标

让 schema 状态可复现，而不是只停留在 TypeScript 文件。

### 涉及文件

- `drizzle.config.ts`
- `src/db/schema.ts`
- `src/db/migrations/**`
- `package.json`

### 技术方案

1. 确认当前 schema 是否就是目标初始 schema。
2. 如需先清理 inherited schema，另开 design/plan，不在本轮直接删。
3. 生成 initial migration。
4. 在 README 写明本地数据库启动方式和迁移命令。

### 验收

- 存在 `src/db/migrations`。
- 新数据库可从 migration 创建。
- `pnpm run db:generate` 不产生未解释 diff。

## Phase 8：测试与验证矩阵

### 单元测试

建议覆盖：

- `buildPromptTryUrl`
  - 参考图去重
  - 最多 3 张
  - 本地路径归一化
  - prompt 参数存在
- billing provider normalize
  - undefined -> stripe
  - stripe -> stripe
  - creem -> creem
  - invalid -> error
- Stripe webhook handlers
  - checkout session completed
  - invoice payment succeeded
  - subscription updated
  - subscription deleted
- credit service
  - welcome credits 幂等
  - freeze insufficient credits
  - settle idempotent
  - release idempotent

### 集成测试

建议覆盖：

- 未登录访问 `/credits` 重定向。
- 未登录点击 checkout 跳 `/login?from=/pricing`。
- 空 price ID 按钮 disabled。
- Google disabled 时不显示 Google button。
- Admin API production disabled 时返回 404。

### 手动 QA

页面：

- `/`
- `/prompts`
- `/pricing`
- `/login`
- `/register`
- `/credits`

浏览器尺寸：

- mobile
- tablet
- desktop

重点：

- 文案不遮挡
- prompt modal 可用
- 生成链接可打开
- toast 可见
- 登录回跳 `from` 正常

### 命令

```bash
pnpm run lint
pnpm run build:prod
pnpm run dev
```

如新增测试脚本：

```bash
pnpm test
```

## 交互细节总表

| 场景 | 当前行为 | 目标行为 | 用户反馈 |
|---|---|---|---|
| 首页点击生成 | 跳外部 generated | 保留跳转，参数 contract 固化 | 无需额外弹窗 |
| prompt case 点击生成 | 跳外部 generated | 带 case id/category/source 参数 | 生成链接失败时 toast |
| 未登录 checkout | API 401 后跳 login | 保留 | `/login?from=/pricing` |
| 支付成功返回 | `/dashboard` 404 | `/pricing?checkout=success` 或实现 dashboard | 顶部成功提示 |
| 支付取消返回 | `/dashboard` 404 | `/pricing?checkout=cancelled` | 顶部取消提示 |
| Google 未配置 | 按钮仍显示 | 按钮隐藏 | 无分隔线 |
| Google 配置错误 | console error | toast 明确提示 | “请使用邮箱登录” |
| Admin 加积分生产环境 | admin 可调用 | 默认 404 | 不暴露测试接口 |
| 积分不足生成 | 暂无本地生成 | 本轮不处理 | 未来本地生成再加确认 |

## 文件级手术清单

### `src/config/billing-provider.ts`

动作：

- 修改默认 provider 为 `stripe`。
- 增加 normalize 函数。
- 非法值 fail fast。

风险：

- 若现有环境依赖默认 Creem，需要显式配置。

### `src/lib/auth/auth.ts`

动作：

- Creem plugin 加 `isCreemProvider` gate。
- Google provider 与公开开关一致。
- Creem `defaultSuccessUrl` 不再指向不存在 `/dashboard`，或等待 dashboard 实现。

风险：

- Creem 用户路径会被暂时隔离。

### `src/app/pricing/page.tsx`

动作：

- 根据 billing provider 渲染不同状态。
- 增加 checkout result query 提示。
- 保持 Stripe cards 现有视觉，不重做 UI。

风险：

- 需要把 query 状态做成 server component 可读取的 props。

### `src/components/checkout-button.tsx`

动作：

- 保留空 planId disabled。
- 增加更清晰的 error message。
- 可选：支持 `returnTo` 参数。

风险：

- 低。

### `src/services/billing.ts`

动作：

- checkout 前 `ensureCustomer`。
- portal 分支检查 `stripeCustomerId`。
- return URL 改为存在页面。
- 失败返回结构化错误。

风险：

- 中。涉及真实付款路径。

### `src/payment/webhooks.ts`

动作：

- 按 event type 拆 handler。
- 用正确 payload 类型。
- 找不到 Customer 时 upsert。
- 处理 subscription deleted。

风险：

- 高。必须用 fixture 测。

### `src/components/user-auth-form.tsx`

动作：

- 根据 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` 隐藏/显示 Google。
- Google 失败 toast。
- 无 social provider 时隐藏 divider。

风险：

- 低。

### `src/app/api/v1/admin/credits/add/route.ts`

动作：

- 加 production guard。
- 无效 credits 返回真正 400。
- 可选：补充 `reason` 字段要求。

风险：

- 低。

### `src/lib/tryUrl.ts`

动作：

- 加 contract 注释。
- 增加 source case metadata 参数。
- 保持现有兼容参数。

风险：

- 中。外部 generated 可能依赖当前参数。

## 依赖关系

### 先后顺序

```text
Phase 0 git baseline
-> Phase 1 billing provider gate
-> Phase 2 Stripe return/webhook/customer
-> Phase 3 auth UI
-> Phase 4 admin guard
-> Phase 5 generation bridge contract
-> Phase 7 migrations
-> Phase 8 tests
```

### 不能倒置的依赖

- 不要在 provider 策略明确前重构 pricing。
- 不要在 return URL 明确前上线 checkout。
- 不要在 webhook fixture 存在前改生产 webhook。
- 不要在 generation 产品方向明确前改 credit hold schema。
- 不要在 git baseline 前做大范围移动/删除。

## 风险与回滚

| 风险 | 触发点 | 回滚方式 |
|---|---|---|
| Stripe webhook 新 handler 有 bug | 付款事件同步失败 | 回滚 `src/payment/webhooks.ts` 并暂停 webhook endpoint |
| Provider gate 影响 Creem 用户 | `CREEM_API_KEY` 存在但 provider 为 stripe | 显式设置 provider 或回滚 gate |
| Return URL 改动影响用户承接 | 支付后不回 dashboard | 临时改回 `/pricing` 或 `/credits` |
| Google 按钮隐藏影响转化 | Google 已配置但公开开关没开 | 设置 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` |
| Admin endpoint 被关影响测试 | production guard 命中 | 本地/preview 用 `IS_DEBUG=true` |
| tryUrl 参数改动影响外部 generated | 外部服务解析失败 | 保留旧参数，只追加新参数，不删除旧参数 |

## 完成定义

一轮 refactor 完成必须满足：

- `pnpm run lint` 通过。
- `pnpm run build:prod` 通过。
- `/`、`/prompts`、`/pricing`、`/login`、`/register`、`/credits` 可打开。
- Google disabled 时登录页不显示 Google。
- Stripe checkout return URL 指向存在页面。
- Stripe webhook fixture 覆盖 checkout + invoice。
- production 下 admin credit API 默认不可用。
- `src/db/migrations` 存在或明确记录为什么暂缓。
- `specs/w6/` 中追加实现后的 code review 或 test-plan。

## 下一份建议文档

如果继续按 specs 链路推进，建议下一份是：

```text
specs/w6/0004-imaima-queencard-implementation-plan.md
```

它应把本 refactor-analysis 拆成可执行任务：

- 每个任务对应一个文件或小模块。
- 每个任务有验收命令。
- 每个任务明确是否需要数据库或环境变量。
- 每个任务避免同时跨 billing、auth、generation 三个域。
