import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    // Better Auth secret (replaces NEXTAUTH_SECRET)
    BETTER_AUTH_SECRET: z.string().optional(),
    // GitHub OAuth (optional, deprecated)
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    // Google OAuth
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Stripe (optional - only required if using Stripe as billing provider)
    STRIPE_API_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Creem
    CREEM_API_KEY: z.string().min(1).optional(),
    CREEM_WEBHOOK_SECRET: z.string().optional(),
    // Resend Email
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM: z.string().optional(),
    // Admin
    ADMIN_EMAIL: z.string().optional(),
    // Debug
    IS_DEBUG: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().optional(),
  },
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET?.trim(),
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID?.trim(),
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET?.trim(),
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?.trim(),
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET?.trim(),
    STRIPE_API_KEY: process.env.STRIPE_API_KEY?.trim(),
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET?.trim(),
    CREEM_API_KEY: process.env.CREEM_API_KEY?.trim(),
    CREEM_WEBHOOK_SECRET: process.env.CREEM_WEBHOOK_SECRET?.trim(),
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL?.trim(),
    RESEND_API_KEY: process.env.RESEND_API_KEY?.trim(),
    RESEND_FROM: process.env.RESEND_FROM?.trim(),
    ADMIN_EMAIL: process.env.ADMIN_EMAIL?.trim(),
    IS_DEBUG: process.env.IS_DEBUG?.trim(),
  },
});
