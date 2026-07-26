"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Clock3,
  Download,
  History,
  Image as ImageIcon,
  ImagePlus,
  Library,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Wand2,
  Zap,
  X,
} from "lucide-react";

import {
  ImageGenerationComposer,
  type ImageGenerationSeed,
} from "@/components/common/image-generation-composer";
import { ModelBrandLogo } from "@/components/common/model-brand-logo";
import { Wordmark } from "@/components/layout/Wordmark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IMAGE_GENERATION_MODEL_OPTIONS,
  getImageGenerationModelOption,
} from "@/config/image-generation-models";
import {
  addReferenceImageToDraft,
  buildGeneratedDraftStorageKey,
  mergeComposerDraftIntoSeed,
  mergeQuotedPrompt,
  readRailCollapsedPreference,
  shouldAskPromptReuseChoice,
  writeRailCollapsedPreference,
  type ComposerDraft,
  type PromptReuseMode,
} from "@/lib/image-generation-workspace";
import { cn } from "@/lib/utils";

type GeneratedAsset = {
  id: string;
  url: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  creditsCharged: number;
  createdAt?: string | Date | null;
};

type GeneratedTask = {
  taskId: string;
  status: string;
  source?: string;
  sourceCaseId?: string | null;
  sourceCaseCategory?: string | null;
  prompt: string;
  referenceImages: string[];
  model: string;
  providerModel: string;
  capability: string;
  aspectRatio: string;
  resolution: string;
  outputCount: number;
  requestedCredits: number;
  settledCredits: number;
  previewRequestedCredits?: number;
  aiEnhance?: boolean;
  fastMode?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string | Date | null;
  completedAt?: string | Date | null;
  assets: GeneratedAsset[];
};

type WorkbenchState =
  | "idle"
  | "seeded_input"
  | "blocked"
  | "loading"
  | "queued"
  | "generating"
  | "completed"
  | "partial_success"
  | "failed";

type WorkspaceScope = "current" | "history";

const MAX_REFERENCE_IMAGES = 3;

function parseJsonArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseNumber(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | null) {
  if (value === null) return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function useGenerationPageSeed() {
  const searchParams = useSearchParams();

  return useMemo(() => {
    const prompt =
      searchParams.get("prompt") ||
      searchParams.get("input") ||
      searchParams.get("value") ||
      searchParams.get("topic") ||
      "";
    const repeatedReferences = [
      ...searchParams.getAll("reference_images[]"),
      ...searchParams.getAll("reference_image_urls[]"),
      ...searchParams.getAll("input_images[]"),
    ];
    const jsonReferences = [
      ...parseJsonArray(searchParams.get("reference_images")),
      ...parseJsonArray(searchParams.get("reference_image_urls")),
      ...parseJsonArray(searchParams.get("input_images")),
    ];
    const referenceImage =
      searchParams.get("reference_image") || searchParams.get("reference_image_url");
    const referenceImages = [
      ...repeatedReferences,
      ...jsonReferences,
      ...(referenceImage ? [referenceImage] : []),
    ];
    const rawSource = searchParams.get("source");
    const source =
      rawSource === "prompt-library" || rawSource === "regenerate"
        ? rawSource
        : "manual";

    return {
      taskId: searchParams.get("taskId") ?? searchParams.get("task_id") ?? "",
      seed: {
        source,
        templateId: searchParams.get("template") ?? undefined,
        sourceCaseId: searchParams.get("source_case_id") ?? undefined,
        sourceCaseCategory: searchParams.get("source_case_category") ?? undefined,
        sourceNoteUrl: searchParams.get("source_note_url") ?? undefined,
        sourceAuthorUrl: searchParams.get("source_author_url") ?? undefined,
        title:
          searchParams.get("title") ??
          searchParams.get("source_case_category") ??
          "图生图生成",
        prompt,
        referenceImages: Array.from(new Set(referenceImages)).slice(
          0,
          MAX_REFERENCE_IMAGES
        ),
        model: searchParams.get("model") ?? undefined,
        aspectRatio: searchParams.get("aspect_ratio") ?? undefined,
        outputCount: parseNumber(
          searchParams.get("output_count") ?? searchParams.get("image_count")
        ),
        resolution: searchParams.get("resolution") ?? undefined,
        aiEnhance: parseBoolean(
          searchParams.get("ai_enhance") ?? searchParams.get("ai_polish")
        ),
        fastMode: parseBoolean(searchParams.get("fast_mode")),
        previewFlow: false,
      } satisfies ImageGenerationSeed,
    };
  }, [searchParams]);
}

function useGeneratedTask(taskId: string) {
  const [task, setTask] = useState<GeneratedTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    hasLoadedRef.current = false;

    if (!taskId) {
      setTask(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadTask = async () => {
      if (!hasLoadedRef.current) {
        setIsLoading(true);
      }
      try {
        if (taskId.startsWith("preview_")) {
          const preview = window.localStorage.getItem(
            `image-generation-preview:${taskId}`
          );
          if (!preview) {
            throw new Error("预览任务已过期，请重新生成。");
          }
          if (!cancelled) {
            setTask(JSON.parse(preview) as GeneratedTask);
            setError(null);
          }
          return;
        }

        const response = await fetch(`/api/v1/image-generations/${taskId}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          if (response.status === 401) {
            window.location.href = `/login?from=${encodeURIComponent(
              window.location.pathname + window.location.search
            )}`;
            return;
          }
          throw new Error(body?.error?.message ?? "读取生成任务失败");
        }
        if (!cancelled) {
          setTask(body.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setTask(null);
          setError(err instanceof Error ? err.message : "读取生成任务失败");
        }
      } finally {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setIsLoading(false);
        }
      }
    };

    void loadTask();
    const timer = window.setInterval(() => {
      void loadTask();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [taskId]);

  return { task, error, isLoading };
}

function useGenerationHistory({
  enabled,
  query,
}: {
  enabled: boolean;
  query: string;
}) {
  const [records, setRecords] = useState<GeneratedTask[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ limit: "36" });
    if (query.trim()) params.set("q", query.trim());

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/v1/image-generations?${params}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          throw new Error(
            response.status === 401
              ? "登录后可以查看全部生成历史。"
              : body?.error?.message ?? "读取生成历史失败"
          );
        }
        if (!cancelled) {
          setRecords(body.data.records ?? []);
          setTotal(Number(body.data.total ?? 0));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setRecords([]);
          setTotal(0);
          setError(err instanceof Error ? err.message : "读取生成历史失败");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [enabled, query]);

  return { records, total, error, isLoading };
}

function statusLabel(status: string) {
  switch (status) {
    case "idle":
      return "待输入";
    case "seeded_input":
      return "待生成";
    case "loading":
      return "读取中";
    case "completed":
      return "已完成";
    case "partial_success":
      return "部分完成";
    case "failed":
      return "生成失败";
    case "generating":
      return "生成中";
    case "queued":
      return "排队中";
    case "blocked":
      return "待处理";
    default:
      return status;
  }
}

function statusIcon(status: string) {
  switch (status) {
    case "completed":
    case "partial_success":
      return CheckCircle2;
    case "failed":
      return AlertCircle;
    case "generating":
      return Loader2;
    case "queued":
      return Clock3;
    default:
      return Sparkles;
  }
}

function statusTone(status: string) {
  switch (status) {
    case "completed":
      return "bg-seafoam";
    case "partial_success":
      return "bg-lemon";
    case "failed":
      return "bg-pumpkin";
    case "generating":
    case "queued":
      return "bg-surface-white";
    default:
      return "bg-canvas-pink";
  }
}

function isTaskWaitingForResult(task: GeneratedTask) {
  return task.status === "queued" || task.status === "generating";
}

function aspectClass(aspectRatio: string | undefined) {
  switch (aspectRatio) {
    case "1:1":
      return "aspect-square";
    case "4:3":
      return "aspect-[4/3]";
    case "16:9":
      return "aspect-video";
    case "9:16":
      return "aspect-[9/16]";
    case "2:3":
      return "aspect-[2/3]";
    case "3:2":
      return "aspect-[3/2]";
    case "21:9":
      return "aspect-[21/9]";
    case "3:4":
    default:
      return "aspect-[3/4]";
  }
}

function assetFrameWidthClass(aspectRatio: string | undefined) {
  switch (aspectRatio) {
    case "1:1":
      return "max-w-[312px]";
    case "4:3":
    case "3:2":
      return "max-w-[416px]";
    case "16:9":
    case "21:9":
      return "max-w-[496px]";
    case "9:16":
      return "max-w-[240px]";
    case "2:3":
      return "max-w-[272px]";
    case "3:4":
    default:
      return "max-w-[304px]";
  }
}

function titleForPrompt(prompt: string) {
  const firstLine = prompt
    .split(/\n|。|！|!|？|\?/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 42) : "图生图生成";
}

function modelOption(model: string | undefined) {
  return (
    getImageGenerationModelOption(model) ??
    IMAGE_GENERATION_MODEL_OPTIONS[0]
  );
}

function uniqueFirstThreeImages(images: string[]) {
  const seen = new Set<string>();
  return images
    .filter(Boolean)
    .filter((image) => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    })
    .slice(0, MAX_REFERENCE_IMAGES);
}

function dateGroupLabel(value?: string | Date | null) {
  if (!value) return "最近";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(date);
}

function groupTasksByDate(records: GeneratedTask[]) {
  return records.reduce<Array<{ label: string; records: GeneratedTask[] }>>(
    (groups, record) => {
      const label = dateGroupLabel(record.createdAt);
      const current = groups[groups.length - 1];
      if (current?.label === label) {
        current.records.push(record);
      } else {
        groups.push({ label, records: [record] });
      }
      return groups;
    },
    []
  );
}

function composerSeedFor(task: GeneratedTask | null, seed: ImageGenerationSeed) {
  if (!task) return seed;
  const continuationImages =
    task.assets.length > 0
      ? task.assets.slice(0, MAX_REFERENCE_IMAGES).map((asset) => asset.url)
      : task.referenceImages.slice(0, MAX_REFERENCE_IMAGES);

  return {
    source: "regenerate",
    sourceCaseId: task.sourceCaseId ?? undefined,
    sourceCaseCategory: task.sourceCaseCategory ?? undefined,
    title: titleForPrompt(task.prompt),
    prompt: task.prompt,
    referenceImages: continuationImages,
    model: task.model,
    aspectRatio: task.aspectRatio,
    outputCount: task.outputCount,
    resolution: task.resolution,
    aiEnhance: Boolean(task.aiEnhance),
    fastMode: task.fastMode !== false,
  } satisfies ImageGenerationSeed;
}

function draftFromSeed(seed: ImageGenerationSeed): ComposerDraft {
  return {
    prompt: seed.prompt ?? "",
    referenceImages: uniqueFirstThreeImages(seed.referenceImages ?? []),
    model: seed.model,
    aspectRatio: seed.aspectRatio,
    outputCount: seed.outputCount,
    resolution: seed.resolution,
    aiEnhance: seed.aiEnhance,
    fastMode: seed.fastMode,
  };
}

function stateFor({
  isLoading,
  task,
  error,
  seed,
}: {
  isLoading: boolean;
  task: GeneratedTask | null;
  error: string | null;
  seed: ImageGenerationSeed;
}): WorkbenchState {
  if (isLoading) return "loading";
  if (task) return task.status as WorkbenchState;
  if (error) return "failed";
  if (!seed.prompt && (seed.referenceImages?.length ?? 0) === 0) return "idle";
  if ((seed.referenceImages?.length ?? 0) === 0) return "blocked";
  return "seeded_input";
}

function GeneratedWorkbenchContent() {
  const { taskId, seed } = useGenerationPageSeed();
  const { task, error, isLoading } = useGeneratedTask(taskId);
  const [scope, setScope] = useState<WorkspaceScope>("current");
  const [historyQuery, setHistoryQuery] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [manualComposerSeed, setManualComposerSeed] =
    useState<ImageGenerationSeed | null>(null);
  const [composerDraft, setComposerDraft] = useState<ComposerDraft | null>(null);
  const [pendingPromptQuote, setPendingPromptQuote] =
    useState<GeneratedTask | null>(null);
  const [pendingReferenceReplacement, setPendingReferenceReplacement] =
    useState<{ record: GeneratedTask; assetUrl: string } | null>(null);
  const completedTaskRef = useRef("");
  const skipNextRailPersistRef = useRef(true);
  const history = useGenerationHistory({
    enabled: scope === "history",
    query: historyQuery,
  });
  const composerSeed = manualComposerSeed ?? composerSeedFor(task, seed);
  const activeComposerDraft = composerDraft ?? draftFromSeed(composerSeed);
  const workspaceSeed = task
    ? seed
    : (mergeComposerDraftIntoSeed(
        seed,
        activeComposerDraft
      ) as ImageGenerationSeed);
  const workbenchState = stateFor({ isLoading, task, error, seed: workspaceSeed });
  const draftStorageKey = useMemo(
    () =>
      buildGeneratedDraftStorageKey({
        taskId,
        source: seed.source,
        sourceCaseId: seed.sourceCaseId,
        templateId: seed.templateId,
      }),
    [seed.source, seed.sourceCaseId, seed.templateId, taskId]
  );

  useEffect(() => {
    setManualComposerSeed(null);
    setComposerDraft(null);
    setPendingPromptQuote(null);
    setPendingReferenceReplacement(null);
    setComposerExpanded(false);
  }, [taskId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = readRailCollapsedPreference(window.localStorage);
    if (stored !== null) setRailCollapsed(stored);
  }, []);

  useEffect(() => {
    if (skipNextRailPersistRef.current) {
      skipNextRailPersistRef.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    writeRailCollapsedPreference(window.localStorage, railCollapsed);
  }, [railCollapsed]);

  useEffect(() => {
    const key = task ? `${task.taskId}:${task.status}` : "";
    if (task?.status === "completed" || task?.status === "partial_success") {
      if (completedTaskRef.current !== key) {
        setComposerExpanded(false);
        completedTaskRef.current = key;
      }
      return;
    }
    if (!task) completedTaskRef.current = "";
  }, [task]);

  const applyDraftToComposer = (
    draft: ComposerDraft,
    baseSeed: ImageGenerationSeed = composerSeed
  ) => {
    const normalizedDraft = {
      ...draft,
      referenceImages: uniqueFirstThreeImages(draft.referenceImages),
    };
    setComposerDraft(normalizedDraft);
    setManualComposerSeed(
      mergeComposerDraftIntoSeed(baseSeed, normalizedDraft) as ImageGenerationSeed
    );
    setComposerExpanded(true);
  };

  const handleUseAsset = (record: GeneratedTask, assetUrl: string) => {
    const result = addReferenceImageToDraft(
      activeComposerDraft.referenceImages,
      assetUrl
    );
    if (result.status === "needs-replacement") {
      setPendingReferenceReplacement({ record, assetUrl });
      setPendingPromptQuote(null);
      setComposerExpanded(true);
      return;
    }

    applyDraftToComposer(
      {
        ...activeComposerDraft,
        referenceImages: result.referenceImages,
      },
      composerSeedFor(record, seed)
    );
  };

  const handleQuotePrompt = (record: GeneratedTask) => {
    if (shouldAskPromptReuseChoice(activeComposerDraft.prompt, record.prompt)) {
      setPendingPromptQuote(record);
      setPendingReferenceReplacement(null);
      setComposerExpanded(true);
      return;
    }

    applyPromptQuote(record, "overwrite");
  };

  const applyPromptQuote = (record: GeneratedTask, mode: PromptReuseMode) => {
    const prompt = mergeQuotedPrompt(
      activeComposerDraft.prompt,
      record.prompt,
      mode
    );
    applyDraftToComposer(
      {
        ...activeComposerDraft,
        prompt,
      },
      composerSeedFor(record, seed)
    );
    setPendingPromptQuote(null);
  };

  const applyReferenceReplacement = (replaceIndex: number) => {
    if (!pendingReferenceReplacement) return;
    const result = addReferenceImageToDraft(
      activeComposerDraft.referenceImages,
      pendingReferenceReplacement.assetUrl,
      replaceIndex
    );
    if (result.status === "replaced" || result.status === "added") {
      applyDraftToComposer(
        {
          ...activeComposerDraft,
          referenceImages: result.referenceImages,
        },
        composerSeedFor(pendingReferenceReplacement.record, seed)
      );
    }
    setPendingReferenceReplacement(null);
  };

  return (
    <main className="generated-shell min-h-screen font-manrope text-charcoal">
      <div className="flex min-h-screen">
        <HistoryRail
          task={task}
          seed={seed}
          state={workbenchState}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed((value) => !value)}
        />

        <section className="relative flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceTopbar
            scope={scope}
            onScopeChange={setScope}
            query={historyQuery}
            onQueryChange={setHistoryQuery}
            onToggleRail={() => setRailCollapsed((value) => !value)}
            railCollapsed={railCollapsed}
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-8 lg:px-10 xl:px-12">
            <div className="grid w-full max-w-[760px] gap-4">
              {scope === "history" ? (
                <HistoryStream
                  records={history.records}
                  total={history.total}
                  query={historyQuery}
                  error={history.error}
                  isLoading={history.isLoading}
                  onClearQuery={() => setHistoryQuery("")}
                  onUseAsset={handleUseAsset}
                  onQuotePrompt={handleQuotePrompt}
                />
              ) : (
                <SessionStream
                  state={workbenchState}
                  task={task}
                  seed={workspaceSeed}
                  error={error}
                  onUseAsset={handleUseAsset}
                  onQuotePrompt={handleQuotePrompt}
                />
              )}
            </div>
          </div>

          <div className="relative z-30 shrink-0 px-3 pb-3 pt-2 md:px-8 lg:px-10 lg:pb-5 xl:px-12">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-[#fff6f2] via-[#fff6f2]/95 to-transparent" />
            <div className="relative mx-auto grid w-full max-w-[980px] gap-2">
              {pendingPromptQuote ? (
                <PromptReuseChoice
                  currentPrompt={activeComposerDraft.prompt}
                  quotedPrompt={pendingPromptQuote.prompt}
                  onChoose={(mode) => applyPromptQuote(pendingPromptQuote, mode)}
                  onCancel={() => setPendingPromptQuote(null)}
                />
              ) : null}
              {pendingReferenceReplacement ? (
                <ReferenceReplacementChoice
                  referenceImages={activeComposerDraft.referenceImages}
                  assetUrl={pendingReferenceReplacement.assetUrl}
                  onReplace={applyReferenceReplacement}
                  onCancel={() => setPendingReferenceReplacement(null)}
                />
              ) : null}
              {composerExpanded ? (
                <ImageGenerationComposer
                  seed={composerSeed}
                  layout="compact"
                  submitMode="create-task"
                  submitLabel={task ? "继续生成" : "生成"}
                  draftStorageKey={draftStorageKey}
                  onDraftChange={setComposerDraft}
                  onCollapse={() => setComposerExpanded(false)}
                />
              ) : (
                <CollapsedComposerSummary
                  seed={composerSeed}
                  task={task}
                  onExpand={() => setComposerExpanded(true)}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function HistoryRail({
  task,
  seed,
  state,
  collapsed,
  onToggleCollapsed,
}: {
  task: GeneratedTask | null;
  seed: ImageGenerationSeed;
  state: WorkbenchState;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const title = task ? titleForPrompt(task.prompt) : seed.title ?? "图生图生成";
  const thumb = task?.assets[0]?.url ?? task?.referenceImages[0] ?? seed.referenceImages?.[0];

  return (
    <aside
      className={cn(
        "generated-rail sticky top-0 hidden h-screen shrink-0 px-3 py-5 transition-[width] duration-200 lg:block",
        collapsed ? "w-[84px]" : "w-[272px]"
      )}
    >
      <div
        className={cn(
          "gap-3",
          collapsed
            ? "grid justify-items-center"
            : "flex items-center justify-between"
        )}
      >
        {collapsed ? (
          <Link
            href="/"
            aria-label="imaima 首页"
            className="grid size-11 place-items-center overflow-hidden rounded-[14px] border border-charcoal/20 bg-lemon px-1 text-charcoal shadow-[0_10px_28px_rgba(26,23,20,0.08)]"
          >
            <Wordmark className="block w-[72px] translate-x-[14px] text-[14px] text-charcoal" />
          </Link>
        ) : (
          <Link href="/" className="min-w-0 transition-transform hover:-translate-y-0.5">
            <Wordmark className="block truncate text-[18px] text-charcoal" />
          </Link>
        )}
        <button
          type="button"
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          onClick={onToggleCollapsed}
          className="grid size-10 shrink-0 place-items-center rounded-[13px] border border-charcoal/18 bg-surface-white/86 text-charcoal shadow-[0_10px_24px_rgba(26,23,20,0.07)] transition-transform hover:-translate-y-0.5 hover:bg-lemon"
        >
          {collapsed ? (
            <PanelLeftOpen size={18} strokeWidth={2.7} />
          ) : (
            <PanelLeftClose size={18} strokeWidth={2.7} />
          )}
        </button>
        {collapsed ? null : (
          <Link
            href="/generated"
            aria-label="新建生成"
            className="generated-primary-action grid size-10 place-items-center text-charcoal transition-transform hover:-translate-y-0.5"
          >
            <Plus size={18} strokeWidth={2.8} />
          </Link>
        )}
      </div>

      <nav className="mt-8 grid gap-2">
        <Link
          href="/generated"
          aria-label="生成页"
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-[16px] border border-charcoal/18 bg-lemon font-manrope text-[14px] font-black text-charcoal shadow-[0_12px_26px_rgba(26,23,20,0.08)]",
            collapsed ? "justify-center px-2" : "px-3"
          )}
        >
          <Sparkles size={18} strokeWidth={2.7} />
          {collapsed ? null : "生成页"}
        </Link>
        <Link
          href="/prompts"
          aria-label="提示词库"
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-[16px] border border-transparent font-manrope text-[14px] font-extrabold text-charcoal/58 transition-colors hover:border-charcoal/14 hover:bg-surface-white/70",
            collapsed ? "justify-center px-2" : "px-3"
          )}
        >
          <Search size={18} strokeWidth={2.7} />
          {collapsed ? null : "提示词库"}
        </Link>
      </nav>

      <div className={cn("mt-8", collapsed ? "grid justify-items-center gap-3" : "")}>
        <p className="px-1 font-manrope text-[11px] font-black uppercase tracking-[0.14em] text-charcoal/42">
          {collapsed ? "Now" : "Current Session"}
        </p>
        <div
          className={cn(
            "mt-3 rounded-[18px] border border-charcoal/16 bg-[#fff8f5]/78 shadow-[0_14px_34px_rgba(26,23,20,0.07)]",
            collapsed ? "grid size-14 place-items-center overflow-hidden p-0" : "p-3"
          )}
        >
          {collapsed ? (
            thumb ? (
              <img src={thumb} alt="" className="h-full w-full object-cover object-top" />
            ) : (
              <ImagePlus size={20} strokeWidth={2.5} />
            )
          ) : (
          <div className="flex gap-3">
            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-charcoal/18 bg-surface-white">
              {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover object-top" />
              ) : (
                <ImagePlus size={20} strokeWidth={2.5} />
              )}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 font-manrope text-[14px] font-black leading-tight text-charcoal">
                {title}
              </p>
              <Badge className={cn("mt-2 border border-charcoal/18 px-2 py-0.5 font-mono text-[11px] font-black text-charcoal shadow-none hover:bg-inherit", statusTone(state))}>
                {statusLabel(state)}
              </Badge>
            </div>
          </div>
          )}
        </div>
      </div>

      <div className="absolute inset-x-3 bottom-5 grid gap-3">
        <div
          className={cn(
            "flex min-h-11 items-center rounded-[16px] border border-charcoal/16 bg-surface-white/82 font-mono text-[13px] font-black text-charcoal shadow-[0_12px_24px_rgba(26,23,20,0.06)]",
            collapsed ? "justify-center px-2" : "justify-between px-3"
          )}
        >
          <span>{collapsed ? "分" : "积分"}</span>
          {collapsed ? null : <span>--</span>}
        </div>
        <div
          className={cn(
            "flex min-h-11 items-center rounded-[16px] border border-charcoal bg-charcoal text-surface-white shadow-[0_16px_34px_rgba(26,23,20,0.12)]",
            collapsed ? "justify-center px-2" : "justify-between px-3"
          )}
        >
          <span className="grid size-7 place-items-center rounded-full bg-surface-white font-manrope text-[12px] font-black text-charcoal">
            U
          </span>
          {collapsed ? null : (
            <span className="font-manrope text-[13px] font-black">用户</span>
          )}
        </div>
      </div>
    </aside>
  );
}

function WorkspaceTopbar({
  scope,
  onScopeChange,
  query,
  onQueryChange,
  onToggleRail,
  railCollapsed,
}: {
  scope: WorkspaceScope;
  onScopeChange: (scope: WorkspaceScope) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onToggleRail: () => void;
  railCollapsed: boolean;
}) {
  return (
    <header className="generated-topbar sticky top-0 z-20 px-4 py-3 md:px-8 lg:px-10 xl:px-12">
      <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={railCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            onClick={onToggleRail}
            className="hidden size-10 shrink-0 place-items-center rounded-[13px] border border-charcoal/16 bg-surface-white/84 text-charcoal shadow-[0_10px_24px_rgba(26,23,20,0.07)] hover:bg-lemon lg:grid"
          >
            {railCollapsed ? (
              <PanelLeftOpen size={18} strokeWidth={2.7} />
            ) : (
              <PanelLeftClose size={18} strokeWidth={2.7} />
            )}
          </button>
          <Link href="/" className="min-w-0 lg:hidden">
          <Wordmark className="block truncate text-[17px] text-charcoal" />
          </Link>
          <div className="grid grid-cols-2 overflow-hidden rounded-[15px] border border-charcoal/18 bg-surface-white/78 p-1 shadow-[0_12px_30px_rgba(26,23,20,0.07)]">
            <button
              type="button"
              onClick={() => onScopeChange("current")}
              className={cn(
                "inline-flex min-h-9 items-center justify-center gap-2 rounded-[11px] px-4 font-manrope text-[13px] font-black transition-colors",
                scope === "current" ? "bg-lemon text-charcoal shadow-[0_8px_18px_rgba(26,23,20,0.08)]" : "text-charcoal/54 hover:bg-canvas-pink/60"
              )}
            >
              <Sparkles size={15} strokeWidth={2.7} />
              当前工具
            </button>
            <button
              type="button"
              onClick={() => onScopeChange("history")}
              className={cn(
                "inline-flex min-h-9 items-center justify-center gap-2 rounded-[11px] px-4 font-manrope text-[13px] font-black transition-colors",
                scope === "history" ? "bg-lemon text-charcoal shadow-[0_8px_18px_rgba(26,23,20,0.08)]" : "text-charcoal/54 hover:bg-canvas-pink/60"
              )}
            >
              <History size={15} strokeWidth={2.7} />
              所有历史
            </button>
          </div>
        </div>

        <div className="ml-auto flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-end">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[15px] border border-charcoal/18 bg-surface-white/78 px-3 shadow-[0_12px_30px_rgba(26,23,20,0.06)] md:max-w-[420px]">
            <Search className="size-4 shrink-0 text-charcoal/42" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
                if (scope !== "history") onScopeChange("history");
              }}
              placeholder="搜索所有生成记录"
              className="min-w-0 flex-1 bg-transparent font-manrope text-[13px] font-extrabold text-charcoal outline-none placeholder:text-charcoal/38"
            />
            {query ? (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => onQueryChange("")}
                className="grid size-7 shrink-0 place-items-center rounded-full text-charcoal/55 hover:bg-canvas-pink hover:text-charcoal"
              >
                <X size={15} strokeWidth={2.7} />
              </button>
            ) : null}
          </label>
          <Button
            asChild
            variant="outline"
            className="h-11 rounded-[15px] border border-charcoal/18 bg-surface-white/80 px-4 font-manrope text-[13px] font-black text-charcoal shadow-[0_12px_26px_rgba(26,23,20,0.06)] hover:bg-lemon"
          >
            <Link href="/prompts">
              <Library size={15} strokeWidth={2.7} />
              资产库
            </Link>
          </Button>
          <Button
            asChild
            className="generated-primary-action h-11 px-4 font-manrope text-[13px] font-black text-charcoal hover:bg-pumpkin"
          >
            <Link href="/generated">新建</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function SessionStream({
  state,
  task,
  seed,
  error,
  onUseAsset,
  onQuotePrompt,
}: {
  state: WorkbenchState;
  task: GeneratedTask | null;
  seed: ImageGenerationSeed;
  error: string | null;
  onUseAsset: (task: GeneratedTask, assetUrl: string) => void;
  onQuotePrompt: (task: GeneratedTask) => void;
}) {
  if (state === "loading") return <TaskSkeleton />;

  if (error && !task) {
    return (
      <Alert className="generated-panel rounded-[22px] bg-pumpkin/90 p-5 text-charcoal">
        <AlertCircle aria-hidden="true" />
        <AlertTitle className="font-manrope text-[17px] font-black">
          读取失败
        </AlertTitle>
        <AlertDescription className="font-manrope text-[14px] font-semibold">
          {error}
        </AlertDescription>
      </Alert>
    );
  }

  if (task) {
    if (isTaskWaitingForResult(task)) {
      return <WaitingForResult task={task} />;
    }

    return (
      <GenerationRecord
        task={task}
        onUseAsset={onUseAsset}
      />
    );
  }

  if (state === "idle") return <IdleRecord />;

  return <SeedRecord seed={seed} blocked={state === "blocked"} />;
}

function WaitingForResult({ task }: { task: GeneratedTask }) {
  const Icon = statusIcon(task.status);

  return (
    <div className="grid min-h-[360px] place-items-center px-4 py-10 text-center">
      <div className="grid max-w-[520px] justify-items-center gap-4">
        <div className="grid size-16 place-items-center rounded-full border border-charcoal/18 bg-lemon shadow-[0_14px_32px_rgba(26,23,20,0.08)]">
          <Icon
            className={cn(
              "size-7 text-charcoal",
              task.status === "generating" ? "animate-spin" : ""
            )}
            aria-hidden="true"
          />
        </div>
        <div>
          <p className="font-manrope text-[13px] font-black uppercase tracking-[0.18em] text-charcoal/42">
            Image generation in progress
          </p>
          <h2 className="mt-2 font-manrope text-[28px] font-black text-charcoal">
            {statusLabel(task.status)}
          </h2>
          <p className="mt-2 font-manrope text-[14px] font-semibold leading-6 text-charcoal/58">
            结果生成完成后，任务面板会自动出现在这里。
          </p>
        </div>
      </div>
    </div>
  );
}

function HistoryStream({
  records,
  total,
  query,
  error,
  isLoading,
  onClearQuery,
  onUseAsset,
  onQuotePrompt,
}: {
  records: GeneratedTask[];
  total: number;
  query: string;
  error: string | null;
  isLoading: boolean;
  onClearQuery: () => void;
  onUseAsset: (task: GeneratedTask, assetUrl: string) => void;
  onQuotePrompt: (task: GeneratedTask) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4">
        <TaskSkeleton />
        <TaskSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="generated-panel rounded-[22px] bg-pumpkin/90 p-5 text-charcoal">
        <AlertCircle aria-hidden="true" />
        <AlertTitle className="font-manrope text-[17px] font-black">
          历史读取失败
        </AlertTitle>
        <AlertDescription className="font-manrope text-[14px] font-semibold">
          {error}
        </AlertDescription>
      </Alert>
    );
  }

  if (records.length === 0) {
    return (
      <section className="generated-panel-flat p-8 text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-[18px] border border-charcoal/20 bg-lemon shadow-[0_14px_32px_rgba(26,23,20,0.08)]">
          <History size={28} strokeWidth={2.7} />
        </div>
        <h2 className="mt-4 font-manrope text-[24px] font-black text-charcoal">
          {query.trim() ? "没有匹配的生成记录" : "还没有生成历史"}
        </h2>
        <p className="mx-auto mt-2 max-w-[520px] font-manrope text-[14px] font-semibold leading-6 text-charcoal/55">
          {query.trim()
            ? "清空搜索词后可以回到全部历史。"
            : "完成第一张图后，这里会按时间沉淀你的 prompt、模型和结果图。"}
        </p>
        {query.trim() ? (
          <Button
            type="button"
            onClick={onClearQuery}
            className="generated-primary-action mt-5 min-h-11 px-5 font-manrope text-[14px] font-black text-charcoal hover:bg-pumpkin"
          >
            <X size={16} strokeWidth={2.7} />
            清空搜索
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    <div className="grid gap-7">
      <div className="generated-panel-flat flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="font-manrope text-[14px] font-black text-charcoal">
          {query.trim() ? `找到 ${records.length}/${total} 条匹配记录` : `${total} 条生成记录`}
        </div>
        <div className="flex flex-wrap gap-2">
          <MetaBadge icon={<Clock3 size={14} />} label="按时间排序" />
          <MetaBadge icon={<ImageIcon size={14} />} label="图片生成" />
        </div>
      </div>

      {groupTasksByDate(records).map((group) => (
        <section key={group.label} className="grid gap-4">
          <div className="sticky top-[72px] z-10 flex items-center gap-3 bg-[#fff8f5]/80 py-1 backdrop-blur-sm">
            <h2 className="rounded-full border border-charcoal/18 bg-lemon px-4 py-2 font-manrope text-[15px] font-black text-charcoal shadow-[0_10px_22px_rgba(26,23,20,0.07)]">
              {group.label}
            </h2>
            <span className="h-0.5 flex-1 bg-charcoal/18" />
          </div>
          {group.records.map((record) => (
            <GenerationRecord
              key={record.taskId}
              task={record}
              onUseAsset={onUseAsset}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function TaskSkeleton() {
  return (
    <section className="generated-panel p-5">
      <div className="flex gap-4">
      <Skeleton className="size-14 rounded-[16px] border border-charcoal/16 bg-canvas-pink" />
        <div className="grid flex-1 gap-3">
          <Skeleton className="h-4 w-32 rounded-full bg-canvas-pink" />
          <Skeleton className="h-7 w-full max-w-[620px] rounded-full bg-canvas-pink" />
          <Skeleton className="h-4 w-full max-w-[480px] rounded-full bg-canvas-pink" />
        </div>
      </div>
      <Skeleton className="mt-6 h-[420px] rounded-[22px] border border-charcoal/14 bg-canvas-pink" />
    </section>
  );
}

function IdleRecord() {
  return (
    <section className="generated-panel-flat p-8 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-[18px] border border-charcoal/20 bg-lemon shadow-[0_14px_32px_rgba(26,23,20,0.08)]">
        <ImagePlus size={28} strokeWidth={2.7} />
      </div>
      <h2 className="mt-4 font-manrope text-[24px] font-black text-charcoal">
        新建图生图任务
      </h2>
      <p className="mx-auto mt-2 max-w-[520px] font-manrope text-[14px] font-semibold leading-6 text-charcoal/55">
        上传参考图后，底部输入器会创建新的生成任务。
      </p>
    </section>
  );
}

function SeedRecord({
  seed,
  blocked,
}: {
  seed: ImageGenerationSeed;
  blocked: boolean;
}) {
  const state = blocked ? "blocked" : "seeded_input";
  const Icon = statusIcon(state);

  return (
    <section className="generated-panel p-5">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <ReferenceStack images={seed.referenceImages ?? []} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("h-8 gap-1.5 rounded-full border border-charcoal/18 px-3 font-manrope text-[12px] font-black text-charcoal shadow-none hover:bg-inherit", statusTone(state))}>
              <Icon className="size-3.5" aria-hidden="true" />
              {statusLabel(state)}
            </Badge>
            <MetaBadge icon={<ImageIcon size={14} />} label="Image to Image" />
            <MetaBadge icon={<Zap size={14} />} label={seed.fastMode === false ? "精细模式" : "快速模式"} />
          </div>
          <p className="mt-4 whitespace-pre-wrap font-manrope text-[16px] font-extrabold leading-8 text-charcoal">
            {seed.prompt || "等待输入提示词"}
          </p>
          {blocked ? (
              <Alert className="mt-5 rounded-[18px] border border-charcoal/18 bg-pumpkin/80 px-4 py-3 text-charcoal">
              <AlertCircle aria-hidden="true" />
              <AlertTitle className="font-manrope text-[14px] font-black">
                缺少参考图
              </AlertTitle>
              <AlertDescription className="font-manrope text-[13px] font-semibold">
                当前生成页只支持 image to image，至少需要 1 张参考图。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function GenerationRecord({
  task,
  onUseAsset,
}: {
  task: GeneratedTask;
  onUseAsset: (task: GeneratedTask, assetUrl: string) => void;
}) {
  const option = modelOption(task.model);
  const Icon = statusIcon(task.status);

  return (
    <article className="w-full">
      <div className="grid gap-3 pb-3 md:grid-cols-[auto_minmax(0,1fr)]">
        <ReferenceStack images={task.referenceImages} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Badge className={cn("h-8 shrink-0 gap-1.5 rounded-full border border-charcoal/18 px-3 font-manrope text-[12px] font-black text-charcoal shadow-none hover:bg-inherit", statusTone(task.status))}>
              <Icon
                className={cn("size-3.5", task.status === "generating" ? "animate-spin" : "")}
                aria-hidden="true"
              />
              {statusLabel(task.status)}
            </Badge>
            <Badge className="h-8 shrink-0 gap-2 rounded-full border border-charcoal/18 bg-canvas-pink/70 px-3 font-manrope text-[12px] font-black text-charcoal shadow-none hover:bg-canvas-pink">
              <ModelBrandLogo logo={option.brandLogo} active className="h-5 w-7 rounded-[5px] border" />
              {option.label}
            </Badge>
            <MetaBadge icon={<Wand2 size={14} />} label={task.aspectRatio} />
            <MetaBadge icon={<ImageIcon size={14} />} label={`${task.outputCount} 张`} />
            <MetaBadge icon={<Zap size={14} />} label={`${task.settledCredits || task.requestedCredits} 积分`} />
            <MetaBadge icon={<RefreshCcw size={14} />} label="可重新生成" />
          </div>

          <h2 className="mt-3 truncate font-manrope text-[16px] font-black leading-snug text-charcoal md:text-[18px]">
            {titleForPrompt(task.prompt)}
          </h2>

        </div>
      </div>

      <AssetStage task={task} onUseAsset={onUseAsset} />
    </article>
  );
}

function ReferenceStack({ images }: { images: string[] }) {
  const visibleImages = images.slice(0, MAX_REFERENCE_IMAGES);
  const firstImage = visibleImages[0];
  const stackCount = visibleImages.length;

  return (
    <div
      className="relative h-[66px] w-[72px] shrink-0 md:h-[78px] md:w-[86px]"
      aria-label={`参考图 ${stackCount}/${MAX_REFERENCE_IMAGES}`}
    >
      {stackCount > 2 ? (
        <div className="absolute left-3.5 top-2.5 size-14 rounded-[12px] border border-charcoal/12 bg-canvas-pink/80 shadow-[0_10px_22px_rgba(26,23,20,0.05)] md:size-[66px]" />
      ) : null}
      {stackCount > 1 ? (
        <div className="absolute left-1.5 top-1 size-14 rounded-[12px] border border-charcoal/14 bg-surface-white shadow-[0_10px_22px_rgba(26,23,20,0.06)] md:size-[66px]" />
      ) : null}
      <div className="relative grid size-14 place-items-center overflow-hidden rounded-[12px] border border-charcoal/18 bg-canvas-pink shadow-[0_14px_32px_rgba(26,23,20,0.08)] md:size-[66px]">
        {firstImage ? (
          <img
            src={firstImage}
            alt="参考图预览"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <ImagePlus size={20} strokeWidth={2.5} className="text-charcoal/38" />
        )}
        {stackCount > 1 ? (
          <span className="absolute bottom-1 right-1 rounded-full border border-charcoal bg-lemon px-1.5 py-0.5 font-mono text-[10px] font-black leading-none text-charcoal shadow-[0_6px_14px_rgba(26,23,20,0.12)]">
            {stackCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AssetStage({
  task,
  onUseAsset,
}: {
  task: GeneratedTask;
  onUseAsset: (task: GeneratedTask, assetUrl: string) => void;
}) {
  const [previewAsset, setPreviewAsset] = useState<GeneratedAsset | null>(null);
  const isRunning = task.status === "queued" || task.status === "generating";
  const isFailed = task.status === "failed";

  if (isRunning) {
    return (
      <div className="grid min-h-[420px] place-items-center bg-canvas-pink/55 p-6">
        <div className={cn("relative grid w-full max-w-[360px] place-items-center rounded-[22px] border border-charcoal/16 bg-surface-white shadow-[0_22px_60px_rgba(26,23,20,0.1)]", aspectClass(task.aspectRatio))}>
          <Skeleton className="absolute inset-4 rounded-[12px] bg-canvas-pink" />
          <div className="relative z-10 grid justify-items-center gap-3">
            <Loader2 className="size-11 animate-spin text-charcoal" aria-hidden="true" />
            <Badge className="rounded-full border border-charcoal/18 bg-lemon px-3 py-1 font-manrope text-[13px] font-black text-charcoal shadow-none hover:bg-lemon">
              {statusLabel(task.status)}
            </Badge>
          </div>
        </div>
      </div>
    );
  }

  if (isFailed || task.assets.length === 0) {
    return (
      <div className="grid min-h-[360px] place-items-center bg-canvas-pink/55 p-6 text-center">
        <div className="max-w-[460px] rounded-[22px] border border-dashed border-charcoal/32 bg-surface-white/82 p-6">
          <AlertCircle className="mx-auto size-10 text-charcoal" aria-hidden="true" />
          <h3 className="mt-4 font-manrope text-[22px] font-black text-charcoal">
            这次没跑出来
          </h3>
          <p className="mt-2 font-manrope text-[14px] font-semibold leading-6 text-charcoal/58">
            {task.errorMessage ?? "可以调整提示词或换一张参考图后重新生成。"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="py-2">
        <div className={cn("grid justify-items-start gap-3", assetFrameWidthClass(task.aspectRatio))}>
          {task.assets.map((asset, index) => (
            <figure
              key={asset.id}
              className="group relative overflow-hidden rounded-[16px] border border-charcoal/16 bg-surface-white shadow-[0_12px_30px_rgba(26,23,20,0.07)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(26,23,20,0.1)]"
            >
              <button
                type="button"
                onClick={() => setPreviewAsset(asset)}
                className={cn("relative flex w-full cursor-zoom-in items-center justify-center bg-surface-white", aspectClass(task.aspectRatio))}
                aria-label={`放大查看生成结果 ${index + 1}`}
              >
                <img
                  src={asset.url}
                  alt={`生成结果 ${index + 1}`}
                  className="h-full w-full object-contain"
                />
                <span className="absolute left-3 top-3 grid size-7 place-items-center rounded-full border border-charcoal/18 bg-surface-white/90 font-mono text-[12px] font-black text-charcoal shadow-[0_8px_18px_rgba(26,23,20,0.07)]">
                  {index + 1}
                </span>
              </button>
              <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <div className="pointer-events-auto flex items-center gap-2 rounded-[14px] border border-charcoal/16 bg-surface-white/92 p-1 shadow-[0_12px_26px_rgba(26,23,20,0.08)] backdrop-blur">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-[9px] text-charcoal hover:bg-lemon"
                  >
                    <a href={asset.url} download aria-label="下载图片">
                      <Download size={18} strokeWidth={2.6} />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 rounded-[9px] text-charcoal hover:bg-lemon"
                    aria-label="设为下一次参考"
                    onClick={() => onUseAsset(task, asset.url)}
                  >
                    <RefreshCcw size={18} strokeWidth={2.6} />
                  </Button>
                </div>
              </div>
              <figcaption className="flex items-center justify-between border-t border-charcoal/12 bg-surface-white px-3 py-1.5 font-mono text-[11px] font-bold text-charcoal/52">
                <span>{asset.width && asset.height ? `${asset.width}x${asset.height}` : task.resolution}</span>
                <span>{asset.creditsCharged} credits</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => !open && setPreviewAsset(null)}>
        <DialogContent className="w-fit max-w-[92vw] gap-0 border-0 bg-transparent p-0 shadow-none sm:rounded-[20px] [&>button]:right-3 [&>button]:top-3 [&>button]:rounded-full [&>button]:border [&>button]:border-charcoal/18 [&>button]:bg-surface-white/90 [&>button]:p-1.5 [&>button]:opacity-100 [&>button]:shadow-[0_10px_24px_rgba(26,23,20,0.14)]">
          <DialogTitle className="sr-only">生成结果预览</DialogTitle>
          <DialogDescription className="sr-only">
            放大查看生成图片，按 Escape 关闭。
          </DialogDescription>
          {previewAsset ? (
            <img
              src={previewAsset.url}
              alt="放大的生成结果"
              className="block max-h-[88vh] max-w-[min(88vw,760px)] rounded-[18px] bg-surface-white object-contain shadow-[0_24px_80px_rgba(26,23,20,0.26)]"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PromptReuseChoice({
  currentPrompt,
  quotedPrompt,
  onChoose,
  onCancel,
}: {
  currentPrompt: string;
  quotedPrompt: string;
  onChoose: (mode: PromptReuseMode) => void;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-[18px] border border-charcoal/18 bg-lemon p-3 text-charcoal shadow-[0_18px_44px_rgba(26,23,20,0.1)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="font-manrope text-[13px] font-black">
            输入器已有提示词
          </p>
          <p className="mt-1 line-clamp-1 font-manrope text-[12px] font-extrabold text-charcoal/58">
            当前：{currentPrompt}
          </p>
          <p className="line-clamp-1 font-manrope text-[12px] font-extrabold text-charcoal/58">
            引用：{quotedPrompt}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onChoose("append")}
            className="h-9 rounded-[12px] border border-charcoal/18 bg-surface-white px-3 font-manrope text-[12px] font-black text-charcoal hover:bg-surface-white"
          >
            <Plus size={14} strokeWidth={2.7} />
            追加
          </Button>
          <Button
            type="button"
            onClick={() => onChoose("overwrite")}
            className="h-9 rounded-[12px] border border-charcoal/18 bg-pumpkin px-3 font-manrope text-[12px] font-black text-charcoal hover:bg-pumpkin"
          >
            <Copy size={14} strokeWidth={2.7} />
            覆盖
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="取消引用提示词"
            onClick={onCancel}
            className="size-9 rounded-[9px] text-charcoal hover:bg-surface-white"
          >
            <X size={15} strokeWidth={2.7} />
          </Button>
        </div>
      </div>
    </section>
  );
}

function ReferenceReplacementChoice({
  referenceImages,
  assetUrl,
  onReplace,
  onCancel,
}: {
  referenceImages: string[];
  assetUrl: string;
  onReplace: (replaceIndex: number) => void;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-[18px] border border-charcoal/18 bg-seafoam p-3 text-charcoal shadow-[0_18px_44px_rgba(26,23,20,0.1)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-charcoal/18 bg-surface-white">
            <img src={assetUrl} alt="待加入的参考图" className="h-full w-full object-cover object-top" />
          </div>
          <div className="min-w-0">
            <p className="font-manrope text-[13px] font-black">
              参考图已满 3 张
            </p>
            <p className="mt-1 font-manrope text-[12px] font-extrabold text-charcoal/58">
              选择一张替换，或先移除输入器里的参考图。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {referenceImages.slice(0, MAX_REFERENCE_IMAGES).map((image, index) => (
            <button
              key={image}
              type="button"
              onClick={() => onReplace(index)}
              className="group relative grid size-11 place-items-center overflow-hidden rounded-[12px] border border-charcoal/18 bg-surface-white shadow-[0_10px_24px_rgba(26,23,20,0.08)] transition-transform hover:-translate-y-0.5"
              aria-label={`替换第 ${index + 1} 张参考图`}
            >
              <img src={image} alt="" className="h-full w-full object-cover object-top" />
              <span className="absolute inset-0 grid place-items-center bg-charcoal/0 font-mono text-[11px] font-black text-surface-white opacity-0 transition-opacity group-hover:bg-charcoal/55 group-hover:opacity-100">
                {index + 1}
              </span>
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="取消加入参考图"
            onClick={onCancel}
            className="size-11 rounded-[9px] text-charcoal hover:bg-surface-white"
          >
            <X size={16} strokeWidth={2.7} />
          </Button>
        </div>
      </div>
    </section>
  );
}

function CollapsedComposerSummary({
  seed,
  task,
  onExpand,
}: {
  seed: ImageGenerationSeed;
  task: GeneratedTask | null;
  onExpand: () => void;
}) {
  const references = seed.referenceImages ?? [];
  const thumb = references[0] ?? task?.assets[0]?.url ?? task?.referenceImages[0];
  const prompt = seed.prompt || task?.prompt || "继续输入想法，或上传参考图开始生成";

  return (
    <button
      type="button"
      onClick={onExpand}
      className="generated-command flex w-full min-w-0 items-center gap-3 overflow-hidden p-3 text-left text-charcoal transition-transform hover:-translate-y-0.5 hover:bg-lemon/35"
    >
      <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-[16px] border border-charcoal/18 bg-canvas-pink">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <ImagePlus size={22} strokeWidth={2.6} />
        )}
        {references.length > 1 ? (
          <span className="absolute bottom-1 right-1 rounded-full border-2 border-charcoal bg-lemon px-1.5 py-0.5 font-mono text-[10px] font-black">
            {references.length}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-manrope text-[11px] font-black uppercase tracking-[0.14em] text-charcoal/45">
          上一步携带的参考图和提示词
        </p>
        <p className="mt-1 line-clamp-2 font-manrope text-[14px] font-black leading-snug text-charcoal md:text-[15px]">
          {prompt}
        </p>
      </div>
      <div className="generated-primary-action hidden shrink-0 items-center gap-2 px-4 py-3 font-manrope text-[14px] font-black text-charcoal md:flex">
        <ChevronDown size={17} strokeWidth={2.8} />
        展开生成
      </div>
    </button>
  );
}

function MetaBadge({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <Badge className="generated-chip h-8 gap-1.5 px-3 font-manrope text-[12px] font-black text-charcoal hover:bg-surface-white">
      {icon}
      {label}
    </Badge>
  );
}

export default function GeneratedPage() {
  return (
    <Suspense fallback={null}>
      <GeneratedWorkbenchContent />
    </Suspense>
  );
}
