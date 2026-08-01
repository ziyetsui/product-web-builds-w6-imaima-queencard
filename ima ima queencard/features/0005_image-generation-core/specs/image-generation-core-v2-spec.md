# imaima queencard 图片生成工作台 v2 规格

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/image-generation-core/0003-imaima-queencard-image-generation-core-v2-spec.md`
- v1 规格：`specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md`
- v1 交互设计：`specs/w6/image-generation-core/0002-imaima-queencard-image-generation-core-interaction-design.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-16`
- Artifact role：`v2-spec`
- 状态：实现前产品与交互规格

## 命名说明

本项目继续使用 Workstream Manual Spec Chain，而不是标准 Spec Kit feature package。

图片生成核心子链当前顺序为：

```text
specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md
specs/w6/image-generation-core/0002-imaima-queencard-image-generation-core-interaction-design.md
specs/w6/image-generation-core/0003-imaima-queencard-image-generation-core-v2-spec.md
```

`0001` 和 `0002` 定义第一版生成页。本文档定义第二版生成页，不替换第一版规格，而是在第一版已经完成的 `/generated` 工作台上继续演进。

## 版本定位

### 第一版基线

第一版以“已做好的生成页”为基线。当前生成页已经具备以下产品能力：

- `/generated` 作为单一图片生成工作台。
- 左侧当前会话栏，包含品牌入口、新建生成、生成页、提示词库和当前会话摘要。
- 顶部工作区栏，包含搜索提示词占位、资产库入口和新建入口。
- 工作区标题、当前状态、参考图数量。
- 生成记录流，承载 idle、seeded input、loading、queued、generating、completed、partial success、failed 等状态。
- 底部 composer，承载参考图、提示词、模型、比例、张数、分辨率、AI Enhance、Fast Mode、预估积分和生成按钮。
- 从旧 query bridge 解析 prompt、参考图和来源信息。
- 支持任务深链、轮询读取、生成结果展示和继续生成。

第一版的重点是把生成链路跑通：输入、生成、状态、结果和继续生成。

### 第二版目标

第二版以用户手绘原型为核心，把生成页从“单任务工作台”升级为“可检索、可折叠、可复用的生成历史工作台”。

第二版重点：

- 左侧导航面板可展开和折叠。
- 顶部提供 `当前工具` 和 `所有历史` tab。
- 可以搜索所有生成对话和提示词记录。
- 主区域按时间展示生成记录。
- 每条生成记录展示 prompt、模型、积分、尺寸、张数、时间和重新生成入口。
- 生成结果支持单图和多图并排展示。
- 图片上提供下载入口。
- 底部 composer 支持收起摘要态和展开编辑态。
- composer 可以携带上一步的参考图和提示词，作为下一次生成的上下文。

第二版不是新增一个页面，而是继续演进 `/generated`。用户仍然在同一个工作台完成查看历史、搜索、继续生成和重新生成。

## 原型抽象

用户原型中的标注可以抽象为以下模块：

| 原型标注 | 产品模块 | v2 抽象 |
|---|---|---|
| 这里是一个折叠面板 | `Collapsible History Rail` | 左侧导航和历史栏支持展开/折叠 |
| tab 块可以切换 | `Workspace Scope Tabs` | 当前工具和所有历史之间切换 |
| 可以搜索所有对话记录 | `History Search` | 搜索 prompt、来源标题、模型和任务记录 |
| 时间 | `Date Group Header` | 按日期或时间段分组展示记录 |
| 所有 label 标签 | `Generation Metadata Chips` | 模型、积分、尺寸、张数、时间、状态、重新生成 |
| 生成的图片，多张图并列 | `Output Grid` | 单图稳定舞台，多图响应式网格 |
| 这里是下载 | `Image Download Action` | 图片级下载按钮，hover/focus/移动端点按可见 |
| 上一步携带的参考图和提示词 | `Composer Context Summary` | composer 收起态展示上一轮上下文摘要 |
| 点击之后放大 | `Composer Expanded State` | composer 从摘要态展开为完整编辑面板 |
| 生成 | `Primary Generate Action` | 固定主行动，显示可用性和积分消耗 |

## 产品目标

1. 用户可以把已生成内容当作可检索资产，而不是只看当前任务。
2. 用户可以快速在“当前创作”和“所有历史”之间切换，不丢失当前输入。
3. 用户可以在历史记录中找到旧 prompt 或旧图，并把它复用到下一次生成。
4. 用户可以在结果页直接下载图片、重新生成或继续修改。
5. 页面在桌面端有工作台效率，在移动端不遮挡生成结果。

## 非目标

- v2 不新增无参考图生成能力，仍遵守 v1 的 image-to-image 工作流。
- v2 不实现视频生成、口型同步或完整图片编辑器。
- v2 不实现公开社区图库。
- v2 不实现多人协作、共享会话或团队资产权限。
- v2 不改变 GPTProto、积分冻结、积分结算和下载不重复扣费的既有规则。
- v2 不复制参考产品或原型以外产品的暗色视觉皮肤，继续使用 imaima 品牌语言。

## 页面结构

v2 仍然是单一路由工作台：

```text
/generated
```

桌面端布局：

```text
+--------------------------------------------------------------------------------+
| L0 App Shell / Workspace Topbar                                                 |
+----------------------+---------------------------------------------------------+
| L1 Collapsible Rail  | L2 Scope Tabs + Search + Filters                         |
| logo / nav / history +---------------------------------------------------------+
| credits / avatar     | L3 Date Group / Current Record Header                    |
|                      +---------------------------------------------------------+
|                      | L4 Generation Record                                     |
|                      | prompt summary                                           |
|                      | chips: model / credits / size / count / time / regen     |
|                      | L5 Output Grid with download actions                     |
|                      +---------------------------------------------------------+
|                      | L7 Composer Dock                                         |
|                      | collapsed summary or expanded editor                     |
+----------------------+---------------------------------------------------------+
```

移动端布局：

```text
+------------------------------------+
| Topbar: logo / scope / new          |
+------------------------------------+
| Search and filters                  |
+------------------------------------+
| Date group                          |
| Generation records                  |
| Output grid                         |
+------------------------------------+
| Composer in document flow           |
+------------------------------------+
```

移动端不使用遮挡结果图的 fixed composer。composer 可以在结果下方自然展开，或从底部按钮打开为 sheet，但不能盖住用户正在查看的图片和操作。

## 用户场景与测试

### User Story 1：查看当前生成记录 (Priority: P1)

用户打开已做好的生成页后，可以清楚看到当前生成任务、生成图、输入 prompt、参考图、模型、积分、尺寸、张数、时间和重新生成入口。

**Why this priority**：这是 v1 到 v2 的主体验升级。没有清晰记录，历史、搜索和复用都没有基础。

**Independent Test**：打开 `/generated?taskId={taskId}`，确认页面可以完整展示当前任务记录和结果图，并且底部 composer 保留继续生成入口。

**Acceptance Scenarios**：

1. Given 用户打开一个已完成任务，When 页面加载完成，Then 主区域展示该任务的 prompt、结果图、元信息 chips、下载入口和重新生成入口。
2. Given 当前任务有多张输出，When 用户查看结果，Then 图片按稳定网格并排展示，不互相遮挡。
3. Given 当前任务仍在生成中，When 用户进入页面，Then 主区域展示稳定占位、状态、模型、预计张数和预计积分。

### User Story 2：切换当前工具和所有历史 (Priority: P1)

用户可以在顶部 tab 中切换 `当前工具` 和 `所有历史`。`当前工具` 聚焦当前生成器的任务，`所有历史` 展示用户过往图片生成记录。

**Why this priority**：这是原型最核心的视图切换，决定页面是单任务页还是历史工作台。

**Independent Test**：用户点击 `所有历史` 后，页面展示历史记录列表；点击 `当前工具` 后回到当前任务或当前输入。

**Acceptance Scenarios**：

1. Given 用户位于当前任务，When 点击 `所有历史`，Then 页面展示历史记录列表，并保留当前 composer 输入。
2. Given 用户位于历史列表，When 点击 `当前工具`，Then 页面回到当前任务或最新 seeded input。
3. Given 用户没有历史记录，When 点击 `所有历史`，Then 页面展示空状态和新建生成入口。

### User Story 3：搜索所有生成记录 (Priority: P2)

用户可以搜索所有对话和生成记录，快速找回旧 prompt、旧案例或旧模型结果。

**Why this priority**：图片生成的长期价值来自复用。搜索让历史不只是时间线。

**Independent Test**：输入一个曾经使用过的 prompt 关键词，系统返回匹配的生成记录；清空搜索后恢复默认列表。

**Acceptance Scenarios**：

1. Given 用户有多条历史记录，When 输入 prompt 关键词，Then 列表只展示匹配记录。
2. Given 搜索结果为空，When 系统展示空结果，Then 提供清空搜索和新建生成入口。
3. Given 用户清空搜索，When 输入框为空，Then 历史列表恢复到当前 tab 的默认结果。

### User Story 4：收起和展开左侧面板 (Priority: P2)

用户可以把左侧导航/历史面板折叠，给生成图和历史流留出更多空间；也可以展开以查看导航、积分、头像和最近会话。

**Why this priority**：原型明确提出折叠面板。生成页需要同时支持沉浸看图和快速导航。

**Independent Test**：点击折叠按钮后左侧栏变窄，主内容区扩大；再次点击后恢复完整面板。

**Acceptance Scenarios**：

1. Given 左侧栏处于展开态，When 用户点击折叠按钮，Then 左侧栏只保留关键图标和必要状态，主内容宽度增加。
2. Given 左侧栏处于折叠态，When 用户点击展开按钮，Then 左侧栏恢复 logo、导航、历史摘要、积分和头像。
3. Given 用户刷新页面，When 工作台重新加载，Then 系统保留或合理恢复上一次的折叠偏好。

### User Story 5：用上一轮上下文继续生成 (Priority: P1)

用户可以在底部 composer 看到上一轮携带的参考图和提示词摘要，点击后展开完整 composer，继续修改 prompt、参考图和参数后生成。

**Why this priority**：这是生成工作台的复用闭环。结果必须能变成下一次生成的上下文。

**Independent Test**：在结果记录中点击“作为参考”或 composer 摘要，确认上一轮图片和 prompt 回填到 composer，并能再次生成。

**Acceptance Scenarios**：

1. Given 用户查看一条已完成记录，When 点击结果图的“作为参考”，Then 该图进入 composer 的参考图区域。
2. Given composer 处于收起态，When 用户点击摘要或展开按钮，Then composer 展开并显示参考图、prompt 和参数控件。
3. Given composer 展开且输入有效，When 用户点击生成，Then 系统创建新任务，旧记录保留。

## Edge Cases

- 历史记录为空：所有历史 tab 展示空状态、说明和新建生成入口。
- 搜索结果为空：展示清空搜索入口，不隐藏 composer。
- 当前任务被删除或无权限：展示可恢复错误，引导回到所有历史或新建生成。
- 多图数量过多：v2 遵守 v1 输出上限，最多按任务输出张数展示；网格不得横向溢出。
- 图片加载失败：保留结果卡片结构，展示失败占位、重试加载和复制链接/重新生成入口。
- 下载失败：提示用户稍后重试，不重复扣积分。
- 左侧栏折叠后视口太窄：移动端改为隐藏或抽屉，不挤压主内容。
- composer 收起时输入无效：生成按钮仍需展示 disabled 原因。
- 用户在所有历史里修改 composer：修改保留在当前工作台，不因为切换 tab 丢失。
- 生成中刷新页面：恢复 queued/generating 状态，不清空 composer 上下文。

## 功能需求

- **FR-001**：系统必须把当前已做好的 `/generated` 页面定义为图片生成工作台 v1，并在 v2 中继续复用该工作台，而不是新增孤立页面。
- **FR-002**：系统必须提供左侧折叠面板，支持展开态和折叠态。
- **FR-003**：展开态左侧面板必须展示品牌入口、生成页入口、提示词库入口、当前或最近会话摘要、积分和用户头像。
- **FR-004**：折叠态左侧面板必须保留可识别的导航图标、展开按钮和用户状态入口。
- **FR-005**：系统必须在顶部提供 `当前工具` 和 `所有历史` 两个 scope tab。
- **FR-006**：`当前工具` 必须展示当前任务、当前输入或最近一个正在处理的图片生成记录。
- **FR-007**：`所有历史` 必须展示当前用户可访问的图片生成历史记录。
- **FR-008**：系统必须提供搜索框，支持按 prompt、来源标题、来源案例、模型和任务状态搜索生成记录。
- **FR-009**：系统必须允许用户清空搜索，并恢复当前 tab 的默认记录列表。
- **FR-010**：系统必须按日期或时间段分组展示历史记录。
- **FR-011**：每条生成记录必须展示用户输入的 prompt 或 prompt 摘要。
- **FR-012**：每条生成记录必须展示 metadata chips，至少包含能力/模式、模型、积分、比例或尺寸、张数、状态、时间。
- **FR-013**：已完成记录必须提供重新生成入口。
- **FR-014**：重新生成必须复用原 prompt、参考图和参数创建新任务，且不得覆盖旧记录。
- **FR-015**：生成结果必须支持单图展示和多图并列展示。
- **FR-016**：图片级下载入口必须在 hover、keyboard focus 和移动端点按时可访问。
- **FR-017**：下载用户自己的已生成图片不得额外扣积分。
- **FR-018**：底部 composer 必须支持收起摘要态和展开编辑态。
- **FR-019**：composer 收起态必须展示上一轮携带的参考图缩略图、prompt 摘要和生成按钮。
- **FR-020**：composer 展开态必须展示完整参考图、prompt、模型、比例、张数、分辨率、AI Enhance、Fast Mode、预估积分和生成按钮。
- **FR-021**：用户必须能从任意已完成结果把图片加入 composer 作为下一轮参考图。
- **FR-022**：用户必须能从任意生成记录把 prompt 回填到 composer。
- **FR-023**：系统必须在 tab 切换、搜索、折叠面板和刷新后保留当前未提交 composer 输入。
- **FR-024**：queued 和 generating 状态必须展示稳定占位、模型、预计张数、预计积分和参考图摘要。
- **FR-025**：failed 状态必须保留输入，展示失败原因和重试或修改入口。
- **FR-026**：blocked 状态必须说明阻塞原因，并提供登录、购买积分、降低参数或修改输入等恢复路径。
- **FR-027**：v2 视觉必须继续使用 imaima 品牌语言，不复制参考产品的深色侧栏和棕色控件。
- **FR-028**：所有图标按钮必须有可访问名称或 tooltip。
- **FR-029**：移动端 composer 不得 fixed 遮挡结果图、下载入口或继续生成入口。
- **FR-030**：历史搜索和视图切换不得触发新的供应商生成调用。

## Key Entities

- **Generation Workspace**：用户当前的图片生成工作台，包括当前 scope、搜索条件、左侧栏状态、composer 状态和当前记录。
- **Workspace Scope**：顶部 tab 选择，包含 `current_tool` 和 `all_history`。
- **Generation Record**：一次生成任务的可视化记录，包含 prompt、参考图、模型、状态、积分、时间和输出图片。
- **Generated Asset**：由生成任务产生的单张图片，可下载、预览、作为参考图或进入继续生成。
- **Composer Context**：底部 composer 当前携带的参考图、prompt 和参数，可能来自手动输入、案例带入、历史记录或已生成图片。
- **History Query**：用户在所有历史中使用的搜索词和过滤条件。
- **Rail Preference**：左侧面板的展开或折叠偏好。

## 交互逻辑

### Workspace Scope Tabs

| Scope | 显示内容 | 默认行为 |
|---|---|---|
| `当前工具` | 当前任务、当前 seeded input、正在生成任务或最近结果 | 打开 `/generated` 默认进入 |
| `所有历史` | 当前用户全部图片生成记录 | 用户主动点击进入 |

规则：

- tab 切换只改变主区域列表和标题，不清空 composer。
- `当前工具` 没有任务时展示 idle composer 和最近历史入口。
- `所有历史` 不自动选中某条记录；用户点击记录后可以展开详情或进入当前工具上下文。
- 如果当前有 generating 任务，tab 切换后仍在顶部或侧栏显示进行中状态。

### Collapsible History Rail

| 状态 | 展示 | 行为 |
|---|---|---|
| `expanded` | logo、导航、当前会话、最近记录摘要、积分、头像 | 默认桌面态 |
| `collapsed` | logo/icon、导航图标、展开按钮、头像或积分短标签 | 给主工作区让出空间 |
| `hidden` | 移动端隐藏或抽屉入口 | 不挤压内容 |

规则：

- 折叠按钮位置稳定，展开和折叠不造成主内容跳到不可见区域。
- 当前会话高亮在展开态可见；折叠态用状态点或 icon 表达。
- 积分信息在展开态显示完整数值，折叠态显示短标签或 tooltip。

### Generation Record

记录结构：

```text
[Prompt Row]
[Metadata Chips: mode / model / credits / size / count / time / regenerate]
[Output Grid]
[Record Actions: download / use as reference / quote prompt / more]
```

规则：

- prompt 可以最多展示两行，超过后折叠，允许展开查看完整内容。
- metadata chips 可以换行，但不得挤压输出图。
- 重新生成按钮与 chips 同行或同一记录头部，不能漂移到页面无关区域。
- 单图结果使用稳定尺寸，不强行拉满整个内容区。
- 多图结果按 `2` 到 `4` 张网格展示；空间不足时换行。
- 图片级操作不改变图片尺寸，不推动下方内容。

### Composer Dock

composer 有两个状态：

| 状态 | 触发 | 展示 |
|---|---|---|
| `collapsed_summary` | 页面已有结果、用户收起 composer、滚动查看历史 | 参考图缩略图、prompt 摘要、展开按钮、生成按钮 |
| `expanded_editor` | 用户点击摘要、添加参考图、编辑 prompt、改参数 | 完整参考图、prompt、模型、比例、张数、分辨率、AI Enhance、Fast Mode、预估积分、生成按钮 |

状态规则：

- 新建生成和 seeded input 默认进入 `expanded_editor`。
- 已完成任务默认可以进入 `collapsed_summary`，让结果图成为主视觉。
- 点击摘要、缩略图、添加按钮或输入区域时展开。
- 用户手动收起后保留已输入内容。
- 输入无效时生成按钮 disabled，并显示原因。
- 生成中时按钮进入 loading 或等待态，宽度保持稳定。

### 继续生成

继续生成入口包括：

- 使用生成图作为参考图。
- 引用或复制本次 prompt。
- 重新生成。
- 在 composer 中继续输入修改要求。

规则：

- “作为参考图”把图片加入 composer reference tray，遵守最多 `3` 张参考图。
- 如果 reference tray 已满，系统提示用户替换或删除一张。
- “引用 prompt”把 prompt 写入 composer；如 composer 已有未提交文本，必须先确认覆盖或追加。
- “重新生成”默认复用原输入和参数，可以直接创建新任务，也可以先把原输入回填到 composer 等用户确认。
- 重新生成属于新任务和新计费，不覆盖旧结果。

### 搜索和过滤

搜索范围：

- prompt 正文和摘要。
- 来源案例标题或分类。
- 模型展示名和内部模型名称。
- 状态，如已完成、生成中、失败。
- 日期或时间段。

规则：

- 搜索在 `所有历史` 中默认作用于所有图片生成记录。
- 在 `当前工具` 中搜索时，只过滤当前工具相关记录。
- 搜索输入为空时恢复默认列表。
- 搜索结果必须保持日期分组或给出清晰的结果数量。
- 搜索不触发供应商调用，不改变任务状态。

### 状态机

v2 沿用 v1 任务状态，但增加视图状态：

```text
workspace_scope: current_tool | all_history
rail_state: expanded | collapsed | hidden
composer_state: collapsed_summary | expanded_editor
record_state: idle | seeded_input | blocked | queued | generating | completed | partial_success | failed
```

主任务状态流：

```text
idle
-> seeded_input
-> blocked
-> seeded_input
-> queued
-> generating
-> completed
```

失败或部分成功：

```text
queued/generating
-> partial_success
-> completed via continued generation

queued/generating
-> failed
-> seeded_input via retry/edit
```

## 响应式要求

桌面端：

- 左侧栏默认展开，允许折叠。
- 顶部 tab、搜索和过滤器同一工作区内展示。
- 输出图和记录正文共享左边缘。
- composer 可固定在底部或跟随内容列 sticky，但不得遮挡记录操作。

平板端：

- 左侧栏可默认折叠。
- 搜索和过滤器允许换行。
- 多图网格按两列优先。

移动端：

- 左侧栏隐藏为顶部入口或抽屉。
- tab 和搜索上下排列。
- 多图网格单列或双列，取决于图像比例。
- composer 放在内容流中或以 sheet 展开，不能遮挡图片下载和继续生成。

## 可访问性要求

- 所有图标按钮必须有 `aria-label` 或 tooltip。
- 图片下载、作为参考、复制 prompt、重新生成必须可键盘操作。
- hover 操作必须有 keyboard focus 等价状态。
- tab 必须有清晰选中态。
- 折叠面板按钮必须表达当前状态和下一步动作。
- 搜索为空、无结果、失败和 blocked 状态必须用文本说明，不能只靠颜色。
- 生成状态变化需要对辅助技术可感知。

## Success Criteria

- **SC-001**：用户从打开 `/generated` 到识别当前任务状态、模型、积分和输出图，不超过 `5` 秒。
- **SC-002**：用户在 `所有历史` 中通过 prompt 关键词找到目标历史记录，常规历史量下不超过 `10` 秒。
- **SC-003**：`100%` 的已完成记录展示下载入口，重复下载额外扣积分为 `0`。
- **SC-004**：`100%` 的多图输出在桌面和移动端不发生图片与按钮重叠。
- **SC-005**：用户在结果记录中点击“作为参考”后，图片进入 composer 的成功率为 `100%`，且最多保留 `3` 张参考图。
- **SC-006**：tab 切换、搜索、左侧栏折叠和刷新后，未提交 composer 输入不丢失。
- **SC-007**：`100%` 的 queued/generating 记录有稳定占位，不出现主区域空白。
- **SC-008**：移动端 composer 不遮挡任何结果图、下载按钮或重新生成入口。
- **SC-009**：用户测试中，至少 `80%` 的用户可以在不阅读说明的情况下完成“搜索旧图并继续生成”。
- **SC-010**：历史搜索、tab 切换和折叠面板交互产生 `0` 次供应商生成调用。

## Assumptions

- 第一版生成页已经作为可运行基线存在，v2 在该页面上迭代。
- v2 的历史记录范围先限定为当前用户的图片生成记录，不包含视频生成和其他工具记录。
- `当前工具` 默认指当前图片生成工具，不跨到视频或编辑器。
- 历史记录数量在 v2 阶段以常规个人使用量为目标；大规模资产管理和复杂筛选可后续扩展。
- 参考图上限继续沿用 v1 的 `1-3` 张规则。
- 重新生成继续沿用 v1 积分规则：新任务、新冻结、新结算，不覆盖旧任务。
- 视觉系统继续沿用 imaima queencard 的粉色画布、粗黑边、白色、lemon、seafoam、pumpkin 和现有字体风格。
