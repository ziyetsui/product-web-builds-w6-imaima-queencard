# imaima queencard 注册登录规格

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 需求来源：`specs/w6/0001-imaima-queencard-instruction.md`
- 抽取来源：
  - `specs/w6/0003-imaima-queencard-refactor-analysis.md`
  - `specs/w6/0004-imaima-queencard-test-safety-net.md`
  - `specs/w6/0005-imaima-queencard-implementation-plan.md`
  - `specs/w6/0006-imaima-queencard-implementation-plan-review.md`
  - `specs/w6/0007-imaima-queencard-implementation-tasks.md`
- 本文件：`specs/w6/registration-login/0001-imaima-queencard-registration-login-spec.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`registration-login-spec`
- 状态：从 w6 既有规格中抽取的独立专题规格

## 命名说明

当前工作流采用人工维护的 spec ledger 形式：

```text
specs/{scope}/{optional-project}/000N-{project-slug}-{artifact-type}.md
```

本文件开启独立的注册登录子链：

```text
specs/w6/registration-login/0001-imaima-queencard-registration-login-spec.md
```

命名含义：

- `specs/w6`：第 6 工作流规格账本。
- `registration-login`：注册登录专题，使用 English kebab-case。
- `0001`：该专题子链第一份稳定规格。
- `imaima-queencard`：产品 slug。
- `registration-login-spec`：注册登录规格。

## 决策摘要

imaima queencard 的注册登录主路径是普通邮箱 magic link。`/login` 和 `/register` 可以复用同一个认证表单；两者都展示 email input 和 magic link submit。

Google OAuth 只是可选增强入口，不能替代或弱化邮箱注册登录。Google 未启用、未配置或登录失败时，邮箱 magic link 仍必须可见、可提交，并向用户提供明确反馈。

本专题不引入密码注册或密码登录字段。首次通过 magic link 登录时的用户创建由 Better Auth 负责。

## 当前注册登录流程

```text
访问 /login 或 /register
-> 输入 email
-> 提交 magic link
-> 邮件服务发送登录链接
-> 用户点击链接
-> Better Auth 创建 session
-> after hook 尝试发 welcome credits
```

核心约束：

- 普通邮箱注册/登录是必选主路径。
- 当前实现方式是 Better Auth magic link。
- 本轮不改成密码登录。
- Google OAuth 是可选 provider。
- Google OAuth 失败时应提示：`Google 登录暂不可用，请使用邮箱登录。`
- Magic link 成功请求后应出现“请检查邮箱”类提示。
- Magic link 失败时应出现“发送失败”类提示。

## 交互规格

### Magic link 单路径

当 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false`：

- 显示 email input。
- 显示 magic link submit。
- 隐藏 social divider。
- 隐藏 Google button。
- `/login` 和 `/register` 都可使用。

### Magic link + Google

当 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`：

- 显示 email input。
- 显示 magic link submit。
- 显示 social divider。
- 显示 Google button。
- Google 是附加入口，不是唯一入口。
- 邮箱 magic link 仍保持可见、可提交。

## 配置规格

Google 只有在启用时才必须存在服务端凭据：

```text
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
```

当 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` 但 `GOOGLE_CLIENT_ID` 或 `GOOGLE_CLIENT_SECRET` 缺失时，应用应在启动或 auth 初始化阶段给出明确错误。

生产 magic link 必要配置：

```text
NEXT_PUBLIC_APP_URL=https://<production-or-preview-domain>
BETTER_AUTH_SECRET=<production-secret>
EMAIL_PROVIDER=zeabur
ZEABUR_EMAIL_API_KEY=<zsend-api-key>
ZEABUR_EMAIL_FROM=<verified-sender>
ZEABUR_EMAIL_API_URL=https://api.zeabur.com/api/v1/zsend/emails
```

说明：

- `ZEABUR_EMAIL_API_URL` 可省略，代码默认使用 Zeabur ZSend API。
- 如果临时使用 Resend，必须显式设置 `EMAIL_PROVIDER=resend`、`RESEND_API_KEY`、`RESEND_FROM`，并在验证文档记录原因。
- `NEXT_PUBLIC_APP_URL` 必须与实际访问域名一致，否则 magic link callback 会回到错误域名。
- `BETTER_AUTH_SECRET` 必须在生产设置，不能使用默认 secret。
- Zeabur、Email、Stripe 等 secret 只能写入部署环境变量，不写入 spec、README 或 git。

## 涉及文件

前端认证 UI：

```text
w6/ima ima queencard/frontend/src/components/common/user-auth-form.tsx
w6/ima ima queencard/frontend/src/app/login/page.tsx
w6/ima ima queencard/frontend/src/app/register/page.tsx
```

认证与配置：

```text
w6/ima ima queencard/frontend/src/lib/auth/auth.ts
w6/ima ima queencard/frontend/src/lib/auth/client.ts
w6/ima ima queencard/frontend/src/lib/auth/env.mjs
w6/ima ima queencard/frontend/src/lib/email.ts
w6/ima ima queencard/frontend/.env.example
```

关联业务：

```text
w6/ima ima queencard/frontend/src/services/credit.ts
w6/ima ima queencard/docs/refactor-verification.md
```

## 已识别问题

- Google 按钮曾经无条件显示。
- 服务端 Google provider 只有 env 完整时才注册，导致前端可见入口和服务端能力可能不一致。
- Google sign-in 失败不能只写入 `console.error`，必须给用户可理解的 toast。
- welcome credits 写入逻辑在 auth hook 内，方向正确，但失败只记日志，需要保持幂等并避免并发重复发放。

## 实施任务

### Auth form 测试

- 增加邮箱输入校验测试。
- 增加 magic link 成功提示测试。
- 增加 magic link 失败提示测试。
- 增加 Google disabled 时隐藏 Google button 和 divider 的测试。
- 增加 Google enabled 时保留邮箱入口并显示 Google button 的测试。

### Auth form 实现

- 读取规范化后的 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`。
- Google disabled 时隐藏 Google button 和 social divider。
- Google enabled 时保留邮箱入口，同时显示 Google button。
- Google sign-in 失败时显示 toast。
- 确认 `/login` 和 `/register` 都使用 email magic link，不新增 password 字段。

### 服务端 auth 配置

- 仅在 `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` 时要求 Google credentials。
- Google enabled 但 credentials 缺失时 fail fast。
- 保持 Better Auth magic link 为邮箱注册登录主路径。

## 验收标准

- Google disabled 时，`/login` 和 `/register` 不显示 Google button。
- Google disabled 时，`/login` 和 `/register` 的邮箱 magic link 入口仍可见、可提交。
- Google enabled 时，`/login` 和 `/register` 的邮箱 magic link 入口仍可见、可提交。
- Google enabled 时，Google button 作为附加入口出现。
- Google enabled 但服务端配置缺失时，有明确配置错误。
- Google sign-in rejected 时，用户看到明确 toast。
- Magic link 成功请求后出现检查邮箱提示。
- Magic link 失败时出现发送失败提示。
- 不新增 password 字段。
- Magic link 首次登录即注册，用户创建由 Better Auth 负责。
- Welcome credits 并发只发一次。
- Magic link rate limit 生效。

## 部署与 smoke

Zeabur 部署前置：

- 操作者已登录 Zeabur。
- 目标 project/service 已确认。
- 生产域名或 preview URL 已确认。
- 环境变量已写入 Zeabur，而不是 repo。
- 前端服务已重启或重新部署。

生产/预览 smoke：

- 在 Zeabur URL 打开 `/login`。
- 输入真实邮箱，确认 magic link 邮件送达。
- 点击 magic link 后 callback 域名是当前 Zeabur 域名，不回到 `localhost`。
- 登录后 session 创建成功。
- 登录后 `/credits` 能看到当前账号状态。
- 在 Zeabur URL 对 `/register` 重复同一邮箱提交路径。
- 验证结果写入 `w6/ima ima queencard/docs/refactor-verification.md`，但不记录 magic link 或任何 secret。

## 禁止事项

- 不新增 password login/register 字段。
- 不让 Google OAuth 替代邮箱 magic link。
- 不在 Google disabled 时展示不可用 Google button。
- 不把 Zeabur token、邮箱 API key、Stripe key、magic link 明文写入 repo。
- 不在 Zeabur 登录、`NEXT_PUBLIC_APP_URL` 和 email provider smoke 未验证前标记生产部署完成。

## 来源摘录索引

- `0003-imaima-queencard-refactor-analysis.md`：登录/注册流程、认证交互修复、交互细节总表。
- `0004-imaima-queencard-test-safety-net.md`：Auth Form 可锁定行为、Google disabled/enabled 测试要求。
- `0005-imaima-queencard-implementation-plan.md`：Phase 3 登录可用性修复、Phase 8 Zeabur 登录和邮箱部署验收、环境变量与完成定义。
- `0006-imaima-queencard-implementation-plan-review.md`：明确 `/login` 和 `/register` 复用 magic link，不新增密码注册。
- `0007-imaima-queencard-implementation-tasks.md`：US3 Auth 任务、US7 Zeabur email/auth smoke 任务、禁止事项。
