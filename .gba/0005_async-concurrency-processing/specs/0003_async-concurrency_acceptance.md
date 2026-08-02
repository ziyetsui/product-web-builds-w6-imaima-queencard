# 图片生成异步与并发处理验收规范

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| Feature | `0005_async-concurrency-processing` |
| 文档 | 验收、故障注入、容量与发布门禁 |
| 状态 | 已批准，待实施验证 |
| 关联设计 | `0001_asynchronous-processing_design.md`、`0002_concurrency-control_design.md` |
| 创建日期 | 2026-08-02 |

## 2. 验收原则

本 feature 只有在功能正确、数据一致、故障可恢复、并发不越界、性能达到目标且灰度证据完整时才能完成。
测试通过不以“接口返回成功”为准，而以任务、资产、积分账本和 permit 最终共同收敛为准。

以下四类问题实行零容忍：

1. 同一任务重复扣费；
2. 同一 `(taskId, outputIndex)` 产生重复有效资产；
3. 活跃 provider 调用突破任何一层并发限制；
4. worker 崩溃后任务或 permit 无法自动恢复。

任意一次零容忍事件都会阻止发布，不允许用“低概率”或人工改库作为豁免理由。

## 3. 验收门禁

| 门禁 | 通过标准 |
| --- | --- |
| G1 静态质量 | TypeScript、lint、相关单测、数据库集成测试、生产构建全部退出 0 |
| G2 功能 | 本文所有 P0 用例通过率 100% |
| G3 数据一致性 | 1,000 个混合任务中不一致记录数为 0 |
| G4 并发 | 全局/用户/provider-model 越界次数均为 0 |
| G5 恢复 | 所有 kill、超时和数据库中断场景最终自动收敛 |
| G6 性能 | API、领取事务、排队延迟达到本文 P95 阈值 |
| G7 可观测性 | 队列、租约、重试、错误、积分异常指标和日志均可查询 |
| G8 灰度 | 10% 生产灰度连续 24 小时无零容忍事件 |

## 4. 测试环境与依赖

### 4.1 必需环境

- 与生产同主版本的 PostgreSQL；测试使用独立数据库和独立 schema。
- 至少 8 个可并发启动的 worker 进程或独立 worker runtime 实例。
- 可控 fake provider，支持延迟、部分结果、429、5xx、断连、超时和重复结果。
- 可查询的结构化日志与指标收集端；本地可用内存 sink 代替远端平台。
- 测试积分账户和账本，不连接真实支付或真实 provider 计费账户。

### 4.2 固定配置

```text
GENERATION_WORKER_CONCURRENCY=4
GENERATION_GLOBAL_CONCURRENCY=4
GENERATION_USER_CONCURRENCY=1
GENERATION_PROVIDER_MODEL_CONCURRENCY=2
GENERATION_TASK_MAX_ATTEMPTS=3
GENERATION_LEASE_MS=120000
GENERATION_HEARTBEAT_MS=30000
GENERATION_PROVIDER_TIMEOUT_MS=300000
GENERATION_QUEUE_POLL_MIN_MS=1000
GENERATION_QUEUE_POLL_MAX_MS=5000
GENERATION_QUEUE_CANDIDATE_BATCH=20
```

需要验证时间行为的集成测试必须注入可控 clock，把 120 秒租约和退避推进为虚拟时间；进程 kill 和真实数据库
恢复测试保留少量 wall-clock 场景，避免完整测试套件等待数分钟。

## 5. 测试数据集

| 数据集 | 用户 | provider/model | 任务 | 用途 |
| --- | ---: | ---: | ---: | --- |
| D1 单任务 | 1 | 1 | 1 | 状态机、API、积分基本闭环 |
| D2 同任务竞争 | 1 | 1 | 1 | 8 worker 原子领取 |
| D3 单用户突发 | 1 | 2 | 20 | 用户并发上限 |
| D4 多用户单模型 | 10 | 1 | 100 | provider/model 和公平性 |
| D5 多用户多模型 | 20 | 4 | 1,000 | 混合压力和一致性 |
| D6 故障矩阵 | 4 | 2 | 60 | kill、超时、429、5xx、断库 |

每个任务使用稳定 `idempotencyKey`，预期输出数在 1～4 间均匀分布。fake provider 为每个任务记录开始、结束、
尝试次数和峰值活跃调用，作为并发断言的独立观测源。

## 6. API 与异步解耦验收

| ID | 优先级 | 场景 | 操作 | 通过标准 |
| --- | --- | --- | --- | --- |
| A-001 | P0 | 创建任务 | provider 延迟 60 秒时提交 | HTTP 202；响应不等待 provider；任务为 `queued` |
| A-002 | P0 | API 延迟 | 连续提交 100 次 | API P95 `<500 ms`，P99 `<1 s` |
| A-003 | P0 | route 隔离 | 禁止 worker 启动后提交 | route 未调用 provider，任务仍持久存在 |
| A-004 | P0 | 请求幂等 | 同用户同 key 并发提交 10 次 | 只返回 1 个 taskId、1 个积分 hold、1 条任务记录 |
| A-005 | P0 | key 隔离 | 两用户使用相同 key | 各自创建 1 个任务，互不冲突 |
| A-006 | P0 | 额度不足 | 可用积分低于预计值 | HTTP 402；无任务、无 hold |
| A-007 | P0 | 事务回滚 | 创建任务写入故障 | 无孤立 hold、无半写任务 |
| A-008 | P0 | 查询安全 | 查询运行中任务 | 不返回 leaseOwner、堆栈、provider 原始响应或凭证 |
| A-009 | P1 | 重新生成 | 对完成任务重新生成 | 创建新 taskId，parentTaskId 指向原任务 |

## 7. 状态机与重试验收

| ID | 优先级 | 输入 | 预期状态序列 | 通过标准 |
| --- | --- | --- | --- | --- |
| S-001 | P0 | 全部输出成功 | queued→running→succeeded | 尝试 1 次，资产数等于预期 |
| S-002 | P0 | 部分输出成功 | queued→running→partially_succeeded | 仅有效资产计费 |
| S-003 | P0 | 参数非法 | queued→running→permanently_failed | 只尝试 1 次，全部释放 hold |
| S-004 | P0 | 429 后成功 | queued→running→retry_scheduled→running→succeeded | 尝试 2 次，退避与 jitter 合法 |
| S-005 | P0 | 连续 5xx | 两次 retry 后 permanently_failed | 总尝试严格等于 3 |
| S-006 | P0 | 未分类异常后成功 | retry_scheduled 后成功 | error category 为 unknown，最终无残留错误状态 |
| S-007 | P0 | 非法状态转换 | 尝试 succeeded→running | 更新 0 行并增加 invalid transition 指标 |
| S-008 | P0 | 终态重复提交 | 同一 worker 重复 finalize 10 次 | 状态、资产和积分结果不变 |
| S-009 | P0 | Retry-After=600 秒 | provider 返回 429 | nextAttemptAt 至少 600 秒后且不超过 15 分钟上限 |

## 8. 原子领取与租约验收

| ID | 优先级 | 场景 | 通过标准 |
| --- | --- | --- | --- |
| L-001 | P0 | 8 worker 同时领取 1 任务 | 恰好 1 个成功，7 个无执行权 |
| L-002 | P0 | 领取后检查租约 | task 与三个 permit 的 owner、version、expiresAt 一致 |
| L-003 | P0 | 每 30 秒心跳 | 租约连续延长，任务不被恢复器接管 |
| L-004 | P0 | 心跳更新 0 行 | worker 进入 stale 状态，不提交终态 |
| L-005 | P0 | kill 当前 worker | 最后心跳后 `≤150 秒` 任务重新可领取 |
| L-006 | P0 | 旧 worker 晚到返回 | 旧 version 写入被拒；新 worker 结果保留 |
| L-007 | P0 | 获取第二个 scope 失败 | 事务全部回滚，没有部分 permit |
| L-008 | P0 | recovery scanner 重复执行 10 次 | 状态只转换一次，无重复 retry 或重复释放 |
| L-009 | P1 | SIGTERM 优雅停止 | 不领取新任务；在途任务继续心跳并在 330 秒窗口内完成或交还 |

## 9. 三层并发验收

fake provider 必须独立记录每次调用区间，通过区间重叠计算峰值，而不能只读取应用自己的 permit 计数。

| ID | 优先级 | 数据集 | 通过标准 |
| --- | --- | --- | --- |
| C-001 | P0 | D5，8 worker | 全局 provider 峰值 `≤4` |
| C-002 | P0 | D3，8 worker | 单用户峰值严格等于 1 |
| C-003 | P0 | D4，8 worker | 单 provider/model 峰值 `≤2` |
| C-004 | P0 | 两个 provider/model 各 20 任务 | 单桶满时另一桶仍可执行，且全局 `≤4` |
| C-005 | P0 | global 4→2 | 在途任务不终止；降到 2 前不启动新任务；最终峰值收敛到 2 |
| C-006 | P0 | global 2→6 | 滚动重启后下一轮扫描使用新增容量，无任务重复领取 |
| C-007 | P0 | 100 任务、4 用户持续提交 | 无可执行任务连续 10 轮被更晚同优先级任务越过 |
| C-008 | P0 | 同上 | 最老可执行任务等待时间 `≤` 新任务 P95 等待时间的 3 倍 |
| C-009 | P0 | permit 记录人工置为过期 | 后续任务可原子接管，不永久损失槽位 |
| C-010 | P0 | 非法并发配置 0、-1、101 | worker 启动失败，不回退无限并发 |

任一时刻出现 `global>4`、`user>1` 或 `provider/model>2`，即使最终数据一致，该轮验收仍失败。

## 10. 积分与资产一致性验收

| ID | 优先级 | 故障点 | 通过标准 |
| --- | --- | --- | --- |
| D-001 | P0 | provider 调用前 kill | hold 保留，恢复执行后只结算一次 |
| D-002 | P0 | provider 返回后、写资产前 kill | 恢复后资产只写一次 |
| D-003 | P0 | 写资产后、积分结算前 kill | 重试 finalize 后单资产、单结算 |
| D-004 | P0 | 积分结算后、写任务终态前 kill | 重试不重复结算，任务最终成功 |
| D-005 | P0 | provider 返回重复 outputIndex | 唯一约束阻止重复有效资产 |
| D-006 | P0 | 4 个预期输出只成功 2 个 | 只结算 2 个，释放剩余冻结，状态部分成功 |
| D-007 | P0 | 三次均无有效输出 | 任务永久失败，冻结全部释放 |
| D-008 | P0 | 同一 finalize 并发调用 10 次 | 有效资产、结算流水和终态各一份 |

D5 的 1,000 个混合任务完成后必须满足：

- 每个任务的有效资产数等于唯一 outputIndex 数。
- 每个 taskId 最多一组最终积分结算。
- `succeeded` 任务的资产数等于预期输出数。
- `partially_succeeded` 的资产数在 1 到预期数减 1 之间。
- `permanently_failed` 且无资产任务的冻结余额为 0。
- 非 `running` 任务不存在未过期 permit。
- 不一致记录总数严格等于 0。

## 11. 故障注入矩阵

| ID | 优先级 | 注入 | 持续/次数 | 通过标准 |
| --- | --- | --- | ---: | --- |
| F-001 | P0 | provider 429 | 连续 2 次 | 第 3 次成功；退避正确；无重复扣费 |
| F-002 | P0 | provider 500 | 连续 3 次 | 永久失败；总尝试 3；hold 释放 |
| F-003 | P0 | provider timeout | 300 秒边界 | 调用被中止或忽略；进入 transient 重试 |
| F-004 | P0 | worker `SIGKILL` | 领取后立即 | `≤150 秒` 恢复任务和 permit |
| F-005 | P0 | worker `SIGKILL` | provider 返回后 | 最终结果幂等收敛 |
| F-006 | P0 | PostgreSQL 不可用 | 30 秒 | 不启动新 provider；恢复后自动继续 |
| F-007 | P0 | 心跳更新失败 | 连续超过 120 秒 | 旧 worker 失权，新 worker 接管 |
| F-008 | P0 | recovery scanner 双实例 | 同时扫描 | 任务只恢复一次 |
| F-009 | P1 | Zeabur 滚动重启模拟 | 每 30 秒重启一个 worker | 队列持续处理，无越界和永久卡住 |

## 12. 性能与容量验收

### 12.1 测试方法

- 预热 2 分钟后采集 10 分钟稳定窗口。
- 至少运行 3 次，报告中位数和最差一次结果。
- API 压测不等待 provider；worker 压测使用 30、60、120 秒三档 fake 延迟。
- PostgreSQL 记录 CPU、连接数、锁等待、慢查询和表扫描。

### 12.2 阈值

| 指标 | 通过标准 |
| --- | --- |
| 创建任务 API | P50 `<200 ms`、P95 `<500 ms`、P99 `<1 s` |
| permit + claim 事务 | P50 `<30 ms`、P95 `<100 ms`、P99 `<200 ms` |
| 有容量时 queued→running | P95 `<5 s`、P99 `<10 s` |
| 崩溃恢复 | 最大值 `≤150 s` |
| worker 空队列查询 | 两 worker最大约 1,440 次/小时 |
| PostgreSQL CPU | 稳态 `<70%` |
| 数据库连接 | 峰值不超过连接池预算的 80% |
| 30 分钟终态收敛率 | `≥99.9%`；测试结束前 100% 进入终态，不允许永久卡住 |

理论吞吐与观测吞吐偏差超过 30% 时，必须解释 provider 排队、数据库等待、重试或配置限制；没有分析不得放行。

## 13. 可观测性验收

| ID | 场景 | 通过标准 |
| --- | --- | --- |
| O-001 | 正常任务 | 可按 taskId 串起创建、领取、心跳、provider、finalize 全链路 |
| O-002 | 队列积压 | 可查询 depth、oldest wait，并在阈值持续 5 分钟后告警 |
| O-003 | permit 过期 | expired 指标增加，包含 provider/model，不包含 userId 标签 |
| O-004 | 429 激增 | 单桶 429 比例超过 5% 持续 5 分钟触发告警 |
| O-005 | 积分异常 | 任意 inconsistency 指标大于 0 立即高优告警 |
| O-006 | 敏感信息 | 自动扫描日志，不出现 API key、DATABASE_URL、完整参考图 URL |
| O-007 | 健康检查 | running、draining、数据库不可用三种状态准确反映 |

## 14. 安全验收

- worker 使用独立 Zeabur 服务身份，只配置必需数据库和 provider 凭证。
- worker 不暴露公开任务执行接口；健康检查不返回配置值或连接信息。
- API 用户只能查询自己的任务和资产。
- `idempotencyKey` 长度为 8～120，按用户隔离，日志中截断或哈希。
- `leaseOwner`、task version、内部错误和 provider 原始结果不进入公开 API。
- 使用恶意 provider/model 字符串测试 scope key，不能造成 SQL 注入或无限指标标签。

## 15. 发布阶段与放行标准

### Stage 1：兼容迁移

- 新字段、索引、约束和 permit 表成功迁移。
- 旧 Web 代码仍可运行。
- 回滚演练证明不需要删除业务数据。

### Stage 2：测试环境

- 1 worker、并发 1。
- 所有 P0 自动化测试和故障注入通过。
- 连续处理 D5 的 1,000 个混合任务，无不一致和永久卡住。

### Stage 3：生产 10% 灰度

- worker 并发 2，`GENERATION_ASYNC_ROLLOUT_PERCENT=10`。
- 连续观察至少 24 小时。
- 零重复扣费、零重复资产、零并发越界、零不可恢复任务。
- API 和队列延迟达到阈值，429 比例低于 5%。

### Stage 4：生产全量

- rollout 提升到 100%，全局并发提升到 4。
- 移除 route 的 `after()` provider 执行路径。
- 连续观察 24 小时后，才允许删除旧执行开关；数据库兼容字段不删除。

## 16. 回滚条件与动作

### 16.1 立即停止扩量

- 任一零容忍事件；
- 领取事务 P95 `>200 ms` 持续 5 分钟；
- 数据库 CPU `>70%` 持续 5 分钟；
- 单桶 429 `>5%` 持续 5 分钟；
- 最老可执行任务等待 `>60 秒` 持续 5 分钟。

### 16.2 回滚动作

1. 把 rollout 调为 0，停止接收新的 worker 路由任务。
2. worker 停止领取新任务，保持在途任务心跳直至完成或租约过期。
3. 恢复旧执行开关前确认没有两个执行入口同时消费同一任务集合。
4. 保留全部任务、permit 历史证据和积分账本；不手工删除业务记录。
5. 形成故障报告和修复计划，通过相同验收后才能重新灰度。

## 17. 验证命令与证据

实现后至少执行：

```bash
pnpm vitest run src/services/generation-queue.test.ts
pnpm vitest run src/services/generation-concurrency.test.ts
pnpm vitest run src/workers/generation-worker.test.ts
pnpm run test
pnpm run lint
pnpm run build:prod
```

实施时按以上路径创建测试；如果计划拆分文件，必须同步更新本文并记录完整实际命令。

证据目录：

```text
.gba/0005_async-concurrency-processing/docs/evidence/{YYYYMMDD-HHmm}/
├── environment.md
├── commands.txt
├── unit-and-integration-tests.txt
├── concurrency-peak-results.json
├── lease-recovery-results.json
├── fault-injection-results.json
├── credit-consistency-results.json
├── performance-summary.md
├── metrics-and-alerts.md
└── rollout-observation.md
```

证据必须脱敏，不得提交真实用户 prompt、参考图片、cookie、密钥、数据库 URL 或 provider 凭证。

## 18. Definition of Done

- 两份设计文档的全部 P0 约束有代码、测试或运维配置对应。
- 本文所有 P0 用例通过，且证据可由另一位工程师复现。
- 1,000 个混合任务零数据不一致、零并发越界、零永久卡住。
- 10% 生产灰度连续 24 小时通过。
- runbook、Zeabur worker 启动命令、健康检查、告警和回滚步骤已写入 docs。
- 实现记录列出 commit、迁移、配置、验证命令、已知限制和后续负责人入口。
