import { WaffoPancake } from "@waffo/pancake-ts";

let client: WaffoPancake | null = null;
let clientFingerprint: string | null = null;

export function getWaffoClient() {
  const merchantId = process.env.WAFFO_MERCHANT_ID?.trim();
  const privateKey = process.env.WAFFO_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");

  if (!merchantId) {
    throw new Error("WAFFO_MERCHANT_ID is not configured");
  }
  if (!privateKey) {
    throw new Error("WAFFO_PRIVATE_KEY is not configured");
  }

  const fingerprint = `${merchantId}:${privateKey.length}:${privateKey.slice(-24)}`;
  if (!client || clientFingerprint !== fingerprint) {
    client = new WaffoPancake({ merchantId, privateKey });
    clientFingerprint = fingerprint;
  }

  return client;
}
