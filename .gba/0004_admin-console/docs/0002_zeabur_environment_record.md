# Zeabur Production 环境配置记录

## 1. 变更信息

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-08-02 |
| Zeabur project | `imma` |
| Environment | `production` |
| Service | `queencard-frontend` |
| Domain | `https://queencard-imaima.zeabur.app` |
| 执行结果 | 已配置、已重启、线上健康检查通过 |

## 2. 配置结果

以下只记录状态，不记录敏感值：

| 变量 | 状态 | 验证 |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | 已轮换为新的 64 字符随机值 | 容器内存在、非空、非默认值 |
| `ADMIN_EMAIL` | 已设置 | 与 owner `iven_chloe@icloud.com` 精确匹配 |
| `SUPERADMIN_EMAILS` | 已设置 | 包含 owner `iven_chloe@icloud.com` |
| `DATABASE_URL` | 已保留 | 容器内非空 |
| `GPTPROTO_API_KEY` | 已保留 | 容器内非空 |
| `NEXT_PUBLIC_APP_URL` | 已保留 | 容器内非空 |

production 最终共有 22 项 service variables。原有 19 项业务变量从变更前仍在运行的容器恢复，未把值写入 Git 或本文档。

## 3. 重启与健康检查

- `queencard-frontend` 是 `PREBUILT_V2` 上传式服务，未绑定 GitHub repository；
  Zeabur 不允许对该服务执行 in-place redeploy。
- 已使用 service restart 使新环境变量进入运行容器，Zeabur 返回 restart success。
- 服务状态：`RUNNING`。
- 域名状态：`PROVISIONED`。
- `GET /`：HTTP 200，响应约 1.93 秒。
- 未登录 `GET /admin/recharges`：HTTP 307，跳转
  `/login?from=/admin/recharges`，说明页面鉴权入口生效。

由于 `BETTER_AUTH_SECRET` 已轮换，变更前的登录 session 会失效一次，用户需要重新登录，这是预期安全行为。

## 4. Git 历史核对结论

- Git 历史中的应用 `.env.example` 原先将三个变量留空，README 使用占位符，
  不能作为 production secret 来源。
- vendor/reference 与历史部署说明中存在示例或填充值，但无法证明与当前 production 一致，
  因此没有复用其中的 secret。
- production 配置以 Zeabur service variables 为唯一运行时来源；真实 secret 不提交 Git。

## 5. Zeabur CLI 避坑记录

本机 Zeabur CLI 为 `0.8.0`，平台提示最新版本为 `0.21.0`。旧版 CLI 在未显式指定
environment 时会出现变量视图/写入不一致。本次已恢复所有变量，后续必须遵守：

1. 所有 variable 命令同时提供明确的 service ID 与 production environment ID。
2. 写变量前后只输出 key、数量和布尔校验，不打印 variable list 原值。
3. 先导出/核对变量键集合，再做批量修改。
4. 优先升级 CLI；升级后先在非生产项目验证 create/update 的语义。
5. 上传式服务修改环境变量后使用 restart；只有绑定 Git repository 后才能 redeploy。

## 6. 后续人工验收

- [x] owner 已于 2026-08-02 使用 `iven_chloe@icloud.com` 重新登录。
- [x] `/admin/recharges` 成功进入管理页面：显示 6 个用户，owner 行角色为 `admin`。
- [x] 页面出现仅 superadmin 可执行的“撤回”入口，说明 `SUPERADMIN_EMAILS` 已生效。
- 在隔离测试用户上执行 1 积分充值并核对审计；不要使用真实付费用户做破坏性测试。
