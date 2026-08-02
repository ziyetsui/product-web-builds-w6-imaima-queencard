import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/error";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createStripeSession: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/services/billing", () => ({
  createStripeSession: mocks.createStripeSession,
}));

import { POST } from "./route";

function checkoutRequest(body: unknown, raw = false) {
  return new Request("http://localhost/api/billing/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

describe("Stripe checkout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: "user_123" });
    mocks.createStripeSession.mockResolvedValue({
      success: true,
      url: "https://checkout.stripe.com/c/pay_123",
    });
  });

  it("returns 401 before parsing checkout input for unauthenticated callers", async () => {
    mocks.requireAuth.mockRejectedValue(new ApiError("Unauthorized", 401));

    const response = await POST(checkoutRequest("not-json", true));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { message: "Unauthorized" },
    });
    expect(mocks.createStripeSession).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "not-json", true],
    ["blank product key", { productKey: "  " }, false],
    ["unknown product key", { productKey: "unknown" }, false],
  ])("rejects %s", async (_case, body, raw) => {
    const response = await POST(checkoutRequest(body, raw));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { message: "Missing or invalid product key" },
    });
    expect(mocks.createStripeSession).not.toHaveBeenCalled();
  });

  it("uses the authenticated user and ignores client-owned billing fields", async () => {
    const response = await POST(
      checkoutRequest({
        productKey: "  credit_creator  ",
        userId: "attacker",
        amount: 1,
        credits: 999999,
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.createStripeSession).toHaveBeenCalledWith(
      "user_123",
      "credit_creator"
    );
  });

  it("returns a provider configuration failure as 400", async () => {
    mocks.createStripeSession.mockResolvedValue({
      success: false,
      url: null,
      error: "Missing or invalid Stripe price ID",
    });

    const response = await POST(checkoutRequest({ productKey: "creator_monthly" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { message: "Missing or invalid Stripe price ID" },
    });
  });

  it("returns the Stripe checkout URL on success", async () => {
    const response = await POST(checkoutRequest({ productKey: "creator_monthly" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        success: true,
        url: "https://checkout.stripe.com/c/pay_123",
      },
    });
  });
});
