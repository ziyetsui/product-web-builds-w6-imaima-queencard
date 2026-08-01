import { afterEach, describe, expect, it } from "vitest";

import {
  PRICING_PRODUCTS,
  getCreditPackPricingProducts,
  getEnabledPricingProducts,
  getPricingProduct,
  getProductByCreemProductId,
  getProductByStripePriceId,
  getSubscriptionPricingProducts,
  resolveCreemProductId,
  resolveStripePriceId,
} from "./pricing-products";

const stripeEnvNames = PRICING_PRODUCTS.map((product) => product.stripePriceEnv);
const creemEnvNames = PRICING_PRODUCTS.map((product) => product.creemProductEnv);

afterEach(() => {
  for (const envName of stripeEnvNames) {
    delete process.env[envName];
  }
  for (const envName of creemEnvNames) {
    delete process.env[envName];
  }
});

describe("pricing products", () => {
  it("defines the six billable catalog products", () => {
    expect(PRICING_PRODUCTS.map((product) => product.key)).toEqual([
      "creator_monthly",
      "creator_annual",
      "studio_monthly",
      "studio_annual",
      "credit_creator",
      "credit_studio",
    ]);
  });

  it("keeps every enabled product billable with credits and RMB pricing", () => {
    const envNames = new Set<string>();
    const creemEnvNameSet = new Set<string>();

    for (const product of getEnabledPricingProducts()) {
      expect(product.credits).toBeGreaterThan(0);
      expect(product.priceUsd).toBeGreaterThan(0);
      expect(product.priceCny).toBeGreaterThan(0);
      expect(product.validityDays).toBeGreaterThan(0);
      expect(product.stripePriceEnv).toMatch(/^STRIPE_PRICE_/);
      expect(product.creemProductEnv).toMatch(/^CREEM_PRODUCT_/);
      expect(envNames.has(product.stripePriceEnv)).toBe(false);
      expect(creemEnvNameSet.has(product.creemProductEnv)).toBe(false);
      envNames.add(product.stripePriceEnv);
      creemEnvNameSet.add(product.creemProductEnv);
      expect(product.creemBillingType).toBe(
        product.mode === "subscription" ? "recurring" : "onetime"
      );
    }
  });

  it("maps subscription products to subscription plans only", () => {
    expect(getSubscriptionPricingProducts().map((product) => product.key)).toEqual([
      "creator_monthly",
      "creator_annual",
      "studio_monthly",
      "studio_annual",
    ]);
    expect(getPricingProduct("creator_monthly")?.plan).toBe("PRO");
    expect(getPricingProduct("studio_annual")?.plan).toBe("BUSINESS");
  });

  it("keeps credit packs out of subscription plan mapping", () => {
    const creditPacks = getCreditPackPricingProducts();

    expect(creditPacks.map((product) => product.key)).toEqual([
      "credit_creator",
      "credit_studio",
    ]);
    expect(creditPacks.every((product) => product.plan === null)).toBe(true);
    expect(creditPacks.every((product) => product.mode === "payment")).toBe(true);
  });

  it("resolves Stripe price IDs from server-only env vars", () => {
    process.env.STRIPE_PRICE_CREATOR_MONTHLY = " price_creator_monthly ";

    expect(resolveStripePriceId("creator_monthly")).toBe("price_creator_monthly");
    expect(resolveStripePriceId("missing")).toBeNull();
    expect(resolveStripePriceId("studio_monthly")).toBeNull();
  });

  it("finds products by configured Stripe price ID", () => {
    process.env.STRIPE_PRICE_CREDIT_STUDIO = "price_credit_studio";

    expect(getProductByStripePriceId(" price_credit_studio ")?.key).toBe(
      "credit_studio"
    );
    expect(getProductByStripePriceId("price_unknown")).toBeNull();
  });

  it("resolves Creem product IDs from server-only env vars", () => {
    process.env.CREEM_PRODUCT_CREATOR_MONTHLY =
      " prod_5oY1tymF5Z1BVzSf6senQ9 ";

    expect(resolveCreemProductId("creator_monthly")).toBe(
      "prod_5oY1tymF5Z1BVzSf6senQ9"
    );
    expect(resolveCreemProductId("missing")).toBeNull();
    expect(resolveCreemProductId("studio_monthly")).toBeNull();
  });

  it("finds products by configured Creem product ID", () => {
    process.env.CREEM_PRODUCT_CREDIT_STUDIO =
      "prod_55Wb84h6LVWyXfH9ABlnwu";

    expect(getProductByCreemProductId(" prod_55Wb84h6LVWyXfH9ABlnwu ")?.key).toBe(
      "credit_studio"
    );
    expect(getProductByCreemProductId("price_unknown")).toBeNull();
  });
});
