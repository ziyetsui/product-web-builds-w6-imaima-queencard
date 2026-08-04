# GPTProto 供应商余额保护

## 目标

避免 GPTProto 余额不足或暂时不可用时继续冻结用户积分、反复重试，或让新用户在不知情的情况下持续提交任务。

## 行为

1. GPTProto `402`，或响应内容明确为余额不足的 `403`，归类为 `GPTPROTO_INSUFFICIENT_BALANCE`。
2. 未配置备用路由时，当前任务立即失败并释放冻结积分；供应商熔断 15 分钟，新任务返回 `503` 和中文维护提示。
3. 配置备用密钥后，主路由遇到余额不足、限流、服务端错误或网络错误时，尝试一次备用 GPTProto 兼容路由。
4. 主路由恢复并成功生成后，清除熔断状态。
5. 首次事故及其后每 6 小时最多发送一次管理员邮件，避免告警风暴。
6. 如果配置了余额查询适配接口，Worker 每 15 分钟检查一次；余额低于默认 ¥500 时发出预警，余额为零时停止接收新任务。

## 环境变量

- `GPTPROTO_FALLBACK_API_KEY`：备用路由密钥。
- `GPTPROTO_FALLBACK_BASE_URL`：备用 GPTProto 兼容端点。
- `GPTPROTO_BALANCE_API_URL`：可选余额查询适配接口，返回 `{ "balanceCny": number }` 或 `{ "data": { "balanceCny": number } }`。
- `GPTPROTO_LOW_BALANCE_CNY`：预警线，默认 `500`。
- `GPTPROTO_BALANCE_CHECK_INTERVAL_MS`：检查间隔，默认 `900000`。

GPTProto 公开文档没有余额查询 API，因此 `GPTPROTO_BALANCE_API_URL` 在获得官方或自建适配接口前保持为空。系统不会用估算值冒充真实余额。

## 验收

- 余额不足不会进行无意义的三次任务重试。
- 失败任务不结算积分，冻结积分被释放。
- 熔断期间，新任务在冻结积分之前被拒绝。
- 备用路由成功时用户任务继续执行，同时管理员收到主路由异常提醒。
- 相同事故不会造成重复邮件轰炸。
