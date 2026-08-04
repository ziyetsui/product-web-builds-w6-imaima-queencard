# Operations notifications and overview

- Notify the operator when a user account is created.
- Notify the operator only after a payment fulfillment has granted credits.
- Prefer a Feishu custom-bot webhook and fall back to the configured email provider.
- Expose a read-only `/admin/operations` page with daily registrations,
  fulfilled payers, estimated CNY list-price revenue, recent payments,
  failed/skipped fulfillments, and GPTProto configuration status.
- Notification delivery failures must never roll back registration, payment, or
  credit fulfillment.

