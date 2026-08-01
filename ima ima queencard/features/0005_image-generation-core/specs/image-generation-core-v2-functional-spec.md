# imaima queencard 图片生成工作台 v2 功能规格

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/image-generation-core/0005-imaima-queencard-image-generation-core-v2-functional-spec.md`
- 上游 PRD：`specs/w6/image-generation-core/0004-imaima-queencard-image-generation-core-v2-prd.md`
- 上游 v2 规格：`specs/w6/image-generation-core/0003-imaima-queencard-image-generation-core-v2-spec.md`
- v1 规格：`specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md`
- v1 交互设计：`specs/w6/image-generation-core/0002-imaima-queencard-image-generation-core-interaction-design.md`
- 关联定价支付计划：`specs/w6/pricing-payment/0002-imaima-queencard-pricing-payment-impl-plan.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-17`
- Artifact role：`functional-spec`
- 状态：实现前功能规格

## 命名说明

本仓库当前使用 `.rules/spec-ledger-naming-rules.md` 中的 Workstream Manual Spec Chain，而不是标准 Spec Kit feature package。

图片生成核心子链当前顺序为：

```text
specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md
specs/w6/image-generation-core/0002-imaima-queencard-image-generation-core-interaction-design.md
specs/w6/image-generation-core/0003-imaima-queencard-image-generation-core-v2-spec.md
specs/w6/image-generation-core/0004-imaima-queencard-image-generation-core-v2-prd.md
specs/w6/image-generation-core/0005-imaima-queencard-image-generation-core-v2-functional-spec.md
```

`0004` 当前是 PRD 占位文档。本文档基于 `0004` 的元数据、其指向的上游 `0003` v2 规格，以及 `0001`/`0002` 中已经确认的生成、积分和交互约束生成。为了避免覆盖或混淆既有 `0003-...-v2-spec.md`，本文档在项目 slug 中加入 `functional`，表示它是从 PRD 链路沉淀出的功能规格；文件后缀仍保持 `spec` 语义。

## Summary

图片生成工作台 v2 将现有 `/generated` 从单次任务结果页升级为“当前生成 + 全部历史 + 搜索复用 + 继续生成”的统一工作台。

v2 的核心价值是让用户能把生成过的图片、prompt、参考图和参数当作可复用资产，而不是一次性结果。用户可以在同一个页面中查看当前任务、切换所有历史、搜索旧记录、下载图片、引用 prompt、把旧图加入下一轮参考图，并继续创建新的图片生成任务。

v2 不改变 v1 已确认的生成和计费底线：每次生成必须有 `1-3` 张参考图；匿名、未登录、无积分或积分不足用户产生 `0` 次供应商调用；生成前冻结积分；成功按输出图片结算；失败释放冻结；下载自己的已生成图片不重复扣积分。

## Product Goals

1. 用户可以在 `/generated` 清楚识别当前生成任务、结果图、prompt、模型、积分、尺寸、张数、时间和状态。
2. 用户可以在 `当前工具` 和 `所有历史` 之间切换，且不丢失当前未提交输入。
3. 用户可以通过搜索快速找回旧 prompt、旧案例、旧模型结果或旧图片。
4. 用户可以把历史记录中的 prompt 和结果图复用到下一次生成。
5. 用户可以在桌面端高效处理历史和结果，在移动端查看图片时不被 composer 或导航遮挡。

## Non-Goals

- 不新增无参考图的文生图入口。
- 不新增视频生成、口型同步、Img to Vid 或完整图片编辑器。
- 不实现公开社区图库、多人协作或团队资产权限。
- 不改变 GPTProto-first、积分冻结、积分结算和下载不重复扣费规则。
- 不改变 Stripe 商品、Webhook 履约或积分包发放规则。
- 不复制参考产品的暗色皮肤、棕色控件、头像品牌或免费无限生成表达。

## Users And Scenarios

### User Story 1：查看当前生成记录 (P1)

用户打开 `/generated` 或 `/generated?taskId={taskId}` 后，可以看到当前任务的输入、状态、结果和下一步操作。

**Acceptance Scenarios**：

1. Given 用户打开已完成任务，When 页面加载完成，Then 系统展示 prompt、参考图、结果图、模型、积分、尺寸、张数、时间、下载入口和重新生成入口。
2. Given 当前任务正在生成，When 用户进入页面，Then 系统展示稳定占位、模型、预计张数、预计积分和参考图摘要。
3. Given 当前任务失败，When 用户进入页面，Then 系统保留原输入，展示失败原因，并提供修改或重试入口。

### User Story 2：切换当前工具和所有历史 (P1)

用户可以用顶部 tab 在当前创作上下文和全部历史之间切换。

**Acceptance Scenarios**：

1. Given 用户在当前任务中编辑 composer，When 切换到 `所有历史`，Then 历史列表出现，当前 composer 输入不丢失。
2. Given 用户在 `所有历史` 查看记录，When 切回 `当前工具`，Then 页面回到当前任务、当前 seed 或最新输入。
3. Given 用户没有历史记录，When 打开 `所有历史`，Then 系统展示空状态和新建生成入口。

### User Story 3：搜索生成历史 (P1)

用户可以搜索所有可访问的图片生成记录，快速找回旧图、旧 prompt 或旧参数。

**Acceptance Scenarios**：

1. Given 用户输入 prompt 关键词，When 存在匹配记录，Then 列表只展示匹配的生成记录。
2. Given 搜索结果为空，When 系统展示空结果，Then 提供清空搜索和新建生成入口。
3. Given 用户清空搜索，When 搜索框为空，Then 当前 tab 恢复默认记录列表。

### User Story 4：复用历史输出继续生成 (P1)

用户可以从任意已完成记录中把输出图加入 composer，并复用或修改该记录的 prompt。

**Acceptance Scenarios**：

1. Given 用户查看一条已完成记录，When 点击结果图的“作为参考”，Then 该图片进入 composer reference tray。
2. Given composer 已有 `3` 张参考图，When 用户继续添加结果图，Then 系统提示替换或删除一张，而不是静默丢弃。
3. Given 用户点击“引用 prompt”，When composer 已有未提交文本，Then 系统要求选择追加或覆盖。

### User Story 5：折叠左侧面板 (P2)

用户可以折叠左侧导航和历史面板，为结果图和历史流留出更多空间。

**Acceptance Scenarios**：

1. Given 左侧面板展开，When 用户点击折叠按钮，Then 面板缩窄为关键图标和状态入口，主内容区变宽。
2. Given 左侧面板折叠，When 用户点击展开按钮，Then 面板恢复品牌、导航、最近记录、积分和头像。
3. Given 用户刷新页面，When 工作台重新加载，Then 系统合理恢复上一次的面板偏好。

### User Story 6：下载和重新生成 (P1)

用户可以下载自己的已生成图片，也可以基于旧记录创建新的重新生成任务。

**Acceptance Scenarios**：

1. Given 用户查看自己的已完成图片，When 点击下载，Then 系统开始下载且额外扣积分为 `0`。
2. Given 用户点击重新生成，When 输入和余额有效，Then 系统创建新任务并重新计费，旧任务和旧结果保持不变。
3. Given 用户尝试访问不属于自己的图片或任务，When 系统校验权限，Then 拒绝访问并展示可理解错误。

## Functional Requirements

### Workspace

- **FR-001**：系统必须继续使用 `/generated` 作为唯一图片生成工作台，不新增独立结果页或历史页。
- **FR-002**：系统必须支持 `idle`、`seeded_input`、`blocked`、`queued`、`generating`、`completed`、`partial_success`、`failed` 任务状态。
- **FR-003**：系统必须能从 `/generated?taskId={taskId}` 恢复对应任务状态、输入、结果和操作。
- **FR-004**：系统必须保留旧 query bridge，把 prompt、reference images、source case 等 query 解析为 `seeded_input`，但不得自动启动供应商生成。
- **FR-005**：系统必须在刷新、tab 切换、搜索和左侧栏折叠后保留当前未提交 composer 输入。

### Scope Tabs And History

- **FR-006**：系统必须提供 `当前工具` 和 `所有历史` 两个 scope tab。
- **FR-007**：`当前工具` 必须展示当前任务、当前 seed、正在生成任务或最近结果。
- **FR-008**：`所有历史` 必须展示当前用户可访问的图片生成记录。
- **FR-009**：历史记录必须按日期或时间段分组。
- **FR-010**：历史列表必须支持空状态、加载状态、错误状态和无结果状态。
- **FR-011**：tab 切换、历史搜索和面板折叠必须产生 `0` 次供应商生成调用。

### Search

- **FR-012**：系统必须提供搜索框，支持按 prompt 正文、prompt 摘要、来源案例、模型展示名、模型 key、任务状态和日期相关信息搜索。
- **FR-013**：搜索必须作用于当前 scope：`所有历史` 搜索全部图片生成记录，`当前工具` 搜索当前工具相关记录。
- **FR-014**：系统必须允许清空搜索并恢复默认列表。
- **FR-015**：搜索结果必须展示结果数量或保留清晰的日期分组。

### Generation Record

- **FR-016**：每条生成记录必须展示 prompt 或 prompt 摘要。
- **FR-017**：每条生成记录必须展示 metadata chips，至少包含能力/模式、模型、积分、比例或尺寸、张数、状态和时间。
- **FR-018**：已完成记录必须提供图片级下载入口、作为参考入口、引用 prompt 入口和重新生成入口。
- **FR-019**：多图输出必须使用稳定网格展示，不得横向溢出或与操作按钮重叠。
- **FR-020**：queued 和 generating 记录必须展示稳定占位，不得让主区域出现大面积空白。
- **FR-021**：failed 记录必须保留原输入，并展示失败原因和可恢复动作。
- **FR-022**：partial success 记录必须展示成功图片和失败说明，并只针对成功图片提供可复用操作。

### Composer

- **FR-023**：composer 必须支持 `collapsed_summary` 和 `expanded_editor` 两种状态。
- **FR-024**：composer 收起态必须展示参考图缩略图、prompt 摘要、展开入口和生成按钮。
- **FR-025**：composer 展开态必须展示参考图、prompt、模型、比例、张数、分辨率、AI Enhance、Fast Mode、预估积分和生成按钮。
- **FR-026**：每次生成必须至少包含 `1` 张参考图，最多 `3` 张参考图。
- **FR-027**：prompt 为空、prompt 超过限制、参考图缺失、模型不可用或积分不足时，系统必须禁用生成并展示原因。
- **FR-028**：用户必须能从任意已完成输出把图片加入 composer 作为下一轮参考图。
- **FR-029**：用户必须能从任意生成记录把 prompt 回填到 composer，并在已有文本时选择追加或覆盖。

### Generation And Credits

- **FR-030**：系统必须在用户明确点击生成后才创建新生成任务。
- **FR-031**：匿名用户、未登录用户、无积分用户、积分不足用户和输入无效用户必须产生 `0` 次供应商调用。
- **FR-032**：系统必须在供应商调用前冻结预估积分。
- **FR-033**：系统必须按成功输出图片张数结算积分。
- **FR-034**：供应商失败、超时、内容审核失败或无成功输出时，系统必须释放冻结积分。
- **FR-035**：重新生成必须创建新任务和新积分冻结，不得覆盖旧记录。
- **FR-036**：下载用户自己的已生成图片不得额外扣积分。

### Ownership And Privacy

- **FR-037**：用户只能查看、下载和复用自己有权限访问的生成任务和生成资产。
- **FR-038**：供应商 key、支付 key、Webhook secret 和其他 secret 不得暴露到前端、spec 示例、日志或可下载响应中。
- **FR-039**：历史搜索结果不得泄露其他用户的 prompt、参考图、结果图或任务状态。

### Responsive And Accessibility

- **FR-040**：桌面端左侧面板必须支持展开和折叠。
- **FR-041**：移动端左侧面板必须隐藏为入口或抽屉，不得挤压主内容。
- **FR-042**：移动端 composer 不得 fixed 遮挡结果图、下载入口、作为参考入口或重新生成入口。
- **FR-043**：所有图标按钮必须具备可访问名称或 tooltip。
- **FR-044**：hover 操作必须提供 keyboard focus 等价状态。
- **FR-045**：失败、阻塞、空状态和无结果状态必须用文本说明，不能只靠颜色表达。

### Visual And Content

- **FR-046**：v2 必须继续使用 imaima queencard 品牌语言，包括粉色画布、白色面板、粗黑边、lemon、seafoam、pumpkin 和现有字体风格。
- **FR-047**：页面不得复制 Raphael 或其他参考产品的暗色皮肤、棕色控件、头像品牌或免费无限生成文案。
- **FR-048**：页面内文案必须直接描述状态和下一步动作，不展示冗长功能说明或操作手册。

## Key Entities

- **Generation Workspace**：用户当前的图片生成工作台，包含 scope、搜索词、左侧栏状态、composer 状态和当前任务。
- **Workspace Scope**：顶部 tab 选择，取值为 `current_tool` 或 `all_history`。
- **Generation Record**：一次生成任务的可视化记录，包含输入、状态、模型、积分、时间、输出图片和操作。
- **Generated Asset**：生成任务产出的单张图片，可下载、预览、作为参考图或进入后续生成。
- **Composer Context**：composer 当前携带的参考图、prompt、模型和参数。
- **History Query**：用户搜索和过滤历史记录时形成的查询上下文。
- **Rail Preference**：左侧面板展开、折叠或移动端隐藏的用户偏好。
- **Credit Hold**：生成任务开始前冻结的预估积分，后续按成功输出结算或释放。

## State Model

### Workspace State

```text
workspace_scope: current_tool | all_history
rail_state: expanded | collapsed | hidden
composer_state: collapsed_summary | expanded_editor
record_state: idle | seeded_input | blocked | queued | generating | completed | partial_success | failed
```

### Main Task Flow

```text
idle
-> seeded_input
-> blocked
-> seeded_input
-> queued
-> generating
-> completed
```

### Failure And Partial Success

```text
queued/generating
-> partial_success
-> completed via continued generation

queued/generating
-> failed
-> seeded_input via retry/edit
```

## Core Flows

### Flow A：从案例进入生成

1. 用户在 `/prompts` 点击案例生成入口。
2. 系统带入案例前 `3` 张参考图、案例 prompt 和来源信息。
3. `/generated` 或生成确认入口进入 `seeded_input` 状态。
4. 用户检查并修改 prompt、参考图和参数。
5. 用户点击生成。
6. 系统校验登录、输入和积分。
7. 校验通过后创建任务、冻结积分并展示 queued/generating。
8. 任务完成后展示 completed、partial_success 或 failed。

### Flow B：搜索旧记录并继续生成

1. 用户打开 `/generated`。
2. 用户切换到 `所有历史`。
3. 用户输入关键词。
4. 系统展示匹配的生成记录。
5. 用户点击结果图的“作为参考”或记录的“引用 prompt”。
6. 系统把对应内容回填到 composer。
7. 用户修改后创建新任务，旧记录保留。

### Flow C：重新生成

1. 用户在已完成记录中点击重新生成。
2. 系统复用原 prompt、参考图和参数。
3. 系统创建新任务并重新冻结积分。
4. 新任务生成完成后追加为新记录，旧记录和旧资产不变。

### Flow D：阻塞恢复

| 阻塞 | 系统表现 | 恢复动作 |
|---|---|---|
| 未登录 | 保留输入并展示登录入口 | 登录后回到 preserved input |
| 积分不足 | 展示购买积分或降参入口 | 购买、订阅、降低张数或换低积分模型 |
| 参考图缺失 | 生成按钮 disabled 并说明原因 | 添加至少 `1` 张参考图 |
| Prompt 无效 | 生成按钮 disabled 并说明原因 | 输入或压缩 prompt |
| 内容策略失败 | failed 或 partial_success | 修改输入后重试 |

## Edge Cases

- 历史为空：`所有历史` 展示空状态和新建生成入口。
- 搜索为空：恢复当前 scope 默认列表。
- 搜索无结果：展示清空搜索和新建生成入口。
- 当前任务不存在、被删除或无权限：展示可恢复错误，允许回到所有历史或新建生成。
- 参考图不可访问：生成前提示替换或删除，不把坏图传给供应商。
- 多图输出超过可视区域：网格换行，不横向溢出。
- 图片加载失败：保留结果结构，展示失败占位、重试加载和复制链接或重新生成入口。
- 下载失败：提示稍后重试，不额外扣积分。
- 用户关闭或刷新页面：任务状态、已完成结果和可恢复输入必须能重新加载。
- 供应商调用后无成功输出：任务失败，释放冻结积分。
- 供应商部分成功：展示成功图片，只结算成功输出。

## Success Criteria

- **SC-001**：用户从打开 `/generated` 到识别当前任务状态、模型、积分和输出图，不超过 `5` 秒。
- **SC-002**：用户在常规个人历史量下通过 prompt 关键词找到目标历史记录，不超过 `10` 秒。
- **SC-003**：`100%` 的匿名、未登录、无积分、积分不足或输入无效场景产生 `0` 次供应商调用。
- **SC-004**：`100%` 的生成任务在供应商调用前完成积分冻结。
- **SC-005**：`100%` 的无成功输出失败任务释放冻结积分。
- **SC-006**：partial success 任务只按成功输出图片数量结算积分。
- **SC-007**：`100%` 的已完成记录展示下载入口，重复下载额外扣积分为 `0`。
- **SC-008**：`100%` 的桌面和移动端多图输出不发生图片、按钮、chips 或 composer 重叠。
- **SC-009**：tab 切换、搜索、左侧栏折叠和刷新后，未提交 composer 输入不丢失。
- **SC-010**：用户测试中，至少 `80%` 的用户可以在不阅读说明的情况下完成“搜索旧图并继续生成”。

## Dependencies And Assumptions

- v1 `/generated` 已作为可运行基线存在，v2 在该页面上继续演进。
- v2 历史范围先限定为当前用户的图片生成记录，不包含视频、团队资产或公开社区图库。
- 参考图上限继续沿用 `1-3` 张规则。
- 重新生成继续沿用“新任务、新冻结、新结算、不覆盖旧任务”的规则。
- 模型、积分和供应商接入遵守 `0001` 图片生成核心规格和 `pricing-payment` 子链的服务端 source-of-truth。
- 视觉系统继续沿用 imaima queencard 当前品牌语言。
- `0004` PRD 当前为空白占位；本文档已使用上游 v2 规格和 v1 规格补齐可执行需求。若后续 PRD 补充新产品目标，应追加新规格或更新本文档。

## Open Questions

当前没有阻塞实现计划的待确认问题。

