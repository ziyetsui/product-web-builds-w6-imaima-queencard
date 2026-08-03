const assert = require("node:assert/strict");
const test = require("node:test");

const { createMemoryStore } = require("../src/store");
const { createGenerationService } = require("../src/services/generation-service");
const { createGenerationWorker } = require("../src/worker/generation-worker");
const { createCreditService } = require("../src/services/credit-service");
const { createModelRegistry } = require("../src/services/model-registry");

function dataImage() {
  return "data:image/png;base64," + Buffer.from("generated-image").toString("base64");
}

test("worker claims leased tasks, persists outputs before settlement, and charges actual outputs once", async () => {
  const store = createMemoryStore({ initialCredits: 5 });
  const user = store.ensureUser({ appid: "wx-test", openid: "worker-user" });
  const provider = {
    name: "test-provider",
    async generate() {
      return { status: "completed", provider: "test-provider", images: [dataImage(), dataImage()] };
    },
  };
  const generation = createGenerationService({ store, registry: createModelRegistry(), creditService: createCreditService({ store }) });
  const submitted = await generation.submit({
    ownerId: user.id,
    idempotencyKey: "worker-submit-1",
    model: "gpt-image-2",
    capability: "text-to-image",
    prompt: "A lemon card",
    outputCount: 2,
  });
  const worker = createGenerationWorker({ store, provider, generation, registry: createModelRegistry(), workerId: "worker-a", now: () => 1000, leaseDurationMs: 5000 });
  await worker.runOnce();
  const task = await store.getTask(submitted.task.id);
  assert.equal(task.status, "completed");
  assert.equal(task.images.length, 2);
  assert.equal(task.settledCredits, 2);
  assert.equal((await store.getUser(user.id)).balance, 3);
  assert.equal((await worker.runOnce()), null);
});

test("worker persists retry timing and releases credits after permanent provider failure", async () => {
  const store = createMemoryStore({ initialCredits: 3 });
  const user = store.ensureUser({ appid: "wx-test", openid: "failure-user" });
  const generation = createGenerationService({ store, registry: createModelRegistry(), creditService: createCreditService({ store }) });
  const submitted = await generation.submit({
    ownerId: user.id,
    idempotencyKey: "failure-submit-1",
    model: "gpt-image-2",
    capability: "text-to-image",
    prompt: "A failing card",
    outputCount: 2,
  });
  const provider = {
    name: "failing-provider",
    async generate() {
      const error = new Error("provider rejected request");
      error.code = "UPSTREAM_REJECTED";
      error.retryable = false;
      throw error;
    },
  };
  const worker = createGenerationWorker({ store, provider, generation, registry: createModelRegistry(), workerId: "worker-b", now: () => 1000, maxAttempts: 1 });
  await worker.runOnce();
  const task = await store.getTask(submitted.task.id);
  assert.equal(task.status, "failed");
  assert.equal(task.errorCode, "UPSTREAM_REJECTED");
  assert.equal((await store.getUser(user.id)).balance, 3);
});
