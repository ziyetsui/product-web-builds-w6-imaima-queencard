const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

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
  const users = new Map();
  const tasks = new Map();
  const creditTransactions = [];
  const templates = new Map();
  const orders = new Map();
  const paymentAudit = [];

  function ensureUser(identity) {
    const id = identity.sub;
    if (!users.has(id)) {
      users.set(id, {
        id,
        provider: "wechat",
        appid: identity.appid,
        openid: identity.openid,
        unionid: identity.unionid || null,
        name: "微信用户",
        balance: initialCredits,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return users.get(id);
  }

  function getUser(id) {
    return users.get(id) || null;
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
    const createdAt = order.createdAt || new Date().toISOString();
    const saved = {
      id: order.id || orderId(),
      userId: order.userId,
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
    orders.set(saved.id, saved);
    return saved;
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
    order.updatedAt = now;
    return { order, fulfilled: true };
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

  function syncTemplates(records = []) {
    records.forEach((record) => {
      templates.set(record.id, record);
    });
    return records.length;
  }

  function listTemplates(query = new URLSearchParams()) {
    const page = positiveInt(query.get("page"), 1);
    const limit = Math.min(positiveInt(query.get("limit"), 12), 100);
    const q = String(query.get("q") || query.get("keyword") || "").trim().toLowerCase();
    const category = String(query.get("category") || "").trim();
    const scenarioCategory = String(query.get("scenario_category") || query.get("scenarioCategory") || "").trim();
    const hotOnly = query.get("hot") === "1" || query.get("hotOnly") === "true";
    const sort = String(query.get("sort") || "default").trim();
    let records = Array.from(templates.values());
    if (category) records = records.filter((record) => record.category === category);
    if (scenarioCategory) records = records.filter((record) => record.scenarioCategory === scenarioCategory);
    if (hotOnly) records = records.filter(isHotTemplate);
    if (q) {
      records = records.filter((record) => [
        record.title,
        record.subtitle,
        record.prompt,
        record.scenarioCategory,
        record.author,
      ].filter(Boolean).join("\n").toLowerCase().includes(q));
    }
    records = sortTemplates(records, sort);
    const total = records.length;
    const start = (page - 1) * limit;
    return {
      records: records.slice(start, start + limit),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  function getTemplate(id) {
    return templates.get(id) || null;
  }

  return {
    ensureUser,
    getUser,
    getUserByIdentity,
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
    cancelOrder,
    refundOrder,
    recordPaymentEvent,
    listPaymentAudit,
    findOwnedImageAsset,
    createTask,
    getTask,
    listTasks,
    syncTemplates,
    listTemplates,
    getTemplate,
    close() {},
  };
}

function createSqliteStore(options = {}) {
  const initialCredits = Number(options.initialCredits || 10);
  const dbPath = options.dbPath || process.env.MINIAPP_DB_PATH || path.resolve(__dirname, "../data/miniapp.sqlite");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  migrate(db);

  function ensureUser(identity) {
    const id = identity.sub;
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
    const createdAt = order.createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO orders (
        id, user_id, product_id, channel, status, payment_status, payment_mode,
        amount_cents, currency, credits, product_json, payment_params_json,
        external_payment_id, credits_granted, credits_revoked, created_at,
        updated_at, paid_at, fulfilled_at, refunded_at, canceled_at, admin_note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      order.userId,
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
    return getOrder(id);
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
            fulfilled_at = ?, credits_granted = ?, updated_at = ?
        WHERE id = ?
      `).run("paid", "fulfilled", input.paidAt || now, now, credits, now, order.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { order: getOrder(id), fulfilled: true };
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
          id, title, subtitle, category, scenario_category, source, source_id,
          source_url, thumbnail_url, preview_url, reference_images_json,
          prompt, use_case, author, metrics_json, seed_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          subtitle = excluded.subtitle,
          category = excluded.category,
          scenario_category = excluded.scenario_category,
          source = excluded.source,
          source_id = excluded.source_id,
          source_url = excluded.source_url,
          thumbnail_url = excluded.thumbnail_url,
          preview_url = excluded.preview_url,
          reference_images_json = excluded.reference_images_json,
          prompt = excluded.prompt,
          use_case = excluded.use_case,
          author = excluded.author,
          metrics_json = excluded.metrics_json,
          seed_json = excluded.seed_json,
          updated_at = excluded.updated_at
      `);
      records.forEach((record) => {
        statement.run(
          record.id,
          record.title || "",
          record.subtitle || "",
          record.category || "",
          record.scenarioCategory || record.scenario_category || "",
          record.source || "",
          record.sourceId || record.source_id || "",
          record.sourceUrl || record.source_url || "",
          record.thumbnailUrl || record.thumbnail_url || "",
          record.previewUrl || record.preview_url || "",
          stringify(record.referenceImages || record.reference_images || []),
          record.prompt || "",
          record.useCase || record.use_case || "",
          record.author || "",
          stringify(record.metrics || null),
          stringify(record.seed || null),
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

  function listTemplates(query = new URLSearchParams()) {
    const page = positiveInt(query.get("page"), 1);
    const limit = Math.min(positiveInt(query.get("limit"), 12), 100);
    const filters = [];
    const values = [];
    const sort = String(query.get("sort") || "default").trim();
    const hotOnly = query.get("hot") === "1" || query.get("hotOnly") === "true";

    const category = String(query.get("category") || "").trim();
    if (category) {
      filters.push("category = ?");
      values.push(category);
    }

    const scenarioCategory = String(query.get("scenario_category") || query.get("scenarioCategory") || "").trim();
    if (scenarioCategory) {
      filters.push("scenario_category = ?");
      values.push(scenarioCategory);
    }

    if (hotOnly) {
      filters.push(`(
        CAST(json_extract(metrics_json, '$.likes') AS INTEGER) >= 20000 OR
        CAST(json_extract(metrics_json, '$.saves') AS INTEGER) >= 20000
      )`);
    }

    const q = String(query.get("q") || query.get("keyword") || "").trim();
    if (q) {
      filters.push(`(
        title LIKE ? OR subtitle LIKE ? OR prompt LIKE ? OR
        scenario_category LIKE ? OR author LIKE ?
      )`);
      const like = `%${q}%`;
      values.push(like, like, like, like, like);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS total FROM templates ${where}`).get(...values).total;
    const rows = db.prepare(`
      SELECT * FROM templates
      ${where}
      ORDER BY id ASC
    `).all(...values);
    const records = sortTemplates(rows.map(rowToTemplate), sort);
    const start = (page - 1) * limit;

    return {
      records: records.slice(start, start + limit),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  function getTemplate(id) {
    const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
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
    cancelOrder,
    refundOrder,
    recordPaymentEvent,
    listPaymentAudit,
    findOwnedImageAsset,
    createTask,
    getTask,
    listTasks,
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
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      appid TEXT NOT NULL,
      openid TEXT NOT NULL,
      unionid TEXT,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL,
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
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      category TEXT,
      scenario_category TEXT,
      source TEXT,
      source_id TEXT,
      source_url TEXT,
      thumbnail_url TEXT,
      preview_url TEXT,
      reference_images_json TEXT NOT NULL,
      prompt TEXT,
      use_case TEXT,
      author TEXT,
      metrics_json TEXT,
      seed_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
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
  ensureColumn(db, "generation_tasks", "prompt", "TEXT");
  ensureColumn(db, "generation_tasks", "topic", "TEXT");
  ensureColumn(db, "generation_tasks", "reference_images_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "generation_tasks", "model", "TEXT");
  ensureColumn(db, "generation_tasks", "output_count", "INTEGER");
  ensureColumn(db, "generation_tasks", "aspect_ratio", "TEXT");
  ensureColumn(db, "generation_tasks", "resolution", "TEXT");
  ensureColumn(db, "orders", "payment_mode", "TEXT");
  ensureColumn(db, "orders", "payment_params_json", "TEXT");
  ensureColumn(db, "orders", "external_payment_id", "TEXT");
  ensureColumn(db, "orders", "credits_granted", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "credits_revoked", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "orders", "paid_at", "TEXT");
  ensureColumn(db, "orders", "fulfilled_at", "TEXT");
  ensureColumn(db, "orders", "refunded_at", "TEXT");
  ensureColumn(db, "orders", "canceled_at", "TEXT");
  ensureColumn(db, "orders", "admin_note", "TEXT");
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

function rowToTemplate(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    category: row.category,
    scenarioCategory: row.scenario_category,
    source: row.source,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    thumbnailUrl: row.thumbnail_url,
    previewUrl: row.preview_url,
    referenceImages: parseJson(row.reference_images_json, []),
    prompt: row.prompt,
    useCase: row.use_case,
    author: row.author,
    metrics: parseJson(row.metrics_json, null),
    seed: parseJson(row.seed_json, null),
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createMemoryStore,
  createSqliteStore,
};
