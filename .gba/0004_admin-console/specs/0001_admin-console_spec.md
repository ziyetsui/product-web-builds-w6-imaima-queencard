# Admin Console 设计规格

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| Feature | `0004_admin-console` |
| 状态 | 已有充值管理基线；其余能力分阶段交付 |
| Owner admin | `iven_chloe@icloud.com` |
| 目标路由 | `/admin`、`/admin/recharges` |
| 当前运行代码 | `ima ima queencard/src/` |
| 创建/更新日期 | 2026-08-02 |

> 仓库说明仍把 `frontend/` 标为运行目录，但当前 admin 实现和可执行
> `package.json` 位于 `ima ima queencard/src/`。本 feature 不顺带搬迁目录；结构归一化应单独处理。

## 2. 功能意图

为产品所有者提供一个默认拒绝、操作可追溯的运营后台，减少直接调用 API、
直接改数据库造成的越权、重复充值和账实不一致风险。

### 2.1 目标

1. 只有授权管理员能够读取后台数据或执行运营动作。
2. 支持按用户定位、查看积分、人工充值、写运营备注和撤回未消费充值。
3. 每个写操作与审计日志处于同一数据库事务，成功操作的审计覆盖率为 100%。
4. 充值请求具备幂等保护；同一 `idempotencyKey` 最多产生 1 次积分发放。
5. 对查询规模、输入长度和单笔积分设置硬限制，避免无界输入。

### 2.2 非目标

- 本期不实现通用 RBAC、组织/租户权限或管理员邀请流程。
- 本期不实现 BI 大盘、批量充值、付款截图存储或完整工单系统。
- 不绕过现有 `credit_packages`、`credit_transactions` 积分账本。
- 不在本 feature 内迁移 `src/` 与 `frontend/` 的目录结构。

## 3. 用户与权限模型

| 角色 | 身份来源 | 可执行能力 |
| --- | --- | --- |
| 未登录 | 无有效 Better Auth session | 不可访问后台；页面跳登录，API 返回 401 |
| 普通用户 | 已登录且 `isAdmin=false`，邮箱不匹配 owner | 不可访问后台；页面跳首页，API 返回 403 |
| admin | `user.isAdmin=true`，或邮箱匹配 `ADMIN_EMAIL` 后自动提升 | 查询用户、人工充值、修改备注 |
| superadmin | admin 且邮箱命中 `SUPERADMIN_EMAILS`；列表为空时回退到 `ADMIN_EMAIL` | admin 全部能力、撤回充值 |

### 3.1 Owner admin 规则

- 内置 bootstrap owner 为 `iven_chloe@icloud.com`。
- `ADMIN_EMAIL` 可在部署环境显式覆盖；比较前必须 `trim` 并转小写。
- 示例部署值同时把该邮箱写入 `ADMIN_EMAIL` 与 `SUPERADMIN_EMAILS`，保证可执行撤回。
- 若 `SUPERADMIN_EMAILS` 配置为非空列表，它是 superadmin 的完整白名单，
  不再自动并入 `ADMIN_EMAIL`；变更时必须验证 owner 仍在列表中。
- 首次以 owner 邮箱登录时，如 `isAdmin=false`，服务端把该用户更新为
  `isAdmin=true`；不能依赖客户端字段授权。

### 3.2 安全边界

- 页面守卫只改善体验，所有 `/api/admin/**` 路由仍必须独立执行服务端鉴权。
- 401/403 响应不得包含用户列表、余额、订单、备注或审计详情。
- 高风险撤回仅限 superadmin，并要求 1～500 字理由和 UI 二次确认。
- 日志不得记录 session cookie、密钥、完整付款凭证图片或数据库连接串。

## 4. 信息架构

### 4.1 当前可交付范围（P0）

| 页面/接口 | 能力 | 状态 |
| --- | --- | --- |
| `/admin` | 重定向到充值管理 | 已实现 |
| `/admin/recharges` | 用户查询、积分摘要、分页、充值、备注、历史、撤回入口 | 已实现基线 |
| `GET /api/admin/users` | 用户/积分/最近充值列表 | 已实现 |
| `POST /api/admin/recharges` | 创建人工充值 | 已实现 |
| `POST /api/admin/notes` | 保存运营备注 | 已实现 |
| `POST /api/admin/recharges/:id/refund` | 撤回未消费充值 | 已实现 |

### 4.2 后续范围（P1/P2）

| 模块 | 目标 | 优先级 |
| --- | --- | --- |
| 生成任务 | 按用户、状态、时间筛选；查看失败原因；受控重试 | P1 |
| 审计查询 | 只读查看 `admin_audit_logs`，按动作/操作者/时间筛选 | P1 |
| 充值订单 | 独立订单列表、状态筛选、人工复核队列 | P1 |
| 卡片库 | 静态数据阶段只读预览与导出改动清单 | P2 |
| RBAC | 管理员授予/撤销、细粒度权限 | 独立 feature |

## 5. 交互设计

### 5.1 用户充值管理页

- 顶部显示用户总数、当前页用户数、当前页可用积分、今日人工充值积分。
- 搜索支持邮箱、用户名、用户 ID、外部付款凭证；搜索词前后空格被忽略。
- 默认每页 50 条，允许 1～100 条；页码下限为 1。
- 充值状态支持：全部、已人工充值、从未人工充值。
- 用户行展示可用/冻结/已用/总积分、最近充值和最新备注。

### 5.2 人工充值

| 字段 | 规则 |
| --- | --- |
| `userId` | 必填，目标用户必须存在 |
| `credits` | 1～10,000 的整数 |
| `amountCents` | 可选，非负整数 |
| `currency` | `CNY` 或 `USD`，默认 `CNY` |
| `paymentChannel` | `wechat`、`alipay`、`bank`、`other` |
| `externalPaymentNo` | 可选；非空凭证号不得重复履约 |
| `remark` | 必填，1～500 字 |
| `idempotencyKey` | 必填，8～120 字符 |

成功后应在同一事务内创建人工充值订单、积分包、积分流水和审计日志。
任一步失败时，四者全部回滚。积分默认有效期为 365 天。

### 5.3 备注与撤回

- 备注最多 500 字，每次修改保留一条历史并写审计。
- 充值历史单次最多返回最近 20 条。
- 仅 `FULFILLED` 订单可撤回；只撤回尚未消费的积分。
- 无法全额撤回时状态改为 `PARTIALLY_REVOKED`，并设置
  `manualReviewRequired=true`；不得把余额扣为负数。

## 6. 数据与事务设计

| 数据表 | 用途 | 关键约束 |
| --- | --- | --- |
| `user` | Better Auth 用户与 `isAdmin` | owner 登录后可服务端提升 |
| `admin_recharge_orders` | 人工充值业务单 | `orderNo`、`idempotencyKey` 唯一 |
| `credit_packages` | 可消费积分包 | 充值/撤回均走账本 |
| `credit_transactions` | 积分流水与余额快照 | 禁止直接改余额替代流水 |
| `admin_user_notes` | 用户运营备注历史 | 记录操作者与时间 |
| `admin_audit_logs` | 后台写操作审计 | 与业务写入同事务 |

审计最少包含：`actorUserId`、`targetUserId`、`action`、`entityType`、
`entityId`、`before`/`after`、`ipAddress`、`userAgent`、`createdAt`。

## 7. API 约定

- 成功：HTTP 2xx，`{ "success": true, "data": ... }`。
- 失败：`{ "success": false, "error": { "message", "details?" } }`。
- 未登录为 401、无权限为 403、输入不合法为 400、对象不存在为 404、
  未处理异常为 500。
- 校验错误可以返回字段级 details；500 响应不得回传堆栈或数据库错误原文。

## 8. 非功能指标

| 指标 | 验收阈值 |
| --- | --- |
| 权限隔离 | 6 类受保护入口的未授权阻断率 100% |
| 审计完整率 | 成功写操作 100% 有对应审计；失败操作 0 条伪成功审计 |
| 充值幂等 | 同 key 连续/并发提交，积分只增加 1 次 |
| 数据一致性 | 订单、积分包、流水、审计的事务一致率 100% |
| 输入边界 | 积分、页大小、备注、理由、幂等键边界测试 100% 通过 |
| 查询上限 | 页面 ≤100 用户/页；历史 ≤20 单/次 |
| 余额安全 | 撤回后可用积分永不小于 0 |
| 构建质量 | `pnpm test`、`pnpm run lint`、`pnpm run build:prod` 均退出 0 |
| 可用性 | 1440 px 与 390 px 视口无横向页面溢出，关键动作可键盘完成 |

## 9. 发布与回滚

1. 在预发布环境显式设置 `ADMIN_EMAIL=iven_chloe@icloud.com` 与
   `SUPERADMIN_EMAILS=iven_chloe@icloud.com`。
2. 执行迁移并核对三张 admin 表与索引存在。
3. 用 owner、普通用户、未登录会话完成权限冒烟。
4. 执行 1 笔最小充值、1 次重复幂等提交、1 次备注、1 次撤回。
5. 核对账本与审计后再发布；生产发布后重复只读和最小金额冒烟。

回滚应用版本前先停止后台写操作；数据库迁移优先向前修复，不直接删除含运营记录的表。
若 owner 配置错误，先在部署平台恢复上一版环境变量并重启服务，不通过数据库临时开放普通用户。
