# 五模型集成量化验收记录

> 日期：2026-08-02
>
> 实例：`http://localhost:8080`
>
> 基线：`feat/prompt-replication@2bbe3c5`
>
> 工具：真实 Chrome + Computer Use
>
> 最终结论：**不通过。默认配置仅 3/5 模型走通。**

## 1. 执行摘要

| 指标 | 实测值 | 验收线 | 结果 |
|---|---:|---:|---|
| UI 模型覆盖 | 5/5（100%） | 5/5 | P |
| 默认路径完成 | 3/5（60%） | 5/5 | F |
| 兼容参数下 provider 产图 | 5/5（100%） | 5/5 | P |
| 成功任务资产可访问 | 5/5（100%） | 100% | P |
| 成功任务结算准确 | 21/21 积分 | 差额 0 | P |
| 失败任务结算 | 0 积分 | 必须为 0 | P |
| 最终冻结余额 | 0 | 0 | P |
| 默认任务 ≤180 秒终态 | 5/5 | 5/5 | P |
| 默认模型验收通过 | 3/5 | 5/5 | **F** |

判定解释：GPT Image 2、Gemini 和 Vidu 默认路径成功。Seedream 与 Doubao 默认 `auto` 都因 provider 要求至少 3,686,400 像素而失败；改成 `2K` 后成功，说明模型、凭证、路由、上游任务、资产和积分链路确实接通，但默认产品参数不可用。根据硬闸门，二者不能判通过。

## 2. 环境与输入

| 项目 | 实测值 |
|---|---|
| 页面路径 | 手动生成 `/generated` → 任务结果 `/generated?taskId=...` |
| Git branch / commit | `feat/prompt-replication` / `2bbe3c5` |
| Dev server | `pnpm dev`，localhost:8080 可访问 |
| 浏览器 | Google Chrome，由 Computer Use 操作；版本号未采集，不猜测 |
| 账号 | `model-lab-***@example.com` |
| 余额 | 开始可用 32 / 冻结 0；结束可用 11 / 冻结 0 |
| 测试预算 | 注册 2 + 本地 `SYSTEM_ADJUST` 30；无生产扣款 |
| Provider / DB | 已配置且可连接；未在证据中保存密钥或连接串 |
| 参考图 | `reference.png`，512×512 PNG，约 2.4 KB，1 张 |
| 参考图 SHA-256 | `a4b022d6e5ca721632ce174e29e3529e6322e2b29fc656ab52ca70658f400fa7` |
| 提示词 | `把这张几何图重绘成柔和的水彩画风格，保留主体构图和主要颜色，不添加文字。` |
| 比例 / 输出 | `3:4` / 1 张 |
| 主路径分辨率 | `auto`；Vidu 实际映射 1080p |
| 诊断变量 | Seedream、Doubao 各仅把分辨率改为 `2K` |

## 3. 端到端判定矩阵

`P` 为有证据通过，`F` 为有证据失败。M1–M8 全部为 P 才能判单模型默认通过。

| 门槛 | 定量条件 | GPT | Gemini | Seedream | Doubao | Vidu |
|---|---|---:|---:|---:|---:|---:|
| M1 UI 可选 | 五模型选择器中唯一可识别 | P | P | P | P | P |
| M2 映射正确 | App model 与 provider model 精确匹配 | P | P | P | P | P |
| M3 UI 创建任务 | 唯一 task ID，非直接调用上游 | P | P | P | P | P |
| M4 默认终态 | `auto`，≤180 秒为 `completed` | P | P | **F** | **F** | P |
| M5 结果数量 | 完成任务恰好 1 个 asset | P | P | F | F | P |
| M6 资产可访问 | HTTP 200、`image/*`、非空 | P | P | F | F | P |
| M7 积分正确 | 成功按规则结算；失败结算 0；冻结归零 | P | P | P | P | P |
| M8 证据串联 | UI/task/provider/asset/credit 同 task ID | P | P | P | P | P |
| 默认结论 | 8/8 才通过 | **通过** | **通过** | **不通过** | **不通过** | **通过** |

Seedream/Doubao 的 M5、M6 在 2K 诊断任务中均为 P，但这不改变其默认任务的 F。

## 4. 逐模型实测

### 4.1 GPT Image 2 — 通过

| 字段 | 结果 |
|---|---|
| App / provider | `gpt-image-2-edit` → `gpt-image-2` |
| 默认任务 | `gen_YhHaHS3Y8JwxCQ5U` |
| 分辨率 / 终态 | `auto` / `completed` |
| 服务端耗时 | 25.330 秒 |
| 产物 | 1；HTTP 200；`image/png` |
| 积分 | 请求 5；结算 5 |
| 证据 | `A2-gpt-image-2-edit-completed.png`、`task-summary.json` |

前置探索任务 `gen_DOsxI_E_AHldrbuV` 因原 `/prompts` 案例含去水印语义触发上游 safety，7.301 秒失败、结算 0。随后使用预定义安全基准输入成功。前置失败不冒充主任务，但证明失败释放积分。

### 4.2 Gemini 3.1 Flash — 通过

| 字段 | 结果 |
|---|---|
| App / provider | `gemini-3.1-flash-edit` → `gemini-3.1-flash-image-preview` |
| 默认任务 | `gen_BLN-oVFAn4sbMBaF` |
| 分辨率 / 终态 | `auto` / `completed` |
| 服务端耗时 | 10.332 秒 |
| 产物 | 1；HTTP 200；`image/png` |
| 积分 | 请求 5；结算 5 |
| 证据 | `A3-gemini-3.1-flash-edit-completed.png`、`task-summary.json` |

前置任务 `gen_pnpYnJzuZ_A9F4dJ` 使用“继续生成”恢复参考图时，得到需要浏览器登录态的 localhost 下载 URL；服务端回拉失败，0.058 秒终止、结算 0。重新上传原文件的主任务成功，因此 Gemini 模型接入通过，但“继续生成”链路另有缺陷。

### 4.3 Seedream 5.0（即梦/CJM）— 默认不通过，2K 条件可用

| 字段 | 默认主任务 | 2K 诊断任务 |
|---|---|---|
| Task ID | `gen_CWklLQFkp_6SVkTi` | `gen_q9_C_3ybkbaOjVky` |
| App / provider | `seedream-5-edit` → `seedream-5-0-260128` | 相同 |
| 终态 / 耗时 | `failed` / 1.209 秒 | `completed` / 30.157 秒 |
| 产物 | 0 | 1；HTTP 200；实际 `image/jpeg` |
| 积分 | 请求 4；结算 0 | 请求 4；结算 4 |
| 证据 | `A4-seedream-5-edit-size-failed.png` | `A4-seedream-5-edit-2k-completed.png` |

错误摘要：`The parameter size is not valid: image size must be at least 3686400 pixels.` 分类 `U-PARAM`，严重度 `S1`。2K 任务 DB MIME 记录为 `image/png`，下载响应实际为 `image/jpeg`，另记 `DISPLAY/PERSIST metadata`、`S3`。

### 4.4 Doubao Seedream 5.0 — 默认不通过，2K 条件可用

| 字段 | 默认主任务 | 2K 诊断任务 |
|---|---|---|
| Task ID | `gen_Uq52zivof7EfHymi` | `gen_c82prsgIbZ0Li_rx` |
| App / provider | `doubao-seedream-5-edit` → `doubao-seedream-5-0-260128` | 相同 |
| 终态 / 耗时 | `failed` / 3.377 秒 | `completed` / 30.082 秒 |
| 产物 | 0 | 1；HTTP 200；实际 `image/jpeg` |
| 积分 | 请求 4；结算 0 | 请求 4；结算 4 |
| 证据 | `A5-doubao-seedream-5-edit-size-failed.png` | `A5-doubao-seedream-5-edit-2k-completed.png` |

错误、分类和 MIME 元数据问题与 Seedream 相同。任务模型映射仍为 Doubao 专属 provider，没有串模。

后续按 GPTProto 文档示例补做了一次 `1:1 + 2K`（有效 size `2048x2048`）Computer Use 复测：任务 `gen_U0tPvdsMSTSBGImi` 命中 `doubao-seedream-5-0-260128`，28.285 秒完成，1 个资产，结算 4、冻结 0。该结果再次确认 Doubao 专属 endpoint 在 2K 下可用。复测完成后，Doubao 已恢复为前台隐藏，provider route 保留。

### 4.5 Vidu Q2 — 通过

| 字段 | 结果 |
|---|---|
| App / provider | `viduq2-i2i` → `viduq2` |
| 默认任务 | `gen_v44aavm1r7NzhiKM` |
| 分辨率 / 终态 | `auto`（provider 1080p）/ `completed` |
| 服务端耗时 | 40.925 秒 |
| 产物 | 1；HTTP 200；`image/png` |
| 积分 | 请求 3；结算 3 |
| 证据 | `A6-viduq2-i2i-completed.png`、`task-summary.json` |

## 5. 积分对账

| 成功任务 | 结算 |
|---|---:|
| GPT 默认 | 5 |
| Gemini 默认 | 5 |
| Seedream 2K 诊断 | 4 |
| Doubao 2K 诊断 | 4 |
| Vidu 默认 | 3 |
| **合计** | **21** |

余额从 32 降至 11，差额 21；所有失败任务结算 0，最终冻结 0。积分对账误差为 `0`。

## 6. 缺陷登记

| ID | 缺陷 | 分类 / 严重度 | 复现率 | 影响 | 状态 |
|---|---|---|---:|---|---|
| F-SEE-001 | Seedream `auto` size 低于 3,686,400 像素 | `U-PARAM / S1` | 1/1 | 默认无法生成 | 开放 |
| F-DBS-001 | Doubao `auto` size 低于 3,686,400 像素 | `U-PARAM / S1` | 1/1 | 默认无法生成 | 开放 |
| F-CONT-001 | 继续生成的认证 asset URL 无法被服务端回拉 | `UPLOAD / S2` | 1/1 | 已有结果无法顺畅再生成 | 开放 |
| F-MIME-001 | Seedream/Doubao DB MIME 为 PNG，HTTP 实际 JPEG | `PERSIST / S3` | 2/2 | 元数据错误，可能影响下游 | 开放 |
| OBS-SAFE-001 | `/prompts` 原案例触发 GPT safety | `U-SAFETY / 观察项` | 1/1 | 特定提示词失败，安全基准成功 | 已隔离 |

未发现：串模、成功重复扣分、失败扣分不释放、资产 HTTP 失败或永久 generating。

## 7. 横向边界状态

本轮唯一目标是五模型连通性。以下扩展项提供明确验收标准，但未执行，不纳入本轮结论或虚构分数。

| ID | 扩展场景 | 验收标准 | 本轮状态 |
|---|---|---|---|
| X01 | 零参考图 | UI 阻止或 API 400；不建任务、不冻结 | 未执行 |
| X02 | 第 4 张参考图 | UI 阻止；服务层最多保留 3 张 | 仅静态审计 |
| X03 | GPT 4 输出 | 4 个有效资产；结算 20 | 未执行 |
| X04 | Gemini 1K/2K/4K | 三档均完成且各结算 5 | 未执行 |
| X05 | Vidu 1080p/2K/4K | 各完成；结算 3/6/7 | 未执行 |
| X06 | 结果页刷新持久化 | 刷新后 task 与 asset 仍可读 | 主路径页面可读；专项刷新未执行 |
| X07 | 失败后“可重新生成” | 新 task ID；旧任务无二次扣费 | 未执行 |
| X08 | 连续稳定性 | 每模型相同输入连续 3 次，成功率 100% | 未执行 |

## 8. 证据索引

证据目录：`evidence/2026-08-02-computer-use/`。

| 文件 | 内容 |
|---|---|
| `A1-model-selector.png` | 选择器展开状态、GPT 选中态与 5 积分；该图不单独证明其余四项 |
| `A2-gpt-image-2-edit-failed.png` | GPT 前置 safety 失败 |
| `A2-gpt-image-2-edit-completed.png` | GPT 默认成功 |
| `A3-gemini-preflight-reference-failed.png` | Gemini 继续生成参考图失败 |
| `A3-gemini-3.1-flash-edit-completed.png` | Gemini 默认成功 |
| `A4-seedream-5-edit-size-failed.png` | Seedream auto size 失败 |
| `A4-seedream-5-edit-2k-completed.png` | Seedream 2K 成功 |
| `A5-doubao-seedream-5-edit-size-failed.png` | Doubao auto size 失败 |
| `A5-doubao-seedream-5-edit-2k-completed.png` | Doubao 2K 成功 |
| `A6-viduq2-i2i-completed.png` | Vidu 默认成功 |
| `reference.png` | 统一参考图 |
| `task-summary.json` | 脱敏任务、耗时、资产 HTTP/MIME 与积分汇总 |

五模型可选性由各模型的独立结果/失败页面、五个不同 App model task 记录及静态配置共同证明；不得把 `A1` 单张截图解读成五项同屏展示。

## 9. 修复后验收

1. 保持同一参考图哈希、提示词、`3:4`、输出 1、`auto`。
2. Seedream 和 Doubao 各连续提交 2 次；必须全部 ≤180 秒完成、每次 1 asset、HTTP 200、积分各 4、冻结 0。
3. 再跑 GPT、Gemini、Vidu 各 1 次，防止共享 size/路由改动回归。
4. 最终默认通过率必须由 60% 提升至 100%；5/5 才能将整体改为通过。
5. 对 Seedream/Doubao 成功资产校验文件签名、DB MIME、HTTP `Content-Type` 三者一致。
6. 从一个既有结果执行“继续生成”，服务端必须能读取参考图并产生新 task。
7. 保留原失败证据；新结果使用新的 task ID 和日期目录，不覆盖历史。

## 10. 最终签署结论

| 模型 | 默认结论 | Provider 接线结论 |
|---|---|---|
| GPT Image 2 | 通过 | 可用 |
| Gemini 3.1 Flash | 通过 | 可用 |
| Seedream 5.0 | **不通过** | 2K 条件下可用 |
| Doubao Seedream 5.0 | **不通过** | 2K 条件下可用 |
| Vidu Q2 | 通过 | 可用 |

**验收决定：拒收当前“五模型默认均正常接入并可走通”的声明。** 更准确的产品状态是：五条 provider 线路都有真实成功产物，但默认用户配置只有三条可用；修复 Seedream/Doubao 的默认 size 并完成第 9 节复测后，才能重新申请五模型集成通过。
