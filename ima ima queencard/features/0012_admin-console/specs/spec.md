# 0012 管理后台 · Admin Console

| 字段 | 内容 |
| --- | --- |
| 状态 | 规格草案，待评审 |
| 建议分支 | `feat/admin-console` → `.trees/admin-console/` |

## 目标

把散落的 admin API（用户/备注/充值/退款/审计）收拢成一个可日常运营的
控制台页面：查用户、调积分、看生成任务、管卡片库,每个动作都留痕。

## 背景（现状）

- 已有 API：`/api/admin/users`、`/api/admin/notes`、`/api/admin/recharges`
  （含 refund）、admin_audit_logs / admin_user_notes / admin_recharge_orders 表
- 关联历史：`features/0007_admin-recharge-management`
- 缺一个成体系的界面；运营动作目前靠接口直调

## 非目标

- 不做多角色权限体系（本期只有 admin 一种角色；RBAC 另立 feature）
- 不做数据大盘/BI（另立 feature）
- 不改用户侧任何页面

## 设计

### 1. 页面结构（/admin 下）

| 页 | 能力 |
| --- | --- |
| 用户 | 按邮箱/ID 搜索；看积分余额、注册时间、备注；手工充值/扣减（必填理由） |
| 生成任务 | 按用户/状态/时间筛选 generation_tasks；看提示词、参考图、结果、失败原因；一键重试 |
| 充值订单 | admin_recharge_orders 列表；退款入口（对接 0011 的退款路径） |
| 卡片库 | 提示词卡片的上/下架与置顶（数据源为静态文件期间，先做只读预览 + 导出改动清单） |
| 审计 | admin_audit_logs 流水，不可删改 |

### 2. 权限与安全

- admin 身份判定沿用现有 session 机制（`user.role`/白名单邮箱,以现状为准）
- 所有写操作强制写 admin_audit_logs（操作人、对象、before/after、理由）
- 高危操作（扣积分、退款）二次确认

### 3. 实现约束

- 全部走现有 Next.js API route + drizzle,不引入新后端
- UI 复用现有组件体系与品牌样式（shadcn + 项目 token）

## 开放问题

- [ ] admin 判定现状是什么（role 字段?邮箱白名单?）——决定要不要先补一个门
- [ ] 卡片库管理是否要求「写」能力（意味着卡片数据从静态文件迁 DB,联动
      另立 feature）,还是本期只读即可？
- [ ] 生成任务的「重试」是否复用用户侧 regenerate 接口并免扣积分？
