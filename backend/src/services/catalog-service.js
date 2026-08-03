const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_FIELDS = [
  "id", "title", "author", "category", "tags", "prompt", "referenceImages",
  "previewImages", "source", "metrics", "createdAt", "updatedAt",
];

function firstText() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]);
    return result;
  }, {});
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function catalogChecksum(records) {
  return crypto.createHash("sha256").update(stableJson(records)).digest("hex");
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid catalog date: ${value}`);
  return date.toISOString();
}

function assetPathFor(value, assetRoot) {
  if (!assetRoot || !value || /^https?:\/\//i.test(value)) return null;
  if (!String(value).startsWith("/")) return null;
  return path.join(assetRoot, String(value).slice(1));
}

function assertLocalAssets(record, assetRoot) {
  if (!assetRoot) return;
  const assets = [...record.referenceImages, ...record.previewImages];
  for (const asset of assets) {
    const file = assetPathFor(asset, assetRoot);
    if (file && !fs.existsSync(file)) throw new Error(`Missing local asset for ${record.id}: ${asset}`);
  }
}

function rawAssetStats(record, assetRoot) {
  const refs = [record && record.image, ...(Array.isArray(record && record.images) ? record.images : [])]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const stats = { total: refs.length, local: 0, http: 0, missing: 0 };
  for (const ref of refs) {
    if (/^https?:\/\//i.test(ref)) {
      stats.http += 1;
      continue;
    }
    stats.local += 1;
    const file = assetPathFor(ref, assetRoot);
    if (file && !fs.existsSync(file)) stats.missing += 1;
  }
  return stats;
}

function noteIdFor(record) {
  const match = String(record.noteUrl || "").match(/explore\/([^?]+)/);
  return match ? match[1] : record.id;
}

function assertSourceRecord(record) {
  if (!record || typeof record !== "object") throw new Error("Invalid catalog source record");
  const required = [
    ["id", record.id],
    ["title", record.title || record.sourceTitle],
    ["author", record.author],
    ["category", record.category || record.scenarioCategory],
    ["prompt", record.prompt],
    ["date", record.date || record.createdAt],
    ["image", record.image || (Array.isArray(record.images) && record.images.length ? record.images[0] : "")],
  ];
  for (const [name, value] of required) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid catalog source record ${record.id || "unknown"}: missing ${name}`);
  }
  for (const key of ["likes", "saves", "shares"]) {
    if (record[key] != null && !Number.isFinite(Number(record[key]))) {
      throw new Error(`Invalid catalog source record ${record.id}: ${key} must be numeric`);
    }
  }
}

function normalizeSourceRecord(record, sourceName, assetRoot, supplementalMetrics) {
  assertSourceRecord(record);
  const id = firstText(record.id);
  if (!id) throw new Error("Catalog record id is required");
  const images = uniqueStrings(record.images || record.referenceImages || []);
  const thumbnailUrl = firstText(record.image, record.thumbnailUrl, images[0]);
  const referenceImages = uniqueStrings(images.length ? images : [thumbnailUrl]);
  const previewImages = uniqueStrings(record.previewImages || [thumbnailUrl, ...images]);
  const prompt = firstText(record.prompt, record.subtitle, record.title);
  const metrics = {
    ...(supplementalMetrics && typeof supplementalMetrics === "object" ? supplementalMetrics : {}),
    ...(record.metrics && typeof record.metrics === "object" ? record.metrics : {}),
    likes: Number(record.likes ?? record.metrics?.likes ?? 0),
    saves: Number(record.saves ?? record.metrics?.saves ?? 0),
    shares: Number(record.shares ?? record.metrics?.shares ?? 0),
    likesText: firstText(record.likesText, record.metrics?.likesText),
    savesText: firstText(record.savesText, record.metrics?.savesText),
    sharesText: firstText(record.sharesText, record.metrics?.sharesText),
  };
  for (const key of ["likes", "saves", "shares"]) {
    if (!Number.isFinite(metrics[key])) metrics[key] = 0;
  }
  const createdAt = isoDate(record.createdAt || record.date);
  const updatedAt = isoDate(record.updatedAt || record.createdAt || record.date);
  const normalized = {
    id,
    title: firstText(record.title, record.sourceTitle, prompt, "未命名模板"),
    subtitle: firstText(record.subtitle, prompt),
    author: firstText(record.author),
    category: firstText(record.category, record.scenarioCategory, "未分类"),
    scenarioCategory: firstText(record.scenarioCategory, record.category),
    tags: uniqueStrings(record.tags || record.topics || []),
    prompt,
    referenceImages,
    previewImages,
    source: firstText(sourceName, record.source, "unknown"),
    sourceId: firstText(record.sourceId, id),
    sourceUrl: firstText(record.sourceUrl, record.noteUrl),
    thumbnailUrl,
    previewUrl: firstText(record.previewUrl, thumbnailUrl),
    useCase: firstText(record.useCase, record.category, "模板"),
    metrics,
    createdAt,
    updatedAt,
    metadata: {
      sourceTitle: firstText(record.sourceTitle, record.title),
      authorUrl: firstText(record.authorUrl),
      patternId: firstText(record.patternId),
      suggestedPatternValues: record.suggestedPatternValues || null,
      likesText: firstText(record.likesText),
      savesText: firstText(record.savesText),
      sharesText: firstText(record.sharesText),
    },
    seed: {
      templateId: id,
      prompt,
      referenceImages,
      sourceCaseId: id,
      sourceCaseCategory: firstText(record.category, record.scenarioCategory),
      sourceTitle: firstText(record.sourceTitle, record.title),
    },
  };
  assertLocalAssets(normalized, assetRoot);
  return normalized;
}

function sourceCategoryCounts(records) {
  const counts = {};
  for (const record of records) counts[record.category] = (counts[record.category] || 0) + 1;
  return Object.keys(counts).sort().reduce((result, key) => {
    result[key] = counts[key];
    return result;
  }, {});
}

function buildCatalogSnapshot({ sources, sourceRef, assetRoot, sourceCommit } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error("Catalog sources are required");
  const records = [];
  const bySource = {};
  const deduplicatedIds = [];
  const seen = new Map();
  const assetRefs = {};
  for (const source of sources) {
    const name = firstText(source && source.name, "unknown");
    if (!Array.isArray(source.records)) throw new Error(`Catalog source ${name} records are required`);
    bySource[name] = (bySource[name] || 0) + source.records.length;
    assetRefs[name] = { total: 0, local: 0, http: 0, missing: 0 };
    for (const input of source.records) {
      const stats = rawAssetStats(input, assetRoot);
      for (const key of Object.keys(stats)) assetRefs[name][key] += stats[key];
      const supplementalMetrics = source.metrics && typeof source.metrics === "object"
        ? source.metrics[noteIdFor(input)] || source.metrics[input.id]
        : null;
      const normalized = normalizeSourceRecord(input, name, assetRoot, supplementalMetrics);
      const previous = seen.get(normalized.id);
      if (previous) {
        if (stableJson(previous) !== stableJson(normalized)) {
          throw new Error(`Conflicting duplicate id: ${normalized.id}`);
        }
        deduplicatedIds.push(normalized.id);
        continue;
      }
      seen.set(normalized.id, normalized);
      records.push(normalized);
    }
  }
  records.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const checksum = catalogChecksum(records);
  const commit = firstText(sourceCommit, sourceRef, "unknown");
  const snapshot = {
    schemaVersion: 1,
    catalogVersion: `catalog-${commit.slice(0, 12)}-${checksum.slice(0, 16)}`,
    schema: "catalog.schema.json",
    source: {
      ref: firstText(sourceRef, commit),
      commit,
      inputs: sources.map((source) => ({
        name: source.name,
        count: source.records.length,
        assetRefs: assetRefs[source.name],
        ...(source.metricsRef ? { metricsRef: source.metricsRef } : {}),
      })),
    },
    counts: {
      total: records.length,
      beforeDedup: Object.values(bySource).reduce((sum, value) => sum + value, 0),
      bySource,
      byCategory: sourceCategoryCounts(records),
      assetRefs,
    },
    deduplicatedIds,
    checksum,
    records,
  };
  validateCatalog(snapshot, { assetRoot });
  return snapshot;
}

function validateCatalog(snapshot, { assetRoot, expectedCount } = {}) {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.records)) {
    throw new Error("Invalid catalog snapshot schema");
  }
  const seen = new Set();
  for (const record of snapshot.records) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in record)) throw new Error(`Catalog record ${record.id || "unknown"} is missing ${field}`);
    }
    if (!record.id || seen.has(record.id)) throw new Error(`Duplicate catalog id: ${record.id}`);
    seen.add(record.id);
    if (!Array.isArray(record.tags) || !Array.isArray(record.referenceImages) || !Array.isArray(record.previewImages)) {
      throw new Error(`Invalid catalog arrays for ${record.id}`);
    }
    assertLocalAssets(record, assetRoot);
  }
  const checksum = catalogChecksum(snapshot.records);
  if (snapshot.checksum !== checksum) throw new Error(`Catalog checksum mismatch: expected ${checksum}`);
  if (snapshot.counts?.total !== snapshot.records.length) throw new Error("Catalog record count mismatch");
  if (expectedCount != null && snapshot.records.length !== Number(expectedCount)) {
    throw new Error(`Catalog expected ${expectedCount} records, got ${snapshot.records.length}`);
  }
  return snapshot;
}

function metricNumber(record, key) {
  const value = Number(record.metrics && record.metrics[key]);
  return Number.isFinite(value) ? value : 0;
}

function interactionScore(record) {
  return metricNumber(record, "likes") + metricNumber(record, "saves") * 0.35 + metricNumber(record, "shares") * 0.45;
}

function potentialRank(record) {
  const value = Number(record.metrics && record.metrics.potentialRank);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function potentialScore(record, maxHeat) {
  const value = Number(record.metrics && record.metrics.potentialScore);
  if (Number.isFinite(value)) return value;
  return Math.max(40, Math.round((interactionScore(record) / maxHeat) * 60 + 40));
}

function compareId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function compareDate(left, right) {
  const delta = (Date.parse(right.createdAt || "") || 0) - (Date.parse(left.createdAt || "") || 0);
  return delta || compareId(left, right);
}

function sortCatalog(records, sort, universe = records) {
  const mode = sort || "default";
  const maxHeat = mode === "potential" ? Math.max(...universe.map(interactionScore), 1) : 1;
  return records.slice().sort((left, right) => {
    if (mode === "potential") {
      const score = potentialScore(right, maxHeat) - potentialScore(left, maxHeat);
      return score || potentialRank(left) - potentialRank(right) || interactionScore(right) - interactionScore(left) || compareId(left, right);
    }
    if (mode === "hot" || mode === "heat") return (metricNumber(right, "likes") + metricNumber(right, "saves")) - (metricNumber(left, "likes") + metricNumber(left, "saves")) || compareId(left, right);
    if (mode === "saves") return metricNumber(right, "saves") - metricNumber(left, "saves") || compareId(left, right);
    if (mode === "shares") return metricNumber(right, "shares") - metricNumber(left, "shares") || compareId(left, right);
    if (mode === "newest" || mode === "latest") return compareDate(left, right);
    if (mode === "default") return (metricNumber(right, "likes") + metricNumber(right, "saves")) - (metricNumber(left, "likes") + metricNumber(left, "saves")) || compareId(left, right);
    return compareId(left, right);
  });
}

function decodeCursor(cursor) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    return Number.isInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function categoryFacets(records) {
  const counts = new Map();
  for (const record of records) counts.set(record.category, (counts.get(record.category) || 0) + 1);
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((left, right) => left.value < right.value ? -1 : left.value > right.value ? 1 : 0);
}

function specialFacets(records) {
  return [{
    key: "hot",
    label: "热门高赞",
    count: records.filter((record) => metricNumber(record, "likes") >= 20000 || metricNumber(record, "saves") >= 20000).length,
  }];
}

function queryCatalog(records, options = new URLSearchParams(), version = null) {
  const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
  const limit = Math.min(Math.max(Number.parseInt(params.get("limit") || "12", 10) || 12, 1), 100);
  const cursorOffset = decodeCursor(params.get("cursor"));
  const page = Math.max(Number.parseInt(params.get("page") || "1", 10) || 1, 1);
  const category = String(params.get("category") || "").trim();
  const scenarioCategory = String(params.get("scenario_category") || params.get("scenarioCategory") || "").trim();
  const q = String(params.get("q") || params.get("keyword") || "").trim().toLowerCase();
  const tags = String(params.get("tag") || params.get("tags") || "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const hotOnly = params.get("hot") === "1" || params.get("hotOnly") === "true";
  let filtered = records.slice();
  if (category && category !== "image") filtered = filtered.filter((record) => record.category === category);
  if (scenarioCategory) filtered = filtered.filter((record) => record.category === scenarioCategory || record.scenarioCategory === scenarioCategory);
  if (tags.length) filtered = filtered.filter((record) => tags.every((tag) => record.tags.some((item) => item.toLowerCase() === tag)));
  if (hotOnly) filtered = filtered.filter((record) => metricNumber(record, "likes") >= 20000 || metricNumber(record, "saves") >= 20000);
  if (q) {
    filtered = filtered.filter((record) => [record.title, record.subtitle, record.prompt, record.author, record.category, ...record.tags]
      .filter(Boolean).join("\n").toLowerCase().includes(q));
  }
  const sorted = sortCatalog(filtered, params.get("sort") || "default", records);
  const offset = params.get("cursor") ? cursorOffset : (page - 1) * limit;
  const recordsPage = sorted.slice(offset, offset + limit);
  const hasMore = offset + recordsPage.length < sorted.length;
  return {
    catalogVersion: version ? (version.id || version.catalogVersion || "") : "",
    records: recordsPage,
    categories: categoryFacets(records),
    specialFilters: specialFacets(records),
    pagination: {
      page: params.get("cursor") ? Math.floor(offset / limit) + 1 : page,
      limit,
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / limit)),
      hasMore,
      nextCursor: hasMore ? encodeCursor(offset + recordsPage.length) : null,
    },
  };
}

async function importCatalog(store, snapshot, options = {}) {
  validateCatalog(snapshot, options);
  if (!store || typeof store.importCatalogVersion !== "function") {
    throw new TypeError("Store must implement importCatalogVersion");
  }
  return store.importCatalogVersion({
    id: snapshot.catalogVersion,
    checksum: snapshot.checksum,
    source: snapshot.source?.ref || "catalog-snapshot",
    recordCount: snapshot.records.length,
    metadata: {
      schemaVersion: snapshot.schemaVersion,
      counts: snapshot.counts,
      deduplicatedIds: snapshot.deduplicatedIds || [],
      source: snapshot.source,
    },
    records: snapshot.records,
  });
}

module.exports = {
  REQUIRED_FIELDS,
  buildCatalogSnapshot,
  catalogChecksum,
  categoryFacets,
  importCatalog,
  normalizeSourceRecord,
  queryCatalog,
  sortCatalog,
  validateCatalog,
};
