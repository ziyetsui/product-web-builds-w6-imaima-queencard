const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter } = require("node:events");
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
    MINIAPP_AUTH_TOKEN_SECRET: "runtime-auth-secret-that-is-long-enough",
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

test("health returns 503 and dependency details while any runtime dependency is unready", async (t) => {
  const runtime = createServer({
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
  const store = { ready: true, close() {} };
  const storage = { ready: true, close() {} };
  const runtime = createServer({
    env: productionEnv(),
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

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.buildSha, "build-runtime-test");
  assert.deepEqual(created, ["store", "storage"]);
});

test("default production entrypoint fails closed until database and storage adapters land", () => {
  const secrets = [
    "runtime-password",
    "runtime-storage-secret",
    "runtime-auth-secret-that-is-long-enough",
    "runtime-wechat-secret",
  ];

  assert.throws(
    () => createServer({ env: productionEnv(), logger: quietLogger() }),
    (error) => {
      assert.equal(error.code, "RUNTIME_DEPENDENCY_MISSING");
      assert.match(error.message, /database adapter/i);
      assert.match(error.message, /storage adapter/i);
      for (const secret of secrets) assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("production adapter initialization errors are typed and sanitized", () => {
  assert.throws(
    () => createServer({
      env: productionEnv({ GPTPROTO_API_KEY: "provider-api-key-secret" }),
      factories: {
        createStore() {
          throw new Error("database rejected runtime-password and provider-api-key-secret");
        },
      },
      logger: quietLogger(),
    }),
    (error) => {
      assert.equal(error.code, "RUNTIME_INIT_FAILED");
      assert.doesNotMatch(error.message, /runtime-password|provider-api-key-secret/);
      assert.match(error.message, /\[REDACTED_SECRET\]/);
      return true;
    },
  );
});

test("shutdown forces active HTTP connections closed after the configured timeout", async () => {
  const entered = deferred();
  const runtime = createServer({
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
  const runtime = createServer({
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
    "storage",
    "database",
    "store",
    "app",
  ]);

  const third = runtime.shutdown("third");
  assert.strictEqual(third, first);
  await assert.rejects(third);
  assert.equal(calls.length, 6);
});

test("runtime responses and logs redact configured secrets from unexpected errors", async (t) => {
  const secret = "runtime-api-v3-secret";
  const errors = [];
  const runtime = createServer({
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
