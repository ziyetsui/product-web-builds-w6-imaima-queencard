import type { PatternVariable, StyleRecreationPattern } from "@/features/style-recreation/pattern-types";

const sourceCaseGroups = {
  "wordplay-reveal": [
    "20251009-27", "6673eff2000000001e013a9f", "20250509-52", "68c5603c000000001d018c87", "68c68166000000001d02859c",
  ],
  "visual-metaphor-emotion": [
    "66432778000000001e030ca6", "69cbb8ea000000002800a9a9", "20260215-18", "685246990000000021019701", "20251021-25",
  ],
  "collectible-checklist": [
    "65b23b6f000000001003c199", "6687df14000000000a0045ee", "68104066000000002300ddf2", "68553b18000000000d0277f5", "69b85e5a000000001a033655",
  ],
  "narrative-resonance": [
    "642cd47a0000000012030388", "6873fc80000000001c0345c5", "68897178000000002303a615", "670689e7000000002c029667", "660e6171000000001a010564",
  ],
} as const;

const commonConstraints = {
  preserve: ["抽象视觉媒介", "色彩关系", "留白比例", "阅读节奏"],
  transform: ["重新设计主体", "重新设计动作", "重新设计场景", "重新设计构图"],
  forbid: ["复制原文案", "复制原主体", "复制原场景", "复制账号", "复制水印"],
  create: ["创建新场景", "创建新动作", "创建新空间关系"],
};

const topicVariable: PatternVariable = {
  key: "topic", label: "新主题", helpText: "这张新作品真正要表达的主题", semanticRole: "content", type: "short_text", required: true, maxLength: 30, placeholder: "例如：程序员第一次带 AI 实习生",
};

function visualStyleVariable(defaultValue: string): PatternVariable {
  return {
    key: "visual_style",
    label: "视觉风格",
    helpText: "希望新作品继承或调整的视觉语言",
    semanticRole: "visual_style",
    type: "short_text",
    required: true,
    defaultValue,
    maxLength: 36,
    placeholder: "例如：极简线稿、大留白和冷幽默",
  };
}

const familyDefinitions = {
  "wordplay-reveal": {
    name: "极简漫画 × 双关揭示",
    description: "用克制画面和语言反差完成新的双关或冷笑话揭示",
    fillTemplate: "沿用参考作品的{{visual_style}}，创作一个关于{{topic}}的冷笑话，用{{setup}}作为情境，最后通过{{punchline}}形成反转。",
    visualLanguage: {
      illustration: "极简手绘漫画",
      palette: ["低饱和底色", "黑色线条", "单一强调色"],
      contrast: "medium" as const,
      compositionTendencies: ["单一视觉焦点", "简洁分镜", "结尾反转"],
      whitespace: "large" as const,
      typography: ["顶部短标题", "手写感粗体", "少量对白"],
      strokeAndTexture: ["松弛线稿", "轻微纸张颗粒"],
      visualRhythm: ["铺垫克制", "末尾突然揭示"],
      emotionalTone: ["荒诞", "轻松", "冷幽默"],
    },
    contentPattern: { hook: "熟悉的日常误导", sequence: ["建立新情境", "埋入语言线索", "用画面揭示双关"], payoff: "让读者在反差中会心一笑" },
    variables: [
      visualStyleVariable("极简线稿、克制留白和冷幽默"),
      topicVariable,
      { key: "setup", label: "新情境", semanticRole: "content", type: "short_text", required: true, maxLength: 50, placeholder: "发生在哪里、谁遇到了什么" },
      { key: "punchline", label: "新包袱", semanticRole: "content", type: "short_text", required: true, maxLength: 60, placeholder: "双关、反差或最后揭示" },
    ] satisfies PatternVariable[],
  },
  "visual-metaphor-emotion": {
    name: "巨型隐喻 × 强情绪",
    description: "把现实困难转译成新的巨大视觉隐喻并重新构图",
    fillTemplate: "沿用参考作品的{{visual_style}}，表现{{topic}}，让{{subject}}面对{{metaphor}}这一巨大视觉隐喻。",
    visualLanguage: {
      illustration: "粗粝版画与编辑插画融合",
      palette: ["黑", "米白", "单一警示色"],
      contrast: "high" as const,
      compositionTendencies: ["单主体", "夸张尺度差", "强透视"],
      whitespace: "large" as const,
      typography: ["顶部大标题", "高字重", "强层级"],
      strokeAndTexture: ["粗粝刻线", "颗粒阴影"],
      visualRhythm: ["巨大空间压迫", "强运动方向"],
      emotionalTone: ["压迫", "焦虑", "共鸣"],
    },
    contentPattern: { hook: "现实困难切入", sequence: ["将困难转译成视觉隐喻", "让新主体与隐喻发生空间关系", "用标题强化情绪"], payoff: "形成强烈情绪共鸣" },
    variables: [
      visualStyleVariable("粗粝版画、高对比和空间压迫感"),
      topicVariable,
      { key: "subject", label: "新主体", semanticRole: "content", type: "short_text", required: true, maxLength: 40, placeholder: "例如：第一次创业的年轻人" },
      { key: "metaphor", label: "新隐喻", semanticRole: "content", type: "short_text", required: true, maxLength: 50, placeholder: "例如：逐渐下沉的深海电梯" },
    ] satisfies PatternVariable[],
  },
  "collectible-checklist": {
    name: "高密度清单 × 收藏信息",
    description: "把新主题拆成层级清楚、值得收藏的信息视觉",
    fillTemplate: "沿用参考作品的{{visual_style}}，为{{audience}}制作一份关于{{topic}}的{{item_count}}项行动清单。",
    visualLanguage: {
      illustration: "扁平信息插画",
      palette: ["明亮主色", "浅色分区", "深色正文"],
      contrast: "high" as const,
      compositionTendencies: ["网格卡片", "分区信息", "清晰编号"],
      whitespace: "medium" as const,
      typography: ["强标题层级", "数字序号", "短句正文"],
      strokeAndTexture: ["干净轮廓", "少量贴纸纹理"],
      visualRhythm: ["高密度但有序", "从标题到分项扫描"],
      emotionalTone: ["实用", "轻快", "可信"],
    },
    contentPattern: { hook: "给出明确收益", sequence: ["拆解关键步骤", "为每项提供行动提示", "形成可扫描的信息层级"], payoff: "让用户愿意收藏并执行" },
    variables: [
      visualStyleVariable("明亮分区、清晰编号和收藏型排版"),
      topicVariable,
      { key: "audience", label: "目标读者", semanticRole: "content", type: "short_text", required: true, maxLength: 30, placeholder: "例如：刚入职的产品经理" },
      { key: "item_count", label: "清单项数", semanticRole: "content", type: "number", required: true, min: 3, max: 9 },
    ] satisfies PatternVariable[],
  },
  "narrative-resonance": {
    name: "大留白 × 叙事共鸣",
    description: "用一个新的日常瞬间和克制文案建立情绪共鸣",
    fillTemplate: "沿用参考作品的{{visual_style}}，围绕{{topic}}，描绘{{subject}}身处{{scene}}的日常瞬间。",
    visualLanguage: {
      illustration: "柔和叙事插画",
      palette: ["低饱和暖色", "柔和阴影", "深色文字"],
      contrast: "low" as const,
      compositionTendencies: ["人物偏置", "环境留白", "生活化镜头"],
      whitespace: "large" as const,
      typography: ["短标题", "轻字重", "呼吸感行距"],
      strokeAndTexture: ["柔软边缘", "细腻颗粒"],
      visualRhythm: ["缓慢进入", "情绪停顿", "余韵收束"],
      emotionalTone: ["温柔", "克制", "治愈"],
    },
    contentPattern: { hook: "一个可识别的生活瞬间", sequence: ["让新主体经历具体事件", "用环境细节承接情绪"], payoff: "以一句新文案留下余韵" },
    variables: [
      visualStyleVariable("柔和插画、大留白和克制情绪"),
      topicVariable,
      { key: "subject", label: "新主体", semanticRole: "content", type: "short_text", required: true, maxLength: 40, placeholder: "谁正在经历这个瞬间" },
      { key: "scene", label: "新场景", semanticRole: "content", type: "short_text", required: true, maxLength: 50, placeholder: "这个瞬间发生在什么地方" },
    ] satisfies PatternVariable[],
  },
};

const reviewedReferencePatterns: StyleRecreationPattern[] = Object.entries(sourceCaseGroups).flatMap(
  ([familyId, caseIds]) => {
    const definition = familyDefinitions[familyId as keyof typeof familyDefinitions];
    return caseIds.map<StyleRecreationPattern>((sourceCaseId, index) => ({
      schemaVersion: "pattern/v1" as const,
      id: `${familyId}-${index + 1}`,
      version: 2,
      level: "reference" as const,
      name: `${definition.name} ${index + 1}`,
      description: definition.description,
      fillTemplate: definition.fillTemplate,
      sourceCaseIds: [sourceCaseId],
      visualLanguage: definition.visualLanguage,
      contentPattern: definition.contentPattern,
      variables: definition.variables,
      creativeConstraints: commonConstraints,
      review: { reviewer: "imaima Pattern 审核组", reviewedAt: "2026-08-02", usageRights: "reviewed" as const },
    }));
  },
);

const genericPatternDefinitions = [
  {
    id: "library-meme-series",
    name: "梗图 × 情境反转",
    description: "保留参考梗图的视觉节奏，用新主题、新情境和新笑点重新创作",
    fillTemplate: "沿用参考作品的{{visual_style}}，创作一个关于{{topic}}的梗图，用{{setup}}作为新情境，并通过{{punchline}}形成笑点。",
    visualLanguage: {
      illustration: "简洁梗图与编辑式插画",
      palette: ["参考图主色关系", "高识别强调色"],
      contrast: "high" as const,
      compositionTendencies: ["单一视觉焦点", "快速阅读", "文图反差"],
      whitespace: "medium" as const,
      typography: ["短标题", "大字重", "移动端可读"],
      strokeAndTexture: ["保留参考媒介的抽象质感"],
      visualRhythm: ["快速铺垫", "明确笑点"],
      emotionalTone: ["轻松", "荒诞", "有共鸣"],
    },
    contentPattern: { hook: "熟悉场景切入", sequence: ["建立新情境", "制造预期偏差"], payoff: "用全新的笑点完成反转" },
    variables: [
      visualStyleVariable("大字标题、强对比和直接笑点"),
      topicVariable,
      { key: "setup", label: "新情境", semanticRole: "content", type: "short_text", required: true, maxLength: 50, placeholder: "谁在什么情况下遇到了什么" },
      { key: "punchline", label: "新包袱", semanticRole: "content", type: "short_text", required: true, maxLength: 60, placeholder: "最后的反差、双关或笑点" },
    ] satisfies PatternVariable[],
  },
  {
    id: "library-article-cover-series",
    name: "公众号配图 × 视觉隐喻",
    description: "保留参考作品的编辑视觉语言，以新主题和新隐喻重新设计公众号配图",
    fillTemplate: "沿用参考作品的{{visual_style}}，围绕{{topic}}设计一张公众号配图，用{{metaphor}}作为新的核心视觉隐喻，并在画面中写{{headline}}。",
    visualLanguage: {
      illustration: "编辑插画与概念视觉",
      palette: ["克制底色", "单一强调色"],
      contrast: "high" as const,
      compositionTendencies: ["核心隐喻", "强标题层级", "重新构图"],
      whitespace: "large" as const,
      typography: ["醒目主标题", "简洁正文层级"],
      strokeAndTexture: ["参考图媒介质感", "适度颗粒"],
      visualRhythm: ["先读标题", "再理解隐喻"],
      emotionalTone: ["明确", "克制", "有观点"],
    },
    contentPattern: { hook: "用标题提出问题或观点", sequence: ["把主题转译成视觉隐喻", "建立新的空间关系"], payoff: "让标题与隐喻共同形成记忆点" },
    variables: [
      visualStyleVariable("编辑插画、强标题层级和克制留白"),
      topicVariable,
      { key: "metaphor", label: "新隐喻", semanticRole: "content", type: "short_text", required: true, maxLength: 50, placeholder: "例如：不断吞噬桌面的巨大待办清单" },
      { key: "headline", label: "新标题", semanticRole: "content", type: "short_text", required: true, maxLength: 36, placeholder: "画面中需要准确出现的短标题" },
    ] satisfies PatternVariable[],
  },
  {
    id: "library-social-post-series",
    name: "爆款图文 × 首图钩子",
    description: "保留参考作品的信息节奏和收藏动机，为新主题重新设计社交媒体首图",
    fillTemplate: "沿用参考作品的{{visual_style}}，为{{audience}}创作一张关于{{topic}}的爆款图文首图，并在画面中写{{headline}}。",
    visualLanguage: {
      illustration: "社交媒体信息视觉",
      palette: ["明亮主色", "清晰内容分区"],
      contrast: "high" as const,
      compositionTendencies: ["首图钩子", "清晰信息层级", "移动端优先"],
      whitespace: "medium" as const,
      typography: ["大标题", "短句", "高可读性"],
      strokeAndTexture: ["参考图抽象媒介质感"],
      visualRhythm: ["标题先行", "视觉信息可扫描"],
      emotionalTone: ["有吸引力", "可信", "值得收藏"],
    },
    contentPattern: { hook: "给出清晰的新主题收益", sequence: ["用首图建立阅读预期", "用视觉层级强化重点"], payoff: "促使目标读者继续阅读或收藏" },
    variables: [
      visualStyleVariable("醒目标题、清晰分区和收藏型排版"),
      topicVariable,
      { key: "audience", label: "目标读者", semanticRole: "content", type: "short_text", required: true, maxLength: 30, placeholder: "例如：第一次做内容的创业者" },
      { key: "headline", label: "新标题", semanticRole: "content", type: "short_text", required: true, maxLength: 36, placeholder: "画面中需要准确出现的短标题" },
    ] satisfies PatternVariable[],
  },
  {
    id: "library-universal-series",
    name: "通用参考作品 × 新主题再创作",
    description: "继承参考作品的抽象视觉语言，用新主体和新场景完成全新创作",
    fillTemplate: "沿用参考作品的{{visual_style}}，围绕{{topic}}，重新设计{{subject}}身处{{scene}}的全新画面。",
    visualLanguage: {
      illustration: "继承参考作品的抽象媒介语言",
      palette: ["参考图色彩关系", "重新分配强调色"],
      contrast: "medium" as const,
      compositionTendencies: ["重新设计主体", "重新设计场景", "重新设计构图"],
      whitespace: "medium" as const,
      typography: ["延续抽象层级", "生成全新文案"],
      strokeAndTexture: ["继承媒介质感但不描摹"],
      visualRhythm: ["延续阅读节奏", "建立新视觉焦点"],
      emotionalTone: ["符合新主题", "系列感"],
    },
    contentPattern: { hook: "从新主题建立视觉焦点", sequence: ["设计新主体", "让主体进入新场景"], payoff: "形成同系列但不重复的新作品" },
    variables: [
      visualStyleVariable("参考作品的配色、构图节奏和媒介质感"),
      topicVariable,
      { key: "subject", label: "新主体", semanticRole: "content", type: "short_text", required: true, maxLength: 40, placeholder: "画面中的新人物、动物或物件" },
      { key: "scene", label: "新场景", semanticRole: "content", type: "short_text", required: true, maxLength: 50, placeholder: "新的地点、动作和空间关系" },
    ] satisfies PatternVariable[],
  },
] satisfies Array<Omit<StyleRecreationPattern, "schemaVersion" | "version" | "level" | "sourceCaseIds" | "creativeConstraints" | "review">>;

const genericSeriesPatterns: StyleRecreationPattern[] = genericPatternDefinitions.map((definition) => ({
  ...definition,
  schemaVersion: "pattern/v1",
  version: 1,
  level: "series",
  sourceCaseIds: [],
  creativeConstraints: commonConstraints,
  review: { reviewer: "imaima 通用 Pattern 审核组", reviewedAt: "2026-08-03", usageRights: "reviewed" },
}));

export const styleRecreationPatterns: StyleRecreationPattern[] = [
  ...reviewedReferencePatterns,
  ...genericSeriesPatterns,
];
