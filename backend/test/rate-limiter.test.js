const assert = require("node:assert/strict");
const test = require("node:test");

const { createRateLimiter } = require("../src/services/rate-limiter");

test("allows a bounded number of calls and resets after the window", () => {
  let currentTime = 0;
  const limiter = createRateLimiter({ now: () => currentTime });

  assert.deepEqual(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 60000,
    retryAfter: 60,
  });
  assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, true);
  assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, false);

  currentTime += 60001;
  assert.equal(limiter.consume({ scope: "login", key: "ip:one", limit: 2, windowMs: 60000 }).allowed, true);
});

test("keeps scopes and keys in separate buckets", () => {
  const limiter = createRateLimiter({ now: () => 0 });

  assert.equal(limiter.consume({ scope: "login", key: "same", limit: 1, windowMs: 60000 }).allowed, true);
  assert.equal(limiter.consume({ scope: "upload", key: "same", limit: 1, windowMs: 60000 }).allowed, true);
  assert.equal(limiter.consume({ scope: "login", key: "other", limit: 1, windowMs: 60000 }).allowed, true);
});

test("rejects invalid limiter limits with typed errors", () => {
  const limiter = createRateLimiter({ now: () => 0 });

  assert.throws(
    () => limiter.consume({ scope: "login", key: "ip:one", limit: 0, windowMs: 60000 }),
    TypeError,
  );
  assert.throws(
    () => limiter.consume({ scope: "login", key: "ip:one", limit: 1, windowMs: 0 }),
    TypeError,
  );
});

test("removes expired buckets during normal consumption", () => {
  let currentTime = 0;
  const limiter = createRateLimiter({ now: () => currentTime });

  limiter.consume({ scope: "login", key: "expired", limit: 1, windowMs: 100 });
  currentTime = 101;
  limiter.consume({ scope: "login", key: "fresh", limit: 1, windowMs: 100 });

  assert.equal(limiter.size, 1);
});

test("evicts the bucket with the oldest reset time at the entry bound", () => {
  let currentTime = 0;
  const limiter = createRateLimiter({ now: () => currentTime, maxEntries: 2 });

  limiter.consume({ scope: "login", key: "oldest", limit: 1, windowMs: 100 });
  currentTime = 1;
  limiter.consume({ scope: "login", key: "middle", limit: 1, windowMs: 100 });
  currentTime = 2;
  limiter.consume({ scope: "login", key: "newest", limit: 1, windowMs: 100 });

  assert.equal(limiter.size, 2);
  assert.equal(limiter.consume({ scope: "login", key: "oldest", limit: 1, windowMs: 100 }).allowed, true);
});
