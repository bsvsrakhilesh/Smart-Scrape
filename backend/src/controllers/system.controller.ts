import type { NextFunction, Request, Response } from "express";
import prisma from "../config/database";
import { writeAuditLog } from "../services/audit.service";
import {
  buildActorAuditMetadata,
  buildAuditActorFields,
} from "../services/requestActor.service";
import { getSystemStatus } from "../services/systemStatus.service";

export async function getSystemStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await getSystemStatus();

    try {
      await writeAuditLog(prisma, {
        action: "system.status.viewed",
        resourceType: "SYSTEM",
        resourceId: "system-status",
        status: "SUCCESS",
        requestId: (req as any).requestId ?? null,
        ...buildAuditActorFields(req),
        metadata: buildActorAuditMetadata(req),
      });
    } catch {
      // audit logging must never block the primary flow
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
}
