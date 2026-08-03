import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const subscriptionPlanEnum = pgEnum("SubscriptionPlan", [
  "FREE",
  "PRO",
  "BUSINESS",
]);

export const statusEnum = pgEnum("Status", [
  "PENDING",
  "CREATING",
  "INITING",
  "RUNNING",
  "STOPPED",
  "DELETED",
]);

export const creditTransTypeEnum = pgEnum("CreditTransType", [
  "NEW_USER",
  "ORDER_PAY",
  "SUBSCRIPTION",
  "VIDEO_CONSUME",
  "REFUND",
  "EXPIRED",
  "SYSTEM_ADJUST",
]);

export const creditPackageStatusEnum = pgEnum("CreditPackageStatus", [
  "ACTIVE",
  "DEPLETED",
  "EXPIRED",
]);

export const videoStatusEnum = pgEnum("VideoStatus", [
  "PENDING",
  "GENERATING",
  "UPLOADING",
  "COMPLETED",
  "FAILED",
]);

export const paymentFulfillmentStatusEnum = pgEnum("PaymentFulfillmentStatus", [
  "PENDING",
  "FULFILLED",
  "SKIPPED",
  "FAILED",
  "REFUNDED",
]);

export const adminRechargeStatusEnum = pgEnum("AdminRechargeStatus", [
  "PENDING",
  "FULFILLED",
  "PARTIALLY_REVOKED",
  "REVOKED",
  "FAILED",
]);

export const adminAuditActionEnum = pgEnum("AdminAuditAction", [
  "ADMIN_RECHARGE_CREATE",
  "ADMIN_RECHARGE_REVOKE",
  "ADMIN_NOTE_UPDATE",
]);

export const customers = pgTable(
  "Customer",
  {
    id: serial("id").primaryKey(),
    authUserId: text("authUserId").notNull(),
    name: text("name"),
    plan: subscriptionPlanEnum("plan"),
    stripeCustomerId: text("stripeCustomerId").unique(),
    stripeSubscriptionId: text("stripeSubscriptionId").unique(),
    stripePriceId: text("stripePriceId"),
    stripeCurrentPeriodEnd: timestamp("stripeCurrentPeriodEnd"),
    billingProvider: text("billing_provider"),
    billingCustomerId: text("billing_customer_id"),
    billingSubscriptionId: text("billing_subscription_id"),
    billingProductId: text("billing_product_id"),
    billingCurrentPeriodEnd: timestamp("billing_current_period_end"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    authUserIdIdx: index("Customer_authUserId_idx").on(table.authUserId),
  })
);

export const users = pgTable("user", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  isAdmin: boolean("isAdmin").default(false).notNull(),
});

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("userId").notNull(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("session_user_id_idx").on(table.userId),
  })
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("userId").notNull(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    idToken: text("idToken"),
    password: text("password"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("account_user_id_idx").on(table.userId),
    providerAccountIdIdx: uniqueIndex("account_provider_account_id_idx").on(
      table.providerId,
      table.accountId
    ),
  })
);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export const legacyAccounts = pgTable(
  "Account",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("userId").notNull(),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (table) => ({
    providerAccountIdIdx: uniqueIndex("Account_provider_account_id_idx").on(
      table.provider,
      table.providerAccountId
    ),
  })
);

export const legacySessions = pgTable("Session", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionToken: text("sessionToken").notNull().unique(),
  userId: text("userId").notNull(),
  expires: timestamp("expires").notNull(),
});

export const legacyUsers = pgTable("User", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified"),
  image: text("image"),
});

export const legacyVerificationTokens = pgTable(
  "VerificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: timestamp("expires").notNull(),
  },
  (table) => ({
    identifierTokenIdx: uniqueIndex("VerificationToken_identifier_token_idx").on(
      table.identifier,
      table.token
    ),
  })
);

export const k8sClusterConfigs = pgTable(
  "K8sClusterConfig",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    location: text("location").notNull(),
    authUserId: text("authUserId").notNull(),
    plan: subscriptionPlanEnum("plan").default("FREE"),
    network: text("network"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    status: statusEnum("status").default("PENDING"),
    delete: boolean("delete").default(false),
  },
  (table) => ({
    authUserIdIdx: index("K8sClusterConfig_authUserId_idx").on(table.authUserId),
  })
);

export const creditPackages = pgTable(
  "credit_packages",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    initialCredits: integer("initial_credits").notNull(),
    remainingCredits: integer("remaining_credits").notNull(),
    frozenCredits: integer("frozen_credits").default(0).notNull(),
    transType: creditTransTypeEnum("trans_type").notNull(),
    orderNo: text("order_no"),
    status: creditPackageStatusEnum("status").default("ACTIVE").notNull(),
    expiredAt: timestamp("expired_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("credit_packages_user_id_status_idx").on(
      table.userId,
      table.status
    ),
    userExpiredIdx: index("credit_packages_user_id_expired_at_idx").on(
      table.userId,
      table.expiredAt
    ),
  })
);

export const creditHolds = pgTable(
  "credit_holds",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    videoUuid: text("video_uuid").notNull().unique(),
    credits: integer("credits").notNull(),
    status: text("status").default("HOLDING").notNull(),
    packageAllocation: jsonb("package_allocation").notNull(),
    packageId: integer("package_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    settledAt: timestamp("settled_at"),
  },
  (table) => ({
    userIdx: index("credit_holds_user_id_idx").on(table.userId),
    statusIdx: index("credit_holds_status_idx").on(table.status),
    packageIdx: index("credit_holds_package_id_idx").on(table.packageId),
  })
);

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: serial("id").primaryKey(),
    transNo: text("trans_no").notNull().unique(),
    userId: text("user_id").notNull(),
    transType: creditTransTypeEnum("trans_type").notNull(),
    credits: integer("credits").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    packageId: integer("package_id"),
    videoUuid: text("video_uuid"),
    orderNo: text("order_no"),
    holdId: integer("hold_id"),
    remark: text("remark"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("credit_transactions_user_id_idx").on(table.userId),
    transTypeIdx: index("credit_transactions_trans_type_idx").on(table.transType),
    createdAtIdx: index("credit_transactions_created_at_idx").on(
      table.createdAt
    ),
  })
);

export const paymentFulfillments = pgTable(
  "payment_fulfillments",
  {
    id: serial("id").primaryKey(),
    fulfillmentKey: text("fulfillment_key").notNull(),
    provider: text("provider").default("stripe").notNull(),
    eventId: text("event_id"),
    eventType: text("event_type"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerCheckoutId: text("provider_checkout_id"),
    providerOrderId: text("provider_order_id"),
    providerTransactionId: text("provider_transaction_id"),
    providerRefundId: text("provider_refund_id"),
    providerDisputeId: text("provider_dispute_id"),
    providerProductId: text("provider_product_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSessionId: text("stripe_session_id"),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    stripeRefundId: text("stripe_refund_id"),
    productKey: text("product_key"),
    stripePriceId: text("stripe_price_id"),
    userId: text("user_id"),
    credits: integer("credits").default(0).notNull(),
    creditPackageId: integer("credit_package_id"),
    status: paymentFulfillmentStatusEnum("status").default("PENDING").notNull(),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    fulfilledAt: timestamp("fulfilled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    fulfillmentKeyIdx: uniqueIndex(
      "payment_fulfillments_fulfillment_key_idx"
    ).on(table.fulfillmentKey),
    providerIdx: index("payment_fulfillments_provider_idx").on(table.provider),
    userIdx: index("payment_fulfillments_user_id_idx").on(table.userId),
    eventIdx: index("payment_fulfillments_event_id_idx").on(table.eventId),
    statusIdx: index("payment_fulfillments_status_idx").on(table.status),
  })
);

export const adminRechargeOrders = pgTable(
  "admin_recharge_orders",
  {
    id: serial("id").primaryKey(),
    orderNo: text("order_no").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    userId: text("user_id").notNull(),
    adminUserId: text("admin_user_id").notNull(),
    credits: integer("credits").notNull(),
    currency: text("currency").default("CNY").notNull(),
    amountCents: integer("amount_cents"),
    paymentChannel: text("payment_channel"),
    externalPaymentNo: text("external_payment_no"),
    creditPackageId: integer("credit_package_id"),
    status: adminRechargeStatusEnum("status").default("PENDING").notNull(),
    refundedCredits: integer("refunded_credits").default(0).notNull(),
    manualReviewRequired: boolean("manual_review_required")
      .default(false)
      .notNull(),
    remark: text("remark"),
    metadata: jsonb("metadata"),
    fulfilledAt: timestamp("fulfilled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orderNoIdx: uniqueIndex("admin_recharge_orders_order_no_idx").on(
      table.orderNo
    ),
    idempotencyKeyIdx: uniqueIndex(
      "admin_recharge_orders_idempotency_key_idx"
    ).on(table.idempotencyKey),
    externalPaymentNoIdx: uniqueIndex(
      "admin_recharge_orders_external_payment_no_idx"
    ).on(table.externalPaymentNo),
    userIdx: index("admin_recharge_orders_user_id_idx").on(table.userId),
    adminUserIdx: index("admin_recharge_orders_admin_user_id_idx").on(
      table.adminUserId
    ),
    statusIdx: index("admin_recharge_orders_status_idx").on(table.status),
    createdAtIdx: index("admin_recharge_orders_created_at_idx").on(
      table.createdAt
    ),
  })
);

export const adminUserNotes = pgTable(
  "admin_user_notes",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    adminUserId: text("admin_user_id").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("admin_user_notes_user_id_idx").on(table.userId),
    createdAtIdx: index("admin_user_notes_created_at_idx").on(table.createdAt),
  })
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: serial("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    targetUserId: text("target_user_id"),
    action: adminAuditActionEnum("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    actorUserIdx: index("admin_audit_logs_actor_user_id_idx").on(
      table.actorUserId
    ),
    targetUserIdx: index("admin_audit_logs_target_user_id_idx").on(
      table.targetUserId
    ),
    actionIdx: index("admin_audit_logs_action_idx").on(table.action),
    createdAtIdx: index("admin_audit_logs_created_at_idx").on(table.createdAt),
  })
);

export const generationTasks = pgTable(
  "generation_tasks",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(),
    source: text("source").default("manual").notNull(),
    sourceCaseId: text("source_case_id"),
    sourceCaseCategory: text("source_case_category"),
    sourceNoteUrl: text("source_note_url"),
    sourceAuthorUrl: text("source_author_url"),
    prompt: text("prompt").notNull(),
    originalPrompt: text("original_prompt"),
    patternContext: jsonb("pattern_context"),
    referenceImages: jsonb("reference_images").default(sql`'[]'::jsonb`).notNull(),
    model: text("model").notNull(),
    providerModel: text("provider_model").notNull(),
    capability: text("capability").notNull(),
    aspectRatio: text("aspect_ratio").default("3:4").notNull(),
    size: text("size"),
    resolution: text("resolution").default("auto").notNull(),
    outputCount: integer("output_count").default(1).notNull(),
    status: text("status").default("queued").notNull(),
    requestedCredits: integer("requested_credits").default(0).notNull(),
    settledCredits: integer("settled_credits").default(0).notNull(),
    creditHoldKey: text("credit_hold_key"),
    provider: text("provider").default("gptproto").notNull(),
    providerTaskId: text("provider_task_id"),
    providerResultUrl: text("provider_result_url"),
    providerRaw: jsonb("provider_raw"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    idempotencyKey: text("idempotency_key"),
    parentTaskId: text("parent_task_id"),
    priority: smallint("priority").default(0).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    heartbeatAt: timestamp("heartbeat_at"),
    version: integer("version").default(0).notNull(),
    failureCategory: text("failure_category"),
    lastErrorAt: timestamp("last_error_at"),
  },
  (table) => ({
    userIdx: index("generation_tasks_user_id_idx").on(table.userId),
    statusIdx: index("generation_tasks_status_idx").on(table.status),
    sourceCaseIdx: index("generation_tasks_source_case_id_idx").on(
      table.sourceCaseId
    ),
    createdAtIdx: index("generation_tasks_created_at_idx").on(table.createdAt),
    userIdempotencyIdx: uniqueIndex(
      "generation_tasks_user_id_idempotency_key_idx"
    )
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    runnableIdx: index("generation_tasks_runnable_idx").on(
      table.status,
      table.priority.desc(),
      table.nextAttemptAt,
      table.createdAt
    ),
    expiredLeaseIdx: index("generation_tasks_expired_lease_idx")
      .on(table.status, table.leaseExpiresAt)
      .where(sql`${table.status} = 'running'`),
    attemptCountRange: check(
      "generation_tasks_attempt_count_range",
      sql`${table.attemptCount} >= 0 and ${table.attemptCount} <= ${table.maxAttempts}`
    ),
    maxAttemptsRange: check(
      "generation_tasks_max_attempts_range",
      sql`${table.maxAttempts} >= 1 and ${table.maxAttempts} <= 5`
    ),
    stateLeaseConsistency: check(
      "generation_tasks_state_lease_consistency",
      sql`(${table.status} = 'running' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null and ${table.heartbeatAt} is not null) or (${table.status} <> 'running' and ${table.leaseOwner} is null)`
    ),
  })
);

export const generationConcurrencyLeases = pgTable(
  "generation_concurrency_leases",
  {
    scopeKey: text("scope_key").notNull(),
    slotNumber: integer("slot_number").notNull(),
    taskId: text("task_id").notNull(),
    taskVersion: integer("task_version").notNull(),
    leaseOwner: text("lease_owner").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    heartbeatAt: timestamp("heartbeat_at").notNull(),
    acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
  },
  (table) => ({
    primaryKey: primaryKey({
      columns: [table.scopeKey, table.slotNumber],
      name: "generation_concurrency_leases_pk",
    }),
    taskScopeIdx: uniqueIndex(
      "generation_concurrency_leases_task_scope_idx"
    ).on(table.taskId, table.scopeKey),
    taskIdx: index("generation_concurrency_leases_task_id_idx").on(table.taskId),
    expiresIdx: index("generation_concurrency_leases_expires_at_idx").on(
      table.expiresAt
    ),
    slotPositive: check(
      "generation_concurrency_leases_slot_positive",
      sql`${table.slotNumber} >= 1`
    ),
  })
);

export const generatedAssets = pgTable(
  "generated_assets",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    taskId: text("task_id").notNull(),
    userId: text("user_id").notNull(),
    outputIndex: integer("output_index").notNull(),
    storageUrl: text("storage_url").notNull(),
    providerUrl: text("provider_url"),
    b64Json: text("b64_json"),
    mimeType: text("mime_type").default("image/png").notNull(),
    width: integer("width"),
    height: integer("height"),
    creditsCharged: integer("credits_charged").default(0).notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index("generated_assets_task_id_idx").on(table.taskId),
    userIdx: index("generated_assets_user_id_idx").on(table.userId),
    taskOutputIdx: uniqueIndex("generated_assets_task_output_idx").on(
      table.taskId,
      table.outputIndex
    ),
  })
);

export const videos = pgTable(
  "videos",
  {
    id: serial("id").primaryKey(),
    uuid: text("uuid").notNull().unique(),
    userId: text("user_id").notNull(),
    prompt: text("prompt").notNull(),
    model: text("model").notNull(),
    parameters: jsonb("parameters"),
    status: videoStatusEnum("status").default("PENDING").notNull(),
    provider: text("provider"),
    externalTaskId: text("external_task_id"),
    errorMessage: text("error_message"),
    startImageUrl: text("start_image_url"),
    originalVideoUrl: text("original_video_url"),
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    duration: integer("duration"),
    resolution: text("resolution"),
    aspectRatio: text("aspect_ratio"),
    fileSize: integer("file_size"),
    creditsUsed: integer("credits_used").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    generationTime: integer("generation_time"),
    isDeleted: boolean("is_deleted").default(false).notNull(),
  },
  (table) => ({
    userIdx: index("videos_user_id_idx").on(table.userId),
    statusIdx: index("videos_status_idx").on(table.status),
    createdAtIdx: index("videos_created_at_idx").on(table.createdAt),
  })
);

export type Customer = typeof customers.$inferSelect;
export type BetterAuthUser = typeof users.$inferSelect;
export type CreditPackage = typeof creditPackages.$inferSelect;
export type CreditHold = typeof creditHolds.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type PaymentFulfillment = typeof paymentFulfillments.$inferSelect;
export type AdminRechargeOrder = typeof adminRechargeOrders.$inferSelect;
export type AdminUserNote = typeof adminUserNotes.$inferSelect;
export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type GenerationTask = typeof generationTasks.$inferSelect;
export type GeneratedAsset = typeof generatedAssets.$inferSelect;
export type Video = typeof videos.$inferSelect;

export const SubscriptionPlan = {
  FREE: "FREE",
  PRO: "PRO",
  BUSINESS: "BUSINESS",
} as const;
export type SubscriptionPlan =
  (typeof SubscriptionPlan)[keyof typeof SubscriptionPlan];

export const CreditTransType = {
  NEW_USER: "NEW_USER",
  ORDER_PAY: "ORDER_PAY",
  SUBSCRIPTION: "SUBSCRIPTION",
  VIDEO_CONSUME: "VIDEO_CONSUME",
  REFUND: "REFUND",
  EXPIRED: "EXPIRED",
  SYSTEM_ADJUST: "SYSTEM_ADJUST",
} as const;
export type CreditTransType =
  (typeof CreditTransType)[keyof typeof CreditTransType];

export const CreditPackageStatus = {
  ACTIVE: "ACTIVE",
  DEPLETED: "DEPLETED",
  EXPIRED: "EXPIRED",
} as const;
export type CreditPackageStatus =
  (typeof CreditPackageStatus)[keyof typeof CreditPackageStatus];

export const VideoStatus = {
  PENDING: "PENDING",
  GENERATING: "GENERATING",
  UPLOADING: "UPLOADING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type VideoStatus = (typeof VideoStatus)[keyof typeof VideoStatus];

export const PaymentFulfillmentStatus = {
  PENDING: "PENDING",
  FULFILLED: "FULFILLED",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type PaymentFulfillmentStatus =
  (typeof PaymentFulfillmentStatus)[keyof typeof PaymentFulfillmentStatus];

export const AdminRechargeStatus = {
  PENDING: "PENDING",
  FULFILLED: "FULFILLED",
  PARTIALLY_REVOKED: "PARTIALLY_REVOKED",
  REVOKED: "REVOKED",
  FAILED: "FAILED",
} as const;
export type AdminRechargeStatus =
  (typeof AdminRechargeStatus)[keyof typeof AdminRechargeStatus];

export const AdminAuditAction = {
  ADMIN_RECHARGE_CREATE: "ADMIN_RECHARGE_CREATE",
  ADMIN_RECHARGE_REVOKE: "ADMIN_RECHARGE_REVOKE",
  ADMIN_NOTE_UPDATE: "ADMIN_NOTE_UPDATE",
} as const;
export type AdminAuditAction =
  (typeof AdminAuditAction)[keyof typeof AdminAuditAction];
