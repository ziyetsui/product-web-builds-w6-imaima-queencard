const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

function extractCasesArray(sourceText) {
  const marker = "export const xhsPromptCases";
  const markerIndex = sourceText.indexOf(marker);
  if (markerIndex < 0) throw new Error("xhsPromptCases export not found");
  const equalsIndex = sourceText.indexOf("=", markerIndex);
  if (equalsIndex < 0) throw new Error("xhsPromptCases assignment not found");
  const start = sourceText.indexOf("[", equalsIndex);
  if (start < 0) throw new Error("xhsPromptCases array not found");

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  throw new Error("xhsPromptCases array did not terminate");
}

function loadGithubCases(filePath) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const literal = extractCasesArray(sourceText);
  return vm.runInNewContext("(" + literal + ")", {}, {
    timeout: 1000,
  });
}

function normalizeGithubCase(record, assetBaseUrl) {
  const preview = assetUrl(record.image, assetBaseUrl);
  const referenceImages = Array.isArray(record.images)
    ? Array.from(record.images).map((image) => assetUrl(image, assetBaseUrl)).filter(Boolean)
    : [];
  const prompt = firstText(record.prompt, record.title);

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
    prompt,
    useCase: record.category || "小红书模板",
    metrics: {
      likes: record.likes || 0,
      saves: record.saves || 0,
      shares: record.shares || 0,
      likesText: record.likesText || "",
      savesText: record.savesText || "",
      sharesText: record.sharesText || "",
    },
    author: record.author || "",
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
  return path.resolve(
    __dirname,
    "../../ima ima queencard/frontend/src/data/xhsPromptCases.ts"
  );
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
  const keyword = query.get("keyword") || query.get("q") || "";
  return records.filter((record) => {
    if (category && category !== "image" && record.category !== category) return false;
    if (scenarioCategory && record.scenarioCategory !== scenarioCategory) return false;
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
  const casesFile = options.githubCasesFile || (options.env && options.env.MINIAPP_GITHUB_CASES_FILE) || defaultGithubCasesFile();
  const records = loadGithubCases(casesFile).map((record) => normalizeGithubCase(record, defaultAssetBaseUrl(options)));
  const filtered = filterGithubCases(records, query);
  const page = Math.max(1, Number(query.get("page") || 1));
  const limit = Math.max(1, Number(query.get("limit") || filtered.length || 1));
  const start = (page - 1) * limit;
  const pageRecords = filtered.slice(start, start + limit);

  return {
    rawRecords: pageRecords,
    records: pageRecords,
    pagination: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
    },
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
  const data = Array.isArray(payload.data) ? payload.data : [];
  return {
    rawRecords: data,
    records: data.map(normalizeTemplate),
    pagination: payload.pagination || {
      page: Number(query.get("page") || 1),
      limit: Number(query.get("limit") || data.length),
      total: data.length,
      totalPages: 1,
    },
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
