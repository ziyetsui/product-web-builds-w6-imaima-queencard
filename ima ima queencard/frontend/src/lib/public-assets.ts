const publicAssetBaseUrl = (
  process.env.NEXT_PUBLIC_ASSET_BASE_URL ||
  process.env.NEXT_PUBLIC_XHS_CASES_CDN_URL ||
  ""
).replace(/\/+$/, "");

function shouldPrefixPublicAsset(path: string) {
  return path.startsWith("/xhs-cases/") || path.startsWith("/landing/");
}

export function publicAssetUrl(path: string) {
  if (!path) return path;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (!publicAssetBaseUrl || !shouldPrefixPublicAsset(path)) return path;
  return `${publicAssetBaseUrl}${path}`;
}

export function publicAssetUrls(paths: string[]) {
  return paths.map(publicAssetUrl);
}
