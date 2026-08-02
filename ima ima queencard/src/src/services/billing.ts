import type Stripe from "stripe";

import { customers, db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { stripe } from "@/payment";
import { pricingData } from "@/payment/subscriptions";
import {
  getProductByCreemProductId,
  getPricingProduct,
  resolveCreemProductId,
  resolveStripePriceId,
} from "@/config/pricing-products";
import { ensureCustomer } from "@/services/customer";
import { createPendingFulfillment } from "@/services/payment-fulfillment";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export type UserSubscriptionPlan = {
  title: string;
  description: string;
  benefits: string[];
  limitations: string[];
  prices: {
    monthly: number;
    yearly: number;
  };
  stripeIds: {
    monthly: string | null;
    yearly: string | null;
  };
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeCurrentPeriodEnd: number;
  isPaid: boolean;
  interval: "month" | "year" | null;
  isCanceled?: boolean;
};

export type StripeSessionResult =
  | { success: true; url: string }
  | { success: false; url: null; error?: string };

export type CheckoutSessionResult = StripeSessionResult;

function getAppUrl() {
  const fallbackOrigin = "http://localhost:8080";
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configuredUrl) return fallbackOrigin;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallbackOrigin;
    }
    return url.origin;
  } catch {
    return fallbackOrigin;
  }
}

export function getStripeReturnUrls() {
  const appUrl = getAppUrl();
  return {
    checkoutSuccessUrl: `${appUrl}/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    checkoutCancelUrl: `${appUrl}/pricing?checkout=cancelled`,
    portalReturnUrl: `${appUrl}/pricing?billing=return`,
  };
}

export function getCreemReturnUrls() {
  const appUrl = getAppUrl();
  return {
    checkoutSuccessUrl: `${appUrl}/pricing?checkout=success&provider=creem`,
  };
}

function getCreemApiBaseUrl() {
  const configured = process.env.CREEM_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  return process.env.CREEM_API_KEY?.startsWith("creem_test_")
    ? "https://test-api.creem.io/v1"
    : "https://api.creem.io/v1";
}

function getCheckoutUrl(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const payload = response as Record<string, unknown>;
  const checkoutUrl = payload.checkout_url ?? payload.checkoutUrl ?? payload.url;
  return typeof checkoutUrl === "string" && checkoutUrl.trim()
    ? checkoutUrl.trim()
    : null;
}

function getCheckoutId(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const id = (response as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export async function createCreemCheckout(
  userId: string,
  productKey: string
): Promise<CheckoutSessionResult> {
  const product = getPricingProduct(productKey);
  if (!product) {
    return {
      success: false as const,
      url: null,
      error: "Missing or invalid product key",
    };
  }

  const creemProductId = resolveCreemProductId(product.key);
  if (!creemProductId) {
    return {
      success: false as const,
      url: null,
      error: "Missing or invalid Creem product ID",
    };
  }

  const creemApiKey = process.env.CREEM_API_KEY?.trim();
  if (!creemApiKey) {
    return {
      success: false as const,
      url: null,
      error: "CREEM_API_KEY is not configured",
    };
  }

  const customer = await ensureCustomer(userId);
  const user = await getCurrentUser();
  if (!user?.email) {
    return { success: false as const, url: null, error: "Missing user email" };
  }

  const { checkoutSuccessUrl } = getCreemReturnUrls();
  const requestId = `imaima:${userId}:${product.key}:${nanoid(12)}`;
  const metadata = {
    userId,
    productKey: product.key,
    mode: product.mode,
    credits: String(product.credits),
    referenceId: userId,
  };

  const response = await fetch(`${getCreemApiBaseUrl()}/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": creemApiKey,
    },
    body: JSON.stringify({
      product_id: creemProductId,
      request_id: requestId,
      success_url: checkoutSuccessUrl,
      metadata,
      customer: {
        email: user.email,
      },
    }),
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      success: false as const,
      url: null,
      error:
        (responseBody as { message?: string; error?: string } | null)?.message ||
        (responseBody as { message?: string; error?: string } | null)?.error ||
        `Creem checkout failed with status ${response.status}`,
    };
  }

  const checkoutUrl = getCheckoutUrl(responseBody);
  if (!checkoutUrl) {
    return {
      success: false as const,
      url: null,
      error: "Creem checkout response did not include a checkout URL",
    };
  }

  const checkoutId = getCheckoutId(responseBody);
  if (checkoutId) {
    await createPendingFulfillment({
      provider: "creem",
      fulfillmentKey: `creem:checkout:${checkoutId}:${product.key}`,
      providerCheckoutId: checkoutId,
      providerProductId: creemProductId,
      providerCustomerId: customer?.billingCustomerId ?? null,
      productKey: product.key,
      userId,
      credits: product.credits,
      metadata: {
        requestId,
        creemProductId,
        creemBillingType: product.creemBillingType,
        creemBillingPeriod: product.creemBillingPeriod,
      },
    });
  }

  return { success: true as const, url: checkoutUrl };
}

export async function createStripeSession(userId: string, productKey: string) {
  const product = getPricingProduct(productKey);
  if (!product) {
    return {
      success: false as const,
      url: null,
      error: "Missing or invalid product key",
    };
  }

  const stripePriceId = resolveStripePriceId(product.key);
  if (!stripePriceId) {
    return {
      success: false as const,
      url: null,
      error: "Missing or invalid Stripe price ID",
    };
  }

  const customer = await ensureCustomer(userId);
  const { checkoutSuccessUrl, checkoutCancelUrl, portalReturnUrl } =
    getStripeReturnUrls();

  if (product.mode === "subscription" && customer?.plan && customer.plan !== "FREE") {
    if (!customer.stripeCustomerId) {
      return {
        success: false as const,
        url: null,
        error: "Missing Stripe customer for paid plan",
      };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: portalReturnUrl,
    });
    return { success: true as const, url: session.url };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false as const, url: null, error: "Missing user" };
  }
  if (!user.email) {
    return { success: false as const, url: null, error: "Missing user email" };
  }
  const email = user.email;
  const metadata = {
    userId,
    productKey: product.key,
    mode: product.mode,
    credits: String(product.credits),
  };

  const checkoutParams: Stripe.Checkout.SessionCreateParams = {
    mode: product.mode,
    client_reference_id: userId,
    metadata,
    cancel_url: checkoutCancelUrl,
    success_url: checkoutSuccessUrl,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    ...(customer?.stripeCustomerId
      ? { customer: customer.stripeCustomerId }
      : { customer_email: email }),
  };

  if (product.mode === "subscription") {
    checkoutParams.subscription_data = { metadata };
  } else {
    checkoutParams.payment_intent_data = { metadata };
  }

  const session = await stripe.checkout.sessions.create(checkoutParams);

  if (!session.url) {
    return {
      success: false as const,
      url: null,
      error: "Stripe checkout did not return a URL",
    };
  }
  return { success: true as const, url: session.url };
}

export async function getUserPlans(userId: string): Promise<UserSubscriptionPlan | undefined> {
  const [custom] = await db
    .select({
      stripeSubscriptionId: customers.stripeSubscriptionId,
      stripeCurrentPeriodEnd: customers.stripeCurrentPeriodEnd,
      stripeCustomerId: customers.stripeCustomerId,
      stripePriceId: customers.stripePriceId,
      billingProvider: customers.billingProvider,
      billingSubscriptionId: customers.billingSubscriptionId,
      billingProductId: customers.billingProductId,
      billingCurrentPeriodEnd: customers.billingCurrentPeriodEnd,
    })
    .from(customers)
    .where(eq(customers.authUserId, userId))
    .limit(1);

  if (!custom) {
    return undefined;
  }

  const billingProduct = getProductByCreemProductId(custom.billingProductId);
  const activeProductId = billingProduct?.key ?? custom.stripePriceId;
  const activePeriodEnd =
    custom.billingCurrentPeriodEnd ?? custom.stripeCurrentPeriodEnd;
  const isPaid =
    !!activeProductId &&
    !!activePeriodEnd &&
    activePeriodEnd.getTime() + 86_400_000 > Date.now();

  const customPlan =
    pricingData.find((plan) => plan.productKeys.monthly === activeProductId) ??
    pricingData.find((plan) => plan.productKeys.yearly === activeProductId) ??
    pricingData.find((plan) => plan.stripeIds.monthly === custom.stripePriceId) ??
    pricingData.find((plan) => plan.stripeIds.yearly === custom.stripePriceId);
  const plan = isPaid && customPlan ? customPlan : pricingData[0]!;

  const interval = isPaid
    ? customPlan?.productKeys.monthly === activeProductId ||
      customPlan?.stripeIds.monthly === custom.stripePriceId
      ? "month"
      : customPlan?.productKeys.yearly === activeProductId ||
          customPlan?.stripeIds.yearly === custom.stripePriceId
        ? "year"
        : null
    : null;

  let isCanceled = false;
  if (
    isPaid &&
    (!custom.billingProvider || custom.billingProvider === "stripe") &&
    custom.stripeSubscriptionId
  ) {
    const stripePlan = await stripe.subscriptions.retrieve(
      custom.stripeSubscriptionId
    );
    isCanceled = stripePlan.cancel_at_period_end;
  }

  return {
    ...plan,
    ...custom,
    stripeCurrentPeriodEnd: activePeriodEnd?.getTime() ?? 0,
    isPaid,
    interval,
    isCanceled,
  };
}

export async function getMySubscription(userId: string) {
  const [customer] = await db
    .select({
      plan: customers.plan,
      stripeSubscriptionId: customers.stripeSubscriptionId,
      stripeCurrentPeriodEnd: customers.stripeCurrentPeriodEnd,
      billingProvider: customers.billingProvider,
      billingSubscriptionId: customers.billingSubscriptionId,
      billingCurrentPeriodEnd: customers.billingCurrentPeriodEnd,
    })
    .from(customers)
    .where(eq(customers.authUserId, userId))
    .limit(1);

  if (!customer) {
    return {
      plan: "FREE" as const,
      status: "inactive" as const,
      cancelAtPeriodEnd: false,
      endsAt: null,
    };
  }

  const storedEndsAt =
    customer.billingCurrentPeriodEnd ?? customer.stripeCurrentPeriodEnd;
  const stripeSubscriptionId =
    (!customer.billingProvider || customer.billingProvider === "stripe")
      ? customer.stripeSubscriptionId ?? customer.billingSubscriptionId
      : null;

  if (stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );
    const legacyPeriodEnd = (
      subscription as Stripe.Subscription & { current_period_end?: number }
    ).current_period_end;
    const itemPeriodEnds = subscription.items.data
      .map(
        (item) =>
          (item as Stripe.SubscriptionItem & { current_period_end?: number })
            .current_period_end
      )
      .filter((value): value is number => typeof value === "number");
    const livePeriodEnd =
      legacyPeriodEnd ??
      (itemPeriodEnds.length > 0 ? Math.max(...itemPeriodEnds) : null);
    const scheduledCancelAt =
      subscription.status === "active" &&
      typeof subscription.cancel_at === "number" &&
      subscription.cancel_at * 1000 > Date.now()
        ? subscription.cancel_at
        : null;

    return {
      plan: customer.plan ?? "FREE",
      status: subscription.status,
      cancelAtPeriodEnd:
        subscription.cancel_at_period_end || scheduledCancelAt !== null,
      endsAt: scheduledCancelAt
        ? new Date(scheduledCancelAt * 1000)
        : livePeriodEnd
          ? new Date(livePeriodEnd * 1000)
          : storedEndsAt,
    };
  }

  const isActive =
    customer.plan !== null &&
    customer.plan !== "FREE" &&
    storedEndsAt !== null &&
    storedEndsAt.getTime() > Date.now();

  return {
    plan: customer.plan ?? "FREE",
    status: isActive ? ("active" as const) : ("inactive" as const),
    cancelAtPeriodEnd: false,
    endsAt: storedEndsAt,
  };
}
