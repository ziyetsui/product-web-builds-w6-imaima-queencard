import { adminAuditLogs, db, type AdminAuditAction } from "@/db";

type AuditDb = Pick<typeof db, "insert">;

export type AdminAuditRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type WriteAdminAuditLogParams = {
  actorUserId: string;
  targetUserId?: string | null;
  action: AdminAuditAction;
  entityType: string;
  entityId?: string | number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestMeta?: AdminAuditRequestMeta;
};

export async function writeAdminAuditLogInTx(
  trx: AuditDb,
  params: WriteAdminAuditLogParams
) {
  await trx.insert(adminAuditLogs).values({
    actorUserId: params.actorUserId,
    targetUserId: params.targetUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId:
      params.entityId === null || params.entityId === undefined
        ? null
        : String(params.entityId),
    before: params.before ?? null,
    after: params.after ?? null,
    ipAddress: params.requestMeta?.ipAddress ?? null,
    userAgent: params.requestMeta?.userAgent ?? null,
  });
}

export async function writeAdminAuditLog(params: WriteAdminAuditLogParams) {
  await writeAdminAuditLogInTx(db, params);
}
