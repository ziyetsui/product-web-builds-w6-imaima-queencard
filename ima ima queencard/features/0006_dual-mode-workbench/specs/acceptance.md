# MM-Coincard 双模式生成工作台验收标准

| 字段 | 内容 |
| --- | --- |
| 对应规格 | [SPEC.md](./SPEC.md) |
| 状态 | 待实施、待执行 |
| 基准路由 | `/prompts`、`/generated`、`/generated?view=history` |
| 证据目录 | `w6/evidence/acceptance/` |
| 规则 | UI 必须截图；生成/积分/隔离必须补充真实 API 和数据库证据；日志只能辅助 |

## 1. 验收执行原则

1. 本文先定义判定标准，不提前创建伪造证据。
2. 实施完成并开始验收时，每项结果填写为 `✅ 通过`、`❌ 未通过` 或 `⛔ 阻塞`，并链接证据文件。
3. 有用户可见表现的项目统一按 UI/页面功能验收，必须有实际浏览器截图。
4. 纯后端不变量必须同时提供真实请求/响应和数据库前后状态；日志、测试输出和 HTTP 200 不能单独证明通过。
5. 任何 placeholder、preview task、本地 mock 图片或成功 Toast 都不能冒充 provider 生成完成。
6. Dev server 无法启动或页面无法打开时，相关项标为阻塞或未通过，不允许降级为只看源码或日志。
7. 截图必须包含判定内容，不接受一张无关全屏截图覆盖多项。

## 2. 必备测试夹具

| 夹具 | 要求 |
| --- | --- |
| `user_funded` | 登录用户，可用积分 100，无运行中任务 |
| `user_empty` | 登录用户，可用积分 0 |
| `user_other` | 第二个登录用户，用于越权验证 |
| `user_new` | 新注册用户，用于记录 2 积分礼包与最低生成价格的已知产品问题，不作为本次 UI 通过条件 |
| 文生图模型 | `enabled=true`、支持 `text-to-image`、最大 4 张 |
| 编辑模型 | `enabled=true`、支持 `image-edit`、最大 4 张 |
| 单张模型 | `enabled=true`、支持图片输入、最大 1 张 |
| 禁用模型 | 配置存在但 `enabled=false` |
| Provider fixture | 完整成功 4/4、部分成功 2/4、失败 0/4、延迟 30 秒四种可控响应 |
| 参考图 | 4 张视觉可区分的 JPEG/PNG/WebP；另有 1 个超 10 MB 文件和 1 个伪 MIME 文件 |
| 历史 | `user_funded` 45 条混合模式/状态任务，`user_other` 3 条任务 |

## 3. 路由与 seed 交接

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-001 | `/prompts` seed 跳转不创建任务 | 一次点击进入 `/generated`；跳转期间 create POST=0；task、hold、transaction 新增数均为 0 | 以 `user_funded` 打开 `/prompts` 固定案例“鸡，谁懂？”，记录 DB 基线；点击案例生成；在落地页核对 prompt、来源、模型、3 张参考图、3:4、4 张；检查 Network 和 DB | `GEN-001-prompts-before.png`、`GEN-001-generated-ready.png`、`GEN-001-network.har`、`GEN-001-db-diff.json` | 待执行 |
| GEN-002 | Seed 字段准确且参考图去重 | prompt、case ID、category、note/author URL 与跳转前一致；3 张参考图顺序一致且无重复 | 在 `/prompts` 修改标题和副标题后跳转；读取页面字段和规范化 URL；对照跳转前编辑值 | `GEN-002-seed-before.png`、`GEN-002-seed-after.png`、`GEN-002-final-url.txt` | 待执行 |
| GEN-003 | 新链接只写规范参数 | `reference_images` 最多出现 1 次；旧的三组 `[]` 参数出现 0 次；URL 中 `data:image` 和 Base64 字节出现 0 次 | 使用静态案例图和 1 张本地上传图分别跳转；检查地址栏、复制 URL 和 Network document URL | `GEN-003-static-url.txt`、`GEN-003-local-handoff-url.txt`、`GEN-003-local-ready.png` | 待执行 |
| GEN-004 | 本地图片 handoff 失效可恢复 | 合法 handoff 恢复 1–3 张；过期/不存在时保留 prompt，显示 1 条明确错误，不创建任务 | 创建本地图片 handoff 并跳转；再伪造过期 `handoff_id` 打开页面；分别核对预览、错误和 Network | `GEN-004-handoff-valid.png`、`GEN-004-handoff-expired.png`、`GEN-004-network.har` | 待执行 |
| GEN-005 | Seed 优先级不受旧草稿污染 | `taskId > 显式 seed > 当前作用域草稿 > 默认值` 四种场景逐一成立 | 预置冲突的匿名草稿、案例草稿和任务；分别打开 default、draft、seed 和 task URL；核对 prompt/model/reference | `GEN-005-default.png`、`GEN-005-draft.png`、`GEN-005-seed.png`、`GEN-005-task.png`、`GEN-005-priority-matrix.json` | 待执行 |
| GEN-006 | 旧 `/generated/[taskId]` 链接兼容 | 一次重定向到 `/generated?taskId=`；无循环；任务内容一致 | 打开当前用户已有任务的旧路径，记录最终 URL、重定向链和页面 task 短 ID | `GEN-006-redirect.har`、`GEN-006-task.png`、`GEN-006-final-url.txt` | 待执行 |
| GEN-007 | 登录中断恢复安全 | 未登录点击生成后进入登录；登录后恢复全部草稿；外部 `from` 被拒绝；跳转期间 create POST=0 | 匿名编辑生成器后点击生成并完成测试登录；再打开含 `from=https://example.com` 的登录链接 | `GEN-007-before-login.png`、`GEN-007-after-login.png`、`GEN-007-auth.har`、`GEN-007-unsafe-from.txt` | 待执行 |

## 4. 双模式生成器

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-101 | 纯文生图真实支持零参考图 | mode=`text-to-image`；referenceImages 长度=0；任务到 `completed`；真实资产≥1；generation endpoint 调用=1；hold 已结算 | 以 `user_funded` 打开 `/generated`，选择纯文生图并提交 1 张成功 fixture；等待终态；检查 create/detail、provider 出站记录、task/assets/hold/transaction | `GEN-101-text-ready.png`、`GEN-101-text-completed.png`、`GEN-101-create-detail.json`、`GEN-101-provider-call.json`、`GEN-101-db-join.json` | 待执行 |
| GEN-102 | Prompt 边界校验 | 0 code point 禁用；1 和 2000 code point 通过；2001 code point 前后端均拒绝；服务端不截断 | 依次输入 0、1、2000、2001 code point；对 2001 再直接调用 API | `GEN-102-empty.png`、`GEN-102-one.png`、`GEN-102-2000.png`、`GEN-102-2001.png`、`GEN-102-api-boundaries.json` | 待执行 |
| GEN-103 | 参考图生成支持 1–3 张并拒绝越界 | 1、2、3 张均可创建；0 张 UI 禁用且 API 400；伪造 4 张的 estimate/create 均 400；非法场景 task/hold 新增=0 | 依次用 0–3 张固定图片操作 UI；再绕过 UI 向 estimate/create 提交 4 张；核对 payload 与 DB diff | `GEN-103-zero.png`、`GEN-103-one.png`、`GEN-103-three.png`、`GEN-103-four-api.json`、`GEN-103-db-diff.json` | 待执行 |
| GEN-104 | 第四张图进入明确替换流程 | 第 4 张不静默丢弃；Dialog 展示 3 个现有槽和新图；取消不变；选择槽位后仅替换 1 张 | 添加 3 张图，再添加第 4 张；先取消，再重开并替换第 2 张；核对缩略图与下一次 payload | `GEN-104-dialog.png`、`GEN-104-after-cancel.png`、`GEN-104-after-replace.png`、`GEN-104-payload.json` | 待执行 |
| GEN-105 | 模式往返不丢输入 | 图生图→文生图时请求排除图片；切回后恢复同序 3 张；prompt 完全一致 | 输入固定 prompt 和 3 张图，来回切换两次；在两种模式分别检查估价请求 | `GEN-105-text-mode.png`、`GEN-105-image-mode-restored.png`、`GEN-105-estimate-payloads.json` | 待执行 |
| GEN-106 | 模型按能力过滤 | 可见集合严格等于 `enabled && supports(mode)`；每种模式至少 1 个；禁用模型不可见 | 准备文生图、编辑、图生图、禁用模型配置；切换模式并记录模型菜单 | `GEN-106-text-models.png`、`GEN-106-image-models.png`、`GEN-106-config-snapshot.json` | 待执行 |
| GEN-107 | 服务端拒绝不兼容模型 | 文生图使用 edit 模型、图生图使用 text-only 模型、使用禁用模型均返回 400；新增 task=0 | 直接调用 create 和 estimate，绕过前端提交三种非法组合 | `GEN-107-illegal-api-responses.json`、`GEN-107-db-diff.json` | 待执行 |
| GEN-108 | 参数集合和模型上限一致 | UI 画幅严格为 8 种；分辨率严格等于当前模型配置；切 max=1 模型后张数变 1；未知画幅、未知/不支持分辨率、超上限张数均 400 | 导出两个模式的可见画幅/分辨率/张数；切换 max=4→max=1；绕过 UI 分别提交三类非法值 | `GEN-108-options.json`、`GEN-108-before-switch.png`、`GEN-108-after-switch.png`、`GEN-108-invalid-api.json` | 待执行 |
| GEN-109 | 积分预估由服务端驱动 | 参数变化后 500ms 内更新；UI=estimate=requestedCredits=hold；旧响应不覆盖新参数 | 快速连续修改张数、分辨率和模型；记录最后 UI 值、estimate 响应；再提交并查 task/hold | `GEN-109-estimate-ui.png`、`GEN-109-network.har`、`GEN-109-credit-chain.json` | 待执行 |
| GEN-110 | 估价失败阻止提交 | estimate 失败时按钮禁用；显示重试；create POST=0 | 让 estimate fixture 返回 500；修改参数触发估价；点击或键盘尝试提交 | `GEN-110-estimate-error.png`、`GEN-110-network.har` | 待执行 |
| GEN-111 | 单击和双击只创建一个任务 | 同一用户动作 create POST=1、task=1、hold=1 | 在按钮可用时双击并快速按 Enter；检查 Network 与 DB | `GEN-111-submit-state.png`、`GEN-111-network.har`、`GEN-111-db.json` | 待执行 |
| GEN-112 | 假功能不出现在 UI | AI Enhance 和 Fast Mode 可见控件数=0；请求不携带误导性默认开关或服务端忽略字段 | 检查桌面、平板、移动生成器和 create payload | `GEN-112-desktop.png`、`GEN-112-mobile.png`、`GEN-112-payload.json` | 待执行 |

## 5. 任务生命周期与积分结算

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-201 | 合法任务状态转换 | 成功路径为 queued→generating→completed/partial；早期失败允许 queued→failed；运行失败允许 generating→failed；终态不回退 | 分别运行延迟成功、queued 早期失败和 generating 失败 fixture；记录每次 detail 响应与 DB 状态 | `GEN-201-queued.png`、`GEN-201-generating.png`、`GEN-201-terminal.png`、`GEN-201-timeline.json`、`GEN-201-db.json` | 待执行 |
| GEN-202 | 后台轮询不闪首屏骨架 | 相邻周期 GET 间隔 3.5–5.0s；后台刷新时编辑器和已有结果不消失；整页 skeleton 闪现=0 | 生成 30 秒延迟任务，录制完整页面并导出请求时间戳 | `GEN-202-polling.mp4`、`GEN-202-network.har`、`GEN-202-intervals.csv` | 待执行 |
| GEN-203 | 终态停止轮询 | 服务端进入终态后 UI ≤5s 更新；其后 5s 内周期 GET=0 | 分别跑 completed、partial、failed fixture；记录终态时间和后续 Network | `GEN-203-completed.png`、`GEN-203-partial.png`、`GEN-203-failed.png`、`GEN-203-network-timestamps.json` | 待执行 |
| GEN-204 | 完整成功资产与积分一致 | N=4：资产=4；settled=sum(asset credits)=requested；hold 状态=SETTLED；套餐 frozen 总和=0；唯一消费流水=requested；余额=`B-requested` | 记录基线 B，运行 4/4 fixture；等待 completed；保存 create/detail/balance 原始响应和 task/assets/hold/package/transaction SQL 结果 | `GEN-204-completed.png`、`GEN-204-api.json`、`GEN-204-db-join.json` | 待执行 |
| GEN-205 | 部分成功只扣成功张数 | 2/4：资产=2；失败槽=2；settled=sum(asset credits)<requested；hold 状态=SETTLED；frozen=0；余额=`B-settled` | 运行 2/4 fixture；保存原始 API 与 task/assets/hold/package/transaction SQL 结果 | `GEN-205-partial.png`、`GEN-205-api.json`、`GEN-205-db-join.json` | 待执行 |
| GEN-206 | 全部失败释放积分 | 0/4：资产=0；settled=0；hold 状态=RELEASED；frozen=0；消费流水金额=0；余额恢复 B | 记录 B，运行失败 fixture；等待 failed；保存原始 API 与 task/assets/hold/package/transaction SQL 结果 | `GEN-206-failed.png`、`GEN-206-api.json`、`GEN-206-db-join.json` | 待执行 |
| GEN-207 | 资产持久化失败不得扣分成功 | asset insert 失败后 task=failed、errorCode=PERSISTENCE_FAILED、资产=0、settled=0、hold=RELEASED、frozen=0 | 通过真实 create API 创建 fixture task，让受控 DB fault 在资产插入处失败；读取真实 detail/balance API 和完整 DB 前后快照 | `GEN-207-error-ui.png`、`GEN-207-create-detail-balance.json`、`GEN-207-db-before-after.json` | 待执行 |
| GEN-208 | 执行器重跑幂等 | 同一 task 两次结构化执行：资产不重复、消费流水不重复、余额只扣一次 | 通过真实 create API 创建 task；对同一 task 触发两次受控执行；保存两次调用结果、detail/balance API 和 DB 前后快照 | `GEN-208-execution-calls.json`、`GEN-208-api.json`、`GEN-208-db-before-after.json` | 待执行 |
| GEN-209 | 创建接口响应速度 | provider 异步条件下 create API P95≤2s，样本≥20 | 用隔离 provider fixture 连续创建 20 个任务，记录每次 HTTP 耗时并确认 create 不等待 provider 终态 | `GEN-209-latency.csv`、`GEN-209-command.txt`、`GEN-209-network-summary.png` | 待执行 |
| GEN-210 | 补偿失败后的 stale hold 可恢复 | 补偿连续失败 3 次后 task 保持非终态；把时间推进到 15 分钟后，首次 detail 或 balance 读取将其变为 `failed/STALE_EXECUTION`、hold=RELEASED、frozen=0、余额恢复；重复读取不重复写流水 | 用受控 DB fault 让补偿 3 次失败；推进测试时钟；分别调用真实 detail 和 balance API；再重复调用一次并查询 DB | `GEN-210-before-reconcile.json`、`GEN-210-detail-balance.json`、`GEN-210-after-reconcile.json`、`GEN-210-idempotency-db.json`、`GEN-210-recovered-ui.png` | 待执行 |

## 6. 结果动作

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-301 | 结果图片与画幅正确 | 成功资产数与 UI 卡片数一致；3:4 请求的卡片占位比误差≤0.02；CLS≤0.1 | 完成 4/4 任务；测量卡片 bounding box；用性能 trace 核对加载前后 layout shift | `GEN-301-results.png`、`GEN-301-dom-measurements.json`、`GEN-301-layout-shift.json` | 待执行 |
| GEN-302 | 安全下载使用资产接口 | 每次点击调用 `/api/v1/image-assets/<id>/download`；页面 URL 不跳到 provider；附件文件名符合规范；他人 asset 404 | 点击第 1 张下载并记录文件；再用 `user_other` 请求 assetId | `GEN-302-download-ui.png`、`GEN-302-download.har`、`GEN-302-file-metadata.json`、`GEN-302-unauthorized-response.json` | 待执行 |
| GEN-303 | 结果设为参考进入下一轮草稿 | 未满时只新增 1 次并切图生图；满 3 张时弹替换；动作本身 create POST=0 | 从文生图结果设为参考，再在 3 张状态执行同操作；核对下一次 estimate/create payload | `GEN-303-added.png`、`GEN-303-replace-dialog.png`、`GEN-303-network.har`、`GEN-303-payload.json` | 待执行 |
| GEN-304 | Prompt 复用要求追加或覆盖 | Dialog 有追加、覆盖、取消；三个选择分别得到确定结果；取消不变 | 设置当前草稿 A，任务 prompt B；依次测试三项 | `GEN-304-dialog.png`、`GEN-304-append.png`、`GEN-304-overwrite.png`、`GEN-304-cancel.png`、`GEN-304-state.json` | 待执行 |
| GEN-305 | 重新生成创建新任务 | 新 taskId≠旧 taskId；source=regenerate；旧任务不变；新 hold 独立；单击不修改原资产 | 对完成任务点击重新生成；记录旧/新 URL、请求和两条 task | `GEN-305-before.png`、`GEN-305-after.png`、`GEN-305-api.json`、`GEN-305-db.json` | 待执行 |
| GEN-306 | 部分成功不伪造重试失败项 | 页面动作明确为“重新生成整组”；不存在声称只重试 2 个失败槽的控件 | 打开 2/4 partial 任务，检查操作文案和 regenerate payload outputCount | `GEN-306-partial-actions.png`、`GEN-306-regenerate-payload.json` | 待执行 |

## 7. 历史、账户与积分上下文

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-401 | 侧栏展示真实账户和积分 | 登录后名称/邮箱、计划和可用积分与 `/user/me`、`credit/balance` 及 DB 一致；静态 `用户/--` 出现 0 次 | 以 `user_funded` 打开工作台，对照两个原始 API 和 user/customer/credit package SQL；再退出登录 | `GEN-401-logged-in.png`、`GEN-401-logged-out.png`、`GEN-401-api.json`、`GEN-401-db.json` | 待执行 |
| GEN-402 | 导航目标正确 | 生成、提示词库、历史、积分、会员 5 个入口分别到 `/generated`、`/prompts`、`/generated?view=history`、`/credits`、`/pricing` | 逐项点击并记录最终 URL；浏览器后退恢复原视图 | `GEN-402-generated.png`、`GEN-402-prompts.png`、`GEN-402-history.png`、`GEN-402-credits.png`、`GEN-402-pricing.png`、`GEN-402-navigation.har`、`GEN-402-urls.txt` | 待执行 |
| GEN-403 | 历史 45 条可全部到达且无重复 | 首批 20；加载后累计 40；再次加载累计 45；唯一 taskId=45；倒序稳定 | 用 45 条 fixture 打开历史并加载至底；导出页面 task IDs 与 API 响应 | `GEN-403-first-page.png`、`GEN-403-last-page.png`、`GEN-403-api-pages.json`、`GEN-403-id-check.json` | 待执行 |
| GEN-404 | 历史字段准确 | 每条模式、状态、模型、成功数、积分、来源和时间与 API/DB 一致；抽查≥5条含五种状态 | 选择 5 条固定任务，保存原始 list/detail API 和 task/assets SQL，再生成字段对照 | `GEN-404-history-sample.png`、`GEN-404-list-detail-api.json`、`GEN-404-db-query.json`、`GEN-404-field-comparison.json` | 待执行 |
| GEN-405 | 历史搜索和筛选 | 300ms debounce；快速输入 5 字时有效查询≤2 次；结果只含命中项；空搜索恢复 | 输入固定关键词并快速键入；切 failed 筛选；清空；检查 Network 和结果 | `GEN-405-search.png`、`GEN-405-filter.png`、`GEN-405-network.har` | 待执行 |
| GEN-406 | 用户隔离 | `user_funded` 历史不含 `user_other` 3 条；他人 task/detail/download 均 404；响应不泄露 owner | 两账户分别请求列表；用对方 IDs 请求详情和下载 | `GEN-406-funded-history.png`、`GEN-406-other-history.png`、`GEN-406-api-responses.json`、`GEN-406-db-query.json` | 待执行 |
| GEN-407 | 积分不足零副作用 | UI 操作 create POST=0；绕过 UI 的 create 返回 402；两步 task/hold/transaction 新增均=0；草稿保留 | 第一步以 `user_empty` 从浏览器尝试生成并检查 HAR；第二步直接调用 create；最后刷新并核对草稿和 DB diff | `GEN-407-insufficient.png`、`GEN-407-browser-network.har`、`GEN-407-direct-api.json`、`GEN-407-db-diff.json`、`GEN-407-after-refresh.png` | 待执行 |
| GEN-408 | 退出登录清理用户状态 | 退出后前用户历史、积分、昵称和账户草稿不可见；第二用户登录不恢复前用户内容 | `user_funded` 编辑草稿后退出，再登录 `user_other`；导出前后 IndexedDB/localStorage key 和 Query cache key | `GEN-408-before.png`、`GEN-408-after-logout.png`、`GEN-408-other-user.png`、`GEN-408-storage-cache.json` | 待执行 |

## 8. 响应式与视觉

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-501 | 1440×900 桌面布局 | 完整侧栏；首屏看到生成器和首行结果/空结果区；横向 overflow≤1px；结果 4 列 | 设置 viewport 1440×900，分别打开 ready 和 completed 状态；测量 overflow 和列数 | `GEN-501-desktop-ready.png`、`GEN-501-desktop-results.png`、`GEN-501-dom.json` | 待执行 |
| GEN-502 | 768×1024 平板布局 | 72px 图标侧栏；结果 2 列；横向 overflow≤1px；参数不裁切 | 设置 viewport 768×1024，打开 seed、更多设置和结果 | `GEN-502-tablet-ready.png`、`GEN-502-tablet-settings.png`、`GEN-502-tablet-results.png`、`GEN-502-dom.json` | 待执行 |
| GEN-503 | 390×844 手机布局 | 无常驻侧栏；Drawer 可开关；结果 2 列；主操作无需横向滚动；横向 overflow≤1px | 设置 viewport 390×844，打开 Drawer、seed、生成中和结果，滚动到底 | `GEN-503-mobile-drawer.png`、`GEN-503-mobile-ready.png`、`GEN-503-mobile-running.png`、`GEN-503-mobile-results.png`、`GEN-503-dom.json` | 待执行 |
| GEN-504 | 手机底部按钮不遮挡内容 | 最后一张结果和错误区可完全滚到生成栏上方；遮挡像素=0；安全区 padding 生效 | 390×844 打开结果和错误；滚动到底；用 390×600 模拟键盘后读取 bounding boxes | `GEN-504-bottom-safe.png`、`GEN-504-keyboard-height.png`、`GEN-504-bounding-boxes.json` | 待执行 |
| GEN-505 | 320px 与 200% zoom 可用 | 不出现二维滚动；结果改 1 列；文字和按钮不截断 | 320px viewport 和桌面 200% zoom 分别检查 ready、Dialog、结果 | `GEN-505-320.png`、`GEN-505-zoom200.png`、`GEN-505-overflow.json` | 待执行 |
| GEN-506 | MM-Coincard 视觉一致 | 背景=`#f6e0db`；主按钮=`#ef724f`；当前模式=`#e7db4c`；成功=`#ace2df`；来源=`#84bfff`；主编辑器阴影偏移=4px；Raphael 品牌/素材/深色主题出现 0 次 | 读取生成页根节点、主按钮、选中模式、成功提示、来源标签和编辑器的 computed style，并截图对照 `/prompts` | `GEN-506-generated.png`、`GEN-506-prompts-reference.png`、`GEN-506-computed-styles.json` | 待执行 |
| GEN-507 | 关键状态均有真实截图 | ready、text mode、image mode、generating、completed、partial、failed、insufficient、history 共 9 种状态均有截图 | 使用固定 fixture 逐个进入状态并截图，截图中必须包含状态文案与主要操作 | `GEN-507-01-ready.png`、`GEN-507-02-text.png`、`GEN-507-03-image.png`、`GEN-507-04-generating.png`、`GEN-507-05-completed.png`、`GEN-507-06-partial.png`、`GEN-507-07-failed.png`、`GEN-507-08-insufficient.png`、`GEN-507-09-history.png` | 待执行 |

## 9. 无障碍

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-601 | axe 自动检查 | 空白文生图、参考图 seed、generating、partial、failed、replace Dialog、history 七种状态 serious=0、critical=0 | 每种状态运行 axe；保留完整 JSON | `GEN-601-01-text-ready.json`、`GEN-601-02-image-seed.json`、`GEN-601-03-generating.json`、`GEN-601-04-partial.json`、`GEN-601-05-failed.json`、`GEN-601-06-replace-dialog.json`、`GEN-601-07-history.json`、`GEN-601-summary.png` | 待执行 |
| GEN-602 | 全键盘完成主路径 | 不使用鼠标完成模式、模型、上传、生成、历史、结果复用和 Dialog；焦点丢失次数=0 | 从地址栏开始按 Tab/方向键/Enter/Escape 完整操作；记录焦点顺序和完整录屏 | `GEN-602-keyboard.mp4`、`GEN-602-focus-order.txt` | 待执行 |
| GEN-603 | 触控目标尺寸 | 所有主要按钮、菜单和结果动作 bounding box 均≥44×44 CSS px | 在 390px viewport 读取所有交互节点尺寸；人工抽查边缘操作 | `GEN-603-target-sizes.json`、`GEN-603-mobile-controls.png` | 待执行 |
| GEN-604 | 状态语义和播报 | 模式有 tab/radio 选中语义；生成状态 polite live；失败 role=alert；重复轮询不重复播报相同文案 | 检查 accessibility snapshot；用读屏或语义工具走生成中和失败 | `GEN-604-a11y-snapshots.txt`、`GEN-604-screenreader.mp4` | 待执行 |
| GEN-605 | 对比度和焦点 | 正文≥4.5:1；大字/控件≥3:1；所有键盘焦点有可见 outline | 对规范色组合运行对比度测量；Tab 遍历页面截图 | `GEN-605-contrast.json`、`GEN-605-focus.png` | 待执行 |
| GEN-606 | 减少动态效果 | `prefers-reduced-motion` 下循环 shimmer、位移和缩放动画数量=0；功能不受影响 | 模拟 reduce，打开生成中和结果态；检查 computed animation/transition | `GEN-606-reduced-motion.png`、`GEN-606-computed.json` | 待执行 |

## 10. 安全、数据和性能

| ID | 验收项 | 量化指标 | 判定方法 | 证据要求 | 结果 |
| --- | --- | --- | --- | --- | --- |
| GEN-701 | 图片格式、规范化大小与出站阻断 | JPEG/PNG/WebP 原图≤10MB可选且规范化≤800KiB；>10MB、伪 MIME、非图片拒绝；非法场景 provider 出站=0、task/hold 新增=0 | 分别上传夹具并直接调用 API；记录客户端规范化元数据、服务端错误、出站 spy 计数和 DB diff | `GEN-701-valid.png`、`GEN-701-invalid.png`、`GEN-701-api.json`、`GEN-701-normalized-files.json`、`GEN-701-outbound-spy.json`、`GEN-701-db-diff.json` | 待执行 |
| GEN-702 | 任意远程 URL 不可触发 SSRF | 未受信 HTTPS、localhost、127.0.0.1、私网、非 HTTPS 均 400；服务端 fetch/provider 出站=0；task/hold 新增=0 | 直接提交五类 URL；通过服务端出站拦截器计数并查询 DB diff | `GEN-702-api-responses.json`、`GEN-702-outbound-spy.json`、`GEN-702-db-diff.json` | 待执行 |
| GEN-703 | 敏感图片不进入 URL 和日志 | 地址栏、document request、应用日志、分析事件中 `data:image`/Base64 匹配数=0 | 使用本地图完成跳转和创建；搜索 URL、HAR、应用日志和事件 payload | `GEN-703-url.txt`、`GEN-703-network.har`、`GEN-703-log-scan.txt`、`GEN-703-events.json` | 待执行 |
| GEN-704 | 页面性能门槛 | 移动 Lighthouse Performance≥80、Accessibility≥95、LCP≤2.5s、CLS≤0.1、INP≤200ms | 在预生产或稳定本地 fixture 上运行 3 次，取中位数；页面包含真实 seed 和结果缩略图 | `GEN-704-run-1.html`、`GEN-704-run-1.json`、`GEN-704-run-2.html`、`GEN-704-run-2.json`、`GEN-704-run-3.html`、`GEN-704-run-3.json`、`GEN-704-summary.md`、`GEN-704-summary.png` | 待执行 |
| GEN-705 | 历史和详情 API 延迟 | 预生产夹具下历史、详情、余额接口各 P95≤1s，样本≥30 | 对三个 API 各执行至少 30 次认证请求，记录耗时和状态 | `GEN-705-latency.csv`、`GEN-705-command.txt`、`GEN-705-summary.png` | 待执行 |
| GEN-706 | 私人工作台不被索引 | `/generated` metadata 含 `noindex,nofollow`；响应或渲染 head 可验证 | 打开页面并检查 DOM head/响应 metadata | `GEN-706-head.txt`、`GEN-706-browser.png` | 待执行 |

## 11. 禁止的“假通过”方式

以下证据不能单独把任何相关验收项标为通过：

- `pnpm run build` 或 `pnpm test` 的成功文本。
- Dev server 日志中的 200。
- 页面出现“生成成功”Toast。
- task 只进入 `queued`。
- placeholder、CSS 渐变或 `preview_*` 资产出现在结果卡。
- 模型只在前端隐藏，但服务端仍接受伪造请求。
- 余额数字只在前端减少，没有 hold、transaction 和 task 对账。
- “设为参考”只改变缩略图，下一次请求仍使用旧图片。
- 历史来自 mock 或 localStorage，没有真实用户隔离。
- 移动截图只是缩小桌面截图，没有真实 viewport 和 bounding-box 检查。
- axe 只在空白状态运行，没有覆盖 Popover、Dialog、运行中和失败状态。

## 12. 验收完成条件

本版本只有在以下条件全部成立时才能整体标记通过：

1. 本文 62 条 GEN 验收项全部为 `✅ 通过`；本规格不预设“不适用”项。
2. 没有 serious/critical 无障碍问题。
3. 完整、部分和失败三种积分不变量都有 API + DB 证据。
4. 桌面、平板和移动端都有 seed、运行和结果截图。
5. 存在任何 `❌ 未通过` 或 `⛔ 阻塞` 时，整体不得标记通过；负责人和后续计划只能解释状态，不能替代通过证据。
