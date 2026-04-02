import prisma from "../config/database";
import type {
  PrismaClient,
  Prisma,
  AuditLogStatus,
  AuditResourceType,
} from "../generated/prisma/client";

type DbLike = PrismaClient | Prisma.TransactionClient;

export type AuditWriteInput = {
  action: string;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  status?: AuditLogStatus;
  actorId?: string | null;
  actorName?: string | null;
  requestId?: string | null;
  metadata?: any;
};

export async function writeAuditLog(db: DbLike, input: AuditWriteInput) {
  return db.auditLog.create({
    data: {
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      status: input.status ?? "INFO",
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? null,
    },
  });
}

function clampLimit(value: unknown, fallback = 20, max = 100) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function listAuditLogs(args?: {
  resourceType?: AuditResourceType | null;
  resourceId?: string | null;
  limit?: number;
}) {
  const where: any = {};
  if (args?.resourceType) where.resourceType = args.resourceType;
  if (args?.resourceId) where.resourceId = args.resourceId;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: clampLimit(args?.limit, 20, 100),
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId ?? null,
    status: row.status,
    actorId: row.actorId ?? null,
    actorName: row.actorName ?? null,
    requestId: row.requestId ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
