const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("release gate registers legal pages and account links", () => {
  const app = JSON.parse(read("app.json"));
  assert.ok(app.pages.includes("pages/legal/privacy"));
  assert.ok(app.pages.includes("pages/legal/terms"));
  assert.match(read("pages/account/index.wxml"), /bindtap="openPrivacy"/);
  assert.match(read("pages/account/index.wxml"), /bindtap="openTerms"/);
  assert.match(read("pages/account/index.js"), /openPrivacy/);
  assert.match(read("pages/account/index.js"), /openTerms/);
});

test("release gate pages explain data handling and payment rules", () => {
  assert.match(read("pages/legal/privacy.wxml"), /隐私政策/);
  assert.match(read("pages/legal/privacy.wxml"), /微信登录标识/);
  assert.match(read("pages/legal/terms.wxml"), /用户协议/);
  assert.match(read("pages/legal/terms.wxml"), /积分/);
  assert.match(read("pages/legal/terms.wxml"), /退款/);
});
