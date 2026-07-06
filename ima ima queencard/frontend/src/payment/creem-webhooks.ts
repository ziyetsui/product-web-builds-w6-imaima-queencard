import { createHmac, timingSafeEqual } from "node:crypto";

import { CreditTransType, SubscriptionPlan } from "@/db";
import {
  getPricingProduct,
  getProductByCreemProductId,
  type PricingProduct,
} from "@/config/pricing-products";
import {
  getCustomerByBillingCustomerId,
  getCustomerByBillingSubscriptionId,
  updateCustomerByBillingCustomerId,
  updateCustomerByBillingSubscriptionId,
  upsertCustomerByAuthUserId,
} from "@/services/customer";
import {
  createPendingFulfillment,
  fulfillCreditGrantOnce,
  markRefunded,
  markSkipped,
} from "@/services/payment-fulfillment";

type JsonRecord = Record<string, unknown>;

export type CreemWebhookEvent = {
  id?: string;
  eventType?: string;
  event_type?: string;
  type?: string;
  data?: unknown;
  object?: unknown;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function eventType(event: CreemWebhookEvent) {
  return (
    stringValue(event.eventType) ??
    stringValue(event.event_type) ??
    stringValue(event.type) ??
    "unknown"
  );
}

function eventObject(event: CreemWebhookEvent) {
  const data = asRecord(event.data);
  return asRecord(event.object) ?? asRecord(data?.object) ?? data ?? {};
}

function nestedId(value: unknown): string | null {
  if (typeof value === "string") return stringValue(value);
  return stringValue(asRecord(value)?.id);
}

function metadataFrom(object: JsonRecord): JsonRecord {
  return asRecord(object.metadata) ?? asRecord(asRecord(object.checkout)?.metadata) ?? {};
}

function parseRequestId(requestId: string | null) {
  if (!requestId?.startsWith("imaima:")) return {};
  const [, userId, productKey] = requestId.split(":");
  return {
    userId: stringValue(userId),
    productKey: stringValue(productKey),
  };
}

function getCreemIds(object: JsonRecord) {
  const objectId = stringValue(object.id);
  const product = asRecord(object.product);
  const checkout = asRecord(object.checkout);
  const order = asRecord(object.order);
  const customer = asRecord(object.customer);
  const subscription = asRecord(object.subscription);
  const transaction = asRecord(object.transaction);
  const refund = asRecord(object.refund);
  const dispute = asRecord(object.dispute);

  return {
    checkoutId:
      (objectId?.startsWith("ch_") ? objectId : null) ??
      nestedId(checkout) ??
      stringValue(object.checkout_id) ??
      stringValue(object.checkoutId),
    orderId:
      (objectId?.startsWith("ord_") ? objectId : null) ??
      nestedId(order) ??
      stringValue(object.order_id) ??
      stringValue(object.orderId),
    customerId:
      nestedId(customer) ??
      stringValue(object.customer_id) ??
      stringValue(object.customerId),
    subscriptionId:
      (objectId?.startsWith("sub_") ? objectId : null) ??
      nestedId(subscription) ??
      stringValue(object.subscription_id) ??
      stringValue(object.subscriptionId),
    transactionId:
      (objectId?.startsWith("txn_") ? objectId : null) ??
      nestedId(transaction) ??
      stringValue(object.transaction_id) ??
      stringValue(object.transactionId),
    refundId:
      (objectId?.startsWith("refund_") ? objectId : null) ??
      nestedId(refund) ??
      stringValue(object.refund_id) ??
      stringValue(object.refundId),
    disputeId:
      (objectId?.startsWith("disp_") ? objectId : null) ??
      nestedId(dispute) ??
      stringValue(object.dispute_id) ??
      stringValue(object.disputeId),
    productId:
      nestedId(product) ?? stringValue(object.product_id) ?? stringValue(object.productId),
  };
}

function getUserAndProduct(
  object: JsonRecord,
  productId: string | null
): {
  userId: string | null;
  productKey: string | null;
  product: PricingProduct | null;
} {
  const metadata = metadataFrom(object);
  const requestId =
    stringValue(object.request_id) ??
    stringValue(object.requestId) ??
    stringValue(metadata.requestId);
  const fromRequest = parseRequestId(requestId);
  const productKey =
    stringValue(metadata.productKey) ??
    stringValue(metadata.product_key) ??
    fromRequest.productKey ??
    null;
  const productFromId = getProductByCreemProductId(productId);
  const productFromKey = productKey ? getPricingProduct(productKey) : null;

  return {
    userId:
      stringValue(metadata.userId) ??
      stringValue(metadata.user_id) ??
      stringValue(metadata.referenceId) ??
      fromRequest.userId ??
      null,
    productKey: productFromId?.key ?? productFromKey?.key ?? productKey,
    product: productFromId ?? productFromKey,
  };
}

function periodEndFrom(object: JsonRecord) {
  const periodEnd =
    numberValue(object.current_period_end) ??
    numberValue(object.currentPeriodEnd) ??
    numberValue(object.period_end) ??
    numberValue(object.periodEnd);
  if (periodEnd) {
    return new Date(periodEnd > 10_000_000_000 ? periodEnd : periodEnd * 1000);
  }

  const dateValue =
    stringValue(object.current_period_end) ??
    stringValue(object.currentPeriodEnd) ??
    stringValue(object.period_end) ??
    stringValue(object.periodEnd);
  return dateValue ? new Date(dateValue) : null;
}

async function resolveUserId(
  object: JsonRecord,
  productId: string | null,
  customerId: string | null,
  subscriptionId: string | null
) {
  const resolved = getUserAndProduct(object, productId);
  if (resolved.userId) return resolved;

  if (subscriptionId) {
    const customer = await getCustomerByBillingSubscriptionId("creem", subscriptionId);
    if (customer) return { ...resolved, userId: customer.authUserId };
  }

  if (customerId) {
    const customer = await getCustomerByBillingCustomerId("creem", customerId);
    if (customer) return { ...resolved, userId: customer.authUserId };
  }

  return resolved;
}

function fulfillmentMetadata(object: JsonRecord) {
  return {
    requestId: stringValue(object.request_id) ?? stringValue(object.requestId),
    status: stringValue(object.status),
    rawType: stringValue(object.object),
  };
}

async function syncCreemSubscription(
  object: JsonRecord,
  options: { deleted?: boolean } = {}
) {
  const ids = getCreemIds(object);
  const { userId, product } = await resolveUserId(
    object,
    ids.productId,
    ids.customerId,
    ids.subscriptionId
  );

  if (!userId && !ids.customerId && !ids.subscriptionId) return null;

  const values = {
    billingProvider: "creem",
    billingCustomerId: ids.customerId,
    billingSubscriptionId: options.deleted ? null : ids.subscriptionId,
    billingProductId: options.deleted ? null : ids.productId,
    billingCurrentPeriodEnd: options.deleted ? null : periodEndFrom(object),
    plan: options.deleted
      ? SubscriptionPlan.FREE
      : product?.plan === "BUSINESS"
        ? SubscriptionPlan.BUSINESS
        : product?.plan === "PRO"
          ? SubscriptionPlan.PRO
          : SubscriptionPlan.FREE,
  };

  if (userId) return upsertCustomerByAuthUserId(userId, values);
  if (ids.subscriptionId) {
    const bySubscription = await updateCustomerByBillingSubscriptionId(
      "creem",
      ids.subscriptionId,
      values
    );
    if (bySubscription) return bySubscription;
  }
  if (ids.customerId) {
    return updateCustomerByBillingCustomerId("creem", ids.customerId, values);
  }

  return null;
}

async function fulfillCheckoutCompleted(
  event: CreemWebhookEvent,
  object: JsonRecord
) {
  const ids = getCreemIds(object);
  const resolved = await resolveUserId(
    object,
    ids.productId,
    ids.customerId,
    ids.subscriptionId
  );

  if (resolved.product?.mode === "subscription") {
    return syncCreemSubscription(object);
  }

  const productKey = resolved.productKey ?? "unknown";
  const fulfillmentKey = ids.checkoutId
    ? `creem:checkout:${ids.checkoutId}:${productKey}`
    : ids.orderId
      ? `creem:order:${ids.orderId}:${productKey}`
      : `creem:event:${event.id ?? "unknown"}:${productKey}`;

  const baseFulfillment = {
    provider: "creem",
    fulfillmentKey,
    eventId: event.id ?? null,
    eventType: eventType(event),
    providerCustomerId: ids.customerId,
    providerCheckoutId: ids.checkoutId,
    providerOrderId: ids.orderId,
    providerProductId: ids.productId,
    userId: resolved.userId,
    productKey: resolved.productKey,
    credits: resolved.product?.credits ?? 0,
    metadata: fulfillmentMetadata(object),
  };

  if (!resolved.userId) {
    await createPendingFulfillment(baseFulfillment);
    return markSkipped(fulfillmentKey, "Missing userId", baseFulfillment.metadata);
  }

  if (!resolved.product || resolved.product.mode !== "payment") {
    await createPendingFulfillment(baseFulfillment);
    return markSkipped(
      fulfillmentKey,
      "Unknown or non-payment Creem product",
      baseFulfillment.metadata
    );
  }

  return fulfillCreditGrantOnce({
    ...baseFulfillment,
    userId: resolved.userId,
    productKey: resolved.product.key,
    credits: resolved.product.credits,
    transType: CreditTransType.ORDER_PAY,
    orderNo: ids.orderId
      ? `creem_order_${ids.orderId}`
      : `creem_checkout_${ids.checkoutId ?? event.id}`,
    expiryDays: resolved.product.validityDays,
    remark: `Creem credit pack: ${resolved.product.title}`,
  });
}

async function fulfillSubscriptionPaid(
  event: CreemWebhookEvent,
  object: JsonRecord
) {
  const ids = getCreemIds(object);
  const resolved = await resolveUserId(
    object,
    ids.productId,
    ids.customerId,
    ids.subscriptionId
  );
  const productKey = resolved.productKey ?? "unknown";
  const paymentMarker =
    ids.transactionId ??
    ids.orderId ??
    stringValue(object.current_period_start) ??
    stringValue(object.periodStart) ??
    event.id ??
    "unknown";
  const fulfillmentKey = ids.subscriptionId
    ? `creem:subscription-paid:${ids.subscriptionId}:${paymentMarker}:${productKey}`
    : `creem:event:${event.id ?? "unknown"}:${productKey}`;
  const baseFulfillment = {
    provider: "creem",
    fulfillmentKey,
    eventId: event.id ?? null,
    eventType: eventType(event),
    providerCustomerId: ids.customerId,
    providerSubscriptionId: ids.subscriptionId,
    providerTransactionId: ids.transactionId,
    providerOrderId: ids.orderId,
    providerProductId: ids.productId,
    userId: resolved.userId,
    productKey: resolved.productKey,
    credits: resolved.product?.credits ?? 0,
    metadata: fulfillmentMetadata(object),
  };

  await syncCreemSubscription(object);

  if (!resolved.userId) {
    await createPendingFulfillment(baseFulfillment);
    return markSkipped(fulfillmentKey, "Missing userId", baseFulfillment.metadata);
  }

  if (!resolved.product || resolved.product.mode !== "subscription") {
    await createPendingFulfillment(baseFulfillment);
    return markSkipped(
      fulfillmentKey,
      "Unknown or non-subscription Creem product",
      baseFulfillment.metadata
    );
  }

  return fulfillCreditGrantOnce({
    ...baseFulfillment,
    userId: resolved.userId,
    productKey: resolved.product.key,
    credits: resolved.product.credits,
    transType: CreditTransType.SUBSCRIPTION,
    orderNo: `creem_subscription_${ids.subscriptionId ?? event.id}`,
    expiryDays: resolved.product.validityDays,
    remark: `Creem subscription credits: ${resolved.product.title}`,
  });
}

async function handleRefund(event: CreemWebhookEvent, object: JsonRecord) {
  const ids = getCreemIds(object);
  const fulfillmentKey = ids.refundId
    ? `creem:refund:${ids.refundId}`
    : `creem:event:${event.id ?? "unknown"}`;

  await createPendingFulfillment({
    provider: "creem",
    fulfillmentKey,
    eventId: event.id ?? null,
    eventType: eventType(event),
    providerCustomerId: ids.customerId,
    providerRefundId: ids.refundId,
    providerOrderId: ids.orderId,
    providerTransactionId: ids.transactionId,
    providerProductId: ids.productId,
    metadata: fulfillmentMetadata(object),
  });

  return markRefunded(fulfillmentKey, ids.refundId, {
    status: stringValue(object.status),
  });
}

async function handleDispute(event: CreemWebhookEvent, object: JsonRecord) {
  const ids = getCreemIds(object);
  const fulfillmentKey = ids.disputeId
    ? `creem:dispute:${ids.disputeId}`
    : `creem:event:${event.id ?? "unknown"}`;

  await createPendingFulfillment({
    provider: "creem",
    fulfillmentKey,
    eventId: event.id ?? null,
    eventType: eventType(event),
    providerCustomerId: ids.customerId,
    providerDisputeId: ids.disputeId,
    providerOrderId: ids.orderId,
    providerTransactionId: ids.transactionId,
    providerProductId: ids.productId,
    metadata: fulfillmentMetadata(object),
  });

  return markSkipped(fulfillmentKey, "Dispute requires manual review", {
    status: stringValue(object.status),
  });
}

export async function handleCreemEvent(event: CreemWebhookEvent) {
  const object = eventObject(event);

  switch (eventType(event)) {
    case "checkout.completed":
      return fulfillCheckoutCompleted(event, object);
    case "subscription.paid":
      return fulfillSubscriptionPaid(event, object);
    case "subscription.active":
    case "subscription.update":
    case "subscription.scheduled_cancel":
    case "subscription.past_due":
    case "subscription.trialing":
    case "subscription.paused":
      return syncCreemSubscription(object);
    case "subscription.canceled":
    case "subscription.expired":
      return syncCreemSubscription(object, { deleted: true });
    case "refund.created":
      return handleRefund(event, object);
    case "dispute.created":
      return handleDispute(event, object);
    default:
      return null;
  }
}

export function verifyCreemSignature(
  payload: string,
  signature: string | null,
  webhookSecret: string | null | undefined
) {
  if (!webhookSecret) {
    throw new Error("CREEM_WEBHOOK_SECRET is not configured");
  }
  if (!signature) return false;

  const expected = createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex");
  const receivedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}
