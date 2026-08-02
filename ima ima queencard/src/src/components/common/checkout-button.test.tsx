import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutButton } from "./checkout-button";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("CheckoutButton", () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables the button when productKey is missing", () => {
    render(<CheckoutButton productKey={null} label="月付订阅" />);

    expect(screen.getByRole("button", { name: "月付订阅" })).toBeDisabled();
  });

  it("does not call checkout when productKey is missing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    render(<CheckoutButton productKey={null} label="月付订阅" />);

    await user.click(screen.getByRole("button", { name: "月付订阅" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["", "/api/billing/stripe/checkout"],
    ["stripe", "/api/billing/stripe/checkout"],
    ["creem", "/api/billing/creem/checkout"],
  ])("uses %s billing provider", async (provider, endpoint) => {
    const user = userEvent.setup();
    vi.stubEnv("NEXT_PUBLIC_BILLING_PROVIDER", provider);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 }))
    );

    render(<CheckoutButton productKey="creator_monthly" label="月付订阅" />);

    await user.click(screen.getByRole("button", { name: "月付订阅" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({
          body: JSON.stringify({ productKey: "creator_monthly" }),
        })
      );
    });
  });

  it("redirects unauthenticated users to login with pricing return path", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 }))
    );
    render(<CheckoutButton productKey="creator_monthly" label="月付订阅" />);

    await user.click(screen.getByRole("button", { name: "月付订阅" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/login?from=/pricing");
    });
  });

  it.each([
    ["stripe", "Stripe"],
    ["creem", "Creem"],
  ])("names %s in checkout configuration errors", async (provider, providerName) => {
    const user = userEvent.setup();
    vi.stubEnv("NEXT_PUBLIC_BILLING_PROVIDER", provider);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: { message: "Provider configuration is incomplete" } },
          { status: 400 }
        )
      )
    );

    render(<CheckoutButton productKey="creator_monthly" label="月付订阅" />);
    await user.click(screen.getByRole("button", { name: "月付订阅" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("无法创建支付链接", {
        description: `请检查 ${providerName} 环境变量和产品配置是否已经完成。`,
      });
    });
  });
});
