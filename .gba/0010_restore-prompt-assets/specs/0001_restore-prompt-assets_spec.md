# Restore prompt assets

## Problem

The active application is built from `ima ima queencard/src`, while the 1,063
XHS prompt assets remain tracked under the legacy
`ima ima queencard/frontend/public/xhs-cases` directory. An upload deployment
from the active application therefore omitted 321 MB of images and every
`/xhs-cases/*` request returned HTTP 404.

## Solution

Keep the existing same-origin `/xhs-cases/*` application contract and use a
Next.js external rewrite to the repository's jsDelivr-backed legacy asset
directory. This avoids duplicating 321 MB into every application image while
preserving browser and reference-image fetch behavior.

## Acceptance

- The cover and gallery paths for `鸡，谁懂？` return HTTP 200 through the app.
- Responses are JPEG images rather than HTML error pages.
- The `/prompts` page renders its cover and selected reference image.
- The production Docker image remains free of the duplicated asset library.
