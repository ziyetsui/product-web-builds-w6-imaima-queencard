const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { createApp } = require("../src/app");
const { createMemoryStore, createSqliteStore } = require("../src/store");
const { createPostgresStore } = require("../src/repositories/postgres-store");
const { applyPgMemSchema, createPgMemPool } = require("./support/pg-mem");
const {
  buildCatalogSnapshot,
  catalogChecksum,
  importCatalog,
  queryCatalog,
  validateCatalog,
} = require("../src/services/catalog-service");

function sourceRecord(id, overrides = {}) {
  return {
    id,
    title: `标题 ${id}`,
    subtitle: "参考首图生成同结构新主题",
    category: overrides.category || "爆款图文",
    author: "测试作者",
    date: overrides.date || "2026-08-01",
    image: overrides.image || `/landing/social-prompt-cases/${id}/01.jpg`,
    images: overrides.images || [`/landing/social-prompt-cases/${id}/01.jpg`],
    noteUrl: `https://example.com/note/${id}`,
    authorUrl: "https://example.com/author",
    topics: overrides.topics || ["测试标签"],
    likes: overrides.likes == null ? 10 : overrides.likes,
    saves: overrides.saves == null ? 5 : overrides.saves,
    shares: overrides.shares == null ? 2 : overrides.shares,
    prompt: `生成 ${id}`,
    sourceTitle: `标题 ${id}`,
  };
}

function buildFixture(records) {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-assets-"));
  for (const record of records) {
    const file = path.join(assetRoot, record.images[0].slice(1));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "fixture");
  }
  return buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [
      { name: "bo", records },
    ],
  });
}

function changedSnapshot(snapshot, change) {
  const changed = structuredClone(snapshot);
  change(changed);
  changed.checksum = catalogChecksum(changed.records);
  return changed;
}

async function catalogStores() {
  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  return [
    { name: "memory", store: createMemoryStore() },
    { name: "sqlite", store: createSqliteStore({ dbPath: ":memory:" }) },
    { name: "postgres", store: createPostgresStore({ pool }), pool },
  ];
}

test("buildCatalogSnapshot normalizes fields and calculates a reproducible checksum", () => {
  const first = buildFixture([sourceRecord("bo-1")]);
  const second = buildFixture([sourceRecord("bo-1")]);

  assert.equal(first.records.length, 1);
  assert.deepEqual(Object.keys(first.records[0]).sort(), [
    "author", "category", "createdAt", "id", "metadata", "metrics", "previewImages",
    "previewUrl", "prompt", "referenceImages", "scenarioCategory", "seed", "source",
    "sourceId", "sourceUrl", "subtitle", "tags", "thumbnailUrl", "title", "updatedAt", "useCase",
  ].sort());
  assert.equal(first.records[0].source, "bo");
  assert.deepEqual(first.records[0].tags, ["测试标签"]);
  assert.equal(first.records[0].referenceImages[0], "/landing/social-prompt-cases/bo-1/01.jpg");
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.checksum, catalogChecksum(first.records));
  assert.equal(first.source.commit, "027d145");
  assert.equal(first.counts.total, 1);
  assert.equal(first.counts.bySource.bo, 1);
  assert.equal(first.counts.assetRefs.bo.total, 2);
});

test("catalog snapshots declare the checked-in schema path", () => {
  const snapshot = buildFixture([sourceRecord("schema-path")]);
  assert.equal(snapshot.schema, "schema.json");
});

test("catalog builder deduplicates identical ids but rejects conflicting duplicate ids", () => {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-assets-"));
  const record = sourceRecord("same-id");
  const file = path.join(assetRoot, record.images[0].slice(1));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "fixture");

  const duplicate = buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [{ name: "bo", records: [record, { ...record }] }],
  });
  assert.equal(duplicate.records.length, 1);
  assert.deepEqual(duplicate.deduplicatedIds, ["same-id"]);

  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [{ name: "bo", records: [record, { ...record, title: "冲突标题" }] }],
  }), /conflicting duplicate id/i);
});

test("catalog builder rejects a broken local asset and preserves HTTP references", () => {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-assets-"));
  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [{ name: "bo", records: [sourceRecord("missing")] }],
  }), /missing local asset/i);

  const snapshot = buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [{
      name: "xhs",
      records: [sourceRecord("remote", {
        image: "https://cdn.example.com/remote.jpg",
        images: ["https://cdn.example.com/remote.jpg"],
      })],
    }],
  });
  assert.equal(snapshot.records[0].referenceImages[0], "https://cdn.example.com/remote.jpg");
});

test("catalog builder rejects invalid source records", () => {
  const invalid = sourceRecord("invalid");
  delete invalid.prompt;
  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    sources: [{ name: "bo", records: [invalid] }],
  }), /missing prompt/i);
});

test("catalog builder rejects malformed nested metrics instead of coercing them", () => {
  const invalidNumber = sourceRecord("invalid-nested-number");
  invalidNumber.metrics = { likes: "not-a-number" };
  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    sources: [{ name: "bo", records: [invalidNumber] }],
  }), /metrics\.likes/i);

  const invalidObject = sourceRecord("invalid-metrics-object");
  invalidObject.metrics = "not-an-object";
  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    sources: [{ name: "bo", records: [invalidObject] }],
  }), /metrics.*object/i);
});

test("catalog validation enforces schema, field types, dates, and metrics", () => {
  const snapshot = buildFixture([sourceRecord("strict-validation")]);
  assert.throws(() => validateCatalog(changedSnapshot(snapshot, (value) => {
    value.schema = "wrong.json";
  })), /schema/i);
  assert.throws(() => validateCatalog(changedSnapshot(snapshot, (value) => {
    value.records[0].createdAt = "not-a-date";
  })), /createdAt|date/i);
  assert.throws(() => validateCatalog(changedSnapshot(snapshot, (value) => {
    value.records[0].metrics.likes = "not-a-number";
  })), /metrics|schema/i);
  assert.throws(() => validateCatalog(changedSnapshot(snapshot, (value) => {
    value.records[0].metrics = "not-an-object";
  })), /metrics|schema/i);
});

test("catalog builder rejects traversal and symlink escapes outside assetRoot", () => {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-contained-"));
  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [{ name: "bo", records: [sourceRecord("traversal", {
      image: "/../../etc/passwd",
      images: ["/../../etc/passwd"],
    })] }],
  }), /asset.*root|escape|traversal/i);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-outside-"));
  fs.writeFileSync(path.join(outside, "outside.jpg"), "outside");
  fs.symlinkSync(outside, path.join(assetRoot, "escape"));
  assert.throws(() => buildCatalogSnapshot({
    sourceRef: "027d145",
    assetRoot,
    sources: [{ name: "bo", records: [sourceRecord("symlink", {
      image: "/escape/outside.jpg",
      images: ["/escape/outside.jpg"],
    })] }],
  }), /asset.*root|escape|symlink/i);
});

test("catalog source import never evaluates executable TypeScript expressions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-parser-"));
  const marker = path.join(root, "executed.txt");
  const boSource = path.join(root, "bo.ts");
  const xhsSource = path.join(root, "xhs.ts");
  const output = path.join(root, "catalog.json");
  const record = sourceRecord("malicious", {
    image: "https://cdn.example.com/malicious.jpg",
    images: ["https://cdn.example.com/malicious.jpg"],
  });
  fs.writeFileSync(boSource, `export const boLandingPromptCases = [\n  (this.constructor.constructor("return process")().getBuiltinModule("fs").writeFileSync(${JSON.stringify(marker)}, "owned"), ${JSON.stringify(record)})\n];\n`);
  fs.writeFileSync(xhsSource, "export const xhsPromptCases = [];\n");

  const result = childProcess.spawnSync(process.execPath, [
    path.resolve(__dirname, "../scripts/build-template-catalog.js"),
    "--source-ref", "malicious-ref",
    "--bo-source", boSource,
    "--xhs-source", xhsSource,
    "--asset-root", root,
    "--output", output,
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(marker), false);
});

test("catalog builder carries XHS potential metrics by note id", () => {
  const record = sourceRecord("mini-id", {
    image: "https://cdn.example.com/mini.jpg",
    images: ["https://cdn.example.com/mini.jpg"],
  });
  record.noteUrl = "https://www.xiaohongshu.com/explore/metric-id?x=1";
  const snapshot = buildCatalogSnapshot({
    sourceRef: "027d145",
    sources: [{ name: "xhs", records: [record], metrics: {
      "metric-id": { potentialScore: 99, potentialRank: 1, followers: 100 },
    } }],
  });
  assert.equal(snapshot.records[0].metrics.potentialScore, 99);
  assert.equal(snapshot.records[0].metrics.potentialRank, 1);
});

test("catalog default matches Web hot ordering, latest stays date ordering, and hot filter uses likes-or-saves", () => {
  const snapshot = buildFixture([
    sourceRecord("hot-likes", { date: "2020-01-01", likes: 20000, saves: 0 }),
    sourceRecord("hot-saves", { date: "2021-01-01", likes: 0, saves: 20000 }),
    sourceRecord("regular", { date: "2026-01-01", likes: 10, saves: 10 }),
  ]);
  assert.deepEqual(queryCatalog(snapshot.records, new URLSearchParams({ sort: "default", limit: "10" })).records.map((record) => record.id), [
    "hot-likes", "hot-saves", "regular",
  ]);
  assert.deepEqual(queryCatalog(snapshot.records, new URLSearchParams({ sort: "latest", limit: "10" })).records.map((record) => record.id), [
    "regular", "hot-saves", "hot-likes",
  ]);
  assert.deepEqual(queryCatalog(snapshot.records, new URLSearchParams({ hot: "1", sort: "default", limit: "10" })).records.map((record) => record.id), [
    "hot-likes", "hot-saves",
  ]);
});

test("potential ordering follows potential score, rank, then weighted interactions", () => {
  const snapshot = buildFixture([
    sourceRecord("score-high", { likes: 1, saves: 1, shares: 1 }),
    sourceRecord("rank-high", { likes: 1, saves: 1, shares: 1 }),
    sourceRecord("interaction-high", { likes: 10, saves: 10, shares: 100 }),
  ]);
  const byId = Object.fromEntries(snapshot.records.map((record) => [record.id, record]));
  byId["score-high"].metrics = { potentialScore: 10, potentialRank: 2, likes: 1, saves: 1, shares: 1 };
  byId["rank-high"].metrics = { potentialScore: 10, potentialRank: 1, likes: 1, saves: 1, shares: 1 };
  byId["interaction-high"].metrics = { potentialScore: 9, potentialRank: 1, likes: 10, saves: 10, shares: 100 };
  assert.deepEqual(queryCatalog(snapshot.records, new URLSearchParams({ sort: "potential", limit: "10" })).records.map((record) => record.id), [
    "rank-high", "score-high", "interaction-high",
  ]);
});

test("catalog import switches active version only after complete validation", async () => {
  const store = createMemoryStore();
  const initial = buildFixture([sourceRecord("old")]);
  const next = buildFixture([sourceRecord("new")]);
  await importCatalog(store, initial);

  const invalid = {
    ...next,
    records: [{ ...next.records[0], title: "改坏的数据" }],
  };
  await assert.rejects(importCatalog(store, invalid), /checksum/i);
  assert.equal((await store.getActiveCatalogVersion()).id, initial.catalogVersion);
  assert.equal((await store.getTemplate("old")).id, "old");
  assert.equal(await store.getTemplate("new"), null);
});

test("memory and sqlite adapters expose the same versioned catalog contract", async () => {
  const snapshot = buildFixture([sourceRecord("contract")]);
  const sqlite = createSqliteStore({ dbPath: ":memory:" });
  for (const store of [createMemoryStore(), sqlite]) {
    await importCatalog(store, snapshot);
    const active = await store.getActiveCatalogVersion();
    assert.equal(active.id, snapshot.catalogVersion);
    assert.equal(active.recordCount, 1);
    assert.equal((await store.listTemplates(new URLSearchParams({ limit: "1" }))).catalogVersion, snapshot.catalogVersion);
    await store.close();
  }
});

test("SQLite migrates the previously shipped global template id key without losing rows", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-old-sqlite-"));
  const dbPath = path.join(root, "miniapp.sqlite");
  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(`
    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      catalog_version_id TEXT,
      title TEXT NOT NULL,
      subtitle TEXT,
      category TEXT,
      scenario_category TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      source_id TEXT,
      source_url TEXT,
      thumbnail_url TEXT,
      preview_url TEXT,
      reference_images_json TEXT NOT NULL,
      preview_images_json TEXT NOT NULL DEFAULT '[]',
      prompt TEXT,
      use_case TEXT,
      author TEXT,
      metrics_json TEXT,
      seed_json TEXT,
      created_at TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO templates (id, title, reference_images_json, updated_at)
    VALUES ('legacy-template', 'Legacy title', '[]', '2026-08-01T00:00:00.000Z');
  `);
  oldDb.close();

  const store = createSqliteStore({ dbPath });
  assert.equal((await store.getTemplate("legacy-template")).title, "Legacy title");
  await store.close();

  const migratedDb = new DatabaseSync(dbPath);
  const idColumn = migratedDb.prepare("PRAGMA table_info(templates)").all().find((column) => column.name === "id");
  assert.equal(Number(idColumn.pk), 0);
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM templates WHERE id = 'legacy-template'").get().count, 1);
  migratedDb.close();
});

test("all catalog adapters preserve overlapping ids when rolling back versions", async () => {
  const recordA = sourceRecord("shared-template");
  recordA.title = "Version A";
  recordA.sourceTitle = "Version A";
  const recordB = sourceRecord("shared-template");
  recordB.title = "Version B";
  recordB.sourceTitle = "Version B";
  const snapshotA = buildFixture([recordA]);
  const snapshotB = buildFixture([recordB]);
  const stores = await catalogStores();

  for (const entry of stores) {
    await importCatalog(entry.store, snapshotA);
    await importCatalog(entry.store, snapshotB);
    await entry.store.activateCatalogVersion(snapshotA.catalogVersion);
    const listed = await entry.store.listTemplates(new URLSearchParams({ limit: "10" }));
    assert.equal(listed.records.length, 1, entry.name);
    assert.equal(listed.records[0].title, "Version A", entry.name);
    assert.equal((await entry.store.getTemplate("shared-template")).title, "Version A", entry.name);
    await entry.store.close();
    if (entry.pool) await entry.pool.end();
  }
});

test("all catalog adapters reject activation of incomplete versions", async () => {
  const snapshot = buildFixture([sourceRecord("complete-template")]);
  const stores = await catalogStores();

  for (const entry of stores) {
    await importCatalog(entry.store, snapshot);
    await entry.store.createCatalogVersion({
      id: "incomplete-version",
      checksum: "1".repeat(64),
      source: "test",
      recordCount: 1,
    });
    await assert.rejects(
      Promise.resolve().then(() => entry.store.activateCatalogVersion("incomplete-version")),
      /incomplete|record count/i,
      entry.name,
    );
    assert.equal((await entry.store.getActiveCatalogVersion()).id, snapshot.catalogVersion, entry.name);
    await entry.store.close();
    if (entry.pool) await entry.pool.end();
  }
});

test("all catalog adapters reject activation when persisted rows do not match the version checksum", async () => {
  const snapshot = buildFixture([sourceRecord("checksum-template")]);
  const stores = await catalogStores();

  for (const entry of stores) {
    await importCatalog(entry.store, snapshot);
    await entry.store.createCatalogVersion({
      id: "checksum-mismatch-version",
      checksum: "0".repeat(64),
      source: "test",
      recordCount: 1,
    });
    await entry.store.syncTemplates(
      [{ ...snapshot.records[0], catalogVersionId: "checksum-mismatch-version" }],
      { catalogVersionId: "checksum-mismatch-version" },
    );
    await assert.rejects(
      Promise.resolve().then(() => entry.store.activateCatalogVersion("checksum-mismatch-version")),
      /checksum/i,
      entry.name,
    );
    assert.equal((await entry.store.getActiveCatalogVersion()).id, snapshot.catalogVersion, entry.name);
    await entry.store.close();
    if (entry.pool) await entry.pool.end();
  }
});

test("all catalog adapters can sync and activate a checksummed version without mutating records", async () => {
  const snapshot = buildFixture([sourceRecord("synced-template")]);
  const versionId = "synced-version";
  const stores = await catalogStores();

  for (const entry of stores) {
    await entry.store.createCatalogVersion({
      id: versionId,
      checksum: snapshot.checksum,
      source: "test",
      recordCount: snapshot.records.length,
    });
    await entry.store.syncTemplates(snapshot.records, { catalogVersionId: versionId });
    await entry.store.activateCatalogVersion(versionId);
    const state = await entry.store.getCatalogVersionState(versionId);
    assert.equal(state.complete, true, entry.name);
    assert.equal((await entry.store.listTemplates(new URLSearchParams())).records[0].updatedAt, snapshot.records[0].updatedAt, entry.name);
    await entry.store.close();
    if (entry.pool) await entry.pool.end();
  }
});

test("app initialization atomically repairs an incomplete active snapshot version", async () => {
  const snapshot = buildFixture([sourceRecord("startup-repair")]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-startup-"));
  const dbPath = path.join(root, "miniapp.sqlite");
  const migrated = createSqliteStore({ dbPath });
  await migrated.close();
  const raw = new DatabaseSync(dbPath);
  raw.prepare(`
    INSERT INTO template_catalog_versions
      (id, checksum, source, record_count, active, metadata_json, created_at, activated_at)
    VALUES (?, ?, ?, ?, 1, '{}', ?, ?)
  `).run(snapshot.catalogVersion, snapshot.checksum, "corrupt-test", snapshot.records.length, new Date().toISOString(), new Date().toISOString());
  raw.close();

  const store = createSqliteStore({ dbPath });
  const app = createApp({
    store,
    catalogSnapshot: snapshot,
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", WECHAT_MINIAPP_APP_ID: "wx-test" },
  });
  assert.equal(typeof app.initialize, "function");
  await app.initialize();
  const listed = await store.listTemplates(new URLSearchParams({ limit: "10" }));
  assert.equal(listed.catalogVersion, snapshot.catalogVersion);
  assert.equal(listed.pagination.total, 1);
  assert.equal(listed.records[0].id, "startup-repair");
  await app.close();
});

test("app initialization repairs mismatched active checksum and declared count", async () => {
  const snapshot = buildFixture([sourceRecord("startup-metadata-repair")]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ima-catalog-startup-metadata-"));
  const dbPath = path.join(root, "miniapp.sqlite");
  const initialStore = createSqliteStore({ dbPath });
  await importCatalog(initialStore, snapshot);
  await initialStore.close();

  const raw = new DatabaseSync(dbPath);
  raw.prepare("UPDATE template_catalog_versions SET checksum = ?, record_count = ? WHERE id = ?")
    .run("0".repeat(64), 99, snapshot.catalogVersion);
  raw.close();

  const store = createSqliteStore({ dbPath });
  const app = createApp({
    store,
    catalogSnapshot: snapshot,
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", WECHAT_MINIAPP_APP_ID: "wx-test" },
  });
  await app.initialize();
  const active = await store.getActiveCatalogVersion();
  const state = await store.getCatalogVersionState(snapshot.catalogVersion);
  assert.equal(active.checksum, snapshot.checksum);
  assert.equal(active.recordCount, snapshot.records.length);
  assert.equal(state.complete, true);
  await app.close();
});

test("postgres adapter imports and activates a complete catalog in one store contract", async () => {
  const { pool } = createPgMemPool();
  await applyPgMemSchema(pool);
  const store = createPostgresStore({ pool, clock: () => new Date("2026-08-03T00:00:00.000Z") });
  const snapshot = buildFixture([sourceRecord("postgres")]);
  const active = await importCatalog(store, snapshot);
  assert.equal(active.id, snapshot.catalogVersion);
  assert.equal((await store.getActiveCatalogVersion()).recordCount, 1);
  assert.equal((await store.listTemplates(new URLSearchParams({ limit: "1" }))).records[0].id, "postgres");
  await assert.rejects(store.activateCatalogVersion("missing-version"), /not found/i);
  assert.equal((await store.getActiveCatalogVersion()).id, snapshot.catalogVersion);
  await store.close();
});

test("template API exposes version, facet counts, tags, keyword, deterministic sorts, and page/cursor pagination", async () => {
  const records = [
    sourceRecord("a", { category: "爆款图文", date: "2026-08-01", likes: 10, saves: 1, shares: 1 }),
    sourceRecord("b", { category: "梗图", date: "2026-08-03", likes: 30, saves: 2, shares: 1, topics: ["目标标签"] }),
    sourceRecord("c", { category: "梗图", date: "2026-08-02", likes: 5, saves: 50, shares: 1 }),
    sourceRecord("d", { category: "公众号配图", date: "2026-07-01", likes: 3, saves: 1, shares: 90 }),
  ];
  const store = createMemoryStore();
  const snapshot = buildFixture(records);
  await importCatalog(store, snapshot);
  const app = createApp({
    store,
    catalogSnapshot: false,
    env: { NODE_ENV: "test", MINIAPP_DEV_LOGIN: "1", WECHAT_MINIAPP_APP_ID: "wx-test" },
  });

  const read = async (query) => (await app.fetch(new Request(`http://local/api/miniapp/templates?${query}`))).json();
  const first = await read("limit=2&sort=latest");
  assert.equal(first.data.catalogVersion, snapshot.catalogVersion);
  assert.deepEqual(first.data.records.map((record) => record.id), ["b", "c"]);
  const defaultOrder = await read("limit=4&sort=default");
  assert.deepEqual(defaultOrder.data.records.map((record) => record.id), ["c", "b", "a", "d"]);
  assert.deepEqual(first.data.categories, [
    { value: "公众号配图", label: "公众号配图", count: 1 },
    { value: "梗图", label: "梗图", count: 2 },
    { value: "爆款图文", label: "爆款图文", count: 1 },
  ]);
  assert.deepEqual(first.data.specialFilters, [{ key: "hot", label: "热门高赞", count: 0 }]);
  assert.equal(first.data.pagination.total, 4);
  assert.equal(typeof first.data.pagination.nextCursor, "string");

  const second = await read(`limit=2&sort=latest&cursor=${encodeURIComponent(first.data.pagination.nextCursor)}`);
  assert.deepEqual(second.data.records.map((record) => record.id), ["a", "d"]);
  assert.equal(new Set(first.data.records.concat(second.data.records).map((record) => record.id)).size, 4);

  const hot = await read("limit=4&sort=hot");
  assert.deepEqual(hot.data.records.map((record) => record.id), ["c", "b", "a", "d"]);
  const potential = await read("limit=4&sort=potential");
  assert.deepEqual(potential.data.records.map((record) => record.id), ["d", "b", "c", "a"]);
  const filtered = await read("limit=10&category=%E6%A2%97%E5%9B%BE&tag=%E7%9B%AE%E6%A0%87%E6%A0%87%E7%AD%BE&keyword=生成");
  assert.deepEqual(filtered.data.records.map((record) => record.id), ["b"]);
  assert.equal(filtered.data.pagination.total, 1);
  await app.close();
});
