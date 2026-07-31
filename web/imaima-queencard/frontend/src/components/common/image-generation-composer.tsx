"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { ModelBrandLogo } from "@/components/common/model-brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  IMAGE_GENERATION_MODEL_OPTIONS,
  defaultImageGenerationModel,
  type ImageGenerationModelOption,
} from "@/config/image-generation-models";
import {
  loadComposerDraft,
  saveComposerDraft,
  type ComposerDraft,
} from "@/lib/image-generation-workspace";
import { cn } from "@/lib/utils";

export type ImageGenerationSeed = {
  source?: "manual" | "prompt-library" | "regenerate";
  templateId?: string;
  sourceCaseId?: string;
  sourceCaseCategory?: string;
  sourceNoteUrl?: string;
  sourceAuthorUrl?: string;
  title?: string;
  prompt?: string;
  referenceImages?: string[];
  model?: string;
  aspectRatio?: string;
  outputCount?: number;
  resolution?: string;
  aiEnhance?: boolean;
  fastMode?: boolean;
  previewFlow?: boolean;
};

const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
const OUTPUT_COUNTS = [1, 2, 3, 4];
const RESOLUTIONS = ["auto", "1k", "2k", "4k"];
const MAX_REFERENCE_IMAGES = 3;
const ASPECT_MARK_CLASS: Record<string, string> = {
  "1:1": "h-5 w-5",
  "3:4": "h-6 w-4",
  "4:3": "h-4 w-6",
  "16:9": "h-3 w-7",
  "9:16": "h-7 w-3",
  "2:3": "h-6 w-4",
  "3:2": "h-4 w-6",
  "21:9": "h-2.5 w-7",
};

type FillPrompt = {
  theme: string;
  title: string;
  replicationParameters: string;
};

function defaultModelFor(referenceImages: string[]) {
  return defaultImageGenerationModel(referenceImages);
}

function optionFor(model: string) {
  return (
    IMAGE_GENERATION_MODEL_OPTIONS.find((option) => option.id === model) ??
    IMAGE_GENERATION_MODEL_OPTIONS[0]
  );
}

function modelForSeed(seed: ImageGenerationSeed | undefined, referenceImages: string[]) {
  return seed?.model &&
    IMAGE_GENERATION_MODEL_OPTIONS.some((option) => option.id === seed.model)
    ? seed.model
    : defaultModelFor(referenceImages);
}

function aspectRatioForSeed(seed: ImageGenerationSeed | undefined, referenceImages: string[]) {
  return seed?.aspectRatio && ASPECT_RATIOS.includes(seed.aspectRatio)
    ? seed.aspectRatio
    : "3:4";
}

function outputCountForSeed(seed: ImageGenerationSeed | undefined) {
  return seed?.outputCount && OUTPUT_COUNTS.includes(seed.outputCount)
    ? seed.outputCount
    : 1;
}

function outputCountsForOption(option: ImageGenerationModelOption) {
  return OUTPUT_COUNTS.filter((count) => count <= option.maxOutputCount);
}

function clampOutputCountForOption(
  outputCount: number,
  option: ImageGenerationModelOption
) {
  return Math.min(outputCount, option.maxOutputCount);
}

function modelRequiresReference() {
  return true;
}

function resolutionForSeed(seed: ImageGenerationSeed | undefined) {
  return seed?.resolution && RESOLUTIONS.includes(seed.resolution) ? seed.resolution : "auto";
}

function uniqueFirstThree(images: string[] | undefined) {
  const seen = new Set<string>();
  return (images ?? [])
    .filter(Boolean)
    .filter((image) => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    })
    .slice(0, MAX_REFERENCE_IMAGES);
}

function resolutionLabel(resolution: string) {
  return resolution === "auto" ? "自动" : resolution.toUpperCase();
}

function optionDisplayLabel(option: string) {
  return option === "auto" ? "自动" : option;
}

function parseFillPrompt(value: string): FillPrompt | null {
  const match = value.match(
    /^生成一组新的(.+?)主题：标题《([^》]*)》，(?:复刻参数|副标题)(?:《([^》]*)》|[“"]([^”"]*)[”"])。?$/
  );
  if (!match) return null;
  return {
    theme: match[1] ?? "",
    title: match[2] ?? "",
    replicationParameters: match[3] ?? match[4] ?? "",
  };
}

function buildFillPrompt(prompt: FillPrompt) {
  return `生成一组新的${prompt.theme}主题：标题《${prompt.title}》，复刻参数“${prompt.replicationParameters}”`;
}

function setOptionalParam(params: URLSearchParams, key: string, value: string | undefined) {
  if (value) params.set(key, value);
}

function buildGeneratedPath({
  seed,
  prompt,
  referenceImages,
  model,
  aspectRatio,
  outputCount,
  resolution,
  aiEnhance,
  fastMode,
}: {
  seed: ImageGenerationSeed | undefined;
  prompt: string;
  referenceImages: string[];
  model: string;
  aspectRatio: string;
  outputCount: number;
  resolution: string;
  aiEnhance: boolean;
  fastMode: boolean;
}) {
  const params = new URLSearchParams({
    source: seed?.source ?? "manual",
    prompt,
    model,
    aspect_ratio: aspectRatio,
    output_count: String(outputCount),
    resolution,
    ai_enhance: aiEnhance ? "1" : "0",
    fast_mode: fastMode ? "1" : "0",
    seeded: "1",
  });

  setOptionalParam(params, "template", seed?.templateId);
  setOptionalParam(params, "source_case_id", seed?.sourceCaseId);
  setOptionalParam(params, "source_case_category", seed?.sourceCaseCategory);
  setOptionalParam(params, "source_note_url", seed?.sourceNoteUrl);
  setOptionalParam(params, "source_author_url", seed?.sourceAuthorUrl);
  setOptionalParam(params, "title", seed?.title);

  if (referenceImages.length > 0) {
    params.set("reference_images", JSON.stringify(referenceImages));
    params.set("reference_image_urls", JSON.stringify(referenceImages));
    params.set("input_images", JSON.stringify(referenceImages));
    referenceImages.forEach((image) => {
      params.append("reference_images[]", image);
      params.append("reference_image_urls[]", image);
      params.append("input_images[]", image);
    });
  }

  return `/generated?${params.toString()}`;
}

function createPreviewTask({
  seed,
  prompt,
  referenceImages,
  model,
  selectedOption,
  aspectRatio,
  outputCount,
  resolution,
  estimatedCredits,
}: {
  seed: ImageGenerationSeed | undefined;
  prompt: string;
  referenceImages: string[];
  model: string;
  selectedOption: ImageGenerationModelOption;
  aspectRatio: string;
  outputCount: number;
  resolution: string;
  estimatedCredits: number;
}) {
  const taskId = `preview_${Date.now()}`;
  const fallbackImages = ["/placeholder.svg"];
  const imagePool = referenceImages.length > 0 ? referenceImages : fallbackImages;
  const assets = Array.from({ length: outputCount }).map((_, index) => ({
    id: `preview_asset_${taskId}_${index + 1}`,
    url: imagePool[index % imagePool.length],
    width: null,
    height: null,
    creditsCharged: 0,
  }));

  return {
    taskId,
    status: "completed",
    source: seed?.source ?? "manual",
    sourceCaseId: seed?.sourceCaseId ?? null,
    sourceCaseCategory: seed?.sourceCaseCategory ?? null,
    prompt,
    referenceImages,
    model,
    providerModel: selectedOption.label,
    capability: selectedOption.capability,
    aspectRatio,
    resolution,
    outputCount,
    requestedCredits: 0,
    settledCredits: 0,
    previewRequestedCredits: estimatedCredits,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    assets,
  };
}

function textWidthCh(value: string, min: number, max: number) {
  const width = Array.from(value).reduce((sum, character) => {
    return sum + (character.charCodeAt(0) > 255 ? 2 : 1);
  }, 0);
  return `${Math.min(max, Math.max(min, width + 2))}ch`;
}

function AspectRatioMark({
  ratio,
  active = false,
}: {
  ratio: string;
  active?: boolean;
}) {
  return (
    <span className="inline-flex h-7 w-8 shrink-0 items-center justify-center" aria-hidden="true">
      <span
        className={cn(
          "rounded-[4px] border-2",
          active ? "border-current bg-current/10" : "border-current/55",
          ASPECT_MARK_CLASS[ratio] ?? "h-5 w-5"
        )}
      />
    </span>
  );
}

function FillSlotInput({
  label,
  value,
  onChange,
  minWidth,
  maxWidth,
  tone = "lemon",
  fullWidth = false,
  align = "center",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minWidth: number;
  maxWidth: number;
  tone?: "lemon" | "sky";
  fullWidth?: boolean;
  align?: "left" | "center";
}) {
  return (
    <Input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={fullWidth ? undefined : { width: textWidthCh(value, minWidth, maxWidth) }}
      className={cn(
        "inline-flex h-8 max-w-full rounded-[4px] border-0 border-b-[3px] border-charcoal px-2 font-manrope text-[15px] font-black leading-none text-charcoal shadow-brand-sm ring-offset-0 focus-visible:ring-0 md:text-[16px]",
        fullWidth ? "w-full" : "mx-1",
        align === "left" ? "text-left" : "text-center",
        tone === "sky" ? "bg-sky/75" : "bg-lemon"
      )}
    />
  );
}

function FillPromptEditor({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const parsed = parseFillPrompt(value);

  if (!parsed) {
    return (
      <div className={cn("min-h-full rounded-[18px] border border-charcoal/14 bg-canvas-pink/34 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]", className)}>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="描述你想生成的图片..."
          className="min-h-[96px] resize-none border-0 bg-transparent p-0 font-manrope text-[14px] font-extrabold leading-[1.7] text-charcoal shadow-none outline-none placeholder:text-charcoal/35 focus-visible:ring-0 md:min-h-[130px]"
        />
        <div className="mt-1 text-right font-mono text-[12px] font-bold text-charcoal/42">
          {value.length}/2000
        </div>
      </div>
    );
  }

  const updateSlot = (slot: keyof FillPrompt, nextValue: string) => {
    onChange(buildFillPrompt({ ...parsed, [slot]: nextValue }));
  };

  return (
    <div className={cn("min-h-full rounded-[18px] border border-charcoal/14 bg-canvas-pink/34 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]", className)}>
      <div className="flex min-h-[96px] flex-col justify-center gap-2.5 font-manrope text-[15px] font-extrabold text-charcoal md:min-h-[130px] md:text-[16px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="shrink-0">生成一组新的</span>
          <FillSlotInput
            label="主题"
            value={parsed.theme}
            onChange={(nextValue) => updateSlot("theme", nextValue)}
            minWidth={8}
            maxWidth={18}
          />
          <span className="shrink-0">主题</span>
        </div>

        <label className="grid items-center gap-2 md:grid-cols-[72px_minmax(0,1fr)]">
          <span className="font-black">标题</span>
          <div className="flex min-w-0 items-center gap-2">
            <FillSlotInput
              label="标题"
              value={parsed.title}
              onChange={(nextValue) => updateSlot("title", nextValue)}
              minWidth={18}
              maxWidth={56}
              fullWidth
              align="left"
            />
          </div>
        </label>

        <label className="grid items-center gap-2 md:grid-cols-[72px_minmax(0,1fr)]">
          <span className="font-black">复刻参数</span>
          <div className="flex min-w-0 items-center gap-2">
            <FillSlotInput
              label="复刻参数"
              value={parsed.replicationParameters}
              onChange={(nextValue) => updateSlot("replicationParameters", nextValue)}
              minWidth={18}
              maxWidth={60}
              tone="sky"
              fullWidth
              align="left"
            />
          </div>
        </label>
      </div>
      <div className="mt-1 text-right font-mono text-[12px] font-bold text-charcoal/42">
        {value.length}/2000
      </div>
    </div>
  );
}

export function ImageGenerationComposer({
  seed,
  className,
  submitLabel = "生成",
  showHeader = true,
  frameless = false,
  layout = "expanded",
  onPromptChange,
  onDraftChange,
  draftStorageKey,
  submitMode = "create-task",
  onCollapse,
}: {
  seed?: ImageGenerationSeed;
  className?: string;
  submitLabel?: string;
  showHeader?: boolean;
  frameless?: boolean;
  layout?: "expanded" | "compact" | "workbench";
  onPromptChange?: (prompt: string) => void;
  onDraftChange?: (draft: ComposerDraft) => void;
  draftStorageKey?: string;
  submitMode?: "create-task" | "open-generated" | "preview-result";
  onCollapse?: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextDraftPersistRef = useRef(false);
  const onDraftChangeRef = useRef(onDraftChange);
  const seedKey = JSON.stringify(seed ?? {});
  const seedSnapshot = useMemo(() => JSON.parse(seedKey) as ImageGenerationSeed, [seedKey]);
  const [prompt, setPrompt] = useState(seed?.prompt ?? "");
  const [referenceImages, setReferenceImages] = useState(() =>
    uniqueFirstThree(seed?.referenceImages)
  );
  const [model, setModel] = useState(() =>
    modelForSeed(seed, uniqueFirstThree(seed?.referenceImages))
  );
  const [aspectRatio, setAspectRatio] = useState(() =>
    aspectRatioForSeed(seed, uniqueFirstThree(seed?.referenceImages))
  );
  const [outputCount, setOutputCount] = useState(() => outputCountForSeed(seed));
  const [resolution, setResolution] = useState(() => resolutionForSeed(seed));
  const [aiEnhance, setAiEnhance] = useState(seed?.aiEnhance ?? false);
  const [fastMode, setFastMode] = useState(seed?.fastMode ?? true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  useEffect(() => {
    const nextReferences = uniqueFirstThree(seedSnapshot.referenceImages);
    const seedDraft: ComposerDraft = {
      prompt: seedSnapshot.prompt ?? "",
      referenceImages: nextReferences,
      model: modelForSeed(seedSnapshot, nextReferences),
      aspectRatio: aspectRatioForSeed(seedSnapshot, nextReferences),
      outputCount: outputCountForSeed(seedSnapshot),
      resolution: resolutionForSeed(seedSnapshot),
      aiEnhance: seedSnapshot.aiEnhance ?? false,
      fastMode: seedSnapshot.fastMode ?? true,
    };
    const storedDraft =
      draftStorageKey && typeof window !== "undefined"
        ? loadComposerDraft(window.localStorage, draftStorageKey)
        : null;
    const nextDraft = storedDraft
      ? {
          ...seedDraft,
          ...storedDraft,
          referenceImages: storedDraft.referenceImages,
        }
      : seedDraft;

    skipNextDraftPersistRef.current = true;
    setPrompt(nextDraft.prompt);
    setReferenceImages(uniqueFirstThree(nextDraft.referenceImages));
    setModel(modelForSeed(nextDraft, nextDraft.referenceImages));
    setAspectRatio(aspectRatioForSeed(nextDraft, nextDraft.referenceImages));
    setOutputCount(outputCountForSeed(nextDraft));
    setResolution(resolutionForSeed(nextDraft));
    setAiEnhance(nextDraft.aiEnhance ?? false);
    setFastMode(nextDraft.fastMode ?? true);
    setError(null);
  }, [draftStorageKey, seedSnapshot]);

  const selectedOption = optionFor(model);
  const allowedOutputCounts = outputCountsForOption(selectedOption);
  const effectiveOutputCount = clampOutputCountForOption(outputCount, selectedOption);
  const estimatedCredits = selectedOption.credits * effectiveOutputCount;
  const hasReferenceImage = referenceImages.length > 0;
  const requiresReference = modelRequiresReference();
  const canSubmit =
    prompt.trim().length > 0 &&
    (!requiresReference || hasReferenceImage) &&
    !isSubmitting;
  const generationNotice = hasReferenceImage
    ? `点击生成后会冻结 ${estimatedCredits} 积分；失败或无输出会自动释放。参考图不会被改变。`
    : "请先上传至少 1 张参考图；图生图会基于参考图生成新画面。";
  const sourceUrl = seed?.sourceNoteUrl ?? seed?.sourceAuthorUrl;

  const groupedModels = useMemo(() => {
    return IMAGE_GENERATION_MODEL_OPTIONS.reduce<Record<string, ImageGenerationModelOption[]>>((groups, option) => {
      groups[option.group] = [...(groups[option.group] ?? []), option];
      return groups;
    }, {});
  }, []);

  const composerDraft = useMemo(
    () => ({
      prompt,
      referenceImages,
      model,
      aspectRatio,
      outputCount: effectiveOutputCount,
      resolution,
      aiEnhance,
      fastMode,
    }),
    [
      aiEnhance,
      aspectRatio,
      effectiveOutputCount,
      fastMode,
      model,
      prompt,
      referenceImages,
      resolution,
    ]
  );

  useEffect(() => {
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }

    onDraftChangeRef.current?.(composerDraft);
    if (!draftStorageKey || typeof window === "undefined") return;
    saveComposerDraft(window.localStorage, draftStorageKey, composerDraft);
  }, [composerDraft, draftStorageKey]);

  useEffect(() => {
    setOutputCount((current) => clampOutputCountForOption(current, selectedOption));
  }, [selectedOption]);

  const updatePrompt = (value: string) => {
    const nextPrompt = value.slice(0, 2000);
    setPrompt(nextPrompt);
    onPromptChange?.(nextPrompt);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const nextImages = [...referenceImages];
    for (const file of Array.from(files)) {
      if (nextImages.length >= MAX_REFERENCE_IMAGES) break;
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      nextImages.push(dataUri);
    }
    setReferenceImages(uniqueFirstThree(nextImages));
    if (!model.endsWith("-edit") && !model.endsWith("-i2i")) {
      setModel(defaultModelFor(nextImages));
    }
  };

  const submit = async () => {
    if (requiresReference && !hasReferenceImage) {
      setError("请先上传至少 1 张参考图。");
      return;
    }
    if (!canSubmit) return;
    if (submitMode === "open-generated") {
      setError(null);
      router.push(
        buildGeneratedPath({
          seed,
          prompt,
          referenceImages,
          model,
          aspectRatio,
          outputCount: effectiveOutputCount,
          resolution,
          aiEnhance,
          fastMode,
        })
      );
      return;
    }
    if (submitMode === "preview-result") {
      setError(null);
      const previewTask = createPreviewTask({
        seed,
        prompt,
        referenceImages,
        model,
        selectedOption,
        aspectRatio,
        outputCount: effectiveOutputCount,
        resolution,
        estimatedCredits,
      });
      window.localStorage.setItem(
        `image-generation-preview:${previewTask.taskId}`,
        JSON.stringify(previewTask)
      );
      router.push(`/generated?taskId=${previewTask.taskId}`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/image-generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: seed?.source ?? "manual",
          templateId: seed?.templateId,
          sourceCaseId: seed?.sourceCaseId,
          sourceCaseCategory: seed?.sourceCaseCategory,
          sourceNoteUrl: seed?.sourceNoteUrl,
          sourceAuthorUrl: seed?.sourceAuthorUrl,
          prompt,
          referenceImages,
          model,
          capability: selectedOption.capability,
          aspectRatio,
          outputCount: effectiveOutputCount,
          resolution,
          aiEnhance,
          fastMode,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        const message = body?.error?.message ?? "生成任务创建失败";
        if (response.status === 401) {
          const from = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?from=${from}`;
          return;
        }
        if (response.status === 402) {
          setError("积分不足，请先购买积分或降低输出张数。");
          return;
        }
        throw new Error(message);
      }

      toast.success("生成任务已创建，正在打开生成页");
      router.push(body.data.redirectUrl ?? `/generated?taskId=${body.data.taskId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成任务创建失败";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompactShellClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onCollapse) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest(
        "button, input, textarea, a, [role='button'], [data-radix-popper-content-wrapper]"
      )
    ) {
      return;
    }
    onCollapse();
  };

  if (layout === "workbench") {
    return (
      <section
        className={cn(
          "overflow-hidden rounded-[14px] border-2 border-charcoal bg-surface-white shadow-brand-lg",
          className
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        <div className="flex flex-col gap-4 border-b-2 border-charcoal bg-lemon px-5 py-4 md:flex-row md:items-center md:justify-between md:px-7 md:py-5">
          <div className="min-w-0">
            <p className="font-manrope text-[13px] font-black text-charcoal/55">
              {seed?.sourceCaseCategory ?? "图片生成"}
            </p>
            <h2 className="mt-1 line-clamp-2 font-manrope text-[22px] font-black leading-tight text-charcoal md:text-[28px]">
              {seed?.title ?? "把参考图变成新图文"}
            </h2>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center rounded-[9px] border-2 border-charcoal bg-surface-white px-4 py-2 font-manrope text-[15px] font-black text-charcoal shadow-brand-sm">
            预估 {estimatedCredits} 积分
          </span>
        </div>

        <div className="grid gap-7 px-5 py-5 md:px-7 md:py-7">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-manrope text-[15px] font-black text-charcoal">
                参考图 {referenceImages.length}/{MAX_REFERENCE_IMAGES}
              </span>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] rounded-[9px] border-2 border-charcoal bg-surface-white px-4 font-manrope text-[15px] font-black text-charcoal shadow-none hover:bg-lemon disabled:border-charcoal/35 disabled:text-charcoal/45 disabled:hover:bg-surface-white"
                onClick={() => fileInputRef.current?.click()}
                disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
              >
                <Plus size={18} strokeWidth={2.7} />
                上传
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: MAX_REFERENCE_IMAGES }).map((_, index) => {
                const image = referenceImages[index];

                return (
                  <div
                    key={image ?? `workbench-empty-${index}`}
                    className="relative aspect-[3/4] overflow-hidden rounded-[10px] border-2 border-charcoal bg-canvas-pink"
                  >
                    {image ? (
                      <>
                        <img
                          src={image}
                          alt={`参考图 ${index + 1}`}
                          className="h-full w-full object-cover object-top"
                        />
                        <button
                          type="button"
                          aria-label="移除参考图"
                          onClick={() =>
                            setReferenceImages((images) =>
                              images.filter((_, imageIndex) => imageIndex !== index)
                            )
                          }
                          className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-full border-2 border-charcoal bg-surface-white text-charcoal shadow-brand-sm transition-transform hover:-translate-y-0.5 hover:bg-lemon"
                        >
                          <Trash2 size={17} strokeWidth={2.6} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-full w-full flex-col items-center justify-center gap-2 font-manrope text-[14px] font-black text-charcoal/50 transition-colors hover:bg-lemon/35"
                      >
                        <ImagePlus size={26} strokeWidth={2.6} />
                        添加参考图
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-manrope text-[15px] font-black text-charcoal">提示词</span>
              <span className="font-mono text-[13px] font-black text-charcoal/42">
                {prompt.length}/2000
              </span>
            </div>
            <Textarea
              value={prompt}
              onChange={(event) => updatePrompt(event.target.value)}
              placeholder="描述你要生成的小红书图文画面..."
              className="min-h-[150px] resize-none rounded-[10px] border-2 border-charcoal bg-canvas-pink/35 px-4 py-4 font-manrope text-[15px] font-extrabold leading-[1.75] text-charcoal shadow-none placeholder:text-charcoal/35 focus-visible:ring-0 md:text-[16px]"
            />
          </div>

          <div className="grid gap-4 rounded-[12px] border-2 border-charcoal bg-canvas-pink p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_1.2fr]">
              <div className="grid gap-2">
                <span className="font-manrope text-[13px] font-black text-charcoal/58">生成模型</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex min-h-[54px] w-full items-center justify-between gap-3 rounded-[10px] border-2 border-charcoal bg-surface-white px-4 text-left font-manrope text-charcoal transition-colors hover:bg-lemon"
                      aria-label={`选择模型：${selectedOption.label}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ModelBrandLogo logo={selectedOption.brandLogo} active />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-black">
                            {selectedOption.label}
                          </span>
                          <span className="block text-[12px] font-extrabold text-charcoal/52">
                            {selectedOption.group} · {selectedOption.credits} 积分/张
                          </span>
                        </span>
                      </span>
                      <ChevronDown size={18} strokeWidth={2.8} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[min(calc(100vw-32px),480px)] rounded-[14px] border-2 border-charcoal bg-surface-white p-3 text-charcoal shadow-brand-lg"
                  >
                    <div className="grid content-start gap-3">
                      {Object.entries(groupedModels).map(([group, options]) => (
                        <div key={group} className="grid gap-1">
                          <p className="px-2 font-manrope text-[11px] font-extrabold text-charcoal/45">{group}</p>
                          {options.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setModel(option.id)}
                              className={cn(
                                "flex min-h-[44px] cursor-pointer items-center justify-between rounded-[9px] border-2 px-2 text-left font-manrope transition-colors hover:bg-lemon",
                                model === option.id
                                  ? "border-charcoal bg-lemon text-charcoal"
                                  : "border-transparent bg-canvas-pink text-charcoal"
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <ModelBrandLogo logo={option.brandLogo} active={model === option.id} />
                                <span className="min-w-0">
                                  <span className="block truncate text-[13px] font-black">{option.label}</span>
                                  <span className="block text-[11px] font-extrabold opacity-60">
                                    {option.credits} 积分/张
                                  </span>
                                </span>
                              </span>
                              {model === option.id ? <Check size={16} strokeWidth={3} /> : null}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <SegmentedControl
                  label="比例"
                  value={aspectRatio}
                  options={ASPECT_RATIOS}
                  onChange={setAspectRatio}
                />
                <SegmentedControl
                  label="张数"
                  value={String(outputCount)}
                  options={allowedOutputCounts.map(String)}
                  onChange={(value) => setOutputCount(Number(value))}
                />
                <SegmentedControl
                  label="分辨率"
                  value={resolution}
                  options={RESOLUTIONS}
                  onChange={setResolution}
                />
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <ToggleRow
                icon={<Wand2 size={17} />}
                label="智能优化"
                checked={aiEnhance}
                onCheckedChange={setAiEnhance}
              />
              <ToggleRow
                icon={<Sparkles size={17} />}
                label="快速模式"
                checked={fastMode}
                onCheckedChange={setFastMode}
              />
              <div className="flex flex-col gap-2 md:min-w-[220px]">
                <span className="font-manrope text-[12px] font-black text-charcoal/58">
                  本次预计冻结
                </span>
                <span className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border-2 border-charcoal bg-surface-white px-4 font-mono text-[14px] font-black text-charcoal">
                  {estimatedCredits} 积分
                </span>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-[9px] border-2 border-charcoal bg-pumpkin px-4 py-3 font-manrope text-[14px] font-black text-charcoal">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t-2 border-charcoal pt-5 md:flex-row md:items-center md:justify-between">
            <p className="max-w-[640px] font-manrope text-[13px] font-extrabold leading-6 text-charcoal/58">
              {generationNotice}
            </p>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="min-h-[56px] min-w-[220px] rounded-[12px] border-2 border-charcoal bg-pumpkin px-7 font-manrope text-[18px] font-black text-charcoal shadow-brand hover:bg-pumpkin"
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Send size={20} strokeWidth={2.8} />}
              {isSubmitting ? "生成中" : submitLabel}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (layout === "compact") {
    return (
      <div
        onClick={handleCompactShellClick}
        className={cn(
          frameless
            ? "overflow-hidden bg-surface-white"
            : "generated-command overflow-hidden",
          className
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        <div className="cursor-pointer bg-surface-white/72 p-3 md:p-4">
          <div className="grid gap-3 md:grid-cols-[132px_1fr] md:items-stretch">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`参考图 ${referenceImages.length}/${MAX_REFERENCE_IMAGES}`}
                  className={cn(
                    "relative flex min-h-[88px] w-full flex-col items-center justify-center overflow-hidden rounded-[18px] border bg-canvas-pink/44 p-3 text-center font-manrope text-charcoal transition-all hover:-translate-y-[2px] hover:bg-canvas-pink/72 md:min-h-[132px]",
                    referenceImages.length > 0
                      ? "border-charcoal/20 bg-surface-white shadow-[0_16px_36px_rgba(26,23,20,0.08)]"
                      : "border-dashed border-charcoal/30"
                  )}
                >
                  {referenceImages[0] ? (
                    <>
                      <img
                        src={referenceImages[0]}
                        alt="当前参考首图"
                        className="absolute inset-0 h-full w-full object-cover object-top"
                      />
                      <span className="absolute left-2 top-2 rounded-full border border-charcoal/18 bg-surface-white/90 px-2 py-1 text-[11px] font-extrabold leading-none shadow-[0_8px_18px_rgba(26,23,20,0.08)]">
                        参考图
                      </span>
                    </>
                  ) : (
                    <>
                      <Plus size={25} strokeWidth={2.6} />
                      <span className="mt-2 text-[13px] font-extrabold leading-tight">
                        参考图
                        <br />
                        最多 3 张
                      </span>
                    </>
                  )}
                  {referenceImages.length > 0 ? (
                    <span className="absolute bottom-2 right-2 rounded-full border border-charcoal/18 bg-lemon px-2 py-0.5 font-mono text-[11px] font-black shadow-[0_8px_18px_rgba(26,23,20,0.08)]">
                      {referenceImages.length}/{MAX_REFERENCE_IMAGES}
                    </span>
                  ) : null}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[340px] rounded-[18px] border border-charcoal/18 bg-surface-white p-3 text-charcoal shadow-[0_24px_70px_rgba(26,23,20,0.14)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-manrope text-[13px] font-extrabold text-charcoal/62">
                    参考图 {referenceImages.length}/{MAX_REFERENCE_IMAGES}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-[10px] border border-charcoal/18 bg-lemon font-extrabold"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
                  >
                    <Plus size={15} />
                    上传
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {Array.from({ length: MAX_REFERENCE_IMAGES }).map((_, index) => {
                    const image = referenceImages[index];
                    return (
                      <div
                        key={image ?? `compact-empty-${index}`}
                        className="relative aspect-[3/4] overflow-hidden rounded-[12px] border border-charcoal/18 bg-canvas-pink"
                      >
                        {image ? (
                          <>
                            <img src={image} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover object-top" />
                            <button
                              type="button"
                              aria-label="移除参考图"
                              onClick={() =>
                                setReferenceImages((images) =>
                                  images.filter((_, imageIndex) => imageIndex !== index)
                                )
                              }
                              className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-charcoal/18 bg-surface-white text-charcoal shadow-[0_8px_16px_rgba(26,23,20,0.08)]"
                            >
                              <Trash2 size={14} strokeWidth={2.5} />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex h-full w-full flex-col items-center justify-center gap-1 font-manrope text-[11px] font-extrabold text-charcoal/55"
                          >
                            <ImagePlus size={20} strokeWidth={2.5} />
                            添加
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <FillPromptEditor
              value={prompt}
              onChange={updatePrompt}
              className="min-w-0"
            />
          </div>
        </div>

        {error ? (
          <div className="border-t-2 border-charcoal bg-pumpkin px-4 py-2 font-manrope text-[13px] font-extrabold text-charcoal">
            {error}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-charcoal/12 bg-surface-white/88 p-2.5 md:flex-nowrap">
          {onCollapse ? (
            <Button
              type="button"
              variant="outline"
              onClick={onCollapse}
              className="min-h-[44px] rounded-[14px] border border-charcoal/18 bg-surface-white/88 px-3 font-manrope text-[13px] font-extrabold text-charcoal shadow-[0_10px_24px_rgba(26,23,20,0.05)] hover:bg-lemon"
            >
              <ChevronDown size={15} strokeWidth={2.7} />
              收起
            </Button>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`选择模型：${selectedOption.label}`}
                className="inline-flex min-h-[44px] min-w-[180px] flex-1 cursor-pointer items-center gap-2 rounded-[14px] border border-charcoal/18 bg-surface-white/88 px-3 font-manrope text-[13px] font-extrabold text-charcoal shadow-[0_10px_24px_rgba(26,23,20,0.05)] transition-colors hover:bg-lemon md:flex-none"
              >
                <ModelBrandLogo
                  logo={selectedOption.brandLogo}
                  active
                  className="h-7 w-9 rounded-[7px]"
                />
                <span className="min-w-0 truncate">{selectedOption.label}</span>
                <ChevronDown size={14} strokeWidth={2.6} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              className="w-[min(calc(100vw-32px),440px)] rounded-[18px] border border-charcoal/18 bg-surface-white p-3 text-charcoal shadow-[0_24px_70px_rgba(26,23,20,0.14)]"
            >
              <div className="grid content-start gap-3">
                <p className="font-manrope text-[12px] font-black text-charcoal/52">生成模型</p>
                {Object.entries(groupedModels).map(([group, options]) => (
                  <div key={group} className="grid gap-1">
                    <p className="px-2 font-manrope text-[11px] font-extrabold text-charcoal/45">{group}</p>
                    {options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setModel(option.id)}
                        className={cn(
                          "flex min-h-[44px] cursor-pointer items-center justify-between rounded-[12px] border px-2 text-left font-manrope transition-colors hover:bg-lemon",
                          model === option.id
                            ? "border-charcoal/24 bg-lemon text-charcoal"
                            : "border-transparent bg-canvas-pink/62 text-charcoal"
                          )}
                        >
                        <span className="flex min-w-0 items-center gap-2">
                          <ModelBrandLogo logo={option.brandLogo} active={model === option.id} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-black">{option.label}</span>
                            <span className="block text-[11px] font-extrabold opacity-60">
                              {option.credits} 积分/张
                            </span>
                          </span>
                        </span>
                        {model === option.id ? <Check size={16} strokeWidth={3} /> : null}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`画面参数：比例 ${aspectRatio}，张数 ${outputCount}，分辨率 ${resolutionLabel(resolution)}`}
                className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[14px] border border-charcoal/18 bg-surface-white/88 px-3 font-manrope text-[13px] font-extrabold text-charcoal shadow-[0_10px_24px_rgba(26,23,20,0.05)] transition-colors hover:bg-lemon md:flex-none"
              >
                <AspectRatioMark ratio={aspectRatio} />
                <span>{aspectRatio}</span>
                <span className="h-4 w-px bg-current/24" />
                <ImageIcon size={15} strokeWidth={2.5} />
                <span>{outputCount}</span>
                <span className="h-4 w-px bg-current/24" />
                <span>{resolutionLabel(resolution)}</span>
                <ChevronDown size={14} strokeWidth={2.6} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              side="top"
              className="w-[min(calc(100vw-32px),420px)] rounded-[18px] border border-charcoal/18 bg-surface-white p-3 text-charcoal shadow-[0_24px_70px_rgba(26,23,20,0.14)]"
            >
              <div className="grid gap-4 rounded-[18px] border border-charcoal/16 bg-canvas-pink/72 p-3">
                <div className="grid gap-2">
                  <p className="font-manrope text-[12px] font-extrabold text-charcoal/52">画面比例</p>
                  <div className="grid grid-cols-4 gap-2 rounded-[14px] border border-charcoal/16 bg-surface-white p-2 sm:grid-cols-5">
                    {ASPECT_RATIOS.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setAspectRatio(ratio)}
                        className={cn(
                          "flex min-h-[54px] cursor-pointer flex-col items-center justify-center rounded-[8px] font-manrope text-[11px] font-extrabold transition-colors",
                          aspectRatio === ratio ? "bg-pumpkin text-charcoal" : "text-charcoal/68 hover:bg-lemon"
                        )}
                      >
                        <AspectRatioMark ratio={ratio} active={aspectRatio === ratio} />
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <SegmentedControl
                    label="生成张数"
                    value={String(outputCount)}
                    options={allowedOutputCounts.map(String)}
                    onChange={(value) => setOutputCount(Number(value))}
                  />

                  <SegmentedControl
                    label="分辨率"
                    value={resolution}
                    options={RESOLUTIONS}
                    onChange={setResolution}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
            <span className="inline-flex h-[44px] shrink-0 items-center rounded-[14px] border border-charcoal/18 bg-canvas-pink/72 px-3 font-mono text-[12px] font-black text-charcoal shadow-[0_10px_22px_rgba(26,23,20,0.05)]">
              {estimatedCredits} 积分
            </span>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="generated-primary-action min-h-[44px] min-w-[132px] px-4 font-manrope text-[15px] font-extrabold text-charcoal hover:bg-pumpkin disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Send size={17} strokeWidth={2.7} />}
              {isSubmitting ? "生成中" : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        frameless
          ? "overflow-hidden bg-surface-white"
          : "overflow-hidden rounded-[10px] border-2 border-charcoal bg-surface-white shadow-brand",
        className
      )}
    >
      {showHeader ? (
        <div className="border-b-2 border-charcoal bg-lemon px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-manrope text-[12px] font-extrabold text-charcoal/60">
              {seed?.sourceCaseCategory ?? "图片生成"}
            </p>
            <h3 className="line-clamp-1 font-manrope text-[18px] font-black text-charcoal">
              {seed?.title ?? "把参考图变成新图文"}
            </h3>
          </div>
          <span className="rounded-[8px] border-2 border-charcoal bg-surface-white px-3 py-1 font-mono text-[13px] font-bold text-charcoal">
            预估 {estimatedCredits} 积分
          </span>
        </div>
      </div>
      ) : null}

      <div className="grid gap-4 p-4">
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="font-manrope text-[13px] font-extrabold text-charcoal/62">
              参考图 {referenceImages.length}/{MAX_REFERENCE_IMAGES}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-[8px] border-2 border-charcoal bg-surface-white font-extrabold"
              onClick={() => fileInputRef.current?.click()}
              disabled={referenceImages.length >= MAX_REFERENCE_IMAGES}
            >
              <Plus size={16} />
              上传
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: MAX_REFERENCE_IMAGES }).map((_, index) => {
              const image = referenceImages[index];
              return (
                <div
                  key={image ?? `empty-${index}`}
                  className="relative aspect-[3/4] overflow-hidden rounded-[8px] border-2 border-charcoal bg-canvas-pink"
                >
                  {image ? (
                    <>
                      <img src={image} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover object-top" />
                      <button
                        type="button"
                        aria-label="移除参考图"
                        onClick={() =>
                          setReferenceImages((images) =>
                            images.filter((_, imageIndex) => imageIndex !== index)
                          )
                        }
                        className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-charcoal bg-surface-white text-charcoal"
                      >
                        <Trash2 size={15} strokeWidth={2.5} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 font-manrope text-[12px] font-extrabold text-charcoal/55"
                    >
                      <ImagePlus size={22} strokeWidth={2.5} />
                      添加参考
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="font-manrope text-[13px] font-extrabold text-charcoal/62">提示词</span>
            <span className="font-mono text-[12px] font-bold text-charcoal/45">
              {prompt.length}/2000
            </span>
          </div>
          <Textarea
            value={prompt}
            onChange={(event) => updatePrompt(event.target.value)}
            placeholder="描述你要生成的小红书图文画面..."
            className="min-h-[132px] resize-none rounded-[8px] border-2 border-charcoal bg-canvas-pink/45 font-manrope text-[14px] font-extrabold leading-[1.6] text-charcoal focus-visible:ring-0"
          />
        </div>

        <div className="grid gap-3 rounded-[10px] border-2 border-charcoal bg-canvas-pink p-3">
          <div className="grid gap-2">
            <span className="font-manrope text-[13px] font-extrabold text-charcoal/62">生成模型</span>
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(groupedModels).flatMap(([group, options]) =>
                options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setModel(option.id)}
                    className={cn(
                      "flex min-h-[62px] items-center gap-2 rounded-[8px] border-2 border-charcoal px-3 py-2 text-left font-manrope transition-transform hover:-translate-y-[2px]",
                      model === option.id
                        ? "bg-charcoal text-surface-white"
                        : "bg-surface-white text-charcoal"
                    )}
                  >
                    <ModelBrandLogo logo={option.brandLogo} active={model === option.id} />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-extrabold opacity-60">
                        {group} · {option.credits} 积分/张
                      </span>
                      <span className="mt-1 block truncate text-[14px] font-black">{option.label}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <SegmentedControl
              label="比例"
              value={aspectRatio}
              options={ASPECT_RATIOS}
              onChange={setAspectRatio}
            />
            <SegmentedControl
              label="张数"
              value={String(outputCount)}
              options={allowedOutputCounts.map(String)}
              onChange={(value) => setOutputCount(Number(value))}
            />
            <SegmentedControl
              label="分辨率"
              value={resolution}
              options={RESOLUTIONS}
              onChange={setResolution}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              icon={<Wand2 size={17} />}
              label="智能优化"
              checked={aiEnhance}
              onCheckedChange={setAiEnhance}
            />
            <ToggleRow
              icon={<Sparkles size={17} />}
              label="快速模式"
              checked={fastMode}
              onCheckedChange={setFastMode}
            />
          </div>
        </div>

        {error ? (
          <div className="rounded-[8px] border-2 border-charcoal bg-pumpkin px-3 py-2 font-manrope text-[13px] font-extrabold text-charcoal">
            {error}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <p className="font-manrope text-[12px] font-extrabold leading-[1.5] text-charcoal/58">
            {generationNotice}
          </p>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="min-h-[48px] rounded-[10px] border-2 border-charcoal bg-pumpkin px-6 font-manrope text-[16px] font-extrabold text-charcoal shadow-brand-sm hover:bg-pumpkin"
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
            {isSubmitting ? "生成中" : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="font-manrope text-[12px] font-extrabold text-charcoal/58">{label}</span>
      <div className="grid grid-cols-4 gap-1 rounded-[13px] border border-charcoal/16 bg-surface-white/88 p-1 shadow-[0_8px_18px_rgba(26,23,20,0.04)]">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "min-h-8 rounded-[10px] px-2 font-manrope text-[12px] font-extrabold transition-colors",
              value === option ? "bg-charcoal text-surface-white shadow-[0_8px_16px_rgba(26,23,20,0.12)]" : "text-charcoal/68 hover:bg-lemon"
            )}
          >
            {optionDisplayLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onCheckedChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-[14px] border border-charcoal/16 bg-surface-white/88 px-3 font-manrope text-[13px] font-extrabold text-charcoal shadow-[0_8px_18px_rgba(26,23,20,0.04)]">
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
