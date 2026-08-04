"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { CheckoutButton } from "@/components/common/checkout-button";
import type { PricingProduct, PricingProductKey } from "@/config/pricing-products";
import type { SubscriptionPlan } from "@/payment/subscriptions";

type PricingMode = "one-time" | "monthly" | "yearly";

type PricingPanelProps = {
  subscriptionPlans: SubscriptionPlan[];
  creditPacks: PricingProduct[];
};

type DisplayCard = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  price: number;
  priceSuffix: string;
  creditLine: string;
  benefits: string[];
  productKey: PricingProductKey | null;
  cta: string;
  tone: "lemon" | "seafoam";
  paymentNote: string;
  highlighted?: boolean;
  href?: string;
};

const modes: Array<{
  value: PricingMode;
  label: string;
  helper?: string;
}> = [
  { value: "one-time", label: "一次性" },
  { value: "monthly", label: "月付" },
  { value: "yearly", label: "年付", helper: "省约 17%" },
];

function formatCny(amount: number) {
  return `¥${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function getSubscriptionCreditLine(plan: SubscriptionPlan, mode: PricingMode) {
  if (plan.title === "免费版") return "注册即送欢迎积分";
  return mode === "yearly"
    ? plan.benefits.find((benefit) => benefit.includes("年付")) ?? plan.benefits[0]
    : plan.benefits[0];
}

function toSubscriptionCards(
  plans: SubscriptionPlan[],
  mode: Exclude<PricingMode, "one-time">
): DisplayCard[] {
  return plans.flatMap((plan, index) => {
    const isFree = plan.pricesCny.monthly === 0;

    if (isFree) return [];

    const productKey = mode === "yearly" ? plan.productKeys.yearly : plan.productKeys.monthly;
    const price = mode === "yearly" ? plan.pricesCny.yearly : plan.pricesCny.monthly;

    return [
      {
        id: `${plan.title}-${mode}`,
        title: plan.title,
        eyebrow: `[ ${plan.title} ]`,
        description: plan.description,
        price,
        priceSuffix: isFree ? "/ 月" : mode === "yearly" ? "/ 年" : "/ 月",
        creditLine: getSubscriptionCreditLine(plan, mode),
        benefits: plan.benefits,
        productKey,
        cta: isFree ? "免费开始" : mode === "yearly" ? "选择年付" : "选择月付",
        tone: index === 1 ? "lemon" : "seafoam",
        paymentNote: isFree
          ? "注册后领取欢迎积分"
          : "银行卡 / Apple Pay / Link · 支付宝订阅开通后支持",
        highlighted: index === 1,
        href: isFree ? "/register" : undefined,
      },
    ];
  });
}

function toCreditPackCards(packs: PricingProduct[]): DisplayCard[] {
  return packs.map((pack, index) => ({
    id: pack.key,
    title: pack.title,
    eyebrow: `[ ${pack.title} ]`,
    description: pack.description,
    price: pack.priceCny,
    priceSuffix: "一次性",
    creditLine: `${pack.credits.toLocaleString("zh-CN")} 积分`,
    benefits: pack.features,
    productKey: pack.key,
    cta: "购买积分包",
    tone: index === 1 ? "lemon" : "seafoam",
    paymentNote: "银行卡 / 支付宝 / 微信支付 · 积分到账后即可使用",
    highlighted: index === 1,
  }));
}

export function PricingPanel({
  subscriptionPlans,
  creditPacks,
}: PricingPanelProps) {
  const [mode, setMode] = useState<PricingMode>("one-time");
  const cards = useMemo(() => {
    if (mode === "one-time") return toCreditPackCards(creditPacks);
    return toSubscriptionCards(subscriptionPlans, mode);
  }, [creditPacks, mode, subscriptionPlans]);
  const cardGridClass =
    cards.length === 2
      ? "grid gap-5 md:mx-auto md:max-w-4xl md:grid-cols-2"
      : "grid gap-5 md:grid-cols-3";

  return (
    <section className="mt-10">
      <div className="mx-auto mb-7 grid w-full max-w-2xl grid-cols-3 gap-2 rounded-[18px] border-2 border-charcoal bg-surface-white p-2 shadow-[5px_5px_0_#000]">
        {modes.map((item) => {
          const active = item.value === mode;

          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(item.value)}
              className={[
                "min-h-12 rounded-[12px] border-2 px-2 text-sm font-black transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal focus-visible:ring-offset-2",
                active
                  ? "border-charcoal bg-charcoal text-surface-white shadow-[3px_3px_0_#f0e83f]"
                  : "border-transparent bg-transparent text-charcoal/60 hover:border-charcoal hover:bg-canvas-pink",
              ].join(" ")}
            >
              <span>{item.label}</span>
              {item.helper ? (
                <span
                  className={[
                    "ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black",
                    active ? "bg-seafoam text-charcoal" : "bg-lemon text-charcoal",
                  ].join(" ")}
                >
                  {item.helper}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={cardGridClass}>
        {cards.map((card) => (
          <article
            key={card.id}
            className={[
              "flex min-h-[560px] flex-col overflow-hidden rounded-[18px] border-2 border-charcoal bg-surface-white shadow-[8px_8px_0_#000]",
              card.highlighted ? "md:-translate-y-2" : "",
            ].join(" ")}
          >
            <div className="flex min-h-[220px] flex-col border-b-2 border-charcoal p-6">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-black tracking-[0.22em] text-charcoal/55">
                  {card.eyebrow}
                </p>
                {card.highlighted ? (
                  <span className="rounded-full border-2 border-charcoal bg-lemon px-3 py-1 text-[11px] font-black shadow-[2px_2px_0_#000]">
                    推荐
                  </span>
                ) : null}
              </div>
              <h2 className="mt-5 font-alfa text-3xl leading-none md:text-4xl">
                {card.title}
              </h2>
              <p className="mt-3 min-h-12 text-sm font-bold leading-6 text-charcoal/65">
                {card.description}
              </p>

              <div
                className={[
                  "mt-auto rounded-[14px] border-2 border-charcoal p-4",
                  card.tone === "lemon" ? "bg-lemon" : "bg-seafoam",
                ].join(" ")}
              >
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-black text-charcoal/70">
                      {card.creditLine}
                    </p>
                    <div className="mt-1 flex flex-wrap items-end gap-2">
                      <span className="font-alfa text-4xl leading-none md:text-5xl">
                        {formatCny(card.price)}
                      </span>
                      <span className="pb-1 text-sm font-black text-charcoal/70">
                        {card.priceSuffix}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-1 flex-col p-6">
              <ul className="grid gap-4 text-sm font-bold">
                {card.benefits.map((benefit) => (
                  <li key={benefit} className="flex gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-8">
                {card.href ? (
                  <Link
                    href={card.href}
                    className="inline-flex h-11 w-full items-center justify-center rounded-full border-2 border-charcoal bg-charcoal px-4 text-sm font-black text-surface-white shadow-[4px_4px_0_#000] transition hover:-translate-y-0.5 hover:bg-charcoal/90"
                  >
                    {card.cta}
                  </Link>
                ) : (
                  <CheckoutButton productKey={card.productKey} label={card.cta} />
                )}
                <p className="mt-5 text-center text-xs font-black text-charcoal/35">
                  {card.paymentNote}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
