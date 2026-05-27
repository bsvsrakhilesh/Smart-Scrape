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
import { queryGovernanceWorkspaceEvidence } from "../services/governanceWorkspaceQuery.service";
import {
  createGovernanceAnswerSession,
  getGovernanceAnswerSession,
  runGovernanceWorkspaceAnswer,
} from "../services/governanceWorkspaceAnswer.service";
import { formatNotebookSseEvent } from "../services/notebookStream.service";
import { writeAuditLog } from "../services/audit.service";
import {
  buildActorAuditMetadata,
  buildAuditActorFields,
} from "../services/requestActor.service";
import type { AuditResourceType } from "../generated/prisma/client";
import { ownerIdForRequest } from "../utils/requestOwner";

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

export async function postGovernanceWorkspaceQueryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = (req as any).body ?? {};
    const out = await queryGovernanceWorkspaceEvidence({
      question: typeof body.question === "string" ? body.question : undefined,
      anchorDocumentIds: Array.isArray(body.anchorDocumentIds)
        ? body.anchorDocumentIds
        : undefined,
      anchorUrlIds: Array.isArray(body.anchorUrlIds)
        ? body.anchorUrlIds
        : undefined,
      sourceScope:
        typeof body.sourceScope === "string" ? body.sourceScope : undefined,
      workflowMode:
        typeof body.workflowMode === "string" ? body.workflowMode : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      collectorPurposeId:
        typeof body.collectorPurposeId === "string"
          ? body.collectorPurposeId
          : undefined,
      ownerId: ownerIdForRequest(req),
    });

    await logGovernanceAudit(req, {
      action: "governance.workspace.query",
      resourceType: "SYSTEM",
      resourceId: "governance-workspace-query",
      metadata: {
        question: out.query.question || null,
        sourceScope: out.query.sourceScope,
        requestedWorkflowMode: out.query.workflowMode,
        resolvedWorkflowMode: out.workflow.resolvedMode,
        anchorDocumentIds: out.query.anchorDocumentIds,
        anchorUrlIds: out.query.anchorUrlIds,
        tokenCount: out.query.tokens.length,
        totalCandidates: out.totalCandidates,
        selectedDocumentId: out.selectedDocumentId,
        collectorPurposeId: out.query.collectorPurposeId,
        allowedDocumentIds: out.evidenceScope?.allowedDocumentIds ?? null,
      },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}


function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function parseNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function userSafeGovernanceAnswerError(error: unknown) {
  const anyError = error as any;
  const status = Number(anyError?.status ?? anyError?.statusCode ?? 500);
  if (
    anyError?.name === "AbortError" ||
    anyError?.code === "ABORT_ERR" ||
    /abort|cancel/i.test(String(anyError?.message ?? ""))
  ) {
    return "Answer generation stopped.";
  }
  if (status === 400) return String(anyError?.message || "Invalid answer request.");
  if (status === 404) return "Governance answer session not found.";
  if (status === 409) return String(anyError?.message || "Capture evidence before asking a question.");
  if (status === 503) return String(anyError?.message || "Answer generation is disabled.");
  if (status === 429) return "Answer generation is busy. Try again in a moment.";
  return "Governance answer generation failed. Please try again.";
}

function buildAnswerInput(req: Request) {
  const body = (req as any).body ?? {};
  return {
    question: typeof body.question === "string" ? body.question : "",
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    history: Array.isArray(body.history) ? body.history : undefined,
    previousRunId:
      typeof body.previousRunId === "string" ? body.previousRunId : undefined,
    previousResponseId:
      typeof body.previousResponseId === "string"
        ? body.previousResponseId
        : undefined,
    anchorDocumentIds: parseStringArray(body.anchorDocumentIds),
    anchorUrlIds: parseNumberArray(body.anchorUrlIds),
    sourceScope: typeof body.sourceScope === "string" ? body.sourceScope : undefined,
    workflowMode:
      typeof body.workflowMode === "string" ? body.workflowMode : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
    selectedIssueId:
      typeof body.selectedIssueId === "string" ? body.selectedIssueId : undefined,
    selectedAgencyId:
      typeof body.selectedAgencyId === "string" ? body.selectedAgencyId : undefined,
    deepReview: body.deepReview === true,
    collectorPurposeId:
      typeof body.collectorPurposeId === "string"
        ? body.collectorPurposeId
        : undefined,
    ownerId: ownerIdForRequest(req),
    requestId: (req as any).requestId ?? null,
    createdBy: null,
  };
}

export async function postGovernanceAnswerSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = (req as any).body ?? {};

    if (typeof body.sessionId === "string" && body.sessionId.trim()) {
      const out = await getGovernanceAnswerSession(body.sessionId.trim());
      return res.json(out);
    }

    const out = await createGovernanceAnswerSession({
      question: typeof body.question === "string" ? body.question : undefined,
      anchorDocumentIds: parseStringArray(body.anchorDocumentIds),
      anchorUrlIds: parseNumberArray(body.anchorUrlIds),
      sourceScope: typeof body.sourceScope === "string" ? body.sourceScope : undefined,
      workflowMode: typeof body.workflowMode === "string" ? body.workflowMode : undefined,
      selectedIssueId:
        typeof body.selectedIssueId === "string" ? body.selectedIssueId : undefined,
      selectedAgencyId:
        typeof body.selectedAgencyId === "string" ? body.selectedAgencyId : undefined,
      collectorPurposeId:
        typeof body.collectorPurposeId === "string"
          ? body.collectorPurposeId
          : undefined,
      requestId: (req as any).requestId ?? null,
      createdBy: null,
    });

    await logGovernanceAudit(req, {
      action: "governance.workspace.answer.session_created",
      resourceType: "CHAT_RUN",
      resourceId: out.id,
      metadata: {
        sourceScope: out.sourceScope,
        requestedWorkflowMode: out.requestedWorkflowMode,
        anchorDocumentIds: out.anchorDocumentIds,
        anchorUrlIds: out.anchorUrlIds,
      },
    });

    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
}

export async function getGovernanceAnswerSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = requireStringId(req);
    const out = await getGovernanceAnswerSession(id);

    await logGovernanceAudit(req, {
      action: "governance.workspace.answer.session_opened",
      resourceType: "CHAT_RUN",
      resourceId: id,
      metadata: { runCount: out.runs.length },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function postGovernanceWorkspaceAnswerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const out = await runGovernanceWorkspaceAnswer(buildAnswerInput(req) as any);

    await logGovernanceAudit(req, {
      action: "governance.workspace.answer.completed",
      resourceType: "CHAT_RUN",
      resourceId: out.run.id,
      metadata: {
        sessionId: out.sessionId,
        model: out.run.model,
        assistModel: out.run.assistModel,
        groundingStatus: out.run.groundingStatus,
        citationCount: out.run.citations.length,
        candidateCount: out.run.candidateDocumentIds.length,
      },
    });

    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function postGovernanceWorkspaceAnswerStreamHandler(
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const abortController = new AbortController();
  let closed = false;

  const send = (event: "run" | "status" | "delta" | "final" | "error", data: any) => {
    if (closed || res.writableEnded) return;
    res.write(formatNotebookSseEvent(event, data));
  };

  try {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    req.on("close", () => {
      closed = true;
      abortController.abort();
    });

    const out = await runGovernanceWorkspaceAnswer({
      ...(buildAnswerInput(req) as any),
      signal: abortController.signal,
      onStreamEvent: (event) => send(event.type, event),
    });

    await logGovernanceAudit(req, {
      action: "governance.workspace.answer.streamed",
      resourceType: "CHAT_RUN",
      resourceId: out.run.id,
      metadata: {
        sessionId: out.sessionId,
        model: out.run.model,
        assistModel: out.run.assistModel,
        groundingStatus: out.run.groundingStatus,
        citationCount: out.run.citations.length,
        candidateCount: out.run.candidateDocumentIds.length,
      },
    });

    send("final", out);
    if (!closed && !res.writableEnded) res.end();
  } catch (err) {
    if (closed || res.writableEnded) return;
    send("error", { message: userSafeGovernanceAnswerError(err) });
    res.end();
  }
}
