import prisma from "../config/database";
import {
  Prisma,
  DocumentRelationType,
  AgencyCategory,
  GovernanceIssueKind,
  GovernanceIssueStatus,
} from "../generated/prisma/client";
import { buildCaseTimelineView } from "./caseTimeline.service";
import {
  analyzeRelation,
  summarizeRelationBuckets,
} from "./contradictionAlignment.service";

const agencySelect = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  category: true,
  jurisdiction: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

const issueSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  kind: true,
  status: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} as const;

const traceSelect = {
  id: true,
  chunkIds: true,
  pageNumbers: true,
  charStart: true,
  charEnd: true,
  evidenceText: true,
  evidenceLocator: true,
  confidence: true,
  extractionModel: true,
  extractionVersion: true,
  createdAt: true,
  updatedAt: true,
  sourceDocument: {
    select: {
      id: true,
      kind: true,
      urlId: true,
      primaryFileId: true,
    },
  },
  documentRevision: {
    select: {
      id: true,
      ordinal: true,
      captureType: true,
      contentHash: true,
      createdAt: true,
      storedFile: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          size: true,
          createdAt: true,
          sourceUrl: true,
          urlId: true,
        },
      },
    },
  },
  sourceRevision: {
    select: {
      id: true,
    },
  },
  pipelineConfig: {
    select: {
      id: true,
      name: true,
      version: true,
      configHash: true,
      codeSha: true,
    },
  },
} as const;

const relationTypeQueryMap: Record<string, DocumentRelationType> = {
  contradiction: DocumentRelationType.CONTRADICTION,
  tension: DocumentRelationType.TENSION,
  override: DocumentRelationType.OVERRIDE,
  reinforcement: DocumentRelationType.REINFORCEMENT,
  alignment: DocumentRelationType.ALIGNMENT,
  duplication: DocumentRelationType.DUPLICATION,
  reference: DocumentRelationType.REFERENCE,
  supersedes: DocumentRelationType.SUPERSEDES,
  other: DocumentRelationType.OTHER,
};

function notFound(message: string) {
  const err: any = new Error(message);
  err.status = 404;
  return err;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function clampLimit(value: unknown, fallback = 100, max = 250) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseDateBoundary(
  value: string | undefined,
  side: "start" | "end",
): Date | null {
  if (!value) return null;

  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const err: any = new Error(
      `Invalid date '${value}'. Expected YYYY-MM-DD format.`,
    );
    err.status = 400;
    throw err;
  }

  return side === "start"
    ? new Date(`${v}T00:00:00.000Z`)
    : new Date(`${v}T23:59:59.999Z`);
}

function mapRelationTypeQuery(
  value?: string,
): DocumentRelationType | undefined {
  if (!value) return undefined;
  return relationTypeQueryMap[String(value).trim().toLowerCase()] ?? undefined;
}

function formatAgency(agency: any) {
  if (!agency) return null;

  return {
    id: agency.id,
    slug: agency.slug,
    name: agency.name,
    shortName: agency.shortName ?? null,
    category: agency.category ?? null,
    jurisdiction: agency.jurisdiction ?? null,
    metadata: agency.metadata ?? null,
    createdAt: toIso(agency.createdAt),
    updatedAt: toIso(agency.updatedAt),
  };
}

function formatIssue(issue: any) {
  if (!issue) return null;

  return {
    id: issue.id,
    slug: issue.slug,
    title: issue.title,
    summary: issue.summary ?? null,
    kind: issue.kind ?? null,
    status: issue.status ?? null,
    metadata: issue.metadata ?? null,
    createdAt: toIso(issue.createdAt),
    updatedAt: toIso(issue.updatedAt),
  };
}

function formatTrace(trace: any) {
  if (!trace) return null;

  return {
    id: trace.id,
    chunkIds: Array.isArray(trace.chunkIds) ? trace.chunkIds : [],
    pageNumbers: Array.isArray(trace.pageNumbers) ? trace.pageNumbers : [],
    charStart: trace.charStart ?? null,
    charEnd: trace.charEnd ?? null,
    evidenceText: trace.evidenceText ?? null,
    evidenceLocator: trace.evidenceLocator ?? null,
    confidence: trace.confidence ?? null,
    extractionModel: trace.extractionModel ?? null,
    extractionVersion: trace.extractionVersion ?? null,
    createdAt: toIso(trace.createdAt),
    updatedAt: toIso(trace.updatedAt),
    sourceDocument: trace.sourceDocument
      ? {
          id: trace.sourceDocument.id,
          kind: trace.sourceDocument.kind,
          urlId: trace.sourceDocument.urlId ?? null,
          primaryFileId: trace.sourceDocument.primaryFileId ?? null,
        }
      : null,
    documentRevision: trace.documentRevision
      ? {
          id: trace.documentRevision.id,
          ordinal: trace.documentRevision.ordinal,
          captureType: trace.documentRevision.captureType,
          contentHash: trace.documentRevision.contentHash ?? null,
          createdAt: toIso(trace.documentRevision.createdAt),
          storedFile: trace.documentRevision.storedFile
            ? {
                id: trace.documentRevision.storedFile.id,
                fileName: trace.documentRevision.storedFile.fileName,
                mimeType: trace.documentRevision.storedFile.mimeType,
                size: trace.documentRevision.storedFile.size,
                createdAt: toIso(trace.documentRevision.storedFile.createdAt),
                sourceUrl: trace.documentRevision.storedFile.sourceUrl ?? null,
                urlId: trace.documentRevision.storedFile.urlId ?? null,
              }
            : null,
        }
      : null,
    sourceRevision: trace.sourceRevision
      ? {
          id: trace.sourceRevision.id,
        }
      : null,
    pipeline: trace.pipelineConfig
      ? {
          id: trace.pipelineConfig.id,
          name: trace.pipelineConfig.name,
          version: trace.pipelineConfig.version,
          configHash: trace.pipelineConfig.configHash,
          codeSha: trace.pipelineConfig.codeSha ?? null,
        }
      : null,
  };
}

function addAgency(map: Map<string, any>, agency: any) {
  if (agency?.id && !map.has(agency.id)) map.set(agency.id, agency);
}

function addIssue(map: Map<string, any>, issue: any) {
  if (issue?.id && !map.has(issue.id)) map.set(issue.id, issue);
}

export async function getDocumentGovernanceOverview(
  documentId: string,
  opts?: { limit?: number },
) {
  const limit = clampLimit(opts?.limit, 100, 250);

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      kind: true,
      urlId: true,
      primaryFileId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!document) throw notFound("Document not found");

  const [
    mandates,
    claims,
    events,
    positions,
    gaps,
    relations,
    originAgencies,
    originIssues,
  ] = await Promise.all([
    prisma.mandate.findMany({
      where: {
        trace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        agency: { select: agencySelect },
        issue: { select: issueSelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentClaim.findMany({
      where: {
        trace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        subjectAgency: { select: agencySelect },
        issue: { select: issueSelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentEvent.findMany({
      where: {
        trace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: [{ sortDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        actorAgency: { select: agencySelect },
        issue: { select: issueSelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.actorPosition.findMany({
      where: {
        trace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        agency: { select: agencySelect },
        issue: { select: issueSelect },
        claim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.governanceGap.findMany({
      where: {
        trace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        issue: { select: issueSelect },
        primaryAgency: { select: agencySelect },
        secondaryAgency: { select: agencySelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentRelation.findMany({
      where: {
        trace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        issue: { select: issueSelect },
        fromAgency: { select: agencySelect },
        toAgency: { select: agencySelect },
        fromClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        toClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.agency.findMany({
      where: {
        originTrace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: { name: "asc" },
      take: limit,
      select: agencySelect,
    }),
    prisma.governanceIssue.findMany({
      where: {
        originTrace: {
          is: { sourceDocumentId: documentId },
        },
      },
      orderBy: { title: "asc" },
      take: limit,
      select: issueSelect,
    }),
  ]);

  const agencyMap = new Map<string, any>();
  const issueMap = new Map<string, any>();

  for (const row of originAgencies) addAgency(agencyMap, row);
  for (const row of originIssues) addIssue(issueMap, row);

  for (const row of mandates) {
    addAgency(agencyMap, row.agency);
    addIssue(issueMap, row.issue);
  }
  for (const row of claims) {
    addAgency(agencyMap, row.subjectAgency);
    addIssue(issueMap, row.issue);
  }
  for (const row of events) {
    addAgency(agencyMap, row.actorAgency);
    addIssue(issueMap, row.issue);
  }
  for (const row of positions) {
    addAgency(agencyMap, row.agency);
    addIssue(issueMap, row.issue);
  }
  for (const row of gaps) {
    addAgency(agencyMap, row.primaryAgency);
    addAgency(agencyMap, row.secondaryAgency);
    addIssue(issueMap, row.issue);
  }
  for (const row of relations) {
    addAgency(agencyMap, row.fromAgency);
    addAgency(agencyMap, row.toAgency);
    addIssue(issueMap, row.issue);
  }

  return {
    document: {
      id: document.id,
      kind: document.kind,
      urlId: document.urlId ?? null,
      primaryFileId: document.primaryFileId ?? null,
      createdAt: toIso(document.createdAt),
      updatedAt: toIso(document.updatedAt),
    },
    summary: {
      agencyCount: agencyMap.size,
      issueCount: issueMap.size,
      mandateCount: mandates.length,
      claimCount: claims.length,
      eventCount: events.length,
      positionCount: positions.length,
      gapCount: gaps.length,
      relationCount: relations.length,
    },
    agencies: Array.from(agencyMap.values())
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(formatAgency),
    issues: Array.from(issueMap.values())
      .sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .map(formatIssue),
    mandates: mandates.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      mandateType: row.mandateType,
      effectiveFrom: toIso(row.effectiveFrom),
      effectiveTo: toIso(row.effectiveTo),
      agency: formatAgency(row.agency),
      issue: formatIssue(row.issue),
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    claims: claims.map((row) => ({
      id: row.id,
      claimText: row.claimText,
      claimSummary: row.claimSummary ?? null,
      polarity: row.polarity,
      scopeText: row.scopeText ?? null,
      normalizedKey: row.normalizedKey ?? null,
      subjectAgency: formatAgency(row.subjectAgency),
      issue: formatIssue(row.issue),
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    events: events.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary ?? null,
      eventDate: toIso(row.eventDate),
      eventDateText: row.eventDateText ?? null,
      eventDatePrecision: row.eventDatePrecision,
      sortDate: toIso(row.sortDate),
      sortDateEnd: toIso(row.sortDateEnd),
      usedDocumentDateFallback: row.usedDocumentDateFallback,
      actorAgency: formatAgency(row.actorAgency),
      issue: formatIssue(row.issue),
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    positions: positions.map((row) => ({
      id: row.id,
      stanceText: row.stanceText,
      stanceSummary: row.stanceSummary ?? null,
      polarity: row.polarity,
      effectiveDate: toIso(row.effectiveDate),
      effectiveDateText: row.effectiveDateText ?? null,
      effectiveDatePrecision: row.effectiveDatePrecision,
      agency: formatAgency(row.agency),
      issue: formatIssue(row.issue),
      claim: row.claim
        ? {
            id: row.claim.id,
            claimText: row.claim.claimText,
            claimSummary: row.claim.claimSummary ?? null,
          }
        : null,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    gaps: gaps.map((row) => ({
      id: row.id,
      gapType: row.gapType,
      summary: row.summary,
      severity: row.severity ?? null,
      issue: formatIssue(row.issue),
      primaryAgency: formatAgency(row.primaryAgency),
      secondaryAgency: formatAgency(row.secondaryAgency),
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    relations: relations.map((row) => ({
      id: row.id,
      relationType: row.relationType,
      confidence: row.confidence ?? null,
      rationale: row.rationale ?? null,
      issue: formatIssue(row.issue),
      fromAgency: formatAgency(row.fromAgency),
      toAgency: formatAgency(row.toAgency),
      fromClaim: row.fromClaim
        ? {
            id: row.fromClaim.id,
            claimText: row.fromClaim.claimText,
            claimSummary: row.fromClaim.claimSummary ?? null,
          }
        : null,
      toClaim: row.toClaim
        ? {
            id: row.toClaim.id,
            claimText: row.toClaim.claimText,
            claimSummary: row.toClaim.claimSummary ?? null,
          }
        : null,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
  };
}

export async function getIssueTimeline(
  issueId: string,
  opts?: {
    actorAgencyId?: string;
    dateFrom?: string;
    dateTo?: string;
    sourceType?: string;
    groupBy?: string;
    limit?: number;
  },
) {
  const issue = await prisma.governanceIssue.findUnique({
    where: { id: issueId },
    select: issueSelect,
  });

  if (!issue) throw notFound("Governance issue not found");

  const limit = clampLimit(opts?.limit, 100, 300);
  const dateFrom = parseDateBoundary(opts?.dateFrom, "start");
  const dateTo = parseDateBoundary(opts?.dateTo, "end");

  const where: Prisma.IssueTimelineEntryWhereInput = {
    issueId,
    ...(opts?.actorAgencyId ? { actorAgencyId: opts.actorAgencyId } : {}),
  };

  if (dateFrom || dateTo) {
    where.sortDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  const rows = await prisma.issueTimelineEntry.findMany({
    where,
    orderBy: [{ sortDate: "asc" }, { createdAt: "asc" }],
    take: limit,
    include: {
      actorAgency: { select: agencySelect },
      event: {
        select: {
          id: true,
          title: true,
          summary: true,
          eventDate: true,
          eventDateText: true,
          eventDatePrecision: true,
          sortDate: true,
          sortDateEnd: true,
          usedDocumentDateFallback: true,
        },
      },
      position: {
        select: {
          id: true,
          stanceText: true,
          stanceSummary: true,
          polarity: true,
          effectiveDate: true,
          effectiveDateText: true,
          effectiveDatePrecision: true,
          agency: { select: agencySelect },
          claim: {
            select: {
              id: true,
              claimText: true,
              claimSummary: true,
            },
          },
        },
      },
      trace: { select: traceSelect },
    },
  });

  const entries = rows.map((row) => ({
    id: row.id,
    itemType: row.eventId ? "event" : row.positionId ? "position" : "entry",
    label: row.label,
    summary: row.summary ?? null,
    sortDate: toIso(row.sortDate),
    sortDateEnd: toIso(row.sortDateEnd),
    sortPrecision: row.sortPrecision,
    actorAgency: formatAgency(row.actorAgency),
    metadata: row.metadata ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    event: row.event
      ? {
          id: row.event.id,
          title: row.event.title,
          summary: row.event.summary ?? null,
          eventDate: toIso(row.event.eventDate),
          eventDateText: row.event.eventDateText ?? null,
          eventDatePrecision: row.event.eventDatePrecision,
          sortDate: toIso(row.event.sortDate),
          sortDateEnd: toIso(row.event.sortDateEnd),
          usedDocumentDateFallback: row.event.usedDocumentDateFallback,
        }
      : null,
    position: row.position
      ? {
          id: row.position.id,
          stanceText: row.position.stanceText,
          stanceSummary: row.position.stanceSummary ?? null,
          polarity: row.position.polarity,
          effectiveDate: toIso(row.position.effectiveDate),
          effectiveDateText: row.position.effectiveDateText ?? null,
          effectiveDatePrecision: row.position.effectiveDatePrecision,
          agency: formatAgency(row.position.agency),
          claim: row.position.claim
            ? {
                id: row.position.claim.id,
                claimText: row.position.claim.claimText,
                claimSummary: row.position.claim.claimSummary ?? null,
              }
            : null,
        }
      : null,
    provenance: formatTrace(row.trace),
  }));

  const timelineView = buildCaseTimelineView({
    entries,
    filters: {
      actorAgencyId: opts?.actorAgencyId ?? null,
      dateFrom: opts?.dateFrom ?? null,
      dateTo: opts?.dateTo ?? null,
      sourceType: opts?.sourceType ?? null,
      groupBy: opts?.groupBy ?? null,
      limit,
    },
  });

  return {
    issue: formatIssue(issue),
    ...timelineView,
  };
}

export async function getIssueRelations(
  issueId: string,
  opts?: {
    relationType?: string;
    limit?: number;
  },
) {
  const issue = await prisma.governanceIssue.findUnique({
    where: { id: issueId },
    select: issueSelect,
  });

  if (!issue) throw notFound("Governance issue not found");

  const limit = clampLimit(opts?.limit, 100, 300);
  const relationType = mapRelationTypeQuery(opts?.relationType);

  const rows = await prisma.documentRelation.findMany({
    where: {
      issueId,
      ...(relationType ? { relationType } : {}),
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      fromAgency: { select: agencySelect },
      toAgency: { select: agencySelect },
      fromClaim: {
        select: {
          id: true,
          claimText: true,
          claimSummary: true,
          scopeText: true,
        },
      },
      toClaim: {
        select: {
          id: true,
          claimText: true,
          claimSummary: true,
          scopeText: true,
        },
      },
      trace: { select: traceSelect },
    },
  });

  const byType: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row.relationType);
    byType[key] = (byType[key] ?? 0) + 1;
  }

  const relations = rows.map((row) => {
    const analysis = analyzeRelation({
      id: row.id,
      relationType: row.relationType,
      fromAgency: row.fromAgency,
      toAgency: row.toAgency,
      fromClaim: row.fromClaim,
      toClaim: row.toClaim,
      confidence: row.confidence ?? null,
    });

    return {
      id: row.id,
      relationType: row.relationType,
      confidence: row.confidence ?? null,
      rationale: row.rationale ?? null,
      fromAgency: formatAgency(row.fromAgency),
      toAgency: formatAgency(row.toAgency),
      fromClaim: row.fromClaim
        ? {
            id: row.fromClaim.id,
            claimText: row.fromClaim.claimText,
            claimSummary: row.fromClaim.claimSummary ?? null,
            scopeText: row.fromClaim.scopeText ?? null,
          }
        : null,
      toClaim: row.toClaim
        ? {
            id: row.toClaim.id,
            claimText: row.toClaim.claimText,
            claimSummary: row.toClaim.claimSummary ?? null,
            scopeText: row.toClaim.scopeText ?? null,
          }
        : null,
      analysis,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    };
  });

  return {
    issue: formatIssue(issue),
    filters: {
      relationType: relationType ?? null,
      limit,
    },
    summary: {
      relationCount: rows.length,
      byType,
      byBucket: summarizeRelationBuckets(relations),
    },
    relations,
  };
}

type CaseWorkspaceRelationFilter = DocumentRelationType | null;

function summarizeRelationTypes(
  rows: Array<{ relationType: DocumentRelationType }>,
) {
  const byType: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row.relationType).toLowerCase();
    byType[key] = (byType[key] ?? 0) + 1;
  }
  return byType;
}

function normalizeScopeKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function summarizePositionEvolution(
  rows: Array<{
    polarity: string | null;
    effectiveDate: Date | null;
    stanceText: string;
    stanceSummary: string | null;
  }>,
) {
  if (rows.length <= 1) {
    return {
      kind: rows.length === 1 ? "single" : "none",
      summary:
        rows.length === 1
          ? "Single extracted position in the current evidence base."
          : "No extracted positions in the current evidence base.",
      changed: false,
    };
  }

  const ordered = [...rows].sort(
    (a, b) =>
      (a.effectiveDate?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.effectiveDate?.getTime() ?? Number.MAX_SAFE_INTEGER),
  );

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  const distinctPolarities = Array.from(
    new Set(ordered.map((row) => row.polarity || "UNKNOWN")),
  );

  const distinctNormalizedStances = Array.from(
    new Set(
      ordered.map((row) =>
        normalizeScopeKey(row.stanceSummary || row.stanceText || ""),
      ),
    ),
  ).filter(Boolean);

  if (
    distinctPolarities.length > 1 ||
    distinctNormalizedStances.length > 1 ||
    normalizeScopeKey(first.stanceText) !== normalizeScopeKey(last.stanceText)
  ) {
    return {
      kind: "changed",
      summary:
        first.polarity && last.polarity && first.polarity !== last.polarity
          ? `Position appears to shift from ${String(first.polarity).toLowerCase()} to ${String(last.polarity).toLowerCase()} across the available evidence.`
          : "Multiple extracted positions indicate a material evolution in the actor's stated stance over time.",
      changed: true,
    };
  }

  return {
    kind: "stable",
    summary:
      "Multiple extracted positions are present, but they remain substantively aligned in the current evidence base.",
    changed: false,
  };
}

export async function getIssueCaseWorkspace(
  issueId: string,
  opts?: {
    actorAgencyId?: string;
    relationType?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  },
) {
  const issue = await prisma.governanceIssue.findUnique({
    where: { id: issueId },
    select: issueSelect,
  });

  if (!issue) throw notFound("Governance issue not found");

  const limit = clampLimit(opts?.limit, 120, 300);
  const dateFrom = parseDateBoundary(opts?.dateFrom, "start");
  const dateTo = parseDateBoundary(opts?.dateTo, "end");
  const relationType = mapRelationTypeQuery(opts?.relationType);

  const timelineWhere: Prisma.IssueTimelineEntryWhereInput = {
    issueId,
    ...(opts?.actorAgencyId ? { actorAgencyId: opts.actorAgencyId } : {}),
  };

  if (dateFrom || dateTo) {
    timelineWhere.sortDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  const positionWhere: Prisma.ActorPositionWhereInput = {
    issueId,
    ...(opts?.actorAgencyId ? { agencyId: opts.actorAgencyId } : {}),
  };

  if (dateFrom || dateTo) {
    positionWhere.effectiveDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  const relationAgencyFilter = opts?.actorAgencyId
    ? {
        OR: [
          { fromAgencyId: opts.actorAgencyId },
          { toAgencyId: opts.actorAgencyId },
        ],
      }
    : {};

  const gapAgencyFilter = opts?.actorAgencyId
    ? {
        OR: [
          { primaryAgencyId: opts.actorAgencyId },
          { secondaryAgencyId: opts.actorAgencyId },
        ],
      }
    : {};

  const [
    issueLinks,
    timelineRows,
    positionRows,
    relationRows,
    gapRows,
    mandateRows,
    claimRows,
    eventRows,
  ] = await Promise.all([
    prisma.governanceIssueAgency.findMany({
      where: { issueId },
      orderBy: [{ roleLabel: "asc" }, { createdAt: "asc" }],
      include: {
        agency: { select: agencySelect },
      },
    }),
    prisma.issueTimelineEntry.findMany({
      where: timelineWhere,
      orderBy: [{ sortDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        actorAgency: { select: agencySelect },
        event: {
          select: {
            id: true,
            title: true,
            summary: true,
            eventDate: true,
            eventDateText: true,
            eventDatePrecision: true,
            sortDate: true,
            sortDateEnd: true,
            usedDocumentDateFallback: true,
          },
        },
        position: {
          select: {
            id: true,
            stanceText: true,
            stanceSummary: true,
            polarity: true,
            effectiveDate: true,
            effectiveDateText: true,
            effectiveDatePrecision: true,
            agency: { select: agencySelect },
            claim: {
              select: {
                id: true,
                claimText: true,
                claimSummary: true,
              },
            },
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.actorPosition.findMany({
      where: positionWhere,
      orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        agency: { select: agencySelect },
        claim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentRelation.findMany({
      where: {
        issueId,
        ...(relationType ? { relationType } : {}),
        ...relationAgencyFilter,
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        fromAgency: { select: agencySelect },
        toAgency: { select: agencySelect },
        fromClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
            scopeText: true,
          },
        },
        toClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
            scopeText: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.governanceGap.findMany({
      where: {
        issueId,
        ...gapAgencyFilter,
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        issue: { select: issueSelect },
        primaryAgency: { select: agencySelect },
        secondaryAgency: { select: agencySelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.mandate.findMany({
      where: {
        issueId,
        ...(opts?.actorAgencyId ? { agencyId: opts.actorAgencyId } : {}),
      },
      orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        agency: { select: agencySelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentClaim.findMany({
      where: {
        issueId,
        ...(opts?.actorAgencyId ? { subjectAgencyId: opts.actorAgencyId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      include: {
        subjectAgency: { select: agencySelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentEvent.findMany({
      where: {
        issueId,
        ...(opts?.actorAgencyId ? { actorAgencyId: opts.actorAgencyId } : {}),
        ...(dateFrom || dateTo
          ? {
              sortDate: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ sortDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        actorAgency: { select: agencySelect },
        trace: { select: traceSelect },
      },
    }),
  ]);

  const agencyMap = new Map<string, any>();
  for (const row of issueLinks) addAgency(agencyMap, row.agency);
  for (const row of timelineRows) addAgency(agencyMap, row.actorAgency);
  for (const row of positionRows) addAgency(agencyMap, row.agency);
  for (const row of relationRows) {
    addAgency(agencyMap, row.fromAgency);
    addAgency(agencyMap, row.toAgency);
  }
  for (const row of gapRows) {
    addAgency(agencyMap, row.primaryAgency);
    addAgency(agencyMap, row.secondaryAgency);
  }
  for (const row of mandateRows) addAgency(agencyMap, row.agency);
  for (const row of claimRows) addAgency(agencyMap, row.subjectAgency);
  for (const row of eventRows) addAgency(agencyMap, row.actorAgency);

  const timelineEntries = timelineRows.map((row) => ({
    id: row.id,
    itemType: row.eventId ? "event" : row.positionId ? "position" : "entry",
    label: row.label,
    summary: row.summary ?? null,
    sortDate: toIso(row.sortDate),
    sortDateEnd: toIso(row.sortDateEnd),
    sortPrecision: row.sortPrecision,
    actorAgency: formatAgency(row.actorAgency),
    metadata: row.metadata ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    event: row.event
      ? {
          id: row.event.id,
          title: row.event.title,
          summary: row.event.summary ?? null,
          eventDate: toIso(row.event.eventDate),
          eventDateText: row.event.eventDateText ?? null,
          eventDatePrecision: row.event.eventDatePrecision,
          sortDate: toIso(row.event.sortDate),
          sortDateEnd: toIso(row.event.sortDateEnd),
          usedDocumentDateFallback: row.event.usedDocumentDateFallback,
        }
      : null,
    position: row.position
      ? {
          id: row.position.id,
          stanceText: row.position.stanceText,
          stanceSummary: row.position.stanceSummary ?? null,
          polarity: row.position.polarity,
          effectiveDate: toIso(row.position.effectiveDate),
          effectiveDateText: row.position.effectiveDateText ?? null,
          effectiveDatePrecision: row.position.effectiveDatePrecision,
          agency: formatAgency(row.position.agency),
          claim: row.position.claim
            ? {
                id: row.position.claim.id,
                claimText: row.position.claim.claimText,
                claimSummary: row.position.claim.claimSummary ?? null,
              }
            : null,
        }
      : null,
    provenance: formatTrace(row.trace),
  }));

  const formattedRelations = relationRows.map((row) => ({
    id: row.id,
    relationType: row.relationType,
    confidence: row.confidence ?? null,
    rationale: row.rationale ?? null,
    issue: formatIssue(issue),
    fromAgency: formatAgency(row.fromAgency),
    toAgency: formatAgency(row.toAgency),
    fromClaim: row.fromClaim
      ? {
          id: row.fromClaim.id,
          claimText: row.fromClaim.claimText,
          claimSummary: row.fromClaim.claimSummary ?? null,
          scopeText: row.fromClaim.scopeText ?? null,
        }
      : null,
    toClaim: row.toClaim
      ? {
          id: row.toClaim.id,
          claimText: row.toClaim.claimText,
          claimSummary: row.toClaim.claimSummary ?? null,
          scopeText: row.toClaim.scopeText ?? null,
        }
      : null,
    analysis: analyzeRelation({
      id: row.id,
      relationType: row.relationType,
      fromAgency: row.fromAgency,
      toAgency: row.toAgency,
      fromClaim: row.fromClaim,
      toClaim: row.toClaim,
      confidence: row.confidence ?? null,
    }),
    metadata: row.metadata ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    provenance: formatTrace(row.trace),
  }));

  const formattedGaps = gapRows.map((row) => ({
    id: row.id,
    gapType: row.gapType,
    summary: row.summary,
    severity: row.severity ?? null,
    issue: formatIssue(row.issue),
    primaryAgency: formatAgency(row.primaryAgency),
    secondaryAgency: formatAgency(row.secondaryAgency),
    metadata: row.metadata ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    provenance: formatTrace(row.trace),
  }));

  const formattedMandates = mandateRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    mandateType: row.mandateType,
    effectiveFrom: toIso(row.effectiveFrom),
    effectiveTo: toIso(row.effectiveTo),
    agency: formatAgency(row.agency),
    issue: formatIssue(issue),
    metadata: row.metadata ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    provenance: formatTrace(row.trace),
  }));

  const formattedClaims = claimRows.map((row) => ({
    id: row.id,
    claimText: row.claimText,
    claimSummary: row.claimSummary ?? null,
    polarity: row.polarity,
    scopeText: row.scopeText ?? null,
    normalizedKey: row.normalizedKey ?? null,
    subjectAgency: formatAgency(row.subjectAgency),
    issue: formatIssue(issue),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    provenance: formatTrace(row.trace),
  }));

  const formattedEvents = eventRows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    eventDate: toIso(row.eventDate),
    eventDateText: row.eventDateText ?? null,
    eventDatePrecision: row.eventDatePrecision,
    sortDate: toIso(row.sortDate),
    sortDateEnd: toIso(row.sortDateEnd),
    usedDocumentDateFallback: row.usedDocumentDateFallback,
    actorAgency: formatAgency(row.actorAgency),
    issue: formatIssue(issue),
    metadata: row.metadata ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    provenance: formatTrace(row.trace),
  }));

  const sourceMap = new Map<string, any>();
  for (const item of [
    ...timelineEntries,
    ...formattedRelations,
    ...formattedGaps,
    ...formattedMandates,
    ...formattedClaims,
    ...formattedEvents,
  ]) {
    const provenance = item.provenance;
    const sourceDocumentId = provenance?.sourceDocument?.id;
    if (!sourceDocumentId) continue;

    const existing = sourceMap.get(sourceDocumentId) || {
      sourceDocument: provenance.sourceDocument,
      documentRevision: provenance.documentRevision,
      pipeline: provenance.pipeline,
      itemCount: 0,
      latestSeenAt: provenance.updatedAt || provenance.createdAt || null,
    };

    existing.itemCount += 1;
    const seenAt = provenance.updatedAt || provenance.createdAt || null;
    if (seenAt && (!existing.latestSeenAt || seenAt > existing.latestSeenAt)) {
      existing.latestSeenAt = seenAt;
    }

    sourceMap.set(sourceDocumentId, existing);
  }

  const actorCards = Array.from(agencyMap.values())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((agency) => {
      const timelineForAgency = timelineEntries.filter(
        (row) => row.actorAgency?.id === agency.id,
      );
      const positionsForAgency = positionRows.filter(
        (row) => row.agencyId === agency.id,
      );
      const eventsForAgency = eventRows.filter(
        (row) => row.actorAgencyId === agency.id,
      );
      const mandatesForAgency = mandateRows.filter(
        (row) => row.agencyId === agency.id,
      );
      const claimsForAgency = claimRows.filter(
        (row) => row.subjectAgencyId === agency.id,
      );
      const outgoingForAgency = formattedRelations.filter(
        (row) => row.fromAgency?.id === agency.id,
      );
      const incomingForAgency = formattedRelations.filter(
        (row) => row.toAgency?.id === agency.id,
      );
      const gapsForAgency = formattedGaps.filter(
        (row) =>
          row.primaryAgency?.id === agency.id ||
          row.secondaryAgency?.id === agency.id,
      );

      const evolution = summarizePositionEvolution(
        positionsForAgency.map((row) => ({
          polarity: row.polarity,
          effectiveDate: row.effectiveDate,
          stanceText: row.stanceText,
          stanceSummary: row.stanceSummary ?? null,
        })),
      );

      const latestPosition =
        positionsForAgency[positionsForAgency.length - 1] ?? null;
      const latestTimeline =
        timelineForAgency[timelineForAgency.length - 1] ?? null;

      return {
        agency: formatAgency(agency),
        roleLabels: Array.from(
          new Set(
            issueLinks
              .filter((row) => row.agencyId === agency.id)
              .map((row) => row.roleLabel)
              .filter((value): value is string => Boolean(value)),
          ),
        ),
        stats: {
          timelineEntryCount: timelineForAgency.length,
          positionCount: positionsForAgency.length,
          eventCount: eventsForAgency.length,
          mandateCount: mandatesForAgency.length,
          claimCount: claimsForAgency.length,
          outgoingRelationCount: outgoingForAgency.length,
          incomingRelationCount: incomingForAgency.length,
          gapCount: gapsForAgency.length,
        },
        evolution,
        latestPosition: latestPosition
          ? {
              id: latestPosition.id,
              stanceText: latestPosition.stanceText,
              stanceSummary: latestPosition.stanceSummary ?? null,
              polarity: latestPosition.polarity,
              effectiveDate: toIso(latestPosition.effectiveDate),
              effectiveDateText: latestPosition.effectiveDateText ?? null,
              effectiveDatePrecision: latestPosition.effectiveDatePrecision,
              claim: latestPosition.claim
                ? {
                    id: latestPosition.claim.id,
                    claimText: latestPosition.claim.claimText,
                    claimSummary: latestPosition.claim.claimSummary ?? null,
                  }
                : null,
              provenance: formatTrace(latestPosition.trace),
            }
          : null,
        latestTimelineEntry: latestTimeline,
        positions: positionsForAgency.map((row) => ({
          id: row.id,
          stanceText: row.stanceText,
          stanceSummary: row.stanceSummary ?? null,
          polarity: row.polarity,
          effectiveDate: toIso(row.effectiveDate),
          effectiveDateText: row.effectiveDateText ?? null,
          effectiveDatePrecision: row.effectiveDatePrecision,
          claim: row.claim
            ? {
                id: row.claim.id,
                claimText: row.claim.claimText,
                claimSummary: row.claim.claimSummary ?? null,
              }
            : null,
          provenance: formatTrace(row.trace),
        })),
      };
    });

  const contradictionRelationTypes: DocumentRelationType[] = [
    DocumentRelationType.CONTRADICTION,
    DocumentRelationType.TENSION,
    DocumentRelationType.OVERRIDE,
  ];

  const alignmentRelationTypes: DocumentRelationType[] = [
    DocumentRelationType.ALIGNMENT,
    DocumentRelationType.REINFORCEMENT,
    DocumentRelationType.DUPLICATION,
    DocumentRelationType.REFERENCE,
    DocumentRelationType.SUPERSEDES,
    DocumentRelationType.OTHER,
  ];

  const contradictionRelations = formattedRelations.filter((row) =>
    contradictionRelationTypes.includes(row.relationType),
  );

  const alignmentRelations = formattedRelations.filter((row) =>
    alignmentRelationTypes.includes(row.relationType),
  );

  return {
    issue: formatIssue(issue),
    filters: {
      actorAgencyId: opts?.actorAgencyId ?? null,
      relationType: (relationType as CaseWorkspaceRelationFilter) ?? null,
      dateFrom: opts?.dateFrom ?? null,
      dateTo: opts?.dateTo ?? null,
      limit,
    },
    summary: {
      agencyCount: actorCards.length,
      timelineEntryCount: timelineEntries.length,
      eventCount: formattedEvents.length,
      positionCount: positionRows.length,
      contradictionCount: contradictionRelations.length,
      gapCount: formattedGaps.length,
      sourceCount: sourceMap.size,
      changedActorCount: actorCards.filter((row) => row.evolution.changed)
        .length,
    },
    actors: actorCards,
    timeline: {
      summary: {
        byType: {
          event: timelineEntries.filter((row) => row.itemType === "event")
            .length,
          position: timelineEntries.filter((row) => row.itemType === "position")
            .length,
          entry: timelineEntries.filter((row) => row.itemType === "entry")
            .length,
        },
      },
      entries: timelineEntries,
    },
    relations: {
      summary: {
        relationCount: formattedRelations.length,
        byType: summarizeRelationTypes(relationRows),
        byBucket: summarizeRelationBuckets(formattedRelations),
        requiresAnalystReviewCount: formattedRelations.filter(
          (row) => row.analysis?.requiresAnalystReview,
        ).length,
      },
      contradictions: contradictionRelations,
      alignments: alignmentRelations,
    },
    gaps: formattedGaps,
    mandates: formattedMandates,
    claims: formattedClaims,
    events: formattedEvents,
    sources: Array.from(sourceMap.values()).sort(
      (a, b) =>
        (b.itemCount ?? 0) - (a.itemCount ?? 0) ||
        String(b.latestSeenAt || "").localeCompare(
          String(a.latestSeenAt || ""),
        ),
    ),
  };
}

export async function getAgencyLandscape(
  agencyId: string,
  opts?: { limit?: number },
) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: agencySelect,
  });

  if (!agency) throw notFound("Agency not found");

  const limit = clampLimit(opts?.limit, 100, 250);

  const [
    issueLinks,
    mandates,
    positions,
    gaps,
    outgoingRelations,
    incomingRelations,
  ] = await Promise.all([
    prisma.governanceIssueAgency.findMany({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        issue: { select: issueSelect },
      },
    }),
    prisma.mandate.findMany({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        issue: { select: issueSelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.actorPosition.findMany({
      where: { agencyId },
      orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
      take: limit,
      include: {
        issue: { select: issueSelect },
        claim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.governanceGap.findMany({
      where: {
        OR: [{ primaryAgencyId: agencyId }, { secondaryAgencyId: agencyId }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        issue: { select: issueSelect },
        primaryAgency: { select: agencySelect },
        secondaryAgency: { select: agencySelect },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentRelation.findMany({
      where: { fromAgencyId: agencyId },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        issue: { select: issueSelect },
        toAgency: { select: agencySelect },
        fromClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        toClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
    prisma.documentRelation.findMany({
      where: { toAgencyId: agencyId },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        issue: { select: issueSelect },
        fromAgency: { select: agencySelect },
        fromClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        toClaim: {
          select: {
            id: true,
            claimText: true,
            claimSummary: true,
          },
        },
        trace: { select: traceSelect },
      },
    }),
  ]);

  const issueMap = new Map<string, any>();
  for (const row of issueLinks) addIssue(issueMap, row.issue);
  for (const row of mandates) addIssue(issueMap, row.issue);
  for (const row of positions) addIssue(issueMap, row.issue);
  for (const row of gaps) addIssue(issueMap, row.issue);
  for (const row of outgoingRelations) addIssue(issueMap, row.issue);
  for (const row of incomingRelations) addIssue(issueMap, row.issue);

  const issues = Array.from(issueMap.values()).sort((a, b) =>
    String(a.title).localeCompare(String(b.title)),
  );

  const issueMatrix = issues.map((issue) => ({
    issue: formatIssue(issue),
    counts: {
      linked: issueLinks.filter((row) => row.issueId === issue.id).length,
      mandates: mandates.filter((row) => row.issueId === issue.id).length,
      positions: positions.filter((row) => row.issueId === issue.id).length,
      gaps: gaps.filter((row) => row.issueId === issue.id).length,
      outgoingRelations: outgoingRelations.filter(
        (row) => row.issueId === issue.id,
      ).length,
      incomingRelations: incomingRelations.filter(
        (row) => row.issueId === issue.id,
      ).length,
    },
  }));

  return {
    agency: formatAgency(agency),
    summary: {
      issueCount: issues.length,
      mandateCount: mandates.length,
      positionCount: positions.length,
      gapCount: gaps.length,
      outgoingRelationCount: outgoingRelations.length,
      incomingRelationCount: incomingRelations.length,
    },
    issueMatrix,
    issueLinks: issueLinks.map((row) => ({
      issue: formatIssue(row.issue),
      roleLabel: row.roleLabel ?? null,
      createdAt: toIso(row.createdAt),
    })),
    mandates: mandates.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      mandateType: row.mandateType,
      effectiveFrom: toIso(row.effectiveFrom),
      effectiveTo: toIso(row.effectiveTo),
      issue: formatIssue(row.issue),
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    positions: positions.map((row) => ({
      id: row.id,
      stanceText: row.stanceText,
      stanceSummary: row.stanceSummary ?? null,
      polarity: row.polarity,
      effectiveDate: toIso(row.effectiveDate),
      effectiveDateText: row.effectiveDateText ?? null,
      effectiveDatePrecision: row.effectiveDatePrecision,
      issue: formatIssue(row.issue),
      claim: row.claim
        ? {
            id: row.claim.id,
            claimText: row.claim.claimText,
            claimSummary: row.claim.claimSummary ?? null,
          }
        : null,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    gaps: gaps.map((row) => ({
      id: row.id,
      gapType: row.gapType,
      summary: row.summary,
      severity: row.severity ?? null,
      issue: formatIssue(row.issue),
      primaryAgency: formatAgency(row.primaryAgency),
      secondaryAgency: formatAgency(row.secondaryAgency),
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    outgoingRelations: outgoingRelations.map((row) => ({
      id: row.id,
      relationType: row.relationType,
      confidence: row.confidence ?? null,
      rationale: row.rationale ?? null,
      issue: formatIssue(row.issue),
      otherAgency: formatAgency(row.toAgency),
      fromClaim: row.fromClaim
        ? {
            id: row.fromClaim.id,
            claimText: row.fromClaim.claimText,
            claimSummary: row.fromClaim.claimSummary ?? null,
          }
        : null,
      toClaim: row.toClaim
        ? {
            id: row.toClaim.id,
            claimText: row.toClaim.claimText,
            claimSummary: row.toClaim.claimSummary ?? null,
          }
        : null,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
    incomingRelations: incomingRelations.map((row) => ({
      id: row.id,
      relationType: row.relationType,
      confidence: row.confidence ?? null,
      rationale: row.rationale ?? null,
      issue: formatIssue(row.issue),
      otherAgency: formatAgency(row.fromAgency),
      fromClaim: row.fromClaim
        ? {
            id: row.fromClaim.id,
            claimText: row.fromClaim.claimText,
            claimSummary: row.fromClaim.claimSummary ?? null,
          }
        : null,
      toClaim: row.toClaim
        ? {
            id: row.toClaim.id,
            claimText: row.toClaim.claimText,
            claimSummary: row.toClaim.claimSummary ?? null,
          }
        : null,
      metadata: row.metadata ?? null,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      provenance: formatTrace(row.trace),
    })),
  };
}

export async function listGovernanceIssues(opts?: {
  query?: string;
  kind?: string;
  status?: string;
  agencyId?: string;
  limit?: number;
}) {
  const limit = clampLimit(opts?.limit, 50, 200);

  const query = typeof opts?.query === "string" ? opts.query.trim() : "";
  const agencyId =
    typeof opts?.agencyId === "string" ? opts.agencyId.trim() : "";

  const kindRaw =
    typeof opts?.kind === "string" ? opts.kind.trim().toUpperCase() : "";
  const statusRaw =
    typeof opts?.status === "string" ? opts.status.trim().toUpperCase() : "";

  const kind = (Object.values(GovernanceIssueKind) as string[]).includes(
    kindRaw,
  )
    ? (kindRaw as GovernanceIssueKind)
    : undefined;

  const status = (Object.values(GovernanceIssueStatus) as string[]).includes(
    statusRaw,
  )
    ? (statusRaw as GovernanceIssueStatus)
    : undefined;

  const and: Prisma.GovernanceIssueWhereInput[] = [];

  if (query) {
    and.push({
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { summary: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  if (kind) and.push({ kind });
  if (status) and.push({ status });

  if (agencyId) {
    and.push({
      OR: [
        { agencies: { some: { agencyId } } },
        { mandates: { some: { agencyId } } },
        { positions: { some: { agencyId } } },
        {
          gaps: {
            some: {
              OR: [
                { primaryAgencyId: agencyId },
                { secondaryAgencyId: agencyId },
              ],
            },
          },
        },
        {
          relations: {
            some: {
              OR: [{ fromAgencyId: agencyId }, { toAgencyId: agencyId }],
            },
          },
        },
        { events: { some: { actorAgencyId: agencyId } } },
        { timelineEntries: { some: { actorAgencyId: agencyId } } },
      ],
    });
  }

  const where: Prisma.GovernanceIssueWhereInput = and.length
    ? { AND: and }
    : {};

  const [total, rows] = await Promise.all([
    prisma.governanceIssue.count({ where }),
    prisma.governanceIssue.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      take: limit,
      include: {
        agencies: {
          take: 5,
          orderBy: { createdAt: "desc" },
          select: {
            roleLabel: true,
            agency: { select: agencySelect },
          },
        },
        _count: {
          select: {
            agencies: true,
            mandates: true,
            claims: true,
            events: true,
            positions: true,
            gaps: true,
            relations: true,
            timelineEntries: true,
            evidenceClusters: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit,
    filters: {
      query: query || null,
      kind: kind ?? null,
      status: status ?? null,
      agencyId: agencyId || null,
    },
    items: rows.map((row) => ({
      ...formatIssue(row),
      counts: {
        agencyCount: row._count.agencies,
        mandateCount: row._count.mandates,
        claimCount: row._count.claims,
        eventCount: row._count.events,
        positionCount: row._count.positions,
        gapCount: row._count.gaps,
        relationCount: row._count.relations,
        timelineEntryCount: row._count.timelineEntries,
        evidenceClusterCount: row._count.evidenceClusters,
      },
      linkedAgencies: row.agencies.map((link) => ({
        roleLabel: link.roleLabel ?? null,
        agency: formatAgency(link.agency),
      })),
    })),
  };
}

export async function listGovernanceAgencies(opts?: {
  query?: string;
  category?: string;
  jurisdiction?: string;
  issueId?: string;
  limit?: number;
}) {
  const limit = clampLimit(opts?.limit, 50, 200);

  const query = typeof opts?.query === "string" ? opts.query.trim() : "";
  const jurisdiction =
    typeof opts?.jurisdiction === "string" ? opts.jurisdiction.trim() : "";
  const issueId = typeof opts?.issueId === "string" ? opts.issueId.trim() : "";

  const categoryRaw =
    typeof opts?.category === "string"
      ? opts.category.trim().toUpperCase()
      : "";

  const category = (Object.values(AgencyCategory) as string[]).includes(
    categoryRaw,
  )
    ? (categoryRaw as AgencyCategory)
    : undefined;

  const and: Prisma.AgencyWhereInput[] = [];

  if (query) {
    and.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { shortName: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  if (category) and.push({ category });

  if (jurisdiction) {
    and.push({
      jurisdiction: {
        contains: jurisdiction,
        mode: "insensitive",
      },
    });
  }

  if (issueId) {
    and.push({
      OR: [
        { issueLinks: { some: { issueId } } },
        { mandates: { some: { issueId } } },
        { positions: { some: { issueId } } },
        { primaryGapLinks: { some: { issueId } } },
        { secondaryGapLinks: { some: { issueId } } },
        { eventActors: { some: { issueId } } },
        { outgoingRelations: { some: { issueId } } },
        { incomingRelations: { some: { issueId } } },
        { subjectClaims: { some: { issueId } } },
        { timelineEntries: { some: { issueId } } },
      ],
    });
  }

  const where: Prisma.AgencyWhereInput = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.agency.count({ where }),
    prisma.agency.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: limit,
      include: {
        issueLinks: {
          take: 5,
          orderBy: { createdAt: "desc" },
          select: {
            roleLabel: true,
            issue: { select: issueSelect },
          },
        },
        _count: {
          select: {
            issueLinks: true,
            mandates: true,
            positions: true,
            primaryGapLinks: true,
            secondaryGapLinks: true,
            eventActors: true,
            outgoingRelations: true,
            incomingRelations: true,
            subjectClaims: true,
            timelineEntries: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    limit,
    filters: {
      query: query || null,
      category: category ?? null,
      jurisdiction: jurisdiction || null,
      issueId: issueId || null,
    },
    items: rows.map((row) => ({
      ...formatAgency(row),
      counts: {
        issueCount: row._count.issueLinks,
        mandateCount: row._count.mandates,
        positionCount: row._count.positions,
        gapCount: row._count.primaryGapLinks + row._count.secondaryGapLinks,
        eventCount: row._count.eventActors,
        relationCount:
          row._count.outgoingRelations + row._count.incomingRelations,
        subjectClaimCount: row._count.subjectClaims,
        timelineEntryCount: row._count.timelineEntries,
      },
      linkedIssues: row.issueLinks.map((link) => ({
        roleLabel: link.roleLabel ?? null,
        issue: formatIssue(link.issue),
      })),
    })),
  };
}
