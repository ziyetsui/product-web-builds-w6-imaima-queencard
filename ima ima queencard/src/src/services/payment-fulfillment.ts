import {
  CreditPackageStatus,
  CreditTransType,
  PaymentFulfillmentStatus,
  creditPackages,
  creditTransactions,
  db,
  paymentFulfillments,
} from "@/db";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface PaymentFulfillmentParams {
  fulfillmentKey: string;
  provider?: string;
  eventId?: string | null;
  eventType?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerCheckoutId?: string | null;
  providerOrderId?: string | null;
  providerTransactionId?: string | null;
  providerRefundId?: string | null;
  providerDisputeId?: string | null;
  providerProductId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSessionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeRefundId?: string | null;
  productKey?: string | null;
  stripePriceId?: string | null;
  userId?: string | null;
  credits?: number;
  metadata?: Record<string, unknown> | null;
}

export interface FulfillCreditGrantParams extends PaymentFulfillmentParams {
  userId: string;
  productKey: string;
  credits: number;
  transType: CreditTransType;
  orderNo: string;
  expiryDays: number;
  remark: string;
}

function nowPlusDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function normalizeCredits(credits: number | undefined) {
  return Math.max(0, Math.floor(credits ?? 0));
}

export async function getFulfillmentByKey(fulfillmentKey: string) {
  const [fulfillment] = await db
    .select()
    .from(paymentFulfillments)
    .where(eq(paymentFulfillments.fulfillmentKey, fulfillmentKey))
    .limit(1);

  return fulfillment ?? null;
}

export async function createPendingFulfillment(params: PaymentFulfillmentParams) {
  const [created] = await db
    .insert(paymentFulfillments)
    .values({
      ...params,
      credits: normalizeCredits(params.credits),
      status: PaymentFulfillmentStatus.PENDING,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: paymentFulfillments.fulfillmentKey,
    })
    .returning();

  return created ?? getFulfillmentByKey(params.fulfillmentKey);
}

async function markStatus(
  fulfillmentKey: string,
  status: PaymentFulfillmentStatus,
  extra: {
    errorMessage?: string | null;
    stripeRefundId?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {}
) {
  const [updated] = await db
    .update(paymentFulfillments)
    .set({
      status,
      errorMessage: extra.errorMessage,
      stripeRefundId: extra.stripeRefundId,
      metadata: extra.metadata,
      fulfilledAt:
        status === PaymentFulfillmentStatus.FULFILLED ||
        status === PaymentFulfillmentStatus.REFUNDED
          ? new Date()
          : undefined,
      updatedAt: new Date(),
    })
    .where(eq(paymentFulfillments.fulfillmentKey, fulfillmentKey))
    .returning();

  return updated ?? null;
}

export function markFulfilled(fulfillmentKey: string) {
  return markStatus(fulfillmentKey, PaymentFulfillmentStatus.FULFILLED);
}

export function markSkipped(
  fulfillmentKey: string,
  reason?: string,
  metadata?: Record<string, unknown> | null
) {
  return markStatus(fulfillmentKey, PaymentFulfillmentStatus.SKIPPED, {
    errorMessage: reason,
    metadata,
  });
}

export function markFailed(fulfillmentKey: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return markStatus(fulfillmentKey, PaymentFulfillmentStatus.FAILED, {
    errorMessage,
  });
}

export function markRefunded(
  fulfillmentKey: string,
  stripeRefundId?: string | null,
  metadata?: Record<string, unknown> | null
) {
  return markStatus(fulfillmentKey, PaymentFulfillmentStatus.REFUNDED, {
    stripeRefundId,
    metadata,
  });
}

export async function fulfillCreditGrantOnce(params: FulfillCreditGrantParams) {
  return db.transaction(async (trx) => {
    await trx
      .insert(paymentFulfillments)
      .values({
        fulfillmentKey: params.fulfillmentKey,
        provider: params.provider ?? "stripe",
        eventId: params.eventId,
        eventType: params.eventType,
        providerCustomerId: params.providerCustomerId,
        providerSubscriptionId: params.providerSubscriptionId,
        providerCheckoutId: params.providerCheckoutId,
        providerOrderId: params.providerOrderId,
        providerTransactionId: params.providerTransactionId,
        providerRefundId: params.providerRefundId,
        providerDisputeId: params.providerDisputeId,
        providerProductId: params.providerProductId,
        stripeCustomerId: params.stripeCustomerId,
        stripeSubscriptionId: params.stripeSubscriptionId,
        stripeSessionId: params.stripeSessionId,
        stripeInvoiceId: params.stripeInvoiceId,
        stripePaymentIntentId: params.stripePaymentIntentId,
        stripeChargeId: params.stripeChargeId,
        stripeRefundId: params.stripeRefundId,
        productKey: params.productKey,
        stripePriceId: params.stripePriceId,
        userId: params.userId,
        credits: normalizeCredits(params.credits),
        status: PaymentFulfillmentStatus.PENDING,
        metadata: params.metadata,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: paymentFulfillments.fulfillmentKey,
      });

    const [fulfillment] = await trx
      .select()
      .from(paymentFulfillments)
      .where(eq(paymentFulfillments.fulfillmentKey, params.fulfillmentKey))
      .for("update")
      .limit(1);

    if (!fulfillment) {
      throw new Error(`Failed to lock fulfillment ${params.fulfillmentKey}`);
    }

    if (fulfillment.status !== PaymentFulfillmentStatus.PENDING) {
      return {
        fulfilled: false,
        fulfillment,
        packageId: fulfillment.creditPackageId,
      };
    }

    if (params.credits <= 0) {
      const [skipped] = await trx
        .update(paymentFulfillments)
        .set({
          status: PaymentFulfillmentStatus.SKIPPED,
          errorMessage: "No credits to grant",
          updatedAt: new Date(),
        })
        .where(eq(paymentFulfillments.id, fulfillment.id))
        .returning();

      return { fulfilled: false, fulfillment: skipped ?? fulfillment, packageId: null };
    }

    const [pkgResult] = await trx
      .insert(creditPackages)
      .values({
        userId: params.userId,
        initialCredits: params.credits,
        remainingCredits: params.credits,
        frozenCredits: 0,
        transType: params.transType,
        orderNo: params.orderNo,
        status: CreditPackageStatus.ACTIVE,
        expiredAt: nowPlusDays(params.expiryDays),
        updatedAt: new Date(),
      })
      .returning({ id: creditPackages.id });

    if (!pkgResult) {
      throw new Error("Failed to create credit package");
    }

    const activePackages = await trx
      .select({
        remainingCredits: creditPackages.remainingCredits,
      })
      .from(creditPackages)
      .where(
        and(
          eq(creditPackages.userId, params.userId),
          eq(creditPackages.status, CreditPackageStatus.ACTIVE),
          or(
            isNull(creditPackages.expiredAt),
            gt(creditPackages.expiredAt, new Date())
          )
        )
      );
    const balanceAfter = activePackages.reduce(
      (sum, pkg) => sum + pkg.remainingCredits,
      0
    );

    await trx.insert(creditTransactions).values({
      transNo: `TXN${Date.now()}${nanoid(6)}`,
      userId: params.userId,
      transType: params.transType,
      credits: params.credits,
      balanceAfter,
      packageId: pkgResult.id,
      orderNo: params.orderNo,
      remark: params.remark,
    });

    const [updatedFulfillment] = await trx
      .update(paymentFulfillments)
      .set({
        eventId: params.eventId ?? fulfillment.eventId,
        eventType: params.eventType ?? fulfillment.eventType,
        providerCustomerId:
          params.providerCustomerId ?? fulfillment.providerCustomerId,
        providerSubscriptionId:
          params.providerSubscriptionId ?? fulfillment.providerSubscriptionId,
        providerCheckoutId:
          params.providerCheckoutId ?? fulfillment.providerCheckoutId,
        providerOrderId: params.providerOrderId ?? fulfillment.providerOrderId,
        providerTransactionId:
          params.providerTransactionId ?? fulfillment.providerTransactionId,
        providerRefundId: params.providerRefundId ?? fulfillment.providerRefundId,
        providerDisputeId:
          params.providerDisputeId ?? fulfillment.providerDisputeId,
        providerProductId: params.providerProductId ?? fulfillment.providerProductId,
        metadata: params.metadata ?? fulfillment.metadata,
        creditPackageId: pkgResult.id,
        status: PaymentFulfillmentStatus.FULFILLED,
        fulfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentFulfillments.id, fulfillment.id))
      .returning();

    return {
      fulfilled: true,
      fulfillment: updatedFulfillment ?? fulfillment,
      packageId: pkgResult.id,
    };
  });
}
