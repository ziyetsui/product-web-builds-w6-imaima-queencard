const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { main } = require("../scripts/smoke-deployment");
const { runDeploymentSmoke } = require("../src/services/deployment-smoke");

function templateRecord(overrides = {}) {
  return {
    id: "template-1",
    title: "A valid template",
    author: "Test author",
    category: "memes",
    tags: ["test"],
    prompt: "Create a test template",
    referenceImages: ["/reference.jpg"],
    previewImages: ["/preview.jpg"],
    source: "bo",
    metrics: {
      likes: 1,
      saves: 2,
      shares: 3,
      likesText: "1",
      savesText: "2",
      sharesText: "3",
    },
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function metadataRecord(overrides = {}) {
  return {
    sourceTitle: "A valid template",
    authorUrl: "https://example.test/author",
    patternId: "pattern-1",
    suggestedPatternValues: null,
    likesText: "1",
    savesText: "2",
    sharesText: "3",
    ...overrides,
  };
}

function seedRecord(overrides = {}) {
  return {
    templateId: "template-1",
    prompt: "Create a test template",
    referenceImages: ["/reference.jpg"],
    sourceCaseId: "case-1",
    sourceCaseCategory: "memes",
    sourceTitle: "A valid template",
    ...overrides,
  };
}

function pricingBody(overrides = {}) {
  return {
    success: true,
    data: {
      currency: "CNY",
      packs: [{
        id: "credits_20",
        type: "pack",
        title: "20 credit pack",
        subtitle: "For light use",
        credits: 20,
        amountCents: 1900,
        currency: "CNY",
        badge: "",
      }],
      subscriptions: [{
        id: "sub_monthly_200",
        type: "subscription",
        title: "Monthly Pro",
        subtitle: "200 monthly credits",
        credits: 200,
        amountCents: 12900,
        currency: "CNY",
        interval: "month",
        badge: "pro",
      }],
      payment: {
        mode: "manual",
        available: false,
      },
      ...overrides,
    },
  };
}

function healthyHealth(overrides = {}) {
  return {
    success: true,
    data: {
      ok: true,
      buildSha: "abc123def456",
      environment: "production",
      dependencies: {
        database: { ready: true },
        storage: { ready: true },
        workers: { ready: true },
      },
      ...overrides,
    },
  };
}

function defaultRoutes() {
  return {
    "/health": { status: 200, body: healthyHealth() },
    "/api/miniapp/templates": {
      status: 200,
      body: { success: true, data: { records: [templateRecord()] } },
    },
    "/api/miniapp/models": {
      status: 200,
      body: {
        success: true,
        data: {
          defaultModel: "gpt-image-2",
          models: [{ key: "gpt-image-2", enabled: true }],
        },
      },
    },
    "/api/miniapp/auth/me": {
      status: 401,
      body: { success: false, error: "Authentication required" },
    },
    "/api/miniapp/pricing": {
      status: 200,
      body: pricingBody(),
    },
  };
}

function sendRoute(response, res) {
  if (response.redirect) {
    res.writeHead(response.status || 302, { location: response.redirect });
    res.end();
    return;
  }

  const headers = {};
  if (response.contentType !== null) headers["content-type"] = response.contentType || "application/json";
  const body = response.raw !== undefined ? response.raw : JSON.stringify(response.body);
  res.writeHead(response.status || 200, headers);
  res.end(body);
}

async function withServer(overrides, callback) {
  const routes = { ...defaultRoutes(), ...overrides };
  const server = http.createServer((req, res) => {
    const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
    const route = routes[path];
    if (typeof route === "function") {
      route(req, res);
      return;
    }
    sendRoute(route || { status: 404, body: { success: false } }, res);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  const fetchImpl = async (input, options = {}) => {
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal);
    const target = new URL(input);
    target.protocol = "http:";
    target.hostname = "127.0.0.1";
    target.port = String(port);
    return fetch(target, options);
  };

  try {
    return await callback({
      baseUrl: `https://smoke.test:${port}/`,
      fetchImpl,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function checkFor(result, name) {
  return result.checks.find((check) => check.name === name);
}

test("passes all deployment smoke checks for a ready payment-disabled deployment", async () => {
  const result = await withServer({}, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((check) => check.name), [
    "/health",
    "/api/miniapp/templates",
    "/api/miniapp/models",
    "/api/miniapp/auth/me",
    "/api/miniapp/pricing",
  ]);
  for (const check of result.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["detail", "name", "ok", "status"]);
    assert.equal(check.ok, true);
  }
  assert.equal(checkFor(result, "/health").status, 200);
  assert.equal(checkFor(result, "/api/miniapp/auth/me").status, 401);
});

test("rejects HTTP, malformed, and credential-bearing base URLs before making requests", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("network should not be called");
  };

  for (const baseUrl of ["http://example.test", "not a URL", "https://user:password@example.test/"]) {
    const result = await runDeploymentSmoke({ baseUrl, fetchImpl });
    assert.equal(result.ok, false, baseUrl);
    assert.equal(result.checks.length, 1, baseUrl);
    assert.equal(result.checks[0].name, "base-url", baseUrl);
    assert.equal(result.checks[0].status, null, baseUrl);
  }
  assert.equal(calls, 0);
});

test("rejects a cross-host redirect without following it", async () => {
  const result = await withServer({
    "/health": { status: 302, redirect: "https://other.example/health" },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.equal(checkFor(result, "/health").ok, false);
  assert.equal(checkFor(result, "/health").status, 302);
  assert.match(checkFor(result, "/health").detail, /redirect/i);
});

test("fails when health responds with HTTP 503 without including its response body", async () => {
  const result = await withServer({
    "/health": {
      status: 503,
      body: { secret: "health-response-token", success: false },
    },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.equal(checkFor(result, "/health").status, 503);
  assert.doesNotMatch(JSON.stringify(result), /health-response-token/);
});

test("fails when health exposes a placeholder build SHA", async () => {
  const result = await withServer({
    "/health": { status: 200, body: healthyHealth({ buildSha: "replace-with-source-commit-sha" }) },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.equal(checkFor(result, "/health").status, 200);
  assert.match(checkFor(result, "/health").detail, /build sha/i);
});

test("fails when the template catalog is empty", async () => {
  const result = await withServer({
    "/api/miniapp/templates": { status: 200, body: { success: true, data: { records: [] } } },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.match(checkFor(result, "/api/miniapp/templates").detail, /template/i);
});

test("fails when the template catalog contains malformed records", async () => {
  for (const records of [[null], ["not-a-template"], [templateRecord({ title: "" })]]) {
    const result = await withServer({
      "/api/miniapp/templates": { status: 200, body: { success: true, data: { records } } },
    }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

    assert.equal(result.ok, false);
    const check = checkFor(result, "/api/miniapp/templates");
    assert.equal(check.ok, false);
    assert.match(check.detail, /template|record|field/i);
  }
});

test("accepts documented optional template DTO fields", async () => {
  const record = templateRecord({
    subtitle: "Optional subtitle",
    scenarioCategory: "memes",
    sourceId: "source-1",
    sourceUrl: "https://example.test/source",
    thumbnailUrl: "https://example.test/thumbnail.jpg",
    previewUrl: "https://example.test/preview.jpg",
    useCase: "social post",
    metrics: { ...templateRecord().metrics, isPotentialHit: false },
    metadata: metadataRecord({ suggestedPatternValues: { tone: "bright" } }),
    seed: seedRecord(),
  });
  const result = await withServer({
    "/api/miniapp/templates": { status: 200, body: { success: true, data: { records: [record] } } },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, true);
  assert.equal(checkFor(result, "/api/miniapp/templates").ok, true);
});

test("rejects malformed optional template DTO fields", async () => {
  const valid = templateRecord();
  const malformedRecords = [
    templateRecord({ metrics: { ...valid.metrics, isPotentialHit: "yes" } }),
    templateRecord({ metadata: [] }),
    templateRecord({ metadata: metadataRecord({ likesText: 7 }) }),
    templateRecord({ metadata: metadataRecord({ suggestedPatternValues: [] }) }),
    templateRecord({ metadata: metadataRecord({ unexpected: true }) }),
    templateRecord({ seed: [] }),
    templateRecord({ seed: seedRecord({ referenceImages: [null] }) }),
    templateRecord({ seed: seedRecord({ sourceTitle: 7 }) }),
    templateRecord({ subtitle: 42 }),
    templateRecord({ thumbnailUrl: {} }),
  ];

  for (const record of malformedRecords) {
    const result = await withServer({
      "/api/miniapp/templates": { status: 200, body: { success: true, data: { records: [record] } } },
    }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

    assert.equal(result.ok, false);
    assert.equal(checkFor(result, "/api/miniapp/templates").ok, false);
  }
});

test("fails when template records violate catalog date, array-item, or metric constraints", async () => {
  const malformedRecords = [
    templateRecord({ createdAt: "not-a-date" }),
    templateRecord({ tags: [null] }),
    templateRecord({ metrics: { ...templateRecord().metrics, likes: -1 } }),
  ];

  for (const record of malformedRecords) {
    const result = await withServer({
      "/api/miniapp/templates": { status: 200, body: { success: true, data: { records: [record] } } },
    }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

    assert.equal(result.ok, false);
    assert.equal(checkFor(result, "/api/miniapp/templates").ok, false);
  }
});

test("fails when GPT Image 2 is not the enabled default model", async () => {
  const result = await withServer({
    "/api/miniapp/models": {
      status: 200,
      body: {
        success: true,
        data: {
          defaultModel: "seedream-5.0",
          models: [{ key: "gpt-image-2", enabled: true }, { key: "seedream-5.0", enabled: true }],
        },
      },
    },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.match(checkFor(result, "/api/miniapp/models").detail, /gpt image 2/i);
});

test("fails when the protected auth endpoint does not return 401 without a token", async () => {
  const result = await withServer({
    "/api/miniapp/auth/me": { status: 200, body: { success: true, data: { user: { id: "dev-user" } } } },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.equal(checkFor(result, "/api/miniapp/auth/me").status, 200);
  assert.match(checkFor(result, "/api/miniapp/auth/me").detail, /401|authentication/i);
});

test("fails when pricing reports payment availability in the disabled smoke profile", async () => {
  const result = await withServer({
    "/api/miniapp/pricing": {
      status: 200,
      body: pricingBody({ payment: { available: true, mode: "mock" } }),
    },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.match(checkFor(result, "/api/miniapp/pricing").detail, /disabled|available/i);
});

test("fails when pricing omits required products or product fields", async () => {
  const malformedBodies = [
    pricingBody({ packs: [{ id: "credits_20", type: "pack" }] }),
    pricingBody({ payment: { available: false } }),
  ];

  for (const body of malformedBodies) {
    const result = await withServer({
      "/api/miniapp/pricing": { status: 200, body },
    }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

    assert.equal(result.ok, false);
    const check = checkFor(result, "/api/miniapp/pricing");
    assert.equal(check.ok, false);
    assert.match(check.detail, /pricing|product|payment/i);
  }
});

test("accepts documented payment-disabled pricing with empty product groups", async () => {
  const result = await withServer({
    "/api/miniapp/pricing": {
      status: 200,
      body: pricingBody({ packs: [], subscriptions: [] }),
    },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, true);
  assert.equal(checkFor(result, "/api/miniapp/pricing").ok, true);
});

test("fails a timed-out endpoint with its name and no response-body dump", async () => {
  const result = await withServer({
    "/api/miniapp/templates": (_req, res) => {
      setTimeout(() => sendRoute({
        status: 200,
        body: { secret: "timeout-response-token", success: true, data: { records: [{ id: "late" }] } },
      }, res), 100);
    },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl, timeoutMs: 15 }));

  assert.equal(result.ok, false);
  const check = checkFor(result, "/api/miniapp/templates");
  assert.equal(check.ok, false);
  assert.match(check.detail, /timed out|timeout/i);
  assert.doesNotMatch(JSON.stringify(result), /timeout-response-token/);
});

test("normalizes a fractional timeout into a bounded request instead of throwing", async () => {
  const result = await withServer({
    "/api/miniapp/templates": (_req, res) => {
      setTimeout(() => sendRoute({
        status: 200,
        body: { success: true, data: { records: [{ id: "late" }] } },
      }, res), 100);
    },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl, timeoutMs: 5.5 }));

  assert.equal(result.ok, false);
  assert.match(checkFor(result, "/api/miniapp/templates").detail, /timed out|timeout/i);
});

test("normalizes a finite timeout above the AbortSignal platform limit", async () => {
  const result = await withServer({}, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({
    baseUrl,
    fetchImpl,
    timeoutMs: Number.MAX_SAFE_INTEGER,
  }));

  assert.equal(result.ok, true);
});

test("rejects malformed JSON after checking the successful response content type", async () => {
  const result = await withServer({
    "/api/miniapp/templates": { status: 200, raw: "not-json secret-response-body" },
  }, ({ baseUrl, fetchImpl }) => runDeploymentSmoke({ baseUrl, fetchImpl }));

  assert.equal(result.ok, false);
  assert.match(checkFor(result, "/api/miniapp/templates").detail, /json/i);
  assert.doesNotMatch(JSON.stringify(result), /secret-response-body/);
});

test("CLI returns success and prints passing check output", async () => {
  const output = [];
  const errors = [];
  const exitCode = await main({
    argv: ["https://smoke.test"],
    runSmoke: async ({ baseUrl }) => {
      assert.equal(baseUrl, "https://smoke.test");
      return { ok: true, checks: [{ name: "/health", ok: true, detail: "ready", status: 200 }] };
    },
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(output, ["PASS /health: ready"]);
  assert.deepEqual(errors, []);
});

test("CLI returns failure and prints only safe failed check output", async () => {
  const output = [];
  const errors = [];
  const exitCode = await main({
    argv: ["https://smoke.test"],
    runSmoke: async () => ({
      ok: false,
      checks: [{ name: "/api/miniapp/templates", ok: false, detail: "template record is malformed", status: 200 }],
    }),
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(output, ["FAIL /api/miniapp/templates: template record is malformed"]);
  assert.deepEqual(errors, []);
});
