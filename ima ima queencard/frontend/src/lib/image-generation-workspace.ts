export type GeneratedDraftKeyInput = {
  taskId?: string | null;
  source?: string | null;
  sourceCaseId?: string | null;
  templateId?: string | null;
};

export type ComposerDraft = {
  prompt: string;
  referenceImages: string[];
  model?: string;
  aspectRatio?: string;
  outputCount?: number;
  resolution?: string;
  aiEnhance?: boolean;
  fastMode?: boolean;
};

export type ComposerSeedLike = {
  prompt?: string;
  referenceImages?: string[];
  model?: string;
  aspectRatio?: string;
  outputCount?: number;
  resolution?: string;
  aiEnhance?: boolean;
  fastMode?: boolean;
};

export type PromptReuseMode = "append" | "overwrite";

export type ReferenceImageDraftResult =
  | { status: "added"; referenceImages: string[] }
  | { status: "already-present"; referenceImages: string[] }
  | { status: "needs-replacement"; referenceImages: string[] }
  | { status: "replaced"; referenceImages: string[] };

const MAX_REFERENCE_IMAGES = 3;
const DRAFT_STORAGE_PREFIX = "imaima.generated.draft";
const RAIL_COLLAPSED_STORAGE_KEY = "imaima.generated.railCollapsed";

function normalizeReferenceImages(images: unknown) {
  if (!Array.isArray(images)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const image of images) {
    if (typeof image !== "string") continue;
    const value = image.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= MAX_REFERENCE_IMAGES) break;
  }

  return normalized;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeComposerDraft(value: unknown): ComposerDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;

  return {
    prompt: typeof draft.prompt === "string" ? draft.prompt.slice(0, 2000) : "",
    referenceImages: normalizeReferenceImages(draft.referenceImages),
    model: optionalString(draft.model),
    aspectRatio: optionalString(draft.aspectRatio),
    outputCount: optionalNumber(draft.outputCount),
    resolution: optionalString(draft.resolution),
    aiEnhance: optionalBoolean(draft.aiEnhance),
    fastMode: optionalBoolean(draft.fastMode),
  };
}

export function buildGeneratedDraftStorageKey(input: GeneratedDraftKeyInput) {
  if (input.taskId) return `${DRAFT_STORAGE_PREFIX}.task:${input.taskId}`;
  if (input.sourceCaseId) {
    return `${DRAFT_STORAGE_PREFIX}.case:${input.sourceCaseId}`;
  }
  if (input.templateId) {
    return `${DRAFT_STORAGE_PREFIX}.template:${input.templateId}`;
  }
  return `${DRAFT_STORAGE_PREFIX}.${input.source || "manual"}`;
}

export function loadComposerDraft(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    return normalizeComposerDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveComposerDraft(
  storage: Storage,
  key: string,
  draft: ComposerDraft
) {
  storage.setItem(key, JSON.stringify(normalizeComposerDraft(draft)));
}

export function mergeComposerDraftIntoSeed<TSeed extends ComposerSeedLike>(
  seed: TSeed,
  draft: ComposerDraft
) {
  return {
    ...seed,
    prompt: draft.prompt,
    referenceImages: normalizeReferenceImages(draft.referenceImages),
    model: draft.model,
    aspectRatio: draft.aspectRatio,
    outputCount: draft.outputCount,
    resolution: draft.resolution,
    aiEnhance: draft.aiEnhance,
    fastMode: draft.fastMode,
  };
}

export function shouldAskPromptReuseChoice(
  currentPrompt: string,
  quotedPrompt: string
) {
  const current = currentPrompt.trim();
  const quoted = quotedPrompt.trim();
  return Boolean(current && quoted && current !== quoted);
}

export function mergeQuotedPrompt(
  currentPrompt: string,
  quotedPrompt: string,
  mode: PromptReuseMode
) {
  const current = currentPrompt.trim();
  const quoted = quotedPrompt.trim();
  if (!current || mode === "overwrite") return quoted;
  if (!quoted || current === quoted) return current;
  return `${current}\n\n${quoted}`;
}

export function addReferenceImageToDraft(
  currentImages: string[],
  imageUrl: string,
  replaceIndex?: number
): ReferenceImageDraftResult {
  const nextImage = imageUrl.trim();
  const referenceImages = normalizeReferenceImages(currentImages);

  if (!nextImage || referenceImages.includes(nextImage)) {
    return { status: "already-present", referenceImages };
  }

  if (referenceImages.length < MAX_REFERENCE_IMAGES) {
    return {
      status: "added",
      referenceImages: [...referenceImages, nextImage],
    };
  }

  if (
    typeof replaceIndex !== "number" ||
    !Number.isInteger(replaceIndex) ||
    replaceIndex < 0 ||
    replaceIndex >= MAX_REFERENCE_IMAGES
  ) {
    return { status: "needs-replacement", referenceImages };
  }

  const replaced = [...referenceImages];
  replaced[replaceIndex] = nextImage;
  return { status: "replaced", referenceImages: normalizeReferenceImages(replaced) };
}

export function readRailCollapsedPreference(storage: Storage) {
  const value = storage.getItem(RAIL_COLLAPSED_STORAGE_KEY);
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

export function writeRailCollapsedPreference(
  storage: Storage,
  collapsed: boolean
) {
  storage.setItem(RAIL_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
}
