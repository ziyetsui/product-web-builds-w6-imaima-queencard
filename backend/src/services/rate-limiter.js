const crypto = require("node:crypto");

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

function resolveTime(value, fallback) {
  const current = value === undefined ? fallback() : typeof value === "function" ? value() : value;
  const timestamp = current instanceof Date ? current.getTime() : Number(current);
  if (!Number.isFinite(timestamp)) throw new TypeError("now must resolve to a finite timestamp");
  return timestamp;
}

function createRateLimiter(options = {}) {
  const now = options.now === undefined ? Date.now : options.now;
  if (typeof now !== "function") throw new TypeError("now must be a function");

  const maxEntries = options.maxEntries === undefined ? 10000 : options.maxEntries;
  assertPositiveInteger(maxEntries, "maxEntries");

  const entries = new Map();

  function bucketKey(scope, key) {
    return crypto.createHash("sha256").update(`${scope}\0${key}`).digest("hex");
  }

  function evictExpired(currentTime) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }
  }

  function evictOldest() {
    let oldestKey = null;
    let oldestResetAt = Infinity;
    for (const [key, entry] of entries) {
      if (entry.resetAt < oldestResetAt) {
        oldestKey = key;
        oldestResetAt = entry.resetAt;
      }
    }
    if (oldestKey !== null) entries.delete(oldestKey);
  }

  function consume(input = {}) {
    const scope = String(input.scope || "").trim();
    const key = String(input.key || "").trim();
    if (!scope) throw new TypeError("scope is required");
    if (!key) throw new TypeError("key is required");
    assertPositiveInteger(input.limit, "limit");
    assertPositiveInteger(input.windowMs, "windowMs");

    const currentTime = resolveTime(input.now, now);
    evictExpired(currentTime);

    const hashedKey = bucketKey(scope, key);
    let entry = entries.get(hashedKey);
    if (!entry) {
      if (entries.size >= maxEntries) evictOldest();
      entry = { count: 0, resetAt: currentTime + input.windowMs };
      entries.set(hashedKey, entry);
    }

    const allowed = entry.count < input.limit;
    if (allowed) entry.count += 1;
    return {
      allowed,
      limit: input.limit,
      remaining: Math.max(0, input.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }

  function currentTime() {
    return resolveTime(undefined, now);
  }

  return {
    consume,
    now: currentTime,
    get size() {
      return entries.size;
    },
  };
}

module.exports = {
  createRateLimiter,
};
