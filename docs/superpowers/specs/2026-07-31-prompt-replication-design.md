# Prompt Replication Design

## Goal

Turn every prompt-library card into a high-similarity rewrite template. The
generated prompt must preserve the source post's content type, title mechanism,
visual mechanism, emotional mechanism, and interaction mechanism while changing
only the topic variables needed for a new post.

## Core Rule

This is template completion, not category-level copywriting:

```text
source type
+ source title skeleton
+ source visual mechanism
+ source emotional mechanism
+ source interaction mechanism
- source-specific subject
+ new subject
```

The reference image remains the primary source. The text prompt gives the
image model explicit instructions about what must remain stable and what may
change.

## Source Analysis

Each card must be interpreted into these fields before a default prompt is
shown:

| Field | Source | Required behavior |
| --- | --- | --- |
| `type` | card category and source metadata | Keep unchanged |
| `sourceTheme` | source title, topics, and content direction | Identify the concrete subject, not generic tags |
| `titlePattern` | source title and source prompt | Keep number, syntax, hook, and emotional direction where applicable |
| `visualMechanism` | source prompt and reference gallery | Preserve panel count, composition, visual rhythm, and reveal order |
| `toneMechanism` | source prompt and title language | Preserve humor, comfort, education, list, or tutorial voice |
| `interactionMechanism` | source prompt and source metadata | Preserve comment, save, share, or action-oriented ending |

Generic tags such as `漫画`, `原创漫画`, `小红书`, `AI创作`, and `抖音` are
not valid topic variables. Prefer a concrete topic from the remaining tags or
the source title.

## Example: Funny Comic

Source:

```text
type: 搞笑漫画
source theme: 鸡 / 冷笑话
title: 鸡，谁懂？
visual mechanism: two panels, before/after contrast, final-panel reveal
tone mechanism: cold joke, conversational, absurd
```

Default rewrite:

```text
生成一组新的搞笑漫画主题：标题《8个把冷笑话画成段子的离谱瞬间》，副标题“保留原图文的节奏、反差包袱、分镜密度和标题语气，换成新的主题”
```

The exact title is a suggested fill value. The user can edit the yellow title
slot and blue subtitle slot without losing the structured editor format.

## Prompt Contract

Every default prompt must match this parseable shape:

```text
生成一组新的{type}主题：标题《{title}》，副标题“{replicationSubtitle}”
```

`replicationSubtitle` must describe source-preservation parameters, not generic
marketing copy. It should mention at least two concrete mechanisms when the
source data provides them, for example `节奏、反差包袱、分镜密度和标题语气`.

## Acceptance Criteria

- Every category in `/prompts` produces the structured editor instead of a raw textarea.
- The generated type equals the source card type or its explicit source subtype.
- The generated title uses a source-derived topic variable and a source-compatible title pattern.
- The subtitle begins with `保留原图文的` and names source replication parameters.
- No generic fallback title such as `看完这组图就懂了` is used unless the source title mechanism itself is a comprehension/explanation hook.
- Editing either colored slot preserves the prompt contract and updates the generated prompt.
- All prompt-generation tests pass and the Web production build succeeds.
