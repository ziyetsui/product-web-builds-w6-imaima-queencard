const fs = require("node:fs/promises");
const path = require("node:path");

function defaultAssetRoot() {
  return path.resolve(
    __dirname,
    "../../ima ima queencard/frontend/public"
  );
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function isAllowedAssetPath(pathname) {
  return pathname.startsWith("/xhs-cases/")
    || pathname.startsWith("/model-logos/")
    || pathname.startsWith("/miniapp-assets/")
    || pathname.startsWith("/uploads/reference/");
}

async function serveAsset(pathname, env = process.env) {
  if (!isAllowedAssetPath(pathname)) return null;

  const isUpload = pathname.startsWith("/uploads/reference/");
  const root = isUpload
    ? path.resolve(env.MINIAPP_UPLOAD_ROOT || path.resolve(__dirname, "../data/uploads"))
    : path.resolve(env.MINIAPP_ASSET_ROOT || defaultAssetRoot());
  const relative = decodeURIComponent(pathname).replace(isUpload ? /^\/uploads\// : /^\/+/, "");
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) return null;

  try {
    const data = await fs.readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": contentType(filePath),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

module.exports = {
  serveAsset,
};
