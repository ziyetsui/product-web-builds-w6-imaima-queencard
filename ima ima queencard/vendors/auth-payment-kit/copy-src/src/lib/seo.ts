import { i18n, localeConfig, type Locale } from "@/config/i18n-config";
import { siteConfig } from "@/config/site";

function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }
  const normalized = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
  return `/${normalized}`;
}

export function getLocaleUrl(pathname: string, locale: Locale): string {
  const normalizedPath = normalizePathname(pathname);
  const prefix = locale === i18n.defaultLocale ? "" : `/${locale}`;
  return `${siteConfig.url}${prefix}${normalizedPath}`;
}

export function buildAlternates(pathname: string, locale: Locale) {
  const languages = Object.fromEntries(
    i18n.locales.map((loc) => [localeConfig[loc].hreflang, getLocaleUrl(pathname, loc)])
  );
  languages["x-default"] = getLocaleUrl(pathname, i18n.defaultLocale);

  return {
    canonical: getLocaleUrl(pathname, locale),
    languages,
  };
}

export function resolveOgImage(fallback?: string): string | undefined {
  const ogImage = siteConfig.ogImage || fallback;
  return ogImage || undefined;
}
