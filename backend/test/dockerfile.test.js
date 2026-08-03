const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Dockerfile documents its backend build context from the repository root", () => {
  const dockerfile = fs.readFileSync(path.resolve(__dirname, "../Dockerfile"), "utf8");

  assert.match(dockerfile, /docker build -t ima-miniapp-backend backend/);
});
