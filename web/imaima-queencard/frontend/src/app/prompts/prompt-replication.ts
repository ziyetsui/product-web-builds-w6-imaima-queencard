import type { XhsPromptCase } from "@/data/xhsPromptCases";

type PromptCase = Pick<XhsPromptCase, "category" | "topics" | "prompt" | "sourceTitle">;

export type SourceAnalysis = {
  type: string;
  sourceTheme: string;
  sourceMechanisms: string;
  sourceTitle: string;
};

export type FillPrompt = {
  visual: string;
  title: string;
  topic: string;
};

const genericTopics = new Set([
  "漫画", "原创漫画", "小红书", "清单种草", "生活灵感", "健康养生", "有趣",
  "爆款图文", "AI创作", "抖音", "搞笑", "抽象",
]);

function sourceThemeFor(item: PromptCase) {
  return item.topics.find((topic) => !genericTopics.has(topic))?.trim() || item.sourceTitle || item.category;
}

function sourceMechanismsFor(item: PromptCase) {
  const direct = item.prompt.match(/参考(?:图文|案例)《[^》]+》的(.+?)，生成一组新的/);
  if (direct?.[1]) return direct[1].trim();
  const method = item.prompt.match(/创作方法：(.+?)(?:。|请输出|$)/);
  if (method?.[1]) return method[1].replace(/^保留(?:原案例|原图文)的/, "").trim();
  return "标题句式、画面结构、情绪节奏和互动方式";
}

export function analyzeSource(item: PromptCase): SourceAnalysis {
  return {
    type: item.category,
    sourceTheme: sourceThemeFor(item),
    sourceMechanisms: sourceMechanismsFor(item),
    sourceTitle: item.sourceTitle,
  };
}

export function instantiateTitle(analysis: SourceAnalysis, topic: string) {
  const { sourceTitle, sourceTheme } = analysis;
  if (sourceTheme && sourceTitle.includes(sourceTheme)) {
    return sourceTitle.split(sourceTheme).join(topic);
  }
  if (/谁懂[？?！!]?$/.test(sourceTitle)) return `${topic}，谁懂？`;
  if (/^(?:如何)?用.+?(?:时间|天)/.test(sourceTitle)) return `如何用7天时间搞定${topic}`;
  return sourceTitle;
}

function sanitizeSlot(value: string) {
  return value
    .replace(/「/g, "『")
    .replace(/」/g, "』")
    .replace(/“/g, "『")
    .replace(/”/g, "』")
    .replace(/"/g, "'");
}

export function buildFillPrompt(fill: FillPrompt) {
  const visual = sanitizeSlot(fill.visual).replace(/[。；;]/g, "、");
  const title = sanitizeSlot(fill.title);
  const topic = sanitizeSlot(fill.topic);
  return (
    `参考已附上的原图，逐项复刻原图的${visual}，画风、构图、配色与字体版式保持一致，` +
    `并去除图片中的水印和平台账号字样。` +
    `只改两处：主标题换成「${title}」，画面主体从原主题换成「${topic}」，其余元素照原图复刻。` +
    `画面中只允许出现作品本身的文字，禁止出现任何说明、分析或指令类文字。`
  );
}

export function buildReplicationPrompt(item: PromptCase) {
  const analysis = analyzeSource(item);
  const topic = analysis.sourceTheme;
  return buildFillPrompt({
    visual: analysis.sourceMechanisms,
    title: instantiateTitle(analysis, topic),
    topic,
  });
}

export function parseReplicationPrompt(prompt: string): FillPrompt | null {
  const match = prompt
    .trim()
    .match(
      /^参考已附上的原图，逐项复刻原图的(.+?)，画风、构图、配色与字体版式保持一致，并去除图片中的水印和平台账号字样。只改两处：主标题换成「([^」]*)」，画面主体从原主题换成「([^」]*)」，其余元素照原图复刻。画面中只允许出现作品本身的文字，禁止出现任何说明、分析或指令类文字。$/,
    );
  if (!match) return null;
  return { visual: match[1], title: match[2], topic: match[3] };
}
