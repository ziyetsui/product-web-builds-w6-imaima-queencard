const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { createSessionToken, hashSessionToken } = require("../src/auth");
const { createMemoryStore } = require("../src/store");

test("creates opaque cryptographically random session tokens", () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.notEqual(first, second);
  assert.equal(first.includes("."), false);
  assert.equal(hashSessionToken(first).length, 64);
  assert.notEqual(hashSessionToken(first), first);
});

test("hashing is deterministic for adapter persistence", () => {
  assert.equal(hashSessionToken("session-token"), hashSessionToken("session-token"));
});

async function json(response) {
  return response.json();
}

test("HTTP auth uses a revocable session and reports stable terminal codes", async () => {
  const store = createMemoryStore({ environment: "test" });
  const app = createApp({
    store,
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-http-test",
    },
  });
  try {
    const login = await json(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
      method: "POST",
      body: JSON.stringify({ code: "http-code" }),
    })));
    const authorization = `Bearer ${login.data.token}`;
    const me = await app.fetch(new Request("http://local/api/miniapp/auth/me", {
      headers: { authorization },
    }));
    assert.equal(me.status, 200);

    const logout = await app.fetch(new Request("http://local/api/miniapp/auth/logout", {
      method: "POST",
      headers: { authorization },
    }));
    assert.equal(logout.status, 200);

    const revoked = await app.fetch(new Request("http://local/api/miniapp/auth/me", {
      headers: { authorization },
    }));
    const revokedBody = await json(revoked);
    assert.equal(revoked.status, 401);
    assert.equal(revokedBody.code, "SESSION_EXPIRED");
    assert.equal(JSON.stringify(revokedBody).includes(login.data.token), false);
  } finally {
    await app.close();
  }
});

test("HTTP auth rejects disabled users with ACCOUNT_DISABLED", async () => {
  const store = createMemoryStore({ environment: "test" });
  const app = createApp({
    store,
    env: {
      NODE_ENV: "test",
      MINIAPP_DEV_LOGIN: "1",
      WECHAT_MINIAPP_APP_ID: "wx-disabled-test",
    },
  });
  try {
    const login = await json(await app.fetch(new Request("http://local/api/miniapp/auth/wechat-login", {
      method: "POST",
      body: JSON.stringify({ code: "disabled-code" }),
    })));
    store.getUser(login.data.user.id).status = "disabled";
    const response = await app.fetch(new Request("http://local/api/miniapp/auth/me", {
      headers: { authorization: `Bearer ${login.data.token}` },
    }));
    const body = await json(response);
    assert.equal(response.status, 401);
    assert.equal(body.code, "ACCOUNT_DISABLED");
  } finally {
    await app.close();
  }
});

test("HTTP auth returns AUTH_REQUIRED without a bearer session", async () => {
  const app = createApp({
    store: createMemoryStore({ environment: "test" }),
    env: { NODE_ENV: "test", WECHAT_MINIAPP_APP_ID: "wx-required-test" },
  });
  try {
    const response = await app.fetch(new Request("http://local/api/miniapp/auth/me"));
    const body = await json(response);
    assert.equal(response.status, 401);
    assert.equal(body.code, "AUTH_REQUIRED");
  } finally {
    await app.close();
  }
});
