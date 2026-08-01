# Pattern Engine Variables Design (prompt contract v4)

## Goal

Users never face a prompt. The rebound editor shows a fill-in-the-blank form
with at most three elements; the full image-model prompt is composed by the
system from the card's DNA plus the user's variables, and is only visible
behind a collapsed disclosure.

Architecture (Pattern Engine lite):

```text
爆款帖子
  → DNA（analyzeSource 静态提取：视觉机制 / 标题骨架 / 原主题）
  → 变量（用户填空：新主题，可选改新标题）
  → Prompt Composer（系统组装完整图像指令）
  → GPT Image 2（参考图 + 组装后的指令）
```

## Layer 1 — visible variables

| 槽位 | 谁填 | 默认值 |
| --- | --- | --- |
| 新主题 (topic) | 用户，唯一必填 | 原帖具体话题 |
| 新标题 (title) | 系统联动生成，可改 | 标题骨架 × 新主题 实例化 |
| DNA 标签 | 只读展示 | 视觉机制清单 |

Topic edits re-link the title by substring replacement (old topic → new topic)
whenever the title still contains the old topic; a hand-edited title that no
longer contains it is left alone.

## Layer 2 — hidden composed prompt (v4 contract)

```text
参考已附上的原图，逐项复刻原图的{visual}，画风、构图、配色与字体版式保持一致，并去除图片中的水印和平台账号字样。只改两处：主标题换成「{title}」，画面主体从原主题换成「{topic}」，其余元素照原图复刻。画面中只允许出现作品本身的文字，禁止出现任何说明、分析或指令类文字。
```

Fixed clauses (not variables): watermark removal, and the double ban on
meta/analysis text — these encode the verified "image stays, title swaps"
behavior recorded in `../docs/style-lock-title-swap-prompt-record.md`.

Slot values are sanitized at build time (corner/straight quotes normalized,
`「」` in values converted) so the string always round-trips through
`parseReplicationPrompt`.

## Title instantiation

Grammar safety rule: prefer in-place topic swap inside the source title (most
grammar-preserving); verb-phrase patterns use noun-friendly wording.

- source title contains source topic → swap it for the new topic in place
- `…谁懂？` → `{topic}，谁懂？`
- `(如何)?用…时间/天…` → `如何用7天时间搞定{topic}`
- otherwise → keep the source title

## Legacy conversion

`normalizePromptForEditor` upgrades v2 (`生成一组新的…复刻参数…`) and v3
(`保留原图的…标题骨架…`) prompts to v4 on entry.

## Acceptance Criteria

- The rebound editor renders variables only — no prompt sentence is shown by
  default; the composed prompt sits behind a collapsed disclosure.
- Every card's default composed prompt matches the v4 contract and
  round-trips through `parseReplicationPrompt`.
- The composed prompt always contains the watermark-removal clause and the
  no-analysis-text ban.
- Editing the topic re-links the auto title; editing the title directly does
  not get overwritten unless it still contains the old topic.
- Card previews on `/prompts` show the variable view (topic and title
  highlighted), not the raw prompt.
- No default title may be ungrammatical (swept all cards on 2026-08-01).
- All prompt tests pass and the production build succeeds.
