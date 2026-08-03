const crypto = require("node:crypto");

function createGenerationService(options = {}) {
  const store = options.store;
  const registry = options.registry;
  const creditService = options.creditService;

  async function submit(input = {}) {
    const validation = registry.validate({
      model: input.model,
      capability: input.capability,
      referenceAssetIds: input.referenceAssetIds || [],
      referenceImages: input.referenceImages || [],
      aspectRatio: input.aspectRatio || "1:1",
      resolution: input.resolution || "1k",
      outputCount: input.outputCount || 1,
    });
    const idempotencyKey = String(input.idempotencyKey || "").trim() || `generated-${crypto.randomUUID()}`;
    const taskId = input.taskId || `task_${crypto.randomUUID()}`;
    const requestedModel = String(input.model || validation.modelKey);
    const metadata = {
      request: {
        prompt: String(input.prompt || ""),
        topic: String(input.topic || ""),
        capability: validation.capability,
        model: requestedModel,
        referenceAssetIds: Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds : [],
        referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : [],
        aspectRatio: validation.aspectRatio,
        resolution: validation.resolution,
        outputCount: validation.outputCount,
        templateId: input.templateId || "custom",
        previewUrl: input.previewUrl || "",
      },
      providerPollCursor: null,
    };
    const task = {
      id: taskId,
      ownerId: input.ownerId,
      idempotencyKey,
      status: "pending",
      images: [],
      templateId: input.templateId || "custom",
      provider: options.providerName || validation.model.provider,
      providerTaskId: "",
      mode: validation.capability,
      prompt: String(input.prompt || ""),
      topic: String(input.topic || ""),
      referenceImages: Array.isArray(input.referenceAssetIds) && input.referenceAssetIds.length
        ? input.referenceAssetIds
        : Array.isArray(input.referenceImages) ? input.referenceImages : [],
      referenceAssetIds: Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds : [],
      model: requestedModel,
      outputCount: validation.outputCount,
      aspectRatio: validation.aspectRatio,
      resolution: validation.resolution,
      requestedCredits: validation.requestedCredits,
      settledCredits: 0,
      metadata,
    };
    if (typeof store.createTaskWithCreditHold !== "function") throw new Error("Store does not support atomic generation submission");
    const result = await store.createTaskWithCreditHold({
      task,
      hold: {
        id: `hold_${crypto.randomUUID()}`,
        userId: input.ownerId,
        taskId,
        idempotencyKey,
        credits: validation.requestedCredits,
      },
    });
    return {
      task: result.task,
      hold: result.hold,
      created: result.created !== false,
      validation,
    };
  }

  async function settle(task, actualCredits, input = {}) {
    const settled = await creditService.settle(task.creditHoldId, actualCredits, {
      taskId: task.id,
      reason: input.reason || `generation:${task.id}`,
    });
    await store.updateTask(task.id, { settledCredits: Number(actualCredits) });
    return settled;
  }

  async function release(task) {
    return creditService.release(task.creditHoldId);
  }

  return { submit, settle, release };
}

module.exports = {
  createGenerationService,
};
