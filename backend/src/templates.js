const fs = require("node:fs");
const path = require("node:path");
const { queryCatalog } = require("./services/catalog-service");
const { parseExportedArray, parseExportedObject } = require("./source-literal-parser");

function firstText() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function assetUrl(value, assetBaseUrl) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const base = (assetBaseUrl || "").replace(/\/$/, "");
  if (!base) return value;
  return base + (value.startsWith("/") ? value : "/" + value);
}

function normalizeTemplate(record) {
  const response = record.response_payload || {};
  const request = record.request_payload || {};
  const images = Array.isArray(response.images) ? response.images : [];
  const firstImage = images[0] || {};
  const thumbnailUrl = firstText(
    record.work_url,
    response.cover_url,
    response.coverImageUrl,
    firstImage.url,
    firstImage.path,
  );
  const prompt = firstText(record.condition_prompt, request.input, request.prompt, record.name);

  return {
    id: record.id,
    title: firstText(record.name, prompt, "未命名模板"),
    subtitle: prompt,
    category: record.category || "",
    scenarioCategory: record.scenario_category || "",
    source: "remote",
    sourceId: record.id,
    sourceUrl: record.source_page || "",
    thumbnailUrl,
    previewUrl: thumbnailUrl,
    referenceImages: thumbnailUrl ? [thumbnailUrl] : [],
    previewImages: thumbnailUrl ? [thumbnailUrl] : [],
    tags: [],
    prompt,
    useCase: record.scenario_category || record.category || "模板",
    seed: {
      templateId: record.id,
      prompt,
      referenceImages: thumbnailUrl ? [thumbnailUrl] : [],
      sourceCaseId: record.id,
      sourceCaseCategory: record.scenario_category || record.category || "",
    },
  };
}

function exportedCaseArrayName(filePath) {
  const baseName = path.basename(filePath);
  if (baseName === "boLandingPromptCases.ts") return "boLandingPromptCases";
  return "xhsPromptCases";
}

function loadGithubCases(filePath) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  return parseExportedArray(sourceText, exportedCaseArrayName(filePath));
}

function loadGithubCaseMetrics(filePath) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  return parseExportedObject(sourceText, "xhsCaseMetrics");
}

function noteIdFor(record) {
  const match = String(record.noteUrl || "").match(/explore\/([^?]+)/);
  return match ? match[1] : record.id;
}

function metricNumber(record, key) {
  const metrics = record.metrics || {};
  const value = Number(metrics[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function interactionScore(record) {
  return metricNumber(record, "likes") + metricNumber(record, "saves") * 0.35 + metricNumber(record, "shares") * 0.45;
}

function potentialScore(record) {
  const value = Number(record.metrics && record.metrics.potentialScore);
  return Number.isFinite(value) ? value : interactionScore(record);
}

function potentialRank(record) {
  const value = Number(record.metrics && record.metrics.potentialRank);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function sortGithubCases(records, sort) {
  const mode = sort || "heat";
  return records.slice().sort((a, b) => {
    if (mode === "potential") {
      const scoreDelta = potentialScore(b) - potentialScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      const rankDelta = potentialRank(a) - potentialRank(b);
      if (rankDelta !== 0) return rankDelta;
      return interactionScore(b) - interactionScore(a);
    }
    if (mode === "saves") return metricNumber(b, "saves") - metricNumber(a, "saves");
    if (mode === "shares") return metricNumber(b, "shares") - metricNumber(a, "shares");
    return metricNumber(b, "likes") + metricNumber(b, "saves") - (metricNumber(a, "likes") + metricNumber(a, "saves"));
  });
}

function normalizeGithubCase(record, assetBaseUrl, caseMetrics) {
  const preview = assetUrl(record.image, assetBaseUrl);
  const referenceImages = Array.isArray(record.images)
    ? Array.from(record.images).map((image) => assetUrl(image, assetBaseUrl)).filter(Boolean)
    : [];
  const prompt = firstText(record.prompt, record.title);
  const metric = (caseMetrics || {})[noteIdFor(record)] || null;

  return {
    id: record.id,
    title: firstText(record.title, prompt, "未命名模板"),
    subtitle: firstText(record.subtitle, prompt),
    category: "image",
    scenarioCategory: record.category || "",
    source: "github",
    sourceId: record.id,
    sourceUrl: record.noteUrl || "",
    thumbnailUrl: preview,
    previewUrl: preview,
    referenceImages,
    previewImages: referenceImages,
    tags: Array.isArray(record.topics) ? record.topics : [],
    prompt,
    useCase: record.category || "小红书模板",
    metrics: {
      likes: record.likes || 0,
      saves: record.saves || 0,
      shares: record.shares || 0,
      likesText: record.likesText || "",
      savesText: record.savesText || "",
      sharesText: record.sharesText || "",
      potentialScore: metric ? metric.potentialScore : null,
      potentialRank: metric ? metric.potentialRank : null,
      isPotentialHit: metric ? metric.isPotentialHit : false,
      followers: metric ? metric.followers : null,
      followersText: metric ? metric.followersText : "",
    },
    author: record.author || "",
    createdAt: record.date ? new Date(record.date).toISOString() : null,
    updatedAt: record.date ? new Date(record.date).toISOString() : null,
    seed: {
      templateId: record.id,
      prompt,
      referenceImages,
      sourceCaseId: record.id,
      sourceCaseCategory: record.category || "",
      sourceTitle: record.sourceTitle || record.title || "",
    },
  };
}

function defaultGithubCasesFile() {
  return path.resolve(__dirname, "../template-data/xhsPromptCases.ts");
}

function defaultGithubExtraCasesFile() {
  return path.resolve(__dirname, "../template-data/boLandingPromptCases.ts");
}

function defaultGithubMetricsFile() {
  return path.resolve(__dirname, "../template-data/xhsCaseMetrics.ts");
}

function splitCaseFiles(value) {
  return String(value || "")
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
}

function githubCaseFiles(options) {
  const env = options.env || process.env;
  const explicitFiles = [
    ...splitCaseFiles(options.githubCasesFile || env.MINIAPP_GITHUB_CASES_FILE),
    ...splitCaseFiles(options.githubExtraCasesFile || env.MINIAPP_GITHUB_EXTRA_CASES_FILE),
  ];
  if (explicitFiles.length) return explicitFiles;

  return [defaultGithubCasesFile(), defaultGithubExtraCasesFile()].filter((file) => fs.existsSync(file));
}

function defaultAssetBaseUrl(options) {
  if (options.assetBaseUrl) return options.assetBaseUrl;
  const env = options.env || process.env;
  if (env.MINIAPP_PUBLIC_ASSET_BASE_URL) return env.MINIAPP_PUBLIC_ASSET_BASE_URL;
  const port = env.PORT || 8787;
  return `http://127.0.0.1:${port}`;
}

function filterGithubCases(records, query) {
  const category = query.get("category");
  const scenarioCategory = query.get("scenario_category") || query.get("scenarioCategory");
  const hotOnly = query.get("hot") === "1" || query.get("hotOnly") === "true";
  const keyword = query.get("keyword") || query.get("q") || "";
  return records.filter((record) => {
    if (category && category !== "image" && record.category !== category) return false;
    if (scenarioCategory && record.scenarioCategory !== scenarioCategory) return false;
    if (hotOnly && !((record.metrics && record.metrics.likes >= 20000) || (record.metrics && record.metrics.saves >= 20000))) return false;
    if (keyword) {
      const haystack = [record.title, record.subtitle, record.prompt, record.scenarioCategory, record.author]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword.toLowerCase())) return false;
    }
    return true;
  });
}

async function fetchGithubTemplateList(options) {
  const query = options.query || new URLSearchParams();
  const metricsFile = options.githubMetricsFile || (options.env && options.env.MINIAPP_GITHUB_METRICS_FILE) || defaultGithubMetricsFile();
  const metrics = fs.existsSync(metricsFile) ? loadGithubCaseMetrics(metricsFile) : {};
  const records = githubCaseFiles(options)
    .flatMap((casesFile) => loadGithubCases(casesFile))
    .map((record) => normalizeGithubCase(record, defaultAssetBaseUrl(options), metrics));
  const result = queryCatalog(records, query, { id: "github-local" });
  const pageRecords = result.records;

  return {
    rawRecords: pageRecords,
    records: pageRecords,
    catalogVersion: result.catalogVersion,
    categories: result.categories,
    specialFilters: result.specialFilters,
    pagination: result.pagination,
  };
}

async function fetchRemoteTemplateList(options) {
  const baseUrl = (options.baseUrl || "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("Remote template baseUrl is not configured");
  const query = options.query || new URLSearchParams();
  const response = await options.fetch(`${baseUrl}/api/templates?${query.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `Template API failed: ${response.status}`);
  }
  const envelope = payload.data && !Array.isArray(payload.data) ? payload.data : payload;
  const data = Array.isArray(envelope.data) ? envelope.data : Array.isArray(envelope.records) ? envelope.records : [];
  const records = data.map(normalizeTemplate);
  const result = queryCatalog(records, query, { id: envelope.catalogVersion || "remote" });
  return {
    rawRecords: data,
    records: result.records,
    catalogVersion: result.catalogVersion,
    categories: result.categories,
    specialFilters: result.specialFilters,
    pagination: envelope.pagination || result.pagination,
  };
}

async function fetchTemplateList(options) {
  if (options.source === "remote" || options.baseUrl) return fetchRemoteTemplateList(options);
  return fetchGithubTemplateList(options);
}

async function fetchTemplateById(options) {
  if (options.source === "remote" || options.baseUrl) {
    const list = await fetchRemoteTemplateList(options);
    const raw = list.rawRecords.find((record) => record.id === options.id);
    return raw ? normalizeTemplate(raw) : list.records[0] || null;
  }
  const list = await fetchGithubTemplateList({
    ...options,
    query: new URLSearchParams({ page: "1", limit: "10000" }),
  });
  return list.records.find((record) => record.id === options.id) || null;
}

module.exports = {
  normalizeTemplate,
  normalizeGithubCase,
  fetchTemplateList,
  fetchTemplateById,
};
