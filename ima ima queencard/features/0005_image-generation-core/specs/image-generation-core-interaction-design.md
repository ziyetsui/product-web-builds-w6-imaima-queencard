# imaima queencard 图片生成核心交互设计

## 元数据

- 工作流：`w6`
- 产品：`imaima queencard`
- 产品目录：`w6/ima ima queencard/frontend/`
- 本文件：`specs/w6/image-generation-core/0002-imaima-queencard-image-generation-core-interaction-design.md`
- 上游规格：`specs/w6/image-generation-core/0001-imaima-queencard-image-generation-core-spec.md`
- 命名依据：`.rules/spec-ledger-naming-rules.md`
- 创建日期：`2026-06-16`
- Artifact role：`interaction-design`
- 状态：实现前交互设计

## 设计目标

本交互设计把图片生成体验抽象为一个可复制的生成页系统，而不是某个参考产品截图的复刻。

核心目标：

- 只支持 image-to-image 工作流，每次生成必须有 `1-3` 张参考图。
- `/generated` 是唯一生成工作台，承载输入、生成中、结果、失败、历史和继续调整。
- 不拆独立确认/结果页面，也不设计无参考图生成入口。
- 生成页用状态机和模块系统组织，方便实现时拆成稳定组件。
- 视觉保持 imaima queencard 的粉色画布、粗黑边、lemon/surface-white/pumpkin 色块和现有品牌导航。

## 非目标

- 不支持没有参考图的生成。
- 不实现视频生成、口型同步或 Img to Vid。
- 不实现完整图片编辑器、画布图层、局部蒙版和手绘区域。
- 不复制 Raphael 或其他参考产品的暗色皮肤、侧栏品牌、头像品牌或商业文案。

## 页面系统

### 单一路由

```text
/generated
```

所有状态都发生在这个页面内：

| 入口 | URL/状态 | 结果 |
|---|---|---|
| 直接打开 | `/generated` | 进入 `idle` |
| 案例带入 | `/generated?...seed fields...` | 进入 `seeded_input` |
| 任务深链 | `/generated?taskId={taskId}` | 进入对应任务状态 |
| 重新生成 | 页面内 action | 进入 `seeded_input` 或创建新任务 |

### 页面层级

| 层级 | 模块 | 责任 |
|---|---|---|
| L0 | App Shell | 品牌、全局导航、订阅、登录、用户入口 |
| L1 | History Rail | 最近生成记录、新会话、历史切换；v1 可选 |
| L2 | Workspace Header | 当前范围、视图切换、搜索、过滤 |
| L3 | Session Stream | 按时间展示输入、状态、生成记录 |
| L4 | Generation Record | 单次生成的状态、输入摘要、元信息、资产、操作 |
| L5 | Asset Stage | 参考图和输出图的稳定展示区域 |
| L6 | Continuation Strip | 复用、派生、下载、引用、重新生成 |
| L7 | Composer Dock | 参考图、提示词、参数、预估积分和生成按钮 |

## 主页面 ASCII

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

## 状态模型

| 状态 | 进入条件 | 用户可做 | 系统约束 |
|---|---|---|---|
| `idle` | 打开空 `/generated` | 上传参考图、输入提示词、打开历史 | 无供应商调用 |
| `seeded_input` | query/case/regenerate 带入 seed | 调整参考图、提示词、参数并生成 | 至少 `1` 张参考图 |
| `blocked` | 未登录、积分不足、校验失败、策略阻塞 | 登录、购买积分、修改输入 | 无供应商调用 |
| `queued` | 已创建任务并冻结积分 | 查看输入和排队状态 | 不重复冻结 |
| `generating` | 供应商任务已开始或轮询中 | 查看稳定占位、等待、取消视实现决定 | 页面不空白 |
| `completed` | 至少一个成功输出 | 下载、复用、重新生成、引用提示词 | 下载不扣积分 |
| `partial_success` | 部分输出成功 | 使用成功资产、查看失败说明、继续生成 | 只结算成功输出 |
| `failed` | 无成功输出或任务失败 | 重试、改输入、改模型 | 释放冻结积分 |

## 状态 ASCII 简版

### S0 Idle

```text
[Header]
[Empty Stream]
[Composer: empty refs + prompt + controls + disabled submit]
```

### S1 Seeded Input

```text
[Header: source]
[Input Summary]
[Composer: 1-3 refs + filled prompt + controls + submit]
```

### S2 Blocked

```text
[Header]
[Blocked Record: reason + recovery action + preserved input]
[Composer: preserved input + blocked action]
```

### S3 Running

```text
[Header: active record]
[Record: state + metadata + input summary]
[Asset Stage: refs + stable placeholder/progress]
[Composer: secondary state]
```

### S4 Result

```text
[Header: result record]
[Record: state + metadata + input summary]
[Asset Stage: refs + outputs + hover/focus actions]
[Continuation Strip: reuse + download + regenerate]
[Composer: ready for next generation]
```

### S5 Failed

```text
[Header: failed record]
[Failed Record: reason + credit release + preserved input]
[Composer: preserved input + retry]
```

## 细节模块设计

### Reference Tray

职责：

- 承载 `1-3` 张参考图。
- 支持上传、删除、替换、排序。
- 没有参考图时生成按钮禁用。

```text
[Reference Tray] = [ref] [ref] [ref] [add]
rules: min 1, max 3, fixed ratio, reorderable
```

交互：

- 点击 add 打开上传或素材选择。
- 删除最后一张参考图后，生成按钮立刻 disabled。
- 排序只改变参考图顺序，不改 prompt。
- 加载失败的参考图显示错误状态，并允许删除或替换。

### Prompt Input

职责：

- 输入或编辑生成提示词。
- 显示字符计数。
- 与 AI Enhance 配合，但不自动改写用户输入。

```text
[Prompt Input] = [textarea] [count] [enhance]
```

交互：

- 空 prompt 禁用生成。
- 超过 `2000` 字符阻止提交。
- AI Enhance 开启时，提交前可生成增强版 prompt，并保留 original prompt。

### Generation Controls

职责：

- 控制模型、比例、张数、分辨率、Fast Mode 和预估积分。

```text
[Generation Controls] = [model] [ratio] [count] [size] [fast] [cost] [go]
```

交互：

- 模型列表来自服务端配置。
- 不支持多输出的模型自动限制张数为 `1`。
- 预估积分随模型和张数实时更新。
- 余额不足时 submit 变为购买/降参引导，不调用供应商。

### Asset Stage

职责：

- 展示生成中占位或输出资产。
- 提供图片级 hover/focus 操作。

```text
[Asset Stage] = [asset/placeholder] + [hover/focus actions]
rules: stable size, no layout shift, keyboardable
```

交互：

- hover/focus 操作不得改变图片尺寸。
- keyboard focus 时显示同一套操作。
- 移动端通过点按或长按展开操作。
- 下载自己生成的资产不重复扣积分。

### Generation Record

职责：

- 聚合一次生成任务的输入、状态、结果、积分和操作。

```text
[Generation Record] = [state] [meta] [input] [assets] [actions]
```

交互：

- queued/generating 展示稳定占位。
- completed 优先展示输出资产。
- partial_success 同时展示成功资产和失败提示。
- failed 保留输入，支持 retry 或修改后再生成。

### Continuation Strip

职责：

- 承载结果后的下一步动作。

```text
[Continuation Strip] = [derive] [reuse] [download] [quote] [regenerate] [status]
```

交互：

- derive 使用当前输出作为下一次参考图。
- use as reference 把输出加入 composer reference tray。
- quote prompt 把本次 prompt 回填 composer。
- regenerate 创建新任务并重新计费，不覆盖旧任务。

### Composer Dock

职责：

- 页面主输入区和主要行动区。

```text
[Composer Dock] = [refs] [prompt] [controls] [submit]
validation: prompt required, reference required
```

交互：

- 桌面端可 sticky/fixed 于底部。
- 移动端自然流式排列，不能遮挡结果图。
- submit loading 时按钮宽度稳定。
- cost chip 靠近 submit。

## 关键用户流

### 从案例进入

1. 用户点击案例生成入口。
2. 打开生成确认对话框，带入前三张参考图和 prompt。
3. 用户点击生成。
4. 创建任务并进入 `/generated?taskId={taskId}`。
5. 生成页展示 running 状态。
6. 任务完成后展示 result 状态。

### 手动生成

1. 用户打开 `/generated`。
2. 上传 `1-3` 张参考图。
3. 输入 prompt。
4. 调整模型、比例、张数、分辨率、Fast Mode。
5. 查看预估积分。
6. 点击生成。
7. 页面进入 running 状态并最终进入 result 或 failed。

### 继续调整

1. 用户在 result 状态点击 use as reference、quote prompt 或 regenerate。
2. Composer 回填相关输入。
3. 用户修改参数。
4. 新建任务，旧记录保留。

### 阻塞恢复

| 阻塞 | UI | 恢复 |
|---|---|---|
| 未登录 | blocked record + login action | 登录后恢复 preserved input |
| 积分不足 | blocked record + purchase/decrease action | 购买或降低张数/模型 |
| 参考图缺失 | composer validation | 上传至少 `1` 张参考图 |
| Prompt 为空 | composer validation | 输入 prompt |
| 内容策略失败 | failed/partial_success record | 修改输入后重试 |

## 响应式规则

桌面端：

- L1 History Rail 可常驻或可折叠。
- L2 Header 与过滤器同一基线。
- L5 Asset Stage 使用稳定尺寸。
- L7 Composer Dock 可 sticky/fixed，宽度与内容列对齐。

移动端：

- L1 History Rail 隐藏到抽屉或入口。
- L2 Header 分行展示。
- L5 Reference Stack 与 Output Stage 垂直堆叠。
- L7 Composer Dock 进入自然文档流，不能遮挡资产。
- 控件可换行，submit 独占最后一行或右对齐。

## 可访问性规则

- 所有图标按钮必须有 `aria-label` 或 tooltip。
- hover 操作必须有 keyboard focus 等价交互。
- 上传、删除、排序参考图必须可键盘操作。
- 生成状态变化需要可被 screen reader 感知。
- 失败原因必须用文本表达，不能只靠颜色。
- disabled submit 必须提供原因。

## 视觉对齐规则

- 生成记录、资产区、continuation strip 共享同一个左边缘。
- 参考图和输出图使用固定比例，加载、hover、失败状态不改变布局尺寸。
- chips 可以换行，但不能挤压资产区。
- composer 内部顺序固定为 reference tray、prompt input、generation controls、submit。
- 生成按钮与 cost chip 视觉邻近。
- 页面允许保留右侧空白给未来详情面板，但不能强行拉伸单张结果图。

## 文案原则

- 文案简短，直接描述当前状态和下一步动作。
- 不在页面里解释完整功能手册。
- 阻塞文案必须给出恢复路径。
- 成功文案不夸大能力，不使用免费无限生成表达。
- 失败文案区分用户可修复问题和系统/供应商问题。

## 实现组件建议

```text
GeneratedPage
GeneratedWorkspaceHeader
GenerationHistoryRail
GenerationSessionStream
GenerationRecord
ReferenceTray
PromptInput
GenerationControls
AssetStage
ContinuationStrip
ComposerDock
ImageGenerationDialog
```

组件边界：

- `GeneratedPage` 负责路由 query、状态恢复和整体布局。
- `GenerationSessionStream` 负责记录列表和当前记录定位。
- `GenerationRecord` 只渲染单条记录，不直接调用供应商。
- `ComposerDock` 负责输入和校验，不直接扣积分。
- 生成、估价、查询、重新生成都通过 API route/service 完成。

## 验收清单

- [ ] `/generated` 是唯一生成工作台。
- [ ] 没有参考图时不能启动生成。
- [ ] query bridge 进入 `seeded_input` 状态。
- [ ] 生成后进入 `/generated?taskId={taskId}` 或同等任务状态。
- [ ] running 状态有稳定占位，不出现大面积空白。
- [ ] result 状态展示输出资产和 continuation strip。
- [ ] failed 状态释放积分并保留输入。
- [ ] hover/focus 图片操作不引发布局位移。
- [ ] 桌面端 composer 可 sticky/fixed，移动端不遮挡资产。
- [ ] 所有状态符合 imaima 视觉语言，不复制参考产品暗色皮肤。
