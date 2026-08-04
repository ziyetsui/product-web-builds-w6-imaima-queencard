import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { magicLink } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { creditService } from "@/services/credit";
import { isGoogleAuthEnabled } from "@/config/env-flags";

import { db, users } from "@/db";
import * as schema from "@/db/schema";
import { env } from "./env.mjs";
import { eq } from "drizzle-orm";

const toLogString = (value: unknown) => {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  const normalized =
    value instanceof Error
      ? {
        name: value.name,
        message: value.message,
        stack: value.stack,
        status: (value as unknown as Record<string, unknown>).status,
        statusText: (value as unknown as Record<string, unknown>).statusText,
        error: (value as unknown as Record<string, unknown>).error,
      }
      : value;
  const seen = new WeakSet();
  try {
    return JSON.stringify(normalized, (_key, val) => {
      if (typeof val === "bigint") return val.toString();
      if (typeof val === "function") return "[Function]";
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
  } catch {
    return String(normalized);
  }
};

const debugLogger =
  process.env.NODE_ENV === "development"
    ? {
      level: "debug" as const,
      log: (level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]) => {
        const suffix = args.length ? ` ${args.map(toLogString).join(" ")}` : "";
        const line = `[Better Auth] ${message}${suffix}`.trimEnd();
        if (level === "error") console.error(line);
        else if (level === "warn") console.warn(line);
        else console.log(line);
      },
    }
    : undefined;

type AuthPlugin =
  | ReturnType<typeof nextCookies>
  | ReturnType<typeof magicLink>;

const plugins: AuthPlugin[] = [
  // Avoid Next.js dev DataCloneError from cookies() in some environments.
  ...(process.env.NODE_ENV === "development" ? [] : [nextCookies()]),
  magicLink({
    sendMagicLink: async ({ email, url }) => {
      const hasEmailProvider = Boolean(
        env.ZEABUR_EMAIL_API_KEY ||
        env.RESEND_API_KEY
      );

      if (!hasEmailProvider) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            [
              "[Auth] Email provider is not configured.",
              "Magic link email was not sent. Use this development link instead:",
              url,
            ].join("\n")
          );
          return;
        }

        throw new Error("Email provider is not configured.");
      }

      // Dynamic import to avoid Edge Runtime issues in middleware
      const { MagicLinkEmail } = await import(
        "@/lib/emails/magic-link-email"
      );
      const { assertEmailSent, sendTransactionalEmail } = await import("@/lib/email");
      const { siteConfig } = await import("@/config/site");

      // Check if user exists to determine email type
      const [existingUser] = await db
        .select({ name: users.name, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      const userVerified = !!existingUser?.emailVerified;
      const authSubject = userVerified
        ? `Sign-in link for ${(siteConfig as { name: string }).name}`
        : `Create your ${(siteConfig as { name: string }).name} account`;

      try {
        const sendResult = await sendTransactionalEmail({
          to: email,
          subject: authSubject,
          react: MagicLinkEmail({
            firstName: existingUser?.name ?? "",
            actionUrl: url,
            mailType: userVerified ? "login" : "register",
            siteName: (siteConfig as { name: string }).name,
          }),
          headers: {
            "X-Entity-Ref-ID": new Date().getTime() + "",
          },
        });
        assertEmailSent(sendResult);
      } catch (error) {
        console.error("Failed to send magic link email:", error);
        throw error;
      }
    },
    expiresIn: 300, // 5 minutes
  }),
];

const baseURL =
  env.NEXT_PUBLIC_APP_URL ||
  process.env.BETTER_AUTH_BASE_URL ||
  "http://localhost:8080";

if (isGoogleAuthEnabled && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
  throw new Error(
    "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
  );
}

const socialProviders = isGoogleAuthEnabled
  ? {
      google: {
        clientId: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        prompt: "select_account" as const,
      },
    }
  : {};

export const auth = betterAuth({
  baseURL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  logger: debugLogger,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      const hasEmailProvider = Boolean(
        env.ZEABUR_EMAIL_API_KEY ||
        env.RESEND_API_KEY
      );

      if (!hasEmailProvider) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            [
              "[Auth] Email provider is not configured.",
              "Password reset email was not sent. Use this development link instead:",
              url,
            ].join("\n")
          );
          return;
        }

        throw new Error("Email provider is not configured.");
      }

      const { sendResetPasswordEmail } = await import("@/lib/emails/utils");
      const sendResult = await sendResetPasswordEmail({
        to: user.email,
        name: user.name ?? "",
        resetUrl: url,
        locale: "zh",
      });

      if (!sendResult.success) {
        throw sendResult.error instanceof Error
          ? sendResult.error
          : new Error("Failed to send reset password email.");
      }
    },
  },

  // Drizzle adapter with schema for Better Auth
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            const { notifyNewRegistration } = await import("@/services/ops-notifications");
            await notifyNewRegistration(user);
          } catch (error) {
            console.error("[Auth] Failed to send registration notification:", error);
          }
        },
      },
    },
  },

  // Plugins
  plugins,

  // Hooks - 自动赠送新用户积分（仅在注册时触发）
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // 只要有新 session 创建（注册或登录），都尝试检查并发放新用户积分
      // grantNewUserCredits 内部有幂等性检查，只会发放一次
      // 这样可以覆盖 Email 注册、OAuth 注册等所有场景
      const newSession = ctx.context?.newSession;
      if (newSession?.user?.id) {
        try {
          // 不等待这个操作，避免阻塞登录/注册响应（虽然它是异步的，但 await 会阻塞中间件链）
          // 但作为 after hook，最好还是 await 确保执行完成，反正数据库查询很快
          await creditService.grantNewUserCredits(newSession.user.id);
        } catch (error) {
          console.error("[Auth] Failed to grant new user credits:", error);
          // 不抛出错误，避免影响用户登录
        }
      }
    }),
  },

  socialProviders,

  // Custom user fields
  user: {
    additionalFields: {
      isAdmin: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // Prevent users from setting this
      },
    },
  },

  // Session configuration
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
});

// Extend user type with additional fields
export type User = typeof auth.$Infer.Session.user & {
  isAdmin?: boolean | null;
};

// Session type with extended user
type BaseSession = typeof auth.$Infer.Session;
export type Session = {
  session: BaseSession["session"];
  user: User;
};
