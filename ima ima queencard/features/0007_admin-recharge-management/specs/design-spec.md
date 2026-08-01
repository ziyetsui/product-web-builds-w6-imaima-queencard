# 后台充值管理系统设计 Spec

## 元数据

- 工作流：`w6`
- 项目：`admin-recharge-management-system`
- 项目目录：`w6/admin-recharge-management-system/`
- 关联产品目录：`w6/ima ima queencard/frontend/`
- 输入需求：`specs/w6/admin-recharge-management-system/0001-admin-recharge-management-system-prd.md`
- 本文件：`specs/w6/admin-recharge-management-system/0002-admin-recharge-management-system-design-spec.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`design-spec`
- 状态：设计初稿

## Summary

后台充值管理系统是 imaima queencard 的人工充值履约入口。它不新增独立余额字段，而是在管理员确认用户已线下付款后，通过现有积分包和积分流水体系给用户发放积分。

核心设计：

- 管理后台新增 `用户充值管理` 页面。
- 用户列表读取 Better Auth `user` 表、`Customer` 表和积分聚合结果。
- 人工充值写入新的 `admin_recharge_orders` 表作为运营订单和幂等记录。
- 积分发放复用 `creditService.recharge`，写入 `credit_packages` 和 `credit_transactions`。
- 所有充值、撤回、备注修改写入 `admin_audit_logs`。
- 权限分为 `admin` 和 `superadmin`，服务端强校验。

## Existing Context

现有项目已经具备以下积分相关结构：

- `user`：Better Auth 用户表，包含 `isAdmin`。
- `Customer`：业务客户表，关联订阅计划和支付客户 ID。
- `credit_packages`：积分包，记录初始积分、剩余积分、冻结积分、有效期。
- `credit_transactions`：积分流水，记录加减积分和余额快照。
- `credit_holds`：生成任务前冻结积分。
- `payment_fulfillments`：支付 webhook 履约幂等表。
- `creditService.recharge`：已有充值服务，可创建积分包和积分流水。

本设计新增人工充值专用订单和审计能力，但继续复用积分账本。

## Project Structure

首选在现有 Next.js app 内实现：

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
│   ├── services/
│   │   ├── admin-auth.ts
│   │   ├── admin-recharge.ts
│   │   └── admin-audit.ts
│   └── db/schema.ts
└── drizzle/
```

`w6/admin-recharge-management-system/` 可作为独立说明、原型或后续拆分项目目录；首轮工程实现建议直接落在 imaima queencard 现有 app 内，减少跨服务鉴权和积分同步成本。

## Data Model

### `admin_recharge_orders`

人工充值的业务订单和幂等记录。

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | serial | primary key |
| `orderNo` | text | unique，格式建议 `ADMIN_RECHARGE_${date}_${nanoid}` |
| `idempotencyKey` | text | unique，来自前端提交或服务端生成 |
| `userId` | text | 目标用户 ID |
| `adminUserId` | text | 操作管理员 ID |
| `credits` | integer | 正整数 |
| `currency` | text | 默认 `CNY` |
| `amountCents` | integer nullable | 付款金额，单位分 |
| `paymentChannel` | text nullable | `wechat`、`alipay`、`bank`、`other` |
| `externalPaymentNo` | text nullable | 外部付款凭证号 |
| `creditPackageId` | integer nullable | 关联 `credit_packages.id` |
| `status` | text | `PENDING`、`FULFILLED`、`PARTIALLY_REVOKED`、`REVOKED`、`FAILED` |
| `refundedCredits` | integer | 默认 0 |
| `manualReviewRequired` | boolean | 默认 false |
| `remark` | text nullable | 充值备注 |
| `metadata` | jsonb nullable | 扩展信息 |
| `fulfilledAt` | timestamp nullable | 发放完成时间 |
| `createdAt` | timestamp | default now |
| `updatedAt` | timestamp | default now |

索引：

- `uniqueIndex(admin_recharge_orders_order_no_idx).on(orderNo)`
- `uniqueIndex(admin_recharge_orders_idempotency_key_idx).on(idempotencyKey)`
- `uniqueIndex(admin_recharge_orders_external_payment_no_idx).on(externalPaymentNo)`，仅当 `externalPaymentNo is not null`
- `index(admin_recharge_orders_user_id_idx).on(userId)`
- `index(admin_recharge_orders_admin_user_id_idx).on(adminUserId)`
- `index(admin_recharge_orders_created_at_idx).on(createdAt)`

### `admin_user_notes`

用户级运营备注。只保存当前备注也可以，但建议保留历史。

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | serial | primary key |
| `userId` | text | 目标用户 ID |
| `adminUserId` | text | 操作管理员 ID |
| `note` | text | 备注内容 |
| `createdAt` | timestamp | default now |

索引：

- `index(admin_user_notes_user_id_idx).on(userId)`
- `index(admin_user_notes_created_at_idx).on(createdAt)`

### `admin_audit_logs`

后台高风险操作审计表。

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | serial | primary key |
| `actorUserId` | text | 操作人 |
| `targetUserId` | text nullable | 被操作用户 |
| `action` | text | `ADMIN_RECHARGE_CREATE`、`ADMIN_RECHARGE_REVOKE`、`ADMIN_NOTE_UPDATE` |
| `entityType` | text | 如 `admin_recharge_order` |
| `entityId` | text nullable | 关联实体 ID |
| `before` | jsonb nullable | 变更前摘要 |
| `after` | jsonb nullable | 变更后摘要 |
| `ipAddress` | text nullable | 请求 IP |
| `userAgent` | text nullable | 浏览器 UA |
| `createdAt` | timestamp | default now |

索引：

- `index(admin_audit_logs_actor_user_id_idx).on(actorUserId)`
- `index(admin_audit_logs_target_user_id_idx).on(targetUserId)`
- `index(admin_audit_logs_action_idx).on(action)`
- `index(admin_audit_logs_created_at_idx).on(createdAt)`

## Service Design

### `services/admin-auth.ts`

职责：

- 获取当前登录用户。
- 判断是否为 `admin` 或 `superadmin`。
- 为后台 API 提供统一鉴权。

接口草案：

```ts
type AdminRole = "admin" | "superadmin";

async function requireAdmin(minRole?: AdminRole): Promise<{
  id: string;
  email: string;
  role: AdminRole;
}>;
```

首期如果数据库只有 `isAdmin`，可先把 `isAdmin=true` 视为 `admin`，并通过环境变量 `SUPERADMIN_EMAILS` 或新增 `role` 字段识别 `superadmin`。

### `services/admin-recharge.ts`

职责：

- 查询后台用户列表。
- 聚合用户积分余额和最近人工充值信息。
- 创建人工充值订单。
- 调用 `creditService.recharge` 发放积分。
- 撤回人工充值中未使用的积分。

接口草案：

```ts
type CreateAdminRechargeInput = {
  userId: string;
  credits: number;
  amountCents?: number;
  currency?: "CNY" | "USD";
  paymentChannel?: "wechat" | "alipay" | "bank" | "other";
  externalPaymentNo?: string;
  remark: string;
  idempotencyKey: string;
};

async function createAdminRecharge(
  adminUserId: string,
  input: CreateAdminRechargeInput
): Promise<{ orderId: number; orderNo: string; packageId: number }>;
```

充值流程必须在一个事务中完成：

1. 校验管理员权限。
2. 校验目标用户存在。
3. 校验积分为正整数。
4. 使用 `idempotencyKey` 创建或复用 `admin_recharge_orders`。
5. 调用或内联等价于 `creditService.recharge` 的账本写入逻辑。
6. 更新 `admin_recharge_orders.creditPackageId/status/fulfilledAt`。
7. 写入 `admin_audit_logs`。

建议 `credit_transactions.transType` 使用现有 `SYSTEM_ADJUST`，备注为 `Admin recharge: ${orderNo}`。如果后续希望前台显示“人工充值”，可新增更明确的 enum `ADMIN_RECHARGE`，但首期不强制。

### `services/admin-audit.ts`

职责：

- 统一写后台审计日志。
- 封装 IP、UA、before/after 摘要。
- 确保审计失败不会静默吞掉高风险操作错误。

## API Contracts

### `GET /api/admin/users`

查询后台用户列表。

Query：

```text
q?: string
status?: active | blocked
rechargeStatus?: all | recharged | never_recharged
lowBalance?: boolean
page?: number
pageSize?: number
```

Response：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "userId": "user_123",
        "email": "buyer@example.com",
        "name": "Buyer",
        "status": "active",
        "role": "user",
        "createdAt": "2026-06-15T02:08:12.000Z",
        "isPaidUser": true,
        "inviteCode": "B00615",
        "availableCredits": 500,
        "frozenCredits": 0,
        "usedCredits": 0,
        "totalCredits": 500,
        "latestRecharge": {
          "orderNo": "ADMIN_RECHARGE_20260615_xxx",
          "credits": 500,
          "createdAt": "2026-06-15T06:22:00.000Z",
          "adminEmail": "admin@example.com"
        },
        "note": "-"
      }
    ],
    "page": 1,
    "pageSize": 50,
    "total": 290,
    "summary": {
      "totalUsers": 290,
      "currentPageUsers": 50,
      "currentPageAvailableCredits": 22060,
      "todayManualRechargeCredits": 1500,
      "todayManualRechargeUsers": 3
    }
  }
}
```

Rules：

- Requires `admin`.
- Search must trim whitespace.
- Pagination maximum `pageSize` is 100.

### `POST /api/admin/recharges`

创建人工充值。

Request：

```json
{
  "userId": "user_123",
  "credits": 500,
  "amountCents": 9900,
  "currency": "CNY",
  "paymentChannel": "wechat",
  "externalPaymentNo": "wx_20260615_001",
  "remark": "小红书私信付款，充值 500 积分",
  "idempotencyKey": "client_generated_uuid"
}
```

Response：

```json
{
  "success": true,
  "data": {
    "orderId": 1,
    "orderNo": "ADMIN_RECHARGE_20260615_abcd12",
    "packageId": 42,
    "availableCredits": 500
  }
}
```

Rules：

- Requires `admin`.
- `credits` must be integer between 1 and configured maximum.
- `remark` is required.
- Duplicate `idempotencyKey` returns the original successful result, not a second grant.
- Duplicate `externalPaymentNo` must fail by default.
- The endpoint never accepts raw SQL, direct balance override, or negative credits.

### `POST /api/admin/recharges/{id}/refund`

撤回人工充值的未使用积分。

Request：

```json
{
  "reason": "充错用户，撤回未使用积分"
}
```

Response：

```json
{
  "success": true,
  "data": {
    "refundedCredits": 300,
    "unrefundedCredits": 200,
    "manualReviewRequired": true,
    "availableCredits": 120
  }
}
```

Rules：

- Requires `superadmin`.
- Only orders created by `POST /api/admin/recharges` can be revoked here.
- Use `creditService.refundUnusedCredits` or equivalent transaction.
- Do not make the user's available balance negative.

### `POST /api/admin/notes`

更新用户运营备注。

Request：

```json
{
  "userId": "user_123",
  "note": "来自小红书，已付款 99 元"
}
```

Response：

```json
{
  "success": true,
  "data": {
    "userId": "user_123",
    "note": "来自小红书，已付款 99 元"
  }
}
```

Rules：

- Requires `admin`.
- Note maximum length 500 chars.
- Every update writes `admin_user_notes` and `admin_audit_logs`.

## UI Design

### Layout

后台首页保持截图中的朴素运营工具风格：

- 顶部大标题：`管理后台`。
- 顶部说明：强调后台用于充值管理、任务监控和用户明细。
- 左侧菜单：`用户充值管理`、`邀请码管理`、`风控配置`、`任务统计报表`、`用户任务明细`、`后台日志查看`。
- 主区域使用数据表，不做营销化 hero。

### 用户充值管理页

控件：

- 搜索框：placeholder `搜索邮箱/用户名/用户 ID/邀请码/付款凭证`。
- 查询按钮。
- 筛选器：充值状态、低余额、新注册时间范围。
- 表格列：用户、注册时间、角色、付费状态、可用积分、冻结积分、已消耗积分、最近充值、备注、操作。
- 行操作：
  - `+100`
  - `+500`
  - `自定义`
  - `备注`
  - `明细`

交互：

- 点击快捷充值后打开确认弹窗，而不是直接提交。
- 弹窗默认带入档位积分，可填写付款渠道、付款金额、外部凭证、备注。
- 成功后 toast 提示，并局部刷新该用户行。
- 失败时展示明确错误，如“付款凭证已使用”或“用户不存在”。

## Credit Ledger Rules

- 人工充值必须创建新的 `credit_packages` 记录。
- 人工充值必须创建新的 `credit_transactions` 记录。
- `orderNo` 使用 `admin_recharge_orders.orderNo`。
- `credit_transactions.transType` 首期使用 `SYSTEM_ADJUST`。
- `credit_packages.expiredAt` 默认当前时间加 365 天。
- 余额计算继续使用现有 `creditService.getBalance`。
- 生成任务冻结和结算逻辑不需要感知后台充值来源。

## Permission Rules

| 操作 | admin | superadmin |
|---|---:|---:|
| 查看用户充值列表 | 是 | 是 |
| 搜索用户 | 是 | 是 |
| 快捷充值 | 是 | 是 |
| 自定义充值 | 是 | 是 |
| 修改备注 | 是 | 是 |
| 查看充值明细 | 是 | 是 |
| 撤回充值 | 否 | 是 |
| 导出审计日志 | 否 | 是 |
| 修改充值档位 | 否 | 是 |

## Idempotency And Safety

- 前端每次打开充值弹窗生成 `crypto.randomUUID()` 作为 `idempotencyKey`。
- 后端对 `idempotencyKey` 建唯一索引。
- 后端对非空 `externalPaymentNo` 建唯一索引，降低同一付款凭证重复充值风险。
- 充值事务必须保证订单、积分包、积分流水、审计日志要么全部成功，要么全部失败。
- 重复提交同一 `idempotencyKey` 时返回原订单。
- 所有金额以分为单位保存，避免浮点误差。

## Tests

### Unit Tests

- `admin-auth.test.ts`
  - 非登录用户被拒绝。
  - 普通用户被拒绝。
  - admin 可充值。
  - superadmin 可撤回。
- `admin-recharge.test.ts`
  - 创建人工充值会写订单、积分包、积分流水。
  - 重复 `idempotencyKey` 不重复发放。
  - 重复 `externalPaymentNo` 被拒绝。
  - 0 或负数积分被拒绝。
  - 撤回只扣未使用积分。

### API Tests

- `GET /api/admin/users` 非管理员返回 403。
- `GET /api/admin/users?q=email` 返回匹配用户和积分摘要。
- `POST /api/admin/recharges` 成功后余额增加。
- `POST /api/admin/recharges/{id}/refund` 普通 admin 返回 403。

### Manual Smoke

1. 注册一个新用户。
2. 用管理员账号打开 `/admin/recharges`。
3. 搜索该用户邮箱。
4. 点击 `+500`，填写备注并确认。
5. 使用该用户登录前台，确认积分余额增加 500。
6. 查看积分历史，确认出现人工充值记录。
7. 用超级管理员撤回未使用积分，确认余额减少且不为负。

## Migration Plan

1. 添加 `admin_recharge_orders`、`admin_user_notes`、`admin_audit_logs` 表。
2. 添加 `admin-auth`、`admin-recharge`、`admin-audit` 服务。
3. 添加后台 API routes。
4. 添加后台页面和表格。
5. 接入现有 `creditService.recharge` 和 `creditService.refundUnusedCredits`。
6. 补测试。
7. 手动 smoke 验证。

## Acceptance Checklist

- [ ] 后台充值管理页面能显示最新注册用户。
- [ ] 搜索邮箱、用户名、用户 ID 至少一种方式可定位用户。
- [ ] `+100`、`+500` 快捷充值可用，且提交前有确认。
- [ ] 自定义充值可记录付款渠道、金额、凭证和备注。
- [ ] 充值成功后用户前台余额立即增加。
- [ ] 充值成功后积分历史出现对应记录。
- [ ] 重复提交同一充值请求不会重复发积分。
- [ ] 非管理员无法访问页面和 API。
- [ ] 超级管理员可撤回未使用积分。
- [ ] 所有充值、撤回、备注修改都有审计日志。

## Open Questions

- 是否要把 `admin` 和 `superadmin` 从 `user.isAdmin` 升级为独立 role enum？
- 普通管理员单笔充值上限建议是多少，1000、5000 还是更高？
- 付款截图是否需要上传到对象存储，还是首期仅记录文字凭证？
- 用户前台积分历史是否要把 `SYSTEM_ADJUST` 显示为“人工充值”？
- 是否需要把社媒来源记录成独立字段，如 `xiaohongshu`、`wechat`、`referral`？
