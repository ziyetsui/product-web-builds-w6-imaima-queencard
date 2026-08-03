const assert = require("node:assert/strict");
const test = require("node:test");

const { createModelRegistry } = require("../src/services/model-registry");

test("authoritative registry exposes enabled models with GPT Image 2 as default", () => {
  const registry = createModelRegistry();
  const models = registry.listPublic();
  assert.equal(registry.defaultModel().key, "gpt-image-2");
  assert.deepEqual(models.map((model) => model.key), [
    "gpt-image-2",
    "gemini-3.1-flash-image-preview",
    "seedream-5.0",
    "doubao-seedream-5.0",
    "vidu-q2",
  ]);
  for (const model of models) {
    assert.equal(model.enabled, true);
    assert.equal(model.verified, true);
    assert.ok(model.provider);
    assert.ok(model.providerModelId);
    assert.ok(model.capabilities.length);
    assert.ok(model.referenceLimits);
    assert.ok(model.aspectRatios.length);
    assert.ok(model.resolutions.length);
    assert.ok(model.outputLimit > 0);
    assert.ok(model.estimatedCredits > 0);
    assert.ok(model.timeoutMs > 0);
    assert.ok(model.retryPolicy);
  }
});

test("registry rejects unsupported model combinations before providers are called", () => {
  const registry = createModelRegistry();
  assert.throws(
    () => registry.validate({ model: "gpt-image-2", capability: "text-to-image", referenceAssetIds: ["asset-1"], outputCount: 1 }),
    (error) => error.code === "MODEL_REFERENCES_UNSUPPORTED",
  );
  assert.throws(
    () => registry.validate({ model: "gpt-image-2", capability: "text-to-image", aspectRatio: "5:7", outputCount: 1 }),
    (error) => error.code === "MODEL_ASPECT_RATIO_UNSUPPORTED",
  );
  assert.throws(
    () => registry.validate({ model: "vidu-q2", capability: "text-to-image", outputCount: 99 }),
    (error) => error.code === "MODEL_OUTPUT_LIMIT_EXCEEDED",
  );
  assert.deepEqual(registry.estimate({ model: "gpt-image-2", capability: "text-to-image", outputCount: 3 }), {
    model: "gpt-image-2",
    outputCount: 3,
    requestedCredits: 3,
  });
});
