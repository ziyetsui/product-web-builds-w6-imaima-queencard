# Model Lab：五模型网站内嵌生图端到端验证 Spec

> 状态：已执行，结果见验收记录
>
> 被测实例：`http://localhost:8080`
>
> 代码基线：`.trees/prompt-replication/web/imaima-queencard/frontend`
>
> 分支 / 提交：`feat/prompt-replication` / `2bbe3c5`
>
> 执行日期：2026-08-02
>
> 唯一目标：确认五个内嵌生图模型是否已经正常接入、默认用户路径是否能走通。

## 1. 验证对象

| # | UI 名称 | App model ID | Provider model | 主路径积分 |
|---|---|---|---|---:|
| M1 | GPT Image 2 | `gpt-image-2-edit` | `gpt-image-2` | 5 |
| M2 | Gemini 3.1 Flash | `gemini-3.1-flash-edit` | `gemini-3.1-flash-image-preview` | 5 |
| M3 | Seedream 5.0（用户所称 CJM/即梦） | `seedream-5-edit` | `seedream-5-0-260128` | 4 |
| M4 | Doubao Seedream 5.0（豆包） | `doubao-seedream-5-edit` | `doubao-seedream-5-0-260128` | 4 |
| M5 | Vidu Q2（用户所称微度） | `viduq2-i2i` | `viduq2` | 3（auto/1080p） |

名称、App model ID 和 provider model 必须同时吻合；共享 provider 实现不能替代逐模型实跑。

## 2. 范围与非目标

范围内：

- 静态核对 UI 配置、模型路由、请求参数、任务终态、资产持久化与积分结算链路。
- 使用真实 Chrome + Computer Use，从网站 UI 分别创建任务并等待终态。
- 五模型使用同一参考图、同一提示词、比例 `3:4`、输出 1 张；默认分辨率 `auto` 是主验收路径。
- 默认路径失败时，只允许一次有明确诊断目的的参数复测。本轮 Seedream 和 Doubao 使用 `2K` 复测，以验证“接线断裂”还是“默认 size 不兼容”。
- 记录任务 ID、模型映射、服务端耗时、资产可访问性、积分结算或释放、UI 截图。

非目标：

- 不评价美学质量、提示词遵循度、模型排名或性价比。
- 不做并发、稳定性、性能 SLA、移动端、多浏览器、多图和多输出边界测试。
- 不因诊断复测成功而把默认配置失败改判为通过。
- 不修改产品代码。本轮只写验证文档和证据；测试账号的额外 30 积分为本地 `SYSTEM_ADJUST` 测试预算，单独披露。

## 3. 固定测试合同

| 字段 | 实际固定值 |
|---|---|
| 主入口 | `/generated` 的手动生成器；任务结果仍在 `/generated?taskId=...` 展示 |
| 参考图 | `reference.png`，512×512 PNG，1 张，SHA-256 `a4b022d6e5ca721632ce174e29e3529e6322e2b29fc656ab52ca70658f400fa7` |
| 提示词 | `把这张几何图重绘成柔和的水彩画风格，保留主体构图和主要颜色，不添加文字。` |
| 比例 | `3:4` |
| 输出数 | `1` |
| 主路径分辨率 | `auto` |
| 诊断分辨率 | 仅 M3/M4 默认失败后使用 `2K` |
| 账号 | `model-lab-***@example.com` |
| 初始余额 | 可用 32，冻结 0；其中注册赠送 2，本地测试调账 30 |

`/prompts` 曾用于前置探索，但其案例提示词触发 GPT safety，且“继续生成”把参考图恢复为需要登录的下载 URL，造成 Gemini 服务端拉图失败。二者不属于上述统一主测试合同，单独记录为前置缺陷证据。

## 4. 静态接入验收

每个模型至少满足：

1. UI 中存在唯一启用项，展示名、能力与积分可识别。
2. App model ID 映射到明确的 provider model 和调用模式。
3. 一张参考图、提示词、比例、输出数、分辨率可进入任务请求。
4. 任务具有 `queued → generating → completed/failed` 终态路径。
5. 成功资产持久化并能通过站内下载接口读取；失败释放冻结积分。
6. 主测试参数没有已知的 provider 不兼容。

代码核对点：

- 五模型 UI 配置：`src/config/image-generation-models.ts:51-96`。
- 参考图去重及最多三张：`src/services/image-generation.ts:59,110-124`。
- App model → provider model：`src/services/image-generation.ts:158-176`、`src/services/image-provider.ts:127-166`。
- Seedream/Doubao size 计算与 v3 请求：`src/services/image-provider.ts:241-261,303-350`。
- 积分 hold/settle/release 与结果落库：`src/services/image-provider.ts:453-507`。
- API 最长执行时间：`src/app/api/v1/image-generations/route.ts:12`（300 秒）。

静态审计能证明“代码存在路径”，不能单独证明凭证、上游或真实资产链路可用。

## 5. Computer Use 执行步骤

对每个模型：

1. 打开生成器，确认登录、余额、参考图预览、提示词、`3:4`、输出 1、`auto`。
2. 展开模型选择器并选择目标模型，核对名称和预计积分。
3. 点击生成一次，记录唯一 task ID；不得用内部 API 代替点击。
4. 观察结果页直到 `completed` 或 `failed`；主等待上限 180 秒。
5. 成功时确认恰好一个 asset、站内资源 HTTP 200、`Content-Type: image/*`、余额结算正确。
6. 失败时记录原始错误、失败层级、冻结积分是否归零。
7. 仅在根因明确且诊断价值足够时改变一个参数复测，并保留首次失败。

## 6. 通过标准（硬闸门）

单模型默认路径只有同时满足下列 8 项才算通过：

1. UI 可选且实际提交的 App model ID 正确。
2. provider model 与目标模型映射完全一致，无 fallback/串模。
3. 任务由 Computer Use 在 UI 创建并取得唯一 task ID。
4. 180 秒内进入 `completed`。
5. 结果数严格等于 1。
6. 资产下载 HTTP 200、字节数大于 0、响应 MIME 为 `image/*`。
7. 实际结算积分等于规则积分，冻结余额最终为 0。
8. UI、任务、provider、资产、积分证据可由同一 task ID 串联。

任何一项失败均不得写“默认路径通过”。诊断参数成功时可写“provider 接线可用 / 条件可用”，但默认路径仍为失败。

整体通过要求：默认参数下 `5/5` 通过。`4/5` 或以下均为“整体不通过”，并同时报告可用模型清单。

## 7. 量化指标

| 指标 | 门槛 |
|---|---:|
| 模型执行覆盖率 | 5/5 = 100% |
| 模型映射覆盖率 | 5/5 = 100% |
| 默认路径通过率 | 5/5 = 100% 才能整体验收通过 |
| 成功任务结果数 | 每任务恰好 1 |
| 成功资产可访问率 | 100% |
| 积分差额 | `前余额 - 后余额 = 成功任务结算总额` |
| 最终冻结余额 | 0 |
| 主路径终态窗口 | ≤180 秒 |
| 默认失败诊断复测 | 最多 1 次，且只改变一个已记录参数 |
| 证据脱敏率 | 100%，不得含密钥、Cookie、连接串、完整个人账号 |

## 8. 状态与失败分类

| 状态 | 定义 |
|---|---|
| `通过` | 默认参数满足全部硬闸门 |
| `条件可用` | 默认参数失败，但单变量诊断复测能到达正确 provider、产出并结算 |
| `失败` | 有效任务在默认参数下失败、无有效产物或结果无法展示 |
| `阻塞` | 登录、余额、公共网络、服务未启动等环境前置阻断，未能验证模型 |
| `不可判定` | 证据不足以确认模型或串联完整链路 |

失败层级：`UI`、`VALIDATION`、`UPLOAD`、`ROUTE-MAP`、`U-AUTH`、`U-SAFETY`、`U-PARAM`、`U-TIMEOUT`、`U-EMPTY`、`PERSIST`、`DISPLAY`、`CREDIT`、`ENV`。

## 9. 实测结果

| 模型 | 默认任务 | 默认终态 / 秒 | 默认结论 | 诊断任务 | 诊断结果 | 积分 | 主证据 |
|---|---|---:|---|---|---|---:|---|
| GPT Image 2 | `gen_YhHaHS3Y8JwxCQ5U` | completed / 25.330 | 通过 | — | — | 5 | `A2-gpt-image-2-edit-completed.png` |
| Gemini 3.1 Flash | `gen_BLN-oVFAn4sbMBaF` | completed / 10.332 | 通过 | — | — | 5 | `A3-gemini-3.1-flash-edit-completed.png` |
| Seedream 5.0 | `gen_CWklLQFkp_6SVkTi` | failed / 1.209 | 失败（`U-PARAM`） | `gen_q9_C_3ybkbaOjVky`，2K | completed / 30.157 | 4 | `A4-seedream-5-edit-size-failed.png`、`A4-seedream-5-edit-2k-completed.png` |
| Doubao Seedream 5.0 | `gen_Uq52zivof7EfHymi` | failed / 3.377 | 失败（`U-PARAM`） | `gen_c82prsgIbZ0Li_rx`，2K | completed / 30.082 | 4 | `A5-doubao-seedream-5-edit-size-failed.png`、`A5-doubao-seedream-5-edit-2k-completed.png` |
| Vidu Q2 | `gen_v44aavm1r7NzhiKM` | completed / 40.925 | 通过 | — | — | 3 | `A6-viduq2-i2i-completed.png` |

默认路径通过率为 `3/5 = 60%`；兼容分辨率下 provider 产图覆盖率为 `5/5 = 100%`。整体结论：**五模型集成验收不通过**。

## 10. 已发现缺陷与复测标准

### D1：Seedream 默认 size 不合法

- 复现任务：`gen_CWklLQFkp_6SVkTi`。
- 错误：上游要求总像素至少 `3,686,400`；默认 `auto` 的 size 低于该阈值。
- 影响：默认用户路径无法生成；严重度 `S1`，分类 `U-PARAM`。
- 修复验收：保持相同参考图、提示词、3:4、输出 1 和 `auto`，连续 2 次完成；每次 ≤180 秒、1 个可访问资产、结算 4、冻结 0。

### D2：Doubao Seedream 默认 size 不合法

- 复现任务：`gen_Uq52zivof7EfHymi`。
- 错误与验收标准同 D1，provider model 必须为 `doubao-seedream-5-0-260128`，不得串到 Seedream；结算 4。

### D3：继续生成的已登录参考图 URL 无法被服务端回拉

- 复现任务：`gen_pnpYnJzuZ_A9F4dJ`。
- 现象：恢复出的参考图 URL 指向 `/api/v1/image-assets/.../download`，服务端无浏览器会话，拉取失败；任务 0.058 秒失败，未结算。
- 修复验收：从既有结果点击继续生成，参考图无需人工重传；任务能到达 provider 并产出，刷新后仍可查看。

### D4：Seedream/Doubao 资产 MIME 元数据不一致

- 现象：两个成功的 2K 资产 HTTP 实际为 `image/jpeg`，数据库记录为 `image/png`。
- 严重度 `S3`；当前不阻断展示，但可能影响下载扩展名、缓存或后续处理。
- 修复验收：DB MIME、下载响应 `Content-Type` 与真实文件签名三者一致。

### D5：GPT 前置案例触发 safety

- 任务：`gen_DOsxI_E_AHldrbuV`，7.301 秒失败、结算 0。
- 该任务使用 `/prompts` 案例中的去水印语义，不纳入统一安全基准主路径；保留作为错误处理证据。

## 11. 复测交付清单

- [ ] D1、D2 修复后，Seedream/Doubao 在 `auto` 下各连续 2 次通过。
- [ ] 五模型再各跑 1 次统一主测试，默认路径 `5/5` 通过。
- [ ] 每个任务保留 UI 截图、task ID、provider model、耗时、asset HTTP/MIME、积分记录。
- [ ] 成功积分总额与余额差额完全一致，冻结余额为 0。
- [ ] D3 的继续生成路径至少跑 GPT/Gemini 各 1 次。
- [ ] D4 的两类 MIME 各抽检 1 个结果。
- [ ] 证据全部脱敏，原失败任务和截图不得删除。
