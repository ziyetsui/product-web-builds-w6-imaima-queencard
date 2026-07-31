# Full Miniapp Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full WeChat Mini Program user product with a dynamic template feed, one-click image generation, local image saving, unified bovideo/Ancher account, credits, history, pricing, and WeChat payment.

**Architecture:** Add a `/api/miniapp/*` adapter layer that uses GitHub queencard as the full product/content/UX scope and prefers bovideo/Ancher upstream APIs for production auth, diamonds, payment, deployed API bridging, and account continuity. Expand the native WeChat Mini Program into a template-first product first, then complete the remaining GitHub queencard product modules; secrets, database access, model providers, and payment callbacks stay server-side.

**Tech Stack:** WeChat Mini Program native WXML/WXSS/JS, Next.js App Router, TypeScript, bovideo `/api/ancher/*` proxy/upstream APIs, optional Drizzle/PostgreSQL template cache, Vitest, WeChat login `code2Session`, WeChat Pay JSAPI.

**Priority Revision:** The first working slice is now template-first and bovideo-synchronized. Users should scroll a dynamically loaded template feed, tap "生成同款", generate the matching image, save it to the phone album, and manually upload it to Xiaohongshu. Account, credits, and payment should follow bovideo/Ancher flows. This changes priority only; the full GitHub queencard product content and workflows remain in scope.

## Global Constraints

- Backend root: `/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend`
- Bovideo root: `/Users/a2/Desktop/ancherexplainfrontend`
- Miniapp root: `/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app`
- Do not store database URLs, provider API keys, WeChat AppSecret, merchant keys, object-storage secrets, or internal credentials in the mini program.
- API URLs are public; every `/api/miniapp/*` route must authenticate, authorize, validate, and verify ownership server-side.
- Reuse existing backend tables and services where possible: `user`, `Customer`, `credit_packages`, `credit_holds`, `credit_transactions`, `payment_fulfillments`, `generation_tasks`, `generated_assets`.
- Add only miniapp-specific persistence: WeChat bindings, miniapp sessions, miniapp orders, optional binding codes.
- Stripe and Creem remain web payment providers. Miniapp purchases use WeChat payment.
- Admin features remain web-only.
- Prompt/case library data must be paged from backend; do not bundle the full `frontend/public/xhs-cases` library into the miniapp package.
- Miniapp UI keeps the current palette and style: pale pink base, black 4rpx borders, 8px max radius, lemon/pumpkin/seafoam/lavender accents.
- Payment implementation is production-gated on WeChat merchant account, AppID association, category eligibility, domain configuration, privacy policy, user agreement, and refund/support copy.
- Template data must be dynamic. Do not put all 1000+ templates into the miniapp package; use backend pagination, CDN thumbnails, and optional database-backed sync jobs.
- Prefer bovideo/Ancher APIs for production account, diamonds, payment, deployed API bridge, reference upload, and account continuity; keep the full GitHub queencard product content, template generation flow, and user-facing modules in scope.
- Use GitHub queencard's `templateId + prompt + referenceImages + sourceCase*` flow as the miniapp generation seed model.
- During miniapp UI review, use visual inspection with WeChat Developer Tools screenshots for home feed, template generate, result/save, pricing, credits, and account pages.

## Revised Execution Order

The detailed tasks below remain useful, but execution should start with these template-first slices:

1. **Template API Adapter:** expose `/api/miniapp/templates`, `/api/miniapp/templates/:id`, and `/api/miniapp/templates/:id/generate`. Source data from bovideo `/api/templates` first, with a normalized database table only if upstream pagination/search is not enough.
2. **Dynamic Miniapp Feed:** replace the static-first home with an infinite-scroll template feed. Each card must show thumbnail, title, category, source, estimated use case, and a clear "生成同款" button.
3. **One-Click Template Generation:** clicking a template builds a GitHub-style seed (`templateId`, `prompt`, `referenceImages`, `sourceCaseId`, `sourceCaseCategory`, `sourceNoteUrl`, `sourceAuthorUrl`) or a bovideo template execution payload, then creates a task.
4. **Result Save Flow:** result page polls task state, previews images, and calls `wx.saveImageToPhotosAlbum`. The success state should tell the user the image is ready for manual Xiaohongshu upload.
5. **Bovideo Account/Credits/Payment:** after the template-to-result loop works, add WeChat login to Ancher account binding, diamonds balance/history, payment catalog/orders, and WeChat Pay.

This revised order supersedes the older backend-schema-first sequence where there is a conflict. It does not remove any GitHub queencard scope; it only moves the template feed and one-click generation loop to the front.

---

## File Structure

### Backend Files To Create

- `frontend/src/miniapp/config.ts`: miniapp env access, feature flags, token lifetime, WeChat endpoints.
- `frontend/src/miniapp/types.ts`: shared miniapp response, user, task, order, pricing, and config types.
- `frontend/src/miniapp/token.ts`: token generation, hashing, expiration helpers.
- `frontend/src/miniapp/wechat-auth.ts`: `code2Session` client.
- `frontend/src/miniapp/auth.ts`: miniapp bearer-token auth middleware and current-user resolver.
- `frontend/src/miniapp/session-service.ts`: create/revoke miniapp sessions.
- `frontend/src/miniapp/binding-service.ts`: openid/unionid binding and web binding-code service.
- `frontend/src/miniapp/response.ts`: miniapp response normalizers.
- `frontend/src/miniapp/upload-service.ts`: upload validation and storage abstraction.
- `frontend/src/miniapp/wechat-pay.ts`: WeChat Pay signing, prepay, notify parsing.
- `frontend/src/miniapp/order-service.ts`: miniapp order lifecycle and fulfillment.
- `frontend/src/app/api/miniapp/config/route.ts`
- `frontend/src/app/api/miniapp/auth/wechat-login/route.ts`
- `frontend/src/app/api/miniapp/auth/me/route.ts`
- `frontend/src/app/api/miniapp/auth/logout/route.ts`
- `frontend/src/app/api/miniapp/auth/bind-code/route.ts`
- `frontend/src/app/api/miniapp/credit/balance/route.ts`
- `frontend/src/app/api/miniapp/credit/history/route.ts`
- `frontend/src/app/api/miniapp/uploads/reference-image/route.ts`
- `frontend/src/app/api/miniapp/image-generations/estimate/route.ts`
- `frontend/src/app/api/miniapp/image-generations/route.ts`
- `frontend/src/app/api/miniapp/image-generations/[taskId]/route.ts`
- `frontend/src/app/api/miniapp/image-generations/[taskId]/regenerate/route.ts`
- `frontend/src/app/api/miniapp/image-assets/[assetId]/download/route.ts`
- `frontend/src/app/api/miniapp/prompt-cases/route.ts`
- `frontend/src/app/api/miniapp/pricing/route.ts`
- `frontend/src/app/api/miniapp/orders/route.ts`
- `frontend/src/app/api/miniapp/orders/[orderId]/route.ts`
- `frontend/src/app/api/miniapp/payments/wechat/notify/route.ts`

### Backend Files To Modify

- `frontend/src/env.mjs`: add miniapp and WeChat Pay server env schema.
- `frontend/src/db/schema.ts`: add `wechat_openid_bindings`, `miniapp_sessions`, `miniapp_orders`, optional `account_binding_codes`.
- `frontend/src/services/image-generation.ts`: expand `ImageGenerationSource` to include `wechat-miniapp`.
- `frontend/src/services/payment-fulfillment.ts`: confirm generic provider fields work with `provider: "wechatpay"`; add tests if behavior is not already covered.
- `frontend/src/config/pricing-products.ts`: expose miniapp-eligible credit packs and keep subscriptions feature-flagged.
- `frontend/src/app/api/v1/image-generations/route.test.ts`: use as pattern for miniapp route tests.
- `frontend/src/test/setup.ts`: add crypto/env test helpers only if tests need them.

### Backend Tests To Create

- `frontend/src/miniapp/token.test.ts`
- `frontend/src/miniapp/auth.test.ts`
- `frontend/src/miniapp/wechat-auth.test.ts`
- `frontend/src/miniapp/binding-service.test.ts`
- `frontend/src/miniapp/response.test.ts`
- `frontend/src/miniapp/order-service.test.ts`
- `frontend/src/miniapp/wechat-pay.test.ts`
- `frontend/src/app/api/miniapp/auth/wechat-login/route.test.ts`
- `frontend/src/app/api/miniapp/image-generations/route.test.ts`
- `frontend/src/app/api/miniapp/pricing/route.test.ts`
- `frontend/src/app/api/miniapp/orders/route.test.ts`
- `frontend/src/app/api/miniapp/payments/wechat/notify/route.test.ts`

### Miniapp Files To Create

- `config/routes.js`: route constants.
- `data/models.js`: miniapp model labels and defaults derived from backend-compatible ids.
- `services/config.js`: fetch and cache backend feature flags.
- `services/credits.js`: credit balance/history client.
- `services/generation.js`: upload, estimate, task create/list/detail/regenerate client.
- `services/orders.js`: pricing/order/payment client.
- `services/promptCases.js`: prompt/case library client.
- `utils/format.js`: date, credit, price, and status formatting helpers.
- `utils/request-state.js`: shared loading/error state helpers.
- `pages/history/index.{js,json,wxml,wxss}`
- `pages/prompts/index.{js,json,wxml,wxss}`
- `pages/account/index.{js,json,wxml,wxss}`
- `pages/credits/index.{js,json,wxml,wxss}`
- `pages/pricing/index.{js,json,wxml,wxss}`
- `pages/orders/index.{js,json,wxml,wxss}`
- `pages/bind/index.{js,json,wxml,wxss}`
- `pages/legal/privacy.{js,json,wxml,wxss}`
- `pages/legal/terms.{js,json,wxml,wxss}`

### Miniapp Files To Modify

- `app.json`: register new pages and tab/navigation if chosen.
- `app.js`: initialize config/session refresh.
- `config/env.js`: production/staging API base and request flags.
- `services/api.js`: add endpoints, query serialization, status handling.
- `services/auth.js`: add `me`, `logout`, `bindCode`, session refresh.
- `services/session.js`: track token expiry and clear invalid sessions.
- `pages/index/index.{js,wxml,wxss}`: add real navigation.
- `pages/generate/index.{js,wxml,wxss}`: connect credits, estimate, feature flags.
- `pages/result/index.{js,wxml,wxss}`: connect task detail, regenerate, reuse image.
- `tools/validate.js`: validate new pages, no secret strings, API config shape.
- `README.md`: document local compile and staging backend config.

---

### Task 1: Backend Miniapp Schema And Environment

**Files:**
- Modify: `frontend/src/env.mjs`
- Modify: `frontend/src/db/schema.ts`
- Create: `frontend/src/miniapp/config.ts`
- Create: `frontend/src/miniapp/types.ts`
- Create: `frontend/src/miniapp/token.ts`
- Test: `frontend/src/miniapp/token.test.ts`

**Interfaces:**
- Produces: `miniappConfig`, `MiniappFeatureFlags`, `createMiniappToken()`, `hashMiniappToken(token: string)`, `miniappTokenExpiresAt(now?: Date): Date`
- Consumes: Drizzle schema exports from `frontend/src/db/schema.ts`

- [ ] **Step 1: Write failing token tests**

```ts
import { describe, expect, it } from "vitest";

import {
  createMiniappToken,
  hashMiniappToken,
  miniappTokenExpiresAt,
} from "./token";

describe("miniapp token helpers", () => {
  it("creates non-empty bearer tokens and stable hashes", async () => {
    const token = createMiniappToken();

    expect(token.length).toBeGreaterThan(32);
    await expect(hashMiniappToken(token)).resolves.toBe(
      await hashMiniappToken(token)
    );
  });

  it("expires sessions in thirty days by default", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");

    expect(miniappTokenExpiresAt(now).toISOString()).toBe(
      "2026-08-26T00:00:00.000Z"
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/token.test.ts
```

Expected: FAIL because `src/miniapp/token.ts` does not exist.

- [ ] **Step 3: Add schema definitions**

Add to `frontend/src/db/schema.ts`:

```ts
export const wechatOpenidBindings = pgTable(
  "wechat_openid_bindings",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    appid: text("appid").notNull(),
    openid: text("openid").notNull(),
    unionid: text("unionid"),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    appOpenidIdx: uniqueIndex("wechat_openid_bindings_app_openid_idx").on(
      table.appid,
      table.openid
    ),
    appUnionidIdx: uniqueIndex("wechat_openid_bindings_app_unionid_idx").on(
      table.appid,
      table.unionid
    ),
    userIdIdx: index("wechat_openid_bindings_user_id_idx").on(table.userId),
  })
);

export const miniappSessions = pgTable(
  "miniapp_sessions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    appid: text("appid").notNull(),
    openid: text("openid").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("miniapp_sessions_token_hash_idx").on(
      table.tokenHash
    ),
    userIdIdx: index("miniapp_sessions_user_id_idx").on(table.userId),
    openidIdx: index("miniapp_sessions_app_openid_idx").on(
      table.appid,
      table.openid
    ),
  })
);

export const miniappOrders = pgTable(
  "miniapp_orders",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(),
    productKey: text("product_key").notNull(),
    provider: text("provider").default("wechatpay").notNull(),
    merchantOrderNo: text("merchant_order_no").notNull().unique(),
    prepayId: text("prepay_id"),
    amountCny: integer("amount_cny").notNull(),
    credits: integer("credits").notNull(),
    status: text("status").notNull(),
    paidAt: timestamp("paid_at"),
    fulfilledAt: timestamp("fulfilled_at"),
    closedAt: timestamp("closed_at"),
    providerTransactionId: text("provider_transaction_id"),
    providerPayload: jsonb("provider_payload"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("miniapp_orders_user_status_idx").on(
      table.userId,
      table.status
    ),
    merchantOrderNoIdx: uniqueIndex("miniapp_orders_merchant_order_no_idx").on(
      table.merchantOrderNo
    ),
  })
);
```

- [ ] **Step 4: Add env schema**

Add server env keys in `frontend/src/env.mjs`:

```ts
MINIAPP_APP_ID: z.string().optional(),
MINIAPP_APP_SECRET: z.string().optional(),
MINIAPP_SESSION_DAYS: z.coerce.number().int().positive().optional(),
MINIAPP_FEATURE_AUTH: z.enum(["on", "off"]).optional(),
MINIAPP_FEATURE_GENERATION: z.enum(["on", "off"]).optional(),
MINIAPP_FEATURE_PRICING: z.enum(["on", "off"]).optional(),
MINIAPP_FEATURE_PAYMENT: z.enum(["on", "off"]).optional(),
MINIAPP_FEATURE_PROMPT_LIBRARY: z.enum(["on", "off"]).optional(),
WECHAT_PAY_MCH_ID: z.string().optional(),
WECHAT_PAY_API_V3_KEY: z.string().optional(),
WECHAT_PAY_PRIVATE_KEY: z.string().optional(),
WECHAT_PAY_CERT_SERIAL_NO: z.string().optional(),
WECHAT_PAY_NOTIFY_URL: z.string().url().optional(),
```

Also add matching `runtimeEnv` mappings using `.trim()`.

- [ ] **Step 5: Add miniapp config and types**

Create `frontend/src/miniapp/types.ts`:

```ts
export interface MiniappFeatureFlags {
  auth: boolean;
  generation: boolean;
  pricing: boolean;
  payment: boolean;
  promptLibrary: boolean;
  subscriptions: boolean;
}

export interface MiniappUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  credits: number;
  wechatBound: boolean;
}

export interface MiniappSessionContext {
  token: string;
  sessionId: string;
  userId: string;
  appid: string;
  openid: string;
}
```

Create `frontend/src/miniapp/config.ts`:

```ts
import { env } from "@/env.mjs";
import type { MiniappFeatureFlags } from "./types";

function enabled(value: string | undefined, fallback = true) {
  if (value === "off") return false;
  if (value === "on") return true;
  return fallback;
}

export const miniappConfig = {
  appId: env.MINIAPP_APP_ID ?? "",
  appSecret: env.MINIAPP_APP_SECRET ?? "",
  sessionDays: env.MINIAPP_SESSION_DAYS ?? 30,
  wechatCode2SessionUrl: "https://api.weixin.qq.com/sns/jscode2session",
};

export function getMiniappFeatureFlags(): MiniappFeatureFlags {
  return {
    auth: enabled(env.MINIAPP_FEATURE_AUTH),
    generation: enabled(env.MINIAPP_FEATURE_GENERATION),
    pricing: enabled(env.MINIAPP_FEATURE_PRICING),
    payment: enabled(env.MINIAPP_FEATURE_PAYMENT, false),
    promptLibrary: enabled(env.MINIAPP_FEATURE_PROMPT_LIBRARY),
    subscriptions: false,
  };
}
```

- [ ] **Step 6: Add token helpers**

Create `frontend/src/miniapp/token.ts`:

```ts
import crypto from "node:crypto";

import { miniappConfig } from "./config";

export function createMiniappToken() {
  return `mini_${crypto.randomBytes(32).toString("base64url")}`;
}

export async function hashMiniappToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function miniappTokenExpiresAt(now = new Date()) {
  return new Date(
    now.getTime() + miniappConfig.sessionDays * 24 * 60 * 60 * 1000
  );
}
```

- [ ] **Step 7: Run tests and generate migration**

Run:

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/token.test.ts
pnpm db:generate
```

Expected: token tests PASS and a new Drizzle migration is generated.

- [ ] **Step 8: Commit**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
git add src/env.mjs src/db/schema.ts src/miniapp/config.ts src/miniapp/types.ts src/miniapp/token.ts src/miniapp/token.test.ts src/db/migrations
git commit -m "feat: add miniapp schema and config"
```

---

### Task 2: Backend Miniapp Auth And WeChat Login

**Files:**
- Create: `frontend/src/miniapp/wechat-auth.ts`
- Create: `frontend/src/miniapp/session-service.ts`
- Create: `frontend/src/miniapp/binding-service.ts`
- Create: `frontend/src/miniapp/auth.ts`
- Create: `frontend/src/app/api/miniapp/auth/wechat-login/route.ts`
- Create: `frontend/src/app/api/miniapp/auth/me/route.ts`
- Create: `frontend/src/app/api/miniapp/auth/logout/route.ts`
- Create: `frontend/src/app/api/miniapp/auth/bind-code/route.ts`
- Test: `frontend/src/miniapp/wechat-auth.test.ts`
- Test: `frontend/src/miniapp/binding-service.test.ts`
- Test: `frontend/src/miniapp/auth.test.ts`
- Test: `frontend/src/app/api/miniapp/auth/wechat-login/route.test.ts`

**Interfaces:**
- Consumes: `miniappConfig`, `createMiniappToken`, `hashMiniappToken`, `wechatOpenidBindings`, `miniappSessions`, `users`
- Produces: `exchangeWechatCode(code: string)`, `findOrCreateMiniappUser(identity)`, `createMiniappSession(input)`, `requireMiniappUser(request)`

- [ ] **Step 1: Write failing WeChat auth test**

```ts
import { describe, expect, it, vi } from "vitest";

import { exchangeWechatCode } from "./wechat-auth";

describe("exchangeWechatCode", () => {
  it("returns appid, openid, and unionid from code2Session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ openid: "openid_1", unionid: "union_1" }),
      })
    );

    await expect(exchangeWechatCode("code_1")).resolves.toMatchObject({
      openid: "openid_1",
      unionid: "union_1",
    });
  });

  it("throws on WeChat errcode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      })
    );

    await expect(exchangeWechatCode("bad")).rejects.toThrow("invalid code");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/wechat-auth.test.ts
```

Expected: FAIL because `exchangeWechatCode` does not exist.

- [ ] **Step 3: Implement WeChat code exchange**

Create `frontend/src/miniapp/wechat-auth.ts`:

```ts
import { ApiError } from "@/lib/api/error";
import { miniappConfig } from "./config";

export interface WechatIdentity {
  appid: string;
  openid: string;
  unionid: string | null;
  sessionKey?: string;
}

export async function exchangeWechatCode(code: string): Promise<WechatIdentity> {
  if (!miniappConfig.appId || !miniappConfig.appSecret) {
    throw new ApiError("Miniapp WeChat credentials are not configured", 503);
  }

  const url = new URL(miniappConfig.wechatCode2SessionUrl);
  url.searchParams.set("appid", miniappConfig.appId);
  url.searchParams.set("secret", miniappConfig.appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  const payload = (await response.json()) as {
    openid?: string;
    unionid?: string;
    session_key?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!response.ok || payload.errcode) {
    throw new ApiError(payload.errmsg || "WeChat login failed", 401, {
      errcode: payload.errcode,
    });
  }

  if (!payload.openid) {
    throw new ApiError("WeChat login did not return openid", 401);
  }

  return {
    appid: miniappConfig.appId,
    openid: payload.openid,
    unionid: payload.unionid ?? null,
    sessionKey: payload.session_key,
  };
}
```

- [ ] **Step 4: Write binding/session service tests**

Mock `db` like existing route tests. Required cases:

```ts
it("returns existing user id for an existing appid/openid binding", async () => {
  await expect(
    findBoundUserId({ appid: "wx_app", openid: "open_1", unionid: null })
  ).resolves.toBe("user_1");
});

it("creates a miniapp token and stores only token hash", async () => {
  const result = await createMiniappSession({
    userId: "user_1",
    appid: "wx_app",
    openid: "open_1",
  });

  expect(result.token.startsWith("mini_")).toBe(true);
  expect(insertedSession.tokenHash).not.toBe(result.token);
});
```

- [ ] **Step 5: Implement binding and session services**

Create `frontend/src/miniapp/binding-service.ts` with:

```ts
export async function findBoundUserId(identity: WechatIdentity) {
  // Select by appid + openid first. If no match and unionid exists, select by
  // appid + unionid. Return string user id or null.
}

export async function bindWechatToUser(identity: WechatIdentity, userId: string) {
  // Insert binding with appid/openid/unionid/userId and on conflict return the
  // existing binding's userId.
}

export async function findOrCreateMiniappUser(identity: WechatIdentity) {
  // If binding exists, return linked user id.
  // If no binding exists, create a backend user with email
  // `wx_${openid}@miniapp.local`, name `微信用户`, then bind openid.
}
```

Create `frontend/src/miniapp/session-service.ts` with:

```ts
export async function createMiniappSession(input: {
  userId: string;
  appid: string;
  openid: string;
}) {
  const token = createMiniappToken();
  const tokenHash = await hashMiniappToken(token);
  const expiresAt = miniappTokenExpiresAt();
  // Insert miniappSessions row and return token plus expiresAt.
}

export async function revokeMiniappSession(token: string) {
  const tokenHash = await hashMiniappToken(token);
  // Set revokedAt and updatedAt on matching active session.
}
```

- [ ] **Step 6: Implement bearer auth**

Create `frontend/src/miniapp/auth.ts`:

```ts
import { and, eq, gt, isNull } from "drizzle-orm";

import { db, miniappSessions, users } from "@/db";
import { ApiError } from "@/lib/api/error";
import { hashMiniappToken } from "./token";

export function getMiniappBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function requireMiniappUser(request: Request) {
  const token = getMiniappBearerToken(request);
  if (!token) throw new ApiError("Unauthorized", 401);

  const tokenHash = await hashMiniappToken(token);
  const [row] = await db
    .select({
      sessionId: miniappSessions.id,
      userId: miniappSessions.userId,
      appid: miniappSessions.appid,
      openid: miniappSessions.openid,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(miniappSessions)
    .innerJoin(users, eq(users.id, miniappSessions.userId))
    .where(
      and(
        eq(miniappSessions.tokenHash, tokenHash),
        gt(miniappSessions.expiresAt, new Date()),
        isNull(miniappSessions.revokedAt)
      )
    )
    .limit(1);

  if (!row) throw new ApiError("Unauthorized", 401);
  return row;
}
```

- [ ] **Step 7: Implement auth routes**

`frontend/src/app/api/miniapp/auth/wechat-login/route.ts`:

```ts
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { creditService } from "@/services/credit";
import { exchangeWechatCode } from "@/miniapp/wechat-auth";
import { findOrCreateMiniappUser } from "@/miniapp/binding-service";
import { createMiniappSession } from "@/miniapp/session-service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) throw new Error("WeChat login code is required");

    const identity = await exchangeWechatCode(code);
    const user = await findOrCreateMiniappUser(identity);
    const session = await createMiniappSession({
      userId: user.id,
      appid: identity.appid,
      openid: identity.openid,
    });
    const credits = await creditService.getBalance(user.id);

    return apiSuccess({
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        credits,
        wechatBound: true,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
```

Use `ApiError` instead of plain `Error` when implementing so missing code returns 400.

- [ ] **Step 8: Run auth tests**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/wechat-auth.test.ts src/miniapp/binding-service.test.ts src/miniapp/auth.test.ts src/app/api/miniapp/auth/wechat-login/route.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/miniapp src/app/api/miniapp/auth
git commit -m "feat: add miniapp wechat auth"
```

---

### Task 3: Backend Config, User, And Credit Routes

**Files:**
- Create: `frontend/src/app/api/miniapp/config/route.ts`
- Create: `frontend/src/app/api/miniapp/credit/balance/route.ts`
- Create: `frontend/src/app/api/miniapp/credit/history/route.ts`
- Modify: `frontend/src/app/api/miniapp/auth/me/route.ts`
- Test: `frontend/src/app/api/miniapp/credit/balance/route.test.ts`
- Test: `frontend/src/app/api/miniapp/credit/history/route.test.ts`

**Interfaces:**
- Consumes: `requireMiniappUser(request)`, `getMiniappFeatureFlags()`, `creditService.getBalance`, `creditService.getHistory`
- Produces: Miniapp config, current user, balance, and paginated credit history API.

- [ ] **Step 1: Write failing balance route test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/miniapp/auth", () => ({
  requireMiniappUser: vi.fn().mockResolvedValue({ userId: "user_1" }),
}));

vi.mock("@/services/credit", () => ({
  creditService: {
    getBalance: vi.fn().mockResolvedValue(600),
  },
}));

import { GET } from "./route";

describe("GET /api/miniapp/credit/balance", () => {
  it("returns authenticated user's balance", async () => {
    const response = await GET(
      new Request("http://localhost/api/miniapp/credit/balance", {
        headers: { authorization: "Bearer mini_token" },
      })
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { balance: 600 },
    });
  });
});
```

- [ ] **Step 2: Implement config route**

`frontend/src/app/api/miniapp/config/route.ts`:

```ts
import { getMiniappFeatureFlags } from "@/miniapp/config";
import { apiSuccess } from "@/lib/api/response";

export async function GET() {
  return apiSuccess({
    productName: "ima ima queencard",
    features: getMiniappFeatureFlags(),
    limits: {
      maxReferenceImages: 3,
      maxPromptLength: 2000,
      pollIntervalMs: 2500,
    },
  });
}
```

- [ ] **Step 3: Implement `auth/me` route**

`frontend/src/app/api/miniapp/auth/me/route.ts`:

```ts
import { requireMiniappUser } from "@/miniapp/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { creditService } from "@/services/credit";

export async function GET(request: Request) {
  try {
    const current = await requireMiniappUser(request);
    const credits = await creditService.getBalance(current.userId);

    return apiSuccess({
      user: {
        id: current.userId,
        email: current.email,
        name: current.name,
        image: current.image,
        credits,
        wechatBound: true,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 4: Implement credit routes**

`frontend/src/app/api/miniapp/credit/balance/route.ts`:

```ts
import { requireMiniappUser } from "@/miniapp/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { creditService } from "@/services/credit";

export async function GET(request: Request) {
  try {
    const current = await requireMiniappUser(request);
    const balance = await creditService.getBalance(current.userId);
    return apiSuccess({ balance });
  } catch (error) {
    return handleApiError(error);
  }
}
```

`frontend/src/app/api/miniapp/credit/history/route.ts`:

```ts
import { requireMiniappUser } from "@/miniapp/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { creditService } from "@/services/credit";

export async function GET(request: Request) {
  try {
    const current = await requireMiniappUser(request);
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const result = await creditService.getHistory(current.userId, { limit, offset });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/app/api/miniapp/credit/balance/route.test.ts src/app/api/miniapp/credit/history/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/miniapp/config src/app/api/miniapp/auth/me src/app/api/miniapp/credit
git commit -m "feat: expose miniapp config and credits"
```

---

### Task 4: Backend Generation Bridge

**Files:**
- Modify: `frontend/src/services/image-generation.ts`
- Create: `frontend/src/miniapp/response.ts`
- Create: `frontend/src/miniapp/upload-service.ts`
- Create: `frontend/src/app/api/miniapp/uploads/reference-image/route.ts`
- Create: `frontend/src/app/api/miniapp/image-generations/estimate/route.ts`
- Create: `frontend/src/app/api/miniapp/image-generations/route.ts`
- Create: `frontend/src/app/api/miniapp/image-generations/[taskId]/route.ts`
- Create: `frontend/src/app/api/miniapp/image-generations/[taskId]/regenerate/route.ts`
- Create: `frontend/src/app/api/miniapp/image-assets/[assetId]/download/route.ts`
- Test: `frontend/src/miniapp/response.test.ts`
- Test: `frontend/src/app/api/miniapp/image-generations/route.test.ts`

**Interfaces:**
- Consumes: `requireMiniappUser`, `createImageGenerationTask`, `runImageGenerationTask`, `getImageGenerationTask`, `listImageGenerationTasks`, `regenerateImageTask`
- Produces: Mobile-friendly task creation, list, detail, regenerate, and asset download routes.

- [ ] **Step 1: Write failing response normalizer test**

```ts
import { describe, expect, it } from "vitest";

import { toMiniappTask } from "./response";

describe("toMiniappTask", () => {
  it("normalizes task and asset fields for miniapp", () => {
    const task = toMiniappTask({
      taskId: "gen_1",
      status: "completed",
      prompt: "make a post",
      model: "doubao-seedream-5-edit",
      aspectRatio: "3:4",
      outputCount: 1,
      requestedCredits: 12,
      settledCredits: 10,
      referenceImages: ["https://cdn/ref.jpg"],
      assets: [{ id: 1, url: "https://cdn/out.jpg", width: 1024, height: 1365 }],
    });

    expect(task).toMatchObject({
      taskId: "gen_1",
      status: "completed",
      statusText: "生成完成",
      images: ["https://cdn/out.jpg"],
      credits: { requested: 12, settled: 10 },
    });
  });
});
```

- [ ] **Step 2: Update generation source type**

Modify `frontend/src/services/image-generation.ts`:

```ts
export type ImageGenerationSource =
  | "manual"
  | "prompt-library"
  | "regenerate"
  | "wechat-miniapp";
```

- [ ] **Step 3: Implement response normalizer**

Create `frontend/src/miniapp/response.ts`:

```ts
export function statusText(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "partial_success") return "生成完成";
  if (normalized === "failed") return "生成失败";
  if (normalized === "queued") return "排队中";
  if (normalized === "generating") return "生成中";
  return "处理中";
}

export function toMiniappTask(task: any) {
  const assets = Array.isArray(task.assets) ? task.assets : [];
  return {
    taskId: task.taskId,
    status: task.status,
    statusText: statusText(task.status),
    prompt: task.prompt,
    model: task.model,
    aspectRatio: task.aspectRatio,
    outputCount: task.outputCount,
    referenceImages: task.referenceImages ?? [],
    images: assets.map((asset: any) => asset.url).filter(Boolean),
    assets: assets.map((asset: any) => ({
      id: asset.id,
      url: asset.url,
      width: asset.width,
      height: asset.height,
      creditsCharged: asset.creditsCharged,
    })),
    credits: {
      requested: task.requestedCredits ?? 0,
      settled: task.settledCredits ?? 0,
    },
    errorMessage: task.errorMessage ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
```

- [ ] **Step 4: Implement upload service with local stub storage**

Create `frontend/src/miniapp/upload-service.ts`:

```ts
import { ApiError } from "@/lib/api/error";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function validateReferenceUpload(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new ApiError("Only JPG, PNG, and WebP images are supported", 400);
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError("Image must be between 1 byte and 10MB", 400);
  }
}

export async function storeReferenceUpload(input: {
  userId: string;
  file: File;
}) {
  await validateReferenceUpload(input.file);
  const arrayBuffer = await input.file.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return {
    url: `data:${input.file.type};base64,${base64}`,
    size: input.file.size,
    mimeType: input.file.type,
  };
}
```

This data URL implementation is acceptable for development and tests. Replace it with object storage before production; the API shape remains stable.

- [ ] **Step 5: Implement upload route**

`frontend/src/app/api/miniapp/uploads/reference-image/route.ts`:

```ts
import { requireMiniappUser } from "@/miniapp/auth";
import { storeReferenceUpload } from "@/miniapp/upload-service";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const current = await requireMiniappUser(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("file is required");
    }
    const stored = await storeReferenceUpload({ userId: current.userId, file });
    return apiSuccess(stored);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 6: Implement generation routes**

Use existing service imports:

```ts
import {
  createImageGenerationTask,
  getImageGenerationTask,
  listImageGenerationTasks,
  regenerateImageTask,
  runImageGenerationTask,
} from "@/services/image-generation";
```

`POST /api/miniapp/image-generations` route:

```ts
export async function POST(request: Request) {
  try {
    const current = await requireMiniappUser(request);
    const body = await request.json();
    const task = await createImageGenerationTask(current.userId, {
      ...body,
      source: "wechat-miniapp",
    });

    void runImageGenerationTask(current.userId, task.taskId).catch((error) => {
      console.error("Miniapp image generation failed:", error);
    });

    return apiSuccess(toMiniappTask(task));
  } catch (error) {
    return handleApiError(error);
  }
}
```

`GET /api/miniapp/image-generations/:taskId` route:

```ts
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const current = await requireMiniappUser(request);
    const { taskId } = await params;
    const task = await getImageGenerationTask(current.userId, taskId);
    return apiSuccess(toMiniappTask(task));
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 7: Write task creation route test**

```ts
it("creates a miniapp task owned by the authenticated user", async () => {
  const response = await POST(
    new Request("http://localhost/api/miniapp/image-generations", {
      method: "POST",
      headers: { authorization: "Bearer mini_token" },
      body: JSON.stringify({
        prompt: "make a post",
        referenceImages: ["https://cdn/ref.jpg"],
        model: "doubao-seedream-5-edit",
        outputCount: 1,
      }),
    })
  );

  const payload = await response.json();
  expect(payload.success).toBe(true);
  expect(payload.data.taskId).toBe("gen_123");
  expect(createImageGenerationTask).toHaveBeenCalledWith(
    "user_1",
    expect.objectContaining({ source: "wechat-miniapp" })
  );
});
```

- [ ] **Step 8: Run generation tests**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/response.test.ts src/app/api/miniapp/image-generations/route.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/image-generation.ts src/miniapp/response.ts src/miniapp/upload-service.ts src/app/api/miniapp/uploads src/app/api/miniapp/image-generations src/app/api/miniapp/image-assets src/miniapp/response.test.ts src/app/api/miniapp/image-generations/route.test.ts
git commit -m "feat: bridge miniapp generation APIs"
```

---

### Task 5: Backend Prompt Library API

**Files:**
- Create: `frontend/src/miniapp/prompt-cases.ts`
- Create: `frontend/src/app/api/miniapp/prompt-cases/route.ts`
- Test: `frontend/src/miniapp/prompt-cases.test.ts`
- Test: `frontend/src/app/api/miniapp/prompt-cases/route.test.ts`

**Interfaces:**
- Consumes: `frontend/src/data/xhsPromptCases.ts`
- Produces: `listMiniappPromptCases(options)` and `GET /api/miniapp/prompt-cases`

- [ ] **Step 1: Write failing library filter test**

```ts
import { describe, expect, it } from "vitest";

import { listMiniappPromptCases } from "./prompt-cases";

describe("listMiniappPromptCases", () => {
  it("returns paged mobile-safe cases", () => {
    const result = listMiniappPromptCases({ query: "养生", limit: 5, offset: 0 });

    expect(result.records.length).toBeLessThanOrEqual(5);
    expect(result.records[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        category: expect.any(String),
      })
    );
    expect(JSON.stringify(result.records[0])).not.toContain("private");
  });
});
```

- [ ] **Step 2: Implement prompt case mapper**

Create `frontend/src/miniapp/prompt-cases.ts`:

```ts
import { xhsPromptCases } from "@/data/xhsPromptCases";

export interface PromptCaseListOptions {
  query?: string | null;
  category?: string | null;
  limit?: number;
  offset?: number;
}

export function listMiniappPromptCases(options: PromptCaseListOptions) {
  const query = (options.query || "").trim().toLowerCase();
  const category = (options.category || "").trim();
  const limit = Math.min(30, Math.max(1, Math.floor(options.limit ?? 20)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const filtered = xhsPromptCases.filter((item) => {
    const categoryMatch = !category || item.category === category;
    const searchable = [item.title, item.category, item.author, ...item.topics]
      .join(" ")
      .toLowerCase();
    const queryMatch = !query || searchable.includes(query);
    return categoryMatch && queryMatch;
  });

  return {
    total: filtered.length,
    limit,
    offset,
    records: filtered.slice(offset, offset + limit).map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      topics: item.topics,
      author: item.author,
      thumbnail: item.image,
      prompt: item.prompt,
      noteUrl: item.noteUrl,
      authorUrl: item.authorUrl,
    })),
  };
}
```

- [ ] **Step 3: Implement route**

`frontend/src/app/api/miniapp/prompt-cases/route.ts`:

```ts
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { listMiniappPromptCases } from "@/miniapp/prompt-cases";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = listMiniappPromptCases({
      query: url.searchParams.get("query"),
      category: url.searchParams.get("category"),
      limit: Number(url.searchParams.get("limit") || 20),
      offset: Number(url.searchParams.get("offset") || 0),
    });
    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/prompt-cases.test.ts src/app/api/miniapp/prompt-cases/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/miniapp/prompt-cases.ts src/miniapp/prompt-cases.test.ts src/app/api/miniapp/prompt-cases
git commit -m "feat: expose miniapp prompt library"
```

---

### Task 6: Backend WeChat Pay Orders And Fulfillment

**Files:**
- Create: `frontend/src/miniapp/wechat-pay.ts`
- Create: `frontend/src/miniapp/order-service.ts`
- Create: `frontend/src/app/api/miniapp/pricing/route.ts`
- Create: `frontend/src/app/api/miniapp/orders/route.ts`
- Create: `frontend/src/app/api/miniapp/orders/[orderId]/route.ts`
- Create: `frontend/src/app/api/miniapp/payments/wechat/notify/route.ts`
- Modify: `frontend/src/config/pricing-products.ts`
- Test: `frontend/src/miniapp/wechat-pay.test.ts`
- Test: `frontend/src/miniapp/order-service.test.ts`
- Test: `frontend/src/app/api/miniapp/orders/route.test.ts`
- Test: `frontend/src/app/api/miniapp/payments/wechat/notify/route.test.ts`

**Interfaces:**
- Consumes: `miniappOrders`, `paymentFulfillments`, `getCreditPackPricingProducts`, `fulfillCreditGrantOnce`
- Produces: `listMiniappPricingProducts()`, `createMiniappOrder`, `fulfillWechatPaidOrderOnce`, `createWechatJsapiPayment`, payment notify route.

- [ ] **Step 1: Write failing pricing test**

```ts
import { describe, expect, it } from "vitest";

import { listMiniappPricingProducts } from "./order-service";

describe("listMiniappPricingProducts", () => {
  it("returns one-time credit products and excludes subscriptions initially", () => {
    const products = listMiniappPricingProducts();

    expect(products.every((product) => product.mode === "payment")).toBe(true);
    expect(products.map((product) => product.key)).toContain("credit_creator");
  });
});
```

- [ ] **Step 2: Implement pricing product mapper**

Create in `frontend/src/miniapp/order-service.ts`:

```ts
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";

import { db, miniappOrders, CreditTransType } from "@/db";
import {
  getCreditPackPricingProducts,
  getPricingProduct,
} from "@/config/pricing-products";
import { ApiError } from "@/lib/api/error";
import { fulfillCreditGrantOnce } from "@/services/payment-fulfillment";

export function listMiniappPricingProducts() {
  return getCreditPackPricingProducts().map((product) => ({
    key: product.key,
    title: product.title,
    description: product.description,
    mode: product.mode,
    priceCny: product.priceCny,
    credits: product.credits,
    validityDays: product.validityDays,
    popular: Boolean(product.popular),
    features: product.features,
  }));
}

export function createMerchantOrderNo(userId: string) {
  return `wx_${Date.now()}_${userId.slice(0, 8)}_${nanoid(8)}`;
}
```

- [ ] **Step 3: Implement order creation**

Add to `order-service.ts`:

```ts
export async function createMiniappOrder(input: {
  userId: string;
  productKey: string;
}) {
  const product = getPricingProduct(input.productKey);
  if (!product || !product.enabled || product.mode !== "payment") {
    throw new ApiError("Unsupported miniapp product", 400);
  }

  const merchantOrderNo = createMerchantOrderNo(input.userId);
  const [order] = await db
    .insert(miniappOrders)
    .values({
      userId: input.userId,
      productKey: product.key,
      merchantOrderNo,
      amountCny: product.priceCny,
      credits: product.credits,
      status: "PENDING",
      updatedAt: new Date(),
    })
    .returning();

  if (!order) throw new ApiError("Failed to create order", 500);
  return order;
}
```

- [ ] **Step 4: Implement WeChat Pay signing service**

Create `frontend/src/miniapp/wechat-pay.ts`:

```ts
import crypto from "node:crypto";

import { env } from "@/env.mjs";
import { ApiError } from "@/lib/api/error";

export interface WechatJsapiPaymentParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}

export function assertWechatPayConfigured() {
  if (
    !env.WECHAT_PAY_MCH_ID ||
    !env.WECHAT_PAY_PRIVATE_KEY ||
    !env.WECHAT_PAY_CERT_SERIAL_NO ||
    !env.WECHAT_PAY_NOTIFY_URL
  ) {
    throw new ApiError("WeChat Pay is not configured", 503);
  }
}

export function signWechatPayMessage(message: string) {
  assertWechatPayConfigured();
  return crypto
    .createSign("RSA-SHA256")
    .update(message)
    .sign(env.WECHAT_PAY_PRIVATE_KEY!, "base64");
}

export function signJsapiPayment(prepayId: string): WechatJsapiPaymentParams {
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString("hex");
  const pkg = `prepay_id=${prepayId}`;
  const paySign = signWechatPayMessage(`${timeStamp}\n${nonceStr}\n${pkg}\n`);

  return {
    timeStamp,
    nonceStr,
    package: pkg,
    signType: "RSA",
    paySign,
  };
}
```

Add `createWechatJsapiPrepay` later in the same file using `fetch` against WeChat Pay v3 JSAPI. Keep the function signature stable:

```ts
export async function createWechatJsapiPrepay(input: {
  appid: string;
  openid: string;
  description: string;
  outTradeNo: string;
  amountCny: number;
}) {
  assertWechatPayConfigured();
  // POST to WeChat Pay JSAPI with amount.total in fen and payer.openid.
  // Return { prepayId: string } after verifying response shape.
}
```

- [ ] **Step 5: Implement order route**

`frontend/src/app/api/miniapp/orders/route.ts`:

```ts
import { requireMiniappUser } from "@/miniapp/auth";
import { createMiniappOrder } from "@/miniapp/order-service";
import { createWechatJsapiPrepay, signJsapiPayment } from "@/miniapp/wechat-pay";
import { apiSuccess, handleApiError } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const current = await requireMiniappUser(request);
    const body = await request.json();
    const productKey = typeof body.productKey === "string" ? body.productKey : "";
    const order = await createMiniappOrder({ userId: current.userId, productKey });
    const prepay = await createWechatJsapiPrepay({
      appid: current.appid,
      openid: current.openid,
      description: `ima ima queencard ${order.productKey}`,
      outTradeNo: order.merchantOrderNo,
      amountCny: order.amountCny,
    });

    return apiSuccess({
      orderId: order.id,
      merchantOrderNo: order.merchantOrderNo,
      payment: signJsapiPayment(prepay.prepayId),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
```

- [ ] **Step 6: Implement notify fulfillment**

Add to `order-service.ts`:

```ts
export async function fulfillWechatPaidOrderOnce(input: {
  merchantOrderNo: string;
  transactionId: string;
  paidAt: Date;
  amountCny: number;
  rawPayload: Record<string, unknown>;
}) {
  const [order] = await db
    .select()
    .from(miniappOrders)
    .where(eq(miniappOrders.merchantOrderNo, input.merchantOrderNo))
    .limit(1);

  if (!order) throw new ApiError("Order not found", 404);
  if (order.amountCny !== input.amountCny) {
    throw new ApiError("Payment amount mismatch", 400);
  }

  const result = await fulfillCreditGrantOnce({
    fulfillmentKey: `wechatpay:transaction:${input.transactionId}`,
    provider: "wechatpay",
    eventId: input.transactionId,
    eventType: "TRANSACTION.SUCCESS",
    providerOrderId: input.merchantOrderNo,
    providerTransactionId: input.transactionId,
    providerProductId: order.productKey,
    productKey: order.productKey,
    userId: order.userId,
    credits: order.credits,
    transType: CreditTransType.ORDER_PAY,
    orderNo: input.merchantOrderNo,
    expiryDays: 365,
    remark: `WeChat Pay credit pack: ${order.productKey}`,
    metadata: input.rawPayload,
  });

  await db
    .update(miniappOrders)
    .set({
      status: "FULFILLED",
      paidAt: input.paidAt,
      fulfilledAt: new Date(),
      providerTransactionId: input.transactionId,
      providerPayload: input.rawPayload,
      updatedAt: new Date(),
    })
    .where(eq(miniappOrders.id, order.id));

  return result;
}
```

- [ ] **Step 7: Write duplicate notify test**

```ts
it("does not grant credits twice for duplicate WeChat notify", async () => {
  await fulfillWechatPaidOrderOnce({
    merchantOrderNo: "wx_order_1",
    transactionId: "4200000001",
    paidAt: new Date("2026-07-27T00:00:00.000Z"),
    amountCny: 99,
    rawPayload: { out_trade_no: "wx_order_1" },
  });

  await fulfillWechatPaidOrderOnce({
    merchantOrderNo: "wx_order_1",
    transactionId: "4200000001",
    paidAt: new Date("2026-07-27T00:00:00.000Z"),
    amountCny: 99,
    rawPayload: { out_trade_no: "wx_order_1" },
  });

  expect(fulfillCreditGrantOnce).toHaveBeenCalledTimes(2);
  expect(secondResult.fulfilled).toBe(false);
});
```

- [ ] **Step 8: Run payment tests**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test src/miniapp/order-service.test.ts src/miniapp/wechat-pay.test.ts src/app/api/miniapp/orders/route.test.ts src/app/api/miniapp/payments/wechat/notify/route.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/miniapp/order-service.ts src/miniapp/wechat-pay.ts src/app/api/miniapp/pricing src/app/api/miniapp/orders src/app/api/miniapp/payments src/miniapp/order-service.test.ts src/miniapp/wechat-pay.test.ts src/app/api/miniapp/orders/route.test.ts src/app/api/miniapp/payments/wechat/notify/route.test.ts
git commit -m "feat: add miniapp wechat payment bridge"
```

---

### Task 7: Miniapp API Client And Session Upgrade

**Files:**
- Modify: `config/env.js`
- Create: `config/routes.js`
- Modify: `services/api.js`
- Modify: `services/session.js`
- Modify: `services/auth.js`
- Create: `services/config.js`
- Create: `services/credits.js`
- Create: `services/generation.js`
- Create: `services/orders.js`
- Create: `services/promptCases.js`
- Create: `utils/format.js`
- Modify: `tools/validate.js`

**Interfaces:**
- Consumes: backend `/api/miniapp/*` routes
- Produces: miniapp services for auth, config, credits, generation, orders, prompt cases.

- [ ] **Step 1: Add route constants**

Create `config/routes.js`:

```js
module.exports = {
  index: "/pages/index/index",
  generate: "/pages/generate/index",
  result: "/pages/result/index",
  history: "/pages/history/index",
  prompts: "/pages/prompts/index",
  account: "/pages/account/index",
  credits: "/pages/credits/index",
  pricing: "/pages/pricing/index",
  orders: "/pages/orders/index",
  bind: "/pages/bind/index",
};
```

- [ ] **Step 2: Extend session storage**

Modify `services/session.js`:

```js
var TOKEN_KEY = "ima_queencard_mini_token";
var TOKEN_EXPIRES_KEY = "ima_queencard_mini_token_expires";
var USER_KEY = "ima_queencard_mini_user";

function isExpired() {
  var value = wx.getStorageSync(TOKEN_EXPIRES_KEY);
  if (!value) return false;
  return new Date(value).getTime() <= Date.now();
}

function getToken() {
  if (isExpired()) {
    clearSession();
    return "";
  }
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function setSession(session) {
  wx.setStorageSync(TOKEN_KEY, session.token || "");
  wx.setStorageSync(TOKEN_EXPIRES_KEY, session.expiresAt || "");
  wx.setStorageSync(USER_KEY, session.user || null);
}
```

Keep existing exports and add `isExpired`.

- [ ] **Step 3: Extend request wrapper**

Modify `services/api.js` to add query serialization and typed endpoint helpers:

```js
function queryString(query) {
  var parts = [];
  Object.keys(query || {}).forEach(function (key) {
    var value = query[key];
    if (value === undefined || value === null || value === "") return;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
  });
  return parts.length ? "?" + parts.join("&") : "";
}

function get(path, query) {
  return request({
    path: path + queryString(query),
    method: "GET",
  });
}

function post(path, data) {
  return request({
    path: path,
    method: "POST",
    data: data || {},
  });
}
```

Export `get`, `post`, and `queryString`.

- [ ] **Step 4: Add service modules**

Create `services/config.js`:

```js
var api = require("./api.js");

function getConfig() {
  return api.get("/config");
}

module.exports = {
  getConfig: getConfig,
};
```

Create `services/credits.js`:

```js
var api = require("./api.js");

function getBalance() {
  return api.get("/credit/balance");
}

function getHistory(options) {
  return api.get("/credit/history", options || {});
}

module.exports = {
  getBalance: getBalance,
  getHistory: getHistory,
};
```

Create `services/generation.js` with wrappers for estimate, create, list, get, regenerate, upload:

```js
var api = require("./api.js");

function estimate(input) {
  return api.post("/image-generations/estimate", input);
}

function createTask(input) {
  return api.post("/image-generations", input);
}

function listTasks(options) {
  return api.get("/image-generations", options || {});
}

function getTask(taskId) {
  return api.get("/image-generations/" + encodeURIComponent(taskId));
}

function regenerate(taskId) {
  return api.post("/image-generations/" + encodeURIComponent(taskId) + "/regenerate");
}

function uploadReferenceImage(filePath) {
  return api.uploadReferenceImage(filePath);
}

module.exports = {
  estimate: estimate,
  createTask: createTask,
  listTasks: listTasks,
  getTask: getTask,
  regenerate: regenerate,
  uploadReferenceImage: uploadReferenceImage,
};
```

- [ ] **Step 5: Add formatting helpers**

Create `utils/format.js`:

```js
function credits(value) {
  return String(Math.max(0, Number(value || 0))) + " 积分";
}

function cny(value) {
  return "¥" + Number(value || 0).toFixed(0);
}

function shortDate(value) {
  if (!value) return "";
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.getFullYear() + "." + (date.getMonth() + 1) + "." + date.getDate();
}

module.exports = {
  credits: credits,
  cny: cny,
  shortDate: shortDate,
};
```

- [ ] **Step 6: Update validation**

Add the new services and route constants to `tools/validate.js` required files and add secret scan patterns:

```js
const secretPattern = /APP_SECRET|API_V3_KEY|PRIVATE_KEY|DATABASE_URL|GPTPROTO_API_KEY|STRIPE_API_KEY|CREEM_API_KEY/;
```

Scan `config`, `services`, `pages`, and `utils` source files for the pattern.

- [ ] **Step 7: Run miniapp validation**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
npm run validate
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
git add config services utils tools/validate.js
git commit -m "feat: expand miniapp API services"
```

---

### Task 8: Miniapp Navigation, Account, Credits, And History Pages

**Files:**
- Modify: `app.json`
- Modify: `app.js`
- Modify: `pages/index/index.js`
- Create: `pages/account/index.{js,json,wxml,wxss}`
- Create: `pages/credits/index.{js,json,wxml,wxss}`
- Create: `pages/history/index.{js,json,wxml,wxss}`
- Modify: `tools/validate.js`

**Interfaces:**
- Consumes: `services/auth.js`, `services/credits.js`, `services/generation.js`, `config/routes.js`, `utils/format.js`
- Produces: account, credits, and history pages reachable from landing/generate/result pages.

- [ ] **Step 1: Register pages**

Modify `app.json`:

```json
{
  "pages": [
    "pages/index/index",
    "pages/generate/index",
    "pages/result/index",
    "pages/history/index",
    "pages/credits/index",
    "pages/account/index"
  ]
}
```

Keep existing `window`, `style`, and `sitemapLocation`.

- [ ] **Step 2: Create account page JS**

`pages/account/index.js`:

```js
var auth = require("../../services/auth.js");
var credits = require("../../services/credits.js");
var routes = require("../../config/routes.js");

Page({
  data: {
    user: null,
    balance: 0,
    loading: false,
    error: "",
  },

  onShow: function () {
    this.refresh();
  },

  refresh: function () {
    var page = this;
    var user = auth.getCurrentUser();
    page.setData({ user: user, loading: true, error: "" });
    if (!user) {
      page.setData({ loading: false });
      return;
    }
    credits.getBalance()
      .then(function (result) {
        page.setData({ balance: result.balance || 0, loading: false });
      })
      .catch(function (error) {
        page.setData({ error: error.message || "读取失败", loading: false });
      });
  },

  login: function () {
    var page = this;
    auth.loginWithWechatProfile({ source: "account" })
      .then(function () {
        page.refresh();
      })
      .catch(function (error) {
        wx.showModal({ title: "登录失败", content: error.message, showCancel: false });
      });
  },

  logout: function () {
    auth.logout();
    this.setData({ user: null, balance: 0 });
  },

  openCredits: function () {
    wx.navigateTo({ url: routes.credits });
  },

  openPricing: function () {
    wx.navigateTo({ url: routes.pricing });
  },
});
```

- [ ] **Step 3: Create account WXML/WXSS**

`pages/account/index.wxml`:

```xml
<view class="page">
  <view class="header">
    <text class="title">我的账号</text>
    <text class="subtitle">统一 Ancher 账号、微信身份和生成额度</text>
  </view>

  <view class="card">
    <text class="label">当前账号</text>
    <text class="value">{{user ? (user.name || user.email || user.id) : '未登录'}}</text>
    <text class="hint">{{user ? '微信身份已连接' : '登录后同步额度和历史'}}</text>
    <button wx:if="{{!user}}" class="primary" bindtap="login">微信登录</button>
    <button wx:else class="secondary" bindtap="logout">退出登录</button>
  </view>

  <view class="grid">
    <button class="tile" bindtap="openCredits">
      <text class="tile-value">{{balance}}</text>
      <text class="tile-label">积分余额</text>
    </button>
    <button class="tile lemon" bindtap="openPricing">
      <text class="tile-value">购买</text>
      <text class="tile-label">积分套餐</text>
    </button>
  </view>
</view>
```

Use WXSS matching existing visual language: pink page, bordered cards, 8px radius, lemon/pumpkin accents.

- [ ] **Step 4: Create credits page**

`pages/credits/index.js`:

```js
var creditsService = require("../../services/credits.js");
var format = require("../../utils/format.js");

function mapRecord(record) {
  return {
    id: record.id,
    type: record.type || record.transType,
    credits: format.credits(record.credits),
    remark: record.remark || record.type || "积分变动",
    date: format.shortDate(record.createdAt),
  };
}

Page({
  data: {
    balance: 0,
    records: [],
    loading: false,
    error: "",
  },

  onShow: function () {
    this.load();
  },

  load: function () {
    var page = this;
    page.setData({ loading: true, error: "" });
    Promise.all([creditsService.getBalance(), creditsService.getHistory({ limit: 30 })])
      .then(function (results) {
        page.setData({
          balance: results[0].balance || 0,
          records: (results[1].records || results[1].items || []).map(mapRecord),
          loading: false,
        });
      })
      .catch(function (error) {
        page.setData({ loading: false, error: error.message || "读取失败" });
      });
  },
});
```

- [ ] **Step 5: Create history page**

`pages/history/index.js`:

```js
var generation = require("../../services/generation.js");

function mapTask(task) {
  return {
    taskId: task.taskId,
    statusText: task.statusText || task.status,
    prompt: task.prompt,
    thumb: task.images && task.images[0] ? task.images[0] : (task.referenceImages && task.referenceImages[0]),
    createdAt: task.createdAt,
  };
}

Page({
  data: {
    records: [],
    loading: false,
    error: "",
    query: "",
  },

  onShow: function () {
    this.load();
  },

  load: function () {
    var page = this;
    page.setData({ loading: true, error: "" });
    generation.listTasks({ limit: 30, query: this.data.query })
      .then(function (result) {
        page.setData({
          records: (result.records || result.items || []).map(mapTask),
          loading: false,
        });
      })
      .catch(function (error) {
        page.setData({ loading: false, error: error.message || "读取失败" });
      });
  },

  openTask: function (event) {
    wx.navigateTo({
      url: "/pages/result/index?taskId=" + encodeURIComponent(event.currentTarget.dataset.taskId),
    });
  },
});
```

- [ ] **Step 6: Run validation**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
npm run validate
```

Expected: PASS.

- [ ] **Step 7: Compile in WeChat Developer Tools**

Open project:

```text
/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app
```

Click `编译`. Verify:

- Account page renders logged-out state.
- Credits page handles unconfigured backend gracefully.
- History page handles unconfigured backend gracefully.

- [ ] **Step 8: Commit**

```bash
git add app.json app.js pages/account pages/credits pages/history pages/index tools/validate.js
git commit -m "feat: add miniapp account credits and history pages"
```

---

### Task 9: Miniapp Generation And Result Real Integration

**Files:**
- Modify: `pages/generate/index.js`
- Modify: `pages/generate/index.wxml`
- Modify: `pages/generate/index.wxss`
- Modify: `pages/result/index.js`
- Modify: `pages/result/index.wxml`
- Modify: `pages/result/index.wxss`
- Create: `data/models.js`

**Interfaces:**
- Consumes: `services/config.js`, `services/credits.js`, `services/generation.js`
- Produces: real estimate/create/result/regenerate/reuse flow.

- [ ] **Step 1: Add model data**

Create `data/models.js`:

```js
module.exports = [
  {
    label: "Doubao Seedream",
    value: "doubao-seedream-5-edit",
    desc: "适合中文图文和平台语感",
  },
  {
    label: "Seedream",
    value: "seedream-5-edit",
    desc: "适合参考图编辑",
  },
  {
    label: "GPT Image",
    value: "gpt-image-2-edit",
    desc: "适合通用图片编辑",
  },
  {
    label: "Gemini Flash",
    value: "gemini-3.1-flash-edit",
    desc: "适合快速试稿",
  },
];
```

- [ ] **Step 2: Replace generate page API calls**

In `pages/generate/index.js`, replace direct `api.*` calls with `generation.*` calls:

```js
var generation = require("../../services/generation.js");
var credits = require("../../services/credits.js");
var models = require("../../data/models.js");
```

Use `generation.uploadReferenceImage`, `generation.estimate`, and `generation.createTask`.

- [ ] **Step 3: Add estimate on form changes**

Add a debounced estimate method:

```js
estimateCredits: function () {
  var page = this;
  if (!this.data.apiReady || !this.data.referenceImagePath || !this.data.prompt) return;
  generation.estimate({
    model: this.data.models[this.data.modelIndex].value,
    prompt: this.data.prompt,
    referenceImages: ["uploaded-placeholder"],
    outputCount: this.data.outputCounts[this.data.countIndex],
    aspectRatio: "3:4",
  })
    .then(function (result) {
      page.setData({ estimatedCredits: result.credits || result.requestedCredits || 0 });
    })
    .catch(function () {
      page.setData({ estimatedCredits: 0 });
    });
}
```

Call it after prompt/model/count changes. If backend requires a real uploaded URL for estimate, delay estimate until after upload and show "提交前计算".

- [ ] **Step 4: Add balance refresh**

On `onShow`, fetch credit balance when logged in:

```js
credits.getBalance()
  .then(function (result) {
    page.setData({ balance: result.balance || 0 });
  })
  .catch(function () {
    page.setData({ balance: 0 });
  });
```

- [ ] **Step 5: Extend result actions**

In `pages/result/index.js`, add:

```js
regenerate: function () {
  var page = this;
  if (!this.data.taskId || this.data.loading) return;
  this.setData({ loading: true });
  generation.regenerate(this.data.taskId)
    .then(function (task) {
      page.setData({
        taskId: task.taskId || page.data.taskId,
        loading: false,
      });
      page.fetchTask();
    })
    .catch(function (error) {
      page.setData({ loading: false, error: error.message || "重新生成失败" });
    });
},

useAsReference: function (event) {
  var url = event.currentTarget.dataset.url;
  if (!url) return;
  wx.navigateTo({
    url: "/pages/generate/index?referenceUrl=" + encodeURIComponent(url),
  });
}
```

- [ ] **Step 6: Update WXML**

Add visible fields:

- Balance badge.
- Estimated credits badge.
- Feature-disabled notice.
- Regenerate button on result page.
- Use-as-reference button for each result image.

Keep button text short:

```xml
<button class="small-button lemon" bindtap="regenerate">重新生成</button>
<button class="small-button white" data-url="{{item}}" bindtap="useAsReference">继续做</button>
```

- [ ] **Step 7: Run validation and simulator compile**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
npm run validate
```

Then compile in WeChat Developer Tools.

Expected:

- No WXML expression errors.
- Generate page shows balance/estimate areas.
- Result page shows regenerate/reuse buttons.

- [ ] **Step 8: Commit**

```bash
git add data/models.js pages/generate pages/result
git commit -m "feat: connect miniapp generation workflow"
```

---

### Task 10: Miniapp Prompt Library

**Files:**
- Create: `pages/prompts/index.{js,json,wxml,wxss}`
- Modify: `app.json`
- Modify: `pages/index/index.js`
- Modify: `tools/validate.js`

**Interfaces:**
- Consumes: `services/promptCases.js`, `config/routes.js`
- Produces: searchable prompt/case library and start-from-case navigation.

- [ ] **Step 1: Register prompts page**

Add `pages/prompts/index` to `app.json`.

- [ ] **Step 2: Create prompt library service**

If not already created in Task 7, create `services/promptCases.js`:

```js
var api = require("./api.js");

function list(options) {
  return api.get("/prompt-cases", options || {});
}

module.exports = {
  list: list,
};
```

- [ ] **Step 3: Create prompts page JS**

`pages/prompts/index.js`:

```js
var promptCases = require("../../services/promptCases.js");

Page({
  data: {
    query: "",
    category: "",
    records: [],
    loading: false,
    error: "",
  },

  onLoad: function () {
    this.load();
  },

  onQueryInput: function (event) {
    this.setData({ query: event.detail.value });
  },

  search: function () {
    this.load();
  },

  load: function () {
    var page = this;
    page.setData({ loading: true, error: "" });
    promptCases.list({
      query: this.data.query,
      category: this.data.category,
      limit: 20,
    })
      .then(function (result) {
        page.setData({
          records: result.records || [],
          loading: false,
        });
      })
      .catch(function (error) {
        page.setData({ loading: false, error: error.message || "读取失败" });
      });
  },

  useCase: function (event) {
    var prompt = event.currentTarget.dataset.prompt || "";
    wx.navigateTo({
      url: "/pages/generate/index?prompt=" + encodeURIComponent(prompt),
    });
  },
});
```

- [ ] **Step 4: Create WXML**

```xml
<view class="page">
  <view class="header">
    <text class="title">参考库</text>
    <text class="subtitle">从已有爆款结构开始生成</text>
  </view>

  <view class="search-row">
    <input class="search-input" value="{{query}}" placeholder="搜索方向或作者" bindinput="onQueryInput" />
    <button class="search-button" bindtap="search">搜索</button>
  </view>

  <view wx:if="{{error}}" class="error-card">{{error}}</view>

  <view class="case-list">
    <view wx:for="{{records}}" wx:key="id" class="case-card">
      <image class="case-image" src="{{item.thumbnail}}" mode="aspectFill" />
      <view class="case-copy">
        <text class="case-title">{{item.title}}</text>
        <text class="case-meta">{{item.category}} · @{{item.author}}</text>
        <button class="small-button lemon" data-prompt="{{item.prompt}}" bindtap="useCase">用这个生成</button>
      </view>
    </view>
  </view>
</view>
```

- [ ] **Step 5: Link from landing**

Modify `pages/index/index.js`:

```js
openPrompts: function () {
  wx.navigateTo({ url: "/pages/prompts/index" });
}
```

Add a CTA in landing WXML near gallery/final CTA.

- [ ] **Step 6: Validate and compile**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
npm run validate
```

Expected: PASS, then WeChat Developer Tools compile succeeds.

- [ ] **Step 7: Commit**

```bash
git add app.json pages/prompts pages/index services/promptCases.js tools/validate.js
git commit -m "feat: add miniapp prompt library"
```

---

### Task 11: Miniapp Pricing, Orders, And Payment UI

**Files:**
- Create: `pages/pricing/index.{js,json,wxml,wxss}`
- Create: `pages/orders/index.{js,json,wxml,wxss}`
- Modify: `app.json`
- Modify: `pages/account/index.js`
- Modify: `pages/credits/index.js`
- Modify: `tools/validate.js`

**Interfaces:**
- Consumes: `services/orders.js`, backend `/api/miniapp/pricing`, `/api/miniapp/orders`, `wx.requestPayment`
- Produces: miniapp credit-pack purchase flow and order history.

- [ ] **Step 1: Create orders service**

If not already created in Task 7, create `services/orders.js`:

```js
var api = require("./api.js");

function getPricing() {
  return api.get("/pricing");
}

function createOrder(productKey) {
  return api.post("/orders", { productKey: productKey });
}

function listOrders(options) {
  return api.get("/orders", options || {});
}

function getOrder(orderId) {
  return api.get("/orders/" + encodeURIComponent(orderId));
}

module.exports = {
  getPricing: getPricing,
  createOrder: createOrder,
  listOrders: listOrders,
  getOrder: getOrder,
};
```

- [ ] **Step 2: Create pricing page JS**

`pages/pricing/index.js`:

```js
var orders = require("../../services/orders.js");
var format = require("../../utils/format.js");

function mapProduct(product) {
  return {
    key: product.key,
    title: product.title,
    description: product.description,
    price: format.cny(product.priceCny),
    credits: format.credits(product.credits),
    validity: product.validityDays + " 天有效",
    popular: product.popular,
    features: product.features || [],
  };
}

Page({
  data: {
    products: [],
    loading: false,
    paying: false,
    error: "",
  },

  onShow: function () {
    this.load();
  },

  load: function () {
    var page = this;
    page.setData({ loading: true, error: "" });
    orders.getPricing()
      .then(function (result) {
        page.setData({
          products: (result.products || result || []).map(mapProduct),
          loading: false,
        });
      })
      .catch(function (error) {
        page.setData({ loading: false, error: error.message || "读取套餐失败" });
      });
  },

  buy: function (event) {
    var page = this;
    var productKey = event.currentTarget.dataset.key;
    if (this.data.paying) return;
    this.setData({ paying: true });
    orders.createOrder(productKey)
      .then(function (result) {
        return new Promise(function (resolve, reject) {
          wx.requestPayment({
            timeStamp: result.payment.timeStamp,
            nonceStr: result.payment.nonceStr,
            package: result.payment.package,
            signType: result.payment.signType,
            paySign: result.payment.paySign,
            success: function () {
              resolve(result.orderId);
            },
            fail: function (error) {
              reject(new Error(error.errMsg || "支付未完成"));
            },
          });
        });
      })
      .then(function (orderId) {
        page.setData({ paying: false });
        wx.navigateTo({ url: "/pages/orders/index?orderId=" + encodeURIComponent(orderId) });
      })
      .catch(function (error) {
        page.setData({ paying: false });
        wx.showModal({ title: "支付未完成", content: error.message, showCancel: false });
      });
  },
});
```

- [ ] **Step 3: Create pricing WXML**

```xml
<view class="page">
  <view class="header">
    <text class="title">购买积分</text>
    <text class="subtitle">积分到账后可用于参考图生成</text>
  </view>

  <view wx:if="{{error}}" class="error-card">{{error}}</view>

  <view class="product-list">
    <view wx:for="{{products}}" wx:key="key" class="product-card">
      <view wx:if="{{item.popular}}" class="badge">推荐</view>
      <text class="product-title">{{item.title}}</text>
      <text class="product-desc">{{item.description}}</text>
      <text class="product-price">{{item.price}}</text>
      <text class="product-credit">{{item.credits}} · {{item.validity}}</text>
      <button class="primary" data-key="{{item.key}}" loading="{{paying}}" bindtap="buy">微信支付</button>
    </view>
  </view>
</view>
```

- [ ] **Step 4: Create orders page JS**

`pages/orders/index.js`:

```js
var orders = require("../../services/orders.js");

Page({
  pollTimer: null,
  data: {
    orderId: "",
    order: null,
    records: [],
    loading: false,
    error: "",
  },

  onLoad: function (options) {
    this.setData({ orderId: options && options.orderId ? decodeURIComponent(options.orderId) : "" });
  },

  onShow: function () {
    this.load();
  },

  onUnload: function () {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  },

  load: function () {
    var page = this;
    page.setData({ loading: true, error: "" });
    var request = this.data.orderId ? orders.getOrder(this.data.orderId) : orders.listOrders({ limit: 20 });
    request
      .then(function (result) {
        page.setData({
          order: page.data.orderId ? result.order || result : null,
          records: page.data.orderId ? [] : (result.records || []),
          loading: false,
        });
        if (page.data.orderId && result.status !== "FULFILLED" && result.status !== "FAILED") {
          page.pollTimer = setTimeout(function () { page.load(); }, 2500);
        }
      })
      .catch(function (error) {
        page.setData({ loading: false, error: error.message || "读取订单失败" });
      });
  },
});
```

- [ ] **Step 5: Validate payment disabled state**

Configure backend feature flag with payment disabled. In simulator:

- Pricing route returns products only when allowed.
- If backend returns "WeChat Pay is not configured", UI shows modal and does not claim payment success.

- [ ] **Step 6: Run validation and compile**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
npm run validate
```

Expected: PASS. Then compile in WeChat Developer Tools.

- [ ] **Step 7: Commit**

```bash
git add app.json pages/pricing pages/orders pages/account pages/credits services/orders.js tools/validate.js
git commit -m "feat: add miniapp pricing and orders"
```

---

### Task 12: Legal Pages, Validation, And Release Gate

**Files:**
- Create: `pages/legal/privacy.{js,json,wxml,wxss}`
- Create: `pages/legal/terms.{js,json,wxml,wxss}`
- Modify: `app.json`
- Modify: `pages/account/index.wxml`
- Modify: `tools/validate.js`
- Modify: `README.md`
- Create: `docs/release-checklist.md`

**Interfaces:**
- Consumes: Miniapp pages and backend feature flags
- Produces: review-facing legal pages, stricter validation, release checklist.

- [ ] **Step 1: Add legal pages**

Create `pages/legal/privacy.js`:

```js
Page({});
```

Create `pages/legal/privacy.json`:

```json
{
  "navigationBarTitleText": "隐私政策"
}
```

Create `pages/legal/privacy.wxml`:

```xml
<view class="page">
  <text class="title">隐私政策</text>
  <text class="paragraph">ima ima queencard 小程序会收集微信登录标识、账号绑定信息、上传的参考图片、生成提示词、生成结果、积分记录和支付订单信息，用于提供账号登录、图文生成、积分扣减、支付到账、客服支持和安全风控。</text>
  <text class="paragraph">小程序不会在客户端保存数据库密码、模型服务密钥、微信支付密钥或商户证书。上传图片和生成结果由服务端存储和处理。</text>
  <text class="paragraph">如需删除账号、查询订单或处理支付问题，请通过小程序账号页提供的客服入口联系我们。</text>
</view>
```

Create terms page with the same structure and product usage/payment rules.

- [ ] **Step 2: Register legal pages and account links**

Add to `app.json`:

```json
"pages/legal/privacy",
"pages/legal/terms"
```

Add account page links:

```xml
<button class="link-row" bindtap="openPrivacy">隐私政策</button>
<button class="link-row" bindtap="openTerms">用户协议</button>
```

Add handlers:

```js
openPrivacy: function () {
  wx.navigateTo({ url: "/pages/legal/privacy" });
},

openTerms: function () {
  wx.navigateTo({ url: "/pages/legal/terms" });
}
```

- [ ] **Step 3: Strengthen validation**

In `tools/validate.js`, validate:

- All registered `app.json` pages have `.js`, `.json`, `.wxml`, `.wxss`.
- Secret keywords do not appear in `config`, `services`, `pages`, `data`, `utils`.
- `config/env.js` does not set `API_BASE_URL` to localhost for production builds.
- `docs/superpowers/specs/2026-07-27-full-miniapp-migration-design.md` exists.

Code sketch:

```js
appJson.pages.forEach((page) => {
  [".js", ".json", ".wxml", ".wxss"].forEach((ext) => {
    const file = path.join(root, page + ext);
    if (!fs.existsSync(file)) fail(`missing page file ${page + ext}`);
  });
});
```

- [ ] **Step 4: Create release checklist**

Create `docs/release-checklist.md` with these checked manually before upload:

```md
# Miniapp Release Checklist

- [ ] AppID is final and matches project.config.json.
- [ ] WeChat request/upload/download domains are configured.
- [ ] Merchant account is associated with AppID.
- [ ] Product category permits this AI generation and credit purchase flow.
- [ ] Privacy policy matches actual collected data.
- [ ] User agreement mentions generated content, credits, payment, refund/support.
- [ ] Backend production env has no missing miniapp vars.
- [ ] Payment feature flag is off unless WeChat Pay is verified.
- [ ] One real login test passes on device.
- [ ] One real generation task appears in web and miniapp history.
- [ ] One payment test order grants credits once.
- [ ] `npm run validate` passes in miniapp root.
- [ ] `pnpm test` passes in backend root.
- [ ] WeChat Developer Tools compile passes.
```

- [ ] **Step 5: Update README**

Add:

```md
## Full Product Migration

The mini program calls the backend through `/api/miniapp/*`. Set
`config/env.js` `API_BASE_URL` to the deployed backend origin. Do not place
secrets in this project.

Run:

```bash
npm run validate
```

Then compile with WeChat Developer Tools.
```

- [ ] **Step 6: Run final miniapp validation**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
npm run validate
```

Expected: PASS.

- [ ] **Step 7: Run backend checks**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/product-web-builds-w6-imaima-queencard/web/frontend"
pnpm test
pnpm lint
pnpm build
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
cd "/Users/ziye/Library/Mobile Documents/com~apple~CloudDocs/wiki/30-39 Product and Web Builds/w6/product-web-builds-w6/miniapp/app"
git add app.json pages/legal pages/account tools/validate.js README.md docs/release-checklist.md
git commit -m "chore: add miniapp release gate"
```

---

## Self-Review

### Spec Coverage

- Unified account and WeChat binding: Tasks 1-3.
- Real generation bridge: Task 4 and Task 9.
- Prompt/case library: Task 5 and Task 10.
- Credits and history: Task 3 and Task 8.
- WeChat payment: Task 6 and Task 11.
- Legal/release hardening: Task 12.
- Admin web-only boundary: preserved by omitting admin pages and admin APIs from miniapp UI.

### Type Consistency

- Backend auth context uses `userId`, `appid`, and `openid` throughout.
- Miniapp order creation uses `productKey`, `orderId`, `merchantOrderNo`, and `payment`.
- Miniapp generation uses `taskId`, `images`, `referenceImages`, `statusText`, and `credits`.
- Miniapp services use `api.get` and `api.post` added in Task 7.

### Execution Notes

- Implement backend tasks before miniapp real integration tasks.
- Keep WeChat payment feature disabled until merchant/category checks are complete.
- Replace the development data-URL upload storage with object storage before production release.
- If the parent workspace remains untracked, initialize or attach the intended Git remote before committing these tasks.
