const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Dockerfile documents its backend build context from the repository root", () => {
  const backendRoot = path.resolve(__dirname, "..");
  const repositoryRoot = path.resolve(backendRoot, "..");
  const dockerfile = fs.readFileSync(path.join(backendRoot, "Dockerfile"), "utf8");
  const deploymentGuide = fs.readFileSync(path.join(backendRoot, "docs/zeabur-deploy.md"), "utf8");

  assert.match(dockerfile, /docker build -t ima-miniapp-backend backend/);
  assert.match(deploymentGuide, /service root[^\n]*`backend`/i);
  assert.doesNotMatch(deploymentGuide, /detect the root `Dockerfile`/i);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "Dockerfile")), false);

  for (const source of ["package.json", "package-lock.json", "src", "public", "template-data", "migrations"]) {
    assert.equal(fs.existsSync(path.join(backendRoot, source)), true, `${source} must exist in the backend build context`);
  }

  assert.match(dockerfile, /COPY migrations \.\/migrations/);
});
