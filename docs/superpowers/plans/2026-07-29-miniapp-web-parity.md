# Miniapp Web Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the WeChat mini-program close to the GitHub web app's user-facing generation workflow: searchable templates, generation history, reuse/regenerate, credit balance/history, and pricing/payment placeholders.

**Architecture:** Keep the native mini-program as the user UI and `miniapp-backend` as the BFF. The backend exposes mobile-friendly `/api/miniapp/*` endpoints backed by SQLite. The mini-program consumes those endpoints through small service modules and native pages; no React/Next code is copied directly into WXML.

**Tech Stack:** WeChat mini-program JavaScript/WXML/WXSS, Node.js built-in `node:test`, `node:sqlite`, standalone HTTP Fetch handler.

## Global Constraints

- Work on branch `lemonricebal`; do not switch to `main`.
- Keep provider/API secrets out of `ima-queencard-miniprogram/config/env.js`.
- Default generation model is GPT Image 2: client value `gpt-image-2-edit`, provider model `gpt-image-2`.
- Keep UI visually consistent with the current mini-program style: pink canvas, black 4rpx borders, 8px radius, lemon/pumpkin/seafoam accent blocks.
- The mini-program pages must stay native WXML/WXSS/JS, not web-view.
- For this pass, admin, Stripe, Creem, and web email auth are not copied into the user mini-program. Pricing/order pages may show WeChat Pay placeholders only.
- Every backend endpoint must be covered by `npm --prefix miniapp-backend test`.
- Every mini-program page/service added must be covered by `npm --prefix ima-queencard-miniprogram run validate`.

---

### Task 1: Backend Web-Parity Generation APIs

**Files:**
- Modify: `miniapp-backend/src/store.js`
- Modify: `miniapp-backend/src/app.js`
- Modify: `miniapp-backend/test/store.test.js`
- Modify: `miniapp-backend/test/server.test.js`
- Modify: `miniapp-backend/README.md`

**Interfaces:**
- Produces `store.listTasks(ownerId, options)` returning `{ records, pagination }`.
- Produces `store.listCreditTransactions(userId, options)` returning `{ records, pagination }`.
- Produces `GET /api/miniapp/image-generations?page&limit&q&status`.
- Produces `POST /api/miniapp/image-generations/estimate`.
- Produces `POST /api/miniapp/image-generations/:taskId/regenerate`.
- Extends task rows with enough request metadata to support reuse: prompt, topic, referenceImages, model, outputCount, aspectRatio, resolution.

- [ ] **Step 1: Write failing backend tests**

Add tests asserting:

```js
// server.test.js
// 1. create a task, wait for completion, GET /api/miniapp/image-generations returns it.
// 2. q filters by prompt/model/template id.
// 3. POST /api/miniapp/image-generations/estimate returns requestedCredits/model/outputCount.
// 4. POST /api/miniapp/image-generations/:taskId/regenerate creates a new pending task with the original prompt/reference/model.
// 5. GET /api/miniapp/credit/history returns transactions and pagination.
```

Add store tests asserting SQLite persists and filters `listTasks`.

- [ ] **Step 2: Run red tests**

Run:

```bash
npm --prefix miniapp-backend test
```

Expected: FAIL because the APIs and store methods do not exist yet.

- [ ] **Step 3: Implement store metadata and list methods**

Add columns through idempotent migration:

```sql
ALTER TABLE generation_tasks ADD COLUMN prompt TEXT;
ALTER TABLE generation_tasks ADD COLUMN topic TEXT;
ALTER TABLE generation_tasks ADD COLUMN reference_images_json TEXT;
ALTER TABLE generation_tasks ADD COLUMN model TEXT;
ALTER TABLE generation_tasks ADD COLUMN output_count INTEGER;
ALTER TABLE generation_tasks ADD COLUMN aspect_ratio TEXT;
ALTER TABLE generation_tasks ADD COLUMN resolution TEXT;
```

Implement equivalent fields in memory store. `rowToTask` must expose the new fields.

- [ ] **Step 4: Implement API routes**

Add routes before `/:taskId` matching:

```text
GET /api/miniapp/image-generations
POST /api/miniapp/image-generations/estimate
POST /api/miniapp/image-generations/:taskId/regenerate
GET /api/miniapp/credit/history
```

Use a simple credit estimate: `requestedCredits = outputCount * 1` for this standalone backend.

- [ ] **Step 5: Verify**

Run:

```bash
npm --prefix miniapp-backend test
```

Expected: all tests pass.

### Task 2: Miniapp API Services and Result Reuse

**Files:**
- Modify: `ima-queencard-miniprogram/services/api.js`
- Create: `ima-queencard-miniprogram/services/generation.js`
- Create: `ima-queencard-miniprogram/services/credits.js`
- Modify: `ima-queencard-miniprogram/pages/result/index.js`
- Modify: `ima-queencard-miniprogram/pages/result/index.wxml`
- Modify: `ima-queencard-miniprogram/pages/result/index.wxss`

**Interfaces:**
- Consumes Task 1 backend endpoints.
- Produces `generation.listTasks`, `generation.estimate`, `generation.regenerateTask`, `generation.buildGenerateUrlFromTask`.
- Produces `credits.getBalance`, `credits.getHistory`.
- Result page shows "我的作品", "用这张继续生成", and "重新生成同款".

- [ ] **Step 1: Write failing mini-program validation**

Extend `tools/validate.js` so it requires `services/generation.js`, `services/credits.js`, and result-page action handlers `openHistory`, `reuseImage`, `regenerateTask`.

- [ ] **Step 2: Run red validation**

Run:

```bash
npm --prefix ima-queencard-miniprogram run validate
```

Expected: FAIL because files/handlers are missing.

- [ ] **Step 3: Implement service wrappers**

Add API wrappers for the new backend endpoints. Keep all request calls through `services/api.js`.

- [ ] **Step 4: Extend result page**

Normalize task metadata and add buttons:

```text
我的作品 -> /pages/history/index
重新生成同款 -> POST regenerate, navigate to result with new taskId
用这张继续生成 -> /pages/generate/index?referenceImage=<url>&prompt=<task prompt>&sourceTaskId=<taskId>
```

- [ ] **Step 5: Verify**

Run:

```bash
npm --prefix ima-queencard-miniprogram run validate
```

Expected: validation passes.

### Task 3: Miniapp History Page

**Files:**
- Create: `ima-queencard-miniprogram/pages/history/index.js`
- Create: `ima-queencard-miniprogram/pages/history/index.json`
- Create: `ima-queencard-miniprogram/pages/history/index.wxml`
- Create: `ima-queencard-miniprogram/pages/history/index.wxss`
- Modify: `ima-queencard-miniprogram/app.json`
- Modify: `ima-queencard-miniprogram/pages/index/index.js`
- Modify: `ima-queencard-miniprogram/pages/index/index.wxml`
- Modify: `ima-queencard-miniprogram/tools/validate.js`

**Interfaces:**
- Consumes `generation.listTasks` from Task 2.
- Produces a searchable, paginated "我的作品" page.

- [ ] **Step 1: Write failing validation**

Require `pages/history/index.*` in `tools/validate.js` and require `app.json` to include `pages/history/index`.

- [ ] **Step 2: Run red validation**

Run:

```bash
npm --prefix ima-queencard-miniprogram run validate
```

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement page**

The page must support:

```text
search input
pull-to-refresh
infinite pagination
empty state
task status badge
tap record -> /pages/result/index?taskId=...
reuse first image -> /pages/generate/index?referenceImage=...
```

- [ ] **Step 4: Add entry points**

Add "我的作品" button on landing and result pages.

- [ ] **Step 5: Verify**

Run:

```bash
npm --prefix ima-queencard-miniprogram run validate
```

Expected: validation passes.

### Task 4: Miniapp Credits and Pricing Pages

**Files:**
- Create: `ima-queencard-miniprogram/pages/credits/index.js`
- Create: `ima-queencard-miniprogram/pages/credits/index.json`
- Create: `ima-queencard-miniprogram/pages/credits/index.wxml`
- Create: `ima-queencard-miniprogram/pages/credits/index.wxss`
- Create: `ima-queencard-miniprogram/pages/pricing/index.js`
- Create: `ima-queencard-miniprogram/pages/pricing/index.json`
- Create: `ima-queencard-miniprogram/pages/pricing/index.wxml`
- Create: `ima-queencard-miniprogram/pages/pricing/index.wxss`
- Modify: `ima-queencard-miniprogram/app.json`
- Modify: `ima-queencard-miniprogram/pages/generate/index.js`
- Modify: `ima-queencard-miniprogram/pages/generate/index.wxml`
- Modify: `ima-queencard-miniprogram/tools/validate.js`

**Interfaces:**
- Consumes `credits.getBalance`, `credits.getHistory`, and `generation.estimate`.
- Produces balance/history UI and a WeChat Pay placeholder pricing UI.

- [ ] **Step 1: Write failing validation**

Require credits/pricing page files and app routes.

- [ ] **Step 2: Implement credits page**

Display balance, credit history, login state, and "购买积分" link.

- [ ] **Step 3: Implement pricing page**

Display three static credit packs and disabled/placeholder WeChat Pay button text: "微信支付接入中".

- [ ] **Step 4: Extend generate page estimate**

When prompt/reference/model/count changes, call `generation.estimate` after login/API ready and display estimated credits. If estimate fails, show "预计消耗以提交后为准".

- [ ] **Step 5: Verify**

Run:

```bash
npm --prefix ima-queencard-miniprogram run validate
```

Expected: validation passes.

### Task 5: Template Library Enhancements and Final Integration

**Files:**
- Modify: `ima-queencard-miniprogram/pages/index/index.js`
- Modify: `ima-queencard-miniprogram/pages/index/index.wxml`
- Modify: `ima-queencard-miniprogram/pages/index/index.wxss`
- Modify: `ima-queencard-miniprogram/services/templates.js`
- Modify: `ima-queencard-miniprogram/tools/validate.js`
- Modify: `miniapp-backend/src/store.js`
- Modify: `miniapp-backend/test/templates.test.js`

**Interfaces:**
- Consumes backend template query support.
- Produces template search, category filter, and sort controls on the landing page.

- [ ] **Step 1: Add validation**

Validation must require visible search/filter hooks: `onTemplateSearchInput`, `selectTemplateCategory`, and `selectTemplateSort`.

- [ ] **Step 2: Implement template controls**

Add:

```text
search by q
category chips
sort: newest, hot, default
refresh resets pagination with current filters
```

Backend may treat sort as best-effort: default/newest by updated time, hot by metrics when available or fallback updated time.

- [ ] **Step 3: Final verification**

Run:

```bash
npm --prefix miniapp-backend test
npm --prefix ima-queencard-miniprogram run validate
git diff --check
```

Expected: all pass.
