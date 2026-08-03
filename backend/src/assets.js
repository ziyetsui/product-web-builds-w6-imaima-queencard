const fs = require("node:fs/promises");
const path = require("node:path");

const { createLocalStorage } = require("./storage/local-storage");

function defaultAssetRoot() {
  return path.resolve(__dirname, "../public");
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
    || pathname.startsWith("/landing/")
    || pathname.startsWith("/model-logos/")
    || pathname.startsWith("/miniapp-assets/")
    || pathname.startsWith("/uploads/");
}

async function serveAsset(pathname, env = process.env, request = null) {
  if (!isAllowedAssetPath(pathname)) return null;

  const isUpload = pathname.startsWith("/uploads/");
  const isMiniappAsset = pathname.startsWith("/miniapp-assets/");
  const root = isUpload
    ? path.resolve(env.MINIAPP_UPLOAD_ROOT || path.resolve(__dirname, "../data/uploads"))
    : isMiniappAsset
      ? path.resolve(env.MINIAPP_MINIAPP_ASSET_ROOT || path.resolve(__dirname, "../public"))
    : path.resolve(env.MINIAPP_ASSET_ROOT || defaultAssetRoot());
  const relative = decodeURIComponent(pathname).replace(isUpload ? /^\/uploads\// : /^\/+/, "");
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) return null;

  if (isUpload) {
    if (["production", "prod"].includes(String(env.NODE_ENV || "").toLowerCase()) && !env.MINIAPP_ASSET_SIGNING_SECRET) {
      return new Response("Not found", { status: 404 });
    }
    const storage = createLocalStorage({
      root,
      signingSecret: env.MINIAPP_ASSET_SIGNING_SECRET || "local-development-only-secret",
    });
    const query = request?.url ? new URL(request.url).searchParams : new URLSearchParams();
    if (!await storage.verifySignedDownload(relative, query)) return new Response("Not found", { status: 404 });
  }

  try {
    const data = await fs.readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": contentType(filePath),
        "cache-control": isUpload ? "private, max-age=300" : "public, max-age=3600",
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
