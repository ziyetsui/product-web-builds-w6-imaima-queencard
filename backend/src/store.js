const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { assertSessionTokenHash } = require("./auth");
const {
  queryCatalog,
  recordsChecksum,
  validateCatalogVersionInput,
} = require("./services/catalog-service");

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
  const clock = options.clock || (() => new Date());
  const users = new Map();
  const sessions = new Map();
  const tasks = new Map();
  const creditHolds = new Map();
  const referenceAssets = new Map();
  const generatedAssets = new Map();
  const creditTransactions = [];
  const templates = new Map();
  const catalogRecords = new Map();
  const catalogVersions = new Map();
  let activeCatalogVersionId = null;
  const orders = new Map();
  const paymentAudit = [];
  const adminAudit = [];
  const paymentFulfillments = new Map();

  function nowIso(value) {
    const current = value instanceof Date ? value : typeof value === "number" ? new Date(value) : clock();
    return current instanceof Date ? current.toISOString() : String(current);
  }

  function memoryCreditError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

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
      metadata: order.metadata || {},
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
      paymentVerified: false,
      refundStatus: "none",
      refundProviderId: "",
      refundAmountCents: 0,
      refundAcceptedAt: null,
      refundCompletedAt: null,
      refundError: "",
      reconcileLeaseOwner: "",
      reconcileLeaseExpiresAt: null,
      lastReconciledAt: null,
    };
    Object.defineProperty(saved, "requestFingerprint", { value: requestFingerprint, enumerable: false });
    orders.set(saved.id, saved);
    return markOrderCreation(saved, true);
  }

  function getOrder(id) {
    return orders.get(id) || null;
  }

  function getOrderByIdempotencyKey(userId, key) {
    return Array.from(orders.values()).find((order) => order.userId === userId && order.idempotencyKey === key) || null;
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

  function getPaymentFulfillment(key) {
    return paymentFulfillments.get(String(key || "")) || null;
  }

  function fulfillPayment(input = {}) {
    if (input.paymentVerified !== true || input.provider !== "wechat" || input.status !== "FULFILLED" || !input.fulfillmentKey || !input.orderId || !input.eventId || !input.providerTransactionId) {
      throw memoryCreditError("Verified WeChat payment required", 409);
    }
    const existing = getPaymentFulfillment(input.fulfillmentKey);
    if (existing) {
      if (existing.orderId !== input.orderId || existing.eventId !== input.eventId || existing.providerTransactionId !== input.providerTransactionId) {
        throw memoryCreditError("Payment fulfillment identity conflict", 409);
      }
      return existing;
    }
    const order = getOrder(input.orderId);
    if (!order || order.paymentMode !== "wechat") throw memoryCreditError("Verified WeChat payment required", 409);
    if (order.fulfilledAt || order.status === "paid") throw memoryCreditError("Payment fulfillment identity conflict", 409);
    const result = fulfillOrder(order.id, {
      paidAt: input.paidAt,
      reason: `wechat-payment:${input.eventId}`,
    });
    result.order.externalPaymentId = input.providerTransactionId;
    result.order.paymentVerified = true;
    result.order.metadata = {
      ...(result.order.metadata || {}),
      ...(input.metadata || {}),
      paymentVerification: "verified",
      paymentEventId: input.eventId,
    };
    const fulfillment = {
      id: input.id || `fulfillment_${crypto.randomUUID()}`,
      fulfillmentKey: input.fulfillmentKey,
      orderId: input.orderId,
      provider: "wechat",
      eventId: input.eventId,
      eventType: input.eventType || "",
      providerOrderId: input.providerOrderId || "",
      providerTransactionId: input.providerTransactionId,
      status: "FULFILLED",
      errorMessage: "",
      metadata: { ...(input.metadata || {}), paymentVerified: true, verificationMode: "wechat" },
      fulfilledAt: input.paidAt || nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    paymentFulfillments.set(fulfillment.fulfillmentKey, fulfillment);
    return fulfillment;
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

  function acceptRefund(id, input = {}) {
    const order = orders.get(id);
    if (!order) return null;
    if (order.refundedAt || order.refundStatus === "succeeded") return { order, accepted: false };
    if (["accepted", "processing"].includes(order.refundStatus)) return { order, accepted: false };
    if (order.status !== "paid") {
      const error = new Error("Only paid orders can be refunded");
      error.status = 409;
      throw error;
    }
    const now = nowIso();
    order.paymentStatus = "refund_pending";
    order.refundStatus = input.refundStatus || "accepted";
    order.refundProviderId = input.refundId || order.refundProviderId || "";
    order.refundAmountCents = Number(input.refundAmountCents || order.amountCents);
    order.refundAcceptedAt = order.refundAcceptedAt || now;
    order.refundError = "";
    order.metadata = { ...(order.metadata || {}), refund: { ...(order.metadata?.refund || {}), ...(input.metadata || {}), id: order.refundProviderId, status: order.refundStatus } };
    order.updatedAt = now;
    return { order, accepted: true };
  }

  function failRefund(id, input = {}) {
    const order = orders.get(id);
    if (!order) return null;
    if (order.refundedAt) return { order, failed: false };
    const now = nowIso();
    if (order.paymentStatus === "refund_pending") order.paymentStatus = "fulfilled";
    order.refundStatus = "failed";
    order.refundError = input.error || "Refund failed";
    order.metadata = { ...(order.metadata || {}), refund: { ...(order.metadata?.refund || {}), ...(input.metadata || {}), status: "failed" } };
    order.updatedAt = now;
    return { order, failed: true };
  }

  function completeRefund(id, input = {}) {
    const order = orders.get(id);
    if (!order) return null;
    if (order.refundedAt || order.refundStatus === "succeeded") return { order, completed: false, revokedCredits: 0 };
    if (!input.allowUnaccepted && !input.verified && !["accepted", "processing"].includes(order.refundStatus)) {
      const error = new Error("Verified refund completion required");
      error.status = 409;
      throw error;
    }
    const user = users.get(order.userId);
    if (!user) throw new Error("User not found");
    const now = nowIso();
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
    order.refundStatus = "succeeded";
    order.refundedAt = now;
    order.refundCompletedAt = now;
    order.refundProviderId = input.refundId || order.refundProviderId || "";
    order.refundAmountCents = Number(input.refundAmountCents || order.refundAmountCents || order.amountCents);
    order.refundError = "";
    order.creditsRevoked = Number(order.creditsRevoked || 0) + revokedCredits;
    order.adminNote = input.reason || order.adminNote || "";
    order.updatedAt = now;
    return { order, refunded: true, completed: true, revokedCredits };
  }

  function refundOrder(id, input = {}) {
    return completeRefund(id, { ...input, allowUnaccepted: true });
  }

  function claimStaleOrders(workerId, input = {}) {
    const now = nowIso(input.now);
    const staleBefore = Date.parse(now) - Number(input.staleAfterMs || 300000);
    const limit = Math.min(Math.max(Number(input.limit || 10), 1), 100);
    const leaseExpiresAt = new Date(Date.parse(now) + Number(input.leaseDurationMs || 60000)).toISOString();
    const candidates = Array.from(orders.values())
      .filter((order) => order.paymentMode === "wechat")
      .filter((order) => (order.status === "pending" && !["fulfilled", "canceled", "refunded"].includes(order.paymentStatus))
        || ["accepted", "processing"].includes(order.refundStatus))
      .filter((order) => !order.reconcileLeaseExpiresAt || Date.parse(order.reconcileLeaseExpiresAt) <= Date.parse(now))
      .filter((order) => Date.parse(order.lastReconciledAt || order.updatedAt || order.createdAt) <= staleBefore)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id))
      .slice(0, limit);
    for (const order of candidates) {
      order.reconcileLeaseOwner = workerId;
      order.reconcileLeaseExpiresAt = leaseExpiresAt;
    }
    return candidates;
  }

  function releaseOrderReconciliationLease(id, workerId, input = {}) {
    const order = orders.get(id);
    if (!order || order.reconcileLeaseOwner !== workerId) return null;
    order.reconcileLeaseOwner = "";
    order.reconcileLeaseExpiresAt = null;
    if (input.reconciledAt) order.lastReconciledAt = nowIso(input.reconciledAt);
    return order;
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

  function recordAdminAudit(input = {}) {
    const saved = {
      id: input.id || auditId(),
      actorUserId: input.actorUserId || "",
      targetUserId: input.targetUserId || null,
      action: input.action || "",
      entityType: input.entityType || "",
      entityId: input.entityId || null,
      reason: input.reason || "",
      before: input.before == null ? null : input.before,
      after: input.after == null ? null : input.after,
      ipAddress: input.ipAddress || "",
      userAgent: input.userAgent || "",
      createdAt: input.createdAt || nowIso(),
    };
    adminAudit.push(saved);
    return saved;
  }

  function listAdminAudit(options = {}) {
    const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
    let records = adminAudit.slice();
    if (params.get("actorUserId")) records = records.filter((record) => record.actorUserId === params.get("actorUserId"));
    if (params.get("targetUserId")) records = records.filter((record) => record.targetUserId === params.get("targetUserId"));
    if (params.get("action")) records = records.filter((record) => record.action === params.get("action"));
    records.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    return paginateRecords(records, params);
  }

  function findOwnedImageAsset(userId, assetId) {
    const direct = findOwnedAsset(userId, assetId);
    if (direct) return { taskId: direct.taskId, assetId: direct.id, url: direct.providerUrl || direct.objectKey };
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

  function creditHoldRequest(input) {
    return { userId: input.userId, taskId: input.taskId || "", idempotencyKey: String(input.idempotencyKey || ""), credits: Number(input.credits) };
  }

  function createCreditHold(input) {
    const expected = creditHoldRequest(input);
    if (!expected.idempotencyKey || !Number.isInteger(expected.credits) || expected.credits <= 0) {
      const error = new Error("Invalid credit hold"); error.status = 400; throw error;
    }
    const requestFingerprint = fingerprint(expected);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT * FROM credit_holds WHERE idempotency_key = ?").get(expected.idempotencyKey);
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) { const error = new Error("Credit hold idempotency conflict"); error.status = 409; throw error; }
        db.exec("COMMIT");
        return rowToCreditHold(existing);
      }
      const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(expected.userId);
      if (!user) { const error = new Error("User not found"); error.status = 404; throw error; }
      if (Number(user.balance) < expected.credits) { const error = new Error("Insufficient credits"); error.status = 402; throw error; }
      const now = clock().toISOString();
      const id = input.id || `hold_${crypto.randomUUID()}`;
      db.prepare("UPDATE users SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?").run(expected.credits, now, expected.userId, expected.credits);
      db.prepare("INSERT INTO credit_holds (id, user_id, task_id, idempotency_key, credits, request_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, expected.userId, expected.taskId || null, expected.idempotencyKey, expected.credits, requestFingerprint, now);
      db.exec("COMMIT");
      return getCreditHold(id);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function getCreditHold(holdId) {
    const row = db.prepare("SELECT * FROM credit_holds WHERE id = ?").get(holdId);
    return row ? rowToCreditHold(row) : null;
  }

  function settleCreditHold(holdId, actualCredits, input = {}) {
    const hold = getCreditHold(holdId);
    if (!hold || hold.status !== "HOLDING") return hold;
    const settledCredits = Number(actualCredits);
    if (!Number.isInteger(settledCredits) || settledCredits < 0 || settledCredits > hold.credits) { const error = new Error("Invalid settled credit amount"); error.status = 400; throw error; }
    const now = clock().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const released = hold.credits - settledCredits;
      db.prepare("UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?").run(released, now, hold.userId);
      if (settledCredits > 0) db.prepare("INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at) SELECT ?, ?, ?, ?, balance, ? FROM users WHERE id = ?").run(input.transactionId || transactionId(), hold.userId, -settledCredits, input.reason || `hold:${hold.id}`, now, hold.userId);
      db.prepare("UPDATE credit_holds SET settled_credits = ?, status = 'SETTLED', settled_at = ? WHERE id = ? AND status = 'HOLDING'").run(settledCredits, now, holdId);
      db.exec("COMMIT");
      return getCreditHold(holdId);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function releaseCreditHold(holdId) {
    const hold = getCreditHold(holdId);
    if (!hold || hold.status !== "HOLDING") return hold;
    const now = clock().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?").run(hold.credits, now, hold.userId);
      db.prepare("UPDATE credit_holds SET status = 'RELEASED', settled_at = ? WHERE id = ? AND status = 'HOLDING'").run(now, holdId);
      db.exec("COMMIT");
      return getCreditHold(holdId);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
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

  function createReferenceAsset(input) {
    const createdAt = input.createdAt || nowIso();
    const saved = {
      id: input.id || `asset_${crypto.randomUUID()}`,
      assetId: input.id || "",
      taskId: null,
      userId: input.userId,
      objectKey: input.objectKey,
      providerUrl: "",
      mimeType: input.mimeType,
      width: input.width || null,
      height: input.height || null,
      sizeBytes: input.sizeBytes || null,
      isDeleted: false,
      metadata: input.metadata || {},
      createdAt,
    };
    saved.assetId = saved.id;
    referenceAssets.set(saved.id, saved);
    return saved;
  }

  function getReferenceAsset(assetId) {
    const asset = referenceAssets.get(assetId);
    return asset && !asset.isDeleted ? asset : null;
  }

  function listReferenceAssets(userId, options = new URLSearchParams()) {
    const records = Array.from(referenceAssets.values()).filter((asset) => asset.userId === userId && !asset.isDeleted);
    return paginateRecords(records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), options);
  }

  function deleteReferenceAsset(assetId, userId) {
    const asset = referenceAssets.get(assetId);
    if (!asset || asset.userId !== userId || asset.isDeleted) return null;
    asset.isDeleted = true;
    asset.deletedAt = nowIso();
    return asset;
  }

  function createGeneratedAsset(input) {
    const key = `${input.taskId}:${Number(input.outputIndex || 0)}`;
    const existing = Array.from(generatedAssets.values()).find((asset) => asset.taskId === input.taskId && asset.outputIndex === Number(input.outputIndex || 0));
    const saved = {
      ...(existing || {}),
      id: existing?.id || input.id || `asset_${crypto.randomUUID()}`,
      assetId: existing?.id || input.id || "",
      taskId: input.taskId,
      userId: input.userId,
      outputIndex: Number(input.outputIndex || 0),
      objectKey: input.objectKey,
      providerUrl: input.providerUrl || "",
      mimeType: input.mimeType || "image/png",
      width: input.width || null,
      height: input.height || null,
      sizeBytes: input.sizeBytes || null,
      isDeleted: false,
      metadata: input.metadata || {},
      createdAt: existing?.createdAt || input.createdAt || nowIso(),
    };
    saved.assetId = saved.id;
    generatedAssets.set(saved.id, saved);
    return saved;
  }

  function getAsset(assetId) {
    const asset = generatedAssets.get(assetId);
    return asset && !asset.isDeleted ? asset : null;
  }

  function findOwnedAsset(userId, assetId) {
    const asset = getAsset(assetId);
    return asset && asset.userId === userId ? asset : null;
  }

  function listAssets(userId, options = new URLSearchParams()) {
    const records = Array.from(generatedAssets.values()).filter((asset) => asset.userId === userId && !asset.isDeleted);
    return paginateRecords(records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), options);
  }

  function deleteAsset(assetId, userId) {
    const asset = generatedAssets.get(assetId);
    if (!asset || asset.userId !== userId || asset.isDeleted) return null;
    asset.isDeleted = true;
    return asset;
  }

  function creditHoldRequest(input) {
    return {
      userId: input.userId,
      taskId: input.taskId || "",
      idempotencyKey: String(input.idempotencyKey || ""),
      credits: Number(input.credits),
    };
  }

  function createCreditHold(input) {
    const expected = creditHoldRequest(input);
    if (!expected.idempotencyKey || !Number.isInteger(expected.credits) || expected.credits <= 0) throw memoryCreditError("Invalid credit hold", 400);
    const requestFingerprint = fingerprint(expected);
    const existing = Array.from(creditHolds.values()).find((hold) => hold.idempotencyKey === expected.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw memoryCreditError("Credit hold idempotency conflict", 409);
      return existing;
    }
    const user = users.get(expected.userId);
    if (!user) throw memoryCreditError("User not found", 404);
    if (user.balance < expected.credits) throw memoryCreditError("Insufficient credits", 402);
    const now = nowIso();
    user.balance -= expected.credits;
    user.updatedAt = now;
    const hold = {
      id: input.id || `hold_${crypto.randomUUID()}`,
      userId: expected.userId,
      taskId: expected.taskId,
      idempotencyKey: expected.idempotencyKey,
      credits: expected.credits,
      settledCredits: 0,
      status: "HOLDING",
      packageAllocation: [],
      requestFingerprint,
      createdAt: now,
      settledAt: null,
    };
    creditHolds.set(hold.id, hold);
    return hold;
  }

  function getCreditHold(holdId) {
    return creditHolds.get(holdId) || null;
  }

  function settleCreditHold(holdId, actualCredits, input = {}) {
    const hold = creditHolds.get(holdId);
    if (!hold) return null;
    if (hold.status !== "HOLDING") return hold;
    const settledCredits = Number(actualCredits);
    if (!Number.isInteger(settledCredits) || settledCredits < 0 || settledCredits > hold.credits) throw memoryCreditError("Invalid settled credit amount", 400);
    const now = nowIso();
    const released = hold.credits - settledCredits;
    const user = users.get(hold.userId);
    user.balance += released;
    user.updatedAt = now;
    if (settledCredits > 0) creditTransactions.push({
      id: input.transactionId || transactionId(),
      userId: hold.userId,
      amount: -settledCredits,
      reason: input.reason || `hold:${hold.id}`,
      balanceAfter: user.balance,
      taskId: hold.taskId,
      holdId: hold.id,
      createdAt: now,
    });
    hold.settledCredits = settledCredits;
    hold.status = "SETTLED";
    hold.settledAt = now;
    return hold;
  }

  function releaseCreditHold(holdId) {
    const hold = creditHolds.get(holdId);
    if (!hold) return null;
    if (hold.status !== "HOLDING") return hold;
    const user = users.get(hold.userId);
    user.balance += hold.credits;
    user.updatedAt = nowIso();
    hold.status = "RELEASED";
    hold.settledAt = nowIso();
    return hold;
  }

  function createTaskWithCreditHold(input) {
    const existing = Array.from(tasks.values()).find((task) => task.ownerId === input.task.ownerId && task.idempotencyKey === input.task.idempotencyKey);
    if (existing) {
      const hold = getCreditHold(existing.creditHoldId) || Array.from(creditHolds.values()).find((candidate) => candidate.taskId === existing.id);
      if (!hold) throw memoryCreditError("Generation task hold is missing", 409);
      return { task: existing, hold, created: false };
    }
    const hold = createCreditHold(input.hold);
    const task = createTask({ ...input.task, creditHoldId: hold.id, requestedCredits: input.hold.credits });
    return { task, hold, created: true };
  }

  function claimTask(workerId, input = {}) {
    const now = input.now !== undefined ? new Date(input.now) : (input.clock ? new Date(input.clock()) : clock());
    const nowValue = now.getTime();
    const leaseDurationMs = Number(input.leaseDurationMs || 60000);
    const candidate = Array.from(tasks.values())
      .filter((task) => ["pending", "retryable"].includes(task.status))
      .filter((task) => (!task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= nowValue) && (!task.nextAttemptAt || Date.parse(task.nextAttemptAt) <= nowValue))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!candidate) return null;
    candidate.status = "leased";
    candidate.leaseOwner = workerId;
    candidate.leaseExpiresAt = new Date(nowValue + leaseDurationMs).toISOString();
    candidate.attempt = Number(candidate.attempt || 0) + 1;
    candidate.startedAt = candidate.startedAt || now.toISOString();
    candidate.updatedAt = now.toISOString();
    return candidate;
  }

  function renewTaskLease(taskIdValue, workerId, input = {}) {
    const task = tasks.get(taskIdValue);
    if (!task || task.leaseOwner !== workerId || !["leased", "processing"].includes(task.status)) return null;
    const now = input.now !== undefined ? new Date(input.now) : clock();
    task.leaseExpiresAt = new Date(now.getTime() + Number(input.leaseDurationMs || 60000)).toISOString();
    task.updatedAt = now.toISOString();
    return task;
  }

  function releaseTaskLease(taskIdValue, workerId, input = {}) {
    const task = tasks.get(taskIdValue);
    if (!task || task.leaseOwner !== workerId) return null;
    const now = nowIso();
    task.status = input.status || "pending";
    task.leaseOwner = "";
    task.leaseExpiresAt = null;
    if (input.errorCode) task.errorCode = input.errorCode;
    if (input.errorMessage) task.errorMessage = input.errorMessage;
    task.updatedAt = now;
    if (task.status === "completed") task.completedAt = task.completedAt || now;
    return task;
  }

  function reclaimExpiredTasks(input) {
    const now = input instanceof Date ? input.getTime() : input !== undefined ? new Date(input).getTime() : clock().getTime();
    return Array.from(tasks.values()).filter((task) => ["leased", "processing"].includes(task.status) && task.leaseExpiresAt && Date.parse(task.leaseExpiresAt) <= now).map((task) => {
      task.status = "retryable";
      task.leaseOwner = "";
      task.leaseExpiresAt = null;
      task.updatedAt = new Date(now).toISOString();
      return task;
    });
  }

  function updateTask(taskIdValue, updates = {}) {
    const task = tasks.get(taskIdValue);
    if (!task) return null;
    for (const key of ["status", "images", "provider", "providerTaskId", "providerResultUrl", "rawProviderResult", "errorCode", "errorMessage", "settledCredits", "completedAt", "nextAttemptAt", "metadata"]) {
      if (updates[key] !== undefined) task[key] = updates[key];
    }
    task.updatedAt = nowIso();
    return task;
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

  function getCatalogVersionState(versionId) {
    const version = getCatalogVersion(versionId);
    if (!version) return null;
    const records = Array.from((catalogRecords.get(versionId) || new Map()).values());
    const persistedChecksum = recordsChecksum(records);
    return {
      version,
      persistedRecordCount: records.length,
      persistedChecksum,
      complete: records.length === version.recordCount && persistedChecksum === version.checksum,
    };
  }

  function activateCatalogVersion(versionId) {
    const state = getCatalogVersionState(versionId);
    if (!state) throw new Error(`Catalog version not found: ${versionId}`);
    if (state.persistedRecordCount !== state.version.recordCount) throw new Error(`Catalog version incomplete: ${versionId} record count mismatch`);
    if (state.persistedChecksum !== state.version.checksum) throw new Error(`Catalog version checksum mismatch: ${versionId}`);
    const version = state.version;
    for (const candidate of catalogVersions.values()) candidate.active = false;
    version.active = true;
    version.activatedAt = new Date().toISOString();
    activeCatalogVersionId = versionId;
    return version;
  }

  function importCatalogVersion(input) {
    const { records } = validateCatalogVersionInput(input);
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
    return saved;
  }

  function syncTemplates(records = [], input = {}) {
    const target = input.catalogVersionId ? (catalogRecords.get(input.catalogVersionId) || new Map()) : templates;
    records.forEach((record) => target.set(record.id, record));
    if (input.catalogVersionId) {
      catalogRecords.set(input.catalogVersionId, target);
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
    createCreditPackage(input) {
      return { id: input.id || `package_${crypto.randomUUID()}`, userId: input.userId, initialCredits: input.initialCredits || 0, remainingCredits: (input.remainingCredits ?? input.initialCredits) || 0, frozenCredits: 0, status: "ACTIVE" };
    },
    getCreditPackage() { return null; },
    listCreditPackages() { return { records: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }; },
    createCreditHold,
    getCreditHold,
    settleCreditHold,
    releaseCreditHold,
    listCreditTransactions,
    createOrder,
    getOrder,
    getOrderByIdempotencyKey,
    listOrders,
    listAllOrders,
    fulfillOrder,
    fulfillMockOrder,
    fulfillPayment,
    getPaymentFulfillment,
    cancelOrder,
    acceptRefund,
    completeRefund,
    failRefund,
    refundOrder,
    claimStaleOrders,
    releaseOrderReconciliationLease,
    recordPaymentEvent,
    listPaymentAudit,
    recordAdminAudit,
    listAdminAudit,
    findOwnedImageAsset,
    createTask,
    createTaskWithCreditHold,
    getTask,
    listTasks,
    claimTask,
    renewTaskLease,
    releaseTaskLease,
    reclaimExpiredTasks,
    updateTask,
    createAsset: createGeneratedAsset,
    createGeneratedAsset,
    getAsset,
    getGeneratedAsset: getAsset,
    findOwnedAsset,
    listAssets,
    listGeneratedAssets: listAssets,
    deleteAsset,
    createReferenceAsset,
    getReferenceAsset,
    listReferenceAssets,
    deleteReferenceAsset,
    createCatalogVersion,
    getCatalogVersion,
    getCatalogVersionState,
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
  const clock = options.clock || (() => new Date());
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

  function getPaymentFulfillment(key) {
    const row = db.prepare("SELECT * FROM payment_fulfillments WHERE fulfillment_key = ?").get(String(key || ""));
    return row ? rowToPaymentFulfillment(row) : null;
  }

  function fulfillPayment(input = {}) {
    if (input.paymentVerified !== true || input.provider !== "wechat" || input.status !== "FULFILLED" || !input.fulfillmentKey || !input.orderId || !input.eventId || !input.providerTransactionId) {
      const error = new Error("Verified WeChat payment required");
      error.status = 409;
      throw error;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const matches = db.prepare(`
        SELECT * FROM payment_fulfillments
        WHERE fulfillment_key = ? OR (provider = ? AND provider_transaction_id = ?) OR (provider = ? AND event_id = ?)
      `).all(input.fulfillmentKey, input.provider, input.providerTransactionId, input.provider, input.eventId);
      if (matches.length) {
        if (matches.length !== 1) throw new Error("Payment fulfillment identity conflict");
        const existing = rowToPaymentFulfillment(matches[0]);
        if (existing.orderId !== input.orderId || existing.eventId !== input.eventId || existing.providerTransactionId !== input.providerTransactionId) {
          const error = new Error("Payment fulfillment identity conflict");
          error.status = 409;
          throw error;
        }
        db.exec("COMMIT");
        return existing;
      }
      const orderRow = db.prepare("SELECT * FROM orders WHERE id = ?").get(input.orderId);
      const order = orderRow ? rowToOrder(orderRow) : null;
      if (!order || order.paymentMode !== "wechat" || order.fulfilledAt || order.status === "paid") {
        const error = new Error("Verified WeChat payment required");
        error.status = 409;
        throw error;
      }
      const userRow = db.prepare("SELECT balance FROM users WHERE id = ?").get(order.userId);
      if (!userRow) throw new Error("User not found");
      const now = new Date().toISOString();
      const credits = positiveInt(order.credits, 0);
      const balanceAfter = Number(userRow.balance) + credits;
      db.prepare("UPDATE users SET balance = ?, updated_at = ? WHERE id = ?").run(balanceAfter, now, order.userId);
      if (credits > 0) {
        db.prepare("INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(transactionId(), order.userId, credits, `wechat-payment:${input.eventId}`, balanceAfter, now);
      }
      const metadata = { ...(order.metadata || {}), ...(input.metadata || {}), paymentVerification: "verified", paymentEventId: input.eventId };
      db.prepare(`
        UPDATE orders
        SET status = 'paid', payment_status = 'fulfilled', payment_verified = 1,
            paid_at = COALESCE(paid_at, ?), fulfilled_at = ?, credits_granted = ?,
            external_payment_id = COALESCE(external_payment_id, ?), metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(input.paidAt || now, now, credits, input.providerTransactionId, stringify(metadata), now, order.id);
      const fulfillmentId = input.id || `fulfillment_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO payment_fulfillments (
          id, fulfillment_key, order_id, provider, event_id, event_type,
          provider_order_id, provider_transaction_id, status, metadata_json,
          fulfilled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fulfillmentId,
        input.fulfillmentKey,
        order.id,
        "wechat",
        input.eventId,
        input.eventType || "",
        input.providerOrderId || "",
        input.providerTransactionId,
        "FULFILLED",
        stringify({ ...(input.metadata || {}), paymentVerified: true, verificationMode: "wechat" }),
        input.paidAt || now,
        now,
        now,
      );
      db.exec("COMMIT");
      return getPaymentFulfillment(input.fulfillmentKey);
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

  function acceptRefund(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    if (order.refundedAt || order.refundStatus === "succeeded") return { order, accepted: false };
    if (["accepted", "processing"].includes(order.refundStatus)) return { order, accepted: false };
    if (order.status !== "paid") {
      const error = new Error("Only paid orders can be refunded");
      error.status = 409;
      throw error;
    }
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE orders
      SET payment_status = 'refund_pending', refund_status = ?, refund_provider_id = ?,
          refund_amount_cents = ?, refund_accepted_at = COALESCE(refund_accepted_at, ?),
          refund_error = '', metadata_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.refundStatus || "accepted",
      input.refundId || order.refundProviderId || "",
      Number(input.refundAmountCents || order.amountCents),
      now,
      stringify({ ...(order.metadata || {}), refund: { ...((order.metadata || {}).refund || {}), ...(input.metadata || {}) } }),
      now,
      order.id,
    );
    return { order: getOrder(id), accepted: true };
  }

  function failRefund(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    if (order.refundedAt) return { order, failed: false };
    const now = new Date().toISOString();
    db.prepare("UPDATE orders SET payment_status = CASE WHEN payment_status = 'refund_pending' THEN 'fulfilled' ELSE payment_status END, refund_status = 'failed', refund_error = ?, metadata_json = ?, updated_at = ? WHERE id = ?").run(
      input.error || "Refund failed",
      stringify({ ...(order.metadata || {}), refund: { ...((order.metadata || {}).refund || {}), ...(input.metadata || {}), status: "failed" } }),
      now,
      id,
    );
    return { order: getOrder(id), failed: true };
  }

  function completeRefund(id, input = {}) {
    const order = getOrder(id);
    if (!order) return null;
    if (order.refundedAt || order.refundStatus === "succeeded") return { order, completed: false, revokedCredits: 0 };
    if (!input.allowUnaccepted && !input.verified && !["accepted", "processing"].includes(order.refundStatus)) {
      const error = new Error("Verified refund completion required");
      error.status = 409;
      throw error;
    }
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
            refund_status = 'succeeded', refund_completed_at = ?,
            refund_provider_id = COALESCE(?, refund_provider_id),
            refund_amount_cents = COALESCE(?, refund_amount_cents),
            credits_revoked = credits_revoked + ?, admin_note = ?, updated_at = ?
        WHERE id = ?
      `).run("refunded", "refunded", now, now, input.refundId || null, Number(input.refundAmountCents || 0) || null, revokedCredits, input.reason || order.adminNote || "", now, order.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { order: getOrder(id), refunded: true, completed: true, revokedCredits };
  }

  function refundOrder(id, input = {}) {
    return completeRefund(id, { ...input, allowUnaccepted: true });
  }

  function claimStaleOrders(workerId, input = {}) {
    const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
    const nowIsoValue = now.toISOString();
    const staleBefore = new Date(now.getTime() - Number(input.staleAfterMs || 300000)).toISOString();
    const limit = Math.min(Math.max(Number(input.limit || 10), 1), 100);
    const expires = new Date(now.getTime() + Number(input.leaseDurationMs || 60000)).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = db.prepare(`
        SELECT * FROM orders
        WHERE payment_mode = 'wechat'
          AND ((status = 'pending' AND payment_status NOT IN ('fulfilled', 'canceled', 'refunded'))
            OR refund_status IN ('accepted', 'processing'))
          AND COALESCE(last_reconciled_at, updated_at) <= ?
          AND (reconcile_lease_expires_at IS NULL OR reconcile_lease_expires_at <= ?)
        ORDER BY created_at ASC, id ASC LIMIT ?
      `).all(staleBefore, nowIsoValue, limit);
      for (const row of rows) db.prepare("UPDATE orders SET reconcile_lease_owner = ?, reconcile_lease_expires_at = ? WHERE id = ?").run(workerId, expires, row.id);
      db.exec("COMMIT");
      return rows.map((row) => getOrder(row.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function releaseOrderReconciliationLease(id, workerId, input = {}) {
    const now = input.reconciledAt instanceof Date ? input.reconciledAt.toISOString() : input.reconciledAt || null;
    const result = db.prepare("UPDATE orders SET reconcile_lease_owner = NULL, reconcile_lease_expires_at = NULL, last_reconciled_at = COALESCE(?, last_reconciled_at) WHERE id = ? AND reconcile_lease_owner = ?").run(now, id, workerId);
    return result.changes ? getOrder(id) : null;
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

  function recordAdminAudit(input = {}) {
    const id = input.id || `admin_audit_${crypto.randomUUID()}`;
    const createdAt = input.createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO admin_audit_logs (
        id, actor_user_id, target_user_id, action, entity_type, entity_id, reason,
        before_state_json, after_state_json, ip_address, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.actorUserId,
      input.targetUserId || null,
      input.action,
      input.entityType,
      input.entityId || null,
      input.reason || "",
      stringify(input.before == null ? null : input.before),
      stringify(input.after == null ? null : input.after),
      input.ipAddress || null,
      input.userAgent || null,
      createdAt,
    );
    return rowToAdminAudit(db.prepare("SELECT * FROM admin_audit_logs WHERE id = ?").get(id));
  }

  function listAdminAudit(options = {}) {
    const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
    const page = positiveInt(params.get("page"), 1);
    const limit = Math.min(positiveInt(params.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const filters = [];
    const values = [];
    if (params.get("actorUserId")) { filters.push("actor_user_id = ?"); values.push(params.get("actorUserId")); }
    if (params.get("targetUserId")) { filters.push("target_user_id = ?"); values.push(params.get("targetUserId")); }
    if (params.get("action")) { filters.push("action = ?"); values.push(params.get("action")); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS total FROM admin_audit_logs ${where}`).get(...values).total;
    const rows = db.prepare(`SELECT * FROM admin_audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset);
    return { records: rows.map(rowToAdminAudit), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  function findOwnedImageAsset(userId, assetId) {
    const direct = findOwnedAsset(userId, assetId);
    if (direct) return { taskId: direct.taskId, assetId: direct.id, url: direct.providerUrl || direct.objectKey };
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

  function createReferenceAsset(input) {
    const id = input.id || `asset_${crypto.randomUUID()}`;
    const createdAt = input.createdAt || clock().toISOString();
    db.prepare("INSERT INTO reference_assets (id, user_id, object_key, mime_type, width, height, size_bytes, is_deleted, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)").run(id, input.userId, input.objectKey, input.mimeType, input.width || null, input.height || null, input.sizeBytes || null, stringify(input.metadata || {}), createdAt);
    return getReferenceAsset(id);
  }

  function getReferenceAsset(assetId) {
    const row = db.prepare("SELECT * FROM reference_assets WHERE id = ? AND is_deleted = 0").get(assetId);
    return row ? rowToAsset(row) : null;
  }

  function listReferenceAssets(userId, options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const total = db.prepare("SELECT COUNT(*) AS total FROM reference_assets WHERE user_id = ? AND is_deleted = 0").get(userId).total;
    const rows = db.prepare("SELECT * FROM reference_assets WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(userId, limit, offset);
    return { records: rows.map(rowToAsset), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  function deleteReferenceAsset(assetId, userId) {
    const result = db.prepare("UPDATE reference_assets SET is_deleted = 1, deleted_at = ? WHERE id = ? AND user_id = ? AND is_deleted = 0").run(clock().toISOString(), assetId, userId);
    return result.changes ? getReferenceAsset(assetId) : null;
  }

  function createGeneratedAsset(input) {
    const createdAt = input.createdAt || clock().toISOString();
    const outputIndex = Number(input.outputIndex || 0);
    db.prepare(`
      INSERT INTO generated_assets (id, task_id, user_id, output_index, object_key, provider_url, mime_type, width, height, size_bytes, is_deleted, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(task_id, output_index) DO UPDATE SET object_key = excluded.object_key, provider_url = excluded.provider_url,
        mime_type = excluded.mime_type, width = excluded.width, height = excluded.height, size_bytes = excluded.size_bytes,
        is_deleted = 0, metadata_json = excluded.metadata_json
    `).run(input.id || `asset_${crypto.randomUUID()}`, input.taskId, input.userId, outputIndex, input.objectKey, input.providerUrl || null, input.mimeType || "image/png", input.width || null, input.height || null, input.sizeBytes || null, stringify(input.metadata || {}), createdAt);
    return rowToAsset(db.prepare("SELECT * FROM generated_assets WHERE task_id = ? AND output_index = ?").get(input.taskId, outputIndex));
  }

  function getAsset(assetId) {
    const row = db.prepare("SELECT * FROM generated_assets WHERE id = ? AND is_deleted = 0").get(assetId);
    return row ? rowToAsset(row) : null;
  }

  function getGeneratedAsset(assetId) { return getAsset(assetId); }

  function findOwnedAsset(userId, assetId) {
    const row = db.prepare("SELECT * FROM generated_assets WHERE id = ? AND user_id = ? AND is_deleted = 0").get(assetId, userId);
    return row ? rowToAsset(row) : null;
  }

  function listAssets(userId, options = new URLSearchParams()) {
    const page = positiveInt(options.get("page"), 1);
    const limit = Math.min(positiveInt(options.get("limit"), 20), 100);
    const offset = (page - 1) * limit;
    const total = db.prepare("SELECT COUNT(*) AS total FROM generated_assets WHERE user_id = ? AND is_deleted = 0").get(userId).total;
    const rows = db.prepare("SELECT * FROM generated_assets WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(userId, limit, offset);
    return { records: rows.map(rowToAsset), pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  function deleteAsset(assetId, userId) {
    const result = db.prepare("UPDATE generated_assets SET is_deleted = 1 WHERE id = ? AND user_id = ? AND is_deleted = 0").run(assetId, userId);
    return result.changes ? getAsset(assetId) : null;
  }

  function creditHoldRequest(input) {
    return { userId: input.userId, taskId: input.taskId || "", idempotencyKey: String(input.idempotencyKey || ""), credits: Number(input.credits) };
  }

  function createCreditHold(input) {
    const expected = creditHoldRequest(input);
    if (!expected.idempotencyKey || !Number.isInteger(expected.credits) || expected.credits <= 0) { const error = new Error("Invalid credit hold"); error.status = 400; throw error; }
    const requestFingerprint = fingerprint(expected);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT * FROM credit_holds WHERE idempotency_key = ?").get(expected.idempotencyKey);
      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) { const error = new Error("Credit hold idempotency conflict"); error.status = 409; throw error; }
        db.exec("COMMIT");
        return rowToCreditHold(existing);
      }
      const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(expected.userId);
      if (!user) { const error = new Error("User not found"); error.status = 404; throw error; }
      if (Number(user.balance) < expected.credits) { const error = new Error("Insufficient credits"); error.status = 402; throw error; }
      const now = clock().toISOString();
      const id = input.id || `hold_${crypto.randomUUID()}`;
      db.prepare("UPDATE users SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?").run(expected.credits, now, expected.userId, expected.credits);
      db.prepare("INSERT INTO credit_holds (id, user_id, task_id, idempotency_key, credits, request_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, expected.userId, expected.taskId || null, expected.idempotencyKey, expected.credits, requestFingerprint, now);
      db.exec("COMMIT");
      return getCreditHold(id);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function getCreditHold(holdId) {
    const row = db.prepare("SELECT * FROM credit_holds WHERE id = ?").get(holdId);
    return row ? rowToCreditHold(row) : null;
  }

  function settleCreditHold(holdId, actualCredits, input = {}) {
    const hold = getCreditHold(holdId);
    if (!hold || hold.status !== "HOLDING") return hold;
    const settledCredits = Number(actualCredits);
    if (!Number.isInteger(settledCredits) || settledCredits < 0 || settledCredits > hold.credits) { const error = new Error("Invalid settled credit amount"); error.status = 400; throw error; }
    const now = clock().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const released = hold.credits - settledCredits;
      db.prepare("UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?").run(released, now, hold.userId);
      if (settledCredits > 0) db.prepare("INSERT INTO credit_transactions (id, user_id, amount, reason, balance_after, created_at) SELECT ?, ?, ?, ?, balance, ? FROM users WHERE id = ?").run(input.transactionId || transactionId(), hold.userId, -settledCredits, input.reason || `hold:${hold.id}`, now, hold.userId);
      db.prepare("UPDATE credit_holds SET settled_credits = ?, status = 'SETTLED', settled_at = ? WHERE id = ? AND status = 'HOLDING'").run(settledCredits, now, holdId);
      db.exec("COMMIT");
      return getCreditHold(holdId);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function releaseCreditHold(holdId) {
    const hold = getCreditHold(holdId);
    if (!hold || hold.status !== "HOLDING") return hold;
    const now = clock().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET balance = balance + ?, updated_at = ? WHERE id = ?").run(hold.credits, now, hold.userId);
      db.prepare("UPDATE credit_holds SET status = 'RELEASED', settled_at = ? WHERE id = ? AND status = 'HOLDING'").run(now, holdId);
      db.exec("COMMIT");
      return getCreditHold(holdId);
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function createTask(task) {
    const createdAt = task.createdAt || clock().toISOString();
    db.prepare(`
      INSERT INTO generation_tasks (
        id, owner_id, idempotency_key, status, images_json, template_id, provider,
        provider_task_id, mode, prompt, topic, reference_images_json, model,
        output_count, aspect_ratio, resolution, raw_provider_result_json,
        metadata_json, requested_credits, settled_credits, credit_hold_id,
        error_code, error_message, attempt, lease_owner, lease_expires_at,
        next_attempt_at, started_at, completed_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_id = excluded.owner_id,
        idempotency_key = excluded.idempotency_key,
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
        metadata_json = excluded.metadata_json,
        requested_credits = excluded.requested_credits,
        settled_credits = excluded.settled_credits,
        credit_hold_id = excluded.credit_hold_id,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        attempt = excluded.attempt,
        lease_owner = excluded.lease_owner,
        lease_expires_at = excluded.lease_expires_at,
        next_attempt_at = excluded.next_attempt_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `).run(
      task.id,
      task.ownerId,
      task.idempotencyKey || null,
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
      stringify(task.metadata || {}),
      Number(task.requestedCredits || 0),
      Number(task.settledCredits || 0),
      task.creditHoldId || null,
      task.errorCode || null,
      task.errorMessage || null,
      Number(task.attempt || 0),
      task.leaseOwner || null,
      task.leaseExpiresAt || null,
      task.nextAttemptAt || null,
      task.startedAt || null,
      task.completedAt || null,
      createdAt,
      clock().toISOString(),
    );
    return getTask(task.id);
  }

  function createTaskWithCreditHold(input) {
    const existing = db.prepare("SELECT * FROM generation_tasks WHERE owner_id = ? AND idempotency_key = ?").get(input.task.ownerId, input.task.idempotencyKey);
    if (existing) {
      const hold = getCreditHold(existing.credit_hold_id);
      if (!hold) { const error = new Error("Generation task hold is missing"); error.status = 409; throw error; }
      return { task: rowToTask(existing), hold, created: false };
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const existingInside = db.prepare("SELECT * FROM generation_tasks WHERE owner_id = ? AND idempotency_key = ?").get(input.task.ownerId, input.task.idempotencyKey);
      if (existingInside) {
        const hold = getCreditHold(existingInside.credit_hold_id);
        db.exec("COMMIT");
        return { task: rowToTask(existingInside), hold, created: false };
      }
      const expected = creditHoldRequest(input.hold);
      const requestFingerprint = fingerprint(expected);
      const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(expected.userId);
      if (!user) { const error = new Error("User not found"); error.status = 404; throw error; }
      if (Number(user.balance) < expected.credits) { const error = new Error("Insufficient credits"); error.status = 402; throw error; }
      const now = clock().toISOString();
      const holdId = input.hold.id || `hold_${crypto.randomUUID()}`;
      db.prepare("UPDATE users SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?").run(expected.credits, now, expected.userId, expected.credits);
      db.prepare("INSERT INTO credit_holds (id, user_id, task_id, idempotency_key, credits, request_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(holdId, expected.userId, expected.taskId || null, expected.idempotencyKey, expected.credits, requestFingerprint, now);
      const hold = getCreditHold(holdId);
      const task = createTask({ ...input.task, idempotencyKey: input.task.idempotencyKey, creditHoldId: hold.id, requestedCredits: input.hold.credits });
      db.exec("COMMIT");
      return { task, hold, created: true };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function claimTask(workerId, input = {}) {
    const now = input.now !== undefined ? new Date(input.now) : clock();
    const nowIsoValue = now.toISOString();
    const expires = new Date(now.getTime() + Number(input.leaseDurationMs || 60000)).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare(`SELECT * FROM generation_tasks WHERE status IN ('pending', 'retryable') AND (lease_expires_at IS NULL OR lease_expires_at <= ?) AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at ASC, id ASC LIMIT 1`).get(nowIsoValue, nowIsoValue);
      if (!row) { db.exec("COMMIT"); return null; }
      db.prepare("UPDATE generation_tasks SET status = 'leased', lease_owner = ?, lease_expires_at = ?, attempt = attempt + 1, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").run(workerId, expires, nowIsoValue, nowIsoValue, row.id);
      const claimed = getTask(row.id);
      db.exec("COMMIT");
      return claimed;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  function renewTaskLease(taskIdValue, workerId, input = {}) {
    const now = input.now !== undefined ? new Date(input.now) : clock();
    const expires = new Date(now.getTime() + Number(input.leaseDurationMs || 60000)).toISOString();
    db.prepare("UPDATE generation_tasks SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_owner = ? AND status IN ('leased', 'processing')").run(expires, now.toISOString(), taskIdValue, workerId);
    return getTask(taskIdValue);
  }

  function releaseTaskLease(taskIdValue, workerId, input = {}) {
    const now = clock().toISOString();
    const status = input.status || "pending";
    const result = db.prepare("UPDATE generation_tasks SET status = ?, lease_owner = NULL, lease_expires_at = NULL, error_code = COALESCE(?, error_code), error_message = COALESCE(?, error_message), updated_at = ?, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE id = ? AND lease_owner = ?").run(status, input.errorCode || null, input.errorMessage || null, now, status, now, taskIdValue, workerId);
    return result.changes ? getTask(taskIdValue) : null;
  }

  function reclaimExpiredTasks(input) {
    const now = input instanceof Date ? input : input !== undefined ? new Date(input) : clock();
    const nowIsoValue = now.toISOString();
    db.prepare("UPDATE generation_tasks SET status = 'retryable', lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE status IN ('leased', 'processing') AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?").run(nowIsoValue, nowIsoValue);
    return db.prepare("SELECT * FROM generation_tasks WHERE status = 'retryable' AND updated_at = ?").all(nowIsoValue).map(rowToTask);
  }

  function updateTask(taskIdValue, updates = {}) {
    const allowed = {
      status: "status", images: "images_json", provider: "provider", providerTaskId: "provider_task_id", providerResultUrl: "provider_result_url",
      rawProviderResult: "raw_provider_result_json", errorCode: "error_code", errorMessage: "error_message", settledCredits: "settled_credits",
      completedAt: "completed_at", nextAttemptAt: "next_attempt_at", metadata: "metadata_json",
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (updates[key] === undefined) continue;
      values.push(["images", "rawProviderResult", "metadata"].includes(key) ? stringify(updates[key]) : updates[key]);
      fields.push(`${column} = ?`);
    }
    if (!fields.length) return getTask(taskIdValue);
    values.push(clock().toISOString(), taskIdValue);
    db.prepare(`UPDATE generation_tasks SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
    return getTask(taskIdValue);
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

  function syncTemplates(records = [], input = {}) {
    const updatedAt = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      const statement = db.prepare(`
        INSERT INTO templates (
          id, catalog_version_id, title, subtitle, category, scenario_category, tags_json,
          source, source_id, source_url, thumbnail_url, preview_url, reference_images_json,
          preview_images_json, prompt, use_case, author, metrics_json, seed_json, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      records.forEach((record) => {
        const versionId = input.catalogVersionId || record.catalogVersionId || null;
        if (versionId) db.prepare("DELETE FROM templates WHERE catalog_version_id = ? AND id = ?").run(versionId, record.id);
        else db.prepare("DELETE FROM templates WHERE catalog_version_id IS NULL AND id = ?").run(record.id);
        statement.run(
          record.id,
          versionId,
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
          stringify(record.metadata || {}),
          record.createdAt || updatedAt,
          record.updatedAt || updatedAt,
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

  function getCatalogVersionState(versionId) {
    const version = getCatalogVersion(versionId);
    if (!version) return null;
    const records = db.prepare("SELECT * FROM templates WHERE catalog_version_id = ? ORDER BY id ASC").all(versionId).map(rowToTemplate);
    const persistedChecksum = recordsChecksum(records);
    return {
      version,
      persistedRecordCount: records.length,
      persistedChecksum,
      complete: records.length === version.recordCount && persistedChecksum === version.checksum,
    };
  }

  function activateCatalogVersion(versionId) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const state = getCatalogVersionState(versionId);
      if (!state) throw new Error(`Catalog version not found: ${versionId}`);
      if (state.persistedRecordCount !== state.version.recordCount) throw new Error(`Catalog version incomplete: ${versionId} record count mismatch`);
      if (state.persistedChecksum !== state.version.checksum) throw new Error(`Catalog version checksum mismatch: ${versionId}`);
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
    const { records } = validateCatalogVersionInput(input);
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
          preview_images_json, prompt, use_case, author, metrics_json, seed_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const record of records) {
        statement.run(
          record.id, input.id, record.title || "", record.subtitle || "", record.category || "",
          record.scenarioCategory || record.scenario_category || "", stringify(record.tags || []),
          record.source || "", record.sourceId || record.source_id || "", record.sourceUrl || record.source_url || "",
          record.thumbnailUrl || record.thumbnail_url || "", record.previewUrl || record.preview_url || "",
          stringify(record.referenceImages || record.reference_images || []), stringify(record.previewImages || record.preview_images || []),
          record.prompt || "", record.useCase || record.use_case || "", record.author || "",
          stringify(record.metrics || null), stringify(record.seed || null), stringify(record.metadata || {}), record.createdAt || now, record.updatedAt || now,
        );
      }
      const state = getCatalogVersionState(input.id);
      if (!state || !state.complete) throw new Error(`Catalog version incomplete after import: ${input.id}`);
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
    createCreditPackage(input) {
      return { id: input.id || `package_${crypto.randomUUID()}`, userId: input.userId, initialCredits: input.initialCredits || 0, remainingCredits: (input.remainingCredits ?? input.initialCredits) || 0, frozenCredits: 0, status: "ACTIVE" };
    },
    getCreditPackage() { return null; },
    listCreditPackages() { return { records: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } }; },
    createCreditHold,
    getCreditHold,
    settleCreditHold,
    releaseCreditHold,
    listCreditTransactions,
    createOrder,
    getOrder,
    getOrderByIdempotencyKey(userId, key) {
      const row = db.prepare("SELECT * FROM orders WHERE user_id = ? AND idempotency_key = ?").get(userId, key);
      return row ? rowToOrder(row) : null;
    },
    listOrders,
    listAllOrders,
    fulfillOrder,
    fulfillMockOrder,
    fulfillPayment,
    getPaymentFulfillment,
    cancelOrder,
    acceptRefund,
    completeRefund,
    failRefund,
    refundOrder,
    claimStaleOrders,
    releaseOrderReconciliationLease,
    recordPaymentEvent,
    listPaymentAudit,
    recordAdminAudit,
    listAdminAudit,
    findOwnedImageAsset,
    createTask,
    createTaskWithCreditHold,
    getTask,
    listTasks,
    claimTask,
    renewTaskLease,
    releaseTaskLease,
    reclaimExpiredTasks,
    updateTask,
    createAsset: createGeneratedAsset,
    createGeneratedAsset,
    getAsset,
    getGeneratedAsset,
    findOwnedAsset,
    listAssets,
    listGeneratedAssets: listAssets,
    deleteAsset,
    createReferenceAsset,
    getReferenceAsset,
    listReferenceAssets,
    deleteReferenceAsset,
    createCatalogVersion,
    getCatalogVersion,
    getCatalogVersionState,
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
      idempotency_key TEXT,
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
      metadata_json TEXT NOT NULL DEFAULT '{}',
      requested_credits INTEGER NOT NULL DEFAULT 0,
      settled_credits INTEGER NOT NULL DEFAULT 0,
      credit_hold_id TEXT,
      error_code TEXT,
      error_message TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TEXT,
      next_attempt_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credit_holds (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      credits INTEGER NOT NULL,
      settled_credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'HOLDING',
      package_allocation_json TEXT NOT NULL DEFAULT '[]',
      request_fingerprint TEXT,
      created_at TEXT NOT NULL,
      settled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS generated_assets (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      output_index INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      provider_url TEXT,
      mime_type TEXT NOT NULL DEFAULT 'image/png',
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (task_id, output_index)
    );
    CREATE TABLE IF NOT EXISTS reference_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      deleted_at TEXT
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
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
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
      metadata_json TEXT NOT NULL DEFAULT '{}',
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
      refund_status TEXT NOT NULL DEFAULT 'none',
      refund_provider_id TEXT,
      refund_amount_cents INTEGER,
      refund_accepted_at TEXT,
      refund_completed_at TEXT,
      refund_error TEXT NOT NULL DEFAULT '',
      reconcile_lease_owner TEXT,
      reconcile_lease_expires_at TEXT,
      last_reconciled_at TEXT,
      canceled_at TEXT,
      admin_note TEXT,
      payment_verified INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}'
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
    CREATE TABLE IF NOT EXISTS payment_fulfillments (
      id TEXT PRIMARY KEY,
      fulfillment_key TEXT NOT NULL UNIQUE,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT,
      provider_order_id TEXT,
      provider_transaction_id TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      fulfilled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      target_user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      reason TEXT NOT NULL DEFAULT '',
      before_state_json TEXT,
      after_state_json TEXT,
      ip_address TEXT,
      user_agent TEXT,
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
  ensureColumn(db, "generation_tasks", "idempotency_key", "TEXT");
  ensureColumn(db, "generation_tasks", "metadata_json", "TEXT NOT NULL DEFAULT '{}' ");
  ensureColumn(db, "generation_tasks", "requested_credits", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "generation_tasks", "settled_credits", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "generation_tasks", "credit_hold_id", "TEXT");
  ensureColumn(db, "generation_tasks", "error_code", "TEXT");
  ensureColumn(db, "generation_tasks", "error_message", "TEXT");
  ensureColumn(db, "generation_tasks", "attempt", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "generation_tasks", "lease_owner", "TEXT");
  ensureColumn(db, "generation_tasks", "lease_expires_at", "TEXT");
  ensureColumn(db, "generation_tasks", "next_attempt_at", "TEXT");
  ensureColumn(db, "generation_tasks", "started_at", "TEXT");
  ensureColumn(db, "generation_tasks", "completed_at", "TEXT");
  ensureColumn(db, "templates", "catalog_version_id", "TEXT");
  ensureColumn(db, "templates", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "templates", "preview_images_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "templates", "created_at", "TEXT");
  ensureColumn(db, "templates", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
  migrateVersionedTemplateRows(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS templates_catalog_version_template_id_unique ON templates (catalog_version_id, id) WHERE catalog_version_id IS NOT NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS templates_legacy_template_id_unique ON templates (id) WHERE catalog_version_id IS NULL");
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
  ensureColumn(db, "orders", "refund_status", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "orders", "refund_provider_id", "TEXT");
  ensureColumn(db, "orders", "refund_amount_cents", "INTEGER");
  ensureColumn(db, "orders", "refund_accepted_at", "TEXT");
  ensureColumn(db, "orders", "refund_completed_at", "TEXT");
  ensureColumn(db, "orders", "refund_error", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "orders", "reconcile_lease_owner", "TEXT");
  ensureColumn(db, "orders", "reconcile_lease_expires_at", "TEXT");
  ensureColumn(db, "orders", "last_reconciled_at", "TEXT");
  ensureColumn(db, "orders", "canceled_at", "TEXT");
  ensureColumn(db, "orders", "admin_note", "TEXT");
  ensureColumn(db, "orders", "payment_verified", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "metadata_json", "TEXT NOT NULL DEFAULT '{}' ");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idempotency_key_unique ON orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS orders_reconcile_lease_idx ON orders (payment_mode, status, updated_at, reconcile_lease_expires_at)");
  db.exec("CREATE INDEX IF NOT EXISTS orders_refund_status_idx ON orders (payment_mode, refund_status, updated_at)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payment_fulfillments_provider_transaction_unique ON payment_fulfillments (provider, provider_transaction_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payment_fulfillments_provider_event_unique ON payment_fulfillments (provider, event_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS generation_tasks_owner_idempotency_unique ON generation_tasks (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS generation_tasks_lease_idx ON generation_tasks (status, lease_expires_at, next_attempt_at)");
}

function migrateVersionedTemplateRows(db) {
  const idColumn = db.prepare("PRAGMA table_info(templates)").all().find((column) => column.name === "id");
  if (!idColumn || Number(idColumn.pk) !== 1) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("ALTER TABLE templates RENAME TO templates_global_id_legacy");
    db.exec(`
      CREATE TABLE templates (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
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
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO templates (
        id, catalog_version_id, title, subtitle, category, scenario_category, tags_json,
        source, source_id, source_url, thumbnail_url, preview_url, reference_images_json,
        preview_images_json, prompt, use_case, author, metrics_json, seed_json, metadata_json,
        created_at, updated_at
      )
      SELECT
        id, catalog_version_id, title, subtitle, category, scenario_category, tags_json,
        source, source_id, source_url, thumbnail_url, preview_url, reference_images_json,
        preview_images_json, prompt, use_case, author, metrics_json, seed_json, metadata_json,
        created_at, updated_at
      FROM templates_global_id_legacy;
      DROP TABLE templates_global_id_legacy;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

function rowToCreditHold(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id || "",
    idempotencyKey: row.idempotency_key,
    credits: Number(row.credits || 0),
    settledCredits: Number(row.settled_credits || 0),
    status: row.status,
    packageAllocation: parseJson(row.package_allocation_json, []),
    createdAt: row.created_at,
    settledAt: row.settled_at,
  };
}

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    assetId: row.id,
    taskId: row.task_id || null,
    userId: row.user_id,
    outputIndex: Number(row.output_index || 0),
    objectKey: row.object_key,
    providerUrl: row.provider_url || "",
    mimeType: row.mime_type,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    isDeleted: Boolean(row.is_deleted),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function rowToTask(row) {
  const metadata = parseJson(row.metadata_json, {});
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
    referenceAssetIds: Array.isArray(metadata.request?.referenceAssetIds)
      ? metadata.request.referenceAssetIds
      : [],
    model: row.model || "",
    outputCount: row.output_count || 1,
    aspectRatio: row.aspect_ratio || "",
    resolution: row.resolution || "",
    rawProviderResult: parseJson(row.raw_provider_result_json, null),
    metadata,
    idempotencyKey: row.idempotency_key || "",
    requestedCredits: Number(row.requested_credits || 0),
    settledCredits: Number(row.settled_credits || 0),
    creditHoldId: row.credit_hold_id || null,
    providerResultUrl: row.provider_result_url || "",
    errorCode: row.error_code || "",
    errorMessage: row.error_message || "",
    attempt: Number(row.attempt || 0),
    leaseOwner: row.lease_owner || "",
    leaseExpiresAt: row.lease_expires_at || null,
    nextAttemptAt: row.next_attempt_at || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
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
    paymentVerified: Boolean(row.payment_verified),
    refundStatus: row.refund_status || "none",
    refundProviderId: row.refund_provider_id || "",
    refundAmountCents: Number(row.refund_amount_cents || 0),
    refundAcceptedAt: row.refund_accepted_at || null,
    refundCompletedAt: row.refund_completed_at || null,
    refundError: row.refund_error || "",
    reconcileLeaseOwner: row.reconcile_lease_owner || "",
    reconcileLeaseExpiresAt: row.reconcile_lease_expires_at || null,
    lastReconciledAt: row.last_reconciled_at || null,
    metadata: parseJson(row.metadata_json, {}),
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

function rowToPaymentFulfillment(row) {
  return {
    id: row.id,
    fulfillmentKey: row.fulfillment_key,
    orderId: row.order_id,
    provider: row.provider,
    eventId: row.event_id,
    eventType: row.event_type || "",
    providerOrderId: row.provider_order_id || "",
    providerTransactionId: row.provider_transaction_id || "",
    status: row.status,
    errorMessage: row.error_message || "",
    metadata: parseJson(row.metadata_json, {}),
    fulfilledAt: row.fulfilled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAdminAudit(row) {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id || null,
    reason: row.reason || "",
    before: parseJson(row.before_state_json, null),
    after: parseJson(row.after_state_json, null),
    ipAddress: row.ip_address || "",
    userAgent: row.user_agent || "",
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
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at || row.updated_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createMemoryStore,
  createSqliteStore,
};
