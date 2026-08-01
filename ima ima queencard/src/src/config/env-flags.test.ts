import { describe, expect, it } from "vitest";

import { normalizeBooleanEnv } from "./env-flags";

describe("normalizeBooleanEnv", () => {
  it("treats only true-like values as enabled", () => {
    expect(normalizeBooleanEnv("true")).toBe(true);
    expect(normalizeBooleanEnv(" TRUE ")).toBe(true);
    expect(normalizeBooleanEnv(true)).toBe(true);
  });

  it("treats false, empty, and missing values as disabled", () => {
    expect(normalizeBooleanEnv("false")).toBe(false);
    expect(normalizeBooleanEnv("0")).toBe(false);
    expect(normalizeBooleanEnv("yes")).toBe(false);
    expect(normalizeBooleanEnv("")).toBe(false);
    expect(normalizeBooleanEnv(undefined)).toBe(false);
    expect(normalizeBooleanEnv(null)).toBe(false);
    expect(normalizeBooleanEnv(false)).toBe(false);
  });
});
