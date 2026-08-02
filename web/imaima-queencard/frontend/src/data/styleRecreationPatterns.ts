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
  key: "topic", label: "新主题", helpText: "这张新作品真正要表达的主题", type: "short_text", required: true, maxLength: 30, placeholder: "例如：程序员第一次带 AI 实习生",
};

const familyDefinitions = {
  "wordplay-reveal": {
    name: "极简漫画 × 双关揭示",
    description: "用克制画面和语言反差完成新的双关或冷笑话揭示",
    fillTemplate: "沿用参考作品的极简线稿、克制留白和冷幽默，创作一个关于{{topic}}的冷笑话，用{{setup}}作为情境，最后通过{{punchline}}形成反转。",
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
      topicVariable,
      { key: "setup", label: "新情境", type: "short_text", required: true, maxLength: 50, placeholder: "发生在哪里、谁遇到了什么" },
      { key: "punchline", label: "新包袱", type: "short_text", required: true, maxLength: 60, placeholder: "双关、反差或最后揭示" },
    ] satisfies PatternVariable[],
  },
  "visual-metaphor-emotion": {
    name: "巨型隐喻 × 强情绪",
    description: "把现实困难转译成新的巨大视觉隐喻并重新构图",
    fillTemplate: "沿用参考作品的粗粝版画、高对比和空间压迫感，表现{{topic}}，让{{subject}}面对{{metaphor}}这一巨大视觉隐喻。",
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
      topicVariable,
      { key: "subject", label: "新主体", type: "short_text", required: true, maxLength: 40, placeholder: "例如：第一次创业的年轻人" },
      { key: "metaphor", label: "新隐喻", type: "short_text", required: true, maxLength: 50, placeholder: "例如：逐渐下沉的深海电梯" },
    ] satisfies PatternVariable[],
  },
  "collectible-checklist": {
    name: "高密度清单 × 收藏信息",
    description: "把新主题拆成层级清楚、值得收藏的信息视觉",
    fillTemplate: "沿用参考作品的明亮分区、清晰编号和收藏型排版，为{{audience}}制作一份关于{{topic}}的{{item_count}}项行动清单。",
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
      topicVariable,
      { key: "audience", label: "目标读者", type: "short_text", required: true, maxLength: 30, placeholder: "例如：刚入职的产品经理" },
      { key: "item_count", label: "清单项数", type: "number", required: true, min: 3, max: 9 },
    ] satisfies PatternVariable[],
  },
  "narrative-resonance": {
    name: "大留白 × 叙事共鸣",
    description: "用一个新的日常瞬间和克制文案建立情绪共鸣",
    fillTemplate: "沿用参考作品的柔和插画、大留白和克制情绪，围绕{{topic}}，描绘{{subject}}身处{{scene}}的日常瞬间。",
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
      topicVariable,
      { key: "subject", label: "新主体", type: "short_text", required: true, maxLength: 40, placeholder: "谁正在经历这个瞬间" },
      { key: "scene", label: "新场景", type: "short_text", required: true, maxLength: 50, placeholder: "这个瞬间发生在什么地方" },
    ] satisfies PatternVariable[],
  },
};

export const styleRecreationPatterns: StyleRecreationPattern[] = Object.entries(sourceCaseGroups).flatMap(
  ([familyId, caseIds]) => {
    const definition = familyDefinitions[familyId as keyof typeof familyDefinitions];
    return caseIds.map<StyleRecreationPattern>((sourceCaseId, index) => ({
      schemaVersion: "pattern/v1" as const,
      id: `${familyId}-${index + 1}`,
      version: 1,
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
