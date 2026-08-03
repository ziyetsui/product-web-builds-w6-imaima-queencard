import { styleRecreationPatterns } from "@/features/prompt-replication/data/styleRecreationPatterns";
import { xhsPromptCases } from "@/features/prompt-replication/data/xhsPromptCases";
import type { XhsPromptCase } from "@/features/prompt-replication/data/xhsPromptCases";
import type { PatternValues, StyleRecreationPattern } from "./pattern-types";
import { validateStyleRecreationPattern } from "./pattern-schema";
import { renderFillTemplate } from "./fill-template";

const patternsById = new Map<string, StyleRecreationPattern>();
const patternsBySourceCase = new Map<string, StyleRecreationPattern>();
const suggestionsBySourceCase = new Map<string, PatternValues>();
const allSourceCases = xhsPromptCases;
const sourceCasesById = new Map(allSourceCases.map((sourceCase) => [sourceCase.id, sourceCase]));

function genericPatternIdFor(sourceCase: XhsPromptCase) {
  if (sourceCase.category === "梗图") return "library-meme-series";
  if (sourceCase.category === "公众号配图") return "library-article-cover-series";
  if (sourceCase.category === "爆款图文") return "library-social-post-series";
  return "library-universal-series";
}

function socialTopicFor(sourceCase: XhsPromptCase) {
  const direction = sourceCase.subtitle;
  if (direction.includes("玄学")) return "考前焦虑的自我安慰";
  if (direction.includes("AI")) return "普通人第一次使用 AI";
  if (direction.includes("知识")) return "AI 如何改变日常工作";
  if (direction.includes("旅行")) return "周末城市漫游";
  if (direction.includes("成长")) return "低能量状态恢复";
  if (direction.includes("美食")) return "下班后的快速晚餐";
  if (direction.includes("英语")) return "每天十分钟学英语";
  if (direction.includes("电商")) return "新手选品避坑";
  if (direction.includes("健康")) return "久坐人群的日常恢复";
  if (direction.includes("职场")) return "第一次带 AI 实习生";
  if (direction.includes("情感")) return "成年人重新照顾自己";
  return "AI 时代的生活新方式";
}

function socialStyleFor(sourceCase: XhsPromptCase) {
  const direction = sourceCase.subtitle;
  if (direction.includes("复古老照片")) return "复古胶片、暖色颗粒和叙事留白";
  if (direction.includes("清单")) return "清晰分区、高信息密度和收藏感";
  if (direction.includes("步骤") || direction.includes("实操")) return "步骤编号、强层级和教程感";
  if (direction.includes("玄学")) return "高饱和能量色、中心构图和仪式感";
  return "醒目标题、清晰分区和收藏型排版";
}

function genericSuggestions(sourceCase: XhsPromptCase, pattern: StyleRecreationPattern): PatternValues {
  if (pattern.id === "library-meme-series") {
    return {
      visual_style: "大字标题、强对比和直接笑点",
      topic: "AI 时代的职场日常",
      setup: "程序员在周一早会上汇报进度",
      punchline: "AI 比老板更早发现需求又改了",
    };
  }
  if (pattern.id === "library-article-cover-series") {
    return {
      visual_style: sourceCase.subtitle.includes("叙事")
        ? "叙事插画、克制配色和大面积留白"
        : "编辑插画、强标题层级和克制留白",
      topic: "AI 创业的真实困境",
      metaphor: "吞掉办公桌的巨大待办清单",
      headline: "创业以后，时间去哪了",
    };
  }
  if (pattern.id === "library-social-post-series") {
    const topic = socialTopicFor(sourceCase);
    return {
      visual_style: socialStyleFor(sourceCase),
      topic,
      audience: "正在寻找可执行方法的年轻人",
      headline: `${topic}，从这一步开始`,
    };
  }

  const topicByCategory: Record<string, string> = {
    搞笑漫画: "AI 时代的职场日常",
    成长自律: "低能量状态恢复",
    情绪疗愈: "成年人重新照顾自己",
    清单种草: "新手创作者的工具清单",
    知识科普: "普通人如何理解 AI",
    养生内调: "久坐人群的日常恢复",
    美女图集: "周末城市漫游",
  };
  return {
    visual_style: "参考作品的配色、构图节奏和媒介质感",
    topic: topicByCategory[sourceCase.category] ?? "AI 时代的生活新方式",
    subject: "第一次尝试新方法的年轻人",
    scene: "下班后的城市街角发生新的故事",
  };
}

export function validateSuggestedPatternValues(pattern: StyleRecreationPattern, values: PatternValues) {
  const expectedKeys = new Set(pattern.variables.map((variable) => variable.key));
  const unknownKey = Object.keys(values).find((key) => !expectedKeys.has(key));
  if (unknownKey) {
    return { ok: false as const, message: `unknown suggested Pattern value: ${unknownKey}` };
  }

  for (const variable of pattern.variables) {
    const value = values[variable.key] ?? variable.defaultValue;
    if (variable.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < variable.min || value > variable.max) {
        return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
      }
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
    }
    const length = Array.from(value).length;
    if ((variable.minLength !== undefined && length < variable.minLength) || (variable.maxLength !== undefined && length > variable.maxLength)) {
      return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
    }
    if (variable.type === "enum" && !variable.options.some((option) => option.value === value)) {
      return { ok: false as const, message: `invalid suggested value: ${variable.key}` };
    }
  }

  return { ok: true as const };
}

for (const inputPattern of styleRecreationPatterns) {
  const parsed = validateStyleRecreationPattern(inputPattern);
  if (!parsed.success) throw new Error(`Invalid style recreation Pattern ${inputPattern.id}: ${parsed.error.message}`);
  const pattern = Object.freeze(parsed.data) as StyleRecreationPattern;
  if (patternsById.has(pattern.id)) throw new Error(`Duplicate style recreation Pattern id: ${pattern.id}`);
  patternsById.set(pattern.id, pattern);

  for (const sourceCaseId of pattern.sourceCaseIds) {
    const sourceCase = sourceCasesById.get(sourceCaseId);
    if (!sourceCase) throw new Error(`Unknown source case: ${sourceCaseId}`);
    if (patternsBySourceCase.has(sourceCaseId)) throw new Error(`Duplicate source case binding: ${sourceCaseId}`);
    if (sourceCase.patternId !== pattern.id) throw new Error(`Mismatched Pattern binding for source case: ${sourceCaseId}`);
    const suggestions = sourceCase.suggestedPatternValues;
    if (!suggestions) throw new Error(`Missing suggested Pattern values for source case: ${sourceCaseId}`);
    const suggestionsValidation = validateSuggestedPatternValues(pattern, suggestions);
    if (!suggestionsValidation.ok) throw new Error(`${suggestionsValidation.message} for source case: ${sourceCaseId}`);
    const resolvedSuggestions = {
      ...Object.fromEntries(pattern.variables
        .filter((variable) => variable.defaultValue !== undefined)
        .map((variable) => [variable.key, variable.defaultValue!])),
      ...suggestions,
    };
    patternsBySourceCase.set(sourceCaseId, pattern);
    suggestionsBySourceCase.set(sourceCaseId, Object.freeze(resolvedSuggestions));
  }
}

for (const sourceCase of allSourceCases) {
  if (patternsBySourceCase.has(sourceCase.id)) continue;
  const pattern = patternsById.get(genericPatternIdFor(sourceCase));
  if (!pattern) throw new Error(`Missing generic Pattern for source case: ${sourceCase.id}`);
  const suggestions = genericSuggestions(sourceCase, pattern);
  const validation = validateSuggestedPatternValues(pattern, suggestions);
  if (!validation.ok) throw new Error(`${validation.message} for source case: ${sourceCase.id}`);
  patternsBySourceCase.set(sourceCase.id, pattern);
  suggestionsBySourceCase.set(sourceCase.id, Object.freeze(suggestions));
}

export function getPatternById(id: string) {
  return patternsById.get(id);
}

export function getPatternDisplayPrompt(id: string | undefined, values: PatternValues | undefined) {
  if (!id || !values) return undefined;
  const pattern = getPatternById(id);
  if (!pattern) return undefined;
  return renderFillTemplate(pattern.fillTemplate, values);
}

export function getPatternForSourceCase(sourceCaseId: string) {
  return patternsBySourceCase.get(sourceCaseId);
}

export function getPatternForPromptCase(sourceCase: XhsPromptCase) {
  return patternsBySourceCase.get(sourceCase.id)
    ?? patternsById.get(genericPatternIdFor(sourceCase));
}

export function getSuggestedPatternValues(sourceCaseId: string) {
  return suggestionsBySourceCase.get(sourceCaseId);
}

export function getSuggestedPatternValuesForCase(sourceCase: XhsPromptCase) {
  const configured = suggestionsBySourceCase.get(sourceCase.id);
  if (configured) return configured;
  const pattern = getPatternForPromptCase(sourceCase);
  return pattern ? genericSuggestions(sourceCase, pattern) : undefined;
}

export function getPatternRegistryValidation() {
  return {
    valid: true as const,
    patternCount: patternsById.size,
    sourceBindingCount: patternsBySourceCase.size,
    sourceCaseCount: allSourceCases.length,
  };
}
