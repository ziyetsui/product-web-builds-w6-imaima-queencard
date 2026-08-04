# Miniapp Production Internal-Test Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the independent mini program backend ready for a payment-disabled production internal-test deployment with safe configuration checks, basic abuse limits, dependency health, and reproducible smoke verification.

**Architecture:** Keep the existing standalone `backend` and native `app` boundaries. Add testable services for production preflight and process-local rate limiting, wire them into the existing request dispatcher, and expose operator scripts that use the same runtime configuration as the server. Do not share web accounts, databases, storage, or payment state.

**Tech Stack:** Node.js `>=22.5.0`, Node built-in test runner, `pg`, existing S3 adapters, native WeChat Mini Program JavaScript/WXML/WXSS, Docker/Zeabur deployment.

## Global Constraints

- Work only on branch `miniapp-lemon`.
- Keep `PAYMENT_PROVIDER=disabled` for this slice; mock payment must not be usable in production.
- Keep `MINIAPP_DEV_LOGIN=0` for production configuration.
- Never print, commit, or put credentials in the mini-program package.
- Preserve the existing ima ima queencard visual language and page behavior.
- Keep web and mini-program accounts, credits, orders, history, databases, and storage independent.
- Use the existing backend configuration loader and error-redaction behavior.
- Do not deploy to Zeabur during this code slice.

---

### Task 1: Add Testable Production Preflight

**Files:**
- Create: `backend/src/services/production-preflight.js`
- Create: `backend/scripts/preflight.js`
- Create: `backend/test/preflight.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `loadConfig(env)` from `backend/src/config.js`.
- Produces: `validateProductionEnvironment(env) -> { ok, missing, invalid, config }` and a CLI command `npm run preflight`.

- [ ] **Step 1: Write failing unit tests for complete and incomplete environments**

Create `backend/test/preflight.test.js` with a reusable fixture containing
non-secret placeholder values and these cases:

```js
test("accepts a payment-disabled GPTProto internal-test environment", () => {
  const result = validateProductionEnvironment({
    NODE_ENV: "production",
    BUILD_SHA: "bb04859",
    MINIAPP_BACKEND_HOST: "0.0.0.0",
    MINIAPP_DEV_LOGIN: "0",
    WECHAT_MINIAPP_APP_ID: "wx-production",
    WECHAT_MINIAPP_APP_SECRET: "wechat-secret",
    DATABASE_URL: "postgres://user:password@db.example/miniapp",
    DATABASE_SSL: "1",
    STORAGE_PROVIDER: "s3",
    STORAGE_ENDPOINT: "https://s3.example",
    STORAGE_BUCKET: "miniapp-assets",
    STORAGE_ACCESS_KEY_ID: "storage-access",
    STORAGE_SECRET_ACCESS_KEY: "storage-secret",
    MINIAPP_ASSET_SIGNING_SECRET: "asset-secret",
    MINIAPP_PUBLIC_ASSET_BASE_URL: "https://miniapp.example",
    MINIAPP_IMAGE_PROVIDER: "gptproto",
    GPTPROTO_API_KEY: "gptproto-secret",
    GENERATION_WORKER_MODE: "durable",
    PAYMENT_PROVIDER: "disabled",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.invalid, []);
});

test("rejects development login, mock payment, preview generation, and placeholder SHA", () => {
  const result = validateProductionEnvironment({
    NODE_ENV: "production",
    BUILD_SHA: "replace-with-source-commit-sha",
    MINIAPP_DEV_LOGIN: "1",
    MINIAPP_IMAGE_PROVIDER: "preview",
    PAYMENT_PROVIDER: "mock",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.invalid, [
    "BUILD_SHA",
    "MINIAPP_DEV_LOGIN",
    "MINIAPP_IMAGE_PROVIDER",
    "PAYMENT_PROVIDER",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret|password|api-key/i);
});
```

- [ ] **Step 2: Run the focused test and verify the missing module fails**

Run:

```bash
cd backend
node --test test/preflight.test.js
```

Expected: FAIL because `production-preflight.js` does not exist yet.

- [ ] **Step 3: Implement the pure validation function**

Implement `validateProductionEnvironment(env = process.env)` with these rules:

```text
NODE_ENV must be production/prod
BUILD_SHA must be non-empty and not "unknown" or "replace-with-source-commit-sha"
MINIAPP_DEV_LOGIN must be false
MINIAPP_BACKEND_HOST must be 0.0.0.0
MINIAPP_IMAGE_PROVIDER must be gptproto or openai
GENERATION_WORKER_MODE must be durable
MINIAPP_PUBLIC_ASSET_BASE_URL must be an https URL
PAYMENT_PROVIDER must be disabled
GPTPROTO_API_KEY is required for gptproto
OPENAI_IMAGE_API_KEY is required for openai
```

Reuse `loadConfig` for database, WeChat, storage, signing-secret, and provider
normalization. Convert configuration errors into key names only. Do not include
the input environment, URLs with credentials, or exception stack traces in the
returned object.

- [ ] **Step 4: Add the CLI entrypoint**

Implement `backend/scripts/preflight.js` so that it calls the pure validator,
prints one line per missing/invalid key, and exits with `0` only when `ok` is
true. The success output must be:

```text
PREFLIGHT_OK environment=production payment=disabled
```

Failure output must have the form `PREFLIGHT_FAILED missing=... invalid=...`
and must not print values. Add this package script:

```json
"preflight": "node scripts/preflight.js"
```

- [ ] **Step 5: Run focused tests and CLI checks**

Run:

```bash
cd backend
node --test test/preflight.test.js
NODE_ENV=production npm run preflight
```

Expected: unit tests pass; the empty-shell CLI exits non-zero and only names
missing/invalid keys.

- [ ] **Step 6: Commit the isolated task**

```bash
git add backend/src/services/production-preflight.js backend/scripts/preflight.js backend/test/preflight.test.js backend/package.json
git commit -m "feat: add production configuration preflight"
```

### Task 2: Add Replaceable Process-Local Rate Limiting

**Files:**
- Create: `backend/src/services/rate-limiter.js`
- Create: `backend/test/rate-limiter.test.js`
- Modify: `backend/src/app.js`
- Modify: `backend/test/server.test.js`

**Interfaces:**
- Consumes: `{ scope, key, limit, windowMs, now }`.
- Produces: `{ allowed, limit, remaining, resetAt }` and HTTP `429` responses with `code: "RATE_LIMITED"` and `Retry-After`.

- [ ] **Step 1: Write failing unit tests for the limiter boundary**

Test a fake clock and verify that the first `limit` calls are allowed, the next
call is rejected, and the window reset allows a new call:

```js
const limiter = createRateLimiter({ now: () => currentTime });
assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, true);
assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, true);
assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, false);
currentTime += 60001;
assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, true);
```

Also verify that scopes and keys do not share counters, invalid limits throw a
typed error, and expired buckets are removed during normal consumption.

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
cd backend
node --test test/rate-limiter.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the bounded limiter**

Implement `createRateLimiter({ now = Date.now, maxEntries = 10000 } = {})`.
Store only a `Map` entry containing `count` and `resetAt`; never store raw
tokens, openids, prompts, filenames, or image data. Evict expired entries on
each consume and evict the oldest reset time when `maxEntries` is exceeded.

- [ ] **Step 4: Add request identity and route policies**

In `backend/src/app.js`, add a `clientIp(request)` helper that takes the first
entry from `x-forwarded-for`, otherwise `request.headers.get("host")` only as a
last-resort stable local identity. Add a `rateLimitResponse(result)` helper and
allow `json(data, status, headers)` to merge `Retry-After` without changing
existing response bodies.

Create the following policies inside `createApp` unless an injected limiter is
provided:

```js
const rateLimits = {
  login: { limit: 10, windowMs: 60_000 },
  upload: { limit: 20, windowMs: 10 * 60_000 },
  generation: { limit: 10, windowMs: 10 * 60_000 },
  order: { limit: 10, windowMs: 60_000 },
  admin: { limit: 60, windowMs: 60_000 },
};
```

Apply them at these existing route points:

| Route group | Key |
| --- | --- |
| `POST /api/miniapp/auth/wechat-login` | `ip:<clientIp>` before code exchange |
| `POST /api/miniapp/uploads/reference-image` | `user:<user.id>` after auth, otherwise IP |
| generation submit and regenerate routes | `user:<user.id>` after auth |
| `POST /api/miniapp/orders` | `user:<user.id>` after auth |
| admin mutation routes | `admin:<user.id>` after `requireAdmin` |

When rejected, return `429` with `Retry-After` rounded up to seconds. Do not
alter successful response DTOs.

- [ ] **Step 5: Add HTTP regression tests**

Add tests that inject a limiter with `now` under test control, submit three
login requests with the login limit set to two, and assert the third response:

```js
assert.equal(response.status, 429);
assert.equal(body.error.code, "RATE_LIMITED");
assert.match(response.headers.get("retry-after"), /^\d+$/);
```

Add one protected-generation test proving the counter is keyed by the
authenticated user and does not block a second user. Keep existing tests with
the default limiter at limits high enough for their request count.

- [ ] **Step 6: Run focused and full backend tests**

```bash
cd backend
node --test test/rate-limiter.test.js test/server.test.js
npm test
```

Expected: all tests pass; the real PostgreSQL test may remain skipped only when
`DATABASE_URL_TEST` is unset.

- [ ] **Step 7: Commit the isolated task**

```bash
git add backend/src/services/rate-limiter.js backend/src/app.js backend/test/rate-limiter.test.js backend/test/server.test.js
git commit -m "feat: add miniapp request rate limits"
```

### Task 3: Make Health Diagnostics Release-Safe

**Files:**
- Modify: `backend/src/server.js`
- Modify: `backend/test/runtime.test.js`
- Modify: `backend/test/config.test.js`

**Interfaces:**
- Consumes: the existing runtime config and injected dependency readiness.
- Produces: non-secret `/health` data with `buildSha`, environment, dependency driver/mode, and HTTP `503` when unready.

- [ ] **Step 1: Add failing assertions for placeholder build identity and secrets**

Extend runtime tests to assert that a ready health response includes the exact
configured `BUILD_SHA`, and that the serialized response does not contain the
database URL, storage endpoint, bucket, AppSecret, API key, or signing secret.
Add a test that a placeholder SHA yields `503` with
`data.build.ready === false` and `data.build.reason === "BUILD_NOT_SET"` while
preserving the existing dependency readiness behavior.

- [ ] **Step 2: Implement the smallest health change**

Keep `healthData` in `backend/src/server.js`. Add a non-secret `build` object
with `{ ready, sha }`, where `sha` is the configured non-empty SHA or `null` and
`ready` is false for an empty value, `unknown`, or
`replace-with-source-commit-sha`. When it is false, set
`build.reason` to `"BUILD_NOT_SET"` and include the build state in `ok` so the
handler returns `503`. Do not add storage endpoints, database URLs, bucket
names, or provider payloads.

- [ ] **Step 3: Run runtime tests**

```bash
cd backend
node --test test/runtime.test.js test/config.test.js
```

Expected: ready fixtures return `200`; unready dependency or placeholder-build
fixtures return `503` without secret leakage.

- [ ] **Step 4: Commit the isolated task**

```bash
git add backend/src/server.js backend/test/runtime.test.js backend/test/config.test.js
git commit -m "feat: expose release-safe miniapp health diagnostics"
```

### Task 4: Add HTTPS Deployment Smoke Verification

**Files:**
- Create: `backend/src/services/deployment-smoke.js`
- Create: `backend/scripts/smoke-deployment.js`
- Create: `backend/test/deployment-smoke.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: a base URL and a fetch implementation.
- Produces: `runDeploymentSmoke({ baseUrl, fetchImpl, timeoutMs }) -> { ok, checks }` and CLI exit status.

- [ ] **Step 1: Write failing tests with a local fake HTTP server**

Use Node's `http.createServer` in `backend/test/deployment-smoke.test.js`.
Return controlled JSON for `/health`, `/api/miniapp/templates`,
`/api/miniapp/models`, `/api/miniapp/auth/me`, and `/api/miniapp/pricing`.
Cover:

```text
all checks pass;
HTTP and malformed URLs are rejected;
cross-host redirects are rejected;
health 503 fails the run;
placeholder build SHA fails the run;
empty templates or a non-GPT Image 2 default fails the run;
missing authentication returns a failure;
pricing with payment.available=true fails this payment-disabled smoke run;
timeouts fail with an endpoint name and no response-body dump.
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
cd backend
node --test test/deployment-smoke.test.js
```

Expected: FAIL because the smoke service does not exist.

- [ ] **Step 3: Implement bounded, HTTPS-only fetches**

Implement `runDeploymentSmoke` with these exact rules:

- accept only `https:` URLs;
- trim a trailing slash and reject credentials in the URL;
- use `redirect: "manual"` and reject a `3xx` response rather than following a
  redirect to another host;
- use `AbortSignal.timeout(timeoutMs)` with a default of `10000` ms;
- parse JSON only after a successful content-type check;
- return checks with `name`, `ok`, `status`, and a short `detail` string;
- never include raw response bodies in errors.

The CLI command is:

```bash
cd backend
npm run smoke -- https://your-miniapp-domain.example
```

Add:

```json
"smoke": "node scripts/smoke-deployment.js"
```

- [ ] **Step 4: Run the smoke tests**

```bash
cd backend
node --test test/deployment-smoke.test.js
```

Expected: all fake-server cases pass.

- [ ] **Step 5: Commit the isolated task**

```bash
git add backend/src/services/deployment-smoke.js backend/scripts/smoke-deployment.js backend/test/deployment-smoke.test.js backend/package.json
git commit -m "feat: add miniapp deployment smoke checks"
```

### Task 5: Align Operator Documentation And Staging Profile

**Files:**
- Modify: `backend/docs/zeabur-deploy.md`
- Modify: `backend/.env.zeabur.example`
- Modify: `backend/test/dockerfile.test.js`
- Modify: `backend/README.md`
- Modify: `app/README.md`

**Interfaces:**
- Consumes: the scripts and checks from Tasks 1-4.
- Produces: copy-pasteable deployment instructions for the payment-disabled internal-test profile.

- [ ] **Step 1: Add documentation contract assertions**

Extend `backend/test/dockerfile.test.js` to require these text markers:

```text
PREFLIGHT_OK
npm run preflight
npm run smoke --
PAYMENT_PROVIDER=disabled
COPY migrations ./migrations
```

Assert that the guide does not claim the PostgreSQL/S3 adapters are unwired and
does not instruct operators to use SQLite or mock payment for production.

- [ ] **Step 2: Rewrite the Zeabur guide for the current backend**

Document the exact service root `backend`, Docker context, `PORT`, migration
copy, PostgreSQL service, S3-compatible storage, `MINIAPP_DEV_LOGIN=0`,
`MINIAPP_IMAGE_PROVIDER=gptproto`, `GENERATION_WORKER_MODE=durable`, and
`PAYMENT_PROVIDER=disabled`. Add commands for `npm run preflight`, `/health`,
and `npm run smoke -- https://...`. State that AppSecret, storage credentials,
GPTProto key, and signing secret are private Zeabur variables.

- [ ] **Step 3: Update both README files**

Replace the stale static-only app description with the current native page list,
backend boundary, API origin configuration, validation command, and the rule
that local SQLite/preview/mock settings are development-only. Keep the existing
UI and template instructions.

- [ ] **Step 4: Make `.env.zeabur.example` internally consistent**

Keep all secret values as placeholders, set the profile to production, durable
worker, GPTProto, disabled payment, and a placeholder `BUILD_SHA` that the
preflight intentionally rejects until Zeabur injects the deployed commit SHA.
Do not add credentials to the file.

- [ ] **Step 5: Run documentation and all automated checks**

```bash
cd backend
npm test
cd ../app
npm run validate
cd ..
git diff --check
```

- [ ] **Step 6: Commit the documentation task**

```bash
git add backend/docs/zeabur-deploy.md backend/.env.zeabur.example backend/README.md app/README.md backend/test/dockerfile.test.js
git commit -m "docs: align miniapp internal deployment instructions"
```

### Task 6: Review, Push, And Handoff The First Slice

**Files:**
- Modify: no source files; inspect the complete diff and commit history.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: one pushed `miniapp-lemon` branch and a handoff with exact environment and external-test gates.

- [ ] **Step 1: Run the final verification commands**

```bash
cd backend
npm test
cd ../app
npm run validate
cd ..
git diff --check
git status --short --branch
```

Expected: backend tests have zero failures; the only permitted skip is the real
PostgreSQL integration test when `DATABASE_URL_TEST` is unset; app validation
passes; `git diff --check` is clean; the worktree has no uncommitted changes.

- [ ] **Step 2: Review the final diff for secret and scope violations**

Run:

```bash
git diff origin/miniapp-lemon...HEAD -- . ':!backend/data'
rg -n "(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]+ PRIVATE KEY|api[_-]?key\\s*[:=]\\s*[A-Za-z0-9_-]{12,})" --glob '!**/node_modules/**' --glob '!backend/.env*' .
```

Expected: no credential values and no web-application files outside the
standalone mini-app backend/app scope.

- [ ] **Step 3: Push the completed slice**

```bash
git push origin miniapp-lemon
```

- [ ] **Step 4: Handoff Part 2 prerequisites**

Record that the next slice requires the user to provide or provision:

```text
WECHAT_MINIAPP_APP_SECRET
DATABASE_URL and DATABASE_URL_TEST
S3-compatible endpoint, bucket, access key, secret, and public origin
GPTPROTO_API_KEY
Zeabur service/project access
```

Do not request WeChat Pay credentials until Part 4.
