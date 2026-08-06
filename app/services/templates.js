var env = require("../config/env.js");
var api = require("./api.js");

var CACHE_KEY = "ima_queencard_catalog_cache_v1";
var requestSerial = 0;
var pendingRequest = null;

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
  if (input.keyword) normalized.keyword = input.keyword;
  if (input.tag) normalized.tag = input.tag;
  if (input.tags) normalized.tags = input.tags;
  if (input.category) normalized.category = input.category;
  if (scenarioCategory) normalized.scenario_category = scenarioCategory;
  if (input.hotOnly) normalized.hot = "1";
  if (input.sort) normalized.sort = input.sort;
  if (input.cursor) normalized.cursor = input.cursor;
  if (input.language) normalized.language = input.language;
  return normalized;
}

function normalizeRecord(record) {
  if (record && (record.title || record.thumbnailUrl || record.referenceImages || record.previewImages)) {
    return {
      id: record.id,
      title: record.title || "未命名模板",
      subtitle: record.subtitle || record.prompt || "",
      category: record.category || "",
      scenarioCategory: record.scenarioCategory || record.scenario_category || "",
      author: record.author || "",
      source: record.source || "",
      sourceId: record.sourceId || record.source_id || record.id,
      sourceUrl: record.sourceUrl || record.source_url || "",
      thumbnailUrl: record.thumbnailUrl || record.previewUrl || "",
      previewUrl: record.previewUrl || record.thumbnailUrl || "",
      referenceImages: Array.isArray(record.referenceImages) ? record.referenceImages : [],
      previewImages: Array.isArray(record.previewImages) ? record.previewImages : [],
      tags: Array.isArray(record.tags) ? record.tags : [],
      prompt: record.prompt || record.subtitle || "",
      useCase: record.useCase || record.use_case || record.category || "模板",
      metrics: record.metrics || {},
      metadata: record.metadata || {},
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      seed: record.seed || null,
    };
  }
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
    previewImages: thumbnailUrl ? [thumbnailUrl] : [],
    tags: Array.isArray(record.tags) ? record.tags : [],
    metrics: record.metrics || {},
    metadata: record.metadata || {},
    createdAt: record.created_at || record.createdAt || null,
    updatedAt: record.updated_at || record.updatedAt || null,
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
  var envelope = payload && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
  envelope = envelope || {};
  var rawRecords = envelope && envelope.records ? envelope.records : envelope && envelope.data;
  var i = 0;
  if (Array.isArray(rawRecords)) {
    for (i = 0; i < rawRecords.length; i += 1) {
      records.push(normalizeRecord(rawRecords[i]));
    }
  }
  return {
    records: records,
    catalogVersion: envelope.catalogVersion || "",
    categories: Array.isArray(envelope.categories) ? envelope.categories : [],
    specialFilters: Array.isArray(envelope.specialFilters) ? envelope.specialFilters : [],
    pagination: envelope.pagination || {
      page: 1,
      limit: records.length,
      total: records.length,
      totalPages: 1,
    },
  };
}

function cacheQueryKey(query) {
  var input = query || {};
  var keys = Object.keys(input).sort();
  var values = {};
  keys.forEach(function (key) {
    values[key] = input[key];
  });
  return JSON.stringify(values);
}

function staleError() {
  var error = new Error("模板请求已过期");
  error.stale = true;
  return error;
}

function cachedResult(query) {
  if (typeof wx === "undefined" || !wx.getStorageSync) return null;
  var cached = wx.getStorageSync(CACHE_KEY);
  if (!cached || !cached.catalogVersion || !cached.pages) return null;
  var value = cached.pages[cacheQueryKey(query)];
  return value ? value : null;
}

function saveCachedResult(query, result) {
  if (typeof wx === "undefined" || !wx.setStorageSync || !result || !result.catalogVersion) return;
  var current = wx.getStorageSync(CACHE_KEY);
  if (!current || current.catalogVersion !== result.catalogVersion) current = { catalogVersion: result.catalogVersion, pages: {} };
  current.pages[cacheQueryKey(query)] = result;
  wx.setStorageSync(CACHE_KEY, current);
}

function cancelPending() {
  requestSerial += 1;
  if (pendingRequest && typeof pendingRequest.abort === "function") pendingRequest.abort();
  pendingRequest = null;
}

function requestPublicTemplates(query) {
  if (!isConfigured()) {
    return Promise.reject(new Error("模板 API 未配置"));
  }

  return new Promise(function (resolve, reject) {
    pendingRequest = wx.request({
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
  var cached = cachedResult(normalizedQuery);
  if (cached) return Promise.resolve(cached);
  var serial = ++requestSerial;
  var request = api.isConfigured()
    ? api.request({
      path: "/templates",
      method: "GET",
      query: normalizedQuery,
      onRequest: function (task) { pendingRequest = task; },
    }).then(normalizeListPayload)
    : requestPublicTemplates(normalizedQuery);
  return request.then(function (result) {
    if (serial !== requestSerial) throw staleError();
    saveCachedResult(normalizedQuery, result);
    pendingRequest = null;
    return result;
  }).catch(function (error) {
    if (serial !== requestSerial) throw staleError();
    pendingRequest = null;
    throw error;
  });
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
  cancelPending: cancelPending,
  getTemplate: getTemplate,
  generateFromTemplate: generateFromTemplate,
};
