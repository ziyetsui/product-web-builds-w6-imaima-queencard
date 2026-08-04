var api = require("./api.js");

var DEFAULT_REFERENCE_LIMIT = 3;
var TERMINAL_STATUSES = ["completed", "succeeded", "success", "failed", "error", "canceled", "cancelled"];

function parseMaybeJson(value, fallback) {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function asArray(value) {
  var parsed = null;
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    parsed = parseMaybeJson(value, null);
    if (Array.isArray(parsed)) return parsed;
    return [value];
  }
  return [value];
}

function uniqueStrings(values, limit) {
  var result = [];
  var seen = {};
  var source = asArray(values);
  var i = 0;
  var value = "";
  for (i = 0; i < source.length; i += 1) {
    value = String(source[i] || "");
    if (!value || seen[value]) continue;
    seen[value] = true;
    result.push(value);
    if (limit && result.length >= limit) break;
  }
  return result;
}

function imageUrl(image) {
  if (typeof image === "string") return image;
  if (!image) return "";
  return image.url || image.imageUrl || image.path || image.src || image.providerUrl || image.downloadUrl || image.signedUrl || "";
}

function imageAssetId(image) {
  if (!image || typeof image === "string") return "";
  return image.assetId || image.asset_id || image.id || "";
}

function normalizeImageItems(value) {
  var result = [];
  var source = asArray(value);
  var image = null;
  var url = "";
  var assetId = "";
  var i = 0;

  for (i = 0; i < source.length; i += 1) {
    image = source[i];
    url = imageUrl(image);
    assetId = imageAssetId(image);
    if (!url && !assetId) continue;
    result.push({
      url: String(url || ""),
      assetId: String(assetId || ""),
      downloadUrl: image && typeof image !== "string" ? (image.downloadUrl || image.signedUrl || "") : "",
      raw: image,
    });
  }
  return result;
}

function normalizeImages(value) {
  return normalizeImageItems(value).map(function (item) {
    return item.url;
  }).filter(Boolean);
}

function requestPayload(task) {
  var source = task || {};
  var raw = source.rawProviderResult || source.rawProviderPayload || source.raw || {};
  var metadata = source.metadata || raw.metadata || {};
  return source.request || source.requestPayload || source.request_payload || metadata.request || raw.request || {};
}

function statusValue(status) {
  return String(status || "running").toLowerCase();
}

function taskFailureMessage(task) {
  var source = task || {};
  var raw = source.rawProviderResult || source.rawProviderPayload || source.raw || {};
  var code = source.errorCode || source.error_code || raw.errorCode || "";
  var message = source.error || source.errorMessage || source.error_message || source.message || raw.error || "";
  var known = {
    PROVIDER_TIMEOUT: "生成服务响应超时，请点击重新生成。",
    GENERATION_PROVIDER_ERROR: "生成服务暂时不可用，请稍后重试。",
    MODEL_UNAVAILABLE: "当前模型暂不可用，请更换模型后重试。",
    MODEL_OUTPUT_LIMIT_EXCEEDED: "当前模型不支持这个输出数量，请减少张数后重试。",
  };
  return known[code] || message || "生成失败，请点击重新生成。";
}

function statusTitle(status) {
  var value = statusValue(status);
  if (value === "completed" || value === "succeeded" || value === "success") return "生成完成";
  if (value === "failed" || value === "error") return "生成失败";
  if (value === "canceled" || value === "cancelled") return "任务已取消";
  if (value === "queued" || value === "pending" || value === "retryable") return "排队中";
  return "生成中";
}

function statusDesc(task) {
  var value = statusValue(task && task.status);
  if (value === "completed" || value === "succeeded" || value === "success") return "可以预览、保存或继续编辑。";
  if (value === "failed" || value === "error") return taskFailureMessage(task);
  if (value === "canceled" || value === "cancelled") return "任务已取消，可以返回重新提交。";
  if (value === "queued" || value === "pending" || value === "retryable") return "任务已经提交，正在等待生成队列处理。";
  return "正在生成图文结果，页面会自动刷新。";
}

function taskIdFrom(result) {
  if (!result) return "";
  if (result.taskId) return result.taskId;
  if (result.id) return result.id;
  if (result.generationTaskId) return result.generationTaskId;
  if (result.task && (result.task.taskId || result.task.id)) return result.task.taskId || result.task.id;
  if (result.generationTask && (result.generationTask.taskId || result.generationTask.id)) return result.generationTask.taskId || result.generationTask.id;
  if (result.data && result.data.taskId) return result.data.taskId;
  if (result.redirectUrl) {
    var match = String(result.redirectUrl).match(/[?&]taskId=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  return "";
}

function mergeOutputItems(items, assets) {
  var result = items.slice();
  var i = 0;
  var item = null;
  var asset = null;
  for (i = 0; i < assets.length; i += 1) {
    asset = assets[i];
    item = result[i];
    if (!item) {
      result[i] = asset;
      continue;
    }
    if (!item.url && asset.url) item.url = asset.url;
    if (!item.assetId && asset.assetId) item.assetId = asset.assetId;
    if (!item.downloadUrl && asset.downloadUrl) item.downloadUrl = asset.downloadUrl;
  }
  return result;
}

function normalizeTask(raw) {
  var source = raw || {};
  var task = source.task || source.generationTask || source;
  var request = requestPayload(task);
  var outputValue = task.imageItems || task.images || task.resultImages || task.outputImages || task.outputs || task.assets || [];
  var imageItems = normalizeImageItems(outputValue);
  var assetItems = normalizeImageItems(task.imageAssets || task.generatedAssets || []);
  var status = task.status || task.state || "running";
  var error = task.error || task.errorMessage || task.error_message || "";
  var referenceValue = task.referenceImages || task.reference_images || task.reference_images_json || request.referenceImages || request.reference_images || [];
  var referenceAssetIds = task.referenceAssetIds || task.reference_asset_ids || request.referenceAssetIds || request.reference_asset_ids || [];
  imageItems = mergeOutputItems(imageItems, assetItems);

  return {
    id: task.id || task.taskId || task.generationTaskId || "",
    status: status,
    title: statusTitle(status),
    desc: statusDesc({ status: status, error: error, errorCode: task.errorCode, raw: task }),
    images: imageItems.map(function (item) { return item.url; }).filter(Boolean),
    imageItems: imageItems,
    referenceImages: normalizeImages(referenceValue),
    referenceAssetIds: uniqueStrings(referenceAssetIds),
    error: error,
    errorCode: task.errorCode || task.error_code || "",
    prompt: task.prompt || request.prompt || "",
    topic: task.topic || request.topic || "",
    model: task.model || request.model || "",
    capability: task.capability || task.mode || request.capability || "",
    templateId: task.templateId || task.template_id || request.templateId || request.template_id || "",
    outputCount: Number(task.outputCount || task.output_count || request.outputCount || request.outputNumber || 1),
    aspectRatio: task.aspectRatio || task.aspect_ratio || request.aspectRatio || "",
    resolution: task.resolution || request.resolution || "",
    createdAt: task.createdAt || task.created_at || "",
    updatedAt: task.updatedAt || task.updated_at || "",
    raw: task,
  };
}

function historyStatusMeta(status) {
  var value = statusValue(status);
  if (value === "completed" || value === "succeeded" || value === "success") return { label: "已完成", tone: "success" };
  if (value === "failed" || value === "error") return { label: "失败", tone: "danger" };
  if (value === "canceled" || value === "cancelled") return { label: "已取消", tone: "muted" };
  if (value === "queued" || value === "pending" || value === "retryable") return { label: "排队中", tone: "waiting" };
  return { label: "生成中", tone: "running" };
}

function formatTime(value) {
  if (!value) return "刚刚";
  var date = new Date(value);
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var hour = date.getHours();
  var minute = date.getMinutes();
  if (isNaN(date.getTime())) return String(value);
  return month + "/" + day + " " + (hour < 10 ? "0" + hour : hour) + ":" + (minute < 10 ? "0" + minute : minute);
}

function normalizeHistoryRecord(raw) {
  var task = normalizeTask(raw);
  var meta = historyStatusMeta(task.status);
  var thumbnails = task.imageItems.filter(function (item) { return Boolean(item.url); }).slice(0, 4);
  return {
    id: task.id,
    title: task.topic || task.templateTitle || task.model || "未命名作品",
    prompt: task.prompt,
    model: task.model || "GPT Image 2",
    status: task.status,
    statusLabel: meta.label,
    statusTone: meta.tone,
    firstImage: thumbnails[0] ? thumbnails[0].url : "",
    thumbnails: thumbnails,
    images: task.images,
    imageItems: task.imageItems,
    outputCount: task.outputCount || task.images.length || 1,
    createdAtLabel: formatTime(task.createdAt || task.updatedAt),
    task: task,
  };
}

function normalizeListPayload(payload) {
  var source = payload || {};
  var records = source.records || source.data || source.items || [];
  var normalized = [];
  var i = 0;
  if (!Array.isArray(records)) records = [];
  for (i = 0; i < records.length; i += 1) normalized.push(normalizeTask(records[i]));
  return {
    records: normalized,
    pagination: source.pagination || { page: 1, limit: normalized.length, total: normalized.length, totalPages: 1 },
  };
}

function normalizeEstimate(payload) {
  var estimate = payload || {};
  return {
    requestedCredits: Number(estimate.requestedCredits || estimate.credits || estimate.cost || 0),
    model: estimate.model || "",
    outputCount: Number(estimate.outputCount || estimate.outputNumber || 1),
    raw: estimate,
  };
}

function decodeOption(value) {
  if (typeof value !== "string") return value;
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function restoreReferenceState(options, maxReferences) {
  var source = options || {};
  var limit = Number(maxReferences || DEFAULT_REFERENCE_LIMIT);
  var paths = source.referenceImagePaths || source.referenceImages || source.referenceImage || source.referenceUrl || [];
  var assetIds = source.referenceAssetIds || [];
  var decodedPaths = decodeOption(paths);
  var decodedAssetIds = decodeOption(assetIds);
  var pathValues = uniqueStrings(decodedPaths, limit);
  var idValues = uniqueStrings(decodedAssetIds, limit);
  return {
    referenceImagePath: pathValues[0] || "",
    referenceImagePaths: pathValues,
    referenceAssetIds: idValues.slice(0, pathValues.length),
  };
}

function selectedModelValue(form) {
  var model = form && form.model;
  if (model && typeof model === "object") return model.value || model.key || "";
  if (model) return String(model);
  if (form && Array.isArray(form.availableModels) && form.availableModels[form.modelIndex]) {
    return form.availableModels[form.modelIndex].value || form.availableModels[form.modelIndex].key || "";
  }
  return "";
}

function buildGenerationRequest(form, uploadedReferences) {
  var source = form || {};
  var capability = source.capability || "text-to-image";
  var textOnly = capability === "text-to-image";
  var paths = uniqueStrings(source.referenceImagePaths || source.referenceImages || [], DEFAULT_REFERENCE_LIMIT);
  var uploads = Array.isArray(uploadedReferences) ? uploadedReferences.map(function (item) {
    var normalized = normalizeImageItems(item)[0];
    return normalized || { url: "", assetId: "" };
  }).filter(function (item) { return item.url || item.assetId; }) : [];
  var references = uploads.length ? uploads : paths.map(function (path) { return { url: path, assetId: "" }; });
  var allUploaded = references.length > 0 && references.every(function (item) { return Boolean(item.assetId); });
  var request = {
    source: source.source || "wechat-miniapp",
    model: selectedModelValue(source),
    capability: capability,
    prompt: String(source.prompt || "").replace(/^\s+|\s+$/g, ""),
    topic: String(source.topic || "").replace(/^\s+|\s+$/g, ""),
    templateId: source.templateId || "",
    sourceTaskId: source.sourceTaskId || "",
    referenceImages: textOnly ? [] : references.map(function (item) { return item.url; }).filter(Boolean),
    referenceAssetIds: textOnly || !allUploaded ? [] : references.map(function (item) { return item.assetId; }),
    outputCount: Number(source.outputCount || (Array.isArray(source.outputCounts) ? source.outputCounts[source.countIndex] : 1) || 1),
    aspectRatio: source.aspectRatio || (textOnly ? "1:1" : "3:4"),
    resolution: source.resolution || "1k",
  };
  return request;
}

function continuationReferenceState(task, preferredImage, maxReferences) {
  var normalized = normalizeTask(task);
  var limit = Number(maxReferences || DEFAULT_REFERENCE_LIMIT);
  var items = normalized.imageItems.filter(function (item) { return Boolean(item.url); });
  var ordered = [];
  var preferred = String(preferredImage || "");
  var i = 0;
  if (preferred) {
    items.forEach(function (item) {
      if (item.url === preferred) ordered.push(item);
    });
  }
  for (i = 0; i < items.length; i += 1) {
    if (!preferred || items[i].url !== preferred) ordered.push(items[i]);
  }
  ordered = ordered.slice(0, limit);
  return {
    referenceImagePath: ordered[0] ? ordered[0].url : "",
    referenceImagePaths: ordered.map(function (item) { return item.url; }),
    referenceAssetIds: [],
  };
}

function buildGenerateUrlFromTask(task, options) {
  var normalized = normalizeTask(task);
  var continuation = continuationReferenceState(normalized, options && options.referenceImage, DEFAULT_REFERENCE_LIMIT);
  var params = [];
  if (continuation.referenceImagePaths.length) params.push("referenceImagePaths=" + encodeURIComponent(JSON.stringify(continuation.referenceImagePaths)));
  if (normalized.prompt) params.push("prompt=" + encodeURIComponent(normalized.prompt));
  if (normalized.topic) params.push("topic=" + encodeURIComponent(normalized.topic));
  if (normalized.model) params.push("model=" + encodeURIComponent(normalized.model));
  if (normalized.capability) params.push("capability=" + encodeURIComponent(normalized.capability));
  if (normalized.outputCount) params.push("outputCount=" + encodeURIComponent(normalized.outputCount));
  if (normalized.templateId) params.push("templateId=" + encodeURIComponent(normalized.templateId));
  if (normalized.id) params.push("sourceTaskId=" + encodeURIComponent(normalized.id));
  return "/pages/generate/index" + (params.length ? "?" + params.join("&") : "");
}

function isCurrentPollRequest(requestId, currentRequestId) {
  return Boolean(requestId) && requestId === currentRequestId;
}

function pollDecision(attempt, maxAttempts, manual) {
  var attemptValue = Math.max(0, Number(attempt || 0));
  var limit = Math.max(1, Number(maxAttempts || 1));
  if (manual) return { shouldPoll: true, exhausted: false, attempt: 0 };
  if (attemptValue >= limit) return { shouldPoll: false, exhausted: true, attempt: attemptValue };
  return { shouldPoll: true, exhausted: false, attempt: attemptValue };
}

function canSaveOutput(task, image) {
  var normalized = normalizeTask(task);
  var candidate = normalizeImageItems(image)[0];
  var isCompleted = ["completed", "succeeded", "success"].indexOf(statusValue(normalized.status)) >= 0;
  var matchesOutput = normalized.imageItems.some(function (item) {
    return (candidate.assetId && item.assetId === candidate.assetId) || (candidate.url && item.url === candidate.url);
  });
  return isCompleted && matchesOutput && Boolean(candidate.assetId || candidate.downloadUrl);
}

function listTasks(query) {
  return api.listGenerationTasks(query || {}).then(normalizeListPayload);
}

function getTask(taskId) {
  return api.getGenerationTask(taskId).then(normalizeTask);
}

function estimate(input) {
  return api.estimateGeneration(input || {}).then(normalizeEstimate);
}

function uploadReferenceImage(filePath) {
  return api.uploadReferenceImage(filePath);
}

function createTask(input) {
  return api.createGenerationTask(input || {});
}

function regenerateTask(taskId, input) {
  return api.regenerateGenerationTask(taskId, input || {}).then(function (result) {
    var nested = result && (result.task || result.generationTask);
    return {
      taskId: taskIdFrom(result),
      task: nested ? normalizeTask(nested) : null,
      raw: result,
    };
  });
}

module.exports = {
  listTasks: listTasks,
  getTask: getTask,
  estimate: estimate,
  uploadReferenceImage: uploadReferenceImage,
  createTask: createTask,
  regenerateTask: regenerateTask,
  buildGenerateUrlFromTask: buildGenerateUrlFromTask,
  buildGenerationRequest: buildGenerationRequest,
  restoreReferenceState: restoreReferenceState,
  continuationReferenceState: continuationReferenceState,
  normalizeTask: normalizeTask,
  normalizeHistoryRecord: normalizeHistoryRecord,
  normalizeImages: normalizeImages,
  normalizeImageItems: normalizeImageItems,
  taskFailureMessage: taskFailureMessage,
  canSaveOutput: canSaveOutput,
  isCurrentPollRequest: isCurrentPollRequest,
  pollDecision: pollDecision,
  statusValue: statusValue,
  terminalStatuses: TERMINAL_STATUSES,
};
