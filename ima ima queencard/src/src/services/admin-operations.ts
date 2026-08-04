import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { getPricingProduct } from "@/config/pricing-products";
import { db, generationProviderHealth, paymentFulfillments, users } from "@/db";

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
  const [newUsers, fulfilledToday, recentPayments, failedToday, providerHealth] = await Promise.all([
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
    db
      .select()
      .from(generationProviderHealth)
      .where(eq(generationProviderHealth.provider, "gptproto"))
      .limit(1),
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
    gptproto: (() => {
      const health = providerHealth[0];
      if (!process.env.GPTPROTO_API_KEY) {
        return { status: "unavailable" as const, label: "未配置，图像生成不可用" };
      }
      if (!health) {
        return { status: "configured" as const, label: "已配置，等待首次健康检查" };
      }
      const balance = health.balanceCny === null ? "" : `，余额约 ¥${health.balanceCny}`;
      const labels = {
        available: `运行正常${balance}`,
        degraded: `备用线路运行中${balance}`,
        unavailable: `暂不可用${balance}：${health.reason ?? "请检查供应商"}`,
      };
      return { status: health.status, label: labels[health.status] };
    })(),
  };
}
