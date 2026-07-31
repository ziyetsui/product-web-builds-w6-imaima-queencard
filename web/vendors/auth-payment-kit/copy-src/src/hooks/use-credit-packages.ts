"use client";

import {
  CREDITS_CONFIG,
  getSubscriptionProducts,
  getOnetimeProducts,
  type CreditPackageConfig,
} from "@/config/credits";

export interface LocalizedPackage extends CreditPackageConfig {
  displayName: string;
  displayDescription: string;
  localizedFeatures: string[];
}

// Dictionary type for credits
export interface CreditsDictionary {
  title?: string;
  buy_credits?: string;
  packages: Record<string, { name: string; description: string }>;
  features: Record<string, string>;
}

/**
 * Get package key from product ID or name
 * Handles both old format (prod_sub_basic) and new Creem format (prod_xxx)
 */
function getPackageKey(productId: string, productName: string): string {
  // Try to extract from old Product ID format first
  const match = productId.match(/prod_(?:sub|pack)_([a-zA-Z0-9]+)/);
  if (match) {
    const rawKey = match[1];
    return rawKey.replace(/_(monthly|yearly)$/, "");
  }

  // For new Creem Product IDs, map from product name
  const nameToKeyMap: Record<string, string> = {
    "Basic Plan": "basic",
    "Pro Plan": "pro",
    "Ultimate Plan": "team", // Use team for Ultimate
    "Basic Plan (Yearly)": "basic",
    "Pro Plan (Yearly)": "pro",
    "Ultimate Plan (Yearly)": "team",
    "Starter Pack": "starter",
    "Standard Pack": "standard",
    "Pro Pack": "pro",
  };

  return nameToKeyMap[productName] || productId;
}

/**
 * Get localized subscription products
 */
export function getLocalizedSubscriptionPackages(
  dictionary: CreditsDictionary
): LocalizedPackage[] {
  const packages = getSubscriptionProducts();

  return packages.map((pkg: CreditPackageConfig) => ({
    ...pkg,
    displayName: dictionary.packages[getPackageKey(pkg.id, pkg.name)]?.name || pkg.name,
    displayDescription:
      dictionary.packages[getPackageKey(pkg.id, pkg.name)]?.description || "",
    localizedFeatures: (pkg.features || []).map((key: string) => {
      const featureKey = key.replace("credits.features.", "");
      return dictionary.features[featureKey] || key;
    }),
  }));
}

/**
 * Get localized one-time purchase products
 */
export function getLocalizedOnetimePackages(
  dictionary: CreditsDictionary
): LocalizedPackage[] {
  const packages = getOnetimeProducts();

  return packages.map((pkg: CreditPackageConfig) => ({
    ...pkg,
    displayName: dictionary.packages[getPackageKey(pkg.id, pkg.name)]?.name || pkg.name,
    displayDescription:
      dictionary.packages[getPackageKey(pkg.id, pkg.name)]?.description || "",
    localizedFeatures: (pkg.features || []).map((key: string) => {
      const featureKey = key.replace("credits.features.", "");
      return dictionary.features[featureKey] || key;
    }),
  }));
}

/**
 * Check if current user can purchase credit packages
 * Returns true if user has subscription OR if there are packages that allow free users
 */
export function canPurchasePackages(hasSubscription: boolean): boolean {
  if (hasSubscription) {
    return true;
  }
  // Check if any package allows free users
  const packages = getOnetimeProducts();
  return packages.some((pkg) => pkg.allowFreeUser !== false);
}
