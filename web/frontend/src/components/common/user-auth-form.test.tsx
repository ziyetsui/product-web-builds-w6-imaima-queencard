import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  googleEnabled: false,
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  social: vi.fn(),
  routerPush: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/config/env-flags", () => ({
  get isGoogleAuthEnabled() {
    return mocks.googleEnabled;
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("from=/pricing"),
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: {
      email: mocks.signInEmail,
      social: mocks.social,
    },
    signUp: {
      email: mocks.signUpEmail,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

import { UserAuthForm } from "./user-auth-form";

describe("UserAuthForm", () => {
  beforeEach(() => {
    mocks.googleEnabled = false;
    mocks.signInEmail.mockReset();
    mocks.signUpEmail.mockReset();
    mocks.social.mockReset();
    mocks.routerPush.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it("keeps email password fields visible when Google is disabled", () => {
    render(<UserAuthForm mode="login" />);

    expect(screen.getByPlaceholderText("name@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
    expect(screen.getByText("忘记密码？")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.queryByText("或使用其他方式")).not.toBeInTheDocument();
  });

  it("keeps email password visible when Google is enabled", () => {
    mocks.googleEnabled = true;

    render(<UserAuthForm mode="register" />);

    expect(screen.getByPlaceholderText("name@example.com")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入密码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建账户" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "使用 Google 继续" })).toBeInTheDocument();
    expect(screen.getByText("或使用其他方式")).toBeInTheDocument();
  });

  it("does not submit invalid email or short password", async () => {
    const user = userEvent.setup();
    render(<UserAuthForm mode="login" />);

    await user.type(screen.getByPlaceholderText("name@example.com"), "bad-email");
    await user.type(screen.getByPlaceholderText("输入密码"), "short");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(mocks.signInEmail).not.toHaveBeenCalled();
    });
  });

  it("signs in with email and password", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValue({ error: null });
    render(<UserAuthForm mode="login" />);

    await user.type(screen.getByPlaceholderText("name@example.com"), "USER@EXAMPLE.COM");
    await user.type(screen.getByPlaceholderText("输入密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "password123",
        rememberMe: true,
        callbackURL: "/pricing",
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "登录成功",
        expect.objectContaining({
          description: expect.stringContaining("欢迎回到"),
        })
      );
      expect(mocks.routerPush).toHaveBeenCalledWith("/pricing");
    });
  });

  it("signs up with email and password", async () => {
    const user = userEvent.setup();
    mocks.signUpEmail.mockResolvedValue({ error: null });
    render(<UserAuthForm mode="register" />);

    await user.type(screen.getByPlaceholderText("name@example.com"), "new@example.com");
    await user.type(screen.getByPlaceholderText("输入密码"), "password123");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() => {
      expect(mocks.signUpEmail).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "password123",
        name: "new",
        callbackURL: "/pricing",
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "账号已创建",
        expect.objectContaining({
          description: expect.stringContaining("工作区"),
        })
      );
      expect(mocks.routerPush).toHaveBeenCalledWith("/pricing");
    });
  });

  it("shows a clear existing-account recovery path when sign up email already exists", async () => {
    const user = userEvent.setup();
    mocks.signUpEmail.mockResolvedValue({
      error: { message: "User already exists. Use another email." },
    });
    render(<UserAuthForm mode="register" />);

    await user.type(screen.getByPlaceholderText("name@example.com"), "old@example.com");
    await user.type(screen.getByPlaceholderText("输入密码"), "password123");
    await user.click(screen.getByRole("button", { name: "创建账户" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "邮箱已注册",
        expect.objectContaining({
          description: expect.stringContaining("直接登录"),
        })
      );
    });

    expect(screen.getByText("邮箱已注册")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去登录" })).toHaveAttribute(
      "href",
      "/login?from=%2Fpricing"
    );
    expect(screen.getByRole("link", { name: "重置密码" })).toHaveAttribute(
      "href",
      "/forgot-password"
    );
  });

  it("shows failure toast when email sign in fails", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValue({
      error: { message: "rate limited" },
    });
    render(<UserAuthForm mode="login" />);

    await user.type(screen.getByPlaceholderText("name@example.com"), "user@example.com");
    await user.type(screen.getByPlaceholderText("输入密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "登录失败",
        expect.objectContaining({
          description: expect.stringContaining("请检查邮箱"),
        })
      );
    });
  });

  it("shows a clear toast when Google sign-in fails", async () => {
    const user = userEvent.setup();
    mocks.googleEnabled = true;
    mocks.social.mockRejectedValue(new Error("Google unavailable"));
    render(<UserAuthForm mode="login" />);

    await user.click(screen.getByRole("button", { name: "使用 Google 继续" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Google 登录暂不可用",
        expect.objectContaining({
          description: "请使用邮箱和密码登录。",
        })
      );
    });
  });
});
