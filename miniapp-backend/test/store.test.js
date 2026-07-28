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
  assert.equal(reopened.listCreditTransactions(user.id).length, 1);
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
