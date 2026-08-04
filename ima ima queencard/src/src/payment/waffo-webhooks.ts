import type { WebhookEvent, WebhookEventData } from "@waffo/pancake-ts";

import { CreditTransType, SubscriptionPlan } from "@/db";
import {
  getPricingProduct,
  resolveWaffoProductId,
} from "@/config/pricing-products";
import {
  getCustomerByBillingSubscriptionId,
  upsertCustomerByAuthUserId,
  updateCustomerByBillingSubscriptionId,
} from "@/services/customer";
import {
  createPendingFulfillment,
  fulfillCreditGrantOnce,
  markRefunded,
  markSkipped,
} from "@/services/payment-fulfillment";

export type WaffoWebhookEvent = WebhookEvent<WebhookEventData>;

function validDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventContext(event: WaffoWebhookEvent) {
  const metadata = event.data.orderMetadata ?? {};
  const product = getPricingProduct(metadata.productKey);
  return {
    userId:
      metadata.userId?.trim() ||
      event.data.merchantProvidedBuyerIdentity?.trim() ||
      null,
    product,
    productKey: product?.key ?? metadata.productKey?.trim() ?? null,
  };
}

async function resolveUserId(event: WaffoWebhookEvent) {
  const context = eventContext(event);
  if (context.userId) return context;

  const customer = await getCustomerByBillingSubscriptionId(
    "waffo",
    event.data.orderId
  );
  return customer
    ? { ...context, userId: customer.authUserId }
    : context;
}

function fulfillmentBase(event: WaffoWebhookEvent) {
  const context = eventContext(event);
  return {
    provider: "waffo",
    fulfillmentKey: `waffo:event:${event.id}`,
    eventId: event.id,
    eventType: event.eventType,
    providerSubscriptionId: event.data.billingPeriod
      ? event.data.orderId
      : null,
    providerOrderId: event.data.orderId,
    providerTransactionId: event.data.paymentId ?? null,
    userId: context.userId,
    productKey: context.productKey,
    credits: context.product?.credits ?? 0,
    metadata: {
      eventId: event.eventId,
      mode: event.mode,
      storeId: event.storeId,
      orderStatus: event.data.orderStatus,
      paymentStatus: event.data.paymentStatus,
    },
  };
}

async function syncSubscription(
  event: WaffoWebhookEvent,
  options: { canceled?: boolean } = {}
) {
  const context = await resolveUserId(event);
  const values = {
    billingProvider: "waffo",
    billingSubscriptionId: options.canceled ? null : event.data.orderId,
    billingProductId: options.canceled
      ? null
      : resolveWaffoProductId(context.productKey),
    billingCurrentPeriodEnd: options.canceled
      ? null
      : validDate(event.data.currentPeriodEnd),
    plan: options.canceled
      ? SubscriptionPlan.FREE
      : context.product?.plan === "BUSINESS"
        ? SubscriptionPlan.BUSINESS
        : context.product?.plan === "PRO"
          ? SubscriptionPlan.PRO
          : SubscriptionPlan.FREE,
  };

  if (context.userId) {
    return upsertCustomerByAuthUserId(context.userId, values);
  }
  return updateCustomerByBillingSubscriptionId(
    "waffo",
    event.data.orderId,
    values
  );
}

async function syncFixedTermMembership(event: WaffoWebhookEvent) {
  const context = await resolveUserId(event);
  if (!context.userId || !context.product?.plan) return null;

  const purchasedAt = validDate(event.timestamp) ?? new Date();
  const membershipEndsAt = new Date(
    purchasedAt.getTime() + context.product.validityDays * 86_400_000
  );

  return upsertCustomerByAuthUserId(context.userId, {
    billingProvider: "waffo",
    billingSubscriptionId: null,
    billingProductId: resolveWaffoProductId(context.product.key),
    billingCurrentPeriodEnd: membershipEndsAt,
    plan:
      context.product.plan === "BUSINESS"
        ? SubscriptionPlan.BUSINESS
        : SubscriptionPlan.PRO,
  });
}

async function fulfillPayment(
  event: WaffoWebhookEvent,
  transType: CreditTransType
) {
  const context = await resolveUserId(event);
  const base = {
    ...fulfillmentBase(event),
    userId: context.userId,
    productKey: context.productKey,
    credits: context.product?.credits ?? 0,
  };

  if (transType === CreditTransType.SUBSCRIPTION) {
    if (event.data.billingPeriod) {
      await syncSubscription(event);
    } else {
      await syncFixedTermMembership(event);
    }
  }

  if (!context.userId) {
    await createPendingFulfillment(base);
    return markSkipped(base.fulfillmentKey, "Missing Waffo userId", base.metadata);
  }
  if (!context.product) {
    await createPendingFulfillment(base);
    return markSkipped(
      base.fulfillmentKey,
      "Unknown Waffo product key",
      base.metadata
    );
  }

  return fulfillCreditGrantOnce({
    ...base,
    userId: context.userId,
    productKey: context.product.key,
    credits: context.product.credits,
    transType,
    orderNo: `waffo_${event.data.paymentId ?? event.data.orderId}_${event.id}`,
    expiryDays: context.product.validityDays,
    remark:
      transType === CreditTransType.SUBSCRIPTION
        ? `Waffo membership credits: ${context.product.title}`
        : `Waffo credit pack: ${context.product.title}`,
  });
}

async function recordRefund(event: WaffoWebhookEvent, succeeded: boolean) {
  const base = fulfillmentBase(event);
  await createPendingFulfillment(base);
  if (succeeded) {
    return markRefunded(base.fulfillmentKey, event.eventId, base.metadata);
  }
  return markSkipped(base.fulfillmentKey, "Waffo refund failed", base.metadata);
}

export async function handleWaffoEvent(event: WaffoWebhookEvent) {
  switch (event.eventType) {
    case "order.completed":
      return fulfillPayment(
        event,
        eventContext(event).product?.plan
          ? CreditTransType.SUBSCRIPTION
          : CreditTransType.ORDER_PAY
      );
    case "subscription.activated":
    case "subscription.payment_succeeded":
      return fulfillPayment(event, CreditTransType.SUBSCRIPTION);
    case "subscription.canceling":
    case "subscription.uncanceled":
    case "subscription.updated":
    case "subscription.past_due":
      return syncSubscription(event);
    case "subscription.canceled":
      return syncSubscription(event, { canceled: true });
    case "refund.succeeded":
      return recordRefund(event, true);
    case "refund.failed":
      return recordRefund(event, false);
    default:
      return null;
  }
}
