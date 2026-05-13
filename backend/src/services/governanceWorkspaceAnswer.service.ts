import { randomUUID } from "crypto";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import prisma from "../config/database";
import { env } from "../config/env";
import { Prisma } from "../generated/prisma/client";
import { openaiClient } from "./openaiClient";
import { queryGovernanceWorkspaceEvidence } from "./governanceWorkspaceQuery.service";

export type GovernanceAnswerStreamEvent =
  | { type: "run"; runId: string; sessionId: string }
  | { type: "status"; message: string }
  | { type: "delta"; text: string };

export type GovernanceAnswerStreamEmit = (
  event: GovernanceAnswerStreamEvent,
) => void | Promise<void>;

export type GovernanceAnswerInput = {
  question: string;
  sessionId?: string | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  previousRunId?: string | null;
  previousResponseId?: string | null;
  anchorDocumentIds?: string[];
  anchorUrlIds?: number[];
  sourceScope?: "all" | "files" | "urls" | "mixed";
  workflowMode?: "auto" | "landscape" | "case_trace" | "question_review";
  limit?: number;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
  deepReview?: boolean;
  requestId?: string | null;
  createdBy?: string | null;
  signal?: AbortSignal;
  onStreamEvent?: GovernanceAnswerStreamEmit;
};

type EvidenceKind =
  | "source_chunk"
  | "claim"
  | "event"
  | "gap"
  | "relation"
  | "trace";

type EvidenceCard = {
  evidenceId: string;
  kind: EvidenceKind;
  title: string;
  text: string;
  documentId: string | null;
  sourceKind?: "URL" | "FILE" | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  chunkId?: string | null;
  sourceId?: string | null;
  sourceRevisionId?: string | null;
  documentRevisionId?: string | null;
  pipelineConfigId?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
};

type ValidatedCitation = {
  evidenceId: string;
  quote: string;
  sourceKind: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  fileId: string | null;
  fileName: string | null;
  chunkId: string | null;
  sourceId: string | null;
  sourceRevisionId: string | null;
  documentRevisionId: string | null;
  pipelineConfigId: string | null;
  documentId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
};

type ValidationReport = {
  status: "verified" | "partially_supported" | "unsupported";
  validCitationCount: number;
  invalidCitationCount: number;
  repaired: boolean;
  droppedClaims: string[];
};

const GOVERNANCE_ANSWER_PROMPT_VERSION = "governance-workspace-answer-v1";

const CitationSchema = z.object({
  evidenceId: z.string().min(1),
  quote: z.string().min(20).max(320),
});

const ClaimCitationSchema = z.object({
  claim: z.string().min(8).max(900),
  citations: z.array(CitationSchema).min(1).max(8),
});

const EvidenceOutputSchema = z.object({
  evidenceId: z.string().min(1),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(900),
  citations: z.array(CitationSchema).min(1).max(6),
});

const CaveatSchema = z.object({
  kind: z.enum(["limitation", "inference", "suggestion"]),
  text: z.string().min(1).max(900),
  citations: z.array(CitationSchema).max(6).optional(),
});

const GovernanceAnswerSchema = z.object({
  answer: z
    .string()
    .describe("Readable markdown answer. Every factual claim must be covered by claimCitations."),
  claimCitations: z
    .array(ClaimCitationSchema)
    .describe("Atomic factual claims with citations to verbatim evidence quotes."),
  evidence: z
    .array(EvidenceOutputSchema)
    .max(12)
    .describe("Important evidence cards used in the answer."),
  caveats: z
    .array(CaveatSchema)
    .max(8)
    .describe("Limitations, clearly labelled inferences, or general suggestions not directly established by evidence."),
  openQuestions: z.array(z.string().min(1).max(500)).max(8),
  suggestedFollowUps: z.array(z.string().min(1).max(240)).min(0).max(6),
});

type GovernanceAnswerStructured = z.infer<typeof GovernanceAnswerSchema>;

const RerankSchema = z.object({
  evidenceIds: z.array(z.string().min(1)).max(28),
});

type GovernanceAnswerSessionRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  requestId: string | null;
  title: string | null;
  question: string | null;
  anchorDocumentIds: unknown;
  anchorUrlIds: unknown;
  sourceScope: string | null;
  requestedWorkflowMode: string | null;
  resolvedWorkflowMode: string | null;
  selectedIssueId: string | null;
  selectedAgencyId: string | null;
  metadata: unknown;
};

type GovernanceAnswerRunRow = {
  id: string;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  requestId: string | null;
  status: string;
  question: string;
  answer: string | null;
  citations: unknown;
  evidence: unknown;
  caveats: unknown;
  openQuestions: unknown;
  suggestedFollowUps: unknown;
  structuredAnswer: unknown;
  model: string | null;
  assistModel: string | null;
  openaiResponseId: string | null;
  previousResponseId: string | null;
  previousRunId: string | null;
  anchorDocumentIds: unknown;
  anchorUrlIds: unknown;
  sourceScope: string | null;
  requestedWorkflowMode: string | null;
  resolvedWorkflowMode: string | null;
  selectedIssueId: string | null;
  selectedAgencyId: string | null;
  candidateDocumentIds: unknown;
  finalEvidenceChunkIds: unknown;
  sourceRevisionIds: unknown;
  documentRevisionIds: unknown;
  pipelineConfigIds: unknown;
  retrievalMetadata: unknown;
  groundingStatus: string | null;
  validation: unknown;
  error: string | null;
  latencyMs: number | null;
};

function asJson(value: unknown): Prisma.Sql {
  return Prisma.sql`${JSON.stringify(value ?? null)}::jsonb`;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function safeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (entry): entry is number =>
          typeof entry === "number" && Number.isFinite(entry),
      ),
    ),
  );
}

function modelForAnswer(deepReview?: boolean) {
  if (deepReview) return env.GOVERNANCE_DEEP_REVIEW_MODEL;
  return env.GOVERNANCE_ANSWER_MODEL;
}

function modelForAssist() {
  return env.GOVERNANCE_ASSIST_MODEL;
}

function normalizeQuestion(value: string) {
  return String(value || "").trim().slice(0, 4000);
}

function normalizeScope(value: unknown): "all" | "files" | "urls" | "mixed" {
  return value === "files" || value === "urls" || value === "mixed"
    ? value
    : "all";
}

function normalizeWorkflow(
  value: unknown,
): "auto" | "landscape" | "case_trace" | "question_review" {
  return value === "landscape" ||
    value === "case_trace" ||
    value === "question_review"
    ? value
    : "auto";
}

function extractKeywords(input: string) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "why",
    "how",
    "does",
    "did",
    "was",
    "were",
    "are",
    "into",
    "one",
    "another",
    "record",
    "unit",
  ]);

  return String(input || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3 && !stop.has(entry))
    .slice(0, 18);
}

function evidenceScore(card: EvidenceCard, keywords: string[], rankByDoc: Map<string, number>) {
  const text = `${card.title}\n${card.text}`.toLowerCase();
  let score = 0;
  for (const token of keywords) {
    if (text.includes(token)) score += 5;
    if (card.title.toLowerCase().includes(token)) score += 3;
  }
  const docRank = card.documentId ? rankByDoc.get(card.documentId) : undefined;
  if (docRank !== undefined) score += Math.max(0, 16 - docRank * 2);
  if (card.kind === "source_chunk") score += 4;
  if (card.kind === "claim") score += 3;
  if (card.kind === "relation") score += 3;
  return score;
}

function compact(value: unknown, max = 2000) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findVerbatimQuote(text: string, quoteFromModel: string) {
  const quote = String(quoteFromModel || "").replace(/\u00a0/g, " ").trim();
  if (quote.length < 20) return null;

  const exact = text.indexOf(quote);
  if (exact >= 0) return { idx: exact, quote: quote.slice(0, 320) };

  const tokens = quote.split(/\s+/g).filter(Boolean);
  if (tokens.length < 3) return null;

  const re = new RegExp(tokens.map(escapeRegExp).join("\\s+"), "m");
  const match = re.exec(text);
  if (!match || match.index == null || match[0].length < 20) return null;
  return { idx: match.index, quote: match[0].slice(0, 320) };
}

function uniq<T>(items: T[]) {
  return Array.from(new Set(items));
}

function flattenValidCitations(groups: Array<{ citations: ValidatedCitation[] }>) {
  const seen = new Set<string>();
  const out: ValidatedCitation[] = [];
  for (const group of groups) {
    for (const citation of group.citations) {
      const key = `${citation.evidenceId}::${citation.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(citation);
    }
  }
  return out;
}

async function insertSession(p: {
  question: string | null;
  createdBy?: string | null;
  requestId?: string | null;
  anchorDocumentIds: string[];
  anchorUrlIds: number[];
  sourceScope: string;
  requestedWorkflowMode: string;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
}) {
  const id = randomUUID();
  const title = p.question ? p.question.slice(0, 120) : "Governance answer session";

  await prisma.$executeRaw`
    INSERT INTO "GovernanceAnswerSession"
      ("id", "createdAt", "updatedAt", "createdBy", "requestId", "title", "question",
       "anchorDocumentIds", "anchorUrlIds", "sourceScope", "requestedWorkflowMode",
       "selectedIssueId", "selectedAgencyId", "metadata")
    VALUES
      (${id}, NOW(), NOW(), ${p.createdBy ?? null}, ${p.requestId ?? null}, ${title}, ${p.question},
       ${asJson(p.anchorDocumentIds)}, ${asJson(p.anchorUrlIds)}, ${p.sourceScope}, ${p.requestedWorkflowMode},
       ${p.selectedIssueId ?? null}, ${p.selectedAgencyId ?? null}, ${asJson({ promptVersion: GOVERNANCE_ANSWER_PROMPT_VERSION })})
  `;

  return id;
}

async function ensureSession(p: {
  sessionId?: string | null;
  question: string | null;
  createdBy?: string | null;
  requestId?: string | null;
  anchorDocumentIds: string[];
  anchorUrlIds: number[];
  sourceScope: string;
  requestedWorkflowMode: string;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
}) {
  if (p.sessionId) {
    const rows = await prisma.$queryRaw<GovernanceAnswerSessionRow[]>`
      SELECT * FROM "GovernanceAnswerSession" WHERE "id" = ${p.sessionId} LIMIT 1
    `;
    if (rows[0]) {
      await prisma.$executeRaw`
        UPDATE "GovernanceAnswerSession"
        SET "updatedAt" = NOW(),
            "question" = COALESCE(${p.question}, "question"),
            "anchorDocumentIds" = ${asJson(p.anchorDocumentIds)},
            "anchorUrlIds" = ${asJson(p.anchorUrlIds)},
            "sourceScope" = ${p.sourceScope},
            "requestedWorkflowMode" = ${p.requestedWorkflowMode},
            "selectedIssueId" = ${p.selectedIssueId ?? null},
            "selectedAgencyId" = ${p.selectedAgencyId ?? null}
        WHERE "id" = ${p.sessionId}
      `;
      return p.sessionId;
    }
  }

  return insertSession(p);
}

async function insertRun(p: {
  sessionId: string;
  question: string;
  model: string;
  assistModel: string;
  previousRunId?: string | null;
  previousResponseId?: string | null;
  createdBy?: string | null;
  requestId?: string | null;
  anchorDocumentIds: string[];
  anchorUrlIds: number[];
  sourceScope: string;
  requestedWorkflowMode: string;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
}) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "GovernanceAnswerRun"
      ("id", "sessionId", "createdAt", "updatedAt", "createdBy", "requestId", "status", "question",
       "model", "assistModel", "previousRunId", "previousResponseId",
       "anchorDocumentIds", "anchorUrlIds", "sourceScope", "requestedWorkflowMode",
       "selectedIssueId", "selectedAgencyId")
    VALUES
      (${id}, ${p.sessionId}, NOW(), NOW(), ${p.createdBy ?? null}, ${p.requestId ?? null}, 'STARTED', ${p.question},
       ${p.model}, ${p.assistModel}, ${p.previousRunId ?? null}, ${p.previousResponseId ?? null},
       ${asJson(p.anchorDocumentIds)}, ${asJson(p.anchorUrlIds)}, ${p.sourceScope}, ${p.requestedWorkflowMode},
       ${p.selectedIssueId ?? null}, ${p.selectedAgencyId ?? null})
  `;
  return id;
}

async function completeRun(p: {
  runId: string;
  startedAtMs: number;
  openaiResponseId?: string | null;
  resolvedWorkflowMode?: string | null;
  answer: GovernanceAnswerStructured;
  claimCitations: Array<{ claim: string; citations: ValidatedCitation[] }>;
  evidence: Array<{ evidenceId: string; title: string; summary: string; citations: ValidatedCitation[] }>;
  caveats: Array<{ kind: string; text: string; citations?: unknown[] }>;
  citations: ValidatedCitation[];
  candidateDocumentIds: string[];
  finalEvidenceChunkIds: string[];
  sourceRevisionIds: string[];
  documentRevisionIds: string[];
  pipelineConfigIds: string[];
  retrievalMetadata: unknown;
  validation: ValidationReport;
}) {
  const latencyMs = Date.now() - p.startedAtMs;
  await prisma.$executeRaw`
    UPDATE "GovernanceAnswerRun"
    SET "updatedAt" = NOW(),
        "status" = 'SUCCEEDED',
        "answer" = ${p.answer.answer},
        "citations" = ${asJson(p.citations)},
        "evidence" = ${asJson(p.evidence)},
        "caveats" = ${asJson(p.caveats)},
        "openQuestions" = ${asJson(p.answer.openQuestions)},
        "suggestedFollowUps" = ${asJson(p.answer.suggestedFollowUps)},
        "structuredAnswer" = ${asJson({ ...p.answer, claimCitations: p.claimCitations, evidence: p.evidence, caveats: p.caveats })},
        "openaiResponseId" = ${p.openaiResponseId ?? null},
        "resolvedWorkflowMode" = ${p.resolvedWorkflowMode ?? null},
        "candidateDocumentIds" = ${asJson(p.candidateDocumentIds)},
        "finalEvidenceChunkIds" = ${asJson(p.finalEvidenceChunkIds)},
        "sourceRevisionIds" = ${asJson(p.sourceRevisionIds)},
        "documentRevisionIds" = ${asJson(p.documentRevisionIds)},
        "pipelineConfigIds" = ${asJson(p.pipelineConfigIds)},
        "retrievalMetadata" = ${asJson(p.retrievalMetadata)},
        "groundingStatus" = ${p.validation.status},
        "validation" = ${asJson(p.validation)},
        "latencyMs" = ${latencyMs}
    WHERE "id" = ${p.runId}
  `;

  await prisma.$executeRaw`
    UPDATE "GovernanceAnswerSession" s
    SET "updatedAt" = NOW(),
        "resolvedWorkflowMode" = ${p.resolvedWorkflowMode ?? null}
    WHERE s."id" = (SELECT "sessionId" FROM "GovernanceAnswerRun" WHERE "id" = ${p.runId})
  `;

  return latencyMs;
}

async function failRun(p: {
  runId: string;
  startedAtMs: number;
  error: unknown;
  retrievalMetadata?: unknown;
}) {
  const message = p.error instanceof Error ? p.error.message : String(p.error ?? "Unknown error");
  await prisma.$executeRaw`
    UPDATE "GovernanceAnswerRun"
    SET "updatedAt" = NOW(),
        "status" = 'FAILED',
        "error" = ${message.slice(0, 2000)},
        "retrievalMetadata" = ${asJson(p.retrievalMetadata ?? null)},
        "latencyMs" = ${Date.now() - p.startedAtMs}
    WHERE "id" = ${p.runId}
  `;
}

async function previousResponseIdFromRun(previousRunId?: string | null) {
  if (!previousRunId) return null;
  const rows = await prisma.$queryRaw<Array<{ openaiResponseId: string | null }>>`
    SELECT "openaiResponseId" FROM "GovernanceAnswerRun" WHERE "id" = ${previousRunId} LIMIT 1
  `;
  return rows[0]?.openaiResponseId ?? null;
}

function mapRun(row: GovernanceAnswerRunRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: row.status,
    question: row.question,
    answer: row.answer,
    citations: Array.isArray(row.citations) ? row.citations : [],
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    caveats: Array.isArray(row.caveats) ? row.caveats : [],
    openQuestions: Array.isArray(row.openQuestions) ? row.openQuestions : [],
    suggestedFollowUps: Array.isArray(row.suggestedFollowUps)
      ? row.suggestedFollowUps
      : [],
    structuredAnswer: row.structuredAnswer ?? null,
    model: row.model,
    assistModel: row.assistModel,
    openaiResponseId: row.openaiResponseId,
    previousRunId: row.previousRunId,
    previousResponseId: row.previousResponseId,
    candidateDocumentIds: safeStringArray(row.candidateDocumentIds),
    finalEvidenceChunkIds: safeStringArray(row.finalEvidenceChunkIds),
    retrievalMetadata: row.retrievalMetadata ?? null,
    groundingStatus: row.groundingStatus,
    validation: row.validation ?? null,
    error: row.error,
    latencyMs: row.latencyMs,
  };
}

function mapSession(row: GovernanceAnswerSessionRow, runs: GovernanceAnswerRunRow[] = []) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdBy,
    requestId: row.requestId,
    title: row.title,
    question: row.question,
    anchorDocumentIds: safeStringArray(row.anchorDocumentIds),
    anchorUrlIds: safeNumberArray(row.anchorUrlIds),
    sourceScope: row.sourceScope,
    requestedWorkflowMode: row.requestedWorkflowMode,
    resolvedWorkflowMode: row.resolvedWorkflowMode,
    selectedIssueId: row.selectedIssueId,
    selectedAgencyId: row.selectedAgencyId,
    metadata: row.metadata ?? null,
    runs: runs.map(mapRun),
  };
}

export async function createGovernanceAnswerSession(p: {
  question?: string | null;
  anchorDocumentIds?: string[];
  anchorUrlIds?: number[];
  sourceScope?: "all" | "files" | "urls" | "mixed";
  workflowMode?: "auto" | "landscape" | "case_trace" | "question_review";
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
  requestId?: string | null;
  createdBy?: string | null;
}) {
  const question = p.question ? normalizeQuestion(p.question) : null;
  const sessionId = await insertSession({
    question,
    createdBy: p.createdBy ?? null,
    requestId: p.requestId ?? null,
    anchorDocumentIds: safeStringArray(p.anchorDocumentIds),
    anchorUrlIds: safeNumberArray(p.anchorUrlIds),
    sourceScope: normalizeScope(p.sourceScope),
    requestedWorkflowMode: normalizeWorkflow(p.workflowMode),
    selectedIssueId: p.selectedIssueId ?? null,
    selectedAgencyId: p.selectedAgencyId ?? null,
  });
  return getGovernanceAnswerSession(sessionId);
}

export async function getGovernanceAnswerSession(sessionId: string) {
  const sessions = await prisma.$queryRaw<GovernanceAnswerSessionRow[]>`
    SELECT * FROM "GovernanceAnswerSession" WHERE "id" = ${sessionId} LIMIT 1
  `;
  const session = sessions[0];
  if (!session) {
    const err: any = new Error("Governance answer session not found");
    err.status = 404;
    throw err;
  }

  const runs = await prisma.$queryRaw<GovernanceAnswerRunRow[]>`
    SELECT * FROM "GovernanceAnswerRun"
    WHERE "sessionId" = ${sessionId}
    ORDER BY "createdAt" ASC
  `;

  return mapSession(session, runs);
}

async function loadEvidenceCards(p: {
  question: string;
  candidateDocumentIds: string[];
  maxCards?: number;
}) {
  if (!p.candidateDocumentIds.length) return [];

  const rankByDoc = new Map(p.candidateDocumentIds.map((id, index) => [id, index]));
  const keywords = extractKeywords(p.question);

  const chunks = await prisma.sourceChunk.findMany({
    where: {
      revision: {
        isActive: true,
        documentRevision: {
          documentId: { in: p.candidateDocumentIds },
        },
      },
    },
    include: {
      source: { include: { url: true, file: true } },
      revision: {
        select: {
          id: true,
          documentRevisionId: true,
          pipelineConfigId: true,
          documentRevision: { select: { documentId: true } },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: Math.max(80, p.candidateDocumentIds.length * 18),
  });

  const cards: EvidenceCard[] = chunks.map((chunk: any) => {
    const sourceKind = chunk.source?.kind ?? null;
    const sourceLabel =
      sourceKind === "URL"
        ? chunk.source?.url?.title ?? chunk.source?.url?.url ?? "URL source"
        : chunk.source?.file?.fileName ?? "File source";

    return {
      evidenceId: `chunk:${chunk.id}`,
      kind: "source_chunk",
      title: `${sourceLabel} — passage ${chunk.idx}`,
      text: compact(chunk.text, 2600),
      documentId: chunk.revision?.documentRevision?.documentId ?? null,
      sourceKind,
      sourceLabel,
      sourceUrl: sourceKind === "URL" ? chunk.source?.url?.url ?? null : null,
      fileId: sourceKind === "FILE" ? chunk.source?.file?.id ?? null : null,
      fileName: sourceKind === "FILE" ? chunk.source?.file?.fileName ?? null : null,
      chunkId: chunk.id,
      sourceId: chunk.sourceId,
      sourceRevisionId: chunk.revisionId,
      documentRevisionId: chunk.revision?.documentRevisionId ?? null,
      pipelineConfigId: chunk.revision?.pipelineConfigId ?? null,
      pageStart: chunk.pageStart ?? null,
      pageEnd: chunk.pageEnd ?? null,
      charStart: chunk.charStart ?? null,
      charEnd: chunk.charEnd ?? null,
    };
  });

  const traceSelect = {
    id: true,
    sourceDocumentId: true,
    evidenceText: true,
    confidence: true,
    sourceRevisionId: true,
    documentRevisionId: true,
    pipelineConfigId: true,
  } as const;

  const [claims, events, gaps, relations, traces] = await Promise.all([
    prisma.documentClaim.findMany({
      where: { trace: { sourceDocumentId: { in: p.candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        subjectAgency: { select: { name: true } },
        trace: { select: traceSelect },
      },
      orderBy: { updatedAt: "desc" },
      take: 70,
    }),
    prisma.documentEvent.findMany({
      where: { trace: { sourceDocumentId: { in: p.candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        actorAgency: { select: { name: true } },
        trace: { select: traceSelect },
      },
      orderBy: [{ sortDate: "desc" }, { updatedAt: "desc" }],
      take: 60,
    }),
    prisma.governanceGap.findMany({
      where: { trace: { sourceDocumentId: { in: p.candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        primaryAgency: { select: { name: true } },
        secondaryAgency: { select: { name: true } },
        trace: { select: traceSelect },
      },
      orderBy: { updatedAt: "desc" },
      take: 60,
    }),
    prisma.documentRelation.findMany({
      where: { trace: { sourceDocumentId: { in: p.candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        fromAgency: { select: { name: true } },
        toAgency: { select: { name: true } },
        fromClaim: { select: { claimText: true } },
        toClaim: { select: { claimText: true } },
        trace: { select: traceSelect },
      },
      orderBy: { updatedAt: "desc" },
      take: 70,
    }),
    prisma.extractionTrace.findMany({
      where: {
        sourceDocumentId: { in: p.candidateDocumentIds },
        evidenceText: { not: null },
      },
      select: traceSelect,
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
  ]);

  for (const claim of claims as any[]) {
    const text = compact(
      [claim.claimText, claim.claimSummary, claim.scopeText, claim.trace?.evidenceText]
        .filter(Boolean)
        .join("\n"),
      2200,
    );
    if (!text) continue;
    cards.push({
      evidenceId: `claim:${claim.id}`,
      kind: "claim",
      title: compact(
        [claim.issue?.title, claim.subjectAgency?.name, "claim"].filter(Boolean).join(" — "),
        180,
      ),
      text,
      documentId: claim.trace?.sourceDocumentId ?? null,
      sourceRevisionId: claim.trace?.sourceRevisionId ?? null,
      documentRevisionId: claim.trace?.documentRevisionId ?? null,
      pipelineConfigId: claim.trace?.pipelineConfigId ?? null,
      confidence: claim.trace?.confidence ?? null,
    });
  }

  for (const event of events as any[]) {
    const text = compact(
      [event.title, event.summary, event.eventDateText, event.trace?.evidenceText]
        .filter(Boolean)
        .join("\n"),
      2200,
    );
    if (!text) continue;
    cards.push({
      evidenceId: `event:${event.id}`,
      kind: "event",
      title: compact(
        [event.issue?.title, event.actorAgency?.name, event.title].filter(Boolean).join(" — "),
        180,
      ),
      text,
      documentId: event.trace?.sourceDocumentId ?? null,
      sourceRevisionId: event.trace?.sourceRevisionId ?? null,
      documentRevisionId: event.trace?.documentRevisionId ?? null,
      pipelineConfigId: event.trace?.pipelineConfigId ?? null,
      confidence: event.trace?.confidence ?? null,
    });
  }

  for (const gap of gaps as any[]) {
    const text = compact(
      [gap.summary, gap.trace?.evidenceText].filter(Boolean).join("\n"),
      2200,
    );
    if (!text) continue;
    cards.push({
      evidenceId: `gap:${gap.id}`,
      kind: "gap",
      title: compact(
        [gap.issue?.title, gap.primaryAgency?.name, gap.secondaryAgency?.name, "gap"]
          .filter(Boolean)
          .join(" — "),
        180,
      ),
      text,
      documentId: gap.trace?.sourceDocumentId ?? null,
      sourceRevisionId: gap.trace?.sourceRevisionId ?? null,
      documentRevisionId: gap.trace?.documentRevisionId ?? null,
      pipelineConfigId: gap.trace?.pipelineConfigId ?? null,
      confidence: gap.trace?.confidence ?? null,
    });
  }

  for (const relation of relations as any[]) {
    const text = compact(
      [
        relation.relationType,
        relation.rationale,
        relation.fromClaim?.claimText,
        relation.toClaim?.claimText,
        relation.trace?.evidenceText,
      ]
        .filter(Boolean)
        .join("\n"),
      2400,
    );
    if (!text) continue;
    cards.push({
      evidenceId: `relation:${relation.id}`,
      kind: "relation",
      title: compact(
        [
          relation.issue?.title,
          relation.fromAgency?.name,
          relation.toAgency?.name,
          relation.relationType,
        ]
          .filter(Boolean)
          .join(" — "),
        180,
      ),
      text,
      documentId: relation.trace?.sourceDocumentId ?? null,
      sourceRevisionId: relation.trace?.sourceRevisionId ?? null,
      documentRevisionId: relation.trace?.documentRevisionId ?? null,
      pipelineConfigId: relation.trace?.pipelineConfigId ?? null,
      confidence: relation.trace?.confidence ?? null,
    });
  }

  for (const trace of traces as any[]) {
    const text = compact(trace.evidenceText, 2200);
    if (!text) continue;
    cards.push({
      evidenceId: `trace:${trace.id}`,
      kind: "trace",
      title: `Extraction trace ${trace.id}`,
      text,
      documentId: trace.sourceDocumentId ?? null,
      sourceRevisionId: trace.sourceRevisionId ?? null,
      documentRevisionId: trace.documentRevisionId ?? null,
      pipelineConfigId: trace.pipelineConfigId ?? null,
      confidence: trace.confidence ?? null,
    });
  }

  const seen = new Set<string>();
  const uniqueCards = cards.filter((card) => {
    const key = `${card.evidenceId}:${card.text.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueCards
    .map((card) => ({ card, score: evidenceScore(card, keywords, rankByDoc) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.card)
    .slice(0, p.maxCards ?? 32);
}

async function maybeRerankEvidenceWithAssistModel(p: {
  question: string;
  cards: EvidenceCard[];
  finalLimit: number;
  signal?: AbortSignal;
}) {
  if (p.cards.length <= p.finalLimit) return p.cards;
  if (!env.OPENAI_ENABLED) return p.cards.slice(0, p.finalLimit);

  const items = p.cards
    .slice(0, 48)
    .map((card, index) =>
      [
        `#${index + 1}`,
        `EVIDENCE_ID: ${card.evidenceId}`,
        `KIND: ${card.kind}`,
        `TITLE: ${card.title}`,
        `TEXT: ${card.text.slice(0, 700)}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  try {
    const resp = await openaiClient().responses.parse(
      {
        model: modelForAssist(),
        input: [
          {
            role: "system" as const,
            content:
              "You are a strict evidence reranker. Return only evidence IDs that directly help answer the user question. Prefer legally/governance-relevant facts and contradiction evidence.",
          },
          {
            role: "user" as const,
            content: [`QUESTION:\n${p.question}`, "", "EVIDENCE:", items].join("\n"),
          },
        ],
        text: { format: zodTextFormat(RerankSchema, "governance_evidence_rerank") },
      } as any,
      p.signal ? { signal: p.signal } : undefined,
    );

    const parsed = resp.output_parsed as z.infer<typeof RerankSchema> | null;
    const byId = new Map(p.cards.map((card) => [card.evidenceId, card]));
    const ranked = (parsed?.evidenceIds ?? [])
      .map((id: string) => byId.get(id))
      .filter((card: EvidenceCard | undefined): card is EvidenceCard => Boolean(card));
    return uniq([...ranked, ...p.cards]).slice(0, p.finalLimit);
  } catch {
    return p.cards.slice(0, p.finalLimit);
  }
}

function formatEvidencePack(cards: EvidenceCard[]) {
  if (!cards.length) return "NO_GOVERNANCE_EVIDENCE_AVAILABLE";

  return cards
    .map((card, index) =>
      [
        `#${index + 1}`,
        `EVIDENCE_ID: ${card.evidenceId}`,
        `KIND: ${card.kind}`,
        `DOCUMENT_ID: ${card.documentId ?? "unknown"}`,
        `SOURCE: ${card.sourceLabel ?? card.title}`,
        `TITLE: ${card.title}`,
        "TEXT:",
        card.text,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function validateStructuredAnswer(
  raw: GovernanceAnswerStructured,
  allowedCards: EvidenceCard[],
  repaired: boolean,
) {
  const cardById = new Map(allowedCards.map((card) => [card.evidenceId, card]));
  let invalidCitationCount = 0;
  const droppedClaims: string[] = [];

  const validateOne = (citation: z.infer<typeof CitationSchema>): ValidatedCitation | null => {
    const card = cardById.get(String(citation.evidenceId || ""));
    if (!card) {
      invalidCitationCount += 1;
      return null;
    }
    const match = findVerbatimQuote(card.text, citation.quote);
    if (!match) {
      invalidCitationCount += 1;
      return null;
    }

    const charStart = card.charStart != null ? card.charStart + match.idx : card.charStart ?? null;
    const charEnd = charStart != null ? charStart + match.quote.length : card.charEnd ?? null;

    return {
      evidenceId: card.evidenceId,
      quote: match.quote,
      sourceKind: card.sourceKind ?? null,
      sourceLabel: card.sourceLabel ?? card.title ?? null,
      sourceUrl: card.sourceUrl ?? null,
      fileId: card.fileId ?? null,
      fileName: card.fileName ?? null,
      chunkId: card.chunkId ?? null,
      sourceId: card.sourceId ?? null,
      sourceRevisionId: card.sourceRevisionId ?? null,
      documentRevisionId: card.documentRevisionId ?? null,
      pipelineConfigId: card.pipelineConfigId ?? null,
      documentId: card.documentId ?? null,
      pageStart: card.pageStart ?? null,
      pageEnd: card.pageEnd ?? null,
      charStart,
      charEnd,
    };
  };

  const claimCitations = raw.claimCitations
    .map((group) => {
      const citations = group.citations.map(validateOne).filter(Boolean) as ValidatedCitation[];
      if (!citations.length) {
        droppedClaims.push(group.claim);
        return null;
      }
      return { claim: group.claim, citations };
    })
    .filter(Boolean) as Array<{ claim: string; citations: ValidatedCitation[] }>;

  const evidence = raw.evidence
    .map((item) => {
      const citations = item.citations.map(validateOne).filter(Boolean) as ValidatedCitation[];
      if (!citations.length) return null;
      return {
        evidenceId: item.evidenceId,
        title: item.title,
        summary: item.summary,
        citations,
      };
    })
    .filter(Boolean) as Array<{ evidenceId: string; title: string; summary: string; citations: ValidatedCitation[] }>;

  const caveats = raw.caveats.map((item) => {
    const citations = (item.citations ?? []).map(validateOne).filter(Boolean) as ValidatedCitation[];
    return {
      kind: item.kind,
      text: item.text,
      ...(citations.length ? { citations } : {}),
    };
  });

  const validCitationCount = flattenValidCitations(claimCitations).length;
  const status: ValidationReport["status"] =
    validCitationCount > 0 && invalidCitationCount === 0
      ? "verified"
      : validCitationCount > 0
        ? "partially_supported"
        : "unsupported";

  return {
    structured: {
      ...raw,
      claimCitations,
      evidence,
      caveats,
    },
    validation: {
      status,
      validCitationCount,
      invalidCitationCount,
      repaired,
      droppedClaims,
    } satisfies ValidationReport,
  };
}

async function generateAnswerOnce(p: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  evidencePack: string;
  evidenceCards: EvidenceCard[];
  model: string;
  previousResponseId?: string | null;
  repairFrom?: GovernanceAnswerStructured | null;
  signal?: AbortSignal;
}) {
  const allowedIds = p.evidenceCards.map((card) => card.evidenceId).join(", ");
  const system = [
    "You are the Governance Workspace answer synthesizer.",
    "Answer only from the supplied GOVERNANCE_EVIDENCE. Conversation history is context, not evidence.",
    "Do not use outside knowledge for factual claims. If evidence is weak or missing, say so.",
    "Every factual claim in the answer must appear in claimCitations with at least one citation.",
    "Each citation must use an allowed evidenceId and quote a verbatim substring from that evidence TEXT.",
    "Allowed general suggestions are permitted only inside caveats with kind=suggestion, clearly labeled as not directly established by evidence.",
    "Return only JSON matching the schema.",
  ].join("\n");

  const user = [
    `QUESTION:\n${p.question}`,
    "",
    `ALLOWED_EVIDENCE_IDS:\n${allowedIds}`,
    "",
    "GOVERNANCE_EVIDENCE:",
    p.evidencePack,
    "",
    p.repairFrom
      ? [
          "The previous structured answer had invalid or weak citations.",
          "Repair it by removing unsupported factual claims or moving non-evidentiary guidance into caveats/suggestions.",
          "PREVIOUS_JSON:",
          JSON.stringify(p.repairFrom),
        ].join("\n")
      : "Produce a direct answer, claim-level citations, evidence cards, caveats, openQuestions, and 3-6 suggestedFollowUps.",
  ].join("\n");

  const input = [
    { role: "system" as const, content: system },
    ...p.history.slice(-10).map((item) => ({ role: item.role, content: item.content })),
    { role: "user" as const, content: user },
  ];

  const resp = await openaiClient().responses.parse(
    {
      model: p.model,
      previous_response_id: p.previousResponseId ?? undefined,
      input,
      text: { format: zodTextFormat(GovernanceAnswerSchema, "governance_answer") },
    } as any,
    p.signal ? { signal: p.signal } : undefined,
  );

  if (!resp.output_parsed) {
    throw new Error("OpenAI did not return a valid structured governance answer.");
  }

  return {
    responseId: (resp as any)?.id ?? null,
    answer: resp.output_parsed as GovernanceAnswerStructured,
  };
}

function unsupportedFallback(question: string): GovernanceAnswerStructured {
  return {
    answer:
      `I could not verify an evidence-backed answer to “${question}” from the retrieved governance evidence. ` +
      "The safest next step is to inspect the retrieved candidate documents and ask a narrower question tied to a specific record, agency, or date.",
    claimCitations: [],
    evidence: [],
    caveats: [
      {
        kind: "limitation",
        text: "No factual answer is provided because the available evidence did not pass citation validation.",
      },
    ],
    openQuestions: [
      "Which record states the unit is restricted?",
      "Which record states the unit is permitted?",
      "Do the records refer to the same unit, date range, activity, and agency?",
    ],
    suggestedFollowUps: [
      "Show the contradiction evidence only",
      "Compare the two strongest records",
      "List missing checks before concluding",
    ],
  };
}

function buildRetrievalMetadata(evidenceResponse: any, evidenceCards: EvidenceCard[]) {
  return {
    promptVersion: GOVERNANCE_ANSWER_PROMPT_VERSION,
    workflow: evidenceResponse?.workflow ?? null,
    queryUnderstanding: evidenceResponse?.queryUnderstanding ?? null,
    retrievalDecision: evidenceResponse?.retrievalDecision ?? null,
    totalCandidates: evidenceResponse?.totalCandidates ?? 0,
    evidenceCardCount: evidenceCards.length,
    contradictionSummary: evidenceResponse?.contradictionFoundation?.summary ?? null,
    questionReviewSummary: evidenceResponse?.questionReviewSurface?.summary ?? null,
  };
}

export async function runGovernanceWorkspaceAnswer(input: GovernanceAnswerInput): Promise<any> {
  const question = normalizeQuestion(input.question);
  if (!question) {
    const err: any = new Error("Question is required.");
    err.status = 400;
    throw err;
  }

  const startedAtMs = Date.now();
  const anchorDocumentIds = safeStringArray(input.anchorDocumentIds);
  const anchorUrlIds = safeNumberArray(input.anchorUrlIds);
  const sourceScope = normalizeScope(input.sourceScope);
  const requestedWorkflowMode = normalizeWorkflow(input.workflowMode);
  const model = modelForAnswer(input.deepReview);
  const assistModel = modelForAssist();

  const sessionId = await ensureSession({
    sessionId: input.sessionId ?? null,
    question,
    createdBy: input.createdBy ?? null,
    requestId: input.requestId ?? null,
    anchorDocumentIds,
    anchorUrlIds,
    sourceScope,
    requestedWorkflowMode,
    selectedIssueId: input.selectedIssueId ?? null,
    selectedAgencyId: input.selectedAgencyId ?? null,
  });

  const previousResponseId =
    input.previousResponseId ?? (await previousResponseIdFromRun(input.previousRunId));

  const runId = await insertRun({
    sessionId,
    question,
    model,
    assistModel,
    previousRunId: input.previousRunId ?? null,
    previousResponseId: previousResponseId ?? null,
    createdBy: input.createdBy ?? null,
    requestId: input.requestId ?? null,
    anchorDocumentIds,
    anchorUrlIds,
    sourceScope,
    requestedWorkflowMode,
    selectedIssueId: input.selectedIssueId ?? null,
    selectedAgencyId: input.selectedAgencyId ?? null,
  });

  await input.onStreamEvent?.({ type: "run", runId, sessionId });

  let retrievalMetadata: unknown = null;

  try {
    if (!env.OPENAI_ENABLED) {
      const err: any = new Error("Answer generation is disabled. Set OPENAI_ENABLED=true and configure OPENAI_API_KEY to enable governance answers.");
      err.status = 503;
      throw err;
    }

    await input.onStreamEvent?.({ type: "status", message: "Retrieving evidence" });
    const evidenceResponse = await queryGovernanceWorkspaceEvidence({
      question,
      anchorDocumentIds,
      anchorUrlIds,
      sourceScope,
      workflowMode: requestedWorkflowMode,
      limit: Math.max(10, Math.min(12, Number(input.limit ?? 12))),
    });

    const candidateDocumentIds = uniq(
      ((evidenceResponse as any)?.candidates ?? []).flatMap((candidate: any) =>
        Array.isArray(candidate.clusterDocumentIds) && candidate.clusterDocumentIds.length
          ? candidate.clusterDocumentIds
          : [candidate.documentId],
      ),
    ).filter(Boolean) as string[];

    await input.onStreamEvent?.({
      type: "status",
      message: candidateDocumentIds.length
        ? `Loading source chunks and graph evidence from ${candidateDocumentIds.length} candidate documents`
        : "No candidate documents found",
    });

    const initialEvidenceCards = await loadEvidenceCards({
      question,
      candidateDocumentIds,
      maxCards: 44,
    });

    await input.onStreamEvent?.({ type: "status", message: "Ranking evidence" });
    const evidenceCards = await maybeRerankEvidenceWithAssistModel({
      question,
      cards: initialEvidenceCards,
      finalLimit: 26,
      signal: input.signal,
    });

    retrievalMetadata = buildRetrievalMetadata(evidenceResponse, evidenceCards);

    if (!evidenceCards.length) {
      const fallback = unsupportedFallback(question);
      const validation: ValidationReport = {
        status: "unsupported",
        validCitationCount: 0,
        invalidCitationCount: 0,
        repaired: false,
        droppedClaims: [],
      };
      const latencyMs = await completeRun({
        runId,
        startedAtMs,
        resolvedWorkflowMode: (evidenceResponse as any)?.workflow?.resolvedMode ?? null,
        answer: fallback,
        claimCitations: [],
        evidence: [],
        caveats: fallback.caveats,
        citations: [],
        candidateDocumentIds,
        finalEvidenceChunkIds: [],
        sourceRevisionIds: [],
        documentRevisionIds: [],
        pipelineConfigIds: [],
        retrievalMetadata,
        validation,
      });

      return {
        sessionId,
        run: {
          id: runId,
          status: "SUCCEEDED",
          question,
          answer: fallback.answer,
          citations: [],
          evidence: [],
          caveats: fallback.caveats,
          openQuestions: fallback.openQuestions,
          suggestedFollowUps: fallback.suggestedFollowUps,
          model,
          assistModel,
          groundingStatus: validation.status,
          validation,
          latencyMs,
        },
      };
    }

    await input.onStreamEvent?.({ type: "status", message: "Composing answer" });
    const evidencePack = formatEvidencePack(evidenceCards);
    const first = await generateAnswerOnce({
      question,
      history: input.history ?? [],
      evidencePack,
      evidenceCards,
      model,
      previousResponseId,
      signal: input.signal,
    });

    await input.onStreamEvent?.({ type: "status", message: "Validating citations" });
    let validated = validateStructuredAnswer(first.answer, evidenceCards, false);
    let openaiResponseId = first.responseId;

    if (validated.validation.invalidCitationCount > 0 || validated.validation.status === "unsupported") {
      await input.onStreamEvent?.({ type: "status", message: "Repairing citations" });
      const repaired = await generateAnswerOnce({
        question,
        history: input.history ?? [],
        evidencePack,
        evidenceCards,
        model,
        previousResponseId: openaiResponseId ?? previousResponseId,
        repairFrom: first.answer,
        signal: input.signal,
      });
      openaiResponseId = repaired.responseId ?? openaiResponseId;
      validated = validateStructuredAnswer(repaired.answer, evidenceCards, true);
    }

    const finalAnswer =
      validated.validation.status === "unsupported"
        ? unsupportedFallback(question)
        : (validated.structured as unknown as GovernanceAnswerStructured);

    if (validated.validation.status === "unsupported") {
      validated = validateStructuredAnswer(finalAnswer, evidenceCards, validated.validation.repaired);
    }

    const claimCitations = (validated.structured as any).claimCitations ?? [];
    const evidence = (validated.structured as any).evidence ?? [];
    const caveats = (validated.structured as any).caveats ?? [];
    const citations = flattenValidCitations(claimCitations);

    const finalEvidenceChunkIds = uniq(
      citations.map((citation) => citation.chunkId).filter(Boolean) as string[],
    );
    const sourceRevisionIds = uniq(
      citations.map((citation) => citation.sourceRevisionId).filter(Boolean) as string[],
    );
    const documentRevisionIds = uniq(
      citations.map((citation) => citation.documentRevisionId).filter(Boolean) as string[],
    );
    const pipelineConfigIds = uniq(
      citations.map((citation) => citation.pipelineConfigId).filter(Boolean) as string[],
    );

    await input.onStreamEvent?.({ type: "status", message: "Saving answer" });
    const latencyMs = await completeRun({
      runId,
      startedAtMs,
      openaiResponseId,
      resolvedWorkflowMode: (evidenceResponse as any)?.workflow?.resolvedMode ?? null,
      answer: finalAnswer,
      claimCitations,
      evidence,
      caveats,
      citations,
      candidateDocumentIds,
      finalEvidenceChunkIds,
      sourceRevisionIds,
      documentRevisionIds,
      pipelineConfigIds,
      retrievalMetadata,
      validation: validated.validation,
    });

    const result = {
      sessionId,
      run: {
        id: runId,
        status: "SUCCEEDED",
        question,
        answer: finalAnswer.answer,
        claimCitations,
        citations,
        evidence,
        caveats,
        openQuestions: finalAnswer.openQuestions,
        suggestedFollowUps: finalAnswer.suggestedFollowUps,
        model,
        assistModel,
        openaiResponseId,
        groundingStatus: validated.validation.status,
        validation: validated.validation,
        candidateDocumentIds,
        finalEvidenceChunkIds,
        retrievalMetadata,
        latencyMs,
      },
    };

    if (input.onStreamEvent) {
      const answerText = finalAnswer.answer ?? "";
      for (let i = 0; i < answerText.length; i += 24) {
        if (input.signal?.aborted) break;
        await input.onStreamEvent({ type: "delta", text: answerText.slice(i, i + 24) });
      }
    }

    return result;
  } catch (error) {
    await failRun({ runId, startedAtMs, error, retrievalMetadata });
    throw error;
  }
}
