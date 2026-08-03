const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLocalStorage } = require("../src/storage/local-storage");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ima-private-storage-"));
}

test("local asset storage stores random private keys and signs expiring downloads", async () => {
  const storage = createLocalStorage({
    root: tempRoot(),
    baseUrl: "http://local",
    signingSecret: "test-signing-secret",
  });
  const body = Buffer.from("private-image");
  const saved = await storage.put({
    key: "reference/owner-supplied-name.png",
    body,
    contentType: "image/png",
    metadata: { ownerId: "user-a" },
  });

  assert.equal(saved.sizeBytes, body.length);
  assert.deepEqual(await storage.head(saved.key), {
    key: saved.key,
    sizeBytes: body.length,
    contentType: "image/png",
    metadata: { ownerId: "user-a" },
  });
  assert.deepEqual(await storage.get(saved.key), body);
  assert.match(saved.key, /^reference\/[a-f0-9-]+\.png$/);
  assert.doesNotMatch(saved.key, /owner-supplied-name/);

  const signed = await storage.getSignedDownloadUrl(saved.key, {
    baseUrl: "http://local",
    expiresInSeconds: 30,
    now: 1000,
  });
  const parsed = new URL(signed);
  assert.equal(parsed.pathname, `/uploads/${saved.key}`);
  assert.equal(parsed.searchParams.get("expires"), "1030");
  assert.equal(await storage.verifySignedDownload(saved.key, parsed.searchParams, 1029), true);
  assert.equal(await storage.verifySignedDownload(saved.key, parsed.searchParams, 1030), false);
  assert.equal(await storage.verifySignedDownload(saved.key, new URLSearchParams(), 1000), false);
  await assert.rejects(() => storage.get("reference/unknown.png"), (error) => error.code === "ASSET_NOT_FOUND");
  await storage.delete(saved.key);
  await assert.rejects(() => storage.head(saved.key), (error) => error.code === "ASSET_NOT_FOUND");
});
