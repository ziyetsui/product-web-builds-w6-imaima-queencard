const assert = require("node:assert/strict");
const test = require("node:test");

const { createMemoryStore } = require("../src/store");
const { createCreditService } = require("../src/services/credit-service");

test("credit service creates idempotent holds, settles once, and releases residual credits", async () => {
  const store = createMemoryStore({ initialCredits: 5 });
  const user = store.ensureUser({ appid: "wx-test", openid: "credit-user" });
  const credits = createCreditService({ store });

  const first = await credits.hold({
    id: "hold-1",
    userId: user.id,
    taskId: "task-1",
    idempotencyKey: "submit-1",
    credits: 3,
  });
  const replay = await credits.hold({
    id: "hold-retry",
    userId: user.id,
    taskId: "task-1",
    idempotencyKey: "submit-1",
    credits: 3,
  });
  assert.equal(replay.id, first.id);
  assert.equal((await store.getUser(user.id)).balance, 2);

  const settled = await credits.settle(first.id, 2, { taskId: "task-1" });
  assert.equal(settled.status, "SETTLED");
  assert.equal(settled.settledCredits, 2);
  assert.equal((await store.getUser(user.id)).balance, 3);
  assert.equal((await credits.settle(first.id, 2, { taskId: "task-1" })).status, "SETTLED");
  assert.equal((await credits.release(first.id)).status, "SETTLED");
});

test("concurrent holds cannot overspend a durable user balance", async () => {
  const store = createMemoryStore({ initialCredits: 2 });
  const user = store.ensureUser({ appid: "wx-test", openid: "concurrent-credit-user" });
  const credits = createCreditService({ store });
  const results = await Promise.allSettled([
    credits.hold({ userId: user.id, taskId: "task-a", idempotencyKey: "submit-a", credits: 2 }),
    credits.hold({ userId: user.id, taskId: "task-b", idempotencyKey: "submit-b", credits: 2 }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await store.getUser(user.id)).balance, 0);
});
