# imaima queencard 图片生成核心功能规格

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md`
- 关联定价支付规格：`specs/w6/pricing-payment/0001-imaima-queencard-pricing-payment-spec.md`
- 关联定价支付计划：`specs/w6/pricing-payment/0002-imaima-queencard-pricing-payment-impl-plan.md`
- Raphael 组件参考：`w6/ima ima queencard/docs/raphael-image-generator-component-reference/`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-15`
- Artifact role：`image-generation-core-spec`
- 状态：实现前需求与设计规格

## 命名说明

当前项目采用 Workstream Manual Spec Chain，而不是标准 Spec Kit feature package。

本功能开启独立的图片生成核心子链：

```text
specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md
specs/w6/image-generation-core/0002-imaima-queencard-image-generation-core-interaction-design.md
```

后续建议按同一目录追加：

```text
specs/w6/image-generation-core/0003-imaima-queencard-image-generation-core-impl-plan.md
specs/w6/image-generation-core/0004-imaima-queencard-image-generation-core-implementation-tasks.md
specs/w6/image-generation-core/0005-imaima-queencard-image-generation-core-code-review.md
```

## 决策摘要

imaima queencard 的图片生成核心功能不是通用「AI 图片玩具」，而是围绕小红书爆款图文复刻的生产工具。

v1 需要实现以下闭环：

- 首页或 `/prompts` 下方的爆款图文卡片可以作为生成入口。
- 用户点击爆款图文后，不直接离开页面；系统弹出生成确认对话框。
- 对话框必须自动带入该案例的前 `3` 张参考图和生成提示词。
- 用户可以在对话框里调整提示词、模型、比例、张数、分辨率和垫图相关选项。
- 用户点击「生成」后，系统创建图片生成任务，并跳转到 `/generated` 生成页展示进度和结果。
- 生成必须接入 GPTProto-first 的图片模型 API。v1 只支持有参考图的 image-to-image 工作流；底层可使用 GPTProto `image-edit` 或 `image-to-image` endpoint，但每次生成至少需要 `1` 张参考图。
- 生成前必须校验登录和积分，冻结积分后才能调用供应商；成功按实际输出结算，失败释放冻结积分。
- 视觉和交互必须保持 imaima queencard 当前风格：粉色画布、黑色粗边、白色/柠檬/海盐绿/南瓜色块、Manrope + Alfa Slab One、轻微错位卡片动效。不要复制 Raphael 的棕黑暗色系。

## 外部资料记录

核对日期：`2026-06-16`。

- Raphael AI 首页：https://raphael.app/
- Raphael 本地截图参考：`w6/ima ima queencard/docs/raphael-image-generator-component-reference/`
- 用户提供 GPTProto API 四要素（2026-06-16）：`openai/gpt-image-2/image-edit`、`google/gemini-3.1-flash-image-preview/image-edit`、`doubao/seedream-5-0-260128/image-edit`、`doubao/doubao-seedream-5-0-260128/image-edit`、`vidu/viduq2/image-to-image`。
- GPTProto GPT-Image-2 图像编辑：https://gptproto.com/model/openai/gpt-image-2/image-edit
- GPTProto Gemini 3.1 Flash Image Preview 图像编辑：https://gptproto.com/model/google/gemini-3.1-flash-image-preview/image-edit
- GPTProto Seedream 5.0 图像编辑：https://gptproto.com/model/bytedance/seedream-5-0-260128/image-edit
- GPTProto Doubao Seedream 5.0 图像编辑：https://gptproto.com/model/bytedance/doubao-seedream-5-0-260128/image-edit
- GPTProto ViduQ2 图生图：https://gptproto.com/model/vidu/viduq2/image-to-image

说明：API key 已由用户单独提供，但不能写入本规格、源码、前端环境变量或提交记录。实现只读取服务端 `GPTPROTO_API_KEY`。

Raphael 可借鉴的结构是：提示词输入、`1-3` 张参考图、模型选择、比例/张数/分辨率设置、AI Enhance、Fast Mode、生成按钮、历史生成状态和案例点击使用。imaima 只参考这些交互结构，不复用 Raphael 的品牌、暗色皮肤和「免费无限生成」商业表达。

## 与定价支付规格的关系

图片生成必须遵守 `pricing-payment` 子链中已经确认的规则：

- GPTProto API key 只存在于服务端环境变量。
- 新用户赠送 `2` 积分，有效期 `30` 天，只覆盖低成本试用，不覆盖主力模型完整生成。
- 模型扣积分按「模型单张积分 * 成功输出张数」计算。
- 生成前冻结积分，供应商失败、超时、内容审核失败或没有可计费输出时释放冻结积分。
- 下载自己已经生成的图片不重复扣积分。
- 匿名用户或无积分用户产生 `0` 次供应商调用。

本规格只定义图片生成体验、任务、垫图 API 和结果页。Stripe 商品、Webhook 履约、积分包发放继续以 `pricing-payment` 子链为准。

## 用户状态

| 用户状态 | 可以打开生成对话框 | 可以进入生成页 | 可以启动供应商生成 | 下一步动作 |
|---|---:|---:|---:|---|
| 匿名用户 | 是 | 是，待提交态 | 否 | 登录 |
| 已登录，无积分 | 是 | 是，待提交态 | 否 | 购买积分或订阅 |
| 已登录，有可用积分 | 是 | 是 | 是 | 正常生成 |
| 已登录，积分不足本次预估 | 是 | 是，待补积分 | 否 | 降低张数/模型，或购买积分 |
| 已登录，任务已有结果 | 是 | 是 | 仅重新生成时调用 | 下载、复制提示词、重新生成 |

## 核心用户流

### Flow A：从爆款图文进入生成

1. 用户进入 `/prompts`。
2. 用户点击下方任一爆款图文卡片、图片、或「用当前案例生成」按钮。
3. 系统打开生成确认对话框，而不是新开窗口。
4. 对话框带入：
   - `sourceCaseId`
   - `sourceCaseCategory`
   - 案例标题、作者、原帖链接和博主链接
   - `imagesFor(item).slice(0, 3)` 得到的前三张参考图
   - `promptForCase(item)` 得到的提示词
5. 用户可以编辑提示词和生成参数。
6. 用户点击「生成」。
7. 如果未登录，系统跳到 `/login?from=...`，登录后回到生成页待提交状态。
8. 如果积分不足，系统展示购买入口，不调用 GPTProto。
9. 如果可以生成，系统创建任务、冻结积分，并进入 `/generated?taskId={taskId}` 或同等生成页任务状态。
10. `/generated` 展示生成中、成功、失败或部分成功结果。

验收重点：

- 任一案例进入对话框时，参考图最多 `3` 张，顺序必须与案例图集顺序一致。
- 对话框里的提示词必须与当前案例动态 prompt 一致，而不是只带案例原始标题。
- 旧的 `/generated?...` query bridge 仍可解析为生成页待提交状态，但新主路径应使用对话框确认后创建任务。

### Flow B：手动输入生成

1. 用户从 `/generated` 或首页生成组件打开空白生成器。
2. 用户上传 `1-3` 张参考图并输入提示词。
3. 未上传参考图时，生成按钮禁用，并提示至少添加 `1` 张参考图。
4. 有参考图时，模型能力默认为 image-to-image 工作流，底层优先展示 `gpt-image-2-edit`、`viduq2-i2i` 等垫图模型。
5. 用户选择参数并点击「生成」。
6. 系统按同一积分和任务流程执行。

### Flow C：重新生成

1. 用户在结果页点击「重新生成」。
2. 系统复用原任务的提示词、参考图和参数，创建新任务。
3. 重新生成属于新的计费任务，必须重新冻结积分。
4. 原结果继续保留。

## 图片生成组件设计

建议组件名：

```text
ImageGenerationComposer
ImageGenerationDialog
GeneratedPage
```

建议位置：

```text
frontend/src/components/common/image-generation-composer.tsx
frontend/src/components/common/image-generation-dialog.tsx
frontend/src/app/generated/page.tsx
```

### 组件输入状态

```ts
type ImageGenerationSeed = {
  source: "manual" | "prompt-library" | "regenerate";
  templateId?: string;
  sourceCaseId?: string;
  sourceCaseCategory?: string;
  sourceNoteUrl?: string;
  sourceAuthorUrl?: string;
  prompt: string;
  referenceImages: string[];
};
```

规则：

- `referenceImages` 必须保留 `1-3` 张；没有参考图时不能提交生成。
- 本地 `/xhs-cases/...` 图片必须转成 GPTProto 可访问的绝对 HTTPS URL；仅在目标模型实测支持输入 base64 时，服务端才可转成 base64 再传给 GPTProto。
- 对外部图片 URL 必须做协议校验，只允许 `https:` 和可信的 `http:` 开发环境地址。
- 如果一张参考图加载失败，UI 允许用户删除；生成时服务端必须过滤不可用图片，并把过滤结果写入任务 metadata。

### 组件控件

| 控件 | 类型 | v1 选项 | 默认值 | 备注 |
|---|---|---|---|---|
| 参考图 | 上传/预览区 | `1-3` 张 | 从案例带入前三张 | 支持删除、替换、排序；案例图默认不可超过 3 张；少于 1 张禁用生成 |
| 提示词 | textarea | 最多 `2000` 字符 | 案例 prompt 或空 | 显示字符计数；空 prompt 禁止生成 |
| 模型 | picker/popover | 主力、快速、经济、垫图 | 默认 `gpt-image-2-edit` | 模型列表来自服务端配置；所有模型必须要求参考图 |
| 比例 | icon segmented control | `1:1`、`3:4`、`4:3`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9` | 案例入口默认 `3:4`，手动默认 `1:1` | 服务端按模型映射合法 size |
| 输出张数 | segmented control | `1`、`2`、`3`、`4` | `4`，单输出模型自动限制为 `1` | 预估积分实时更新 |
| 分辨率 | select/menu | `Auto`、`1K`、`2K`、`4K` | `Auto` | 4K 只在支持模型启用 |
| AI Enhance | switch | on/off | 案例入口默认 off | 案例 prompt 已经是结构化提示词，默认不改写 |
| Fast Mode | switch | on/off | on | 作为路由偏好；只有配置支持时影响模型或队列 |
| 生成按钮 | button | enabled/disabled/loading | disabled until valid | 按钮旁显示预估积分 |

### 模型选择分组

| 分组 | 展示模型 | 推荐用途 |
|---|---|---|
| 主力 | GPT Image 2 / `gpt-image-2-edit` | 默认高质量改图、多参考图融合、中文文字和品牌图 |
| 快速 | Gemini 3.1 Flash Image Preview / `gemini-3.1-flash-edit` | 日常参考图改图、低延迟试稿 |
| 经济 | Seedream 5.0 / `seedream-5-edit`、Doubao Seedream 5.0 / `doubao-seedream-5-edit` | 中文视觉资产、批量试错、参考图再创作 |
| 垫图 | ViduQ2 / `viduq2-i2i`，GPT Image 2 image-edit，Seedream 5.0 image-edit | 结构保持、风格迁移、参考图再创作 |

### 视觉要求

- 页面背景使用 `canvas-pink #f6e0db`。
- 主要面板使用 `surface-white #ffffff`，粗黑边 `2px`，卡片圆角约 `10px`。
- CTA 使用 `pumpkin #ef724f` 或 `charcoal #000000` 反色。
- 标签和状态可以使用 `lemon #e7db4c`、`seafoam #ace2df`、`canvas-pink`。
- 字体沿用 Manrope；大标题仍可使用 Alfa Slab One。
- 对话框和弹层使用现有 shadcn/Radix UI primitives，视觉上做 imaima 皮肤化。
- 不使用 Raphael 的深棕背景、头像品牌、免费无限生成文案。
- 不把卡片嵌套在卡片里；对话框内部区域用边框分区。

## 生成页设计

生成页是单一图片生成工作台。Canonical route 为 `/generated`；它承载空白输入、从案例带入的 seed、生成中状态、成功/失败结果、历史切换和继续调整。需要深链到某个任务时使用 `/generated?taskId=...` 或同等 query/state。

生成页的核心不是“填表”，而是围绕一个连续的生成会话展开工作流：用户输入或带入参考，系统生成并追加记录，用户在同一页继续修改、复用、重新生成或下载。

生成页输入来源：

| 来源 | 进入方式 | 页面状态 | 行为 |
|---|---|---|---|
| 空白手动输入 | 用户打开 `/generated` | `idle` | 展示空 composer 和最近任务入口 |
| 案例带入 | 从 `/prompts` 或 query bridge 进入 | `seeded_input` | 预填参考图、提示词和参数，等待用户点击生成 |
| 任务深链 | `/generated?taskId=...` | 对应任务状态 | 加载任务记录、结果和继续调整入口 |
| 重新生成 | 结果记录点击重新生成 | `seeded_input` 或直接创建新任务 | 复用原任务输入并重新计费 |

共享设计原则：

- 参考图、提示词、参数、预估积分和生成按钮必须形成一条清晰的操作路径。
- `seeded_input` 只是生成页的待提交状态，不是独立页面；该状态不得自动调用供应商。
- 模型选择、比例、张数、分辨率、AI Enhance、Fast Mode 在所有状态中使用同一套控件语言。
- Raphael 可借鉴的是信息架构：历史任务流、生成状态卡、底部 composer、任务元信息 chips、图片 hover 操作。imaima 不复制 Raphael 的深棕暗色皮肤、左侧产品导航、头像品牌、免费无限生成表达；必须继续使用粉色画布、粗黑边、lemon/surface-white/pumpkin 色块和当前品牌导航。

生成页状态：

| 状态 | UI |
|---|---|
| `idle` | 空白 composer、最近任务入口、无供应商调用 |
| `seeded_input` | composer 预填参考图、提示词和参数，等待用户明确点击生成 |
| `queued` | 已冻结积分，等待供应商或队列 |
| `generating` | 展示生成中占位、模型、张数、预估积分、参考图 |
| `partial_success` | 展示成功图片，提示部分失败，只结算成功输出 |
| `completed` | 展示图片网格、下载、复制提示词、重新生成 |
| `failed` | 展示失败原因，积分已释放，允许重试 |
| `blocked` | 未登录、积分不足、内容审核等可恢复阻塞 |

生成页必须支持刷新恢复状态。用户刷新页面后，不应丢失当前 seed、任务进度或结果。

生成页必须是“生成历史/生成工作台 + 底部生成器”结构：顶部展示日期/分组标题、当前记录/历史筛选、搜索和过滤；中间展示当前生成记录展开态或 seeded input；底部保留可复用的 composer，使用户可以在结果基础上继续生成或调整参数。

### 生成页页面模型抽象

参考产品截图可以抽象为同一套页面模型，而不是具体照搬某一种皮肤：

| 层级 | 模块 | 责任 |
|---|---|---|
| L0 | App Shell | 品牌、全局导航、订阅/登录入口；imaima v1 继续用现有品牌导航 |
| L1 | History Rail | 最近任务、默认创作、新任务入口；v1 可选，必须可折叠 |
| L2 | Workspace Header | 当前日期/分组标题、当前记录/全部历史、搜索、时间/模式/类型过滤 |
| L3 | Task Stream | 用户输入、系统状态、生成记录按时间流展示 |
| L4 | Generation Record | 一次生成任务的状态、提示词、元信息 chips、结果图、消耗积分和操作 |
| L5 | Asset Stage | 稳定比例的结果图/生成占位；hover/focus 显示图片级操作 |
| L6 | Continuation Strip | 继续修改建议、以图生图、作为参考、重新生成、引用提示词 |
| L7 | Composer Dock | 参考图、继续输入、模型/比例/张数/分辨率/Fast Mode、预估积分和生成按钮 |

抽象 ASCII：

```text
+------------------------------------------------------------+
| L0 App Shell                                                |
+--------------+---------------------------------------------+
| L1 History   | L2 Workspace Header                         |
| Rail         +---------------------------------------------+
| optional     | L3 Session Stream                           |
|              | +-----------------------------------------+ |
|              | | L4 Generation Record                    | |
|              | | L5 Asset Stage                          | |
|              | | L6 Continuation Strip                   | |
|              | +-----------------------------------------+ |
|              | L7 Composer Dock                           |
+--------------+---------------------------------------------+
```

### 生成页状态 ASCII 简版

这些状态不是不同路由，也不是不同页面文件；它们是同一个 `/generated` 工作台的可复制状态模板。

#### S0 Idle：空工作台

```text
[Header]
[Empty Stream]
[Composer: empty refs + prompt + controls + disabled submit]
```

#### S1 Seeded Input：已带入参考，待提交

```text
[Header: source]
[Input Summary]
[Composer: 1-3 refs + filled prompt + controls + submit]
```

#### S2 Blocked：可恢复阻塞

```text
[Header]
[Blocked Record: reason + recovery action + preserved input]
[Composer: preserved input + blocked action]
```

#### S3 Running：排队或生成中

```text
[Header: active record]
[Record: state + metadata + input summary]
[Asset Stage: refs + stable placeholder/progress]
[Composer: secondary state]
```

#### S4 Result：完成或部分成功

```text
[Header: result record]
[Record: state + metadata + input summary]
[Asset Stage: refs + outputs + hover/focus actions]
[Continuation Strip: reuse + download + regenerate]
[Composer: ready for next generation]
```

#### S5 Failed：失败但输入可复用

```text
[Header: failed record]
[Failed Record: reason + credit release + preserved input]
[Composer: preserved input + retry]
```

### 细节模块 ASCII 简版

#### Reference Tray

```text
[Reference Tray] = [ref] [ref] [ref] [add]
rules: min 1, max 3, fixed ratio, reorderable
```

#### Asset Stage

```text
[Asset Stage] = [asset/placeholder] + [hover/focus actions]
rules: stable size, no layout shift, keyboardable
```

#### Generation Record

```text
[Generation Record] = [state] [meta] [input] [assets] [actions]
```

#### Composer Dock

```text
[Composer Dock] = [refs] [prompt] [controls] [submit]
validation: prompt required, reference required
```

生成页布局与对齐规则：

- 页面模型的最小可实现切片是 L0、L2、L3、L4、L5、L6、L7；L1 History Rail 和完整过滤器属于增强项。
- v1 可以先不实现完整左侧工具栏；若需要工具导航或最近任务栏，必须做 imaima 品牌化，不复制参考产品的深色 sidebar。
- 最近任务栏属于增强项；若实现，桌面端可常驻或可折叠，当前记录高亮；移动端使用抽屉或隐藏入口，不能挤压主生成结果。
- 顶部工作区第一行左侧放日期或分组标题，右侧放 Current tool / All history、搜索、时间和类型过滤；桌面端同一基线对齐，移动端标题在上、筛选控件换行。
- 生成记录、结果图和结果快捷动作必须共享同一个左边缘；不要让提示词、chips、结果图分别形成不同的视觉起点。
- 生成记录元信息用 chips：能力、模型、比例、张数、分辨率、Fast Mode、创建时间、重新生成；桌面端优先单行展示，空间不足时 chips 换行但不挤压结果图。
- 当前生成记录的提示词行必须与缩略图垂直居中；长提示词允许截断或换行到第二行，但不能把元信息 chips 推出视口。
- 生成记录也可以呈现为对话式工作流：用户输入气泡靠右，系统状态、说明文案、结果图和后续建议靠左并沿同一内容列排列。
- `queued`/`generating` 状态必须展示稳定占位框，不允许页面大面积空白。
- 生成中占位必须显示模型、预计张数、预计积分和参考图缩略图。
- completed 状态优先展示输出图片；桌面端单张结果图使用稳定宽度和固定比例，结果图上方先给出简短完成说明。
- 结果图 hover/focus 时显示图片级覆盖操作，推荐优先使用角落浮层：左下放下载，右下放预览/放大、编辑/擦除或更多；多操作场景也可使用顶部/底部两条短工具条。覆盖工具条不得改变图片尺寸或推动图下内容。
- hover 工具条必须同时支持键盘 focus 和移动端长按/点按展开；所有图标按钮必须有 tooltip 或 aria-label。
- 图下常驻区域放继续修改建议 chips、AI 生成声明和本次消耗积分；建议 chips 可以横向滚动或换行，但不能遮挡操作按钮。
- 图下派生动作按钮可以包括以图生图、作为参考图、打开编辑器；Raphael 参考里的 Img to Vid / Lip Sync 属于视频后续链路，imaima v1 不作为必需按钮，未实现时不要展示可点击入口。
- 图下主操作保留重新生成、引用提示词/复制提示词、更多；下载、预览、局部编辑等图片级高频操作可同时出现在 hover 工具条中。
- 右侧大面积空间可以保留给未来详情面板或多结果网格，但不能把单张结果图强行拉伸到整行。
- 滚动较长时可以显示「回到底部」浮动按钮，位置靠右下，不能覆盖结果图、建议 chips 或底部 composer。
- 底部 composer 是生成页的主要二次行动区，支持继续生成、重新使用结果图作为参考图、调整模型和参数。
- 底部 composer 在桌面端可 sticky/fixed 于底部，宽度应小于主工作区并居中或与内容列对齐；距离视口底部保留固定安全间距，不能遮挡结果图和快捷动作。
- 底部 composer 内部左侧放参考图缩略图和添加按钮，中间放提示词，右上放 AI Enhance；底部控制条从左到右依次为类型、模型、比例/分辨率、张数、Fast Mode、更多设置、预估积分和生成按钮。
- 生成按钮固定在 composer 右下角，预估积分 chip 靠近生成按钮；加载中时按钮宽度保持稳定，避免底部工具条抖动。
- 移动端底部 composer 必须在内容下方自然流式排列，不能 fixed 遮挡结果图；控件按两行或多行排列，生成按钮独占最后一行或保持右对齐。
- 生成页的搜索/过滤（Current task、All history、All time、All types）属于增强项；v1 可先展示当前记录和最近记录，但结构应预留。
- 所有按钮和控件保持粗黑边、品牌色和 shadcn/Radix 可访问性，不使用 Raphael 的暗色、棕色透明控件。

## 垫图模型 API 接入

### 接入目标

v1 只支持用户上传或从爆款案例带入参考图后生成新图片。没有参考图时不能启动生成。

垫图能力分两类：

| 能力 | 含义 | 默认使用场景 |
|---|---|---|
| `image-edit` | 输入一张或多张图片，按提示词做编辑/融合/改图 | 多参考图、人物或版式延续 |
| `image-to-image` | 输入源图，做结构保持、重绘、风格迁移 | 保留首图构图，做新风格 |

### v1 实际接入模型矩阵

| 内部模型 key | GPTProto provider/model/能力 | Endpoint | 输入图片 | 输出张数 | 默认积分 | v1 角色 |
|---|---|---|---:|---:|---:|---|
| `gpt-image-2-edit` | `openai/gpt-image-2/image-edit` | `/api/v3/openai/gpt-image-2/image-edit` | `1-3` | `1-4`，使用 `n` | `5/张` | v1 默认高质量改图模型，优先接入 |
| `gemini-3.1-flash-edit` | `google/gemini-3.1-flash-image-preview/image-edit` | `/api/v3/google/gemini-3.1-flash-image-preview/image-edit` | `1-3` | `1` 起，按实测确认是否支持多张 | `5/张` | 快速多参考图改图、低延迟试稿 |
| `seedream-5-edit` | `doubao/seedream-5-0-260128/image-edit` | `/api/v3/doubao/seedream-5-0-260128/image-edit` | `1-3` | `1` 起，按实测确认是否支持多张 | `4/张` | 经济垫图/中文图文 |
| `doubao-seedream-5-edit` | `doubao/doubao-seedream-5-0-260128/image-edit` | `/api/v3/doubao/doubao-seedream-5-0-260128/image-edit` | `1-3` | `1` 起，按实测确认是否支持多张 | `4/张` | Seedream 备用线路 |
| `viduq2-i2i` | `vidu/viduq2/image-to-image` | `/api/v3/vidu/viduq2/image-to-image` | `1-3` | 默认 `1`，v1 UI 限制为单张 | `3/张` | image-to-image 结构保持、风格迁移 |

说明：

- v1 真实模型注册表必须以上表为 source of truth；历史模型 key 只能作为兼容 alias，不作为完成验收的必须模型。
- 用户提供的 API key 只进入服务端 `GPTPROTO_API_KEY`，不得出现在 spec、源码、日志、数据库、`NEXT_PUBLIC_*` 或提交记录中。
- 所有 GPTProto 请求必须由服务端发起，统一使用 `Authorization: Bearer ${GPTPROTO_API_KEY}` 和 `Content-Type: application/json`。
- GPTProto v3 创建任务后通常先返回 `status: "created"`、空 `outputs` 和 `data.urls.get`。Adapter 必须轮询返回的 `get` URL；若缺少该 URL，则使用 `/api/v3/predictions/{data.id}/result`。
- 对不支持多输出参数的模型，服务端可以限制 `outputCount = 1`，或在一次积分 hold 下拆成多次 provider call；v1 优先选择限制 UI，避免重复任务和重复扣费语义复杂化。

### GPTProto v3 请求规格

#### GPT-Image-2 image-edit

```json
{
  "images": ["https://example.com/reference-1.jpg"],
  "prompt": "保留参考图的人物身份和版式结构，改成新的主题。",
  "n": 1,
  "quality": "auto",
  "size": "auto",
  "enable_sync_mode": "false",
  "response_format": "url"
}
```

#### Gemini 3.1 Flash Image Preview image-edit

```json
{
  "prompt": "保持参考图空间结构，生成一张适合小红书封面的室内视觉图。",
  "images": ["https://example.com/reference-1.jpg"],
  "size": "1K",
  "aspect_ratio": "1:1",
  "output_format": "jpeg",
  "enable_sync_mode": false,
  "enable_base64_output": false
}
```

#### Seedream 5.0 image-edit

```json
{
  "prompt": "保持首图构图和小红书图文语感，生成新的封面图。",
  "images": ["https://example.com/reference-1.jpg"],
  "size": "2048x2048",
  "enable_base64_output": false,
  "enable_sync_mode": false
}
```

#### Doubao Seedream 5.0 image-edit

```json
{
  "prompt": "保持参考图构图和小红书封面语感，生成新的主题视觉。",
  "images": ["https://example.com/reference-1.jpg"],
  "size": "2048x2048",
  "enable_base64_output": false,
  "enable_sync_mode": false
}
```

#### ViduQ2 image-to-image

```json
{
  "prompt": "保持源图结构，改成夸张、醒目的小红书封面构图。",
  "images": ["https://example.com/reference-1.jpg"],
  "aspect_ratio": "3:4",
  "resolution": "1080p",
  "seed": 1
}
```

#### 统一创建响应

GPTProto v3 创建任务响应需要至少兼容以下结构：

```json
{
  "data": {
    "id": "9a37064a-f353-474c-b98e-1de6539b2435",
    "model": "gpt-image-2",
    "outputs": [],
    "urls": {
      "get": "https://gptproto.com/api/v3/predictions/9a37064a-f353-474c-b98e-1de6539b2435/result"
    },
    "hasNsfwContents": [],
    "status": "created",
    "createdAt": "2026-06-16 08:23:58",
    "executionTime": 0,
    "timings": {
      "inference": 0
    }
  },
  "message": "success",
  "code": 200
}
```

Adapter 不能把 `outputs: []` 当作失败；必须进入轮询，直到结果完成、失败、内容审核阻塞或超时。

### 参数映射规则

| 内部模型 key | UI 比例映射 | UI 分辨率映射 | 输出张数映射 | 备注 |
|---|---|---|---|---|
| `gpt-image-2-edit` | 优先在 prompt 后追加 `--ar {aspectRatio}`；`size` 默认 `auto` | `Auto` -> `auto`，其他值仅在实测支持后启用 | `n = outputCount` | 附件示例使用 `quality: "auto"`、`response_format: "url"` |
| `gemini-3.1-flash-edit` | `aspect_ratio = aspectRatio` | `Auto` -> `1K`，`1K/2K/4K` 直传实测支持值 | v1 可先限制 `1` | `output_format` 默认 `jpeg` |
| `seedream-5-edit` | 映射为最接近的 `size`，如 `1:1` -> `2048x2048` | `Auto` -> `2048x2048` | v1 可先限制 `1` | 适合中文图文经济线路 |
| `doubao-seedream-5-edit` | 映射为最接近的 `size`，如 `1:1` -> `2048x2048` | `Auto` -> `2048x2048` | v1 可先限制 `1` | 必须传入至少 `1` 张参考图 |
| `viduq2-i2i` | `aspect_ratio = aspectRatio` | `Auto` -> `1080p`，其他值按 Vidu 支持集限制 | v1 限制 `1` | `seed` 可选；没有用户显式输入时由服务端生成或省略 |

### Adapter 输出规格

所有供应商返回必须归一为：

```ts
type NormalizedImageGenerationResult = {
  provider: "gptproto";
  providerTaskId?: string;
  model: string;
  capability: "image-edit" | "image-to-image" | "tool";
  images: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    providerCostUsd?: number;
  };
  raw: unknown;
};
```

归一化规则：

- `data.urls.get` 必须保存为任务轮询 URL；没有返回时再根据 `data.id` 拼接 `/api/v3/predictions/{id}/result`。
- `data.outputs`、`data.output`、`data.images`、`data[].url`、`data[].b64_json` 都必须被兼容解析。
- 如果返回的是临时 URL，服务端必须下载并保存为用户资产，不能只保存临时供应商链接。
- 如果返回 `hasNsfwContents`、`has_nsfw_contents` 或内容策略错误，任务进入 `failed` 或 `partial_success`，不结算失败图片。
- 如果供应商返回少于请求数量的图片，只按成功图片数量结算积分。

## 积分与计费设计

### 预估积分

```text
estimatedCredits = modelCreditsPerImage * outputCount
```

示例：

| 模型 | 输出张数 | 预估积分 |
|---|---:|---:|
| GPT Image 2 主力，`5/张` | `4` | `20` |
| Gemini 3.1 Flash 快速，`5/张` | `2` | `10` |
| Seedream 5.0 经济，`4/张` | `4` | `16` |
| Doubao Seedream 5.0，`4/张` | `1` | `4` |
| ViduQ2 垫图，`3/张` | `1` | `3` |

### 扣费流程

1. 服务端收到生成请求。
2. 校验用户登录。
3. 校验 prompt、参考图、模型和参数。
4. 使用服务端模型配置计算预估积分。
5. 如果余额不足，返回 `INSUFFICIENT_CREDITS`，不调用供应商。
6. 创建 `generation_tasks`。
7. 创建 credit hold，`holdKey = generationTaskId`。
8. 调用 GPTProto。
9. 保存成功输出为 `generated_assets`。
10. 按成功输出数计算 `settledCredits`。
11. 结算 hold；若没有成功输出则释放 hold。
12. 更新任务状态。

生成失败时：

- 供应商请求前失败：不应有 hold，或必须释放 hold。
- 供应商请求后失败但无输出：释放全部 hold。
- 部分成功：只结算成功输出对应积分，释放差额。
- 重试：创建新任务和新 hold，不复用失败任务的 hold。

## 数据模型

目标状态新增或泛化以下实体。现有 `videos` 表可作为首轮兼容层，但不应继续扩大视频命名。

### `generation_tasks`

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | text/uuid | 任务 ID，也可作为 hold key |
| `userId` | text | 所属用户 |
| `source` | text | `manual`、`prompt-library`、`regenerate` |
| `sourceCaseId` | text nullable | 来源爆款案例 |
| `sourceCaseCategory` | text nullable | 来源类别 |
| `prompt` | text | 实际提交给模型的提示词 |
| `originalPrompt` | text nullable | AI Enhance 前的提示词 |
| `referenceImages` | jsonb | `1-3` 张输入图 |
| `model` | text | 内部模型 key |
| `providerModel` | text | GPTProto 模型名 |
| `capability` | text | `image-edit`、`image-to-image` |
| `aspectRatio` | text | UI 比例 |
| `size` | text nullable | Adapter 映射后的尺寸 |
| `resolution` | text | `auto`、`1k`、`2k`、`4k` |
| `outputCount` | integer | 请求张数，`1-4` |
| `status` | text | `queued`、`generating`、`partial_success`、`completed`、`failed` |
| `requestedCredits` | integer | 预估冻结积分 |
| `settledCredits` | integer | 实际结算积分 |
| `creditHoldKey` | text | hold id 或 key |
| `providerTaskId` | text nullable | GPTProto task/prediction id |
| `providerResultUrl` | text nullable | GPTProto `data.urls.get`，用于刷新恢复和后台轮询 |
| `providerRaw` | jsonb nullable | 精简后的供应商响应 |
| `errorCode` | text nullable | 失败类型 |
| `errorMessage` | text nullable | 用户可理解的错误 |
| `createdAt` | timestamp | 创建时间 |
| `startedAt` | timestamp nullable | 开始调用供应商 |
| `completedAt` | timestamp nullable | 结束时间 |

### `generated_assets`

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | text/uuid | 资产 ID |
| `taskId` | text | 关联 generation task |
| `userId` | text | 所属用户 |
| `outputIndex` | integer | 输出顺序 |
| `storageUrl` | text | 本地对象存储/CDN URL |
| `providerUrl` | text nullable | 原始临时 URL，仅审计用 |
| `mimeType` | text | 默认 `image/png` 或供应商返回值 |
| `width` | integer nullable | 宽 |
| `height` | integer nullable | 高 |
| `creditsCharged` | integer | 该输出对应结算积分 |
| `isDeleted` | boolean | 软删除 |
| `createdAt` | timestamp | 创建时间 |

### 积分流水兼容

目标状态建议新增 `IMAGE_CONSUME` 或把 `VIDEO_CONSUME` 泛化为 `GENERATION_CONSUME`。

如果首轮不改枚举，可以继续写入现有 `VIDEO_CONSUME`，但：

- API 和 UI 展示必须显示为 `image_generate`。
- `credit_transactions.videoUuid` 实际保存 `generationTaskId`。
- 后续 migration 需要把字段改成更通用的 `taskId` 或 `generationId`。

## API 合约

### `POST /api/v1/image-generations/estimate`

Request：

```json
{
  "model": "gpt-image-2-edit",
  "capability": "image-edit",
  "outputCount": 4
}
```

Response：

```json
{
  "success": true,
  "data": {
    "estimatedCredits": 20,
    "modelCreditsPerImage": 5
  }
}
```

### `POST /api/v1/image-generations`

Request：

```json
{
  "source": "prompt-library",
  "sourceCaseId": "68e7953a00000000070087cc",
  "sourceCaseCategory": "搞笑漫画",
  "prompt": "参考图文《鸡，谁懂？》的节奏，生成一组新的小红书搞笑漫画主题...",
  "referenceImages": [
    "https://imaimaqueencard.com/xhs-cases/gallery/68e7953a00000000070087cc/01.jpg",
    "https://imaimaqueencard.com/xhs-cases/gallery/68e7953a00000000070087cc/02.jpg",
    "https://imaimaqueencard.com/xhs-cases/gallery/68e7953a00000000070087cc/03.jpg"
  ],
  "model": "gpt-image-2-edit",
  "capability": "image-edit",
  "aspectRatio": "3:4",
  "outputCount": 4,
  "resolution": "auto",
  "aiEnhance": false,
  "fastMode": true
}
```

Response：

```json
{
  "success": true,
  "data": {
    "taskId": "gen_abc123",
    "status": "generating",
    "requestedCredits": 20,
    "redirectUrl": "/generated?taskId=gen_abc123"
  }
}
```

Rules：

- Requires login.
- Server must re-compute credits and ignore any client-sent credit number.
- Server must reject more than `3` reference images.
- Server must reject unsupported model/capability combinations.
- Server must reject or clamp `outputCount` values above the selected model's v1 cap, especially `viduq2-i2i` and other single-output models.
- Server must freeze credits before provider call.
- Server must return `INSUFFICIENT_CREDITS` before provider call when balance is insufficient.

### `GET /api/v1/image-generations/{taskId}`

Response：

```json
{
  "success": true,
  "data": {
    "taskId": "gen_abc123",
    "status": "completed",
    "prompt": "...",
    "model": "gpt-image-2-edit",
    "requestedCredits": 20,
    "settledCredits": 20,
    "assets": [
      {
        "id": "asset_1",
        "url": "https://cdn.example.com/generated/asset_1.png",
        "width": 1024,
        "height": 1360
      }
    ]
  }
}
```

Rules：

- Requires login.
- User can only read own tasks.
- Task polling should be safe to call repeatedly.

### `POST /api/v1/image-generations/{taskId}/regenerate`

Rules：

- Requires login.
- Creates a new task from the old task inputs.
- Must not mutate the old task.
- Must freeze new credits.

### `GET /api/v1/image-assets/{assetId}/download`

Rules：

- Requires login.
- User can only download own assets.
- Repeated downloads cost `0` credits.
- Deleted or missing assets return a user-friendly error.

## 旧 `/generated` query bridge 兼容

当前 `frontend/src/lib/tryUrl.ts` 已经把案例信息编码到 `/generated` query，包括：

- `prompt`
- `reference_images`
- `reference_image_urls`
- `input_images`
- `source_case_id`
- `source_case_category`
- `source_note_url`
- `source_author_url`
- `generation_payload`

新实现必须保留解析能力，但行为改为：

- 打开 `/generated?...` 时进入生成页 `seeded_input` 状态。
- 生成页展示组件和已解析参考图。
- 不自动启动供应商生成。
- 用户点击「生成」后，走 `POST /api/v1/image-generations`。

如果 URL 太长导致浏览器或分享渠道不稳定，后续可以把 seed 写入 `sessionStorage` 或服务端 seed 存储，但 v1 不强制新增持久化 seed 表。

## 功能需求

- FR-001：系统必须提供可复用的图片生成组件，支持提示词、参考图、模型、比例、输出张数、分辨率、AI Enhance 和 Fast Mode。
- FR-002：系统必须允许爆款图文案例一键打开生成确认对话框。
- FR-003：从爆款图文进入时，系统必须携带该案例前 `3` 张参考图和当前提示词。
- FR-004：点击对话框「生成」后，系统必须创建任务并进入 `/generated?taskId={taskId}` 或同等生成页任务状态。
- FR-005：`/generated` 必须能解析现有 query bridge，并展示 `seeded_input` 状态。
- FR-006：系统必须要求每次生成至少有 `1` 张参考图；无参考图时禁用生成且不调用供应商。
- FR-007：系统必须支持有参考图的 `image-edit`。
- FR-008：系统必须支持有参考图的 `image-to-image` 垫图生图。
- FR-009：系统必须接入 GPTProto-first 的实际模型 API，至少完成 `gpt-image-2-edit` 的 `image-edit` 端到端路径和 `viduq2-i2i` 的 `image-to-image` 端到端路径；`gemini-3.1-flash-edit`、`seedream-5-edit`、`doubao-seedream-5-edit` 作为同一模型注册表中的可用线路或灰度线路。
- FR-010：所有供应商请求必须在服务端执行，不能暴露 GPTProto key。
- FR-011：系统必须在生成前展示预估扣积分。
- FR-012：系统必须在生成前校验登录和积分。
- FR-013：系统必须在供应商调用前冻结积分。
- FR-014：系统必须按成功输出图片张数结算积分。
- FR-015：供应商失败、超时、内容审核失败或无输出时，系统必须释放冻结积分。
- FR-016：用户必须能重复下载自己已生成的图片且不额外扣积分。
- FR-017：用户不能读取或下载不属于自己的任务和图片资产。
- FR-018：结果页必须支持刷新恢复任务状态。
- FR-019：重新生成必须创建新任务并重新计费，不能覆盖旧结果。
- FR-020：UI 必须保持 imaima queencard 当前视觉语言，不复制 Raphael 暗色风格。
- FR-021：`/generated` 必须使用单一生成页工作台模型，包含参考图、提示词、参数区、生成记录、结果资产区和继续生成 composer。
- FR-022：`/generated` 必须展示生成状态卡或结果卡，并提供底部/下方 composer 作为继续生成入口；生成中状态不能出现大面积空白。

## 边界与异常

- Prompt 为空：禁用生成按钮。
- Prompt 超过 `2000` 字符：阻止提交并提示压缩。
- 参考图少于 `1` 张：禁用生成按钮；服务端也必须拒绝请求。
- 参考图超过 `3` 张：客户端阻止，服务端拒绝。
- 参考图不可访问：生成前过滤或报错；不能把坏图传给供应商。
- 本地开发图片 URL 无法被供应商访问：服务端应先转存为 GPTProto 可访问的 HTTPS URL；只有实测确认模型支持输入 base64 时才转为 base64，否则跳过供应商实测。
- 余额不足：不创建供应商任务。
- GPTProto 返回 401/403：任务失败，释放积分，提示配置或余额问题。
- GPTProto 返回 429：任务失败或排队重试；不得重复冻结积分。
- GPTProto 返回内容策略错误：任务失败或部分成功；不结算失败输出。
- 轮询超时：任务标记失败，释放积分；如果供应商后续成功，需要后台补偿或人工处理。
- 用户关闭页面：任务继续，结果页可通过 task id 恢复。

## 非目标

- v1 不实现视频生成。
- v1 不实现完整图片编辑器、画布图层、局部蒙版和手绘区域。
- v1 不实现公开社区图库。
- v1 不实现批量生成整套 6-9 页图文的排版导出；这里只生成图片资产，后续可在 carousel/slide 子链扩展。
- v1 不直接创建或修改 Stripe 商品。
- v1 不把 Qwen/Wan 等未实测垫图 API 作为必须上线项。

## 实现影响范围

预计影响：

- `frontend/src/app/prompts/page.tsx`：把爆款图文生成入口改为打开生成对话框，并继续保留 `buildCaseTryUrl` 兼容。
- `frontend/src/lib/tryUrl.ts`：保留 query bridge，必要时补解析 helper。
- `frontend/src/app/generated/page.tsx`：新增单一生成页工作台，覆盖 seed 输入、任务状态和结果展示。
- `frontend/src/components/common/image-generation-composer.tsx`：新增可复用生成组件。
- `frontend/src/components/common/image-generation-dialog.tsx`：新增案例回填确认对话框。
- `frontend/src/app/api/v1/image-generations/**/route.ts`：新增生成、估价、查询、重新生成 API。
- `frontend/src/services/image-provider.ts`：扩展为 GPTProto v3 image-edit、GPTProto v3 image-to-image 的统一 adapter，并通过服务端模型注册表选择真实 endpoint。
- `frontend/src/services/gptproto.ts`：补 GPTProto v3 任务创建、`data.urls.get` 结果轮询、超时处理和输出归一化。
- `frontend/src/config/credits.ts`：补垫图模型 key、模型能力和积分规则。
- `frontend/src/db/schema.ts`：新增或规划 `generation_tasks`、`generated_assets`，并逐步减少 `videos` 命名泄漏。
- `frontend/src/services/credit.ts`：把 `videoUuid` hold 用法泛化为 `generationTaskId`。
- `frontend/public/xhs-cases/`：继续作为案例参考图静态来源，不移动资产。

## 成功标准

- SC-001：用户从任一爆款图文到打开带入前三张参考图的生成对话框，交互不超过 `1` 次点击。
- SC-002：用户从生成对话框点击「生成」到进入生成页，正常网络下不超过 `2` 秒。
- SC-003：`100%` 的案例入口都只带入前 `3` 张参考图，且顺序正确。
- SC-004：匿名用户、积分不足用户产生 `0` 次 GPTProto 调用。
- SC-005：`100%` 的生成任务在供应商调用前完成积分冻结。
- SC-006：`100%` 的无成功输出失败任务释放冻结积分。
- SC-007：部分成功任务只按成功输出图片数量结算积分。
- SC-008：`100%` 的生成结果刷新后仍能恢复状态。
- SC-009：用户重复下载自己的图片，额外扣积分为 `0`。
- SC-010：`gpt-image-2-edit` 至少完成一条 `image-edit` 端到端实测，`viduq2-i2i` 至少完成一条 `image-to-image` 端到端实测，且两者都不暴露 API key。

## 当前假设

- `xhsPromptCases` 中的 `images` 顺序代表用户希望参考的图文顺序。
- 生成入口优先服务「参考爆款结构再创作」，因此案例入口默认 `AI Enhance = false`。
- 默认展示 `gpt-image-2-edit` 等图像编辑模型；所有可选模型都必须要求至少 `1` 张参考图。
- GPTProto v3 模型大多是异步任务，必须按 `data.urls.get` 或 task id 轮询。
- 用户已提供 2026-06-16 的实际 GPTProto endpoint 和 payload 示例；实现前仍需在本地 `.env.local` 中用服务端 key 复测，但不得提交真实 key。
- 生成资产存储可先使用现有静态/对象存储方案，具体存储供应商不在本 spec 决定。

## 验收清单

- [ ] `/prompts` 下方爆款图文点击后打开生成确认对话框。
- [ ] 对话框展示并提交该案例前三张参考图。
- [ ] 对话框展示并提交该案例提示词。
- [ ] 生成按钮展示预估积分。
- [ ] 未登录点击生成进入登录流程，不调用 GPTProto。
- [ ] 积分不足点击生成进入购买/降参流程，不调用 GPTProto。
- [ ] 已登录且积分充足时创建生成任务并跳转生成页。
- [ ] `/generated` 能解析旧 query bridge 为 `seeded_input` 状态。
- [ ] `/generated` 使用单一生成页工作台模型，不拆多个页面。
- [ ] `/generated` 能展示生成中、成功、失败、部分成功状态。
- [ ] `/generated` 生成中状态展示任务卡、稳定占位、模型/积分/参考图信息和继续生成入口。
- [ ] GPTProto `gpt-image-2-edit` image-edit 可用。
- [ ] GPTProto `viduq2-i2i` image-to-image 可用。
- [ ] GPTProto Seedream/Gemini 线路按注册表可配置启用或灰度。
- [ ] 失败任务释放冻结积分。
- [ ] 部分成功按成功图片数结算积分。
- [ ] 下载已生成图片不重复扣积分。
- [ ] UI 使用 imaima queencard 现有视觉语言。
