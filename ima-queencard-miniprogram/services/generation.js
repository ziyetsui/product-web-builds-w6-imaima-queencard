var api = require("./api.js");

function parseMaybeJson(value, fallback) {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeImages(value) {
  var result = [];
  var source = value || [];
  var parsed = null;
  var i = 0;
  var image = null;

  if (typeof source === "string") {
    parsed = parseMaybeJson(source, null);
    source = parsed || (source ? [source] : []);
  }

  if (!Array.isArray(source)) source = [source];

  for (i = 0; i < source.length; i += 1) {
    image = source[i];
    if (typeof image === "string") {
      result.push(image);
    } else if (image && image.url) {
      result.push(image.url);
    } else if (image && image.imageUrl) {
      result.push(image.imageUrl);
    } else if (image && image.path) {
      result.push(image.path);
    }
  }
  return result;
}

function requestPayload(task) {
  var raw = task.rawProviderResult || task.rawProviderPayload || task.raw || {};
  return task.request || task.requestPayload || task.request_payload || raw.request || {};
}

function statusTitle(status) {
  if (status === "completed" || status === "succeeded" || status === "success") return "生成完成";
  if (status === "failed" || status === "error") return "生成失败";
  if (status === "canceled" || status === "cancelled") return "任务已取消";
  if (status === "queued" || status === "pending") return "排队中";
  return "生成中";
}

function statusDesc(status, error) {
  if (status === "completed" || status === "succeeded" || status === "success") return "可以预览、保存或继续生成下一组。";
  if (status === "failed" || status === "error") return error || "后端返回失败状态，请查看任务日志。";
  if (status === "canceled" || status === "cancelled") return "任务已经取消，可以返回重新提交。";
  if (status === "queued" || status === "pending") return "任务已经提交，正在等待生成队列处理。";
  return "正在生成图文结果，页面会自动刷新。";
}

function taskIdFrom(result) {
  if (!result) return "";
  if (result.taskId) return result.taskId;
  if (result.id) return result.id;
  if (result.generationTaskId) return result.generationTaskId;
  if (result.task && (result.task.taskId || result.task.id)) return result.task.taskId || result.task.id;
  if (result.data && result.data.taskId) return result.data.taskId;
  if (result.redirectUrl) {
    var match = String(result.redirectUrl).match(/[?&]taskId=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
  return "";
}

function normalizeTask(raw) {
  var task = raw || {};
  var nested = task.task || task.generationTask || null;
  var request = null;
  var status = "";
  var error = "";
  var images = [];
  var referenceImages = [];

  if (nested) task = nested;

  request = requestPayload(task);
  status = task.status || task.state || "running";
  error = task.error || task.errorMessage || task.message || "";
  images = normalizeImages(task.images || task.resultImages || task.outputImages || task.outputs || task.assets);
  referenceImages = normalizeImages(
    task.referenceImages ||
      task.reference_images ||
      task.reference_images_json ||
      request.referenceImages ||
      request.reference_images
  );

  return {
    id: task.id || task.taskId || "",
    status: status,
    title: statusTitle(status),
    desc: statusDesc(status, error),
    images: images,
    referenceImages: referenceImages,
    error: error,
    prompt: task.prompt || request.prompt || "",
    topic: task.topic || request.topic || "",
    model: task.model || request.model || "",
    templateId: task.templateId || task.template_id || request.templateId || "",
    outputCount: task.outputCount || task.output_count || request.outputCount || request.outputNumber || 1,
    aspectRatio: task.aspectRatio || task.aspect_ratio || request.aspectRatio || "",
    resolution: task.resolution || request.resolution || "",
    raw: task,
  };
}

function normalizeListPayload(payload) {
  var source = payload || {};
  var records = source.records || source.data || source.items || [];
  var normalized = [];
  var i = 0;

  if (!Array.isArray(records)) records = [];
  for (i = 0; i < records.length; i += 1) {
    normalized.push(normalizeTask(records[i]));
  }

  return {
    records: normalized,
    pagination: source.pagination || {
      page: 1,
      limit: normalized.length,
      total: normalized.length,
      totalPages: 1,
    },
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

function listTasks(query) {
  return api.listGenerationTasks(query || {}).then(normalizeListPayload);
}

function getTask(taskId) {
  return api.getGenerationTask(taskId).then(normalizeTask);
}

function estimate(input) {
  return api.estimateGeneration(input || {}).then(normalizeEstimate);
}

function regenerateTask(taskId, input) {
  return api.regenerateGenerationTask(taskId, input || {}).then(function (result) {
    return {
      taskId: taskIdFrom(result),
      task: result && (result.task || result.generationTask) ? normalizeTask(result.task || result.generationTask) : null,
      raw: result,
    };
  });
}

function firstImage(task, preferredImage) {
  var normalized = normalizeTask(task);
  if (preferredImage) return preferredImage;
  if (normalized.images.length > 0) return normalized.images[0];
  if (normalized.referenceImages.length > 0) return normalized.referenceImages[0];
  return "";
}

function buildGenerateUrlFromTask(task, options) {
  var normalized = normalizeTask(task);
  var params = [];
  var referenceImage = firstImage(normalized, options && options.referenceImage);

  if (referenceImage) params.push("referenceImage=" + encodeURIComponent(referenceImage));
  if (normalized.prompt) params.push("prompt=" + encodeURIComponent(normalized.prompt));
  if (normalized.id) params.push("sourceTaskId=" + encodeURIComponent(normalized.id));
  return "/pages/generate/index" + (params.length ? "?" + params.join("&") : "");
}

module.exports = {
  listTasks: listTasks,
  getTask: getTask,
  estimate: estimate,
  regenerateTask: regenerateTask,
  buildGenerateUrlFromTask: buildGenerateUrlFromTask,
  normalizeTask: normalizeTask,
  normalizeImages: normalizeImages,
};
