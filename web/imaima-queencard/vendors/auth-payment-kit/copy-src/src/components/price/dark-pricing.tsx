"use client";

import { useMemo, useState, useTransition } from "react";
import Balancer from "react-wrap-balancer";
import { IconCheck, IconX } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { creem } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as Icons from "@/components/ui/icons";

import { useSigninModal } from "@/hooks/use-signin-modal";
import {
  getLocalizedOnetimePackages,
  getLocalizedSubscriptionPackages,
  type CreditsDictionary,
  type LocalizedPackage,
} from "@/hooks/use-credit-packages";
import { useCredits } from "@/stores/credits-store";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface DarkPricingProps {
  userId?: string;
  dictPrice: Record<string, string>;
  dictCredits: CreditsDictionary;
}

type PricingTab = "onetime" | "monthly" | "yearly";
type FeatureItem = {
  text: string;
  included: boolean;
};

function formatPrice(cents: number): string {
  const value = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `$${value}`;
}

// 定义标准功能列表（所有产品功能的并集）
function getStandardFeatures(products: LocalizedPackage[]): FeatureItem[] {
  // 收集所有产品的功能
  const allFeatures = products.flatMap(p => p.localizedFeatures);
  // 去重
  const uniqueFeatures = Array.from(new Set(allFeatures));

  return uniqueFeatures.map(feature => ({
    text: feature,
    included: false, // 默认为 false，每个产品会自己设置
  }));
}

export function DarkPricing({
  userId,
  dictPrice,
  dictCredits,
}: DarkPricingProps) {
  const t = useTranslations("PricingCards");
  const [activeTab, setActiveTab] = useState<PricingTab>("monthly");
  const [hasAccess, setHasAccess] = useState(false);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const signInModal = useSigninModal();
  const { balance } = useCredits();
  const userPlan = balance?.plan || "FREE";
  const isFreeUser = !userPlan || userPlan === "FREE";

  // 组织产品数据
  const allSubscriptionProducts = useMemo(
    () =>
      getLocalizedSubscriptionPackages(dictCredits).sort(
        (a, b) => a.credits - b.credits
      ),
    [dictCredits]
  );

  const onetimeProducts = useMemo(
    () =>
      getLocalizedOnetimePackages(dictCredits).sort(
        (a, b) => a.credits - b.credits
      ),
    [dictCredits]
  );

  const monthlyProducts = useMemo(
    () => allSubscriptionProducts.filter((p) => p.billingPeriod === "month"),
    [allSubscriptionProducts]
  );

  const yearlyProducts = useMemo(
    () => allSubscriptionProducts.filter((p) => p.billingPeriod === "year"),
    [allSubscriptionProducts]
  );

  const handleCheckout = (product: LocalizedPackage) => {
    if (!userId) {
      signInModal.onOpen();
      return;
    }

    startTransition(async () => {
      const origin = window.location.origin;
      // 支付成功后跳转到 credits 页面
      // 如果当前不在 pricing 页面（例如嵌入在其他页面的弹窗），则设置 returnTo 以便跳回
      // 如果本来就在 pricing 页面，则不设置 returnTo，让用户停留在 credits 页面查看余额
      const currentPath = window.location.pathname;
      const isPricingPage = currentPath.includes("/pricing");
      const returnTo = isPricingPage ? "" : encodeURIComponent(currentPath);

      const successUrl = returnTo
        ? `${origin}/credits?payment=success&returnTo=${returnTo}`
        : `${origin}/credits?payment=success`;

      const { data, error } = await creem.createCheckout({
        productId: product.id,
        successUrl,
        metadata: {
          plan: product.id,
        },
      });

      if (error) {
        toast.error("Checkout error", {
          description: error.message ?? "Failed to create checkout session.",
        });
        return;
      }

      if (!data || !("url" in data) || !data.url) {
        toast.error("Checkout error", {
          description: "Missing checkout URL from Creem.",
        });
        return;
      }

      window.location.href = data.url;
    });
  };

  const handlePortal = async () => {
    const { data, error } = await creem.createPortal();
    if (error) {
      toast.error("Portal error", {
        description: error.message ?? "Failed to open customer portal.",
      });
      return;
    }

    if (!data || !("url" in data) || !data.url) {
      toast.error("Portal error", {
        description: "Missing portal URL from Creem.",
      });
      return;
    }

    window.location.href = data.url;
  };

  // 获取当前 tab 的产品
  const getCurrentProducts = () => {
    switch (activeTab) {
      case "onetime":
        return onetimeProducts;
      case "monthly":
        return monthlyProducts;
      case "yearly":
        return yearlyProducts;
      default:
        return [];
    }
  };

  const currentProducts = getCurrentProducts();
  const buyCreditsLabel = dictCredits.buy_credits ?? "Buy Credits";

  // 计算标准功能列表（所有产品的功能并集）
  const standardFeatures = useMemo(() => {
    return getStandardFeatures(currentProducts);
  }, [currentProducts]);

  return (
    <section className="flex flex-col items-center text-center py-6 md:py-6">
      {/* Tab 切换 */}
      <div className="mb-6 mx-auto flex justify-center font-plex-mono lowercase text-[11px] tracking-widest">
        <div className="inline-flex rounded-none border border-white/20 p-1 bg-transparent">
          <TabButton
            active={activeTab === "onetime"}
            onClick={() => setActiveTab("onetime")}
          >
            {t("onetime")}
          </TabButton>
          <TabButton
            active={activeTab === "monthly"}
            onClick={() => setActiveTab("monthly")}
          >
            {t("monthly")}
          </TabButton>
          <TabButton
            active={activeTab === "yearly"}
            onClick={() => setActiveTab("yearly")}
            showBadge
          >
            {t("yearly")}
            <span className="ml-1.5 rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
              20% OFF
            </span>
          </TabButton>
        </div>
      </div>

      {/* 价格卡片 */}
      {currentProducts.length > 0 ? (
        <div className="mx-auto grid gap-5 bg-inherit py-5 md:grid-cols-[repeat(3,minmax(0,360px))] justify-center">
          {currentProducts.map((product, index) => {
            const isRecommended = product.popular === true;
            const isCurrent = activeProductId === product.id && hasAccess;

            // 为每个产品生成对齐后的功能列表
            const alignedFeatures = standardFeatures.map(feature => ({
              ...feature,
              included: product.localizedFeatures.some(f => f === feature.text),
            }));

            // 检查是否允许免费用户购买
            const isRestricted = isFreeUser && product.allowFreeUser === false;

            return (
              <PricingCard
                key={product.id}
                product={product}
                features={alignedFeatures}
                isRecommended={isRecommended}
                isCurrent={isCurrent}
                userId={userId}
                isPending={isPending}
                isRestricted={isRestricted} // Pass restriction status
                buyCreditsLabel={buyCreditsLabel}
                dictPrice={dictPrice}
                dictCredits={dictCredits}
                onCheckout={handleCheckout}
                onPortal={handlePortal}
                signInModal={signInModal}
              />
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center text-muted-foreground">
          {t("no_products")}
        </div>
      )}
    </section>
  );
}

// ============================================
// Tab Button Component
// ============================================

interface TabButtonProps {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  showBadge?: boolean;
}

function TabButton({ active, children, onClick, showBadge }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-6 py-2 transition-all duration-200 uppercase tracking-widest border border-transparent",
        !showBadge && "pr-6",
        active
          ? "border-white/40 text-white"
          : "text-white/40 hover:text-white/80"
      )}
    >
      {children}
    </button>
  );
}

// ============================================
// Pricing Card Component
// ============================================

interface PricingCardProps {
  product: LocalizedPackage;
  features: FeatureItem[];
  isRecommended: boolean;
  isCurrent: boolean;
  userId?: string;
  isPending: boolean;
  buyCreditsLabel: string;
  dictPrice: Record<string, string>;
  dictCredits: CreditsDictionary;
  onCheckout: (product: LocalizedPackage) => void;
  onPortal: () => void;
  signInModal: { onOpen: () => void };
  isRestricted?: boolean;
}

function PricingCard({
  product,
  features,
  isRecommended,
  isCurrent,
  userId,
  isPending,
  buyCreditsLabel,
  dictPrice,
  dictCredits,
  onCheckout,
  onPortal,
  signInModal,
  isRestricted = false,
}: PricingCardProps) {
  const t = useTranslations("PricingCards");

  return (
    <div
      className={cn(
        "relative flex flex-col font-plex-mono border transition-all duration-500",
        isRecommended
          ? "border-white/30 z-10 bg-white/[0.02]"
          : "border-white/10 bg-transparent hover:border-white/20"
      )}
    >
      <div className={cn(
        "min-h-[140px] items-start space-y-4 p-8 border-b border-white/10"
      )}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-normal lowercase tracking-[0.2em] text-white/30">
            [ {product.displayName} ]
          </p>
          {isRecommended && (
            <span className="text-[8px] px-1.5 py-0.5 border border-white/20 text-white/50 uppercase tracking-widest">
              preferred
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <div className="text-3xl font-light text-white tracking-tighter">
              {formatPrice(product.price.amount)}
            </div>
            <div className="text-[10px] font-light text-white/30 lowercase tracking-[0.1em]">
              {product.billingPeriod ? (product.billingPeriod === "year" ? t("per_year") : t("per_month")) : "one-time"}
            </div>
          </div>
          {product.credits && (
            <div className="text-[10px] text-white/40 tracking-[0.05em] lowercase">
              — {product.credits.toLocaleString()} production credits
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-between gap-12 p-8">
        <ul className="space-y-4">
          {features.filter(f => f.included).map((feature, idx) => (
            <li className="flex items-start gap-4" key={idx}>
              <Icons.Check className="mt-0.5 h-3 w-3 shrink-0 text-white/40" strokeWidth={1.5} />
              <p className="text-[10px] text-white/60 lowercase tracking-[0.05em] leading-relaxed">
                {feature.text}
              </p>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          {userId ? (
            isCurrent ? (
              <button
                onClick={onPortal}
                className="w-full py-3 text-[10px] font-light tracking-[0.2em] lowercase border border-white/20 text-white/60 hover:border-white/60 hover:text-white transition-all"
              >
                {dictPrice.manage_subscription}
              </button>
            ) : (
              <button
                disabled={isPending || isRestricted}
                onClick={() => onCheckout(product)}
                className={cn(
                  "w-full py-3 text-[10px] font-light tracking-[0.2em] lowercase border transition-all",
                  isRecommended
                    ? "border-white/60 text-white bg-white/5"
                    : "border-white/20 text-white/50 hover:border-white/60 hover:text-white"
                )}
              >
                {isPending ? "processing..." : isRestricted ? "subscribers only" : (product.billingPeriod ? dictPrice.upgrade : buyCreditsLabel)}
              </button>
            )
          ) : (
            <button
              onClick={signInModal.onOpen}
              className={cn(
                "w-full py-3 text-[10px] font-light tracking-[0.2em] lowercase border transition-all",
                isRecommended
                  ? "border-white/60 text-white bg-white/5"
                  : "border-white/20 text-white/50 hover:border-white/60 hover:text-white"
              )}
            >
              start creating
            </button>
          )}
          <p className="text-[8px] text-center text-white/20 tracking-[0.1em] lowercase py-2">
            secure encryption • no long-term commitment required
          </p>
        </div>
      </div>
    </div>
  );
}

