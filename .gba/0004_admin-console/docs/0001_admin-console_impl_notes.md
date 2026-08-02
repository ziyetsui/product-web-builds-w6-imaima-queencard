# Admin Console 实现记录与交接

## 1. 当前实现摘要

截至 2026-08-02，当前 admin console 已具备人工充值管理基线：

- `/admin` 重定向到 `/admin/recharges`。
- Better Auth session + `user.isAdmin` 提供基础管理员权限。
- `ADMIN_EMAIL` 支持 owner 首次登录自动提升 admin。
- `SUPERADMIN_EMAILS` 限制撤回等高风险动作。
- 用户查询、人工充值、运营备注、充值历史和未消费积分撤回已接通。
- 充值、备注、撤回写入 `admin_audit_logs`。

本次把 bootstrap owner 调整为 `iven_chloe@icloud.com`：

- 代码默认值：`src/src/lib/auth/env.mjs`。
- 环境示例：`frontend/.env.example` 的 `ADMIN_EMAIL`、`SUPERADMIN_EMAILS`。

生产环境仍应显式配置这两个变量；代码默认值主要用于避免本地或新环境因漏配而失去 owner 入口。

## 2. 关键代码地图

| 职责 | 路径 |
| --- | --- |
| admin 页面入口 | `ima ima queencard/src/src/app/admin/` |
| admin API | `ima ima queencard/src/src/app/api/admin/` |
| 页面鉴权 | `ima ima queencard/src/src/lib/auth/admin.ts` |
| API 鉴权 | `ima ima queencard/src/src/lib/api/auth.ts` |
| 环境变量/owner 默认值 | `ima ima queencard/src/src/lib/auth/env.mjs` |
| 充值业务与校验 | `ima ima queencard/src/src/services/admin-recharge.ts` |
| 审计写入 | `ima ima queencard/src/src/services/admin-audit.ts` |
| 额度与分页限制 | `ima ima queencard/src/src/config/admin-recharge.ts` |
| 数据表 | `ima ima queencard/src/src/db/schema.ts` |
| 数据迁移 | `ima ima queencard/src/src/db/migrations/0004_admin_recharge_management.sql` |

## 3. 已确认的实现约束

- 人工充值：1～10,000 整数积分；remark 1～500 字；幂等键 8～120 字符。
- 备注/撤回理由：最多 500 字；撤回理由至少 1 字。
- 默认每页 50，最大每页 100；充值历史最多 20 条。
- 默认积分有效期 365 天；支持 CNY/USD 与微信/支付宝/银行/其他渠道。
- 撤回仅处理尚未消费积分；剩余无法撤回部分进入人工复核。
- 充值、积分包、积分流水、审计在同一事务内提交。

## 4. 决策记录

### D-001：单 owner 邮箱作为 bootstrap 门

使用 `iven_chloe@icloud.com` 作为默认 `ADMIN_EMAIL`。原因是当前产品为单 owner
运营阶段，引入完整 RBAC 会增加迁移与管理成本。触发多人运营时，应把管理员授予、撤销和角色拆成独立 feature。

### D-002：服务端权限是唯一可信边界

页面重定向不能替代 API 鉴权。每个 admin route 都必须调用 `requireAdmin` 或
`requireSuperAdmin`，客户端传入的角色字段一律不可信。

### D-003：superadmin 白名单非空时采用完整覆盖

当前实现只要 `SUPERADMIN_EMAILS` 非空，就以该列表为完整集合；否则才回退到
`ADMIN_EMAIL`。部署变更必须同时检查 owner 邮箱，否则 owner 可能保有 admin
但失去撤回权限。

### D-004：不直接修改余额

人工充值和撤回继续走积分包、积分流水与余额快照，以便追责和对账。任何“直接 update
余额字段”的实现都不符合本 feature 设计。

### D-005：不在本次处理目录漂移

仓库文档称 `frontend/` 为活动应用，但 admin 代码与 `package.json` 位于 `src/`。
本次只记录风险，不复制文件、不手工混合分支。目录归一化需单独计划、迁移和验收。

## 5. 已知缺口

| 缺口 | 风险 | 后续动作 |
| --- | --- | --- |
| admin 鉴权/充值 service 的自动化测试不足 | 回归时可能漏掉越权或幂等问题 | 按 acceptance 的 12 个最低断言补测 |
| 暂无审计查询页面 | 有日志但运营查看不便 | P1 增加只读审计页 |
| 暂无生成任务管理页 | 失败任务仍需其他方式处理 | P1 单独设计受控重试 |
| 暂无通用 RBAC | 多人运营时权限撤销成本高 | 另立 feature |
| 运行目录说明与代码不一致 | 命令、部署目标易选错 | 项目结构 feature 统一 |

## 6. 验证与证据

验收用例以 `../specs/0002_admin-console_acceptance.md` 为准。证据应放入：

```text
.gba/0004_admin-console/docs/evidence/<YYYYMMDD-HHmm>/
├── commands.txt
├── api-auth.txt
├── database-consistency.txt
├── desktop.png
└── mobile.png
```

不要提交 cookie、密钥、数据库 URL 或包含真实用户隐私的原始导出。

### 本次验证记录

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| owner 默认值与环境示例 | PASS | 代码默认值和两项环境示例均为 `iven_chloe@icloud.com` |
| `pnpm test` | PASS | 2026-08-02：18 个文件、90 个测试通过，含 owner 默认邮箱回归测试 |
| `pnpm run lint` | PASS | 2026-08-02：退出码 0 |
| `pnpm run build:prod` | PASS（有环境警告） | 2026-08-02：退出码 0；当前 shell 未配置 `BETTER_AUTH_SECRET`，构建期间 Better Auth 输出默认 secret 警告，部署前必须配置真实 secret |
| Zeabur production variables | PASS | owner、superadmin、新 auth secret 与关键既有变量均在重启后容器中通过脱敏校验 |
| Zeabur production health | PASS | service `RUNNING`；首页 200；未登录 admin 页面 307 跳登录 |

## 7. 部署交接

1. 部署环境显式设置 `ADMIN_EMAIL=iven_chloe@icloud.com`。
2. 设置 `SUPERADMIN_EMAILS=iven_chloe@icloud.com`；多人时用英文逗号分隔并保留 owner。
3. 重启/重新部署服务，使服务端环境变量生效。
4. owner 登录 `/admin/recharges`，确认数据库 `user.isAdmin=true`。
5. 普通账号访问后台必须失败；再完成 1 笔最小积分冒烟与审计核对。
6. 严禁把 `.env.local`、session、数据库连接串或支付密钥提交到 git。
