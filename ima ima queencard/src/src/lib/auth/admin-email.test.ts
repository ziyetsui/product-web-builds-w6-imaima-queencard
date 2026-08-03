import { describe, expect, it } from "vitest";

import { DEFAULT_ADMIN_EMAIL } from "./env.mjs";

describe("admin owner email", () => {
  it("uses the product owner's email as the bootstrap default", () => {
    expect(DEFAULT_ADMIN_EMAIL).toBe("iven_chloe@icloud.com");
  });
});
