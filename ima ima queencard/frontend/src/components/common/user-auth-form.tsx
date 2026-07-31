"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";

import { authClient } from "@/lib/auth/client";
import { cn } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import * as Icons from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isGoogleAuthEnabled } from "@/config/env-flags";

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  lang?: string;
  disabled?: boolean;
  mode?: "login" | "register";
}

const userAuthSchema = z.object({
  email: z.string().email("请输入有效的邮箱地址。"),
  password: z.string().min(8, "密码至少需要 8 位字符。"),
});

type FormData = z.infer<typeof userAuthSchema>;
type AuthFailureNotice = {
  title: string;
  description: string;
  showAccountRecoveryLinks?: boolean;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function isExistingAccountError(message: string) {
  return /already exists|existing email|email.*exists|user.*exists/i.test(message);
}

function getAuthFailureNotice(
  mode: "login" | "register",
  error: unknown
): AuthFailureNotice {
  const message = getErrorMessage(error);

  if (mode === "register" && isExistingAccountError(message)) {
    return {
      title: "邮箱已注册",
      description: "请直接登录；如果你之前没有设置过密码，可以先重置密码。",
      showAccountRecoveryLinks: true,
    };
  }

  if (mode === "register") {
    return {
      title: "创建失败",
      description: message || "请稍后重试，或换一个邮箱再创建。",
    };
  }

  return {
    title: "登录失败",
    description:
      message ||
      "请检查邮箱和密码；如果这个邮箱还没创建账号，请先注册。",
    showAccountRecoveryLinks: true,
  };
}

export function UserAuthForm({
  className,
  mode = "login",
  disabled,
  ...props
}: UserAuthFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(userAuthSchema),
  });
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [isGoogleLoading, setIsGoogleLoading] = React.useState<boolean>(false);
  const [failureNotice, setFailureNotice] =
    React.useState<AuthFailureNotice | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = searchParams?.get("from") ?? "/prompts";
  const loginHref = `/login?from=${encodeURIComponent(callbackURL)}`;
  const submitLabel = mode === "register" ? "创建账户" : "登录";
  const showGoogle = isGoogleAuthEnabled;

  function getDefaultName(email: string) {
    const [localPart] = email.split("@");
    return localPart || "ima ima queencard user";
  }

  async function onSubmit(data: FormData) {
    setIsLoading(true);
    setFailureNotice(null);
    const email = data.email.toLowerCase();

    try {
      const result =
        mode === "register"
          ? await authClient.signUp.email({
              email,
              password: data.password,
              name: getDefaultName(email),
              callbackURL,
            })
          : await authClient.signIn.email({
              email,
              password: data.password,
              rememberMe: true,
              callbackURL,
            });
      const authError = (result as { error?: { message?: string; statusText?: string } | null }).error;

      if (authError) {
        throw new Error(authError.message || authError.statusText || "Email auth failed");
      }

      toast.success(mode === "register" ? "账号已创建" : "登录成功", {
        description:
          mode === "register"
            ? "你的工作区和积分账户已经准备好了。"
            : "欢迎回到 ima ima queencard。",
      });
      router.push(callbackURL);
    } catch (error) {
      console.warn("Email/password auth error:", error);
      const notice = getAuthFailureNotice(mode, error);
      setFailureNotice(notice);
      toast.error(notice.title, {
        description: notice.description,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={cn("grid gap-6", className)} {...props}>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid gap-4">
          <div className="grid gap-1">
            <Label className="sr-only" htmlFor="email">
              邮箱
            </Label>
            <Input
              id="email"
              placeholder="name@example.com"
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect="off"
              disabled={isLoading || isGoogleLoading || disabled}
              {...register("email")}
            />
            {errors?.email && (
              <p className="px-1 text-xs text-red-600">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="grid gap-1">
            <Label className="sr-only" htmlFor="password">
              密码
            </Label>
            <Input
              id="password"
              placeholder="输入密码"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              disabled={isLoading || isGoogleLoading || disabled}
              {...register("password")}
            />
            {errors?.password && (
              <p className="px-1 text-xs text-red-600">
                {errors.password.message}
              </p>
            )}
          </div>

          {mode === "login" ? (
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm font-bold text-[#ef724f] underline-offset-4 hover:underline"
              >
                忘记密码？
              </Link>
            </div>
          ) : null}

          {failureNotice ? (
            <div className="rounded-[12px] border-2 border-charcoal bg-canvas-pink px-4 py-3 text-sm font-bold text-charcoal/75">
              <p className="text-charcoal">{failureNotice.title}</p>
              <p className="mt-1">{failureNotice.description}</p>
              {failureNotice.showAccountRecoveryLinks ? (
                <div className="mt-3 flex flex-wrap gap-3 text-[#ef724f]">
                  {mode === "register" ? (
                    <Link href={loginHref} className="underline underline-offset-4">
                      去登录
                    </Link>
                  ) : (
                    <Link
                      href={`/register?from=${encodeURIComponent(callbackURL)}`}
                      className="underline underline-offset-4"
                    >
                      去注册
                    </Link>
                  )}
                  <Link href="/forgot-password" className="underline underline-offset-4">
                    重置密码
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            className={cn(buttonVariants(), "font-bold")}
            disabled={isLoading || disabled}
          >
            {isLoading && (
              <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            {submitLabel}
          </button>
        </div>
      </form>

      {showGoogle ? (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                或使用其他方式
              </span>
            </div>
          </div>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline" }), "font-bold")}
            onClick={() => {
              setIsGoogleLoading(true);
              authClient.signIn
                .social({
                  provider: "google",
                  callbackURL,
                })
                .catch((error) => {
                  console.warn("Google signIn error:", error);
                  toast.error("Google 登录暂不可用", {
                    description: "请使用邮箱和密码登录。",
                  });
                  setIsGoogleLoading(false);
                });
            }}
            disabled={isLoading || isGoogleLoading || disabled}
          >
            {isGoogleLoading ? (
              <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Icons.Google className="mr-2 h-4 w-4" />
            )}{" "}
            使用 Google 继续
          </button>
        </>
      ) : null}
    </div>
  );
}
