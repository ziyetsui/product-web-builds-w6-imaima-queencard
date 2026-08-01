import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureCustomer: vi.fn(),
  getCurrentUser: vi.fn(),
  createPendingFulfillment: vi.fn(),
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
  },
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

import { createCreemCheckout, createStripeSession } from "./billing";

describe("createStripeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
    process.env.STRIPE_PRICE_CREATOR_MONTHLY = "price_creator_monthly";
    process.env.STRIPE_PRICE_CREDIT_CREATOR = "price_credit_creator";
    process.env.CREEM_API_KEY = "creem_test_123";
    process.env.CREEM_API_BASE_URL = "https://test-api.creem.io/v1";
    process.env.CREEM_PRODUCT_CREATOR_MONTHLY = "prod_creator_monthly";
    process.env.CREEM_PRODUCT_CREDIT_CREATOR = "prod_credit_creator";
    mocks.getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
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

  it("rejects missing Stripe price IDs before calling Stripe", async () => {
    delete process.env.STRIPE_PRICE_CREATOR_MONTHLY;

    const result = await createStripeSession("user_123", "creator_monthly");

    expect(result).toEqual({
      success: false,
      url: null,
      error: "Missing or invalid Stripe price ID",
    });
    expect(mocks.ensureCustomer).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

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

  it("creates payment checkout for one-time credit packs", async () => {
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
        payment_method_types: ["card", "alipay", "wechat_pay"],
        payment_method_options: {
          wechat_pay: { client: "web" },
        },
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
