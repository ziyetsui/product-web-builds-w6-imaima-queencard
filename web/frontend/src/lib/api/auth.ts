import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { auth, type User } from "@/lib/auth";
import { env } from "@/lib/auth/env.mjs";

import { ApiError } from "./error";

function splitEmails(value?: string | null) {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email?: string | null) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const superAdminEmails = splitEmails(env.SUPERADMIN_EMAILS);
  if (superAdminEmails.length > 0) {
    return superAdminEmails.includes(normalizedEmail);
  }

  return env.ADMIN_EMAIL?.trim().toLowerCase() === normalizedEmail;
}

/**
 * Get authenticated user from request headers
 * Returns null if not authenticated
 */
export async function getAuthUser(request: Request): Promise<User | null> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    return null;
  }

  return session.user as User;
}

/**
 * Require authentication - throws ApiError if not authenticated
 */
export async function requireAuth(request: Request): Promise<User> {
  const user = await getAuthUser(request);
  if (!user) {
    throw new ApiError("Unauthorized", 401);
  }
  return user;
}

/**
 * Require admin role - throws ApiError if not admin
 */
export async function requireAdmin(request: Request): Promise<User> {
  const user = await requireAuth(request);
  if (!user.isAdmin) {
    const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail && user.email?.trim().toLowerCase() === adminEmail) {
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
      return { ...user, isAdmin: true };
    }

    throw new ApiError("Forbidden", 403);
  }
  return user;
}

/**
 * Require super admin role for high-risk admin operations.
 */
export async function requireSuperAdmin(request: Request): Promise<User> {
  const user = await requireAdmin(request);
  if (!isSuperAdminEmail(user.email)) {
    throw new ApiError("Forbidden", 403);
  }
  return user;
}
