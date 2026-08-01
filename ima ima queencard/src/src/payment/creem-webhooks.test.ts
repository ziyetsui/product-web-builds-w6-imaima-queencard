import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomerByBillingCustomerId: vi.fn(),
  getCustomerByBillingSubscriptionId: vi.fn(),
  updateCustomerByBillingCustomerId: vi.fn(),
  updateCustomerByBillingSubscriptionId: vi.fn(),
  upsertCustomerByAuthUserId: vi.fn(),
  createPendingFulfillment: vi.fn(),
  fulfillCreditGrantOnce: vi.fn(),
  markRefunded: vi.fn(),
  markSkipped: vi.fn(),
}));

vi.mock("@/services/customer", () => ({
  getCustomerByBillingCustomerId: mocks.getCustomerByBillingCustomerId,
  getCustomerByBillingSubscriptionId: mocks.getCustomerByBillingSubscriptionId,
  updateCustomerByBillingCustomerId: mocks.updateCustomerByBillingCustomerId,
  updateCustomerByBillingSubscriptionId:
    mocks.updateCustomerByBillingSubscriptionId,
  upsertCustomerByAuthUserId: mocks.upsertCustomerByAuthUserId,
}));

vi.mock("@/services/payment-fulfillment", () => ({
  createPendingFulfillment: mocks.createPendingFulfillment,
  fulfillCreditGrantOnce: mocks.fulfillCreditGrantOnce,
  markRefunded: mocks.markRefunded,
  markSkipped: mocks.markSkipped,
}));

import { handleCreemEvent, verifyCreemSignature } from "./creem-webhooks";

describe("Creem webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CREEM_PRODUCT_CREDIT_CREATOR =
      "prod_MpQpZNBEIqYQLDWlqOWXp";
    process.env.CREEM_PRODUCT_CREATOR_MONTHLY =
      "prod_5oY1tymF5Z1BVzSf6senQ9";
  });

  it("verifies HMAC-SHA256 webhook signatures", () => {
    const payload = JSON.stringify({ eventType: "checkout.completed" });
    const signature = createHmac("sha256", "whsec_test")
      .update(payload)
      .digest("hex");

    expect(verifyCreemSignature(payload, signature, "whsec_test")).toBe(true);
    expect(verifyCreemSignature(payload, "deadbeef", "whsec_test")).toBe(false);
  });

  it("fulfills one-time credit packs from checkout.completed", async () => {
    await handleCreemEvent({
      id: "evt_checkout",
      eventType: "checkout.completed",
      object: {
        id: "ch_123",
        request_id: "imaima:user_123:credit_creator:req",
        product: { id: "prod_MpQpZNBEIqYQLDWlqOWXp" },
        order: { id: "ord_123" },
        customer: { id: "cust_123" },
        status: "completed",
      },
    });

    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "creem",
        fulfillmentKey: "creem:checkout:ch_123:credit_creator",
        eventId: "evt_checkout",
        eventType: "checkout.completed",
        providerCustomerId: "cust_123",
        providerCheckoutId: "ch_123",
        providerOrderId: "ord_123",
        providerProductId: "prod_MpQpZNBEIqYQLDWlqOWXp",
        userId: "user_123",
        productKey: "credit_creator",
        credits: 600,
        transType: "ORDER_PAY",
        orderNo: "creem_order_ord_123",
        expiryDays: 365,
      })
    );
  });

  it("syncs and fulfills paid subscription periods", async () => {
    await handleCreemEvent({
      id: "evt_sub_paid",
      eventType: "subscription.paid",
      object: {
        request_id: "imaima:user_123:creator_monthly:req",
        product: { id: "prod_5oY1tymF5Z1BVzSf6senQ9" },
        subscription_id: "sub_123",
        transaction_id: "txn_123",
        customer: { id: "cust_123" },
        current_period_end: 1_800_000_000,
      },
    });

    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        billingProvider: "creem",
        billingCustomerId: "cust_123",
        billingSubscriptionId: "sub_123",
        billingProductId: "prod_5oY1tymF5Z1BVzSf6senQ9",
        plan: "PRO",
      })
    );
    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "creem",
        fulfillmentKey:
          "creem:subscription-paid:sub_123:txn_123:creator_monthly",
        providerSubscriptionId: "sub_123",
        providerTransactionId: "txn_123",
        userId: "user_123",
        productKey: "creator_monthly",
        credits: 600,
        transType: "SUBSCRIPTION",
        orderNo: "creem_subscription_sub_123",
        expiryDays: 30,
      })
    );
  });
});
