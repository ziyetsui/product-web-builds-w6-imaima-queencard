const crypto = require("node:crypto");

const { withTransaction } = require("../db/migrate");

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

  async function ensureUser(identity) {
    const createdAt = timestamp(clock);
    const userId = identity.sub || `wechat:${identity.appid}:${identity.openid}`;
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
    const result = await pool.query(`
      INSERT INTO miniapp_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *
    `, [input.id || id("session"), input.userId, input.tokenHash, input.expiresAt, input.ipAddress || null, input.userAgent || null, createdAt]);
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

  async function createCreditPackage(input) {
    const createdAt = timestamp(clock);
    const initial = Number(input.initialCredits || 0);
    const remaining = input.remainingCredits == null ? initial : Number(input.remainingCredits);
    const frozen = Number(input.frozenCredits || 0);
    const packageId = input.id || id("package");
    const result = await withTransaction(pool, async (client) => {
      const inserted = await client.query(`
        INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, frozen_credits, trans_type, order_no, status, expired_at, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
        ON CONFLICT (id) DO UPDATE SET updated_at = credit_packages.updated_at
        RETURNING *
      `, [packageId, input.userId, initial, remaining, frozen, input.transType || "SYSTEM_ADJUST", input.orderNo || null, input.status || "ACTIVE", input.expiredAt || null, JSON.stringify(json(input.metadata)), createdAt]);
      if (Number(remaining) > 0 && input.addToBalance !== false) {
        await client.query("UPDATE miniapp_users SET balance = balance + $1, updated_at = $2 WHERE id = $3", [remaining, createdAt, input.userId]);
      }
      return inserted.rows[0];
    });
    return rowToPackage(result);
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

  async function createCreditHold(input) {
    const createdAt = timestamp(clock);
    return withTransaction(pool, async (client) => {
      const existing = await client.query("SELECT * FROM credit_holds WHERE idempotency_key = $1", [input.idempotencyKey]);
      if (existing.rowCount) return rowToHold(existing.rows[0]);
      const allocations = Array.isArray(input.packageAllocation) ? input.packageAllocation : [];
      let remainingToAllocate = Number(input.credits);
      const selected = allocations.length ? allocations : (await client.query(`
        SELECT id, remaining_credits FROM credit_packages
        WHERE user_id = $1 AND status = 'ACTIVE' AND (expired_at IS NULL OR expired_at > $2) AND remaining_credits > 0
        ORDER BY expired_at NULLS LAST, created_at ASC, id ASC FOR UPDATE
      `, [input.userId, createdAt])).rows.map((row) => ({ packageId: row.id, credits: Math.min(Number(row.remaining_credits), remainingToAllocate) }));
      const normalized = [];
      for (const allocation of selected) {
        const amount = Math.min(Number(allocation.credits), remainingToAllocate);
        if (amount <= 0) continue;
        const updated = await client.query(`
          UPDATE credit_packages SET remaining_credits = remaining_credits - $1, frozen_credits = frozen_credits + $1, updated_at = $2
          WHERE id = $3 AND user_id = $4 AND remaining_credits >= $1 RETURNING id
        `, [amount, createdAt, allocation.packageId, input.userId]);
        if (!updated.rowCount) throw err("Insufficient credits", 402);
        normalized.push({ packageId: allocation.packageId, credits: amount });
        remainingToAllocate -= amount;
      }
      if (remainingToAllocate > 0) throw err("Insufficient credits", 402);
      const result = await client.query(`
        INSERT INTO credit_holds (id, user_id, task_id, idempotency_key, credits, package_allocation, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
      `, [input.id || id("hold"), input.userId, input.taskId || null, input.idempotencyKey, Number(input.credits), JSON.stringify(normalized), createdAt]);
      await client.query("UPDATE miniapp_users SET balance = balance - $1, updated_at = $2 WHERE id = $3 AND balance >= $1", [Number(input.credits), createdAt, input.userId]);
      return rowToHold(result.rows[0]);
    });
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
      const now = timestamp(clock);
      for (const allocation of hold.packageAllocation) {
        const allocated = Number(allocation.credits || 0);
        const packageRelease = released ? Math.min(allocated, released) : 0;
        await client.query("UPDATE credit_packages SET frozen_credits = frozen_credits - $1, remaining_credits = remaining_credits + $1, updated_at = $2 WHERE id = $3", [allocated, now, allocation.packageId]);
        if (packageRelease) await client.query("UPDATE credit_packages SET remaining_credits = remaining_credits - $1, updated_at = $2 WHERE id = $3", [packageRelease, now, allocation.packageId]);
      }
      const user = await client.query("UPDATE miniapp_users SET balance = balance + $1, updated_at = $2 WHERE id = $3 RETURNING balance", [released, now, hold.userId]);
      if (settledCredits > 0) {
        await insertTransaction(client, {
          id: input.transactionId,
          transNo: input.transNo,
          userId: hold.userId,
          transType: "GENERATION",
          credits: -settledCredits,
          balanceAfter: Number(user.rows[0].balance),
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
        await client.query("UPDATE credit_packages SET frozen_credits = frozen_credits - $1, remaining_credits = remaining_credits + $1, updated_at = $2 WHERE id = $3", [Number(allocation.credits), now, allocation.packageId]);
      }
      await client.query("UPDATE miniapp_users SET balance = balance + $1, updated_at = $2 WHERE id = $3", [hold.credits, now, hold.userId]);
      const result = await client.query("UPDATE credit_holds SET status = 'RELEASED', settled_at = $1 WHERE id = $2 RETURNING *", [now, holdId]);
      return rowToHold(result.rows[0]);
    });
  }

  async function addCredits(userId, amount, reason) {
    const value = Number.parseInt(amount, 10);
    if (!Number.isInteger(value) || value === 0) throw err("Credit amount must be non-zero", 400);
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      const userResult = await client.query("SELECT * FROM miniapp_users WHERE id = $1 FOR UPDATE", [userId]);
      if (!userResult.rowCount) throw err("User not found", 404);
      const user = rowToUser(userResult.rows[0]);
      if (value < 0 && user.balance < Math.abs(value)) throw err("Insufficient credits to revoke", 402);
      const next = user.balance + value;
      let packageId = null;
      if (value > 0) {
        packageId = id("package");
        await client.query("INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, trans_type, metadata, created_at, updated_at) VALUES ($1, $2, $3, $3, 'SYSTEM_ADJUST', $4, $5, $5)", [packageId, userId, value, JSON.stringify({ reason: reason || "admin:adjust" }), now]);
      }
      await client.query("UPDATE miniapp_users SET balance = $1, updated_at = $2 WHERE id = $3", [next, now, userId]);
      await insertTransaction(client, { userId, transType: "SYSTEM_ADJUST", credits: value, balanceAfter: next, packageId, reason: reason || "admin:adjust", createdAt: now });
      const result = await client.query("SELECT * FROM miniapp_users WHERE id = $1", [userId]);
      return rowToUser(result.rows[0]);
    });
  }

  async function charge(userId, amount, reason) {
    const value = Math.abs(Number(amount));
    if (!Number.isInteger(value) || value <= 0) throw err("Credit amount must be positive", 400);
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      const userResult = await client.query("SELECT * FROM miniapp_users WHERE id = $1 FOR UPDATE", [userId]);
      if (!userResult.rowCount) throw err("User not found", 404);
      const balance = Number(userResult.rows[0].balance);
      if (balance < value) throw err("Insufficient credits", 402);
      const next = balance - value;
      await client.query("UPDATE miniapp_users SET balance = $1, updated_at = $2 WHERE id = $3", [next, now, userId]);
      await insertTransaction(client, { userId, transType: "GENERATION", credits: -value, balanceAfter: next, reason, createdAt: now });
      return next;
    });
  }

  async function listCreditTransactions(userId, options = new URLSearchParams()) {
    const { page, limit, offset } = pageOf(options);
    const total = await pool.query("SELECT COUNT(*)::int AS total FROM credit_transactions WHERE user_id = $1", [userId]);
    const rows = await pool.query("SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3", [userId, limit, offset]);
    return { records: rows.rows.map(rowToTransaction), pagination: pagination(page, limit, total.rows[0].total) };
  }

  async function createTask(input) {
    if (input.idempotencyKey) {
      const existing = await pool.query("SELECT * FROM generation_tasks WHERE owner_id = $1 AND idempotency_key = $2", [input.ownerId, input.idempotencyKey]);
      if (existing.rowCount) return rowToTask(existing.rows[0]);
    }
    const createdAt = input.createdAt || timestamp(clock);
    const result = await pool.query(`
      INSERT INTO generation_tasks (id, owner_id, idempotency_key, status, images, template_id, provider, provider_task_id, provider_result_url, mode, prompt, topic, reference_images, model, output_count, aspect_ratio, resolution, requested_credits, settled_credits, credit_hold_id, raw_provider_result, error_code, error_message, created_at, updated_at, started_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $24, $25, $26)
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, images = EXCLUDED.images, provider = EXCLUDED.provider, provider_task_id = EXCLUDED.provider_task_id, prompt = EXCLUDED.prompt, topic = EXCLUDED.topic, reference_images = EXCLUDED.reference_images, model = EXCLUDED.model, output_count = EXCLUDED.output_count, aspect_ratio = EXCLUDED.aspect_ratio, resolution = EXCLUDED.resolution, requested_credits = EXCLUDED.requested_credits, settled_credits = EXCLUDED.settled_credits, credit_hold_id = EXCLUDED.credit_hold_id, raw_provider_result = EXCLUDED.raw_provider_result, error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message, updated_at = EXCLUDED.updated_at, completed_at = EXCLUDED.completed_at
      RETURNING *
    `, [input.id, input.ownerId, input.idempotencyKey || null, input.status || "completed", JSON.stringify(input.images || []), input.templateId || null, input.provider || null, input.providerTaskId || null, input.providerResultUrl || null, input.mode || null, input.prompt || "", input.topic || "", JSON.stringify(input.referenceImages || []), input.model || "", positiveInt(input.outputCount, 1), input.aspectRatio || "", input.resolution || "", Number(input.requestedCredits || 0), Number(input.settledCredits || 0), input.creditHoldId || null, JSON.stringify(input.rawProviderResult || null), input.errorCode || null, input.errorMessage || null, createdAt, input.startedAt || null, input.completedAt || null]);
    return rowToTask(result.rows[0]);
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
    const result = await pool.query("INSERT INTO template_catalog_versions (id, checksum, source, record_count, metadata) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (checksum) DO UPDATE SET checksum = EXCLUDED.checksum RETURNING *", [input.id || id("catalog"), input.checksum, input.source || "unknown", Number(input.recordCount || 0), JSON.stringify(json(input.metadata))]);
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

  async function activateCatalogVersion(versionId) {
    return withTransaction(pool, async (client) => {
      const now = timestamp(clock);
      await client.query("UPDATE template_catalog_versions SET active = FALSE WHERE active = TRUE");
      const result = await client.query("UPDATE template_catalog_versions SET active = TRUE, activated_at = $1 WHERE id = $2 RETURNING *", [now, versionId]);
      return rowToCatalogVersion(result.rows[0]);
    });
  }

  async function syncTemplates(records = [], input = {}) {
    return withTransaction(pool, async (client) => {
      const versionId = input.catalogVersionId || (await client.query("SELECT id FROM template_catalog_versions WHERE active = TRUE LIMIT 1")).rows[0]?.id || null;
      for (const record of records) {
        await client.query(`
          INSERT INTO templates (id, catalog_version_id, title, subtitle, author, category, scenario_category, tags, prompt, reference_images, preview_images, source, source_id, source_url, thumbnail_url, preview_url, use_case, metrics, seed, metadata, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          ON CONFLICT (id) DO UPDATE SET catalog_version_id = EXCLUDED.catalog_version_id, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, author = EXCLUDED.author, category = EXCLUDED.category, scenario_category = EXCLUDED.scenario_category, tags = EXCLUDED.tags, prompt = EXCLUDED.prompt, reference_images = EXCLUDED.reference_images, preview_images = EXCLUDED.preview_images, source = EXCLUDED.source, source_id = EXCLUDED.source_id, source_url = EXCLUDED.source_url, thumbnail_url = EXCLUDED.thumbnail_url, preview_url = EXCLUDED.preview_url, use_case = EXCLUDED.use_case, metrics = EXCLUDED.metrics, seed = EXCLUDED.seed, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at
        `, [record.id, versionId, record.title || "", record.subtitle || "", record.author || "", record.category || "", record.scenarioCategory || record.scenario_category || "", JSON.stringify(record.tags || []), record.prompt || "", JSON.stringify(record.referenceImages || record.reference_images || []), JSON.stringify(record.previewImages || record.preview_images || []), record.source || "", record.sourceId || record.source_id || "", record.sourceUrl || record.source_url || "", record.thumbnailUrl || record.thumbnail_url || "", record.previewUrl || record.preview_url || "", record.useCase || record.use_case || "", JSON.stringify(record.metrics || null), JSON.stringify(record.seed || null), JSON.stringify(record.metadata || {}), timestamp(clock)]);
      }
      return records.length;
    });
  }

  async function listTemplates(options = new URLSearchParams()) {
    const { params, page, limit } = pageOf(options, 12);
    const values = [];
    const filters = [];
    const active = await getActiveCatalogVersion();
    if (active) { values.push(active.id); filters.push(`catalog_version_id = $${values.length}`); }
    for (const [field, value] of [["category", params.get("category")], ["scenario_category", params.get("scenario_category") || params.get("scenarioCategory")]]) {
      if (value) { values.push(value); filters.push(`${field} = $${values.length}`); }
    }
    const q = String(params.get("q") || params.get("keyword") || "").trim();
    if (q) { values.push(`%${q}%`); filters.push(`(title ILIKE $${values.length} OR subtitle ILIKE $${values.length} OR prompt ILIKE $${values.length} OR author ILIKE $${values.length})`); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await pool.query(`SELECT * FROM templates ${where}`, values);
    let records = rows.rows.map(rowToTemplate);
    if (params.get("hot") === "1" || params.get("hotOnly") === "true") records = records.filter((record) => metric(record, "likes") >= 20000 || metric(record, "saves") >= 20000);
    records = sortTemplates(records, params.get("sort") || "default");
    const start = (page - 1) * limit;
    return { records: records.slice(start, start + limit), pagination: pagination(page, limit, records.length) };
  }

  async function getTemplate(templateId) {
    const result = await pool.query("SELECT * FROM templates WHERE id = $1", [templateId]);
    return rowToTemplate(result.rows[0]);
  }

  async function createOrder(input) {
    if (input.idempotencyKey) {
      const existing = await pool.query("SELECT * FROM miniapp_orders WHERE user_id = $1 AND idempotency_key = $2", [input.userId, input.idempotencyKey]);
      if (existing.rowCount) return rowToOrder(existing.rows[0]);
    }
    const now = input.createdAt || timestamp(clock);
    const result = await pool.query(`
      INSERT INTO miniapp_orders (id, user_id, idempotency_key, product_id, channel, status, payment_status, payment_mode, payment_verified, amount_cents, currency, credits, product_snapshot, payment_params, external_payment_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10, $11, $12, $13, $14, $15, $15)
      RETURNING *
    `, [input.id || id("order"), input.userId, input.idempotencyKey || null, input.productId, input.channel || "wechat", input.status || "pending", input.paymentStatus || "created", input.paymentMode || "manual", Number(input.amountCents || 0), input.currency || "CNY", Number(input.credits || 0), JSON.stringify(input.productSnapshot || {}), JSON.stringify(input.paymentParams || null), input.externalPaymentId || null, now]);
    return rowToOrder(result.rows[0]);
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

  async function fulfillOrder(orderId, input = {}) {
    return withTransaction(pool, async (client) => {
      const found = await client.query("SELECT * FROM miniapp_orders WHERE id = $1 FOR UPDATE", [orderId]);
      if (!found.rowCount) return null;
      const order = rowToOrder(found.rows[0]);
      if (order.fulfilledAt) return { order, fulfilled: false };
      if (order.status === "canceled" || order.status === "refunded") throw err("Order cannot be fulfilled", 409);
      const now = timestamp(clock);
      const credits = positiveInt(input.credits || order.credits, 0);
      const user = await client.query("UPDATE miniapp_users SET balance = balance + $1, updated_at = $2 WHERE id = $3 RETURNING balance", [credits, now, order.userId]);
      if (!user.rowCount) throw err("User not found", 404);
      if (credits > 0) {
        await client.query("INSERT INTO credit_packages (id, user_id, initial_credits, remaining_credits, trans_type, order_no, metadata, created_at, updated_at) VALUES ($1, $2, $3, $3, 'ORDER_PAY', $4, $5, $6, $6)", [`order_${order.id}`, order.userId, credits, order.id, JSON.stringify({ orderId: order.id }), now]);
        await insertTransaction(client, { userId: order.userId, transType: "ORDER_PAY", credits, balanceAfter: Number(user.rows[0].balance), orderNo: order.id, reason: input.reason || `order:${order.id}`, createdAt: now });
      }
      await client.query("UPDATE miniapp_orders SET status = 'paid', payment_status = 'fulfilled', payment_verified = COALESCE($1, payment_verified), paid_at = COALESCE(paid_at, $2), fulfilled_at = $2, credits_granted = $3, updated_at = $2 WHERE id = $4", [input.paymentVerified == null ? null : Boolean(input.paymentVerified), input.paidAt || now, credits, order.id]);
      const updated = await client.query("SELECT * FROM miniapp_orders WHERE id = $1", [order.id]);
      return { order: rowToOrder(updated.rows[0]), fulfilled: true };
    });
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
      const user = await client.query("SELECT * FROM miniapp_users WHERE id = $1 FOR UPDATE", [order.userId]);
      if (!user.rowCount) throw err("User not found", 404);
      const remainder = Math.max(0, order.creditsGranted - order.creditsRevoked);
      const revoked = input.revokeCredits === false ? 0 : Math.min(Number(user.rows[0].balance), remainder);
      const now = timestamp(clock);
      const nextBalance = Number(user.rows[0].balance) - revoked;
      if (revoked) {
        await client.query("UPDATE miniapp_users SET balance = $1, updated_at = $2 WHERE id = $3", [nextBalance, now, order.userId]);
        await insertTransaction(client, { userId: order.userId, transType: "REFUND", credits: -revoked, balanceAfter: nextBalance, orderNo: order.id, reason: input.reason || `refund:${order.id}`, createdAt: now });
      }
      await client.query("UPDATE miniapp_orders SET status = 'refunded', payment_status = 'refunded', refunded_at = $1, credits_revoked = credits_revoked + $2, admin_note = $3, updated_at = $1 WHERE id = $4", [now, revoked, input.reason || order.adminNote || "", order.id]);
      const updated = await client.query("SELECT * FROM miniapp_orders WHERE id = $1", [order.id]);
      return { order: rowToOrder(updated.rows[0]), refunded: true, revokedCredits: revoked };
    });
  }

  async function recordPaymentFulfillment(input) {
    const createdAt = timestamp(clock);
    const result = await pool.query(`
      INSERT INTO payment_fulfillments (id, fulfillment_key, order_id, provider, event_id, event_type, provider_order_id, provider_transaction_id, status, error_message, metadata, fulfilled_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      ON CONFLICT (fulfillment_key) DO NOTHING RETURNING *
    `, [input.id || id("fulfillment"), input.fulfillmentKey, input.orderId || null, input.provider || "unknown", input.eventId || null, input.eventType || null, input.providerOrderId || null, input.providerTransactionId || null, input.status || "PENDING", input.errorMessage || null, JSON.stringify(json(input.metadata)), input.fulfilledAt || (input.status === "FULFILLED" ? createdAt : null), createdAt]);
    if (!result.rowCount) {
      const existing = await pool.query("SELECT * FROM payment_fulfillments WHERE fulfillment_key = $1", [input.fulfillmentKey]);
      return rowToPaymentFulfillment(existing.rows[0]);
    }
    return rowToPaymentFulfillment(result.rows[0]);
  }

  async function fulfillPayment(input) {
    const fulfillment = await recordPaymentFulfillment(input);
    if (fulfillment.status === "FULFILLED" && input.orderId) await fulfillOrder(input.orderId, { paymentVerified: false, paidAt: input.paidAt });
    return fulfillment;
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
    createTask, getTask, listTasks, claimTask, renewTaskLease, releaseTaskLease, reclaimExpiredTasks, updateTask,
    createAsset, createGeneratedAsset: createAsset, getAsset, getGeneratedAsset: getAsset, findOwnedAsset, findOwnedImageAsset, listAssets, listGeneratedAssets: listAssets, deleteAsset,
    createReferenceAsset, getReferenceAsset, listReferenceAssets, deleteReferenceAsset,
    createCatalogVersion, getCatalogVersion, getActiveCatalogVersion, activateCatalogVersion, syncTemplates, listTemplates, getTemplate,
    createOrder, getOrder, getOrderByIdempotencyKey, listOrders, listAllOrders, fulfillOrder, cancelOrder, refundOrder,
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
