import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripeCases = [
  ["creator_monthly", "subscription", "STRIPE_PRICE_CREATOR_MONTHLY", "price_creator_monthly", 600],
  ["creator_annual", "subscription", "STRIPE_PRICE_CREATOR_ANNUAL", "price_creator_annual", 7200],
  ["studio_monthly", "subscription", "STRIPE_PRICE_STUDIO_MONTHLY", "price_studio_monthly", 1800],
  ["studio_annual", "subscription", "STRIPE_PRICE_STUDIO_ANNUAL", "price_studio_annual", 21600],
  ["credit_creator", "payment", "STRIPE_PRICE_CREDIT_CREATOR", "price_credit_creator", 600],
  ["credit_studio", "payment", "STRIPE_PRICE_CREDIT_STUDIO", "price_credit_studio", 1800],
] as const;

const mocks = vi.hoisted(() => ({
  customerRows: [] as Array<Record<string, unknown>>,
  db: {
    select: vi.fn(),
  },
  ensureCustomer: vi.fn(),
  getCurrentUser: vi.fn(),
  createPendingFulfillment: vi.fn(),
  waffoCheckoutCreate: vi.fn(),
  stripe: {
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("@/db", () => ({
  customers: {
    authUserId: "authUserId",
    plan: "plan",
    stripeCustomerId: "stripeCustomerId",
    stripeSubscriptionId: "stripeSubscriptionId",
    stripePriceId: "stripePriceId",
    stripeCurrentPeriodEnd: "stripeCurrentPeriodEnd",
    billingProvider: "billingProvider",
    billingSubscriptionId: "billingSubscriptionId",
    billingProductId: "billingProductId",
    billingCurrentPeriodEnd: "billingCurrentPeriodEnd",
  },
  db: mocks.db,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => "auth-user-filter"),
}));

vi.mock("@/services/customer", () => ({
  ensureCustomer: mocks.ensureCustomer,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/services/payment-fulfillment", () => ({
  createPendingFulfillment: mocks.createPendingFulfillment,
}));

vi.mock("@/payment", () => ({
  stripe: mocks.stripe,
}));

vi.mock("@/payment/waffo", () => ({
  getWaffoClient: () => ({
    checkout: { authenticated: { create: mocks.waffoCheckoutCreate } },
  }),
}));

import {
  createCreemCheckout,
  createStripeSession,
  createWaffoCheckout,
  getMySubscription,
  getStripeReturnUrls,
} from "./billing";

describe("createWaffoCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    process.env.WAFFO_PRODUCT_CREATOR_MONTHLY = "PROD_creatorMonthly";
    mocks.ensureCustomer.mockResolvedValue({ id: 1, authUserId: "user_123" });
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
    });
    mocks.waffoCheckoutCreate.mockResolvedValue({
      sessionId: "CHK_123",
      checkoutUrl:
        "https://pancake.waffo.ai/store/demo/checkout/CHK_123#token=test",
      expiresAt: "2026-08-04T12:00:00.000Z",
    });
  });

  afterEach(() => {
    delete process.env.WAFFO_PRODUCT_CREATOR_MONTHLY;
  });

  it("creates an authenticated Waffo checkout with server-owned metadata", async () => {
    const result = await createWaffoCheckout("user_123", "creator_monthly");

    expect(result).toEqual({
      success: true,
      url: "https://pancake.waffo.ai/store/demo/checkout/CHK_123#token=test",
    });
    expect(mocks.waffoCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "PROD_creatorMonthly",
        currency: "USD",
        buyerIdentity: "user_123",
        buyerEmail: "user@example.com",
        successUrl: "https://example.com/pricing?checkout=success&provider=waffo",
        metadata: expect.objectContaining({
          userId: "user_123",
          productKey: "creator_monthly",
          credits: "600",
        }),
      })
    );
    expect(mocks.createPendingFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "waffo",
        fulfillmentKey: "waffo:checkout:CHK_123:creator_monthly",
        providerCheckoutId: "CHK_123",
        providerProductId: "PROD_creatorMonthly",
        userId: "user_123",
        credits: 600,
      })
    );
  });

  it("rejects a missing Waffo product mapping before calling the SDK", async () => {
    delete process.env.WAFFO_PRODUCT_CREATOR_MONTHLY;

    await expect(
      createWaffoCheckout("user_123", "creator_monthly")
    ).resolves.toEqual({
      success: false,
      url: null,
      error: "Missing or invalid Waffo product ID",
    });
    expect(mocks.waffoCheckoutCreate).not.toHaveBeenCalled();
  });
});

function configureCustomerQuery() {
  mocks.db.select.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mocks.customerRows),
      })),
    })),
  });
}

describe("createStripeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerRows = [];
    configureCustomerQuery();
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    for (const [, , envName, priceId] of stripeCases) {
      process.env[envName] = priceId;
    }
    process.env.CREEM_API_KEY = "creem_test_123";
    process.env.CREEM_API_BASE_URL = "https://test-api.creem.io/v1";
    process.env.CREEM_PRODUCT_CREATOR_MONTHLY = "prod_creator_monthly";
    process.env.CREEM_PRODUCT_CREDIT_CREATOR = "prod_credit_creator";
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
    });
  });

  afterEach(() => {
    for (const [, , envName] of stripeCases) {
      delete process.env[envName];
    }
  });

  it.each(stripeCases)(
    "creates %s as %s with server-owned metadata",
    async (productKey, mode, _envName, priceId, credits) => {
      mocks.ensureCustomer.mockResolvedValue({
        id: 1,
        authUserId: "user_123",
        plan: "FREE",
        stripeCustomerId: null,
      });
      mocks.stripe.checkout.sessions.create.mockResolvedValue({
        url: "https://checkout.stripe.com/session",
      });

      await createStripeSession("user_123", productKey);

      const checkoutParams = mocks.stripe.checkout.sessions.create.mock.calls[0]![0];
      expect(checkoutParams).toEqual(
        expect.objectContaining({
          mode,
          line_items: [{ price: priceId, quantity: 1 }],
          metadata: {
            userId: "user_123",
            productKey,
            mode,
            credits: String(credits),
          },
        })
      );
      if (mode === "subscription") {
        expect(checkoutParams.subscription_data).toEqual({
          metadata: checkoutParams.metadata,
        });
      } else {
        expect(checkoutParams.payment_intent_data).toEqual({
          metadata: checkoutParams.metadata,
        });
      }
    }
  );

  it("rejects a missing authenticated user with an explicit error", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      stripeCustomerId: null,
    });
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(createStripeSession("user_123", "creator_monthly")).resolves.toEqual({
      success: false,
      url: null,
      error: "Missing user",
    });
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects a user without an email before calling Stripe", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      stripeCustomerId: null,
    });
    mocks.getCurrentUser.mockResolvedValue({ id: "user_123", email: null });

    await expect(createStripeSession("user_123", "creator_monthly")).resolves.toEqual({
      success: false,
      url: null,
      error: "Missing user email",
    });
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns an explicit error when Stripe omits the checkout URL", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      stripeCustomerId: null,
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({ url: null });

    await expect(createStripeSession("user_123", "creator_monthly")).resolves.toEqual({
      success: false,
      url: null,
      error: "Stripe checkout did not return a URL",
    });
  });

  it("creates subscription checkout with productKey metadata", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      stripeCustomerId: null,
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session",
    });

    const result = await createStripeSession("user_123", "creator_monthly");

    expect(result).toEqual({
      success: true,
      url: "https://checkout.stripe.com/session",
    });
    expect(mocks.ensureCustomer).toHaveBeenCalledWith("user_123");
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cancel_url: "https://example.com/pricing?checkout=cancelled",
        success_url:
          "https://example.com/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        client_reference_id: "user_123",
        line_items: [{ price: "price_creator_monthly", quantity: 1 }],
        mode: "subscription",
        subscription_data: {
          metadata: {
            userId: "user_123",
            productKey: "creator_monthly",
            mode: "subscription",
            credits: "600",
          },
        },
        metadata: {
          userId: "user_123",
          productKey: "creator_monthly",
          mode: "subscription",
          credits: "600",
        },
      })
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        payment_method_types: expect.any(Array),
      })
    );
  });

  it.each(stripeCases)(
    "rejects a missing Stripe price ID for %s before calling Stripe",
    async (productKey, _mode, envName) => {
      delete process.env[envName];

      const result = await createStripeSession("user_123", productKey);

      expect(result).toEqual({
        success: false,
        url: null,
        error: "Missing or invalid Stripe price ID",
      });
      expect(mocks.ensureCustomer).not.toHaveBeenCalled();
      expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    }
  );

  it("uses an existing Stripe customer when available", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      stripeCustomerId: "cus_123",
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session",
    });

    await createStripeSession("user_123", "creator_monthly");

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_123",
      })
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        customer_email: expect.any(String),
      })
    );
  });

  it("opens billing portal for paid Stripe customers", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "PRO",
      stripeCustomerId: "cus_123",
    });
    mocks.stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.com/session",
    });

    const result = await createStripeSession("user_123", "creator_monthly");

    expect(result).toEqual({
      success: true,
      url: "https://billing.stripe.com/session",
    });
    expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_123",
      return_url: "https://example.com/pricing?billing=return",
    });
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("does not create portal sessions without stripeCustomerId", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "PRO",
      stripeCustomerId: null,
    });

    const result = await createStripeSession("user_123", "creator_monthly");

    expect(result).toEqual({
      success: false,
      url: null,
      error: "Missing Stripe customer for paid plan",
    });
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("creates card-safe payment checkout without forcing optional wallets", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      stripeCustomerId: null,
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session",
    });

    const result = await createStripeSession("user_123", "credit_creator");

    expect(result.success).toBe(true);
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [{ price: "price_credit_creator", quantity: 1 }],
        payment_intent_data: {
          metadata: {
            userId: "user_123",
            productKey: "credit_creator",
            mode: "payment",
            credits: "600",
          },
        },
      })
    );
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        payment_method_types: expect.any(Array),
        payment_method_options: expect.any(Object),
      })
    );
  });

  it("keeps paid subscribers in checkout when buying credit packs", async () => {
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "PRO",
      stripeCustomerId: "cus_123",
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/session",
    });

    const result = await createStripeSession("user_123", "credit_creator");

    expect(result.success).toBe(true);
    expect(mocks.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalled();
  });
});

describe("billing return URLs", () => {
  const fallbackOrigin = "http://localhost:8080";

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it.each([
    [
      "https://example.com/base/path?unsafe=1#fragment",
      "https://example.com",
    ],
    ["https://example.com///", "https://example.com"],
    ["  http://localhost:9090/admin  ", "http://localhost:9090"],
  ])("builds every Stripe return URL from the configured origin for %s", (configured, origin) => {
    process.env.NEXT_PUBLIC_APP_URL = configured;

    expect(getStripeReturnUrls()).toEqual({
      checkoutSuccessUrl: `${origin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      checkoutCancelUrl: `${origin}/pricing?checkout=cancelled`,
      portalReturnUrl: `${origin}/pricing?billing=return`,
    });
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/store",
    "//example.com/store",
    "not a URL",
  ])("rejects unsafe or malformed app URL %s and uses the local origin", (configured) => {
    process.env.NEXT_PUBLIC_APP_URL = configured;

    expect(getStripeReturnUrls()).toEqual({
      checkoutSuccessUrl: `${fallbackOrigin}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      checkoutCancelUrl: `${fallbackOrigin}/pricing?checkout=cancelled`,
      portalReturnUrl: `${fallbackOrigin}/pricing?billing=return`,
    });
  });
});

describe("getMySubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.customerRows = [];
    configureCustomerQuery();
  });

  it("returns an explicit free inactive status when the user has no subscription row", async () => {
    await expect(getMySubscription("user_123")).resolves.toEqual({
      plan: "FREE",
      status: "inactive",
      cancelAtPeriodEnd: false,
      endsAt: null,
    });
  });

  it("uses the live Stripe subscription status and modern item period end", async () => {
    mocks.customerRows = [
      {
        plan: "PRO",
        stripeSubscriptionId: "sub_live",
        stripeCurrentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        billingProvider: "stripe",
        billingSubscriptionId: null,
        billingCurrentPeriodEnd: null,
      },
    ];
    mocks.stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_live",
      status: "active",
      cancel_at_period_end: true,
      items: {
        data: [{ current_period_end: 1_788_220_800 }],
      },
    });

    await expect(getMySubscription("user_123")).resolves.toEqual({
      plan: "PRO",
      status: "active",
      cancelAtPeriodEnd: true,
      endsAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("treats a future Stripe cancel_at as a scheduled cancellation", async () => {
    mocks.customerRows = [
      {
        plan: "PRO",
        stripeSubscriptionId: "sub_scheduled_cancel",
        stripeCurrentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
        billingProvider: "stripe",
        billingSubscriptionId: null,
        billingCurrentPeriodEnd: null,
      },
    ];
    mocks.stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_scheduled_cancel",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: 1_788_220_800,
      cancellation_details: { reason: "cancellation_requested" },
      items: {
        data: [{ current_period_end: 1_790_812_800 }],
      },
    });

    await expect(getMySubscription("user_123")).resolves.toEqual({
      plan: "PRO",
      status: "active",
      cancelAtPeriodEnd: true,
      endsAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("falls back to stored subscription state when no Stripe subscription exists", async () => {
    const endsAt = new Date("2099-01-01T00:00:00.000Z");
    mocks.customerRows = [
      {
        plan: "BUSINESS",
        stripeSubscriptionId: null,
        stripeCurrentPeriodEnd: null,
        billingProvider: "creem",
        billingSubscriptionId: "creem_sub_123",
        billingCurrentPeriodEnd: endsAt,
      },
    ];

    await expect(getMySubscription("user_123")).resolves.toEqual({
      plan: "BUSINESS",
      status: "active",
      cancelAtPeriodEnd: false,
      endsAt,
    });
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});

describe("createCreemCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    process.env.CREEM_API_KEY = "creem_test_123";
    process.env.CREEM_API_BASE_URL = "https://test-api.creem.io/v1";
    process.env.CREEM_PRODUCT_CREATOR_MONTHLY = "prod_creator_monthly";
    process.env.CREEM_PRODUCT_CREDIT_CREATOR = "prod_credit_creator";
    mocks.ensureCustomer.mockResolvedValue({
      id: 1,
      authUserId: "user_123",
      plan: "FREE",
      billingCustomerId: null,
    });
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          id: "ch_123",
          checkout_url: "https://checkout.creem.io/ch_123",
        })
      )
    );
  });

  it("creates Creem checkout from a server-side productKey mapping", async () => {
    const result = await createCreemCheckout("user_123", "creator_monthly");

    expect(result).toEqual({
      success: true,
      url: "https://checkout.creem.io/ch_123",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://test-api.creem.io/v1/checkouts",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "creem_test_123",
        },
        body: expect.any(String),
      })
    );
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual(
      expect.objectContaining({
        product_id: "prod_creator_monthly",
        success_url: "https://example.com/pricing?checkout=success&provider=creem",
        customer: { email: "user@example.com" },
        metadata: expect.objectContaining({
          userId: "user_123",
          productKey: "creator_monthly",
          mode: "subscription",
          credits: "600",
        }),
      })
    );
    expect(mocks.createPendingFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "creem",
        fulfillmentKey: "creem:checkout:ch_123:creator_monthly",
        providerCheckoutId: "ch_123",
        providerProductId: "prod_creator_monthly",
        productKey: "creator_monthly",
        userId: "user_123",
        credits: 600,
      })
    );
  });

  it("rejects missing Creem product IDs before calling Creem", async () => {
    delete process.env.CREEM_PRODUCT_CREATOR_MONTHLY;

    const result = await createCreemCheckout("user_123", "creator_monthly");

    expect(result).toEqual({
      success: false,
      url: null,
      error: "Missing or invalid Creem product ID",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.createPendingFulfillment).not.toHaveBeenCalled();
  });
});
