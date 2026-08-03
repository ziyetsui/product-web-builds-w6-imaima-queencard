const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { assetStorageError } = require("./storage");

function unixNow(value) {
  if (value !== undefined) return Number(value);
  return Math.floor(Date.now() / 1000);
}

function safeKey(value) {
  const key = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw assetStorageError("Invalid asset object key", "ASSET_KEY_INVALID", 400);
  }
  return key;
}

function extensionFor(key, contentType) {
  const extension = path.extname(String(key || "")).toLowerCase();
  if (extension) return extension;
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  return ".png";
}

function randomKey(input) {
  const requested = safeKey(input.key || "asset");
  const directory = path.posix.dirname(requested);
  const prefix = directory === "." ? "assets" : directory;
  return `${prefix}/${crypto.randomUUID()}${extensionFor(requested, input.contentType)}`;
}

function signatureFor(secret, key, expires) {
  return crypto.createHmac("sha256", secret).update(`${key}:${expires}`).digest("base64url");
}

function encodedPath(key) {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function createLocalStorage(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, "../../data/uploads"));
  const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
  const signingSecret = String(options.signingSecret || process.env.MINIAPP_ASSET_SIGNING_SECRET || "local-development-only-secret");

  function filePath(key) {
    const normalized = safeKey(key);
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw assetStorageError("Asset object key escapes storage root", "ASSET_KEY_INVALID", 400);
    }
    return target;
  }

  async function put(input = {}) {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body || "");
    const key = randomKey(input);
    const target = filePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, { flag: "wx" });
    await fs.writeFile(`${target}.metadata.json`, JSON.stringify({
      contentType: input.contentType || "application/octet-stream",
      metadata: input.metadata || {},
    }), { flag: "wx" });
    return {
      key,
      sizeBytes: body.length,
      contentType: input.contentType || "application/octet-stream",
      metadata: input.metadata || {},
    };
  }

  async function head(key) {
    const normalized = safeKey(key);
    try {
      const stat = await fs.stat(filePath(normalized));
      const metadataPath = `${filePath(normalized)}.metadata.json`;
      let metadata = {};
      let contentType = "application/octet-stream";
      try {
        const parsed = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        metadata = parsed.metadata || {};
        contentType = parsed.contentType || contentType;
      } catch {
        // Metadata is optional for files created by older local development runs.
      }
      return { key: normalized, sizeBytes: stat.size, contentType, metadata };
    } catch (error) {
      if (error.code === "ENOENT") throw assetStorageError("Asset object not found", "ASSET_NOT_FOUND", 404);
      throw error;
    }
  }

  async function get(key) {
    try {
      return await fs.readFile(filePath(key));
    } catch (error) {
      if (error.code === "ENOENT") throw assetStorageError("Asset object not found", "ASSET_NOT_FOUND", 404);
      throw error;
    }
  }

  async function getSignedDownloadUrl(key, input = {}) {
    const normalized = safeKey(key);
    const expires = unixNow(input.now) + Math.max(1, Number(input.expiresInSeconds || 300));
    const signature = signatureFor(signingSecret, normalized, expires);
    const origin = String(input.baseUrl || baseUrl).replace(/\/$/, "");
    return `${origin}/uploads/${encodedPath(normalized)}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
  }

  async function verifySignedDownload(key, params, now) {
    const normalized = safeKey(key);
    const expires = Number(params?.get ? params.get("expires") : params?.expires);
    const signature = String(params?.get ? params.get("signature") : params?.signature || "");
    if (!Number.isSafeInteger(expires) || expires <= unixNow(now)) return false;
    const expected = signatureFor(signingSecret, normalized, expires);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  async function remove(key) {
    const target = filePath(key);
    await fs.rm(target, { force: true });
    await fs.rm(`${target}.metadata.json`, { force: true });
  }

  return {
    driver: "local",
    root,
    put,
    head,
    get,
    getSignedDownloadUrl,
    verifySignedDownload,
    delete: remove,
  };
}

module.exports = {
  createLocalStorage,
  safeKey,
};
