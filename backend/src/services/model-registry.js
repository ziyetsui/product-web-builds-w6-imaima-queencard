const fs = require("node:fs");
const path = require("node:path");

function modelError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createModelRegistry(options = {}) {
  const source = options.models || JSON.parse(fs.readFileSync(
    options.path || path.resolve(__dirname, "../../config/models.json"),
    "utf8",
  ));
  const models = source.map((model) => ({
    ...model,
    aliases: Array.isArray(model.aliases) ? model.aliases : [],
    capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
    aspectRatios: Array.isArray(model.aspectRatios) ? model.aspectRatios : [],
    resolutions: Array.isArray(model.resolutions) ? model.resolutions : [],
    referenceLimits: { min: 0, max: 0, ...(model.referenceLimits || {}) },
  }));
  const byKey = new Map();
  for (const model of models) {
    byKey.set(model.key, model);
    for (const alias of model.aliases) byKey.set(alias, model);
  }

  function publicModels() {
    return models.filter((model) => model.enabled && model.verified).map((model) => clone(model));
  }

  function defaultModel() {
    const model = models.find((candidate) => candidate.key === "gpt-image-2" && candidate.enabled && candidate.verified);
    if (!model) throw modelError("No verified default image model is enabled", "MODEL_DEFAULT_UNAVAILABLE");
    return clone(model);
  }

  function resolve(value) {
    const key = String(value || "gpt-image-2").trim() || "gpt-image-2";
    const model = byKey.get(key);
    if (!model || !model.enabled || !model.verified) throw modelError("Image model is unavailable", "MODEL_UNAVAILABLE");
    return model;
  }

  function validate(input = {}) {
    const model = resolve(input.model);
    const capability = String(input.capability || "text-to-image");
    if (!model.capabilities.includes(capability)) throw modelError("Model does not support this generation capability", "MODEL_CAPABILITY_UNSUPPORTED");
    const assetReferences = Array.isArray(input.referenceAssetIds) ? input.referenceAssetIds : [];
    const references = assetReferences.length
      ? assetReferences
      : Array.isArray(input.referenceImages) ? input.referenceImages : [];
    const referenceCount = references.length;
    if (capability === "text-to-image" && referenceCount > 0) throw modelError("Text-to-image models do not accept references", "MODEL_REFERENCES_UNSUPPORTED");
    if (capability !== "text-to-image" && referenceCount < 1) throw modelError("This model mode requires a reference image", "MODEL_REFERENCES_UNSUPPORTED");
    if (referenceCount < model.referenceLimits.min || referenceCount > model.referenceLimits.max) {
      throw modelError("Model does not support this reference image count", "MODEL_REFERENCES_UNSUPPORTED");
    }
    const aspectRatio = String(input.aspectRatio || "1:1");
    if (!model.aspectRatios.includes(aspectRatio)) throw modelError("Model does not support this aspect ratio", "MODEL_ASPECT_RATIO_UNSUPPORTED");
    const resolution = String(input.resolution || model.resolutions[0]);
    if (!model.resolutions.includes(resolution)) throw modelError("Model does not support this resolution", "MODEL_RESOLUTION_UNSUPPORTED");
    const outputCount = Number(input.outputCount || input.outputNumber || 1);
    if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > model.outputLimit) throw modelError("Model output count exceeds its limit", "MODEL_OUTPUT_LIMIT_EXCEEDED");
    return {
      model: clone(model),
      modelKey: model.key,
      capability,
      referenceCount,
      aspectRatio,
      resolution,
      outputCount,
      requestedCredits: outputCount * Number(model.estimatedCredits),
    };
  }

  function estimate(input = {}) {
    const validation = validate(input);
    return { model: validation.modelKey, outputCount: validation.outputCount, requestedCredits: validation.requestedCredits };
  }

  return {
    listPublic: publicModels,
    defaultModel,
    resolve,
    validate,
    estimate,
  };
}

module.exports = {
  createModelRegistry,
};
