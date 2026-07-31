# imaima queencard 接入步骤

以下步骤以 imaima queencard 项目根目录为准：

`/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/20-29 Product and Web Builds/w6/product-web-builds-w6/web/frontend`

## 1. 安装缺少依赖

```bash
pnpm add @creem_io/better-auth@^0.0.12 better-auth@^1.4.17 drizzle-orm@^0.45.1 postgres@^3.4.5 stripe@14.15.0 resend@2.1.0 @t3-oss/env-nextjs@0.13.10 next-safe-action@^8.0.11 next-intl@^4.7.0 @react-email/button@0.2.1 @react-email/components@1.0.4 @react-email/html@0.0.12 zustand@5.0.3 @formatjs/intl-localematcher@0.5.4 negotiator@0.6.3
pnpm add -D drizzle-kit@^0.31.8 dotenv@^17.2.3 dotenv-cli@^11.0.0 tsx@^4.19.2 @types/negotiator@0.6.3 react-email@^5.2.5 @react-email/render@^2.0.3 @react-email/preview-server@5.2.5
```

如果决定去掉 Goya 的 locale 路由，可以先不装 `next-intl`、`@formatjs/intl-localematcher`、`negotiator`、`@types/negotiator`。

## 2. 合并环境变量

把 `config/env.auth-payment.example` 里的变量合并到 imaima queencard 的 `.env.local` 和 `.env.example`。

必须重新生成：

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM`
- `STRIPE_API_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Stripe/Creem 商品 ID

不要使用 Goya 的真实密钥。

## 3. 复制核心后端文件

从 `_integration/goya-auth-payment-kit/copy-src/` 中按路径复制：

- `src/db`
- `src/lib/auth`
- `src/lib/api/auth.ts`
- `src/lib/api/response.ts`
- `src/lib/api/error.ts`
- `src/lib/email.ts`
- `src/lib/emails`
- `src/mail`
- `src/payment`
- `src/services/billing.ts`
- `src/services/customer.ts`
- `src/services/credit.ts`
- `src/app/api/auth`
- `src/app/api/webhooks`
- `src/app/api/v1/credit`
- `src/app/api/v1/user`
- `src/app/api/v1/admin/credits`
- `drizzle.config.ts`

`src/env.mjs` 可以复制，但要和 imaima queencard 现有环境变量策略合并。

## 4. 建表

确认 `DATABASE_URL` 指向 imaima queencard 自己的 PostgreSQL 数据库，然后运行：

```bash
pnpm drizzle-kit push
```

如果你更想保留 migration 文件，先运行：

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

## 5. 跑通登录

先只验证：

- `/api/auth/[...all]`
- magic link 邮件发送
- session cookie
- `/api/v1/user/me`

imaima queencard 没有 locale 路由时，可以把 Goya 的 `src/app/[locale]/(auth)/login/page.tsx` 改成 `src/app/login/page.tsx`。

## 6. 接支付

二选一：

- Stripe：设置 `NEXT_PUBLIC_BILLING_PROVIDER=stripe`，配置 Stripe 商品/价格 ID，接入 `/api/webhooks/stripe`。
- Creem：设置 `NEXT_PUBLIC_BILLING_PROVIDER=creem`，替换 `src/config/pricing-user.ts` 中所有产品 ID。

本包保留两套来源代码，但 imaima queencard 上线时建议只启用一种。

## 7. 合并 UI

最后再合并：

- `src/components/user-auth-form.tsx`
- `src/components/sign-in-modal.tsx`
- `src/components/billing-form.tsx`
- `src/components/price`
- `src/components/credits`
- `src/hooks/use-*`
- `src/stores/credits-store.ts`

imaima queencard 已有 `src/components/ui`，建议只补缺少的 UI 组件，不整体覆盖。

## 8. 验证

至少跑：

```bash
pnpm lint
pnpm build
```

然后手动验证：

- 未登录访问受保护 API 返回 401。
- magic link 能收到并完成登录。
- Stripe checkout 能创建 session。
- Stripe webhook 能写入订阅/积分变化。
- `/api/v1/credit/balance` 和 `/api/v1/credit/history` 返回正常。
