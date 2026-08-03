const crypto = require("node:crypto");
const path = require("node:path");

const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { assetStorageError } = require("./storage");

function safeKey(value) {
  const key = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw assetStorageError("Invalid asset object key", "ASSET_KEY_INVALID", 400);
  }
  return key;
}

function randomKey(input = {}) {
  const requested = safeKey(input.key || "asset");
  const directory = path.posix.dirname(requested);
  const extension = path.extname(requested).toLowerCase()
    || (input.contentType === "image/jpeg" ? ".jpg" : input.contentType === "image/webp" ? ".webp" : ".png");
  return `${directory === "." ? "assets" : directory}/${crypto.randomUUID()}${extension}`;
}

function createS3Storage(options = {}) {
  const bucket = String(options.bucket || "").trim();
  if (!bucket) throw assetStorageError("S3 bucket is required", "ASSET_STORAGE_CONFIG_INVALID", 500);
  const client = options.client || new S3Client({
    region: options.region || "auto",
    endpoint: options.endpoint || undefined,
    forcePathStyle: Boolean(options.forcePathStyle),
    credentials: options.accessKeyId && options.secretAccessKey
      ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
      : undefined,
  });

  async function put(input = {}) {
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body || "");
    const key = randomKey(input);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: input.contentType || "application/octet-stream",
      Metadata: input.metadata || {},
    }));
    return { key, sizeBytes: body.length, contentType: input.contentType || "application/octet-stream", metadata: input.metadata || {} };
  }

  async function head(key) {
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
      return {
        key: safeKey(key),
        sizeBytes: Number(result.ContentLength || 0),
        contentType: result.ContentType || "application/octet-stream",
        metadata: result.Metadata || {},
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
        throw assetStorageError("Asset object not found", "ASSET_NOT_FOUND", 404);
      }
      throw error;
    }
  }

  async function get(key) {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
    if (Buffer.isBuffer(result.Body)) return result.Body;
    if (result.Body && typeof result.Body.transformToByteArray === "function") return Buffer.from(await result.Body.transformToByteArray());
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async function getSignedDownloadUrl(key, input = {}) {
    const command = new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) });
    return getSignedUrl(client, command, { expiresIn: Math.max(1, Number(input.expiresInSeconds || 300)) });
  }

  async function remove(key) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
  }

  return {
    driver: "s3",
    bucket,
    client,
    put,
    head,
    get,
    getSignedDownloadUrl,
    delete: remove,
  };
}

module.exports = {
  createS3Storage,
};
