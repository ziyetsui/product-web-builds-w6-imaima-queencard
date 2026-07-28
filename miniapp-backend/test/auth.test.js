const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createMiniappToken,
  verifyMiniappToken,
} = require("../src/auth");

test("signs and verifies standalone WeChat miniapp token", () => {
  const token = createMiniappToken({
    appid: "wx-app",
    openid: "openid-1",
    secret: "test-secret",
    now: new Date("2026-07-28T00:00:00.000Z"),
  });

  const payload = verifyMiniappToken(token, {
    secret: "test-secret",
    now: new Date("2026-07-28T00:01:00.000Z"),
  });

  assert.equal(payload.sub, "wechat:wx-app:openid-1");
  assert.equal(payload.appid, "wx-app");
  assert.equal(payload.openid, "openid-1");
});

test("rejects expired standalone WeChat miniapp token", () => {
  const token = createMiniappToken({
    appid: "wx-app",
    openid: "openid-1",
    secret: "test-secret",
    now: new Date("2026-07-28T00:00:00.000Z"),
    ttlSeconds: 60,
  });

  assert.throws(
    () => verifyMiniappToken(token, {
      secret: "test-secret",
      now: new Date("2026-07-28T00:01:01.000Z"),
    }),
    /expired/,
  );
});
