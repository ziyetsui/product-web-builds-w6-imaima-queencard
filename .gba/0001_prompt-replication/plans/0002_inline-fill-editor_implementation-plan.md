# Inline Pattern Fill Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Pattern Library grid form with a compact natural-language sentence containing three or four prefilled, auto-width editable slots while keeping the Prompt Compiler hidden and unchanged.

**Architecture:** Extend the reviewed Pattern contract with a strict `fillTemplate`, keep case-specific suggested values on the source case, and parse templates into fixed text plus keyed slots. A focused `InlinePatternSlot` handles compact input behavior; `StyleRecreationEditor` only composes the sentence and errors. The Composer resolves initial values in the order same-version draft > case suggestions > Schema defaults and continues to compile structured values through the existing Compiler.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 3, Zod, Vitest, Testing Library, pnpm.

## Global Constraints

- Work only in `.trees/prompt-replication` on `feat/prompt-replication`.
- Pattern Library exposes exactly 3 variables per Pattern in the initial registry; the Schema allows at most 4.
- Pattern Library accepts `short_text`, `enum`, and `number`; it rejects `long_text`.
- All 20 reviewed cases have complete, valid, non-empty suggested values.
- `topic` remains required and has no Pattern-level `defaultValue`; case suggestions provide its initial UI value.
- The sentence shows no Pattern name, description, labels, help copy, character counters, inherit/change card, or compiled Prompt.
- Manual mode, generation API fields, model settings, reference images, billing, and task history remain behaviorally unchanged.
- Do not add dependencies or a state manager.

---

### Task 1: Fill-template contract and validation

**Files:**
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/pattern-types.ts`
- Create: `web/imaima-queencard/frontend/src/features/style-recreation/fill-template.ts`
- Create: `web/imaima-queencard/frontend/src/features/style-recreation/fill-template.test.ts`
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/pattern-schema.ts`
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/pattern-schema.test.ts`

**Interfaces:**
- Produces: `StyleRecreationPattern.fillTemplate: string`.
- Produces: `FillTemplateSegment = { type: "text"; value: string } | { type: "slot"; key: string }`.
- Produces: `parseFillTemplate(template: string): FillTemplateSegment[]`.
- Produces: `validateFillTemplate(template: string, variables: PatternVariable[]): { ok: true; segments: FillTemplateSegment[] } | { ok: false; message: string }`.
- Consumes: existing `PatternVariable` and `validateStyleRecreationPattern`.

- [ ] **Step 1: Write parser and Schema failure tests**

Add focused cases that assert exact segment order and reject unknown, duplicate, missing, malformed, or overlong templates:

```ts
expect(parseFillTemplate("创作关于{{topic}}的故事，用{{scene}}收尾。")).toEqual([
  { type: "text", value: "创作关于" },
  { type: "slot", key: "topic" },
  { type: "text", value: "的故事，用" },
  { type: "slot", key: "scene" },
  { type: "text", value: "收尾。" },
]);
expect(validateFillTemplate("{{topic}}{{topic}}{{missing}}", variables).ok).toBe(false);
```

Update the valid Pattern fixture to contain:

```ts
fillTemplate: "沿用黑白木刻、高对比和大留白，创作关于{{topic}}的画面，让{{subject}}感受到{{emotion}}。"
```

Assert that 2 variables, 5 variables, any `long_text`, a template missing a variable, and a template whose maximum expanded length exceeds 220 code points all fail Schema validation.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm vitest run src/features/style-recreation/fill-template.test.ts src/features/style-recreation/pattern-schema.test.ts
```

Expected: FAIL because `fillTemplate`, parser exports, the 3–4 variable limit, and template validation do not exist.

- [ ] **Step 3: Implement the strict parser and contract**

Add `fillTemplate: string` to `StyleRecreationPattern`. Implement one-pass token parsing with `/\{\{([a-z][a-z0-9_]{1,31})\}\}/g`. Validation must:

1. reject leftover `{{` or `}}` after recognized tokens;
2. require every Pattern variable key exactly once;
3. reject unknown and duplicate keys;
4. estimate maximum expanded Unicode code points using `maxLength`, longest enum label/value, or numeric bounds;
5. reject an expanded maximum over 220 code points.

Change the Pattern array constraint from `.min(3).max(6)` to `.min(3).max(4)`. Add a Schema refinement rejecting `long_text`. Call `validateFillTemplate` inside the Pattern refinement and attach failures to `fillTemplate`.

- [ ] **Step 4: Run tests and confirm GREEN**

Run:

```bash
pnpm vitest run src/features/style-recreation/fill-template.test.ts src/features/style-recreation/pattern-schema.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit the contract**

```bash
git add web/imaima-queencard/frontend/src/features/style-recreation/pattern-types.ts \
  web/imaima-queencard/frontend/src/features/style-recreation/fill-template.ts \
  web/imaima-queencard/frontend/src/features/style-recreation/fill-template.test.ts \
  web/imaima-queencard/frontend/src/features/style-recreation/pattern-schema.ts \
  web/imaima-queencard/frontend/src/features/style-recreation/pattern-schema.test.ts
git commit -m "feat: validate inline Pattern templates"
```

---

### Task 2: Twenty reviewed templates and case suggestions

**Files:**
- Modify: `web/imaima-queencard/frontend/src/data/styleRecreationPatterns.ts`
- Modify: `web/imaima-queencard/frontend/src/data/xhsPromptCases.ts`
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/pattern-registry.ts`
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/pattern-registry.test.ts`

**Interfaces:**
- Produces: `XhsPromptCase.suggestedPatternValues?: PatternValues`.
- Produces: `getSuggestedPatternValues(sourceCaseId: string): PatternValues | undefined`.
- Consumes: Task 1 `fillTemplate` and existing Pattern variable validation rules.

- [ ] **Step 1: Write registry RED tests for all twenty cases**

Assert:

```ts
for (const item of xhsPromptCases.filter((entry) => entry.patternId)) {
  const pattern = getPatternForSourceCase(item.id)!;
  expect(pattern.variables).toHaveLength(3);
  expect(pattern.fillTemplate).toContain("{{topic}}");
  expect(Object.keys(item.suggestedPatternValues ?? {}).sort()).toEqual(
    pattern.variables.map((variable) => variable.key).sort(),
  );
  expect(getSuggestedPatternValues(item.id)).toEqual(item.suggestedPatternValues);
}
```

Add negative fixture coverage proving registry initialization rejects a missing key, unknown key, wrong type, invalid enum, and out-of-range number.

- [ ] **Step 2: Run the registry test and confirm RED**

Run:

```bash
pnpm vitest run src/features/style-recreation/pattern-registry.test.ts
```

Expected: FAIL because templates, case suggestions, and suggestion lookup are missing; current families contain 3–5 fields and one `long_text`.

- [ ] **Step 3: Configure four concise sentence templates**

Use one reviewed sentence mechanism per family, copied into each generated Pattern:

```ts
"wordplay-reveal":
  "沿用参考作品的极简线稿、克制留白和冷幽默，创作一个关于{{topic}}的冷笑话，用{{setup}}作为情境，最后通过{{punchline}}形成反转。"

"visual-metaphor-emotion":
  "沿用参考作品的粗粝版画、高对比和空间压迫感，表现{{topic}}，让{{subject}}面对{{metaphor}}这一巨大视觉隐喻。"

"collectible-checklist":
  "沿用参考作品的明亮分区、清晰编号和收藏型排版，为{{audience}}制作一份关于{{topic}}的{{item_count}}项行动清单。"

"narrative-resonance":
  "沿用参考作品的柔和插画、大留白和克制情绪，围绕{{topic}}，描绘{{subject}}身处{{scene}}的日常瞬间。"
```

Reduce every family to exactly three variables. Convert `punchline` from `long_text` to `short_text` with `maxLength: 60`. Remove `emotion`, `subtitle`, and `tone` from the relevant families. Keep `item_count` as the third checklist variable and remove its Pattern default so the case suggestion is authoritative.

- [ ] **Step 4: Add twenty case-specific suggested value sets**

Add `suggestedPatternValues` directly to each of the first twenty bound `XhsPromptCase` records. Each set must use the family keys below and contain a new subject distinct from the source title:

```text
wordplay-reveal: topic, setup, punchline
visual-metaphor-emotion: topic, subject, metaphor
collectible-checklist: topic, audience, item_count
narrative-resonance: topic, subject, scene
```

Use concrete values rather than placeholders. The first case must be exactly:

```ts
suggestedPatternValues: {
  topic: "AI 创业",
  setup: "程序员加班",
  punchline: "模型又崩了",
}
```

For the remaining cases, use different reviewed combinations such as “第一次当领导 / 新经理开晨会 / 下属全是 AI”、“自由职业焦虑 / 独立设计师 / 不断下沉的待办清单”、“新手产品经理避坑 / 刚转行的产品经理 / 7” and “重新开始 / 搬到新城市的年轻人 / 清晨第一班公交车”。Do not reuse source titles or original copy as values.

- [ ] **Step 5: Validate suggestions at Registry startup**

For every bound case, verify that suggestion keys exactly equal Pattern variable keys and reuse Compiler-compatible type/value checks. Throw a case-specific error on missing, unknown, invalid enum, length, or number bounds. Freeze a normalized copy and expose it through `getSuggestedPatternValues(sourceCaseId)`.

- [ ] **Step 6: Run registry, Schema, and Compiler tests**

Run:

```bash
pnpm vitest run src/features/style-recreation/pattern-registry.test.ts \
  src/features/style-recreation/pattern-schema.test.ts \
  src/features/style-recreation/prompt-compiler.test.ts
```

Expected: all pass; Pattern count remains 20 and Compiler output remains deterministic.

- [ ] **Step 7: Commit reviewed Pattern presentation data**

```bash
git add web/imaima-queencard/frontend/src/data/styleRecreationPatterns.ts \
  web/imaima-queencard/frontend/src/data/xhsPromptCases.ts \
  web/imaima-queencard/frontend/src/features/style-recreation/pattern-registry.ts \
  web/imaima-queencard/frontend/src/features/style-recreation/pattern-registry.test.ts
git commit -m "feat: add reviewed inline Pattern suggestions"
```

---

### Task 3: Inline sentence and auto-width slot components

**Files:**
- Create: `web/imaima-queencard/frontend/src/features/style-recreation/inline-pattern-slot.tsx`
- Create: `web/imaima-queencard/frontend/src/features/style-recreation/inline-pattern-slot.test.tsx`
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/style-recreation-editor.tsx`
- Modify: `web/imaima-queencard/frontend/src/features/style-recreation/style-recreation-editor.test.tsx`

**Interfaces:**
- Produces: `InlinePatternSlot({ variable, value, error, toneIndex, onValueChange })`.
- Consumes: Task 1 `parseFillTemplate`, existing `PatternVariable`, `PatternValue`, and editor callback.

- [ ] **Step 1: Replace form assertions with sentence assertions**

Create a three-variable fixture with a `fillTemplate`. Test that fixed sentence fragments render in order, exactly three controls exist, the controls contain suggested values, and none of these legacy elements exist: Pattern name, Pattern description, field help, character count, inherit/change card, or compiled Prompt.

Add slot tests for:

```ts
expect(screen.getByLabelText("新主题")).toHaveStyle({ width: "8ch" });
fireEvent.change(screen.getByLabelText("新主题"), { target: { value: "一个更长的新主题名称" } });
expect(onValueChange).toHaveBeenCalledWith("一个更长的新主题名称");
```

Also assert short-text `maxLength`, number `min/max`, enum options, `aria-invalid`, `aria-describedby`, Enter-to-blur, Escape-to-restore, and at least `44px` touch height.

- [ ] **Step 2: Run component tests and confirm RED**

Run:

```bash
pnpm vitest run src/features/style-recreation/inline-pattern-slot.test.tsx \
  src/features/style-recreation/style-recreation-editor.test.tsx
```

Expected: FAIL because the slot component does not exist and the editor still renders a grid form plus inherit/change card.

- [ ] **Step 3: Implement `InlinePatternSlot`**

Render `short_text` and `number` as inline inputs and `enum` as an inline select. Use Unicode code-point length and clamp widths to `8–26ch` on desktop while applying `max-w-full`. Use an `inline-flex min-h-11 align-middle whitespace-nowrap` wrapper, alternating `bg-lemon` and `bg-sky/75`, a strong bottom border, and a visible focus ring. Keep the value captured on focus so Escape can restore it through `onValueChange`.

- [ ] **Step 4: Reduce `StyleRecreationEditor` to sentence composition**

Parse `pattern.fillTemplate`, render text segments directly, and render slot segments by key. Use one paragraph with `font-manrope text-[16px] leading-[1.9] md:text-[18px] md:leading-[2]`. Render only active errors in a compact list after the sentence. Delete imports and code for `Textarea`, field descriptions, Pattern heading/description, and inherit/change summaries.

- [ ] **Step 5: Run component tests and confirm GREEN**

Run:

```bash
pnpm vitest run src/features/style-recreation/inline-pattern-slot.test.tsx \
  src/features/style-recreation/style-recreation-editor.test.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit the inline editor**

```bash
git add web/imaima-queencard/frontend/src/features/style-recreation/inline-pattern-slot.tsx \
  web/imaima-queencard/frontend/src/features/style-recreation/inline-pattern-slot.test.tsx \
  web/imaima-queencard/frontend/src/features/style-recreation/style-recreation-editor.tsx \
  web/imaima-queencard/frontend/src/features/style-recreation/style-recreation-editor.test.tsx
git commit -m "feat: render Pattern variables as inline slots"
```

---

### Task 4: Suggested-value initialization, drafts, and submission

**Files:**
- Modify: `web/imaima-queencard/frontend/src/components/common/image-generation-composer.tsx`
- Modify: `web/imaima-queencard/frontend/src/components/common/image-generation-composer.pattern.test.tsx`
- Modify: `web/imaima-queencard/frontend/src/app/generated/workspace-state.test.ts`
- Test: `web/imaima-queencard/frontend/src/lib/image-generation-workspace.ts`

**Interfaces:**
- Consumes: Task 2 `getSuggestedPatternValues(sourceCaseId)`.
- Produces: initialization order same-version draft > case suggestions > Pattern defaults.
- Preserves: existing `restorePatternDraft`, `compileStyleRecreationPrompt`, request body, and Manual mode.

- [ ] **Step 1: Write Composer RED tests for prefill and precedence**

Change the first Pattern mode test to assert:

```ts
expect(screen.getByLabelText("新主题")).toHaveValue("AI 创业");
expect(screen.getByLabelText("新情境")).toHaveValue("程序员加班");
expect(screen.getByLabelText("新包袱")).toHaveValue("模型又崩了");
expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();
```

Then edit only `新包袱`, submit, and assert the compiled request contains the edited value and does not contain the original suggested punchline. Add a seeded same-version draft test showing saved values override all three suggestions. Keep the existing Manual mode and missing-Pattern tests unchanged.

- [ ] **Step 2: Run integration tests and confirm RED**

Run:

```bash
pnpm vitest run src/components/common/image-generation-composer.pattern.test.tsx \
  src/app/generated/workspace-state.test.ts
```

Expected: FAIL because Pattern mode currently starts from Pattern defaults and leaves required fields empty.

- [ ] **Step 3: Resolve initial values from the source case**

Replace `defaultPatternValues(patternId)` with:

```ts
function defaultPatternValues(patternId: string | undefined, sourceCaseId?: string): PatternValues {
  const pattern = patternId ? getPatternById(patternId) : undefined;
  if (!pattern) return {};
  return {
    ...Object.fromEntries(pattern.variables
      .filter((variable) => variable.defaultValue !== undefined)
      .map((variable) => [variable.key, variable.defaultValue!])),
    ...(sourceCaseId ? getSuggestedPatternValues(sourceCaseId) : undefined),
  };
}
```

Use it for initial state, seed draft creation, and Pattern reset. Continue to merge `restorePatternDraft(pattern, nextDraft).values` last so a valid same-version draft wins.

- [ ] **Step 4: Run focused and full V2 tests**

Run:

```bash
pnpm vitest run src/features/style-recreation/*.test.ts \
  src/features/style-recreation/*.test.tsx \
  src/components/common/image-generation-composer.pattern.test.tsx \
  src/app/prompts/prompt-replication.test.ts \
  src/app/generated/workspace-state.test.ts
```

Expected: all V2 tests pass.

- [ ] **Step 5: Run static and production checks**

Run:

```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run build:prod
```

Expected: all commands exit 0.

- [ ] **Step 6: Perform requested browser QA**

Keep the existing dev server on port 8080. Inspect `/prompts` at `1440×900`, `1024×768`, `390×844`, and `360×800`. For the first reviewed case verify:

- one sentence and exactly three prefilled slots;
- no grid labels, help copy, counters, Pattern header, inherit/change card, or Prompt preview;
- slots resize without filling the row;
- sentence wraps without horizontal overflow;
- focus and error states remain visible;
- Manual mode still shows its normal free-text editor.

- [ ] **Step 7: Commit the integration**

```bash
git add web/imaima-queencard/frontend/src/components/common/image-generation-composer.tsx \
  web/imaima-queencard/frontend/src/components/common/image-generation-composer.pattern.test.tsx \
  web/imaima-queencard/frontend/src/app/generated/workspace-state.test.ts
git commit -m "feat: prefill inline Pattern editor"
git push
```

---

## Plan Self-Review

- Spec coverage: Tasks 1–4 cover the template contract, 3–4 slot limit, 20 reviewed defaults, sentence UI, accessibility, draft precedence, hidden Compiler, Manual compatibility, responsive QA, and build verification.
- Scope: no AI “换一组”, API, model, billing, or automatic DNA extraction work is included.
- Type consistency: `fillTemplate`, `suggestedPatternValues`, `parseFillTemplate`, `validateFillTemplate`, `InlinePatternSlot`, and `getSuggestedPatternValues` keep the same names throughout.
- Placeholder scan: the plan contains no TBD/TODO steps; every task specifies tests, implementation, commands, expected outcomes, and commit boundaries.
