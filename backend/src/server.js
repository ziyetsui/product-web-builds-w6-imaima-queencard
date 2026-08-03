const http = require("node:http");

const { createApp } = require("./app");
const { loadConfig, toRuntimeEnv } = require("./config");
const { createImageProvider } = require("./providers");
const { getListenOptions } = require("./listen-options");
const { createSqliteStore } = require("./store");

function asResourceList(resources) {
  if (!resources) return [];
  return Array.isArray(resources) ? resources : [resources];
}

async function stopResource(resource) {
  if (!resource) return;
  if (typeof resource.stop === "function") return resource.stop();
  if (typeof resource.shutdown === "function") return resource.shutdown();
  if (typeof resource.end === "function") return resource.end();
  if (typeof resource.close === "function") return resource.close();
  if (typeof resource.destroy === "function") return resource.destroy();
}

async function stopResources(resources) {
  const seen = new Set();
  for (const resource of resources.flatMap(asResourceList)) {
    if (!resource || seen.has(resource)) continue;
    seen.add(resource);
    await stopResource(resource);
  }
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
  });
}

async function readinessFor(resource, fallback) {
  if (!resource) return fallback;
  if (typeof resource.isReady === "function") return Boolean(await resource.isReady());
  if (typeof resource.ready === "function") return Boolean(await resource.ready());
  if (typeof resource.ready === "boolean") return resource.ready;
  return true;
}

async function healthData(config, dependencies) {
  const databaseResource = dependencies.database || dependencies.store;
  const storageResource = dependencies.storage;
  const workerResource = dependencies.workers || dependencies.worker;
  const databaseReady = await readinessFor(databaseResource, config.database.driver === "sqlite");
  const storageReady = await readinessFor(storageResource, config.storage.driver === "local");
  const workersReady = await readinessFor(workerResource, config.generation.workerMode === "in-process");

  return {
    ok: databaseReady && storageReady && workersReady,
    buildSha: config.server.buildSha,
    environment: config.server.environment,
    dependencies: {
      database: { ready: databaseReady, driver: config.database.driver },
      storage: { ready: storageReady, driver: config.storage.driver },
      workers: { ready: workersReady, mode: config.generation.workerMode },
    },
  };
}

function createRequestHandler({ app, config, dependencies, listenOptions }) {
  return (req, res) => {
    const startedAt = Date.now();
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${listenOptions.host}:${listenOptions.port}`}`);
        let response;
        if (requestUrl.pathname === "/health" && req.method === "GET") {
          response = Response.json({ success: true, data: await healthData(config, dependencies) });
        } else {
          response = await app.fetch(new Request(requestUrl, {
            method: req.method,
            headers: req.headers,
            body: ["GET", "HEAD"].includes(req.method || "") ? undefined : Buffer.concat(chunks),
          }));
        }
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
        console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${response.status} ${Date.now() - startedAt}ms`);
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: error.message || "Server error" }));
        console.error(`${new Date().toISOString()} ${req.method} ${req.url} 500 ${Date.now() - startedAt}ms ${error.message || error}`);
      }
    });
  };
}

function createDependencies(config, sourceEnv, options = {}) {
  const runtimeEnv = toRuntimeEnv(config, sourceEnv);
  const provided = options.dependencies || {};
  const store = provided.store || (config.database.driver === "sqlite"
    ? createSqliteStore({
      dbPath: config.database.sqlitePath,
      initialCredits: runtimeEnv.MINIAPP_INITIAL_CREDITS || "10",
    })
    : null);
  if (!store && !options.app) {
    throw new Error("PostgreSQL runtime dependency is not configured; provide dependencies.store until the PostgreSQL store is available");
  }
  const imageProvider = provided.imageProvider || createImageProvider({
    env: runtimeEnv,
    fetch: options.fetch || fetch,
  });
  return {
    ...provided,
    store,
    imageProvider,
    runtimeEnv,
  };
}

function createServer(options = {}) {
  const sourceEnv = options.env || process.env;
  const config = options.config || loadConfig(sourceEnv);
  const listenOptions = getListenOptions(config);
  const dependencies = createDependencies(config, sourceEnv, options);
  const app = options.app || createApp({
    env: dependencies.runtimeEnv,
    store: dependencies.store,
    imageProvider: dependencies.imageProvider,
    fetch: options.fetch,
  });
  const server = http.createServer(createRequestHandler({
    app,
    config,
    dependencies,
    listenOptions,
  }));
  let shutdownPromise = null;

  function listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        const port = address && typeof address === "object" ? address.port : listenOptions.port;
        console.log(`ima miniapp backend listening on http://${listenOptions.host}:${port}`);
        resolve(server);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(listenOptions.port, listenOptions.host);
    });
  }

  function shutdown(signal = "shutdown") {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log(`ima miniapp backend received ${signal}; shutting down`);
      await closeHttpServer(server);
      await stopResources([
        dependencies.workers,
        dependencies.worker,
        dependencies.storage,
        dependencies.database,
        dependencies.store,
        options.app && options.app,
      ]);
    })();
    return shutdownPromise;
  }

  return {
    app,
    config,
    dependencies,
    listenOptions,
    server,
    listen,
    shutdown,
    close: shutdown,
  };
}

function installSignalHandlers(runtime, processRef = process) {
  const onSignal = (signal) => {
    runtime.shutdown(signal)
      .then(() => {
        processRef.exitCode = 0;
      })
      .catch((error) => {
        console.error(`Failed to shut down after ${signal}: ${error.message || error}`);
        processRef.exitCode = 1;
      });
  };
  processRef.once("SIGTERM", onSignal);
  processRef.once("SIGINT", onSignal);
  return () => {
    processRef.off("SIGTERM", onSignal);
    processRef.off("SIGINT", onSignal);
  };
}

if (require.main === module) {
  const runtime = createServer();
  installSignalHandlers(runtime);
  runtime.listen().catch((error) => {
    console.error(`Failed to start backend: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  healthData,
  installSignalHandlers,
  stopResource,
};
