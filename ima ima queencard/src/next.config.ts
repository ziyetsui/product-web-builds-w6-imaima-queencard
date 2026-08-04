import type { NextConfig } from "next";

const xhsAssetCdnBase =
  "https://cdn.jsdelivr.net/gh/ziyetsui/product-web-builds-w6-imaima-queencard@main/ima%20ima%20queencard/frontend/public";

function publicEnv(nextName: string, viteName: string, fallback = "") {
  return process.env[nextName] ?? process.env[viteName] ?? fallback;
}

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/xhs-cases/:assetPath*",
        destination: `${xhsAssetCdnBase}/xhs-cases/:assetPath*`,
      },
    ];
  },
  env: {
    NEXT_PUBLIC_ENTER_ANALYTICS_ENABLED: publicEnv("NEXT_PUBLIC_ENTER_ANALYTICS_ENABLED", "VITE_ENTER_ANALYTICS_ENABLED"),
    NEXT_PUBLIC_ENTER_ANALYTICS_TOKEN: publicEnv("NEXT_PUBLIC_ENTER_ANALYTICS_TOKEN", "VITE_ENTER_ANALYTICS_TOKEN"),
    NEXT_PUBLIC_ENTER_PROJECT_ID: publicEnv("NEXT_PUBLIC_ENTER_PROJECT_ID", "VITE_ENTER_PROJECT_ID"),
    NEXT_PUBLIC_ENTER_ANALYTICS_ENDPOINT: publicEnv(
      "NEXT_PUBLIC_ENTER_ANALYTICS_ENDPOINT",
      "VITE_ENTER_ANALYTICS_ENDPOINT",
      "https://api.enter.pro"
    ),
    NEXT_PUBLIC_ENTER_ANALYTICS_DEFINITIONS_ENDPOINT: publicEnv(
      "NEXT_PUBLIC_ENTER_ANALYTICS_DEFINITIONS_ENDPOINT",
      "VITE_ENTER_ANALYTICS_DEFINITIONS_ENDPOINT"
    ),
    NEXT_PUBLIC_ENTER_ANALYTICS_DEBUG: publicEnv("NEXT_PUBLIC_ENTER_ANALYTICS_DEBUG", "VITE_ENTER_ANALYTICS_DEBUG"),
  },
};

export default nextConfig;
