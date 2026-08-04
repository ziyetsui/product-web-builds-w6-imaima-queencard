import { describe, expect, it } from "vitest";

import { hasDatabaseUrl, resolveDatabaseUrl } from "./config";

describe("database environment configuration", () => {
  it("uses the conventional application variable first", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: " postgresql://application ",
        POSTGRES_URI: "postgresql://zeabur",
      })
    ).toBe("postgresql://application");
  });

  it("supports Zeabur's linked PostgreSQL variable", () => {
    expect(
      resolveDatabaseUrl({ POSTGRES_URI: " postgresql://zeabur " })
    ).toBe("postgresql://zeabur");
  });

  it("supports Zeabur's expanded connection-string variable", () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: " ",
        POSTGRES_CONNECTION_STRING: "postgresql://linked-service",
      })
    ).toBe("postgresql://linked-service");
  });

  it("reports when no usable database variable exists", () => {
    expect(hasDatabaseUrl({ DATABASE_URL: " " })).toBe(false);
  });
});
