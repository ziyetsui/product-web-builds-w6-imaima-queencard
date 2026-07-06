import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chargeRefundedEvent,
  checkoutAsyncPaymentFailedEvent,
  checkoutAsyncPaymentSucceededEvent,
  checkoutCompletedEvent,
  checkoutPaymentCompletedEvent,
  invoicePaidEvent,
  invoicePaymentFailedEvent,
  invoicePaymentSucceededEvent,
  stripeSubscription,
  subscriptionDeletedEvent,
  subscriptionUpdatedEvent,
} from "@/test/fixtures/stripe-events";

const mocks = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  upsertCustomerByAuthUserId: vi.fn(),
  updateCustomerByStripeCustomerId: vi.fn(),
  updateCustomerByStripeSubscriptionId: vi.fn(),
  createPendingFulfillment: vi.fn(),
  fulfillCreditGrantOnce: vi.fn(),
  markFailed: vi.fn(),
  markRefunded: vi.fn(),
  markSkipped: vi.fn(),
}));

vi.mock(".", () => ({
  stripe: {
    subscriptions: {
      retrieve: mocks.retrieveSubscription,
    },
  },
}));

vi.mock("@/services/customer", () => ({
  upsertCustomerByAuthUserId: mocks.upsertCustomerByAuthUserId,
  updateCustomerByStripeCustomerId: mocks.updateCustomerByStripeCustomerId,
  updateCustomerByStripeSubscriptionId:
    mocks.updateCustomerByStripeSubscriptionId,
}));

vi.mock("@/services/payment-fulfillment", () => ({
  createPendingFulfillment: mocks.createPendingFulfillment,
  fulfillCreditGrantOnce: mocks.fulfillCreditGrantOnce,
  markFailed: mocks.markFailed,
  markRefunded: mocks.markRefunded,
  markSkipped: mocks.markSkipped,
}));

vi.mock("./plans", () => ({
  getSubscriptionPlan: (priceId: string | undefined) =>
    priceId === "price_business_monthly" ? "BUSINESS" : priceId ? "PRO" : "FREE",
}));

import { handleEvent } from "./webhooks";

describe("handleEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieveSubscription.mockResolvedValue(stripeSubscription());
    mocks.upsertCustomerByAuthUserId.mockResolvedValue({ id: 1 });
    mocks.updateCustomerByStripeCustomerId.mockResolvedValue({ id: 1 });
    mocks.updateCustomerByStripeSubscriptionId.mockResolvedValue({ id: 1 });
    mocks.createPendingFulfillment.mockResolvedValue({ id: 1 });
    mocks.fulfillCreditGrantOnce.mockResolvedValue({
      fulfilled: true,
      packageId: 1,
    });
    mocks.markFailed.mockResolvedValue({ id: 1 });
    mocks.markRefunded.mockResolvedValue({ id: 1 });
    mocks.markSkipped.mockResolvedValue({ id: 1 });
  });

  it("syncs subscription checkout without granting subscription credits", async () => {
    await handleEvent(checkoutCompletedEvent());

    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub_123");
    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_pro_monthly",
        plan: "PRO",
      })
    );
    expect(mocks.fulfillCreditGrantOnce).not.toHaveBeenCalled();
  });

  it("grants subscription credits from invoice.payment_succeeded", async () => {
    await handleEvent(invoicePaymentSucceededEvent());

    expect(mocks.retrieveSubscription).toHaveBeenCalledWith("sub_123");
    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_pro_monthly",
        plan: "PRO",
      })
    );
    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentKey: "stripe:invoice:in_123",
        productKey: "creator_monthly",
        userId: "user_123",
        credits: 600,
        orderNo: "stripe_invoice_in_123",
      })
    );
  });

  it("uses the same invoice fulfillment key for invoice.paid alias", async () => {
    await handleEvent(invoicePaidEvent());

    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentKey: "stripe:invoice:in_123",
      })
    );
  });

  it("falls back to stripeCustomerId when subscription metadata has no userId", async () => {
    mocks.retrieveSubscription.mockResolvedValue(
      stripeSubscription({ metadata: {} })
    );

    await handleEvent(invoicePaymentSucceededEvent());

    expect(mocks.upsertCustomerByAuthUserId).not.toHaveBeenCalled();
    expect(mocks.updateCustomerByStripeCustomerId).toHaveBeenCalledWith(
      "cus_123",
      expect.objectContaining({
        stripeSubscriptionId: "sub_123",
        stripePriceId: "price_pro_monthly",
      })
    );
    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_123",
      })
    );
  });

  it("updates customer.subscription.updated directly from subscription payload", async () => {
    await handleEvent(
      subscriptionUpdatedEvent({
        items: {
          object: "list",
          data: [
            {
              id: "si_business",
              object: "subscription_item",
              price: { id: "price_business_monthly", object: "price" },
            },
          ],
        } as never,
      })
    );

    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        plan: "BUSINESS",
        stripePriceId: "price_business_monthly",
      })
    );
  });

  it("downgrades customer.subscription.deleted to FREE", async () => {
    await handleEvent(subscriptionDeletedEvent());

    expect(mocks.upsertCustomerByAuthUserId).toHaveBeenCalledWith(
      "user_123",
      expect.objectContaining({
        plan: "FREE",
        stripeSubscriptionId: null,
        stripePriceId: null,
        stripeCurrentPeriodEnd: null,
      })
    );
  });

  it("grants one-time credit packs from paid checkout sessions", async () => {
    await handleEvent(checkoutPaymentCompletedEvent());

    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentKey: "stripe:payment_intent:pi_credit_123",
        productKey: "credit_creator",
        userId: "user_123",
        credits: 600,
        orderNo: "stripe_pi_pi_credit_123",
      })
    );
  });

  it("uses the same payment intent fulfillment key for async wallet success", async () => {
    await handleEvent(checkoutAsyncPaymentSucceededEvent());

    expect(mocks.fulfillCreditGrantOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        fulfillmentKey: "stripe:payment_intent:pi_credit_123",
      })
    );
  });

  it("records async wallet and invoice failures without granting credits", async () => {
    await handleEvent(checkoutAsyncPaymentFailedEvent());
    await handleEvent(invoicePaymentFailedEvent());

    expect(mocks.fulfillCreditGrantOnce).not.toHaveBeenCalled();
    expect(mocks.markSkipped).toHaveBeenCalledTimes(2);
  });

  it("marks refunded charges without granting negative credits", async () => {
    await handleEvent(chargeRefundedEvent());

    expect(mocks.fulfillCreditGrantOnce).not.toHaveBeenCalled();
    expect(mocks.markRefunded).toHaveBeenCalledWith(
      "stripe:payment_intent:pi_credit_123",
      null,
      { chargeId: "ch_123" }
    );
  });
});
