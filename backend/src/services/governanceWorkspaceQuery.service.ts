import prisma from "../config/database";
import { env } from "../config/env";
import { Prisma, DocumentKind } from "../generated/prisma/client";
import { embedQuery, toPgVectorLiteral } from "./embeddings.service";

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

type RankedCandidate = CandidateAccumulator & {
  authorityScore: number;
  freshnessScore: number;
  matchScore: number;
  whyRanked: string[];
};

type GovernanceWorkspaceQueryType =
  | "broad_scan"
  | "case_review"
  | "chronology_review"
  | "contradiction_review";

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
  workflowMode: "landscape" | "case_trace";
  question: string;
}): GovernanceWorkspaceQueryType {
  const text = String(args.question || "").toLowerCase();

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
  workflowMode: "landscape" | "case_trace";
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

function rankCandidate(candidate: CandidateAccumulator): RankedCandidate {
  const authorityScore = computeAuthorityScore(candidate);
  const freshnessScore = computeFreshnessScore(candidate);

  return {
    ...candidate,
    authorityScore,
    freshnessScore,
    matchScore:
      candidate.anchorScore +
      candidate.signalScore +
      authorityScore +
      freshnessScore,
    whyRanked: buildRankingWhy(candidate, {
      authorityScore,
      freshnessScore,
    }),
  };
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

function chunkScopeSql(scope: GovernanceWorkspaceSourceScope) {
  if (scope === "files") return Prisma.sql`AND d."kind" = 'FILE'`;
  if (scope === "urls") return Prisma.sql`AND d."kind" = 'URL'`;
  return Prisma.empty;
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
}): Promise<ChunkRetrievalHit[]> {
  const q = String(args.question || "").trim();
  if (!q) return [];

  const scopeSql = chunkScopeSql(args.scope);
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
}): Promise<ChunkRetrievalHit[]> {
  const q = String(args.question || "").trim();
  if (!q) return [];

  const qEmbedding = await embedQuery(q);
  if (!qEmbedding?.length) return [];

  const qVec = toPgVectorLiteral(qEmbedding);
  const scopeSql = chunkScopeSql(args.scope);
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
  },
) {
  const [keywordHits, semanticHits] = await Promise.all([
    retrieveKeywordChunkHits(args),
    retrieveSemanticChunkHits(args),
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
      summary: merged.best.summary,
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
  const tokens = tokenizeQuestion(input.question);
  const workflow = resolveWorkflowPlan({
    requestedMode: input.workflowMode,
    question: input.question,
    tokens,
    anchorDocumentIds: input.anchorDocumentIds,
    anchorUrlIds: input.anchorUrlIds,
  });
  const queryUnderstanding = await buildQueryUnderstanding({
    question: input.question,
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
      anchorScore: 100,
    });
  }

  if (input.question.trim()) {
    await addHybridChunkCandidates(candidates, {
      question: input.question,
      tokens,
      scope: input.sourceScope,
      limit: Math.max(input.limit * 3, 18),
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
    .map((candidate) => rankCandidate(candidate))
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.authorityScore !== a.authorityScore) {
        return b.authorityScore - a.authorityScore;
      }
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    })
    .slice(0, input.limit);

  const retrievalDecision = resolveRetrievalDecision(ranked);

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
      authorityScore: candidate.authorityScore,
      freshnessScore: candidate.freshnessScore,
      anchor: candidate.anchor,
      reasons: Array.from(candidate.reasons).slice(0, 4),
      whyRanked: candidate.whyRanked,
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
    queryUnderstanding,
    retrievalDecision,
    selectedDocumentId: retrievalDecision.shouldAutoSelect
      ? retrievalDecision.recommendedDocumentId
      : null,
    totalCandidates: items.length,
    candidates: items,
  };
}
