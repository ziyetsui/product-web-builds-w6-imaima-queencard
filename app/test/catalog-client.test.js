const assert = require("node:assert/strict");
const test = require("node:test");

const servicePath = require.resolve("../services/templates.js");
const apiPath = require.resolve("../services/api.js");
const sessionPath = require.resolve("../services/session.js");
const env = require("../config/env.js");

function createWxHarness() {
  const storage = new Map();
  const requests = [];
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    request(options) {
      requests.push(options);
      return { abort() { options.aborted = true; } };
    },
  };
  return { requests, storage };
}

function unload() {
  for (const modulePath of [servicePath, apiPath, sessionPath]) delete require.cache[modulePath];
  delete global.wx;
}

test("template client ignores stale responses and stores pages under the returned catalog version", async () => {
  const harness = createWxHarness();
  try {
    const service = require(servicePath);
    const first = service.listTemplates({ page: 1, limit: 2, sort: "default" });
    const second = service.listTemplates({ page: 1, limit: 2, sort: "default" });
    assert.equal(harness.requests.length, 2);
    harness.requests[1].success({
      statusCode: 200,
      data: { success: true, data: {
        catalogVersion: "catalog-v2",
        records: [{ id: "new" }],
        categories: [],
        pagination: { page: 1, total: 1, totalPages: 1 },
      } },
    });
    assert.deepEqual((await second).records.map((record) => record.id), ["new"]);
    harness.requests[0].success({
      statusCode: 200,
      data: { success: true, data: {
        catalogVersion: "catalog-v1",
        records: [{ id: "old" }],
        categories: [],
        pagination: { page: 1, total: 1, totalPages: 1 },
      } },
    });
    await assert.rejects(first, (error) => error && error.stale === true);
    assert.equal(harness.storage.get("ima_queencard_catalog_cache_v1").catalogVersion, "catalog-v2");
  } finally {
    unload();
  }
});

test("template client aborts the previous request when explicitly cancelled", () => {
  const harness = createWxHarness();
  try {
    const service = require(servicePath);
    service.listTemplates({ page: 1 });
    service.cancelPending();
    assert.equal(harness.requests[0].aborted, true);
  } finally {
    unload();
  }
});

test("template client keeps normalized server catalog fields", async () => {
  const harness = createWxHarness();
  try {
    const service = require(servicePath);
    const pending = service.listTemplates({ page: 1 });
    harness.requests[0].success({
      statusCode: 200,
      data: { success: true, data: {
        catalogVersion: "catalog-v3",
        records: [{
          id: "server-record",
          title: "服务端标题",
          subtitle: "服务端副标题",
          category: "梗图",
          author: "作者",
          thumbnailUrl: "https://cdn.example.com/cover.jpg",
          referenceImages: ["https://cdn.example.com/cover.jpg"],
          previewImages: ["https://cdn.example.com/cover.jpg"],
          metadata: {
            sourceTitle: "服务端标题",
            authorUrl: "https://example.com/author",
            patternId: "library-meme-series",
            suggestedPatternValues: { topic: "AI 日常" },
            likesText: "1w",
            savesText: "2k",
            sharesText: "300",
          },
        }],
        pagination: { page: 1, total: 1, totalPages: 1 },
      } },
    });
    const result = await pending;
    assert.equal(result.records[0].title, "服务端标题");
    assert.equal(result.records[0].thumbnailUrl, "https://cdn.example.com/cover.jpg");
    assert.equal(result.records[0].category, "梗图");
    assert.equal(result.records[0].metadata.patternId, "library-meme-series");
    assert.equal(result.records[0].metadata.suggestedPatternValues.topic, "AI 日常");
  } finally {
    unload();
  }
});

test("public fallback retains and aborts its wx.request task", { concurrency: false }, async () => {
  const originalApiBaseUrl = env.API_BASE_URL;
  const originalTemplateApiBaseUrl = env.TEMPLATE_API_BASE_URL;
  env.API_BASE_URL = "";
  env.TEMPLATE_API_BASE_URL = "https://templates.example.com";
  const harness = createWxHarness();
  try {
    const service = require(servicePath);
    const pending = service.listTemplates({ page: 1 });
    assert.equal(harness.requests.length, 1);
    service.cancelPending();
    assert.equal(harness.requests[0].aborted, true);
    harness.requests[0].fail({ errMsg: "request:fail abort" });
    await assert.rejects(pending, (error) => error && error.stale === true);
  } finally {
    env.API_BASE_URL = originalApiBaseUrl;
    env.TEMPLATE_API_BASE_URL = originalTemplateApiBaseUrl;
    unload();
  }
});

test("legacy public records expose preview images for fixed prompt blocks", { concurrency: false }, async () => {
  const originalApiBaseUrl = env.API_BASE_URL;
  const originalTemplateApiBaseUrl = env.TEMPLATE_API_BASE_URL;
  env.API_BASE_URL = "";
  env.TEMPLATE_API_BASE_URL = "https://templates.example.com";
  const harness = createWxHarness();
  try {
    const service = require(servicePath);
    const pending = service.listTemplates({ page: 1 });
    harness.requests[0].success({
      statusCode: 200,
      data: { success: true, data: {
        catalogVersion: "catalog-legacy",
        records: [{
          id: "legacy-record",
          name: "旧格式模板",
          work_url: "https://cdn.example.com/legacy.jpg",
          condition_prompt: "生成一组新的【搞笑漫画】主题",
        }],
        pagination: { page: 1, total: 1, totalPages: 1 },
      } },
    });
    const result = await pending;
    assert.deepEqual(result.records[0].previewImages, ["https://cdn.example.com/legacy.jpg"]);
    assert.deepEqual(result.records[0].referenceImages, ["https://cdn.example.com/legacy.jpg"]);
  } finally {
    env.API_BASE_URL = originalApiBaseUrl;
    env.TEMPLATE_API_BASE_URL = originalTemplateApiBaseUrl;
    unload();
  }
});
