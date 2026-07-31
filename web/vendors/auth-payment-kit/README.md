# Goya Auth + Payment Integration Kit

这个文件夹是从 Goya 项目中抽出的登录、支付、积分、邮件和数据库相关接入包，用来评估并迁移到其他 Next.js 项目。

## 已复制到哪里

- Goya 归档包：`/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/20-29 Product and Web Builds/w5/goya/my-next-app-extras/60_integration-kits/goya-auth-payment-kit`
- imaima queencard 参考包：`/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/20-29 Product and Web Builds/w6/product-web-builds-w6/web/frontend/_integration/goya-auth-payment-kit`

## 目录说明

- `copy-src/`：保持 Goya 原始相对路径的源码，可按需复制到目标项目。
- `config/`：环境变量模板、依赖清单、源项目参考配置。
- `docs/`：imaima queencard 接入说明和兼容性判断。

## 包含内容

- Better Auth 登录、magic link、用户 API、管理员校验。
- Drizzle/PostgreSQL schema 和数据库连接。
- Resend 邮件模板。
- Stripe checkout、webhook、订阅和用户账单服务。
- Creem 支付/订阅相关配置和 Better Auth 插件逻辑。
- 积分余额、积分历史、用户账单 API。
- 登录页、注册页、价格页、积分页和相关 UI 组件。
- Goya 的 `next-intl` 支撑文件，供保留 locale 路由时参考。

## 没有包含

- 没有复制 `.env.local`、真实 API key、数据库地址或 webhook secret。
- 没有复制数据库数据。
- 没有直接修改 imaima queencard 的运行源码或 `package.json`。

## 结论

可以复用，但建议分阶段接入。先接入登录和数据库，再接支付 webhook，最后接价格页/积分页 UI。imaima queencard 目前没有完整 auth/payment 系统，所以这个包适合作为迁移来源；不过 Goya 的产品文案、积分规则和部分 schema 仍带有视频产品痕迹，需要在 imaima queencard 正式上线前改成 imaima queencard 自己的业务语义。
