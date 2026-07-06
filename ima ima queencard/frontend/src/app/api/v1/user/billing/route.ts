import { NextRequest } from "next/server";

import { getPricingProduct } from "@/config/pricing-products";
import { requireAuth } from "@/lib/api/auth";
import { apiSuccess, handleApiError } from "@/lib/api/response";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import type { CreditTransType } from "@/db/schema";

type BillingPackageRow = {
  id: number;
  userId: string;
  initialCredits: number;
  remainingCredits: number;
  transType: CreditTransType;
  orderNo: string | null;
  status: string;
  createdAt: string | Date;
  productKey: string | null;
  provider: string | null;
  stripeInvoiceId: string | null;
  stripeSessionId: string | null;
  stripePaymentIntentId: string | null;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  providerTransactionId: string | null;
};

/**
 * GET /api/v1/user/billing
 *
 * Get user's purchase history (credit packages)
 * Query params:
 * - limit: number of items per page (default: 20)
 * - cursor: pagination cursor (creditPackages.id)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);

    const limit = Number.parseInt(searchParams.get("limit") || "20");
    const cursor = searchParams.get("cursor");

    const orderPayType: CreditTransType = "ORDER_PAY";
    const subscriptionType: CreditTransType = "SUBSCRIPTION";

    const packages = await db.execute(sql`
      SELECT
        cp.id,
        cp.user_id as "userId",
        cp.initial_credits as "initialCredits",
        cp.remaining_credits as "remainingCredits",
        cp.trans_type as "transType",
        cp.order_no as "orderNo",
        cp.status,
        cp.expired_at as "expiredAt",
        cp.created_at as "createdAt",
        pf.product_key as "productKey",
        pf.provider,
        pf.stripe_invoice_id as "stripeInvoiceId",
        pf.stripe_session_id as "stripeSessionId",
        pf.stripe_payment_intent_id as "stripePaymentIntentId",
        pf.provider_checkout_id as "providerCheckoutId",
        pf.provider_order_id as "providerOrderId",
        pf.provider_transaction_id as "providerTransactionId"
      FROM credit_packages cp
      LEFT JOIN payment_fulfillments pf ON pf.credit_package_id = cp.id
      WHERE cp.user_id = ${user.id}
        AND cp.trans_type IN (${orderPayType}, ${subscriptionType})
        ${cursor ? sql`AND cp.id < ${Number.parseInt(cursor)}` : sql``}
      ORDER BY cp.created_at DESC
      LIMIT ${limit + 1}
    `);

    // Check if there's more data
    const hasMore = packages.length > limit;
    const results = (hasMore ? packages.slice(0, limit) : packages) as BillingPackageRow[];

    // Get next cursor
    const nextCursor = hasMore && results.length > 0
      ? String(results[results.length - 1].id)
      : null;

    // Transform to invoice format
    const invoices = results.map((pkg) => {
      const product = pkg.productKey ? getPricingProduct(pkg.productKey) : null;
      const source =
        pkg.transType === "SUBSCRIPTION"
          ? `${pkg.provider ?? "stripe"}_subscription`
          : `${pkg.provider ?? "stripe"}_credit_pack`;

      return {
        id: String(pkg.id),
        amount: product?.priceUsd ?? null,
        currency: "USD",
        status: (pkg.status as string).toLowerCase(),
        source,
        orderNo: pkg.orderNo,
        stripe: {
          productKey: pkg.productKey,
          invoiceId: pkg.stripeInvoiceId,
          sessionId: pkg.stripeSessionId,
          paymentIntentId: pkg.stripePaymentIntentId,
        },
        provider: {
          name: pkg.provider ?? "stripe",
          checkoutId: pkg.providerCheckoutId,
          orderId: pkg.providerOrderId,
          transactionId: pkg.providerTransactionId,
        },
        items: [
          {
            type: "credits",
            description:
              product?.title ??
              (pkg.transType === "SUBSCRIPTION"
                ? "Subscription credits"
                : "Credit pack"),
            quantity: pkg.initialCredits,
            remaining: pkg.remainingCredits,
          },
        ],
        createdAt: new Date(pkg.createdAt),
      };
    });

    return apiSuccess({
      user: {
        email: user.email,
        id: user.id,
        createdAt: user.createdAt,
      },
      invoices,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
