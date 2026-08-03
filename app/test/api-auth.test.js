const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const apiPath = path.join(appRoot, "services/api.js");
const authPath = path.join(appRoot, "services/auth.js");
const sessionPath = path.join(appRoot, "services/session.js");

function unloadServices() {
  for (const modulePath of [apiPath, authPath, sessionPath]) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function createHarness(options = {}) {
  const storage = new Map([
    ["ima_queencard_mini_token", "stale-token"],
    ["ima_queencard_mini_user", { id: "stale-user" }],
  ]);
  const events = [];
  const counts = {
    login: 0,
    loginRequest: 0,
    protectedRequest: 0,
    protectedUpload: 0,
    redirect: 0,
  };

  function authResponse() {
    return {
      statusCode: 200,
      data: {
        success: true,
        data: { token: "fresh-token", user: { id: "wechat:wx-app:openid" } },
      },
    };
  }

  const wx = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
      events.push(`set:${key}`);
    },
    removeStorageSync(key) {
      storage.delete(key);
      events.push(`remove:${key}`);
    },
    login(callbacks) {
      counts.login += 1;
      if (options.loginFails) {
        callbacks.fail({ errMsg: "sensitive wx.login failure" });
        return;
      }
      callbacks.success({ code: "wx-login-code" });
    },
    request(requestOptions) {
      if (requestOptions.url.endsWith("/auth/wechat-login")) {
        counts.loginRequest += 1;
        if (options.loginRequestFails) {
          requestOptions.success({
            statusCode: 401,
            data: { success: false, code: "AUTH_REQUIRED", error: "raw login 401" },
          });
          return;
        }
        requestOptions.success(authResponse());
        return;
      }
      counts.protectedRequest += 1;
      requestOptions.success({
        statusCode: 401,
        data: { success: false, code: "SESSION_EXPIRED", error: "raw 401 response" },
      });
    },
    uploadFile(uploadOptions) {
      counts.protectedUpload += 1;
      uploadOptions.success({
        statusCode: 401,
        data: JSON.stringify({ success: false, code: "SESSION_EXPIRED", error: "raw 401 upload" }),
      });
    },
  };
  const app = {
    handleAuthRequired() {
      counts.redirect += 1;
      events.push("redirect:/pages/account/index?auth=required");
    },
  };

  unloadServices();
  global.wx = wx;
  global.getApp = () => app;
  const api = require(apiPath);

  return {
    api,
    counts,
    events,
    storage,
    cleanup() {
      unloadServices();
      delete global.wx;
      delete global.getApp;
    },
  };
}

function invokeProtected(api, transport) {
  return transport === "request"
    ? api.getMe()
    : api.uploadReferenceImage("/tmp/reference.png");
}

function assertGenericTerminalError(error) {
  assert.equal(error.authRequired, true);
  assert.equal(error.statusCode, 401);
  assert.match(error.message, /登录状态已失效/);
  assert.doesNotMatch(error.message, /401|raw|sensitive|wx\.login/i);
  return true;
}

for (const transport of ["request", "upload"]) {
  test(`${transport} performs one login and one retry before a terminal second 401`, { concurrency: false }, async () => {
    const harness = createHarness();
    try {
      await assert.rejects(invokeProtected(harness.api, transport), assertGenericTerminalError);

      assert.equal(harness.counts.login, 1);
      assert.equal(harness.counts.loginRequest, 1);
      assert.equal(harness.counts.protectedRequest, transport === "request" ? 2 : 0);
      assert.equal(harness.counts.protectedUpload, transport === "upload" ? 2 : 0);
      assert.equal(harness.counts.redirect, 1);
      assert.equal(harness.storage.has("ima_queencard_mini_token"), false);
      assert.equal(harness.storage.has("ima_queencard_mini_user"), false);
      assert.equal(harness.events.filter((event) => event.startsWith("redirect:")).length, 1);
    } finally {
      harness.cleanup();
    }
  });

  for (const loginFailure of ["wx", "request"]) {
    test(`${transport} makes ${loginFailure} login failure terminal without another protected attempt`, { concurrency: false }, async () => {
      const harness = createHarness({
        loginFails: loginFailure === "wx",
        loginRequestFails: loginFailure === "request",
      });
      try {
        await assert.rejects(invokeProtected(harness.api, transport), assertGenericTerminalError);

        assert.equal(harness.counts.login, 1);
        assert.equal(harness.counts.loginRequest, loginFailure === "request" ? 1 : 0);
        assert.equal(harness.counts.protectedRequest, transport === "request" ? 1 : 0);
        assert.equal(harness.counts.protectedUpload, transport === "upload" ? 1 : 0);
        assert.equal(harness.counts.redirect, 1);
        assert.equal(harness.storage.has("ima_queencard_mini_token"), false);
        assert.equal(harness.storage.has("ima_queencard_mini_user"), false);
      } finally {
        harness.cleanup();
      }
    });
  }
}
