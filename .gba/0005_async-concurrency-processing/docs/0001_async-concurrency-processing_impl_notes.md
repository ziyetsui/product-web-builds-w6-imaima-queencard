# 异步与并发处理实现记录与交接

## 1. 当前状态

截至 2026-08-04，本 feature 已完成持久队列、三层并发 permit、租约续期与恢复、幂等执行器、
独立 worker、API 纯入队切换、可观测性和本地隔离 PostgreSQL 量化验收。生产数据库迁移和
Zeabur worker 发布仍需由部署流程执行，不在本地验收中操作生产环境。

当前图片生成链路为：

1. route 调用 `createImageGenerationTask` 写入 `queued` 任务；
2. route 使用 `void runImageGenerationTask(...)` 在请求进程内启动生成；
3. service 通过条件更新把任务从 `queued` 改为 `generating`；
4. provider 完成后写入资产，并把任务更新为完成、部分成功或失败。

这种方式具备基础状态记录，但不是可恢复的持久异步队列。

## 2. 代码地图

| 职责 | 当前路径 |
| --- | --- |
| 创建/执行/查询生成任务 | `ima ima queencard/src/src/services/image-generation.ts` |
| 图片生成 API | `ima ima queencard/src/src/app/api/v1/image-generations/` |
| provider 适配与积分调用 | `ima ima queencard/src/src/services/image-provider.ts` |
| GPTProto 任务创建与轮询 | `ima ima queencard/src/src/services/gptproto.ts` |
| 生成任务与资产表 | `ima ima queencard/src/src/db/schema.ts` |
| 图片生成迁移基线 | `ima ima queencard/src/src/db/migrations/0003_image_generation_core.sql` |
| 积分冻结/结算/释放 | `ima ima queencard/src/src/services/credit.ts` |
| route 基线测试 | `ima ima queencard/src/src/app/api/v1/image-generations/route.test.ts` |
| service 基线测试 | `ima ima queencard/src/src/services/image-generation.test.ts` |

## 3. 已确认事实

- `generation_tasks.status` 默认值为 `queued`。
- 当前执行使用 `queued` 条件更新，重复启动时只有一个调用可首次进入 `generating`。
- route 不等待执行结果，但执行仍依赖同一个应用进程。
- 当前表有用户、状态、来源案例和创建时间索引。
- 当前 schema 没有租约、心跳、重试调度字段。
- 当前代码尚未形成共享的全局、每用户、每 provider/model 并发控制器。

## 4. 已批准的实施阶段

### Phase 1：数据与领取协议

- 增加 attempt、next-attempt、lease-owner、lease-expiry、heartbeat 字段和索引。
- 增加资产 `(task_id, output_index)` 唯一约束。
- 实现短事务原子领取、续租、终态提交和过期恢复。

### Phase 2：独立 worker

- 新增可单独启动和停止的 worker 入口。
- route 只创建任务并返回 202，不再 fire-and-forget 调用 provider。
- 支持优雅停止：停止领取，等待在途任务到安全点后退出。

### Phase 3：并发、重试与公平性

- 实现全局、用户和 provider/model 三层共享并发限制。
- 集中定义错误分类、硬超时、指数退避和最大尝试次数。
- 增加公平调度和陈旧任务优先机制。

### Phase 4：观测与灰度

- 增加结构化日志、队列指标和告警。
- 以低并发灰度，执行崩溃、超时、429、重复结果和积分故障注入。
- 验收通过后再逐步提高生产并发。

## 5. 已批准决策

| 决策 | 结论 | 依据 |
| --- | --- | --- |
| 首版队列后端 | PostgreSQL | 已有任务表，降低新增基础设施成本 |
| worker 部署 | 独立 Zeabur worker 服务 | 与 Web 生命周期隔离，可独立扩缩容 |
| 全局协调方式 | PostgreSQL 持久 permit | 跨 worker 生效且可随租约恢复 |
| 默认 worker 并发 | 4 | 先低并发灰度，再按 provider 限额调整 |
| 默认单用户并发 | 1 | 防止单用户占满队列 |
| 默认 provider/model 并发 | 2 | 隔离热点模型与上游限流 |
| 最大尝试次数 | 3 | 控制成本并覆盖常见临时故障 |
| 租约/心跳 | 120 秒/30 秒 | 允许长任务持续续租，崩溃后 150 秒内恢复 |
| provider 硬超时 | 300 秒 | 与当前 route 最大执行窗口一致 |
| 中间件 | 首版不引入 Redis/BullMQ | 没有容量证据前保持基础设施最小 |

## 6. 实现约束

- 不把 provider 网络请求放进数据库事务。
- 不用单进程内 semaphore 冒充多实例全局并发限制。
- 不通过扫描 prompt 或用户输入实现幂等。
- 不允许失败重试生成新的积分 hold key。
- 不删除历史任务来修复队列；恢复动作必须可审计。
- 数据库迁移先兼容旧代码，再切换消费入口。

## 7. 验证与交接

设计和验收入口：

- `../specs/0001_asynchronous-processing_design.md`
- `../specs/0002_concurrency-control_design.md`
- `../specs/0003_async-concurrency_acceptance.md`

每次实现批次应在本文件追加：

- 变更 commit/PR；
- 数据库迁移和回滚策略；
- 实际并发配置；
- 测试和压测命令；
- 租约恢复、重复执行和积分一致性证据；
- 已知缺口与下一位执行者的明确入口。

验证证据统一放在 `evidence/{YYYYMMDD-HHmm}/`，其中时间戳使用实际执行时间；不得提交任何密钥或真实用户隐私。

## 8. 2026-08-04 实施结果

- API 创建与重新生成均返回 HTTP 202、`statusUrl` 和 `redirectUrl`，请求进程不再调用 provider。
- worker 启动命令：`pnpm worker:generation`；健康检查：`/health/live`、`/health/ready`。
- 任务执行、资产插入、积分结算/释放和终态更新受有效租约保护；瞬时失败保留 hold。
- 最后一次尝试租约过期时，恢复扫描在同一事务内释放积分并写入永久失败。
- 8 worker、1,000 任务验证：global/user/provider-model 峰值分别为 2/1/2，领取 P95 63.12ms。
- 重复资产、重复结算、积分不一致、永久卡死、残留 permit 均为 0。
- 完整测试、ESLint、TypeScript 和 Next.js 生产构建通过；详细证据见 `evidence/20260804-0450/`。

### Zeabur 发布合同

- 新建独立 worker service，代码与 Web 使用同一提交，Root Directory 为 `ima ima queencard/src`。
- Start Command：`pnpm worker:generation`，共享 PostgreSQL，但只注入 server-side provider 密钥。
- 初始 24 小时设置 `GENERATION_WORKER_ENABLED=true`、worker concurrency 2、rollout 10；验收稳定后再提高到 4/100。
- Liveness Path：`/health/live`；Readiness Path：`/health/ready`。
- 回滚时先停止领取并等待 drain；不要删除迁移字段、任务、permit 或积分账本历史。
