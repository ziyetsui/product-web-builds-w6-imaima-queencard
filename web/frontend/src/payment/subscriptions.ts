import {
  getPricingProduct,
  type PricingProductKey,
  resolveStripePriceId,
} from "@/config/pricing-products";

export interface SubscriptionPlan {
  title: string;
  description: string;
  benefits: string[];
  limitations: string[];
  prices: {
    monthly: number;
    yearly: number;
  };
  pricesCny: {
    monthly: number;
    yearly: number;
  };
  stripeIds: {
    monthly: string | null;
    yearly: string | null;
  };
  productKeys: {
    monthly: PricingProductKey | null;
    yearly: PricingProductKey | null;
  };
}

const creatorMonthly = getPricingProduct("creator_monthly");
const creatorAnnual = getPricingProduct("creator_annual");
const studioMonthly = getPricingProduct("studio_monthly");
const studioAnnual = getPricingProduct("studio_annual");

export const pricingData: SubscriptionPlan[] = [
  {
    title: "免费版",
    description: "注册后获得欢迎积分，适合先体验基础流程。",
    benefits: [
      "新用户欢迎积分",
      "可体验核心图片工作流",
      "需要更多生成额度时可随时升级",
    ],
    limitations: ["生成前需要有可用积分"],
    prices: {
      monthly: 0,
      yearly: 0,
    },
    pricesCny: {
      monthly: 0,
      yearly: 0,
    },
    stripeIds: {
      monthly: null,
      yearly: null,
    },
    productKeys: {
      monthly: null,
      yearly: null,
    },
  },
  {
    title: "创作者版",
    description: "适合稳定发布图像内容的个人创作者。",
    benefits: [
      "每月 600 积分",
      "支持参考图生图",
      "生成内容可商用",
      "年付包含 7,200 积分",
    ],
    limitations: ["暂不包含 API 访问"],
    prices: {
      monthly: creatorMonthly?.priceUsd ?? 0,
      yearly: creatorAnnual?.priceUsd ?? 0,
    },
    pricesCny: {
      monthly: creatorMonthly?.priceCny ?? 0,
      yearly: creatorAnnual?.priceCny ?? 0,
    },
    stripeIds: {
      monthly: resolveStripePriceId("creator_monthly"),
      yearly: resolveStripePriceId("creator_annual"),
    },
    productKeys: {
      monthly: "creator_monthly",
      yearly: "creator_annual",
    },
  },
  {
    title: "工作室版",
    description: "适合高频生成和小团队工作流。",
    benefits: [
      "每月 1,800 积分",
      "支持参考图生图",
      "更高生成额度",
      "年付包含 21,600 积分",
    ],
    limitations: ["暂不包含 API 访问"],
    prices: {
      monthly: studioMonthly?.priceUsd ?? 0,
      yearly: studioAnnual?.priceUsd ?? 0,
    },
    pricesCny: {
      monthly: studioMonthly?.priceCny ?? 0,
      yearly: studioAnnual?.priceCny ?? 0,
    },
    stripeIds: {
      monthly: resolveStripePriceId("studio_monthly"),
      yearly: resolveStripePriceId("studio_annual"),
    },
    productKeys: {
      monthly: "studio_monthly",
      yearly: "studio_annual",
    },
  },
];
