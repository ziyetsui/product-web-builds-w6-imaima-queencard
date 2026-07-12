# 模块 06：技术架构与数据契约

## 1. 模块目标

在保持现有 API、数据库和 `/prompts` 行为兼容的前提下，重构 `/generated` 的页面职责并增加纯文生图。改造必须让每个单元有一个清楚职责，不把新的 Raphael 式 UI继续堆进当前约 1,760 行的 route page。

## 2. 当前基线

运行时位于 `frontend/`：Next.js 16 App Router、React 19、TypeScript、Tailwind 3、shadcn/Radix、Drizzle/Postgres、Better Auth、TanStack Query 和 Zustand。

当前关键代码：

- `frontend/src/app/generated/page.tsx`：URL 解析、任务轮询、历史、草稿、派生状态、工作台交互和全部 JSX。
- `frontend/src/components/common/image-generation-composer.tsx`：表单状态、上传、三种提交语义和三套 renderer。
- `frontend/src/lib/image-generation-workspace.ts`：草稿、提示词合并、参考图添加/替换和侧栏偏好等纯逻辑。
- `frontend/src/app/api/v1/image-generations/**`：创建、列表、估价、详情和重新生成。
- `frontend/src/services/image-generation.ts`：验证、任务创建、查询和 task 执行。
- `frontend/src/services/image-provider.ts`：模型路由、provider 请求和积分冻结/结算。
- `frontend/src/services/gptproto.ts`：OpenAI-compatible generation/edit 和 GPTProto v3 请求。
- `frontend/src/db/schema.ts`：`generation_tasks` 与 `generated_assets`。

## 3. 推荐目录结构

```text
frontend/src/app/generated/
  page.tsx
  loading.tsx
  error.tsx
  [taskId]/page.tsx
  _components/
    generated-workbench.tsx
    workspace-shell.tsx
    workspace-sidebar.tsx
    workspace-toolbar.tsx
    generation-composer-dock.tsx
    generation-stream.tsx
    generation-record.tsx
    generation-asset-card.tsx
    generation-history.tsx
    reuse-prompt-dialog.tsx
    replace-reference-dialog.tsx
  _hooks/
    use-generation-page-seed.ts
    use-generated-task.ts
    use-generation-history.ts
  _lib/
    generated-view-model.ts
    generation-handoff-store.ts

frontend/src/components/common/
  image-generation-composer.tsx
  image-generation-composer/
    composer-controller.ts
    composer-types.ts
    reference-picker.tsx
    prompt-editor.tsx
    model-picker.tsx
    generation-settings.tsx
    raphael-workbench-composer.tsx
```

命名可以在实施计划中微调，但职责边界不得重新合并为单个巨型文件。

## 4. 组件职责

| 单元 | 单一职责 | 依赖 | 不应包含 |
| --- | --- | --- | --- |
| `page.tsx` | Suspense 和 route 入口 | `GeneratedWorkbench` | 请求、草稿和大块 JSX |
| `GeneratedWorkbench` | 编排 seed、task、history 和草稿动作 | 三个 route hook、view model | 侧栏/结果卡的具体 markup |
| `WorkspaceShell` | 响应式壳层和主区 | Sidebar、Toolbar | API 请求和业务校验 |
| `WorkspaceSidebar` | 导航、积分、账户和折叠 | user/balance hooks | 任务详情 |
| `GenerationComposerDock` | 把草稿和 task 快照接入公共 Composer | Composer facade | 历史查询 |
| `GenerationStream` | 当前任务状态和结果列表 | task view model | 表单状态 |
| `GenerationRecord` | 单个 task 的只读状态块 | AssetCard | 创建任务 |
| `GenerationAssetCard` | 单张结果和资产动作 | download/reuse callbacks | 全局草稿管理 |
| `GenerationHistory` | 历史查询、筛选和分页 | history hook | 当前表单内部状态 |
| 三个 Dialog | 明确的覆盖/追加/替换决策 | callback props | 隐式网络副作用 |

## 5. Hook 与纯逻辑边界

### 5.1 `useGenerationPageSeed`

- 读取规范参数和旧别名。
- 读取 `handoff_id` 的 IndexedDB Blob。
- 应用 seed 优先级。
- 输出稳定的 `GenerationComposerSeed` 和来源元数据。
- 规范化 URL。
- 不创建任务。

### 5.2 `useGeneratedTask`

- 读取当前 task。
- 只在非终态开启 4 秒轮询。
- 后台刷新与首屏 loading 分离。
- 提供 refetch 和错误状态。
- 不保存草稿。

### 5.3 `useGenerationHistory`

- 300 ms 搜索 debounce。
- 状态筛选。
- 20 条分页和加载更多。
- 取消或忽略旧请求。
- 查询 key 包含 user、query、status 和 offset。

### 5.4 `generated-view-model.ts`

承接状态标签、日期分组、task → composer seed、成功数量、积分文案和页面状态机等纯派生函数。该文件不依赖 React、window 或网络，必须可以单元测试。

### 5.5 现有纯逻辑

继续复用 `image-generation-workspace.ts`。只有在新需求确实需要时增加：

- 按用户分区的草稿 key。
- mode 字段。
- 参考图临时暂存。
- 规范 handoff key 和 TTL。

不得把业务网络请求塞入该纯逻辑文件。

## 6. 公共 Composer 兼容策略

`ImageGenerationComposer` 继续保留当前 export 和 props 入口：

- `/prompts` 继续使用 `compact + open-generated`。
- `/generated` 使用新的 Raphael workbench renderer 和真实 create-task 语义。
- 表单控制器、验证、上传和 payload 构建共享。
- 不复制第二套 create 请求逻辑到 route 组件。
- 旧 `compact`、`expanded` 和已有 renderer 暂不删除，以降低回归风险。

新增 mode、服务端 estimate 和能力过滤时，所有 renderer 从同一个 controller 读取；旧 renderer 可以隐藏新功能，但不得提交不一致的 payload。

## 7. API 契约

### 7.1 创建任务

`POST /api/v1/image-generations`

请求体：

```json
{
  "source": "prompt-library",
  "sourceCaseId": "20251009-27",
  "sourceCaseCategory": "搞笑漫画",
  "sourceNoteUrl": "https://www.xiaohongshu.com/...",
  "sourceAuthorUrl": "https://www.xiaohongshu.com/...",
  "prompt": "生成一组新的搞笑漫画……",
  "mode": "image-to-image",
  "capability": "image-edit",
  "referenceImages": ["/xhs-cases/.../01.jpg"],
  "referenceAssetIds": [],
  "model": "gpt-image-2-edit",
  "aspectRatio": "3:4",
  "outputCount": 4,
  "resolution": "auto"
}
```

`mode` 是产品语义，`capability` 是模型/provider 语义。服务端从 model 配置验证两者，不信任客户端任意组合。

响应保留现有统一 API envelope、`taskId` 字段和 `redirectUrl`，不得改成破坏现有消费者的 `id`：

```json
{
  "success": true,
  "data": {
    "taskId": "gen_xxx",
    "status": "queued",
    "source": "prompt-library",
    "prompt": "...",
    "referenceImages": ["..."],
    "model": "gpt-image-2-edit",
    "capability": "image-edit",
    "aspectRatio": "3:4",
    "resolution": "auto",
    "outputCount": 4,
    "requestedCredits": 20,
    "settledCredits": 0,
    "assets": [],
    "redirectUrl": "/generated?taskId=gen_xxx"
  }
}
```

创建服务在返回前完成 task 与 credit hold 的同事务写入。后台 `runImageGenerationTask` 只使用 `creditHoldKey=taskId` 的既有 hold，不再次冻结。

### 7.2 积分估价

`POST /api/v1/image-generations/estimate`

- 允许匿名调用；该接口只计算公开模型价格，没有数据库写入或 provider 调用。
- 使用与 create 相同的 model、mode、张数和分辨率 validation；不接收 prompt 全文或图片内容，只接收参考图数量。
- 不要求真实 prompt 内容；但 mode、model、张数、分辨率和参考图数量必须一致。
- 不创建 task、hold 或 transaction。
- 返回 `estimatedCredits`、单张价格、模型和 capability。

### 7.3 列表

`GET /api/v1/image-generations?query=&status=&limit=20&offset=0`

- 强制登录。
- `limit` 范围 1–50，默认 20。
- 继续使用现有 offset 契约；服务端按 `createdAt DESC, id DESC` 返回稳定顺序，并返回 `hasMore` 或可等价判断是否继续加载的总数。
- 只返回当前用户。
- query 最大 100 字符。

本版本不引入 cursor 迁移，避免扩大 API 变更。

### 7.4 任务详情

`GET /api/v1/image-generations/[taskId]`

- 强制登录和归属校验。
- 他人或不存在返回 404。
- 返回 task、assets 和必要结算字段。

### 7.5 重新生成

`POST /api/v1/image-generations/[taskId]/regenerate`

- 复制原参数，重新验证当前模型、价格和余额。
- 新任务 `source=regenerate`。
- 返回新 task。
- 使用幂等键或请求防重，避免双击创建两条任务。

### 7.6 下载

`GET /api/v1/image-assets/[assetId]/download`

- 归属校验。
- 服务端验证后代理读取资产并返回附件响应；不得 302 到 provider URL。
- 响应设置受控 `Content-Type`、`Content-Length` 和 `Content-Disposition: attachment; filename="..."`。
- 对客户端隐藏原始 provider URL，并设置下载超时与最大字节数。

## 8. 服务端类型与模型配置

### 8.1 Capability

以下位置统一增加 `text-to-image`：

- `config/image-generation-models.ts`
- `services/image-generation.ts`
- `services/image-provider.ts`
- Composer 和 API schema 类型

禁止用字符串散落判断。模型配置是客户端过滤和服务端 allowlist 的共同真值。

每个模型 ID 只保存一个 capability。`mode` 不写入数据库，按 capability 派生：`text-to-image` 映射产品文生图，`image-edit` 和 `image-to-image` 映射产品参考图生成。模型配置同时声明 `supportedResolutions`、`defaultResolution` 和 `maxOutputCount`，具体矩阵以模块 02 为准。

### 8.2 Provider 路由

`ImageModelRoute` 增加：

```ts
capability: "text-to-image" | "image-edit" | "image-to-image";
mode: "openai-generation" | "openai-edit" | "gptproto-v3";
```

`gpt-image`：

- provider model 为 `gpt-image-2`。
- capability 为 `text-to-image`。
- mode 为 `openai-generation`。
- 调用现有 `createOpenAIImageGeneration()`。
- 发送 prompt、size、n、response_format 和 user，不发送 images。

`gpt-image-2-edit` 继续走 image-edit endpoint，并要求至少一张参考图。

## 9. 服务端验证

所有创建和估价请求共用验证：

- prompt 1–2000 字。
- mode 合法。
- model 存在、启用并支持 mode。
- 文生图 0 张参考图。
- 图生图 1–3 张参考图。
- 画幅在 8 个 allowlist 中。
- output count 1–4 且不超过模型上限。
- resolution 在模型支持集合中。
- source URL 字段只接受 HTTPS。
- sourceCaseId/category 有长度上限。

不得静默截断 output count、未知画幅或不兼容 model；必须返回有字段信息的 400。

## 10. 参考图安全

### 10.1 可接受来源

- 站内 `/xhs-cases/**` 静态资源。
- 当前用户拥有的 `referenceAssetIds`，服务端解析资产 URL。
- 通过客户端校验的 Data URL；服务端仍验证 MIME、解码大小和图片签名。
- 配置明确允许的受信资产域。

不接受用户任意提交的 HTTPS URL 让服务端抓取。当前“任意 HTTPS 即接受”的行为存在 SSRF、超大响应和 MIME 欺骗风险。

### 10.2 限制

- 原始浏览器文件最大 10 MB；创建 API 只接受规范化后单张不超过 800 KiB、总 JSON body 不超过 3.5 MB 的 Data URL。
- 最多 3 张。
- MIME 与文件签名一致。
- 请求超时和最大下载字节数必须受控。
- provider 请求、数据库错误和分析事件不得记录完整 Data URL。

## 11. 数据库

本版本不需要 migration：

- `generation_tasks.capability` 是 text，可保存 `text-to-image`。
- `reference_images` 已支持空数组。
- `source` 已支持 manual、prompt-library 和 regenerate。
- `generated_assets` 可以继续按 outputIndex 保存结果。
- 产品 mode 永远由 capability 派生，不新增 mode 列。

数据不变量：

- task userId 必填。
- 同 task outputIndex 唯一。
- requestedCredits ≥ settledCredits ≥ 0。
- 终态 hold 为 0。
- `completed` 资产数等于 outputCount。
- `partial_success` 资产数在 1 和 outputCount-1 之间。
- `failed` 资产数为 0。

## 12. 事务与幂等

- 创建任务与冻结积分位于同一个事务；余额不足或任一步失败时两者都不写入。
- provider 成功后，资产写入、task 终态和积分结算位于同一个事务；失败时按模块 03 的唯一补偿方案释放 hold 并标记 task failed。
- task 执行器重跑不得重复扣分。
- Web 请求返回失败但后台已创建 task 时，客户端重试不得产生无法识别的重复任务；实施计划需定义幂等键生成方式。
- `compensateGenerationFailure` 使用 taskId 作为幂等键并最多重试 3 次。
- 任务详情和余额服务在读取时调用 `reconcileStaleGenerationHolds`：对超过 15 分钟仍为 `queued/generating + HELD` 的任务，原子释放 hold 并写入 `failed/STALE_EXECUTION`。这是一条明确的读时恢复路径，不新增队列或 cron。

## 13. 页面错误边界与 metadata

- `generated/loading.tsx` 只用于首屏路由加载，不用于轮询刷新。
- `generated/error.tsx` 提供重试和返回提示词库。
- task 查询、历史查询和 Composer 估价使用局部错误状态，不让单个接口错误摧毁整页。
- `/generated` 使用 route metadata：明确标题，并设置 `robots: noindex, nofollow`，避免私人工作台被搜索引擎索引。

## 14. 测试边界

### 14.1 单元测试

- Seed 别名和优先级。
- mode 推断与切换。
- 模型能力过滤。
- 参数验证。
- task view model。
- terminal state 判断。
- 草稿 key 用户隔离。
- 参考图添加、去重和替换。

### 14.2 组件测试

- 双模式 Composer。
- 模型切换导致张数降级。
- estimate debounce 和过期响应。
- 401/402 草稿保留。
- 参考图替换 Dialog。
- prompt 追加/覆盖 Dialog。
- 结果卡键盘操作。

### 14.3 API/服务测试

- 零参考图文生图成功。
- edit 零图返回 400。
- 文生图携带图片返回 400。
- 不兼容/禁用模型返回 400。
- estimate 与 create 计价一致。
- 完整、部分、失败三种积分不变量。
- 重跑幂等。
- 用户隔离。
- download 归属。

### 14.4 浏览器验收

浏览器验收不由单元测试替代，详见 `../ACCEPTANCE.md`。

## 15. 明确不做的架构改造

- 不迁移到独立 FastAPI 后端。
- 不引入新全局 store。
- 不重写 Better Auth、支付或积分服务。
- 不引入 durable workflow/queue。
- 不新增对象存储。
- 不全量迁移到 `features/image-generation/`。
- 不同时清理所有 legacy renderer 或死代码。
