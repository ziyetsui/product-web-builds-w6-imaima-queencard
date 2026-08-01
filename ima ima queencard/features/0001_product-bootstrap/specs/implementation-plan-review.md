# imaima queencard Implementation Plan Review

## 元数据

- 工作流：`w6`
- 项目目录：`w6/ima ima queencard/`
- 前端应用目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/0006-imaima-queencard-implementation-plan-review.md`
- 被审查文件：`specs/w6/0005-imaima-queencard-implementation-plan.md`
- 关联分析：`specs/w6/0003-imaima-queencard-refactor-analysis.md`
- 前置测试计划：`specs/w6/0004-imaima-queencard-test-safety-net.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-12`
- Artifact role：`implementation-plan-review`
- Review 结论：需要小幅修订后再执行

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md` 的手动 spec chain 公式：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

本文件命名为：

```text
specs/w6/0006-imaima-queencard-implementation-plan-review.md
```

命名含义：

- `w6`：所属 workstream。
- `0006`：紧随 `0005-imaima-queencard-implementation-plan.md`。
- `imaima queencard`：当前项目名。
- `implementation-plan-review`：执行前审查实现计划，检查依赖、风险、测试缺口和边界。

## Review 结论

`0005` 的整体方向正确：先测试安全网，再收口 Billing、Stripe、Auth、Admin API 和 external generation bridge，不把本地生成闭环塞进本轮。

但当前计划还不建议直接进入实现。主要原因不是方向错，而是几个高风险细节仍然太松：

- Stripe return URL 需要带 session id，否则支付回跳后的状态 reconciliation 会弱。
- webhook Customer resolution、幂等和乱序事件处理需要更明确。
- env flag 的 string/boolean 解析必须先定义，尤其是 `IS_DEBUG`。
- DB migration baseline 应至少提前检查，不应放到所有业务改动之后才发现 schema 不可复现。

建议先把本文的 P1 项回写到 `0005`，再生成 `0007-imaima-queencard-implementation-tasks.md`。

## Findings

### P1 - Stripe success URL 缺少 checkout session id，回跳页无法可靠核对支付状态

位置：

- `0005` Phase 2，任务 2-4。
- `0005` 完成定义：Stripe checkout return URL 指向存在页面。

当前计划要求：

```text
checkout success URL 改为 /pricing?checkout=success
checkout cancel URL 改为 /pricing?checkout=cancelled
```

这个比 `/dashboard` 404 好，但仍然不够。用户支付成功后回到 `/pricing?checkout=success` 时，页面无法知道是哪一个 checkout session，也无法在 webhook 延迟时用 `session_id` 做查询、提示或后续排查。`0004` 的 bug-fix tests 里已经提到 success URL 应包含 `{CHECKOUT_SESSION_ID}`，但 `0005` 没吸收这个要求。

建议修订：

```text
success_url = `${APP_URL}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`
cancel_url = `${APP_URL}/pricing?checkout=cancelled`
portal return_url = `${APP_URL}/pricing?billing=return`
```

验收也应补充：

- success URL 包含 `session_id`。
- `/pricing?checkout=success&session_id=...` 能显示同步中状态。
- session id 不存在或格式异常时，不暴露内部错误。

### P1 - Webhook Customer resolution 仍然过于抽象，按当前计划实现容易漏掉 invoice 乱序和无 metadata 场景

位置：

- `0005` Phase 2，任务 6-8。
- `0005` T010。

当前计划写的是：

```text
webhook 找不到本地 Customer 时执行 upsert 或明确创建策略。
```

这还不够执行。当前代码里 `invoice.payment_succeeded` 错把 `event.data.object` 当作 checkout session，再读取 `session.subscription`。修类型只是第一步；真正危险的是 Stripe 事件可能乱序、重复投递，invoice payload 也不总能直接拿到 `subscription.metadata.userId`。

建议把 webhook contract 写死：

1. `checkout.session.completed`
   - 读取 `session.client_reference_id` 或 `subscription.metadata.userId`。
   - retrieve subscription。
   - 以 `authUserId` upsert local customer。
   - 写入 `stripeCustomerId`、`stripeSubscriptionId`、`stripePriceId`、`stripeCurrentPeriodEnd`、`plan`。

2. `invoice.payment_succeeded`
   - 读取 invoice subscription id。
   - retrieve subscription。
   - 优先用 `subscription.metadata.userId` 找用户。
   - 如果 metadata 缺失，用 `subscription.customer` 对应的 `stripeCustomerId` 找 local customer。
   - 找不到时记录 structured warning，不抛出导致 Stripe 重试风暴。

3. `customer.subscription.updated`
   - 用 subscription customer id 或 metadata userId 找 local customer。
   - 更新 plan、period、price、cancel status。

4. `customer.subscription.deleted`
   - 用 subscription id/customer id 找 local customer。
   - 设置 plan FREE，并标记 subscription inactive。

5. 幂等策略
   - 本轮可以不新增 event ledger 表。
   - 但同一事件重复投递必须是幂等 update。
   - 不能因为重复事件产生重复积分、重复 customer 或错误 plan。

必须补 fixture tests：

- checkout 先到，invoice 后到。
- invoice 先到，checkout 后到。
- 同一 invoice 重复投递。
- metadata 缺失但 `stripeCustomerId` 可匹配。
- customer/subscription deleted 后降级 FREE。

### P1 - env flag 解析需要先定义，否则 `IS_DEBUG` 和 public flags 容易出现 string/boolean bug

位置：

- `0005` Phase 1。
- `0005` Phase 3。
- `0005` Phase 4。
- `0005` 环境变量决策。

当前真实代码中 `frontend/src/lib/auth/env.mjs` 把 `IS_DEBUG` 定义为 `z.string().optional()`，`.env.example` 写的是：

```text
IS_DEBUG=false
```

如果实现时直接写：

```ts
env.IS_DEBUG !== true
```

会因为 `env.IS_DEBUG` 是字符串而永远不等于 boolean `true`。同样，`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` 和 `NEXT_PUBLIC_BILLING_PROVIDER=stripe` 也需要统一通过 schema 或 normalize 函数处理，否则 client/server import 时可能出现默认值不一致。

建议在 `0005` 中增加一个独立小任务：

```text
T004a Env Normalization
```

要求：

- 增加 `normalizeBooleanEnv(value)` 或 `isDebugEnabled` helper。
- `IS_DEBUG` 仅接受 `"true"` 作为 true，其他值默认 false。
- `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` 仅接受 `"true"` 作为 true。
- `NEXT_PUBLIC_BILLING_PROVIDER` 仅接受 `stripe | creem | undefined`。
- server 侧非法 provider fail fast。
- client 侧只导出安全枚举，不把 server-only env validation 泄漏到 client bundle。

验收：

- `IS_DEBUG=false` 在 production guard 中是 false。
- `IS_DEBUG=true` 才允许 production debug route。
- Google disabled/enabled 两种状态都有测试。
- provider undefined/stripe/creem/invalid 都有测试。

### P1 - DB migration baseline 放在 Phase 6 太晚，可能在实现后才发现 schema 不可复现

位置：

- `0005` Phase 6。
- `0005` 依赖顺序：DB Baseline 在 Bridge 之后。

计划说“不在本轮清理 inherited schema”是对的，但 baseline 检查不应该放到最后。Stripe Customer、credit service、admin credit API 都依赖当前 schema；如果 migration 状态本来就不可复现，后续测试和回滚都会变得很难。

建议拆成两步：

1. Phase 0 增加只读/低风险 baseline inspection：

```bash
pnpm run db:generate --dry-run
```

如果 drizzle-kit 没有 dry-run，就记录实际可用命令和不要写入的替代检查方式。

2. Phase 6 再决定是否正式生成 migration。

验收应调整为：

- Phase 0 已确认 schema/migration 当前状态。
- 如果 migration 暂缓，必须在实施前记录 blocker，不是最后才记录。

### P1 - Phase 0 测试安全网范围偏大，容易卡住整个止血改造

位置：

- `0005` Phase 0。
- `0005` T001-T003。

Phase 0 同时要求 Vitest、Testing Library、jsdom、`buildPromptTryUrl`、`CheckoutButton`、Pricing Page、Auth Form。这个方向对，但第一刀如果一次把组件测试、页面测试和 mock toast/router 全部塞进去，可能会在测试环境配置上耗掉太多时间，反而迟迟不能修 Stripe 主路径。

建议拆成两个门槛：

必须在改业务前完成：

- `buildPromptTryUrl` 纯函数 characterization tests。
- `normalizeBillingProvider` / env normalization tests。
- `CheckoutButton` 最小行为 tests：空 price id disabled、401 redirect。

可以在对应 phase 前完成：

- Pricing Page render tests。
- Auth Form full component tests。
- Admin API route tests。
- webhook fixture tests。

这样既保留安全网，又不会让测试框架本身成为第一阻塞点。

### P2 - `0005` 收尾文档编号与当前 spec 链路冲突

位置：

- `0005` Phase 7 收尾文档。

当前写法：

```text
若实现完成，追加 code review 或 test-plan:
specs/w6/0006-imaima-queencard-code-review.md
```

现在 `0006` 已用于 implementation-plan-review。应改为：

```text
specs/w6/0007-imaima-queencard-implementation-tasks.md
specs/w6/0008-imaima-queencard-code-review.md
```

或者如果跳过 tasks：

```text
specs/w6/0007-imaima-queencard-code-review.md
```

建议不要跳过 tasks，因为本轮有 Stripe/webhook/Auth/Admin 多个高风险边界。

### P2 - Auth 验收还需要明确“邮箱注册”和“邮箱登录”不是两个不同 UI，但都走同一 magic link 入口

位置：

- `0005` Phase 3。

计划已经补充“普通邮箱注册/登录保持主路径”，很好。但实现时仍需避免误解成要新增密码注册。建议在 tasks 里写清：

- `/login` 和 `/register` 可以复用同一个 `user-auth-form`。
- 两个页面都展示 email input + magic link submit。
- 不新增 password 字段。
- magic link 首次登录即注册，具体用户创建由 Better Auth 负责。

### P2 - Manual QA 需要补本地浏览器验证产物

位置：

- `0005` Phase 7。

计划已有手动 QA 页面清单，但没有说要保存什么证据。由于本轮会改 `/pricing`、`/login`、`/register`、`/prompts`，建议要求：

- dev server 跑在 `http://localhost:8080`。
- 至少检查 desktop 和 mobile 两个 viewport。
- 截图或记录 smoke 结果。
- 如果 Browser tool 可用，用 Browser 打开本地页面验证；不可用则记录 fallback。

## 建议回写到 `0005` 的最小改动

在继续实现前，建议只改 `0005` 的这些点，不要重写整份计划：

1. Phase 2 success URL 改为带 `{CHECKOUT_SESSION_ID}`。
2. Phase 2 webhook 增加明确 Customer resolution 顺序和 fixture matrix。
3. Phase 1/3/4 前增加 Env Normalization 小任务。
4. Phase 0 增加 DB baseline inspection，Phase 6 保留正式 migration 决策。
5. Phase 0 测试安全网拆成 mandatory tests 和 phase-gated tests。
6. Phase 7 的下一文档编号从 `0006` 顺延。

## 修订后推荐任务链

```text
0003-imaima-queencard-refactor-analysis.md
-> 0004-imaima-queencard-test-safety-net.md
-> 0005-imaima-queencard-implementation-plan.md
-> 0006-imaima-queencard-implementation-plan-review.md
-> 0007-imaima-queencard-implementation-tasks.md
-> implementation
-> 0008-imaima-queencard-code-review.md
-> 0009-imaima-queencard-test-plan.md 或 0009-imaima-queencard-test-report.md
```

## 执行建议

不要直接让 Agent 执行整个 `0005`。下一步应先生成 `0007-imaima-queencard-implementation-tasks.md`，并把任务切得更小：

- 先做 env normalization 和测试框架。
- 再做 provider gate。
- 再做 Stripe return URL 和 portal guard。
- webhook 单独一组任务，必须带 fixture。
- Auth 单独一组任务，保证邮箱入口不被 Google 影响。
- Admin guard 单独一组任务。
- tryUrl bridge 单独一组任务。

这会让每次 diff 都小到可以 review，也符合本轮“止血和收口”的目标。
