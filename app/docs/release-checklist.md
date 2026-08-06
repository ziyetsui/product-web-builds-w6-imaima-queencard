# Mini Program Release Checklist

## WeChat Console

- [ ] AppID is final and matches `app/project.config.json`.
- [ ] The production backend is HTTPS and added to request合法域名.
- [ ] Upload and download domains are configured for the asset endpoints.
- [ ] The merchant account is associated with the AppID before enabling WeChat Pay.
- [ ] The product category permits AI image generation and credit purchase.
- [ ] Privacy policy and user agreement are reviewed and published.

## Backend

- [ ] `NODE_ENV=production` is set.
- [ ] PostgreSQL or another durable production store is configured.
- [ ] `WECHAT_MINIAPP_APP_ID` and `WECHAT_MINIAPP_APP_SECRET` are configured only on the backend.
- [ ] `GPTPROTO_API_KEY` or `OPENAI_IMAGE_API_KEY` is configured only on the backend.
- [ ] Private asset storage, signed downloads, and cleanup jobs are working.
- [ ] `MINIAPP_PAYMENT_MODE=disabled` remains set until WeChat Pay notify verification is complete.
- [ ] Rate limits, audit logs, error monitoring, and backups are enabled.

## Functional Tests

- [ ] A real WeChat user can log in and remains logged in after reopening the app.
- [ ] A template loads its fixed image block and editable prompt slots.
- [ ] The generated request contains the final rendered prompt.
- [ ] A real generation task reaches the result page and can be saved to the album.
- [ ] The task appears in the mini program history with its status and output.
- [ ] Failed or timed-out tasks release held credits exactly once.
- [ ] Account, credits, billing, and order pages load for the same user.
- [ ] A payment-disabled build cannot call mock payment in production.
- [ ] A verified payment callback grants credits once and is idempotent on replay.
- [ ] A real-device small-amount `wx.requestPayment` succeeds and reconciliation marks the order paid.
- [ ] A full refund reaches the separate refund callback and reverses credits exactly once.
- [ ] Payment, fulfillment, refund acceptance, and refund completion appear in the audit trail.

## Build Gate

- [ ] `npm run validate` passes in `app`.
- [ ] Backend tests, lint, and production build pass.
- [ ] WeChat Developer Tools compile has no errors.
- [ ] Screenshots have been checked for landing, template feed, generate,
  result, history, account, credits, pricing, billing, and legal pages.
- [ ] No server secret or private key is present in the mini program package.
