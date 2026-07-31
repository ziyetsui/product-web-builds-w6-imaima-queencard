"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080"),
  plugins: [magicLinkClient()],
});

// Export commonly used methods
export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
} = authClient;

// Re-export types
export type AuthClient = typeof authClient;

// User type for client components
// This matches the server-side User type structure
export type User = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  isAdmin?: boolean | null;
};
