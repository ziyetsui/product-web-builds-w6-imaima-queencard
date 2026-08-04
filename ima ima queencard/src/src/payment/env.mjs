import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  shared: {},
  server: {
    STRIPE_API_KEY: z.string().optional(),
    STRIPE_PRICE_CREATOR_MONTHLY: z.string().optional(),
    STRIPE_PRICE_CREATOR_ANNUAL: z.string().optional(),
    STRIPE_PRICE_STUDIO_MONTHLY: z.string().optional(),
    STRIPE_PRICE_STUDIO_ANNUAL: z.string().optional(),
    STRIPE_PRICE_CREDIT_CREATOR: z.string().optional(),
    STRIPE_PRICE_CREDIT_STUDIO: z.string().optional(),
    CREEM_API_KEY: z.string().optional(),
    CREEM_WEBHOOK_SECRET: z.string().optional(),
    CREEM_API_BASE_URL: z.string().url().optional(),
    CREEM_PRODUCT_CREATOR_MONTHLY: z.string().optional(),
    CREEM_PRODUCT_CREATOR_ANNUAL: z.string().optional(),
    CREEM_PRODUCT_STUDIO_MONTHLY: z.string().optional(),
    CREEM_PRODUCT_STUDIO_ANNUAL: z.string().optional(),
    CREEM_PRODUCT_CREDIT_CREATOR: z.string().optional(),
    CREEM_PRODUCT_CREDIT_STUDIO: z.string().optional(),
    WAFFO_MERCHANT_ID: z.string().optional(),
    WAFFO_PRIVATE_KEY: z.string().optional(),
    WAFFO_PRODUCT_CREATOR_MONTHLY: z.string().optional(),
    WAFFO_PRODUCT_CREATOR_ANNUAL: z.string().optional(),
    WAFFO_PRODUCT_STUDIO_MONTHLY: z.string().optional(),
    WAFFO_PRODUCT_STUDIO_ANNUAL: z.string().optional(),
    WAFFO_PRODUCT_CREDIT_CREATOR: z.string().optional(),
    WAFFO_PRODUCT_CREDIT_STUDIO: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BILLING_PROVIDER: z.enum(["creem", "stripe", "waffo"]).optional(),
  },
  runtimeEnv: {
    STRIPE_API_KEY: process.env.STRIPE_API_KEY?.trim(),
    STRIPE_PRICE_CREATOR_MONTHLY:
      process.env.STRIPE_PRICE_CREATOR_MONTHLY?.trim(),
    STRIPE_PRICE_CREATOR_ANNUAL:
      process.env.STRIPE_PRICE_CREATOR_ANNUAL?.trim(),
    STRIPE_PRICE_STUDIO_MONTHLY:
      process.env.STRIPE_PRICE_STUDIO_MONTHLY?.trim(),
    STRIPE_PRICE_STUDIO_ANNUAL:
      process.env.STRIPE_PRICE_STUDIO_ANNUAL?.trim(),
    STRIPE_PRICE_CREDIT_CREATOR:
      process.env.STRIPE_PRICE_CREDIT_CREATOR?.trim(),
    STRIPE_PRICE_CREDIT_STUDIO:
      process.env.STRIPE_PRICE_CREDIT_STUDIO?.trim(),
    CREEM_API_KEY: process.env.CREEM_API_KEY?.trim(),
    CREEM_WEBHOOK_SECRET: process.env.CREEM_WEBHOOK_SECRET?.trim(),
    CREEM_API_BASE_URL: process.env.CREEM_API_BASE_URL?.trim(),
    CREEM_PRODUCT_CREATOR_MONTHLY:
      process.env.CREEM_PRODUCT_CREATOR_MONTHLY?.trim(),
    CREEM_PRODUCT_CREATOR_ANNUAL:
      process.env.CREEM_PRODUCT_CREATOR_ANNUAL?.trim(),
    CREEM_PRODUCT_STUDIO_MONTHLY:
      process.env.CREEM_PRODUCT_STUDIO_MONTHLY?.trim(),
    CREEM_PRODUCT_STUDIO_ANNUAL:
      process.env.CREEM_PRODUCT_STUDIO_ANNUAL?.trim(),
    CREEM_PRODUCT_CREDIT_CREATOR:
      process.env.CREEM_PRODUCT_CREDIT_CREATOR?.trim(),
    CREEM_PRODUCT_CREDIT_STUDIO:
      process.env.CREEM_PRODUCT_CREDIT_STUDIO?.trim(),
    WAFFO_MERCHANT_ID: process.env.WAFFO_MERCHANT_ID?.trim(),
    WAFFO_PRIVATE_KEY: process.env.WAFFO_PRIVATE_KEY?.trim(),
    WAFFO_PRODUCT_CREATOR_MONTHLY:
      process.env.WAFFO_PRODUCT_CREATOR_MONTHLY?.trim(),
    WAFFO_PRODUCT_CREATOR_ANNUAL:
      process.env.WAFFO_PRODUCT_CREATOR_ANNUAL?.trim(),
    WAFFO_PRODUCT_STUDIO_MONTHLY:
      process.env.WAFFO_PRODUCT_STUDIO_MONTHLY?.trim(),
    WAFFO_PRODUCT_STUDIO_ANNUAL:
      process.env.WAFFO_PRODUCT_STUDIO_ANNUAL?.trim(),
    WAFFO_PRODUCT_CREDIT_CREATOR:
      process.env.WAFFO_PRODUCT_CREDIT_CREATOR?.trim(),
    WAFFO_PRODUCT_CREDIT_STUDIO:
      process.env.WAFFO_PRODUCT_CREDIT_STUDIO?.trim(),
    NEXT_PUBLIC_BILLING_PROVIDER:
      process.env.NEXT_PUBLIC_BILLING_PROVIDER?.trim(),
  },
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
