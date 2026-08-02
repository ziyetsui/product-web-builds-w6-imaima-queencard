# 0002 · ima ima queencard — Component Design Spec (组件设计规范)

> Status: Living spec · Last updated 2026-06-17
> Scope: `w6/ima ima queencard/frontend` (Next.js 16 + React + TypeScript + Tailwind + shadcn/ui)
> Companion to [`0001_design_tokens.md`](./0001_design_tokens.md). 0001 defines the **tokens** (colour / type / spacing / shadow). This doc defines the **components** built from them: anatomy, props, variants, states, sizing, and reuse rules.
> Reference implementation (every pattern below ships here): `src/app/prompts/page.tsx`. Brand primitives: `src/components/layout/Wordmark.tsx`, `src/components/common/branded-carousel-controls.tsx`, custom classes in `src/index.css`.

---

## 0. How to read this spec

This is a **catalog**, not a story. Each entry gives: what it is → anatomy → the exact class recipe → variants/states → rules. When you build a new screen, you compose from §3, obey the conventions in §2, and check §6 before shipping.

The acceptance bar is the same as 0001: **自然 / 克制** (natural / restrained). A component is "done" when it carries the brand frame (2px charcoal border + hard offset shadow) **and** respects the type-weight hierarchy and one-dominant-action-colour rules — not when it merely renders.

---

## 1. The two tiers of components (read this first)

There are two kinds of "component" in this project, and confusing them is the #1 mistake:

### 1.1 shadcn/ui primitives (`src/components/ui/*`)
Behaviour engines: `ToggleGroup`, `Tooltip`, `Dialog`, `Select`, `Drawer`, etc. We use them for **interaction logic and a11y**, then **override the visuals** with brand classes at the call site. They are themed to the brand via `:root` HSL tokens (see 0001 §2.3), but their default chrome (e.g. `rounded-md`) is usually replaced.

> ⚠️ **`ui/button.tsx` is stock shadcn and is NOT the brand button.** It is `rounded-md`, `font-medium`, thin border — none of the brand DNA. The `/prompts` page never imports it. **Brand buttons are a Tailwind class pattern (§3.2), authored inline**, not `<Button>`. Don't "fix" a brand button by swapping in `<Button>`; you'll lose the frame.

### 1.2 Brand components & patterns
Two sub-kinds:
- **Extracted components** — real reusable files: `Wordmark`, `BrandedCarouselControls`, `Navbar`, `Footer`, `ImageGenerationComposer`. Import these; never re-hand-roll them.
- **Inline patterns** — recurring class recipes that live at the call site (buttons, chips, header strips, cards). Documented in §3 so they stay consistent. Promote an inline pattern to a real component only when it repeats across ≥3 pages with identical structure (the bar that produced `BrandedCarouselControls`).

---

## 2. Anatomy conventions (the shared grammar)

Every brand surface is assembled from the same small grammar. Internalise these and most components write themselves.

### 2.1 The frame
```
rounded-[R] border-2 border-charcoal bg-<surface> shadow-brand-<size>
```
- **Border** is always `border-2 border-charcoal` (never 1px, never `#000`).
- **Radius** scales with size: chips/buttons `rounded-pill` (47px); inner thumbs/avatars `rounded-[8px]`; cards `rounded-[10px]`; large surfaces (composer, dialog, confirm panel) `rounded-[12px]`/`[14px]`.
- **Elevation** is the 4-step hard-offset scale only: `shadow-brand-sm/-brand/-brand-lg/-brand-xl` = `2/4/6/10 px` offset, no blur, `#1a1714`. Bigger/more-important surface → bigger step. Selected state swaps to a **coloured** offset (§4).

### 2.2 The header-strip pattern
Cards that carry a subject (composer, confirm panel, prompt box, dialog sidebar) open with a **filled strip** divided from the body by `border-b-2 border-charcoal`:
- **Lemon strip** (`bg-lemon` / `bg-lemon/80`) = "this is your active selection" (composer, confirm panel).
- **Charcoal strip** (`bg-charcoal text-surface-white`) = a system/section label (prompt box header "提示词", confirm CTA footer).
Inside the strip: a bordered thumbnail (`rounded-[8px]/[10px] border-2`) + title (`font-extrabold`) + author link + a cluster of accent/stat chips.

### 2.3 The info-row pattern
Key/value lists (confirm panel) use one bordered box with **hairline** internal dividers, never nested boxes:
```
grid divide-y-2 divide-charcoal/10   →   each row: grid grid-cols-[96px_1fr] gap-4 px-5 py-4
                                          label = 11px/700/uppercase/tracking-[0.12em]/charcoal-45
```
The 2px charcoal frame is the *outer* edge; inside, dividers drop to `charcoal/10` so the box reads as one object.

### 2.4 The label tier
Eyebrows / field labels / meta use the `.brand-eyebrow` recipe (or inline equivalent): `12px / 700 / uppercase / tracking-[0.12em–0.16em] / text-charcoal/45–55`. This is the quietest text tier and it is what makes dense UI read as "designed".

---

## 3. Component catalog

### 3.1 Wordmark — `Wordmark` ★ single source of truth
The logotype `ima ima 𝒬ueencard`: Alfa Slab caps with the **Q in Pinyon Script** (`font-script`, `text-[2em]`, optically kerned `-ml-[0.04em] -mr-[0.02em]`, `align-[-0.08em]`).
- **Props:** `className` (size + colour, e.g. `text-charcoal text-[24px]`), `qClassName` (Q colour on dark surfaces, e.g. `text-lemon`).
- **Rules:** the ONLY way to render the logotype. Never re-create the lemon-badge + Playfair-Q lockup. Never put the script Q inside running prose/headings — flourish is logo-only. (Full rationale: 0001 §6.1 / §8.)

### 3.2 Buttons (inline pattern — not `ui/button`)
Base recipe for all brand buttons:
```
inline-flex items-center justify-center gap-1.5–2 rounded-pill border-2 border-charcoal
font-manrope font-extrabold transition-transform hover:-translate-y-[2px] active:translate-y-0
```
Variants by fill:

| Variant | Fill / hover | Use | Example sizing |
|---|---|---|---|
| **Primary** | `bg-pumpkin text-charcoal` | The one dominant action per view | `min-h-[54px] text-[18px]` (dialog primary) |
| **Secondary → lemon** | `bg-surface-white` → `hover:bg-pumpkin` *or* `hover:bg-lemon` | Card actions, soft CTAs | `min-h-[42px] text-[13.5px]` (card "立刻尝试") |
| **Dark** | `bg-charcoal text-surface-white` | Inverse footer CTA on a light card | `min-h-[52px] text-[15px]` |
| **Icon / nav** | `rounded-full size-11`, `bg-surface-white`, `shadow-brand-sm` | Close (`X`), prev/next nav | `h-11 w-11` |

- **Radius exception:** large CTAs inside cards sometimes use `rounded-[10px]` (not pill) to echo the card corner (see dialog CTAs at `page.tsx:1239`). Pill is the default; match the parent when the button spans a card edge.
- **Hover lift** is the universal affordance: `-translate-y-[2px]`. Nav/icon buttons also gain `shadow-brand-sm`. Some secondary buttons animate **fill** instead of lift (`hover:bg-lemon`) — pick one, not both, per button.
- Icon size inside buttons: `13–19px`, `strokeWidth 2.5–2.8` (lucide). Heavier stroke is intentional — it matches the 2px border weight.

### 3.3 Chips, badges & tags
All share `rounded-pill border-2 border-charcoal` (except topic tags). Four roles:

| Role | Recipe | State logic |
|---|---|---|
| **Filter category chip** | `h-9 px-3.5 text-[13px] font-bold`; default `bg-surface-white text-charcoal/65`; active `${accentFor(cat)} text-charcoal shadow-brand-sm` | Neutral until active — **this is the rainbow-taming rule**. Only the active chip colours up. Hover `-translate-y-[2px]`. |
| **Metric badge** (潜力/爆款) | `min-h-[26px] px-2.5 text-[10.5px] font-extrabold leading-none`; 潜力 = `bg-lemon`, 爆款 = `bg-pumpkin` | Wrapped in a `Tooltip` (§3.6) for the score explanation; `tabIndex={0}` + `cursor-help`. |
| **Accent/stat chip** (header strips) | `rounded-[6px] border-2 px-2–3 py-1 text-[11–13px] font-extrabold`; category uses `accentFor(cat)`, stats `bg-surface-white` | Square-ish (`rounded-[6px]`), not pill, when packed into a strip. |
| **Topic tag** | borderless: `rounded-pill bg-canvas-pink/70 px-2 text-[10.5px] font-semibold text-charcoal/60`, `truncate max-w-[96px]` | Lowest tier — no border, muted, truncated. Use `compactTopicTag()` to strip 小红书 boilerplate. |

`accentFor(category)` maps each category to one fill (`categoryAccents` table in `page.tsx:43`). Default fallback `bg-lemon`.

### 3.4 Segmented control (sort) — shadcn `ToggleGroup`
Single-select. One pill container holds borderless-joined items:
```
ToggleGroup type="single" → rounded-pill border-2 border-charcoal bg-surface-white shadow-brand-sm gap-0 overflow-hidden
ToggleGroupItem           → h-10 rounded-none border-l-2 border-charcoal first:border-l-0 px-3.5 text-[13px] font-bold
                            text-charcoal/70  hover:bg-canvas-pink  data-[state=on]:bg-charcoal data-[state=on]:text-surface-white
```
- Preceded by a label `ArrowDownUp + 排序` (12px/700/uppercase/tracking-[0.14em]), `hidden` below `sm`.
- Active segment = **charcoal fill, white text** (not an accent colour — keeps it calm). Items are joined by `border-l-2`, first item `border-l-0`. Use for mutually-exclusive modes; for filters that stack, use chips (§3.3).

### 3.5 Search field
A `<label>` acting as the input shell (whole field is clickable):
```
flex min-h-[46px] items-center gap-3 rounded-[12px] border-2 border-charcoal bg-surface-white px-4
  ├ Search icon  (19px, strokeWidth 2.5, text-charcoal/55)
  ├ <input>      bg-transparent text-[15px] font-semibold; placeholder:font-medium placeholder:text-charcoal/40; focus:outline-none
  └ count        text-[12px] font-bold tabular-nums text-charcoal/45  ("共 N")
```
No focus ring on the input itself; the 2px frame is the focus affordance. Trailing count is optional meta.

### 3.6 Tooltip — shadcn `Tooltip` (brand-styled content)
Replaces native `title=` for anything that needs a styled explanation (badge scores). Page wraps everything in **one** `TooltipProvider delayDuration={150}`. Content recipe:
```
max-w-[280px] rounded-[10px] border-2 border-charcoal bg-surface-white px-3 py-2
text-[12px] font-medium leading-relaxed text-charcoal shadow-brand
```
Trigger element gets `tabIndex={0}` so keyboard users reach the same info. (`title=` is still fine for low-value hints like truncated topic tags.)

### 3.7 Composer card — `PromptHero` shell + `ImageGenerationComposer`
The generation surface. Outer card + lemon reference strip + embedded composer:
```
.prompt-composer-card (width min(100%,760px)→820px ≥1024)
  rounded-[14px] border-2 border-charcoal bg-surface-white shadow-brand-lg overflow-hidden
  ├ lemon strip:  border-b-2 border-charcoal bg-lemon/80 p-3, flex-col → md:flex-row justify-between
  │   ├ 52×52 thumb (rounded-[8px] border-2 bg-canvas-pink) + image-count badge (mono, charcoal pill)
  │   ├ title (15px/800) + author link (12px/800, underline decoration-2 underline-offset-4) + ArrowUpRight
  │   └ chip cluster: category accent chip + 赞/藏 white chips (rounded-[6px])
  └ <ImageGenerationComposer showHeader={false} frameless layout="compact"
        submitMode="open-generated" submitLabel="生成" onPromptChange={setPrompt} />
```
Pass `frameless` + `showHeader={false}` so the composer inherits this card's frame instead of drawing its own. Seed it via `buildCaseGenerationSeed(item, prompt)` (carries `referenceImages.slice(0,3)`, source links, category).

### 3.8 Prompt template preview — `PromptTemplatePreview` + `.prompt-slot-highlight`
Renders a prompt string with the **editable slots** (标题《…》, 副标题《…》) boxed:
- Component parses title/subtitle via regex and wraps each in `<span class="prompt-slot-highlight">`.
- `.prompt-slot-highlight` = inline boxed token: `border-2 border-charcoal rounded-[7px]`, white→sky gradient fill, `box-shadow: inset 0 -2px 0 rgba(0,0,0,.2), 2px 2px 0 #84bfff`, `font-weight:900`, `box-decoration-break:clone` (survives line wraps).
- Body text tier when used as a paragraph: `text-[14px] font-extrabold leading-[1.7–1.75] text-charcoal/78`.
Use this anywhere a prompt is shown read-only (dialog, confirm panel) so the "what you can change" affordance is consistent.

### 3.9 Case card — `CaseCard` (the workhorse)
Fixed-height editorial card. **Height is locked to `610px`** (`.xhs-case-card`) so the masonry grid stays even; the image region is locked to `352px` (`.case-card-gallery`). Anatomy top→bottom:
```
<article> rounded-[10px] border-2 border-charcoal bg-surface-white  [selected → shadow-[5px_5px_0_#ef724f]]
  1. Header   border-b-2, px-4 py-3: author link (14px/700, charcoal/80) + badge cluster (潜力 lemon / 爆款 pumpkin, §3.3)
  2. Gallery  CaseImageCarousel (§3.10) on bg-canvas-pink p-3, 352px tall
  3. Body     border-t-2, flex-1 flex-col, px-3 py-3 → md:[14px]:
       ├ tag row: category chip (bg-sky) + ≤2 topic tags (truncate, overflow-hidden)
       ├ title:   line-clamp-2 min-h-[40px] text-[16px] font-extrabold leading-[1.25] tracking-[-0.02em]
       ├ stat strip (mt-auto): §3.11
       └ action:  secondary→pumpkin button "立刻尝试" (Zap + .action-underline), min-h-[42px]
```
- **Selected** card = pumpkin coloured shadow `shadow-[5px_5px_0_#ef724f]` (the one place a coloured offset is allowed — signals "this feeds the composer").
- Title must clamp to 2 lines with a reserved `min-h-[40px]` so cards don't jump.
- `.action-underline` draws an animated underline on hover (CSS pseudo-elements, `group/action:hover`).

### 3.10 Image carousel — `CaseImageCarousel` + `BrandedCarouselControls`
Embla-driven slider inside the card gallery region.
- **Lift-shadow shell** (`.case-image-card-shell`): on hover the white surface translates `(8px,-8px)` to reveal a stacked pumpkin + bubblegum offset behind it — a layered hard-shadow "peek". Pure CSS, `0.1s ease-out`.
- Slides cross-fade via GSAP (`opacity/xPercent/scale`, `power3.out`); tap fires `playImageClickMotion` (elastic pop) then `onUseImage`.
- **`BrandedCarouselControls`** (import it): a single translucent pill, bottom-centred, `bg-surface-white/92 backdrop-blur rounded-full border-2 shadow-brand-sm`, chevrons (15px) + `N / count` mono counter. Props: `count`, `selectedIndex`, `ariaLabel`, `onPrevious`, `onNext`, `className?`. Auto-disables (`opacity-35`) when `count <= 1`.
- Each slide is a `<button>` (whole image is the "use this reference" affordance) with `aria-roledescription="slide"` and `aria-label="i / n"`.

### 3.11 Case stat strip — `.case-stat-cell` (data-bar gradient)
One bordered strip, three equal cells, divided by `border-l-2 border-charcoal/10`:
```
flex rounded-[8px] border-2 border-charcoal bg-surface-white overflow-hidden
  each cell: min-h-[34px] flex-1, icon (13px) + value (font-mono 12px/700 tabular tracking-[-0.02em])
```
Each cell paints a **horizontal fill bar** proportional to that metric vs the card's max (`caseStatGradientStyle` sets `--case-stat-fill/--from/--via/--to`; per-kind palettes: likes=pumpkin, saves=sky, shares=lemon). `data-emphasis` (`high/mid/low`, from `caseStatEmphasis`) bumps the leading metric to `font-weight:900 charcoal` and dims low ones to `0.72`. This is how three numbers get a visual ranking without three different chips.

### 3.12 Gallery preview dialog — `GalleryPreviewDialog` (modal)
Full-screen immersive viewer. Hand-rolled (not `ui/dialog`) for the bespoke split layout + GSAP entrance.
```
overlay: fixed inset-0 z-[80] bg-charcoal/58 backdrop-blur-[2px], click-outside closes
shell:   max-w-[1160px] rounded-[14px] border-2 border-charcoal bg-canvas-pink shadow-brand-xl, overflow-hidden
  ├ media stage: border-b-2, charcoal letterbox, object-contain image, lemon "NN/NN" progress badge (mono),
  │              prev/next pill buttons (white, shadow-brand-sm)
  └ aside (white, scrolls):
       ├ header: eyebrow "沉浸式图集预览" + title (26px/900) + close icon-button (size-11 rounded-full)
       ├ accent/stat chip box (rounded-[10px] border-2 bg-canvas-pink)
       ├ thumbnail tabs: 52×68 buttons, active = border-charcoal bg-lemon shadow-brand-sm; inactive = border-charcoal/45 opacity-70
       ├ prompt box: charcoal header strip "提示词" + PromptTemplatePreview (§3.8)
       └ CTAs: primary pumpkin "用这组图生成" (min-h-54) + secondary→lemon "打开生成确认" (min-h-48)
```
- Modal mechanics: locks `body` overflow; Esc closes; ←/→ change image; `role="dialog" aria-modal="true" aria-labelledby`.
- Entrance: shell `y:24→0 scale .985→1`; copy children stagger `0.06`. `shadow-brand-xl` (10px) is reserved for this top-elevation surface.

### 3.13 Money board — `MoneyDuoDuoBoard` ("钱多多榜单")
A self-contained ranking section. Mostly bespoke CSS (`.money-board-*` in `index.css`). Structure:
```
.money-board-shell  rounded-[10px] border-2 shadow-brand-lg
  ├ .money-board-copy  pumpkin strip: kicker pill + h2 (clamp 34–58px, 950 weight, tracking -0.05em) + window pill (seafoam/lemon split)
  └ .money-board-layout  (≥1180px: 2-col, dial | panel)
       ├ dial: SVG text-on-circle ring + rotated keyword pills (.money-board-keyword, --money-pill-rotate)
       └ panel: head (track·metric) + metric toggles (heart/bookmark/share) + ranked list (.money-board-row, 01–06)
```
Notable patterns reusable elsewhere: **rotated pill cluster** (each pill `--money-pill-rotate` ±5–9°, straightens on hover/active), and the **split info pill** (label cell seafoam | value cell lemon, divided by `border-right: 2px`).

### 3.14 Confirm panel ("生成前确认")
Two-column section on a **pumpkin** ground. Left = copy + 3 numbered step cards (`rounded-[12px] border-2 shadow-brand`, mono `01/02/03`). Right = a summary card using the header-strip (§2.2, lemon) + info-rows (§2.3, `divide-y-2 divide-charcoal/10`) + a charcoal footer strip holding the "回到上方生成" button. This is the canonical example of §2.2 + §2.3 + §3.8 composed together.

### 3.15 Empty state
```
rounded-[14px] border-2 border-charcoal bg-surface-white p-8 text-center shadow-brand-lg
  h3 (22px/800) + p (15px/500 charcoal/65, max-w-[360px])
```
Always offer a recovery path in the body copy ("换一个关键词，或回到「全部」"). A bordered+shadowed box, never bare centered text.

### 3.16 Hero headline + marquee (`PromptHero`)
- **Headline**: `font-manrope font-black` (900), `clamp(2.35rem, 4.4vw, 3.9rem)`, `leading-[0.96] tracking-[-0.02em]`. Per-character GSAP reveal (`yPercent 115→0`, stagger `0.026`, `power4.out`); keep a real `aria-label` on the `<h1>` and `aria-hidden` on the animated spans.
- **Marquee** (`.hero-marquee`): a single bordered pill (`border-2 rounded-999 shadow-brand-sm`) with an infinite x-scrolling track; items separated by a pumpkin dot (`::before`), `aria-hidden`. One decorative motion, not a carousel of ornaments.

### 3.17 Image fallback (cross-cutting)
Every `<img>` uses `onError={handleImageError}` → swaps to `IMAGE_FALLBACK` (inline SVG: canvas-pink field + faint charcoal image glyph), guarded by `dataset.fallback="1"` against loops. A missing image must look **designed**, never a broken-image glyph. (See 0001 §9.)

---

## 4. State & interaction matrix

| State | How it's expressed | Applies to |
|---|---|---|
| **Default** | Frame + `shadow-brand-*`, body text muted (`charcoal/70`) | all |
| **Hover (lift)** | `-translate-y-[2px]` (`[1px]` logo, `[3px]` big CTAs) + `transition-transform` | buttons, chips, cards, thumbs |
| **Hover (fill)** | `hover:bg-lemon` / `hover:bg-pumpkin` / `hover:bg-canvas-pink` | secondary buttons, segmented items |
| **Active (press)** | `active:translate-y-0` (cancels the lift) | all interactive |
| **Selected** | **coloured** hard shadow: card `shadow-[5px_5px_0_#ef724f]`; thumb/segment `bg-lemon`/`bg-charcoal` + `shadow-brand-sm` | case card, thumb tabs, sort, filter chip |
| **Disabled** | `opacity-35` (controls) / `opacity-50` (shadcn default), `cursor-default`, no hover | carousel nav, form buttons |
| **Focus** | the 2px charcoal frame *is* the affordance; shadcn focus ring token = pumpkin (`--ring`) | inputs, shadcn primitives |

Rule of thumb: **movement = hover, colour-shadow = selected, fill = toggle-on.** Never bounce for attention.

---

## 5. Composition recipes (copy these, don't reinvent)

1. **Subject header strip** → §2.2. Lemon = your selection; charcoal = system label.
2. **Key/value list** → §2.3. One box, hairline `divide-charcoal/10` rows, 96px label column.
3. **Packed chip cluster** → `rounded-[6px] border-2` square chips, `flex-wrap gap-2`, category coloured + neutral stat chips.
4. **Three-up metric strip** → §3.11. One bordered strip, `border-l-2 border-charcoal/10`, mono tabular values, gradient fill bar for ranking.
5. **CTA stack** → primary (pumpkin, biggest `min-h`) above secondary (white→lemon). Match button radius to the parent card edge.
6. **Numbered steps** → small cards with mono `01/02/03` top-left (`text-charcoal/35`) and the label pinned bottom (`mt-8`).

---

## 6. Do / Don't

**Do**
- Import `Wordmark` and `BrandedCarouselControls`; never re-hand-roll them.
- Build brand buttons/chips from the §3.2/§3.3 recipes (inline), and keep one dominant pumpkin action per view.
- Carry the full frame on every surface: `border-2 border-charcoal` + the matching `shadow-brand-*` step.
- Use shadcn primitives for behaviour, then override chrome with brand classes.
- Mute supporting copy (`charcoal/70`, weight 500–600) and reserve clamp `min-h` so cards don't jump.
- Wrap explanatory hovers in the brand `Tooltip`; give the trigger `tabIndex={0}`.

**Don't**
- Use stock `ui/button` for a brand action (it's `rounded-md`, no frame).
- Invent a 5th shadow or hand-write `shadow-[Npx_Npx_0_#000]` (use the scale; `#1a1714` only).
- Colour every filter chip at once (rainbow) — neutral until active.
- Nest boxes for a key/value list — one box + hairlines.
- Put the script Q in prose, or re-introduce the lemon-badge logo lockup.
- Make everything `font-extrabold`/`900` — the weight hierarchy (0001 §3.2) is what reads as "natural".

---

## 7. Component & file map

| Component / pattern | Where |
|---|---|
| Wordmark (logotype) | `src/components/layout/Wordmark.tsx` |
| Carousel controls | `src/components/common/branded-carousel-controls.tsx` |
| Navbar / Footer | `src/components/layout/{Navbar,Footer}.tsx` |
| Composer (embedded) | `src/components/common/image-generation-composer.tsx` |
| shadcn primitives (ToggleGroup, Tooltip, Dialog, …) | `src/components/ui/*` |
| Buttons / chips / cards / strips (inline patterns) | `src/app/prompts/page.tsx` (canonical) |
| Case card, carousel, stat strip, dialog, money board, confirm panel | `src/app/prompts/page.tsx` |
| Custom classes (shadows, containers, slot-highlight, stat-cell, masonry, money-board) | `src/index.css` |
| Tokens (colour / type / spacing / shadow values) | [`0001_design_tokens.md`](./0001_design_tokens.md) |
