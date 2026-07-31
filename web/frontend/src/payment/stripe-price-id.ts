export function normalizeStripePriceId(value: string | null | undefined) {
  const priceId = value?.trim();

  if (!priceId) return null;
  if (!priceId.startsWith("price_")) return null;
  if (/^price_x+$/i.test(priceId)) return null;

  return priceId;
}

export function isConfiguredStripePriceId(value: string | null | undefined) {
  return normalizeStripePriceId(value) !== null;
}
