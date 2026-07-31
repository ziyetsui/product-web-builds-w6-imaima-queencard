import { SUBSCRIPTION_PRODUCTS } from "@/config/pricing-user";

export interface SubscriptionPlanTranslation {
  id: string;
  title: string;
  description: string;
  benefits: string[];
  limitations: string[];
  prices: {
    monthly: number;
    yearly: number;
  };
  credits?: {
    monthly: number;
    yearly: number;
  };
}

/**
 * 定价数据配置
 *
 * 基于 PRICING_REFERENCE.md 文档：
 * - Basic: $9.90/月, $99/年, 280积分/月 (3360积分/年)
 * - Pro: $29.90/月, $299/年, 960积分/月 (11520积分/年)
 * - Ultimate: $79.90/月, $799/年, 2850积分/月 (34200积分/年)
 *
 * 年付 = 月付 × 10（买 10 送 2，省 2 个月）
 *
 * 数据来源：从 SUBSCRIPTION_PRODUCTS (pricing-user.ts) 自动生成
 */

/**
 * 根据 SUBSCRIPTION_PRODUCTS 生成前端展示数据
 */
function generatePriceData() {
  // 按 period 和 name 分组产品
  const monthlyProducts = SUBSCRIPTION_PRODUCTS.filter(p => p.period === "month");
  const yearlyProducts = SUBSCRIPTION_PRODUCTS.filter(p => p.period === "year");

  // 映射计划名称到展示 ID
  const planIdMap: Record<string, string> = {
    "Basic Plan": "basic",
    "Pro Plan": "pro",
    "Ultimate Plan": "ultimate",
  };

  // 生成价格映射
  const pricesMap: Record<string, { monthly: number; yearly: number }> = {};
  const creditsMap: Record<string, { monthly: number; yearly: number }> = {};
  const popularMap: Record<string, boolean> = {};

  for (const product of SUBSCRIPTION_PRODUCTS) {
    const planId = planIdMap[product.name];
    if (!planId) continue;

    if (!pricesMap[planId]) {
      pricesMap[planId] = { monthly: 0, yearly: 0 };
      creditsMap[planId] = { monthly: 0, yearly: 0 };
      popularMap[planId] = product.popular || false;
    }

    if (product.period === "month") {
      pricesMap[planId].monthly = product.priceUsd;
      creditsMap[planId].monthly = product.credits;
    } else {
      pricesMap[planId].yearly = product.priceUsd;
      creditsMap[planId].yearly = product.credits;
    }
  }

  // 定义计划特性
  const planFeatures: Record<string, { benefits: Record<string, string[]>; limitations: Record<string, string[]>; description: Record<string, string> }> = {
    basic: {
      description: {
        zh: "适合初学者和个人用户",
        en: "For beginners and individuals",
      },
      benefits: {
        zh: [
          "每月 280 积分（约 28 个视频）",
          "高清视频生成（720P/1080P）",
          "快速生成通道",
          "商业使用权",
        ],
        en: [
          "280 credits/month (~28 videos)",
          "HD video generation (720P/1080P)",
          "Fast generation",
          "Commercial license",
        ],
      },
      limitations: {
        zh: [
          "无水印功能",
          "无优先支持",
          "无 API 访问权限",
        ],
        en: [
          "No watermark-free videos",
          "No priority support",
          "No API access",
        ],
      },
    },
    pro: {
      description: {
        zh: "推荐给专业用户和创作者",
        en: "Recommended for professionals and creators",
      },
      benefits: {
        zh: [
          "每月 960 积分（约 96 个视频）",
          "高清视频生成（720P/1080P）",
          "快速生成通道",
          "无水印",
          "商业使用权",
          "优先客户支持",
        ],
        en: [
          "960 credits/month (~96 videos)",
          "HD video generation (720P/1080P)",
          "Fast generation",
          "No watermark",
          "Commercial license",
          "Priority support",
        ],
      },
      limitations: {
        zh: ["无 API 访问权限"],
        en: ["No API access"],
      },
    },
    ultimate: {
      description: {
        zh: "适合团队和企业用户",
        en: "For teams and enterprises",
      },
      benefits: {
        zh: [
          "每月 2,850 积分（约 285 个视频）",
          "高清视频生成（720P/1080P）",
          "快速生成通道",
          "无水印",
          "商业使用权",
          "优先客户支持",
          "API 访问权限",
        ],
        en: [
          "2,850 credits/month (~285 videos)",
          "HD video generation (720P/1080P)",
          "Fast generation",
          "No watermark",
          "Commercial license",
          "Priority support",
          "API access",
        ],
      },
      limitations: {
        zh: [],
        en: [],
      },
    },
  };

  const plans: ("basic" | "pro" | "ultimate")[] = ["basic", "pro", "ultimate"];

  // 生成中文数据
  const zhData = plans.map((planId) => ({
    id: planId,
    title: planId.charAt(0).toUpperCase() + planId.slice(1),
    description: planFeatures[planId].description.zh,
    benefits: planFeatures[planId].benefits.zh,
    limitations: planFeatures[planId].limitations.zh,
    prices: pricesMap[planId],
    credits: creditsMap[planId],
    popular: popularMap[planId],
  }));

  // 生成英文数据
  const enData = plans.map((planId) => ({
    id: planId,
    title: planId.charAt(0).toUpperCase() + planId.slice(1),
    description: planFeatures[planId].description.en,
    benefits: planFeatures[planId].benefits.en,
    limitations: planFeatures[planId].limitations.en,
    prices: pricesMap[planId],
    credits: creditsMap[planId],
    popular: popularMap[planId],
  }));

  return { zh: zhData, en: enData };
}

const generatedData = generatePriceData();

export const priceDataMap: Record<string, SubscriptionPlanTranslation[]> = {
  zh: generatedData.zh,
  en: generatedData.en,
};
