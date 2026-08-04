const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createServer, installSignalHandlers } = require("../src/server");

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    BUILD_SHA: "build-runtime-test",
    PORT: "0",
    MINIAPP_BACKEND_HOST: "127.0.0.1",
    MINIAPP_DEV_LOGIN: "0",
    DATABASE_URL: "postgres://runtime-user:runtime-password@db.example/miniapp",
    STORAGE_PROVIDER: "s3",
    STORAGE_ENDPOINT: "https://s3.example.com",
    STORAGE_BUCKET: "miniapp-assets",
    STORAGE_ACCESS_KEY_ID: "runtime-access-key",
    STORAGE_SECRET_ACCESS_KEY: "runtime-storage-secret",
    MINIAPP_ASSET_SIGNING_SECRET: "runtime-asset-signing-secret",
    WECHAT_MINIAPP_APP_ID: "wx-runtime",
    WECHAT_MINIAPP_APP_SECRET: "runtime-wechat-secret",
    GENERATION_WORKER_MODE: "durable",
    PAYMENT_PROVIDER: "disabled",
    MINIAPP_PAYMENT_MODE: "manual",
    ...overrides,
  };
}

function quietLogger() {
  return {
    log() {},
    error() {},
  };
}

function storageAdapter(overrides = {}) {
  return {
    ready: true,
    async put() {},
    async head() {},
    async getSignedDownloadUrl() {},
    async delete() {},
    close() {},
    ...overrides,
  };
}

function addressFor(runtime) {
  const address = runtime.server.address();
  return `http://127.0.0.1:${address.port}`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("runtime waits for application initialization before accepting traffic", async () => {
  const initialization = deferred();
  let initializeCalls = 0;
  const app = {
    fetch: () => Response.json({ success: true }),
    initialize() {
      initializeCalls += 1;
      return initialization.promise;
    },
  };

  let resolved = false;
  const runtimePromise = createServer({
    env: { NODE_ENV: "test", PORT: "0", MINIAPP_BACKEND_HOST: "127.0.0.1" },
    app,
    dependencies: { store: { ready: true } },
    logger: quietLogger(),
  }).then((runtime) => {
    resolved = true;
    return runtime;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(initializeCalls, 1);
  assert.equal(resolved, false);

  initialization.resolve();
  const runtime = await runtimePromise;
  await runtime.shutdown();
});

test("health returns 503 and dependency details while any runtime dependency is unready", async (t) => {
  const runtime = await createServer({
    env: { NODE_ENV: "test", PORT: "0", MINIAPP_BACKEND_HOST: "127.0.0.1" },
    app: { fetch: () => Response.json({ success: true }) },
    dependencies: {
      store: { ready: true },
      storage: { ready: false },
      workers: { ready: true },
    },
    logger: quietLogger(),
  });
  t.after(() => runtime.shutdown());
  await runtime.listen();

  const response = await fetch(`${addressFor(runtime)}/health`);
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.success, false);
  assert.equal(payload.data.ok, false);
  assert.deepEqual(payload.data.dependencies.storage, { ready: false, driver: "local" });
});

test("fully configured production listens when its runtime adapters are injected", async (t) => {
  const created = [];
  let storeCloseCalls = 0;
  const store = {
    ready: true,
    close() {
      storeCloseCalls += 1;
    },
  };
  const storage = storageAdapter();
  const runtime = await createServer({
    env: productionEnv({ GPTPROTO_API_KEY: "runtime-provider-api-key" }),
    factories: {
      createStore() {
        created.push("store");
        return store;
      },
      createStorage() {
        created.push("storage");
        return storage;
      },
    },
    dependencies: {
      workers: { ready: true, stop() {} },
    },
    logger: quietLogger(),
  });
  t.after(() => runtime.shutdown());
  await runtime.listen();
  const response = await fetch(`${addressFor(runtime)}/health`);
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.buildSha, "build-runtime-test");
  assert.deepEqual(payload.data.build, { ready: true, sha: "build-runtime-test" });
  for (const secret of [
    "postgres://runtime-user:runtime-password@db.example/miniapp",
    "https://s3.example.com",
    "miniapp-assets",
    "runtime-wechat-secret",
    "runtime-provider-api-key",
    "runtime-asset-signing-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, `health response leaked ${secret}`);
  }
  assert.deepEqual(created, ["store", "storage"]);
  await runtime.shutdown();
  assert.equal(storeCloseCalls, 1);
});

test("health returns 503 with BUILD_NOT_SET while preserving ready dependency details", async (t) => {
  const runtime = await createServer({
    env: productionEnv({
      BUILD_SHA: "replace-with-source-commit-sha",
      GPTPROTO_API_KEY: "runtime-provider-api-key",
    }),
    factories: {
      createStore() {
        return { ready: true };
      },
      createStorage() {
        return storageAdapter();
      },
    },
    dependencies: {
      workers: { ready: true, stop() {} },
    },
    logger: quietLogger(),
  });
  t.after(() => runtime.shutdown());
  await runtime.listen();

  const response = await fetch(`${addressFor(runtime)}/health`);
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.success, false);
  assert.equal(payload.data.ok, false);
  assert.equal(payload.data.build.ready, false);
  assert.equal(payload.data.build.reason, "BUILD_NOT_SET");
  assert.deepEqual(payload.data.dependencies, {
    database: { ready: true, driver: "postgres" },
    storage: { ready: true, driver: "s3" },
    workers: { ready: true, mode: "durable" },
  });
});

test("shutdown waits for the internally owned asynchronous store close exactly once", async () => {
  const closeStarted = deferred();
  const allowCloseToFinish = deferred();
  let closeCalls = 0;
  let closeFinished = false;
  const runtime = await createServer({
    env: productionEnv(),
    factories: {
      createStore() {
        return {
          ready: true,
          close() {
            closeCalls += 1;
            closeStarted.resolve();
            return allowCloseToFinish.promise.then(() => {
              closeFinished = true;
            });
          },
        };
      },
      createStorage() {
        return storageAdapter();
      },
    },
    dependencies: {
      workers: { ready: true, stop() {} },
    },
    logger: quietLogger(),
  });

  const shutdown = runtime.shutdown("deferred-store-close");
  await closeStarted.promise;
  const beforeRelease = await Promise.race([
    shutdown.then(() => "resolved"),
    new Promise((resolve) => setImmediate(() => resolve("pending"))),
  ]);
  allowCloseToFinish.resolve();
  await shutdown;

  assert.equal(beforeRelease, "pending");
  assert.equal(closeFinished, true);
  assert.equal(closeCalls, 1);
});

test("asynchronous store close rejection follows sanitized aggregate shutdown", async () => {
  const secret = "async-store-close-secret";
  let closeCalls = 0;
  const runtime = await createServer({
    env: productionEnv({ STORAGE_SECRET_ACCESS_KEY: secret }),
    factories: {
      createStore() {
        return {
          ready: true,
          close() {
            closeCalls += 1;
            return new Promise((resolve, reject) => {
              setImmediate(() => reject(new Error(`store close exposed ${secret}`)));
            });
          },
        };
      },
      createStorage() {
        return storageAdapter();
      },
    },
    dependencies: {
      workers: { ready: true, stop() {} },
    },
    logger: quietLogger(),
  });

  const result = await runtime.shutdown("rejecting-store-close").then(
    () => ({ status: "resolved", error: null }),
    (error) => ({ status: "rejected", error }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.status, "rejected");
  assert.equal(result.error.name, "AggregateError");
  assert.equal(result.error.errors.length, 1);
  assert.doesNotMatch(runtime.sanitizeError(result.error), new RegExp(secret));
  assert.equal(closeCalls, 1);
});

test("default production entrypoint fails closed when the asset signing secret is absent", async () => {
  const secrets = [
    "runtime-password",
    "runtime-storage-secret",
    "runtime-auth-secret-that-is-long-enough",
    "runtime-wechat-secret",
  ];

  await assert.rejects(
    createServer({
      env: productionEnv({ MINIAPP_ASSET_SIGNING_SECRET: "" }),
      logger: quietLogger(),
    }),
    (error) => {
      assert.equal(error.code, "CONFIG_INVALID");
      assert.match(error.message, /MINIAPP_ASSET_SIGNING_SECRET/);
      for (const secret of secrets) assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("production adapter initialization errors are typed and sanitized", async () => {
  await assert.rejects(
    Promise.resolve().then(() => createServer({
      env: productionEnv({ GPTPROTO_API_KEY: "provider-api-key-secret" }),
      factories: {
        createStore() {
          throw new Error("database rejected runtime-password and provider-api-key-secret");
        },
      },
      logger: quietLogger(),
    })),
    (error) => {
      assert.equal(error.code, "RUNTIME_INIT_FAILED");
      assert.doesNotMatch(error.message, /runtime-password|provider-api-key-secret/);
      assert.match(error.message, /\[REDACTED_SECRET\]/);
      return true;
    },
  );
});

test("actual auto-created SQLite store closes once on direct shutdown and SIGTERM", async () => {
  for (const mode of ["direct", "SIGTERM"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ima-runtime-shutdown-"));
    const processRef = new EventEmitter();
    processRef.exitCode = undefined;
    const runtime = await createServer({
      env: {
        NODE_ENV: "test",
        PORT: "0",
        MINIAPP_BACKEND_HOST: "127.0.0.1",
        MINIAPP_DB_PATH: path.join(root, "miniapp.sqlite"),
      },
      logger: quietLogger(),
    });
    const originalClose = runtime.dependencies.store.close.bind(runtime.dependencies.store);
    let storeCloseCalls = 0;
    runtime.dependencies.store.close = () => {
      storeCloseCalls += 1;
      return originalClose();
    };
    await runtime.listen();

    if (mode === "direct") {
      await runtime.shutdown(mode);
    } else {
      const removeHandlers = installSignalHandlers(runtime, processRef, quietLogger());
      processRef.emit(mode, mode);
      for (let attempt = 0; attempt < 100 && processRef.exitCode === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      removeHandlers();
      assert.equal(processRef.exitCode, 0);
    }

    assert.equal(storeCloseCalls, 1);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("failed construction rolls back every acquired resource in reverse order", async (t) => {
  const scenarios = [
    {
      stage: "store",
      wantCalls: ["database"],
      wantEvents: ["start:database", "finish:database"],
    },
    {
      stage: "storage",
      wantCalls: ["store", "database"],
      wantEvents: ["start:store", "finish:store", "start:database", "finish:database"],
    },
    {
      stage: "image provider",
      wantCalls: ["storage", "store", "database"],
      wantEvents: [
        "start:storage", "finish:storage",
        "start:store", "finish:store",
        "start:database", "finish:database",
      ],
    },
    {
      stage: "app",
      wantCalls: ["image provider", "storage", "store", "database"],
      wantEvents: [
        "start:image provider", "finish:image provider",
        "start:storage", "finish:storage",
        "start:store", "finish:store",
        "start:database", "finish:database",
      ],
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.stage, async () => {
      const calls = [];
      const events = [];
      const resource = (name) => ({
        async close() {
          events.push(`start:${name}`);
          await new Promise((resolve) => setImmediate(resolve));
          events.push(`finish:${name}`);
          calls.push(name);
          if (name === scenario.wantCalls[0]) {
            throw new Error(`${name} cleanup exposed runtime-storage-secret`);
          }
        },
      });
      const failAt = (stage) => {
        if (scenario.stage === stage) {
          throw new Error(`${stage} construction exposed provider-api-key-secret`);
        }
      };

      await assert.rejects(
        Promise.resolve().then(() => createServer({
          env: productionEnv({ GPTPROTO_API_KEY: "provider-api-key-secret" }),
          factories: {
            createDatabase() {
              return resource("database");
            },
            createStore() {
              failAt("store");
              return resource("store");
            },
            createStorage() {
              failAt("storage");
              return resource("storage");
            },
            createImageProvider() {
              failAt("image provider");
              return resource("image provider");
            },
            createApp() {
              failAt("app");
              return { fetch: () => Response.json({ success: true }) };
            },
          },
          logger: quietLogger(),
        })),
        (error) => {
          assert.equal(error.code, "RUNTIME_INIT_FAILED");
          assert.doesNotMatch(error.message, /provider-api-key-secret|runtime-storage-secret/);
          assert.match(error.message, /\[REDACTED_SECRET\]/);
          return true;
        },
      );
      assert.deepEqual(calls, scenario.wantCalls);
      assert.deepEqual(events, scenario.wantEvents);
    });
  }
});

test("shutdown forces active HTTP connections closed after the configured timeout", async () => {
  const entered = deferred();
  const runtime = await createServer({
    env: {
      NODE_ENV: "test",
      PORT: "0",
      MINIAPP_BACKEND_HOST: "127.0.0.1",
      SHUTDOWN_TIMEOUT_MS: "15",
    },
    app: {
      fetch() {
        entered.resolve();
        return new Promise(() => {});
      },
    },
    logger: quietLogger(),
  });
  await runtime.listen();

  const request = http.get(`${addressFor(runtime)}/blocked`);
  request.on("error", () => {});
  await entered.promise;

  const shutdown = runtime.shutdown("test-timeout");
  const result = await Promise.race([
    shutdown.then(() => "closed"),
    new Promise((resolve) => setTimeout(() => {
      runtime.server.closeAllConnections();
      resolve("test-watchdog");
    }, 100)),
  ]);
  await shutdown;

  assert.equal(result, "closed");
  assert.equal(runtime.server.listening, false);
});

test("shutdown is idempotent and attempts every cleanup hook after failures", async () => {
  const calls = [];
  const failing = (name) => ({
    async close() {
      calls.push(name);
      throw new Error(`${name} failed`);
    },
  });
  const runtime = await createServer({
    env: { NODE_ENV: "test", PORT: "0" },
    app: failing("app"),
    dependencies: {
      workers: [failing("worker-one"), failing("worker-two")],
      storage: failing("storage"),
      database: failing("database"),
      store: failing("store"),
    },
    logger: quietLogger(),
  });

  const first = runtime.shutdown("first");
  const second = runtime.shutdown("second");
  assert.strictEqual(second, first);
  await assert.rejects(first, (error) => {
    assert.equal(error.name, "AggregateError");
    assert.equal(error.errors.length, 6);
    return true;
  });
  assert.deepEqual(calls, [
    "worker-one",
    "worker-two",
    "app",
    "store",
    "storage",
    "database",
  ]);

  const third = runtime.shutdown("third");
  assert.strictEqual(third, first);
  await assert.rejects(third);
  assert.equal(calls.length, 6);
});

test("runtime responses and logs redact configured secrets from unexpected errors", async (t) => {
  const secret = "runtime-api-v3-secret";
  const errors = [];
  const runtime = await createServer({
    env: {
      NODE_ENV: "test",
      PORT: "0",
      MINIAPP_BACKEND_HOST: "127.0.0.1",
      WECHAT_PAY_API_V3_KEY: secret,
    },
    app: {
      fetch() {
        throw new Error(`upstream rejected ${secret}`);
      },
    },
    logger: {
      log() {},
      error(...args) {
        errors.push(args.join(" "));
      },
    },
  });
  t.after(() => runtime.shutdown());
  await runtime.listen();

  const response = await fetch(`${addressFor(runtime)}/explode`);
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.doesNotMatch(body, new RegExp(secret));
  assert.match(body, /Internal server error/);
  assert.doesNotMatch(errors.join("\n"), new RegExp(secret));
  assert.match(errors.join("\n"), /\[REDACTED_SECRET\]/);
});

test("SIGTERM and SIGINT invoke the idempotent runtime shutdown path", async () => {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    const processRef = new EventEmitter();
    const stopped = deferred();
    const calls = [];
    processRef.exitCode = undefined;
    const removeHandlers = installSignalHandlers({
      shutdown(receivedSignal) {
        calls.push(receivedSignal);
        stopped.resolve();
        return Promise.resolve();
      },
    }, processRef, quietLogger());

    processRef.emit(signal, signal);
    await stopped.promise;
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(calls, [signal]);
    assert.equal(processRef.exitCode, 0);
    removeHandlers();
  }
});
