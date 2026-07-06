import type { Stripe } from "stripe";

export function checkoutCompletedEvent(
  overrides: Partial<Stripe.Checkout.Session> = {}
) {
  return {
    id: "evt_checkout_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        object: "checkout.session",
        client_reference_id: "user_123",
        customer: "cus_123",
        subscription: "sub_123",
        mode: "subscription",
        metadata: {
          userId: "user_123",
          productKey: "creator_monthly",
          credits: "600",
        },
        ...overrides,
      },
    },
  } as unknown as Stripe.DiscriminatedEvent;
}

export function checkoutPaymentCompletedEvent(
  overrides: Partial<Stripe.Checkout.Session> = {}
) {
  return checkoutCompletedEvent({
    id: "cs_credit_123",
    client_reference_id: "user_123",
    customer: "cus_123",
    subscription: null,
    payment_intent: "pi_credit_123",
    mode: "payment",
    payment_status: "paid",
    metadata: {
      userId: "user_123",
      productKey: "credit_creator",
      credits: "600",
    },
    ...overrides,
  });
}

export function checkoutAsyncPaymentSucceededEvent(
  overrides: Partial<Stripe.Checkout.Session> = {}
) {
  return {
    ...checkoutPaymentCompletedEvent(overrides),
    id: "evt_checkout_async_success",
    type: "checkout.session.async_payment_succeeded",
  } as unknown as Stripe.DiscriminatedEvent;
}

export function checkoutAsyncPaymentFailedEvent(
  overrides: Partial<Stripe.Checkout.Session> = {}
) {
  return {
    id: "evt_checkout_async_failed",
    type: "checkout.session.async_payment_failed",
    data: {
      object: {
        id: "cs_async_failed_123",
        object: "checkout.session",
        client_reference_id: "user_123",
        customer: "cus_123",
        subscription: null,
        payment_intent: "pi_failed_123",
        mode: "payment",
        payment_status: "unpaid",
        metadata: {
          userId: "user_123",
          productKey: "credit_creator",
          credits: "600",
        },
        ...overrides,
      },
    },
  } as unknown as Stripe.DiscriminatedEvent;
}

export function invoicePaymentSucceededEvent(
  overrides: Partial<Stripe.Invoice> = {}
) {
  return {
    id: "evt_invoice_paid",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_123",
        object: "invoice",
        customer: "cus_123",
        subscription: "sub_123",
        billing_reason: "subscription_cycle",
        status: "paid",
        lines: {
          object: "list",
          data: [
            {
              id: "il_123",
              object: "line_item",
              price: { id: "price_pro_monthly", object: "price" },
            },
          ],
        },
        subscription_details: {
          metadata: {
            userId: "user_123",
            productKey: "creator_monthly",
          },
        },
        ...overrides,
      },
    },
  } as unknown as Stripe.DiscriminatedEvent;
}

export function invoicePaidEvent(overrides: Partial<Stripe.Invoice> = {}) {
  return {
    ...invoicePaymentSucceededEvent(overrides),
    id: "evt_invoice_paid_alias",
    type: "invoice.paid",
  } as unknown as Stripe.DiscriminatedEvent;
}

export function invoicePaymentFailedEvent(
  overrides: Partial<Stripe.Invoice> = {}
) {
  return {
    ...invoicePaymentSucceededEvent({
      id: "in_failed_123",
      status: "open",
      ...overrides,
    }),
    id: "evt_invoice_payment_failed",
    type: "invoice.payment_failed",
  } as unknown as Stripe.DiscriminatedEvent;
}

export function subscriptionUpdatedEvent(
  overrides: Partial<Stripe.Subscription> = {}
) {
  return {
    id: "evt_subscription_updated",
    type: "customer.subscription.updated",
    data: {
      object: stripeSubscription(overrides),
    },
  } as unknown as Stripe.DiscriminatedEvent;
}

export function subscriptionDeletedEvent(
  overrides: Partial<Stripe.Subscription> = {}
) {
  return {
    id: "evt_subscription_deleted",
    type: "customer.subscription.deleted",
    data: {
      object: stripeSubscription(overrides),
    },
  } as unknown as Stripe.DiscriminatedEvent;
}

export function stripeSubscription(
  overrides: Partial<Stripe.Subscription> = {}
) {
  return {
    id: "sub_123",
    object: "subscription",
    customer: "cus_123",
    metadata: { userId: "user_123", productKey: "creator_monthly" },
    current_period_end: 1_800_000_000,
    cancel_at_period_end: false,
    items: {
      object: "list",
      data: [
        {
          id: "si_123",
          object: "subscription_item",
          price: {
            id: "price_pro_monthly",
            object: "price",
          },
        },
      ],
    },
    ...overrides,
  } as Stripe.Subscription;
}

export function chargeRefundedEvent(overrides: Partial<Stripe.Charge> = {}) {
  return {
    id: "evt_charge_refunded",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_123",
        object: "charge",
        customer: "cus_123",
        payment_intent: "pi_credit_123",
        refunded: true,
        metadata: {
          userId: "user_123",
          productKey: "credit_creator",
          credits: "600",
        },
        ...overrides,
      },
    },
  } as unknown as Stripe.DiscriminatedEvent;
}

export function refundUpdatedEvent(overrides: Partial<Stripe.Refund> = {}) {
  return {
    id: "evt_refund_updated",
    type: "refund.updated",
    data: {
      object: {
        id: "re_123",
        object: "refund",
        charge: "ch_123",
        payment_intent: "pi_credit_123",
        status: "succeeded",
        ...overrides,
      },
    },
  } as unknown as Stripe.DiscriminatedEvent;
}
