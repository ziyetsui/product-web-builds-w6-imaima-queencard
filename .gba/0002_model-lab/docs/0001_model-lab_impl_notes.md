# Model Lab 实现与诊断记录

> 日期：2026-08-02
>
> 代码：`.trees/prompt-replication/web/imaima-queencard/frontend`，`feat/prompt-replication@2bbe3c5`
>
> 用途：记录静态接入事实、实测对照和实现风险；最终判定见 [0002_model-integration-acceptance.md](0002_model-integration-acceptance.md)。

## 1. 模型映射事实

| UI 名 | App model ID | Provider model | 模式 / endpoint | 最大输出 | 基础积分 |
|---|---|---|---|---:|---:|
| GPT Image 2 | `gpt-image-2-edit` | `gpt-image-2` | OpenAI-compatible `/v1/images/edits` | 4 | 5 |
| Gemini 3.1 Flash | `gemini-3.1-flash-edit` | `gemini-3.1-flash-image-preview` | OpenAI-compatible image edit | 1 | 5 |
| Seedream 5.0 | `seedream-5-edit` | `seedream-5-0-260128` | `/api/v3/doubao/seedream-5-0-260128/image-edit` | 1 | 4 |
| Doubao Seedream 5.0 | `doubao-seedream-5-edit` | `doubao-seedream-5-0-260128` | `/api/v3/doubao/doubao-seedream-5-0-260128/image-edit` | 1 | 4 |
| Vidu Q2 | `viduq2-i2i` | `viduq2` | `/api/v3/vidu/viduq2/image-to-image` | 1 | 3/6/7 |

五个 UI 项定义在 `src/config/image-generation-models.ts:51-96`；model route 在 `src/services/image-provider.ts:127-166`。静态映射与本轮任务记录一致，未观察到 fallback 或 Seedream/Doubao 串模。

## 2. 共同业务边界

- 所有五个编辑模型至少需要 1 张参考图；服务层去重并最多保留 3 张，见 `src/services/image-generation.ts:59,110-124,181-223`。
- GPT 最多请求 4 个输出；其余模型的 provider 输出数钳制为 1，见 `src/services/image-provider.ts:63-71`。
- Vidu 的 `auto/1k` 归一化为 `1080p`；1–3 参考图定价为 3/6/7（1080p/2K/4K）。UI 最多三张参考图，因此代码中的 `>3` 计价档正常 UI 不可达。
- 创建任务后状态由 queued/generating 收敛到 completed/failed；成功结算、失败释放。相关路径在 `src/services/image-generation.ts:395-471` 和 `src/services/image-provider.ts:453-507`。
- API `maxDuration=300` 秒；GPTProto v3 轮询约每 2 秒一次、最多 120 次。页面本地轮询约 4 秒。上游较慢或部署平台不支持后台 `after()` 时仍有超时风险。

## 3. 默认 size 缺陷的代码关联

`src/services/image-provider.ts:241-261` 的 `sizeFromAspectRatio()` 对 `2k` 有专门的大尺寸计算，而 `auto` 最终使用约 1024 档尺寸。`buildV3Body()` 在 `src/services/image-provider.ts:303-350` 把该 size 同时用于 Seedream 和 Doubao。

实测两条默认请求均被 provider 以同一错误拒绝：总像素必须至少 `3,686,400`。切换 `2K` 后二者都能完成。因此最小修复方向应是让 Seedream/Doubao 的 `auto` 映射到 provider 合法尺寸，或在 UI/请求层禁止不合法档位；不能靠重试解决确定性参数错误。

额外静态风险：`4k` 路径应做专项验证，避免 size 计算只针对 `2k` 特判而出现 4K 名称与实际像素不一致。

## 4. 实测与代码对照

| 模型 | 默认任务 | 默认结果 | 代码映射是否命中 | 诊断 |
|---|---|---|---|---|
| GPT | `gen_YhHaHS3Y8JwxCQ5U` | completed，1 PNG，25.330s | 是 | 无需 |
| Gemini | `gen_BLN-oVFAn4sbMBaF` | completed，1 PNG，10.332s | 是 | 无需 |
| Seedream | `gen_CWklLQFkp_6SVkTi` | failed，size invalid，1.209s | 是 | 2K 任务成功，30.157s |
| Doubao | `gen_Uq52zivof7EfHymi` | failed，size invalid，3.377s | 是 | 2K 任务成功，30.082s |
| Vidu | `gen_v44aavm1r7NzhiKM` | completed，1 PNG，40.925s | 是 | 无需 |

成功任务全部由页面创建、资产 HTTP 200。代码“存在”与真实 E2E 的差异由 Seedream/Doubao 清楚证明：静态 route 正确不代表默认请求参数可被上游接受。

## 5. 其他实现风险

### 5.1 继续生成参考图认证

`gen_pnpYnJzuZ_A9F4dJ` 说明：已有 asset 被恢复成 `/api/v1/image-assets/{id}/download` URL 后，服务端 provider 适配器尝试自行 fetch；该请求没有用户浏览器的会话凭证，导致参考图加载失败。实现应改为服务端直接读取已授权资产，或生成服务端可用的短期 URL，而不是回拉需登录的 localhost URL。

### 5.2 MIME 元数据

Seedream 与 Doubao 2K 成功资产的下载响应均为 `image/jpeg`，任务资产记录却标为 `image/png`。应从响应 header/文件签名推导实际 MIME，并让 DB、HTTP 和文件扩展名一致。

### 5.3 持久化与结算顺序

当前共享链路存在“先结算、后写资产”的潜在一致性风险。若资产插入失败，可能出现已扣积分但无可展示资产。本轮未复现，但建议用事务或可补偿步骤覆盖，并添加真实 endpoint 集成测试。

### 5.4 自动化覆盖

现有单元测试能验证价格和部分输入约束，不能证明 provider 凭证、真实 endpoint、异步轮询、资产下载或 UI 回显。建议新增最小合约测试：

- 每个 route 序列化出的 provider model、endpoint、size、resolution 快照。
- Seedream/Doubao 的 auto/1K/2K/4K 像素下限测试。
- 上游 completed/failed/empty/timeout 的任务与积分状态机测试。
- 已登录 asset 作为继续生成参考图的服务端读取测试。
- JPEG/PNG/WebP 响应的 MIME 持久化测试。

## 6. 积分验证

成功结算 `5 + 5 + 4 + 4 + 3 = 21`。账号可用余额 `32 → 11`，最终冻结为 0；默认 size 失败、safety 失败和参考图回拉失败均结算 0。本轮未发现积分误差。

## 7. 证据边界

证据位于 `docs/evidence/2026-08-02-computer-use/`：

- `A1-model-selector.png` 只证明选择器展开、GPT 选中态和 5 积分；其余四模型的可选性由各自页面、独立 task 记录和静态配置共同证明。
- `A2`–`A6` 分别覆盖成功页、默认参数失败页及 2K 诊断成功页。
- `task-summary.json` 保存脱敏 task ID、模型、耗时、资产状态/MIME 和积分；不含密码、Cookie、API key 或数据库连接串。
- `reference.png` 是固定输入，SHA-256 为 `a4b022d6e5ca721632ce174e29e3529e6322e2b29fc656ab52ca70658f400fa7`。

截图证明用户可见终态；JSON 和静态代码审计补足模型映射、资产 HTTP/MIME、耗时和积分。两类证据需结合解读。
