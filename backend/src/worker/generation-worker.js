function createGenerationWorker(options = {}) {
  const store = options.store;
  const provider = options.provider;
  const generation = options.generation;
  const registry = options.registry;
  const assetService = options.assetService || null;
  const workerId = options.workerId || `generation-worker-${process.pid}`;
  const leaseDurationMs = Number(options.leaseDurationMs || 60000);
  const pollIntervalMs = Number(options.pollIntervalMs || 1000);
  const maxAttempts = Number(options.maxAttempts || 3);
  const backoffBaseMs = Number(options.backoffBaseMs || 1000);
  const backoffCapMs = Number(options.backoffCapMs || 30000);
  const nowInput = options.now || (() => Date.now());
  const sleepClock = options.setInterval || setInterval;
  const clearClock = options.clearInterval || clearInterval;
  let timer = null;
  let scheduled = false;

  function nowDate() {
    const value = typeof nowInput === "function" ? nowInput() : nowInput;
    return value instanceof Date ? value : new Date(value);
  }

  function retryDelay(attempt) {
    return Math.min(backoffCapMs, backoffBaseMs * (2 ** Math.max(0, Number(attempt || 1) - 1)));
  }

  async function providerInput(task) {
    const request = task.metadata?.request || {};
    const referenceAssetIds = task.referenceAssetIds || [];
    const referenceImages = referenceAssetIds.length && assetService?.resolveReferenceUrls
      ? await assetService.resolveReferenceUrls(task.ownerId, referenceAssetIds, { expiresInSeconds: 300 })
      : referenceAssetIds.length ? referenceAssetIds : task.referenceImages || [];
    return {
      template: {
        id: task.templateId || "custom",
        prompt: task.prompt || "",
        referenceImages: [],
        previewUrl: request.previewUrl || "",
      },
      model: registry.resolve(task.model),
      prompt: task.prompt,
      referenceImages,
      outputNumber: task.outputCount,
      user: { id: task.ownerId },
      request: {
        ...request,
        model: task.model,
        aspectRatio: task.aspectRatio,
        resolution: task.resolution,
        providerTaskId: task.providerTaskId || "",
        pollCursor: task.metadata?.providerPollCursor || null,
      },
    };
  }

  async function persistOutputs(task, images, input) {
    if (assetService) return assetService.persistGeneratedOutputs({
      taskId: task.id,
      userId: task.ownerId,
      images,
    });
    const records = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = typeof images[index] === "string" ? images[index] : images[index]?.url || "";
      records.push(await store.createGeneratedAsset({
        id: `asset_${task.id}_${index}`,
        taskId: task.id,
        userId: task.ownerId,
        outputIndex: index,
        objectKey: `generated/${task.id}/${index}`,
        providerUrl: image,
        mimeType: "image/png",
        metadata: { source: "worker-test-or-injected-provider" },
      }));
    }
    return records;
  }

  async function processTask(task) {
    const heartbeat = sleepClock(() => {
      void store.renewTaskLease(task.id, workerId, { leaseDurationMs });
    }, Math.max(100, Math.floor(leaseDurationMs / 3)));
    try {
      await store.updateTask(task.id, { status: "processing" });
      const input = await providerInput(task);
      const result = task.providerTaskId && typeof provider.poll === "function"
        ? await provider.poll({ ...input, providerTaskId: task.providerTaskId, pollCursor: task.metadata?.providerPollCursor })
        : await provider.generate(input);
      const images = Array.isArray(result.images) ? result.images : [];
      const pending = ["pending", "processing", "queued", "running"].includes(String(result.status || "").toLowerCase()) && images.length === 0;
      if (pending) {
        await store.updateTask(task.id, {
          status: "retryable",
          providerTaskId: result.providerTaskId || task.providerTaskId || "",
          rawProviderResult: result.raw || null,
          metadata: { ...(task.metadata || {}), providerPollCursor: result.pollCursor || result.raw?.cursor || null },
          nextAttemptAt: new Date(nowDate().getTime() + pollIntervalMs).toISOString(),
        });
        return store.releaseTaskLease(task.id, workerId, { status: "retryable" });
      }
      const assets = await persistOutputs(task, images, input);
      const outputItems = assets.map((asset) => ({ assetId: asset.id, url: asset.providerUrl || "" }));
      await store.updateTask(task.id, {
        images: outputItems,
        provider: result.provider || task.provider,
        providerTaskId: result.providerTaskId || task.providerTaskId || "",
        rawProviderResult: result.raw || null,
        status: "processing",
      });
      await generation.settle(task, Number(result.actualCredits ?? assets.length), { reason: `generation:${task.id}` });
      return store.releaseTaskLease(task.id, workerId, { status: "completed" });
    } catch (error) {
      const retryable = error.retryable !== false && Number(task.attempt || 0) < maxAttempts;
      const errorCode = error.code || "GENERATION_PROVIDER_ERROR";
      const errorMessage = error.publicMessage || error.message || "Generation failed";
      if (retryable) {
        await store.updateTask(task.id, {
          status: "retryable",
          errorCode,
          errorMessage,
          nextAttemptAt: new Date(nowDate().getTime() + retryDelay(task.attempt)).toISOString(),
          rawProviderResult: error.details || null,
        });
        return store.releaseTaskLease(task.id, workerId, { status: "retryable", errorCode, errorMessage });
      }
      await generation.release(task);
      await store.updateTask(task.id, { status: "failed", errorCode, errorMessage, rawProviderResult: error.details || null });
      return store.releaseTaskLease(task.id, workerId, { status: "failed", errorCode, errorMessage });
    } finally {
      clearClock(heartbeat);
    }
  }

  async function runOnce() {
    await store.reclaimExpiredTasks(nowDate());
    const task = await store.claimTask(workerId, { leaseDurationMs, now: nowDate() });
    if (!task) return null;
    return processTask(task);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void runOnce().catch(() => {});
    });
  }

  function start() {
    if (timer) return;
    timer = sleepClock(() => { void runOnce().catch(() => {}); }, Math.max(25, pollIntervalMs));
  }

  function stop() {
    if (timer) clearClock(timer);
    timer = null;
  }

  return { runOnce, schedule, start, stop, processTask };
}

module.exports = {
  createGenerationWorker,
};
