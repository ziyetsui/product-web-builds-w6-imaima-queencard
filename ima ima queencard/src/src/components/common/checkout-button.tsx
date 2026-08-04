"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface CheckoutButtonProps {
  productKey: string | null;
  label: string;
  disabled?: boolean;
}

const CHECKOUT_HOSTS = new Set([
  "checkout.stripe.com",
  "billing.stripe.com",
  "checkout.creem.io",
  "pancake.waffo.ai",
]);

class UnsafeCheckoutUrlError extends Error {}

export function isAllowedCheckoutUrl(
  value: unknown,
  environment = process.env.NODE_ENV
) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    if (url.protocol === "https:" && CHECKOUT_HOSTS.has(url.hostname)) {
      return true;
    }

    return (
      environment === "development" &&
      url.protocol === "http:" &&
      url.origin === window.location.origin
    );
  } catch {
    return false;
  }
}

export function getCheckoutEndpoint(
  provider = process.env.NEXT_PUBLIC_BILLING_PROVIDER
) {
  if (provider === "creem") return "/api/billing/creem/checkout";
  if (provider === "waffo") return "/api/billing/waffo/checkout";
  return "/api/billing/stripe/checkout";
}

export function CheckoutButton({
  productKey,
  label,
  disabled,
}: CheckoutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function startCheckout() {
    if (!productKey) {
      toast.error("套餐暂未配置", {
        description: "请先完成产品配置。",
      });
      return;
    }

    setLoading(true);
    const configuredProvider = process.env.NEXT_PUBLIC_BILLING_PROVIDER;
    const provider =
      configuredProvider === "creem" || configuredProvider === "waffo"
        ? configuredProvider
        : "stripe";
    const providerName =
      provider === "creem" ? "Creem" : provider === "waffo" ? "Waffo" : "Stripe";
    try {
      const response = await fetch(getCheckoutEndpoint(provider), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey }),
      });

      if (response.status === 401) {
        router.push("/login?from=/pricing");
        return;
      }

      const result = await response.json();
      const url = result?.data?.url;

      if (!response.ok || !result?.data?.success || !url) {
        throw new Error(result?.error?.message || "Failed to create checkout session");
      }

      if (!isAllowedCheckoutUrl(url)) {
        throw new UnsafeCheckoutUrlError("Unsafe checkout URL");
      }

      window.location.href = url;
    } catch (error) {
      console.warn("Checkout session error:", error);
      toast.error("无法创建支付链接", {
        description:
          error instanceof UnsafeCheckoutUrlError
            ? "支付服务返回了不安全的跳转地址。"
            : `请检查 ${providerName} 环境变量和产品配置是否已经完成。`,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      className="w-full rounded-full border-2 border-charcoal bg-charcoal text-surface-white shadow-[4px_4px_0_#000] hover:-translate-y-0.5 hover:bg-charcoal/90"
      disabled={disabled || loading || !productKey}
      onClick={startCheckout}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}
