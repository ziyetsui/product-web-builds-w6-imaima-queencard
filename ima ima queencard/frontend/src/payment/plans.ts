import { SubscriptionPlan } from "@/db";
import {
  getSubscriptionPricingProducts,
  resolveCreemProductId,
  resolveStripePriceId,
} from "@/config/pricing-products";

type PlanType = (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan];

const planMap: Record<string, PlanType> = {};
const registerPlan = (priceId: string | null, plan: PlanType) => {
  if (priceId) {
    planMap[priceId] = plan;
  }
};

for (const product of getSubscriptionPricingProducts()) {
  if (product.plan === "PRO") {
    registerPlan(resolveStripePriceId(product.key), SubscriptionPlan.PRO);
    registerPlan(resolveCreemProductId(product.key), SubscriptionPlan.PRO);
  }
  if (product.plan === "BUSINESS") {
    registerPlan(resolveStripePriceId(product.key), SubscriptionPlan.BUSINESS);
    registerPlan(resolveCreemProductId(product.key), SubscriptionPlan.BUSINESS);
  }
}

export const PLANS = planMap;

export function getSubscriptionPlan(priceId: string | undefined): PlanType {
  return priceId && PLANS[priceId] ? PLANS[priceId]! : SubscriptionPlan.FREE;
}
