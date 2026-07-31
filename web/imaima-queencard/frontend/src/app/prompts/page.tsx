"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type SyntheticEvent } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Search,
  Send,
  Share2,
  X,
  Zap,
} from "lucide-react";
import gsap from "gsap";
import useEmblaCarousel, { type UseEmblaCarouselType } from "embla-carousel-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import {
  ImageGenerationComposer,
  type ImageGenerationSeed,
} from "@/components/common/image-generation-composer";
import { BrandedCarouselControls } from "@/components/common/branded-carousel-controls";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { potentialHitTopCount, xhsCaseMetrics } from "@/data/xhsCaseMetrics";
import { boLandingPromptCases } from "@/data/boLandingPromptCases";
import { xhsPromptCases, type XhsPromptCase } from "@/data/xhsPromptCases";
import { publicAssetUrls } from "@/lib/public-assets";

const boLandingCategories = ["爆款图文", "梗图", "公众号配图"];
const promptCases = [...xhsPromptCases, ...boLandingPromptCases];
const categories = [
  "全部",
  "热门高赞",
  ...boLandingCategories,
  "养生内调",
  "清单种草",
  "美女图集",
  "情绪疗愈",
  "搞笑漫画",
  "成长自律",
  "知识科普",
];

const categoryAccents: Record<string, string> = {
  全部: "bg-pumpkin",
  热门高赞: "bg-lemon",
  爆款图文: "bg-pumpkin",
  梗图: "bg-sky",
  公众号配图: "bg-seafoam",
  养生内调: "bg-seafoam",
  清单种草: "bg-lavender",
  美女图集: "bg-spring",
  情绪疗愈: "bg-sky",
  搞笑漫画: "bg-lemon",
  成长自律: "bg-spring",
  知识科普: "bg-seafoam",
};

const sortModes = ["综合热度", "潜力优先", "收藏优先", "分享优先"];
const defaultCase = promptCases[0];

const IMAGE_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='200'><rect width='160' height='200' fill='#f6e0db'/><g fill='none' stroke='#1a1714' stroke-opacity='0.26' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'><rect x='42' y='62' width='76' height='76' rx='10'/><circle cx='66' cy='88' r='8'/><path d='M50 128 L80 104 L118 134'/></g></svg>",
  );

function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  if (img.dataset.fallback === "1") return;
  img.dataset.fallback = "1";
  img.src = IMAGE_FALLBACK;
}
const heroHeadlineLines = ["爆款首图，", "直接变新图文。"];
const heroHeadline = heroHeadlineLines.join("");
const heroMarqueeItems = ["爆款标题", "首图结构", "参考提示词", "博主链接", "互动数据", "一键生成", "批量复用"];
const moneyBoardRingText = "钱多多 · 来财 · 一秒复刻 · 爆款 · 钱多多 · 来财 · 一秒复刻 · 爆款 · ";
const moneyBoardMetricModes = [
  { key: "likes" as const, label: "高赞", shortLabel: "赞", icon: Heart },
  { key: "saves" as const, label: "高收藏", shortLabel: "藏", icon: Bookmark },
  { key: "shares" as const, label: "高转发", shortLabel: "转", icon: Share2 },
];
const moneyKeywordRotations = ["-9deg", "8deg", "-5deg", "7deg", "-7deg", "5deg"];
type CarouselApi = UseEmblaCarouselType[1];
type MoneyMetricKey = (typeof moneyBoardMetricModes)[number]["key"];
type PromptTarget = {
  theme: string;
  title: string;
  subtitle: string;
  output: string;
};
type CaseStatKind = "likes" | "saves" | "shares";

const caseStatGradientPalettes: Record<CaseStatKind, { from: string; via: string; to: string }> = {
  likes: {
    from: "rgba(239, 114, 79, 0.32)",
    via: "rgba(239, 114, 79, 0.72)",
    to: "rgba(239, 114, 79, 1)",
  },
  saves: {
    from: "rgba(132, 191, 255, 0.3)",
    via: "rgba(132, 191, 255, 0.7)",
    to: "rgba(81, 150, 255, 0.98)",
  },
  shares: {
    from: "rgba(231, 219, 76, 0.34)",
    via: "rgba(231, 219, 76, 0.74)",
    to: "rgba(231, 219, 76, 1)",
  },
};

function statLabel(value: string, label: string) {
  return `${value} ${label}`;
}

function accentFor(category: string) {
  return categoryAccents[category] ?? "bg-lemon";
}

function imagesFor(item: XhsPromptCase) {
  return publicAssetUrls(item.images.length > 0 ? item.images : [item.image]);
}

function buildCaseGenerationSeed(
  item: XhsPromptCase,
  prompt: string
): ImageGenerationSeed {
  return {
    source: "prompt-library",
    templateId: item.id,
    sourceCaseId: item.id,
    sourceCaseCategory: item.category,
    sourceNoteUrl: item.noteUrl,
    sourceAuthorUrl: item.authorUrl,
    title: item.title,
    prompt,
    referenceImages: imagesFor(item).slice(0, 3),
  };
}

function noteIdFor(item: XhsPromptCase) {
  return item.noteUrl.match(/explore\/([^?]+)/)?.[1] ?? item.id;
}

function metricFor(item: XhsPromptCase) {
  return xhsCaseMetrics[noteIdFor(item)];
}

function compactPromptSeed(value: string, maxLength = 6) {
  const cleaned = value
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .find((part) => part.length >= 2);

  if (!cleaned) return "日常状态";
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function seedForCase(item: XhsPromptCase) {
  const genericTopics = new Set(["漫画", "原创漫画", "小红书", "清单种草", "生活灵感", "健康养生", "有趣"]);
  const topic = item.topics.find((entry) => {
    const compact = compactPromptSeed(entry, 8);
    return compact.length >= 2 && !genericTopics.has(compact);
  });

  return compactPromptSeed(topic ?? item.sourceTitle ?? item.title, item.category === "知识科普" ? 8 : 6);
}

function emotionTargetFor(item: XhsPromptCase, seed: string): PromptTarget {
  const titleText = `${item.sourceTitle} ${item.topics.join(" ")}`;

  if (/睡眠|入睡|熬夜|作息|夜/.test(titleText)) {
    return {
      theme: "情绪疗愈",
      title: "7个把夜晚慢慢养回来的小动作",
      subtitle: "睡不稳也能照着做的温柔恢复清单",
      output: "封面钩子、6 页内容卡和结尾收藏引导，每页都给一句共情话和一个可执行动作。",
    };
  }

  if (/身体|湿气|气色|脾胃|中焦|五脏|养生|眼睛|腰|食物/.test(titleText)) {
    return {
      theme: "情绪疗愈",
      title: `7个把${seed}慢慢养回来的小动作`,
      subtitle: "状态下滑时也能照着做的温柔恢复清单",
      output: "封面钩子、6 页内容卡和结尾收藏引导，每页都给一句共情话和一个可执行动作。",
    };
  }

  if (/小狗|狗狗|宠物|陪伴/.test(titleText)) {
    return {
      theme: "情绪疗愈",
      title: "7个被温柔接住的日常瞬间",
      subtitle: "被生活弄累时也能获得安慰的陪伴清单",
      output: "封面钩子、6 页内容卡和结尾收藏引导，每页都给一句共情话和一个可执行动作。",
    };
  }

  return {
    theme: "情绪疗愈",
    title: "7个把自己慢慢养回来的小动作",
    subtitle: "低谷期也能照着做的温柔恢复清单",
    output: "封面钩子、6 页内容卡和结尾收藏引导，每页都给一句共情话和一个可执行动作。",
  };
}

function promptTargetFor(item: XhsPromptCase): PromptTarget {
  const seed = seedForCase(item);

  if (item.category === "爆款图文") {
    const sourceText = `${item.sourceTitle} ${item.topics.join(" ")}`;
    if (/旅行|攻略|景点|路线|城市/.test(sourceText)) {
      return {
        theme: "旅行攻略图文",
        title: `${seed}旅行攻略，一张图讲清楚`,
        subtitle: "把路线、体验和避坑信息整理成能直接收藏的出行清单",
        output: "封面钩子、6-8 页图文脚本，每页包含地点/路线、画面重点、实用信息和互动/收藏动作。",
      };
    }

    if (/知识|科普|考试|学习|方法/.test(sourceText)) {
      return {
        theme: "知识科普图文",
        title: `一张图讲清${seed}的关键逻辑`,
        subtitle: "把复杂知识拆成准确、清晰、能收藏转发的视觉卡片",
        output: "封面钩子、6-8 页图文脚本，每页包含核心知识点、画面元素、口语化解释和互动/收藏动作。",
      };
    }

    return {
      theme: "爆款图文",
      title: `${seed}，看完这组图就懂了`,
      subtitle: "保留原图文的情绪钩子、画面节奏和收藏理由，换成新的主题",
      output: "封面标题与副标题、6-8 页图文脚本，每页包含画面描述、主文案、信息点和互动/收藏动作。",
    };
  }

  if (item.category === "梗图") {
    return {
      theme: "梗图",
      title: `关于${seed}的几个离谱瞬间`,
      subtitle: "用轻松、简短、有反差的画面把日常情绪讲出来",
      output: "封面钩子、6-8 页梗图脚本，每页包含画面构图、短文案、反差点和最后一页互动提问。",
    };
  }

  if (item.category === "公众号配图") {
    return {
      theme: "公众号配图",
      title: `${seed}主题视觉图文`,
      subtitle: "把文章观点拆成有层次、易阅读、适合转发的配图内容",
      output: "封面标题与副标题、6-8 页配图脚本，每页包含画面描述、主文案、信息层级和版式建议。",
    };
  }

  if (item.category === "情绪疗愈") return emotionTargetFor(item, seed);

  if (item.category === "搞笑漫画") {
    return {
      theme: "搞笑漫画",
      title: `8个把${seed}画成段子的离谱瞬间`,
      subtitle: "把日常小崩溃画成轻松好笑的连环图文",
      output: "6-9 页图文脚本，每页包含画面描述、主文案、角色情绪和最后一页互动提问。",
    };
  }

  if (item.category === "成长自律") {
    return {
      theme: "成长自律",
      title: `7天把${seed}重新拉回正轨`,
      subtitle: "普通人也能执行的状态重启计划",
      output: "7 页计划，每页包含行动、耗时、为什么有效和画面排版建议。",
    };
  }

  if (item.category === "养生内调") {
    return {
      theme: "养生内调",
      title: `7个把${seed}慢慢养回来的小习惯`,
      subtitle: "身体发信号时也能照着做的温柔清单",
      output: "封面钩子、7 页内容卡和结尾收藏引导，每页包含一个身体信号、一个轻动作和一句谨慎说明，避免医疗承诺。",
    };
  }

  if (item.category === "清单种草") {
    return {
      theme: "清单种草",
      title: `9个让${seed}变顺手的日常清单`,
      subtitle: "不贵但有用，适合收藏照做",
      output: "9 个条目，每个条目包含短标题、推荐理由、画面元素和一句口语化说明。",
    };
  }

  if (item.category === "美女图集") {
    return {
      theme: "拍照参考",
      title: `8组拍出${seed}氛围感的照片`,
      subtitle: "从姿势、光线到构图，一套能直接照着拍的灵感清单",
      output: "6-9 页图文脚本，每页包含画面构图、人物姿态、服装/场景关键词、镜头建议和一句小红书式短文案。",
    };
  }

  return {
    theme: "知识科普",
    title: `一张图讲清${seed}的隐藏逻辑`,
    subtitle: "把复杂知识拆成能收藏转发的视觉说明书",
    output: "封面钩子、6-8 页内容卡、每页核心知识点、画面元素和一句口语化解释，注意表达准确，避免夸大。",
  };
}

function promptForCase(item: XhsPromptCase) {
  const target = promptTargetFor(item);

  return `生成一组新的${target.theme}主题：标题《${target.title}》，副标题“${target.subtitle}”`;
}

function caseDateTimeFor(item: XhsPromptCase) {
  const [year, month, day] = item.date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateStringFromTime(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

function formatShortDate(date: string) {
  return date.slice(5).replace("-", ".");
}

const latestCaseTime = Math.max(...promptCases.map(caseDateTimeFor));
const moneyBoardWindowStartTime = latestCaseTime - 13 * 24 * 60 * 60 * 1000;
const moneyBoardWindowLabel = `${formatShortDate(dateStringFromTime(moneyBoardWindowStartTime))} - ${formatShortDate(dateStringFromTime(latestCaseTime))}`;
const moneyBoardRecentCases = promptCases.filter((item) => {
  const time = caseDateTimeFor(item);
  return time >= moneyBoardWindowStartTime && time <= latestCaseTime;
});
const moneyBoardTracks = [
  "全部",
  ...categories.filter((category) => category !== "全部" && category !== "热门高赞" && moneyBoardRecentCases.some((item) => item.category === category)),
];

function metricValueFor(item: XhsPromptCase, metric: MoneyMetricKey) {
  if (metric === "likes") return item.likes;
  if (metric === "saves") return item.saves;
  return item.shares;
}

function metricTextFor(item: XhsPromptCase, metric: MoneyMetricKey) {
  if (metric === "likes") return item.likesText;
  if (metric === "saves") return item.savesText;
  return item.sharesText;
}

function caseStatGradientStyle(kind: CaseStatKind, value: number, maxValue: number) {
  const palette = caseStatGradientPalettes[kind];
  const ratio = maxValue > 0 ? Math.max(0, Math.min(1, value / maxValue)) : 0;
  const fillPercent = ratio <= 0 ? 0 : Math.max(16, Math.round(ratio * 100));

  return {
    "--case-stat-fill": `${fillPercent}%`,
    "--case-stat-opacity": (0.56 + ratio * 0.38).toFixed(2),
    "--case-stat-from": palette.from,
    "--case-stat-via": palette.via,
    "--case-stat-to": palette.to,
  } as CSSProperties;
}

function caseStatEmphasis(value: number, maxValue: number) {
  const ratio = maxValue > 0 ? value / maxValue : 0;
  if (ratio >= 0.82) return "high";
  if (ratio >= 0.45) return "mid";
  return "low";
}

function compactRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function fallbackHeatScore(item: XhsPromptCase) {
  const heat = item.likes + item.saves * 0.35 + item.shares * 0.45;
  const maxHeat = Math.max(...promptCases.map((entry) => entry.likes + entry.saves * 0.35 + entry.shares * 0.45));
  return Math.max(40, Math.round((heat / Math.max(maxHeat, 1)) * 60 + 40));
}

function potentialScoreFor(item: XhsPromptCase) {
  return metricFor(item)?.potentialScore ?? fallbackHeatScore(item);
}

function compactTopicTag(topic: string) {
  const cleaned = topic
    .replace(/^我在小红书/, "")
    .replace(/^在小红书/, "")
    .replace(/^小红书/, "")
    .replace(/^我的/, "")
    .replace(/分享$/, "")
    .trim();

  if (cleaned.length <= 5) return cleaned;
  return `${cleaned.slice(0, 4)}…`;
}

function interactionScoreFor(item: XhsPromptCase) {
  return item.likes + item.saves * 0.35 + item.shares * 0.45;
}

function compareByPotential(a: XhsPromptCase, b: XhsPromptCase) {
  const scoreDelta = potentialScoreFor(b) - potentialScoreFor(a);
  if (scoreDelta !== 0) return scoreDelta;

  const rankA = metricFor(a)?.potentialRank ?? Number.MAX_SAFE_INTEGER;
  const rankB = metricFor(b)?.potentialRank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;

  return interactionScoreFor(b) - interactionScoreFor(a);
}

function useFilteredCases(activeCategory: string, query: string, sortMode: string) {
  return useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = promptCases.filter((item) => {
      const matchesCategory =
        activeCategory === "全部" ||
        (activeCategory === "热门高赞" ? item.likes >= 20000 || item.saves >= 20000 : item.category === activeCategory);
      const searchable = [item.title, item.category, item.author, promptForCase(item), ...item.topics].join(" ").toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });

    return filtered.sort((a, b) => {
      if (sortMode === "潜力优先") return compareByPotential(a, b);
      if (sortMode === "收藏优先") return b.saves - a.saves;
      if (sortMode === "分享优先") return b.shares - a.shares;
      return b.likes + b.saves - (a.likes + a.saves);
    });
  }, [activeCategory, query, sortMode]);
}

function PromptTemplatePreview({ prompt, className = "" }: { prompt: string; className?: string }) {
  const titleMatch = /标题《([^》]+)》/.exec(prompt);
  const subtitleMatch = /副标题(?:《([^》]+)》|[“"]([^”"]+)[”"])/.exec(prompt);
  const ranges = [
    titleMatch
      ? {
          start: titleMatch.index + "标题".length,
          end: titleMatch.index + titleMatch[0].length,
          text: titleMatch[0].replace(/^标题/, ""),
        }
      : null,
    subtitleMatch
      ? {
          start: subtitleMatch.index + "副标题".length,
          end: subtitleMatch.index + subtitleMatch[0].length,
          text: subtitleMatch[0].replace(/^副标题/, ""),
        }
      : null,
  ]
    .filter((range): range is { start: number; end: number; text: string } => Boolean(range))
    .sort((a, b) => a.start - b.start);

  if (ranges.length === 0) {
    return <p className={className}>{prompt}</p>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(<span key={`text-${index}`}>{prompt.slice(cursor, range.start)}</span>);
    }
    parts.push(
      <span key={`slot-${index}`} className="prompt-slot-highlight">
        {range.text}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < prompt.length) {
    parts.push(<span key="text-tail">{prompt.slice(cursor)}</span>);
  }

  return <p className={className}>{parts}</p>;
}

function PromptHero({
  selectedCase,
  prompt,
  setPrompt,
}: {
  selectedCase: XhsPromptCase;
  prompt: string;
  setPrompt: (prompt: string) => void;
}) {
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const selectedAuthorUrl = selectedCase.authorUrl || selectedCase.noteUrl;
  const selectedImages = imagesFor(selectedCase);

  useEffect(() => {
    if (!headlineRef.current) return;

    const context = gsap.context(() => {
      const characters = headlineRef.current?.querySelectorAll("[data-hero-char]");
      const marqueeTracks = marqueeRef.current?.querySelectorAll("[data-marquee-track]");

      gsap.fromTo(
        characters,
        { yPercent: 115, opacity: 0, rotate: 1.5 },
        {
          yPercent: 0,
          opacity: 1,
          rotate: 0,
          duration: 0.86,
          ease: "power4.out",
          stagger: 0.026,
        },
      );

      gsap.to(marqueeTracks, {
        xPercent: -50,
        duration: 18,
        ease: "none",
        repeat: -1,
      }).totalProgress(0.35);
    }, headlineRef);

    return () => context.revert();
  }, []);

  return (
    <section className="prompt-hero-shell px-4 pb-8 pt-20 md:px-8 md:pb-12 md:pt-24">
      <div className="prompt-container prompt-container--hero">
        <div className="flex flex-col items-center text-center">
          <h1
            ref={headlineRef}
            className="hero-motion-line font-manrope font-black leading-[0.96] text-charcoal"
            aria-label={heroHeadline}
          >
            <span aria-hidden="true" className="block">
              {heroHeadlineLines.map((line) => (
                <span key={line} className="block whitespace-nowrap">
                  {line.split("").map((character, index) => (
                    <span key={`${line}-${character}-${index}`} className="inline-block overflow-hidden align-baseline">
                      <span data-hero-char className="inline-block">
                        {character}
                      </span>
                    </span>
                  ))}
                </span>
              ))}
            </span>
          </h1>
        </div>

        <div ref={marqueeRef} className="hero-marquee mt-8" aria-hidden="true">
          <div data-marquee-track className="hero-marquee-track">
            {[...heroMarqueeItems, ...heroMarqueeItems].map((item, index) => (
              <span key={`${item}-${index}`} className="hero-marquee-item">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="prompt-composer-card mx-auto mt-8 overflow-hidden rounded-[14px] border-2 border-charcoal bg-surface-white shadow-brand-lg">
          <div className="flex flex-col gap-3 border-b-2 border-charcoal bg-lemon/80 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[8px] border-2 border-charcoal bg-canvas-pink">
                <img src={selectedImages[0]} alt={selectedCase.title} onError={handleImageError} className="h-full w-full object-cover object-top" />
                {selectedImages.length > 1 ? (
                  <span className="absolute bottom-1 right-1 rounded-[4px] bg-charcoal px-1.5 py-0.5 font-mono text-[10px] font-bold text-surface-white">
                    {selectedImages.length}
                  </span>
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="line-clamp-1 font-manrope text-[15px] font-extrabold leading-tight text-charcoal">{selectedCase.title}</p>
                {selectedAuthorUrl ? (
                  <a
                    href={selectedAuthorUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex max-w-full items-center gap-1 truncate font-manrope text-[12px] font-extrabold text-charcoal/70 underline decoration-2 underline-offset-4"
                  >
                    @{selectedCase.author}
                    <ArrowUpRight size={13} strokeWidth={2.5} />
                  </a>
                ) : (
                  <p className="mt-1 truncate font-manrope text-[12px] font-extrabold text-charcoal/70">@{selectedCase.author}</p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 font-manrope text-[11px] font-extrabold text-charcoal">
              <span className={`rounded-[6px] border-2 border-charcoal px-2 py-1 ${accentFor(selectedCase.category)}`}>
                {selectedCase.category}
              </span>
              <span className="rounded-[6px] border-2 border-charcoal bg-surface-white px-2 py-1">
                {statLabel(selectedCase.likesText, "赞")}
              </span>
              <span className="rounded-[6px] border-2 border-charcoal bg-surface-white px-2 py-1">
                {statLabel(selectedCase.savesText, "藏")}
              </span>
            </div>
          </div>

          <ImageGenerationComposer
            seed={buildCaseGenerationSeed(selectedCase, prompt)}
            showHeader={false}
            frameless
            layout="compact"
            onPromptChange={setPrompt}
            submitMode="create-task"
            submitLabel="生成"
          />
        </div>
      </div>
    </section>
  );
}

function MoneyDuoDuoBoard({ onPick }: { onPick: (item: XhsPromptCase) => void }) {
  const [activeTrack, setActiveTrack] = useState(moneyBoardTracks[0]);
  const [activeMetric, setActiveMetric] = useState<MoneyMetricKey>("likes");
  const activeMetricConfig = moneyBoardMetricModes.find((mode) => mode.key === activeMetric) ?? moneyBoardMetricModes[0];
  const ActiveMetricIcon = activeMetricConfig.icon;
  const rankedItems = useMemo(() => {
    return moneyBoardRecentCases
      .filter((item) => activeTrack === "全部" || item.category === activeTrack)
      .sort((a, b) => {
        const metricDelta = metricValueFor(b, activeMetric) - metricValueFor(a, activeMetric);
        if (metricDelta !== 0) return metricDelta;
        return interactionScoreFor(b) - interactionScoreFor(a);
      })
      .slice(0, 6);
  }, [activeMetric, activeTrack]);
  const leadItem = rankedItems[0];

  return (
    <section className="money-board-section px-4 py-8 md:px-8 md:py-10">
      <div className="prompt-container prompt-container--wide">
        <div className="money-board-shell">
          <div className="money-board-copy">
            <span className="money-board-kicker">近期爆款榜</span>
            <h2>钱多多榜单</h2>
            <p>按案例库最新收录往前两周，抓出各赛道的高赞、高收藏、高转发内容。点赛道关键词，直接看可复刻标题。</p>
            <div className="money-board-window">
              <span>时间范围</span>
              <strong>{moneyBoardWindowLabel}</strong>
            </div>
          </div>

          <div className="money-board-layout">
            <div className="money-board-dial" aria-label="钱多多赛道关键词">
              <svg className="money-board-ring" viewBox="0 0 520 520" aria-hidden="true">
                <defs>
                  <path id="money-board-ring-path" d="M260 260 m -210 0 a 210 210 0 1 1 420 0 a 210 210 0 1 1 -420 0" />
                </defs>
                <circle cx="260" cy="260" r="238" />
                <circle cx="260" cy="260" r="165" />
                <text>
                  <textPath href="#money-board-ring-path" startOffset="0%">
                    {moneyBoardRingText}
                  </textPath>
                </text>
              </svg>
              <div className="money-board-keywords">
                {moneyBoardTracks.map((track, index) => (
                  <button
                    key={track}
                    type="button"
                    onClick={() => setActiveTrack(track)}
                    aria-pressed={activeTrack === track}
                    className={`money-board-keyword ${activeTrack === track ? "is-active" : ""}`}
                    style={{ "--money-pill-rotate": moneyKeywordRotations[index % moneyKeywordRotations.length] } as CSSProperties}
                  >
                    <span>{track}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="money-board-panel">
              <div className="money-board-panel-head">
                <div>
                  <p>{activeTrack} · {activeMetricConfig.label}</p>
                  <h3>{leadItem ? leadItem.title : "暂无近两周收录"}</h3>
                </div>
                <span>{rankedItems.length} 条</span>
              </div>

              <div className="money-board-metrics" aria-label="榜单指标">
                {moneyBoardMetricModes.map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => setActiveMetric(mode.key)}
                      aria-pressed={activeMetric === mode.key}
                      className={activeMetric === mode.key ? "is-active" : ""}
                    >
                      <Icon size={15} strokeWidth={2.7} />
                      {mode.label}
                    </button>
                  );
                })}
              </div>

              <div key={`${activeTrack}-${activeMetric}`} className="money-board-list">
                {rankedItems.map((item, index) => (
                  <button key={item.id} type="button" onClick={() => onPick(item)} className="money-board-row">
                    <span className="money-board-rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="money-board-title">
                      <strong>{item.title}</strong>
                      <small>@{item.author} · {item.category}</small>
                    </span>
                    <span className="money-board-value">
                      <ActiveMetricIcon size={14} strokeWidth={2.7} />
                      {metricTextFor(item, activeMetric)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CaseImageCarousel({
  item,
  onUseImage,
}: {
  item: XhsPromptCase;
  onUseImage: (item: XhsPromptCase, imageIndex: number) => void;
}) {
  const images = imagesFor(item);
  const usesImageBackdrop = item.category === "公众号配图";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const previousIndexRef = useRef(0);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const frameRef = useRef<HTMLDivElement>(null);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: false,
    skipSnaps: false,
  });

  const updateSelected = useCallback((api: CarouselApi) => {
    if (!api) return;
    setSelectedIndex(api.selectedScrollSnap());
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    updateSelected(emblaApi);
    emblaApi.on("select", updateSelected);
    emblaApi.on("reInit", updateSelected);

    return () => {
      emblaApi.off("select", updateSelected);
      emblaApi.off("reInit", updateSelected);
    };
  }, [emblaApi, updateSelected]);

  useEffect(() => {
    setSelectedIndex(0);
    previousIndexRef.current = 0;
    emblaApi?.scrollTo(0, true);
    gsap.set(frameRef.current, { x: 0, y: 0, clearProps: "boxShadow" });
  }, [emblaApi, item.id]);

  useEffect(() => {
    if (images.length <= 1) return;

    const direction = selectedIndex >= previousIndexRef.current ? 1 : -1;
    const activeSlide = slideRefs.current[selectedIndex];
    const activeImage = activeSlide?.querySelector("img:not(.case-image-backdrop)");
    const frame = frameRef.current;

    if (activeSlide && activeImage && frame) {
      gsap.killTweensOf([activeSlide, activeImage, frame]);
      gsap.fromTo(
        activeSlide,
        { opacity: 0.72, xPercent: direction * 5, scale: 0.985 },
        { opacity: 1, xPercent: 0, scale: 1, duration: 0.48, ease: "power3.out" },
      );
      gsap.fromTo(
        activeImage,
        { scale: 1.045, xPercent: direction * -2.5 },
        { scale: 1, xPercent: 0, duration: 0.7, ease: "power3.out" },
      );
    }

    previousIndexRef.current = selectedIndex;
  }, [images.length, selectedIndex]);

  const scrollToImage = useCallback(
    (index: number, event?: ReactMouseEvent<HTMLButtonElement>) => {
      emblaApi?.scrollTo(index);
      if (!event) return;
      gsap.fromTo(event.currentTarget, { y: 3, scale: 0.96 }, { y: 0, scale: 1, duration: 0.42, ease: "elastic.out(1, 0.55)" });
    },
    [emblaApi],
  );

  const stepImage = useCallback(
    (direction: -1 | 1, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (images.length <= 1) return;
      const nextIndex = (selectedIndex + direction + images.length) % images.length;
      scrollToImage(nextIndex, event);
    },
    [images.length, scrollToImage, selectedIndex],
  );

  const playImageClickMotion = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const trigger = event.currentTarget;
    const activeImage = trigger.querySelector("img:not(.case-image-backdrop)");

    gsap.killTweensOf([trigger, activeImage]);

    const timeline = gsap.timeline({
      defaults: { ease: "power3.out" },
    });

    timeline
      .to(trigger, { scale: 0.985, duration: 0.12 }, 0)
      .to(activeImage, { scale: 1.026, duration: 0.2 }, 0)
      .to(trigger, { scale: 1, duration: 0.18, ease: "elastic.out(1, 0.62)" }, 0.18)
      .to(activeImage, { scale: 1.012, duration: 0.18 }, 0.2);
  }, []);

  return (
    <div className="case-card-gallery bg-canvas-pink p-3">
      <div className="case-image-card-shell">
        <div
          ref={frameRef}
          className="case-image-card-surface group/carousel relative overflow-hidden rounded-[10px] bg-surface-white"
          role="region"
          aria-roledescription="carousel"
          aria-label={`${item.title} 完整图集`}
        >
          <div ref={emblaRef} className="case-image-viewport overflow-hidden">
            <div className="case-image-track flex">
              {images.map((src, index) => (
                <div
                  key={`${item.id}-${src}`}
                  ref={(node) => {
                    slideRefs.current[index] = node;
                  }}
                  className="case-image-slide group/slide relative min-w-0 shrink-0 grow-0 basis-full"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${index + 1} / ${images.length}`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      playImageClickMotion(event);
                      onUseImage(item, index);
                    }}
                    className="case-image-trigger block w-full cursor-pointer text-left"
                    aria-label={`使用 ${item.title} 第 ${index + 1} 张参考图生成`}
                  >
                    <img
                      src={src}
                      alt={`${item.title} 第 ${index + 1} 张参考图`}
                      loading="lazy"
                      onError={handleImageError}
                      className={`${usesImageBackdrop ? "case-image-contained-center" : ""} select-none transition-transform duration-700 ease-out`}
                      draggable={false}
                    />
                    {usesImageBackdrop ? (
                      <img
                        src={src}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        onError={handleImageError}
                        className="case-image-backdrop select-none"
                        draggable={false}
                      />
                    ) : null}
                  </button>
                  <a
                    href={src}
                    download
                    onClick={(event) => event.stopPropagation()}
                    className="case-image-download-button"
                    aria-label={`下载 ${item.title} 第 ${index + 1} 张原图`}
                    title="下载原图"
                  >
                    <Download size={17} strokeWidth={2.8} aria-hidden="true" />
                  </a>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      <BrandedCarouselControls
        count={images.length}
        selectedIndex={selectedIndex}
        ariaLabel={`${item.title} 图集分页`}
        onPrevious={(event) => stepImage(-1, event)}
        onNext={(event) => stepImage(1, event)}
      />
    </div>
  );
}

function CaseCard({
  item,
  selected,
  onTry,
  onUseImage,
}: {
  item: XhsPromptCase;
  selected: boolean;
  onTry: (item: XhsPromptCase) => void;
  onUseImage: (item: XhsPromptCase, imageIndex: number) => void;
}) {
  const authorUrl = item.authorUrl || item.noteUrl;
  const metric = metricFor(item);
  const potentialScore = potentialScoreFor(item);
  const isPotentialHit = Boolean(metric?.isPotentialHit);
  const stats = [
    { kind: "likes" as const, label: "赞", value: item.likes, text: item.likesText, icon: Heart },
    { kind: "saves" as const, label: "藏", value: item.saves, text: item.savesText, icon: Bookmark },
    { kind: "shares" as const, label: "转", value: item.shares, text: item.sharesText, icon: Share2 },
  ];
  const maxStatValue = Math.max(...stats.map((stat) => stat.value), 1);
  const potentialTitle = metric
    ? `算法：赞藏转加权 / 粉丝数；入线规则：当前有粉丝数案例 Top ${potentialHitTopCount}。粉丝 ${metric.followersText}，赞粉比 ${compactRatio(metric.likeFollowerRatio)}x，排名 #${metric.potentialRank}。`
    : "这条暂时没有匹配到粉丝数，先使用互动热度做保底分；补充粉丝数后会自动改用赞粉比。";

  return (
    <article
      className={`xhs-case-card group flex flex-col rounded-[10px] border-2 border-charcoal bg-surface-white ${
        selected ? "shadow-[5px_5px_0_#ef724f]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b-2 border-charcoal px-4 py-3">
        <div className="min-w-0">
          {authorUrl ? (
            <a
              href={authorUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 truncate font-manrope text-[14px] font-bold leading-tight text-charcoal/80 decoration-charcoal/30 decoration-2 underline-offset-4 transition-colors hover:text-charcoal hover:underline"
            >
              @{item.author}
              <ArrowUpRight size={14} strokeWidth={2.5} className="shrink-0 opacity-60" />
            </a>
          ) : (
            <p className="truncate font-manrope text-[14px] font-bold leading-tight text-charcoal/80">@{item.author}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="inline-flex min-h-[26px] cursor-help items-center whitespace-nowrap rounded-pill border-2 border-charcoal bg-lemon px-2.5 font-manrope text-[10.5px] font-extrabold leading-none text-charcoal"
              >
                潜力 {potentialScore}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] rounded-[10px] border-2 border-charcoal bg-surface-white px-3 py-2 font-manrope text-[12px] font-medium leading-relaxed text-charcoal shadow-brand">
              {potentialTitle}
            </TooltipContent>
          </Tooltip>
          {isPotentialHit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={`${item.title} 爆款`}
                  className="inline-flex min-h-[26px] cursor-help items-center rounded-pill border-2 border-charcoal bg-pumpkin px-2.5 font-manrope text-[10.5px] font-extrabold leading-none text-charcoal"
                >
                  爆款
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] rounded-[10px] border-2 border-charcoal bg-surface-white px-3 py-2 font-manrope text-[12px] font-medium leading-relaxed text-charcoal shadow-brand">
                {potentialTitle}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <CaseImageCarousel item={item} onUseImage={onUseImage} />

      <div className="flex flex-1 flex-col border-t-2 border-charcoal px-3 py-3 md:px-[14px] md:py-[14px]">
        <div className="mb-2.5 flex flex-nowrap items-center gap-1.5 overflow-hidden">
          <span className="inline-flex min-h-[26px] shrink-0 items-center rounded-pill border-2 border-charcoal bg-sky px-2.5 font-manrope text-[11px] font-bold text-charcoal">
            {item.category}
          </span>
          {item.topics.slice(0, 2).map((topic) => (
            <span
              key={topic}
              title={`#${topic}`}
              className="inline-flex min-h-[24px] min-w-0 max-w-[96px] shrink items-center truncate rounded-pill bg-canvas-pink/70 px-2 font-manrope text-[10.5px] font-semibold tracking-[-0.01em] text-charcoal/60"
            >
              #{compactTopicTag(topic)}
            </span>
          ))}
        </div>
        <h3 className="line-clamp-2 min-h-[40px] max-w-[96%] font-manrope text-[16px] font-extrabold leading-[1.25] tracking-[-0.02em] text-charcoal">
          {item.title}
        </h3>

        <div className="mt-auto flex items-stretch overflow-hidden rounded-[8px] border-2 border-charcoal bg-surface-white font-manrope text-charcoal">
          {stats.map((stat, index) => {
            const Icon = stat.icon;

            return (
              <span
                key={stat.kind}
                title={`${stat.text} ${stat.label}`}
                data-emphasis={caseStatEmphasis(stat.value, maxStatValue)}
                style={caseStatGradientStyle(stat.kind, stat.value, maxStatValue)}
                className={`case-stat-cell inline-flex min-h-[34px] min-w-0 flex-1 items-center justify-center gap-1.5 px-1.5 ${
                  index > 0 ? "border-l-2 border-charcoal/10" : ""
                }`}
              >
                <Icon size={13} strokeWidth={2.6} className="case-stat-cell__icon shrink-0" />
                <span className="case-stat-cell__value font-mono text-[12px] font-bold leading-none tracking-[-0.02em] text-charcoal">{stat.text}</span>
              </span>
            );
          })}
        </div>

        <div className="mt-2.5 grid">
          <button
            type="button"
            onClick={() => onTry(item)}
            className="group/action inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-pill border-2 border-charcoal bg-surface-white px-[14px] font-manrope text-[13.5px] font-extrabold text-charcoal transition-[transform,background-color] hover:-translate-y-[2px] hover:bg-pumpkin active:translate-y-0"
          >
            <Zap size={14} strokeWidth={2.8} />
            <span className="action-underline">立刻尝试</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function GalleryPreviewDialog({
  item,
  initialIndex,
  onClose,
  onTry,
}: {
  item: XhsPromptCase | null;
  initialIndex: number;
  onClose: () => void;
  onTry: (item: XhsPromptCase) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const previousIndexRef = useRef(initialIndex);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!item) return;
    setActiveIndex(initialIndex);
    previousIndexRef.current = initialIndex;
  }, [initialIndex, item]);

  useEffect(() => {
    if (!item) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") {
        const images = imagesFor(item);
        setActiveIndex((index) => (index - 1 + images.length) % images.length);
      }
      if (event.key === "ArrowRight") {
        const images = imagesFor(item);
        setActiveIndex((index) => (index + 1) % images.length);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    const context = gsap.context(() => {
      gsap.fromTo(
        dialogRef.current,
        { opacity: 0, y: 24, scale: 0.985 },
        { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "power3.out" },
      );
      gsap.fromTo(copyRef.current?.children ?? [], { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: "power3.out" });
    }, dialogRef);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
      context.revert();
    };
  }, [item, onClose]);

  useEffect(() => {
    if (!item || !imageRef.current || !mediaRef.current) return;
    const direction = activeIndex >= previousIndexRef.current ? 1 : -1;

    gsap.killTweensOf([imageRef.current, mediaRef.current]);
    gsap.fromTo(
      mediaRef.current,
      { clipPath: direction > 0 ? "inset(0 0 0 8%)" : "inset(0 8% 0 0)" },
      { clipPath: "inset(0 0 0 0)", duration: 0.62, ease: "power3.out" },
    );
    gsap.fromTo(
      imageRef.current,
      { opacity: 0.72, scale: 1.08, xPercent: direction * -4 },
      { opacity: 1, scale: 1, xPercent: 0, duration: 0.72, ease: "power3.out" },
    );

    previousIndexRef.current = activeIndex;
  }, [activeIndex, item]);

  if (!item) return null;

  const images = imagesFor(item);
  const activeImage = images[activeIndex] ?? images[0];
  const activeLabel = String(activeIndex + 1).padStart(2, "0");
  const totalLabel = String(images.length).padStart(2, "0");
  const authorUrl = item.authorUrl || item.noteUrl;

  const goPrev = () => setActiveIndex((index) => (index - 1 + images.length) % images.length);
  const goNext = () => setActiveIndex((index) => (index + 1) % images.length);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-charcoal/58 px-3 py-5 backdrop-blur-[2px] md:px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gallery-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="gallery-preview-shell max-h-[92dvh] w-full max-w-[1160px] overflow-hidden rounded-[14px] border-2 border-charcoal bg-canvas-pink shadow-brand-xl"
      >
        <div className="gallery-preview-media relative min-h-[52dvh] border-b-2 border-charcoal bg-surface-white p-3">
          <div
            ref={mediaRef}
            className="gallery-preview-stage relative flex h-[56dvh] min-h-[360px] items-center justify-center overflow-hidden rounded-[10px] border-2 border-charcoal bg-charcoal"
          >
            <img
              ref={imageRef}
              key={`${item.id}-${activeImage}`}
              src={activeImage}
              alt={`${item.title} 第 ${activeIndex + 1} 张沉浸式预览图`}
              onError={handleImageError}
              className="h-full w-full object-contain"
              draggable={false}
            />
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-[7px] border-2 border-charcoal bg-lemon px-2.5 py-2 shadow-brand-sm">
              <span className="font-mono text-[12px] font-bold leading-none text-charcoal">
                {activeLabel}/{totalLabel}
              </span>
              <span className="h-1.5 w-14 overflow-hidden rounded-full border border-charcoal bg-surface-white">
                <span
                  className="block h-full rounded-full bg-pumpkin transition-[width] duration-300 ease-out"
                  style={{ width: `${((activeIndex + 1) / images.length) * 100}%` }}
                />
              </span>
            </div>
            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  className="absolute left-3 top-1/2 inline-flex min-h-11 -translate-y-1/2 items-center gap-1.5 rounded-pill border-2 border-charcoal bg-surface-white px-3 font-manrope text-[13px] font-extrabold text-charcoal shadow-brand-sm transition-transform hover:-translate-y-[calc(50%+2px)] active:-translate-y-1/2"
                  aria-label="上一张预览图"
                >
                  <ChevronLeft size={18} strokeWidth={2.8} />
                  上一张
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="absolute right-3 top-1/2 inline-flex min-h-11 -translate-y-1/2 items-center gap-1.5 rounded-pill border-2 border-charcoal bg-surface-white px-3 font-manrope text-[13px] font-extrabold text-charcoal shadow-brand-sm transition-transform hover:-translate-y-[calc(50%+2px)] active:-translate-y-1/2"
                  aria-label="下一张预览图"
                >
                  下一张
                  <ChevronRight size={18} strokeWidth={2.8} />
                </button>
              </>
            ) : null}
          </div>
        </div>

        <aside className="flex max-h-[92dvh] flex-col overflow-y-auto bg-surface-white">
          <div className="flex items-start justify-between gap-4 border-b-2 border-charcoal p-4 md:p-5">
            <div className="min-w-0">
              <p className="font-manrope text-[12px] font-extrabold text-charcoal/58">沉浸式图集预览</p>
              <h2 id="gallery-preview-title" className="mt-2 font-manrope text-[26px] font-black leading-[1.08] text-charcoal">
                {item.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-charcoal bg-surface-white text-charcoal shadow-brand-sm transition-transform hover:-translate-y-[2px] active:translate-y-0"
              aria-label="关闭沉浸式图集预览"
            >
              <X size={20} strokeWidth={2.8} />
            </button>
          </div>

          <div ref={copyRef} className="grid gap-4 p-4 md:p-5">
            <div className="grid gap-2 rounded-[10px] border-2 border-charcoal bg-canvas-pink p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-[6px] border-2 border-charcoal px-3 py-1 font-manrope text-[13px] font-extrabold ${accentFor(item.category)}`}>
                  {item.category}
                </span>
                <span className="rounded-[6px] border-2 border-charcoal bg-surface-white px-3 py-1 font-manrope text-[13px] font-extrabold">
                  {statLabel(item.likesText, "赞")}
                </span>
                <span className="rounded-[6px] border-2 border-charcoal bg-surface-white px-3 py-1 font-manrope text-[13px] font-extrabold">
                  {statLabel(item.savesText, "藏")}
                </span>
              </div>
              {authorUrl ? (
                <a
                  href={authorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit max-w-full items-center gap-1 truncate font-manrope text-[15px] font-extrabold text-charcoal underline decoration-2 underline-offset-4"
                >
                  @{item.author}
                  <ArrowUpRight size={15} strokeWidth={2.5} />
                </a>
              ) : (
                <p className="truncate font-manrope text-[15px] font-extrabold text-charcoal">@{item.author}</p>
              )}
            </div>

            <div>
              <p className="mb-2 font-manrope text-[12px] font-extrabold text-charcoal/58">缩略图 tabs</p>
              <div className="case-gallery-thumbs flex gap-2 overflow-x-auto pb-1" aria-label={`${item.title} 弹窗图集缩略图`}>
                {images.map((src, index) => (
                  <button
                    key={`${item.id}-preview-thumb-${src}`}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`预览第 ${index + 1} 张图`}
                    aria-current={index === activeIndex}
                    className={`group/thumb relative h-[68px] w-[52px] shrink-0 overflow-hidden rounded-[8px] border-2 transition-all duration-300 hover:-translate-y-[2px] ${
                      index === activeIndex
                        ? "border-charcoal bg-lemon shadow-brand-sm"
                        : "border-charcoal/45 bg-surface-white opacity-70 hover:border-charcoal hover:opacity-100"
                    }`}
                  >
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      onError={handleImageError}
                      className="h-full w-full object-cover object-top transition-transform duration-500 ease-out group-hover/thumb:scale-110"
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] border-2 border-charcoal bg-surface-white">
              <div className="border-b-2 border-charcoal bg-charcoal px-3 py-2 font-manrope text-[12px] font-extrabold text-surface-white">
                提示词
              </div>
              <PromptTemplatePreview
                prompt={promptForCase(item)}
                className="max-h-[190px] overflow-y-auto p-3 font-manrope text-[14px] font-extrabold leading-[1.75] text-charcoal/78"
              />
            </div>

            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  onTry(item);
                  onClose();
                }}
                className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-[10px] bg-pumpkin px-5 py-3 text-center font-manrope text-[18px] font-extrabold text-charcoal transition-transform hover:-translate-y-[2px] active:translate-y-0"
              >
                <Send size={19} strokeWidth={2.7} />
                用这组图生成
              </button>
              <button
                type="button"
                onClick={() => {
                  onTry(item);
                  onClose();
                }}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border-2 border-charcoal bg-surface-white px-5 py-3 text-center font-manrope text-[15px] font-extrabold text-charcoal transition-colors hover:bg-lemon"
              >
                <Zap size={17} strokeWidth={2.7} />
                打开生成确认
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function Prompts() {
  const [activeCategory, setActiveCategory] = useState("全部");
  const [sortMode, setSortMode] = useState("综合热度");
  const [query, setQuery] = useState("");
  const [selectedCase, setSelectedCase] = useState<XhsPromptCase>(defaultCase);
  const [prompt, setPrompt] = useState(() => promptForCase(defaultCase));
  const [previewCase, setPreviewCase] = useState<XhsPromptCase | null>(null);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const filteredCases = useFilteredCases(activeCategory, query, sortMode);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const selectCaseForGeneration = (item: XhsPromptCase, promptValue = promptForCase(item)) => {
    setSelectedCase(item);
    setPrompt(promptValue);
  };

  const scrollToComposer = (behavior: ScrollBehavior = "smooth") => {
    const wrapper = composerRef.current;
    wrapper?.scrollIntoView({ behavior, block: "start" });
    const card = wrapper?.querySelector<HTMLElement>(".prompt-composer-card");
    if (!card) return;

    gsap.killTweensOf(card);
    gsap.fromTo(
      card,
      { y: 14, scale: 0.992 },
      { y: 0, scale: 1, duration: 0.58, ease: "elastic.out(1, 0.58)" },
    );
  };

  const handleTry = (item: XhsPromptCase) => {
    selectCaseForGeneration(item, promptForCase(item));
    requestAnimationFrame(() => scrollToComposer());
  };

  const handleUseImage = (item: XhsPromptCase) => {
    selectCaseForGeneration(item, promptForCase(item));
    requestAnimationFrame(() => scrollToComposer());
  };

  return (
    <TooltipProvider delayDuration={150}>
    <main className="prompt-page-scale min-h-screen w-full max-w-full overflow-x-hidden bg-canvas-pink font-manrope">
      <Navbar />
      <div ref={composerRef}>
        <PromptHero
          selectedCase={selectedCase}
          prompt={prompt}
          setPrompt={setPrompt}
        />
      </div>

      <section className="border-y-2 border-charcoal bg-surface-white px-4 py-4 md:px-8 md:py-5">
        <div className="prompt-container prompt-container--wide">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="flex min-h-[46px] flex-1 items-center gap-3 rounded-[12px] border-2 border-charcoal bg-surface-white px-4">
              <Search size={19} strokeWidth={2.5} className="shrink-0 text-charcoal/55" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索主题、博主、分类、提示词"
                className="w-full bg-transparent font-manrope text-[15px] font-semibold text-charcoal placeholder:font-medium placeholder:text-charcoal/40 focus:outline-none"
              />
              <span className="shrink-0 whitespace-nowrap font-manrope text-[12px] font-bold tabular-nums text-charcoal/45">
                共 {promptCases.length}
              </span>
            </label>

            <div className="flex shrink-0 items-center gap-2.5">
              <span className="hidden items-center gap-1.5 font-manrope text-[12px] font-bold uppercase tracking-[0.14em] text-charcoal/45 sm:inline-flex">
                <ArrowDownUp size={14} strokeWidth={2.6} />
                排序
              </span>
              <ToggleGroup
                type="single"
                value={sortMode}
                onValueChange={(value) => value && setSortMode(value)}
                className="gap-0 overflow-hidden rounded-pill border-2 border-charcoal bg-surface-white shadow-brand-sm"
              >
                {sortModes.map((mode) => (
                  <ToggleGroupItem
                    key={mode}
                    value={mode}
                    aria-label={mode}
                    className="h-10 rounded-none border-l-2 border-charcoal px-3.5 font-manrope text-[13px] font-bold text-charcoal/70 transition-colors first:border-l-0 hover:bg-canvas-pink hover:text-charcoal data-[state=on]:bg-charcoal data-[state=on]:text-surface-white"
                  >
                    {mode}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((category) => {
              const active = activeCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`inline-flex h-9 items-center rounded-pill border-2 border-charcoal px-3.5 font-manrope text-[13px] font-bold transition-transform hover:-translate-y-[2px] ${
                    active
                      ? `${accentFor(category)} text-charcoal shadow-brand-sm`
                      : "bg-surface-white text-charcoal/65 hover:text-charcoal"
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section id="gallery" className="px-4 py-10 md:px-8 md:py-12">
        <div className="prompt-container prompt-container--gallery">
          {filteredCases.length > 0 ? (
            <div className="xhs-masonry">
              {filteredCases.map((item) => (
                <CaseCard key={item.id} item={item} selected={item.id === selectedCase.id} onTry={handleTry} onUseImage={handleUseImage} />
              ))}
            </div>
          ) : (
            <div className="rounded-[14px] border-2 border-charcoal bg-surface-white p-8 text-center shadow-brand-lg">
              <h3 className="font-manrope text-[22px] font-extrabold text-charcoal">没有匹配的案例</h3>
              <p className="mx-auto mt-2 max-w-[360px] font-manrope text-[15px] font-medium leading-[1.6] text-charcoal/65">
                换一个关键词，或者回到「全部」查看完整案例库。
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="border-t-2 border-charcoal bg-pumpkin px-4 py-12 md:px-8 md:py-16">
        <div className="prompt-container prompt-container--wide grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch">
          <div className="flex flex-col justify-start gap-10">
            <div>
              <span className="inline-flex items-center rounded-pill border-2 border-charcoal bg-surface-white px-3.5 py-1.5 font-manrope text-[11px] font-bold uppercase tracking-[0.14em] text-charcoal">
                生成前确认
              </span>
              <h2 className="mt-5 max-w-[480px] font-manrope text-[28px] font-black leading-[1.04] tracking-[-0.02em] text-charcoal md:text-[36px]">
                选好参考，换个主题就开跑。
              </h2>
              <p className="mt-4 max-w-[500px] font-manrope text-[15px] font-medium leading-[1.65] text-charcoal/75">
                这一屏只服务一个决策：当前案例是否适合作为新图文的结构参考。保留首图、标题节奏和来源链接，把注意力留给主题方向。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {["选一张爆款首图", "改一句主题方向", "带参考图去生成"].map((step, index) => (
                <div key={step} className="flex flex-col justify-between rounded-[12px] border-2 border-charcoal bg-surface-white p-4 shadow-brand">
                  <p className="font-mono text-[12px] font-bold tracking-[0.05em] text-charcoal/35">{String(index + 1).padStart(2, "0")}</p>
                  <p className="mt-8 font-manrope text-[16px] font-extrabold leading-tight text-charcoal">{step}</p>
                </div>
              ))}
            </div>
          </div>

            <div className="overflow-hidden rounded-[14px] border-2 border-charcoal bg-surface-white shadow-brand-lg">
            <div className="grid grid-cols-[96px_1fr] gap-4 border-b-2 border-charcoal bg-lemon p-4 md:grid-cols-[128px_1fr] md:p-4">
              <div className="h-[112px] overflow-hidden rounded-[10px] border-2 border-charcoal bg-canvas-pink md:h-[136px]">
                <img src={imagesFor(selectedCase)[0]} alt={`${selectedCase.title} 当前参考`} onError={handleImageError} className="h-full w-full object-cover object-top" />
              </div>
              <div className="min-w-0 self-center">
                <p className="font-manrope text-[11px] font-bold uppercase tracking-[0.14em] text-charcoal/55">当前选择</p>
                <h3 className="mt-2 line-clamp-2 font-manrope text-[21px] font-extrabold leading-[1.1] tracking-[-0.01em] text-charcoal md:text-[26px]">
                  {selectedCase.title}
                </h3>
                <a
                  href={selectedCase.authorUrl || selectedCase.noteUrl}
                  target="_blank"
                  rel="noreferrer"
                className="mt-3 inline-flex max-w-full items-center gap-1 truncate font-manrope text-[13px] font-bold text-charcoal/80 decoration-charcoal/30 decoration-2 underline-offset-4 hover:underline"
                >
                  @{selectedCase.author}
                  <ArrowUpRight size={14} strokeWidth={2.5} className="shrink-0 opacity-60" />
                </a>
              </div>
            </div>

            <div className="grid divide-y-2 divide-charcoal/10 font-manrope text-charcoal">
              <div className="grid grid-cols-[96px_1fr] items-center gap-4 px-5 py-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-charcoal/45">分类</span>
                <span className={`w-fit rounded-[6px] border-2 border-charcoal px-3 py-1 text-[13px] font-bold ${accentFor(selectedCase.category)}`}>
                  {selectedCase.category}
                </span>
              </div>
              <div className="grid grid-cols-[96px_1fr] gap-4 px-5 py-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-charcoal/45">带入内容</span>
                <p className="line-clamp-2 text-[14px] font-medium leading-[1.55] text-charcoal/72">
                  当前输入框内容、前 3 张参考图、原帖链接和博主链接。
                </p>
              </div>
              <div className="grid grid-cols-[96px_1fr] gap-4 px-5 py-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-charcoal/45">主题方向</span>
                <PromptTemplatePreview
                  prompt={prompt}
                  className="line-clamp-3 text-[14px] font-semibold leading-[1.7] text-charcoal/80"
                />
              </div>
            </div>

            <div className="border-t-2 border-charcoal bg-charcoal p-4">
              <button
                type="button"
                onClick={() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-surface-white px-5 py-3 font-manrope text-[15px] font-extrabold text-charcoal transition-transform hover:-translate-y-[3px] active:translate-y-0"
              >
                回到上方生成
                <ArrowUpRight size={18} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <Footer />
      <GalleryPreviewDialog item={previewCase} initialIndex={previewInitialIndex} onClose={() => setPreviewCase(null)} onTry={handleTry} />
    </main>
    </TooltipProvider>
  );
}
