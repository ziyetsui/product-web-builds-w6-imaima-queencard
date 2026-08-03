import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  handleEvent: vi.fn(),
  webhookSecret: "whsec_test" as string | undefined,
}));

vi.mock("@/payment", () => ({
  stripe: { webhooks: { constructEvent: mocks.constructEvent } },
  handleEvent: mocks.handleEvent,
}));

vi.mock("@/env.mjs", () => ({
  env: {
    get STRIPE_WEBHOOK_SECRET() {
      return mocks.webhookSecret;
    },
  },
}));

import { GET, POST } from "./route";

const payload = JSON.stringify({
  id: "evt_123",
  type: "checkout.session.completed",
  data: { object: { id: "cs_123" } },
});

function webhookRequest(signature?: string) {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: payload,
    headers: signature ? { "Stripe-Signature": signature } : undefined,
  });
}

describe("Stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookSecret = "whsec_test";
    mocks.constructEvent.mockReturnValue({
      id: "evt_123",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123" } },
    });
    mocks.handleEvent.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("rejects a missing signature before event construction", async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.handleEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing webhook secret before event construction", async () => {
    mocks.webhookSecret = undefined;

    const response = await POST(webhookRequest("sig_test"));

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.handleEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without handling the event", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const response = await POST(webhookRequest("sig_invalid"));

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      payload,
      "sig_invalid",
      "whsec_test"
    );
    expect(mocks.handleEvent).not.toHaveBeenCalled();
  });

  it("verifies the unchanged raw body before handling the event", async () => {
    const event = {
      id: "evt_123",
      type: "checkout.session.completed",
      data: { object: { id: "cs_123" } },
    };
    mocks.constructEvent.mockReturnValue(event);

    const response = await POST(webhookRequest("sig_valid"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      payload,
      "sig_valid",
      "whsec_test"
    );
    expect(mocks.handleEvent).toHaveBeenCalledWith(event);
  });

  it("returns 400 so Stripe can retry a handler failure", async () => {
    mocks.handleEvent.mockRejectedValue(new Error("Database unavailable"));

    const response = await POST(webhookRequest("sig_valid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Database unavailable",
    });
  });

  it("rejects GET requests", async () => {
    const response = GET();

    expect(response.status).toBe(405);
  });
});
