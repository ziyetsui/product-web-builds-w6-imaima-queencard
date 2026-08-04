# Miniapp Production Internal-Test Foundation Design

## 1. Goal

Make the `miniapp-lemon` branch deployable as a payment-disabled production
internal-test build without changing the existing ima ima queencard UI or
joining the web account/database system.

This slice ends at a reproducible deployment handoff. It does not deploy to
Zeabur, submit a WeChat review build, or enable real WeChat Pay.

## 2. Current Baseline

- The mini program and its backend are independently deployable from the web
  product.
- The mini program already includes template browsing, generation, result,
  history, credits, pricing, account, billing, and protected admin pages.
- The backend already includes WeChat login, PostgreSQL and S3-compatible
  adapters, durable generation jobs, GPTProto/OpenAI providers, credit holds,
  billing, admin operations, and a disabled/WeChat payment adapter boundary.
- `backend/Dockerfile` includes the production SQL migrations.
- The checked-in client currently targets
  `https://ima-queencard-miniapp.zeabur.app`, but the deployed service is older
  than the current `miniapp-lemon` branch.
- Real PostgreSQL, object storage, GPTProto, WeChat login, deployed-domain, and
  payment tests have not all been completed against one production deployment.

## 3. Scope

### Included

1. Bring deployment and app README documentation in line with the current
   independent mini-program architecture.
2. Add a production preflight command that validates configuration without
   printing secret values.
3. Add single-instance rate limiting through a replaceable backend interface.
4. Extend health diagnostics with build identity and explicit database,
   storage, and worker readiness.
5. Add a post-deployment smoke command for public and authentication-boundary
   endpoints.
6. Test the Docker build contract, production configuration contract, rate
   limits, health output, and smoke-command failure behavior.
7. Keep payment disabled in the internal-test production configuration.

### Excluded

- Creating or modifying Zeabur services.
- Supplying or rotating real secrets.
- WeChat content-security API integration.
- Privacy, terms, support, and refund pages.
- Real WeChat Pay, refunds, or merchant-notification validation against the
  live merchant account.
- WeChat review submission or release upload.
- Sharing users, credits, orders, history, databases, or storage with the web
  product.
- Visual restyling.

## 4. Architecture

### 4.1 Production Preflight

Create `backend/scripts/preflight.js` as the operator entrypoint. It loads the
same `backend/src/config.js` configuration used by the server and returns one
of two outcomes:

- exit code `0`: every required internal-test production setting is present
  and internally consistent;
- non-zero exit code: a stable list of missing or invalid variable names.

The command must never print variable values. It checks these groups:

- runtime: production mode, host, build SHA;
- WeChat: real AppID, AppSecret, development login disabled;
- database: PostgreSQL URL and SSL choice;
- storage: supported S3-compatible provider, endpoint, region, bucket and
  credentials;
- generated assets: signing secret and public backend origin;
- generation: durable worker, GPTProto or OpenAI provider and matching key;
- payment: exactly `PAYMENT_PROVIDER=disabled` for this slice.

The preflight remains a static/configuration check. Live dependency checks are
reported by `/health` after deployment.

### 4.2 Rate Limiting

Add a small rate-limiter service with a stable interface:

```text
consume({ scope, key, limit, windowMs, now })
  -> { allowed, limit, remaining, resetAt }
```

The first implementation is process-local and intended for one internal-test
backend instance. The interface allows a shared Redis/PostgreSQL adapter to be
added before a multi-instance public release.

Policies:

| Scope | Identity | Limit |
| --- | --- | --- |
| WeChat login | client IP | 10 per minute |
| Reference upload | authenticated user, else IP | 20 per 10 minutes |
| Generation submit/regenerate | authenticated user | 10 per 10 minutes |
| Order creation | authenticated user | 10 per minute |
| Admin mutations | authenticated admin | 60 per minute |

Rejected requests return HTTP `429`, code `RATE_LIMITED`, a Chinese-safe client
message, and `Retry-After`. No token, openid, prompt, filename, or image content
is written into the rate-limit key or response.

### 4.3 Health Diagnostics

`GET /health` remains unauthenticated but exposes only non-secret diagnostics:

```json
{
  "success": true,
  "data": {
    "ok": true,
    "buildSha": "<deployed commit>",
    "environment": "production",
    "dependencies": {
      "database": { "ready": true, "driver": "postgres" },
      "storage": { "ready": true, "driver": "s3" },
      "workers": { "ready": true, "mode": "durable" }
    }
  }
}
```

Any unready dependency returns HTTP `503`. Errors are sanitized using the
existing secret-redaction path.

### 4.4 Deployment Smoke Check

Create `backend/scripts/smoke-deployment.js`. It accepts a base HTTPS URL and
checks:

1. `/health` returns `200`, `production`, a non-placeholder build SHA, and all
   dependencies ready.
2. `/api/miniapp/templates?page=1&limit=1` returns a non-empty catalog record.
3. `/api/miniapp/models` returns GPT Image 2 as the default enabled model.
4. A protected endpoint without a bearer token returns `401`, proving the
   production service is not using development login.
5. `/api/miniapp/pricing` is readable while order creation reports payment as
   disabled rather than completing a mock purchase.

The smoke command must use HTTPS, reject redirects to another host, use bounded
timeouts, and never accept credentials as command-line arguments.

## 5. Documentation

Update:

- `backend/docs/zeabur-deploy.md`: remove the obsolete statement that
  PostgreSQL/S3 adapters are not wired; document the current Docker context,
  migrations, production preflight, payment-disabled staging profile, health,
  smoke check, and later secret injection.
- `app/README.md`: remove the obsolete static-only description and document the
  current pages, backend boundary, local validation, Developer Tools import,
  and the configured API origin.
- `backend/.env.zeabur.example`: make the internal-test profile unambiguous,
  require a non-placeholder `BUILD_SHA`, durable generation, real provider,
  and disabled payment. Secret values remain placeholders.

## 6. Error Handling And Security

- Configuration errors name keys only and never values.
- Rate-limit errors are stable and do not disclose whether an account exists.
- Health failures expose dependency class and readiness only, not hostnames,
  bucket names, database URLs, provider responses, or stack traces.
- Smoke failures name the failing endpoint and expected state but redact
  response bodies that may contain user or provider data.
- All new HTTP calls have explicit timeouts.
- `.env` files remain ignored; example files remain tracked.

## 7. Testing

Add focused tests for:

- production preflight success and each missing/invalid configuration group;
- preflight output secret redaction;
- rate-limit boundary, reset, independent identities, and HTTP `429` mapping;
- health `200`/`503`, build SHA, and non-secret dependency output;
- smoke success using a local fake HTTP server;
- smoke rejection of HTTP URLs, cross-host redirects, malformed JSON,
  placeholder build SHA, unready dependencies, missing templates/models, and
  mock payment behavior;
- documentation and Docker-context contracts.

Run these final gates:

```bash
cd backend && npm test
cd app && npm run validate
git diff --check
```

The real PostgreSQL integration test remains a Part 2 gate because it requires
`DATABASE_URL_TEST`.

## 8. Acceptance Criteria

Part 1 is complete only when:

1. Production preflight fails closed on every missing dependency group and
   prints no secret values.
2. The internal-test profile cannot enable development login or mock payment.
3. The five protected action groups return `429` at their documented limits.
4. `/health` reliably distinguishes ready from unready production instances and
   includes the deployed commit SHA.
5. The smoke command can distinguish the current old Zeabur service from a
   deployment built from `miniapp-lemon`.
6. Backend tests, app validation, and `git diff --check` pass.
7. Documentation contains exact operator commands and no live credentials.
8. The work is committed and pushed to `miniapp-lemon` as one reviewable slice.

## 9. Later Parts

- Part 2: provision/connect PostgreSQL and object storage, deploy to Zeabur,
  configure AppSecret and GPTProto, then run real login/upload/generate/history
  smoke tests.
- Part 3: add privacy/terms/support/refund surfaces, WeChat content security,
  reviewer-safe feature flags, and full visual review.
- Part 4: configure and validate live WeChat Pay, notify, exactly-once credit
  fulfillment, refunds, and payment audit.
- Part 5: real-device regression, legal-domain verification, release upload,
  monitoring, backup, rollback, and review submission.
