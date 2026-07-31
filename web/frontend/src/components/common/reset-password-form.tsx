"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { authClient } from "@/lib/auth/client";
import { buttonVariants } from "@/components/ui/button";
import * as Icons from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/components/ui";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "密码至少需要 8 位字符。"),
    confirmPassword: z.string().min(8, "密码至少需要 8 位字符。"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次输入的密码不一致。",
    path: ["confirmPassword"],
  });

type ResetPasswordData = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams?.get("token") ?? "";
  const error = searchParams?.get("error");
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordData>({
    resolver: zodResolver(resetPasswordSchema),
  });
  const [isLoading, setIsLoading] = React.useState(false);

  async function onSubmit(data: ResetPasswordData) {
    if (!token) return;
    setIsLoading(true);

    try {
      const result = await authClient.resetPassword({
        newPassword: data.password,
        token,
      });
      const authError = (result as { error?: { message?: string; statusText?: string } | null }).error;

      if (authError) {
        throw new Error(authError.message || authError.statusText || "Password reset failed");
      }

      toast.success("密码已更新", {
        description: "请使用新密码登录。",
      });
      router.push("/login");
    } catch (resetError) {
      console.warn("Reset password error:", resetError);
      toast.error("重置失败", {
        description: "链接可能已经失效，请重新发送重置链接。",
      });
    } finally {
      setIsLoading(false);
    }
  }

  if (error || !token) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-zinc-600">
          这个重置链接不存在或已经失效。
        </p>
        <Link href="/forgot-password" className="text-sm font-bold text-[#ef724f] underline-offset-4 hover:underline">
          重新发送重置链接
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
      <div className="grid gap-1">
        <Label className="sr-only" htmlFor="password">
          新密码
        </Label>
        <Input
          id="password"
          placeholder="输入新密码"
          type="password"
          autoComplete="new-password"
          disabled={isLoading}
          {...register("password")}
        />
        {errors.password ? (
          <p className="px-1 text-xs text-red-600">{errors.password.message}</p>
        ) : null}
      </div>

      <div className="grid gap-1">
        <Label className="sr-only" htmlFor="confirmPassword">
          确认新密码
        </Label>
        <Input
          id="confirmPassword"
          placeholder="再次输入新密码"
          type="password"
          autoComplete="new-password"
          disabled={isLoading}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword ? (
          <p className="px-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        className={cn(buttonVariants(), "font-bold")}
        disabled={isLoading}
      >
        {isLoading ? <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
        重置密码
      </button>
    </form>
  );
}
