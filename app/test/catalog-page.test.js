const assert = require("node:assert/strict");
const test = require("node:test");

const pagePath = require.resolve("../pages/index/index.js");
const templatesPath = require.resolve("../services/templates.js");
const apiPath = require.resolve("../services/api.js");

function loadPage(templatesService) {
  let definition;
  delete require.cache[pagePath];
  require.cache[templatesPath] = {
    id: templatesPath,
    filename: templatesPath,
    loaded: true,
    exports: templatesService,
  };
  require.cache[apiPath] = {
    id: apiPath,
    filename: apiPath,
    loaded: true,
    exports: { isConfigured() { return true; } },
  };
  global.Page = function registerPage(value) {
    definition = value;
  };
  require(pagePath);
  return Object.assign({}, definition, {
    data: structuredClone(definition.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  });
}

function unloadPage() {
  for (const modulePath of [pagePath, templatesPath, apiPath]) delete require.cache[modulePath];
  delete global.Page;
}

test("catalog page restarts from page one when a later page changes catalog version", { concurrency: false }, async () => {
  const calls = [];
  const responses = [
    {
      catalogVersion: "catalog-v1",
      records: [{ id: "v1-page-1" }],
      categories: [],
      pagination: { page: 1, nextCursor: "v1-cursor", hasMore: true },
    },
    {
      catalogVersion: "catalog-v2",
      records: [{ id: "v2-page-2" }],
      categories: [],
      pagination: { page: 2, nextCursor: "v2-page-2-cursor", hasMore: true },
    },
    {
      catalogVersion: "catalog-v2",
      records: [{ id: "v2-page-1" }],
      categories: [],
      pagination: { page: 1, nextCursor: "v2-cursor", hasMore: true },
    },
  ];
  const service = {
    isConfigured() { return true; },
    cancelPending() {},
    listTemplates(query) {
      calls.push({ ...query });
      return Promise.resolve(responses[calls.length - 1]);
    },
  };

  try {
    const page = loadPage(service);
    await page.loadTemplates(true);
    await page.loadTemplates(false);

    assert.equal(calls.length, 3);
    assert.equal(calls[1].cursor, "v1-cursor");
    assert.equal(calls[2].page, 1);
    assert.equal(calls[2].cursor, "");
    assert.equal(page.data.catalogVersion, "catalog-v2");
    assert.deepEqual(page.data.templates.map((record) => record.id), ["v2-page-1"]);
  } finally {
    unloadPage();
  }
});
