const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createMemoryStore(options = {}) {
  const initialCredits = Number(options.initialCredits || 10);
  const users = new Map();
  const tasks = new Map();
  const creditTransactions = [];
  const templates = new Map();

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
      });
    }
    return users.get(id);
  }

  function getUser(id) {
    return users.get(id) || null;
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
    let records = Array.from(templates.values());
    if (category) records = records.filter((record) => record.category === category);
    if (scenarioCategory) records = records.filter((record) => record.scenarioCategory === scenarioCategory);
    if (q) {
      records = records.filter((record) => [
        record.title,
        record.subtitle,
        record.prompt,
        record.scenarioCategory,
        record.author,
      ].filter(Boolean).join("\n").toLowerCase().includes(q));
    }
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
    charge,
    listCreditTransactions,
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
    const offset = (page - 1) * limit;
    const filters = [];
    const values = [];

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
      ORDER BY updated_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);

    return {
      records: rows.map(rowToTemplate),
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

  return {
    ensureUser,
    getUser,
    charge,
    listCreditTransactions,
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
  `);
  ensureColumn(db, "generation_tasks", "prompt", "TEXT");
  ensureColumn(db, "generation_tasks", "topic", "TEXT");
  ensureColumn(db, "generation_tasks", "reference_images_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "generation_tasks", "model", "TEXT");
  ensureColumn(db, "generation_tasks", "output_count", "INTEGER");
  ensureColumn(db, "generation_tasks", "aspect_ratio", "TEXT");
  ensureColumn(db, "generation_tasks", "resolution", "TEXT");
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
