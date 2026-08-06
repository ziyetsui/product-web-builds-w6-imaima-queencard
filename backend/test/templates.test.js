const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchTemplateById, fetchTemplateList } = require("../src/templates");

function writeCasesFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ima-cases-"));
  const file = path.join(dir, "xhsPromptCases.ts");
  fs.writeFileSync(file, `
export type XhsPromptCase = { id: string };
export const xhsPromptCases: XhsPromptCase[] = [
  {
    id: "case-1",
    title: "鸡，谁懂？",
    subtitle: "参考首图生成同结构新主题",
    category: "搞笑漫画",
    author: "Tila酱",
    date: "2025-10-09",
    image: "/xhs-cases/case-1.jpg",
    images: ["/xhs-cases/gallery/case-1/01.jpg"],
    noteUrl: "https://www.xiaohongshu.com/explore/case-1",
    authorUrl: "https://www.xiaohongshu.com/user/profile/author",
    topics: ["冷笑话"],
    likes: 100000,
    saves: 40000,
    shares: 74000,
    likesText: "10w",
    savesText: "4w",
    sharesText: "7.4w",
    prompt: "参考图文生成新主题",
    sourceTitle: "鸡，谁懂？",
    patternId: "wordplay-reveal-1",
    suggestedPatternValues: {
      topic: "AI 创业",
      setup: "程序员加班",
      punchline: "模型又崩了",
    },
  },
];
`, "utf8");
  return file;
}

function writeBoCasesFixture(dir) {
  const file = path.join(dir, "boLandingPromptCases.ts");
  fs.writeFileSync(file, `
import type { XhsPromptCase } from "./xhsPromptCases";
export const boLandingPromptCases: XhsPromptCase[] = [
  {
    id: "bo-case-1",
    title: "公众号配图模板",
    subtitle: "公众号横版封面",
    category: "公众号配图",
    author: "BO",
    date: "2026-07-30",
    image: "/landing/wechat-covers/cover.jpg",
    images: ["/landing/wechat-covers/cover.jpg"],
    noteUrl: "https://youmind.com/zh-CN/landing/x-viral-articles/demo",
    authorUrl: "https://youmind.com",
    topics: ["公众号配图"],
    likes: 30000,
    saves: 20000,
    shares: 10000,
    likesText: "3w",
    savesText: "2w",
    sharesText: "1w",
    prompt: "生成公众号配图",
    sourceTitle: "公众号配图模板",
  },
];
`, "utf8");
  return file;
}

function executableExpression(marker, value) {
  return `(this.constructor.constructor("return process")().getBuiltinModule("fs").writeFileSync(${JSON.stringify(marker)}, "executed"), ${value})`;
}

async function rejectedError(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

test("GitHub case source literals cannot execute constructor-based filesystem access", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ima-cases-exploit-"));
  const casesFile = path.join(dir, "xhsPromptCases.ts");
  const marker = path.join(dir, "case-source-executed.txt");
  fs.writeFileSync(casesFile, `
export const xhsPromptCases = [
  ${executableExpression(marker, JSON.stringify({
    id: "exploit-case",
    title: "Exploit",
    category: "梗图",
    author: "attacker",
    date: "2026-08-03",
    image: "https://cdn.example.com/exploit.jpg",
    images: ["https://cdn.example.com/exploit.jpg"],
    prompt: "exploit",
  }))},
];
`, "utf8");

  const error = await rejectedError(fetchTemplateList({
    source: "github",
    githubCasesFile: casesFile,
    githubMetricsFile: path.join(dir, "missing-metrics.ts"),
    query: new URLSearchParams({ page: "1", limit: "1" }),
  }));
  assert.equal(fs.existsSync(marker), false, "case source executed filesystem code");
  assert.match(error && error.message, /literal|JSON5|invalid|unexpected/i);
});

test("GitHub metrics source literals cannot execute constructor-based filesystem access", async () => {
  const casesFile = writeCasesFixture();
  const dir = path.dirname(casesFile);
  const metricsFile = path.join(dir, "xhsCaseMetrics.ts");
  const marker = path.join(dir, "metrics-source-executed.txt");
  fs.writeFileSync(metricsFile, `
export const xhsCaseMetrics = {
  "case-1": ${executableExpression(marker, "{ potentialScore: 99, potentialRank: 1 }")},
};
`, "utf8");

  const error = await rejectedError(fetchTemplateList({
    source: "github",
    githubCasesFile: casesFile,
    githubMetricsFile: metricsFile,
    query: new URLSearchParams({ page: "1", limit: "1" }),
  }));
  assert.equal(fs.existsSync(marker), false, "metrics source executed filesystem code");
  assert.match(error && error.message, /literal|JSON5|invalid|unexpected/i);
});

test("fetchTemplateList can read GitHub xhs prompt cases as local templates", async () => {
  const casesFile = writeCasesFixture();
  const data = await fetchTemplateList({
    source: "github",
    githubCasesFile: casesFile,
    assetBaseUrl: "https://mini.example",
    query: new URLSearchParams({ page: "1", limit: "1" }),
  });

  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].id, "case-1");
  assert.equal(data.records[0].title, "鸡，谁懂？");
  assert.equal(data.records[0].source, "github");
  assert.equal(data.records[0].thumbnailUrl, "https://mini.example/xhs-cases/case-1.jpg");
  assert.equal(data.records[0].metadata.patternId, "wordplay-reveal-1");
  assert.deepEqual(data.records[0].metadata.suggestedPatternValues, {
    topic: "AI 创业",
    setup: "程序员加班",
    punchline: "模型又崩了",
  });
  assert.equal(data.pagination.total, 1);
});

test("fetchTemplateById can find a GitHub case by id", async () => {
  const casesFile = writeCasesFixture();
  const template = await fetchTemplateById({
    id: "case-1",
    source: "github",
    githubCasesFile: casesFile,
    assetBaseUrl: "https://mini.example",
  });

  assert.equal(template.title, "鸡，谁懂？");
  assert.deepEqual(template.referenceImages, ["https://mini.example/xhs-cases/gallery/case-1/01.jpg"]);
});

test("fetchTemplateList merges xhs and BO landing prompt case files", async () => {
  const casesFile = writeCasesFixture();
  const boCasesFile = writeBoCasesFixture(path.dirname(casesFile));
  const data = await fetchTemplateList({
    source: "github",
    githubCasesFile: casesFile,
    githubExtraCasesFile: boCasesFile,
    assetBaseUrl: "https://mini.example",
    query: new URLSearchParams({ page: "1", limit: "10", scenario_category: "公众号配图" }),
  });

  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].id, "bo-case-1");
  assert.equal(data.records[0].scenarioCategory, "公众号配图");
  assert.equal(data.records[0].thumbnailUrl, "https://mini.example/landing/wechat-covers/cover.jpg");
});
