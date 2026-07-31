import { getModelConfig } from "./credits";

export type ImageGenerationCapability =
  | "image-edit"
  | "image-to-image";

export type ImageGenerationModelOption = {
  id: string;
  label: string;
  group: string;
  credits: number;
  capability: ImageGenerationCapability;
  brandLogo: ImageGenerationBrandLogo;
  maxOutputCount: number;
};

export type ImageGenerationBrandLogo = {
  src: string;
  alt: string;
  format: "symbol" | "wordmark";
  surface: "light" | "dark";
};

const MODEL_BRAND_LOGOS = {
  gemini: {
    src: "/model-logos/gemini.svg",
    alt: "Gemini",
    format: "symbol",
    surface: "light",
  },
  bytedanceSeed: {
    src: "/model-logos/bytedance-seed.svg",
    alt: "ByteDance Seed",
    format: "symbol",
    surface: "light",
  },
  openai: {
    src: "/model-logos/openai.svg",
    alt: "OpenAI",
    format: "symbol",
    surface: "light",
  },
  vidu: {
    src: "/model-logos/vidu.svg",
    alt: "Vidu",
    format: "wordmark",
    surface: "dark",
  },
} satisfies Record<string, ImageGenerationBrandLogo>;

const CONNECTED_IMAGE_MODELS: Array<
  Omit<ImageGenerationModelOption, "label" | "credits"> & {
    fallbackLabel: string;
  }
> = [
  {
    id: "gpt-image-2-edit",
    fallbackLabel: "GPT Image 2",
    group: "主力",
    capability: "image-edit",
    brandLogo: MODEL_BRAND_LOGOS.openai,
    maxOutputCount: 4,
  },
  {
    id: "gemini-3.1-flash-edit",
    fallbackLabel: "Gemini 3.1 Flash",
    group: "快速",
    capability: "image-edit",
    brandLogo: MODEL_BRAND_LOGOS.gemini,
    maxOutputCount: 1,
  },
  {
    id: "seedream-5-edit",
    fallbackLabel: "Seedream 5.0",
    group: "经济",
    capability: "image-edit",
    brandLogo: MODEL_BRAND_LOGOS.bytedanceSeed,
    maxOutputCount: 1,
  },
  {
    id: "doubao-seedream-5-edit",
    fallbackLabel: "Doubao Seedream 5.0",
    group: "经济",
    capability: "image-edit",
    brandLogo: MODEL_BRAND_LOGOS.bytedanceSeed,
    maxOutputCount: 1,
  },
  {
    id: "viduq2-i2i",
    fallbackLabel: "Vidu Q2",
    group: "垫图",
    capability: "image-to-image",
    brandLogo: MODEL_BRAND_LOGOS.vidu,
    maxOutputCount: 1,
  },
];

export const IMAGE_GENERATION_MODEL_OPTIONS: ImageGenerationModelOption[] =
  CONNECTED_IMAGE_MODELS.flatMap((model) => {
    const config = getModelConfig(model.id);
    if (config?.enabled === false) return [];

    return [
      {
        id: model.id,
        label: config?.name ?? model.fallbackLabel,
        group: model.group,
        credits: config?.creditCost.base ?? 1,
        capability: model.capability,
        brandLogo: model.brandLogo,
        maxOutputCount: model.maxOutputCount,
      },
    ];
  });

export function getImageGenerationModelOption(modelId: string | undefined) {
  if (!modelId) return null;
  return IMAGE_GENERATION_MODEL_OPTIONS.find((option) => option.id === modelId) ?? null;
}

export function getImageGenerationModelMaxOutputCount(modelId: string | undefined) {
  return getImageGenerationModelOption(modelId)?.maxOutputCount ?? 1;
}

export function defaultImageGenerationModel(_referenceImages: string[]) {
  return "gpt-image-2-edit";
}

export function imageGenerationCapabilityLabel(capability: string) {
  switch (capability) {
    case "image-edit":
      return "图片编辑";
    case "image-to-image":
      return "图生图";
    default:
      return capability;
  }
}
