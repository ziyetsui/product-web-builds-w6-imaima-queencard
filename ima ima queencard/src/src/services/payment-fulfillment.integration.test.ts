import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const paymentTestDatabaseUrl = process.env.PAYMENT_TEST_DATABASE_URL?.trim();
const describeWithDatabase = paymentTestDatabaseUrl ? describe : describe.skip;

describeWithDatabase("payment fulfillment PostgreSQL integration", () => {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const concurrentUserId = `payment_test_concurrent_${runId}`;
  const rollbackUserId = `payment_test_rollback_${runId}`;
  const concurrentKey = `stripe:payment_test:${runId}:concurrent`;
  const rollbackKey = `stripe:payment_test:${runId}:rollback`;
  const sql = postgres(paymentTestDatabaseUrl!, { max: 4 });
  let fulfillCreditGrantOnce: typeof import("./payment-fulfillment").fulfillCreditGrantOnce;

  beforeAll(async () => {
    process.env.DATABASE_URL = paymentTestDatabaseUrl;
    ({ fulfillCreditGrantOnce } = await import("./payment-fulfillment"));

    const [{ paymentFulfillmentsTable }] = await sql<
      { paymentFulfillmentsTable: string | null }[]
    >`select to_regclass('public.payment_fulfillments')::text as "paymentFulfillmentsTable"`;
    expect(paymentFulfillmentsTable).toBe("payment_fulfillments");
  });

  afterAll(async () => {
    await sql`delete from credit_transactions where user_id in (${concurrentUserId}, ${rollbackUserId})`;
    await sql`delete from payment_fulfillments where fulfillment_key in (${concurrentKey}, ${rollbackKey})`;
    await sql`delete from credit_packages where user_id in (${concurrentUserId}, ${rollbackUserId})`;
    await sql.end();
  });

  it("grants one package and transaction under three concurrent deliveries", async () => {
    const params = {
      fulfillmentKey: concurrentKey,
      userId: concurrentUserId,
      productKey: "credit_creator",
      credits: 600,
      transType: "ORDER_PAY" as const,
      orderNo: `stripe_payment_test_${runId}`,
      expiryDays: 365,
      remark: "Payment fulfillment concurrency test",
    };

    const results = await Promise.all([
      fulfillCreditGrantOnce(params),
      fulfillCreditGrantOnce(params),
      fulfillCreditGrantOnce(params),
    ]);

    expect(results.filter((result) => result.fulfilled)).toHaveLength(1);
    const [counts] = await sql<
      { packages: number; transactions: number; fulfillments: number }[]
    >`
      select
        (select count(*)::int from credit_packages where user_id = ${concurrentUserId}) as packages,
        (select count(*)::int from credit_transactions where user_id = ${concurrentUserId}) as transactions,
        (select count(*)::int from payment_fulfillments where fulfillment_key = ${concurrentKey} and status = 'FULFILLED') as fulfillments
    `;
    expect(counts).toEqual({ packages: 1, transactions: 1, fulfillments: 1 });
  });

  it("rolls back the package and fulfillment when the transaction balance overflows", async () => {
    await sql`
      insert into credit_packages (
        user_id, initial_credits, remaining_credits, frozen_credits,
        trans_type, order_no, status, updated_at
      ) values (
        ${rollbackUserId}, 2000000000, 2000000000, 0,
        'ORDER_PAY', ${`payment_test_seed_${runId}`}, 'ACTIVE', now()
      )
    `;

    await expect(
      fulfillCreditGrantOnce({
        fulfillmentKey: rollbackKey,
        userId: rollbackUserId,
        productKey: "credit_studio",
        credits: 2_000_000_000,
        transType: "ORDER_PAY",
        orderNo: `stripe_payment_test_rollback_${runId}`,
        expiryDays: 365,
        remark: "Payment fulfillment rollback test",
      })
    ).rejects.toThrow();

    const [counts] = await sql<
      { packages: number; transactions: number; fulfillments: number }[]
    >`
      select
        (select count(*)::int from credit_packages where user_id = ${rollbackUserId}) as packages,
        (select count(*)::int from credit_transactions where user_id = ${rollbackUserId}) as transactions,
        (select count(*)::int from payment_fulfillments where fulfillment_key = ${rollbackKey}) as fulfillments
    `;
    expect(counts).toEqual({ packages: 1, transactions: 0, fulfillments: 0 });
  });
});
