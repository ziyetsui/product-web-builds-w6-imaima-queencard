import {
  AdminAuditAction,
  AdminRechargeStatus,
  CreditPackageStatus,
  CreditTransType,
  adminRechargeOrders,
  adminUserNotes,
  creditPackages,
  creditTransactions,
  customers,
  db,
  users,
  type AdminRechargeOrder,
  type BetterAuthUser,
} from "@/db";
import { ADMIN_RECHARGE_CONFIG } from "@/config/admin-recharge";
import { ApiError } from "@/lib/api/error";
import {
  getCreditBalanceInTx,
  grantCreditsInTx,
  creditService,
} from "@/services/credit";
import {
  type AdminAuditRequestMeta,
  writeAdminAuditLogInTx,
} from "@/services/admin-audit";
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

type AdminDb = Pick<typeof db, "insert" | "select" | "update">;

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const createAdminRechargeSchema = z.object({
  userId: z.string().trim().min(1),
  credits: z.coerce
    .number()
    .int()
    .min(ADMIN_RECHARGE_CONFIG.minCredits)
    .max(ADMIN_RECHARGE_CONFIG.maxCreditsPerOrder),
  amountCents: z.coerce.number().int().nonnegative().optional().nullable(),
  currency: z
    .enum(ADMIN_RECHARGE_CONFIG.supportedCurrencies)
    .default(ADMIN_RECHARGE_CONFIG.defaultCurrency),
  paymentChannel: z
    .enum(ADMIN_RECHARGE_CONFIG.paymentChannels)
    .optional()
    .nullable(),
  externalPaymentNo: optionalTrimmedString,
  remark: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const updateAdminUserNoteSchema = z.object({
  userId: z.string().trim().min(1),
  note: z.string().trim().max(500),
});

export const revokeAdminRechargeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export type CreateAdminRechargeInput = z.input<
  typeof createAdminRechargeSchema
>;
export type UpdateAdminUserNoteInput = z.input<
  typeof updateAdminUserNoteSchema
>;
export type RevokeAdminRechargeInput = z.input<
  typeof revokeAdminRechargeSchema
>;

export type AdminUserListParams = {
  q?: string | null;
  rechargeStatus?: "all" | "recharged" | "never_recharged" | null;
  lowBalance?: boolean;
  page?: number;
  pageSize?: number;
};

export type AdminRechargeUserRow = {
  userId: string;
  email: string;
  name: string | null;
  status: "active";
  role: "admin" | "user";
  createdAt: Date;
  isPaidUser: boolean;
  inviteCode: string | null;
  availableCredits: number;
  frozenCredits: number;
  usedCredits: number;
  totalCredits: number;
  latestRecharge: {
    orderId: number;
    orderNo: string;
    credits: number;
    createdAt: Date;
    adminEmail: string | null;
  } | null;
  note: string | null;
};

function clampPage(value: number | undefined) {
  if (!Number.isFinite(value ?? 1)) return 1;
  return Math.max(1, Math.floor(value ?? 1));
}

function clampPageSize(value: number | undefined) {
  if (!Number.isFinite(value ?? ADMIN_RECHARGE_CONFIG.defaultPageSize)) {
    return ADMIN_RECHARGE_CONFIG.defaultPageSize;
  }
  return Math.min(
    ADMIN_RECHARGE_CONFIG.maxPageSize,
    Math.max(1, Math.floor(value ?? ADMIN_RECHARGE_CONFIG.defaultPageSize))
  );
}

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeOptional(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function getMatchingRechargeUserIds(query: string) {
  const pattern = `%${query}%`;
  const rows = await db
    .select({ userId: adminRechargeOrders.userId })
    .from(adminRechargeOrders)
    .where(
      or(
        ilike(adminRechargeOrders.orderNo, pattern),
        ilike(adminRechargeOrders.externalPaymentNo, pattern),
        ilike(adminRechargeOrders.remark, pattern)
      )
    )
    .limit(1000);

  return Array.from(new Set(rows.map((row) => row.userId)));
}

async function getRechargedUserIds() {
  const rows = await db
    .select({ userId: adminRechargeOrders.userId })
    .from(adminRechargeOrders)
    .where(eq(adminRechargeOrders.status, AdminRechargeStatus.FULFILLED));

  return Array.from(new Set(rows.map((row) => row.userId)));
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function listAdminRechargeUsers(params: AdminUserListParams = {}) {
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const offset = (page - 1) * pageSize;
  const q = params.q?.trim();
  const filters: SQL[] = [];

  if (q) {
    const matchingRechargeUserIds = await getMatchingRechargeUserIds(q);
    const searchFilters: SQL[] = [
      ilike(users.email, `%${q}%`),
      ilike(users.name, `%${q}%`),
      ilike(users.id, `%${q}%`),
    ];
    if (matchingRechargeUserIds.length > 0) {
      searchFilters.push(inArray(users.id, matchingRechargeUserIds));
    }
    filters.push(or(...searchFilters)!);
  }

  if (params.rechargeStatus && params.rechargeStatus !== "all") {
    const rechargedUserIds = await getRechargedUserIds();
    if (params.rechargeStatus === "recharged") {
      filters.push(
        rechargedUserIds.length > 0
          ? inArray(users.id, rechargedUserIds)
          : sql`false`
      );
    } else if (rechargedUserIds.length > 0) {
      filters.push(notInArray(users.id, rechargedUserIds));
    }
  }

  const whereClause = filters.length > 0 ? and(...filters) : undefined;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(whereClause);

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      isAdmin: users.isAdmin,
      plan: customers.plan,
      billingCustomerId: customers.billingCustomerId,
      stripeCustomerId: customers.stripeCustomerId,
    })
    .from(users)
    .leftJoin(customers, eq(customers.authUserId, users.id))
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset);

  const userIds = userRows.map((row) => row.id);
  if (userIds.length === 0) {
    return {
      items: [],
      page,
      pageSize,
      total: toNumber(countRow?.count),
      summary: {
        totalUsers: toNumber(countRow?.count),
        currentPageUsers: 0,
        currentPageAvailableCredits: 0,
        todayManualRechargeCredits: 0,
        todayManualRechargeUsers: 0,
      },
    };
  }

  const now = new Date();
  const balanceRows = await db
    .select({
      userId: creditPackages.userId,
      totalCredits: sql<number>`coalesce(sum(${creditPackages.initialCredits}), 0)`,
      availableCredits: sql<number>`coalesce(sum(${creditPackages.remainingCredits}), 0)`,
      frozenCredits: sql<number>`coalesce(sum(${creditPackages.frozenCredits}), 0)`,
    })
    .from(creditPackages)
    .where(
      and(
        inArray(creditPackages.userId, userIds),
        eq(creditPackages.status, CreditPackageStatus.ACTIVE),
        or(isNull(creditPackages.expiredAt), gt(creditPackages.expiredAt, now))
      )
    )
    .groupBy(creditPackages.userId);

  const balances = new Map(
    balanceRows.map((row) => {
      const totalCredits = toNumber(row.totalCredits);
      const availableCredits = toNumber(row.availableCredits);
      const frozenCredits = toNumber(row.frozenCredits);
      return [
        row.userId,
        {
          totalCredits,
          availableCredits,
          frozenCredits,
          usedCredits: Math.max(0, totalCredits - availableCredits - frozenCredits),
        },
      ];
    })
  );

  const rechargeRows = await db
    .select()
    .from(adminRechargeOrders)
    .where(inArray(adminRechargeOrders.userId, userIds))
    .orderBy(desc(adminRechargeOrders.createdAt));
  const latestRechargeByUser = new Map<string, AdminRechargeOrder>();
  for (const row of rechargeRows) {
    if (!latestRechargeByUser.has(row.userId)) {
      latestRechargeByUser.set(row.userId, row);
    }
  }

  const adminIds = Array.from(
    new Set(rechargeRows.map((row) => row.adminUserId).filter(Boolean))
  );
  const adminRows =
    adminIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, adminIds))
      : [];
  const adminEmailById = new Map(
    adminRows.map((row) => [row.id, row.email] as const)
  );

  const noteRows = await db
    .select()
    .from(adminUserNotes)
    .where(inArray(adminUserNotes.userId, userIds))
    .orderBy(desc(adminUserNotes.createdAt));
  const latestNoteByUser = new Map<string, string>();
  for (const row of noteRows) {
    if (!latestNoteByUser.has(row.userId)) {
      latestNoteByUser.set(row.userId, row.note);
    }
  }

  let items: AdminRechargeUserRow[] = userRows.map((row) => {
    const balance = balances.get(row.id) ?? {
      totalCredits: 0,
      availableCredits: 0,
      frozenCredits: 0,
      usedCredits: 0,
    };
    const latestRecharge = latestRechargeByUser.get(row.id);

    return {
      userId: row.id,
      email: row.email,
      name: row.name,
      status: "active",
      role: row.isAdmin ? "admin" : "user",
      createdAt: row.createdAt,
      isPaidUser: Boolean(
        latestRecharge ||
          row.plan ||
          row.billingCustomerId ||
          row.stripeCustomerId
      ),
      inviteCode: null,
      ...balance,
      latestRecharge: latestRecharge
        ? {
            orderId: latestRecharge.id,
            orderNo: latestRecharge.orderNo,
            credits: latestRecharge.credits,
            createdAt: latestRecharge.createdAt,
            adminEmail: adminEmailById.get(latestRecharge.adminUserId) ?? null,
          }
        : null,
      note: latestNoteByUser.get(row.id) ?? null,
    };
  });

  if (params.lowBalance) {
    items = items.filter(
      (item) =>
        item.availableCredits <= ADMIN_RECHARGE_CONFIG.lowBalanceThreshold
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayRechargeRows = await db
    .select({
      credits: adminRechargeOrders.credits,
      userId: adminRechargeOrders.userId,
    })
    .from(adminRechargeOrders)
    .where(
      and(
        eq(adminRechargeOrders.status, AdminRechargeStatus.FULFILLED),
        gt(adminRechargeOrders.createdAt, todayStart)
      )
    );

  return {
    items,
    page,
    pageSize,
    total: toNumber(countRow?.count),
    summary: {
      totalUsers: toNumber(countRow?.count),
      currentPageUsers: items.length,
      currentPageAvailableCredits: items.reduce(
        (sum, item) => sum + item.availableCredits,
        0
      ),
      todayManualRechargeCredits: todayRechargeRows.reduce(
        (sum, row) => sum + row.credits,
        0
      ),
      todayManualRechargeUsers: new Set(
        todayRechargeRows.map((row) => row.userId)
      ).size,
    },
  };
}

async function getCurrentBalance(userId: string) {
  return creditService.getBalance(userId);
}

async function getTargetUser(trx: Pick<typeof db, "select">, userId: string) {
  const [targetUser] = await trx
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return targetUser ?? null;
}

function buildOrderNo() {
  return `ADMIN_RECHARGE_${formatDateKey()}_${nanoid(8)}`;
}

async function getExistingOrderByIdempotencyKey(
  idempotencyKey: string
): Promise<AdminRechargeOrder | null> {
  const [existing] = await db
    .select()
    .from(adminRechargeOrders)
    .where(eq(adminRechargeOrders.idempotencyKey, idempotencyKey))
    .limit(1);

  return existing ?? null;
}

async function assertExternalPaymentNoUnused(
  trx: Pick<typeof db, "select">,
  externalPaymentNo: string | null
) {
  if (!externalPaymentNo) return;

  const [existing] = await trx
    .select({ id: adminRechargeOrders.id })
    .from(adminRechargeOrders)
    .where(eq(adminRechargeOrders.externalPaymentNo, externalPaymentNo))
    .limit(1);

  if (existing) {
    throw new ApiError("External payment number has already been used", 409);
  }
}

export async function createAdminRecharge(
  adminUser: Pick<BetterAuthUser, "id"> & { email?: string | null },
  input: CreateAdminRechargeInput,
  requestMeta?: AdminAuditRequestMeta
) {
  const parsed = createAdminRechargeSchema.parse(input);
  const externalPaymentNo = normalizeOptional(parsed.externalPaymentNo);

  const existingByIdempotency = await getExistingOrderByIdempotencyKey(
    parsed.idempotencyKey
  );
  if (existingByIdempotency?.status === AdminRechargeStatus.FULFILLED) {
    const balance = await getCurrentBalance(existingByIdempotency.userId);
    return {
      orderId: existingByIdempotency.id,
      orderNo: existingByIdempotency.orderNo,
      packageId: existingByIdempotency.creditPackageId,
      availableCredits: balance.availableCredits,
      idempotent: true,
    };
  }
  if (existingByIdempotency) {
    throw new ApiError("Recharge request is already being processed", 409);
  }

  return db.transaction(async (trx) => {
    const targetUser = await getTargetUser(trx, parsed.userId);
    if (!targetUser) {
      throw new ApiError("Target user not found", 404);
    }

    await assertExternalPaymentNoUnused(trx, externalPaymentNo);

    const orderNo = buildOrderNo();
    const [order] = await trx
      .insert(adminRechargeOrders)
      .values({
        orderNo,
        idempotencyKey: parsed.idempotencyKey,
        userId: parsed.userId,
        adminUserId: adminUser.id,
        credits: parsed.credits,
        currency: parsed.currency,
        amountCents: parsed.amountCents ?? null,
        paymentChannel: parsed.paymentChannel ?? null,
        externalPaymentNo,
        status: AdminRechargeStatus.PENDING,
        remark: parsed.remark,
        metadata: {
          targetEmail: targetUser.email,
          adminEmail: adminUser.email,
        },
        updatedAt: new Date(),
      })
      .returning();

    if (!order) {
      throw new ApiError("Failed to create recharge order", 500);
    }

    const grant = await grantCreditsInTx(trx, {
      userId: parsed.userId,
      credits: parsed.credits,
      orderNo,
      transType: CreditTransType.SYSTEM_ADJUST,
      expiryDays: ADMIN_RECHARGE_CONFIG.defaultExpiryDays,
      remark: `人工充值到账：${parsed.credits} 积分`,
    });

    const [updatedOrder] = await trx
      .update(adminRechargeOrders)
      .set({
        creditPackageId: grant.packageId,
        status: AdminRechargeStatus.FULFILLED,
        fulfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adminRechargeOrders.id, order.id))
      .returning();

    await writeAdminAuditLogInTx(trx, {
      actorUserId: adminUser.id,
      targetUserId: parsed.userId,
      action: AdminAuditAction.ADMIN_RECHARGE_CREATE,
      entityType: "admin_recharge_order",
      entityId: order.id,
      after: {
        orderNo,
        credits: parsed.credits,
        packageId: grant.packageId,
        externalPaymentNo,
      },
      requestMeta,
    });

    return {
      orderId: order.id,
      orderNo,
      packageId: grant.packageId,
      availableCredits: grant.balanceAfter,
      order: updatedOrder ?? order,
      idempotent: false,
    };
  });
}

async function refundAdminOrderCreditsInTx(
  trx: AdminDb,
  order: AdminRechargeOrder,
  reason: string
) {
  const packages = await trx
    .select()
    .from(creditPackages)
    .where(
      and(
        eq(creditPackages.userId, order.userId),
        eq(creditPackages.orderNo, order.orderNo)
      )
    )
    .orderBy(desc(creditPackages.createdAt));

  let remainingToRefund = Math.max(0, order.credits - order.refundedCredits);
  let refundedCredits = 0;

  for (const pkg of packages) {
    if (remainingToRefund <= 0) break;
    if (pkg.status !== CreditPackageStatus.ACTIVE || pkg.remainingCredits <= 0) {
      continue;
    }

    const creditsToRefund = Math.min(pkg.remainingCredits, remainingToRefund);
    const nextRemainingCredits = pkg.remainingCredits - creditsToRefund;

    await trx
      .update(creditPackages)
      .set({
        remainingCredits: nextRemainingCredits,
        status:
          nextRemainingCredits === 0 && pkg.frozenCredits === 0
            ? CreditPackageStatus.DEPLETED
            : pkg.status,
        updatedAt: new Date(),
      })
      .where(eq(creditPackages.id, pkg.id));

    refundedCredits += creditsToRefund;
    remainingToRefund -= creditsToRefund;
  }

  const refundOrderNo = `${order.orderNo}:REFUND:${nanoid(8)}`;
  const balance = await getCreditBalanceInTx(trx, order.userId);
  await trx.insert(creditTransactions).values({
    transNo: `TXN${Date.now()}${nanoid(6)}`,
    userId: order.userId,
    transType: CreditTransType.REFUND,
    credits: -refundedCredits,
    balanceAfter: balance.availableCredits,
    orderNo: refundOrderNo,
    remark: `人工充值撤回：${reason}`,
  });

  return {
    refundedCredits,
    unrefundedCredits: Math.max(0, remainingToRefund),
    requiresManualReview: remainingToRefund > 0,
    availableCredits: balance.availableCredits,
  };
}

export async function revokeAdminRecharge(
  superAdminUser: Pick<BetterAuthUser, "id"> & { email?: string | null },
  orderId: number,
  input: RevokeAdminRechargeInput,
  requestMeta?: AdminAuditRequestMeta
) {
  const parsed = revokeAdminRechargeSchema.parse(input);

  return db.transaction(async (trx) => {
    const [order] = await trx
      .select()
      .from(adminRechargeOrders)
      .where(eq(adminRechargeOrders.id, orderId))
      .limit(1);

    if (!order) {
      throw new ApiError("Recharge order not found", 404);
    }
    if (order.status !== AdminRechargeStatus.FULFILLED) {
      throw new ApiError("Only fulfilled recharge orders can be revoked", 400);
    }

    const refund = await refundAdminOrderCreditsInTx(trx, order, parsed.reason);
    const totalRefundedCredits = order.refundedCredits + refund.refundedCredits;
    const remainingUnrefundedCredits = Math.max(
      0,
      order.credits - totalRefundedCredits
    );
    const nextStatus =
      remainingUnrefundedCredits === 0
        ? AdminRechargeStatus.REVOKED
        : AdminRechargeStatus.PARTIALLY_REVOKED;

    const [updatedOrder] = await trx
      .update(adminRechargeOrders)
      .set({
        status: nextStatus,
        refundedCredits: totalRefundedCredits,
        manualReviewRequired: remainingUnrefundedCredits > 0,
        updatedAt: new Date(),
      })
      .where(eq(adminRechargeOrders.id, order.id))
      .returning();

    await writeAdminAuditLogInTx(trx, {
      actorUserId: superAdminUser.id,
      targetUserId: order.userId,
      action: AdminAuditAction.ADMIN_RECHARGE_REVOKE,
      entityType: "admin_recharge_order",
      entityId: order.id,
      before: {
        status: order.status,
        refundedCredits: order.refundedCredits,
      },
      after: {
        status: nextStatus,
        refundedCredits: totalRefundedCredits,
        reason: parsed.reason,
      },
      requestMeta,
    });

    return {
      order: updatedOrder ?? order,
      refundedCredits: refund.refundedCredits,
      unrefundedCredits: remainingUnrefundedCredits,
      manualReviewRequired: remainingUnrefundedCredits > 0,
      availableCredits: refund.availableCredits,
    };
  });
}

export async function updateAdminUserNote(
  adminUser: Pick<BetterAuthUser, "id"> & { email?: string | null },
  input: UpdateAdminUserNoteInput,
  requestMeta?: AdminAuditRequestMeta
) {
  const parsed = updateAdminUserNoteSchema.parse(input);

  return db.transaction(async (trx) => {
    const targetUser = await getTargetUser(trx, parsed.userId);
    if (!targetUser) {
      throw new ApiError("Target user not found", 404);
    }

    const note = parsed.note || "-";
    const [created] = await trx
      .insert(adminUserNotes)
      .values({
        userId: parsed.userId,
        adminUserId: adminUser.id,
        note,
      })
      .returning();

    await writeAdminAuditLogInTx(trx, {
      actorUserId: adminUser.id,
      targetUserId: parsed.userId,
      action: AdminAuditAction.ADMIN_NOTE_UPDATE,
      entityType: "admin_user_note",
      entityId: created?.id,
      after: {
        note,
      },
      requestMeta,
    });

    return {
      userId: parsed.userId,
      note,
      noteId: created?.id,
    };
  });
}

export async function getAdminRechargeHistory(userId: string) {
  const orders = await db
    .select()
    .from(adminRechargeOrders)
    .where(eq(adminRechargeOrders.userId, userId))
    .orderBy(desc(adminRechargeOrders.createdAt))
    .limit(20);

  return { orders };
}
