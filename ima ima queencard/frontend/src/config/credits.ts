import {
  getCreditPackPricingProducts,
  getSubscriptionPricingProducts,
} from "./pricing-products";

export type ProductType = "subscription" | "one-time";

export interface CreditPackagePrice {
  amount: number;
  currency: string;
}

export interface CreditPackageConfig {
  id: string;
  name: string;
  credits: number;
  price: CreditPackagePrice;
  type: ProductType;
  billingPeriod?: "month" | "year";
  popular?: boolean;
  disabled?: boolean;
  expireDays?: number;
  features?: string[];
  allowFreeUser?: boolean;
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  creditCost: {
    base: number;
    byResolution?: Partial<Record<"1k" | "2k" | "4k" | "1080p", number>>;
    byResolutionAndReferenceCount?: Partial<
      Record<
        "1080p" | "2k" | "4k",
        {
          upTo3: number;
          over3: number;
        }
      >
    >;
    perExtraSecond?: number;
    highQualityMultiplier?: number;
  };
  enabled?: boolean;
  badge?: string;
}

export const NEW_USER_GIFT = {
  enabled: true,
  credits: 2,
  validDays: 30,
};

export const CREDIT_EXPIRATION = {
  subscriptionDays: 30,
  purchaseDays: 365,
  warnBeforeDays: 7,
};

export const IMAGE_MODEL_CREDIT_PRICING: Record<string, ModelConfig> = {
  "gpt-image": {
    id: "gpt-image",
    name: "GPT Image",
    description: "OpenAI-compatible image generation and editing.",
    creditCost: { base: 4 },
    enabled: false,
  },
  "gpt-image-2-all": {
    id: "gpt-image-2-all",
    name: "GPT Image 2 All",
    description: "GPT image generation and image editing.",
    creditCost: { base: 4 },
    enabled: false,
  },
  "nano-banana-2": {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    description: "Gemini image generation and editing.",
    creditCost: { base: 5, byResolution: { "1k": 5, "2k": 8, "4k": 11 } },
    enabled: false,
  },
  "nano-banana-2-edit": {
    id: "nano-banana-2-edit",
    name: "Nano Banana 2",
    description: "Multi-reference image editing with Gemini image.",
    creditCost: { base: 5, byResolution: { "1k": 5, "2k": 8, "4k": 11 } },
    enabled: false,
    badge: "主力",
  },
  "gemini-3.1-flash-edit": {
    id: "gemini-3.1-flash-edit",
    name: "Gemini 3.1 Flash",
    description: "Fast GPTProto image editing with references.",
    creditCost: { base: 5 },
    enabled: true,
    badge: "快速",
  },
  "gemini-3.1-flash-image-preview": {
    id: "gemini-3.1-flash-image-preview",
    name: "Nano Banana 2",
    description: "Gemini image generation and editing.",
    creditCost: { base: 5, byResolution: { "1k": 5, "2k": 8, "4k": 11 } },
    enabled: false,
  },
  seedream: {
    id: "seedream",
    name: "Seedream",
    description: "Seedream image generation and image editing.",
    creditCost: { base: 4 },
    enabled: false,
  },
  "seedream-5-0-260128": {
    id: "seedream-5-0-260128",
    name: "Seedream 5.0",
    description: "Seedream 5.0 image generation and editing.",
    creditCost: { base: 4 },
    enabled: false,
  },
  "seedream-5-edit": {
    id: "seedream-5-edit",
    name: "Seedream 5.0",
    description: "Seedream 5.0 reference image editing.",
    creditCost: { base: 4 },
    enabled: true,
    badge: "经济",
  },
  "seedream-5-0-260128-edit": {
    id: "seedream-5-0-260128-edit",
    name: "Seedream 5.0",
    description: "Seedream 5.0 reference image editing.",
    creditCost: { base: 4 },
    enabled: false,
    badge: "经济",
  },
  "gpt-image-2-edit": {
    id: "gpt-image-2-edit",
    name: "GPT Image 2",
    description: "Advanced GPT image editing with references.",
    creditCost: { base: 5 },
    enabled: true,
    badge: "主力",
  },
  doubao: {
    id: "doubao",
    name: "Doubao Image",
    description: "Doubao image generation and editing.",
    creditCost: { base: 4 },
    enabled: false,
  },
  "doubao-seedream-5-edit": {
    id: "doubao-seedream-5-edit",
    name: "Doubao Seedream 5.0",
    description: "Doubao Seedream 5.0 reference image editing.",
    creditCost: { base: 4 },
    enabled: true,
    badge: "备用",
  },
  "doubao-seedream-5-0-260128-edit": {
    id: "doubao-seedream-5-0-260128-edit",
    name: "Doubao Seedream 5.0",
    description: "Legacy alias for Doubao Seedream 5.0 image editing.",
    creditCost: { base: 4 },
    enabled: false,
    badge: "备用",
  },
  "qwen-image": {
    id: "qwen-image",
    name: "Qwen Image",
    description: "Qwen image generation and editing.",
    creditCost: { base: 3 },
    enabled: false,
  },
  "kling-image": {
    id: "kling-image",
    name: "Kling Image",
    description: "Kling image generation and editing.",
    creditCost: { base: 3 },
    enabled: false,
  },
  "kling-image-o1-i2i": {
    id: "kling-image-o1-i2i",
    name: "Kling Image O1",
    description: "Image-to-image structure keeping and style transfer.",
    creditCost: { base: 3 },
    enabled: false,
  },
  "viduq2-i2i": {
    id: "viduq2-i2i",
    name: "Vidu Q2",
    description: "Vidu Q2 image-to-image generation.",
    creditCost: {
      base: 3,
      byResolutionAndReferenceCount: {
        "1080p": { upTo3: 3, over3: 4 },
        "2k": { upTo3: 6, over3: 10 },
        "4k": { upTo3: 7, over3: 15 },
      },
    },
    enabled: true,
    badge: "垫图",
  },
  "grok-image": {
    id: "grok-image",
    name: "Grok Image",
    description: "Grok image generation and editing.",
    creditCost: { base: 2 },
    enabled: false,
  },
  "grok-2-image": {
    id: "grok-2-image",
    name: "Grok 2 Image",
    description: "Grok 2 image generation and editing.",
    creditCost: { base: 2 },
    enabled: false,
  },
  ideogram: {
    id: "ideogram",
    name: "Ideogram",
    description: "Ideogram image generation and editing.",
    creditCost: { base: 6 },
    enabled: false,
  },
  "gemini-pro-image": {
    id: "gemini-pro-image",
    name: "Gemini Pro Image",
    description: "Premium Gemini image generation.",
    creditCost: { base: 10 },
    enabled: false,
  },
  upscaler: {
    id: "upscaler",
    name: "Image Upscaler",
    description: "Image upscaling.",
    creditCost: { base: 2 },
    enabled: false,
  },
  "background-remover": {
    id: "background-remover",
    name: "Background Remover",
    description: "Image background removal.",
    creditCost: { base: 1 },
    enabled: false,
  },
};

function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

export const CREDITS_CONFIG = {
  enabled: true,
  registerGift: {
    enabled: NEW_USER_GIFT.enabled,
    amount: NEW_USER_GIFT.credits,
    expireDays: NEW_USER_GIFT.validDays,
  },
  expiration: {
    subscriptionDays: CREDIT_EXPIRATION.subscriptionDays,
    purchaseDays: CREDIT_EXPIRATION.purchaseDays,
    warnBeforeDays: CREDIT_EXPIRATION.warnBeforeDays,
  },
  subscriptions: Object.fromEntries(
    getSubscriptionPricingProducts().map((product) => [
      product.key,
      {
        id: product.key,
        name: product.title,
        credits: product.credits,
        price: {
          amount: usdToCents(product.priceUsd),
          currency: "USD",
        },
        type: "subscription" as const,
        billingPeriod: product.billingPeriod ?? undefined,
        popular: product.popular,
        expireDays: product.validityDays,
        features: product.features,
      },
    ])
  ) as Record<string, CreditPackageConfig>,
  packages: Object.fromEntries(
    getCreditPackPricingProducts().map((pkg) => [
      pkg.key,
      {
        id: pkg.key,
        name: pkg.title,
        credits: pkg.credits,
        price: {
          amount: usdToCents(pkg.priceUsd),
          currency: "USD",
        },
        type: "one-time" as const,
        popular: pkg.popular,
        expireDays: pkg.validityDays,
        features: pkg.features,
        allowFreeUser: true,
      },
    ])
  ) as Record<string, CreditPackageConfig>,
  models: IMAGE_MODEL_CREDIT_PRICING,
};

export function getSubscriptionProducts(): CreditPackageConfig[] {
  return Object.values(CREDITS_CONFIG.subscriptions).filter(
    (product) => !product.disabled
  );
}

export function getOnetimeProducts(): CreditPackageConfig[] {
  return Object.values(CREDITS_CONFIG.packages).filter(
    (product) => !product.disabled
  );
}

export function getProductById(productId: string): CreditPackageConfig | null {
  const allProducts = {
    ...CREDITS_CONFIG.subscriptions,
    ...CREDITS_CONFIG.packages,
  };

  return Object.values(allProducts).find((product) => product.id === productId) || null;
}

export function getProductExpiryDays(product: CreditPackageConfig): number {
  if (product.expireDays !== undefined) {
    return product.expireDays;
  }

  return product.type === "subscription"
    ? CREDITS_CONFIG.expiration.subscriptionDays
    : CREDITS_CONFIG.expiration.purchaseDays;
}

export function getAvailableModels(): ModelConfig[] {
  return Object.values(CREDITS_CONFIG.models).filter((model) => model.enabled);
}

export function getModelConfig(modelId: string): ModelConfig | null {
  return CREDITS_CONFIG.models[modelId] ?? null;
}

export function calculateModelCredits(
  modelId: string,
  params: {
    duration?: number;
    outputNumber?: number;
    resolution?: string | null;
    referenceImageCount?: number;
  } = {}
): number {
  const outputNumber = params.outputNumber ?? 1;
  const model = getModelConfig(modelId);
  const resolution = normalizeCreditResolution(params.resolution);
  const referenceImageCount = Math.max(0, Math.floor(params.referenceImageCount ?? 0));
  const referenceTier =
    model?.creditCost.byResolutionAndReferenceCount?.[resolution];
  const baseCredits = referenceTier
    ? referenceImageCount > 3
      ? referenceTier.over3
      : referenceTier.upTo3
    : model?.creditCost.byResolution?.[resolution] ?? model?.creditCost.base ?? 1;

  return Math.max(1, baseCredits * outputNumber);
}

function normalizeCreditResolution(
  resolution: string | null | undefined
): "1k" | "2k" | "4k" | "1080p" {
  const value = resolution?.trim().toLowerCase();
  if (value === "4k") return "4k";
  if (value === "2k") return "2k";
  if (value === "1080p") return "1080p";
  return "1k";
}
