export function normalizeBooleanEnv(value: boolean | string | null | undefined) {
  if (typeof value === "boolean") return value;
  return value?.trim().toLowerCase() === "true";
}

export const isDebugEnabled = normalizeBooleanEnv(process.env.IS_DEBUG);

export const isGoogleAuthEnabled = normalizeBooleanEnv(
  process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED
);
