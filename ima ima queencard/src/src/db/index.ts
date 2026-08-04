import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import { resolveDatabaseUrl } from "./config";

const databaseUrl = resolveDatabaseUrl();

const parseSslConfig = (url: string) => {
  const mode = (
    process.env.DATABASE_SSL_MODE ||
    process.env.DATABASE_SSL ||
    ""
  )
    .toLowerCase()
    .trim();

  if (mode === "disable" || mode === "false" || mode === "0" || mode === "off") {
    return undefined;
  }

  if (mode === "require" || mode === "true" || mode === "1" || mode === "on") {
    return "require" as const;
  }

  const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1");
  return isLocalhost ? undefined : ("require" as const);
};

function createDb() {
  if (!databaseUrl || !databaseUrl.startsWith("postgres")) {
    throw new Error(
      "Missing or invalid PostgreSQL connection URL. Set DATABASE_URL, POSTGRES_URL, POSTGRES_URI, or POSTGRES_CONNECTION_STRING.\n" +
        "Example: DATABASE_URL='postgresql://user:password@host:port/database'"
    );
  }
  const sql = postgres(databaseUrl, {
    max: 10,
    ssl: parseSslConfig(databaseUrl),
  });
  return drizzle(sql, { schema });
}

let _db: ReturnType<typeof createDb> | undefined;
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    if (!_db) {
      _db = createDb();
    }
    return Reflect.get(_db, prop, receiver);
  },
});

export * from "./schema";
