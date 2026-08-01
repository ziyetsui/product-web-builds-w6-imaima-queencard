# imaima queencard Test Safety Net

## 元数据

- 工作流：`w6`
- 项目目录：`w6/ima ima queencard/`
- 前端应用目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/0004-imaima-queencard-test-safety-net.md`
- 来源方案：`specs/w6/0003-imaima-queencard-refactor-analysis.md`
- 创建日期：`2026-06-12`
- Artifact role：`test-safety-net`
- 状态：重构前测试安全网计划，供后续 Agent 执行

## 命名说明

根据 `.rules/spec-ledger-naming-rules.md` 的手动 spec chain 公式：

```text
specs/{scope}/000N-{project-slug}-{artifact-type}.md
```

本文件命名为：

```text
specs/w6/0004-imaima-queencard-test-safety-net.md
```

命名含义：

- `w6`：所属 workstream。
- `0004`：紧随 `0003-imaima-queencard-refactor-analysis.md`。
- `imaima queencard`：当前项目名。
- `test-safety-net`：重构前的测试安全网，属于 `test-plan` 的前置子类型。

## 背景

`0003-imaima-queencard-refactor-analysis.md` 中的第二步强调：

```text
建立安全网：
这是最容易被忽略的一步。在修改旧逻辑之前，先让 Agent 为旧逻辑写测试。
```

目标不是立刻修复所有 bug，而是先锁定当前仍应保留的行为。后续任何重构让这些测试变红时，就能判断 Agent 是破坏了既有功能，还是有意修复了一个已知 bug。

## Agent Prompt

可直接复制给后续执行 Agent：

```text
针对 imaima queencard 现有功能，请先建立重构前测试安全网。

要求：
1. 只写测试和必要测试配置，先不要修改业务逻辑。
2. 优先覆盖当前代码下应该保持通过的旧行为。
3. 区分 characterization tests 和 bug-fix tests：
   - characterization tests 必须在当前代码下通过，用来锁定现状。
   - 已知 bug 不要写成必须通过的旧行为；可以写成 test.todo、describe.skip，或记录到后续 phase。
4. 重点覆盖边界条件、错误状态、未登录状态、空配置、重复参数、外部 URL bridge。
5. 完成后运行测试，确保新增测试在当前代码下全部通过。

项目路径：
- project root: w6/ima ima queencard/
- app root: w6/ima ima queencard/frontend/

请先阅读：
- specs/w6/0003-imaima-queencard-refactor-analysis.md
- w6/ima ima queencard/docs/project-structure-map.md
```

## Safety Net 原则

### 1. 先锁现状，再改逻辑

本阶段只允许：

- 增加测试框架配置。
- 增加测试文件。
- 增加测试辅助 mock / fixtures。
- 为可测试性做极小范围的纯函数导出，前提是不改变运行时行为。

本阶段不允许：

- 修 Stripe webhook。
- 删除 Creem runtime。
- 改 auth provider 行为。
- 改 welcome credits 幂等逻辑。
- 改 admin API guard。
- 改 UI 文案和跳转行为。

### 2. Characterization tests 必须当前通过

Characterization tests 用来说明：

```text
这就是当前我们认为仍应保留的行为。
```

如果测试写完后当前代码不能通过，需要先判断：

- 测试是不是错了。
- 行为是不是已知 bug。
- 行为是不是应该进入 bug-fix phase。

不要为了让测试通过而在本阶段修改业务逻辑。

### 3. 已知 bug 不要锁死

例如：

- Stripe webhook GET 当前行为不是长期正确行为。
- Google 按钮无条件显示不是长期正确行为。
- Admin credit API 生产暴露不是长期正确行为。

这些应进入 bug-fix tests 或后续 phase，不应作为“当前正确行为”被锁死。

## 推荐测试栈

当前项目尚未保留测试框架。本阶段推荐：

- 单元测试：Vitest。
- React 组件测试：Testing Library。
- API route 测试：轻量 mock route handler 或服务层函数。
- 浏览器 E2E：暂不作为第一步，可在后续 smoke phase 用 Playwright。

建议脚本：

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

建议测试目录：

```text
w6/ima ima queencard/frontend/
  tests/
    unit/
    components/
    integration/
    fixtures/
```

也可采用 colocated tests，但要保持清晰：

```text
src/lib/tryUrl.test.ts
src/components/common/checkout-button.test.tsx
```

## 第一批 Characterization Tests

### `buildPromptTryUrl`

目标文件：

```text
w6/ima ima queencard/frontend/src/lib/tryUrl.ts
```

必须覆盖：

- 无参数时返回 `https://imaimaqueencard.com/generated?...`。
- 带 prompt 时同时设置 `prompt`、`input`、`value`、`topic`、`default_prompt`。
- 本地图片路径归一化到 `https://imaimaqueencard.com/...`。
- 多张参考图最多保留 3 张。
- 重复参考图会去重。
- `noteUrl` 和 `authorUrl` 被写入 query。
- `generation_payload`、`payload`、`config` 都存在且可以 JSON parse。

### `CheckoutButton`

目标文件：

```text
w6/ima ima queencard/frontend/src/components/common/checkout-button.tsx
```

必须覆盖：

- `planId=null` 时按钮 disabled。
- `planId=null` 时点击不会发起 fetch。
- `planId=null` 时显示“套餐未配置”类提示。
- API 返回 `401` 时跳转 `/login?from=/pricing`。
- API 返回成功 URL 时跳转该 URL。
- API 返回失败时显示错误 toast。

### Pricing Page

目标文件：

```text
w6/ima ima queencard/frontend/src/app/pricing/page.tsx
```

必须覆盖：

- 渲染 Starter、Pro、Business 三个套餐。
- 免费套餐链接到 `/register`。
- 非免费套餐渲染月付和年付按钮。
- 未配置 price id 时按钮不可点击。

### Auth Form

目标文件：

```text
w6/ima ima queencard/frontend/src/components/common/user-auth-form.tsx
```

当前可锁定行为：

- `/login` 和 `/register` 都保留普通邮箱输入入口。
- Email 输入非法时表单校验失败。
- 成功请求 magic link 后出现“请检查邮箱”类 toast。
- magic link 失败时出现“发送失败”类 toast。
- Google disabled 时，普通邮箱 magic link 仍可见、可提交。
- Google enabled 时，普通邮箱 magic link 仍可见、可提交，Google 只是附加入口。

不要作为 characterization 锁定：

- Google 按钮无条件显示。

该行为应进入 bug-fix tests：

- Google disabled 时不显示 Google 按钮和 divider。

### Credit Service

目标文件：

```text
w6/ima ima queencard/frontend/src/services/credit.ts
```

优先抽出或测试纯逻辑；如果短期难以单测，先写 integration test plan。

建议覆盖：

- balance 计算：`totalCredits`、`usedCredits`、`frozenCredits`、`availableCredits`。
- `expiringSoon` 计算。
- freeze 优先消耗更早过期的 package。
- insufficient credits 抛错。
- settle 后 frozen 减少，transaction 写入。
- release 后 remaining 恢复，frozen 减少。

### API Guards

目标文件：

```text
w6/ima ima queencard/frontend/src/app/api/v1/credit/balance/route.ts
w6/ima ima queencard/frontend/src/app/api/v1/credit/history/route.ts
w6/ima ima queencard/frontend/src/app/api/v1/admin/credits/add/route.ts
```

可先用 route handler 层集成测试或轻量 mock：

- `/api/v1/credit/balance` 未登录返回 `401`。
- `/api/v1/credit/history` 未登录返回 `401`。
- admin credit API 非 admin 返回 `403`。

## 第一批 Bug-Fix Tests

这些测试不要求在 safety net 阶段全部通过。可以先用 `test.todo`、`describe.skip` 或独立文档记录，等对应 phase 再启用。

- Webhook GET 应返回 `405` 或不可用。
- `invoice.payment_succeeded` 不应读取 checkout session payload。
- 同一 Stripe event 重复投递两次，本地状态不变。
- `invoice.payment_succeeded` 先于 `checkout.session.completed` 到达，最终状态正确。
- Checkout 使用稳定 `stripeCustomerId`，不反复创建 Stripe Customer。
- success URL 包含 `{CHECKOUT_SESSION_ID}`。
- Google disabled 时不显示 Google 按钮。
- 普通邮箱注册/登录在 Google disabled/enabled 两种状态下都保持可用。
- Magic link rate limit 生效。
- Welcome credits 并发只发一次。
- Production 下 admin credit API 默认 `404`。

## 最小 Smoke Matrix

测试安全网建立后，仍需保留人工/浏览器 smoke：

```text
/
/prompts
/pricing
/login
/register
/credits
```

重点确认：

- 页面能正常打开。
- 主要按钮可点击。
- 未登录状态不会白屏。
- prompt case modal 可打开。
- 生成 URL 可构造。
- toast 可见。

## 执行顺序

```text
1. cd w6/ima ima queencard/frontend
2. 安装测试依赖与配置 Vitest
3. 先写 buildPromptTryUrl 单元测试
4. 再写 CheckoutButton 组件测试
5. 再写 Pricing/Auth 组件或页面测试
6. 再补 API guard 轻量测试
7. 对难以立即测试的 credit service 写清楚 fixture/mocking plan
8. 运行 pnpm test
9. 运行 pnpm run lint
10. 运行 pnpm run build:prod
```

## 验收标准

必须满足：

- 新增测试框架配置。
- 新增测试脚本。
- 第一批 characterization tests 在当前代码下通过。
- 已知 bug 没有被错误锁定为长期正确行为。
- bug-fix tests 已以 TODO、skip 或后续 phase 任务形式明确记录。
- `pnpm test` 通过。
- `pnpm run lint` 通过。
- `pnpm run build:prod` 通过。

## 后续关系

本文件应先于后续 implementation plan 执行。

推荐后续顺序：

```text
0004-imaima-queencard-test-safety-net.md
-> 0005-imaima-queencard-implementation-plan.md
-> code changes in w6/ima ima queencard/
-> code review
-> test-plan-review
```

如果后续已有其他 `0004/0005` 文档恢复到目录中，请按 `.rules/spec-ledger-naming-rules.md` 重新顺延编号，避免规格账本编号冲突。

## Implementation Update - 2026-06-14

Safety-net implementation has been folded into
`specs/w6/0007-imaima-queencard-implementation-tasks.md`.

Completed automated coverage:

- `buildPromptTryUrl` characterization and bridge metadata tests.
- Checkout button empty `planId` and unauthenticated redirect tests.
- Pricing page smoke tests for plan rendering and disabled price state.
- Auth form email magic link tests with Google disabled/enabled behavior.
- Billing provider/env normalization tests.
- Stripe checkout/portal/webhook fixture tests.
- Admin credit API guard tests.

Current verification:

```text
pnpm test           10 files / 42 tests passed
pnpm run lint       passed
pnpm run build:prod passed
```

Deferred or partially covered:

- Credit service deep accounting tests remain outside this stop-the-bleeding
  round.
- Browser visual smoke was attempted with the in-app Browser and local Chrome
  headless. The in-app Browser timed out, and Chrome headless only produced a
  stable desktop home screenshot before timing out on later pages. HTTP smoke
  and production build still pass, but full desktop/mobile visual screenshots
  remain a follow-up.
