# imaima queencard 兼容性判断

## 可以复用

- `better-auth` 登录体系：server auth、client auth、magic link 邮件、登录 API。
- `drizzle-orm` + PostgreSQL：用户、session、account、verification、customer、subscription、credit transaction 等表。
- 支付服务层：Stripe checkout、subscription 查询、webhook 处理。
- Creem 支付配置：如果继续使用 Creem，可以复用产品和 webhook 逻辑。
- 积分系统：新用户赠送、购买积分、消费/历史记录、余额查询。
- 登录弹窗、登录表单、价格卡片、积分页等 UI，可作为参考组件。

## 需要适配

- imaima queencard 是 Next 16，Goya 是 Next 15。大部分 App Router 代码可以迁移，但正式接入后要跑 `pnpm build` 验证。
- imaima queencard 现在没有 `next-intl` 路由结构；Goya 的页面在 `src/app/[locale]/...`。可以保留 locale，也可以改成普通 `/login`、`/register`、`/pricing`、`/credits`。
- imaima queencard 已有自己的 `src/components/ui` 和 `src/lib/utils.ts`。不要盲目覆盖，建议逐个合并缺少的 UI 组件。
- imaima queencard 已安装 Supabase SDK，但 Goya 的登录/支付使用 Better Auth + Drizzle/PostgreSQL。建议二选一作为主用户系统，避免同一个项目同时维护两套用户身份。
- Goya 的 `src/db/schema.ts` 里包含一些历史表和视频业务表。迁移时可以先完整跑通，再删掉 imaima queencard 不需要的表。
- `src/config/pricing-user.ts` 里的产品 ID、套餐名、积分规则来自 Goya，需要替换为 imaima queencard 自己的 Stripe/Creem 商品。

## 推荐接入顺序

1. 只接数据库、auth、邮件和 `/api/auth/[...all]`。
2. 跑通 magic link 登录。
3. 接 Stripe 或 Creem 中的一种支付方式。
4. 接积分 API。
5. 最后迁移价格页、积分页、弹窗等 UI。

## 风险提醒

- 不要把 Goya 的 `.env.local` 直接复制到 imaima queencard。
- 不要直接覆盖 imaima queencard 的 `src/app/layout.tsx`、`src/app/providers.tsx`、`src/components/ui`。
- Stripe webhook 必须使用 imaima queencard 自己的 endpoint secret。
- 邮件发信域名需要在 Resend 后台为 imaima queencard 验证。
