/**
 * Site configuration
 * Central place for website settings, auth providers, and features
 */
import { isGoogleAuthEnabled } from "./env-flags";

export interface SiteConfig {
  name: string;
  description: string;
  url: string;
  ogImage: string;
  links: {
    github?: string;
    twitter?: string;
    discord?: string;
  };
  auth: {
    enableGoogleLogin: boolean;
    enableMagicLinkLogin: boolean;
    defaultProvider: "google" | "email";
  };
  routes: {
    defaultLoginRedirect: string;
  };
}

export const siteConfig: SiteConfig = {
  name: "ima ima queencard",
  description: "参考图驱动的爆款图文创作工具",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:8080",
  ogImage: "/placeholder.svg",
  links: {},
  auth: {
    enableGoogleLogin: isGoogleAuthEnabled,
    enableMagicLinkLogin: false,
    defaultProvider: "email",
  },
  routes: {
    defaultLoginRedirect: "/prompts",
  },
};

// Helper to get enabled auth providers
export function getEnabledAuthProviders() {
  const providers: string[] = [];
  if (siteConfig.auth.enableGoogleLogin) providers.push("google");
  if (siteConfig.auth.enableMagicLinkLogin) providers.push("email");
  return providers;
}
