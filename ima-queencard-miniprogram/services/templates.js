var env = require("../config/env.js");
var api = require("./api.js");

function buildQuery(query) {
  var parts = [];
  var key = "";
  if (!query) return "";
  for (key in query) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
    if (query[key] === undefined || query[key] === null || query[key] === "") continue;
    parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(query[key])));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function isConfigured() {
  return Boolean(env.TEMPLATE_API_BASE_URL && env.TEMPLATE_API_BASE_URL.indexOf("http") === 0);
}

function normalizeQuery(query) {
  var input = query || {};
  var normalized = {};
  var scenarioCategory = input.scenario_category || input.scenarioCategory || "";
  if (input.page) normalized.page = input.page;
  if (input.limit) normalized.limit = input.limit;
  if (input.q) normalized.q = input.q;
  if (input.category) normalized.category = input.category;
  if (scenarioCategory) normalized.scenario_category = scenarioCategory;
  if (input.hotOnly) normalized.hot = "1";
  if (input.sort) normalized.sort = input.sort;
  if (input.language) normalized.language = input.language;
  return normalized;
}

function normalizeRecord(record) {
  var response = record.response_payload || {};
  var request = record.request_payload || {};
  var images = response.images || [];
  var firstImage = images[0] || {};
  var thumbnailUrl = record.work_url || response.cover_url || response.coverImageUrl || firstImage.url || firstImage.path || "";
  var prompt = record.condition_prompt || request.input || request.prompt || record.name || "";

  return {
    id: record.id,
    title: record.name || prompt || "未命名模板",
    subtitle: prompt,
    category: record.category || "",
    scenarioCategory: record.scenario_category || "",
    source: "remote",
    sourceId: record.id,
    sourceUrl: record.source_page || "",
    thumbnailUrl: thumbnailUrl,
    previewUrl: thumbnailUrl,
    referenceImages: thumbnailUrl ? [thumbnailUrl] : [],
    prompt: prompt,
    useCase: record.scenario_category || record.category || "模板",
    seed: {
      templateId: record.id,
      prompt: prompt,
      referenceImages: thumbnailUrl ? [thumbnailUrl] : [],
      sourceCaseId: record.id,
      sourceCaseCategory: record.scenario_category || record.category || "",
    },
  };
}

function normalizeListPayload(payload) {
  var records = [];
  var rawRecords = payload && payload.data;
  var i = 0;
  if (Array.isArray(rawRecords)) {
    for (i = 0; i < rawRecords.length; i += 1) {
      records.push(normalizeRecord(rawRecords[i]));
    }
  }
  return {
    records: records,
    pagination: payload.pagination || {
      page: 1,
      limit: records.length,
      total: records.length,
      totalPages: 1,
    },
  };
}

function requestPublicTemplates(query) {
  if (!isConfigured()) {
    return Promise.reject(new Error("模板 API 未配置"));
  }

  return new Promise(function (resolve, reject) {
    wx.request({
      url: env.TEMPLATE_API_BASE_URL.replace(/\/$/, "") + "/api/templates" + buildQuery(query),
      method: "GET",
      timeout: env.REQUEST_TIMEOUT,
      header: {
        "content-type": "application/json",
      },
      success: function (res) {
        var payload = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && payload.success !== false) {
          resolve(normalizeListPayload(payload));
          return;
        }
        reject(new Error(payload.error || payload.message || "模板请求失败：" + res.statusCode));
      },
      fail: function (error) {
        reject(new Error(error.errMsg || "模板网络请求失败"));
      },
    });
  });
}

function listTemplates(query) {
  var normalizedQuery = normalizeQuery(query);
  if (api.isConfigured()) {
    return api.request({
      path: "/templates",
      method: "GET",
      query: normalizedQuery,
    });
  }
  return requestPublicTemplates(normalizedQuery);
}

function getTemplate(id) {
  return api.request({
    path: "/templates/" + encodeURIComponent(id),
    method: "GET",
  });
}

function generateFromTemplate(id, input) {
  return api.request({
    path: "/templates/" + encodeURIComponent(id) + "/generate",
    method: "POST",
    data: input || {},
  });
}

module.exports = {
  isConfigured: isConfigured,
  listTemplates: listTemplates,
  getTemplate: getTemplate,
  generateFromTemplate: generateFromTemplate,
};
