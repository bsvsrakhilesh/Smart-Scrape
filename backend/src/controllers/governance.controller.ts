import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import {
  getAgencyLandscape,
  getDocumentGovernanceOverview,
  getIssueCaseWorkspace,
  getIssueRelations,
  getIssueTimeline,
  listGovernanceAgencies,
  listGovernanceIssues,
} from "../services/governanceRead.service";
import { writeAuditLog } from "../services/audit.service";
import {
  buildActorAuditMetadata,
  buildAuditActorFields,
} from "../services/requestActor.service";
import type { AuditResourceType } from "../generated/prisma/client";

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

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function logGovernanceAudit(
  req: Request,
  args: {
    action: string;
    resourceType: AuditResourceType;
    resourceId: string;
    metadata?: any;
  },
) {
  try {
    await writeAuditLog(prisma, {
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      requestId: (req as any).requestId ?? null,
      ...buildAuditActorFields(req),
      metadata: {
        ...(args.metadata ?? {}),
        ...buildActorAuditMetadata(req),
      },
    });
  } catch {
    // never block primary flow
  }
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

    await logGovernanceAudit(req, {
      action: "governance.document.opened",
      resourceType: "DOCUMENT",
      resourceId: id,
      metadata: { limit: parseLimit(req.query.limit) ?? null },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getIssuesDirectoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const out = await listGovernanceIssues({
      query: parseOptionalString(req.query.q),
      kind: parseOptionalString(req.query.kind),
      status: parseOptionalString(req.query.status),
      agencyId: parseOptionalString(req.query.agencyId),
      limit: parseLimit(req.query.limit),
    });

    await logGovernanceAudit(req, {
      action: "governance.issue.directory_viewed",
      resourceType: "SYSTEM",
      resourceId: "governance-issues-directory",
      metadata: {
        q: parseOptionalString(req.query.q) ?? null,
        kind: parseOptionalString(req.query.kind) ?? null,
        status: parseOptionalString(req.query.status) ?? null,
        agencyId: parseOptionalString(req.query.agencyId) ?? null,
        limit: parseLimit(req.query.limit) ?? null,
      },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getAgenciesDirectoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const out = await listGovernanceAgencies({
      query: parseOptionalString(req.query.q),
      category: parseOptionalString(req.query.category),
      jurisdiction: parseOptionalString(req.query.jurisdiction),
      issueId: parseOptionalString(req.query.issueId),
      limit: parseLimit(req.query.limit),
    });

    await logGovernanceAudit(req, {
      action: "governance.agency.directory_viewed",
      resourceType: "SYSTEM",
      resourceId: "governance-agencies-directory",
      metadata: {
        q: parseOptionalString(req.query.q) ?? null,
        category: parseOptionalString(req.query.category) ?? null,
        jurisdiction: parseOptionalString(req.query.jurisdiction) ?? null,
        issueId: parseOptionalString(req.query.issueId) ?? null,
        limit: parseLimit(req.query.limit) ?? null,
      },
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
      sourceType:
        typeof req.query.sourceType === "string"
          ? req.query.sourceType
          : undefined,
      groupBy:
        typeof req.query.groupBy === "string" ? req.query.groupBy : undefined,
      limit: parseLimit(req.query.limit),
    });

    await logGovernanceAudit(req, {
      action: "governance.issue.timeline_viewed",
      resourceType: "ISSUE",
      resourceId: id,
      metadata: {
        actorAgencyId:
          typeof req.query.actorAgencyId === "string"
            ? req.query.actorAgencyId
            : null,
        dateFrom:
          typeof req.query.dateFrom === "string" ? req.query.dateFrom : null,
        dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null,
        sourceType:
          typeof req.query.sourceType === "string"
            ? req.query.sourceType
            : null,
        groupBy:
          typeof req.query.groupBy === "string" ? req.query.groupBy : null,
        limit: parseLimit(req.query.limit) ?? null,
      },
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

    await logGovernanceAudit(req, {
      action: "governance.issue.relations_viewed",
      resourceType: "ISSUE",
      resourceId: id,
      metadata: {
        relationType:
          typeof req.query.relationType === "string"
            ? req.query.relationType
            : null,
        limit: parseLimit(req.query.limit) ?? null,
      },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function getIssueCaseWorkspaceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = requireStringId(req);
    const out = await getIssueCaseWorkspace(id, {
      actorAgencyId:
        typeof req.query.actorAgencyId === "string"
          ? req.query.actorAgencyId
          : undefined,
      relationType:
        typeof req.query.relationType === "string"
          ? req.query.relationType
          : undefined,
      dateFrom:
        typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
      dateTo:
        typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
      limit: parseLimit(req.query.limit),
    });

    await logGovernanceAudit(req, {
      action: "governance.issue.case_workspace_opened",
      resourceType: "ISSUE",
      resourceId: id,
      metadata: {
        actorAgencyId:
          typeof req.query.actorAgencyId === "string"
            ? req.query.actorAgencyId
            : null,
        relationType:
          typeof req.query.relationType === "string"
            ? req.query.relationType
            : null,
        dateFrom:
          typeof req.query.dateFrom === "string" ? req.query.dateFrom : null,
        dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null,
        limit: parseLimit(req.query.limit) ?? null,
      },
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

    await logGovernanceAudit(req, {
      action: "governance.agency.landscape_viewed",
      resourceType: "AGENCY",
      resourceId: id,
      metadata: { limit: parseLimit(req.query.limit) ?? null },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}
