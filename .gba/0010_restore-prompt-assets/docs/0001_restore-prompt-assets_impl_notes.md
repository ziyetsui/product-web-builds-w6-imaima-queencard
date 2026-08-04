# Restore prompt assets implementation notes

The CDN source was verified before implementation:

- Cover image: HTTP 200, `image/jpeg`, CORS `*`.
- Gallery image: HTTP 200, `image/jpeg`, CORS `*`.

The rewrite is intentionally scoped to `/xhs-cases/:assetPath*`; other public
assets continue to be served from the active application's `src/public`.

Local verification on 2026-08-04:

- Production build completed successfully.
- `/xhs-cases/027-20251009-Tila酱-鸡-谁懂.jpg` returned HTTP 200,
  `image/jpeg`, and JPEG magic bytes `ffd8ff`.
- `/xhs-cases/gallery/68e7953a00000000070087cc/01.jpg` returned HTTP 200,
  `image/jpeg`, and JPEG magic bytes `ffd8ff`.
