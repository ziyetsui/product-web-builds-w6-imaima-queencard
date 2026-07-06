const TRY_ORIGIN = "https://imaimaqueencard.com";
const TRY_BASE_URL = `${TRY_ORIGIN}/generated`;
const MAX_REFERENCE_IMAGES = 3;

export const DEFAULT_TRY_URL = `${TRY_BASE_URL}?type=visual-explainer&ai_polish=0`;

// External generation contract: prompt-library links hand off to
// https://imaimaqueencard.com/generated with enough context for generation. The
// current app does not create local image-generation tasks or spend local
// credits from this bridge.

const DEFAULT_GENERATION_PAYLOAD = {
  input: "讲一个鬼故事",
  style: "professional",
  language: "zh",
  parameters: {
    image: {
      n: 4,
      lang: "zh",
      style: "craft-handmade",
      aspect: "landscape",
      layout: "bridge",
      language: "zh",
      direct_input: false,
      images_per_paragraph: 1,
      image_count_per_paragraph: 1,
    },
    skill_name: "baoyu-infographic",
  },
  skill_name: "baoyu-infographic",
  target_duration: {
    max: 60,
    min: 30,
  },
  enable_web_search: false,
  use_custom_params: false,
};

type PromptTryUrlOptions = {
  templateId?: string;
  prompt?: string;
  referenceImage?: string;
  referenceImages?: string[];
  noteUrl?: string;
  authorUrl?: string;
  sourceCaseId?: string;
  sourceCaseCategory?: string;
  sourceNoteUrl?: string;
  sourceAuthorUrl?: string;
};

function normalizeReferenceImage(referenceImage: string) {
  if (/^https?:\/\//i.test(referenceImage)) return referenceImage;
  return new URL(referenceImage, TRY_ORIGIN).toString();
}

function collectReferenceImages(referenceImages: Array<string | undefined | null>) {
  const seen = new Set<string>();

  return referenceImages
    .filter((image): image is string => Boolean(image))
    .map((image) => normalizeReferenceImage(image))
    .filter((image) => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    })
    .slice(0, MAX_REFERENCE_IMAGES);
}

function normalizeSourceUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return sourceUrl;
    return `${url.origin}${url.pathname}`;
  } catch {
    return sourceUrl;
  }
}

function buildGenerationPayload(prompt: string | undefined, referenceImages: string[]) {
  const input = prompt?.trim() || DEFAULT_GENERATION_PAYLOAD.input;

  return {
    ...DEFAULT_GENERATION_PAYLOAD,
    input,
    reference_images: referenceImages,
    reference_image_urls: referenceImages,
    parameters: {
      ...DEFAULT_GENERATION_PAYLOAD.parameters,
      image: {
        ...DEFAULT_GENERATION_PAYLOAD.parameters.image,
        reference_images: referenceImages,
        reference_image_urls: referenceImages,
        referenceImages,
      },
    },
  };
}

export function buildPromptTryUrl(templateIdOrOptions?: string | PromptTryUrlOptions) {
  const options = typeof templateIdOrOptions === "string" ? { templateId: templateIdOrOptions } : templateIdOrOptions;
  const params = new URLSearchParams({
    type: "visual-explainer",
    ai_polish: "0",
    source: "prompt-library",
    agent: "visual-explainer",
    style: DEFAULT_GENERATION_PAYLOAD.style,
    language: DEFAULT_GENERATION_PAYLOAD.language,
    skill_name: DEFAULT_GENERATION_PAYLOAD.skill_name,
    image_provider: "nanobanana",
    image_style: DEFAULT_GENERATION_PAYLOAD.parameters.image.style,
    image_aspect: DEFAULT_GENERATION_PAYLOAD.parameters.image.aspect,
    image_layout: DEFAULT_GENERATION_PAYLOAD.parameters.image.layout,
    image_count: String(DEFAULT_GENERATION_PAYLOAD.parameters.image.n),
    visual_duration: "30s-1 min",
    visual_content_depth: "Short",
    visual_image_source_mode: "reference",
  });

  if (options?.templateId) {
    params.set("template", options.templateId);
  }

  if (options?.prompt) {
    params.set("prompt", options.prompt);
    params.set("input", options.prompt);
    params.set("value", options.prompt);
    params.set("topic", options.prompt);
    params.set("default_prompt", options.prompt);
  }

  const rawReferenceImages = options?.referenceImages?.length ? options.referenceImages : [options?.referenceImage].filter(Boolean);
  const referenceImages = collectReferenceImages(rawReferenceImages);
  const generationPayload = buildGenerationPayload(options?.prompt, referenceImages);

  params.set("generation_payload", JSON.stringify(generationPayload));
  params.set("payload", JSON.stringify(generationPayload));
  params.set("config", JSON.stringify(generationPayload));
  params.set("parameters", JSON.stringify(generationPayload.parameters));
  params.set("target_duration", JSON.stringify(generationPayload.target_duration));
  params.set("enable_web_search", String(generationPayload.enable_web_search));
  params.set("use_custom_params", String(generationPayload.use_custom_params));

  if (referenceImages.length > 0) {
    params.set("reference_image", referenceImages[0]);
    params.set("reference_image_url", referenceImages[0]);
    params.set("image_source_mode", "reference");
    params.set("visual_image_source_mode", "reference");
    params.set("visualImageSourceMode", "reference");
    params.set("reference_image_count", String(referenceImages.length));
    params.set("reference_images", JSON.stringify(referenceImages));
    params.set("referenceImages", JSON.stringify(referenceImages));
    params.set("reference_image_urls", JSON.stringify(referenceImages));
    params.set("visual_reference_images", JSON.stringify(referenceImages));
    params.set("visualReferenceImages", JSON.stringify(referenceImages));
    params.set("input_images", JSON.stringify(referenceImages));
    referenceImages.forEach((image, index) => {
      params.set(`reference_image_${index + 1}`, image);
      params.append("reference_image_urls[]", image);
      params.append("reference_images[]", image);
      params.append("visual_reference_image_urls[]", image);
      params.append("input_images[]", image);
    });
  }

  if (options?.noteUrl) {
    params.set("note_url", options.noteUrl);
  }

  if (options?.authorUrl) {
    params.set("author_url", options.authorUrl);
  }

  if (options?.sourceCaseId) {
    params.set("source_case_id", options.sourceCaseId);
  }

  if (options?.sourceCaseCategory) {
    params.set("source_case_category", options.sourceCaseCategory);
  }

  const sourceNoteUrl = options?.sourceNoteUrl ?? options?.noteUrl;
  if (sourceNoteUrl) {
    params.set("source_note_url", normalizeSourceUrl(sourceNoteUrl));
  }

  const sourceAuthorUrl = options?.sourceAuthorUrl ?? options?.authorUrl;
  if (sourceAuthorUrl) {
    params.set("source_author_url", normalizeSourceUrl(sourceAuthorUrl));
  }

  return `${TRY_BASE_URL}?${params.toString()}`;
}
