import { SubscriptionPlan, customers, db, users } from "@/db";
import { and, eq } from "drizzle-orm";

export async function updateUserName(userId: string, name: string) {
  await db.update(users).set({ name }).where(eq(users.id, userId));
}

export async function getCustomerByUserId(userId: string) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.authUserId, userId))
    .limit(1);
  return customer ?? null;
}

export async function getCustomerByStripeCustomerId(stripeCustomerId: string) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return customer ?? null;
}

export async function getCustomerByStripeSubscriptionId(
  stripeSubscriptionId: string
) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return customer ?? null;
}

export async function getCustomerByBillingCustomerId(
  billingProvider: string,
  billingCustomerId: string
) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.billingProvider, billingProvider),
        eq(customers.billingCustomerId, billingCustomerId)
      )
    )
    .limit(1);
  return customer ?? null;
}

export async function getCustomerByBillingSubscriptionId(
  billingProvider: string,
  billingSubscriptionId: string
) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.billingProvider, billingProvider),
        eq(customers.billingSubscriptionId, billingSubscriptionId)
      )
    )
    .limit(1);
  return customer ?? null;
}

export async function ensureCustomer(userId: string) {
  const existing = await getCustomerByUserId(userId);
  if (existing) return existing;

  const [created] = await db
    .insert(customers)
    .values({
      authUserId: userId,
      plan: SubscriptionPlan.FREE,
    })
    .returning();

  return created ?? null;
}

type StripeCustomerFields = {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  stripeCurrentPeriodEnd?: Date | null;
  billingProvider?: string | null;
  billingCustomerId?: string | null;
  billingSubscriptionId?: string | null;
  billingProductId?: string | null;
  billingCurrentPeriodEnd?: Date | null;
  plan?: SubscriptionPlan | null;
};

async function updateCustomerById(id: number, values: StripeCustomerFields) {
  const [updated] = await db
    .update(customers)
    .set({
      ...values,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, id))
    .returning();

  return updated ?? null;
}

export async function upsertCustomerByAuthUserId(
  authUserId: string,
  values: StripeCustomerFields
) {
  const existing = await getCustomerByUserId(authUserId);
  if (existing) {
    return updateCustomerById(existing.id, values);
  }

  const [created] = await db
    .insert(customers)
    .values({
      authUserId,
      plan: values.plan ?? SubscriptionPlan.FREE,
      stripeCustomerId: values.stripeCustomerId ?? null,
      stripeSubscriptionId: values.stripeSubscriptionId ?? null,
      stripePriceId: values.stripePriceId ?? null,
      stripeCurrentPeriodEnd: values.stripeCurrentPeriodEnd ?? null,
      billingProvider: values.billingProvider ?? null,
      billingCustomerId: values.billingCustomerId ?? null,
      billingSubscriptionId: values.billingSubscriptionId ?? null,
      billingProductId: values.billingProductId ?? null,
      billingCurrentPeriodEnd: values.billingCurrentPeriodEnd ?? null,
    })
    .returning();

  return created ?? null;
}

export async function updateCustomerByStripeCustomerId(
  stripeCustomerId: string,
  values: StripeCustomerFields
) {
  const existing = await getCustomerByStripeCustomerId(stripeCustomerId);
  if (!existing) return null;
  return updateCustomerById(existing.id, values);
}

export async function updateCustomerByStripeSubscriptionId(
  stripeSubscriptionId: string,
  values: StripeCustomerFields
) {
  const existing = await getCustomerByStripeSubscriptionId(stripeSubscriptionId);
  if (!existing) return null;
  return updateCustomerById(existing.id, values);
}

export async function updateCustomerByBillingCustomerId(
  billingProvider: string,
  billingCustomerId: string,
  values: StripeCustomerFields
) {
  const existing = await getCustomerByBillingCustomerId(
    billingProvider,
    billingCustomerId
  );
  if (!existing) return null;
  return updateCustomerById(existing.id, values);
}

export async function updateCustomerByBillingSubscriptionId(
  billingProvider: string,
  billingSubscriptionId: string,
  values: StripeCustomerFields
) {
  const existing = await getCustomerByBillingSubscriptionId(
    billingProvider,
    billingSubscriptionId
  );
  if (!existing) return null;
  return updateCustomerById(existing.id, values);
}
