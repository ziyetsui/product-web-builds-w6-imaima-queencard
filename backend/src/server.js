const http = require("node:http");

const { createApp } = require("./app");
const {
  REDACTED_SECRET,
  loadConfig,
  redactConfig,
  toRuntimeEnv,
} = require("./config");
const { createImageProvider } = require("./providers");
const { getListenOptions } = require("./listen-options");
const { createSqliteStore } = require("./store");
const { createPostgresPool } = require("./db/pool");
const { createPostgresStore } = require("./repositories/postgres-store");
const { createLocalStorage } = require("./storage/local-storage");
const { createS3Storage } = require("./storage/s3-storage");

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

async function stopResourceGroups(groups) {
  const errors = [];
  const seen = new Set();

  for (const group of groups) {
    const resources = asResourceList(group).filter((resource) => {
      if (!resource || seen.has(resource)) return false;
      seen.add(resource);
      return true;
    });
    const results = await Promise.allSettled(
      resources.map((resource) => Promise.resolve().then(() => stopResource(resource))),
    );
    for (const result of results) {
      if (result.status === "rejected") errors.push(result.reason);
    }
  }

  if (errors.length) throw new AggregateError(errors, "One or more runtime cleanup hooks failed");
}

function trackResource(resources, resource) {
  for (const candidate of asResourceList(resource)) {
    if (candidate && !resources.includes(candidate)) resources.push(candidate);
  }
  return resource;
}

async function rollbackResources(resources) {
  try {
    await stopResourceGroups([...resources].reverse());
    return [];
  } catch (error) {
    return error instanceof AggregateError ? error.errors : [error];
  }
}

function closeHttpServer(server, timeoutMs, sockets) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      finish();
    }, timeoutMs);

    server.close((error) => {
      finish(error);
    });
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  });
}

function configuredSecretValues(...sources) {
  const values = [];

  function visit(source, publicValue) {
    if (publicValue === REDACTED_SECRET) {
      if (typeof source === "string" && source) {
        values.push(source);
        try {
          const parsed = new URL(source);
          if (parsed.username) values.push(decodeURIComponent(parsed.username));
          if (parsed.password) values.push(decodeURIComponent(parsed.password));
        } catch {
          // Secret values are not required to be URLs.
        }
      }
      return;
    }
    if (!source || typeof source !== "object" || !publicValue || typeof publicValue !== "object") return;
    for (const key of Object.keys(publicValue)) visit(source[key], publicValue[key]);
  }

  for (const source of sources) visit(source, redactConfig(source));
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function sanitizedErrorMessage(error, ...secretSources) {
  let message = error && error.message ? error.message : String(error || "Unknown runtime error");
  for (const secret of configuredSecretValues(...secretSources)) {
    message = message.split(secret).join(REDACTED_SECRET);
  }
  return message;
}

function loggerFor(logger = console) {
  return {
    log: typeof logger.log === "function" ? logger.log.bind(logger) : () => {},
    error: typeof logger.error === "function" ? logger.error.bind(logger) : () => {},
  };
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
  const buildSha = typeof config.server.buildSha === "string" ? config.server.buildSha.trim() : "";
  const buildReady = Boolean(buildSha)
    && !["unknown", "replace-with-source-commit-sha"].includes(buildSha.toLowerCase());
  const build = {
    ready: buildReady,
    sha: buildReady ? buildSha : null,
  };
  if (!buildReady) build.reason = "BUILD_NOT_SET";

  return {
    ok: buildReady && databaseReady && storageReady && workersReady,
    buildSha: config.server.buildSha,
    build,
    environment: config.server.environment,
    dependencies: {
      database: { ready: databaseReady, driver: config.database.driver },
      storage: { ready: storageReady, driver: config.storage.driver },
      workers: { ready: workersReady, mode: config.generation.workerMode },
    },
  };
}

function createRequestHandler({ app, config, dependencies, listenOptions, logger, sanitizeError }) {
  return (req, res) => {
    const startedAt = Date.now();
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${listenOptions.host}:${listenOptions.port}`}`);
        let response;
        if (requestUrl.pathname === "/health" && req.method === "GET") {
          const data = await healthData(config, dependencies);
          response = Response.json({ success: data.ok, data }, { status: data.ok ? 200 : 503 });
        } else {
          response = await app.fetch(new Request(requestUrl, {
            method: req.method,
            headers: req.headers,
            body: ["GET", "HEAD"].includes(req.method || "") ? undefined : Buffer.concat(chunks),
          }));
        }
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
        logger.log(`${new Date().toISOString()} ${req.method} ${req.url} ${response.status} ${Date.now() - startedAt}ms`);
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Internal server error" }));
        logger.error(`${new Date().toISOString()} ${req.method} ${req.url} 500 ${Date.now() - startedAt}ms ${sanitizeError(error)}`);
      }
    });
  };
}

async function createDependencies(config, sourceEnv, options, acquiredResources) {
  const runtimeEnv = toRuntimeEnv(config, sourceEnv);
  const provided = options.dependencies || {};
  const factories = options.factories || {};
  const hasInjectedStore = Boolean(provided.store) || typeof factories.createStore === "function";
  let database = provided.database || null;
  if (!database && typeof factories.createDatabase === "function") {
    database = await factories.createDatabase({ config: config.database, env: runtimeEnv });
  }
  if (!database && config.database.driver === "postgres" && !hasInjectedStore) {
    database = createPostgresPool({ config: config.database });
  }
  trackResource(acquiredResources, database);

  let store = provided.store || null;
  if (!store && typeof factories.createStore === "function") {
    store = await factories.createStore({ config: config.database, database, env: runtimeEnv });
  }
  if (!store && config.database.driver === "postgres") {
    store = createPostgresStore({
      pool: database,
      initialCredits: runtimeEnv.MINIAPP_INITIAL_CREDITS || "10",
      environment: config.server.environment,
    });
  }
  if (!store && config.database.driver === "sqlite" && !options.app) {
    store = createSqliteStore({
      dbPath: config.database.sqlitePath,
      initialCredits: runtimeEnv.MINIAPP_INITIAL_CREDITS || "10",
      environment: config.server.environment,
    });
  }
  trackResource(acquiredResources, store);

  let storage = provided.storage || null;
  if (!storage && typeof factories.createStorage === "function") {
    storage = await factories.createStorage({ config: config.storage, env: runtimeEnv });
  }
  if (!storage) {
    if (config.storage.driver === "local") {
      storage = createLocalStorage({
        root: config.storage.localRoot,
        baseUrl: config.storage.publicBaseUrl,
        signingSecret: config.storage.signingSecret,
      });
    } else {
      storage = createS3Storage({
        bucket: config.storage.bucket,
        endpoint: config.storage.endpoint,
        region: config.storage.region,
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
        forcePathStyle: config.storage.forcePathStyle,
      });
    }
  }
  trackResource(acquiredResources, storage);

  const missing = [];
  if (config.database.driver !== "sqlite" && !database && !store) missing.push("database adapter");
  else if (!store && !options.app) missing.push("database store adapter");
  if (config.storage.driver !== "local" && !storage) missing.push("storage adapter");
  if (missing.length) {
    const error = new Error(`Production runtime dependencies are not configured: ${[...new Set(missing)].join(", ")}`);
    error.code = "RUNTIME_DEPENDENCY_MISSING";
    throw error;
  }
  if (config.database.driver === "postgres" && typeof database?.initialize === "function") {
    await database.initialize();
  }
  let imageProvider = provided.imageProvider || null;
  if (!imageProvider && typeof factories.createImageProvider === "function") {
    imageProvider = await factories.createImageProvider({
      config: config.generation,
      env: runtimeEnv,
      fetch: options.fetch || fetch,
    });
  }
  if (!imageProvider) {
    imageProvider = createImageProvider({
      env: runtimeEnv,
      fetch: options.fetch || fetch,
    });
  }
  trackResource(acquiredResources, imageProvider);
  return {
    ...provided,
    database,
    store,
    storage,
    imageProvider,
    runtimeEnv,
  };
}

async function createServer(options = {}) {
  const sourceEnv = options.env || process.env;
  const config = options.config || loadConfig(sourceEnv);
  const logger = loggerFor(options.logger);
  const listenOptions = getListenOptions(config);
  const sanitizeError = (error) => sanitizedErrorMessage(error, config, sourceEnv);
  const acquiredResources = [];
  let dependencies;
  let app;
  try {
    dependencies = await createDependencies(config, sourceEnv, options, acquiredResources);
    trackResource(acquiredResources, dependencies.workers);
    trackResource(acquiredResources, dependencies.worker);
    if (options.app) {
      app = options.app;
    } else if (typeof (options.factories || {}).createApp === "function") {
      app = await options.factories.createApp({
        config,
        env: dependencies.runtimeEnv,
        dependencies,
        fetch: options.fetch || fetch,
      });
    } else {
      app = createApp({
        env: dependencies.runtimeEnv,
        store: dependencies.store,
        storage: dependencies.storage,
        imageProvider: dependencies.imageProvider,
        fetch: options.fetch,
      });
    }
    trackResource(acquiredResources, app.worker);
    if (typeof app.initialize === "function") await app.initialize();
    if (typeof app.worker?.start === "function") app.worker.start();
  } catch (error) {
    const cleanupErrors = await rollbackResources(acquiredResources);
    if (error && error.code === "RUNTIME_DEPENDENCY_MISSING" && cleanupErrors.length === 0) throw error;
    const cleanupMessage = cleanupErrors.length
      ? `; cleanup failures: ${cleanupErrors.map(sanitizeError).join("; ")}`
      : "";
    const runtimeError = new Error(`${sanitizeError(error)}${cleanupMessage}`);
    runtimeError.name = "RuntimeInitializationError";
    runtimeError.code = "RUNTIME_INIT_FAILED";
    throw runtimeError;
  }
  const healthDependencies = {
    ...dependencies,
    workers: dependencies.workers || dependencies.worker || app.worker,
  };
  const server = http.createServer(createRequestHandler({
    app,
    config,
    dependencies: healthDependencies,
    listenOptions,
    logger,
    sanitizeError,
  }));
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
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
        logger.log(`ima miniapp backend listening on http://${listenOptions.host}:${port}`);
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
      logger.log(`ima miniapp backend received ${signal}; shutting down`);
      const errors = [];
      try {
        await closeHttpServer(server, config.server.shutdownTimeoutMs, sockets);
      } catch (error) {
        errors.push(error);
      }
      try {
        await stopResourceGroups([
          [dependencies.workers, dependencies.worker, app.worker].flatMap(asResourceList),
          app,
          options.app ? dependencies.store : null,
          dependencies.imageProvider,
          dependencies.storage,
          dependencies.database,
        ]);
      } catch (error) {
        if (error instanceof AggregateError) errors.push(...error.errors);
        else errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, "Runtime shutdown completed with errors");
    })();
    return shutdownPromise;
  }

  return {
    app,
    config,
    dependencies,
    listenOptions,
    server,
    sanitizeError,
    listen,
    shutdown,
    close: shutdown,
  };
}

function installSignalHandlers(runtime, processRef = process, loggerInput = console) {
  const logger = loggerFor(loggerInput);
  const onSignal = (signal) => {
    runtime.shutdown(signal)
      .then(() => {
        processRef.exitCode = 0;
      })
      .catch((error) => {
        const message = typeof runtime.sanitizeError === "function"
          ? runtime.sanitizeError(error)
          : sanitizedErrorMessage(error, runtime.config);
        logger.error(`Failed to shut down after ${signal}: ${message}`);
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
  (async () => {
    try {
      const runtime = await createServer();
      installSignalHandlers(runtime);
      await runtime.listen();
    } catch (error) {
      console.error(`Failed to start backend: ${sanitizedErrorMessage(error)}`);
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  createServer,
  healthData,
  installSignalHandlers,
  sanitizedErrorMessage,
  stopResource,
};
