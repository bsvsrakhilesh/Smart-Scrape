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
  officerFilters?: GovernanceAnswerOfficerFilters | null;
  selectedIssueId?: string | null;
  selectedAgencyId?: string | null;
  selectedDocumentIds?: string[];
  deepReview?: boolean;
  requestId?: string | null;
  createdBy?: string | null;
  collectorPurposeId?: string | null;
  ownerId?: string | null;
  signal?: AbortSignal;
  onStreamEvent?: GovernanceAnswerStreamEmit;
};

type GovernanceAnswerOfficerFilters = {
  questionType?: string | null;
  issueHint?: string | null;
  jurisdiction?: string | null;
  timeRange?: string | null;
  pollutants?: string[];
  agencies?: string[];
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
  supportedClaimCount: number;
  citationCount: number;
  evidenceCardCount: number;
  droppedClaimCount: number;
  qualityBand: "strong" | "usable" | "thin" | "unsafe";
  recommendedAction: "use" | "inspect" | "deep_review" | "broaden_evidence";
};

export function buildGovernanceAnswerQualitySummary(p: {
  status: ValidationReport["status"];
  validCitationCount: number;
  invalidCitationCount: number;
  repaired: boolean;
  droppedClaims?: string[] | null;
  supportedClaimCount: number;
  evidenceCardCount: number;
}) {
  const citationCount = Math.max(0, p.validCitationCount);
  const invalidCitationCount = Math.max(0, p.invalidCitationCount);
  const supportedClaimCount = Math.max(0, p.supportedClaimCount);
  const evidenceCardCount = Math.max(0, p.evidenceCardCount);
  const droppedClaimCount = Math.max(0, p.droppedClaims?.length ?? 0);

  let qualityBand: ValidationReport["qualityBand"];
  if (p.status === "unsupported" || citationCount === 0) {
    qualityBand = "unsafe";
  } else if (
    p.status === "verified" &&
    invalidCitationCount === 0 &&
    droppedClaimCount === 0
  ) {
    qualityBand = "strong";
  } else if (supportedClaimCount >= 2 && citationCount >= 2 && evidenceCardCount >= 1) {
    qualityBand = "usable";
  } else {
    qualityBand = "thin";
  }

  const recommendedAction: ValidationReport["recommendedAction"] =
    qualityBand === "strong"
      ? "use"
      : qualityBand === "usable"
        ? "inspect"
        : qualityBand === "thin"
          ? "deep_review"
          : "broaden_evidence";

  return {
    supportedClaimCount,
    citationCount,
    evidenceCardCount,
    droppedClaimCount,
    invalidCitationCount,
    repaired: p.repaired,
    qualityBand,
    recommendedAction,
  };
}

const GOVERNANCE_ANSWER_PROMPT_VERSION = "air-quality-governance-answer-v3";

type AirQualityOfficerQueryType =
  | "quick_answer"
  | "official_source_review"
  | "agency_responsibility"
  | "case_timeline"
  | "contradiction_brief"
  | "enforcement_gap_review"
  | "policy_order_comparison"
  | "field_action_prep";

type AirQualityQueryProfile = {
  domain: "air_quality_governance";
  queryType: AirQualityOfficerQueryType;
  jurisdiction: string | null;
  agencies: string[];
  pollutants: string[];
  sectors: string[];
  orderTypes: string[];
  enforcementSignals: string[];
  timeRange: string | null;
  sourcePriorities: string[];
  generationStages: string[];
};

type MultiStepResearchStep = {
  id: string;
  label: string;
  question: string;
  purpose: string;
};

type MultiStepResearchResult = {
  enabled: boolean;
  rationale: string;
  steps: Array<
    MultiStepResearchStep & {
      candidateCount: number;
      documentIds: string[];
      topSources: Array<{
        documentId: string | null;
        title: string;
        sourceLabel: string | null;
        matchScore: number | null;
        whyRanked: string[];
      }>;
      retrievalDecision: unknown;
      queryUnderstanding: unknown;
      coverageFamilies: string[];
      retrievalLanes: string[];
    }
  >;
};

type GraphRagSummary = {
  active: boolean;
  summary: {
    graphCandidateCount: number;
    relationLaneCount: number;
    contradictionCount: number;
    overrideChainCount: number;
    comparisonCount: number;
    caseTrailEventCount: number;
    actorCount: number;
    openQuestionCount: number;
  };
  relationshipPaths: Array<{
    id: string;
    kind: "comparison" | "override_chain" | "case_trail" | "actor_signal";
    label: string;
    detail: string;
    documentIds: string[];
    relationTypes: string[];
    issueTitle?: string | null;
    actorName?: string | null;
  }>;
  officerWarnings: string[];
};

const AIR_QUALITY_POLLUTANT_PATTERNS: Array<[RegExp, string]> = [
  [/\bpm\s*2\.?5\b|\bpm2\.?5\b/i, "PM2.5"],
  [/\bpm\s*10\b|\bpm10\b/i, "PM10"],
  [/\baqi\b/i, "AQI"],
  [/\bnox?\b|\bnitrogen oxides?\b/i, "NOx"],
  [/\bso2\b|\bsulphur dioxide\b|\bsulfur dioxide\b/i, "SO2"],
  [/\bozone\b|\bo3\b/i, "Ozone"],
  [/\bco\b|\bcarbon monoxide\b/i, "CO"],
];

const AIR_QUALITY_AGENCY_PATTERNS: Array<[RegExp, string]> = [
  [/\bcpcb\b|central pollution control board/i, "CPCB"],
  [/\bspcb\b|state pollution control board/i, "SPCB"],
  [/\bdpcc\b|delhi pollution control committee/i, "DPCC"],
  [/\bcaqm\b|commission for air quality management/i, "CAQM"],
  [/\bmoefcc\b|environment ministry|ministry of environment/i, "MoEFCC"],
  [/\bngt\b|national green tribunal/i, "NGT"],
  [/\bsupreme court\b|\bhigh court\b|\bcourt\b/i, "Court"],
  [/\bmunicipal\b|\bmunicipality\b|\bmc\b|\bmcd\b/i, "Municipal body"],
  [/\bdistrict magistrate\b|\bdm\b|\bdistrict administration\b/i, "District administration"],
];

const AIR_QUALITY_SECTOR_PATTERNS: Array<[RegExp, string]> = [
  [/\bconstruction\b|\bdust\b|\bc&d\b/i, "Construction and dust"],
  [/\bindustr(y|ial)\b|\bfactory\b|\bplant\b/i, "Industry"],
  [/\btransport\b|\bvehicle\b|\bdiesel\b|\btraffic\b/i, "Transport"],
  [/\bstubble\b|\bcrop residue\b|\bburning\b/i, "Stubble or open burning"],
  [/\bthermal\b|\bpower plant\b|\bcoal\b/i, "Power generation"],
  [/\bwaste\b|\blandfill\b|\bgarbage\b/i, "Waste management"],
];

const AIR_QUALITY_ORDER_PATTERNS: Array<[RegExp, string]> = [
  [/\bgrap\b/i, "GRAP"],
  [/\bshow[-\s]?cause\b/i, "Show-cause notice"],
  [/\bclosure\b|\bclose(d|ure)? direction\b/i, "Closure direction"],
  [/\bdirection\b|\border\b|\bnotification\b|\bcircular\b/i, "Direction/order"],
  [/\baction plan\b|\bclean air action plan\b|\bncap\b/i, "Action plan"],
  [/\binspection\b|\bsite visit\b/i, "Inspection record"],
  [/\bcompliance report\b|\bstatus report\b/i, "Compliance/status report"],
];

const OFFICIAL_SOURCE_PATTERNS = [
  /\b(cpcb|spcb|dpcc|caqm|moefcc|ngt|tribunal|court|commission|authority|ministry|municipal|gov|nic\.in)\b/i,
  /\.(gov|nic)\.in\b/i,
];

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

const OfficerFindingSchema = z.object({
  title: z.string().min(3).max(160),
  finding: z.string().min(8).max(900),
  citations: z.array(CitationSchema).min(1).max(6),
});

const ConfidenceSchema = z.object({
  level: z.enum(["high", "medium", "low"]),
  rationale: z.string().min(8).max(700),
  evidenceCoverage: z.enum(["strong", "adequate", "thin", "missing"]),
});

const GovernanceAnswerSchema = z.object({
  queryType: z
    .enum([
      "quick_answer",
      "official_source_review",
      "agency_responsibility",
      "case_timeline",
      "contradiction_brief",
      "enforcement_gap_review",
      "policy_order_comparison",
      "field_action_prep",
    ])
    .describe("Officer workflow chosen for this answer."),
  jurisdiction: z.string().nullable().describe("Detected jurisdiction or location, if evidence supports one."),
  agencies: z.array(z.string().min(1).max(120)).max(12),
  pollutants: z.array(z.string().min(1).max(60)).max(12),
  timeRange: z.string().nullable(),
  summary: z.string().min(1).max(1200),
  findings: z.array(OfficerFindingSchema).max(10),
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
  conflicts: z.array(OfficerFindingSchema).max(8),
  evidenceGaps: z.array(z.string().min(1).max(500)).max(10),
  recommendedNextSteps: z.array(z.string().min(1).max(320)).max(8),
  confidence: ConfidenceSchema,
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
  collectorPurposeId: string | null;
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
  collectorPurposeId: string | null;
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

type GovernanceAnswerSessionSummaryRow = GovernanceAnswerSessionRow & {
  runCount: bigint | number | null;
  latestRunId: string | null;
  latestRunStatus: string | null;
  latestRunQuestion: string | null;
  latestRunCreatedAt: Date | null;
  latestGroundingStatus: string | null;
  latestValidation: unknown;
};

type GovernanceAnswerFeedbackInput = {
  runId: string;
  rating: "useful" | "wrong_citation" | "missing_source" | "hallucinated_claim" | "needs_deeper_review";
  target?: "answer" | "claim" | "citation" | "evidence" | null;
  claim?: string | null;
  evidenceId?: string | null;
  citationQuote?: string | null;
  comment?: string | null;
  requestId?: string | null;
  createdBy?: string | null;
};

type GovernanceAnswerEvaluation = {
  runId: string;
  status: string;
  qualityBand: string;
  recommendedAction: string;
  scores: {
    retrieval: number;
    citation: number;
    coverage: number;
    conflict: number;
    overall: number;
  };
  checks: Array<{
    key: string;
    label: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }>;
  officerFeedbackCount: number;
  updatedAt: string;
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

function maxOutputTokensForAnswer(deepReview?: boolean) {
  return deepReview
    ? env.GOVERNANCE_DEEP_REVIEW_MAX_OUTPUT_TOKENS
    : env.GOVERNANCE_ANSWER_MAX_OUTPUT_TOKENS;
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

function collectPatternMatches(
  text: string,
  patterns: Array<[RegExp, string]>,
) {
  return uniq(
    patterns
      .filter(([pattern]) => pattern.test(text))
      .map(([, label]) => label),
  );
}

function detectJurisdiction(question: string) {
  const text = question.replace(/\s+/g, " ").trim();
  const hints = [
    /\b(delhi ncr|ncr|delhi|faridabad|gurugram|gurgaon|noida|ghaziabad|bhiwadi|sonipat|panipat|haryana|punjab|uttar pradesh|rajasthan)\b/i,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:district|city|state|airshed)\b/,
  ];

  for (const pattern of hints) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function detectTimeRange(question: string) {
  const text = question.replace(/\s+/g, " ").trim();
  const range = /\b(20\d{2})(?:\s*(?:-|to|through)\s*(20\d{2}))?\b/i.exec(text);
  if (range?.[1]) return range[2] ? `${range[1]}-${range[2]}` : range[1];
  const phrase =
    /\b(last\s+\d+\s+(?:days|weeks|months|years)|last\s+year|this\s+year|current|recent|today|yesterday)\b/i.exec(
      text,
    );
  return phrase?.[1] ?? null;
}

function inferOfficerQueryType(question: string): AirQualityOfficerQueryType {
  const q = question.toLowerCase();
  if (/\b(compare|changed|difference|amendment|versus|vs\.?)\b/.test(q)) {
    return "policy_order_comparison";
  }
  if (/\b(conflict|contradict|override|inconsistent|tension)\b/.test(q)) {
    return "contradiction_brief";
  }
  if (/\b(timeline|chronology|sequence|when did|case trail)\b/.test(q)) {
    return "case_timeline";
  }
  if (/\b(who|which agency|responsib|mandate|jurisdiction|coordinate)\b/.test(q)) {
    return "agency_responsibility";
  }
  if (/\b(gap|missing|failure|not complied|non[-\s]?compliance|enforcement)\b/.test(q)) {
    return "enforcement_gap_review";
  }
  if (/\b(order|notice|direction|notification|official source|source supports|citation)\b/.test(q)) {
    return "official_source_review";
  }
  if (/\b(inspect|field|site visit|prepare|check before|action)\b/.test(q)) {
    return "field_action_prep";
  }
  return "quick_answer";
}

function normalizeAnswerOfficerFilters(
  filters: GovernanceAnswerInput["officerFilters"],
): GovernanceAnswerOfficerFilters {
  if (!filters || typeof filters !== "object") return {};
  return {
    questionType: String(filters.questionType ?? "").trim() || null,
    issueHint: String(filters.issueHint ?? "").trim() || null,
    jurisdiction: String(filters.jurisdiction ?? "").trim() || null,
    timeRange: String(filters.timeRange ?? "").trim() || null,
    pollutants: safeStringArray(filters.pollutants).slice(0, 8),
    agencies: safeStringArray(filters.agencies).slice(0, 8),
  };
}

export function buildAirQualityQueryProfile(
  question: string,
  filters?: GovernanceAnswerOfficerFilters | null,
): AirQualityQueryProfile {
  const text = question.toLowerCase();
  const queryType = inferOfficerQueryType(question);
  const officerFilters = normalizeAnswerOfficerFilters(filters);
  const filterText = [
    officerFilters.questionType,
    officerFilters.issueHint,
    officerFilters.jurisdiction,
    officerFilters.timeRange,
    ...(officerFilters.pollutants ?? []),
    ...(officerFilters.agencies ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const profileText = [question, filterText].filter(Boolean).join("\n");
  const pollutants = uniq([
    ...collectPatternMatches(profileText, AIR_QUALITY_POLLUTANT_PATTERNS),
    ...(officerFilters.pollutants ?? []),
  ]);
  const agencies = uniq([
    ...collectPatternMatches(profileText, AIR_QUALITY_AGENCY_PATTERNS),
    ...(officerFilters.agencies ?? []),
  ]);
  const sectors = collectPatternMatches(question, AIR_QUALITY_SECTOR_PATTERNS);
  const orderTypes = collectPatternMatches(question, AIR_QUALITY_ORDER_PATTERNS);
  const enforcementSignals = collectPatternMatches(question, [
    [/\bviolation\b|\bnon[-\s]?compliance\b/i, "Violation/non-compliance"],
    [/\bpenalty\b|\bfine\b|\bprosecution\b/i, "Penalty/prosecution"],
    [/\bclosure\b|\bsealing\b|\bshut\b/i, "Closure/sealing"],
    [/\binspection\b|\bsite visit\b/i, "Inspection"],
    [/\bfollow[-\s]?up\b|\bstatus report\b/i, "Follow-up/status"],
  ]);

  const sourcePriorities = uniq([
    "Official orders and directions",
    "Court/tribunal records",
    "Inspection, compliance, and status reports",
    "Agency mandates and responsibility statements",
    queryType === "contradiction_brief" ? "Conflicting or override evidence" : "",
    text.includes("grap") ? "GRAP-stage evidence" : "",
  ].filter(Boolean));

  return {
    domain: "air_quality_governance",
    queryType,
    jurisdiction: officerFilters.jurisdiction || detectJurisdiction(question),
    agencies,
    pollutants,
    sectors,
    orderTypes,
    enforcementSignals,
    timeRange: officerFilters.timeRange || detectTimeRange(question),
    sourcePriorities,
    generationStages: [
      "understand_air_quality_question",
      "retrieve_hybrid_governance_evidence",
      "rank_official_sources",
      "validate_claim_citations",
      "draft_officer_brief",
    ],
  };
}

function officialSourceScore(text: string) {
  return OFFICIAL_SOURCE_PATTERNS.some((pattern) => pattern.test(text)) ? 10 : 0;
}

function airQualityDomainScore(text: string, profile: AirQualityQueryProfile) {
  const haystack = text.toLowerCase();
  let score = officialSourceScore(haystack);
  for (const token of [
    "aqi",
    "pm2.5",
    "pm10",
    "grap",
    "emission",
    "dust",
    "stubble",
    "inspection",
    "show-cause",
    "closure",
    "action plan",
    "compliance report",
  ]) {
    if (haystack.includes(token)) score += 2;
  }
  for (const value of [
    ...profile.pollutants,
    ...profile.agencies,
    ...profile.sectors,
    ...profile.orderTypes,
    ...profile.enforcementSignals,
  ]) {
    if (value && haystack.includes(value.toLowerCase())) score += 4;
  }
  if (profile.jurisdiction && haystack.includes(profile.jurisdiction.toLowerCase())) {
    score += 5;
  }
  return score;
}

function incrementCount(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapCounts(map: Map<string, number>) {
  return Object.fromEntries(
    Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

function buildAnswerRetrievalTraceSummary(args: {
  evidenceResponse: any;
  evidenceCards: EvidenceCard[];
  selectedDocumentIds: string[];
  profile: AirQualityQueryProfile;
}) {
  const candidates = Array.isArray(args.evidenceResponse?.candidates)
    ? args.evidenceResponse.candidates
    : [];
  const selectedDocumentSet = new Set(args.selectedDocumentIds);
  const laneCounts = new Map<string, number>();
  const coverageCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();
  let officialSourceCandidateCount = 0;

  for (const candidate of candidates) {
    for (const lane of candidate.retrievalLanes ?? []) incrementCount(laneCounts, lane);
    for (const family of candidate.coverageFamilies ?? []) {
      incrementCount(coverageCounts, family);
    }
    for (const reason of candidate.whyRanked ?? []) incrementCount(reasonCounts, reason);
    const officialCue = officialSourceScore(
      `${candidate.title ?? ""} ${candidate.sourceLabel ?? ""}`,
    );
    if (officialCue > 0) officialSourceCandidateCount += 1;
  }

  const selectedEvidence = args.evidenceCards.slice(0, 18).map((card) => ({
    evidenceId: card.evidenceId,
    kind: card.kind,
    documentId: card.documentId,
    title: card.title,
    sourceLabel: card.sourceLabel ?? card.title,
    officialSource: officialSourceScore(
      `${card.title} ${card.sourceLabel ?? ""} ${card.sourceUrl ?? ""}`,
    ) > 0,
    airQualityScore: airQualityDomainScore(`${card.title}\n${card.text}`, args.profile),
  }));

  return {
    candidateCount: candidates.length,
    selectedDocumentCount: selectedDocumentSet.size,
    selectedEvidenceCardCount: args.evidenceCards.length,
    officialSourceCandidateCount,
    officialSourceEvidenceCount: selectedEvidence.filter((item) => item.officialSource).length,
    laneCounts: mapCounts(laneCounts),
    coverageCounts: mapCounts(coverageCounts),
    topReasons: Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
    selectedEvidence,
  };
}

export function buildGraphRagSummary(evidenceResponse: any): GraphRagSummary {
  const candidates = Array.isArray(evidenceResponse?.candidates)
    ? evidenceResponse.candidates
    : [];
  const graphCandidates = candidates.filter((candidate: any) =>
    Array.isArray(candidate.coverageFamilies) &&
    candidate.coverageFamilies.includes("graph"),
  );
  const relationLaneCount = candidates.filter((candidate: any) =>
    Array.isArray(candidate.retrievalLanes) &&
    candidate.retrievalLanes.includes("relation_graph"),
  ).length;
  const contradictionFoundation = objectFrom(
    evidenceResponse?.contradictionFoundation,
  );
  const contradictionSummary = objectFrom(contradictionFoundation.summary);
  const overrideChainFoundation = objectFrom(
    evidenceResponse?.overrideChainFoundation,
  );
  const comparisonSurface = objectFrom(evidenceResponse?.comparisonSurface);
  const caseTrailFoundation = objectFrom(evidenceResponse?.caseTrailFoundation);
  const questionReviewSurface = objectFrom(
    evidenceResponse?.questionReviewSurface,
  );
  const comparisonItems = arrayFrom(comparisonSurface.comparisons);
  const overrideChains = arrayFrom(overrideChainFoundation.chains);
  const caseTrailEvents = arrayFrom(caseTrailFoundation.events);
  const actorInputs = arrayFrom(questionReviewSurface.actorInputs);
  const openQuestions = arrayFrom(questionReviewSurface.openQuestions);

  const comparisonPaths = comparisonItems.slice(0, 5).map((item: any) => ({
    id: String(item.comparisonKey ?? `comparison:${item.documentIds?.join(":")}`),
    kind: "comparison" as const,
    label: String(item.changeSummary ?? "Document relationship"),
    detail: String(
      item.strongestReason ??
        "Relationship pair assembled from contradiction or override evidence.",
    ),
    documentIds: safeStringArray(item.documentIds),
    relationTypes: safeStringArray(item.relationTypes),
    issueTitle: typeof item.issueTitle === "string" ? item.issueTitle : null,
  }));

  const overridePaths = overrideChains.slice(0, 4).map((chain: any) => ({
    id: String(chain.chainKey ?? `override:${chain.documentIds?.join(":")}`),
    kind: "override_chain" as const,
    label: String(chain.title ?? "Override or supersession chain"),
    detail: String(chain.basis ?? "Possible override chain detected."),
    documentIds: safeStringArray(chain.documentIds),
    relationTypes: ["OVERRIDE", "SUPERSEDES"].filter((type) =>
      JSON.stringify(chain).includes(type),
    ),
    issueTitle: typeof chain.issueTitle === "string" ? chain.issueTitle : null,
  }));

  const caseTrailPaths = caseTrailEvents.slice(0, 4).map((event: any) => ({
    id: String(event.eventId ?? `case-trail:${event.documentId ?? event.dateLabel}`),
    kind: "case_trail" as const,
    label: String(event.title ?? event.dateLabel ?? "Case trail event"),
    detail: String(event.detail ?? event.reason ?? "Chronology graph event."),
    documentIds: safeStringArray(event.documentIds ?? [event.documentId]),
    relationTypes: [],
    issueTitle: typeof event.issueTitle === "string" ? event.issueTitle : null,
  }));

  const actorPaths = actorInputs.slice(0, 4).map((actor: any) => ({
    id: `actor:${String(actor.actorName ?? "unknown")}`,
    kind: "actor_signal" as const,
    label: String(actor.actorName ?? "Unattributed institution"),
    detail: String(
      actor.strongestSignal?.detail ??
        actor.role ??
        "Actor signal assembled from graph evidence.",
    ),
    documentIds: safeStringArray(actor.strongestSignal?.documentIds),
    relationTypes: [],
    actorName: typeof actor.actorName === "string" ? actor.actorName : null,
  }));

  const officerWarnings = [
    numberFrom(contradictionSummary.reviewCount, 0) > 0
      ? `${numberFrom(contradictionSummary.reviewCount)} graph relation(s) require analyst review.`
      : null,
    comparisonItems.length > 0
      ? "Comparison paths may indicate conflicts, scope changes, overrides, or supersession."
      : null,
    openQuestions.length > 0
      ? `${openQuestions.length} graph-informed open question(s) remain.`
      : null,
  ].filter((item): item is string => Boolean(item));

  const relationshipPaths = [
    ...comparisonPaths,
    ...overridePaths,
    ...caseTrailPaths,
    ...actorPaths,
  ].slice(0, 14);

  return {
    active:
      graphCandidates.length > 0 ||
      relationshipPaths.length > 0 ||
      numberFrom(contradictionSummary.contradictionCount, 0) > 0,
    summary: {
      graphCandidateCount: graphCandidates.length,
      relationLaneCount,
      contradictionCount: numberFrom(
        contradictionSummary.contradictionCount,
        0,
      ),
      overrideChainCount: overrideChains.length,
      comparisonCount: comparisonItems.length,
      caseTrailEventCount: caseTrailEvents.length,
      actorCount: actorInputs.length,
      openQuestionCount: openQuestions.length,
    },
    relationshipPaths,
    officerWarnings,
  };
}

export function buildMultiStepResearchPlan(args: {
  question: string;
  profile: AirQualityQueryProfile;
  deepReview?: boolean;
}): { enabled: boolean; rationale: string; steps: MultiStepResearchStep[] } {
  const steps: MultiStepResearchStep[] = [];
  const profile = args.profile;
  const baseContext = [
    profile.jurisdiction ? `in ${profile.jurisdiction}` : "",
    profile.pollutants.length ? `for ${profile.pollutants.join(", ")}` : "",
    profile.timeRange ? `during ${profile.timeRange}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const complex =
    args.deepReview ||
    args.question.length > 180 ||
    [
      "agency_responsibility",
      "case_timeline",
      "contradiction_brief",
      "enforcement_gap_review",
      "policy_order_comparison",
      "field_action_prep",
    ].includes(profile.queryType);

  if (!complex) {
    return {
      enabled: false,
      rationale:
        "The question is narrow enough for single-pass hybrid retrieval.",
      steps,
    };
  }

  if (
    profile.queryType === "agency_responsibility" ||
    /\b(who|agency|responsib|mandate|jurisdiction|coordinate)\b/i.test(args.question)
  ) {
    steps.push({
      id: "agency_responsibility",
      label: "Agency responsibility",
      purpose: "Identify mandates, responsible agencies, and coordination duties.",
      question: `Which agencies, mandates, and coordination duties are relevant ${baseContext || "to this air quality issue"}?`,
    });
  }

  if (
    profile.queryType === "case_timeline" ||
    /\b(timeline|chronology|sequence|since|between|when)\b/i.test(args.question)
  ) {
    steps.push({
      id: "timeline",
      label: "Timeline",
      purpose: "Retrieve dated orders, events, inspections, and status changes.",
      question: `What is the chronology of orders, inspections, actions, and status changes ${baseContext || "for this air quality issue"}?`,
    });
  }

  if (
    profile.queryType === "contradiction_brief" ||
    /\b(conflict|contradict|override|inconsistent|tension|supersede)\b/i.test(args.question)
  ) {
    steps.push({
      id: "conflicts",
      label: "Conflicts and overrides",
      purpose: "Find contradictions, tensions, overrides, and superseding directions.",
      question: `Which records conflict, override, reinforce, or supersede each other ${baseContext || "for this air quality issue"}?`,
    });
  }

  if (
    profile.queryType === "enforcement_gap_review" ||
    /\b(gap|missing|failure|non[-\s]?compliance|enforcement|follow[-\s]?up)\b/i.test(args.question)
  ) {
    steps.push({
      id: "gaps",
      label: "Enforcement gaps",
      purpose: "Identify missing follow-up, accountability, compliance, and evidence gaps.",
      question: `What enforcement, compliance, accountability, or evidence gaps are recorded ${baseContext || "for this air quality issue"}?`,
    });
  }

  if (
    profile.queryType === "policy_order_comparison" ||
    /\b(compare|changed|difference|amendment|order|notice|direction|action plan)\b/i.test(args.question)
  ) {
    steps.push({
      id: "orders",
      label: "Orders and policy comparison",
      purpose: "Retrieve official orders, notices, action plans, and changes between them.",
      question: `Which official orders, notices, directions, or action plans apply, and what changed between them ${baseContext || "for this air quality issue"}?`,
    });
  }

  if (!steps.length) {
    steps.push({
      id: "official_sources",
      label: "Official-source review",
      purpose: "Prioritize official-source records before synthesis.",
      question: `Which official-source records support the answer to: ${args.question}`,
    });
  }

  return {
    enabled: true,
    rationale:
      "The question needs multi-step retrieval across responsibility, chronology, conflicts, gaps, or official-source comparisons.",
    steps: steps.slice(0, args.deepReview ? 5 : 3),
  };
}

function documentIdsFromEvidenceResponse(response: any) {
  return uniq(
    ((response as any)?.candidates ?? []).flatMap((candidate: any) =>
      Array.isArray(candidate.clusterDocumentIds) && candidate.clusterDocumentIds.length
        ? candidate.clusterDocumentIds
        : [candidate.documentId],
    ),
  ).filter(Boolean) as string[];
}

function summarizeResearchStep(step: MultiStepResearchStep, response: any) {
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : [];
  const coverageFamilies = uniq(
    candidates.flatMap((candidate: any) => candidate.coverageFamilies ?? []),
  ).filter(Boolean) as string[];
  const retrievalLanes = uniq(
    candidates.flatMap((candidate: any) => candidate.retrievalLanes ?? []),
  ).filter(Boolean) as string[];

  return {
    ...step,
    candidateCount: Number(response?.totalCandidates ?? candidates.length ?? 0),
    documentIds: documentIdsFromEvidenceResponse(response),
    topSources: candidates.slice(0, 5).map((candidate: any) => ({
      documentId: candidate.documentId ?? null,
      title: String(candidate.title ?? "Untitled evidence"),
      sourceLabel: candidate.sourceLabel ?? null,
      matchScore:
        typeof candidate.matchScore === "number" ? candidate.matchScore : null,
      whyRanked: Array.isArray(candidate.whyRanked)
        ? candidate.whyRanked.slice(0, 4)
        : [],
    })),
    retrievalDecision: response?.retrievalDecision ?? null,
    queryUnderstanding: response?.queryUnderstanding ?? null,
    coverageFamilies,
    retrievalLanes,
  };
}

async function runMultiStepResearch(args: {
  question: string;
  profile: AirQualityQueryProfile;
  deepReview?: boolean;
  anchorDocumentIds: string[];
  anchorUrlIds: number[];
  sourceScope: "all" | "files" | "urls" | "mixed";
  requestedWorkflowMode: "auto" | "landscape" | "case_trace" | "question_review";
  collectorPurposeId?: string | null;
  ownerId: string;
}) {
  const plan = buildMultiStepResearchPlan({
    question: args.question,
    profile: args.profile,
    deepReview: args.deepReview,
  });

  if (!plan.enabled) {
    return {
      enabled: false,
      rationale: plan.rationale,
      steps: [],
    } satisfies MultiStepResearchResult;
  }

  const steps: MultiStepResearchResult["steps"] = [];
  for (const step of plan.steps) {
    const response = await queryGovernanceWorkspaceEvidence({
      question: step.question,
      anchorDocumentIds: args.anchorDocumentIds,
      anchorUrlIds: args.anchorUrlIds,
      sourceScope: args.sourceScope,
      workflowMode:
        step.id === "timeline" || step.id === "conflicts"
          ? "case_trace"
          : args.requestedWorkflowMode,
      limit: args.deepReview ? 8 : 5,
      collectorPurposeId: args.collectorPurposeId ?? null,
      ownerId: args.ownerId,
    });
    steps.push(summarizeResearchStep(step, response));
  }

  return {
    enabled: true,
    rationale: plan.rationale,
    steps,
  } satisfies MultiStepResearchResult;
}

function evidenceScore(
  card: EvidenceCard,
  keywords: string[],
  rankByDoc: Map<string, number>,
  profile: AirQualityQueryProfile,
) {
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
  if (card.kind === "event" && profile.queryType === "case_timeline") score += 5;
  if (card.kind === "gap" && profile.queryType === "enforcement_gap_review") score += 6;
  if (card.kind === "relation" && profile.queryType === "agency_responsibility") score += 5;
  score += airQualityDomainScore(text, profile);
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
  collectorPurposeId?: string | null;
}) {
  const id = randomUUID();
  const title = p.question ? p.question.slice(0, 120) : "Governance answer session";

  await prisma.$executeRaw`
    INSERT INTO "GovernanceAnswerSession"
      ("id", "createdAt", "updatedAt", "createdBy", "requestId", "title", "question",
       "anchorDocumentIds", "anchorUrlIds", "sourceScope", "requestedWorkflowMode",
       "selectedIssueId", "selectedAgencyId", "collectorPurposeId", "metadata")
    VALUES
      (${id}, NOW(), NOW(), ${p.createdBy ?? null}, ${p.requestId ?? null}, ${title}, ${p.question},
       ${asJson(p.anchorDocumentIds)}, ${asJson(p.anchorUrlIds)}, ${p.sourceScope}, ${p.requestedWorkflowMode},
       ${p.selectedIssueId ?? null}, ${p.selectedAgencyId ?? null}, ${p.collectorPurposeId ?? null}, ${asJson({ promptVersion: GOVERNANCE_ANSWER_PROMPT_VERSION })})
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
  collectorPurposeId?: string | null;
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
            "selectedAgencyId" = ${p.selectedAgencyId ?? null},
            "collectorPurposeId" = ${p.collectorPurposeId ?? null}
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
  collectorPurposeId?: string | null;
}) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "GovernanceAnswerRun"
      ("id", "sessionId", "createdAt", "updatedAt", "createdBy", "requestId", "status", "question",
       "model", "assistModel", "previousRunId", "previousResponseId",
       "anchorDocumentIds", "anchorUrlIds", "sourceScope", "requestedWorkflowMode",
       "selectedIssueId", "selectedAgencyId", "collectorPurposeId")
    VALUES
      (${id}, ${p.sessionId}, NOW(), NOW(), ${p.createdBy ?? null}, ${p.requestId ?? null}, 'STARTED', ${p.question},
       ${p.model}, ${p.assistModel}, ${p.previousRunId ?? null}, ${p.previousResponseId ?? null},
       ${asJson(p.anchorDocumentIds)}, ${asJson(p.anchorUrlIds)}, ${p.sourceScope}, ${p.requestedWorkflowMode},
       ${p.selectedIssueId ?? null}, ${p.selectedAgencyId ?? null}, ${p.collectorPurposeId ?? null})
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
  const structured =
    row.structuredAnswer && typeof row.structuredAnswer === "object"
      ? (row.structuredAnswer as Record<string, unknown>)
      : {};
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
    queryType: typeof structured.queryType === "string" ? structured.queryType : null,
    jurisdiction:
      typeof structured.jurisdiction === "string" ? structured.jurisdiction : null,
    agencies: Array.isArray(structured.agencies) ? structured.agencies : [],
    pollutants: Array.isArray(structured.pollutants) ? structured.pollutants : [],
    timeRange: typeof structured.timeRange === "string" ? structured.timeRange : null,
    summary: typeof structured.summary === "string" ? structured.summary : null,
    findings: Array.isArray(structured.findings) ? structured.findings : [],
    conflicts: Array.isArray(structured.conflicts) ? structured.conflicts : [],
    evidenceGaps: Array.isArray(structured.evidenceGaps)
      ? structured.evidenceGaps
      : [],
    recommendedNextSteps: Array.isArray(structured.recommendedNextSteps)
      ? structured.recommendedNextSteps
      : [],
    confidence:
      structured.confidence && typeof structured.confidence === "object"
        ? structured.confidence
        : null,
    model: row.model,
    assistModel: row.assistModel,
    openaiResponseId: row.openaiResponseId,
    previousRunId: row.previousRunId,
    previousResponseId: row.previousResponseId,
    collectorPurposeId: row.collectorPurposeId,
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
    collectorPurposeId: row.collectorPurposeId,
    metadata: row.metadata ?? null,
    runs: runs.map(mapRun),
  };
}

export function mapGovernanceAnswerSessionSummary(
  row: GovernanceAnswerSessionSummaryRow,
) {
  const validation =
    row.latestValidation && typeof row.latestValidation === "object"
      ? (row.latestValidation as Record<string, unknown>)
      : {};
  const anchorDocumentIds = safeStringArray(row.anchorDocumentIds);
  const anchorUrlIds = safeNumberArray(row.anchorUrlIds);

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    title: row.title,
    question: row.question ?? row.latestRunQuestion ?? null,
    sourceScope: row.sourceScope,
    requestedWorkflowMode: row.requestedWorkflowMode,
    resolvedWorkflowMode: row.resolvedWorkflowMode,
    selectedIssueId: row.selectedIssueId,
    selectedAgencyId: row.selectedAgencyId,
    collectorPurposeId: row.collectorPurposeId,
    anchorDocumentCount: anchorDocumentIds.length,
    anchorUrlCount: anchorUrlIds.length,
    runCount: Number(row.runCount ?? 0),
    latestRunId: row.latestRunId,
    latestRunStatus: row.latestRunStatus,
    latestRunCreatedAt: row.latestRunCreatedAt?.toISOString() ?? null,
    latestGroundingStatus: row.latestGroundingStatus,
    qualityBand:
      typeof validation.qualityBand === "string" ? validation.qualityBand : null,
    recommendedAction:
      typeof validation.recommendedAction === "string"
        ? validation.recommendedAction
        : null,
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
  collectorPurposeId?: string | null;
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
    collectorPurposeId: p.collectorPurposeId ?? null,
  });
  return getGovernanceAnswerSession(sessionId);
}

export async function listGovernanceAnswerSessions(p: {
  limit?: number;
  q?: string | null;
  collectorPurposeId?: string | null;
  sourceScope?: "all" | "files" | "urls" | "mixed" | null;
}) {
  const limit = Math.max(1, Math.min(50, Math.floor(p.limit ?? 20)));
  const q = String(p.q || "").trim();
  const collectorPurposeId = String(p.collectorPurposeId || "").trim();
  const sourceScope = normalizeScope(p.sourceScope);
  const filters: Prisma.Sql[] = [];

  if (q) {
    filters.push(Prisma.sql`(
      s."title" ILIKE ${`%${q}%`} OR
      s."question" ILIKE ${`%${q}%`} OR
      latest."question" ILIKE ${`%${q}%`}
    )`);
  }

  if (collectorPurposeId) {
    filters.push(Prisma.sql`s."collectorPurposeId" = ${collectorPurposeId}`);
  }

  if (p.sourceScope) {
    filters.push(Prisma.sql`s."sourceScope" = ${sourceScope}`);
  }

  const whereSql = filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<GovernanceAnswerSessionSummaryRow[]>`
    SELECT
      s.*,
      COALESCE(run_counts."runCount", 0) AS "runCount",
      latest."id" AS "latestRunId",
      latest."status" AS "latestRunStatus",
      latest."question" AS "latestRunQuestion",
      latest."createdAt" AS "latestRunCreatedAt",
      latest."groundingStatus" AS "latestGroundingStatus",
      latest."validation" AS "latestValidation"
    FROM "GovernanceAnswerSession" s
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS "runCount"
      FROM "GovernanceAnswerRun" r
      WHERE r."sessionId" = s."id"
    ) run_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT *
      FROM "GovernanceAnswerRun" r
      WHERE r."sessionId" = s."id"
      ORDER BY
        CASE WHEN r."status" = 'SUCCEEDED' THEN 0 ELSE 1 END,
        r."createdAt" DESC
      LIMIT 1
    ) latest ON TRUE
    ${whereSql}
    ORDER BY s."updatedAt" DESC
    LIMIT ${limit}
  `;

  return rows.map(mapGovernanceAnswerSessionSummary);
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

async function getGovernanceAnswerRunOrThrow(runId: string) {
  const rows = await prisma.$queryRaw<GovernanceAnswerRunRow[]>`
    SELECT * FROM "GovernanceAnswerRun" WHERE "id" = ${runId} LIMIT 1
  `;
  const run = rows[0];
  if (!run) {
    const err: any = new Error("Governance answer run not found");
    err.status = 404;
    throw err;
  }
  return run;
}

function numberFrom(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function objectFrom(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function arrayFrom(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildAnswerEvaluationFromRun(row: GovernanceAnswerRunRow): GovernanceAnswerEvaluation {
  const validation = objectFrom(row.validation);
  const retrievalMetadata = objectFrom(row.retrievalMetadata);
  const structured = objectFrom(row.structuredAnswer);
  const retrievalDecision = objectFrom(retrievalMetadata.retrievalDecision);
  const officerFeedback = arrayFrom(validation.officerFeedback);
  const citationCount = numberFrom(
    validation.validCitationCount ?? validation.citationCount,
    arrayFrom(row.citations).length,
  );
  const invalidCitationCount = numberFrom(validation.invalidCitationCount, 0);
  const supportedClaimCount = numberFrom(
    validation.supportedClaimCount,
    arrayFrom((structured as any).claimCitations).length,
  );
  const evidenceCardCount = numberFrom(
    validation.evidenceCardCount,
    arrayFrom(row.evidence).length,
  );
  const totalCandidates = numberFrom(retrievalMetadata.totalCandidates, 0);
  const confidence =
    typeof retrievalDecision.confidence === "string"
      ? retrievalDecision.confidence
      : "low";
  const evidenceGaps = arrayFrom(structured.evidenceGaps);
  const conflicts = arrayFrom(structured.conflicts);
  const retrievalScore = clampScore(
    (confidence === "high" ? 72 : confidence === "medium" ? 54 : 34) +
      Math.min(18, totalCandidates * 2) +
      Math.min(10, evidenceCardCount),
  );
  const citationScore = clampScore(
    citationCount > 0
      ? 70 + Math.min(20, citationCount * 2) - invalidCitationCount * 10
      : 10,
  );
  const coverageScore = clampScore(
    30 +
      Math.min(32, supportedClaimCount * 6) +
      Math.min(18, evidenceCardCount * 3) -
      Math.min(30, evidenceGaps.length * 5),
  );
  const conflictScore = clampScore(
    conflicts.length > 0 || evidenceGaps.length > 0
      ? 72 + Math.min(18, conflicts.length * 4)
      : 52,
  );
  const overall = clampScore(
    retrievalScore * 0.25 +
      citationScore * 0.35 +
      coverageScore * 0.25 +
      conflictScore * 0.15,
  );

  const checks: GovernanceAnswerEvaluation["checks"] = [
    {
      key: "retrieval",
      label: "Retrieved evidence strength",
      status: retrievalScore >= 70 ? "pass" : retrievalScore >= 45 ? "warn" : "fail",
      detail:
        totalCandidates > 0
          ? `${totalCandidates} candidates with ${confidence} retrieval confidence.`
          : "No retrieval candidates were recorded.",
    },
    {
      key: "citations",
      label: "Citation integrity",
      status: citationScore >= 70 ? "pass" : citationScore >= 45 ? "warn" : "fail",
      detail:
        citationCount > 0
          ? `${citationCount} valid citations, ${invalidCitationCount} invalid citations.`
          : "No valid citations were available.",
    },
    {
      key: "coverage",
      label: "Officer answer coverage",
      status: coverageScore >= 70 ? "pass" : coverageScore >= 45 ? "warn" : "fail",
      detail:
        evidenceGaps.length > 0
          ? `${evidenceGaps.length} evidence gaps remain.`
          : `${supportedClaimCount} supported claims/findings with no explicit evidence gaps.`,
    },
    {
      key: "conflicts",
      label: "Conflict and gap surfacing",
      status: conflictScore >= 70 ? "pass" : "warn",
      detail:
        conflicts.length > 0
          ? `${conflicts.length} conflicts or tensions surfaced.`
          : "No conflicts surfaced; inspect if the question required contradiction review.",
    },
  ];

  return {
    runId: row.id,
    status: String(validation.status ?? row.groundingStatus ?? "unknown"),
    qualityBand: String(validation.qualityBand ?? "unsafe"),
    recommendedAction: String(validation.recommendedAction ?? "broaden_evidence"),
    scores: {
      retrieval: retrievalScore,
      citation: citationScore,
      coverage: coverageScore,
      conflict: conflictScore,
      overall,
    },
    checks,
    officerFeedbackCount: officerFeedback.length,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function evaluateGovernanceAnswerRun(runId: string) {
  const row = await getGovernanceAnswerRunOrThrow(runId);
  return buildAnswerEvaluationFromRun(row);
}

export async function recordGovernanceAnswerFeedback(
  input: GovernanceAnswerFeedbackInput,
) {
  const row = await getGovernanceAnswerRunOrThrow(input.runId);
  const validation = objectFrom(row.validation);
  const officerFeedback = arrayFrom(validation.officerFeedback);
  const feedback = {
    id: randomUUID(),
    rating: input.rating,
    target: input.target ?? "answer",
    claim: input.claim?.trim() || null,
    evidenceId: input.evidenceId?.trim() || null,
    citationQuote: input.citationQuote?.trim().slice(0, 500) || null,
    comment: input.comment?.trim().slice(0, 1200) || null,
    requestId: input.requestId ?? null,
    createdBy: input.createdBy ?? null,
    createdAt: new Date().toISOString(),
  };

  const nextValidation = {
    ...validation,
    officerFeedback: [...officerFeedback, feedback].slice(-100),
    latestOfficerFeedback: feedback,
  };

  await prisma.$executeRaw`
    UPDATE "GovernanceAnswerRun"
    SET "updatedAt" = NOW(),
        "validation" = ${asJson(nextValidation)}
    WHERE "id" = ${input.runId}
  `;

  const updated = await getGovernanceAnswerRunOrThrow(input.runId);
  return {
    feedback,
    evaluation: buildAnswerEvaluationFromRun(updated),
  };
}

export function claimTextWithinEvidenceScope(
  claim:
    | {
        claimText?: string | null;
        trace?: { sourceDocumentId?: string | null } | null;
      }
    | null
    | undefined,
  allowedDocumentIdSet: ReadonlySet<string> | null,
) {
  if (!claim?.claimText) return null;
  if (
    allowedDocumentIdSet &&
    !allowedDocumentIdSet.has(claim.trace?.sourceDocumentId ?? "")
  ) {
    return null;
  }
  return claim.claimText;
}

export function assertEvidenceCardsWithinPurposeScope(
  cards: Array<Pick<EvidenceCard, "evidenceId" | "documentId">>,
  allowedDocumentIds?: string[] | null,
) {
  if (!allowedDocumentIds) return;

  const allowedDocumentIdSet = new Set(allowedDocumentIds);
  const escapedCard = cards.find(
    (card) => !card.documentId || !allowedDocumentIdSet.has(card.documentId),
  );
  if (!escapedCard) return;

  const error: any = new Error(
    `Purpose evidence boundary violation detected for ${escapedCard.evidenceId}.`,
  );
  error.status = 500;
  throw error;
}

export function resolveAnswerCandidateDocumentIds(p: {
  retrievedDocumentIds: string[];
  selectedDocumentIds?: string[] | null;
  allowedDocumentIds?: string[] | null;
}) {
  const retrievedDocumentIds = safeStringArray(p.retrievedDocumentIds);
  const selectedDocumentIds = safeStringArray(p.selectedDocumentIds);
  const allowedDocumentIdSet = p.allowedDocumentIds
    ? new Set(safeStringArray(p.allowedDocumentIds))
    : null;

  if (!selectedDocumentIds.length) {
    return {
      candidateDocumentIds: retrievedDocumentIds,
      manualEvidenceSelection: null,
    };
  }

  const selectedDocumentIdSet = new Set(selectedDocumentIds);
  const retrievedDocumentIdSet = new Set(retrievedDocumentIds);
  const outsideRetrieval = selectedDocumentIds.filter(
    (documentId) => !retrievedDocumentIdSet.has(documentId),
  );
  if (outsideRetrieval.length) {
    const error: any = new Error(
      "Selected evidence is no longer part of the retrieved document set. Run Find evidence again.",
    );
    error.status = 400;
    throw error;
  }

  if (allowedDocumentIdSet) {
    const outsidePurpose = selectedDocumentIds.filter(
      (documentId) => !allowedDocumentIdSet.has(documentId),
    );
    if (outsidePurpose.length) {
      const error: any = new Error(
        "Selected evidence is outside the current purpose boundary.",
      );
      error.status = 400;
      throw error;
    }
  }

  return {
    candidateDocumentIds: retrievedDocumentIds.filter((documentId) =>
      selectedDocumentIdSet.has(documentId),
    ),
    manualEvidenceSelection: {
      active: true,
      selectedDocumentIds,
      selectedDocumentCount: selectedDocumentIds.length,
      retrievedDocumentCount: retrievedDocumentIds.length,
    },
  };
}

async function loadEvidenceCards(p: {
  question: string;
  candidateDocumentIds: string[];
  allowedDocumentIds?: string[] | null;
  maxCards?: number;
}) {
  const allowedDocumentIdSet = p.allowedDocumentIds
    ? new Set(p.allowedDocumentIds)
    : null;
  const candidateDocumentIds = allowedDocumentIdSet
    ? p.candidateDocumentIds.filter((documentId) => allowedDocumentIdSet.has(documentId))
    : p.candidateDocumentIds;
  if (!candidateDocumentIds.length) return [];

  const rankByDoc = new Map(candidateDocumentIds.map((id, index) => [id, index]));
  const keywords = extractKeywords(p.question);
  const profile = buildAirQualityQueryProfile(p.question);

  const chunks = await prisma.sourceChunk.findMany({
    where: {
      revision: {
        isActive: true,
        documentRevision: {
          documentId: { in: candidateDocumentIds },
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
    take: Math.max(80, candidateDocumentIds.length * 18),
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
      where: { trace: { sourceDocumentId: { in: candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        subjectAgency: { select: { name: true } },
        trace: { select: traceSelect },
      },
      orderBy: { updatedAt: "desc" },
      take: 70,
    }),
    prisma.documentEvent.findMany({
      where: { trace: { sourceDocumentId: { in: candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        actorAgency: { select: { name: true } },
        trace: { select: traceSelect },
      },
      orderBy: [{ sortDate: "desc" }, { updatedAt: "desc" }],
      take: 60,
    }),
    prisma.governanceGap.findMany({
      where: { trace: { sourceDocumentId: { in: candidateDocumentIds } } },
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
      where: { trace: { sourceDocumentId: { in: candidateDocumentIds } } },
      include: {
        issue: { select: { title: true } },
        fromAgency: { select: { name: true } },
        toAgency: { select: { name: true } },
        fromClaim: {
          select: {
            claimText: true,
            trace: { select: { sourceDocumentId: true } },
          },
        },
        toClaim: {
          select: {
            claimText: true,
            trace: { select: { sourceDocumentId: true } },
          },
        },
        trace: { select: traceSelect },
      },
      orderBy: { updatedAt: "desc" },
      take: 70,
    }),
    prisma.extractionTrace.findMany({
      where: {
        sourceDocumentId: { in: candidateDocumentIds },
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
    const fromClaimText = claimTextWithinEvidenceScope(
      relation.fromClaim,
      allowedDocumentIdSet,
    );
    const toClaimText = claimTextWithinEvidenceScope(
      relation.toClaim,
      allowedDocumentIdSet,
    );
    const text = compact(
      [
        relation.relationType,
        relation.rationale,
        fromClaimText,
        toClaimText,
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
    .map((card) => ({ card, score: evidenceScore(card, keywords, rankByDoc, profile) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.card)
    .slice(0, p.maxCards ?? 32);
}

async function maybeRerankEvidenceWithAssistModel(p: {
  question: string;
  profile: AirQualityQueryProfile;
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
        max_output_tokens: env.OPENAI_FAST_MAX_OUTPUT_TOKENS,
        input: [
          {
            role: "system" as const,
            content:
              "You are a strict air-quality governance evidence reranker for government officers. Return only evidence IDs that directly help answer the user question. Prefer official sources, orders, directions, court/tribunal records, agency responsibility evidence, enforcement records, timelines, and contradiction/gap evidence.",
          },
          {
            role: "user" as const,
            content: [
              `QUESTION:\n${p.question}`,
              "",
              `OFFICER_QUERY_PROFILE:\n${JSON.stringify(p.profile)}`,
              "",
              "EVIDENCE:",
              items,
            ].join("\n"),
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

function formatEvidencePack(cards: EvidenceCard[], profile: AirQualityQueryProfile) {
  if (!cards.length) return "NO_GOVERNANCE_EVIDENCE_AVAILABLE";

  return cards
    .map((card, index) =>
      [
        `#${index + 1}`,
        `EVIDENCE_ID: ${card.evidenceId}`,
        `KIND: ${card.kind}`,
        `DOCUMENT_ID: ${card.documentId ?? "unknown"}`,
        `SOURCE: ${card.sourceLabel ?? card.title}`,
        `OFFICIAL_SOURCE_CUE: ${officialSourceScore(`${card.title} ${card.sourceLabel ?? ""} ${card.sourceUrl ?? ""}`) > 0 ? "yes" : "no"}`,
        `AIR_QUALITY_SCORE: ${airQualityDomainScore(`${card.title}\n${card.text}`, profile)}`,
        `TITLE: ${card.title}`,
        "TEXT:",
        card.text.slice(0, 2_500),
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

  const validateFindingGroup = (
    items: Array<z.infer<typeof OfficerFindingSchema>>,
  ) =>
    items
      .map((item) => {
        const citations = item.citations
          .map(validateOne)
          .filter(Boolean) as ValidatedCitation[];
        if (!citations.length) {
          droppedClaims.push(item.finding);
          return null;
        }
        return {
          title: item.title,
          finding: item.finding,
          citations,
        };
      })
      .filter(Boolean) as Array<{
      title: string;
      finding: string;
      citations: ValidatedCitation[];
    }>;

  const findings = validateFindingGroup(raw.findings ?? []);
  const conflicts = validateFindingGroup(raw.conflicts ?? []);

  const validCitationCount = flattenValidCitations([
    ...claimCitations,
    ...findings,
    ...conflicts,
  ]).length;
  const status: ValidationReport["status"] =
    validCitationCount > 0 && invalidCitationCount === 0
      ? "verified"
      : validCitationCount > 0
        ? "partially_supported"
        : "unsupported";

  return {
    structured: {
      ...raw,
      findings,
      claimCitations,
      evidence,
      caveats,
      conflicts,
    },
    validation: {
      status,
      validCitationCount,
      droppedClaims,
      ...buildGovernanceAnswerQualitySummary({
        status,
        validCitationCount,
        invalidCitationCount,
        repaired,
        droppedClaims,
        supportedClaimCount: claimCitations.length + findings.length + conflicts.length,
        evidenceCardCount: evidence.length,
      }),
    } satisfies ValidationReport,
  };
}

async function generateAnswerOnce(p: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  evidencePack: string;
  evidenceCards: EvidenceCard[];
  profile: AirQualityQueryProfile;
  multiStepResearch?: MultiStepResearchResult | null;
  graphRagSummary?: GraphRagSummary | null;
  model: string;
  maxOutputTokens: number;
  previousResponseId?: string | null;
  repairFrom?: GovernanceAnswerStructured | null;
  signal?: AbortSignal;
}) {
  const allowedIds = p.evidenceCards.map((card) => card.evidenceId).join(", ");
  const system = [
    "You are the Air Quality Governance Intelligence Workspace answer synthesizer.",
    "Your user is a government officer, regulator, analyst, field-enforcement reviewer, or public-sector decision maker.",
    "Answer only from the supplied GOVERNANCE_EVIDENCE. Conversation history is context, not evidence.",
    "Do not use outside knowledge for factual claims. If evidence is weak or missing, say so.",
    "Every factual claim in the answer must appear in claimCitations with at least one citation.",
    "Each citation must use an allowed evidenceId and quote a verbatim substring from that evidence TEXT.",
    "Prioritize official-source evidence from pollution boards, CAQM, environment departments, courts/tribunals, municipal bodies, district administrations, orders, directions, inspections, compliance reports, and action plans.",
    "Use GRAPH_RAG_SUMMARY to reason over agency relationships, issue links, contradictions, override chains, case-trail chronology, and actor signals when it is present.",
    "Return the officer workflow metadata fields: queryType, jurisdiction, agencies, pollutants, timeRange, summary, findings, conflicts, evidenceGaps, recommendedNextSteps, and confidence.",
    "Findings and conflicts must be citation-backed. Evidence gaps and recommended next steps may be uncited but must be phrased as review actions, not factual conclusions.",
    "Allowed general suggestions are permitted only inside caveats with kind=suggestion, clearly labeled as not directly established by evidence.",
    "The answer field must be concise markdown using these exact H2 sections in this order:",
    "## Short answer",
    "## Key findings",
    "## Timeline",
    "## Agencies involved",
    "## Directions / orders",
    "## Compliance or follow-up",
    "## Contradictions / gaps",
    "## Evidence used",
    "If a section lacks evidence, write a short 'Not found in the retrieved evidence' statement instead of inventing content.",
    "Keep bullets short. Do not include uncited factual claims in any section.",
    "Return only JSON matching the schema.",
  ].join("\n");

  const user = [
    `QUESTION:\n${p.question}`,
    "",
    `OFFICER_QUERY_PROFILE:\n${JSON.stringify(p.profile)}`,
    "",
    p.multiStepResearch?.enabled
      ? `MULTI_STEP_RESEARCH_TRACE:\n${JSON.stringify(p.multiStepResearch)}\n`
      : "",
    p.graphRagSummary?.active
      ? `GRAPH_RAG_SUMMARY:\n${JSON.stringify(p.graphRagSummary)}\n`
      : "",
    `ALLOWED_EVIDENCE_IDS:\n${allowedIds}`,
    "",
    "GOVERNANCE_EVIDENCE:",
    p.evidencePack,
    "",
    p.repairFrom
      ? [
          "The previous structured answer had invalid or weak citations.",
          "Repair it by removing unsupported factual claims or moving non-evidentiary guidance into caveats/suggestions.",
          "Keep the answer field in the exact governance-brief H2 section format.",
          "PREVIOUS_JSON:",
          JSON.stringify(p.repairFrom),
        ].join("\n")
      : "Produce the governance-brief answer, claim-level citations, evidence cards, caveats, openQuestions, and 3-6 suggestedFollowUps.",
  ].join("\n");

  const input = [
    { role: "system" as const, content: system },
    ...p.history.slice(-6).map((item) => ({
      role: item.role,
      content: String(item.content ?? "").slice(0, 4_000),
    })),
    { role: "user" as const, content: user },
  ];

  const resp = await openaiClient().responses.parse(
    {
      model: p.model,
      max_output_tokens: p.maxOutputTokens,
      previous_response_id: env.OPENAI_STATEFUL_RESPONSES
        ? p.previousResponseId ?? undefined
        : undefined,
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

function unsupportedFallback(question: string): any {
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

function unsupportedAirQualityFallback(
  question: string,
  profile: AirQualityQueryProfile = buildAirQualityQueryProfile(question),
): GovernanceAnswerStructured {
  return {
    queryType: profile.queryType,
    jurisdiction: profile.jurisdiction,
    agencies: profile.agencies,
    pollutants: profile.pollutants,
    timeRange: profile.timeRange,
    summary:
      "The retrieved evidence did not support a safe officer-grade answer.",
    findings: [],
    answer:
      `I could not verify an evidence-backed answer to "${question}" from the retrieved air-quality governance evidence. ` +
      "The safest next step is to inspect the retrieved candidate documents and ask a narrower question tied to a specific order, agency, location, pollutant, or date.",
    claimCitations: [],
    evidence: [],
    caveats: [
      {
        kind: "limitation",
        text: "No factual answer is provided because the available evidence did not pass citation validation.",
      },
    ],
    conflicts: [],
    evidenceGaps: [
      "No retrieved evidence passed citation validation for the officer brief.",
      "A narrower source, agency, location, pollutant, or date may be needed.",
    ],
    recommendedNextSteps: [
      "Broaden evidence retrieval to official orders, directions, inspection records, and compliance/status reports.",
      "Ask a narrower question tied to one agency, issue, location, or date range.",
    ],
    confidence: {
      level: "low",
      rationale:
        "No citation-backed factual claim could be verified from the retrieved evidence.",
      evidenceCoverage: "missing",
    },
    openQuestions: [
      "Which official order, direction, inspection record, or status report should be treated as the primary source?",
      "Which agency, jurisdiction, pollutant, and date range should the review focus on?",
      "Are there conflicting records that refer to the same issue, location, and period?",
    ],
    suggestedFollowUps: [
      "Show official-source evidence only",
      "Compare the two strongest records",
      "List missing checks before an officer can rely on this",
    ],
  };
}

function buildRetrievalMetadata(
  evidenceResponse: any,
  evidenceCards: EvidenceCard[],
  profile: AirQualityQueryProfile,
  selectedDocumentIds: string[] = [],
  multiStepResearch?: MultiStepResearchResult | null,
  graphRagSummary?: GraphRagSummary | null,
) {
  return {
    promptVersion: GOVERNANCE_ANSWER_PROMPT_VERSION,
    domain: profile.domain,
    officerQueryProfile: profile,
    generationStages: profile.generationStages,
    workflow: evidenceResponse?.workflow ?? null,
    queryUnderstanding: evidenceResponse?.queryUnderstanding ?? null,
    retrievalDecision: evidenceResponse?.retrievalDecision ?? null,
    multiStepResearch: multiStepResearch ?? null,
    graphRagSummary: graphRagSummary ?? null,
    totalCandidates: evidenceResponse?.totalCandidates ?? 0,
    evidenceCardCount: evidenceCards.length,
    retrievalTraceSummary: buildAnswerRetrievalTraceSummary({
      evidenceResponse,
      evidenceCards,
      selectedDocumentIds,
      profile,
    }),
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
  const officerFilters = normalizeAnswerOfficerFilters(input.officerFilters);
  const model = modelForAnswer(input.deepReview);
  const maxOutputTokens = maxOutputTokensForAnswer(input.deepReview);
  const assistModel = modelForAssist();
  const officerQueryProfile = buildAirQualityQueryProfile(question, officerFilters);

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
    collectorPurposeId: input.collectorPurposeId ?? null,
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
    collectorPurposeId: input.collectorPurposeId ?? null,
  });

  await input.onStreamEvent?.({ type: "run", runId, sessionId });

  let retrievalMetadata: unknown = null;

  try {
    if (!env.OPENAI_ENABLED) {
      const err: any = new Error("Answer generation is disabled. Set OPENAI_ENABLED=true and configure OPENAI_API_KEY to enable governance answers.");
      err.status = 503;
      throw err;
    }

    await input.onStreamEvent?.({
      type: "status",
      message: "Understanding air-quality governance question",
    });
    await input.onStreamEvent?.({ type: "status", message: "Retrieving hybrid governance evidence" });
    const evidenceResponse = await queryGovernanceWorkspaceEvidence({
      question,
      anchorDocumentIds,
      anchorUrlIds,
      sourceScope,
      workflowMode: requestedWorkflowMode,
      limit: Math.max(10, Math.min(12, Number(input.limit ?? 12))),
      collectorPurposeId: input.collectorPurposeId ?? null,
      ownerId: input.ownerId ?? "local",
      officerFilters,
    });

    const allowedDocumentIds = input.collectorPurposeId
      ? safeStringArray((evidenceResponse as any)?.evidenceScope?.allowedDocumentIds)
      : null;
    retrievalMetadata = {
      collectorPurposeId: input.collectorPurposeId ?? null,
      allowedDocumentIds,
    };

    if (input.collectorPurposeId && !allowedDocumentIds?.length) {
      const err: any = new Error(
        "This purpose has no captured evidence yet. Capture a saved URL before asking questions.",
      );
      err.status = 409;
      throw err;
    }

    await input.onStreamEvent?.({
      type: "status",
      message: "Planning multi-step research when needed",
    });
    const multiStepResearch = await runMultiStepResearch({
      question,
      profile: officerQueryProfile,
      deepReview: input.deepReview,
      anchorDocumentIds,
      anchorUrlIds,
      sourceScope,
      requestedWorkflowMode,
      collectorPurposeId: input.collectorPurposeId ?? null,
      ownerId: input.ownerId ?? "local",
    });

    if (multiStepResearch.enabled) {
      await input.onStreamEvent?.({
        type: "status",
        message: `Retrieved ${multiStepResearch.steps.length} research lanes`,
      });
    }
    const graphRagSummary = buildGraphRagSummary(evidenceResponse);

    const retrievedDocumentIds = uniq([
      ...documentIdsFromEvidenceResponse(evidenceResponse),
      ...multiStepResearch.steps.flatMap((step) => step.documentIds),
    ]);
    const { candidateDocumentIds, manualEvidenceSelection } =
      resolveAnswerCandidateDocumentIds({
        retrievedDocumentIds,
        selectedDocumentIds: input.selectedDocumentIds,
        allowedDocumentIds,
      });

    await input.onStreamEvent?.({
      type: "status",
      message: candidateDocumentIds.length
        ? `Loading source chunks and graph evidence from ${candidateDocumentIds.length} candidate documents`
        : "No candidate documents found",
    });

    const initialEvidenceCards = await loadEvidenceCards({
      question,
      candidateDocumentIds,
      allowedDocumentIds,
      maxCards: 44,
    });
    assertEvidenceCardsWithinPurposeScope(initialEvidenceCards, allowedDocumentIds);

    await input.onStreamEvent?.({ type: "status", message: "Ranking official sources and evidence lanes" });
    const evidenceCards = await maybeRerankEvidenceWithAssistModel({
      question,
      profile: officerQueryProfile,
      cards: initialEvidenceCards,
      finalLimit: 26,
      signal: input.signal,
    });
    assertEvidenceCardsWithinPurposeScope(evidenceCards, allowedDocumentIds);

    retrievalMetadata = {
      ...buildRetrievalMetadata(
        evidenceResponse,
        evidenceCards,
        officerQueryProfile,
        candidateDocumentIds,
        multiStepResearch,
        graphRagSummary,
      ),
      collectorPurposeId: input.collectorPurposeId ?? null,
      allowedDocumentIds,
      manualEvidenceSelection,
    };

    if (!evidenceCards.length) {
      const fallback = unsupportedAirQualityFallback(question, officerQueryProfile);
      const validation: ValidationReport = {
        status: "unsupported",
        validCitationCount: 0,
        droppedClaims: [],
        ...buildGovernanceAnswerQualitySummary({
          status: "unsupported",
          validCitationCount: 0,
          invalidCitationCount: 0,
          repaired: false,
          droppedClaims: [],
          supportedClaimCount: 0,
          evidenceCardCount: 0,
        }),
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
          structuredAnswer: fallback,
          queryType: fallback.queryType,
          jurisdiction: fallback.jurisdiction,
          agencies: fallback.agencies,
          pollutants: fallback.pollutants,
          timeRange: fallback.timeRange,
          summary: fallback.summary,
          findings: fallback.findings,
          conflicts: fallback.conflicts,
          evidenceGaps: fallback.evidenceGaps,
          recommendedNextSteps: fallback.recommendedNextSteps,
          confidence: fallback.confidence,
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

    await input.onStreamEvent?.({ type: "status", message: "Drafting officer brief" });
    const evidencePack = formatEvidencePack(evidenceCards, officerQueryProfile);
    const first = await generateAnswerOnce({
      question,
      history: input.history ?? [],
      evidencePack,
      evidenceCards,
      profile: officerQueryProfile,
      multiStepResearch,
      graphRagSummary,
      model,
      maxOutputTokens,
      previousResponseId,
      signal: input.signal,
    });

    await input.onStreamEvent?.({ type: "status", message: "Checking claim citations" });
    let validated = validateStructuredAnswer(first.answer, evidenceCards, false);
    let openaiResponseId = first.responseId;

    if (validated.validation.invalidCitationCount > 0 || validated.validation.status === "unsupported") {
      await input.onStreamEvent?.({ type: "status", message: "Repairing citations" });
      const repaired = await generateAnswerOnce({
        question,
        history: input.history ?? [],
        evidencePack,
        evidenceCards,
        profile: officerQueryProfile,
        multiStepResearch,
        graphRagSummary,
        model,
        maxOutputTokens,
        previousResponseId: openaiResponseId ?? previousResponseId,
        repairFrom: first.answer,
        signal: input.signal,
      });
      openaiResponseId = repaired.responseId ?? openaiResponseId;
      validated = validateStructuredAnswer(repaired.answer, evidenceCards, true);
    }

    const finalAnswer =
      validated.validation.status === "unsupported"
        ? unsupportedAirQualityFallback(question, officerQueryProfile)
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
        structuredAnswer: finalAnswer,
        queryType: finalAnswer.queryType,
        jurisdiction: finalAnswer.jurisdiction,
        agencies: finalAnswer.agencies,
        pollutants: finalAnswer.pollutants,
        timeRange: finalAnswer.timeRange,
        summary: finalAnswer.summary,
        findings: (validated.structured as any).findings ?? [],
        conflicts: (validated.structured as any).conflicts ?? [],
        evidenceGaps: finalAnswer.evidenceGaps,
        recommendedNextSteps: finalAnswer.recommendedNextSteps,
        confidence: finalAnswer.confidence,
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
