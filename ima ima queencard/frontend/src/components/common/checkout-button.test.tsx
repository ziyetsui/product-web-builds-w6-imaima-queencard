import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.stubGlobal("fetch", vi.fn());
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

  it("posts productKey to checkout", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 }))
    );

    render(<CheckoutButton productKey="creator_monthly" label="月付订阅" />);

    await user.click(screen.getByRole("button", { name: "月付订阅" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/billing/creem/checkout",
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
});
