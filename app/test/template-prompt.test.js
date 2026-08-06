const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseTemplatePrompt,
  renderTemplatePrompt,
} = require("../services/template-prompt.js");
const generation = require("../services/generation.js");
const templatePattern = require("../services/template-pattern.js");

test("parses the same category, title, and subtitle blocks exposed by Web prompt preview", () => {
  const prompt = "参考图文的留白比例，生成一组新的情绪疗愈主题：标题《7个慢慢养回自己的动作》，副标题“低谷期也能照着做的清单”。请输出封面和内容卡。";

  assert.deepEqual(parseTemplatePrompt(prompt).slots, [
    { key: "category", label: "主题方向", value: "情绪疗愈", kind: "category" },
    { key: "title", label: "标题", value: "7个慢慢养回自己的动作", kind: "title" },
    { key: "subtitle", label: "副标题", value: "低谷期也能照着做的清单", kind: "subtitle" },
  ]);
});

test("renders edited fixed-block values back into the exact prompt sent downstream", () => {
  const prompt = "生成一组新的【情绪疗愈】主题：标题《旧标题》，副标题“旧副标题”。请输出封面。";

  const rendered = renderTemplatePrompt(prompt, {
    category: "成长自律",
    title: "新标题",
    subtitle: "新副标题",
  });

  assert.equal(
    rendered,
    "生成一组新的【成长自律】主题：标题《新标题》，副标题“新副标题”。请输出封面。",
  );
});

test("supports Web-style multiline title and subtitle blocks", () => {
  const prompt = "生成一组新的【梗图】主题\n标题：\n旧标题\n副标题：\n旧副标题\n请保持原图节奏。";

  assert.equal(
    renderTemplatePrompt(prompt, { title: "新标题", subtitle: "新副标题" }),
    "生成一组新的【梗图】主题\n标题：\n新标题\n副标题：\n新副标题\n请保持原图节奏。",
  );
});

test("renders generic double-brace slots and leaves prompts without slots unchanged", () => {
  const prompt = "生成一张{{主题}}海报，主色为{{颜色}}。";

  assert.equal(
    renderTemplatePrompt(prompt, { "slot-1": "咖啡店开业", "slot-2": "明黄色" }),
    "生成一张咖啡店开业海报，主色为明黄色。",
  );
  assert.equal(renderTemplatePrompt("没有可填词槽的固定提示词。", {}), "没有可填词槽的固定提示词。");
});

test("builds the generation payload with the rendered prompt rather than the stored template prompt", () => {
  const renderedPrompt = "生成一组新的【成长自律】主题：标题《新标题》，副标题“新副标题”。";
  const request = generation.buildGenerationRequest({
    source: "wechat-miniapp",
    capability: "text-to-image",
    prompt: renderedPrompt,
    topic: "成长自律",
    templateId: "template-1",
    availableModels: [{ value: "gpt-image-2" }],
    modelIndex: 0,
    outputCounts: [1],
    countIndex: 0,
  });

  assert.equal(request.prompt, renderedPrompt);
  assert.equal(request.templateId, "template-1");
});

test("maps a Web Pattern binding to blue visual and yellow content slots", () => {
  const pattern = templatePattern.getPatternForTemplate({
    scenarioCategory: "搞笑漫画",
    metadata: { patternId: "wordplay-reveal-1", suggestedPatternValues: {
      topic: "AI 创业",
      setup: "程序员加班",
      punchline: "模型又崩了",
    } },
  });
  const values = templatePattern.getSuggestedValues({
    metadata: { patternId: "wordplay-reveal-1", suggestedPatternValues: {
      topic: "AI 创业",
      setup: "程序员加班",
      punchline: "模型又崩了",
    } },
  }, pattern);
  const slots = templatePattern.buildPatternSlots(pattern, values);

  assert.deepEqual(slots.map((slot) => [slot.key, slot.kind]), [
    ["visual_style", "visual_style"],
    ["topic", "content"],
    ["setup", "content"],
    ["punchline", "content"],
  ]);
  assert.equal(templatePattern.renderPatternTemplate(pattern, {
    visual_style: "极简线稿",
    topic: "AI 创业",
    setup: "程序员加班",
    punchline: "模型又崩了",
  }), "沿用参考作品的极简线稿，创作一个关于AI 创业的冷笑话，用程序员加班作为情境，最后通过模型又崩了形成反转。");
});

test("compiles the Pattern values into the Web-compatible downstream prompt", () => {
  const pattern = templatePattern.getPatternForTemplate({ scenarioCategory: "梗图", metadata: {} });
  const compiled = templatePattern.compilePatternPrompt(pattern, {
    visual_style: "大字标题、强对比和直接笑点",
    topic: "AI 日常",
    setup: "周一早会",
    punchline: "大家都在等模型回复",
  });

  assert.match(compiled, /【创作任务】/);
  assert.match(compiled, /【继承的视觉语言】/);
  assert.match(compiled, /视觉风格（用户指定，优先）：大字标题、强对比和直接笑点/);
  assert.match(compiled, /AI 日常/);
  assert.match(compiled, /中等面积留白/);
  assert.match(compiled, /不得保留原主题/);
});

test("derives social series suggestions from the Web case direction", () => {
  const pattern = templatePattern.getPatternForTemplate({ scenarioCategory: "爆款图文", metadata: {} });
  const values = templatePattern.getSuggestedValues({
    subtitle: "健康实操",
    metadata: {},
  }, pattern);

  assert.equal(values.topic, "久坐人群的日常恢复");
  assert.equal(values.visual_style, "步骤编号、强层级和教程感");
  assert.equal(values.headline, "久坐人群的日常恢复，从这一步开始");
});
