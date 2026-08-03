const publicAssetBaseUrl = (
  process.env.NEXT_PUBLIC_ASSET_BASE_URL ||
  process.env.NEXT_PUBLIC_XHS_CASES_CDN_URL ||
  ""
).replace(/\/+$/, "");

const landingAssetBaseUrl =
  publicAssetBaseUrl ||
  "https://cdn.jsdelivr.net/gh/ziyetsui/product-web-builds-w6-imaima-queencard@lemonricebal/ima%20ima%20queencard/frontend/public";

function shouldPrefixPublicAsset(path: string) {
  return path.startsWith("/xhs-cases/") || path.startsWith("/landing/");
}

export function publicAssetUrl(path: string) {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (!shouldPrefixPublicAsset(path)) return path;
  if (path.startsWith("/landing/")) return `${landingAssetBaseUrl}${path}`;
  return publicAssetBaseUrl ? `${publicAssetBaseUrl}${path}` : path;
}

export function publicAssetUrls(paths: string[]) {
  return paths.map(publicAssetUrl);
}
