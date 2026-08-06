# ima ima queencard Mini Program

Native WeChat Mini Program reconstruction of the GitHub queencard product.
The app keeps the Web prompt-page interaction model: matching templates expose
fixed image blocks and editable prompt slots, while older prompts keep the
ordinary text editor.

## Preview

1. Open WeChat Developer Tools.
2. Import the `app` folder in this repository.
3. Use the AppID in `project.config.json` for preview, or replace it with the
   real Mini Program AppID.

The mini program calls the independent backend through `/api/miniapp/*`.
Set `config/env.js` `API_BASE_URL` to the deployed HTTPS backend origin. Keep
all model keys, database credentials, WeChat AppSecret, payment keys and
certificates in the backend environment only.

The template catalog is paged from the backend. Do not bundle the full catalog
or generated image library into the mini program package.

## Validate

```bash
npm run validate
```

For local development with a localhost backend, run:

```bash
VALIDATE_ALLOW_LOCALHOST=1 npm run validate
```

Before upload, follow `docs/release-checklist.md` and compile the project in
WeChat Developer Tools. Payment remains unavailable unless the backend returns
verified payment parameters and the merchant callback is configured.
