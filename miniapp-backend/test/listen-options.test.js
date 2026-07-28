const assert = require("node:assert/strict");
const test = require("node:test");

const { getListenOptions } = require("../src/listen-options");

test("binds local dev backend to IPv4 localhost by default", () => {
  assert.deepEqual(getListenOptions({ PORT: "8787" }), {
    port: 8787,
    host: "127.0.0.1",
  });
});

test("allows host override for deployment", () => {
  assert.deepEqual(getListenOptions({ PORT: "9000", MINIAPP_BACKEND_HOST: "0.0.0.0" }), {
    port: 9000,
    host: "0.0.0.0",
  });
});
