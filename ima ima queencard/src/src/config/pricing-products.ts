import { normalizeStripePriceId } from "@/payment/stripe-price-id";

export type PricingProductMode = "subscription" | "payment";
export type PricingProductBillingPeriod = "month" | "year" | null;
export type PricingProductPlan = "PRO" | "BUSINESS" | null;

export type PricingProductKey =
  | "creator_monthly"
  | "creator_annual"
  | "studio_monthly"
  | "studio_annual"
  | "credit_creator"
  | "credit_studio";

export interface PricingProduct {
  key: PricingProductKey;
  title: string;
  description: string;
  mode: PricingProductMode;
  plan: PricingProductPlan;
  billingPeriod: PricingProductBillingPeriod;
  stripePriceEnv: string;
  creemProductEnv: string;
  waffoProductEnv: string;
  creemBillingType: "recurring" | "onetime";
  creemBillingPeriod: "every-month" | "every-year" | null;
  priceUsd: number;
  priceCny: number;
  credits: number;
  validityDays: number;
  popular?: boolean;
  enabled: boolean;
  features: string[];
}

export const PRICING_PRODUCTS = [
  {
    key: "creator_monthly",
    title: "创作者版",
    description: "适合稳定发布图像内容的个人创作者。",
    mode: "subscription",
    plan: "PRO",
    billingPeriod: "month",
    stripePriceEnv: "STRIPE_PRICE_CREATOR_MONTHLY",
    creemProductEnv: "CREEM_PRODUCT_CREATOR_MONTHLY",
    waffoProductEnv: "WAFFO_PRODUCT_CREATOR_MONTHLY",
    creemBillingType: "recurring",
    creemBillingPeriod: "every-month",
    priceUsd: 14.9,
    priceCny: 99,
    credits: 600,
    validityDays: 30,
    popular: true,
    enabled: true,
    features: ["每月 600 积分", "可商用", "支持图片生成和编辑"],
  },
  {
    key: "creator_annual",
    title: "创作者版年付",
    description: "适合长期稳定创作的个人创作者。",
    mode: "subscription",
    plan: "PRO",
    billingPeriod: "year",
    stripePriceEnv: "STRIPE_PRICE_CREATOR_ANNUAL",
    creemProductEnv: "CREEM_PRODUCT_CREATOR_ANNUAL",
    waffoProductEnv: "WAFFO_PRODUCT_CREATOR_ANNUAL",
    creemBillingType: "recurring",
    creemBillingPeriod: "every-year",
    priceUsd: 149,
    priceCny: 999,
    credits: 7200,
    validityDays: 365,
    popular: true,
    enabled: true,
    features: ["每年 7,200 积分", "可商用", "约等于赠送 2 个月"],
  },
  {
    key: "studio_monthly",
    title: "工作室版",
    description: "适合高频生成和小团队工作流。",
    mode: "subscription",
    plan: "BUSINESS",
    billingPeriod: "month",
    stripePriceEnv: "STRIPE_PRICE_STUDIO_MONTHLY",
    creemProductEnv: "CREEM_PRODUCT_STUDIO_MONTHLY",
    waffoProductEnv: "WAFFO_PRODUCT_STUDIO_MONTHLY",
    creemBillingType: "recurring",
    creemBillingPeriod: "every-month",
    priceUsd: 39.9,
    priceCny: 269,
    credits: 1800,
    validityDays: 30,
    enabled: true,
    features: ["每月 1,800 积分", "更高生成额度", "适合团队协作量级"],
  },
  {
    key: "studio_annual",
    title: "工作室版年付",
    description: "适合长期高频生成和团队创作。",
    mode: "subscription",
    plan: "BUSINESS",
    billingPeriod: "year",
    stripePriceEnv: "STRIPE_PRICE_STUDIO_ANNUAL",
    creemProductEnv: "CREEM_PRODUCT_STUDIO_ANNUAL",
    waffoProductEnv: "WAFFO_PRODUCT_STUDIO_ANNUAL",
    creemBillingType: "recurring",
    creemBillingPeriod: "every-year",
    priceUsd: 399,
    priceCny: 2699,
    credits: 21600,
    validityDays: 365,
    enabled: true,
    features: ["每年 21,600 积分", "更高生成额度", "约等于赠送 2 个月"],
  },
  {
    key: "credit_creator",
    title: "创作者积分包",
    description: "对应创作者版月度额度的一次性积分包。",
    mode: "payment",
    plan: null,
    billingPeriod: null,
    stripePriceEnv: "STRIPE_PRICE_CREDIT_CREATOR",
    creemProductEnv: "CREEM_PRODUCT_CREDIT_CREATOR",
    waffoProductEnv: "WAFFO_PRODUCT_CREDIT_CREATOR",
    creemBillingType: "onetime",
    creemBillingPeriod: null,
    priceUsd: 14.9,
    priceCny: 99,
    credits: 600,
    validityDays: 365,
    popular: true,
    enabled: true,
    features: ["600 积分", "一次性购买", "有效期 365 天"],
  },
  {
    key: "credit_studio",
    title: "工作室积分包",
    description: "适合高频工作流的一次性大额补充。",
    mode: "payment",
    plan: null,
    billingPeriod: null,
    stripePriceEnv: "STRIPE_PRICE_CREDIT_STUDIO",
    creemProductEnv: "CREEM_PRODUCT_CREDIT_STUDIO",
    waffoProductEnv: "WAFFO_PRODUCT_CREDIT_STUDIO",
    creemBillingType: "onetime",
    creemBillingPeriod: null,
    priceUsd: 39.9,
    priceCny: 269,
    credits: 1800,
    validityDays: 365,
    enabled: true,
    features: ["1,800 积分", "一次性购买", "有效期 365 天"],
  },
] satisfies PricingProduct[];

export function getPricingProduct(
  productKey: string | null | undefined
): PricingProduct | null {
  if (!productKey) return null;
  return PRICING_PRODUCTS.find((product) => product.key === productKey) ?? null;
}

export function getEnabledPricingProducts(): PricingProduct[] {
  return PRICING_PRODUCTS.filter((product) => product.enabled);
}

export function getSubscriptionPricingProducts(): PricingProduct[] {
  return getEnabledPricingProducts().filter(
    (product) => product.mode === "subscription"
  );
}

export function getCreditPackPricingProducts(): PricingProduct[] {
  return getEnabledPricingProducts().filter(
    (product) => product.mode === "payment"
  );
}

export function resolveStripePriceId(
  productKey: string | null | undefined
): string | null {
  const product = getPricingProduct(productKey);
  if (!product) return null;
  return normalizeStripePriceId(process.env[product.stripePriceEnv]);
}

export function normalizeCreemProductId(
  creemProductId: string | null | undefined
): string | null {
  const normalized = creemProductId?.trim();
  return normalized && normalized.startsWith("prod_") ? normalized : null;
}

export function resolveCreemProductId(
  productKey: string | null | undefined
): string | null {
  const product = getPricingProduct(productKey);
  if (!product) return null;
  return normalizeCreemProductId(process.env[product.creemProductEnv]);
}

export function normalizeWaffoProductId(
  waffoProductId: string | null | undefined
): string | null {
  const normalized = waffoProductId?.trim();
  return normalized && normalized.startsWith("PROD_") ? normalized : null;
}

export function resolveWaffoProductId(
  productKey: string | null | undefined
): string | null {
  const product = getPricingProduct(productKey);
  if (!product) return null;
  return normalizeWaffoProductId(process.env[product.waffoProductEnv]);
}

export function getProductByStripePriceId(
  stripePriceId: string | null | undefined
): PricingProduct | null {
  const normalizedPriceId = normalizeStripePriceId(stripePriceId);
  if (!normalizedPriceId) return null;

  return (
    PRICING_PRODUCTS.find(
      (product) =>
        normalizeStripePriceId(process.env[product.stripePriceEnv]) ===
        normalizedPriceId
    ) ?? null
  );
}

export function getProductByCreemProductId(
  creemProductId: string | null | undefined
): PricingProduct | null {
  const normalizedProductId = normalizeCreemProductId(creemProductId);
  if (!normalizedProductId) return null;

  return (
    PRICING_PRODUCTS.find(
      (product) =>
        normalizeCreemProductId(process.env[product.creemProductEnv]) ===
        normalizedProductId
    ) ?? null
  );
}

export function getProductByWaffoProductId(
  waffoProductId: string | null | undefined
): PricingProduct | null {
  const normalizedProductId = normalizeWaffoProductId(waffoProductId);
  if (!normalizedProductId) return null;

  return (
    PRICING_PRODUCTS.find(
      (product) =>
        normalizeWaffoProductId(process.env[product.waffoProductEnv]) ===
        normalizedProductId
    ) ?? null
  );
}
