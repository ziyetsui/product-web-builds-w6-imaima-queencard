import Link from "next/link";
import { Wordmark } from "@/components/layout/Wordmark";

import { PricingPanel } from "@/components/pricing/pricing-panel";
import { getCreditPackPricingProducts } from "@/config/pricing-products";
import { pricingData } from "@/payment/subscriptions";

type SearchParamsValue = string | string[] | undefined;
type PricingPageProps = {
  searchParams?: Promise<Record<string, SearchParamsValue>> | Record<string, SearchParamsValue>;
};

function getSearchParam(
  searchParams: Record<string, SearchParamsValue>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getPricingNotice(searchParams: Record<string, SearchParamsValue>) {
  const checkout = getSearchParam(searchParams, "checkout");
  const billing = getSearchParam(searchParams, "billing");

  if (checkout === "success") {
    return {
      title: "支付结果确认中",
      description:
        "你已返回支付页面，支付结果仍需服务端确认。订阅或积分是否到账，以服务端 Webhook 处理结果和「我的积分」页面显示为准。",
    };
  }

  if (checkout === "cancelled") {
    return {
      title: "你已取消支付",
      description: "套餐没有变更，可以随时重新选择。",
    };
  }

  if (billing === "return") {
    return {
      title: "已返回套餐页",
      description: "如果你刚调整过订阅，状态可能需要几秒同步。",
    };
  }

  return null;
}

export default async function PricingPage({ searchParams }: PricingPageProps = {}) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const notice = getPricingNotice(resolvedSearchParams);
  const creditPacks = getCreditPackPricingProducts();

  return (
    <main className="min-h-screen bg-canvas-pink px-6 py-8 text-charcoal">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-10 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center transition-transform duration-200 hover:-translate-y-[1px]">
            <Wordmark className="text-charcoal text-[20px]" />
          </Link>
          <Link
            href="/credits"
            className="rounded-full border-2 border-charcoal bg-surface-white px-5 py-2 text-sm font-black shadow-[3px_3px_0_#000]"
          >
            我的积分
          </Link>
        </nav>

        <section className="mb-10 max-w-3xl">
          <p className="mb-3 inline-flex rounded-full border-2 border-charcoal bg-seafoam px-4 py-1 text-xs font-black">
            定价
          </p>
          <h1 className="font-alfa text-4xl leading-tight md:text-6xl">
            为持续生成爆款图文配置会员套餐
          </h1>
          <p className="mt-4 text-base font-bold leading-7 text-charcoal/75">
            选择适合你的积分套餐，用于生成、编辑和下载高质量图像。
          </p>
        </section>

        {notice ? (
          <section className="mb-6 rounded-[14px] border-2 border-charcoal bg-seafoam p-4 shadow-[4px_4px_0_#000]">
            <h2 className="text-base font-black">{notice.title}</h2>
            <p className="mt-1 text-sm font-bold text-charcoal/70">
              {notice.description}
            </p>
          </section>
        ) : null}

        <PricingPanel subscriptionPlans={pricingData} creditPacks={creditPacks} />
      </div>
    </main>
  );
}
