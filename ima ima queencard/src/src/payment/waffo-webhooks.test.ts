import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomerByBillingSubscriptionId: vi.fn(),
  upsertCustomerByAuthUserId: vi.fn(),
  updateCustomerByBillingSubscriptionId: vi.fn(),
  createPendingFulfillment: vi.fn(),
  fulfillCreditGrantOnce: vi.fn(),
  markRefunded: vi.fn(),
  markSkipped: vi.fn(),
}));

vi.mock("@/services/customer", () => ({
  getCustomerByBillingSubscriptionId: mocks.getCustomerByBillingSubscriptionId,
  upsertCustomerByAuthUserId: mocks.upsertCustomerByAuthUserId,
  updateCustomerByBillingSubscriptionId:
    mocks.updateCustomerByBillingSubscriptionId,
}));

vi.mock("@/services/payment-fulfillment", () => ({
  createPendingFulfillment: mocks.createPendingFulfillment,
  fulfillCreditGrantOnce: mocks.fulfillCreditGrantOnce,
  markRefunded: mocks.markRefunded,
  markSkipped: mocks.markSkipped,
}));

import type { WaffoWebhookEvent } from "./waffo-webhooks";
import { handleWaffoEvent } from "./waffo-webhooks";

function event(
  eventType: string,
  overrides: Partial<WaffoWebhookEvent["data"]> = {}
): WaffoWebhookEvent {
  return {
    id: "delivery_123",
    timestamp: "2026-08-04T08:00:00.000Z",
    eventType,
    eventId: "PAY_123",
    storeId: "STO_123",
    storeName: "ima ima queencard",
    mode: "test",
    data: {
      orderId: "ORD_123",
      buyerEmail: "user@example.com",
      merchantProvidedBuyerIdentity: "user_123",
      currency: "USD",
      amount: "14.90",
      taxAmount: "0.00",
      productName: "Creator",
      paymentId: "PAY_123",
      orderMetadata: {
        userId: "user_123",
        productKey: "credit_creator",
      },
      ...overrides,
    },
  };
}

describe("Waffo webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WAFFO_PRODUCT_CREATOR_MONTHLY = "PROD_creatorMonthly";
  });

  it("fulfills a one-time order once using the delivery ID", async () => {
    await handleWaffoEvent(event("order.completed"));

    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "waffo",
        fulfillmentKey: "waffo:event:delivery_123",
        eventId: "delivery_123",
        providerOrderId: "ORD_123",
        providerTransactionId: "PAY_123",
        userId: "user_123",
        productKey: "credit_creator",
        credits: 600,
        transType: "ORDER_PAY",
      })
    );
  });

  it("syncs an activated subscription and grants its first period", async () => {
    await handleWaffoEvent(
      event("subscription.activated", {
        billingPeriod: "monthly",
        currentPeriodEnd: "2026-09-04",
        orderMetadata: {
          userId: "user_123",
          productKey: "creator_monthly",
        },
      })
    );

    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        billingProvider: "waffo",
        billingSubscriptionId: "ORD_123",
        billingProductId: "PROD_creatorMonthly",
        plan: "PRO",
      })
    );
    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentKey: "waffo:event:delivery_123",
        productKey: "creator_monthly",
        credits: 600,
        transType: "SUBSCRIPTION",
      })
    );
  });

  it("returns a fully canceled subscription to the free plan", async () => {
    await handleWaffoEvent(
      event("subscription.canceled", {
        billingPeriod: "monthly",
        orderMetadata: {
          userId: "user_123",
          productKey: "creator_monthly",
        },
      })
    );

    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        billingProvider: "waffo",
        billingSubscriptionId: null,
        billingProductId: null,
        billingCurrentPeriodEnd: null,
        plan: "FREE",
      })
    );
  });
});
