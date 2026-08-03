const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const sharp = require("sharp");

const { createMemoryStore } = require("../src/store");
const { createLocalStorage } = require("../src/storage/local-storage");
const { createAssetService } = require("../src/services/asset-service");

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ima-asset-service-"));
}

async function imageBytes(options = {}) {
  return sharp({
    create: {
      width: options.width || 2,
      height: options.height || 2,
      channels: 4,
      background: { r: 240, g: 220, b: 40, alpha: 1 },
    },
  }).png().toBuffer();
}

function setup(options = {}) {
  const store = createMemoryStore({ initialCredits: 10 });
  const storage = createLocalStorage({
    root: tempRoot(),
    baseUrl: "http://local",
    signingSecret: "test-signing-secret",
  });
  const service = createAssetService({
    store,
    storage,
    maxBytes: options.maxBytes || 1024 * 1024,
    maxWidth: options.maxWidth || 4096,
    maxHeight: options.maxHeight || 4096,
    maxPixels: options.maxPixels || 4096 * 4096,
  });
  const owner = store.ensureUser({ appid: "wx-test", openid: "owner" });
  const other = store.ensureUser({ appid: "wx-test", openid: "other" });
  return { store, storage, service, owner, other };
}

test("asset service validates sharp metadata, persists owner metadata, and returns asset IDs", async () => {
  const { service, owner, other } = setup();
  const bytes = await imageBytes();
  const asset = await service.createReferenceAsset({
    userId: owner.id,
    body: bytes,
    contentType: "image/png",
    filename: "client-secret-name.png",
  });

  assert.match(asset.id, /^asset_/);
  assert.equal(asset.userId, owner.id);
  assert.equal(asset.mimeType, "image/png");
  assert.equal(asset.width, 2);
  assert.equal(asset.height, 2);
  assert.doesNotMatch(asset.objectKey, /client-secret-name/);
  assert.equal(asset.assetId, asset.id);
  assert.equal(Object.prototype.hasOwnProperty.call(asset, "url"), false);

  const signedUrl = await service.getDownloadUrl(owner.id, asset.id, { baseUrl: "http://local" });
  assert.match(signedUrl, /expires=/);
  await assert.rejects(
    () => service.getDownloadUrl(other.id, asset.id, { baseUrl: "http://local" }),
    (error) => error.status === 404,
  );
});

test("asset service rejects oversize, mismatched MIME, unsupported, corrupt, and oversized images", async () => {
  const context = setup({ maxBytes: 1024 * 1024, maxWidth: 4, maxHeight: 4, maxPixels: 16 });
  const valid = await imageBytes();
  const sizeContext = setup({ maxBytes: 8 });
  await assert.rejects(() => sizeContext.service.createReferenceAsset({
    userId: context.owner.id,
    body: Buffer.alloc(9),
    contentType: "image/png",
    filename: "too-large.png",
  }), (error) => error.code === "ASSET_TOO_LARGE");

  await assert.rejects(() => context.service.createReferenceAsset({
    userId: context.owner.id,
    body: valid,
    contentType: "image/jpeg",
    filename: "wrong-type.jpg",
  }), (error) => error.code === "ASSET_MIME_MISMATCH");

  await assert.rejects(() => context.service.createReferenceAsset({
    userId: context.owner.id,
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'),
    contentType: "image/svg+xml",
    filename: "unsupported.svg",
  }), (error) => error.code === "ASSET_FORMAT_UNSUPPORTED");

  await assert.rejects(() => context.service.createReferenceAsset({
    userId: context.owner.id,
    body: Buffer.from("not-an-image"),
    contentType: "image/png",
    filename: "corrupt.png",
  }), (error) => error.code === "ASSET_INVALID_IMAGE");

  const wideContext = setup({ maxBytes: 1024 * 1024, maxWidth: 4, maxHeight: 4, maxPixels: 16 });
  const wide = await imageBytes({ width: 5, height: 2 });
  await assert.rejects(() => wideContext.service.createReferenceAsset({
    userId: wideContext.owner.id,
    body: wide,
    contentType: "image/png",
    filename: "too-wide.png",
  }), (error) => error.code === "ASSET_DIMENSIONS_TOO_LARGE");
});
