# 0001 · ima ima queencard — Design System & Tokens

> Status: Living spec · Last updated 2026-06-16
> Scope: `w6/ima ima queencard/frontend` (Next.js 16 + React + TypeScript + Tailwind + shadcn/ui)
> Source of truth in code: `src/index.css` (`:root` tokens + utilities), `tailwind.config.ts`, `src/components/layout/Wordmark.tsx`, shared `Navbar`/`Footer`.

This document codifies the visual language of **ima ima queencard** — a 参考图驱动 (reference-image-driven) viral-content generation tool. The aesthetic is **"refined neo-brutalism"**: it keeps the brand's bold identity (thick black borders, hard offset shadows, candy accents) but executes it with the restraint, hierarchy and rhythm of a world-class editorial product. The north star reference is **every.to** (calm, editorial, one elegant decorative move); functional layout references **raphael.app** (canvas + vertical masonry).

---

## 0. The brief, distilled

Every design request on this project has repeated the same intent:

> "用 shadcn + TS + React 美化提升页面 —— layout、字体、排版、层级、间距…… 堪比国际一流 UI/UX 设计大师，**使其看起来自然**。"

Direction locked: **refine the existing neo-brutalist style** (do not replace it), scope **includes shared components** (Navbar/Footer). "自然 / 克制" (natural / restrained) is the acceptance bar — louder is wrong.

---

## 1. What makes it look "natural" (core principles)

These are the levers that turn "noisy brutalism" into "premium". When in doubt, optimise for these:

1. **Type weight hierarchy beats size.** The #1 fix on this project was ending the "everything is `font-extrabold` (800)" wall. Information must have a loudness order (see §3).
2. **Mute the body, spotlight the focus.** Supporting copy drops to weight 500–600 **and** colour `text-charcoal/70`. This single move creates breathing room.
3. **Colour discipline = role system, not a rainbow.** One action colour (pumpkin), one highlight (lemon), neutral surfaces, muted secondary text. Decorative accents earn their place; they don't carpet the screen. Category chips are neutral by default and only colour up when active.
4. **Warm near-black, never pure black.** Charcoal is `#1a1714`, not `#000`. Softer borders/text pair with the warm canvas background and read as "designed", not "default".
5. **One consistent shadow scale**, never ad-hoc `shadow-[Npx_Npx_0_#000]`.
6. **A 4 / 8 spacing rhythm** and shared content measures, so blocks feel related, not floating.
7. **One decorative move, done well.** A single calligraphic glyph in the wordmark > two competing ornaments. (We removed a duplicated logo Q because it read "不自然".)
8. **Graceful degradation looks intentional.** Broken images fall back to a branded placeholder, never a browser glyph.
9. **Motion is a whisper.** Small hover lifts and soft eases; nothing bounces for attention.

---

## 2. Colour

### 2.1 Brand palette (`tailwind.config.ts` → `theme.extend.colors`)

| Token | Hex | Role |
|---|---|---|
| `canvas-pink` | `#f6e0db` | Page background (warm). The "paper". |
| `charcoal` | `#1a1714` | **Warm near-black.** All borders, primary text, hard shadows. (Was `#000` — warmed for elegance.) |
| `surface-white` | `#ffffff` | Cards / raised surfaces. |
| `pumpkin` | `#ef724f` | **Primary action / focus.** CTAs, active nav, selected-card shadow, focus ring. The only "go" colour. |
| `lemon` | `#e7db4c` | **Highlight / selected / brand accent.** Composer header, active chips, wordmark Q on dark. |
| `seafoam` | `#ace2df` | Secondary accent (shadcn `--secondary`). |
| `sky` | `#84bfff` | Tertiary accent (e.g. card category chip). |
| `lavender` | `#e69dff` | Accent (category). |
| `spring` | `#6ed311` | Accent (category). |
| `bubblegum` | `#981082` | Deep accent (rare). |
| `deep-blue` | `#5196ff` | Accent (rare). |

### 2.2 Colour roles (use these, not "pick a nice colour")

- **Action / primary** → `pumpkin`. Exactly one per view should dominate.
- **Highlight / selected / active** → `lemon`.
- **Surface** → `surface-white` on `canvas-pink`.
- **Ink** → `charcoal` (primary), `charcoal/70` (body), `charcoal/55`–`/45` (labels/meta), `charcoal/25`–`/10` (hairlines/dividers).
- **Category accents** (seafoam/sky/lavender/spring): **muted/neutral by default, coloured only when active or as a single per-card tag.** Never a full grid of different colours competing.

### 2.3 shadcn HSL mapping (`src/index.css` `:root`)

shadcn components are themed to the brand. Key mappings (HSL triplets):

```
--background: 11 60% 91%    /* canvas-pink */      --foreground: 30 13% 9%   /* charcoal  */
--card: 0 0% 100%                                  --card-foreground: 30 13% 9%
--primary: 30 13% 9%        /* charcoal fill */    --primary-foreground: 0 0% 100%
--secondary: 178 45% 76%    /* seafoam */          --accent: 54 76% 60%      /* lemon */
--muted: 11 40% 88%                                --muted-foreground: 0 0% 35%
--border: 30 13% 9%   --input: 30 13% 9%   --ring: 13 83% 62%  /* pumpkin */
--radius: 47px        /* default = pill */
```

`30 13% 9%` is the HSL form of charcoal `#1a1714`; it appears anywhere pure black would have. `* { @apply border-border }` makes charcoal the default border everywhere.

---

## 3. Typography

### 3.1 Families (`tailwind.config.ts` + Google Fonts `<link>` in `src/app/layout.tsx`)

| Tailwind class | Font | Use |
|---|---|---|
| `font-alfa` | **Alfa Slab One** | Display slab — wordmark, some H1/H2 in marketing. |
| `font-manrope` | **Manrope** (400/500/600/700/800) | Everything UI: body, labels, buttons, stats. Default `body` font. |
| `font-playfair` | **Playfair Display** (700/800/900) | High-contrast Didone serif — editorial accents / alt logo. |
| `font-script` | **Pinyon Script** | Calligraphic copperplate — **the "Q" of the wordmark** and the favicon mark. |

Fonts load via one `<link>` in `layout.tsx`. When adding a weight, add it to the link query or it silently falls back (we hit this with Manrope 600 and Playfair).

### 3.2 The weight hierarchy (the rule that creates "natural")

| Tier | Weight | Colour | Used for |
|---|---|---|---|
| Display | **900** (`font-black`) | `charcoal` | Hero headline, big section H2 |
| Title | **800** (`font-extrabold`) | `charcoal` | Card titles, section sub-heads |
| Label / eyebrow | **700** (`font-bold`) + `tracking-[0.12em–0.16em]`, often `uppercase` | `charcoal/45–55` | Kickers, field labels, meta |
| Body / supporting | **500–600** (`font-medium`/`font-semibold`) | `charcoal/70` | Descriptions, helper text |
| Numerals / stats | `font-mono` **700** + `tabular-nums` | `charcoal` | Counts, metrics, `1 / N` |

Rules:
- **Never leave a screen all-800.** If a block has a title and a paragraph, the paragraph must be lighter and dimmer.
- Tight display tracking: headlines use `tracking-[-0.02em]`; wordmark `tracking-[-0.015em]`.
- `.brand-eyebrow` utility encapsulates the label tier (12px / 700 / `0.16em` / uppercase / `charcoal/55`).

---

## 4. Spacing, layout & containers

### 4.1 Rhythm
- Base grid: **4 / 8 px**. Internal stacks use `mt-4 / mt-5 / mt-6 / mt-8` consistently.
- Section vertical padding: `py-12 md:py-16` for major sections; `py-4 md:py-5` for utility bars.
- Hero internal cadence: `eyebrow → (mt-5) headline → (mt-5) subcopy → (mt-8) marquee → (mt-8) composer`.

### 4.2 Content measures (`src/index.css`)
- `.prompt-container` ≈ `min(100vw-32px, 880px)`; `--wide`/`--gallery` widen to `1080px` ≥1024px.
- `.prompt-container--hero` is narrower (`≤920px`) so the hero reads centred.
- All hero blocks share one measure → no "floating disconnected blocks".

### 4.3 The signature layout pattern (ref raphael.app)
**Canvas + vertical masonry.** The generation surface (composer) sits up top; results/cases flow in a vertical masonry grid below.
- `.xhs-masonry`: 1 col → **2 cols ≥820px** → **3 cols ≥1180px**, `gap: 18–20px`.
- Cards are fixed-height (`610px`) with an internal image carousel region (`352px`).

---

## 5. Borders, radius, elevation

### 5.1 Borders
- **`border-2 border-charcoal`** is the universal frame. 2px, warm-black, everywhere.
- Hairlines / internal dividers use `charcoal/10`–`/15` (e.g. `divide-charcoal/10`) — much lighter than the 2px frame, to avoid a heavy grid.

### 5.2 Radius (`tailwind.config.ts` + arbitrary)
| Token | Value | Use |
|---|---|---|
| `rounded-pill` | `47px` | Pills, chips, buttons, segmented controls |
| `rounded-card` | `10px` | Default card/box |
| `rounded-[12px]` / `[14px]` | — | Larger cards, composer, dialog |
| `rounded-[16px]`/`[18px]` | — | Logo chip / large surfaces |
| `rounded-card-lg` | `40px` | Rare large blocks |

### 5.3 Shadow scale — **the hard-offset system** (`src/index.css` utilities)
Always use these; never hand-write `shadow-[...#000]`.

```
.shadow-brand-sm  → 2px 2px 0 #1a1714
.shadow-brand     → 4px 4px 0 #1a1714
.shadow-brand-lg  → 6px 6px 0 #1a1714
.shadow-brand-xl  → 10px 10px 0 #1a1714
```
- Hard (no blur), warm-black, offset down-right. This *is* the brutalist signature — but disciplined to four steps.
- **Selected state exception:** a selected card uses a coloured hard shadow `shadow-[5px_5px_0_#ef724f]` (pumpkin) to signal focus.

---

## 6. Components

### 6.1 Brand wordmark — `Wordmark` (`src/components/layout/Wordmark.tsx`) ★ single source of truth
Renders `ima ima 𝒬ueencard`: Alfa Slab caps with the **"Q" of Queencard in Pinyon Script** (`font-script`), the every.to "embedded glyph" move.
- Q is `text-[2em]` (scales from parent size), `inline-block`, vertically centred with the caps via `align-[-0.08em]`, with `-ml-[0.04em] -mr-[0.02em]` optical kerning.
- Props: `className` (size + colour, e.g. `text-charcoal text-[24px]`), `qClassName` (Q colour on dark surfaces, e.g. `text-lemon`).
- **Rule: this component is the ONLY way to render the logotype.** Never re-create the old "lemon badge + Playfair Q" lockup. It is wired into Navbar (desktop + mobile menu), Footer, and the login / register / forgot-password / reset-password / pricing / credits / generated pages.
- **Do NOT** embed the script Q in running prose/headings (landing copy, hero description) — those stay plain text "ima ima queencard". The flourish is for the logo only.

### 6.2 Buttons
- Shape: `rounded-pill border-2 border-charcoal`, `font-manrope font-extrabold`, `min-h` 42–54px.
- Primary: `bg-pumpkin text-charcoal`. Secondary: `bg-surface-white`, hover `bg-lemon`. Dark: `bg-charcoal text-surface-white`.
- Hover: `-translate-y-[2px]` (+ `shadow-brand-sm` on nav pills); active: `translate-y-0`.

### 6.3 Chips / tags
- `rounded-pill border-2 border-charcoal`, height `h-9` (filters) / `min-h-[24–28px]` (card tags).
- **Filter category chips:** neutral (`bg-surface-white text-charcoal/65`) by default; active = `accentFor(category)` fill + `shadow-brand-sm`. This is the rainbow-taming rule.
- Topic tags: borderless, `bg-canvas-pink/70`, `font-semibold text-charcoal/60`.

### 6.4 Segmented control (sort) — shadcn `ToggleGroup`
Single-select sort uses `ToggleGroup type="single"`: one pill container (`rounded-pill border-2 border-charcoal shadow-brand-sm`), items `border-l-2 border-charcoal first:border-l-0`, active = `data-[state=on]:bg-charcoal data-[state=on]:text-surface-white`. A single `ArrowDownUp` + "排序" label precedes it (hidden on mobile). Replaces the old row of 4 redundant buttons.

### 6.5 Tooltip — shadcn `Tooltip`
Used for the potential-score / 爆款 badges (replaces native `title`). Content styled to brand: `rounded-[10px] border-2 border-charcoal bg-surface-white px-3 py-2 text-[12px] font-medium text-charcoal shadow-brand`. Page is wrapped in one `TooltipProvider` (delay 150ms).

### 6.6 Cards (case card)
Structure: header (author + badges) → image carousel → body (category/topics, title, stats strip, action). Hierarchy applied: author `font-bold text-charcoal/80`, title 800, stats `font-mono 700`. Stats are **one** bordered strip divided by `border-charcoal/10` (not 3 nested boxes).

### 6.7 Carousel controls — `BrandedCarouselControls`
A single translucent pill (`bg-surface-white/92 backdrop-blur rounded-full border-2 shadow-brand-sm`) with chevrons. ≤7 images → pumpkin dots (active `w-4`); >7 → compact `N / total` mono counter. (Replaced a heavy black dot-bar.)

### 6.8 Composer card
`rounded-[14px] border-2 border-charcoal shadow-brand-lg`, lemon header strip carrying the selected reference + stats, body with the prompt template (highlighted "slots").

---

## 7. Motion

- **Hover lift:** `-translate-y-[2px]` (cards/buttons), `-translate-y-[1px]` (logo). Always paired with `transition-transform`/`transition-all duration-200`.
- **Easing:** UI transitions `160–280ms`; signature spring `cubic-bezier(0.16, 1, 0.3, 1)`; underline reveal `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- **GSAP** (hero + carousel + dialog only): hero headline per-character reveal (`yPercent 115→0`, stagger `0.026`, `power4.out`); marquee infinite x-scroll; carousel slide cross-fade; dialog open `power3.out`. Keep GSAP for orchestrated sequences; use CSS transitions for simple hovers.
- Restraint: no bounce-for-attention, no neon/glow, no blur except subtle backdrop on the carousel pill.

---

## 8. Brand identity — logo & favicon

- **Direction:** every.to-inspired calligraphy ("B · Calligraphy"). The decorative glyph is a **Pinyon Script "Q"**.
- **In-page logo** = the `Wordmark` (wordmark *is* the logo; no separate icon chip). One script Q only.
- **Favicon** = the *standalone* mark (square icon role), separate from the wordmark: `public/icon.svg` + `public/favicon.ico` = `canvas-pink` rounded square + `charcoal` Pinyon Script Q.
  - **Why rasterized:** favicons render in isolation and can't load web fonts, so the script Q is baked to a PNG: render the page-loaded Pinyon font onto a `<canvas>` (`document.fonts.ready` → `ctx.fillText`), embed that PNG inside `icon.svg` as `<image>`, and wrap the same PNG in a PNG-embedded `.ico` (ICO header + dir entry + PNG). `layout.tsx` `metadata.icons` lists `/icon.svg` (type `image/svg+xml`) first, `/favicon.ico` as fallback.
- Earlier explored & rejected: A · Editorial (Playfair Didone Q) and C · lemon brutalist badge — kept as alternates, not in use.

---

## 9. Imagery & fallback

- Reference images are **local** assets under `/xhs-cases/...` (object-fit `contain`/`cover` on white surfaces).
- **Broken-image rule:** every `<img>` uses an `onError` handler that swaps to a branded inline-SVG placeholder (canvas-pink field + a faint charcoal image icon), guarded by `dataset.fallback` to avoid loops. A missing image must look designed, not broken.

---

## 10. Accessibility

- Colour text on coloured fills uses the darkest shade of that family (`text-charcoal` on lemon/pumpkin), never mid-grey.
- Interactive glyph badges that use Tooltip carry `tabIndex={0}` so keyboard users get the same info.
- Carousel/controls have `aria-label`s; decorative marquee is `aria-hidden`. Hero headline keeps a real `aria-label` while characters animate.
- Focus ring token = pumpkin (`--ring`).

---

## 11. Do / Don't

**Do**
- Use `Wordmark`, `shadow-brand-*`, `.brand-eyebrow`, the weight tiers, and the colour roles.
- Keep one dominant action colour per view.
- Mute and dim supporting copy.
- Add new font weights to the `layout.tsx` link before using them.

**Don't**
- Re-introduce the lemon-badge + Playfair-Q logo lockup.
- Write ad-hoc `shadow-[...#000]` or use pure `#000`.
- Make everything `font-extrabold`.
- Colour every category chip at once (rainbow).
- Put the script Q inside sentences/headings.

---

## 12. File map

| Concern | File |
|---|---|
| Tokens (`:root`), shadow/eyebrow utilities, custom classes | `w6/ima ima queencard/frontend/src/index.css` |
| Brand colours, fonts, radii | `w6/ima ima queencard/frontend/tailwind.config.ts` |
| Font loading + favicon metadata | `w6/ima ima queencard/frontend/src/app/layout.tsx` |
| Logotype | `w6/ima ima queencard/frontend/src/components/layout/Wordmark.tsx` |
| Nav / footer | `w6/ima ima queencard/frontend/src/components/layout/{Navbar,Footer}.tsx` |
| Carousel control | `w6/ima ima queencard/frontend/src/components/common/branded-carousel-controls.tsx` |
| Favicon assets | `w6/ima ima queencard/frontend/public/{icon.svg,favicon.ico}` |
| Reference implementation of all the above | `w6/ima ima queencard/frontend/src/app/prompts/page.tsx` |
