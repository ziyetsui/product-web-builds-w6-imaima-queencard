const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createSqliteStore } = require("../src/store");

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ima-db-")), "miniapp.sqlite");
}

const identity = {
  sub: "wechat:wx-test:openid-1",
  appid: "wx-test",
  openid: "openid-1",
};

test("sqlite store persists users, credit charges, and generation tasks", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  const user = store.ensureUser(identity);
  assert.equal(user.balance, 10);
  assert.equal(store.charge(user.id, 1, "template:case-1"), 9);
  store.createTask({
    id: "task-1",
    taskId: "task-1",
    ownerId: user.id,
    status: "completed",
    images: ["https://cdn.example.com/result.jpg"],
    templateId: "case-1",
    provider: "preview",
    mode: "preview",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  store.close();

  const reopened = createSqliteStore({ dbPath, initialCredits: 10 });
  assert.equal(reopened.getUser(user.id).balance, 9);
  assert.deepEqual(reopened.getTask("task-1").images, ["https://cdn.example.com/result.jpg"]);
  assert.equal(reopened.listCreditTransactions(user.id).records.length, 1);
  reopened.close();
});

test("sqlite store syncs and pages templates", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  const synced = store.syncTemplates([
    {
      id: "case-1",
      title: "鸡，谁懂？",
      category: "image",
      scenarioCategory: "搞笑漫画",
      source: "github",
      thumbnailUrl: "http://127.0.0.1:8787/xhs-cases/case-1.jpg",
      previewUrl: "http://127.0.0.1:8787/xhs-cases/case-1.jpg",
      referenceImages: ["http://127.0.0.1:8787/xhs-cases/gallery/case-1/01.jpg"],
      prompt: "参考图文生成新主题",
      seed: { templateId: "case-1" },
    },
    {
      id: "case-2",
      title: "腿记",
      category: "image",
      scenarioCategory: "搞笑漫画",
      source: "github",
      thumbnailUrl: "http://127.0.0.1:8787/xhs-cases/case-2.jpg",
      previewUrl: "http://127.0.0.1:8787/xhs-cases/case-2.jpg",
      referenceImages: [],
      prompt: "参考另一篇图文生成新主题",
      seed: { templateId: "case-2" },
    },
  ]);

  const page = store.listTemplates(new URLSearchParams({ page: "1", limit: "1", q: "鸡" }));
  assert.equal(synced, 2);
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0].id, "case-1");
  assert.equal(page.pagination.total, 1);
  assert.equal(store.getTemplate("case-2").title, "腿记");
  store.close();
});

test("sqlite store filters and sorts templates like the web prompt library", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  store.syncTemplates([
    {
      id: "case-low",
      title: "低热度",
      category: "image",
      scenarioCategory: "清单种草",
      source: "github",
      metrics: { likes: 1000, saves: 900, shares: 600, potentialScore: 99, potentialRank: 1 },
    },
    {
      id: "case-like",
      title: "高赞",
      category: "image",
      scenarioCategory: "搞笑漫画",
      source: "github",
      metrics: { likes: 30000, saves: 1000, shares: 200, potentialScore: 60, potentialRank: 3 },
    },
    {
      id: "case-save",
      title: "高收藏",
      category: "image",
      scenarioCategory: "清单种草",
      source: "github",
      metrics: { likes: 8000, saves: 22000, shares: 30000, potentialScore: 80, potentialRank: 2 },
    },
  ]);

  const hot = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", hot: "1", sort: "heat" }));
  assert.deepEqual(hot.records.map((record) => record.id), ["case-like", "case-save"]);

  const category = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", scenario_category: "清单种草", sort: "heat" }));
  assert.deepEqual(category.records.map((record) => record.id), ["case-save", "case-low"]);

  const saves = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", sort: "saves" }));
  assert.deepEqual(saves.records.map((record) => record.id), ["case-save", "case-like", "case-low"]);

  const shares = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", sort: "shares" }));
  assert.deepEqual(shares.records.map((record) => record.id), ["case-save", "case-low", "case-like"]);

  const potential = store.listTemplates(new URLSearchParams({ page: "1", limit: "10", sort: "potential" }));
  assert.deepEqual(potential.records.map((record) => record.id), ["case-low", "case-save", "case-like"]);
  store.close();
});

test("sqlite store persists and filters generation task history", () => {
  const dbPath = tempDbPath();
  const store = createSqliteStore({ dbPath, initialCredits: 10 });
  const user = store.ensureUser(identity);
  store.createTask({
    id: "task-history-1",
    ownerId: user.id,
    status: "completed",
    images: ["https://cdn.example.com/history-1.jpg"],
    templateId: "tpl-queen",
    provider: "preview",
    prompt: "Create a lemon queen card",
    topic: "Lemon queen",
    referenceImages: ["https://cdn.example.com/reference.jpg"],
    model: "gpt-image-2-edit",
    outputCount: 2,
    aspectRatio: "1:1",
    resolution: "1024x1024",
    createdAt: "2026-07-28T00:00:00.000Z",
  });
  store.createTask({
    id: "task-history-2",
    ownerId: user.id,
    status: "failed",
    images: [],
    templateId: "tpl-other",
    provider: "preview",
    prompt: "Create a pumpkin poster",
    topic: "Pumpkin poster",
    referenceImages: [],
    model: "preview",
    outputCount: 1,
    aspectRatio: "3:4",
    resolution: "768x1024",
    createdAt: "2026-07-28T00:01:00.000Z",
  });
  store.close();

  const reopened = createSqliteStore({ dbPath, initialCredits: 10 });
  const promptMatches = reopened.listTasks(user.id, new URLSearchParams({ q: "lemon", status: "completed" }));
  assert.equal(promptMatches.pagination.total, 1);
  assert.equal(promptMatches.records[0].id, "task-history-1");
  assert.equal(promptMatches.records[0].prompt, "Create a lemon queen card");
  assert.deepEqual(promptMatches.records[0].referenceImages, ["https://cdn.example.com/reference.jpg"]);
  assert.equal(promptMatches.records[0].model, "gpt-image-2-edit");
  assert.equal(promptMatches.records[0].outputCount, 2);
  assert.equal(promptMatches.records[0].aspectRatio, "1:1");
  assert.equal(promptMatches.records[0].resolution, "1024x1024");

  const modelMatches = reopened.listTasks(user.id, new URLSearchParams({ q: "gpt-image-2-edit" }));
  assert.equal(modelMatches.pagination.total, 1);

  const templateMatches = reopened.listTasks(user.id, new URLSearchParams({ q: "tpl-other" }));
  assert.equal(templateMatches.pagination.total, 1);
  assert.equal(templateMatches.records[0].id, "task-history-2");

  const firstPage = reopened.listTasks(user.id, new URLSearchParams({ page: "1", limit: "1" }));
  assert.equal(firstPage.records.length, 1);
  assert.equal(firstPage.records[0].id, "task-history-2");
  assert.equal(firstPage.pagination.total, 2);
  assert.equal(firstPage.pagination.totalPages, 2);
  reopened.close();
});
