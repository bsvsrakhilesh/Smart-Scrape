import { Request, Response, NextFunction } from "express";
import { listAuditLogs } from "../services/audit.service";

export async function getAuditLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const limit = req.query?.limit ? Number(req.query.limit) : undefined;

    const data = await listAuditLogs({
      resourceType:
        typeof req.query.resourceType === "string"
          ? (req.query.resourceType as any)
          : null,
      resourceId:
        typeof req.query.resourceId === "string" ? req.query.resourceId : null,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
}
