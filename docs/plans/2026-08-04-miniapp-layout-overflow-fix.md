# Mini-program layout overflow fix

## Problem

Several native `button` elements render at an intrinsic width of about 184px in WeChat Developer Tools. The width stretches grid cells, action rows, and three-column top bars beyond the 390px simulator viewport.

## Design

- Allow native buttons to shrink globally with `min-width: 0`.
- Override the native 184px width only where a page already declares an explicit layout width.
- Use equal side columns in three-part top bars so the brand remains centered.
- Keep existing colors, borders, shadows, type scale, and component structure.
- Retain full-width upload controls and shrinkable generation-mode grid tracks.
- Verify every registered page at the top and bottom of its scroll range with the official mini-program automator.

## Acceptance criteria

- No registered page has a scroll width greater than the 390px simulator viewport.
- No inspected interactive element extends outside the viewport.
- Existing unit tests and the mini-program validator pass.
- Nine-page visual screenshots show no text clipping, button overflow, or top-bar overlap.
