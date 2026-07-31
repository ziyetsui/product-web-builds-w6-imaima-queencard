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
