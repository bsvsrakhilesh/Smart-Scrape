import prisma from "../config/database";
import { Prisma, DocumentKind } from "../generated/prisma/client";

type GovernanceWorkspaceSourceScope = "all" | "files" | "urls" | "mixed";
type GovernanceWorkspaceWorkflowMode = "auto" | "landscape" | "case_trace";

type GovernanceWorkspaceQueryInput = {
  question?: string | null;
  anchorDocumentIds?: string[];
  anchorUrlIds?: number[];
  sourceScope?: GovernanceWorkspaceSourceScope;
  workflowMode?: GovernanceWorkspaceWorkflowMode;
  limit?: number;
};

type CandidateAccumulator = {
  documentId: string;
  kind: DocumentKind;
  urlId: number | null;
  primaryFileId: string | null;
  title: string;
  sourceLabel: string | null;
  summary: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  anchor: boolean;
  anchorScore: number;
  signalScore: number;
  reasons: Set<string>;
  matchedIssues: Set<string>;
  matchedAgencies: Set<string>;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "where",
  "what",
  "which",
  "when",
  "have",
  "has",
  "had",
  "were",
  "been",
  "being",
  "about",
  "currently",
  "current",
  "force",
  "does",
  "appear",
  "across",
  "their",
  "they",
  "them",
  "into",
  "there",
  "than",
  "then",
  "also",
  "could",
  "would",
  "should",
  "agency",
  "agencies",
  "issue",
  "issues",
  "document",
  "documents",
  "record",
  "records",
]);

const ciContains = (value: string) => ({
  contains: value,
  mode: Prisma.QueryMode.insensitive,
});

const documentContextSelect = {
  id: true,
  kind: true,
  urlId: true,
  primaryFileId: true,
  createdAt: true,
  updatedAt: true,
  url: {
    select: {
      title: true,
      url: true,
      publishedAt: true,
    },
  },
  primaryFile: {
    select: {
      fileName: true,
      sourceUrl: true,
      sourcePublishedAt: true,
    },
  },
} satisfies Prisma.DocumentSelect;

type DocumentWithContext = Prisma.DocumentGetPayload<{
  select: typeof documentContextSelect;
}>;

function clampLimit(value: unknown, fallback = 8, max = 12) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function uniqueNumbers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      ),
    ),
  );
}

function normalizeScope(value: unknown): GovernanceWorkspaceSourceScope {
  return value === "files" ||
    value === "urls" ||
    value === "mixed" ||
    value === "all"
    ? value
    : "all";
}

function normalizeWorkflowMode(
  value: unknown,
): GovernanceWorkspaceWorkflowMode {
  return value === "landscape" || value === "case_trace" || value === "auto"
    ? value
    : "auto";
}

function resolveWorkflowPlan(args: {
  requestedMode: GovernanceWorkspaceWorkflowMode;
  question: string;
  tokens: string[];
  anchorDocumentIds: string[];
  anchorUrlIds: number[];
}) {
  if (args.requestedMode === "landscape") {
    return {
      requestedMode: args.requestedMode,
      resolvedMode: "landscape" as const,
      rationale:
        "Landscape mode was chosen explicitly, so retrieval will optimize for broad governance scoping across agencies, directions, and compliance records.",
      expectedOutputs: [
        "Agency and jurisdiction map",
        "Active directions or orders",
        "Follow-up actions and compliance gaps",
      ],
    };
  }

  if (args.requestedMode === "case_trace") {
    return {
      requestedMode: args.requestedMode,
      resolvedMode: "case_trace" as const,
      rationale:
        "Case tracing mode was chosen explicitly, so retrieval will optimize for one-unit chronology, conflicting positions, and contradiction-ready evidence.",
      expectedOutputs: [
        "Chronological case trail",
        "Contradiction and override candidates",
        "Escalation-ready evidence pack",
      ],
    };
  }

  const haystack = `${args.question} ${args.tokens.join(" ")}`.toLowerCase();

  const caseSignals = [
    "why",
    "contradict",
    "conflict",
    "permitted",
    "restricted",
    "trace",
    "timeline",
    "case",
    "unit",
    "facility",
    "override",
    "supersede",
  ].filter((term) => haystack.includes(term)).length;

  const landscapeSignals = [
    "currently in force",
    "current",
    "what is in force",
    "map",
    "landscape",
    "jurisdiction",
    "agencies",
    "active directions",
    "follow up",
    "follow-up",
    "compliance gaps",
    "governing",
  ].filter((term) => haystack.includes(term)).length;

  const anchorBias =
    args.anchorDocumentIds.length + args.anchorUrlIds.length >= 2 ? 1 : 0;

  if (caseSignals + anchorBias > landscapeSignals) {
    return {
      requestedMode: args.requestedMode,
      resolvedMode: "case_trace" as const,
      rationale:
        "The question reads like a single-case or contradiction review, so the workspace will prioritize chronology, conflicting positions, and cross-record tracing.",
      expectedOutputs: [
        "Chronological case trail",
        "Contradiction and override candidates",
        "Escalation-ready evidence pack",
      ],
    };
  }

  return {
    requestedMode: args.requestedMode,
    resolvedMode: "landscape" as const,
    rationale:
      "The question reads like broad issue scoping, so the workspace will prioritize agencies, active directions, follow-up actions, and compliance coverage.",
    expectedOutputs: [
      "Agency and jurisdiction map",
      "Active directions or orders",
      "Follow-up actions and compliance gaps",
    ],
  };
}

function normalizeInput(input: GovernanceWorkspaceQueryInput): Required<
  Pick<GovernanceWorkspaceQueryInput, "anchorDocumentIds" | "anchorUrlIds">
> & {
  question: string;
  sourceScope: GovernanceWorkspaceSourceScope;
  workflowMode: GovernanceWorkspaceWorkflowMode;
  limit: number;
} {
  return {
    question: String(input.question || "").trim(),
    anchorDocumentIds: uniqueStrings(input.anchorDocumentIds),
    anchorUrlIds: uniqueNumbers(input.anchorUrlIds),
    sourceScope: normalizeScope(input.sourceScope),
    workflowMode: normalizeWorkflowMode(input.workflowMode),
    limit: clampLimit(input.limit),
  };
}

function tokenizeQuestion(question: string): string[] {
  return Array.from(
    new Set(
      String(question || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(
          (token) =>
            token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token),
        )
        .slice(0, 8),
    ),
  );
}

function documentAllowed(
  kind: DocumentKind,
  scope: GovernanceWorkspaceSourceScope,
) {
  if (scope === "files") return kind === "FILE";
  if (scope === "urls") return kind === "URL";
  return true;
}

function matchedTokens(
  textParts: Array<string | null | undefined>,
  tokens: string[],
) {
  if (!tokens.length) return [] as string[];
  const haystack = textParts.filter(Boolean).join(" ").toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).slice(0, 3);
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function documentDescriptor(doc: DocumentWithContext) {
  const isUrl = doc.kind === "URL";
  return {
    title: isUrl
      ? doc.url?.title || `Saved URL ${doc.urlId ?? "document"}`
      : doc.primaryFile?.fileName || `File ${doc.primaryFileId ?? "document"}`,
    sourceLabel: isUrl
      ? (doc.url?.url ?? null)
      : (doc.primaryFile?.sourceUrl ?? null),
    publishedAt: isUrl
      ? toIso(doc.url?.publishedAt)
      : toIso(doc.primaryFile?.sourcePublishedAt),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

function addCandidate(
  map: Map<string, CandidateAccumulator>,
  args: {
    doc: DocumentWithContext;
    scope: GovernanceWorkspaceSourceScope;
    reason: string;
    signalScore: number;
    anchorScore?: number;
    issueTitle?: string | null;
    agencyNames?: Array<string | null | undefined>;
    summary?: string | null;
  },
) {
  if (!documentAllowed(args.doc.kind, args.scope)) return;

  const descriptor = documentDescriptor(args.doc);
  const existing = map.get(args.doc.id) ?? {
    documentId: args.doc.id,
    kind: args.doc.kind,
    urlId: args.doc.urlId,
    primaryFileId: args.doc.primaryFileId,
    title: descriptor.title,
    sourceLabel: descriptor.sourceLabel,
    summary: args.summary ?? null,
    publishedAt: descriptor.publishedAt,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
    anchor: false,
    anchorScore: 0,
    signalScore: 0,
    reasons: new Set<string>(),
    matchedIssues: new Set<string>(),
    matchedAgencies: new Set<string>(),
  };

  existing.signalScore += args.signalScore;
  existing.anchorScore += args.anchorScore ?? 0;
  existing.anchor =
    existing.anchor || Boolean(args.anchorScore && args.anchorScore > 0);
  existing.reasons.add(args.reason);
  if (!existing.summary && args.summary) existing.summary = args.summary;
  if (args.issueTitle) existing.matchedIssues.add(args.issueTitle);
  for (const agencyName of args.agencyNames || []) {
    if (agencyName) existing.matchedAgencies.add(agencyName);
  }

  map.set(args.doc.id, existing);
}

function buildContainsOr(tokens: string[], fields: string[]) {
  return tokens.flatMap((token) =>
    fields.map((field) => ({
      [field]: ciContains(token),
    })),
  );
}

async function attachDocumentStats(documentIds: string[]) {
  if (!documentIds.length) {
    return new Map<
      string,
      {
        claimCount: number;
        eventCount: number;
        gapCount: number;
        relationCount: number;
      }
    >();
  }

  const [claimCounts, eventCounts, gapCounts, relationCounts] =
    await Promise.all([
      prisma.documentClaim.groupBy({
        by: ["traceId"],
        where: { trace: { sourceDocumentId: { in: documentIds } } },
        _count: { _all: true },
      }),
      prisma.documentEvent.groupBy({
        by: ["traceId"],
        where: { trace: { sourceDocumentId: { in: documentIds } } },
        _count: { _all: true },
      }),
      prisma.governanceGap.groupBy({
        by: ["traceId"],
        where: { trace: { sourceDocumentId: { in: documentIds } } },
        _count: { _all: true },
      }),
      prisma.documentRelation.groupBy({
        by: ["traceId"],
        where: { trace: { sourceDocumentId: { in: documentIds } } },
        _count: { _all: true },
      }),
    ]);

  const traceToDocument = new Map<string, string>();
  const traces = await prisma.extractionTrace.findMany({
    where: { sourceDocumentId: { in: documentIds } },
    select: { id: true, sourceDocumentId: true },
  });
  for (const trace of traces)
    traceToDocument.set(trace.id, trace.sourceDocumentId);

  const stats = new Map<
    string,
    {
      claimCount: number;
      eventCount: number;
      gapCount: number;
      relationCount: number;
    }
  >();

  const ensure = (documentId: string) => {
    const current = stats.get(documentId) ?? {
      claimCount: 0,
      eventCount: 0,
      gapCount: 0,
      relationCount: 0,
    };
    stats.set(documentId, current);
    return current;
  };

  for (const row of claimCounts) {
    const documentId = traceToDocument.get(row.traceId);
    if (!documentId) continue;
    ensure(documentId).claimCount += row._count._all;
  }

  for (const row of eventCounts) {
    const documentId = traceToDocument.get(row.traceId);
    if (!documentId) continue;
    ensure(documentId).eventCount += row._count._all;
  }

  for (const row of gapCounts) {
    const documentId = traceToDocument.get(row.traceId);
    if (!documentId) continue;
    ensure(documentId).gapCount += row._count._all;
  }

  for (const row of relationCounts) {
    const documentId = traceToDocument.get(row.traceId);
    if (!documentId) continue;
    ensure(documentId).relationCount += row._count._all;
  }

  return stats;
}

export async function queryGovernanceWorkspaceEvidence(
  rawInput: GovernanceWorkspaceQueryInput,
) {
  const input = normalizeInput(rawInput);
  const tokens = tokenizeQuestion(input.question);
  const workflow = resolveWorkflowPlan({
    requestedMode: input.workflowMode,
    question: input.question,
    tokens,
    anchorDocumentIds: input.anchorDocumentIds,
    anchorUrlIds: input.anchorUrlIds,
  });
  const candidates = new Map<string, CandidateAccumulator>();

  const anchorDocuments =
    input.anchorDocumentIds.length || input.anchorUrlIds.length
      ? await prisma.document.findMany({
          where: {
            OR: [
              ...(input.anchorDocumentIds.length
                ? [{ id: { in: input.anchorDocumentIds } }]
                : []),
              ...(input.anchorUrlIds.length
                ? [{ urlId: { in: input.anchorUrlIds } }]
                : []),
            ],
          },
          select: documentContextSelect,
        })
      : [];

  for (const doc of anchorDocuments) {
    addCandidate(candidates, {
      doc,
      scope: input.sourceScope,
      reason: "Anchor evidence selected by the user",
      signalScore: 0,
      anchorScore: 100,
    });
  }

  if (tokens.length) {
    const metadataHits = await prisma.document.findMany({
      where: {
        OR: tokens.flatMap((token) => [
          {
            url: {
              is: {
                title: ciContains(token),
              },
            },
          },
          {
            url: {
              is: {
                url: ciContains(token),
              },
            },
          },
          {
            primaryFile: {
              is: {
                fileName: ciContains(token),
              },
            },
          },
          {
            primaryFile: {
              is: {
                sourceUrl: ciContains(token),
              },
            },
          },
        ]),
      },
      take: 24,
      select: documentContextSelect,
    });

    for (const row of metadataHits) {
      const hits = matchedTokens(
        [
          row.url?.title,
          row.url?.url,
          row.primaryFile?.fileName,
          row.primaryFile?.sourceUrl,
        ],
        tokens,
      );

      addCandidate(candidates, {
        doc: row,
        scope: input.sourceScope,
        reason: hits.length
          ? `Title/source match: ${hits.join(", ")}`
          : "Document title or source metadata matches the question",
        signalScore: 28 + hits.length * 4,
      });
    }

    const issueHits = await prisma.governanceIssue.findMany({
      where: {
        OR: buildContainsOr(tokens, ["title", "summary"]),
        originTrace: { isNot: null },
      } as any,
      take: 24,
      include: {
        originTrace: {
          select: {
            sourceDocument: {
              select: documentContextSelect,
            },
          },
        },
      },
    });

    for (const row of issueHits) {
      const doc = row.originTrace?.sourceDocument;
      if (!doc) continue;

      const hits = matchedTokens([row.title, row.summary], tokens);

      addCandidate(candidates, {
        doc,
        scope: input.sourceScope,
        reason: hits.length
          ? `Issue match: ${hits.join(", ")}`
          : "Issue title or summary matches the question",
        signalScore: 35 + hits.length * 6,
        issueTitle: row.title,
        summary: row.summary,
      });
    }

    const claimHits = await prisma.documentClaim.findMany({
      where: {
        OR: buildContainsOr(tokens, [
          "claimText",
          "claimSummary",
          "scopeText",
          "normalizedKey",
        ]),
      } as any,
      take: 40,
      include: {
        issue: { select: { title: true } },
        subjectAgency: { select: { name: true } },
        trace: {
          select: {
            sourceDocument: {
              select: documentContextSelect,
            },
          },
        },
      },
    });

    for (const row of claimHits) {
      const doc = row.trace.sourceDocument;
      const hits = matchedTokens(
        [row.claimText, row.claimSummary, row.scopeText, row.normalizedKey],
        tokens,
      );

      addCandidate(candidates, {
        doc,
        scope: input.sourceScope,
        reason: hits.length
          ? `Claim match: ${hits.join(", ")}`
          : "Claim language matches the question",
        signalScore: 24 + hits.length * 5,
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.subjectAgency?.name],
        summary: row.claimSummary ?? row.claimText,
      });
    }

    const eventHits = await prisma.documentEvent.findMany({
      where: {
        OR: buildContainsOr(tokens, ["title", "summary"]),
      } as any,
      take: 30,
      include: {
        issue: { select: { title: true } },
        actorAgency: { select: { name: true } },
        trace: {
          select: {
            sourceDocument: {
              select: documentContextSelect,
            },
          },
        },
      },
    });

    for (const row of eventHits) {
      const doc = row.trace.sourceDocument;
      const hits = matchedTokens([row.title, row.summary], tokens);

      addCandidate(candidates, {
        doc,
        scope: input.sourceScope,
        reason: hits.length
          ? `Event match: ${hits.join(", ")}`
          : "Event summary matches the question",
        signalScore: 20 + hits.length * 4,
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.actorAgency?.name],
        summary: row.summary ?? row.title,
      });
    }

    const gapHits = await prisma.governanceGap.findMany({
      where: {
        OR: buildContainsOr(tokens, ["summary"]),
      } as any,
      take: 30,
      include: {
        issue: { select: { title: true } },
        primaryAgency: { select: { name: true } },
        secondaryAgency: { select: { name: true } },
        trace: {
          select: {
            sourceDocument: {
              select: documentContextSelect,
            },
          },
        },
      },
    });

    for (const row of gapHits) {
      const doc = row.trace.sourceDocument;
      const hits = matchedTokens([row.summary], tokens);

      addCandidate(candidates, {
        doc,
        scope: input.sourceScope,
        reason: hits.length
          ? `Gap match: ${hits.join(", ")}`
          : "Gap summary matches the question",
        signalScore: 18 + hits.length * 4,
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.primaryAgency?.name, row.secondaryAgency?.name],
        summary: row.summary,
      });
    }

    const relationHits = await prisma.documentRelation.findMany({
      where: {
        OR: buildContainsOr(tokens, ["rationale"]),
      } as any,
      take: 30,
      include: {
        issue: { select: { title: true } },
        fromAgency: { select: { name: true } },
        toAgency: { select: { name: true } },
        trace: {
          select: {
            sourceDocument: {
              select: documentContextSelect,
            },
          },
        },
      },
    });

    for (const row of relationHits) {
      const doc = row.trace.sourceDocument;
      const hits = matchedTokens([row.rationale], tokens);

      addCandidate(candidates, {
        doc,
        scope: input.sourceScope,
        reason: hits.length
          ? `Relation match: ${hits.join(", ")}`
          : "Inter-agency relation rationale matches the question",
        signalScore: 16 + hits.length * 4,
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.fromAgency?.name, row.toAgency?.name],
        summary: row.rationale,
      });
    }
  }

  const ranked = Array.from(candidates.values())
    .map((candidate) => ({
      ...candidate,
      matchScore: candidate.anchorScore + candidate.signalScore,
    }))
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    })
    .slice(0, input.limit);

  const statsByDocument = await attachDocumentStats(
    ranked.map((candidate) => candidate.documentId),
  );

  const items = ranked.map((candidate) => {
    const stats = statsByDocument.get(candidate.documentId) ?? {
      claimCount: 0,
      eventCount: 0,
      gapCount: 0,
      relationCount: 0,
    };

    return {
      documentId: candidate.documentId,
      kind: candidate.kind,
      urlId: candidate.urlId,
      primaryFileId: candidate.primaryFileId,
      title: candidate.title,
      sourceLabel: candidate.sourceLabel,
      summary: candidate.summary,
      publishedAt: candidate.publishedAt,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      matchScore: candidate.matchScore,
      anchorScore: candidate.anchorScore,
      signalScore: candidate.signalScore,
      anchor: candidate.anchor,
      reasons: Array.from(candidate.reasons).slice(0, 4),
      matchedIssues: Array.from(candidate.matchedIssues).slice(0, 3),
      matchedAgencies: Array.from(candidate.matchedAgencies).slice(0, 3),
      stats,
    };
  });

  return {
    query: {
      question: input.question,
      tokens,
      sourceScope: input.sourceScope,
      workflowMode: input.workflowMode,
      anchorDocumentIds: input.anchorDocumentIds,
      anchorUrlIds: input.anchorUrlIds,
      limit: input.limit,
    },
    workflow,
    selectedDocumentId: items[0]?.documentId ?? null,
    totalCandidates: items.length,
    candidates: items,
  };
}
