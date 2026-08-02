import type Stripe from "stripe";

import { CreditTransType, SubscriptionPlan } from "@/db";
import {
  getPricingProduct,
  getProductByStripePriceId,
} from "@/config/pricing-products";
import {
  updateCustomerByStripeCustomerId,
  updateCustomerByStripeSubscriptionId,
  upsertCustomerByAuthUserId,
} from "@/services/customer";
import {
  createPendingFulfillment,
  fulfillCreditGrantOnce,
  markFailed,
  markRefunded,
  markSkipped,
} from "@/services/payment-fulfillment";

import { stripe } from ".";
import { getSubscriptionPlan } from "./plans";

type StripeSubscriptionSyncFields = {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeCurrentPeriodEnd: Date | null;
  plan: SubscriptionPlan;
};

function getSubscriptionId(
  subscription: string | Stripe.Subscription | null | undefined
) {
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function getStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
) {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function getSubscriptionPriceId(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.price?.id ?? null;
}

function getPaymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null | undefined
) {
  if (!paymentIntent) return null;
  return typeof paymentIntent === "string" ? paymentIntent : paymentIntent.id;
}

function getChargeId(charge: string | Stripe.Charge | null | undefined) {
  if (!charge) return null;
  return typeof charge === "string" ? charge : charge.id;
}

function getMetadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getEventId(event: Stripe.DiscriminatedEvent) {
  return (event as Stripe.Event).id;
}

function getInvoiceLinePriceId(invoice: Stripe.Invoice) {
  const line = invoice.lines?.data[0] as
    | (Stripe.InvoiceLineItem & {
        pricing?: {
          price_details?: { price?: string | null } | null;
        } | null;
      })
    | undefined;

  return line?.price?.id ?? line?.pricing?.price_details?.price ?? null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const modernInvoice = invoice as Stripe.Invoice & {
    parent?: {
      subscription_details?: {
        subscription?: string | Stripe.Subscription | null;
      } | null;
    } | null;
  };
  const line = invoice.lines?.data[0] as
    | (Stripe.InvoiceLineItem & {
        parent?: {
          subscription_item_details?: {
            subscription?: string | Stripe.Subscription | null;
          } | null;
        } | null;
      })
    | undefined;

  return getSubscriptionId(
    invoice.subscription ??
      modernInvoice.parent?.subscription_details?.subscription ??
      line?.parent?.subscription_item_details?.subscription
  );
}

function getInvoiceSubscriptionMetadata(invoice: Stripe.Invoice) {
  const modernInvoice = invoice as Stripe.Invoice & {
      subscription_details?: { metadata?: Stripe.Metadata | null };
      parent?: {
        subscription_details?: { metadata?: Stripe.Metadata | null } | null;
      } | null;
    };
  return (
    modernInvoice.subscription_details?.metadata ??
    modernInvoice.parent?.subscription_details?.metadata ??
    null
  );
}

function getProductFromMetadataOrPrice(
  metadata: Stripe.Metadata | null | undefined,
  stripePriceId: string | null | undefined
) {
  const productKey = getMetadataValue(metadata, "productKey");
  return productKey
    ? getPricingProduct(productKey)
    : getProductByStripePriceId(stripePriceId);
}

async function recordSkippedFulfillment(
  params: Parameters<typeof createPendingFulfillment>[0],
  reason: string
) {
  await createPendingFulfillment(params);
  return markSkipped(params.fulfillmentKey, reason, params.metadata ?? null);
}

async function recordFailedFulfillment(
  params: Parameters<typeof createPendingFulfillment>[0],
  error: unknown
) {
  await createPendingFulfillment(params);
  return markFailed(params.fulfillmentKey, error);
}

function getSubscriptionSyncFields(
  subscription: Stripe.Subscription,
  mode: "active" | "deleted" = "active"
): StripeSubscriptionSyncFields | null {
  const stripeCustomerId = getStripeCustomerId(subscription.customer);
  if (!stripeCustomerId) return null;

  if (mode === "deleted") {
    return {
      stripeCustomerId,
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeCurrentPeriodEnd: null,
      plan: SubscriptionPlan.FREE,
    };
  }

  const stripePriceId = getSubscriptionPriceId(subscription);

  return {
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId,
    stripeCurrentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    plan: getSubscriptionPlan(stripePriceId ?? undefined),
  };
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  options: { userId?: string | null; mode?: "active" | "deleted" } = {}
) {
  const fields = getSubscriptionSyncFields(subscription, options.mode);
  if (!fields) {
    console.warn("[Stripe] Subscription missing customer id", {
      subscriptionId: subscription.id,
    });
    return null;
  }

  const userId = options.userId || subscription.metadata?.userId;
  if (userId) {
    return upsertCustomerByAuthUserId(userId, fields);
  }

  const byStripeCustomer = await updateCustomerByStripeCustomerId(
    fields.stripeCustomerId,
    fields
  );
  if (byStripeCustomer) return byStripeCustomer;

  if (subscription.id) {
    const bySubscription = await updateCustomerByStripeSubscriptionId(
      subscription.id,
      fields
    );
    if (bySubscription) return bySubscription;
  }

  console.warn("[Stripe] No local customer matched webhook event", {
    stripeCustomerId: fields.stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });
  return null;
}

async function handleSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session) {
  const subscriptionId = getSubscriptionId(session.subscription);
  if (!subscriptionId) {
    console.warn("[Stripe] Checkout completed without subscription", {
      sessionId: session.id,
    });
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = session.client_reference_id || subscription.metadata?.userId;
  return syncSubscription(subscription, { userId });
}

async function fulfillOneTimeCheckout(
  event: Stripe.DiscriminatedEvent,
  session: Stripe.Checkout.Session
) {
  const paymentIntentId = getPaymentIntentId(session.payment_intent);
  const fulfillmentKey = paymentIntentId
    ? `stripe:payment_intent:${paymentIntentId}`
    : `stripe:checkout_session:${session.id}`;
  const metadata = session.metadata ?? {};
  const product = getProductFromMetadataOrPrice(metadata, null);
  const userId =
    session.client_reference_id || getMetadataValue(metadata, "userId");

  const baseFulfillment = {
    fulfillmentKey,
    eventId: getEventId(event),
    eventType: event.type,
    stripeCustomerId: getStripeCustomerId(session.customer),
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    productKey: product?.key ?? getMetadataValue(metadata, "productKey"),
    stripePriceId: null,
    userId,
    credits: product?.credits ?? 0,
    metadata: {
      paymentStatus: session.payment_status,
      mode: session.mode,
    },
  };

  if (session.payment_status !== "paid") {
    return recordSkippedFulfillment(
      {
        ...baseFulfillment,
        fulfillmentKey: `stripe:checkout_unpaid:${session.id}`,
      },
      `Checkout payment_status is ${session.payment_status}`
    );
  }

  if (!userId) {
    return recordFailedFulfillment(baseFulfillment, "Missing userId");
  }

  if (!product || product.mode !== "payment") {
    return recordFailedFulfillment(baseFulfillment, "Unknown payment product");
  }

  return fulfillCreditGrantOnce({
    ...baseFulfillment,
    fulfillmentKey,
    userId,
    productKey: product.key,
    credits: product.credits,
    transType: CreditTransType.ORDER_PAY,
    orderNo: paymentIntentId
      ? `stripe_pi_${paymentIntentId}`
      : `stripe_cs_${session.id}`,
    expiryDays: product.validityDays,
    remark: `Stripe credit pack: ${product.title}`,
  });
}

async function handleCheckoutCompleted(
  event: Stripe.DiscriminatedEvent,
  session: Stripe.Checkout.Session
) {
  if (session.mode === "payment") {
    return fulfillOneTimeCheckout(event, session);
  }

  return handleSubscriptionCheckoutCompleted(session);
}

async function fulfillSubscriptionInvoice(
  event: Stripe.DiscriminatedEvent,
  invoice: Stripe.Invoice,
  subscription: Stripe.Subscription
) {
  const invoiceMetadata = invoice.metadata ?? {};
  const subscriptionMetadata =
    getInvoiceSubscriptionMetadata(invoice) ?? subscription.metadata ?? {};
  const stripePriceId =
    getInvoiceLinePriceId(invoice) ?? getSubscriptionPriceId(subscription);
  const product =
    getProductFromMetadataOrPrice(invoiceMetadata, stripePriceId) ??
    getProductFromMetadataOrPrice(subscriptionMetadata, stripePriceId);
  const userId =
    getMetadataValue(invoiceMetadata, "userId") ||
    getMetadataValue(subscriptionMetadata, "userId") ||
    subscription.metadata?.userId ||
    null;
  const paymentIntentId = getPaymentIntentId(
    (invoice as Stripe.Invoice & {
      payment_intent?: string | Stripe.PaymentIntent | null;
    }).payment_intent
  );

  const baseFulfillment = {
    fulfillmentKey: `stripe:invoice:${invoice.id}`,
    eventId: getEventId(event),
    eventType: event.type,
    stripeCustomerId: getStripeCustomerId(invoice.customer),
    stripeSubscriptionId: subscription.id,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: paymentIntentId,
    productKey: product?.key ?? getMetadataValue(subscriptionMetadata, "productKey"),
    stripePriceId,
    userId,
    credits: product?.credits ?? 0,
    metadata: {
      billingReason: invoice.billing_reason,
      status: invoice.status,
    },
  };

  if (!userId) {
    return recordFailedFulfillment(baseFulfillment, "Missing userId");
  }

  if (!product || product.mode !== "subscription") {
    return recordFailedFulfillment(baseFulfillment, "Unknown subscription product");
  }

  return fulfillCreditGrantOnce({
    ...baseFulfillment,
    userId,
    productKey: product.key,
    credits: product.credits,
    transType: CreditTransType.SUBSCRIPTION,
    orderNo: `stripe_invoice_${invoice.id}`,
    expiryDays: product.validityDays,
    remark: `Stripe subscription credits: ${product.title}`,
  });
}

async function handleInvoicePaymentSucceeded(
  event: Stripe.DiscriminatedEvent,
  invoice: Stripe.Invoice
) {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.warn("[Stripe] Invoice paid without subscription", {
      invoiceId: invoice.id,
    });
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscription(subscription);
  return fulfillSubscriptionInvoice(event, invoice, subscription);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  return syncSubscription(subscription);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  return syncSubscription(subscription, { mode: "deleted" });
}

async function handleCheckoutAsyncFailed(
  event: Stripe.DiscriminatedEvent,
  session: Stripe.Checkout.Session
) {
  return recordSkippedFulfillment(
    {
      fulfillmentKey: `stripe:checkout_async_failed:${session.id}`,
      eventId: getEventId(event),
      eventType: event.type,
      stripeCustomerId: getStripeCustomerId(session.customer),
      stripeSessionId: session.id,
      stripePaymentIntentId: getPaymentIntentId(session.payment_intent),
      userId: session.client_reference_id || getMetadataValue(session.metadata, "userId"),
      productKey: getMetadataValue(session.metadata, "productKey"),
      credits: Number(getMetadataValue(session.metadata, "credits") ?? 0),
      metadata: {
        paymentStatus: session.payment_status,
        mode: session.mode,
      },
    },
    "Async payment failed"
  );
}

async function handleInvoicePaymentFailed(
  event: Stripe.DiscriminatedEvent,
  invoice: Stripe.Invoice
) {
  return recordSkippedFulfillment(
    {
      fulfillmentKey: `stripe:invoice_failed:${invoice.id}`,
      eventId: getEventId(event),
      eventType: event.type,
      stripeCustomerId: getStripeCustomerId(invoice.customer),
      stripeInvoiceId: invoice.id,
      stripeSubscriptionId: getInvoiceSubscriptionId(invoice),
      userId: getMetadataValue(invoice.metadata, "userId"),
      productKey: getMetadataValue(invoice.metadata, "productKey"),
      stripePriceId: getInvoiceLinePriceId(invoice),
      metadata: {
        billingReason: invoice.billing_reason,
        status: invoice.status,
      },
    },
    "Invoice payment failed"
  );
}

async function handlePaymentIntentFailed(
  event: Stripe.DiscriminatedEvent,
  paymentIntent: Stripe.PaymentIntent
) {
  const metadata = {
    failureCode: paymentIntent.last_payment_error?.code ?? null,
    declineCode: paymentIntent.last_payment_error?.decline_code ?? null,
  };

  return recordSkippedFulfillment(
    {
      fulfillmentKey: `stripe:payment_intent_failed:${paymentIntent.id}`,
      eventId: getEventId(event),
      eventType: event.type,
      stripeCustomerId: getStripeCustomerId(paymentIntent.customer),
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: getChargeId(paymentIntent.latest_charge),
      userId: getMetadataValue(paymentIntent.metadata, "userId"),
      productKey: getMetadataValue(paymentIntent.metadata, "productKey"),
      credits: 0,
      metadata,
    },
    "Payment intent failed"
  );
}

async function handleChargeRefunded(
  event: Stripe.DiscriminatedEvent,
  charge: Stripe.Charge
) {
  const paymentIntentId = getPaymentIntentId(charge.payment_intent);
  const fulfillmentKey = paymentIntentId
    ? `stripe:payment_intent:${paymentIntentId}`
    : `stripe:charge:${charge.id}`;

  await createPendingFulfillment({
    fulfillmentKey,
    eventId: getEventId(event),
    eventType: event.type,
    stripeCustomerId: getStripeCustomerId(charge.customer),
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: charge.id,
    userId: getMetadataValue(charge.metadata, "userId"),
    productKey: getMetadataValue(charge.metadata, "productKey"),
    credits: Number(getMetadataValue(charge.metadata, "credits") ?? 0),
    metadata: { refunded: charge.refunded },
  });
  return markRefunded(fulfillmentKey, null, { chargeId: charge.id });
}

async function handleRefundUpdated(
  event: Stripe.DiscriminatedEvent,
  refund: Stripe.Refund
) {
  if (refund.status === "failed" || (event.type as string) === "refund.failed") {
    return recordSkippedFulfillment(
      {
        fulfillmentKey: `stripe:refund_failed:${refund.id}`,
        eventId: getEventId(event),
        eventType: event.type,
        stripeChargeId: getChargeId(refund.charge),
        stripeRefundId: refund.id,
        metadata: { status: refund.status },
      },
      "Refund failed"
    );
  }

  await createPendingFulfillment({
    fulfillmentKey: `stripe:refund:${refund.id}`,
    eventId: getEventId(event),
    eventType: event.type,
    stripeChargeId: getChargeId(refund.charge),
    stripePaymentIntentId: getPaymentIntentId(
      (refund as Stripe.Refund & {
        payment_intent?: string | Stripe.PaymentIntent | null;
      }).payment_intent
    ),
    stripeRefundId: refund.id,
    metadata: { status: refund.status },
  });
  return markRefunded(`stripe:refund:${refund.id}`, refund.id, {
    status: refund.status,
  });
}

export async function handleEvent(event: Stripe.DiscriminatedEvent) {
  switch (event.type as string) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(
        event,
        event.data.object as Stripe.Checkout.Session
      );
    case "checkout.session.async_payment_succeeded":
      return fulfillOneTimeCheckout(
        event,
        event.data.object as Stripe.Checkout.Session
      );
    case "checkout.session.async_payment_failed":
      return handleCheckoutAsyncFailed(
        event,
        event.data.object as Stripe.Checkout.Session
      );
    case "invoice.payment_succeeded":
    case "invoice.paid":
      return handleInvoicePaymentSucceeded(
        event,
        event.data.object as Stripe.Invoice
      );
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event, event.data.object as Stripe.Invoice);
    case "payment_intent.payment_failed":
      return handlePaymentIntentFailed(
        event,
        event.data.object as Stripe.PaymentIntent
      );
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
    case "charge.refunded":
      return handleChargeRefunded(event, event.data.object as Stripe.Charge);
    case "refund.updated":
    case "refund.failed":
      return handleRefundUpdated(event, event.data.object as Stripe.Refund);
    default:
      return null;
  }
}
