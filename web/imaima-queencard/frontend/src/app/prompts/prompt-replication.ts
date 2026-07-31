import type { XhsPromptCase } from "@/data/xhsPromptCases";

type PromptCase = Pick<XhsPromptCase, "category" | "topics" | "prompt" | "sourceTitle">;

export type SourceAnalysis = {
  type: string;
  sourceTheme: string;
  sourceMechanisms: string;
  titlePattern: string;
  sourceTitle: string;
};

export type FillPrompt = {
  theme: string;
  title: string;
  replicationParameters: string;
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
  const sourceTheme = sourceThemeFor(item);
  return {
    type: item.category,
    sourceTheme,
    sourceMechanisms: sourceMechanismsFor(item),
    titlePattern: item.category === "搞笑漫画" ? "数量 + 主题对象 + 画面动作 + 情绪结果" : "原帖标题句式与主题对象",
    sourceTitle: item.sourceTitle,
  };
}

function titleFor(analysis: SourceAnalysis) {
  const { type, sourceTheme, sourceTitle } = analysis;
  if (type === "搞笑漫画") return `8个把${sourceTheme}画成段子的离谱瞬间`;
  if (type === "梗图") return `关于${sourceTheme}的几个离谱瞬间`;
  if (type === "公众号配图") return `${sourceTheme}主题视觉图文`;
  if (type === "成长自律") return `7天把${sourceTheme}重新拉回正轨`;
  if (type === "情绪疗愈") return `7个把${sourceTheme}慢慢养回来的小动作`;
  if (type === "养生内调") return `7个把${sourceTheme}慢慢养回来的小习惯`;
  if (type === "清单种草") return `9个让${sourceTheme}变顺手的日常清单`;
  if (type === "美女图集") return `8组拍出${sourceTheme}氛围感的照片`;
  if (type === "知识科普") return `一张图讲清${sourceTheme}的隐藏逻辑`;
  if (type === "爆款图文" && /看完|懂了|通透|瞬间/.test(sourceTitle)) return `${sourceTheme}，看完这组图就懂了`;
  return `${sourceTheme}，换个主题也能复刻`;
}

export function buildReplicationPrompt(item: PromptCase) {
  const analysis = analyzeSource(item);
  const fill: FillPrompt = {
    theme: analysis.type,
    title: titleFor(analysis),
    replicationParameters: `保留原图文的${analysis.sourceMechanisms}，换成新的主题`,
  };
  return `生成一组新的${fill.theme}主题：标题《${fill.title}》，复刻参数“${fill.replicationParameters}”`;
}

export function parseReplicationPrompt(prompt: string): FillPrompt | null {
  const match = prompt.trim().match(/^生成一组新的(.+?)主题：标题《([^》]*)》，复刻参数(?:《([^》]*)》|[“"]([^”"]*)[”"])。?$/);
  if (!match) return null;
  return { theme: match[1], title: match[2], replicationParameters: match[3] ?? match[4] ?? "" };
}
