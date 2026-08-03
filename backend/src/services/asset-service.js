const crypto = require("node:crypto");
const sharp = require("sharp");

const { assertAssetStorage } = require("../storage/storage");

const ALLOWED_FORMATS = new Map([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["webp", "image/webp"],
]);

function assetError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function dataUri(value) {
  const match = String(value || "").match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return { contentType: match[1].toLowerCase(), body: Buffer.from(match[2], "base64") };
}

function normalizeAssetIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function createAssetService(options = {}) {
  const store = options.store;
  const storage = assertAssetStorage(options.storage);
  const fetchImpl = options.fetch || fetch;
  const maxBytes = Number(options.maxBytes || 10 * 1024 * 1024);
  const maxWidth = Number(options.maxWidth || 8192);
  const maxHeight = Number(options.maxHeight || 8192);
  const maxPixels = Number(options.maxPixels || 40 * 1000 * 1000);
  const environment = String(options.environment || process.env.NODE_ENV || "development").toLowerCase();

  async function validateImage(body, declaredType) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
    if (bytes.length > maxBytes) throw assetError("Image exceeds upload size limit", "ASSET_TOO_LARGE", 413);
    let metadata;
    try {
      metadata = await sharp(bytes).metadata();
    } catch {
      throw assetError("Uploaded file is not a valid image", "ASSET_INVALID_IMAGE", 400);
    }
    const actualType = ALLOWED_FORMATS.get(String(metadata.format || "").toLowerCase());
    if (!actualType) throw assetError("Image format is not supported", "ASSET_FORMAT_UNSUPPORTED", 415);
    if (declaredType && String(declaredType).toLowerCase() !== actualType) {
      throw assetError("Image MIME type does not match its bytes", "ASSET_MIME_MISMATCH", 400);
    }
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (!width || !height || width > maxWidth || height > maxHeight || width * height > maxPixels) {
      throw assetError("Image dimensions exceed the upload limit", "ASSET_DIMENSIONS_TOO_LARGE", 413);
    }
    return { bytes, metadata, mimeType: actualType, width, height };
  }

  async function createReferenceAsset(input = {}) {
    const validated = await validateImage(input.body, input.contentType);
    const saved = await storage.put({
      key: `reference/${input.filename || validated.mimeType}`,
      body: validated.bytes,
      contentType: validated.mimeType,
      metadata: { ownerId: String(input.userId), kind: "reference" },
    });
    try {
      const asset = await store.createReferenceAsset({
        id: `asset_${crypto.randomUUID()}`,
        userId: input.userId,
        objectKey: saved.key,
        mimeType: validated.mimeType,
        width: validated.width,
        height: validated.height,
        sizeBytes: validated.bytes.length,
        metadata: { originalName: String(input.filename || "").slice(0, 120), kind: "reference" },
      });
      return { ...asset, assetId: asset.id };
    } catch (error) {
      await storage.delete(saved.key).catch(() => {});
      throw error;
    }
  }

  async function getReferenceAsset(userId, assetId) {
    const asset = await store.getReferenceAsset(assetId);
    if (!asset || asset.userId !== userId) throw assetError("Asset not found", "ASSET_NOT_FOUND", 404);
    return asset;
  }

  async function getDownloadUrl(userId, assetId, input = {}) {
    const asset = await getReferenceAsset(userId, assetId);
    return storage.getSignedDownloadUrl(asset.objectKey, {
      baseUrl: input.baseUrl,
      expiresInSeconds: Math.min(Number(input.expiresInSeconds || 300), 900),
    });
  }

  async function resolveReferenceUrls(userId, assetIds, input = {}) {
    const ids = normalizeAssetIds(assetIds);
    const urls = [];
    for (const assetId of ids) urls.push(await getDownloadUrl(userId, assetId, input));
    return urls;
  }

  async function bytesFromImage(image) {
    const uri = dataUri(image);
    if (uri) return uri;
    if (!/^https?:\/\//i.test(String(image || ""))) throw assetError("Provider output is not an image URL", "ASSET_OUTPUT_INVALID", 502);
    if (environment !== "production" && environment !== "prod") {
      throw assetError("Development provider output is retained by reference", "ASSET_OUTPUT_REFERENCE_ONLY", 502);
    }
    const response = await fetchImpl(image);
    if (!response.ok) throw assetError(`Provider output download failed: ${response.status}`, "ASSET_OUTPUT_DOWNLOAD_FAILED", 502);
    return { contentType: response.headers.get("content-type") || "", body: Buffer.from(await response.arrayBuffer()) };
  }

  async function persistGeneratedOutputs(input = {}) {
    const images = Array.isArray(input.images) ? input.images : [];
    const records = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      try {
        const source = await bytesFromImage(typeof image === "string" ? image : image?.url);
        const validated = await validateImage(source.body, source.contentType || undefined);
        const saved = await storage.put({
          key: `generated/${input.taskId || "task"}/${index}.png`,
          body: validated.bytes,
          contentType: validated.mimeType,
          metadata: { ownerId: String(input.userId), taskId: String(input.taskId), kind: "generated" },
        });
        records.push(await store.createGeneratedAsset({
          id: `asset_${crypto.randomUUID()}`,
          taskId: input.taskId,
          userId: input.userId,
          outputIndex: index,
          objectKey: saved.key,
          providerUrl: typeof image === "string" && /^https?:\/\//i.test(image) ? image : "",
          mimeType: validated.mimeType,
          width: validated.width,
          height: validated.height,
          sizeBytes: validated.bytes.length,
          metadata: { kind: "generated" },
        }));
      } catch (error) {
        if (environment === "production" || environment === "prod") throw error;
        // Preview/test providers may return an unreachable catalog URL. Keep the
        // output durable and attributable without exposing it as a public asset.
        records.push(await store.createGeneratedAsset({
          id: `asset_${crypto.randomUUID()}`,
          taskId: input.taskId,
          userId: input.userId,
          outputIndex: index,
          objectKey: `provider/${crypto.randomUUID()}`,
          providerUrl: typeof image === "string" ? image : image?.url || "",
          mimeType: "image/png",
          metadata: { kind: "generated", persistence: "provider-reference" },
        }));
      }
    }
    return records;
  }

  async function getGeneratedDownloadUrl(userId, assetId, input = {}) {
    const asset = await store.findOwnedAsset(userId, assetId);
    if (!asset) throw assetError("Asset not found", "ASSET_NOT_FOUND", 404);
    return storage.getSignedDownloadUrl(asset.objectKey, {
      baseUrl: input.baseUrl,
      expiresInSeconds: Math.min(Number(input.expiresInSeconds || 300), 900),
    });
  }

  return {
    validateImage,
    createReferenceAsset,
    getReferenceAsset,
    getDownloadUrl,
    resolveReferenceUrls,
    persistGeneratedOutputs,
    getGeneratedDownloadUrl,
    normalizeAssetIds,
  };
}

module.exports = {
  createAssetService,
  normalizeAssetIds,
};
