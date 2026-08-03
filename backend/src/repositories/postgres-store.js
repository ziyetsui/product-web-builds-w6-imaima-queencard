const crypto = require("node:crypto");

const { assertSessionTokenHash } = require("../auth");
const { withTransaction } = require("../db/migrate");
const {
  queryCatalog,
  recordsChecksum,
  validateCatalogVersionInput,
} = require("../services/catalog-service");

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function timestamp(clock) {
  const value = typeof clock === "function" ? clock() : clock?.now ? clock.now() : new Date();
  return value instanceof Date ? value.toISOString() : String(value);
}

function json(value, fallback = {}) {
  return value == null ? fallback : value;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
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

function packageRequest(input) {
  const initialCredits = Number(input.initialCredits || 0);
  return {
    userId: input.userId,
    initialCredits,
    remainingCredits: input.remainingCredits == null ? initialCredits : Number(input.remainingCredits),
    frozenCredits: Number(input.frozenCredits || 0),
    transType: input.transType || "SYSTEM_ADJUST",
    orderNo: input.orderNo || "",
    status: input.status || "ACTIVE",
    expiredAt: iso(input.expiredAt),
    metadata: parseJson(input.metadata, {}),
  };
}

function packageMatchesRequest(row, expected, requestFingerprint) {
  return row.user_id === expected.userId && row.request_fingerprint === requestFingerprint;
}

function holdRequest(input) {
  return {
    userId: input.userId,
    taskId: input.taskId || "",
    idempotencyKey: input.idempotencyKey,
    credits: Number(input.credits),
    packageAllocation: Array.isArray(input.packageAllocation)
      ? input.packageAllocation.map((allocation) => ({ packageId: allocation.packageId, credits: Number(allocation.credits) }))
      : [],
  };
}

function holdMatchesRequest(row, expected, requestFingerprint) {
  return row.user_id === expected.userId
    && (row.task_id || "") === expected.taskId
    && row.idempotency_key === expected.idempotencyKey
    && Number(row.credits) === expected.credits
    && row.request_fingerprint === requestFingerprint;
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
    productSnapshot: parseJson(input.productSnapshot, {}),
    metadata: parseJson(input.metadata, {}),
  };
}

function markOrderCreation(order, created) {
  if (!order) return order;
  Object.defineProperty(order, "created", { value: created, enumerable: false });
  return order;
}

function positiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pageOf(options, fallbackLimit = 20) {
  const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
  const page = positiveInt(params.get("page"), 1);
  const limit = Math.min(positiveInt(params.get("limit"), fallbackLimit), 100);
  return { params, page, limit, offset: (page - 1) * limit };
}

function pagination(page, limit, total) {
  return { page, limit, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / limit)) };
}

function err(message, status) {
  const error = new Error(message);
  if (status) error.status = status;
  return error;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    appid: row.appid,
    openid: row.openid,
    unionid: row.unionid || null,
    name: row.name,
    avatarUrl: row.avatar_url || "",
    balance: Number(row.balance || 0),
    status: row.status || "active",
    role: row.role || "user",
    metadata: parseJson(row.metadata, {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    lastUsedAt: iso(row.last_used_at),
    ipAddress: row.ip_address || "",
    userAgent: row.user_agent || "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToPackage(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    initialCredits: Number(row.initial_credits || 0),
    remainingCredits: Number(row.remaining_credits || 0),
    frozenCredits: Number(row.frozen_credits || 0),
    transType: row.trans_type,
    orderNo: row.order_no || "",
    status: row.status,
    expiredAt: iso(row.expired_at),
    metadata: parseJson(row.metadata, {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToHold(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id || "",
    idempotencyKey: row.idempotency_key,
    credits: Number(row.credits || 0),
    settledCredits: Number(row.settled_credits || 0),
    status: row.status,
    packageAllocation: parseJson(row.package_allocation, []),
    createdAt: iso(row.created_at),
    settledAt: iso(row.settled_at),
  };
}

function rowToTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    transNo: row.trans_no,
    userId: row.user_id,
    transType: row.trans_type,
    amount: Number(row.credits || 0),
    credits: Number(row.credits || 0),
    balanceAfter: Number(row.balance_after || 0),
    packageId: row.package_id || null,
    taskId: row.task_id || null,
    orderNo: row.order_no || null,
    holdId: row.hold_id || null,
    reason: row.reason || "",
    metadata: parseJson(row.metadata, {}),
    createdAt: iso(row.created_at),
  };
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.id,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key || "",
    status: row.status,
    images: parseJson(row.images, []),
    templateId: row.template_id || null,
    provider: row.provider || "",
    providerTaskId: row.provider_task_id || "",
    providerResultUrl: row.provider_result_url || "",
    mode: row.mode || "",
    prompt: row.prompt || "",
    topic: row.topic || "",
    referenceImages: parseJson(row.reference_images, []),
    model: row.model || "",
    outputCount: Number(row.output_count || 1),
    aspectRatio: row.aspect_ratio || "",
    resolution: row.resolution || "",
    requestedCredits: Number(row.requested_credits || 0),
    settledCredits: Number(row.settled_credits || 0),
    creditHoldId: row.credit_hold_id || null,
    rawProviderResult: parseJson(row.raw_provider_result, null),
    metadata: parseJson(row.metadata, {}),
    errorCode: row.error_code || "",
    errorMessage: row.error_message || "",
    attempt: Number(row.attempt || 0),
    leaseOwner: row.lease_owner || "",
    leaseExpiresAt: iso(row.lease_expires_at),
    nextAttemptAt: iso(row.next_attempt_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
  };
}

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    outputIndex: Number(row.output_index),
    objectKey: row.object_key,
    providerUrl: row.provider_url || "",
    mimeType: row.mime_type,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    isDeleted: Boolean(row.is_deleted),
    metadata: parseJson(row.metadata, {}),
    createdAt: iso(row.created_at),
  };
}

function rowToTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    catalogVersionId: row.catalog_version_id || null,
    title: row.title || "",
    subtitle: row.subtitle || "",
    author: row.author || "",
    category: row.category || "",
    scenarioCategory: row.scenario_category || "",
    tags: parseJson(row.tags, []),
    prompt: row.prompt || "",
    referenceImages: parseJson(row.reference_images, []),
    previewImages: parseJson(row.preview_images, []),
    source: row.source || "",
    sourceId: row.source_id || "",
    sourceUrl: row.source_url || "",
    thumbnailUrl: row.thumbnail_url || "",
    previewUrl: row.preview_url || "",
    useCase: row.use_case || "",
    metrics: parseJson(row.metrics, null),
    seed: parseJson(row.seed, null),
    metadata: parseJson(row.metadata, {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToCatalogVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    checksum: row.checksum,
    source: row.source,
    recordCount: Number(row.record_count || 0),
    metadata: parseJson(row.metadata, {}),
    active: Boolean(row.active),
    createdAt: iso(row.created_at),
    activatedAt: iso(row.activated_at),
  };
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key || "",
    productId: row.product_id,
    channel: row.channel,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMode: row.payment_mode,
    paymentVerified: Boolean(row.payment_verified),
    amountCents: Number(row.amount_cents || 0),
    currency: row.currency,
    credits: Number(row.credits || 0),
    productSnapshot: parseJson(row.product_snapshot, null),
    paymentParams: parseJson(row.payment_params, null),
    externalPaymentId: row.external_payment_id || "",
    creditsGranted: Number(row.credits_granted || 0),
    creditsRevoked: Number(row.credits_revoked || 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    paidAt: iso(row.paid_at),
    fulfilledAt: iso(row.fulfilled_at),
    refundedAt: iso(row.refunded_at),
    canceledAt: iso(row.canceled_at),
    adminNote: row.admin_note || "",
    metadata: parseJson(row.metadata, {}),
  };
}

function rowToPaymentFulfillment(row) {
  if (!row) return null;
  return {
    id: row.id,
    fulfillmentKey: row.fulfillment_key,
    orderId: row.order_id || null,
    provider: row.provider,
    eventId: row.event_id || "",
    eventType: row.event_type || "",
    providerOrderId: row.provider_order_id || "",
    providerTransactionId: row.provider_transaction_id || "",
    status: row.status,
    errorMessage: row.error_message || "",
    metadata: parseJson(row.metadata, {}),
    fulfilledAt: iso(row.fulfilled_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToPaymentEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id || "",
    userId: row.user_id || "",
    type: row.type,
    actorId: row.actor_id || "",
    message: row.message || "",
    metadata: parseJson(row.metadata, null),
    createdAt: iso(row.created_at),
  };
}

function rowToAdminAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    targetUserId: row.target_user_id || null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id || null,
    reason: row.reason || "",
    before: parseJson(row.before_state, null),
    after: parseJson(row.after_state, null),
    ipAddress: row.ip_address || "",
    userAgent: row.user_agent || "",
    createdAt: iso(row.created_at),
  };
}

function imageUrl(image) {
  return typeof image === "string" ? image : image && typeof image.url === "string" ? image.url : "";
}

function assetIdForUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

function assetIdForUrlBase64(url) {
  return crypto.createHash("sha256").update(url).digest("base64url");
}

function matchesAssetId(url, value) {
  const assetId = decodeURIComponent(String(value || ""));
  return assetId === url || assetId === assetIdForUrl(url) || assetId === assetIdForUrlBase64(url);
}

function metric(record, key) {
  const value = Number(record.metrics?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function sortTemplates(records, sort) {
  return records.sort((a, b) => {
    if (sort === "potential") {
      const score = metric(b, "potentialScore") - metric(a, "potentialScore");
      if (score) return score;
      return metric(a, "potentialRank") - metric(b, "potentialRank") || b.id.localeCompare(a.id);
    }
    if (sort === "saves") return metric(b, "saves") - metric(a, "saves") || a.id.localeCompare(b.id);
    if (sort === "shares") return metric(b, "shares") - metric(a, "shares") || a.id.localeCompare(b.id);
    if (sort === "newest") return b.id.localeCompare(a.id);
    return metric(b, "likes") + metric(b, "saves") - metric(a, "likes") - metric(a, "saves") || a.id.localeCompare(b.id);
  });
}

function createPostgresStore(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.query !== "function") throw new TypeError("createPostgresStore requires a PostgreSQL pool");
  const clock = options.clock || (() => new Date());
  const initialCredits = Number(options.initialCredits || 10);
  const environment = String(options.environment || process.env.NODE_ENV || "development").toLowerCase();
  const inFlight = new Map();

  function singleFlight(key, operation) {
    if (!key) return operation();
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(operation);
    inFlight.set(key, pending);
    return pending.finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
  }

  async function changeUserBalance(client, userId, amount, changedAt) {
    const value = Number(amount);
    const result = value < 0
      ? await client.query(
        "UPDATE miniapp_users SET balance = balance + $1, updated_at = $2 WHERE id = $3 AND balance >= $4 RETURNING balance",
        [value, changedAt, userId, Math.abs(value)],
      )
      : await client.query(
        "UPDATE miniapp_users SET balance = balance + $1, updated_at = $2 WHERE id = $3 RETURNING balance",
        [value, changedAt, userId],
      );
    if (!result.rowCount) {
      const exists = await client.query("SELECT id FROM miniapp_users WHERE id = $1", [userId]);
      if (!exists.rowCount) throw err("User not found", 404);
      throw err("Insufficient credits", 402);
    }
    return Number(result.rows[0].balance);
  }

  async function consumePackageCredits(client, userId, credits, changedAt, input = {}) {
    let remaining = Number(credits);
    const values = [userId, changedAt];
    let orderFilter = "";
    if (input.orderNo && input.onlyOrder) {
      values.push(input.orderNo);
      orderFilter = `AND order_no = $${values.length}`;
    }
    const packages = await client.query(`
      SELECT id, remaining_credits, frozen_credits FROM credit_packages
      WHERE user_id = $1 AND status = 'ACTIVE'
        AND (expired_at IS NULL OR expired_at > $2)
        AND remaining_credits > 0 ${orderFilter}
      ORDER BY expired_at NULLS LAST, created_at ASC, id ASC FOR UPDATE
    `, values);
    const allocations = [];
    for (const pkg of packages.rows) {
      if (remaining <= 0) break;
      const amount = Math.min(Number(pkg.remaining_credits), remaining);
      const nextRemaining = Number(pkg.remaining_credits) - amount;
      const nextStatus = nextRemaining === 0 && Number(pkg.frozen_credits) === 0 ? "DEPLETED" : "ACTIVE";
      const updated = await client.query(`
        UPDATE credit_packages
        SET remaining_credits = $1, status = $2, updated_at = $3
        WHERE id = $4 AND user_id = $5 AND remaining_credits >= $6
        RETURNING id
      `, [nextRemaining, nextStatus, changedAt, pkg.id, userId, amount]);
      if (!updated.rowCount) throw err("Insufficient package credits", 409);
      allocations.push({ packageId: pkg.id, credits: amount });
      remaining -= amount;
    }
    if (remaining > 0) throw err("Insufficient package credits", 409);
    return allocations;
  }

  async function ensureUser(identity) {
    const createdAt = timestamp(clock);
    const userId = identity.appid && identity.openid
      ? `wechat:${identity.appid}:${identity.openid}`
      : identity.sub;
    await withTransaction(pool, async (client) => {
      const inserted = await client.query(`
        INSERT INTO miniapp_users (id, provider, appid, openid, unionid, name, balance, created_at, updated_at)
        VALUES ($1, 'wechat', $2, $3, $4, '微信用户', $5, $6, $6)
        ON CONFLICT (appid, openid) DO NOTHING
        RETURNING id
      `, [userId, identity.appid || "", identity.openid || "", identity.unionid || null, initialCredits, createdAt]);
      if (inserted.rowCount) {
        await client.query(`
          INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, trans_type, metadata, created_at, updated_at)
          VALUES ($1, $2, $3, $3, 'NEW_USER', $4, $5, $5)
          ON CONFLICT (id) DO NOTHING
        `, [`welcome_${userId}`, userId, initialCredits, JSON.stringify({ source: "miniapp" }), createdAt]);
      }
    });
    return getUser(userId);
  }

  async function getUser(userId) {
    const result = await pool.query("SELECT * FROM miniapp_users WHERE id = $1", [userId]);
    return rowToUser(result.rows[0]);
  }

  async function getUserByIdentity(appid, openid) {
    const result = await pool.query("SELECT * FROM miniapp_users WHERE appid = $1 AND openid = $2", [appid, openid]);
    return rowToUser(result.rows[0]);
  }

  async function updateUserProfile(userId, updates = {}) {
    if (!await getUser(userId)) throw err("User not found", 404);
    const updatedAt = timestamp(clock);
    const result = await pool.query(
      "UPDATE miniapp_users SET name = COALESCE($1, name), avatar_url = COALESCE($2, avatar_url), updated_at = $3 WHERE id = $4 RETURNING *",
      [typeof updates.name === "string" ? updates.name.slice(0, 40) : null, typeof updates.avatarUrl === "string" ? updates.avatarUrl : null, updatedAt, userId],
    );
    return rowToUser(result.rows[0]);
  }

  async function listUsers(options = new URLSearchParams()) {
    const { params, page, limit, offset } = pageOf(options);
    const values = [];
    const filters = [];
    const q = String(params.get("q") || "").trim();
    if (q) {
      values.push(`%${q}%`);
      filters.push("(id ILIKE $1 OR openid ILIKE $1 OR unionid ILIKE $1 OR name ILIKE $1)");
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM miniapp_users ${where}`, values);
    const rows = await pool.query(`SELECT * FROM miniapp_users ${where} ORDER BY created_at DESC, id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    return { records: rows.rows.map(rowToUser), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function createSession(input) {
    const createdAt = timestamp(clock);
    const tokenHash = assertSessionTokenHash(input.tokenHash);
    const result = await pool.query(`
      INSERT INTO miniapp_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *
    `, [input.id || id("session"), input.userId, tokenHash, input.expiresAt, input.ipAddress || null, input.userAgent || null, createdAt]);
    return rowToSession(result.rows[0]);
  }

  async function getSessionByTokenHash(tokenHash) {
    const result = await pool.query("SELECT * FROM miniapp_sessions WHERE token_hash = $1", [tokenHash]);
    return rowToSession(result.rows[0]);
  }

  async function getSession(sessionId) {
    const result = await pool.query("SELECT * FROM miniapp_sessions WHERE id = $1", [sessionId]);
    return rowToSession(result.rows[0]);
  }

  async function touchSession(sessionId) {
    const now = timestamp(clock);
    const result = await pool.query("UPDATE miniapp_sessions SET last_used_at = $1, updated_at = $1 WHERE id = $2 RETURNING *", [now, sessionId]);
    return rowToSession(result.rows[0]);
  }

  async function revokeSession(sessionId) {
    const now = timestamp(clock);
    const result = await pool.query("UPDATE miniapp_sessions SET revoked_at = COALESCE(revoked_at, $1), updated_at = $1 WHERE id = $2 RETURNING *", [now, sessionId]);
    return rowToSession(result.rows[0]);
  }

  async function revokeSessionByTokenHash(tokenHash) {
    const session = await getSessionByTokenHash(tokenHash);
    return session ? revokeSession(session.id) : null;
  }

  async function revokeAllSessions(userId) {
    const result = await pool.query("UPDATE miniapp_sessions SET revoked_at = COALESCE(revoked_at, $1), updated_at = $1 WHERE user_id = $2 AND revoked_at IS NULL RETURNING id", [timestamp(clock), userId]);
    return result.rowCount;
  }

  async function createCreditPackageOnce(input) {
    const createdAt = timestamp(clock);
    const expected = packageRequest(input);
    const requestFingerprint = fingerprint(expected);
    const initial = expected.initialCredits;
    const remaining = expected.remainingCredits;
    const frozen = expected.frozenCredits;
    const packageId = input.id || id("package");
    if (remaining < 0 || frozen < 0 || remaining + frozen > initial) throw err("Invalid credit package allocation", 400);
    const result = await withTransaction(pool, async (client) => {
      const replay = await client.query("SELECT * FROM credit_packages WHERE id = $1", [packageId]);
      if (replay.rowCount) {
        if (!packageMatchesRequest(replay.rows[0], expected, requestFingerprint)) throw err("Credit package idempotency conflict", 409);
        return replay.rows[0];
      }
      const inserted = await client.query(`
        INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, frozen_credits, trans_type, order_no, status, expired_at, metadata, request_fingerprint, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `, [packageId, expected.userId, initial, remaining, frozen, expected.transType, expected.orderNo || null, expected.status, expected.expiredAt, JSON.stringify(expected.metadata), requestFingerprint, createdAt]);
      if (!inserted.rowCount) {
        const existing = await client.query("SELECT * FROM credit_packages WHERE id = $1", [packageId]);
        if (!existing.rowCount || !packageMatchesRequest(existing.rows[0], expected, requestFingerprint)) throw err("Credit package idempotency conflict", 409);
        return existing.rows[0];
      }
      if (!packageMatchesRequest(inserted.rows[0], expected, requestFingerprint)) throw err("Credit package idempotency conflict", 409);
      if (Number(remaining) > 0) {
        await changeUserBalance(client, expected.userId, remaining, createdAt);
      }
      return inserted.rows[0];
    });
    return rowToPackage(result);
  }

  function createCreditPackage(input) {
    const expected = packageRequest(input);
    return singleFlight(input.id ? `package:${expected.userId}:${input.id}:${fingerprint(expected)}` : null, () => createCreditPackageOnce(input));
  }

  async function listCreditPackages(userId, options = new URLSearchParams()) {
    const { page, limit, offset } = pageOf(options);
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM credit_packages WHERE user_id = $1", [userId]);
    const rows = await pool.query("SELECT * FROM credit_packages WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [userId, limit, offset]);
    return { records: rows.rows.map(rowToPackage), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function getCreditPackage(packageId) {
    const result = await pool.query("SELECT * FROM credit_packages WHERE id = $1", [packageId]);
    return rowToPackage(result.rows[0]);
  }

  async function createCreditHoldInTransaction(client, input) {
    const createdAt = timestamp(clock);
    const expected = holdRequest(input);
    const requestFingerprint = fingerprint(expected);
    const holdId = input.id || id("hold");
    const replay = await client.query("SELECT * FROM credit_holds WHERE idempotency_key = $1 FOR UPDATE", [expected.idempotencyKey]);
    if (replay.rowCount) {
      if (!holdMatchesRequest(replay.rows[0], expected, requestFingerprint)) throw err("Credit hold idempotency conflict", 409);
      return rowToHold(replay.rows[0]);
    }
    const inserted = await client.query(`
        INSERT INTO credit_holds (id, user_id, task_id, idempotency_key, credits, package_allocation, request_fingerprint, created_at)
        VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING *
      `, [holdId, expected.userId, expected.taskId || null, expected.idempotencyKey, expected.credits, requestFingerprint, createdAt]);
    if (!inserted.rowCount) {
      const existing = await client.query("SELECT * FROM credit_holds WHERE idempotency_key = $1 FOR UPDATE", [expected.idempotencyKey]);
      if (!existing.rowCount || !holdMatchesRequest(existing.rows[0], expected, requestFingerprint)) throw err("Credit hold idempotency conflict", 409);
      return rowToHold(existing.rows[0]);
    }
    if (!holdMatchesRequest(inserted.rows[0], expected, requestFingerprint)) throw err("Credit hold idempotency conflict", 409);
    await changeUserBalance(client, expected.userId, -expected.credits, createdAt);
    const allocations = expected.packageAllocation;
    let remainingToAllocate = expected.credits;
    const selected = allocations.length ? allocations : (await client.query(`
        SELECT id, remaining_credits FROM credit_packages
        WHERE user_id = $1 AND status = 'ACTIVE' AND (expired_at IS NULL OR expired_at > $2) AND remaining_credits > 0
        ORDER BY expired_at NULLS LAST, created_at ASC, id ASC FOR UPDATE
      `, [expected.userId, createdAt])).rows.map((row) => ({ packageId: row.id, credits: Math.min(Number(row.remaining_credits), remainingToAllocate) }));
    const normalized = [];
    for (const allocation of selected) {
      const amount = Math.min(Number(allocation.credits), remainingToAllocate);
      if (amount <= 0) continue;
      const locked = await client.query("SELECT remaining_credits, frozen_credits FROM credit_packages WHERE id = $1 AND user_id = $2 FOR UPDATE", [allocation.packageId, expected.userId]);
      if (!locked.rowCount || Number(locked.rows[0].remaining_credits) < amount) throw err("Insufficient credits", 402);
      const nextRemaining = Number(locked.rows[0].remaining_credits) - amount;
      const nextFrozen = Number(locked.rows[0].frozen_credits) + amount;
      const updated = await client.query(`
          UPDATE credit_packages SET remaining_credits = $1, frozen_credits = $2, status = 'ACTIVE', updated_at = $3
          WHERE id = $4 AND user_id = $5 AND remaining_credits >= $6 RETURNING id
        `, [nextRemaining, nextFrozen, createdAt, allocation.packageId, expected.userId, amount]);
      if (!updated.rowCount) throw err("Insufficient credits", 402);
      normalized.push({ packageId: allocation.packageId, credits: amount });
      remainingToAllocate -= amount;
    }
    if (remainingToAllocate > 0) throw err("Insufficient credits", 402);
    const result = await client.query(
        "UPDATE credit_holds SET package_allocation = $1 WHERE id = $2 RETURNING *",
        [JSON.stringify(normalized), inserted.rows[0].id],
      );
    return rowToHold(result.rows[0]);
  }

  async function createCreditHoldOnce(input) {
    return withTransaction(pool, (client) => createCreditHoldInTransaction(client, input));
  }

  function createCreditHold(input) {
    const expected = holdRequest(input);
    return singleFlight(`hold:${expected.userId}:${expected.idempotencyKey}:${fingerprint(expected)}`, () => createCreditHoldOnce(input));
  }

  async function getCreditHold(holdId) {
    const result = await pool.query("SELECT * FROM credit_holds WHERE id = $1", [holdId]);
    return rowToHold(result.rows[0]);
  }

  async function settleCreditHold(holdId, actualCredits, input = {}) {
    return withTransaction(pool, async (client) => {
      const found = await client.query("SELECT * FROM credit_holds WHERE id = $1 FOR UPDATE", [holdId]);
      if (!found.rowCount) return null;
      const hold = rowToHold(found.rows[0]);
      if (hold.status !== "HOLDING") return hold;
      const settledCredits = Number(actualCredits);
      if (!Number.isInteger(settledCredits) || settledCredits < 0 || settledCredits > hold.credits) throw err("Invalid settled credit amount", 400);
      const released = hold.credits - settledCredits;
      let releasedRemaining = released;
      const now = timestamp(clock);
      for (const allocation of hold.packageAllocation) {
        const allocated = Number(allocation.credits || 0);
        const packageRelease = Math.min(allocated, releasedRemaining);
        releasedRemaining -= packageRelease;
        const locked = await client.query("SELECT remaining_credits, frozen_credits FROM credit_packages WHERE id = $1 FOR UPDATE", [allocation.packageId]);
        if (!locked.rowCount || Number(locked.rows[0].frozen_credits) < allocated) throw err("Credit hold package allocation is inconsistent", 409);
        const nextRemaining = Number(locked.rows[0].remaining_credits) + packageRelease;
        const nextFrozen = Number(locked.rows[0].frozen_credits) - allocated;
        const updated = await client.query(`
          UPDATE credit_packages
          SET frozen_credits = $1, remaining_credits = $2, status = $3, updated_at = $4
          WHERE id = $5 AND frozen_credits >= $6 RETURNING id
        `, [nextFrozen, nextRemaining, nextRemaining > 0 || nextFrozen > 0 ? "ACTIVE" : "DEPLETED", now, allocation.packageId, allocated]);
        if (!updated.rowCount) throw err("Credit hold package allocation is inconsistent", 409);
      }
      if (releasedRemaining !== 0) throw err("Credit hold release is inconsistent", 409);
      const balanceAfter = await changeUserBalance(client, hold.userId, released, now);
      if (settledCredits > 0) {
        await insertTransaction(client, {
          id: input.transactionId,
          transNo: input.transNo,
          userId: hold.userId,
          transType: "GENERATION",
          credits: -settledCredits,
          balanceAfter,
          holdId,
          taskId: hold.taskId,
          reason: input.reason || `hold:${holdId}`,
          createdAt: now,
        });
      }
      const result = await client.query("UPDATE credit_holds SET settled_credits = $1, status = 'SETTLED', settled_at = $2 WHERE id = $3 RETURNING *", [settledCredits, now, holdId]);
      return rowToHold(result.rows[0]);
    });
  }

  async function releaseCreditHold(holdId) {
    return withTransaction(pool, async (client) => {
      const found = await client.query("SELECT * FROM credit_holds WHERE id = $1 FOR UPDATE", [holdId]);
      if (!found.rowCount) return null;
      const hold = rowToHold(found.rows[0]);
      if (hold.status !== "HOLDING") return hold;
      const now = timestamp(clock);
      for (const allocation of hold.packageAllocation) {
        const amount = Number(allocation.credits);
        const locked = await client.query("SELECT remaining_credits, frozen_credits FROM credit_packages WHERE id = $1 FOR UPDATE", [allocation.packageId]);
        if (!locked.rowCount || Number(locked.rows[0].frozen_credits) < amount) throw err("Credit hold package allocation is inconsistent", 409);
        const nextRemaining = Number(locked.rows[0].remaining_credits) + amount;
        const nextFrozen = Number(locked.rows[0].frozen_credits) - amount;
        const updated = await client.query(`
          UPDATE credit_packages
          SET frozen_credits = $1, remaining_credits = $2, status = 'ACTIVE', updated_at = $3
          WHERE id = $4 AND frozen_credits >= $5 RETURNING id
        `, [nextFrozen, nextRemaining, now, allocation.packageId, amount]);
        if (!updated.rowCount) throw err("Credit hold package allocation is inconsistent", 409);
      }
      await changeUserBalance(client, hold.userId, hold.credits, now);
      const result = await client.query("UPDATE credit_holds SET status = 'RELEASED', settled_at = $1 WHERE id = $2 RETURNING *", [now, holdId]);
      return rowToHold(result.rows[0]);
    });
  }

  async function addCredits(userId, amount, reason) {
    const value = Number.parseInt(amount, 10);
    if (!Number.isInteger(value) || value === 0) throw err("Credit amount must be non-zero", 400);
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      let packageId = null;
      let allocations = [];
      if (value > 0) {
        packageId = id("package");
        await client.query("INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, trans_type, metadata, created_at, updated_at) VALUES ($1, $2, $3, $3, 'SYSTEM_ADJUST', $4, $5, $5)", [packageId, userId, value, JSON.stringify({ reason: reason || "admin:adjust" }), now]);
      }
      const next = await changeUserBalance(client, userId, value, now);
      if (value < 0) allocations = await consumePackageCredits(client, userId, Math.abs(value), now);
      await insertTransaction(client, { userId, transType: "SYSTEM_ADJUST", credits: value, balanceAfter: next, packageId, reason: reason || "admin:adjust", metadata: { allocations }, createdAt: now });
      const result = await client.query("SELECT * FROM miniapp_users WHERE id = $1", [userId]);
      return rowToUser(result.rows[0]);
    });
  }

  async function charge(userId, amount, reason) {
    const value = Math.abs(Number(amount));
    if (!Number.isInteger(value) || value <= 0) throw err("Credit amount must be positive", 400);
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      const next = await changeUserBalance(client, userId, -value, now);
      const allocations = await consumePackageCredits(client, userId, value, now);
      await insertTransaction(client, { userId, transType: "GENERATION", credits: -value, balanceAfter: next, reason, metadata: { allocations }, createdAt: now });
      return next;
    });
  }

  async function listCreditTransactions(userId, options = new URLSearchParams()) {
    const { page, limit, offset } = pageOf(options);
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM credit_transactions WHERE user_id = $1", [userId]);
    const rows = await pool.query("SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [userId, limit, offset]);
    return { records: rows.rows.map(rowToTransaction), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function createTaskOnce(input) {
    const createdAt = input.createdAt || timestamp(clock);
    const taskIdValue = input.id || id("task");
    const conflict = input.idempotencyKey
      ? "ON CONFLICT (owner_id, idempotency_key) DO NOTHING"
      : "ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, images = EXCLUDED.images, provider = EXCLUDED.provider, provider_task_id = EXCLUDED.provider_task_id, prompt = EXCLUDED.prompt, topic = EXCLUDED.topic, reference_images = EXCLUDED.reference_images, model = EXCLUDED.model, output_count = EXCLUDED.output_count, aspect_ratio = EXCLUDED.aspect_ratio, resolution = EXCLUDED.resolution, requested_credits = EXCLUDED.requested_credits, settled_credits = EXCLUDED.settled_credits, credit_hold_id = EXCLUDED.credit_hold_id, raw_provider_result = EXCLUDED.raw_provider_result, error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message, updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at";
    const result = await pool.query(`
      INSERT INTO generation_tasks (id, owner_id, idempotency_key, status, images, template_id, provider, provider_task_id, provider_result_url, mode, prompt, topic, reference_images, model, output_count, aspect_ratio, resolution, requested_credits, settled_credits, credit_hold_id, raw_provider_result, metadata, error_code, error_message, created_at, updated_at, started_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $25, $26, $27)
      ${conflict}
      RETURNING *
    `, [taskIdValue, input.ownerId, input.idempotencyKey || null, input.status || "completed", JSON.stringify(input.images || []), input.templateId || null, input.provider || null, input.providerTaskId || null, input.providerResultUrl || null, input.mode || null, input.prompt || "", input.topic || "", JSON.stringify(input.referenceImages || []), input.model || "", positiveInt(input.outputCount, 1), input.aspectRatio || "", input.resolution || "", Number(input.requestedCredits || 0), Number(input.settledCredits || 0), input.creditHoldId || null, JSON.stringify(input.rawProviderResult || null), JSON.stringify(input.metadata || {}), input.errorCode || null, input.errorMessage || null, createdAt, input.startedAt || null, input.completedAt || null]);
    if (!result.rowCount && input.idempotencyKey) {
      const existing = await pool.query("SELECT * FROM generation_tasks WHERE owner_id = $1 AND idempotency_key = $2", [input.ownerId, input.idempotencyKey]);
      return rowToTask(existing.rows[0]);
    }
    return rowToTask(result.rows[0]);
  }

  function createTask(input) {
    return singleFlight(input.idempotencyKey ? `task:${input.ownerId}:${input.idempotencyKey}` : null, () => createTaskOnce(input));
  }

  function createTaskWithCreditHold(input) {
    const task = input.task || {};
    const key = String(task.idempotencyKey || input.hold?.idempotencyKey || "");
    return singleFlight(`generation:${task.ownerId}:${key}`, async () => withTransaction(pool, async (client) => {
      const existing = key
        ? await client.query("SELECT * FROM generation_tasks WHERE owner_id = $1 AND idempotency_key = $2 FOR UPDATE", [task.ownerId, key])
        : { rowCount: 0, rows: [] };
      if (existing.rowCount) {
        const holdRow = task.creditHoldId
          ? await client.query("SELECT * FROM credit_holds WHERE id = $1", [task.creditHoldId])
          : await client.query("SELECT * FROM credit_holds WHERE task_id = $1", [existing.rows[0].id]);
        return { task: rowToTask(existing.rows[0]), hold: rowToHold(holdRow.rows[0]), created: false };
      }

      const hold = await createCreditHoldInTransaction(client, input.hold);
      const createdAt = task.createdAt || timestamp(clock);
      const result = await client.query(`
        INSERT INTO generation_tasks (
          id, owner_id, idempotency_key, status, images, template_id, provider, provider_task_id,
          provider_result_url, mode, prompt, topic, reference_images, model, output_count,
          aspect_ratio, resolution, requested_credits, settled_credits, credit_hold_id,
          raw_provider_result, metadata, error_code, error_message, created_at, updated_at, started_at, completed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, $25, $26, $27
        ) ON CONFLICT (owner_id, idempotency_key) DO NOTHING RETURNING *
      `, [
        task.id || id("task"), task.ownerId, key || null, task.status || "pending", JSON.stringify(task.images || []),
        task.templateId || null, task.provider || null, task.providerTaskId || null, task.providerResultUrl || null,
        task.mode || null, task.prompt || "", task.topic || "", JSON.stringify(task.referenceImages || []),
        task.model || "", positiveInt(task.outputCount, 1), task.aspectRatio || "", task.resolution || "",
        Number(task.requestedCredits || input.hold.credits || 0), Number(task.settledCredits || 0), hold.id,
        JSON.stringify(task.rawProviderResult || null), JSON.stringify(task.metadata || {}), task.errorCode || null,
        task.errorMessage || null, createdAt, task.startedAt || null, task.completedAt || null,
      ]);
      if (!result.rowCount) {
        const replay = await client.query("SELECT * FROM generation_tasks WHERE owner_id = $1 AND idempotency_key = $2 FOR UPDATE", [task.ownerId, key]);
        return { task: rowToTask(replay.rows[0]), hold, created: false };
      }
      return { task: rowToTask(result.rows[0]), hold, created: true };
    }));
  }

  async function getTask(taskId) {
    const result = await pool.query("SELECT * FROM generation_tasks WHERE id = $1", [taskId]);
    return rowToTask(result.rows[0]);
  }

  async function listTasks(ownerId, options = new URLSearchParams()) {
    const { params, page, limit, offset } = pageOf(options);
    const values = [ownerId];
    const filters = ["owner_id = $1"];
    const status = String(params.get("status") || "").trim();
    if (status) { values.push(status); filters.push(`status = $${values.length}`); }
    const q = String(params.get("q") || "").trim();
    if (q) { values.push(`%${q}%`); filters.push(`(prompt ILIKE $${values.length} OR topic ILIKE $${values.length} OR model ILIKE $${values.length} OR template_id ILIKE $${values.length})`); }
    const where = `WHERE ${filters.join(" AND ")}`;
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM generation_tasks ${where}`, values);
    const rows = await pool.query(`SELECT * FROM generation_tasks ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    return { records: rows.rows.map(rowToTask), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function claimTask(workerId, input = {}) {
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      const duration = Number(input.leaseDurationMs || 60_000);
      const expires = new Date(Date.parse(now) + duration).toISOString();
      const found = await client.query("SELECT * FROM generation_tasks WHERE status IN ('pending', 'retryable') AND (lease_expires_at IS NULL OR lease_expires_at <= $1) AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE", [now]);
      if (!found.rowCount) return null;
      const result = await client.query("UPDATE generation_tasks SET status = 'leased', lease_owner = $1, lease_expires_at = $2, attempt = attempt + 1, started_at = COALESCE(started_at, $3), updated_at = $3 WHERE id = $4 RETURNING *", [workerId, expires, now, found.rows[0].id]);
      return rowToTask(result.rows[0]);
    });
  }

  async function renewTaskLease(taskId, workerId, input = {}) {
    const now = timestamp(clock);
    const expires = new Date(Date.parse(now) + Number(input.leaseDurationMs || 60_000)).toISOString();
    const result = await pool.query("UPDATE generation_tasks SET lease_expires_at = $1, updated_at = $2 WHERE id = $3 AND lease_owner = $4 AND status IN ('leased', 'processing') RETURNING *", [expires, now, taskId, workerId]);
    return rowToTask(result.rows[0]);
  }

  async function releaseTaskLease(taskId, workerId, input = {}) {
    const now = timestamp(clock);
    const result = await pool.query("UPDATE generation_tasks SET status = $1, lease_owner = NULL, lease_expires_at = NULL, error_code = COALESCE($2, error_code), error_message = COALESCE($3, error_message), updated_at = $4, completed_at = CASE WHEN $1 = 'completed' THEN COALESCE(completed_at, $4) ELSE completed_at END WHERE id = $5 AND lease_owner = $6 RETURNING *", [input.status || "pending", input.errorCode || null, input.errorMessage || null, now, taskId, workerId]);
    return rowToTask(result.rows[0]);
  }

  async function reclaimExpiredTasks() {
    const now = timestamp(clock);
    const result = await pool.query("UPDATE generation_tasks SET status = 'retryable', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1 WHERE status IN ('leased', 'processing') AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1 RETURNING *", [now]);
    return result.rows.map(rowToTask);
  }

  async function updateTask(taskId, updates = {}) {
    const allowed = {
      status: "status",
      images: "images",
      provider: "provider",
      providerTaskId: "provider_task_id",
      providerResultUrl: "provider_result_url",
      rawProviderResult: "raw_provider_result",
      errorCode: "error_code",
      errorMessage: "error_message",
      settledCredits: "settled_credits",
      completedAt: "completed_at",
      nextAttemptAt: "next_attempt_at",
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (updates[key] === undefined) continue;
      values.push(["images", "rawProviderResult"].includes(key) ? JSON.stringify(updates[key]) : updates[key]);
      fields.push(`${column} = $${values.length}`);
    }
    if (!fields.length) return getTask(taskId);
    values.push(timestamp(clock), taskId);
    const result = await pool.query(`UPDATE generation_tasks SET ${fields.join(", ")}, updated_at = $${values.length - 1} WHERE id = $${values.length} RETURNING *`, values);
    return rowToTask(result.rows[0]);
  }

  async function createAsset(input) {
    const result = await pool.query("INSERT INTO generated_assets (id, task_id, user_id, output_index, object_key, provider_url, mime_type, width, height, size_bytes, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (task_id, output_index) DO UPDATE SET object_key = EXCLUDED.object_key, provider_url = EXCLUDED.provider_url, mime_type = EXCLUDED.mime_type, width = EXCLUDED.width, height = EXCLUDED.height, size_bytes = EXCLUDED.size_bytes, metadata = EXCLUDED.metadata RETURNING *", [input.id || id("asset"), input.taskId, input.userId, Number(input.outputIndex || 0), input.objectKey, input.providerUrl || null, input.mimeType || "image/png", input.width || null, input.height || null, input.sizeBytes || null, JSON.stringify(json(input.metadata))]);
    return rowToAsset(result.rows[0]);
  }

  async function getAsset(assetId) {
    const result = await pool.query("SELECT * FROM generated_assets WHERE id = $1 AND is_deleted = FALSE", [assetId]);
    return rowToAsset(result.rows[0]);
  }

  async function findOwnedAsset(userId, assetId) {
    const direct = await getAsset(assetId);
    if (direct && direct.userId === userId) return direct;
    const result = await pool.query("SELECT * FROM generated_assets WHERE user_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC", [userId]);
    return result.rows.map(rowToAsset).find((asset) => asset.id === assetId) || null;
  }

  async function findOwnedImageAsset(userId, value) {
    const result = await pool.query("SELECT * FROM generated_assets WHERE user_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC", [userId]);
    for (const asset of result.rows.map(rowToAsset)) {
      if (matchesAssetId(asset.providerUrl || asset.objectKey, value)) return { taskId: asset.taskId, assetId: asset.id || assetIdForUrl(asset.providerUrl || asset.objectKey), url: asset.providerUrl || asset.objectKey };
    }
    return null;
  }

  async function listAssets(userId, options = new URLSearchParams()) {
    const { page, limit, offset } = pageOf(options);
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM generated_assets WHERE user_id = $1 AND is_deleted = FALSE", [userId]);
    const rows = await pool.query("SELECT * FROM generated_assets WHERE user_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [userId, limit, offset]);
    return { records: rows.rows.map(rowToAsset), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function deleteAsset(assetId, userId) {
    const result = await pool.query("UPDATE generated_assets SET is_deleted = TRUE WHERE id = $1 AND user_id = $2 RETURNING *", [assetId, userId]);
    return rowToAsset(result.rows[0]);
  }

  async function createReferenceAsset(input) {
    const result = await pool.query("INSERT INTO reference_assets (id, user_id, object_key, mime_type, width, height, size_bytes, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *", [input.id || id("reference"), input.userId, input.objectKey, input.mimeType, input.width || null, input.height || null, input.sizeBytes || null, JSON.stringify(json(input.metadata)), input.createdAt || timestamp(clock)]);
    return rowToAsset(result.rows[0]);
  }

  async function getReferenceAsset(assetId) {
    const result = await pool.query("SELECT id, NULL::text AS task_id, user_id, 0 AS output_index, object_key, NULL::text AS provider_url, mime_type, width, height, size_bytes, is_deleted, metadata, created_at FROM reference_assets WHERE id = $1 AND is_deleted = FALSE", [assetId]);
    return rowToAsset(result.rows[0]);
  }

  async function listReferenceAssets(userId, options = new URLSearchParams()) {
    const { page, limit, offset } = pageOf(options);
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM reference_assets WHERE user_id = $1 AND is_deleted = FALSE", [userId]);
    const rows = await pool.query("SELECT id, NULL::text AS task_id, user_id, 0 AS output_index, object_key, NULL::text AS provider_url, mime_type, width, height, size_bytes, is_deleted, metadata, created_at FROM reference_assets WHERE user_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [userId, limit, offset]);
    return { records: rows.rows.map(rowToAsset), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function deleteReferenceAsset(assetId, userId) {
    const result = await pool.query("UPDATE reference_assets SET is_deleted = TRUE, deleted_at = $1 WHERE id = $2 AND user_id = $3 RETURNING id, NULL::text AS task_id, user_id, 0 AS output_index, object_key, NULL::text AS provider_url, mime_type, width, height, size_bytes, is_deleted, metadata, created_at", [timestamp(clock), assetId, userId]);
    return rowToAsset(result.rows[0]);
  }

  async function createCatalogVersion(input) {
    const result = await pool.query("INSERT INTO template_catalog_versions (id, checksum, source, record_count, metadata) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET checksum = EXCLUDED.checksum, source = EXCLUDED.source, record_count = EXCLUDED.record_count, metadata = EXCLUDED.metadata RETURNING *", [input.id || id("catalog"), input.checksum, input.source || "unknown", Number(input.recordCount || 0), JSON.stringify(json(input.metadata))]);
    return rowToCatalogVersion(result.rows[0]);
  }

  async function getCatalogVersion(versionId) {
    const result = await pool.query("SELECT * FROM template_catalog_versions WHERE id = $1", [versionId]);
    return rowToCatalogVersion(result.rows[0]);
  }

  async function getActiveCatalogVersion() {
    const result = await pool.query("SELECT * FROM template_catalog_versions WHERE active = TRUE LIMIT 1");
    return rowToCatalogVersion(result.rows[0]);
  }

  async function catalogVersionState(client, versionId) {
    const versionResult = await client.query("SELECT * FROM template_catalog_versions WHERE id = $1", [versionId]);
    if (!versionResult.rowCount) return null;
    const version = rowToCatalogVersion(versionResult.rows[0]);
    const rows = await client.query("SELECT * FROM templates WHERE catalog_version_id = $1 ORDER BY id ASC", [versionId]);
    const persistedChecksum = recordsChecksum(rows.rows.map(rowToTemplate));
    return {
      version,
      persistedRecordCount: rows.rowCount,
      persistedChecksum,
      complete: rows.rowCount === version.recordCount && persistedChecksum === version.checksum,
    };
  }

  function getCatalogVersionState(versionId) {
    return catalogVersionState(pool, versionId);
  }

  async function activateCatalogVersion(versionId) {
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      const state = await catalogVersionState(client, versionId);
      if (!state) throw new Error(`Catalog version not found: ${versionId}`);
      if (state.persistedRecordCount !== state.version.recordCount) throw new Error(`Catalog version incomplete: ${versionId} record count mismatch`);
      if (state.persistedChecksum !== state.version.checksum) throw new Error(`Catalog version checksum mismatch: ${versionId}`);
      await client.query("UPDATE template_catalog_versions SET active = FALSE WHERE active = TRUE");
      const result = await client.query("UPDATE template_catalog_versions SET active = TRUE, activated_at = $1 WHERE id = $2 RETURNING *", [now, versionId]);
      return rowToCatalogVersion(result.rows[0]);
    });
  }

  async function syncTemplates(records = [], input = {}) {
    return withTransaction(pool, async (client) => {
      const versionId = input.catalogVersionId || (await client.query("SELECT id FROM template_catalog_versions WHERE active = TRUE LIMIT 1")).rows[0]?.id || null;
      for (const record of records) {
        if (versionId) await client.query("DELETE FROM templates WHERE catalog_version_id = $1 AND id = $2", [versionId, record.id]);
        else await client.query("DELETE FROM templates WHERE catalog_version_id IS NULL AND id = $1", [record.id]);
        await client.query(`
          INSERT INTO templates (id, catalog_version_id, title, subtitle, author, category, scenario_category, tags, prompt, reference_images, preview_images, source, source_id, source_url, thumbnail_url, preview_url, use_case, metrics, seed, metadata, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        `, [record.id, versionId, record.title || "", record.subtitle || "", record.author || "", record.category || "", record.scenarioCategory || record.scenario_category || "", JSON.stringify(record.tags || []), record.prompt || "", JSON.stringify(record.referenceImages || record.reference_images || []), JSON.stringify(record.previewImages || record.preview_images || []), record.source || "", record.sourceId || record.source_id || "", record.sourceUrl || record.source_url || "", record.thumbnailUrl || record.thumbnail_url || "", record.previewUrl || record.preview_url || "", record.useCase || record.use_case || "", JSON.stringify(record.metrics || null), JSON.stringify(record.seed || null), JSON.stringify(record.metadata || {}), record.createdAt || timestamp(clock), record.updatedAt || timestamp(clock)]);
      }
      return records.length;
    });
  }

  async function importCatalogVersion(input) {
    const { records } = validateCatalogVersionInput(input);
    const ids = new Set();
    for (const record of records) {
      if (!record || !record.id || ids.has(record.id)) throw new Error(`Duplicate catalog id: ${record && record.id}`);
      ids.add(record.id);
    }
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      await client.query(`
        INSERT INTO template_catalog_versions (id, checksum, source, record_count, active, metadata)
        VALUES ($1, $2, $3, $4, FALSE, $5)
        ON CONFLICT (id) DO UPDATE SET checksum = EXCLUDED.checksum, source = EXCLUDED.source,
          record_count = EXCLUDED.record_count, metadata = EXCLUDED.metadata
      `, [input.id, input.checksum || "", input.source || "unknown", Number(input.recordCount || records.length), JSON.stringify(json(input.metadata))]);
      await client.query("DELETE FROM templates WHERE catalog_version_id = $1", [input.id]);
      for (const record of records) {
        await client.query(`
          INSERT INTO templates (id, catalog_version_id, title, subtitle, author, category, scenario_category, tags, prompt, reference_images, preview_images, source, source_id, source_url, thumbnail_url, preview_url, use_case, metrics, seed, metadata, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        `, [record.id, input.id, record.title || "", record.subtitle || "", record.author || "", record.category || "", record.scenarioCategory || record.scenario_category || "", JSON.stringify(record.tags || []), record.prompt || "", JSON.stringify(record.referenceImages || record.reference_images || []), JSON.stringify(record.previewImages || record.preview_images || []), record.source || "", record.sourceId || record.source_id || "", record.sourceUrl || record.source_url || "", record.thumbnailUrl || record.thumbnail_url || "", record.previewUrl || record.preview_url || "", record.useCase || record.use_case || "", JSON.stringify(record.metrics || null), JSON.stringify(record.seed || null), JSON.stringify(record.metadata || {}), record.createdAt || now, record.updatedAt || now]);
      }
      const state = await catalogVersionState(client, input.id);
      if (!state || !state.complete) throw new Error(`Catalog version incomplete after import: ${input.id}`);
      await client.query("UPDATE template_catalog_versions SET active = FALSE, activated_at = NULL WHERE active = TRUE");
      await client.query("UPDATE template_catalog_versions SET active = TRUE, activated_at = $1 WHERE id = $2", [now, input.id]);
      const result = await client.query("SELECT * FROM template_catalog_versions WHERE id = $1", [input.id]);
      return rowToCatalogVersion(result.rows[0]);
    });
  }

  async function listTemplates(options = new URLSearchParams()) {
    const active = await getActiveCatalogVersion();
    const rows = active
      ? await pool.query("SELECT * FROM templates WHERE catalog_version_id = $1", [active.id])
      : await pool.query("SELECT * FROM templates WHERE catalog_version_id IS NULL");
    return queryCatalog(rows.rows.map(rowToTemplate), options, active);
  }

  async function getTemplate(templateId) {
    const active = await getActiveCatalogVersion();
    const result = active
      ? await pool.query("SELECT * FROM templates WHERE id = $1 AND catalog_version_id = $2", [templateId, active.id])
      : await pool.query("SELECT * FROM templates WHERE id = $1 AND catalog_version_id IS NULL", [templateId]);
    return rowToTemplate(result.rows[0]);
  }

  async function createOrderOnce(input) {
    const now = input.createdAt || timestamp(clock);
    const orderIdValue = input.id || id("order");
    const requestFingerprint = fingerprint(orderRequest(input));
    const result = await pool.query(`
      INSERT INTO miniapp_orders (id, user_id, idempotency_key, product_id, channel, status, payment_status, payment_mode, payment_verified, amount_cents, currency, credits, product_snapshot, payment_params, external_payment_id, metadata, request_fingerprint, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [orderIdValue, input.userId, input.idempotencyKey || null, input.productId, input.channel || "wechat", input.status || "pending", input.paymentStatus || "created", input.paymentMode || "manual", Number(input.amountCents || 0), input.currency || "CNY", Number(input.credits || 0), JSON.stringify(input.productSnapshot || {}), JSON.stringify(input.paymentParams || null), input.externalPaymentId || null, JSON.stringify(input.metadata || {}), requestFingerprint, now]);
    if (result.rowCount) return markOrderCreation(rowToOrder(result.rows[0]), true);

    if (input.idempotencyKey) {
      const replay = await pool.query(
        "SELECT * FROM miniapp_orders WHERE user_id = $1 AND idempotency_key = $2",
        [input.userId, input.idempotencyKey],
      );
      const row = replay.rows[0];
      if (row && row.user_id === input.userId && row.request_fingerprint === requestFingerprint) {
        return markOrderCreation(rowToOrder(row), false);
      }
    }

    const legacyReplay = await pool.query("SELECT * FROM miniapp_orders WHERE id = $1", [orderIdValue]);
    const row = legacyReplay.rows[0];
    if (row && row.user_id === input.userId && row.request_fingerprint === requestFingerprint) {
      return markOrderCreation(rowToOrder(row), false);
    }
    throw err("Order idempotency conflict", 409);
  }

  function createOrder(input) {
    return createOrderOnce(input);
  }

  async function getOrder(orderId) {
    const result = await pool.query("SELECT * FROM miniapp_orders WHERE id = $1", [orderId]);
    return rowToOrder(result.rows[0]);
  }

  async function getOrderByIdempotencyKey(userId, key) {
    const result = await pool.query("SELECT * FROM miniapp_orders WHERE user_id = $1 AND idempotency_key = $2", [userId, key]);
    return rowToOrder(result.rows[0]);
  }

  async function queryOrders(where, values, options) {
    const { page, limit, offset } = pageOf(options);
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM miniapp_orders ${where}`, values);
    const rows = await pool.query(`SELECT * FROM miniapp_orders ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    return { records: rows.rows.map(rowToOrder), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function listOrders(userId, options = new URLSearchParams()) {
    const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
    const values = [userId];
    const filters = ["user_id = $1"];
    if (params.get("status")) { values.push(params.get("status")); filters.push(`status = $${values.length}`); }
    if (params.get("productId")) { values.push(params.get("productId")); filters.push(`product_id = $${values.length}`); }
    return queryOrders(`WHERE ${filters.join(" AND ")}`, values, options);
  }

  async function listAllOrders(options = new URLSearchParams()) {
    const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
    const values = [];
    const filters = [];
    if (params.get("userId")) { values.push(params.get("userId")); filters.push(`user_id = $${values.length}`); }
    if (params.get("status")) { values.push(params.get("status")); filters.push(`status = $${values.length}`); }
    return queryOrders(filters.length ? `WHERE ${filters.join(" AND ")}` : "", values, options);
  }

  async function findPaymentIdentity(client, input, lock = false) {
    const result = await client.query(`
      SELECT * FROM payment_fulfillments
      WHERE fulfillment_key = $1
         OR (provider = $2 AND provider_transaction_id = $3)
         OR (provider = $2 AND event_id = $4)
      ${lock ? "FOR UPDATE" : ""}
    `, [input.fulfillmentKey, input.provider, input.providerTransactionId || null, input.eventId || null]);
    return [...new Map(result.rows.map((row) => [row.id, row])).values()];
  }

  function validatedPaymentReplay(rows, input, verificationMode = null) {
    if (rows.length !== 1) throw err("Payment fulfillment identity conflict", 409);
    const fulfillment = rowToPaymentFulfillment(rows[0]);
    const matches = fulfillment.orderId === (input.orderId || null)
      && fulfillment.provider === input.provider
      && fulfillment.eventId === (input.eventId || "")
      && fulfillment.providerTransactionId === (input.providerTransactionId || "");
    const verified = !verificationMode
      || (fulfillment.status === "FULFILLED"
        && fulfillment.metadata.paymentVerified === true
        && fulfillment.metadata.verificationMode === verificationMode);
    if (!matches || !verified) throw err("Payment fulfillment identity conflict", 409);
    return fulfillment;
  }

  async function lockPaymentOrder(client, orderId, input, verificationMode) {
    const found = await client.query("SELECT * FROM miniapp_orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!found.rowCount) return null;
    const order = rowToOrder(found.rows[0]);
    if (order.status === "canceled" || order.status === "refunded") throw err("Order cannot be fulfilled", 409);
    if (verificationMode === "wechat" && (order.paymentMode !== "wechat" || input.provider !== "wechat")) {
      throw err("Verified WeChat payment required", 409);
    }
    if (verificationMode === "mock") {
      const expected = `mock:${orderId}`;
      const imported = Boolean(order.metadata.legacyId) || order.metadata.paymentVerification === "not-verified";
      const pendingMockOrder = order.paymentMode === "mock"
        && order.status === "pending"
        && order.paymentStatus === "mock_pending"
        && !order.fulfilledAt
        && !order.paymentVerified;
      const completedMockOrder = order.paymentMode === "mock"
        && order.status === "paid"
        && order.paymentStatus === "fulfilled"
        && Boolean(order.fulfilledAt)
        && order.paymentVerified;
      const deterministicIdentity = input.fulfillmentKey === expected
        && input.eventId === expected
        && input.providerTransactionId === expected;
      if (["production", "prod"].includes(environment)
        || order.paymentMode !== "mock"
        || input.provider !== "mock"
        || input.paymentMode !== "mock"
        || imported
        || !deterministicIdentity
        || (!pendingMockOrder && !completedMockOrder)) {
        throw err("Development mock payment required", 409);
      }
    }
    if (order.fulfilledAt) {
      const verification = verificationMode === "mock" ? "mock-verified" : "verified";
      if (!order.paymentVerified || order.externalPaymentId !== input.providerTransactionId || order.metadata.paymentEventId !== input.eventId || order.metadata.paymentVerification !== verification) {
        throw err("Payment fulfillment identity conflict", 409);
      }
    }
    return order;
  }

  async function fulfillPaymentOrder(client, order, input, verificationMode) {
    if (!order) return null;
    if (order.fulfilledAt) return { order, fulfilled: false };
    const now = timestamp(clock);
    const credits = positiveInt(order.credits, 0);
    let balanceAfter = Number((await client.query("SELECT balance FROM miniapp_users WHERE id = $1", [order.userId])).rows[0]?.balance);
    if (!Number.isFinite(balanceAfter)) throw err("User not found", 404);
    if (credits > 0) {
      await client.query("INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, trans_type, order_no, metadata, created_at, updated_at) VALUES ($1, $2, $3, $3, 'ORDER_PAY', $4, $5, $6, $6)", [`order_${order.id}`, order.userId, credits, order.id, JSON.stringify({ orderId: order.id, paymentEventId: input.eventId }), now]);
      balanceAfter = await changeUserBalance(client, order.userId, credits, now);
      await insertTransaction(client, { userId: order.userId, transType: "ORDER_PAY", credits, balanceAfter, orderNo: order.id, reason: `${verificationMode}-payment:${input.eventId}`, metadata: { provider: input.provider, providerTransactionId: input.providerTransactionId }, createdAt: now });
    }
    const paymentVerification = verificationMode === "mock" ? "mock-verified" : "verified";
    await client.query(`
      UPDATE miniapp_orders
      SET status = 'paid', payment_status = 'fulfilled', payment_verified = TRUE,
          paid_at = COALESCE(paid_at, $1), fulfilled_at = $1, credits_granted = $2,
          external_payment_id = COALESCE(external_payment_id, $3),
          metadata = $4, updated_at = $1
      WHERE id = $5
    `, [input.paidAt || now, credits, input.providerTransactionId, JSON.stringify({ ...order.metadata, paymentVerification, paymentEventId: input.eventId }), order.id]);
    const updated = await client.query("SELECT * FROM miniapp_orders WHERE id = $1", [order.id]);
    return { order: rowToOrder(updated.rows[0]), fulfilled: true };
  }

  async function fulfillOrder() {
    throw err("Verified payment event required", 409);
  }

  async function fulfillPaymentEvent(input, verificationMode) {
    return withTransaction(pool, async (client) => {
      const order = await lockPaymentOrder(client, input.orderId, input, verificationMode);
      if (!order) return { fulfillment: null, result: null };
      const existing = await findPaymentIdentity(client, input, true);
      if (existing.length) {
        const fulfillment = validatedPaymentReplay(existing, input, verificationMode);
        return { fulfillment, result: await fulfillPaymentOrder(client, order, input, verificationMode) };
      }

      const createdAt = timestamp(clock);
      const fulfillmentId = input.id || id("fulfillment");
      const metadata = { ...json(input.metadata), paymentVerified: true, verificationMode };
      const inserted = await client.query(`
        INSERT INTO payment_fulfillments (id, fulfillment_key, order_id, provider, event_id, event_type, provider_order_id, provider_transaction_id, status, metadata, fulfilled_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'FULFILLED', $9, $10, $10, $10)
        ON CONFLICT DO NOTHING RETURNING *
      `, [fulfillmentId, input.fulfillmentKey, input.orderId, input.provider, input.eventId, input.eventType || null, input.providerOrderId || null, input.providerTransactionId, JSON.stringify(metadata), createdAt]);
      let fulfillment;
      if (inserted.rowCount && inserted.rows[0].id === fulfillmentId) {
        fulfillment = rowToPaymentFulfillment(inserted.rows[0]);
      } else {
        fulfillment = validatedPaymentReplay(await findPaymentIdentity(client, input, true), input, verificationMode);
      }
      const result = await fulfillPaymentOrder(client, order, input, verificationMode);
      return { fulfillment, result };
    });
  }

  async function fulfillMockOrder(orderId, input = {}) {
    const expected = `mock:${orderId}`;
    if (["production", "prod"].includes(environment)
      || input.provider !== "mock"
      || input.paymentMode !== "mock"
      || input.paymentVerified !== true
      || input.status !== "FULFILLED"
      || input.fulfillmentKey !== expected
      || input.eventId !== expected
      || input.providerTransactionId !== expected) {
      throw err("Development mock payment required", 409);
    }
    const fulfilled = await fulfillPaymentEvent({ ...input, orderId }, "mock");
    return fulfilled.result;
  }

  async function cancelOrder(orderId, input = {}) {
    const order = await getOrder(orderId);
    if (!order) return null;
    if (order.fulfilledAt || order.status === "paid") throw err("Paid orders must be refunded instead of canceled", 409);
    if (order.canceledAt) return { order, canceled: false };
    const now = timestamp(clock);
    const result = await pool.query("UPDATE miniapp_orders SET status = 'canceled', payment_status = 'canceled', canceled_at = $1, admin_note = $2, updated_at = $1 WHERE id = $3 RETURNING *", [now, input.reason || order.adminNote || "", orderId]);
    return { order: rowToOrder(result.rows[0]), canceled: true };
  }

  async function refundOrder(orderId, input = {}) {
    return withTransaction(pool, async (client) => {
      const found = await client.query("SELECT * FROM miniapp_orders WHERE id = $1 FOR UPDATE", [orderId]);
      if (!found.rowCount) return null;
      const order = rowToOrder(found.rows[0]);
      if (order.refundedAt) return { order, refunded: false, revokedCredits: 0 };
      const remainder = Math.max(0, order.creditsGranted - order.creditsRevoked);
      const now = timestamp(clock);
      const available = await client.query("SELECT COALESCE(SUM(remaining_credits), 0)::int AS credits FROM credit_packages WHERE user_id = $1 AND order_no = $2 AND status = 'ACTIVE'", [order.userId, order.id]);
      const revoked = input.revokeCredits === false ? 0 : Math.min(Number(available.rows[0].credits), remainder);
      if (revoked) {
        const nextBalance = await changeUserBalance(client, order.userId, -revoked, now);
        const allocations = await consumePackageCredits(client, order.userId, revoked, now, { orderNo: order.id, onlyOrder: true });
        await insertTransaction(client, { userId: order.userId, transType: "REFUND", credits: -revoked, balanceAfter: nextBalance, orderNo: order.id, reason: input.reason || `refund:${order.id}`, metadata: { allocations }, createdAt: now });
      }
      await client.query("UPDATE miniapp_orders SET status = 'refunded', payment_status = 'refunded', refunded_at = $1, credits_revoked = credits_revoked + $2, admin_note = $3, updated_at = $1 WHERE id = $4", [now, revoked, input.reason || order.adminNote || "", order.id]);
      const updated = await client.query("SELECT * FROM miniapp_orders WHERE id = $1", [order.id]);
      return { order: rowToOrder(updated.rows[0]), refunded: true, revokedCredits: revoked };
    });
  }

  async function recordPaymentFulfillment(input) {
    const normalized = { ...input, provider: input.provider || "unknown" };
    return withTransaction(pool, async (client) => {
      const existing = await findPaymentIdentity(client, normalized, true);
      if (existing.length) return validatedPaymentReplay(existing, normalized);
      const createdAt = timestamp(clock);
      const fulfillmentId = input.id || id("fulfillment");
      const result = await client.query(`
        INSERT INTO payment_fulfillments (id, fulfillment_key, order_id, provider, event_id, event_type, provider_order_id, provider_transaction_id, status, error_message, metadata, fulfilled_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
        ON CONFLICT DO NOTHING RETURNING *
      `, [fulfillmentId, input.fulfillmentKey, input.orderId || null, normalized.provider, input.eventId || null, input.eventType || null, input.providerOrderId || null, input.providerTransactionId || null, input.status || "PENDING", input.errorMessage || null, JSON.stringify(json(input.metadata)), input.fulfilledAt || (input.status === "FULFILLED" ? createdAt : null), createdAt]);
      if (result.rowCount && result.rows[0].id === fulfillmentId) return rowToPaymentFulfillment(result.rows[0]);
      return validatedPaymentReplay(await findPaymentIdentity(client, normalized, true), normalized);
    });
  }

  async function fulfillPayment(input) {
    if (input.paymentVerified !== true || input.provider !== "wechat" || input.status !== "FULFILLED" || !input.fulfillmentKey || !input.orderId || !input.eventId || !input.providerTransactionId) {
      throw err("Verified WeChat payment required", 409);
    }
    return (await fulfillPaymentEvent(input, "wechat")).fulfillment;
  }

  async function getPaymentFulfillment(key) {
    const result = await pool.query("SELECT * FROM payment_fulfillments WHERE fulfillment_key = $1", [key]);
    return rowToPaymentFulfillment(result.rows[0]);
  }

  async function recordPaymentEvent(input) {
    const result = await pool.query("INSERT INTO payment_audit_events (id, order_id, user_id, type, actor_id, message, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *", [input.id || id("audit"), input.orderId || null, input.userId || null, input.type, input.actorId || null, input.message || "", JSON.stringify(input.metadata == null ? null : input.metadata), input.createdAt || timestamp(clock)]);
    return rowToPaymentEvent(result.rows[0]);
  }

  async function listPaymentAudit(options = new URLSearchParams()) {
    const { params, page, limit, offset } = pageOf(options);
    const values = [];
    const filters = [];
    for (const field of ["user_id", "order_id", "type"]) {
      const key = field === "user_id" ? "userId" : field === "order_id" ? "orderId" : field;
      if (params.get(key)) { values.push(params.get(key)); filters.push(`${field} = $${values.length}`); }
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM payment_audit_events ${where}`, values);
    const rows = await pool.query(`SELECT * FROM payment_audit_events ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    return { records: rows.rows.map(rowToPaymentEvent), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function recordAdminAudit(input) {
    const result = await pool.query("INSERT INTO admin_audit_logs (id, actor_user_id, target_user_id, action, entity_type, entity_id, reason, before_state, after_state, ip_address, user_agent, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *", [input.id || id("admin_audit"), input.actorUserId, input.targetUserId || null, input.action, input.entityType, input.entityId || null, input.reason || "", JSON.stringify(input.before == null ? null : input.before), JSON.stringify(input.after == null ? null : input.after), input.ipAddress || null, input.userAgent || null, input.createdAt || timestamp(clock)]);
    return rowToAdminAudit(result.rows[0]);
  }

  async function listAdminAudit(options = {}) {
    const params = options instanceof URLSearchParams ? options : new URLSearchParams(options || {});
    const { page, limit, offset } = pageOf(params);
    const values = [];
    const filters = [];
    if (params.get("actorUserId")) { values.push(params.get("actorUserId")); filters.push(`actor_user_id = $${values.length}`); }
    if (params.get("targetUserId")) { values.push(params.get("targetUserId")); filters.push(`target_user_id = $${values.length}`); }
    if (params.get("action")) { values.push(params.get("action")); filters.push(`action = $${values.length}`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM admin_audit_logs ${where}`, values);
    const rows = await pool.query(`SELECT * FROM admin_audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
    return { records: rows.rows.map(rowToAdminAudit), pagination: pagination(page, limit, total.rows[0].total) };
  }

  return {
    ensureUser, getUser, getUserByIdentity, updateUserProfile, listUsers,
    createSession, getSession, getSessionByTokenHash, touchSession, revokeSession, revokeSessionByTokenHash, revokeAllSessions,
    createCreditPackage, getCreditPackage, listCreditPackages, createCreditHold, getCreditHold, settleCreditHold, releaseCreditHold,
    addCredits, charge, listCreditTransactions,
    createTask, createTaskWithCreditHold, getTask, listTasks, claimTask, renewTaskLease, releaseTaskLease, reclaimExpiredTasks, updateTask,
    createAsset, createGeneratedAsset: createAsset, getAsset, getGeneratedAsset: getAsset, findOwnedAsset, findOwnedImageAsset, listAssets, listGeneratedAssets: listAssets, deleteAsset,
    createReferenceAsset, getReferenceAsset, listReferenceAssets, deleteReferenceAsset,
    createCatalogVersion, getCatalogVersion, getCatalogVersionState, getActiveCatalogVersion, activateCatalogVersion, importCatalogVersion, syncTemplates, listTemplates, getTemplate,
    createOrder, getOrder, getOrderByIdempotencyKey, listOrders, listAllOrders, fulfillOrder, fulfillMockOrder, cancelOrder, refundOrder,
    recordPaymentFulfillment, fulfillPayment, getPaymentFulfillment, recordPaymentEvent, listPaymentAudit,
    recordAdminAudit, listAdminAudit,
    isReady: () => true,
    close: async () => {},
  };
}

async function insertTransaction(client, input) {
  const transactionId = input.id || id("transaction");
  await client.query(`
    INSERT INTO credit_transactions (id, trans_no, user_id, trans_type, credits, balance_after, package_id, task_id, order_no, hold_id, reason, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [transactionId, input.transNo || transactionId, input.userId, input.transType, input.credits, input.balanceAfter, input.packageId || null, input.taskId || null, input.orderNo || null, input.holdId || null, input.reason || "", JSON.stringify(input.metadata || {}), input.createdAt || new Date().toISOString()]);
}

module.exports = {
  createPostgresStore,
  rowToUser,
  rowToTask,
  rowToOrder,
};
