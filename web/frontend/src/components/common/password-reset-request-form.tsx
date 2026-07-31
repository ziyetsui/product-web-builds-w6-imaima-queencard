"use client";

import * as React from "react";
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

const resetRequestSchema = z.object({
  email: z.string().email("请输入有效的邮箱地址。"),
});

type ResetRequestData = z.infer<typeof resetRequestSchema>;

export function PasswordResetRequestForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetRequestData>({
    resolver: zodResolver(resetRequestSchema),
  });
  const [isLoading, setIsLoading] = React.useState(false);

  async function onSubmit(data: ResetRequestData) {
    setIsLoading(true);

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : "/reset-password";
      const result = await authClient.requestPasswordReset({
        email: data.email.toLowerCase(),
        redirectTo,
      });
      const authError = (result as { error?: { message?: string; statusText?: string } | null }).error;

      if (authError) {
        throw new Error(authError.message || authError.statusText || "Password reset failed");
      }

      toast.success("请检查邮箱", {
        description: "如果账号存在，重置链接已经发送。",
      });
    } catch (error) {
      console.warn("Password reset request error:", error);
      toast.error("发送失败", {
        description: "请稍后再试，或检查邮箱地址是否正确。",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
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
          disabled={isLoading}
          {...register("email")}
        />
        {errors.email ? (
          <p className="px-1 text-xs text-red-600">{errors.email.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        className={cn(buttonVariants(), "font-bold")}
        disabled={isLoading}
      >
        {isLoading ? <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
        发送重置链接
      </button>
    </form>
  );
}
