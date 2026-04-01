import { Request, Response, NextFunction } from "express";
import {
  getAgencyLandscape,
  getDocumentGovernanceOverview,
  getIssueRelations,
  getIssueTimeline,
} from "../services/governanceRead.service";

function requireStringId(req: Request): string {
  const id = String(req.params.id || "").trim();
  if (!id) {
    const err: any = new Error("Invalid id");
    err.status = 400;
    throw err;
  }
  return id;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function getDocumentGovernanceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = requireStringId(req);
    const out = await getDocumentGovernanceOverview(id, {
      limit: parseLimit(req.query.limit),
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getIssueTimelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = requireStringId(req);
    const out = await getIssueTimeline(id, {
      actorAgencyId:
        typeof req.query.actorAgencyId === "string"
          ? req.query.actorAgencyId
          : undefined,
      dateFrom:
        typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
      dateTo:
        typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getIssueRelationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = requireStringId(req);
    const out = await getIssueRelations(id, {
      relationType:
        typeof req.query.relationType === "string"
          ? req.query.relationType
          : undefined,
      limit: parseLimit(req.query.limit),
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getAgencyLandscapeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = requireStringId(req);
    const out = await getAgencyLandscape(id, {
      limit: parseLimit(req.query.limit),
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}
