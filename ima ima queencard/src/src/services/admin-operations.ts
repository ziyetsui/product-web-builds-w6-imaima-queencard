import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { getPricingProduct } from "@/config/pricing-products";
import { db, paymentFulfillments, users } from "@/db";

const PAYMENT_SUCCESS_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.payment_succeeded",
  "invoice.paid",
  "order.completed",
  "subscription.activated",
  "subscription.payment_succeeded",
  "checkout.completed",
  "subscription.paid",
] as const;

function shanghaiDayStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day"), -8));
}

export async function getOperationsOverview(now = new Date()) {
  const start = shanghaiDayStart(now);
  const [newUsers, fulfilledToday, recentPayments, failedToday] = await Promise.all([
    db.select({ id: users.id }).from(users).where(gte(users.createdAt, start)),
    db
      .select({
        userId: paymentFulfillments.userId,
        productKey: paymentFulfillments.productKey,
      })
      .from(paymentFulfillments)
      .where(and(
        eq(paymentFulfillments.status, "FULFILLED"),
        gte(paymentFulfillments.fulfilledAt, start)
      )),
    db
      .select({
        id: paymentFulfillments.id,
        provider: paymentFulfillments.provider,
        productKey: paymentFulfillments.productKey,
        credits: paymentFulfillments.credits,
        fulfilledAt: paymentFulfillments.fulfilledAt,
        email: users.email,
      })
      .from(paymentFulfillments)
      .leftJoin(users, eq(paymentFulfillments.userId, users.id))
      .where(eq(paymentFulfillments.status, "FULFILLED"))
      .orderBy(desc(paymentFulfillments.fulfilledAt))
      .limit(20),
    db
      .select({ id: paymentFulfillments.id })
      .from(paymentFulfillments)
      .where(and(
        inArray(paymentFulfillments.status, ["FAILED", "SKIPPED"]),
        gte(paymentFulfillments.createdAt, start),
        isNotNull(paymentFulfillments.eventId),
        inArray(paymentFulfillments.eventType, [...PAYMENT_SUCCESS_EVENTS])
      )),
  ]);

  const payingUsers = new Set(fulfilledToday.flatMap((row) => row.userId ? [row.userId] : []));
  const estimatedRevenueCny = fulfilledToday.reduce((sum, row) =>
    sum + (getPricingProduct(row.productKey)?.priceCny ?? 0), 0);

  return {
    summary: {
      newUsers: newUsers.length,
      payingUsers: payingUsers.size,
      estimatedRevenueCny,
      failedFulfillments: failedToday.length,
    },
    recentPayments: recentPayments.map((row) => ({
      ...row,
      productTitle: getPricingProduct(row.productKey)?.title ?? row.productKey ?? "未知商品",
      listedPriceCny: getPricingProduct(row.productKey)?.priceCny ?? null,
    })),
    gptproto: {
      status: process.env.GPTPROTO_API_KEY ? "configured" as const : "unavailable" as const,
      label: process.env.GPTPROTO_API_KEY
        ? "已配置（余额需在 GPTProto 控制台确认）"
        : "未配置，图像生成不可用",
    },
  };
}
