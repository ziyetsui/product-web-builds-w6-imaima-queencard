import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import PricingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("PricingPage", () => {
  it("treats a checkout return as pending server confirmation", async () => {
    render(
      await PricingPage({
        searchParams: Promise.resolve({ checkout: "success" }),
      })
    );

    expect(
      screen.getByRole("heading", { name: "支付结果确认中" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/以服务端 Webhook 处理结果和.*我的积分.*页面显示为准/)
    ).toBeInTheDocument();
    expect(screen.queryByText("支付已完成")).not.toBeInTheDocument();
  });

  it("does not show a checkout result notice without a success parameter", async () => {
    render(await PricingPage({}));

    expect(screen.queryByText("支付结果确认中")).not.toBeInTheDocument();
    expect(screen.queryByText("支付已完成")).not.toBeInTheDocument();
  });

  it("renders Chinese pricing tabs and defaults to one-time credit packs", async () => {
    render(await PricingPage({}));

    expect(screen.getByRole("button", { name: "一次性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "月付" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /年付/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "创作者积分包" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "工作室积分包" })).toBeInTheDocument();
    expect(screen.getAllByText("600 积分").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,800 积分").length).toBeGreaterThan(0);
    expect(screen.getByText("¥99")).toBeInTheDocument();
    expect(screen.getByText("¥269")).toBeInTheDocument();
  });

  it("hides the free plan from monthly and yearly pricing", async () => {
    const user = userEvent.setup();
    render(await PricingPage({}));

    await user.click(screen.getByRole("button", { name: "月付" }));

    expect(screen.queryByRole("heading", { name: "免费版" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "免费开始" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /年付/ }));

    expect(screen.queryByRole("heading", { name: "免费版" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "免费开始" })).not.toBeInTheDocument();
  });

  it("renders checkout buttons for each selected pricing mode", async () => {
    const user = userEvent.setup();
    render(await PricingPage({}));

    expect(screen.getAllByRole("button", { name: "购买积分包" })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "月付" }));
    expect(screen.getAllByRole("button", { name: "选择月付" })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /年付/ }));
    expect(screen.getAllByRole("button", { name: "选择年付" })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "一次性" }));
    expect(screen.getAllByRole("button", { name: "购买积分包" })).toHaveLength(2);
  });
});
