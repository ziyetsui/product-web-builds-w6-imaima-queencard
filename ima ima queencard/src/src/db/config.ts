const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URI",
  "POSTGRES_CONNECTION_STRING",
] as const;

type DatabaseEnvironment = Record<string, string | undefined>;

export function resolveDatabaseUrl(
  environment: DatabaseEnvironment = process.env
) {
  for (const key of DATABASE_URL_KEYS) {
    const value = environment[key]?.trim();
    if (value) return value;
  }

  return "";
}

export function hasDatabaseUrl(
  environment: DatabaseEnvironment = process.env
) {
  return Boolean(resolveDatabaseUrl(environment));
}
