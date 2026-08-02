# 图片生成并发控制详细设计

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| Feature | `0005_async-concurrency-processing` |
| 文档 | 并发控制详细设计 |
| 状态 | 已批准，待实施 |
| 协调后端 | PostgreSQL 持久 permit |
| 首版并发 | 全局 4、单用户 1、单 provider/model 2 |
| 创建日期 | 2026-08-02 |

## 2. 决策摘要

并发限制必须跨多个 worker 实例生效，因此不能只使用 Node.js 进程内 semaphore。首版使用
PostgreSQL 持久 permit：任务只有在一个短事务中同时获得全局、用户和 provider/model 三类
permit 后，才能进入 `running`。permit 与任务租约共享 owner、心跳和到期时间；worker 崩溃后，
过期 permit 自动回收，不依赖进程执行 finally。

固定初始值：

| 层级 | 限制 | scope key |
| --- | ---: | --- |
| 全局 | 4 | `global` |
| 单用户 | 1 | `user:{userId}` |
| provider/model | 2 | `provider:{provider}:{model}` |

## 3. 目标与非目标

### 3.1 目标

1. 任意 worker 数量下，活跃 provider 调用都不突破三层配置。
2. worker 崩溃后，并发容量在 150 秒内自动恢复。
3. 一个用户或热点模型达到上限时，其他用户和模型仍可执行。
4. 持续有新任务进入时，旧的可执行任务不会无限饥饿。
5. 配置调整不强杀在途任务，系统自然收敛到新上限。
6. 领取事务 P95 小于 100 ms，不能把 provider 延迟带入数据库锁。

### 3.2 非目标

- 不提供跨产品、跨数据库的通用配额服务。
- 不保证严格全局 FIFO；并发约束和公平性优先于绝对顺序。
- 不实现用户购买更高优先级或动态竞价。
- 不以 advisory session lock 作为长任务锁；连接池无法保证会话生命周期与任务一致。
- 不在首版用 Redis 分布式锁或第三方限流服务。

## 4. 并发不变量

| 编号 | 不变量 |
| --- | --- |
| CONC-I01 | 活跃全局 permit 数永远小于等于全局限制。 |
| CONC-I02 | 任一用户活跃 permit 数永远小于等于用户限制。 |
| CONC-I03 | 任一 provider/model 活跃 permit 数永远小于等于该桶限制。 |
| CONC-I04 | 任务进入 `running` 时必须同时持有三个 scope 的 permit。 |
| CONC-I05 | 三个 permit 要么全部获得，要么全部不获得。 |
| CONC-I06 | permit 的 owner、task version 和到期时间必须与任务租约一致。 |
| CONC-I07 | 非租约 owner 不能续期或释放其他 worker 的 permit。 |
| CONC-I08 | 过期 permit 不计入活跃并发，并可被后续任务原子接管。 |
| CONC-I09 | 任何配置错误都必须 fail fast，不能悄悄回退到无限并发。 |

## 5. 为什么不用进程内 semaphore

单进程 semaphore 只能限制本进程。Zeabur 扩容到两个 worker，每个进程限制为 4 时，系统实际
并发会变成 8；扩容数量越大，越容易突破 provider 限额。进程崩溃也无法向其他实例说明哪些
任务仍有效。

进程内 semaphore 仍可作为本地背压，防止单进程创建过多 Promise，但它不是并发事实来源。
最终允许执行的依据只有数据库 permit。

## 6. 数据模型

新增 `generation_concurrency_leases`：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `scope_key` | text | 与 `slot_number` 组成主键 |
| `slot_number` | integer | 从 1 开始，不得超过该 scope 当前限制 |
| `task_id` | text | 当前占用任务 |
| `task_version` | integer | 必须匹配任务领取版本 |
| `lease_owner` | text | 当前 worker ID |
| `expires_at` | timestamp | 与任务租约同一时间 |
| `heartbeat_at` | timestamp | 最近续租时间 |
| `acquired_at` | timestamp | 首次获得时间 |

约束与索引：

- 主键：`(scope_key, slot_number)`。
- 唯一：`(task_id, scope_key)`，一个任务在同一 scope 只能占一个槽。
- 索引：`(task_id)`，用于终态释放。
- 索引：`(expires_at)`，用于恢复扫描。
- `slot_number >= 1`。

permit 表只保留正在占用或尚未清理的槽，不预先为所有用户创建永久记录。过期记录可以被条件更新接管。

## 7. Scope 规范化

scope key 必须由服务端构造，用户输入不能直接参与 SQL 标识或作为未验证 key：

```text
global
user:{canonical-user-id}
provider:{canonical-provider}:{canonical-model}
```

provider 和 model 使用内部标准名，不使用任意展示名。scope key 最大长度 200 字符。构造后按字典序排序，
所有 worker 必须以相同顺序锁定三个 scope，降低死锁概率。

## 8. 原子领取与 permit 获取

### 8.1 候选选择

worker 只在本地仍有空闲执行槽时查询候选。查询顺序：

```sql
ORDER BY priority DESC, next_attempt_at ASC, created_at ASC
LIMIT 20
```

候选状态只能是 `queued` 或到期的 `retry_scheduled`。查询本身不把任务改成 `running`。

### 8.2 获取算法

对每个候选任务执行一个短事务：

1. `SELECT ... FOR UPDATE SKIP LOCKED` 锁定任务并再次验证状态和调度时间。
2. 读取经过校验的并发配置。
3. 构造并排序三个 scope。
4. 对每个 scope，从 `1..limit` 中选择第一个空闲或已过期 slot。
5. 使用 `INSERT ... ON CONFLICT` 或带 `expires_at <= now()` 条件的更新占用 slot。
6. 任一 scope 无可用 slot，回滚整个事务，任务保持原状态。
7. 三个 scope 全部成功后，把任务更新为 `running`，增加 attempt/version，并写入相同租约。
8. 提交事务，返回任务快照和租约 token。

不能先把任务设为 `running` 再逐个获取 permit，否则中途失败会制造“运行中但没有完整容量”的状态。

### 8.3 竞争处理

两个事务可能同时看到相同空闲 slot，主键冲突会使其中一个失败。失败者最多在当前 scope 内尝试下一个
slot；若所有 slot 均竞争失败，回滚并处理下一个候选。唯一冲突是正常竞争，不记录为系统错误，但计入
`generation_permit_contention_total`。

## 9. 心跳、释放和回收

### 9.1 心跳

worker 每 30 秒在一个事务中续期任务租约和三个 permit，新到期时间统一为 `now() + 120s`。
更新条件包含 `taskId + taskVersion + leaseOwner + expiresAt > now()`。四项更新任一不满足，视为执行权丢失。

### 9.2 正常释放

任务提交终态时，在同一事务内删除该 `taskId + taskVersion + leaseOwner` 的全部 permit，并清空任务租约字段。
删除数必须为 3；数量不符时仍优先保证任务和积分幂等，但增加高优先级一致性告警。

### 9.3 崩溃回收

recovery scanner 每 30 秒处理 `expires_at <= now()` 的记录。它先恢复对应任务，再删除或接管 permit。
过期 permit 从 SQL 判断上已不可阻塞新任务，因此即使清理器短暂延迟，也不能造成永久容量泄漏。

恢复目标：最后一次成功心跳后 120 秒 permit 到期，扫描器最多再等待 30 秒，因此总恢复时间不超过 150 秒。

## 10. 三层并发策略

### 10.1 全局限制

全局限制保护应用、数据库连接和整体 provider 成本。首版为 4。即使部署 8 个 worker 进程，也只有 4 个任务
能同时持有 `global` permit。

### 10.2 单用户限制

单用户限制为 1，防止一个用户批量提交后占满全部全局槽。达到限制的用户任务保留在队列中，调度器继续检查
其他候选。该规则同时简化同一用户积分冻结和展示顺序。

### 10.3 Provider/model 限制

每个 provider/model 桶限制为 2。不同模型使用不同 scope，因此热点模型限流时，其他模型仍可消耗剩余全局容量。
当 provider 发布明确限额后，可按内部配置覆盖某个桶，但不能超过全局上限。

## 11. 公平调度

严格 FIFO 会在队首任务的用户或 provider 已满时造成 head-of-line blocking。首版采用“有序候选 + 可运行跳过”：

- 每轮按优先级、到期时间和创建时间取最老 20 条。
- 对受限候选不改状态，继续尝试后续任务。
- 同一用户并发为 1，天然限制连续占用。
- 每轮结束后重新查询，不把候选长期缓存在进程内。

公平性验收：在至少 4 个用户持续提交的 100 任务测试中，最老可执行任务等待时间不得超过新任务 P95 等待时间
的 3 倍；任何可执行任务不得连续 10 个扫描周期被更晚创建、相同优先级的任务越过。

如果未来需要更严格公平性，再引入 per-user round-robin；首版不预设复杂调度器。

## 12. 本地背压与数据库压力

每个 worker 的本地 Promise 并发上限等于 `GENERATION_WORKER_CONCURRENCY`，默认 4。只有本地槽位空闲时才扫描。

轮询参数：

| 参数 | 默认值 |
| --- | ---: |
| 最小轮询间隔 | 1 秒 |
| 最大空闲退避 | 5 秒 |
| 候选批次 | 20 |
| 恢复扫描间隔 | 30 秒 |

两个空闲 worker 在最大退避时每小时约产生 1,440 次扫描；有工作时最坏约 7,200 次/小时。领取查询必须使用
可运行索引，禁止全表排序。若数据库 CPU 连续 5 分钟超过 70%，或领取事务 P95 超过 200 ms，触发容量告警。

## 13. 容量模型

理论吞吐上限近似为：

```text
tasks_per_hour = global_concurrency × 3600 / average_task_seconds
```

全局并发为 4 时：

| 平均任务时长 | 理论上限 | 建议按 70% 安全利用率规划 |
| ---: | ---: | ---: |
| 30 秒 | 480 个/小时 | 336 个/小时 |
| 60 秒 | 240 个/小时 | 168 个/小时 |
| 120 秒 | 120 个/小时 | 84 个/小时 |
| 300 秒 | 48 个/小时 | 33 个/小时 |

该表不包含 provider 自身排队和重试。扩容 worker 只能提高可用性与调度吞吐，不能突破全局 permit；提高业务吞吐必须
同时评估 provider 限额、积分风险和数据库容量后调整全局值。

## 14. 动态配置

```text
GENERATION_WORKER_CONCURRENCY=4
GENERATION_GLOBAL_CONCURRENCY=4
GENERATION_USER_CONCURRENCY=1
GENERATION_PROVIDER_MODEL_CONCURRENCY=2
GENERATION_QUEUE_CANDIDATE_BATCH=20
GENERATION_QUEUE_POLL_MIN_MS=1000
GENERATION_QUEUE_POLL_MAX_MS=5000
```

首版环境变量在进程启动时读取，不做远程热配置。修改配置后滚动重启 worker：

- 降低限制不终止在途任务；新任务等待活跃数自然降到新上限。
- 提高限制在新 worker 启动后的下一轮扫描生效。
- `user` 和 `provider/model` 限制不得大于全局限制。
- 所有限制范围为 1～100；批次范围为 1～100；轮询最小值不得低于 250 ms。

## 15. 限流与重试的关系

本地 permit 不等于 provider 速率限制。provider 返回 429 时：

1. 当前任务释放 permit，进入 `retry_scheduled`。
2. 使用 `Retry-After` 或设计规定退避计算下次时间。
3. 增加该 provider/model 的 429 指标。
4. 首版不自动修改配置，避免短时错误导致全局振荡。

若某桶 429 比例连续 5 分钟超过 5%，触发告警并由运营降低该桶配置；自动自适应限流作为后续独立设计。

## 16. 故障模式与处置

| 故障 | 系统行为 | 验收结果 |
| --- | --- | --- |
| worker 在获取 permit 后崩溃 | 120 秒到期，150 秒内恢复容量 | 不永久泄漏 |
| worker 失去租约后返回结果 | 拒绝旧版本提交 | 无重复资产/扣费 |
| 获取第 2 个 scope 失败 | 整个事务回滚 | 不留下部分 permit |
| 数据库连接中断 | 不开始新 provider 调用；在途任务等待重连或失去租约 | 最终恢复 |
| 配置从 4 降到 2 | 在途 4 个继续，新任务等待活跃数低于 2 | 无强杀 |
| provider/model 桶满 | 跳过该候选，尝试其他桶 | 无队首阻塞 |
| 清理器重复运行 | 条件更新/删除幂等 | 状态不倒退 |

## 17. 指标与告警

| 指标 | 目标/告警 |
| --- | --- |
| 全局活跃 permit | 永远 `<= configured_limit` |
| 用户活跃 permit | 永远 `<= 1` |
| provider/model 活跃 permit | 永远 `<= 2` |
| permit 获取事务 P95 | 目标 `<100 ms`；`>200 ms` 持续 5 分钟告警 |
| permit 竞争率 | `>20%` 持续 5 分钟告警并检查批次/worker 数量 |
| 过期 permit 数 | 任意非零均记录；`>5` 持续 5 分钟告警 |
| 队列深度 | `>100` 持续 5 分钟告警 |
| 最老等待时间 | `>60 秒` 持续 5 分钟告警 |
| 429 比例 | 单桶 `>5%` 持续 5 分钟告警 |

并发越界属于零容忍事件，单次发生立即触发高优先级告警并停止提高 rollout 百分比。

## 18. 测试边界

- 单元测试：scope 构造、配置校验、退避、候选排序和容量公式。
- PostgreSQL 集成测试：slot 竞争、三 scope 原子获取、续租、释放和过期接管。
- 多 worker 测试：8 个 worker 抢 1 个任务，以及 100 个混合任务。
- 动态配置测试：4→2→6，验证自然收敛和不强杀。
- 故障注入：领取后 kill、心跳中断、数据库短暂不可用、旧 worker 晚到提交。
- 压测：全局、用户和 provider/model 三个维度的峰值活跃数必须精确落在配置边界内。

详细步骤、数据集和通过标准见 `0003_async-concurrency_acceptance.md`。
