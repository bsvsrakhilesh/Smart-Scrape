import prisma from "../config/database";
import { env } from "../config/env";
import {
  Prisma,
  DocumentKind,
  DocumentRelationType,
} from "../generated/prisma/client";
import { analyzeRelation } from "./contradictionAlignment.service";
import { embedQuery, toPgVectorLiteral } from "./embeddings.service";
import { resolveCollectorPurposeEvidenceScope } from "./collectorPurposeEvidence.service";

type GovernanceWorkspaceSourceScope = "all" | "files" | "urls" | "mixed";
type GovernanceWorkspaceWorkflowMode =
  | "auto"
  | "landscape"
  | "case_trace"
  | "question_review";
type GovernanceWorkspaceResolvedMode = Exclude<
  GovernanceWorkspaceWorkflowMode,
  "auto"
>;

type GovernanceWorkspaceQueryInput = {
  question?: string | null;
  anchorDocumentIds?: string[];
  anchorUrlIds?: number[];
  sourceScope?: GovernanceWorkspaceSourceScope;
  workflowMode?: GovernanceWorkspaceWorkflowMode;
  limit?: number;
  collectorPurposeId?: string | null;
  ownerId?: string | null;
  officerFilters?: GovernanceWorkspaceOfficerFilters | null;
};

type GovernanceWorkspaceOfficerFilters = {
  questionType?: string | null;
  issueHint?: string | null;
  jurisdiction?: string | null;
  timeRange?: string | null;
  pollutants?: string[];
  agencies?: string[];
};

type GovernanceWorkspaceRetrievalLane =
  | "anchor"
  | "metadata"
  | "issue_graph"
  | "claim_graph"
  | "event_graph"
  | "gap_graph"
  | "relation_graph"
  | "keyword_chunk"
  | "semantic_chunk";

type GovernanceWorkspaceCoverageFamily =
  | "anchor"
  | "metadata"
  | "graph"
  | "chunk";

type CandidateAccumulator = {
  documentId: string;
  kind: DocumentKind;
  urlId: number | null;
  primaryFileId: string | null;
  mimeType: string | null;
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
  matchedLanes: Set<GovernanceWorkspaceRetrievalLane>;
};

type RankedCandidate = CandidateAccumulator & {
  authorityScore: number;
  freshnessScore: number;
  matchScore: number;
  whyRanked: string[];
  duplicateCount: number;
  clusterDocumentIds: string[];
  clusterKinds: DocumentKind[];
  clusterReason: string | null;
  retrievalLanes: GovernanceWorkspaceRetrievalLane[];
  coverageFamilies: GovernanceWorkspaceCoverageFamily[];
  diversityReason: string | null;
  temporalReason: string | null;
};

type GovernanceWorkspaceQueryType =
  | "broad_scan"
  | "case_review"
  | "chronology_review"
  | "contradiction_review"
  | "question_review";

type GovernanceWorkspaceIssueSignal = {
  id: string;
  title: string;
  kind: string | null;
  status: string | null;
};

type GovernanceWorkspaceAgencySignal = {
  id: string;
  name: string;
  category: string | null;
  jurisdiction: string | null;
};

type GovernanceWorkspaceQueryUnderstanding = {
  queryType: GovernanceWorkspaceQueryType;
  focusTerms: string[];
  timeHints: string[];
  locationHints: string[];
  matchedIssues: GovernanceWorkspaceIssueSignal[];
  matchedAgencies: GovernanceWorkspaceAgencySignal[];
};

type ChunkRetrievalHit = {
  documentId: string;
  retrievalKind: "keyword_chunk" | "semantic_chunk";
  summary: string;
  signalScore: number;
  reason: string;
};

type GovernanceWorkspaceRetrievalDecision = {
  shouldAutoSelect: boolean;
  recommendedDocumentId: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
  topCandidateScore: number | null;
  runnerUpScore: number | null;
  scoreMargin: number | null;
};

type GovernanceWorkspaceDiversityControl = {
  active: boolean;
  rationale: string;
  balancedBy: string[];
};

type GovernanceWorkspaceTemporalControl = {
  active: boolean;
  mode: "current_preference" | "historical_neutral" | "neutral";
  rationale: string;
  preferredSignals: string[];
};

type GovernanceWorkspaceContradictionCandidate = {
  relationId: string;
  relationType: DocumentRelationType;
  bucket:
    | "conflict"
    | "alignment"
    | "temporal_shift_candidate"
    | "scope_variant_candidate"
    | "reference";
  requiresAnalystReview: boolean;
  sameActor: boolean;
  scopeWarning: boolean;
  confidence: number | null;
  reason: string;
  rationale: string | null;
  issueTitle: string | null;
  fromDocumentId: string;
  fromDocumentTitle: string;
  toDocumentId: string;
  toDocumentTitle: string;
  fromAgencyName: string | null;
  toAgencyName: string | null;
};

type GovernanceWorkspaceContradictionGroup = {
  groupKey: string;
  issueTitle: string | null;
  label: string;
  documentIds: string[];
  documentTitles: string[];
  candidateCount: number;
  reviewCount: number;
  strongestBucket:
    | "conflict"
    | "alignment"
    | "temporal_shift_candidate"
    | "scope_variant_candidate"
    | "reference";
  strongestReason: string;
  relationIds: string[];
};

type GovernanceWorkspaceOverrideHint = {
  relationId: string;
  relationType: DocumentRelationType;
  preferredDocumentId: string;
  preferredDocumentTitle: string;
  supersededDocumentId: string;
  supersededDocumentTitle: string;
  confidence: number | null;
  basis: string;
};

type GovernanceWorkspaceContradictionFoundation = {
  active: boolean;
  rationale: string;
  summary: {
    contradictionCount: number;
    reviewCount: number;
    overrideHintCount: number;
    groupCount: number;
  };
  groups: GovernanceWorkspaceContradictionGroup[];
  candidates: GovernanceWorkspaceContradictionCandidate[];
  overrideHints: GovernanceWorkspaceOverrideHint[];
  involvedDocumentIds: string[];
};

type GovernanceWorkspaceCaseTrailEvent = {
  eventId: string;
  eventType:
    | "document"
    | "conflict_cluster"
    | "override_hint"
    | "override_chain";
  title: string;
  subtitle: string | null;
  issueTitle: string | null;
  narrative: string;
  sortDate: string | null;
  dateLabel: string;
  documentIds: string[];
  confidence: number | null;
};

type GovernanceWorkspaceCaseTrailFoundation = {
  active: boolean;
  rationale: string;
  summary: {
    eventCount: number;
    documentEventCount: number;
    conflictEventCount: number;
    overrideEventCount: number;
    overrideChainEventCount: number;
  };
  events: GovernanceWorkspaceCaseTrailEvent[];
};

type GovernanceWorkspaceDocumentComparison = {
  comparisonKey: string;
  issueTitle: string | null;
  documentIds: string[];
  documentTitles: string[];
  contradictionSignalCount: number;
  reviewCount: number;
  overrideHintCount: number;
  strongestBucket:
    | "conflict"
    | "alignment"
    | "temporal_shift_candidate"
    | "scope_variant_candidate"
    | "reference";
  strongestReason: string;
  relationTypes: DocumentRelationType[];
  preferredDocumentId: string | null;
  preferredDocumentTitle: string | null;
  supersededDocumentId: string | null;
  supersededDocumentTitle: string | null;
  involvedChainKeys: string[];
  changeSummary: string;
};

type GovernanceWorkspaceComparisonSurface = {
  active: boolean;
  rationale: string;
  summary: {
    comparisonCount: number;
    reviewCount: number;
    preferredPairCount: number;
  };
  comparisons: GovernanceWorkspaceDocumentComparison[];
};

type GovernanceWorkspaceLandscapeIssue = {
  title: string;
  documentCount: number;
  anchorCount: number;
  currentPreferredCount: number;
  conflictLinkedCount: number;
};

type GovernanceWorkspaceLandscapeAgency = {
  name: string;
  documentCount: number;
  currentPreferredCount: number;
  conflictLinkedCount: number;
};

type GovernanceWorkspaceLandscapeSpotlightDocument = {
  documentId: string;
  title: string;
  summary: string | null;
  issueTitle: string | null;
  agencyName: string | null;
  reason: string;
  anchor: boolean;
  currentPreferred: boolean;
  conflictLinked: boolean;
};

type GovernanceWorkspaceLandscapeMappingSurface = {
  active: boolean;
  rationale: string;
  summary: {
    issueCount: number;
    agencyCount: number;
    spotlightCount: number;
    currentPreferredCount: number;
    conflictLinkedCount: number;
  };
  sourceCoverage: {
    fileCount: number;
    urlCount: number;
    anchorCount: number;
    metadataCount: number;
    graphCount: number;
    chunkCount: number;
  };
  topIssues: GovernanceWorkspaceLandscapeIssue[];
  topAgencies: GovernanceWorkspaceLandscapeAgency[];
  spotlightDocuments: GovernanceWorkspaceLandscapeSpotlightDocument[];
};

type GovernanceWorkspaceCaseTracingFocusDocument = {
  documentId: string;
  title: string;
  issueTitle: string | null;
  agencyName: string | null;
  reason: string;
  conflictLinked: boolean;
  currentPreferred: boolean;
};

type GovernanceWorkspaceCaseTracingSurface = {
  active: boolean;
  rationale: string;
  summary: {
    focusDocumentCount: number;
    contradictionClusterCount: number;
    comparisonCount: number;
    overrideChainCount: number;
    timelineHighlightCount: number;
    reviewCount: number;
  };
  focusDocuments: GovernanceWorkspaceCaseTracingFocusDocument[];
  contradictionClusters: GovernanceWorkspaceContradictionGroup[];
  comparisonPairs: GovernanceWorkspaceDocumentComparison[];
  overrideChains: GovernanceWorkspaceOverrideChain[];
  timelineHighlights: GovernanceWorkspaceCaseTrailEvent[];
};

type GovernanceWorkspaceQuestionReviewSignal = {
  id: string;
  label: string;
  detail: string;
  sourceTitle: string | null;
  issueTitle: string | null;
  agencyName: string | null;
  documentIds: string[];
  confidence: number | null;
};

type GovernanceWorkspaceQuestionReviewFactor = {
  key: string;
  label: string;
  description: string;
  count: number;
  strongestSignal: GovernanceWorkspaceQuestionReviewSignal | null;
};

type GovernanceWorkspaceQuestionReviewActorInput = {
  actorName: string;
  role: string | null;
  signalCount: number;
  strongestSignal: GovernanceWorkspaceQuestionReviewSignal | null;
};

type GovernanceWorkspaceQuestionReviewSurface = {
  active: boolean;
  rationale: string;
  question: string;
  queryType: GovernanceWorkspaceQueryType;
  summary: {
    sourceCount: number;
    factorCount: number;
    timelineHighlightCount: number;
    actorCount: number;
    gapCount: number;
    reviewCount: number;
  };
  answerSignals: GovernanceWorkspaceQuestionReviewSignal[];
  factors: GovernanceWorkspaceQuestionReviewFactor[];
  timelineHighlights: GovernanceWorkspaceCaseTrailEvent[];
  actorInputs: GovernanceWorkspaceQuestionReviewActorInput[];
  openQuestions: string[];
};

type GovernanceWorkspaceOverrideChain = {
  chainKey: string;
  documentIds: string[];
  documentTitles: string[];
  edgeCount: number;
  maxConfidence: number | null;
  basis: string;
};

type GovernanceWorkspaceOverrideChainFoundation = {
  active: boolean;
  rationale: string;
  summary: {
    chainCount: number;
    linkedDocumentCount: number;
  };
  chains: GovernanceWorkspaceOverrideChain[];
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
      mimeType: true,
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
  return value === "landscape" ||
    value === "case_trace" ||
    value === "question_review" ||
    value === "auto"
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

  if (args.requestedMode === "question_review") {
    return {
      requestedMode: args.requestedMode,
      resolvedMode: "question_review" as const,
      rationale:
        "Question Review mode was chosen explicitly, so retrieval will optimize for evidence-backed answers, factors considered, chronology, actor inputs, actions, and unresolved checks.",
      expectedOutputs: [
        "Evidence-backed answer",
        "Factors and chronology",
        "Verification and gap register",
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

  const questionReviewSignals = [
    "what factors",
    "why",
    "what evidence",
    "evidence supports",
    "actions followed",
    "what actions",
    "who acted",
    "who was responsible",
    "what was considered",
    "considered",
    "previous years",
    "past years",
    "how did",
    "position change",
    "what happened",
    "explain",
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

  if (questionReviewSignals > 0) {
    return {
      requestedMode: args.requestedMode,
      resolvedMode: "question_review" as const,
      rationale:
        "The question asks for an evidence-backed explanation, so the workspace will prioritize answer signals, factors considered, chronology, actor inputs, and verification gaps.",
      expectedOutputs: [
        "Evidence-backed answer",
        "Factors and chronology",
        "Verification and gap register",
      ],
    };
  }

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
  collectorPurposeId: string | null;
  ownerId: string;
  officerFilters: GovernanceWorkspaceOfficerFilters;
} {
  const officerFilters = normalizeOfficerFilters(input.officerFilters);

  return {
    question: String(input.question || "").trim(),
    anchorDocumentIds: uniqueStrings(input.anchorDocumentIds),
    anchorUrlIds: uniqueNumbers(input.anchorUrlIds),
    sourceScope: normalizeScope(input.sourceScope),
    workflowMode: normalizeWorkflowMode(input.workflowMode),
    limit: clampLimit(input.limit),
    collectorPurposeId: String(input.collectorPurposeId || "").trim() || null,
    ownerId: String(input.ownerId || "local").trim() || "local",
    officerFilters,
  };
}

function normalizeOfficerFilters(
  filters: GovernanceWorkspaceQueryInput["officerFilters"],
): GovernanceWorkspaceOfficerFilters {
  if (!filters || typeof filters !== "object") return {};
  return {
    questionType: trimOptional(filters.questionType),
    issueHint: trimOptional(filters.issueHint),
    jurisdiction: trimOptional(filters.jurisdiction),
    timeRange: trimOptional(filters.timeRange),
    pollutants: uniqueStrings(filters.pollutants).slice(0, 8),
    agencies: uniqueStrings(filters.agencies).slice(0, 8),
  };
}

function trimOptional(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function officerFilterTerms(filters: GovernanceWorkspaceOfficerFilters): string[] {
  return uniqueStrings([
    filters.questionType,
    filters.issueHint,
    filters.jurisdiction,
    filters.timeRange,
    ...(filters.pollutants ?? []),
    ...(filters.agencies ?? []),
  ]);
}

function retrievalQuestionWithFilters(
  question: string,
  filters: GovernanceWorkspaceOfficerFilters,
) {
  const terms = officerFilterTerms(filters);
  if (!terms.length) return question;
  return [question, `Officer filters: ${terms.join("; ")}`].filter(Boolean).join("\n");
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

function extractTimeHints(question: string): string[] {
  const text = String(question || "").trim();
  const hints: string[] = [];

  if (/\b(current|currently|active|latest|today|now|in force)\b/i.test(text)) {
    hints.push("Current or in-force view");
  }

  const rangeMatch = text.match(/\bfrom\s+(\d{4})\s+to\s+(\d{4})\b/i);
  if (rangeMatch) {
    hints.push(`${rangeMatch[1]} to ${rangeMatch[2]}`);
  }

  const yearMatches = Array.from(
    new Set(text.match(/\b(19|20)\d{2}\b/g) ?? []),
  );
  for (const year of yearMatches.slice(0, 3)) {
    if (!hints.includes(year)) hints.push(year);
  }

  if (/\b(history|historical|timeline|chronology|trace)\b/i.test(text)) {
    hints.push("Chronology requested");
  }

  return hints.slice(0, 4);
}

function extractLocationHints(question: string): string[] {
  const text = String(question || "");
  const matches = Array.from(
    text.matchAll(
      /\b(?:in|for|across|within|at)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/g,
    ),
  )
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(matches)).slice(0, 4);
}

function resolveQueryType(args: {
  workflowMode: GovernanceWorkspaceResolvedMode;
  question: string;
}): GovernanceWorkspaceQueryType {
  const text = String(args.question || "").toLowerCase();

  if (
    args.workflowMode === "question_review" ||
    /\b(what factors|what evidence|evidence supports|what actions|actions followed|who acted|who was responsible|what was considered|considered|previous years|past years|why|how did|explain)\b/.test(
      text,
    )
  ) {
    return "question_review";
  }

  if (
    /\b(contradict|conflict|override|supersede|permitted|restricted|non-compliant|compliant)\b/.test(
      text,
    )
  ) {
    return "contradiction_review";
  }

  if (
    /\b(trace|timeline|chronology|history|from\s+\d{4}\s+to\s+\d{4})\b/.test(
      text,
    )
  ) {
    return "chronology_review";
  }

  if (args.workflowMode === "case_trace") {
    return "case_review";
  }

  return "broad_scan";
}

async function buildQueryUnderstanding(args: {
  question: string;
  tokens: string[];
  workflowMode: GovernanceWorkspaceResolvedMode;
}): Promise<GovernanceWorkspaceQueryUnderstanding> {
  const focusTerms = args.tokens.slice(0, 6);
  const timeHints = extractTimeHints(args.question);
  const locationHints = extractLocationHints(args.question);
  const queryType = resolveQueryType({
    workflowMode: args.workflowMode,
    question: args.question,
  });

  if (!args.tokens.length) {
    return {
      queryType,
      focusTerms,
      timeHints,
      locationHints,
      matchedIssues: [],
      matchedAgencies: [],
    };
  }

  const [issueHits, agencyHits] = await Promise.all([
    prisma.governanceIssue.findMany({
      where: {
        OR: buildContainsOr(args.tokens, ["title", "summary"]),
      } as any,
      take: 6,
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
      },
    }),
    prisma.agency.findMany({
      where: {
        OR: buildContainsOr(args.tokens, ["name", "shortName", "jurisdiction"]),
      } as any,
      take: 6,
      select: {
        id: true,
        name: true,
        category: true,
        jurisdiction: true,
      },
    }),
  ]);

  return {
    queryType,
    focusTerms,
    timeHints,
    locationHints,
    matchedIssues: issueHits.map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind ?? null,
      status: item.status ?? null,
    })),
    matchedAgencies: agencyHits.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category ?? null,
      jurisdiction: item.jurisdiction ?? null,
    })),
  };
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

function isPdfCandidate(candidate: RankedCandidate) {
  return (
    candidate.kind === "FILE" &&
    (candidate.mimeType?.toLowerCase().includes("pdf") ||
      /\.pdf$/i.test(candidate.title))
  );
}

function isTextFileCandidate(candidate: RankedCandidate) {
  return (
    candidate.kind === "FILE" &&
    (candidate.mimeType?.toLowerCase().startsWith("text/") ||
      /\.txt$/i.test(candidate.title))
  );
}

function fileEvidencePreference(candidate: RankedCandidate) {
  if (isPdfCandidate(candidate)) return 3;
  if (candidate.kind === "FILE" && isTextFileCandidate(candidate)) return 2;
  if (candidate.kind === "FILE") return 2;
  return 1;
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function computeFreshnessScore(candidate: CandidateAccumulator) {
  const bestDate =
    parseIsoDate(candidate.publishedAt) ??
    parseIsoDate(candidate.updatedAt) ??
    parseIsoDate(candidate.createdAt);

  if (!bestDate) return 0;

  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - bestDate) / (1000 * 60 * 60 * 24)),
  );

  if (ageDays <= 30) return 12;
  if (ageDays <= 90) return 9;
  if (ageDays <= 365) return 5;
  if (ageDays <= 730) return 2;
  return 0;
}

function computeAuthorityScore(candidate: CandidateAccumulator) {
  const haystack =
    `${candidate.title} ${candidate.sourceLabel ?? ""}`.toLowerCase();

  let score = 0;

  if (
    /\b(gov|nic\.in|cpcb|spcb|dpcc|caqm|ministry|tribunal|court|board|commission|authority)\b/.test(
      haystack,
    )
  ) {
    score += 10;
  }

  score += Math.min(6, candidate.matchedIssues.size * 3);
  score += Math.min(6, candidate.matchedAgencies.size * 3);

  return score;
}

function buildRankingWhy(
  candidate: CandidateAccumulator,
  args: {
    authorityScore: number;
    freshnessScore: number;
  },
) {
  const notes: string[] = [];

  if (candidate.anchorScore > 0) {
    notes.push("Pinned or anchor evidence");
  }

  if (candidate.signalScore >= 40) {
    notes.push("Strong question match");
  } else if (candidate.signalScore >= 24) {
    notes.push("Relevant governance signal match");
  }

  if (args.authorityScore >= 10) {
    notes.push("Institutional or official-source cues");
  } else if (args.authorityScore >= 4) {
    notes.push("Matched governance entities");
  }

  if (args.freshnessScore >= 9) {
    notes.push("Recent source");
  } else if (args.freshnessScore >= 2) {
    notes.push("Moderately recent source");
  }

  return Array.from(new Set(notes)).slice(0, 4);
}

const retrievalLaneOrder: GovernanceWorkspaceRetrievalLane[] = [
  "anchor",
  "metadata",
  "issue_graph",
  "claim_graph",
  "event_graph",
  "gap_graph",
  "relation_graph",
  "keyword_chunk",
  "semantic_chunk",
];

const coverageFamilyOrder: GovernanceWorkspaceCoverageFamily[] = [
  "anchor",
  "metadata",
  "graph",
  "chunk",
];

function sortRetrievalLanes(
  lanes: Iterable<GovernanceWorkspaceRetrievalLane>,
): GovernanceWorkspaceRetrievalLane[] {
  const laneSet = new Set(lanes);
  return retrievalLaneOrder.filter((lane) => laneSet.has(lane));
}

function summarizeCoverageFamilies(
  lanes: Iterable<GovernanceWorkspaceRetrievalLane>,
): GovernanceWorkspaceCoverageFamily[] {
  const families = new Set<GovernanceWorkspaceCoverageFamily>();

  for (const lane of lanes) {
    if (lane === "anchor") {
      families.add("anchor");
    } else if (lane === "metadata") {
      families.add("metadata");
    } else if (lane === "keyword_chunk" || lane === "semantic_chunk") {
      families.add("chunk");
    } else {
      families.add("graph");
    }
  }

  return coverageFamilyOrder.filter((family) => families.has(family));
}

function extendRankingWhyWithCoverage(args: {
  base: string[];
  retrievalLanes: GovernanceWorkspaceRetrievalLane[];
}) {
  const notes = [...args.base];

  const hasChunkSupport = args.retrievalLanes.some(
    (lane) => lane === "keyword_chunk" || lane === "semantic_chunk",
  );
  const hasGraphSupport = args.retrievalLanes.some((lane) =>
    [
      "issue_graph",
      "claim_graph",
      "event_graph",
      "gap_graph",
      "relation_graph",
    ].includes(lane),
  );
  const hasMetadataSupport = args.retrievalLanes.includes("metadata");

  if (hasChunkSupport && hasGraphSupport) {
    notes.push("Supported by graph and raw-text retrieval");
  } else if (hasChunkSupport && hasMetadataSupport) {
    notes.push("Supported by metadata and raw-text retrieval");
  } else if (args.retrievalLanes.length >= 2) {
    notes.push("Supported by multiple retrieval lanes");
  }

  return Array.from(new Set(notes)).slice(0, 5);
}

function rankCandidate(candidate: CandidateAccumulator): RankedCandidate {
  const authorityScore = computeAuthorityScore(candidate);
  const freshnessScore = computeFreshnessScore(candidate);
  const retrievalLanes = sortRetrievalLanes(candidate.matchedLanes);
  const coverageFamilies = summarizeCoverageFamilies(candidate.matchedLanes);

  return {
    ...candidate,
    authorityScore,
    freshnessScore,
    matchScore:
      candidate.anchorScore +
      candidate.signalScore +
      authorityScore +
      freshnessScore,
    whyRanked: extendRankingWhyWithCoverage({
      base: buildRankingWhy(candidate, {
        authorityScore,
        freshnessScore,
      }),
      retrievalLanes,
    }),
    duplicateCount: 0,
    clusterDocumentIds: [candidate.documentId],
    clusterKinds: [candidate.kind],
    clusterReason: null,
    retrievalLanes,
    coverageFamilies,
    diversityReason: null,
    temporalReason: null,
  };
}

function applyOfficerFilterBoosts(
  candidates: Map<string, CandidateAccumulator>,
  filters: GovernanceWorkspaceOfficerFilters,
) {
  const terms = officerFilterTerms(filters);
  if (!terms.length) return;

  for (const candidate of candidates.values()) {
    const haystack = [
      candidate.title,
      candidate.sourceLabel,
      candidate.summary,
      candidate.publishedAt,
      candidate.createdAt,
      candidate.updatedAt,
      ...Array.from(candidate.matchedIssues),
      ...Array.from(candidate.matchedAgencies),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matched = terms.filter((term) =>
      haystack.includes(String(term).toLowerCase()),
    );
    if (!matched.length) continue;
    candidate.signalScore += Math.min(18, matched.length * 6);
    candidate.reasons.add(`Officer filter match: ${matched.slice(0, 3).join(", ")}`);
  }
}

function resolveRetrievalDecision(
  ranked: RankedCandidate[],
): GovernanceWorkspaceRetrievalDecision {
  const top = ranked[0];
  const runnerUp = ranked[1];

  if (!top) {
    return {
      shouldAutoSelect: false,
      recommendedDocumentId: null,
      confidence: "low",
      rationale:
        "No evidence candidates were strong enough to recommend automatically.",
      topCandidateScore: null,
      runnerUpScore: null,
      scoreMargin: null,
    };
  }

  const topCandidateScore = top.matchScore;
  const runnerUpScore = runnerUp?.matchScore ?? null;
  const scoreMargin =
    runnerUpScore === null
      ? topCandidateScore
      : topCandidateScore - runnerUpScore;

  if (top.anchor && topCandidateScore >= 90) {
    return {
      shouldAutoSelect: true,
      recommendedDocumentId: top.documentId,
      confidence: "high",
      rationale:
        "A pinned anchor source is also the strongest match, so the workspace can open it immediately.",
      topCandidateScore,
      runnerUpScore,
      scoreMargin,
    };
  }

  if (
    topCandidateScore >= 82 &&
    (runnerUpScore === null || scoreMargin >= 12)
  ) {
    return {
      shouldAutoSelect: true,
      recommendedDocumentId: top.documentId,
      confidence: "high",
      rationale:
        "The top candidate is clearly stronger than the rest, so the workspace can auto-open it safely.",
      topCandidateScore,
      runnerUpScore,
      scoreMargin,
    };
  }

  if (topCandidateScore >= 64 && (runnerUpScore === null || scoreMargin >= 8)) {
    return {
      shouldAutoSelect: false,
      recommendedDocumentId: top.documentId,
      confidence: "medium",
      rationale:
        "One source looks strongest, but the evidence set is not decisive enough for an automatic jump.",
      topCandidateScore,
      runnerUpScore,
      scoreMargin,
    };
  }

  return {
    shouldAutoSelect: false,
    recommendedDocumentId: top.documentId,
    confidence: "low",
    rationale:
      "Multiple candidates are plausible or the evidence is still thin, so the analyst should choose the source manually.",
    topCandidateScore,
    runnerUpScore,
    scoreMargin,
  };
}

function addCandidate(
  map: Map<string, CandidateAccumulator>,
  args: {
    doc: DocumentWithContext;
    scope: GovernanceWorkspaceSourceScope;
    reason: string;
    signalScore: number;
    lane?: GovernanceWorkspaceRetrievalLane;
    lanes?: GovernanceWorkspaceRetrievalLane[];
    anchorScore?: number;
    issueTitle?: string | null;
    agencyNames?: Array<string | null | undefined>;
    summary?: string | null;
    allowedDocumentIds?: Set<string> | null;
  },
) {
  if (!documentAllowed(args.doc.kind, args.scope)) return;
  if (args.allowedDocumentIds && !args.allowedDocumentIds.has(args.doc.id)) return;

  const descriptor = documentDescriptor(args.doc);
  const existing = map.get(args.doc.id) ?? {
    documentId: args.doc.id,
    kind: args.doc.kind,
    urlId: args.doc.urlId,
    primaryFileId: args.doc.primaryFileId,
    mimeType: args.doc.primaryFile?.mimeType ?? null,
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
    matchedLanes: new Set<GovernanceWorkspaceRetrievalLane>(),
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

  if (args.lane) existing.matchedLanes.add(args.lane);
  for (const lane of args.lanes || []) {
    existing.matchedLanes.add(lane);
  }

  map.set(args.doc.id, existing);
}

function normalizeClusterTitle(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(
      /\b(copy|final|draft|scan|scanned|rev(?:ision)?\s*\d+|v\d+)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeClusterSourceLabel(value: string | null | undefined) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`
      .replace(/\/+$/, "")
      .replace(/^www\./, "");
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

function candidateDateBucket(candidate: RankedCandidate) {
  return (
    String(
      candidate.publishedAt || candidate.updatedAt || candidate.createdAt || "",
    ).slice(0, 10) || "na"
  );
}

function buildCandidateClusterKey(candidate: RankedCandidate) {
  const sourceKey = normalizeClusterSourceLabel(candidate.sourceLabel);
  if (sourceKey) return `source:${sourceKey}`;

  const titleKey = normalizeClusterTitle(candidate.title);
  if (titleKey.length >= 14) {
    return `title:${titleKey}|date:${candidateDateBucket(candidate)}`;
  }

  return `doc:${candidate.documentId}`;
}

function chooseClusterRepresentative(group: RankedCandidate[]) {
  return [...group].sort((a, b) => {
    const sourcePreferenceDelta =
      fileEvidencePreference(b) - fileEvidencePreference(a);
    if (sourcePreferenceDelta !== 0) return sourcePreferenceDelta;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (b.authorityScore !== a.authorityScore) {
      return b.authorityScore - a.authorityScore;
    }
    if (Number(b.anchor) !== Number(a.anchor)) {
      return Number(b.anchor) - Number(a.anchor);
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  })[0];
}

function clusterRankedCandidates(ranked: RankedCandidate[]) {
  const groups = new Map<string, RankedCandidate[]>();

  for (const candidate of ranked) {
    const key = buildCandidateClusterKey(candidate);
    const current = groups.get(key) ?? [];
    current.push(candidate);
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => {
    const best = chooseClusterRepresentative(group);
    const clusterDocumentIds = Array.from(
      new Set(group.map((item) => item.documentId)),
    );
    const clusterKinds = Array.from(
      new Set(group.map((item) => item.kind)),
    ) as DocumentKind[];
    const mergedReasons = Array.from(
      new Set(group.flatMap((item) => Array.from(item.reasons))),
    );
    const mergedIssues = Array.from(
      new Set(group.flatMap((item) => Array.from(item.matchedIssues))),
    );
    const mergedAgencies = Array.from(
      new Set(group.flatMap((item) => Array.from(item.matchedAgencies))),
    );
    const mergedLanes = sortRetrievalLanes(
      group.flatMap((item) => item.retrievalLanes),
    );
    const mergedCoverageFamilies = summarizeCoverageFamilies(mergedLanes);
    const mergedWhyRanked = Array.from(
      new Set(group.flatMap((item) => item.whyRanked)),
    );

    const duplicateCount = Math.max(0, clusterDocumentIds.length - 1);
    const clusterBoost =
      duplicateCount > 0 ? Math.min(12, duplicateCount * 3) : 0;

    return {
      ...best,
      matchScore: best.matchScore + clusterBoost,
      reasons: new Set(mergedReasons.slice(0, 6)),
      matchedIssues: new Set(mergedIssues.slice(0, 4)),
      matchedAgencies: new Set(mergedAgencies.slice(0, 4)),
      whyRanked: Array.from(
        new Set([
          ...mergedWhyRanked,
          ...(mergedLanes.length >= 2
            ? ["Supported by multiple retrieval lanes"]
            : []),
          ...(duplicateCount > 0
            ? [`Merged ${clusterDocumentIds.length} near-duplicate records`]
            : []),
        ]),
      ).slice(0, 5),
      duplicateCount,
      clusterDocumentIds,
      clusterKinds,
      clusterReason:
        duplicateCount > 0
          ? `Merged ${clusterDocumentIds.length} closely related records into one evidence card`
          : null,
      retrievalLanes: mergedLanes,
      coverageFamilies: mergedCoverageFamilies,
    };
  });
}

function aggregateClusterStats(
  statsByDocument: Map<
    string,
    {
      claimCount: number;
      eventCount: number;
      gapCount: number;
      relationCount: number;
    }
  >,
  documentIds: string[],
) {
  return documentIds.reduce(
    (acc, documentId) => {
      const current = statsByDocument.get(documentId);
      if (!current) return acc;

      acc.claimCount += current.claimCount;
      acc.eventCount += current.eventCount;
      acc.gapCount += current.gapCount;
      acc.relationCount += current.relationCount;
      return acc;
    },
    {
      claimCount: 0,
      eventCount: 0,
      gapCount: 0,
      relationCount: 0,
    },
  );
}

type WorkspaceDocumentPreview = {
  documentId: string;
  kind: DocumentKind;
  title: string;
  publishedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

function previewWorkspaceDocument(
  doc: DocumentWithContext | null | undefined,
): WorkspaceDocumentPreview | null {
  if (!doc) return null;

  const descriptor = documentDescriptor(doc);
  return {
    documentId: doc.id,
    kind: doc.kind,
    title: descriptor.title,
    publishedAt: descriptor.publishedAt,
    updatedAt: descriptor.updatedAt,
    createdAt: descriptor.createdAt,
  };
}

function previewDocumentDateMs(value: WorkspaceDocumentPreview | null) {
  if (!value) return null;
  return (
    parseIsoDate(value.publishedAt) ??
    parseIsoDate(value.updatedAt) ??
    parseIsoDate(value.createdAt)
  );
}

function relationBucketPriority(
  bucket: GovernanceWorkspaceContradictionCandidate["bucket"],
) {
  switch (bucket) {
    case "conflict":
      return 5;
    case "temporal_shift_candidate":
      return 4;
    case "scope_variant_candidate":
      return 3;
    case "reference":
      return 2;
    default:
      return 1;
  }
}

function normalizeContradictionGroupKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildContradictionGroups(
  candidates: GovernanceWorkspaceContradictionCandidate[],
): GovernanceWorkspaceContradictionGroup[] {
  const groups = new Map<string, GovernanceWorkspaceContradictionCandidate[]>();

  for (const candidate of candidates) {
    const pair = [candidate.fromDocumentId, candidate.toDocumentId]
      .sort()
      .join("::");
    const issueKey =
      normalizeContradictionGroupKey(candidate.issueTitle) || "cross-issue";
    const key = `${issueKey}|${pair}`;

    const existing = groups.get(key) ?? [];
    existing.push(candidate);
    groups.set(key, existing);
  }

  return Array.from(groups.entries())
    .map(([groupKey, items]) => {
      const strongest = [...items].sort((a, b) => {
        const bucketGap =
          relationBucketPriority(b.bucket) - relationBucketPriority(a.bucket);
        if (bucketGap !== 0) return bucketGap;
        return (b.confidence ?? 0) - (a.confidence ?? 0);
      })[0];

      const documentTitles = Array.from(
        new Set(
          items.flatMap((item) => [
            item.fromDocumentTitle,
            item.toDocumentTitle,
          ]),
        ),
      ).slice(0, 3);

      const documentIds = Array.from(
        new Set(
          items.flatMap((item) => [item.fromDocumentId, item.toDocumentId]),
        ),
      );

      const reviewCount = items.filter(
        (item) => item.requiresAnalystReview,
      ).length;

      return {
        groupKey,
        issueTitle: strongest.issueTitle,
        label: strongest.issueTitle
          ? `${strongest.issueTitle} — ${documentTitles.join(" ↔ ")}`
          : documentTitles.join(" ↔ "),
        documentIds,
        documentTitles,
        candidateCount: items.length,
        reviewCount,
        strongestBucket: strongest.bucket,
        strongestReason: strongest.reason,
        relationIds: Array.from(new Set(items.map((item) => item.relationId))),
      };
    })
    .sort((a, b) => {
      const reviewGap = b.reviewCount - a.reviewCount;
      if (reviewGap !== 0) return reviewGap;

      const candidateGap = b.candidateCount - a.candidateCount;
      if (candidateGap !== 0) return candidateGap;

      const bucketGap =
        relationBucketPriority(b.strongestBucket) -
        relationBucketPriority(a.strongestBucket);
      if (bucketGap !== 0) return bucketGap;

      return a.label.localeCompare(b.label);
    })
    .slice(0, 6);
}

function inferOverrideHint(args: {
  relationId: string;
  relationType: DocumentRelationType;
  confidence: number | null;
  fromDocument: WorkspaceDocumentPreview;
  toDocument: WorkspaceDocumentPreview;
}): GovernanceWorkspaceOverrideHint {
  const fromMs = previewDocumentDateMs(args.fromDocument);
  const toMs = previewDocumentDateMs(args.toDocument);

  let preferred = args.toDocument;
  let superseded = args.fromDocument;
  let basis =
    args.relationType === DocumentRelationType.SUPERSEDES
      ? "Supersedes-style relation indicates one document may displace the earlier position."
      : "Override-style relation indicates one document may replace the earlier position.";

  if (fromMs !== null && toMs !== null) {
    if (fromMs > toMs) {
      preferred = args.fromDocument;
      superseded = args.toDocument;
    } else {
      preferred = args.toDocument;
      superseded = args.fromDocument;
    }
    basis = "Newer-dated document may supersede the older position.";
  }

  return {
    relationId: args.relationId,
    relationType: args.relationType,
    preferredDocumentId: preferred.documentId,
    preferredDocumentTitle: preferred.title,
    supersededDocumentId: superseded.documentId,
    supersededDocumentTitle: superseded.title,
    confidence: args.confidence,
    basis,
  };
}

async function buildContradictionFoundation(args: {
  documentIds: string[];
  workflowMode: GovernanceWorkspaceResolvedMode;
}): Promise<GovernanceWorkspaceContradictionFoundation> {
  if (args.documentIds.length < 2) {
    return {
      active: false,
      rationale:
        "At least two evidence documents are needed before contradiction and override signals can be compared.",
      summary: {
        contradictionCount: 0,
        reviewCount: 0,
        overrideHintCount: 0,
        groupCount: 0,
      },
      groups: [],
      candidates: [],
      overrideHints: [],
      involvedDocumentIds: [],
    };
  }

  const documentIdSet = new Set(args.documentIds);

  const relationRows = await prisma.documentRelation.findMany({
    where: {
      OR: [
        {
          fromClaim: {
            trace: {
              sourceDocument: {
                id: { in: args.documentIds },
              },
            },
          },
        },
        {
          toClaim: {
            trace: {
              sourceDocument: {
                id: { in: args.documentIds },
              },
            },
          },
        },
      ],
    },
    take: Math.max(args.documentIds.length * 8, 40),
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
    include: {
      issue: { select: { title: true } },
      fromAgency: { select: { id: true, name: true } },
      toAgency: { select: { id: true, name: true } },
      fromClaim: {
        select: {
          scopeText: true,
          trace: {
            select: {
              sourceDocument: {
                select: documentContextSelect,
              },
            },
          },
        },
      },
      toClaim: {
        select: {
          scopeText: true,
          trace: {
            select: {
              sourceDocument: {
                select: documentContextSelect,
              },
            },
          },
        },
      },
    },
  });

  const contradictionCandidates: GovernanceWorkspaceContradictionCandidate[] =
    [];
  const overrideHints: GovernanceWorkspaceOverrideHint[] = [];
  const involvedDocumentIds = new Set<string>();

  for (const row of relationRows) {
    const fromDocument = previewWorkspaceDocument(
      row.fromClaim?.trace?.sourceDocument,
    );
    const toDocument = previewWorkspaceDocument(
      row.toClaim?.trace?.sourceDocument,
    );

    if (!fromDocument || !toDocument) continue;
    if (!documentIdSet.has(fromDocument.documentId)) continue;
    if (!documentIdSet.has(toDocument.documentId)) continue;
    if (fromDocument.documentId === toDocument.documentId) continue;

    involvedDocumentIds.add(fromDocument.documentId);
    involvedDocumentIds.add(toDocument.documentId);

    const analysis = analyzeRelation({
      id: row.id,
      relationType: row.relationType,
      fromAgency: row.fromAgency,
      toAgency: row.toAgency,
      fromClaim: row.fromClaim,
      toClaim: row.toClaim,
      confidence: row.confidence,
    });

    const contradictionLike =
      row.relationType === DocumentRelationType.CONTRADICTION ||
      row.relationType === DocumentRelationType.TENSION ||
      analysis.bucket === "conflict" ||
      analysis.bucket === "temporal_shift_candidate" ||
      analysis.bucket === "scope_variant_candidate";

    if (contradictionLike) {
      contradictionCandidates.push({
        relationId: row.id,
        relationType: row.relationType,
        bucket: analysis.bucket,
        requiresAnalystReview: analysis.requiresAnalystReview,
        sameActor: analysis.sameActor,
        scopeWarning: analysis.scopeWarning,
        confidence: row.confidence ?? null,
        reason: analysis.reason,
        rationale: row.rationale ?? null,
        issueTitle: row.issue?.title ?? null,
        fromDocumentId: fromDocument.documentId,
        fromDocumentTitle: fromDocument.title,
        toDocumentId: toDocument.documentId,
        toDocumentTitle: toDocument.title,
        fromAgencyName: row.fromAgency?.name ?? null,
        toAgencyName: row.toAgency?.name ?? null,
      });
    }

    if (
      row.relationType === DocumentRelationType.OVERRIDE ||
      row.relationType === DocumentRelationType.SUPERSEDES
    ) {
      overrideHints.push(
        inferOverrideHint({
          relationId: row.id,
          relationType: row.relationType,
          confidence: row.confidence ?? null,
          fromDocument,
          toDocument,
        }),
      );
    }
  }

  const contradictionCount = contradictionCandidates.length;
  const reviewCount = contradictionCandidates.filter(
    (item) => item.requiresAnalystReview,
  ).length;

  const sortedCandidates = contradictionCandidates
    .sort((a, b) => {
      const byBucket =
        relationBucketPriority(b.bucket) - relationBucketPriority(a.bucket);
      if (byBucket !== 0) return byBucket;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    })
    .slice(0, 6);

  const contradictionGroups = buildContradictionGroups(contradictionCandidates);

  const sortedOverrideHints = Array.from(
    new Map(
      overrideHints.map((item) => [
        `${item.preferredDocumentId}:${item.supersededDocumentId}:${item.relationType}`,
        item,
      ]),
    ).values(),
  )
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 6);

  if (
    !sortedCandidates.length &&
    !sortedOverrideHints.length &&
    !contradictionGroups.length
  ) {
    return {
      active: false,
      rationale:
        "No explicit contradiction, tension, override, or supersession relations were found inside the current evidence set.",
      summary: {
        contradictionCount: 0,
        reviewCount: 0,
        overrideHintCount: 0,
        groupCount: 0,
      },
      groups: [],
      candidates: [],
      overrideHints: [],
      involvedDocumentIds: [],
    };
  }

  return {
    active: true,
    rationale:
      args.workflowMode === "case_trace"
        ? "Cross-document conflict and override signals were found in the current case evidence. Treat these as analyst-reviewed leads, not final legal conclusions."
        : "Cross-document conflict and override signals were found in the retrieved evidence set. Use them to inspect tensions, supersession, and position shifts.",
    summary: {
      contradictionCount,
      reviewCount,
      overrideHintCount: sortedOverrideHints.length,
      groupCount: contradictionGroups.length,
    },
    groups: contradictionGroups,
    candidates: sortedCandidates,
    overrideHints: sortedOverrideHints,
    involvedDocumentIds: Array.from(involvedDocumentIds),
  };
}

function candidateBestKnownDate(candidate: RankedCandidate) {
  return (
    parseIsoDate(candidate.publishedAt) ??
    parseIsoDate(candidate.updatedAt) ??
    parseIsoDate(candidate.createdAt)
  );
}

function candidateAgeDays(candidate: RankedCandidate) {
  const bestDate = candidateBestKnownDate(candidate);
  if (bestDate === null) return null;

  return Math.max(
    0,
    Math.floor((Date.now() - bestDate) / (1000 * 60 * 60 * 24)),
  );
}

function formatCaseTrailDate(ms: number | null) {
  if (ms === null) {
    return {
      sortDate: null,
      dateLabel: "Undated",
    };
  }

  const iso = new Date(ms).toISOString();
  return {
    sortDate: iso,
    dateLabel: iso.slice(0, 10),
  };
}

function caseTrailEventTypePriority(
  value: GovernanceWorkspaceCaseTrailEvent["eventType"],
) {
  switch (value) {
    case "document":
      return 1;
    case "conflict_cluster":
      return 2;
    case "override_chain":
      return 3;
    default:
      return 4;
  }
}

function buildComparisonSurface(args: {
  contradictionFoundation: GovernanceWorkspaceContradictionFoundation;
  overrideChainFoundation: GovernanceWorkspaceOverrideChainFoundation;
}): GovernanceWorkspaceComparisonSurface {
  const map = new Map<
    string,
    {
      issueTitle: string | null;
      documentIds: string[];
      documentTitles: string[];
      contradictionSignalCount: number;
      reviewCount: number;
      overrideHintCount: number;
      strongestBucket:
        | "conflict"
        | "alignment"
        | "temporal_shift_candidate"
        | "scope_variant_candidate"
        | "reference";
      strongestReason: string;
      strongestPriority: number;
      relationTypes: Set<DocumentRelationType>;
      preferredDocumentId: string | null;
      preferredDocumentTitle: string | null;
      supersededDocumentId: string | null;
      supersededDocumentTitle: string | null;
      involvedChainKeys: Set<string>;
    }
  >();

  const ensurePair = (
    documentIds: string[],
    documentTitles: string[],
    issueTitle: string | null,
  ) => {
    const normalizedIds = Array.from(new Set(documentIds)).sort();
    const normalizedTitles = Array.from(new Set(documentTitles)).slice(0, 2);
    const key = normalizedIds.join("::");
    const existing = map.get(key) ?? {
      issueTitle,
      documentIds: normalizedIds,
      documentTitles: normalizedTitles,
      contradictionSignalCount: 0,
      reviewCount: 0,
      overrideHintCount: 0,
      strongestBucket: "reference" as const,
      strongestReason: "",
      strongestPriority: 0,
      relationTypes: new Set<DocumentRelationType>(),
      preferredDocumentId: null,
      preferredDocumentTitle: null,
      supersededDocumentId: null,
      supersededDocumentTitle: null,
      involvedChainKeys: new Set<string>(),
    };

    if (!existing.issueTitle && issueTitle) existing.issueTitle = issueTitle;
    if (!existing.documentTitles.length && normalizedTitles.length) {
      existing.documentTitles = normalizedTitles;
    }

    map.set(key, existing);
    return [key, existing] as const;
  };

  for (const item of args.contradictionFoundation.candidates) {
    const [_, pair] = ensurePair(
      [item.fromDocumentId, item.toDocumentId],
      [item.fromDocumentTitle, item.toDocumentTitle],
      item.issueTitle,
    );

    pair.contradictionSignalCount += 1;
    if (item.requiresAnalystReview) pair.reviewCount += 1;
    pair.relationTypes.add(item.relationType);

    const priority = relationBucketPriority(item.bucket);
    if (priority > pair.strongestPriority) {
      pair.strongestPriority = priority;
      pair.strongestBucket = item.bucket;
      pair.strongestReason = item.reason;
    }
  }

  for (const item of args.contradictionFoundation.overrideHints) {
    const [_, pair] = ensurePair(
      [item.preferredDocumentId, item.supersededDocumentId],
      [item.preferredDocumentTitle, item.supersededDocumentTitle],
      null,
    );

    pair.overrideHintCount += 1;
    pair.relationTypes.add(item.relationType);
    pair.preferredDocumentId = item.preferredDocumentId;
    pair.preferredDocumentTitle = item.preferredDocumentTitle;
    pair.supersededDocumentId = item.supersededDocumentId;
    pair.supersededDocumentTitle = item.supersededDocumentTitle;

    if (!pair.strongestReason) {
      pair.strongestReason = item.basis;
    }
  }

  for (const chain of args.overrideChainFoundation.chains) {
    for (let i = 0; i < chain.documentIds.length - 1; i += 1) {
      const leftId = chain.documentIds[i];
      const rightId = chain.documentIds[i + 1];
      const leftTitle = chain.documentTitles[i] ?? leftId;
      const rightTitle = chain.documentTitles[i + 1] ?? rightId;
      const [_, pair] = ensurePair(
        [leftId, rightId],
        [leftTitle, rightTitle],
        null,
      );
      pair.involvedChainKeys.add(chain.chainKey);
      if (!pair.strongestReason) {
        pair.strongestReason = chain.basis;
      }
    }
  }

  const comparisons = Array.from(map.entries())
    .map(([comparisonKey, value]) => {
      const changeSummary = value.preferredDocumentTitle
        ? `Likely position shift from ${value.supersededDocumentTitle ?? "earlier record"} to ${value.preferredDocumentTitle}.`
        : value.strongestReason ||
          "This document pair contains comparison signals worth analyst review.";

      return {
        comparisonKey,
        issueTitle: value.issueTitle,
        documentIds: value.documentIds,
        documentTitles: value.documentTitles,
        contradictionSignalCount: value.contradictionSignalCount,
        reviewCount: value.reviewCount,
        overrideHintCount: value.overrideHintCount,
        strongestBucket: value.strongestBucket,
        strongestReason: value.strongestReason || changeSummary,
        relationTypes: Array.from(value.relationTypes),
        preferredDocumentId: value.preferredDocumentId,
        preferredDocumentTitle: value.preferredDocumentTitle,
        supersededDocumentId: value.supersededDocumentId,
        supersededDocumentTitle: value.supersededDocumentTitle,
        involvedChainKeys: Array.from(value.involvedChainKeys),
        changeSummary,
      };
    })
    .sort((a, b) => {
      const reviewGap = b.reviewCount - a.reviewCount;
      if (reviewGap !== 0) return reviewGap;
      const signalGap =
        b.contradictionSignalCount +
        b.overrideHintCount -
        (a.contradictionSignalCount + a.overrideHintCount);
      if (signalGap !== 0) return signalGap;
      const bucketGap =
        relationBucketPriority(b.strongestBucket) -
        relationBucketPriority(a.strongestBucket);
      if (bucketGap !== 0) return bucketGap;
      return a.documentTitles
        .join(" ")
        .localeCompare(b.documentTitles.join(" "));
    })
    .slice(0, 8);

  if (!comparisons.length) {
    return {
      active: false,
      rationale:
        "No document-to-document comparison pairs were assembled from the current contradiction and override signals.",
      summary: {
        comparisonCount: 0,
        reviewCount: 0,
        preferredPairCount: 0,
      },
      comparisons: [],
    };
  }

  return {
    active: true,
    rationale:
      "This comparison surface groups document pairs so you can inspect what conflicts, what changed, and what may supersede what.",
    summary: {
      comparisonCount: comparisons.length,
      reviewCount: comparisons.filter((item) => item.reviewCount > 0).length,
      preferredPairCount: comparisons.filter((item) => item.preferredDocumentId)
        .length,
    },
    comparisons,
  };
}

function buildLandscapeMappingSurface(args: {
  ranked: RankedCandidate[];
  workflowMode: GovernanceWorkspaceResolvedMode;
  queryType: GovernanceWorkspaceQueryType;
  contradictionFoundation: GovernanceWorkspaceContradictionFoundation;
}): GovernanceWorkspaceLandscapeMappingSurface {
  if (!args.ranked.length) {
    return {
      active: false,
      rationale:
        "A landscape map needs at least one retrieved evidence document before broad governance coverage can be summarized.",
      summary: {
        issueCount: 0,
        agencyCount: 0,
        spotlightCount: 0,
        currentPreferredCount: 0,
        conflictLinkedCount: 0,
      },
      sourceCoverage: {
        fileCount: 0,
        urlCount: 0,
        anchorCount: 0,
        metadataCount: 0,
        graphCount: 0,
        chunkCount: 0,
      },
      topIssues: [],
      topAgencies: [],
      spotlightDocuments: [],
    };
  }

  const shouldActivate =
    args.workflowMode === "landscape" || args.queryType === "broad_scan";

  if (!shouldActivate) {
    return {
      active: false,
      rationale:
        "Landscape mapping stays out of the way for case-focused, chronology, or contradiction-driven workflows.",
      summary: {
        issueCount: 0,
        agencyCount: 0,
        spotlightCount: 0,
        currentPreferredCount: 0,
        conflictLinkedCount: 0,
      },
      sourceCoverage: {
        fileCount: 0,
        urlCount: 0,
        anchorCount: 0,
        metadataCount: 0,
        graphCount: 0,
        chunkCount: 0,
      },
      topIssues: [],
      topAgencies: [],
      spotlightDocuments: [],
    };
  }

  const contradictionDocIds = new Set(
    args.contradictionFoundation.involvedDocumentIds,
  );

  const issueMap = new Map<
    string,
    {
      documentIds: Set<string>;
      anchorCount: number;
      currentPreferredCount: number;
      conflictLinkedCount: number;
    }
  >();

  const agencyMap = new Map<
    string,
    {
      documentIds: Set<string>;
      currentPreferredCount: number;
      conflictLinkedCount: number;
    }
  >();

  const sourceCoverage = {
    fileCount: 0,
    urlCount: 0,
    anchorCount: 0,
    metadataCount: 0,
    graphCount: 0,
    chunkCount: 0,
  };

  const spotlightDocuments: GovernanceWorkspaceLandscapeSpotlightDocument[] =
    args.ranked.slice(0, 4).map((candidate) => {
      const issueTitle = Array.from(candidate.matchedIssues)[0] ?? null;
      const agencyName = Array.from(candidate.matchedAgencies)[0] ?? null;
      const conflictLinked = candidate.clusterDocumentIds.some((documentId) =>
        contradictionDocIds.has(documentId),
      );

      return {
        documentId: candidate.documentId,
        title: candidate.title,
        summary: candidate.summary,
        issueTitle,
        agencyName,
        reason:
          candidate.temporalReason ||
          candidate.diversityReason ||
          candidate.whyRanked[0] ||
          "Strong landscape evidence candidate.",
        anchor: candidate.anchor,
        currentPreferred: Boolean(candidate.temporalReason),
        conflictLinked,
      };
    });

  for (const candidate of args.ranked) {
    const conflictLinked = candidate.clusterDocumentIds.some((documentId) =>
      contradictionDocIds.has(documentId),
    );

    if (candidate.kind === "FILE") {
      sourceCoverage.fileCount += 1;
    } else {
      sourceCoverage.urlCount += 1;
    }

    if (candidate.anchor) sourceCoverage.anchorCount += 1;
    if (candidate.coverageFamilies.includes("metadata"))
      sourceCoverage.metadataCount += 1;
    if (candidate.coverageFamilies.includes("graph"))
      sourceCoverage.graphCount += 1;
    if (candidate.coverageFamilies.includes("chunk"))
      sourceCoverage.chunkCount += 1;

    for (const issue of candidate.matchedIssues) {
      const current = issueMap.get(issue) ?? {
        documentIds: new Set<string>(),
        anchorCount: 0,
        currentPreferredCount: 0,
        conflictLinkedCount: 0,
      };

      current.documentIds.add(candidate.documentId);
      if (candidate.anchor) current.anchorCount += 1;
      if (candidate.temporalReason) current.currentPreferredCount += 1;
      if (conflictLinked) current.conflictLinkedCount += 1;

      issueMap.set(issue, current);
    }

    for (const agency of candidate.matchedAgencies) {
      const current = agencyMap.get(agency) ?? {
        documentIds: new Set<string>(),
        currentPreferredCount: 0,
        conflictLinkedCount: 0,
      };

      current.documentIds.add(candidate.documentId);
      if (candidate.temporalReason) current.currentPreferredCount += 1;
      if (conflictLinked) current.conflictLinkedCount += 1;

      agencyMap.set(agency, current);
    }
  }

  const topIssues = Array.from(issueMap.entries())
    .map(([title, value]) => ({
      title,
      documentCount: value.documentIds.size,
      anchorCount: value.anchorCount,
      currentPreferredCount: value.currentPreferredCount,
      conflictLinkedCount: value.conflictLinkedCount,
    }))
    .sort((a, b) => {
      const docGap = b.documentCount - a.documentCount;
      if (docGap !== 0) return docGap;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 6);

  const topAgencies = Array.from(agencyMap.entries())
    .map(([name, value]) => ({
      name,
      documentCount: value.documentIds.size,
      currentPreferredCount: value.currentPreferredCount,
      conflictLinkedCount: value.conflictLinkedCount,
    }))
    .sort((a, b) => {
      const docGap = b.documentCount - a.documentCount;
      if (docGap !== 0) return docGap;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 6);

  return {
    active: true,
    rationale:
      "This landscape mapping surface summarizes the broad governance picture by highlighting issue clusters, agency presence, coverage lanes, and the strongest spotlight documents.",
    summary: {
      issueCount: topIssues.length,
      agencyCount: topAgencies.length,
      spotlightCount: spotlightDocuments.length,
      currentPreferredCount: args.ranked.filter((item) => item.temporalReason)
        .length,
      conflictLinkedCount: args.ranked.filter((item) =>
        item.clusterDocumentIds.some((documentId) =>
          contradictionDocIds.has(documentId),
        ),
      ).length,
    },
    sourceCoverage,
    topIssues,
    topAgencies,
    spotlightDocuments,
  };
}

function buildCaseTracingSurface(args: {
  ranked: RankedCandidate[];
  workflowMode: GovernanceWorkspaceResolvedMode;
  queryType: GovernanceWorkspaceQueryType;
  contradictionFoundation: GovernanceWorkspaceContradictionFoundation;
  comparisonSurface: GovernanceWorkspaceComparisonSurface;
  overrideChainFoundation: GovernanceWorkspaceOverrideChainFoundation;
  caseTrailFoundation: GovernanceWorkspaceCaseTrailFoundation;
}): GovernanceWorkspaceCaseTracingSurface {
  const shouldActivate =
    args.workflowMode === "case_trace" ||
    args.queryType === "case_review" ||
    args.queryType === "chronology_review" ||
    args.queryType === "contradiction_review";

  if (!shouldActivate) {
    return {
      active: false,
      rationale:
        "Case tracing stays out of the way for broad landscape questions.",
      summary: {
        focusDocumentCount: 0,
        contradictionClusterCount: 0,
        comparisonCount: 0,
        overrideChainCount: 0,
        timelineHighlightCount: 0,
        reviewCount: 0,
      },
      focusDocuments: [],
      contradictionClusters: [],
      comparisonPairs: [],
      overrideChains: [],
      timelineHighlights: [],
    };
  }

  const contradictionDocIds = new Set(
    args.contradictionFoundation.involvedDocumentIds,
  );

  const focusDocuments: GovernanceWorkspaceCaseTracingFocusDocument[] =
    args.ranked.slice(0, 6).map((candidate) => {
      const issueTitle = Array.from(candidate.matchedIssues)[0] ?? null;
      const agencyName = Array.from(candidate.matchedAgencies)[0] ?? null;
      const conflictLinked = candidate.clusterDocumentIds.some((documentId) =>
        contradictionDocIds.has(documentId),
      );

      return {
        documentId: candidate.documentId,
        title: candidate.title,
        issueTitle,
        agencyName,
        reason:
          candidate.diversityReason ||
          candidate.temporalReason ||
          candidate.whyRanked[0] ||
          candidate.summary ||
          "Key case evidence document.",
        conflictLinked,
        currentPreferred: Boolean(candidate.temporalReason),
      };
    });

  const contradictionClusters = args.contradictionFoundation.groups.slice(0, 6);
  const comparisonPairs = args.comparisonSurface.comparisons.slice(0, 6);
  const overrideChains = args.overrideChainFoundation.chains.slice(0, 6);

  const timelineHighlights = args.caseTrailFoundation.events
    .filter((event) => event.eventType !== "document")
    .slice(0, 8);

  return {
    active: true,
    rationale:
      "This case-tracing surface assembles the strongest conflict clusters, document comparisons, override chains, and timeline highlights into one investigation-ready view.",
    summary: {
      focusDocumentCount: focusDocuments.length,
      contradictionClusterCount: contradictionClusters.length,
      comparisonCount: comparisonPairs.length,
      overrideChainCount: overrideChains.length,
      timelineHighlightCount: timelineHighlights.length,
      reviewCount:
        args.contradictionFoundation.summary.reviewCount +
        args.comparisonSurface.summary.reviewCount,
    },
    focusDocuments,
    contradictionClusters,
    comparisonPairs,
    overrideChains,
    timelineHighlights,
  };
}

const questionReviewFactorDefinitions = [
  {
    key: "context",
    label: "Context and trigger",
    description:
      "Background conditions, trigger events, time hints, or circumstances that made the question relevant.",
    terms: [
      "trigger",
      "context",
      "because",
      "due",
      "reason",
      "incident",
      "condition",
      "previous",
      "past",
      "current",
      "latest",
    ],
  },
  {
    key: "evidence",
    label: "Evidence considered",
    description:
      "Source material, reports, observations, records, data, or findings cited by the evidence set.",
    terms: [
      "evidence",
      "report",
      "record",
      "finding",
      "data",
      "inspection",
      "observed",
      "noted",
      "minutes",
      "submitted",
    ],
  },
  {
    key: "actor_inputs",
    label: "Institutional inputs",
    description:
      "Agency positions, recommendations, submissions, dissent, or inter-institutional signals.",
    terms: [
      "agency",
      "committee",
      "department",
      "recommended",
      "submitted",
      "directed",
      "meeting",
      "position",
      "input",
      "dissent",
    ],
  },
  {
    key: "mandate_basis",
    label: "Authority or mandate basis",
    description:
      "Legal, policy, mandate, direction, order, jurisdiction, or responsibility basis.",
    terms: [
      "order",
      "direction",
      "mandate",
      "jurisdiction",
      "authority",
      "policy",
      "rule",
      "act",
      "compliance",
      "responsible",
    ],
  },
  {
    key: "decision_actions",
    label: "Decision and actions",
    description:
      "Conclusions, approvals, restrictions, actions taken, or implementation choices.",
    terms: [
      "decision",
      "decided",
      "action",
      "activated",
      "permitted",
      "restricted",
      "approved",
      "rejected",
      "implemented",
      "enforced",
    ],
  },
  {
    key: "follow_up",
    label: "Follow-up and outcomes",
    description:
      "Follow-up actions, monitoring, reports, outcomes, compliance status, or continuity signals.",
    terms: [
      "follow",
      "outcome",
      "monitor",
      "status",
      "compliance",
      "report",
      "action taken",
      "inspection",
      "verified",
      "pending",
    ],
  },
  {
    key: "uncertainty",
    label: "Contradictions and gaps",
    description:
      "Conflicts, unresolved questions, scope differences, missing evidence, or analyst-review flags.",
    terms: [
      "contradict",
      "conflict",
      "gap",
      "missing",
      "unclear",
      "different",
      "override",
      "supersede",
      "review",
      "verify",
    ],
  },
] as const;

function buildQuestionReviewSignalFromCandidate(
  candidate: RankedCandidate,
  index: number,
): GovernanceWorkspaceQuestionReviewSignal {
  const reason =
    candidate.temporalReason ||
    candidate.diversityReason ||
    candidate.whyRanked[0] ||
    candidate.summary ||
    "Relevant evidence document for the question.";

  return {
    id: `candidate:${candidate.documentId}:${index}`,
    label: candidate.title,
    detail: reason,
    sourceTitle: candidate.sourceLabel,
    issueTitle: Array.from(candidate.matchedIssues)[0] ?? null,
    agencyName: Array.from(candidate.matchedAgencies)[0] ?? null,
    documentIds: candidate.clusterDocumentIds,
    confidence: Math.max(0, Math.min(1, candidate.matchScore / 100)),
  };
}

function signalText(signal: GovernanceWorkspaceQuestionReviewSignal) {
  return [
    signal.label,
    signal.detail,
    signal.sourceTitle,
    signal.issueTitle,
    signal.agencyName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildQuestionReviewSurface(args: {
  question: string;
  ranked: RankedCandidate[];
  workflowMode: GovernanceWorkspaceResolvedMode;
  queryType: GovernanceWorkspaceQueryType;
  contradictionFoundation: GovernanceWorkspaceContradictionFoundation;
  comparisonSurface: GovernanceWorkspaceComparisonSurface;
  caseTrailFoundation: GovernanceWorkspaceCaseTrailFoundation;
}): GovernanceWorkspaceQuestionReviewSurface {
  const shouldActivate =
    args.workflowMode === "question_review" ||
    args.queryType === "question_review" ||
    args.queryType === "chronology_review" ||
    args.queryType === "contradiction_review";

  const emptySummary = {
    sourceCount: 0,
    factorCount: 0,
    timelineHighlightCount: 0,
    actorCount: 0,
    gapCount: 0,
    reviewCount: 0,
  };

  if (!shouldActivate) {
    return {
      active: false,
      rationale:
        "Question Review stays out of the way for broad landscape mapping questions.",
      question: args.question,
      queryType: args.queryType,
      summary: emptySummary,
      answerSignals: [],
      factors: [],
      timelineHighlights: [],
      actorInputs: [],
      openQuestions: [],
    };
  }

  if (!args.ranked.length) {
    return {
      active: false,
      rationale:
        "Question Review needs retrieved evidence before it can assemble an answer, factors, chronology, and verification gaps.",
      question: args.question,
      queryType: args.queryType,
      summary: emptySummary,
      answerSignals: [],
      factors: [],
      timelineHighlights: [],
      actorInputs: [],
      openQuestions: [
        "No evidence documents were retrieved for the current question.",
        "Broaden the source scope or attach stronger source anchors before drafting an answer.",
      ],
    };
  }

  const answerSignals = args.ranked
    .slice(0, 8)
    .map((candidate, index) =>
      buildQuestionReviewSignalFromCandidate(candidate, index),
    );

  const factors = questionReviewFactorDefinitions.map((definition) => {
    const matches = answerSignals.filter((signal) =>
      definition.terms.some((term) => signalText(signal).includes(term)),
    );

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      count: matches.length,
      strongestSignal: matches[0] ?? null,
    };
  });

  const actorMap = new Map<string, GovernanceWorkspaceQuestionReviewActorInput>();
  for (const signal of answerSignals) {
    const actorName = signal.agencyName || "Unattributed institution";
    const current = actorMap.get(actorName) ?? {
      actorName,
      role: signal.issueTitle,
      signalCount: 0,
      strongestSignal: signal,
    };
    current.signalCount += 1;
    actorMap.set(actorName, current);
  }

  const timelineHighlights = args.caseTrailFoundation.events.slice(0, 8);
  const reviewCount =
    args.contradictionFoundation.summary.reviewCount +
    args.comparisonSurface.summary.reviewCount;

  const openQuestions = [
    factors.some((factor) => factor.key === "evidence" && factor.count === 0)
      ? "The evidence-considered factor is thin; verify source reports or records before finalizing the answer."
      : null,
    factors.some((factor) => factor.key === "follow_up" && factor.count === 0)
      ? "Follow-up or outcome evidence is not prominent in the retrieved set."
      : null,
    reviewCount > 0
      ? "Some conflict or scope-change signals require analyst review before external use."
      : null,
    args.contradictionFoundation.summary.contradictionCount === 0
      ? "No explicit contradiction signals were found in the retrieved set."
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    active: true,
    rationale:
      "Question Review assembles an evidence-backed answer surface from source candidates, chronology, actor signals, contradictions, and verification gaps.",
    question: args.question,
    queryType: args.queryType,
    summary: {
      sourceCount: args.ranked.length,
      factorCount: factors.filter((factor) => factor.count > 0).length,
      timelineHighlightCount: timelineHighlights.length,
      actorCount: actorMap.size,
      gapCount: openQuestions.length,
      reviewCount,
    },
    answerSignals,
    factors,
    timelineHighlights,
    actorInputs: Array.from(actorMap.values())
      .sort((a, b) => b.signalCount - a.signalCount)
      .slice(0, 8),
    openQuestions,
  };
}

export const governanceWorkspaceQueryTestHooks = {
  resolveWorkflowPlan,
  resolveQueryType,
  clusterRankedCandidates,
  documentAllowed,
};

function buildCaseTrailFoundation(args: {
  ranked: RankedCandidate[];
  contradictionFoundation: GovernanceWorkspaceContradictionFoundation;
  overrideChainFoundation: GovernanceWorkspaceOverrideChainFoundation;
  comparisonSurface: GovernanceWorkspaceComparisonSurface;
  workflowMode: GovernanceWorkspaceResolvedMode;
}): GovernanceWorkspaceCaseTrailFoundation {
  if (!args.ranked.length) {
    return {
      active: false,
      rationale:
        "A case trail needs at least one retrieved evidence document before chronology can be assembled.",
      summary: {
        eventCount: 0,
        documentEventCount: 0,
        conflictEventCount: 0,
        overrideEventCount: 0,
        overrideChainEventCount: 0,
      },
      events: [],
    };
  }

  const candidateByDocumentId = new Map<string, RankedCandidate>();

  for (const candidate of args.ranked) {
    for (const documentId of candidate.clusterDocumentIds) {
      if (!candidateByDocumentId.has(documentId)) {
        candidateByDocumentId.set(documentId, candidate);
      }
    }
  }

  const documentEvents: GovernanceWorkspaceCaseTrailEvent[] = args.ranked.map(
    (candidate) => {
      const { sortDate, dateLabel } = formatCaseTrailDate(
        candidateBestKnownDate(candidate),
      );

      return {
        eventId: `document:${candidate.documentId}`,
        eventType: "document",
        title: candidate.title,
        subtitle: candidate.sourceLabel ?? null,
        issueTitle: Array.from(candidate.matchedIssues)[0] ?? null,
        narrative:
          candidate.temporalReason ||
          candidate.diversityReason ||
          candidate.clusterReason ||
          candidate.summary ||
          "Retrieved evidence document included in the current case trail.",
        sortDate,
        dateLabel,
        documentIds: candidate.clusterDocumentIds,
        confidence: null,
      };
    },
  );

  const conflictEvents: GovernanceWorkspaceCaseTrailEvent[] =
    args.contradictionFoundation.groups.map((group) => {
      const ms = Math.max(
        ...group.documentIds
          .map((documentId) => candidateByDocumentId.get(documentId))
          .map((candidate) =>
            candidate ? (candidateBestKnownDate(candidate) ?? -1) : -1,
          ),
      );

      const normalizedMs = ms >= 0 ? ms : null;
      const { sortDate, dateLabel } = formatCaseTrailDate(normalizedMs);

      return {
        eventId: `conflict:${group.groupKey}`,
        eventType: "conflict_cluster",
        title: group.label,
        subtitle: `${group.candidateCount} contradiction signals`,
        issueTitle: group.issueTitle,
        narrative: group.strongestReason,
        sortDate,
        dateLabel,
        documentIds: group.documentIds,
        confidence: null,
      };
    });
  const overrideEvents: GovernanceWorkspaceCaseTrailEvent[] =
    args.contradictionFoundation.overrideHints.map((hint) => {
      const preferred = candidateByDocumentId.get(hint.preferredDocumentId);
      const superseded = candidateByDocumentId.get(hint.supersededDocumentId);

      const preferredMs = preferred ? candidateBestKnownDate(preferred) : null;
      const supersededMs = superseded
        ? candidateBestKnownDate(superseded)
        : null;
      const ms =
        preferredMs !== null && supersededMs !== null
          ? Math.max(preferredMs, supersededMs)
          : (preferredMs ?? supersededMs ?? null);

      const { sortDate, dateLabel } = formatCaseTrailDate(ms);

      return {
        eventId: `override:${hint.relationId}`,
        eventType: "override_hint",
        title: `Prefer ${hint.preferredDocumentTitle}`,
        subtitle: `May supersede ${hint.supersededDocumentTitle}`,
        issueTitle: null,
        narrative: hint.basis,
        sortDate,
        dateLabel,
        documentIds: [hint.preferredDocumentId, hint.supersededDocumentId],
        confidence: hint.confidence,
      };
    });

  const overrideChainEvents: GovernanceWorkspaceCaseTrailEvent[] =
    args.overrideChainFoundation.chains.map((chain) => {
      const chainCandidates = chain.documentIds
        .map((documentId) => candidateByDocumentId.get(documentId))
        .filter((item): item is RankedCandidate => Boolean(item));

      const msValues = chainCandidates
        .map((candidate) => candidateBestKnownDate(candidate))
        .filter((value): value is number => value !== null);

      const { sortDate, dateLabel } = formatCaseTrailDate(
        msValues.length ? Math.max(...msValues) : null,
      );

      return {
        eventId: chain.chainKey,
        eventType: "override_chain",
        title: chain.documentTitles.join(" → "),
        subtitle: `${chain.edgeCount} override link${chain.edgeCount > 1 ? "s" : ""}`,
        issueTitle: null,
        narrative: chain.basis,
        sortDate,
        dateLabel,
        documentIds: chain.documentIds,
        confidence: chain.maxConfidence,
      };
    });

  const comparisonEvents: GovernanceWorkspaceCaseTrailEvent[] =
    args.comparisonSurface.comparisons.map((comparison) => {
      const comparisonCandidates = comparison.documentIds
        .map((documentId) => candidateByDocumentId.get(documentId))
        .filter((item): item is RankedCandidate => Boolean(item));

      const msValues = comparisonCandidates
        .map((candidate) => candidateBestKnownDate(candidate))
        .filter((value): value is number => value !== null);

      const { sortDate, dateLabel } = formatCaseTrailDate(
        msValues.length ? Math.max(...msValues) : null,
      );

      return {
        eventId: `comparison:${comparison.comparisonKey}`,
        eventType: "conflict_cluster",
        title: comparison.documentTitles.join(" ↔ "),
        subtitle: `${comparison.contradictionSignalCount} conflict signal${comparison.contradictionSignalCount === 1 ? "" : "s"}`,
        issueTitle: comparison.issueTitle,
        narrative: comparison.changeSummary,
        sortDate,
        dateLabel,
        documentIds: comparison.documentIds,
        confidence: null,
      };
    });

  const events = [
    ...documentEvents,
    ...comparisonEvents,
    ...conflictEvents,
    ...overrideChainEvents,
    ...overrideEvents,
  ]
    .sort((a, b) => {
      if (a.sortDate && b.sortDate) {
        const byDate = a.sortDate.localeCompare(b.sortDate);
        if (byDate !== 0) return byDate;
      } else if (a.sortDate && !b.sortDate) {
        return -1;
      } else if (!a.sortDate && b.sortDate) {
        return 1;
      }

      const byType =
        caseTrailEventTypePriority(a.eventType) -
        caseTrailEventTypePriority(b.eventType);
      if (byType !== 0) return byType;

      return a.title.localeCompare(b.title);
    })
    .slice(0, 14);

  return {
    active:
      args.workflowMode === "case_trace" ||
      args.contradictionFoundation.active ||
      args.overrideChainFoundation.active ||
      args.ranked.length > 1,
    rationale:
      args.workflowMode === "case_trace"
        ? "This case trail orders retrieved documents, document comparisons, conflict clusters, override chains, and override hints into a single evolving timeline."
        : "This trail shows how the retrieved evidence evolves over time, including document comparisons, conflicts, override chains, and possible supersession.",
    summary: {
      eventCount: events.length,
      documentEventCount: documentEvents.length,
      conflictEventCount: conflictEvents.length + comparisonEvents.length,
      overrideEventCount: overrideEvents.length,
      overrideChainEventCount: overrideChainEvents.length,
    },
    events,
  };
}

function buildOverrideChains(
  hints: GovernanceWorkspaceOverrideHint[],
): GovernanceWorkspaceOverrideChain[] {
  if (!hints.length) return [];

  const nextBySource = new Map<string, GovernanceWorkspaceOverrideHint[]>();
  const incomingCount = new Map<string, number>();
  const allNodes = new Set<string>();

  for (const hint of hints) {
    const from = hint.supersededDocumentId;
    const to = hint.preferredDocumentId;

    const current = nextBySource.get(from) ?? [];
    current.push(hint);
    nextBySource.set(from, current);

    incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);

    allNodes.add(from);
    allNodes.add(to);
  }

  for (const [key, values] of nextBySource.entries()) {
    values.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    nextBySource.set(key, values);
  }

  const consumedEdges = new Set<string>();
  const chains: GovernanceWorkspaceOverrideChain[] = [];

  const starts = Array.from(allNodes).filter(
    (node) => (incomingCount.get(node) ?? 0) === 0 && nextBySource.has(node),
  );

  const fallbackStarts = Array.from(nextBySource.keys()).filter(
    (node) => !starts.includes(node),
  );

  const orderedStarts = [...starts, ...fallbackStarts];

  for (const start of orderedStarts) {
    let current = start;
    const visitedDocs = new Set<string>([current]);
    const documentIds = [current];
    const documentTitles: string[] = [];
    const edgeHints: GovernanceWorkspaceOverrideHint[] = [];

    while (true) {
      const nextHint = (nextBySource.get(current) ?? []).find(
        (hint) => !consumedEdges.has(hint.relationId),
      );
      if (!nextHint) break;

      consumedEdges.add(nextHint.relationId);
      edgeHints.push(nextHint);

      if (!documentTitles.length) {
        documentTitles.push(nextHint.supersededDocumentTitle);
      }

      const nextDoc = nextHint.preferredDocumentId;
      documentIds.push(nextDoc);
      documentTitles.push(nextHint.preferredDocumentTitle);

      if (visitedDocs.has(nextDoc)) break;
      visitedDocs.add(nextDoc);
      current = nextDoc;
    }

    if (!edgeHints.length) continue;

    chains.push({
      chainKey: `chain:${documentIds.join("->")}`,
      documentIds: Array.from(new Set(documentIds)),
      documentTitles,
      edgeCount: edgeHints.length,
      maxConfidence: edgeHints.reduce<number | null>(
        (best, item) =>
          best === null
            ? (item.confidence ?? null)
            : Math.max(best, item.confidence ?? 0),
        null,
      ),
      basis:
        edgeHints.length > 1
          ? "Multiple override or supersession hints form a likely chronology of position change."
          : (edgeHints[0]?.basis ??
            "A single override or supersession hint forms a likely chronology link."),
    });
  }

  return chains
    .sort((a, b) => {
      const byEdges = b.edgeCount - a.edgeCount;
      if (byEdges !== 0) return byEdges;
      return (b.maxConfidence ?? 0) - (a.maxConfidence ?? 0);
    })
    .slice(0, 6);
}

function buildOverrideChainFoundation(args: {
  contradictionFoundation: GovernanceWorkspaceContradictionFoundation;
}): GovernanceWorkspaceOverrideChainFoundation {
  const chains = buildOverrideChains(
    args.contradictionFoundation.overrideHints,
  );

  if (!chains.length) {
    return {
      active: false,
      rationale:
        "No linked override or supersession chains were assembled from the current hint set.",
      summary: {
        chainCount: 0,
        linkedDocumentCount: 0,
      },
      chains: [],
    };
  }

  const linkedDocumentIds = new Set(
    chains.flatMap((chain) => chain.documentIds),
  );

  return {
    active: true,
    rationale:
      "Override and supersession hints were linked into short chronology chains to show how the governing position may have shifted over time.",
    summary: {
      chainCount: chains.length,
      linkedDocumentCount: linkedDocumentIds.size,
    },
    chains,
  };
}

function candidateHasOrderCue(candidate: RankedCandidate) {
  const haystack = `${candidate.title} ${candidate.summary ?? ""} ${
    candidate.sourceLabel ?? ""
  }`.toLowerCase();

  return /\b(order|direction|notification|circular|guideline|guidelines|notice|mandate|regulation|compliance)\b/.test(
    haystack,
  );
}

function candidateHasCurrentCue(candidate: RankedCandidate) {
  const haystack = `${candidate.title} ${candidate.summary ?? ""} ${
    candidate.sourceLabel ?? ""
  }`.toLowerCase();

  return /\b(current|active|in force|effective|latest|ongoing|valid)\b/.test(
    haystack,
  );
}

function resolveTemporalControl(args: {
  workflowMode: GovernanceWorkspaceResolvedMode;
  queryType: GovernanceWorkspaceQueryType;
  question: string;
  timeHints: string[];
}): GovernanceWorkspaceTemporalControl {
  const lower = String(args.question || "").toLowerCase();

  const historicalIntent =
    args.queryType === "chronology_review" ||
    /\b(history|historical|timeline|chronology|trace|from\s+\d{4}\s+to\s+\d{4})\b/.test(
      lower,
    ) ||
    args.timeHints.includes("Chronology requested");

  if (historicalIntent) {
    return {
      active: false,
      mode: "historical_neutral",
      rationale:
        "This looks like a chronology or historical review, so the workspace avoids over-preferencing the newest evidence.",
      preferredSignals: ["Chronology requested", "Historical range"],
    };
  }

  const currentIntent =
    args.workflowMode === "landscape" &&
    (args.queryType === "broad_scan" ||
      /\b(current|currently|active|latest|today|now|in force)\b/.test(lower) ||
      args.timeHints.includes("Current or in-force view"));

  if (currentIntent) {
    return {
      active: true,
      mode: "current_preference",
      rationale:
        "This looks like a current-state governance question, so the workspace prefers recent and currently operative order-like evidence.",
      preferredSignals: [
        "Recent publication or update date",
        "Order or direction cue",
        "Current or active wording",
      ],
    };
  }

  return {
    active: false,
    mode: "neutral",
    rationale:
      "No strong temporal preference was applied for this evidence run.",
    preferredSignals: [],
  };
}

function applyTemporalPreference(args: {
  ranked: RankedCandidate[];
  control: GovernanceWorkspaceTemporalControl;
}) {
  if (!args.control.active || args.control.mode !== "current_preference") {
    return args.ranked;
  }

  return [...args.ranked]
    .map((candidate) => {
      let temporalBoost = 0;
      const notes: string[] = [];

      const ageDays = candidateAgeDays(candidate);

      if (ageDays !== null) {
        if (ageDays <= 30) {
          temporalBoost += 10;
          notes.push("Very recent evidence");
        } else if (ageDays <= 90) {
          temporalBoost += 7;
          notes.push("Recent evidence");
        } else if (ageDays <= 365) {
          temporalBoost += 3;
          notes.push("Still relatively recent");
        } else if (ageDays > 1095) {
          temporalBoost -= 6;
          notes.push("Older evidence for a current-state query");
        }
      }

      if (candidateHasOrderCue(candidate)) {
        temporalBoost += 5;
        notes.push("Order/direction style record");
      }

      if (candidateHasCurrentCue(candidate)) {
        temporalBoost += 4;
        notes.push("Active/current wording");
      }

      if (temporalBoost === 0) {
        return candidate;
      }

      const temporalReason = notes.join(" • ");

      return {
        ...candidate,
        matchScore: candidate.matchScore + temporalBoost,
        temporalReason,
        whyRanked: Array.from(
          new Set([...candidate.whyRanked, ...notes]),
        ).slice(0, 6),
      };
    })
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.authorityScore !== a.authorityScore) {
        return b.authorityScore - a.authorityScore;
      }
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
}

function normalizeDiversityValue(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function firstSetValue(values: Set<string>) {
  const first = values.values().next();
  return first.done ? "" : first.value;
}

function candidateIssueBucket(candidate: RankedCandidate) {
  return normalizeDiversityValue(firstSetValue(candidate.matchedIssues));
}

function candidateAgencyBucket(candidate: RankedCandidate) {
  return normalizeDiversityValue(firstSetValue(candidate.matchedAgencies));
}

function candidateSourceBucket(candidate: RankedCandidate) {
  const raw = String(candidate.sourceLabel || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return `${candidate.kind}:${normalizeDiversityValue(candidate.title).slice(0, 48)}`;
  }

  try {
    const url = new URL(raw);
    return `${candidate.kind}:${url.hostname.replace(/^www\./, "")}`;
  } catch {
    return `${candidate.kind}:${
      raw
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/[?#].*$/, "")
        .split("/")[0]
    }`;
  }
}

function shouldApplyEvidenceDiversity(args: {
  workflowMode: GovernanceWorkspaceResolvedMode;
  queryType: GovernanceWorkspaceQueryType;
  candidateCount: number;
}) {
  if (args.workflowMode === "case_trace") return false;
  if (args.workflowMode === "question_review") return false;
  if (args.queryType === "case_review") return false;
  if (args.queryType === "chronology_review") return false;
  if (args.queryType === "contradiction_review") return false;
  if (args.queryType === "question_review") return false;
  return args.candidateCount > 3;
}

function diversifyEvidenceCandidates(args: {
  ranked: RankedCandidate[];
  workflowMode: GovernanceWorkspaceResolvedMode;
  queryType: GovernanceWorkspaceQueryType;
  limit: number;
}): {
  items: RankedCandidate[];
  control: GovernanceWorkspaceDiversityControl;
} {
  const active = shouldApplyEvidenceDiversity({
    workflowMode: args.workflowMode,
    queryType: args.queryType,
    candidateCount: args.ranked.length,
  });

  if (!active) {
    return {
      items: args.ranked.slice(0, args.limit),
      control: {
        active: false,
        rationale:
          "Diversity balancing stays off for case-focused or already narrow evidence runs.",
        balancedBy: [],
      },
    };
  }

  const pool = [...args.ranked];
  const selected: RankedCandidate[] = [];

  const issueCounts = new Map<string, number>();
  const agencyCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();

  while (pool.length && selected.length < args.limit) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestReason: string | null = null;

    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i];
      const issueKey = candidateIssueBucket(candidate);
      const agencyKey = candidateAgencyBucket(candidate);
      const sourceKey = candidateSourceBucket(candidate);

      const issueCount = issueKey ? (issueCounts.get(issueKey) ?? 0) : 0;
      const agencyCount = agencyKey ? (agencyCounts.get(agencyKey) ?? 0) : 0;
      const sourceCount = sourceKey ? (sourceCounts.get(sourceKey) ?? 0) : 0;

      let adjusted = candidate.matchScore;
      const promotions: string[] = [];

      if (issueKey) {
        if (issueCount === 0) {
          adjusted += 6;
          promotions.push("issue coverage");
        } else {
          adjusted -= issueCount * 6;
        }
      }

      if (agencyKey) {
        if (agencyCount === 0) {
          adjusted += 4;
          promotions.push("agency coverage");
        } else {
          adjusted -= agencyCount * 4;
        }
      }

      if (sourceKey) {
        if (sourceCount === 0) {
          adjusted += 3;
          promotions.push("source-family coverage");
        } else {
          adjusted -= sourceCount * 3;
        }
      }

      if (
        candidate.coverageFamilies.includes("chunk") &&
        !selected.some((item) => item.coverageFamilies.includes("chunk"))
      ) {
        adjusted += 2;
        promotions.push("raw-text coverage");
      }

      if (
        candidate.coverageFamilies.includes("graph") &&
        !selected.some((item) => item.coverageFamilies.includes("graph"))
      ) {
        adjusted += 2;
        promotions.push("graph coverage");
      }

      if (
        adjusted > bestScore ||
        (adjusted === bestScore &&
          candidate.matchScore > pool[bestIndex].matchScore)
      ) {
        bestScore = adjusted;
        bestIndex = i;
        bestReason = promotions.length
          ? `Elevated to widen ${promotions.join(", ")}`
          : null;
      }
    }

    const chosen = pool.splice(bestIndex, 1)[0];
    const issueKey = candidateIssueBucket(chosen);
    const agencyKey = candidateAgencyBucket(chosen);
    const sourceKey = candidateSourceBucket(chosen);

    if (issueKey)
      issueCounts.set(issueKey, (issueCounts.get(issueKey) ?? 0) + 1);
    if (agencyKey)
      agencyCounts.set(agencyKey, (agencyCounts.get(agencyKey) ?? 0) + 1);
    if (sourceKey)
      sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);

    selected.push({
      ...chosen,
      diversityReason: bestReason,
      whyRanked: Array.from(
        new Set([...chosen.whyRanked, ...(bestReason ? [bestReason] : [])]),
      ).slice(0, 6),
    });
  }

  return {
    items: selected,
    control: {
      active: true,
      rationale:
        "Balanced the evidence set so one issue, agency, or source family does not dominate broad-scan results.",
      balancedBy: [
        "Issue coverage",
        "Agency coverage",
        "Source-family coverage",
      ],
    },
  };
}

function buildContainsOr(tokens: string[], fields: string[]) {
  return tokens.flatMap((token) =>
    fields.map((field) => ({
      [field]: ciContains(token),
    })),
  );
}

function chunkScopeSql(
  scope: GovernanceWorkspaceSourceScope,
  allowedDocumentIds?: string[] | null,
) {
  const typeSql =
    scope === "files"
      ? Prisma.sql`AND d."kind" = 'FILE'`
      : scope === "urls"
        ? Prisma.sql`AND d."kind" = 'URL'`
        : Prisma.empty;
  const allowedSql = allowedDocumentIds
    ? allowedDocumentIds.length
      ? Prisma.sql`AND d."id" IN (${Prisma.join(allowedDocumentIds)})`
      : Prisma.sql`AND false`
    : Prisma.empty;
  return Prisma.sql`${typeSql} ${allowedSql}`;
}

function deriveChunkTerms(question: string, tokens: string[]) {
  if (tokens.length) return tokens;

  return Array.from(
    new Set(
      String(question || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((value) => value.trim())
        .filter(
          (value) =>
            value.length >= 3 && !STOP_WORDS.has(value) && !/^\d+$/.test(value),
        )
        .slice(0, 8),
    ),
  );
}

function chunkMatchedTerms(text: string, tokens: string[]) {
  if (!tokens.length) return [] as string[];
  const lower = String(text || "").toLowerCase();
  return tokens.filter((token) => lower.includes(token)).slice(0, 4);
}

function buildChunkSummary(text: string, tokens: string[]) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= 280) return clean;

  const lower = clean.toLowerCase();
  const anchor = tokens.find((token) => lower.includes(token));

  if (!anchor) {
    return `${clean.slice(0, 280).trim()}…`;
  }

  const idx = lower.indexOf(anchor);
  const start = Math.max(0, idx - 80);
  const end = Math.min(clean.length, idx + 200);

  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${
    end < clean.length ? "…" : ""
  }`;
}

async function retrieveKeywordChunkHits(args: {
  question: string;
  tokens: string[];
  scope: GovernanceWorkspaceSourceScope;
  limit: number;
  allowedDocumentIds?: string[] | null;
}): Promise<ChunkRetrievalHit[]> {
  const q = String(args.question || "").trim();
  if (!q) return [];

  const scopeSql = chunkScopeSql(args.scope, args.allowedDocumentIds);
  const terms = deriveChunkTerms(args.question, args.tokens);

  try {
    const rows = await prisma.$queryRaw<
      { documentId: string; chunkText: string; rank: number | null }[]
    >`
      SELECT
        d."id" AS "documentId",
        sc."text" AS "chunkText",
        ts_rank(sc."fts", plainto_tsquery('english', ${q}))::float8 AS "rank"
      FROM "SourceChunk" sc
      JOIN "SourceRevision" sr ON sr."id" = sc."revisionId"
      JOIN "DocumentRevision" dr ON dr."id" = sr."documentRevisionId"
      JOIN "Document" d ON d."id" = dr."documentId"
      WHERE sr."isActive" = true
        ${scopeSql}
        AND sc."fts" @@ plainto_tsquery('english', ${q})
      ORDER BY "rank" DESC
      LIMIT ${args.limit}
    `;

    return rows.map((row) => {
      const matched = chunkMatchedTerms(row.chunkText, terms);
      const rankBoost = Math.min(14, Math.round(Number(row.rank ?? 0) * 10));

      return {
        documentId: row.documentId,
        retrievalKind: "keyword_chunk" as const,
        summary: buildChunkSummary(row.chunkText, terms),
        signalScore: 32 + rankBoost + matched.length * 3,
        reason: matched.length
          ? `Chunk text match: ${matched.join(", ")}`
          : "Chunk text full-text match",
      };
    });
  } catch {
    const fallbackRows = await prisma.$queryRaw<
      { documentId: string; chunkText: string }[]
    >`
      SELECT
        d."id" AS "documentId",
        sc."text" AS "chunkText"
      FROM "SourceChunk" sc
      JOIN "SourceRevision" sr ON sr."id" = sc."revisionId"
      JOIN "DocumentRevision" dr ON dr."id" = sr."documentRevisionId"
      JOIN "Document" d ON d."id" = dr."documentId"
      WHERE sr."isActive" = true
        ${scopeSql}
      ORDER BY sc."createdAt" DESC
      LIMIT ${Math.max(args.limit * 10, 240)}
    `;

    const scored = fallbackRows
      .map((row) => {
        const matched = chunkMatchedTerms(row.chunkText, terms);
        const lower = row.chunkText.toLowerCase();

        let rawScore = matched.length * 8;
        if (lower.includes(q.toLowerCase())) rawScore += 12;

        return {
          row,
          matched,
          rawScore,
        };
      })
      .filter((item) => item.rawScore > 0)
      .sort((a, b) => b.rawScore - a.rawScore)
      .slice(0, args.limit);

    return scored.map((item) => ({
      documentId: item.row.documentId,
      retrievalKind: "keyword_chunk" as const,
      summary: buildChunkSummary(item.row.chunkText, terms),
      signalScore: 26 + Math.min(18, item.rawScore),
      reason: item.matched.length
        ? `Chunk text match: ${item.matched.join(", ")}`
        : "Chunk text fallback match",
    }));
  }
}

async function retrieveSemanticChunkHits(args: {
  question: string;
  tokens: string[];
  scope: GovernanceWorkspaceSourceScope;
  limit: number;
  allowedDocumentIds?: string[] | null;
}): Promise<ChunkRetrievalHit[]> {
  const q = String(args.question || "").trim();
  if (!q) return [];

  const qEmbedding = await embedQuery(q);
  if (!qEmbedding?.length) return [];

  const qVec = toPgVectorLiteral(qEmbedding);
  const scopeSql = chunkScopeSql(args.scope, args.allowedDocumentIds);
  const terms = deriveChunkTerms(args.question, args.tokens);
  const maxDist = env.RETRIEVAL_MAX_COSINE_DISTANCE ?? 0.42;

  const rows = await prisma.$queryRaw<
    { documentId: string; chunkText: string; dist: number }[]
  >`
    SELECT
      d."id" AS "documentId",
      sc."text" AS "chunkText",
      (sc."embedding" <=> ${qVec}::vector)::float8 AS "dist"
    FROM "SourceChunk" sc
    JOIN "SourceRevision" sr ON sr."id" = sc."revisionId"
    JOIN "DocumentRevision" dr ON dr."id" = sr."documentRevisionId"
    JOIN "Document" d ON d."id" = dr."documentId"
    WHERE sr."isActive" = true
      AND sc."embedding" IS NOT NULL
      ${scopeSql}
    ORDER BY "dist" ASC
    LIMIT ${args.limit}
  `;

  return rows
    .filter((row) => Number(row.dist) <= maxDist)
    .map((row) => {
      const matched = chunkMatchedTerms(row.chunkText, terms);
      const closeness = Math.max(0, 1 - Number(row.dist) / maxDist);

      return {
        documentId: row.documentId,
        retrievalKind: "semantic_chunk" as const,
        summary: buildChunkSummary(row.chunkText, terms),
        signalScore: 28 + Math.round(closeness * 20) + matched.length * 2,
        reason: matched.length
          ? `Semantic chunk match: ${matched.join(", ")}`
          : "Semantic chunk match via embeddings",
      };
    });
}

async function addHybridChunkCandidates(
  map: Map<string, CandidateAccumulator>,
  args: {
    question: string;
    tokens: string[];
    scope: GovernanceWorkspaceSourceScope;
    limit: number;
    allowedDocumentIds?: Set<string> | null;
  },
) {
  const [keywordHits, semanticHits] = await Promise.all([
    retrieveKeywordChunkHits({
      ...args,
      allowedDocumentIds: args.allowedDocumentIds
        ? Array.from(args.allowedDocumentIds)
        : null,
    }),
    retrieveSemanticChunkHits({
      ...args,
      allowedDocumentIds: args.allowedDocumentIds
        ? Array.from(args.allowedDocumentIds)
        : null,
    }),
  ]);

  const allHits = [...keywordHits, ...semanticHits];
  if (!allHits.length) return;

  const mergedByDocument = new Map<
    string,
    {
      best: ChunkRetrievalHit;
      lanes: Set<ChunkRetrievalHit["retrievalKind"]>;
    }
  >();

  for (const hit of allHits) {
    const current = mergedByDocument.get(hit.documentId);

    if (!current) {
      mergedByDocument.set(hit.documentId, {
        best: hit,
        lanes: new Set([hit.retrievalKind]),
      });
      continue;
    }

    current.lanes.add(hit.retrievalKind);
    if (hit.signalScore > current.best.signalScore) {
      current.best = hit;
    }
  }

  const docs = await prisma.document.findMany({
    where: {
      id: {
        in: Array.from(mergedByDocument.keys()),
      },
    },
    select: documentContextSelect,
  });

  const docsById = new Map(docs.map((doc) => [doc.id, doc] as const));

  for (const [documentId, merged] of mergedByDocument.entries()) {
    const doc = docsById.get(documentId);
    if (!doc) continue;

    const laneBonus = merged.lanes.size > 1 ? 6 : 0;

    addCandidate(map, {
      doc,
      scope: args.scope,
      reason:
        merged.lanes.size > 1
          ? `${merged.best.reason} + multi-lane retrieval`
          : merged.best.reason,
      signalScore: merged.best.signalScore + laneBonus,
      lanes: Array.from(merged.lanes),
      summary: merged.best.summary,
      allowedDocumentIds: args.allowedDocumentIds,
    });
  }
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
  const retrievalQuestion = retrievalQuestionWithFilters(
    input.question,
    input.officerFilters,
  );
  const evidenceScope = input.collectorPurposeId
    ? await resolveCollectorPurposeEvidenceScope(input.ownerId, input.collectorPurposeId)
    : null;
  const allowedDocumentIds = evidenceScope
    ? new Set(evidenceScope.allowedDocumentIds)
    : null;
  const tokens = tokenizeQuestion(retrievalQuestion);
  const workflow = resolveWorkflowPlan({
    requestedMode: input.workflowMode,
    question: retrievalQuestion,
    tokens,
    anchorDocumentIds: input.anchorDocumentIds,
    anchorUrlIds: input.anchorUrlIds,
  });
  const queryUnderstanding = await buildQueryUnderstanding({
    question: retrievalQuestion,
    tokens,
    workflowMode: workflow.resolvedMode,
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
      lane: "anchor",
      anchorScore: 100,
      allowedDocumentIds,
    });
  }

  if (retrievalQuestion.trim()) {
    await addHybridChunkCandidates(candidates, {
      question: retrievalQuestion,
      tokens,
      scope: input.sourceScope,
      limit: Math.max(input.limit * 3, 18),
      allowedDocumentIds,
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
        lane: "metadata",
        allowedDocumentIds,
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
        lane: "issue_graph",
        issueTitle: row.title,
        summary: row.summary,
        allowedDocumentIds,
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
        lane: "claim_graph",
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.subjectAgency?.name],
        summary: row.claimSummary ?? row.claimText,
        allowedDocumentIds,
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
        lane: "event_graph",
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.actorAgency?.name],
        summary: row.summary ?? row.title,
        allowedDocumentIds,
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
        lane: "gap_graph",
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.primaryAgency?.name, row.secondaryAgency?.name],
        summary: row.summary,
        allowedDocumentIds,
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
        lane: "relation_graph",
        issueTitle: row.issue?.title ?? null,
        agencyNames: [row.fromAgency?.name, row.toAgency?.name],
        summary: row.rationale,
        allowedDocumentIds,
      });
    }
  }

  applyOfficerFilterBoosts(candidates, input.officerFilters);

  const ranked = Array.from(candidates.values())
    .map((candidate) => rankCandidate(candidate))
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.authorityScore !== a.authorityScore) {
        return b.authorityScore - a.authorityScore;
      }
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

  const clustered = clusterRankedCandidates(ranked).sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (b.authorityScore !== a.authorityScore) {
      return b.authorityScore - a.authorityScore;
    }
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  const temporalControl = resolveTemporalControl({
    workflowMode: workflow.resolvedMode,
    queryType: queryUnderstanding.queryType,
    question: input.question,
    timeHints: queryUnderstanding.timeHints,
  });

  const diversityResult = diversifyEvidenceCandidates({
    ranked: applyTemporalPreference({
      ranked: clustered,
      control: temporalControl,
    }),
    workflowMode: workflow.resolvedMode,
    queryType: queryUnderstanding.queryType,
    limit: input.limit,
  });

  const diversified = diversityResult.items;

  const contradictionFoundation = await buildContradictionFoundation({
    documentIds: Array.from(
      new Set(diversified.flatMap((candidate) => candidate.clusterDocumentIds)),
    ),
    workflowMode: workflow.resolvedMode,
  });

  const overrideChainFoundation = buildOverrideChainFoundation({
    contradictionFoundation,
  });

  const comparisonSurface = buildComparisonSurface({
    contradictionFoundation,
    overrideChainFoundation,
  });

  const landscapeMappingSurface = buildLandscapeMappingSurface({
    ranked: diversified,
    workflowMode: workflow.resolvedMode,
    queryType: queryUnderstanding.queryType,
    contradictionFoundation,
  });

  const caseTrailFoundation = buildCaseTrailFoundation({
    ranked: diversified,
    contradictionFoundation,
    overrideChainFoundation,
    comparisonSurface,
    workflowMode: workflow.resolvedMode,
  });

  const caseTracingSurface = buildCaseTracingSurface({
    ranked: diversified,
    workflowMode: workflow.resolvedMode,
    queryType: queryUnderstanding.queryType,
    contradictionFoundation,
    comparisonSurface,
    overrideChainFoundation,
    caseTrailFoundation,
  });

  const questionReviewSurface = buildQuestionReviewSurface({
    question: input.question,
    ranked: diversified,
    workflowMode: workflow.resolvedMode,
    queryType: queryUnderstanding.queryType,
    contradictionFoundation,
    comparisonSurface,
    caseTrailFoundation,
  });

  const retrievalDecision = resolveRetrievalDecision(diversified);

  const statsByDocument = await attachDocumentStats(
    Array.from(
      new Set(diversified.flatMap((candidate) => candidate.clusterDocumentIds)),
    ),
  );

  const items = diversified.map((candidate) => {
    const stats = aggregateClusterStats(
      statsByDocument,
      candidate.clusterDocumentIds,
    );

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
      authorityScore: candidate.authorityScore,
      freshnessScore: candidate.freshnessScore,
      anchor: candidate.anchor,
      reasons: Array.from(candidate.reasons).slice(0, 4),
      whyRanked: candidate.whyRanked,
      matchedIssues: Array.from(candidate.matchedIssues).slice(0, 3),
      matchedAgencies: Array.from(candidate.matchedAgencies).slice(0, 3),
      duplicateCount: candidate.duplicateCount,
      clusterDocumentIds: candidate.clusterDocumentIds,
      clusterKinds: candidate.clusterKinds,
      clusterReason: candidate.clusterReason,
      retrievalLanes: candidate.retrievalLanes,
      coverageFamilies: candidate.coverageFamilies,
      diversityReason: candidate.diversityReason,
      temporalReason: candidate.temporalReason,
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
      collectorPurposeId: input.collectorPurposeId,
      officerFilters: input.officerFilters,
    },
    evidenceScope,
    workflow,
    queryUnderstanding,
    temporalControl,
    diversityControl: diversityResult.control,
    contradictionFoundation,
    overrideChainFoundation,
    comparisonSurface,
    landscapeMappingSurface,
    caseTracingSurface,
    questionReviewSurface,
    caseTrailFoundation,
    retrievalDecision,
    selectedDocumentId: retrievalDecision.shouldAutoSelect
      ? retrievalDecision.recommendedDocumentId
      : null,
    totalCandidates: items.length,
    candidates: items,
  };
}
