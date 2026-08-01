# 后台充值管理系统实现计划

## 元数据

- 工作流：`w6`
- 项目：`admin-recharge-management-system`
- 项目目录：`w6/admin-recharge-management-system/`
- 关联产品目录：`w6/ima ima queencard/frontend/`
- 输入需求：`specs/w6/admin-recharge-management-system/0001-admin-recharge-management-system-prd.md`
- 输入设计：`specs/w6/admin-recharge-management-system/0002-admin-recharge-management-system-design-spec.md`
- 本文件：`specs/w6/admin-recharge-management-system/0003-admin-recharge-management-system-impl-plan.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`impl-plan`
- 状态：实现前计划

## Setup 记录

用户本次点名 `$speckit-implement`，但当前 `admin-recharge-management-system` 采用的是 `.rules/spec-ledger-naming-rules.md` 中的 Workstream Manual Spec Chain，不是标准 Spec Kit feature package。

已执行：

```bash
bash .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
```

结果：

```text
ERROR: Feature directory not found. Set SPECIFY_FEATURE_DIRECTORY or run the specify command to create .specify/feature.json.
ERROR: Failed to resolve feature paths
```

因此本文件不执行代码实现，也不标记 `tasks.md`。它按手工 spec ledger 生成实现计划，作为后续生成 implementation tasks 或直接实现的依据。

## Summary

本计划实现 imaima queencard 的后台充值管理模块，用于“社媒收款后人工给用户加积分”的运营闭环。

核心结论：

- 首版不新建独立后端。
- 在现有 `w6/ima ima queencard/frontend/` Next.js App Router 项目内增加 `/admin/recharges` 页面和 `/api/admin/*` 接口。
- 后台充值必须复用现有积分账本：`credit_packages`、`credit_transactions`、`creditService.getBalance`。
- 新增 `admin_recharge_orders` 记录人工充值订单和幂等键。
- 新增 `admin_user_notes` 记录用户运营备注历史。
- 新增 `admin_audit_logs` 记录充值、撤回、备注修改审计。
- 管理员权限复用现有 Better Auth 和 `user.isAdmin`，超级管理员首版由环境变量识别。

## Technical Context

| 项目 | 决策 |
|---|---|
| Language/Version | TypeScript 5.9，React 19，Next.js 16 App Router |
| Primary Dependencies | Drizzle ORM、Better Auth、Zod、Vitest、Radix UI/shadcn 可用组件、lucide-react |
| Storage | PostgreSQL，通过 Drizzle schema/migrations 管理 |
| Existing Credit System | `credit_packages`、`credit_transactions`、`credit_holds`、`creditService` |
| Auth | Better Auth，现有 `user.isAdmin` 和 `ADMIN_EMAIL` 自动管理员逻辑 |
| Testing | `pnpm test` 使用 Vitest；必要时补 service/API/page 级测试 |
| Target App | `w6/ima ima queencard/frontend/` |
| Dev Port | `8080` |
| Constraints | 不直接改余额字段；不让普通用户访问后台 API；充值必须幂等；撤回不能造成负余额 |

## Constitution Check

`.specify/memory/constitution.md` 当前不是本功能的标准 feature gate。本计划采用以下本地 gate：

- 人工充值必须进入积分包和积分流水，不能绕过账本。
- 所有后台 API 必须服务端鉴权。
- 加积分、撤回、备注修改必须有审计日志。
- 同一个 `idempotencyKey` 不得重复发放积分。
- 同一个非空外部付款凭证默认不得重复用于成功充值。
- 超级管理员撤回只能撤回未使用积分，不能把用户余额扣成负数。

## Implementation Decisions

### D1: 不建独立后端

Decision：首版作为现有 Next.js app 的 admin 模块实现。

Rationale：充值后台需要直接读写同一批用户、积分包、积分流水和登录态。拆独立后端会立刻引入跨服务鉴权、数据库权限、部署、CORS、会话共享和数据一致性问题。

Future split trigger：多个产品共用同一管理后台、管理员体系需要独立部署、或需要把后台域名单独隔离到 `backend.*`。

### D2: 超级管理员识别

Decision：首版不修改 `user` 表结构。`admin` 继续使用 `user.isAdmin=true`；`superadmin` 使用 `SUPERADMIN_EMAILS` 环境变量，缺省时兼容现有 `ADMIN_EMAIL`。

Rationale：最小迁移风险，同时满足撤回等高风险操作需要更高权限。

Future migration：若后台能力继续扩展，再把 `user` 表升级为 role enum。

### D3: 充值事务边界

Decision：新增 transaction-aware 的积分发放 helper，例如 `grantCreditsInTx`，让人工订单、积分包、积分流水、审计日志在同一个数据库事务里完成。

Rationale：现有 `creditService.recharge` 自己开启事务，直接调用会让 `admin_recharge_orders` 与积分账本的原子性不够清晰。抽出可复用 helper 可以同时保留现有外部调用行为。

### D4: 人工充值流水类型

Decision：首版使用现有 `CreditTransType.SYSTEM_ADJUST`，充值备注使用中文，如 `人工充值到账：ADMIN_RECHARGE_...`。

Rationale：现有 enum 已包含 `SYSTEM_ADJUST`，无需数据库 enum 迁移风险。前台 `credits/page.tsx` 对中文备注会直接展示备注文本。

Future migration：如果运营报表需要独立统计，可新增 `ADMIN_RECHARGE` trans type。

### D5: 付款截图

Decision：首版不上传付款截图，只记录付款渠道、金额、币种、外部付款凭证号和备注。

Rationale：避免对象存储、安全权限和隐私处理进入首版。截图可作为 P1 后续。

## Project Structure

新增或修改文件：

```text  
w6/ima ima queencard/frontend/
├── src/
│   ├── app/
│   │   ├── admin/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── recharges/page.tsx
│   │   └── api/admin/
│   │       ├── users/route.ts
│   │       ├── recharges/route.ts
│   │       ├── recharges/[id]/refund/route.ts
│   │       └── notes/route.ts
│   ├── components/admin/
│   │   ├── admin-shell.tsx
│   │   ├── admin-sidebar.tsx
│   │   ├── recharge-user-table.tsx
│   │   ├── recharge-dialog.tsx
│   │   ├── user-note-dialog.tsx
│   │   └── recharge-history-drawer.tsx
│   ├── config/
│   │   └── admin-recharge.ts
│   ├── db/
│   │   └── schema.ts
│   ├── lib/
│   │   ├── api/auth.ts
│   │   └── auth/env.mjs
│   └── services/
│       ├── admin-audit.ts
│       ├── admin-recharge.test.ts
│       ├── admin-recharge.ts
│       └── credit.ts
├── drizzle/
└── package.json
```

## Phase 1: Data Model And Migration

Files:

- `src/db/schema.ts`
- Drizzle migration output under `src/db/migrations/`

Tasks:

- Add `adminRechargeStatusEnum`:
  - `PENDING`
  - `FULFILLED`
  - `PARTIALLY_REVOKED`
  - `REVOKED`
  - `FAILED`
- Add `adminAuditActionEnum` or text constants:
  - `ADMIN_RECHARGE_CREATE`
  - `ADMIN_RECHARGE_REVOKE`
  - `ADMIN_NOTE_UPDATE`
- Add `admin_recharge_orders` table:
  - `id`
  - `orderNo`
  - `idempotencyKey`
  - `userId`
  - `adminUserId`
  - `credits`
  - `currency`
  - `amountCents`
  - `paymentChannel`
  - `externalPaymentNo`
  - `creditPackageId`
  - `status`
  - `refundedCredits`
  - `manualReviewRequired`
  - `remark`
  - `metadata`
  - `fulfilledAt`
  - `createdAt`
  - `updatedAt`
- Add `admin_user_notes` table:
  - `id`
  - `userId`
  - `adminUserId`
  - `note`
  - `createdAt`
- Add `admin_audit_logs` table:
  - `id`
  - `actorUserId`
  - `targetUserId`
  - `action`
  - `entityType`
  - `entityId`
  - `before`
  - `after`
  - `ipAddress`
  - `userAgent`
  - `createdAt`
- Add indexes:
  - unique `orderNo`
  - unique `idempotencyKey`
  - unique non-empty `externalPaymentNo` if supported by Drizzle partial unique index
  - indexes on `userId`, `adminUserId`, `status`, `createdAt`
- Export inferred types from `schema.ts`.
- Generate migration with:

```bash
cd "w6/ima ima queencard/frontend"
pnpm db:generate
```

Acceptance:

- Migration compiles.
- `schema.ts` exports the new table definitions and types.
- Existing `pnpm test` does not fail because of enum/table imports.

## Phase 2: Config And Auth

Files:

- `src/config/admin-recharge.ts`
- `src/lib/auth/env.mjs`
- `src/lib/api/auth.ts`
- `src/lib/auth/admin.ts`

Tasks:

- Add config source of truth:

```ts
export const ADMIN_RECHARGE_CONFIG = {
  quickAmounts: [100, 500],
  defaultExpiryDays: 365,
  minCredits: 1,
  maxCreditsPerOrder: 10000,
  supportedCurrencies: ["CNY", "USD"],
  paymentChannels: ["wechat", "alipay", "bank", "other"],
};
```

- Add `SUPERADMIN_EMAILS` env parsing, comma-separated.
- Add API-level `requireSuperAdmin(request)` in `src/lib/api/auth.ts`.
- Keep page-level `requireAdmin` in `src/lib/auth/admin.ts`.
- Define role resolution:
  - `superadmin` if email in `SUPERADMIN_EMAILS`.
  - fallback `superadmin` if email equals existing `ADMIN_EMAIL`.
  - `admin` if `user.isAdmin`.

Acceptance:

- Existing admin auth behavior remains compatible.
- API helpers return 401 for unauthenticated, 403 for non-admin.
- Superadmin check can be tested without browser redirects.

## Phase 3: Credit Service Refactor

Files:

- `src/services/credit.ts`
- `src/services/admin-recharge.test.ts`

Tasks:

- Extract reusable transaction helper:

```ts
async function grantCreditsInTx(trx, params: {
  userId: string;
  credits: number;
  orderNo: string;
  transType: CreditTransType;
  expiryDays: number;
  remark: string;
}): Promise<{ packageId: number; balanceAfter: number }>;
```

- Keep public `creditService.recharge` behavior unchanged by delegating to the helper.
- Ensure `CreditTransType.SYSTEM_ADJUST` can be used by admin recharge.
- Keep `creditService.refundUnusedCredits` for revoke path.

Acceptance:

- Existing credit tests continue to pass.
- Admin service can write order + package + transaction + audit in one transaction.
- User balance calculation still uses active, unexpired `credit_packages`.

## Phase 4: Admin Audit Service

Files:

- `src/services/admin-audit.ts`
- `src/services/admin-recharge.test.ts`

Tasks:

- Implement `writeAdminAuditLog`.
- Normalize request metadata:
  - `actorUserId`
  - `targetUserId`
  - `action`
  - `entityType`
  - `entityId`
  - `before`
  - `after`
  - `ipAddress`
  - `userAgent`
- Keep audit log inside the same transaction for recharge and revoke operations.

Acceptance:

- Successful recharge writes one audit log.
- Successful note update writes one audit log.
- Successful revoke writes one audit log.

## Phase 5: Admin Recharge Service

Files:

- `src/services/admin-recharge.ts`
- `src/services/admin-recharge.test.ts`

Service functions:

```ts
async function listAdminRechargeUsers(params): Promise<AdminRechargeUserList>;
async function createAdminRecharge(adminUser, input, requestMeta): Promise<CreateResult>;
async function revokeAdminRecharge(superAdminUser, orderId, input, requestMeta): Promise<RevokeResult>;
async function updateAdminUserNote(adminUser, input, requestMeta): Promise<NoteResult>;
async function getAdminRechargeHistory(userId): Promise<HistoryResult>;
```

Implementation details:

- `listAdminRechargeUsers`
  - Query `user` and optional `Customer`.
  - Aggregate active, unexpired `credit_packages`.
  - Aggregate used credits from package math or `credit_transactions`.
  - Join latest `admin_recharge_orders`.
  - Join latest `admin_user_notes`.
  - Support `q`, `rechargeStatus`, `lowBalance`, `page`, `pageSize`.
- `createAdminRecharge`
  - Validate input with Zod.
  - Check target user exists.
  - Create `orderNo` using date + `nanoid`.
  - Use `idempotencyKey` unique constraint.
  - Reject duplicate non-empty `externalPaymentNo`.
  - Grant credits with `SYSTEM_ADJUST`.
  - Write audit log.
  - Return current balance.
- `revokeAdminRecharge`
  - Fetch fulfilled admin order.
  - Call `creditService.refundUnusedCredits` or transaction-equivalent logic.
  - Update order status to `REVOKED` or `PARTIALLY_REVOKED`.
  - Record `manualReviewRequired` if not all credits could be revoked.
  - Write audit log.
- `updateAdminUserNote`
  - Insert note history.
  - Return latest note.
  - Write audit log.

Acceptance:

- Duplicate idempotency key returns original result without second package.
- Duplicate external payment number fails by default.
- Revoke never creates negative available credits.
- List response matches design contract shape.

## Phase 6: Admin API Routes

Files:

- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/recharges/route.ts`
- `src/app/api/admin/recharges/[id]/refund/route.ts`
- `src/app/api/admin/notes/route.ts`

Tasks:

- Use `requireAdmin(request)` for list/create/note routes.
- Use `requireSuperAdmin(request)` for revoke route.
- Use existing `apiSuccess` and `handleApiError` response helpers.
- Parse request JSON with Zod.
- Return stable JSON contracts from the design spec.
- Include request metadata for audit:
  - `x-forwarded-for`
  - `user-agent`

Acceptance:

- Non-admin receives 403.
- Invalid payload receives 400 with useful message.
- Successful create returns `orderId`, `orderNo`, `packageId`, `availableCredits`.

## Phase 7: Admin UI

Files:

- `src/app/admin/layout.tsx`
- `src/app/admin/page.tsx`
- `src/app/admin/recharges/page.tsx`
- `src/components/admin/admin-shell.tsx`
- `src/components/admin/admin-sidebar.tsx`
- `src/components/admin/recharge-user-table.tsx`
- `src/components/admin/recharge-dialog.tsx`
- `src/components/admin/user-note-dialog.tsx`
- `src/components/admin/recharge-history-drawer.tsx`

UI requirements:

- Admin pages are utilitarian, data-dense, and consistent with screenshot reference.
- `/admin` redirects or links to `/admin/recharges`.
- `/admin/recharges` shows:
  - top title `管理后台`
  - short subtitle
  - left menu with `用户充值管理` active
  - summary stats
  - search input
  - user table
  - row actions `+100`、`+500`、`自定义`、`备注`、`明细`
- Quick recharge opens confirmation dialog.
- Custom recharge dialog supports:
  - credits
  - amount
  - currency
  - payment channel
  - external payment no
  - remark
- Note dialog supports editing user-level note.
- History drawer shows admin recharge history and audit summaries.

Implementation notes:

- Use client components for table actions and dialogs.
- Use stable column widths and horizontal scroll for dense table.
- Avoid nested cards; use one shell and table bands.
- Keep button text short and ensure no overflow on narrow widths.

Acceptance:

- Admin can find a user by email and trigger `+500`.
- Confirmation dialog prevents direct accidental recharge.
- Successful recharge refreshes table data.
- User row shows updated available credits.

## Phase 8: Frontend Credit History Polish

Files:

- `src/app/credits/page.tsx`

Tasks:

- Ensure admin recharge transaction shows a friendly user-facing title.
- Preferred approach: store Chinese remark from admin service:

```text
人工充值到账：500 积分
```

- If needed, add a mapping for `SYSTEM_ADJUST` remarks that start with `Admin recharge`.

Acceptance:

- User can see a clear recharge record in `/credits`.
- Existing Stripe/Creem credit labels remain unchanged.

## Phase 9: Tests

Files:

- `src/services/admin-recharge.test.ts`
- `src/app/admin/recharges/admin-recharges-page.test.tsx` if existing test setup supports page rendering
- API route tests if local patterns are already available

Required tests:

- Auth:
  - unauthenticated is rejected
  - non-admin is rejected
  - admin can create recharge
  - admin cannot revoke
  - superadmin can revoke
- Create recharge:
  - creates `admin_recharge_orders`
  - creates `credit_packages`
  - creates `credit_transactions`
  - creates `admin_audit_logs`
  - returns available balance
  - rejects invalid credits
  - rejects missing remark
  - rejects duplicate external payment no
  - is idempotent by `idempotencyKey`
- Revoke:
  - revokes unused credits
  - marks partial revoke when some credits were already used
  - never creates negative balance
- Notes:
  - inserts note history
  - writes audit log
- List:
  - returns latest users
  - filters by search query
  - includes balance summary

Validation commands:

```bash
cd "w6/ima ima queencard/frontend"
pnpm test
pnpm lint
pnpm build
```

## Phase 10: Manual Smoke

Prerequisites:

- Local database is migrated.
- At least one admin user exists.
- `ADMIN_EMAIL` or `SUPERADMIN_EMAILS` is configured.

Steps:

1. Start app:

   ```bash
   cd "w6/ima ima queencard/frontend"
   pnpm dev
   ```

2. Register or identify a normal test user.
3. Open `http://localhost:8080/admin/recharges` as admin.
4. Search the test user's email.
5. Click `+500`.
6. Fill remark: `测试人工充值`。
7. Confirm recharge.
8. Open `http://localhost:8080/credits` as the test user.
9. Confirm available credits increased by 500.
10. Confirm credit history shows the recharge.
11. Open admin history drawer and confirm audit information exists.
12. As superadmin, revoke the recharge.
13. Confirm unused credits are removed and balance is not negative.

## Rollback Plan

- If UI has issues, hide `/admin/recharges` route from navigation and keep API inaccessible through permissions.
- If API create path has an issue, disable `POST /api/admin/recharges` by returning 503 while preserving list view.
- If migration has not been deployed, do not deploy UI/API code that imports new tables.
- If bad manual recharge happened, use revoke path for unused credits and mark used portion as manual review.

## Risks

| Risk | Mitigation |
|---|---|
| Existing code assumes only `isAdmin`, no `superadmin` | Use env-based `SUPERADMIN_EMAILS` first |
| Nested transaction around `creditService.recharge` is unclear | Extract transaction-aware grant helper |
| Duplicate external payment no with empty strings | Normalize empty strings to null before insert |
| Partial unique index support differs in Drizzle migration output | If partial unique is awkward, enforce duplicate check in service plus nullable unique only if safe |
| Admin table list query becomes slow | Add indexes and keep page size max 100 |
| User cannot recognize `SYSTEM_ADJUST` | Store Chinese remark for admin recharge |

## Out Of Scope

- Independent backend service.
- Payment screenshot upload.
- Automatic payment reconciliation.
- Multi-product shared admin platform.
- Full CRM pipeline.
- Admin role management UI.
- Export CSV or finance report.

## Completion Checklist

- [ ] `admin_recharge_orders` table exists.
- [ ] `admin_user_notes` table exists.
- [ ] `admin_audit_logs` table exists.
- [ ] `SUPERADMIN_EMAILS` or equivalent role check exists.
- [ ] Admin list API returns users and credit summaries.
- [ ] Admin create recharge API grants credits exactly once.
- [ ] Duplicate `idempotencyKey` does not double grant.
- [ ] Duplicate external payment no is rejected.
- [ ] Revoke API removes only unused credits.
- [ ] `/admin/recharges` page is usable by admin only.
- [ ] Quick buttons `+100` and `+500` open confirmation before submit.
- [ ] User `/credits` page shows manual recharge clearly.
- [ ] Audit logs are written for recharge, revoke, and note updates.
- [ ] `pnpm test` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm build` passes, or unrelated blockers are documented.

## Next Spec Ledger Step

Recommended next document:

```text
specs/w6/admin-recharge-management-system/0004-admin-recharge-management-system-implementation-tasks.md
```

That document should split this implementation plan into task IDs, dependencies, parallel markers, and exact file-level work items.
