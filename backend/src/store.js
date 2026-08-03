const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { assertSessionTokenHash } = require("./auth");
const { queryCatalog } = require("./services/catalog-service");

const mockFulfillmentIdentity = Symbol("mockFulfillmentIdentity");

function developmentMockIdentity(environment, order, input) {
  const expected = `mock:${order.id}`;
  const requestIsValid = input.fulfillmentKey === expected
    && input.provider === "mock"
    && input.paymentMode === "mock"
    && input.eventId === expected
    && input.providerTransactionId === expected
    && input.status === "FULFILLED"
    && input.paymentVerified === true;
  const pendingMockOrder = order.paymentMode === "mock"
    && order.status === "pending"
    && order.paymentStatus === "mock_pending"
    && !order.fulfilledAt;
  const completedMockOrder = order.paymentMode === "mock"
    && order.status === "paid"
    && order.paymentStatus === "fulfilled"
    && Boolean(order.fulfilledAt)
    && order.mockFulfillmentKey === expected
    && order.mockEventId === expected
    && order.mockProviderTransactionId === expected;
  if (["production", "prod"].includes(environment)
    || !requestIsValid
    || (!pendingMockOrder && !completedMockOrder)) {
    const error = new Error("Development mock payment required");
    error.status = 409;
    throw error;
  }
  return { expected, completed: completedMockOrder };
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

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalizeJsonInput(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  return parseJson(value, fallback);
}

function orderRequest(input) {
  return {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey || "",
    productId: input.productId,
    channel: input.channel || "wechat",
    status: input.status || "pending",
    paymentStatus: input.paymentStatus || "created",
    paymentMode: input.paymentMode || "manual",
    amountCents: Number(input.amountCents || 0),
    currency: input.currency || "CNY",
    credits: Number(input.credits || 0),
    productSnapshot: normalizeJsonInput(input.productSnapshot, {}),
    metadata: normalizeJsonInput(input.metadata, {}),
  };
}

function markOrderCreation(order, created) {
  if (!order) return order;
  const marked = { ...order };
  Object.defineProperty(marked, "created", { value: created, enumerable: false });
  return marked;
}

function orderIdempotencyConflict() {
  const error = new Error("Order idempotency conflict");
  error.status = 409;
  return error;
}

function mockGrantTransactionId(orderIdValue) {
  return `mock-grant:${orderIdValue}`;
}

function metricNumber(record, key) {
  const metrics = record.metrics || {};
  const value = Number(metrics[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function heatScore(record) {
  return metricNumber(record, "likes") + metricNumber(record, "saves");
}

function interactionScore(record) {
  return metricNumber(record, "likes") + metricNumber(record, "saves") * 0.35 + metricNumber(record, "shares") * 0.45;
}

function potentialScore(record) {
  const metrics = record.metrics || {};
  if (Number.isFinite(Number(metrics.potentialScore))) return Number(metrics.potentialScore);
  return interactionScore(record);
}

function potentialRank(record) {
  const metrics = record.metrics || {};
  const value = Number(metrics.potentialRank);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function isHotTemplate(record) {
  return metricNumber(record, "likes") >= 20000 || metricNumber(record, "saves") >= 20000;
}

function sortTemplates(records, sort) {
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
    if (mode === "newest") return String(b.id || "").localeCompare(String(a.id || ""));
    return heatScore(b) - heatScore(a);
  });
}

function createMemoryStore(options = {}) {
  const initialCredits = Number(options.initialCredits || 10);
  const environment = String(options.environment || process.env.NODE_ENV || "development").toLowerCase();
  const users = new Map();
  const sessions = new Map();
  const tasks = new Map();
  const creditTransactions = [];
  const templates = new Map();
  const catalogRecords = new Map();
  const catalogVersions = new Map();
  let activeCatalogVersionId = null;
  const orders = new Map();
  const paymentAudit = [];

  function ensureUser(identity) {
    const id = identity.appid && identity.openid
      ? `wechat:${identity.appid}:${identity.openid}`
      : identity.sub;
    if (!users.has(id)) {
      users.set(id, {
        id,
        provider: "wechat",
        appid: identity.appid,
        openid: identity.openid,
        unionid: identity.unionid || null,
        name: "微信用户",
        balance: initialCredits,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return users.get(id);
  }

  function getUser(id) {
    return users.get(id) || null;
  }

  function createSession(input) {
    const now = new Date().toISOString();
    const tokenHash = assertSessionTokenHash(input.tokenHash);
    const saved = {
      id: input.id || `session_${crypto.randomUUID()}`,
      userId: input.userId,
      tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastUsedAt: null,
      ipAddress: input.ipAddress || "",
      userAgent: input.userAgent || "",
      createdAt: now,
      updatedAt: now,
    };
    sessions.set(saved.id, saved);
    return saved;
  }

  function getSession(id) {
    return sessions.get(id) || null;
  }

  function getSessionByTokenHash(tokenHash) {
    return Array.from(sessions.values()).find((session) => session.tokenHash === tokenHash) || null;
  }

  function touchSession(id) {
    const session = sessions.get(id);
    if (!session) return null;
    const now = new Date().toISOString();
    session.lastUsedAt = now;
    session.updatedAt = now;
    return session;
  }

  function revokeSession(id) {
    const session = sessions.get(id);
    if (!session) return null;
    const now = new Date().toISOString();
    session.revokedAt = session.revokedAt || now;
    session.updatedAt = now;
    return session;
  }

  function revokeSessionByTokenHash(tokenHash) {
    const session = getSessionByTokenHash(tokenHash);
    return session ? revokeSession(session.id) : null;
  }

  function revokeAllSessions(userId) {
    return Array.from(sessions.values())
      .filter((session) => session.userId === userId && !session.revokedAt)
      .map((session) => revokeSession(session.id)).length;
  }

  function getUserByIdentity(appid, openid) {
    return Array.from(users.values()).find((user) => user.appid === appid && user.openid === openid) || null;
  }

  function updateUserProfile(userId, updates = {}) {
    const user = users.get(userId);
    if (!user) throw new Error("User not found");
    if (typeof updates.name === "string") user.name = updates.name.slice(0, 40);
    user.updatedAt = new Date().toISOString();
    return user;
  }

  function listUsers(options = new URLSearchParams()) {
    const q = String(options.get("q") || "").trim().toLowerCase();
    let records = Array.from(users.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    if (q) {
      records = records.filter((user) => [
        user.id,
        user.openid,
        user.unionid,
        user.name,
      ].filter(Boolean).join("\n").toLowerCase().includes(q));
    }
    return paginateRecords(records, options);
  }

  function addCredits(userId, amount, reason) {
    const user = users.get(userId);
    if (!user) throw new Error("User not found");
    const value = Number.parseInt(amount, 10);
    if (!Number.isFinite(value) || value === 0) {
      const error = new Error("Credit amount must be non-zero");
      error.status = 400;
      throw error;
    }
    if (value < 0 && user.balance < Math.abs(value)) {
      const error = new Error("Insufficient credits to revoke");
      error.status = 402;
      throw error;
    }
    const createdAt = new Date().toISOString();
    user.balance += value;
    user.updatedAt = createdAt;
    creditTransactions.push({
      id: transactionId(),
      userId,
      amount: value,
      reason: reason || "admin:adjust",
      balanceAfter: user.balance,
      createdAt,
    });
    return user;
  }

  function charge(userId, amount, reason) {
    const user = users.get(userId);
    if (!user) throw new Error("User not found");
    if (user.balance < amount) {
      const error = new Error("Insufficient credits");
      error.status = 402;
      throw error;
    }
    user.balance -= amount;
    user.lastCharge = {
      amount,
      reason,
      chargedAt: new Date().toISOString(),
    };
    creditTransactions.push({
      id: transactionId(),
      userId,
      amount: -Math.abs(amount),
      reason,
      balanceAfter: user.balance,
      createdAt: user.lastCharge.chargedAt,
    });
    return user.balance;
  }

  function createOrder(order) {
    const id = order.id || orderId();
    const idempotencyKey = order.idempotencyKey || null;
    const requestFingerprint = fingerprint(orderRequest(order));
    const byKey = idempotencyKey
      ? Array.from(orders.values()).find((saved) => saved.userId === order.userId && saved.idempotencyKey === idempotencyKey)
      : null;
    const byId = orders.get(id) || null;
    const existing = byKey || byId;
    if (existing) {
      if (existing.userId === order.userId && existing.requestFingerprint === requestFingerprint) {
        return markOrderCreation(existing, false);
      }
      throw orderIdempotencyConflict();
    }
    const createdAt = order.createdAt || new Date().toISOString();
    const saved = {
      id,
      userId: order.userId,
      idempotencyKey: idempotencyKey || "",
      productId: order.productId,
      channel: order.channel || "wechat",
      status: order.status || "pending",
      paymentStatus: order.paymentStatus || "created",
      paymentMode: order.paymentMode || "manual",
      amountCents: Number(order.amountCents || 0),
      currency: order.currency || "CNY",
      credits: Number(order.credits || 0),
      productSnapshot: order.productSnapshot || null,
      paymentParams: order.paymentParams || null,
      externalPaymentId: order.externalPaymentId || "",
      mockFulfillmentKey: order.mockFulfillmentKey || "",
      mockEventId: order.mockEventId || "",
      mockProviderTransactionId: order.mockProviderTransactionId || "",
      creditsGranted: 0,
      creditsRevoked: 0,
      createdAt,
      updatedAt: createdAt,
      paidAt: null,
      fulfilledAt: null,
      refundedAt: null,
      canceledAt: null,
      adminNote: "",
    };
    Object.defineProperty(saved, "requestFingerprint", { value: requestFingerprint, enumerable: false });
    orders.set(saved.id, saved);
    return markOrderCreation(saved, true);
  }

  function getOrder(id) {
    return orders.get(id) || null;
  }

  function listOrders(userId, options = new URLSearchParams()) {
    return listOrderRecords(Array.from(orders.values()).filter((order) => order.userId === userId), options);
  }

  function listAllOrders(options = new URLSearchParams()) {
    return listOrderRecords(Array.from(orders.values()), options);
  }

  function fulfillOrder(id, input = {}) {
    const order = orders.get(id);
    if (!order) return null;
    if (order.fulfilledAt) return { order, fulfilled: false };
    if (order.status === "canceled" || order.status === "refunded") {
      const error = new Error("Order cannot be fulfilled");
      error.status = 409;
      throw error;
    }
    const user = users.get(order.userId);
    if (!user) throw new Error("User not found");
    const now = new Date().toISOString();
    const credits = positiveInt(input.credits || order.credits, 0);
    user.balance += credits;
    user.updatedAt = now;
    if (credits > 0) {
      creditTransactions.push({
        id: transactionId(),
        userId: user.id,
        amount: credits,
        reason: input.reason || `order:${order.id}`,
        balanceAfter: user.balance,
        createdAt: now,
      });
    }
    order.status = "paid";
    order.paymentStatus = "fulfilled";
    order.paidAt = order.paidAt || input.paidAt || now;
    order.fulfilledAt = now;
    order.creditsGranted = credits;
    const mockIdentity = input[mockFulfillmentIdentity];
    if (mockIdentity) {
      order.mockFulfillmentKey = mockIdentity;
      order.mockEventId = mockIdentity;
      order.mockProviderTransactionId = mockIdentity;
      order.externalPaymentId = mockIdentity;
    }
    order.updatedAt = now;
    return { order, fulfilled: true };
  }

  function fulfillMockOrder(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    const identity = developmentMockIdentity(environment, order, input);
    if (identity.completed) return { order, fulfilled: false };
    return fulfillOrder(id, {
      paidAt: input.paidAt,
      reason: input.reason,
      [mockFulfillmentIdentity]: identity.expected,
    });
  }

  function cancelOrder(id, input = {}) {
    const order = orders.get(id);
    if (!order) return null;
    if (order.fulfilledAt || order.status === "paid") {
      const error = new Error("Paid orders must be refunded instead of canceled");
      error.status = 409;
      throw error;
    }
    if (order.canceledAt) return { order, canceled: false };
    const now = new Date().toISOString();
    order.status = "canceled";
    order.paymentStatus = "canceled";
    order.canceledAt = now;
    order.adminNote = input.reason || order.adminNote || "";
    order.updatedAt = now;
    return { order, canceled: true };
  }

  function refundOrder(id, input = {}) {
    const order = orders.get(id);
    if (!order) return null;
    if (order.refundedAt) return { order, refunded: false, revokedCredits: 0 };
    const user = users.get(order.userId);
    if (!user) throw new Error("User not found");
    const now = new Date().toISOString();
    let revokedCredits = 0;
    const grantRemainder = Math.max(0, Number(order.creditsGranted || 0) - Number(order.creditsRevoked || 0));
    if (input.revokeCredits !== false && grantRemainder > 0) {
      revokedCredits = Math.min(user.balance, grantRemainder);
      if (revokedCredits > 0) {
        user.balance -= revokedCredits;
        user.updatedAt = now;
        creditTransactions.push({
          id: transactionId(),
          userId: user.id,
          amount: -revokedCredits,
          reason: input.reason || `refund:${order.id}`,
          balanceAfter: user.balance,
          createdAt: now,
        });
      }
    }
    order.status = "refunded";
    order.paymentStatus = "refunded";
    order.refundedAt = now;
    order.creditsRevoked = Number(order.creditsRevoked || 0) + revokedCredits;
    order.adminNote = input.reason || order.adminNote || "";
    order.updatedAt = now;
    return { order, refunded: true, revokedCredits };
  }

  function recordPaymentEvent(event) {
    const createdAt = event.createdAt || new Date().toISOString();
    const saved = {
      id: event.id || auditId(),
      orderId: event.orderId || "",
      userId: event.userId || "",
      type: event.type,
      actorId: event.actorId || "",
      message: event.message || "",
      metadata: event.metadata || null,
      createdAt,
    };
    paymentAudit.push(saved);
    return saved;
  }

  function listPaymentAudit(options = new URLSearchParams()) {
    const userId = String(options.get("userId") || "").trim();
    const orderIdValue = String(options.get("orderId") || "").trim();
    const type = String(options.get("type") || "").trim();
    let records = paymentAudit.slice();
    if (userId) records = records.filter((event) => event.userId === userId);
    if (orderIdValue) records = records.filter((event) => event.orderId === orderIdValue);
    if (type) records = records.filter((event) => event.type === type);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return paginateRecords(records, options);
  }

  function findOwnedImageAsset(userId, assetId) {
    for (const task of tasks.values()) {
      if (task.ownerId !== userId) continue;
      for (const image of task.images || []) {
        const url = imageUrl(image);
        if (url && matchesAssetId(url, assetId)) {
          return { taskId: task.id, assetId: assetIdForUrl(url), url };
        }
      }
    }
    return null;
  }

  function listCreditTransactions(userId, options = new URLSearchParams()) {
    const records = creditTransactions
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return paginateRecords(records, options);
  }

  function createTask(task) {
    const createdAt = task.createdAt || new Date().toISOString();
    const saved = {
      ...task,
      id: task.id,
      taskId: task.id,
      status: task.status || "completed",
      images: Array.isArray(task.images) ? task.images : [],
      referenceImages: Array.isArray(task.referenceImages) ? task.referenceImages : [],
      outputCount: positiveInt(task.outputCount, 1),
      createdAt,
      updatedAt: new Date().toISOString(),
    };
    tasks.set(saved.id, saved);
    return saved;
  }

  function getTask(id) {
    return tasks.get(id) || null;
  }

  function listTasks(ownerId, options = new URLSearchParams()) {
    const status = String(options.get("status") || "").trim();
    const q = String(options.get("q") || "").trim().toLowerCase();
    let records = Array.from(tasks.values())
      .filter((task) => task.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    if (status) records = records.filter((task) => task.status === status);
    if (q) {
      records = records.filter((task) => [
        task.prompt,
        task.topic,
        task.model,
        task.templateId,
      ].filter(Boolean).join("\n").toLowerCase().includes(q));
    }
    return paginateRecords(records, options);
  }

  function catalogVersionFromInput(input, active = false) {
    const now = new Date().toISOString();
    return {
      id: input.id,
      checksum: input.checksum || "",
      source: input.source || "unknown",
      recordCount: Number(input.recordCount || 0),
      metadata: input.metadata || {},
      active,
      createdAt: input.createdAt || now,
      activatedAt: active ? (input.activatedAt || now) : (input.activatedAt || null),
    };
  }

  function createCatalogVersion(input) {
    const existing = catalogVersions.get(input.id);
    if (existing) return existing;
    const saved = catalogVersionFromInput(input, false);
    catalogVersions.set(saved.id, saved);
    catalogRecords.set(saved.id, new Map());
    return saved;
  }

  function getCatalogVersion(versionId) {
    return catalogVersions.get(versionId) || null;
  }

  function getActiveCatalogVersion() {
    return activeCatalogVersionId ? catalogVersions.get(activeCatalogVersionId) || null : null;
  }

  function activateCatalogVersion(versionId) {
    const version = catalogVersions.get(versionId);
    if (!version) throw new Error(`Catalog version not found: ${versionId}`);
    for (const candidate of catalogVersions.values()) candidate.active = false;
    version.active = true;
    version.activatedAt = new Date().toISOString();
    activeCatalogVersionId = versionId;
    templates.clear();
    for (const [id, record] of (catalogRecords.get(versionId) || new Map()).entries()) templates.set(id, record);
    return version;
  }

  function importCatalogVersion(input) {
    const records = Array.isArray(input.records) ? input.records : [];
    const ids = new Set();
    for (const record of records) {
      if (!record || !record.id || ids.has(record.id)) throw new Error(`Duplicate catalog id: ${record && record.id}`);
      ids.add(record.id);
    }
    const saved = catalogVersionFromInput(input, true);
    const savedRecords = new Map(records.map((record) => [record.id, { ...record, catalogVersionId: saved.id }]));
    catalogVersions.set(saved.id, saved);
    catalogRecords.set(saved.id, savedRecords);
    activeCatalogVersionId = saved.id;
    for (const candidate of catalogVersions.values()) candidate.active = candidate.id === saved.id;
    templates.clear();
    for (const [id, record] of savedRecords.entries()) templates.set(id, record);
    return saved;
  }

  function syncTemplates(records = [], input = {}) {
    const target = input.catalogVersionId ? (catalogRecords.get(input.catalogVersionId) || new Map()) : templates;
    records.forEach((record) => target.set(record.id, record));
    if (input.catalogVersionId) {
      catalogRecords.set(input.catalogVersionId, target);
      if (activeCatalogVersionId === input.catalogVersionId) {
        templates.clear();
        for (const [id, record] of target.entries()) templates.set(id, record);
      }
    }
    return records.length;
  }

  function listTemplates(query = new URLSearchParams()) {
    const active = getActiveCatalogVersion();
    const records = active
      ? Array.from((catalogRecords.get(active.id) || new Map()).values())
      : Array.from(templates.values());
    return queryCatalog(records, query, active);
  }

  function getTemplate(id) {
    const active = getActiveCatalogVersion();
    return (active ? (catalogRecords.get(active.id) || new Map()).get(id) : templates.get(id)) || null;
  }

  return {
    ensureUser,
    getUser,
    getUserByIdentity,
    createSession,
    getSession,
    getSessionByTokenHash,
    touchSession,
    revokeSession,
    revokeSessionByTokenHash,
    revokeAllSessions,
    updateUserProfile,
    listUsers,
    addCredits,
    charge,
    listCreditTransactions,
    createOrder,
    getOrder,
    listOrders,
    listAllOrders,
    fulfillOrder,
    fulfillMockOrder,
    cancelOrder,
    refundOrder,
    recordPaymentEvent,
    listPaymentAudit,
    findOwnedImageAsset,
    createTask,
    getTask,
    listTasks,
    createCatalogVersion,
    getCatalogVersion,
    getActiveCatalogVersion,
    activateCatalogVersion,
    importCatalogVersion,
    syncTemplates,
    listTemplates,
    getTemplate,
    close() {},
  };
}

function createSqliteStore(options = {}) {
  const initialCredits = Number(options.initialCredits || 10);
  const environment = String(options.environment || process.env.NODE_ENV || "development").toLowerCase();
  const dbPath = options.dbPath || process.env.MINIAPP_DB_PATH || path.resolve(__dirname, "../data/miniapp.sqlite");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  migrate(db);

  function ensureUser(identity) {
    const id = identity.appid && identity.openid
      ? `wechat:${identity.appid}:${identity.openid}`
      : identity.sub;
    const existing = getUser(id);
    if (existing) return existing;

    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, provider, appid, openid, unionid, name, balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      "wechat",
      identity.appid || "",
      identity.openid || "",
      identity.unionid || null,
      "微信用户",
      initialCredits,
      createdAt,
      createdAt,
    );
    return getUser(id);
  }

  function getUser(id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? rowToUser(row) : null;
  }

  function getUserByIdentity(appid, openid) {
    const row = db.prepare("SELECT * FROM users WHERE appid = ? AND openid = ?").get(appid, openid);
    return row ? rowToUser(row) : null;
  }

  function createSession(input) {
    const now = new Date().toISOString();
    const sessionId = input.id || `session_${crypto.randomUUID()}`;
    const tokenHash = assertSessionTokenHash(input.tokenHash);
    db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, last_used_at, ip_address, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `).run(
      sessionId,
      input.userId,
      tokenHash,
      input.expiresAt,
      input.ipAddress || "",
      input.userAgent || "",
      now,
      now,
    );
    return getSession(sessionId);
  }

  function getSession(id) {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? rowToSession(row) : null;
  }

  function getSessionByTokenHash(tokenHash) {
    const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash);
    return row ? rowToSession(row) : null;
  }

  function touchSession(id) {
    const now = new Date().toISOString();
    db.prepare("UPDATE sessions SET last_used_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
    return getSession(id);
  }

  function revokeSession(id) {
    const now = new Date().toISOString();
    db.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ?").run(now, now, id);
    return getSession(id);
  }

  function revokeSessionByTokenHash(tokenHash) {
    const session = getSessionByTokenHash(tokenHash);
    return session ? revokeSession(session.id) : null;
  }

  function revokeAllSessions(userId) {
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, now, userId);
    return result.changes;
  }

  function updateUserProfile(userId, updates = {}) {
    const user = getUser(userId);
    if (!user) throw new Error("User not found");
    const name = typeof updates.name === "string" ? updates.name.slice(0, 40) : user.name;
    const updatedAt = new Date().toISOString();
    db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(name, updatedAt, userId);
    return getUser(userId);
  }

  function listUsers(options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const q = String(options.get("q") || "").trim();
    const values = [];
    const where = q ? "(id LIKE ? OR openid LIKE ? OR unionid LIKE ? OR name LIKE ?)" : "";
    if (q) {
      const like = `%${q}%`;
      values.push(like, like, like, like);
    }
    const whereSql = where ? `WHERE ${where}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS total FROM users ${whereSql}`).get(...values).total;
    const rows = db.prepare(`
      SELECT * FROM users
      ${whereSql}
      ORDER BY created_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
    return {
      records: rows.map(rowToUser),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  function addCredits(userId, amount, reason) {
    const user = getUser(userId);
    if (!user) throw new Error("User not found");
    const value = Number.parseInt(amount, 10);
    if (!Number.isFinite(value) || value === 0) {
      const error = new Error("Credit amount must be non-zero");
      error.status = 400;
      throw error;
    }
    if (value < 0 && user.balance < Math.abs(value)) {
      const error = new Error("Insufficient credits to revoke");
      error.status = 402;
      throw error;
    }
    const createdAt = new Date().toISOString();
    const balanceAfter = user.balance + value;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?").run(balanceAfter, createdAt, userId);
      db.prepare(`
        INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(transactionId(), userId, value, reason || "admin:adjust", balanceAfter, createdAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getUser(userId);
  }

  function charge(userId, amount, reason) {
    const user = getUser(userId);
    if (!user) throw new Error("User not found");
    if (user.balance < amount) {
      const error = new Error("Insufficient credits");
      error.status = 402;
      throw error;
    }

    const balanceAfter = user.balance - amount;
    const chargedAt = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?").run(balanceAfter, chargedAt, userId);
      db.prepare(`
        INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(transactionId(), userId, -Math.abs(amount), reason, balanceAfter, chargedAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return balanceAfter;
  }

  function listCreditTransactions(userId, options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const total = db.prepare(`
      SELECT COUNT(*) AS total FROM credit_transactions
      WHERE user_id = ?
    `).get(userId).total;
    const rows = db.prepare(`
      SELECT * FROM credit_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    return {
      records: rows.map(rowToCreditTransaction),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  function createOrder(order) {
    const id = order.id || orderId();
    const idempotencyKey = order.idempotencyKey || null;
    const requestFingerprint = fingerprint(orderRequest(order));
    db.exec("BEGIN IMMEDIATE");
    try {
      const byKey = idempotencyKey
        ? db.prepare("SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?").get(order.userId, idempotencyKey)
        : null;
      const byId = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
      const existing = byKey || byId;
      if (existing) {
        if (existing.user_id === order.userId && existing.request_fingerprint === requestFingerprint) {
          db.exec("COMMIT");
          return markOrderCreation(rowToOrder(existing), false);
        }
        throw orderIdempotencyConflict();
      }

      const createdAt = order.createdAt || new Date().toISOString();
      db.prepare(`
        INSERT INTO orders (
          id, user_id, idempotency_key, request_fingerprint, product_id, channel, status, payment_status, payment_mode,
          amount_cents, currency, credits, product_json, payment_params_json,
          external_payment_id, credits_granted, credits_revoked, created_at,
          updated_at, paid_at, fulfilled_at, refunded_at, canceled_at, admin_note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        order.userId,
        idempotencyKey,
        requestFingerprint,
        order.productId,
        order.channel || "wechat",
        order.status || "pending",
        order.paymentStatus || "created",
        order.paymentMode || "manual",
        Number(order.amountCents || 0),
        order.currency || "CNY",
        Number(order.credits || 0),
        stringify(order.productSnapshot || null),
        stringify(order.paymentParams || null),
        order.externalPaymentId || "",
        0,
        0,
        createdAt,
        createdAt,
        null,
        null,
        null,
        null,
        "",
      );
      db.exec("COMMIT");
      return markOrderCreation(getOrder(id), true);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getOrder(id) {
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    return row ? rowToOrder(row) : null;
  }

  function listOrders(userId, options = new URLSearchParams()) {
    return queryOrders("WHERE user_id = ?", [userId], options);
  }

  function listAllOrders(options = new URLSearchParams()) {
    const userId = String(options.get("userId") || "").trim();
    const status = String(options.get("status") || "").trim();
    const filters = [];
    const values = [];
    if (userId) {
      filters.push("user_id = ?");
      values.push(userId);
    }
    if (status) {
      filters.push("status = ?");
      values.push(status);
    }
    return queryOrders(filters.length ? `WHERE ${filters.join(" AND ")}` : "", values, options);
  }

  function fulfillOrder(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    if (order.fulfilledAt) return { order, fulfilled: false };
    if (order.status === "canceled" || order.status === "refunded") {
      const error = new Error("Order cannot be fulfilled");
      error.status = 409;
      throw error;
    }
    const user = getUser(order.userId);
    if (!user) throw new Error("User not found");
    const now = new Date().toISOString();
    const credits = positiveInt(input.credits || order.credits, 0);
    const balanceAfter = user.balance + credits;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?").run(balanceAfter, now, user.id);
      if (credits > 0) {
        db.prepare(`
          INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(transactionId(), user.id, credits, input.reason || `order:${order.id}`, balanceAfter, now);
      }
      db.prepare(`
        UPDATE orders
        SET status = ?, payment_status = ?, paid_at = COALESCE(paid_at, ?),
            fulfilled_at = ?, credits_granted = ?, updated_at = ?,
            mock_fulfillment_key = COALESCE(?, mock_fulfillment_key),
            mock_event_id = COALESCE(?, mock_event_id),
            mock_provider_transaction_id = COALESCE(?, mock_provider_transaction_id),
            external_payment_id = COALESCE(?, external_payment_id)
        WHERE id = ?
      `).run(
        "paid",
        "fulfilled",
        input.paidAt || now,
        now,
        credits,
        now,
        input[mockFulfillmentIdentity] || null,
        input[mockFulfillmentIdentity] || null,
        input[mockFulfillmentIdentity] || null,
        input[mockFulfillmentIdentity] || null,
        order.id,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { order: getOrder(id), fulfilled: true };
  }

  function fulfillMockOrder(id, input = {}) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const order = getOrder(id);
      if (!order) {
        db.exec("COMMIT");
        return null;
      }
      const identity = developmentMockIdentity(environment, order, input);
      if (identity.completed) {
        db.exec("COMMIT");
        return { order, fulfilled: false };
      }

      const userRow = db.prepare("SELECT balance FROM users WHERE id = ?").get(order.userId);
      if (!userRow) throw new Error("User not found");
      const now = new Date().toISOString();
      const credits = positiveInt(order.credits, 0);
      const balanceAfter = Number(userRow.balance) + credits;
      const userUpdate = db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?").run(balanceAfter, now, order.userId);
      if (userUpdate.changes !== 1) throw new Error("User not found");
      if (credits > 0) {
        db.prepare(`
          INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(mockGrantTransactionId(order.id), order.userId, credits, input.reason || `order:${order.id}`, balanceAfter, now);
      }
      const orderUpdate = db.prepare(`
        UPDATE orders
        SET status = ?, payment_status = ?, paid_at = COALESCE(paid_at, ?),
            fulfilled_at = ?, credits_granted = ?, updated_at = ?,
            mock_fulfillment_key = ?, mock_event_id = ?,
            mock_provider_transaction_id = ?, external_payment_id = ?
        WHERE id = ? AND status = 'pending' AND payment_status = 'mock_pending' AND fulfilled_at IS NULL
      `).run(
        "paid",
        "fulfilled",
        input.paidAt || now,
        now,
        credits,
        now,
        identity.expected,
        identity.expected,
        identity.expected,
        identity.expected,
        order.id,
      );
      if (orderUpdate.changes !== 1) {
        const error = new Error("Development mock payment required");
        error.status = 409;
        throw error;
      }
      db.exec("COMMIT");
      return { order: getOrder(id), fulfilled: true };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function cancelOrder(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    if (order.fulfilledAt || order.status === "paid") {
      const error = new Error("Paid orders must be refunded instead of canceled");
      error.status = 409;
      throw error;
    }
    if (order.canceledAt) return { order, canceled: false };
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE orders
      SET status = ?, payment_status = ?, canceled_at = ?, admin_note = ?, updated_at = ?
      WHERE id = ?
    `).run("canceled", "canceled", now, input.reason || order.adminNote || "", now, order.id);
    return { order: getOrder(id), canceled: true };
  }

  function refundOrder(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    if (order.refundedAt) return { order, refunded: false, revokedCredits: 0 };
    const user = getUser(order.userId);
    if (!user) throw new Error("User not found");
    const now = new Date().toISOString();
    const grantRemainder = Math.max(0, Number(order.creditsGranted || 0) - Number(order.creditsRevoked || 0));
    const revokedCredits = input.revokeCredits === false ? 0 : Math.min(user.balance, grantRemainder);
    const balanceAfter = user.balance - revokedCredits;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (revokedCredits > 0) {
        db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?").run(balanceAfter, now, user.id);
        db.prepare(`
          INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(transactionId(), user.id, -revokedCredits, input.reason || `refund:${order.id}`, balanceAfter, now);
      }
      db.prepare(`
        UPDATE orders
        SET status = ?, payment_status = ?, refunded_at = ?,
            credits_revoked = credits_revoked + ?, admin_note = ?, updated_at = ?
        WHERE id = ?
      `).run("refunded", "refunded", now, revokedCredits, input.reason || order.adminNote || "", now, order.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { order: getOrder(id), refunded: true, revokedCredits };
  }

  function recordPaymentEvent(event) {
    const id = event.id || auditId();
    const createdAt = event.createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO payment_audit (id, order_id, user_id, type, actor_id, message, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.orderId || "",
      event.userId || "",
      event.type,
      event.actorId || "",
      event.message || "",
      stringify(event.metadata || null),
      createdAt,
    );
    return rowToPaymentEvent(db.prepare("SELECT * FROM payment_audit WHERE id = ?").get(id));
  }

  function listPaymentAudit(options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const filters = [];
    const values = [];
    const userId = String(options.get("userId") || "").trim();
    const orderIdValue = String(options.get("orderId") || "").trim();
    const type = String(options.get("type") || "").trim();
    if (userId) {
      filters.push("user_id = ?");
      values.push(userId);
    }
    if (orderIdValue) {
      filters.push("order_id = ?");
      values.push(orderIdValue);
    }
    if (type) {
      filters.push("type = ?");
      values.push(type);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS total FROM payment_audit ${where}`).get(...values).total;
    const rows = db.prepare(`
      SELECT * FROM payment_audit
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
    return {
      records: rows.map(rowToPaymentEvent),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  function findOwnedImageAsset(userId, assetId) {
    const rows = db.prepare(`
      SELECT id, images_json FROM generation_tasks
      WHERE owner_id = ? AND status = 'completed'
      ORDER BY created_at DESC
    `).all(userId);
    for (const row of rows) {
      for (const image of parseJson(row.images_json, [])) {
        const url = imageUrl(image);
        if (url && matchesAssetId(url, assetId)) {
          return { taskId: row.id, assetId: assetIdForUrl(url), url };
        }
      }
    }
    return null;
  }

  function createTask(task) {
    const createdAt = task.createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO generation_tasks (
        id, owner_id, status, images_json, template_id, provider,
        provider_task_id, mode, prompt, topic, reference_images_json, model,
        output_count, aspect_ratio, resolution, raw_provider_result_json,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        status = excluded.status,
        images_json = excluded.images_json,
        template_id = excluded.template_id,
        provider = excluded.provider,
        provider_task_id = excluded.provider_task_id,
        mode = excluded.mode,
        prompt = excluded.prompt,
        topic = excluded.topic,
        reference_images_json = excluded.reference_images_json,
        model = excluded.model,
        output_count = excluded.output_count,
        aspect_ratio = excluded.aspect_ratio,
        resolution = excluded.resolution,
        raw_provider_result_json = excluded.raw_provider_result_json,
        updated_at = excluded.updated_at
    `).run(
      task.id,
      task.ownerId,
      task.status || "completed",
      stringify(task.images || []),
      task.templateId || null,
      task.provider || null,
      task.providerTaskId || null,
      task.mode || null,
      task.prompt || null,
      task.topic || null,
      stringify(task.referenceImages || []),
      task.model || null,
      positiveInt(task.outputCount, 1),
      task.aspectRatio || null,
      task.resolution || null,
      stringify(task.rawProviderResult || null),
      createdAt,
      new Date().toISOString(),
    );
    return getTask(task.id);
  }

  function getTask(id) {
    const row = db.prepare("SELECT * FROM generation_tasks WHERE id = ?").get(id);
    return row ? rowToTask(row) : null;
  }

  function listTasks(ownerId, options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const filters = ["owner_id = ?"];
    const values = [ownerId];

    const status = String(options.get("status") || "").trim();
    if (status) {
      filters.push("status = ?");
      values.push(status);
    }

    const q = String(options.get("q") || "").trim();
    if (q) {
      filters.push("(prompt LIKE ? OR topic LIKE ? OR model LIKE ? OR template_id LIKE ?)");
      const like = `%${q}%`;
      values.push(like, like, like, like);
    }

    const where = `WHERE ${filters.join(" AND ")}`;
    const total = db.prepare(`SELECT COUNT(*) AS total FROM generation_tasks ${where}`).get(...values).total;
    const rows = db.prepare(`
      SELECT * FROM generation_tasks
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);

    return {
      records: rows.map(rowToTask),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  function syncTemplates(records = []) {
    const updatedAt = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const statement = db.prepare(`
        INSERT INTO templates (
          id, catalog_version_id, title, subtitle, category, scenario_category, tags_json,
          source, source_id, source_url, thumbnail_url, preview_url, reference_images_json,
          preview_images_json, prompt, use_case, author, metrics_json, seed_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          catalog_version_id = excluded.catalog_version_id,
          title = excluded.title,
          subtitle = excluded.subtitle,
          category = excluded.category,
          scenario_category = excluded.scenario_category,
          tags_json = excluded.tags_json,
          source = excluded.source,
          source_id = excluded.source_id,
          source_url = excluded.source_url,
          thumbnail_url = excluded.thumbnail_url,
          preview_url = excluded.preview_url,
          reference_images_json = excluded.reference_images_json,
          preview_images_json = excluded.preview_images_json,
          prompt = excluded.prompt,
          use_case = excluded.use_case,
          author = excluded.author,
          metrics_json = excluded.metrics_json,
          seed_json = excluded.seed_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `);
      records.forEach((record) => {
        statement.run(
          record.id,
          record.catalogVersionId || null,
          record.title || "",
          record.subtitle || "",
          record.category || "",
          record.scenarioCategory || record.scenario_category || "",
          stringify(record.tags || []),
          record.source || "",
          record.sourceId || record.source_id || "",
          record.sourceUrl || record.source_url || "",
          record.thumbnailUrl || record.thumbnail_url || "",
          record.previewUrl || record.preview_url || "",
          stringify(record.referenceImages || record.reference_images || []),
          stringify(record.previewImages || record.preview_images || []),
          record.prompt || "",
          record.useCase || record.use_case || "",
          record.author || "",
          stringify(record.metrics || null),
          stringify(record.seed || null),
          record.createdAt || updatedAt,
          updatedAt,
        );
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return records.length;
  }

  function createCatalogVersion(input) {
    const now = input.createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO template_catalog_versions (id, checksum, source, record_count, active, metadata_json, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET checksum = excluded.checksum, source = excluded.source,
        record_count = excluded.record_count, metadata_json = excluded.metadata_json
    `).run(input.id, input.checksum || "", input.source || "unknown", Number(input.recordCount || 0), stringify(input.metadata || {}), now);
    return rowToCatalogVersion(db.prepare("SELECT * FROM template_catalog_versions WHERE id = ?").get(input.id));
  }

  function getCatalogVersion(versionId) {
    return rowToCatalogVersion(db.prepare("SELECT * FROM template_catalog_versions WHERE id = ?").get(versionId));
  }

  function getActiveCatalogVersion() {
    return rowToCatalogVersion(db.prepare("SELECT * FROM template_catalog_versions WHERE active = 1 LIMIT 1").get());
  }

  function activateCatalogVersion(versionId) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const found = db.prepare("SELECT id FROM template_catalog_versions WHERE id = ?").get(versionId);
      if (!found) throw new Error(`Catalog version not found: ${versionId}`);
      db.prepare("UPDATE template_catalog_versions SET active = 0, activated_at = NULL").run();
      db.prepare("UPDATE template_catalog_versions SET active = 1, activated_at = ? WHERE id = ?").run(new Date().toISOString(), versionId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getCatalogVersion(versionId);
  }

  function importCatalogVersion(input) {
    const records = Array.isArray(input.records) ? input.records : [];
    const ids = new Set();
    for (const record of records) {
      if (!record || !record.id || ids.has(record.id)) throw new Error(`Duplicate catalog id: ${record && record.id}`);
      ids.add(record.id);
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO template_catalog_versions (id, checksum, source, record_count, active, metadata_json, created_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET checksum = excluded.checksum, source = excluded.source,
          record_count = excluded.record_count, metadata_json = excluded.metadata_json
      `).run(input.id, input.checksum || "", input.source || "unknown", Number(input.recordCount || records.length), stringify(input.metadata || {}), now);
      db.prepare("DELETE FROM templates WHERE catalog_version_id = ?").run(input.id);
      const statement = db.prepare(`
        INSERT INTO templates (
          id, catalog_version_id, title, subtitle, category, scenario_category, tags_json,
          source, source_id, source_url, thumbnail_url, preview_url, reference_images_json,
          preview_images_json, prompt, use_case, author, metrics_json, seed_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET catalog_version_id = excluded.catalog_version_id,
          title = excluded.title, subtitle = excluded.subtitle, category = excluded.category,
          scenario_category = excluded.scenario_category, tags_json = excluded.tags_json,
          source = excluded.source, source_id = excluded.source_id, source_url = excluded.source_url,
          thumbnail_url = excluded.thumbnail_url, preview_url = excluded.preview_url,
          reference_images_json = excluded.reference_images_json, preview_images_json = excluded.preview_images_json,
          prompt = excluded.prompt, use_case = excluded.use_case, author = excluded.author,
          metrics_json = excluded.metrics_json, seed_json = excluded.seed_json,
          created_at = excluded.created_at, updated_at = excluded.updated_at
      `);
      for (const record of records) {
        statement.run(
          record.id, input.id, record.title || "", record.subtitle || "", record.category || "",
          record.scenarioCategory || record.scenario_category || "", stringify(record.tags || []),
          record.source || "", record.sourceId || record.source_id || "", record.sourceUrl || record.source_url || "",
          record.thumbnailUrl || record.thumbnail_url || "", record.previewUrl || record.preview_url || "",
          stringify(record.referenceImages || record.reference_images || []), stringify(record.previewImages || record.preview_images || []),
          record.prompt || "", record.useCase || record.use_case || "", record.author || "",
          stringify(record.metrics || null), stringify(record.seed || null), record.createdAt || now, record.updatedAt || now,
        );
      }
      db.prepare("UPDATE template_catalog_versions SET active = 0, activated_at = NULL").run();
      db.prepare("UPDATE template_catalog_versions SET active = 1, activated_at = ? WHERE id = ?").run(now, input.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return getCatalogVersion(input.id);
  }

  function listTemplates(query = new URLSearchParams()) {
    const active = getActiveCatalogVersion();
    const rows = active
      ? db.prepare("SELECT * FROM templates WHERE catalog_version_id = ?").all(active.id)
      : db.prepare("SELECT * FROM templates WHERE catalog_version_id IS NULL").all();
    return queryCatalog(rows.map(rowToTemplate), query, active);
  }

  function getTemplate(id) {
    const active = getActiveCatalogVersion();
    const row = active
      ? db.prepare("SELECT * FROM templates WHERE id = ? AND catalog_version_id = ?").get(id, active.id)
      : db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
    return row ? rowToTemplate(row) : null;
  }

  function queryOrders(whereSql, values, options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const total = db.prepare(`SELECT COUNT(*) AS total FROM orders ${whereSql}`).get(...values).total;
    const rows = db.prepare(`
      SELECT * FROM orders
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
    return {
      records: rows.map(rowToOrder),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  return {
    ensureUser,
    getUser,
    getUserByIdentity,
    createSession,
    getSession,
    getSessionByTokenHash,
    touchSession,
    revokeSession,
    revokeSessionByTokenHash,
    revokeAllSessions,
    updateUserProfile,
    listUsers,
    addCredits,
    charge,
    listCreditTransactions,
    createOrder,
    getOrder,
    listOrders,
    listAllOrders,
    fulfillOrder,
    fulfillMockOrder,
    cancelOrder,
    refundOrder,
    recordPaymentEvent,
    listPaymentAudit,
    findOwnedImageAsset,
    createTask,
    getTask,
    listTasks,
    createCatalogVersion,
    getCatalogVersion,
    getActiveCatalogVersion,
    activateCatalogVersion,
    importCatalogVersion,
    syncTemplates,
    listTemplates,
    getTemplate,
    close() {
      db.close();
    },
  };
}

function migrate(db) {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      appid TEXT NOT NULL,
      openid TEXT NOT NULL,
      unionid TEXT,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_used_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL,
      images_json TEXT NOT NULL,
      template_id TEXT,
      provider TEXT,
      provider_task_id TEXT,
      mode TEXT,
      prompt TEXT,
      topic TEXT,
      reference_images_json TEXT NOT NULL DEFAULT '[]',
      model TEXT,
      output_count INTEGER,
      aspect_ratio TEXT,
      resolution TEXT,
      raw_provider_result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template_catalog_versions (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      source TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      activated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS templates (
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
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      idempotency_key TEXT,
      request_fingerprint TEXT,
      product_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      payment_mode TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      credits INTEGER NOT NULL,
      product_json TEXT NOT NULL,
      payment_params_json TEXT,
      external_payment_id TEXT,
      mock_fulfillment_key TEXT,
      mock_event_id TEXT,
      mock_provider_transaction_id TEXT,
      credits_granted INTEGER NOT NULL DEFAULT 0,
      credits_revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      paid_at TEXT,
      fulfilled_at TEXT,
      refunded_at TEXT,
      canceled_at TEXT,
      admin_note TEXT
    );
    CREATE TABLE IF NOT EXISTS payment_audit (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT,
      message TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "users", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "generation_tasks", "prompt", "TEXT");
  ensureColumn(db, "generation_tasks", "topic", "TEXT");
  ensureColumn(db, "generation_tasks", "reference_images_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "generation_tasks", "model", "TEXT");
  ensureColumn(db, "generation_tasks", "output_count", "INTEGER");
  ensureColumn(db, "generation_tasks", "aspect_ratio", "TEXT");
  ensureColumn(db, "generation_tasks", "resolution", "TEXT");
  ensureColumn(db, "templates", "catalog_version_id", "TEXT");
  ensureColumn(db, "templates", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "templates", "preview_images_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "templates", "created_at", "TEXT");
  ensureColumn(db, "template_catalog_versions", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "template_catalog_versions", "activated_at", "TEXT");
  ensureColumn(db, "orders", "payment_mode", "TEXT");
  ensureColumn(db, "orders", "idempotency_key", "TEXT");
  ensureColumn(db, "orders", "request_fingerprint", "TEXT");
  ensureColumn(db, "orders", "payment_params_json", "TEXT");
  ensureColumn(db, "orders", "external_payment_id", "TEXT");
  ensureColumn(db, "orders", "mock_fulfillment_key", "TEXT");
  ensureColumn(db, "orders", "mock_event_id", "TEXT");
  ensureColumn(db, "orders", "mock_provider_transaction_id", "TEXT");
  ensureColumn(db, "orders", "credits_granted", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "credits_revoked", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "paid_at", "TEXT");
  ensureColumn(db, "orders", "fulfilled_at", "TEXT");
  ensureColumn(db, "orders", "refunded_at", "TEXT");
  ensureColumn(db, "orders", "canceled_at", "TEXT");
  ensureColumn(db, "orders", "admin_note", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_key_unique ON orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL");
}

function ensureColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function transactionId() {
  return `txn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function orderId() {
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function auditId() {
  return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function paginateRecords(records, options = new URLSearchParams()) {
  const page = positiveInt(options.get("page"), 1);
  const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
  const start = (page - 1) * limit;
  return {
    records: records.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: records.length,
      totalPages: Math.max(1, Math.ceil(records.length / limit)),
    },
  };
}

function listOrderRecords(records, options = new URLSearchParams()) {
  const status = String(options.get("status") || "").trim();
  const productId = String(options.get("productId") || "").trim();
  let filtered = records.slice();
  if (status) filtered = filtered.filter((order) => order.status === status);
  if (productId) filtered = filtered.filter((order) => order.productId === productId);
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  return paginateRecords(filtered, options);
}

function imageUrl(image) {
  if (typeof image === "string") return image;
  if (image && typeof image.url === "string") return image.url;
  return "";
}

function assetIdForUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function assetIdForUrlBase64(url) {
  return crypto.createHash("sha256").update(url).digest("base64url");
}

function matchesAssetId(url, assetId) {
  if (!assetId || !url) return false;
  const decodedPathId = decodeURIComponent(assetId);
  if (url === decodedPathId) return true;
  if (assetIdForUrl(url) === decodedPathId || assetIdForUrlBase64(url) === decodedPathId) return true;
  try {
    if (Buffer.from(decodedPathId, "base64url").toString("utf8") === url) return true;
  } catch {
    return false;
  }
  return false;
}

function rowToUser(row) {
  return {
    id: row.id,
    provider: row.provider,
    appid: row.appid,
    openid: row.openid,
    unionid: row.unionid,
    name: row.name,
    balance: row.balance,
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    ipAddress: row.ip_address || "",
    userAgent: row.user_agent || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCreditTransaction(row) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    reason: row.reason,
    balanceAfter: row.balance_after,
    createdAt: row.created_at,
  };
}

function rowToTask(row) {
  return {
    id: row.id,
    taskId: row.id,
    ownerId: row.owner_id,
    status: row.status,
    images: parseJson(row.images_json, []),
    templateId: row.template_id,
    provider: row.provider,
    providerTaskId: row.provider_task_id,
    mode: row.mode,
    prompt: row.prompt || "",
    topic: row.topic || "",
    referenceImages: parseJson(row.reference_images_json, []),
    model: row.model || "",
    outputCount: row.output_count || 1,
    aspectRatio: row.aspect_ratio || "",
    resolution: row.resolution || "",
    rawProviderResult: parseJson(row.raw_provider_result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key || "",
    productId: row.product_id,
    channel: row.channel,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMode: row.payment_mode || "",
    amountCents: row.amount_cents,
    currency: row.currency,
    credits: row.credits,
    productSnapshot: parseJson(row.product_json, null),
    paymentParams: parseJson(row.payment_params_json, null),
    externalPaymentId: row.external_payment_id || "",
    mockFulfillmentKey: row.mock_fulfillment_key || "",
    mockEventId: row.mock_event_id || "",
    mockProviderTransactionId: row.mock_provider_transaction_id || "",
    creditsGranted: row.credits_granted || 0,
    creditsRevoked: row.credits_revoked || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at || null,
    fulfilledAt: row.fulfilled_at || null,
    refundedAt: row.refunded_at || null,
    canceledAt: row.canceled_at || null,
    adminNote: row.admin_note || "",
  };
}

function rowToPaymentEvent(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    type: row.type,
    actorId: row.actor_id || "",
    message: row.message || "",
    metadata: parseJson(row.metadata_json, null),
    createdAt: row.created_at,
  };
}

function rowToCatalogVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    checksum: row.checksum || "",
    source: row.source || "",
    recordCount: Number(row.record_count || 0),
    metadata: parseJson(row.metadata_json, {}),
    active: Boolean(row.active),
    createdAt: row.created_at || null,
    activatedAt: row.activated_at || null,
  };
}

function rowToTemplate(row) {
  return {
    id: row.id,
    catalogVersionId: row.catalog_version_id || null,
    title: row.title,
    subtitle: row.subtitle,
    category: row.category,
    scenarioCategory: row.scenario_category,
    tags: parseJson(row.tags_json, []),
    source: row.source,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url,
    previewUrl: row.preview_url,
    referenceImages: parseJson(row.reference_images_json, []),
    previewImages: parseJson(row.preview_images_json, []),
    prompt: row.prompt,
    useCase: row.use_case,
    author: row.author,
    metrics: parseJson(row.metrics_json, null),
    seed: parseJson(row.seed_json, null),
    createdAt: row.created_at || row.updated_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createMemoryStore,
  createSqliteStore,
};
