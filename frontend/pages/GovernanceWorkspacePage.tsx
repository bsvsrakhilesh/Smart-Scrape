import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Building2,
  ChevronDown,
  FileText,
  GitBranch,
  Landmark,
  Loader2,
  Network,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import SmartCard from "../components/ui/SmartCard";
import CaseWorkspacePanel from "../components/governance/CaseWorkspacePanel";
import {
  apiUrl,
  getAuditLogs,
  getDocumentGovernance,
  getGovernanceAgenciesDirectory,
  getGovernanceAgencyLandscape,
  getGovernanceIssueRelations,
  getGovernanceIssuesDirectory,
  getGovernanceIssueTimeline,
  getUrlRevisions,
  queryGovernanceWorkspaceEvidence,
  streamGovernanceWorkspaceAnswer,
  type AuditLogRow,
  type GovernanceAgency,
  type GovernanceIssue,
  type GovernanceProvenance,
  type GovernanceRelationType,
  type GovernanceAnswerCitation,
  type GovernanceAnswerRun,
} from "../lib/api";
import NotebookTemplateModal from "../components/governance/NotebookTemplateModal";
import { notebookClient } from "../lib/notebookClient";
import type {
  Citation,
  ClaimCitationLink,
  EvidenceBlock,
  NotebookTemplateKey,
  SourceKind,
} from "../lib/notebookClient";
import { openNotebookWithTarget } from "../lib/notebookLaunch";
import {
  consumeGovernanceWorkspaceIntent,
  type GovernanceWorkspaceIntent,
  type GovernanceWorkspaceSourceScope,
} from "../lib/governanceWorkspace";
import { navigateWithinApp } from "../lib/navigation";

type RelationFilter = "all" | GovernanceRelationType;

type WorkspaceIntakeMode =
  | "auto"
  | "landscape"
  | "case_trace"
  | "question_review";

type GovernanceQueryType =
  | "broad_scan"
  | "case_review"
  | "chronology_review"
  | "contradiction_review"
  | "question_review";

const workspaceIntentModeOptions: Array<{
  value: WorkspaceIntakeMode;
  label: string;
  help: string;
}> = [
  {
    value: "auto",
    label: "Auto-detect",
    help: "Let the workspace choose between landscape mapping, case tracing, and question review.",
  },
  {
    value: "landscape",
    label: "Landscape Mapping",
    help: "Use this for broad governance scoping, active directions, and agency mapping.",
  },
  {
    value: "case_trace",
    label: "Case Tracing",
    help: "Use this for one unit, one dispute, one timeline, or contradiction review.",
  },
  {
    value: "question_review",
    label: "Question Review",
    help: "Use this for why, factors, evidence, actions, responsibility, or follow-up questions.",
  },
];

const governancePromptExamples: Array<{
  label: string;
  mode: WorkspaceIntakeMode;
  prompt: string;
}> = [
  {
    label: "In-force policy view",
    mode: "landscape",
    prompt: "What is currently in force for industrial emissions in Faridabad?",
  },
  {
    label: "Jurisdiction and gaps",
    mode: "landscape",
    prompt:
      "Map the active agencies, directions, follow-up actions, and compliance gaps for stone crushers in Bhiwadi.",
  },
  {
    label: "Evidence-backed why",
    mode: "question_review",
    prompt:
      "Why does this unit appear restricted in one record and permitted in another?",
  },
  {
    label: "Actions and responsibility",
    mode: "question_review",
    prompt:
      "What actions followed the 2022 order, and which agencies were responsible?",
  },
];

function normalizeWorkspaceIntentMode(
  preferredMode?: string | null,
): WorkspaceIntakeMode {
  if (preferredMode === "landscape") return "landscape";
  if (preferredMode === "question_review") return "question_review";
  if (preferredMode === "case_trace" || preferredMode === "contradiction") {
    return "case_trace";
  }
  return "auto";
}

function formatWorkspaceIntentModeLabel(mode: WorkspaceIntakeMode) {
  switch (mode) {
    case "landscape":
      return "Governance Landscape Mapping";
    case "case_trace":
      return "Case-Tracing and Contradiction Mapping";
    case "question_review":
      return "Question Review";
    default:
      return "Auto-detect";
  }
}

function formatQueryTypeLabel(type: GovernanceQueryType) {
  switch (type) {
    case "contradiction_review":
      return "Contradiction review";
    case "chronology_review":
      return "Chronology review";
    case "case_review":
      return "Case review";
    case "question_review":
      return "Question review";
    default:
      return "Broad scan";
  }
}

function formatRetrievalConfidenceLabel(value: "high" | "medium" | "low") {
  switch (value) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    default:
      return "Low confidence";
  }
}

function formatCoverageFamilyLabel(
  value: "anchor" | "metadata" | "graph" | "chunk",
) {
  switch (value) {
    case "anchor":
      return "Anchor coverage";
    case "metadata":
      return "Metadata coverage";
    case "graph":
      return "Governance graph";
    default:
      return "Raw chunk support";
  }
}

function formatDiversityBalancedByLabel(value: string) {
  switch (value) {
    case "Issue coverage":
      return "Balanced by issue";
    case "Agency coverage":
      return "Balanced by agency";
    case "Source-family coverage":
      return "Balanced by source family";
    default:
      return value;
  }
}

function formatTemporalModeLabel(
  value: "current_preference" | "historical_neutral" | "neutral",
) {
  switch (value) {
    case "current_preference":
      return "Current-state preference";
    case "historical_neutral":
      return "Historical neutrality";
    default:
      return "Temporal neutral";
  }
}

function formatRelationTypeLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCaseTrailEventTypeLabel(
  value: "document" | "conflict_cluster" | "override_hint" | "override_chain",
) {
  switch (value) {
    case "document":
      return "Document";
    case "conflict_cluster":
      return "Conflict cluster";
    case "override_chain":
      return "Override chain";
    default:
      return "Override hint";
  }
}

function formatComparisonSurfaceLabel(value: string) {
  switch (value) {
    case "conflict":
      return "Conflict-heavy pair";
    case "temporal_shift_candidate":
      return "Position shift pair";
    case "scope_variant_candidate":
      return "Scope variant pair";
    case "alignment":
      return "Alignment pair";
    default:
      return "Reference-linked pair";
  }
}

function formatContradictionBucketLabel(
  value:
    | "conflict"
    | "alignment"
    | "temporal_shift_candidate"
    | "scope_variant_candidate"
    | "reference",
) {
  switch (value) {
    case "conflict":
      return "Conflict";
    case "temporal_shift_candidate":
      return "Position shift candidate";
    case "scope_variant_candidate":
      return "Scope variant candidate";
    case "alignment":
      return "Alignment";
    default:
      return "Reference";
  }
}

function formatRetrievalLaneLabel(
  value:
    | "anchor"
    | "metadata"
    | "issue_graph"
    | "claim_graph"
    | "event_graph"
    | "gap_graph"
    | "relation_graph"
    | "keyword_chunk"
    | "semantic_chunk",
) {
  switch (value) {
    case "anchor":
      return "Anchor";
    case "metadata":
      return "Metadata";
    case "issue_graph":
      return "Issue graph";
    case "claim_graph":
      return "Claim graph";
    case "event_graph":
      return "Event graph";
    case "gap_graph":
      return "Gap graph";
    case "relation_graph":
      return "Relation graph";
    case "keyword_chunk":
      return "Keyword chunk";
    default:
      return "Semantic chunk";
  }
}

function toWorkspaceSurfaceMode(mode: WorkspaceIntakeMode): "map" | "case" {
  return mode === "case_trace" || mode === "question_review" ? "case" : "map";
}

type ProvenanceSelection = {
  title: string;
  subtitle: string | null;
  narrative: string | null;
  chips: string[];
  provenance: GovernanceProvenance | null;
};

type NotebookLaunchAction = {
  key: NotebookTemplateKey;
  label: string;
  description: string;
  enabled: boolean;
  accentClass: string;
  chips: string[];
};

function notebookLaunchMeta(key: NotebookTemplateKey) {
  switch (key) {
    case "governance_brief":
      return {
        label: "Governance Brief",
        description:
          "Capture the active governance map with agencies, issues, and evidence-linked findings.",
        accentClass:
          "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
        icon: <BookOpen className="h-4 w-4" />,
      };
    case "contradiction_brief":
      return {
        label: "Contradiction Brief",
        description:
          "Summarize conflicting institutional positions for the active issue with traceable evidence.",
        accentClass:
          "border-amber-200 bg-amber-50/70 text-amber-950 hover:border-amber-300 hover:bg-amber-50",
        icon: <GitBranch className="h-4 w-4" />,
      };
    case "agency_comparison_summary":
      return {
        label: "Agency Comparison",
        description:
          "Compare the selected agency against adjacent institutions in the current governance lens.",
        accentClass:
          "border-emerald-200 bg-emerald-50/70 text-emerald-950 hover:border-emerald-300 hover:bg-emerald-50",
        icon: <Building2 className="h-4 w-4" />,
      };
    case "issue_landscape_summary":
      return {
        label: "Issue Landscape",
        description:
          "Turn the active issue into a structured landscape summary grounded in cross-document evidence.",
        accentClass:
          "border-sky-200 bg-sky-50/70 text-sky-950 hover:border-sky-300 hover:bg-sky-50",
        icon: <Landmark className="h-4 w-4" />,
      };
    case "case_timeline_note":
      return {
        label: "Case Timeline",
        description:
          "Create a chronology note for the current issue with actor-linked events and positions.",
        accentClass:
          "border-violet-200 bg-violet-50/70 text-violet-950 hover:border-violet-300 hover:bg-violet-50",
        icon: <Network className="h-4 w-4" />,
      };
    case "accountability_coordination_gap_note":
      return {
        label: "Gap Note",
        description:
          "Document accountability and coordination failures around the active issue and agency lens.",
        accentClass:
          "border-rose-200 bg-rose-50/70 text-rose-950 hover:border-rose-300 hover:bg-rose-50",
        icon: <AlertCircle className="h-4 w-4" />,
      };
    case "question_review_brief":
      return {
        label: "Question Review",
        description:
          "Create an evidence-backed answer note with factors, chronology, actor inputs, gaps, and citation audit.",
        accentClass:
          "border-indigo-200 bg-indigo-50/70 text-indigo-950 hover:border-indigo-300 hover:bg-indigo-50",
        icon: <FileText className="h-4 w-4" />,
      };
    default:
      return {
        label: "Notebook Note",
        description: "Launch a reusable governance notebook note.",
        accentClass:
          "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
        icon: <FileText className="h-4 w-4" />,
      };
  }
}

const relationOptions: Array<{ value: RelationFilter; label: string }> = [
  { value: "all", label: "All relations" },
  { value: "contradiction", label: "Contradictions" },
  { value: "tension", label: "Tensions" },
  { value: "override", label: "Overrides" },
  { value: "reinforcement", label: "Reinforcements" },
  { value: "alignment", label: "Alignments" },
  { value: "duplication", label: "Duplications" },
  { value: "reference", label: "References" },
  { value: "supersedes", label: "Supersedes" },
  { value: "other", label: "Other" },
];

const governanceIssueKindOptions = ["GOVERNANCE_ISSUE", "CASE_FILE"] as const;

const governanceIssueStatusOptions = [
  "OPEN",
  "MONITORING",
  "RESOLVED",
  "CLOSED",
  "ARCHIVED",
] as const;

const governanceAgencyCategoryOptions = [
  "REGULATOR",
  "JUDICIARY",
  "MINISTRY",
  "EXECUTIVE",
  "LOCAL_BODY",
  "RESEARCH_BODY",
  "CIVIL_SOCIETY",
  "PRIVATE_SECTOR",
  "OTHER",
] as const;

const sourceScopeOptions: Array<{
  value: GovernanceWorkspaceSourceScope;
  label: string;
  help: string;
}> = [
  {
    value: "files",
    label: "File Manager",
    help: "Prefer file-backed evidence as the starting retrieval scope.",
  },
  {
    value: "urls",
    label: "Saved URLs",
    help: "Prefer URL-backed evidence as the starting retrieval scope.",
  },
  {
    value: "mixed",
    label: "Mixed anchors",
    help: "Start from both file and URL anchors together.",
  },
  {
    value: "all",
    label: "All sources",
    help: "Do not constrain retrieval to a single source family.",
  },
];

function formatSourceScopeLabel(scope: GovernanceWorkspaceSourceScope) {
  switch (scope) {
    case "files":
      return "File Manager";
    case "urls":
      return "Saved URLs";
    case "mixed":
      return "Mixed anchors";
    default:
      return "All sources";
  }
}

function getPrimaryAnchorDocumentId(intent?: GovernanceWorkspaceIntent | null) {
  return (
    intent?.anchorDocumentIds?.find((id) => String(id).trim().length > 0) ??
    (typeof intent?.documentId === "string" &&
    intent.documentId.trim().length > 0
      ? intent.documentId.trim()
      : null)
  );
}

function getPrimaryAnchorUrlId(intent?: GovernanceWorkspaceIntent | null) {
  return (
    intent?.anchorUrlIds?.find((id) => Number.isFinite(id)) ??
    (typeof intent?.urlId === "number" && Number.isFinite(intent.urlId)
      ? intent.urlId
      : null)
  );
}

function humanizeEnumValue(value?: string | null, fallback = "Unspecified") {
  const text = String(value || "").trim();
  if (!text) return fallback;

  return text
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown date";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatShortDate(value?: string | null) {
  if (!value) return "Undated";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

function compactText(value?: string | null, fallback = "—") {
  const text = String(value || "").trim();
  return text || fallback;
}

function confidencePct(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function confidenceTone(value?: number | null) {
  const pct = confidencePct(value);
  if (pct === null) return "border-slate-200 bg-slate-50 text-slate-700";
  if (pct >= 80) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (pct >= 60) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function confidenceLabel(value?: number | null) {
  const pct = confidencePct(value);
  return pct === null ? "Confidence unscored" : `${pct}% extraction confidence`;
}

function prettifyTokenLabel(value?: string | null, fallback = "Unspecified") {
  const text = String(value || "").trim();
  if (!text) return fallback;

  return text
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function gapSeverityTone(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  if (value >= 0.8) return "border-rose-200 bg-rose-50 text-rose-800";
  if (value >= 0.5) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function relationDirectionLabel(direction: "outgoing" | "incoming") {
  return direction === "outgoing" ? "Outgoing relation" : "Incoming relation";
}

function prettifyAuditAction(action: string) {
  return String(action || "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function openArtifactPreview(provenance: GovernanceProvenance | null) {
  const fileId = provenance?.documentRevision?.storedFile?.id;
  if (!fileId) return;
  window.open(apiUrl(`/api/files/${fileId}/preview`), "_blank", "noopener");
}

function MetricCard({
  label,
  value,
  icon,
  tone,
  detail,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: "emerald" | "blue" | "violet" | "slate";
  detail: string;
}) {
  const toneMap: Record<string, string> = {
    emerald:
      "from-emerald-500/18 via-emerald-400/10 to-transparent border-emerald-200/70",
    blue: "from-sky-500/18 via-blue-400/10 to-transparent border-sky-200/70",
    violet:
      "from-violet-500/18 via-fuchsia-400/10 to-transparent border-violet-200/70",
    slate:
      "from-slate-500/12 via-slate-300/8 to-transparent border-slate-200/70",
  };

  return (
    <SmartCard
      className={`overflow-hidden border bg-white/80 backdrop-blur-sm ${toneMap[tone]}`}
      tabIndex={-1}
    >
      <div className="relative p-4">
        <div className="absolute inset-0 bg-gradient-to-br pointer-events-none opacity-90" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {value}
            </div>
            <div className="mt-2 text-sm text-slate-600">{detail}</div>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/75 p-3 text-slate-700 shadow-sm">
            {icon}
          </div>
        </div>
      </div>
    </SmartCard>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-slate-900">
          <span className="rounded-xl border border-white/60 bg-white/80 p-2 shadow-sm">
            {icon}
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-slate-600">{subtitle}</p>
          </div>
        </div>
      </div>
      {action}
    </div>
  );
}


function formatCaveatKind(value: string) {
  return humanizeEnumValue(value, "Caveat");
}

function openGovernanceCitation(citation: GovernanceAnswerCitation) {
  if (citation.sourceUrl) {
    window.open(citation.sourceUrl, "_blank", "noopener");
    return;
  }

  if (citation.fileId) {
    window.open(apiUrl(`/api/files/${citation.fileId}/preview`), "_blank", "noopener");
  }
}

function buildGovernanceAnswerNoteContent(run: GovernanceAnswerRun) {
  const citationLines = (run.citations ?? [])
    .slice(0, 40)
    .map((citation, index) => {
      const label = citation.sourceLabel || citation.fileName || citation.sourceUrl || citation.evidenceId;
      const where = [
        citation.pageStart != null ? `p. ${citation.pageStart}` : null,
        citation.charStart != null ? `chars ${citation.charStart}-${citation.charEnd ?? "?"}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `${index + 1}. ${label}${where ? ` (${where})` : ""} — “${citation.quote}”`;
    });

  const evidenceLines = (run.evidence ?? [])
    .slice(0, 12)
    .map((item) => `- **${item.title}**: ${item.summary}`);

  const caveatLines = (run.caveats ?? [])
    .slice(0, 8)
    .map((item) => `- **${formatCaveatKind(item.kind)}:** ${item.text}`);

  return [
    `# Governance answer — ${run.question}`,
    "",
    "## Answer",
    run.answer || "",
    "",
    evidenceLines.length ? "## Evidence cards" : "",
    evidenceLines.join("\n"),
    "",
    caveatLines.length ? "## Caveats / suggestions" : "",
    caveatLines.join("\n"),
    "",
    run.openQuestions?.length ? "## Open checks" : "",
    (run.openQuestions ?? []).slice(0, 8).map((item) => `- ${item}`).join("\n"),
    "",
    citationLines.length ? "## Preserved citations" : "",
    citationLines.join("\n"),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function normalizeGovernanceCitationKind(
  value: GovernanceAnswerCitation["sourceKind"],
): SourceKind | null {
  return value === "URL" || value === "FILE" ? value : null;
}

function toNotebookCitation(citation: GovernanceAnswerCitation): Citation {
  return {
    chunkId: citation.chunkId ?? citation.evidenceId,
    quote: citation.quote,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
    charStart: citation.charStart,
    charEnd: citation.charEnd,
    sourceId: citation.sourceId,
    sourceKind: normalizeGovernanceCitationKind(citation.sourceKind),
    sourceLabel: citation.sourceLabel,
    sourceUrl: citation.sourceUrl,
    fileName: citation.fileName,
    sourceRevisionId: citation.sourceRevisionId,
    documentRevisionId: citation.documentRevisionId,
    pipelineConfigId: citation.pipelineConfigId,
  };
}

function toNotebookEvidenceBlock(
  evidence: NonNullable<GovernanceAnswerRun["evidence"]>[number],
): EvidenceBlock {
  return {
    claim: [evidence.title, evidence.summary].filter(Boolean).join(": "),
    citations: (evidence.citations ?? []).map(toNotebookCitation),
  };
}

function toNotebookClaimLink(
  link: NonNullable<GovernanceAnswerRun["claimCitations"]>[number],
): ClaimCitationLink {
  const citations = (link.citations ?? []).map(toNotebookCitation);
  return {
    claim: link.claim,
    status: citations.length ? "linked" : "review_needed",
    source: "evidence",
    supportScore: citations.length ? 1 : 0,
    citations,
  };
}

function GovernanceAnswerPanel({
  run,
  draftText,
  status,
  loading,
  error,
  followUpQuestion,
  setFollowUpQuestion,
  onSubmitFollowUp,
  onRegenerate,
  onDeepReview,
  onCopy,
  onExport,
  exporting,
}: {
  run: GovernanceAnswerRun | null;
  draftText: string;
  status: string | null;
  loading: boolean;
  error: string | null;
  followUpQuestion: string;
  setFollowUpQuestion: (value: string) => void;
  onSubmitFollowUp: () => void;
  onRegenerate: () => void;
  onDeepReview: () => void;
  onCopy: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const answerText = run?.answer || draftText;
  const citations = run?.citations ?? [];
  const hasAnswer = Boolean(answerText.trim()) || Boolean(run);

  return (
    <div className="rounded-[26px] border border-indigo-100 bg-white/90 p-4 shadow-[0_18px_44px_rgba(79,70,229,0.10)] backdrop-blur-sm">
      <SectionHeader
        icon={<Sparkles className="h-4 w-4" />}
        title="Inline cited answer"
        subtitle="Persisted Governance Workspace Q&A with strict evidence citations."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {run?.model ? (
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                {run.model}
              </span>
            ) : null}
            {run?.groundingStatus ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {humanizeEnumValue(run.groundingStatus, "Grounding")}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="mt-4 space-y-4">
        {loading || status ? (
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{status ?? "Answer ready"}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-800">
            {error}
          </div>
        ) : null}

        {hasAnswer ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
              {answerText}
            </div>
          </div>
        ) : (
          <EmptyPanel
            title="No synthesized answer yet"
            body="Run a governance question; the answer layer will start after evidence retrieval succeeds."
          />
        )}

        {citations.length ? (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Citation chips
            </div>
            <div className="flex flex-wrap gap-2">
              {citations.slice(0, 12).map((citation, index) => (
                <button
                  key={`${citation.evidenceId}-${index}`}
                  type="button"
                  onClick={() => openGovernanceCitation(citation)}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700"
                  title={citation.quote}
                >
                  <span className="max-w-[14rem] truncate">
                    {citation.sourceLabel || citation.evidenceId}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {run?.evidence?.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {run.evidence.slice(0, 6).map((item) => (
              <div
                key={item.evidenceId}
                className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="text-sm font-semibold text-slate-900">
                  {item.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {item.summary}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.citations.slice(0, 3).map((citation, index) => (
                    <button
                      key={`${item.evidenceId}-cite-${index}`}
                      type="button"
                      onClick={() => openGovernanceCitation(citation)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-white"
                      title={citation.quote}
                    >
                      Evidence {index + 1}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {run?.caveats?.length || run?.openQuestions?.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {run.caveats?.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                <div className="text-sm font-semibold text-amber-950">
                  Caveats and suggestions
                </div>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-900">
                  {run.caveats.slice(0, 6).map((item, index) => (
                    <li key={`${item.kind}-${index}`}>
                      <span className="font-semibold">{formatCaveatKind(item.kind)}:</span>{" "}
                      {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {run.openQuestions?.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-semibold text-slate-900">
                  Open checks
                </div>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                  {run.openQuestions.slice(0, 6).map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {run?.suggestedFollowUps?.length ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Suggested follow-ups
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {run.suggestedFollowUps.slice(0, 6).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFollowUpQuestion(item)}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-white"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr),auto]">
          <input
            value={followUpQuestion}
            onChange={(event) => setFollowUpQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmitFollowUp();
              }
            }}
            placeholder="Ask a follow-up in the same answer session"
            className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={onSubmitFollowUp}
            disabled={!followUpQuestion.trim() || loading}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-900/10 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ask follow-up
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Regenerate
          </button>
          <button
            type="button"
            onClick={onDeepReview}
            disabled={loading}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-white disabled:opacity-50"
          >
            Deep review
          </button>
          <button
            type="button"
            onClick={onCopy}
            disabled={!answerText.trim()}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Copy answer
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={!run || exporting}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export to Notebook"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-sm text-slate-600">
      <div className="font-medium text-slate-900">{title}</div>
      <p className="mt-2 leading-6">{body}</p>
    </div>
  );
}

export default function GovernanceWorkspacePage() {
  const [launchIntent, setLaunchIntent] =
    useState<GovernanceWorkspaceIntent | null>(null);
  const [documentInput, setDocumentInput] = useState("");
  const [workspaceQuestion, setWorkspaceQuestion] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [workspaceIntentMode, setWorkspaceIntentMode] =
    useState<WorkspaceIntakeMode>("auto");
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [sourceScope, setSourceScope] =
    useState<GovernanceWorkspaceSourceScope>("all");
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState<RelationFilter>("all");
  const [selectedProvenance, setSelectedProvenance] =
    useState<ProvenanceSelection | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"map" | "case">("map");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templatePreset, setTemplatePreset] =
    useState<NotebookTemplateKey>("governance_brief");
  const [workspaceQueryRunKey, setWorkspaceQueryRunKey] = useState(0);
  const [answerSessionId, setAnswerSessionId] = useState<string | null>(null);
  const [answerRun, setAnswerRun] = useState<GovernanceAnswerRun | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const [answerStatus, setAnswerStatus] = useState<string | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerExporting, setAnswerExporting] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const answerAbortRef = useRef<AbortController | null>(null);
  const lastAutoAnswerKeyRef = useRef("");
  const constrainedPurposeId = launchIntent?.collectorPurposeId ?? null;
  const constrainedPurposeTitle =
    launchIntent?.collectorPurposeTitle ?? launchIntent?.title ?? "Selected purpose";

  const [issueSearch, setIssueSearch] = useState("");
  const [issueKindFilter, setIssueKindFilter] = useState("");
  const [issueStatusFilter, setIssueStatusFilter] = useState("");
  const [agencySearch, setAgencySearch] = useState("");
  const [agencyCategoryFilter, setAgencyCategoryFilter] = useState("");
  const [agencyJurisdictionFilter, setAgencyJurisdictionFilter] = useState("");

  const evidenceDocumentId =
    selectedProvenance?.provenance?.sourceDocument?.id ?? null;

  const evidenceAuditQuery = useQuery({
    queryKey: ["governance-evidence-audit", evidenceDocumentId],
    enabled: Boolean(evidenceDocumentId),
    queryFn: async () =>
      getAuditLogs({
        resourceType: "DOCUMENT",
        resourceId: String(evidenceDocumentId),
        limit: 6,
      }),
  });

  useEffect(() => {
    const pending = consumeGovernanceWorkspaceIntent();
    if (!pending) return;

    setLaunchIntent(pending);
    setSourceScope(pending.sourceScope ?? "all");
    setWorkspaceQuestion(pending.question ?? "");

    const primaryAnchorDocumentId = getPrimaryAnchorDocumentId(pending);

    if (primaryAnchorDocumentId) {
      setDocumentInput(primaryAnchorDocumentId);
      setActiveDocumentId(primaryAnchorDocumentId);
    }

    if (pending.selectedIssueId) {
      setSelectedIssueId(pending.selectedIssueId);
    }

    if (pending.selectedAgencyId) {
      setSelectedAgencyId(pending.selectedAgencyId);
    }

    const normalizedIntentMode = normalizeWorkspaceIntentMode(
      pending.preferredMode,
    );
    setWorkspaceIntentMode(normalizedIntentMode);
    setWorkspaceMode(toWorkspaceSurfaceMode(normalizedIntentMode));

    if (
      pending.question?.trim() ||
      pending.anchorDocumentIds?.length ||
      pending.anchorUrlIds?.length
    ) {
      setWorkspaceQueryRunKey((current) => current + 1);
    }
  }, []);

  const primaryAnchorUrlId = getPrimaryAnchorUrlId(launchIntent);

  const runWorkspaceEvidenceSearch = React.useCallback(() => {
    const hasQuestion = workspaceQuestion.trim().length > 0;
    const hasAnchors =
      Boolean(launchIntent?.anchorDocumentIds?.length) ||
      Boolean(launchIntent?.anchorUrlIds?.length);

    if (!hasQuestion && !hasAnchors) return;
    setWorkspaceQueryRunKey((current) => current + 1);
  }, [
    workspaceQuestion,
    launchIntent?.anchorDocumentIds,
    launchIntent?.anchorUrlIds,
  ]);

  const clearAnchorIntake = React.useCallback(() => {
    setLaunchIntent((current) => {
      if (!current) return null;

      return {
        ...current,
        anchorDocumentIds: [],
        anchorUrlIds: [],
        documentId: null,
        urlId: null,
        sourceScope: "all",
      };
    });
  }, []);

  const clearAdvancedFilters = React.useCallback(() => {
    setDocumentInput("");
    setSourceScope("all");
    clearAnchorIntake();
    setShowAdvancedFilters(false);
  }, [clearAnchorIntake]);

  useEffect(() => {
    const el = questionInputRef.current;
    if (!el) return;

    el.style.height = "0px";
    const nextHeight = Math.max(92, Math.min(el.scrollHeight, 176));
    el.style.height = `${nextHeight}px`;
  }, [workspaceQuestion]);

  const urlResolutionQuery = useQuery({
    queryKey: ["governance-workspace", "resolve-url", primaryAnchorUrlId],
    enabled: Boolean(primaryAnchorUrlId) && !activeDocumentId,
    queryFn: async () => getUrlRevisions(Number(primaryAnchorUrlId), 1),
  });

  useEffect(() => {
    if (urlResolutionQuery.data?.documentId) {
      setDocumentInput(urlResolutionQuery.data.documentId);
      setActiveDocumentId(urlResolutionQuery.data.documentId);
    }
  }, [urlResolutionQuery.data?.documentId]);

  const workspaceEvidenceQuery = useQuery({
    queryKey: [
      "governance-workspace-evidence",
      workspaceQueryRunKey,
      workspaceQuestion,
      workspaceIntentMode,
      sourceScope,
      launchIntent?.anchorDocumentIds?.join("|") ?? "",
      launchIntent?.anchorUrlIds?.join("|") ?? "",
      constrainedPurposeId ?? "",
    ],
    enabled:
      workspaceQueryRunKey > 0 &&
      (workspaceQuestion.trim().length > 0 ||
        Boolean(launchIntent?.anchorDocumentIds?.length) ||
        Boolean(launchIntent?.anchorUrlIds?.length)),
    queryFn: async () =>
      queryGovernanceWorkspaceEvidence({
        question: workspaceQuestion.trim() || undefined,
        workflowMode: workspaceIntentMode,
        anchorDocumentIds: launchIntent?.anchorDocumentIds ?? [],
        anchorUrlIds: launchIntent?.anchorUrlIds ?? [],
        sourceScope,
        limit: 8,
        collectorPurposeId: constrainedPurposeId,
      }),
  });

  useEffect(() => {
    const selectedDocumentId = workspaceEvidenceQuery.data?.selectedDocumentId;
    if (!selectedDocumentId) return;
    if (selectedDocumentId === activeDocumentId) return;

    setDocumentInput(selectedDocumentId);
    setActiveDocumentId(selectedDocumentId);
    setSelectedProvenance(null);
  }, [workspaceEvidenceQuery.data?.selectedDocumentId, activeDocumentId]);

  useEffect(() => {
    const resolvedMode = workspaceEvidenceQuery.data?.workflow?.resolvedMode;
    if (!resolvedMode) return;

    setWorkspaceMode(resolvedMode === "landscape" ? "map" : "case");
  }, [workspaceEvidenceQuery.data?.workflow?.resolvedMode]);

  const documentQuery = useQuery({
    queryKey: ["governance-document", activeDocumentId],
    enabled: Boolean(activeDocumentId),
    queryFn: async () =>
      getDocumentGovernance(String(activeDocumentId), { limit: 160 }),
  });

  const overview = documentQuery.data ?? null;

  const issueDirectoryQuery = useQuery({
    queryKey: [
      "governance-issues-directory",
      issueSearch,
      issueKindFilter,
      issueStatusFilter,
      selectedAgencyId,
    ],
    queryFn: async () =>
      getGovernanceIssuesDirectory({
        q: issueSearch || undefined,
        kind: issueKindFilter || undefined,
        status: issueStatusFilter || undefined,
        agencyId: selectedAgencyId || undefined,
        limit: 40,
      }),
  });

  const agencyDirectoryQuery = useQuery({
    queryKey: [
      "governance-agencies-directory",
      agencySearch,
      agencyCategoryFilter,
      agencyJurisdictionFilter,
      selectedIssueId,
    ],
    queryFn: async () =>
      getGovernanceAgenciesDirectory({
        q: agencySearch || undefined,
        category: agencyCategoryFilter || undefined,
        jurisdiction: agencyJurisdictionFilter || undefined,
        issueId: selectedIssueId || undefined,
        limit: 40,
      }),
  });

  const issueDirectoryItems = issueDirectoryQuery.data?.items ?? [];
  const agencyDirectoryItems = agencyDirectoryQuery.data?.items ?? [];

  useEffect(() => {
    if (!issueDirectoryItems.length) return;
    if (
      selectedIssueId &&
      issueDirectoryItems.some((issue) => issue.id === selectedIssueId)
    ) {
      return;
    }

    setSelectedIssueId(issueDirectoryItems[0]?.id ?? null);
    setSelectedProvenance(null);
  }, [issueDirectoryItems, selectedIssueId]);

  useEffect(() => {
    if (!agencyDirectoryItems.length) return;
    if (
      selectedAgencyId &&
      agencyDirectoryItems.some((agency) => agency.id === selectedAgencyId)
    ) {
      return;
    }

    setSelectedAgencyId(agencyDirectoryItems[0]?.id ?? null);
    setSelectedProvenance(null);
  }, [agencyDirectoryItems, selectedAgencyId]);

  useEffect(() => {
    if (!selectedIssueId && workspaceMode === "case") {
      setWorkspaceMode("map");
    }
  }, [selectedIssueId, workspaceMode]);

  const timelineQuery = useQuery({
    queryKey: ["governance-issue-timeline", selectedIssueId],
    enabled: Boolean(selectedIssueId),
    queryFn: async () =>
      getGovernanceIssueTimeline(String(selectedIssueId), {
        limit: 200,
      }),
  });

  const relationsQuery = useQuery({
    queryKey: ["governance-issue-relations", selectedIssueId, relationFilter],
    enabled: Boolean(selectedIssueId),
    queryFn: async () =>
      getGovernanceIssueRelations(String(selectedIssueId), {
        relationType: relationFilter === "all" ? undefined : relationFilter,
        limit: 200,
      }),
  });

  const agencyLandscapeQuery = useQuery({
    queryKey: ["governance-agency-landscape", selectedAgencyId],
    enabled: Boolean(selectedAgencyId),
    queryFn: async () =>
      getGovernanceAgencyLandscape(String(selectedAgencyId), {
        limit: 160,
      }),
  });

  const selectedIssue = useMemo<GovernanceIssue | null>(() => {
    if (!selectedIssueId) return null;

    return (
      issueDirectoryItems.find((issue) => issue.id === selectedIssueId) ??
      overview?.issues.find((issue) => issue.id === selectedIssueId) ??
      timelineQuery.data?.issue ??
      relationsQuery.data?.issue ??
      null
    );
  }, [
    issueDirectoryItems,
    overview,
    selectedIssueId,
    timelineQuery.data?.issue,
    relationsQuery.data?.issue,
  ]);

  const selectedAgency = useMemo<GovernanceAgency | null>(() => {
    if (!selectedAgencyId) return null;

    return (
      agencyDirectoryItems.find((agency) => agency.id === selectedAgencyId) ??
      overview?.agencies.find((agency) => agency.id === selectedAgencyId) ??
      agencyLandscapeQuery.data?.agency ??
      null
    );
  }, [
    agencyDirectoryItems,
    overview,
    selectedAgencyId,
    agencyLandscapeQuery.data?.agency,
  ]);

  useEffect(() => {
    if (selectedProvenance) return;

    const firstTimeline = timelineQuery.data?.entries[0];
    if (firstTimeline?.provenance) {
      setSelectedProvenance({
        title: firstTimeline.label,
        subtitle: firstTimeline.actorAgency?.name ?? firstTimeline.itemType,
        narrative:
          firstTimeline.summary ??
          firstTimeline.position?.stanceSummary ??
          firstTimeline.position?.stanceText ??
          firstTimeline.event?.summary ??
          null,
        chips: [
          firstTimeline.itemType,
          firstTimeline.sortPrecision,
          firstTimeline.actorAgency?.name ?? "Unattributed",
        ].filter((chip): chip is string => Boolean(chip)),
        provenance: firstTimeline.provenance,
      });
    }
  }, [selectedProvenance, timelineQuery.data]);

  const busy =
    workspaceEvidenceQuery.isLoading ||
    documentQuery.isLoading ||
    urlResolutionQuery.isLoading ||
    issueDirectoryQuery.isLoading ||
    agencyDirectoryQuery.isLoading ||
    timelineQuery.isLoading ||
    relationsQuery.isLoading ||
    agencyLandscapeQuery.isLoading;

  const anyError =
    (workspaceEvidenceQuery.error as Error | null) ||
    (urlResolutionQuery.error as Error | null) ||
    (documentQuery.error as Error | null) ||
    (issueDirectoryQuery.error as Error | null) ||
    (agencyDirectoryQuery.error as Error | null) ||
    (timelineQuery.error as Error | null) ||
    (relationsQuery.error as Error | null) ||
    (agencyLandscapeQuery.error as Error | null);

  const sourceDescriptor =
    launchIntent?.sourceLabel ??
    overview?.document.kind ??
    "Bring in a document from File Manager or Saved URLs";

  const sourceScopeLabel = formatSourceScopeLabel(sourceScope);
  const anchorDocumentCount = launchIntent?.anchorDocumentIds?.length ?? 0;
  const anchorUrlCount = launchIntent?.anchorUrlIds?.length ?? 0;
  const hasPinnedAnchors = anchorDocumentCount > 0 || anchorUrlCount > 0;
  const exactLookupId = documentInput.trim();
  const hasAdvancedFiltersApplied =
    exactLookupId.length > 0 || hasPinnedAnchors || sourceScope !== "all";
  const evidenceCandidates = workspaceEvidenceQuery.data?.candidates ?? [];

  const startGovernanceAnswer = React.useCallback(
    async (question: string, options?: { deepReview?: boolean; previousRunId?: string | null }) => {
      const trimmedQuestion = question.trim();
      if (!trimmedQuestion) return;

      answerAbortRef.current?.abort();
      const controller = new AbortController();
      answerAbortRef.current = controller;

      setAnswerLoading(true);
      setAnswerError(null);
      setAnswerStatus("Retrieving evidence");
      setAnswerDraft("");

      let finalSeen = false;

      const previousRunId =
        options && Object.prototype.hasOwnProperty.call(options, "previousRunId")
          ? options.previousRunId ?? null
          : answerRun?.id ?? null;
      const includeHistory = Boolean(previousRunId && answerRun?.answer);

      try {
        await streamGovernanceWorkspaceAnswer(
          {
            question: trimmedQuestion,
            sessionId: answerSessionId,
            previousRunId,
            history: includeHistory
              ? [
                  { role: "user", content: answerRun!.question },
                  { role: "assistant", content: answerRun!.answer || "" },
                ]
              : undefined,
            anchorDocumentIds: launchIntent?.anchorDocumentIds ?? [],
            anchorUrlIds: launchIntent?.anchorUrlIds ?? [],
            sourceScope,
            workflowMode: workspaceIntentMode,
            selectedIssueId,
            selectedAgencyId,
            collectorPurposeId: constrainedPurposeId,
            limit: 12,
            deepReview: options?.deepReview === true,
          },
          (event) => {
            switch (event.event) {
              case "run":
                setAnswerSessionId(event.data.sessionId);
                setAnswerStatus("Answer run started");
                break;
              case "status":
                setAnswerStatus(event.data.message);
                break;
              case "delta":
                setAnswerDraft((current) => current + event.data.text);
                break;
              case "final":
                finalSeen = true;
                setAnswerSessionId(event.data.sessionId);
                setAnswerRun(event.data.run);
                setAnswerDraft(event.data.run.answer ?? "");
                setAnswerStatus("Answer saved");
                break;
              case "error":
                setAnswerError(event.data.message || "Governance answer generation failed.");
                break;
              default:
                break;
            }
          },
          controller.signal,
        );
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setAnswerError(err?.message || "Governance answer generation failed.");
        }
      } finally {
        if (answerAbortRef.current === controller) {
          answerAbortRef.current = null;
        }
        setAnswerLoading(false);
        if (!finalSeen) {
          setAnswerStatus(null);
        }
      }
    },
    [
      answerRun,
      answerSessionId,
      launchIntent?.anchorDocumentIds,
      launchIntent?.anchorUrlIds,
      selectedAgencyId,
      selectedIssueId,
      sourceScope,
      workspaceIntentMode,
      constrainedPurposeId,
    ],
  );

  useEffect(() => {
    return () => {
      answerAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!workspaceEvidenceQuery.data || workspaceEvidenceQuery.isLoading) return;
    if (
      constrainedPurposeId &&
      (workspaceEvidenceQuery.data.evidenceScope?.allowedDocumentIds.length ?? 0) === 0
    ) {
      return;
    }
    const question = workspaceQuestion.trim();
    if (!question) return;

    const key = [
      workspaceQueryRunKey,
      question,
      workspaceIntentMode,
      sourceScope,
      launchIntent?.anchorDocumentIds?.join("|") ?? "",
      launchIntent?.anchorUrlIds?.join("|") ?? "",
      constrainedPurposeId ?? "",
    ].join("::");

    if (lastAutoAnswerKeyRef.current === key) return;
    lastAutoAnswerKeyRef.current = key;
    void startGovernanceAnswer(question, { previousRunId: null });
  }, [
    launchIntent?.anchorDocumentIds,
    launchIntent?.anchorUrlIds,
    constrainedPurposeId,
    sourceScope,
    startGovernanceAnswer,
    workspaceEvidenceQuery.data,
    workspaceEvidenceQuery.isLoading,
    workspaceIntentMode,
    workspaceQueryRunKey,
    workspaceQuestion,
  ]);

  const submitFollowUpAnswer = React.useCallback(() => {
    const question = followUpQuestion.trim();
    if (!question) return;
    setFollowUpQuestion("");
    void startGovernanceAnswer(question, { previousRunId: answerRun?.id ?? null });
  }, [answerRun?.id, followUpQuestion, startGovernanceAnswer]);

  const regenerateAnswer = React.useCallback(() => {
    const question = answerRun?.question || workspaceQuestion.trim();
    if (!question) return;
    void startGovernanceAnswer(question, { previousRunId: answerRun?.previousRunId ?? null });
  }, [answerRun?.previousRunId, answerRun?.question, startGovernanceAnswer, workspaceQuestion]);

  const deepReviewAnswer = React.useCallback(() => {
    const question = answerRun?.question || workspaceQuestion.trim();
    if (!question) return;
    void startGovernanceAnswer(question, {
      deepReview: true,
      previousRunId: answerRun?.id ?? null,
    });
  }, [answerRun?.id, answerRun?.question, startGovernanceAnswer, workspaceQuestion]);

  const copyAnswer = React.useCallback(() => {
    const text = answerRun?.answer || answerDraft;
    if (!text.trim()) return;
    void navigator.clipboard?.writeText(text);
  }, [answerDraft, answerRun?.answer]);

  const exportAnswerToNotebook = React.useCallback(async () => {
    if (!answerRun?.answer) return;
    setAnswerExporting(true);
    setAnswerError(null);
    try {
      const notebooks = await notebookClient.listNotebooks();
      let notebook = notebooks.find((item) => item.title === "Governance Answer Sessions");
      if (!notebook) {
        notebook = await notebookClient.createNotebook({
          title: "Governance Answer Sessions",
          description: "Persisted Governance Workspace answer sessions with citation provenance.",
        });
      }

      const note = await notebookClient.createNote(notebook.id, {
        title: `Answer — ${answerRun.question.slice(0, 120)}`,
        content: buildGovernanceAnswerNoteContent(answerRun),
        citations: {
          version: "note-provenance-v1",
          artifacts: [
            {
              kind: "chat-answer",
              createdAt: new Date().toISOString(),
              answer: answerRun.answer,
              citations: (answerRun.citations ?? []).map(toNotebookCitation),
              evidence: (answerRun.evidence ?? []).map(toNotebookEvidenceBlock),
              claimLinks: (answerRun.claimCitations ?? []).map(toNotebookClaimLink),
            },
          ],
        },
      });

      openNotebookWithTarget({ notebookId: notebook.id, noteId: note.id });
    } catch (err: any) {
      setAnswerError(err?.message || "Could not export the governance answer to Notebook.");
    } finally {
      setAnswerExporting(false);
    }
  }, [answerRun]);

  const workflowPlan = useMemo(() => {
    const fromResponse = workspaceEvidenceQuery.data?.workflow;
    if (fromResponse) return fromResponse;

    if (workspaceIntentMode === "case_trace") {
      return {
        requestedMode: "case_trace" as const,
        resolvedMode: "case_trace" as const,
        rationale:
          "The intake is pinned to case tracing, so the workspace will prioritize one-unit trails, chronology, and contradictions.",
        expectedOutputs: [
          "Case trail",
          "Contradiction map",
          "Chronology of records",
        ],
      };
    }

    if (workspaceIntentMode === "question_review") {
      return {
        requestedMode: "question_review" as const,
        resolvedMode: "question_review" as const,
        rationale:
          "The intake is pinned to question review, so the workspace will prioritize evidence-backed answer signals, factors, chronology, actor inputs, and verification gaps.",
        expectedOutputs: [
          "Evidence-backed answer",
          "Factors and chronology",
          "Verification and gap register",
        ],
      };
    }

    if (workspaceIntentMode === "landscape") {
      return {
        requestedMode: "landscape" as const,
        resolvedMode: "landscape" as const,
        rationale:
          "The intake is pinned to landscape mapping, so the workspace will prioritize jurisdiction, active directions, and compliance gaps.",
        expectedOutputs: ["Agency map", "Active directions", "Compliance gaps"],
      };
    }

    return {
      requestedMode: "auto" as const,
      resolvedMode: "landscape" as const,
      rationale:
        "Auto-detect will choose the best workflow after retrieval; until then, the workspace defaults to broad governance scoping.",
      expectedOutputs: ["Agency map", "Active directions", "Top evidence"],
    };
  }, [workspaceEvidenceQuery.data?.workflow, workspaceIntentMode]);

  const queryUnderstanding = workspaceEvidenceQuery.data
    ?.queryUnderstanding ?? {
    queryType:
      workflowPlan.resolvedMode === "question_review"
        ? ("question_review" as const)
        : workflowPlan.resolvedMode === "case_trace"
          ? ("case_review" as const)
        : ("broad_scan" as const),
    focusTerms: workspaceEvidenceQuery.data?.query.tokens ?? [],
    timeHints: [],
    locationHints: [],
    matchedIssues: [],
    matchedAgencies: [],
  };

  const retrievalDecision = workspaceEvidenceQuery.data?.retrievalDecision ?? {
    shouldAutoSelect: false,
    recommendedDocumentId: null,
    confidence: "low" as const,
    rationale:
      "No retrieval decision is available yet. Run a question to generate ranked evidence.",
    topCandidateScore: null,
    runnerUpScore: null,
    scoreMargin: null,
  };

  const temporalControl = workspaceEvidenceQuery.data?.temporalControl ?? {
    active: false,
    mode: "neutral" as const,
    rationale:
      "No strong temporal preference is active until a question signals current-state or historical intent.",
    preferredSignals: [],
  };

  const diversityControl = workspaceEvidenceQuery.data?.diversityControl ?? {
    active: false,
    rationale:
      "Diversity balancing is inactive until a broad evidence run produces enough candidates.",
    balancedBy: [],
  };

  const contradictionFoundation = workspaceEvidenceQuery.data
    ?.contradictionFoundation ?? {
    active: false,
    rationale:
      "No contradiction or override signals are available until a multi-document evidence set is retrieved.",
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

  const overrideChainFoundation = workspaceEvidenceQuery.data
    ?.overrideChainFoundation ?? {
    active: false,
    rationale:
      "No linked override chains are available until override or supersession hints connect into a chronology.",
    summary: {
      chainCount: 0,
      linkedDocumentCount: 0,
    },
    chains: [],
  };

  const comparisonSurface = workspaceEvidenceQuery.data?.comparisonSurface ?? {
    active: false,
    rationale:
      "No document-to-document comparison pairs are available until contradiction and override signals are assembled.",
    summary: {
      comparisonCount: 0,
      reviewCount: 0,
      preferredPairCount: 0,
    },
    comparisons: [],
  };

  const landscapeMappingSurface = workspaceEvidenceQuery.data
    ?.landscapeMappingSurface ?? {
    active: false,
    rationale:
      "No landscape mapping surface is available until a broad governance query assembles enough evidence.",
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

  const caseTracingSurface = workspaceEvidenceQuery.data
    ?.caseTracingSurface ?? {
    active: false,
    rationale:
      "No case-tracing surface is available until a case-focused evidence run assembles contradiction, comparison, or chronology signals.",
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

  const questionReviewSurface = workspaceEvidenceQuery.data
    ?.questionReviewSurface ?? {
    active: false,
    rationale:
      "No question-review surface is available until an evidence-backed question run assembles answer signals.",
    question: workspaceQuestion,
    queryType: queryUnderstanding.queryType,
    summary: {
      sourceCount: 0,
      factorCount: 0,
      timelineHighlightCount: 0,
      actorCount: 0,
      gapCount: 0,
      reviewCount: 0,
    },
    answerSignals: [],
    factors: [],
    timelineHighlights: [],
    actorInputs: [],
    openQuestions: [],
  };

  const caseTrailFoundation = workspaceEvidenceQuery.data
    ?.caseTrailFoundation ?? {
    active: false,
    rationale:
      "No case-trail timeline is available until at least one evidence run assembles chronological signals.",
    summary: {
      eventCount: 0,
      documentEventCount: 0,
      conflictEventCount: 0,
      overrideEventCount: 0,
      overrideChainEventCount: 0,
    },
    events: [],
  };

  const contradictionLinkedDocumentIds = useMemo(
    () => new Set(contradictionFoundation.involvedDocumentIds),
    [contradictionFoundation.involvedDocumentIds],
  );

  const documentSummary = overview?.summary ?? {
    agencyCount: 0,
    issueCount: 0,
    mandateCount: 0,
    claimCount: 0,
    eventCount: 0,
    positionCount: 0,
    gapCount: 0,
    relationCount: 0,
  };

  const notebookLaunchActions = useMemo<NotebookLaunchAction[]>(() => {
    const preferredOrder: NotebookTemplateKey[] =
      workspaceMode === "case"
        ? [
            "question_review_brief",
            "contradiction_brief",
            "case_timeline_note",
            "issue_landscape_summary",
            "accountability_coordination_gap_note",
          ]
        : [
            "governance_brief",
            "agency_comparison_summary",
            "issue_landscape_summary",
            "accountability_coordination_gap_note",
          ];

    return preferredOrder.map((key) => {
      switch (key) {
        case "governance_brief":
          return {
            key,
            label: "Governance Brief",
            description:
              "Capture the current governance map as a reusable notebook artifact.",
            enabled: Boolean(activeDocumentId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              activeDocumentId ? "document ready" : "document required",
              workspaceMode === "map" ? "map mode" : "case mode",
            ],
          };

        case "agency_comparison_summary":
          return {
            key,
            label: "Agency Comparison",
            description:
              "Compare the selected agency against related institutions in the current lens.",
            enabled: Boolean(activeDocumentId && selectedAgencyId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              selectedAgency?.name ?? "agency required",
              selectedIssue?.title ?? "optional issue lens",
            ],
          };

        case "issue_landscape_summary":
          return {
            key,
            label: "Issue Landscape",
            description:
              "Generate a concise issue landscape grounded in the active issue registry row.",
            enabled: Boolean(activeDocumentId && selectedIssueId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              selectedIssue?.title ?? "issue required",
              `${documentSummary.agencyCount} agencies in evidence base`,
            ],
          };

        case "contradiction_brief":
          return {
            key,
            label: "Contradiction Brief",
            description:
              "Summarize tensions, overrides, and conflict candidates for the active issue.",
            enabled: Boolean(activeDocumentId && selectedIssueId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              selectedIssue?.title ?? "issue required",
              relationFilter === "all"
                ? "all relation types"
                : `filter ${relationFilter}`,
            ],
          };

        case "question_review_brief":
          return {
            key,
            label: "Question Review",
            description:
              "Create an evidence-backed answer note with factors, chronology, actor inputs, gaps, and citation audit.",
            enabled: Boolean(activeDocumentId && selectedIssueId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              selectedIssue?.title ?? "issue required",
              workspaceQuestion.trim() ? "question attached" : "issue evidence",
            ],
          };

        case "case_timeline_note":
          return {
            key,
            label: "Case Timeline",
            description:
              "Build a timeline note for the current issue and actor lens.",
            enabled: Boolean(activeDocumentId && selectedIssueId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              selectedIssue?.title ?? "issue required",
              selectedAgency?.name ?? "optional actor lens",
            ],
          };

        case "accountability_coordination_gap_note":
          return {
            key,
            label: "Gap Note",
            description:
              "Capture accountability and coordination failures around the current issue.",
            enabled: Boolean(activeDocumentId && selectedIssueId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [
              selectedIssue?.title ?? "issue required",
              selectedAgency?.name ?? "optional agency lens",
            ],
          };

        default:
          return {
            key,
            label: "Notebook Note",
            description: "Open the notebook template picker.",
            enabled: Boolean(activeDocumentId),
            accentClass: notebookLaunchMeta(key).accentClass,
            chips: [],
          };
      }
    });
  }, [
    activeDocumentId,
    workspaceMode,
    selectedIssueId,
    selectedAgencyId,
    selectedIssue?.title,
    selectedAgency?.name,
    relationFilter,
    workspaceQuestion,
    documentSummary.agencyCount,
  ]);

  const notebookContextChips = [
    activeDocumentId ? `document ${activeDocumentId}` : null,
    selectedIssue?.title ? `issue ${selectedIssue.title}` : null,
    selectedAgency?.name ? `agency ${selectedAgency.name}` : null,
    relationFilter !== "all" ? `relation ${relationFilter}` : null,
    workspaceMode === "case" ? "case review mode" : "governance map mode",
  ].filter((chip): chip is string => Boolean(chip));

  function loadDocumentFromInput() {
    const next = documentInput.trim();
    setSelectedProvenance(null);
    setSelectedIssueId(null);
    setSelectedAgencyId(null);
    setActiveDocumentId(next || null);
  }

  const landscape = agencyLandscapeQuery.data ?? null;
  const timeline = timelineQuery.data ?? null;
  const relations = relationsQuery.data ?? null;

  const selectedLandscapeIssueRow = useMemo(() => {
    if (!landscape || !selectedIssueId) return null;
    return (
      landscape.issueMatrix.find((row) => row.issue.id === selectedIssueId) ??
      null
    );
  }, [landscape, selectedIssueId]);

  const selectedIssueMandates = useMemo(
    () =>
      (landscape?.mandates ?? []).filter(
        (item) => item.issue?.id === selectedIssueId,
      ),
    [landscape, selectedIssueId],
  );

  const selectedIssuePositions = useMemo(
    () =>
      (landscape?.positions ?? []).filter(
        (item) => item.issue?.id === selectedIssueId,
      ),
    [landscape, selectedIssueId],
  );

  const selectedIssueGaps = useMemo(
    () =>
      (landscape?.gaps ?? []).filter(
        (item) => item.issue?.id === selectedIssueId,
      ),
    [landscape, selectedIssueId],
  );

  const selectedIssueOutgoingRelations = useMemo(
    () =>
      (landscape?.outgoingRelations ?? []).filter(
        (item) => item.issue?.id === selectedIssueId,
      ),
    [landscape, selectedIssueId],
  );

  const selectedIssueIncomingRelations = useMemo(
    () =>
      (landscape?.incomingRelations ?? []).filter(
        (item) => item.issue?.id === selectedIssueId,
      ),
    [landscape, selectedIssueId],
  );

  const selectedIssueRelationWatchlist = useMemo(
    () =>
      [
        ...selectedIssueOutgoingRelations.map((relation) => ({
          direction: "outgoing" as const,
          relation,
        })),
        ...selectedIssueIncomingRelations.map((relation) => ({
          direction: "incoming" as const,
          relation,
        })),
      ].sort((a, b) => {
        const aConfidence =
          typeof a.relation.confidence === "number"
            ? a.relation.confidence
            : -1;
        const bConfidence =
          typeof b.relation.confidence === "number"
            ? b.relation.confidence
            : -1;

        if (bConfidence !== aConfidence) return bConfidence - aConfidence;

        return String(b.relation.updatedAt || "").localeCompare(
          String(a.relation.updatedAt || ""),
        );
      }),
    [selectedIssueOutgoingRelations, selectedIssueIncomingRelations],
  );

  const comparisonAgencyPreview = useMemo(() => {
    const map = new Map<string, GovernanceAgency>();

    for (const gap of selectedIssueGaps) {
      const primary = gap.primaryAgency;
      const secondary = gap.secondaryAgency;

      if (primary?.id && primary.id !== selectedAgencyId) {
        map.set(primary.id, primary);
      }
      if (secondary?.id && secondary.id !== selectedAgencyId) {
        map.set(secondary.id, secondary);
      }
    }

    for (const row of selectedIssueRelationWatchlist) {
      const agency = row.relation.otherAgency;
      if (agency?.id && agency.id !== selectedAgencyId) {
        map.set(agency.id, agency);
      }
    }

    return Array.from(map.values()).slice(0, 8);
  }, [selectedIssueGaps, selectedIssueRelationWatchlist, selectedAgencyId]);

  function openTemplateModal(templateKey: NotebookTemplateKey) {
    setTemplatePreset(templateKey);
    setTemplateModalOpen(true);
  }

  return (
    <div className="space-y-6 py-6 px-4 sm:px-6 lg:px-8">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.86),rgba(240,249,255,0.82),rgba(236,253,245,0.84))] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl"
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_30%),radial-gradient(circle_at_left,rgba(16,185,129,0.12),transparent_35%)] " />
        <div className="relative flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr),600px] xl:items-start">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              Governance Workspace
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
              Institutional mapping, contradictions, and evidence-grade
              provenance
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
              This workspace turns your captured documents into a governance
              map: agencies, mandates, case events, actor positions,
              coordination gaps, and contradiction trails — all with
              source-linked provenance.
            </p>
          </div>

          <div className="grid gap-3 lg:min-w-[580px]">
            <div className="rounded-[26px] border border-white/70 bg-white/88 p-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)] backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Governance question
                </div>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                  Retrieval anchor intake
                </span>
              </div>

              <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 shadow-inner">
                <textarea
                  ref={questionInputRef}
                  value={workspaceQuestion}
                  onChange={(e) => setWorkspaceQuestion(e.target.value)}
                  rows={1}
                  placeholder="Ask a governance question"
                  className="block min-h-[92px] max-h-44 w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>

              <div className="mt-3 text-xs leading-5 text-slate-500">
                File Manager documents and Saved URLs act as anchor evidence.
                Evidence search can expand beyond them when ranking relevant
                records.
              </div>
              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Workflow
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {workspaceIntentModeOptions.map((option) => {
                    const active = option.value === workspaceIntentMode;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setWorkspaceIntentMode(option.value)}
                        className={[
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                          active
                            ? "border-slate-950 bg-slate-950 text-white shadow-sm"
                            : "border-white/70 bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900",
                        ].join(" ")}
                        title={option.help}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr),320px]">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Example prompts
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {governancePromptExamples.map((example) => (
                        <button
                          key={example.label}
                          type="button"
                          onClick={() => {
                            setWorkspaceQuestion(example.prompt);
                            setWorkspaceIntentMode(example.mode);
                          }}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950"
                        >
                          {example.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200/80 bg-white/75 p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Query understanding
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        {formatQueryTypeLabel(queryUnderstanding.queryType)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {queryUnderstanding.locationHints.map((item) => (
                        <span
                          key={`location-${item}`}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                        >
                          Location: {item}
                        </span>
                      ))}
                      {queryUnderstanding.timeHints.map((item) => (
                        <span
                          key={`time-${item}`}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                        >
                          Time: {item}
                        </span>
                      ))}
                      {queryUnderstanding.focusTerms.map((item) => (
                        <span
                          key={`term-${item}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                        >
                          {item}
                        </span>
                      ))}
                    </div>

                    {queryUnderstanding.matchedIssues.length ||
                    queryUnderstanding.matchedAgencies.length ? (
                      <div className="mt-3 space-y-3">
                        {queryUnderstanding.matchedIssues.length ? (
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Issue signals
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {queryUnderstanding.matchedIssues.map((issue) => (
                                <button
                                  key={issue.id}
                                  type="button"
                                  onClick={() => setSelectedIssueId(issue.id)}
                                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
                                  title="Use this as the active issue lens"
                                >
                                  {issue.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {queryUnderstanding.matchedAgencies.length ? (
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Agency signals
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {queryUnderstanding.matchedAgencies.map(
                                (agency) => (
                                  <button
                                    key={agency.id}
                                    type="button"
                                    onClick={() =>
                                      setSelectedAgencyId(agency.id)
                                    }
                                    className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-100"
                                    title="Use this as the active agency lens"
                                  >
                                    {agency.name}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6 text-slate-500">
                        Once retrieval runs, the workspace will show detected
                        issue, agency, time, and location signals here.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-200/80 bg-sky-50/70 p-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                    Workflow plan
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-950">
                    {formatWorkspaceIntentModeLabel(workflowPlan.resolvedMode)}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {workflowPlan.rationale}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {workflowPlan.expectedOutputs.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-sky-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-sky-800"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {constrainedPurposeId && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                  <div>
                    <span className="font-semibold text-emerald-950">
                      Purpose: {constrainedPurposeTitle}
                    </span>
                    <span className="ml-2 text-emerald-800">
                      | Captured evidence only
                    </span>
                    {workspaceEvidenceQuery.data?.evidenceScope && (
                      <span className="ml-2 text-emerald-700">
                        ({workspaceEvidenceQuery.data.evidenceScope.allowedDocumentIds.length} documents)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 font-medium text-emerald-900"
                    onClick={() => {
                      setLaunchIntent((current) =>
                        current
                          ? {
                              ...current,
                              collectorPurposeId: null,
                              collectorPurposeTitle: null,
                            }
                          : current,
                      );
                      setWorkspaceQueryRunKey((current) => current + 1);
                    }}
                  >
                    Expand to all workspace evidence
                  </button>
                </div>
              )}

              {constrainedPurposeId &&
                workspaceEvidenceQuery.data?.evidenceScope &&
                workspaceEvidenceQuery.data.evidenceScope.allowedDocumentIds.length === 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <div className="font-semibold">No captured evidence for this purpose yet</div>
                    <p className="mt-1 text-amber-800">
                      Save and capture text or PDF evidence before generating a governed answer.
                    </p>
                    <button
                      type="button"
                      className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium"
                      onClick={() =>
                        navigateWithinApp(
                          `/app/saved-urls?collectorPurposeId=${encodeURIComponent(constrainedPurposeId)}`,
                        )
                      }
                    >
                      Return to Saved URLs capture
                    </button>
                  </div>
                )}
              <div className="flex flex-wrap gap-2">
                {sourceScopeOptions.map((option) => {
                  const active = option.value === sourceScope;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSourceScope(option.value)}
                      className={[
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                        active
                          ? "border-slate-950 bg-slate-950 text-white shadow-sm"
                          : "border-white/70 bg-white/80 text-slate-600 hover:bg-white hover:text-slate-900",
                      ].join(" ")}
                      title={option.help}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                  className="inline-flex items-center rounded-full border border-white/70 bg-white/85 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-white"
                >
                  <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />
                  Advanced filters
                  <ChevronDown
                    className={[
                      "ml-2 h-3.5 w-3.5 transition-transform",
                      showAdvancedFilters ? "rotate-180" : "",
                    ].join(" ")}
                  />
                </button>

                {exactLookupId ? (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                    Exact dossier: {exactLookupId}
                  </span>
                ) : null}

                {anchorDocumentCount > 0 ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    File anchors: {anchorDocumentCount}
                  </span>
                ) : null}

                {anchorUrlCount > 0 ? (
                  <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
                    URL anchors: {anchorUrlCount}
                  </span>
                ) : null}

                {hasAdvancedFiltersApplied ? (
                  <button
                    type="button"
                    onClick={clearAdvancedFilters}
                    className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-100"
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Clear filters
                  </button>
                ) : null}
              </div>

              {showAdvancedFilters ? (
                <div className="grid gap-3 rounded-[24px] border border-white/70 bg-white/88 p-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)] backdrop-blur-sm xl:grid-cols-[minmax(0,1fr),300px]">
                  <div className="space-y-3">
                    <label className="block rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Exact dossier lookup
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Search className="h-4 w-4 text-slate-400" />
                        <input
                          value={documentInput}
                          onChange={(e) => setDocumentInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              loadDocumentFromInput();
                            }
                          }}
                          placeholder="Paste a canonical document id"
                          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                        />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        Use this only when you already know the exact dossier
                        you want to open. The main workflow should still start
                        from a governance question.
                      </p>
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                          Pinned anchor intake
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-emerald-800">
                            Files: {anchorDocumentCount}
                          </span>
                          <span className="rounded-full border border-violet-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-violet-800">
                            URLs: {anchorUrlCount}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700">
                            Scope: {sourceScopeLabel}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-slate-600">
                          These anchors come from File Manager or Saved URLs and
                          act as the initial retrieval evidence pack.
                        </p>
                        {hasPinnedAnchors ? (
                          <button
                            type="button"
                            onClick={clearAnchorIntake}
                            className="mt-3 inline-flex items-center rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-white"
                          >
                            Clear pinned anchors
                          </button>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-sky-200/70 bg-sky-50/60 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                          How narrowing works
                        </div>
                        <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-600">
                          <li>Question = main retrieval intent</li>
                          <li>Source scope = preferred search family</li>
                          <li>Exact dossier = direct document opening</li>
                          <li>
                            Pinned anchors = evidence-biased retrieval starting
                            point
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={runWorkspaceEvidenceSearch}
                      className="inline-flex h-12 items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/10 transition hover:-translate-y-0.5 hover:bg-sky-700"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Find evidence
                    </button>

                    <button
                      type="button"
                      onClick={loadDocumentFromInput}
                      className="inline-flex h-12 items-center justify-center rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-slate-900"
                    >
                      Load dossier
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void issueDirectoryQuery.refetch();
                        void agencyDirectoryQuery.refetch();
                        if (workspaceQueryRunKey > 0)
                          void workspaceEvidenceQuery.refetch();

                        if (activeDocumentId) {
                          void documentQuery.refetch();
                          if (selectedIssueId) void timelineQuery.refetch();
                          if (selectedIssueId) void relationsQuery.refetch();
                          if (selectedAgencyId)
                            void agencyLandscapeQuery.refetch();
                        }
                      }}
                      className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/70 bg-white/80 px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white"
                      title="Refresh workspace data"
                    >
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Refresh
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={runWorkspaceEvidenceSearch}
                    className="inline-flex h-12 items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-semibold text-white shadow-lg shadow-sky-900/10 transition hover:-translate-y-0.5 hover:bg-sky-700"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Find evidence
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      void issueDirectoryQuery.refetch();
                      void agencyDirectoryQuery.refetch();
                      if (workspaceQueryRunKey > 0)
                        void workspaceEvidenceQuery.refetch();

                      if (activeDocumentId) {
                        void documentQuery.refetch();
                        if (selectedIssueId) void timelineQuery.refetch();
                        if (selectedIssueId) void relationsQuery.refetch();
                        if (selectedAgencyId)
                          void agencyLandscapeQuery.refetch();
                      }
                    }}
                    className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/70 bg-white/80 px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white"
                    title="Refresh workspace data"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Refresh
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center rounded-full border border-white/70 bg-white/70 px-3 py-1 shadow-sm">
            Launch source: {sourceDescriptor}
          </span>

          <span className="inline-flex items-center rounded-full border border-white/70 bg-white/70 px-3 py-1 shadow-sm">
            Source scope: {sourceScopeLabel}
          </span>

          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 shadow-sm">
            Query type: {formatQueryTypeLabel(queryUnderstanding.queryType)}
          </span>

          {queryUnderstanding.locationHints.slice(0, 1).map((item) => (
            <span
              key={`status-location-${item}`}
              className="inline-flex items-center rounded-full border border-emerald-200/80 bg-emerald-50/80 px-3 py-1 shadow-sm"
            >
              Location: {item}
            </span>
          ))}

          {workspaceQuestion.trim() ? (
            <span className="inline-flex max-w-full items-center rounded-full border border-sky-200/80 bg-sky-50/80 px-3 py-1 shadow-sm">
              <span className="font-medium text-sky-900">Question:</span>
              <span className="ml-1 max-w-[34rem] truncate text-sky-800">
                {workspaceQuestion.trim()}
              </span>
            </span>
          ) : null}

          {anchorDocumentCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-emerald-200/80 bg-emerald-50/80 px-3 py-1 shadow-sm">
              File anchors: {anchorDocumentCount}
            </span>
          )}

          {anchorUrlCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-violet-200/80 bg-violet-50/80 px-3 py-1 shadow-sm">
              URL anchors: {anchorUrlCount}
            </span>
          )}

          {exactLookupId ? (
            <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-1 shadow-sm">
              Exact lookup: {exactLookupId}
            </span>
          ) : null}

          {activeDocumentId && (
            <span className="inline-flex items-center rounded-full border border-white/70 bg-white/70 px-3 py-1 shadow-sm">
              Active document: {activeDocumentId}
            </span>
          )}

          {launchIntent?.title && (
            <span className="inline-flex items-center rounded-full border border-emerald-200/80 bg-emerald-50/80 px-3 py-1 shadow-sm">
              Context: {launchIntent.title}
            </span>
          )}
        </div>

        {workspaceQueryRunKey > 0 || answerRun || answerLoading || answerError ? (
          <GovernanceAnswerPanel
            run={answerRun}
            draftText={answerDraft}
            status={answerStatus}
            loading={answerLoading}
            error={answerError}
            followUpQuestion={followUpQuestion}
            setFollowUpQuestion={setFollowUpQuestion}
            onSubmitFollowUp={submitFollowUpAnswer}
            onRegenerate={regenerateAnswer}
            onDeepReview={deepReviewAnswer}
            onCopy={copyAnswer}
            onExport={() => void exportAnswerToNotebook()}
            exporting={answerExporting}
          />
        ) : null}

        {workspaceQueryRunKey > 0 ? (
          <div className="rounded-[26px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <SectionHeader
              icon={<Sparkles className="h-4 w-4" />}
              title="Retrieved evidence"
              subtitle="Question-ranked candidate documents from File Manager and Saved URLs."
              action={
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                  {workspaceEvidenceQuery.data?.totalCandidates ?? 0} candidates
                </span>
              }
            />

            <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    retrievalDecision.confidence === "high"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : retrievalDecision.confidence === "medium"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-rose-200 bg-rose-50 text-rose-700",
                  ].join(" ")}
                >
                  {formatRetrievalConfidenceLabel(retrievalDecision.confidence)}
                </span>

                {temporalControl.active ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    {formatTemporalModeLabel(temporalControl.mode)}
                  </span>
                ) : null}

                {diversityControl.active ? (
                  <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">
                    Diversity balancing active
                  </span>
                ) : null}

                {retrievalDecision.topCandidateScore !== null ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    Top score {retrievalDecision.topCandidateScore}
                  </span>
                ) : null}

                {retrievalDecision.scoreMargin !== null ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    Margin {retrievalDecision.scoreMargin}
                  </span>
                ) : null}

                {retrievalDecision.shouldAutoSelect ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                    Auto-opened best dossier
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                {retrievalDecision.rationale}
              </p>

              {temporalControl.active ? (
                <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                    Temporal control
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {temporalControl.rationale}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {temporalControl.preferredSignals.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {diversityControl.active ? (
                <div className="mt-3 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                    Diversity control
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {diversityControl.rationale}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {diversityControl.balancedBy.map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700"
                      >
                        {formatDiversityBalancedByLabel(item)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {contradictionFoundation.active ? (
                <div className="mt-3 rounded-2xl border border-rose-200/80 bg-rose-50/60 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                    Contradiction foundation
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {contradictionFoundation.rationale}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700">
                      Contradiction signals{" "}
                      {contradictionFoundation.summary.contradictionCount}
                    </span>
                    <span className="rounded-full border border-fuchsia-200 bg-white px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                      Clusters {contradictionFoundation.summary.groupCount}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                      Needs review {contradictionFoundation.summary.reviewCount}
                    </span>
                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700">
                      Override hints{" "}
                      {contradictionFoundation.summary.overrideHintCount}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 xl:grid-cols-4">
                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Conflict clusters
                      </div>

                      {contradictionFoundation.groups.length ? (
                        <div className="mt-3 space-y-3">
                          {contradictionFoundation.groups.map((group) => (
                            <div
                              key={group.groupKey}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                                  {formatContradictionBucketLabel(
                                    group.strongestBucket,
                                  )}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                  Signals {group.candidateCount}
                                </span>
                                {group.reviewCount > 0 ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Review {group.reviewCount}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {group.label}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {group.strongestReason}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No grouped contradiction clusters were created for the
                          current evidence set.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Conflict candidates
                      </div>

                      {contradictionFoundation.candidates.length ? (
                        <div className="mt-3 space-y-3">
                          {contradictionFoundation.candidates.map((item) => (
                            <div
                              key={item.relationId}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                                  {formatContradictionBucketLabel(item.bucket)}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {formatRelationTypeLabel(item.relationType)}
                                </span>
                                {item.requiresAnalystReview ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Analyst review
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {item.fromDocumentTitle} →{" "}
                                {item.toDocumentTitle}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {item.reason}
                              </p>

                              {item.rationale ? (
                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                  {item.rationale}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No explicit contradiction-style relations were
                          surfaced in the current evidence set.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Override chains
                      </div>

                      {overrideChainFoundation.chains.length ? (
                        <div className="mt-3 space-y-3">
                          {overrideChainFoundation.chains.map((chain) => (
                            <div
                              key={chain.chainKey}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                                  Chain length {chain.edgeCount}
                                </span>
                                {chain.maxConfidence !== null ? (
                                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                    Confidence {chain.maxConfidence.toFixed(2)}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {chain.documentTitles.join(" → ")}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {chain.basis}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No linked override chains were assembled from the
                          current hint set.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Override hints
                      </div>

                      {contradictionFoundation.overrideHints.length ? (
                        <div className="mt-3 space-y-3">
                          {contradictionFoundation.overrideHints.map((item) => (
                            <div
                              key={item.relationId}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                                  {formatRelationTypeLabel(item.relationType)}
                                </span>
                                {item.confidence !== null ? (
                                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                    Confidence {item.confidence.toFixed(2)}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                Prefer {item.preferredDocumentTitle}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {item.basis}
                              </p>

                              <div className="mt-2 text-xs text-slate-500">
                                May supersede: {item.supersededDocumentTitle}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No explicit override or supersession hints were
                          surfaced yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {comparisonSurface.active ? (
                <div className="mt-3 rounded-2xl border border-sky-200/80 bg-sky-50/40 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                    Document comparison surface
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {comparisonSurface.rationale}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700">
                      Comparisons {comparisonSurface.summary.comparisonCount}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                      Needs review {comparisonSurface.summary.reviewCount}
                    </span>
                    <span className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700">
                      Preferred pairs{" "}
                      {comparisonSurface.summary.preferredPairCount}
                    </span>
                  </div>

                  {comparisonSurface.comparisons.length ? (
                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {comparisonSurface.comparisons.map((comparison) => (
                        <div
                          key={comparison.comparisonKey}
                          className="rounded-2xl border border-slate-200/80 bg-white/80 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                              {formatComparisonSurfaceLabel(
                                comparison.strongestBucket,
                              )}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                              Conflict signals{" "}
                              {comparison.contradictionSignalCount}
                            </span>
                            {comparison.overrideHintCount > 0 ? (
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                                Override hints {comparison.overrideHintCount}
                              </span>
                            ) : null}
                            {comparison.reviewCount > 0 ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                Review {comparison.reviewCount}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 text-sm font-semibold text-slate-900">
                            {comparison.documentTitles.join(" ↔ ")}
                          </div>

                          {comparison.issueTitle ? (
                            <div className="mt-2">
                              <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                                {comparison.issueTitle}
                              </span>
                            </div>
                          ) : null}

                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {comparison.changeSummary}
                          </p>

                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            {comparison.strongestReason}
                          </div>

                          {comparison.preferredDocumentTitle ? (
                            <div className="mt-3 rounded-2xl border border-violet-200/80 bg-violet-50/60 px-3 py-2 text-xs leading-5 text-violet-800">
                              Prefer {comparison.preferredDocumentTitle}
                              {comparison.supersededDocumentTitle
                                ? ` over ${comparison.supersededDocumentTitle}`
                                : ""}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      No document-to-document comparison pairs were assembled
                      for the current evidence set.
                    </p>
                  )}
                </div>
              ) : null}

              {landscapeMappingSurface.active ? (
                <div className="mt-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    Landscape mapping surface
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {landscapeMappingSurface.rationale}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700">
                      Issues {landscapeMappingSurface.summary.issueCount}
                    </span>
                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700">
                      Agencies {landscapeMappingSurface.summary.agencyCount}
                    </span>
                    <span className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700">
                      Spotlight {landscapeMappingSurface.summary.spotlightCount}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                      Current signals{" "}
                      {landscapeMappingSurface.summary.currentPreferredCount}
                    </span>
                    <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700">
                      Conflict-linked{" "}
                      {landscapeMappingSurface.summary.conflictLinkedCount}
                    </span>
                  </div>

                  <div className="mt-3 rounded-2xl border border-white/80 bg-white/80 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Source coverage
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                        Files {landscapeMappingSurface.sourceCoverage.fileCount}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                        URLs {landscapeMappingSurface.sourceCoverage.urlCount}
                      </span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        Anchors{" "}
                        {landscapeMappingSurface.sourceCoverage.anchorCount}
                      </span>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                        Metadata{" "}
                        {landscapeMappingSurface.sourceCoverage.metadataCount}
                      </span>
                      <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                        Graph{" "}
                        {landscapeMappingSurface.sourceCoverage.graphCount}
                      </span>
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                        Raw chunk{" "}
                        {landscapeMappingSurface.sourceCoverage.chunkCount}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Top issues
                      </div>

                      {landscapeMappingSurface.topIssues.length ? (
                        <div className="mt-3 space-y-3">
                          {landscapeMappingSurface.topIssues.map((item) => (
                            <div
                              key={item.title}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="text-sm font-semibold text-slate-900">
                                {item.title}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                  Documents {item.documentCount}
                                </span>
                                {item.anchorCount > 0 ? (
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                    Anchors {item.anchorCount}
                                  </span>
                                ) : null}
                                {item.currentPreferredCount > 0 ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Current {item.currentPreferredCount}
                                  </span>
                                ) : null}
                                {item.conflictLinkedCount > 0 ? (
                                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                                    Conflict-linked {item.conflictLinkedCount}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No issue clusters were assembled for the current
                          landscape run.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Top agencies
                      </div>

                      {landscapeMappingSurface.topAgencies.length ? (
                        <div className="mt-3 space-y-3">
                          {landscapeMappingSurface.topAgencies.map((item) => (
                            <div
                              key={item.name}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="text-sm font-semibold text-slate-900">
                                {item.name}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                  Documents {item.documentCount}
                                </span>
                                {item.currentPreferredCount > 0 ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Current {item.currentPreferredCount}
                                  </span>
                                ) : null}
                                {item.conflictLinkedCount > 0 ? (
                                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                                    Conflict-linked {item.conflictLinkedCount}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No agency clusters were assembled for the current
                          landscape run.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Spotlight documents
                      </div>

                      {landscapeMappingSurface.spotlightDocuments.length ? (
                        <div className="mt-3 space-y-3">
                          {landscapeMappingSurface.spotlightDocuments.map(
                            (item) => (
                              <div
                                key={item.documentId}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  {item.currentPreferred ? (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                      Current-state signal
                                    </span>
                                  ) : null}
                                  {item.conflictLinked ? (
                                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                                      Conflict-linked
                                    </span>
                                  ) : null}
                                  {item.anchor ? (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                      Anchor
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2 text-sm font-semibold text-slate-900">
                                  {item.title}
                                </div>

                                {item.issueTitle ? (
                                  <div className="mt-2">
                                    <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                                      {item.issueTitle}
                                    </span>
                                  </div>
                                ) : null}

                                {item.agencyName ? (
                                  <div className="mt-2 text-xs text-slate-500">
                                    {item.agencyName}
                                  </div>
                                ) : null}

                                {item.summary ? (
                                  <p className="mt-2 text-sm leading-6 text-slate-600">
                                    {item.summary}
                                  </p>
                                ) : null}

                                <div className="mt-2 text-xs leading-5 text-slate-500">
                                  {item.reason}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No spotlight documents were selected for this
                          landscape view.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {caseTracingSurface.active ? (
                <div className="mt-3 rounded-2xl border border-rose-200/80 bg-rose-50/35 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                    Case tracing / contradiction mapping surface
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {caseTracingSurface.rationale}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                      Focus docs {caseTracingSurface.summary.focusDocumentCount}
                    </span>
                    <span className="rounded-full border border-fuchsia-200 bg-white px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                      Clusters{" "}
                      {caseTracingSurface.summary.contradictionClusterCount}
                    </span>
                    <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-700">
                      Comparisons {caseTracingSurface.summary.comparisonCount}
                    </span>
                    <span className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-medium text-violet-700">
                      Chains {caseTracingSurface.summary.overrideChainCount}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-700">
                      Review signals {caseTracingSurface.summary.reviewCount}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-5">
                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Focus documents
                      </div>

                      {caseTracingSurface.focusDocuments.length ? (
                        <div className="mt-3 space-y-3">
                          {caseTracingSurface.focusDocuments.map((item) => (
                            <div
                              key={item.documentId}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                {item.currentPreferred ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Current
                                  </span>
                                ) : null}
                                {item.conflictLinked ? (
                                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                                    Conflict-linked
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {item.title}
                              </div>

                              {item.issueTitle ? (
                                <div className="mt-2">
                                  <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                                    {item.issueTitle}
                                  </span>
                                </div>
                              ) : null}

                              {item.agencyName ? (
                                <div className="mt-2 text-xs text-slate-500">
                                  {item.agencyName}
                                </div>
                              ) : null}

                              <div className="mt-2 text-xs leading-5 text-slate-500">
                                {item.reason}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No focus documents were selected for the current
                          case-tracing run.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Contradiction clusters
                      </div>

                      {caseTracingSurface.contradictionClusters.length ? (
                        <div className="mt-3 space-y-3">
                          {caseTracingSurface.contradictionClusters.map(
                            (item) => (
                              <div
                                key={item.groupKey}
                                className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                                    {formatContradictionBucketLabel(
                                      item.strongestBucket,
                                    )}
                                  </span>
                                  {item.reviewCount > 0 ? (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                      Review {item.reviewCount}
                                    </span>
                                  ) : null}
                                </div>

                                <div className="mt-2 text-sm font-semibold text-slate-900">
                                  {item.label}
                                </div>

                                <p className="mt-2 text-sm leading-6 text-slate-600">
                                  {item.strongestReason}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No contradiction clusters were selected for this
                          case-tracing view.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Comparison pairs
                      </div>

                      {caseTracingSurface.comparisonPairs.length ? (
                        <div className="mt-3 space-y-3">
                          {caseTracingSurface.comparisonPairs.map((item) => (
                            <div
                              key={item.comparisonKey}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                                  {formatContradictionBucketLabel(
                                    item.strongestBucket,
                                  )}
                                </span>
                                {item.reviewCount > 0 ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                                    Review {item.reviewCount}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {item.documentTitles.join(" ↔ ")}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {item.changeSummary}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No comparison pairs were selected for this
                          case-tracing view.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Override chains
                      </div>

                      {caseTracingSurface.overrideChains.length ? (
                        <div className="mt-3 space-y-3">
                          {caseTracingSurface.overrideChains.map((item) => (
                            <div
                              key={item.chainKey}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                                  Chain length {item.edgeCount}
                                </span>
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {item.documentTitles.join(" → ")}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {item.basis}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No override chains were selected for this case-tracing
                          view.
                        </p>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Timeline highlights
                      </div>

                      {caseTracingSurface.timelineHighlights.length ? (
                        <div className="mt-3 space-y-3">
                          {caseTracingSurface.timelineHighlights.map((item) => (
                            <div
                              key={item.eventId}
                              className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {item.dateLabel}
                                </span>
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                                  {formatCaseTrailEventTypeLabel(
                                    item.eventType,
                                  )}
                                </span>
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {item.title}
                              </div>

                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {item.narrative}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                          No timeline highlights were selected for this
                          case-tracing view.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {caseTrailFoundation.active ? (
                <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Case trail timeline
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {caseTrailFoundation.rationale}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                      Events {caseTrailFoundation.summary.eventCount}
                    </span>
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                      Documents {caseTrailFoundation.summary.documentEventCount}
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                      Conflicts {caseTrailFoundation.summary.conflictEventCount}
                    </span>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                      Override hints{" "}
                      {caseTrailFoundation.summary.overrideEventCount}
                    </span>
                    <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                      Override chains{" "}
                      {caseTrailFoundation.summary.overrideChainEventCount}
                    </span>
                  </div>

                  {caseTrailFoundation.events.length ? (
                    <div className="mt-4 space-y-3">
                      {caseTrailFoundation.events.map((event) => (
                        <div
                          key={event.eventId}
                          className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                              {event.dateLabel}
                            </span>
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
                              {formatCaseTrailEventTypeLabel(event.eventType)}
                            </span>
                            {event.confidence !== null ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                                Confidence {event.confidence.toFixed(2)}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 text-sm font-semibold text-slate-900">
                            {event.title}
                          </div>

                          {event.subtitle ? (
                            <div className="mt-1 text-xs text-slate-500">
                              {event.subtitle}
                            </div>
                          ) : null}

                          {event.issueTitle ? (
                            <div className="mt-2">
                              <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-xs font-medium text-fuchsia-700">
                                {event.issueTitle}
                              </span>
                            </div>
                          ) : null}

                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {event.narrative}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      No chronological trail events were assembled for the
                      current evidence set.
                    </p>
                  )}
                </div>
              ) : null}

              {!retrievalDecision.shouldAutoSelect &&
              retrievalDecision.recommendedDocumentId ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDocumentInput(
                        retrievalDecision.recommendedDocumentId!,
                      );
                      setActiveDocumentId(
                        retrievalDecision.recommendedDocumentId!,
                      );
                      setSelectedProvenance(null);
                    }}
                    className="inline-flex items-center rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-50"
                  >
                    Open top suggestion
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {evidenceCandidates.length ? (
                evidenceCandidates.map((candidate) => {
                  const isActive = candidate.documentId === activeDocumentId;

                  return (
                    <button
                      key={candidate.documentId}
                      type="button"
                      onClick={() => {
                        setDocumentInput(candidate.documentId);
                        setActiveDocumentId(candidate.documentId);
                        setSelectedProvenance(null);
                      }}
                      className={[
                        "rounded-2xl border p-4 text-left transition",
                        isActive
                          ? "border-sky-300 bg-sky-50/70 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60",
                      ].join(" ")}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <span>
                          {candidate.kind === "URL" ? "Saved URL" : "File"}
                        </span>
                        <span>•</span>
                        <span>Total score {candidate.matchScore}</span>
                        {candidate.documentId ===
                        retrievalDecision.recommendedDocumentId ? (
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-700">
                            Top suggestion
                          </span>
                        ) : null}
                        {contradictionLinkedDocumentIds.has(
                          candidate.documentId,
                        ) ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                            Conflict-linked
                          </span>
                        ) : null}
                        {candidate.temporalReason ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                            Temporally preferred
                          </span>
                        ) : null}
                        {candidate.diversityReason ? (
                          <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700">
                            Diversity balanced
                          </span>
                        ) : null}
                        {candidate.duplicateCount > 0 ? (
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-violet-700">
                            Merged {candidate.duplicateCount + 1} related
                            records
                          </span>
                        ) : null}
                        {candidate.anchor ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                            Anchor
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-sm font-semibold text-slate-950">
                        {candidate.title}
                      </div>

                      {candidate.sourceLabel ? (
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {candidate.sourceLabel}
                        </div>
                      ) : null}

                      {candidate.summary ? (
                        <div className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">
                          {candidate.summary}
                        </div>
                      ) : null}

                      {candidate.clusterReason ? (
                        <div className="mt-3 rounded-2xl border border-violet-200/80 bg-violet-50/60 px-3 py-2 text-xs leading-5 text-violet-800">
                          {candidate.clusterReason}
                        </div>
                      ) : null}

                      {candidate.temporalReason ? (
                        <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-800">
                          {candidate.temporalReason}
                        </div>
                      ) : null}

                      {candidate.diversityReason ? (
                        <div className="mt-3 rounded-2xl border border-fuchsia-200/80 bg-fuchsia-50/60 px-3 py-2 text-xs leading-5 text-fuchsia-800">
                          {candidate.diversityReason}
                        </div>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                        {candidate.reasons.map((reason) => (
                          <span
                            key={reason}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Why this source
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                            Signal {candidate.signalScore}
                          </span>
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                            Authority {candidate.authorityScore}
                          </span>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                            Freshness {candidate.freshnessScore}
                          </span>
                          {candidate.anchorScore > 0 ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              Anchor {candidate.anchorScore}
                            </span>
                          ) : null}
                        </div>

                        {candidate.coverageFamilies.length ? (
                          <div className="mt-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Coverage
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {candidate.coverageFamilies.map((family) => (
                                <span
                                  key={family}
                                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                                >
                                  {formatCoverageFamilyLabel(family)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {candidate.retrievalLanes.length ? (
                          <div className="mt-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Matched through
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {candidate.retrievalLanes.map((lane) => (
                                <span
                                  key={lane}
                                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
                                >
                                  {formatRetrievalLaneLabel(lane)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {candidate.whyRanked.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {candidate.whyRanked.map((note) => (
                              <span
                                key={note}
                                className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700"
                              >
                                {note}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        {candidate.matchedIssues.map((issue) => (
                          <span
                            key={issue}
                            className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700"
                          >
                            {issue}
                          </span>
                        ))}
                        {candidate.matchedAgencies.map((agency) => (
                          <span
                            key={agency}
                            className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-700"
                          >
                            {agency}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>Claims {candidate.stats.claimCount}</span>
                        <span>Events {candidate.stats.eventCount}</span>
                        <span>Gaps {candidate.stats.gapCount}</span>
                        <span>Relations {candidate.stats.relationCount}</span>
                        {candidate.duplicateCount > 0 ? (
                          <span>
                            Related records{" "}
                            {candidate.clusterDocumentIds.length}
                          </span>
                        ) : null}
                        {candidate.publishedAt ? (
                          <span>
                            Published{" "}
                            {new Date(
                              candidate.publishedAt,
                            ).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              ) : workspaceEvidenceQuery.isFetched &&
                !workspaceEvidenceQuery.isLoading ? (
                <EmptyPanel
                  title="No candidate evidence found"
                  body="Refine the governance question, broaden the source scope, or keep a stronger anchor source selected."
                />
              ) : (
                <EmptyPanel
                  title="Evidence retrieval is ready"
                  body="Use Find evidence to turn the question and anchor sources into a ranked document set."
                />
              )}
            </div>
          </div>
        ) : null}

        {activeDocumentId ? (
          <div className="rounded-[26px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Notebook handoff
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  Launch the right reusable note for the current governance or
                  case-review lens.
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {notebookContextChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {notebookLaunchActions.map((action) => {
                const meta = notebookLaunchMeta(action.key);

                return (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => openTemplateModal(action.key)}
                    disabled={!action.enabled}
                    className={[
                      "rounded-[22px] border p-4 text-left shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50",
                      action.accentClass,
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-sm font-semibold">
                        <span className="rounded-xl border border-black/5 bg-white/70 p-2 shadow-sm">
                          {meta.icon}
                        </span>
                        {action.label}
                      </div>
                      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                    </div>

                    <div className="mt-3 text-sm leading-6">
                      {action.description}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                      {action.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full border border-black/5 bg-white/70 px-2.5 py-1"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </motion.section>

      {!activeDocumentId ? (
        <SmartCard
          className="border-white/70 bg-white/85 p-8 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
          tabIndex={-1}
        >
          <div className="mx-auto max-w-3xl">
            <SectionHeader
              icon={<BookOpen className="h-5 w-5" />}
              title="Start from an existing captured document"
              subtitle="Open this workspace from File Manager or Saved URLs, or paste a canonical document id manually."
            />
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <EmptyPanel
                title="From File Manager"
                body="Use the Evidence Inspector and click “Open governance workspace” to jump in with the selected artifact."
              />
              <EmptyPanel
                title="From Saved URLs"
                body="Open a saved URL detail drawer and launch governance view after a revision is available."
              />
              <EmptyPanel
                title="Manual deep-linking"
                body="Paste a canonical document id above to inspect all extracted issues, positions, relations, and provenance."
              />
            </div>
          </div>
        </SmartCard>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Agencies"
              value={documentSummary.agencyCount}
              icon={<Building2 className="h-5 w-5" />}
              tone="emerald"
              detail="Institutions surfaced from the selected evidence base."
            />
            <MetricCard
              label="Issues"
              value={documentSummary.issueCount}
              icon={<Landmark className="h-5 w-5" />}
              tone="blue"
              detail="Governance or case files extracted for navigation and comparison."
            />
            <MetricCard
              label="Claims & positions"
              value={documentSummary.claimCount + documentSummary.positionCount}
              icon={<FileText className="h-5 w-5" />}
              tone="violet"
              detail="Structured assertions and actor stances with evidence anchors."
            />
            <MetricCard
              label="Relations & gaps"
              value={documentSummary.relationCount + documentSummary.gapCount}
              icon={<GitBranch className="h-5 w-5" />}
              tone="slate"
              detail="Contradictions, tensions, overlaps, and coordination gaps."
            />
          </div>

          {anyError && (
            <SmartCard
              className="border-red-200/80 bg-red-50/90 p-4 text-sm text-red-700"
              tabIndex={-1}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="font-semibold text-red-900">
                    Workspace request failed
                  </div>
                  <div className="mt-1">{anyError.message}</div>
                </div>
              </div>
            </SmartCard>
          )}

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/80 p-2 shadow-sm">
            <div className="text-sm text-slate-600">
              {workspaceMode === "map"
                ? "Governance Map mode"
                : "Question Review mode"}
            </div>
            <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setWorkspaceMode("map")}
                className={[
                  "rounded-xl px-3 py-2 text-sm font-medium transition",
                  workspaceMode === "map"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                ].join(" ")}
              >
                Governance Map
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedIssueId) setWorkspaceMode("case");
                }}
                disabled={!selectedIssueId}
                className={[
                  "rounded-xl px-3 py-2 text-sm font-medium transition",
                  workspaceMode === "case"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:text-slate-900",
                  !selectedIssueId ? "cursor-not-allowed opacity-50" : "",
                ].join(" ")}
              >
                Question Review
              </button>
            </div>
          </div>

          {workspaceMode === "case" && selectedIssueId ? (
            <CaseWorkspacePanel
              issueId={selectedIssueId}
              issueTitle={selectedIssue?.title ?? null}
              actorAgencyId={selectedAgencyId}
              reviewQuestion={workspaceQuestion.trim() || null}
              questionReviewSurface={questionReviewSurface}
              onActorAgencyIdChange={setSelectedAgencyId}
              onClose={() => setWorkspaceMode("map")}
            />
          ) : (
            <div className="grid gap-6 xl:grid-cols-[300px,minmax(0,1fr),360px]">
              <div className="space-y-6">
                <SmartCard
                  className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                  tabIndex={-1}
                >
                  <SectionHeader
                    icon={<Landmark className="h-5 w-5" />}
                    title="Issue directory"
                    subtitle="Search the cross-document governance issue registry and set the active case lens."
                  />

                  <div className="mt-5 space-y-4">
                    <label className="block">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Search issues
                      </div>
                      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <Search className="h-4 w-4 text-slate-400" />
                        <input
                          value={issueSearch}
                          onChange={(e) => setIssueSearch(e.target.value)}
                          placeholder="Search title, summary, or slug"
                          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                        />
                      </div>
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Kind
                        </div>
                        <select
                          value={issueKindFilter}
                          onChange={(e) => setIssueKindFilter(e.target.value)}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        >
                          <option value="">All kinds</option>
                          {governanceIssueKindOptions.map((kind) => (
                            <option key={kind} value={kind}>
                              {humanizeEnumValue(kind)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Status
                        </div>
                        <select
                          value={issueStatusFilter}
                          onChange={(e) => setIssueStatusFilter(e.target.value)}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        >
                          <option value="">All statuses</option>
                          {governanceIssueStatusOptions.map((status) => (
                            <option key={status} value={status}>
                              {humanizeEnumValue(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="block">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Active issue
                      </div>
                      <select
                        value={selectedIssueId ?? ""}
                        onChange={(e) => {
                          setSelectedIssueId(e.target.value || null);
                          setSelectedProvenance(null);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      >
                        {!issueDirectoryItems.length ? (
                          <option value="">No issues available</option>
                        ) : null}
                        {issueDirectoryItems.map((issue) => (
                          <option key={issue.id} value={issue.id}>
                            {issue.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-6 space-y-3">
                    {issueDirectoryQuery.isLoading &&
                    issueDirectoryItems.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading issue directory…
                      </div>
                    ) : issueDirectoryItems.length === 0 ? (
                      <EmptyPanel
                        title="No governance issues matched these filters"
                        body="Adjust the issue search or clear the filters to broaden the landscape."
                      />
                    ) : (
                      issueDirectoryItems.slice(0, 8).map((issue) => {
                        const active = issue.id === selectedIssueId;
                        const linkedAgencyPreview = issue.linkedAgencies
                          .slice(0, 2)
                          .map(
                            (link) => link.agency.shortName || link.agency.name,
                          )
                          .join(" • ");

                        return (
                          <button
                            key={issue.id}
                            type="button"
                            onClick={() => {
                              setSelectedIssueId(issue.id);
                              setSelectedProvenance(null);
                            }}
                            className={[
                              "w-full rounded-2xl border p-3 text-left transition",
                              active
                                ? "border-sky-300 bg-sky-50 shadow-sm"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900">
                                  {issue.title}
                                </div>
                                <div className="mt-1 text-xs text-slate-600">
                                  {compactText(
                                    issue.summary,
                                    "No issue summary extracted",
                                  )}
                                </div>
                              </div>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                                {humanizeEnumValue(issue.kind, "Unknown")}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600">
                              {issue.status ? (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                  {humanizeEnumValue(issue.status)}
                                </span>
                              ) : null}
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                {issue.counts.agencyCount} agencies
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                {issue.counts.relationCount} relations
                              </span>
                            </div>

                            <div className="mt-2 text-[11px] text-slate-500">
                              {linkedAgencyPreview ||
                                "No linked agencies preview"}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {selectedIssue ? (
                    <button
                      type="button"
                      onClick={() => setWorkspaceMode("case")}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-slate-900"
                    >
                      Open Case Review
                      <ArrowUpRight className="h-4 w-4" />
                    </button>
                  ) : null}
                </SmartCard>

                <SmartCard
                  className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                  tabIndex={-1}
                >
                  <SectionHeader
                    icon={<Building2 className="h-5 w-5" />}
                    title="Agency directory"
                    subtitle="Search the cross-document institution registry and set the active agency comparison lens."
                  />

                  <div className="mt-5 space-y-4">
                    <label className="block">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Search agencies
                      </div>
                      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <Search className="h-4 w-4 text-slate-400" />
                        <input
                          value={agencySearch}
                          onChange={(e) => setAgencySearch(e.target.value)}
                          placeholder="Search name, short name, or slug"
                          className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                        />
                      </div>
                    </label>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Category
                        </div>
                        <select
                          value={agencyCategoryFilter}
                          onChange={(e) =>
                            setAgencyCategoryFilter(e.target.value)
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                        >
                          <option value="">All categories</option>
                          {governanceAgencyCategoryOptions.map((category) => (
                            <option key={category} value={category}>
                              {humanizeEnumValue(category)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Jurisdiction
                        </div>
                        <input
                          value={agencyJurisdictionFilter}
                          onChange={(e) =>
                            setAgencyJurisdictionFilter(e.target.value)
                          }
                          placeholder="e.g. Delhi, National"
                          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Active agency
                      </div>
                      <select
                        value={selectedAgencyId ?? ""}
                        onChange={(e) => {
                          setSelectedAgencyId(e.target.value || null);
                          setSelectedProvenance(null);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                      >
                        {!agencyDirectoryItems.length ? (
                          <option value="">No agencies available</option>
                        ) : null}
                        {agencyDirectoryItems.map((agency) => (
                          <option key={agency.id} value={agency.id}>
                            {agency.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-6 space-y-3">
                    {agencyDirectoryQuery.isLoading &&
                    agencyDirectoryItems.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading agency directory…
                      </div>
                    ) : agencyDirectoryItems.length === 0 ? (
                      <EmptyPanel
                        title="No agencies matched these filters"
                        body="Adjust the agency search or clear the filters to widen the institution landscape."
                      />
                    ) : (
                      agencyDirectoryItems.slice(0, 12).map((agency) => {
                        const active = agency.id === selectedAgencyId;
                        const linkedIssuePreview = agency.linkedIssues
                          .slice(0, 2)
                          .map((link) => link.issue.title)
                          .join(" • ");

                        return (
                          <button
                            key={agency.id}
                            type="button"
                            onClick={() => {
                              setSelectedAgencyId(agency.id);
                              setSelectedProvenance(null);
                            }}
                            className={[
                              "w-full rounded-2xl border p-3 text-left transition",
                              active
                                ? "border-emerald-300 bg-emerald-50 shadow-sm"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            <div className="text-sm font-semibold text-slate-900">
                              {agency.name}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                              {agency.category ? (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                  {humanizeEnumValue(agency.category)}
                                </span>
                              ) : null}
                              {agency.jurisdiction ? (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                  {agency.jurisdiction}
                                </span>
                              ) : null}
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                {agency.counts.issueCount} issues
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                {agency.counts.relationCount} relations
                              </span>
                            </div>

                            <div className="mt-2 text-[11px] text-slate-500">
                              {linkedIssuePreview || "No linked issues preview"}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </SmartCard>
              </div>

              <div className="space-y-6">
                <SmartCard
                  className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                  tabIndex={-1}
                >
                  <SectionHeader
                    icon={<Network className="h-5 w-5" />}
                    title="Case timeline"
                    subtitle={
                      selectedIssue
                        ? `Merged chronology for ${selectedIssue.title}`
                        : "Choose an issue to inspect the merged timeline."
                    }
                    action={
                      busy ? (
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs text-slate-600 shadow-sm">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Syncing
                        </div>
                      ) : null
                    }
                  />

                  <div className="mt-5 space-y-3">
                    {(timeline?.entries ?? []).length === 0 ? (
                      <EmptyPanel
                        title="No timeline entries"
                        body="This issue does not yet have normalized events or dated positions."
                      />
                    ) : (
                      (timeline?.entries ?? []).map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() =>
                            setSelectedProvenance({
                              title: entry.label,
                              subtitle:
                                entry.actorAgency?.name ??
                                entry.position?.agency?.name ??
                                entry.itemType,
                              narrative:
                                entry.summary ??
                                entry.position?.stanceSummary ??
                                entry.position?.stanceText ??
                                entry.event?.summary ??
                                null,
                              chips: [
                                entry.itemType,
                                entry.sortPrecision,
                                entry.actorAgency?.name ?? "Unattributed",
                              ].filter((chip): chip is string => Boolean(chip)),
                              provenance: entry.provenance,
                            })
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                  {entry.itemType}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {entry.actorAgency?.name ??
                                    entry.position?.agency?.name ??
                                    "Unattributed"}
                                </span>
                              </div>
                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {entry.label}
                              </div>
                              <div className="mt-1 text-sm leading-6 text-slate-600">
                                {compactText(
                                  entry.summary ??
                                    entry.position?.stanceSummary ??
                                    entry.position?.stanceText ??
                                    entry.event?.summary,
                                  "No narrative summary available",
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-xs font-semibold text-slate-500">
                                {formatShortDate(entry.sortDate)}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-400">
                                {entry.sortPrecision}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </SmartCard>

                <SmartCard
                  className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                  tabIndex={-1}
                >
                  <SectionHeader
                    icon={<GitBranch className="h-5 w-5" />}
                    title="Contradiction & alignment panel"
                    subtitle="Inspect explicit cross-document relation candidates grounded in extracted claims."
                    action={
                      <select
                        value={relationFilter}
                        onChange={(e) =>
                          setRelationFilter(e.target.value as RelationFilter)
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                      >
                        {relationOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    }
                  />

                  <div className="mt-5 space-y-3">
                    {(relations?.relations ?? []).length === 0 ? (
                      <EmptyPanel
                        title="No relation candidates"
                        body="This issue currently has no extracted contradictions, tensions, overrides, or reinforcements."
                      />
                    ) : (
                      (relations?.relations ?? []).map((rel) => (
                        <button
                          key={rel.id}
                          type="button"
                          onClick={() =>
                            setSelectedProvenance({
                              title: `${rel.relationType} • ${rel.fromAgency?.name ?? "Unknown"} → ${rel.toAgency?.name ?? "Unknown"}`,
                              subtitle:
                                rel.issue?.title ??
                                selectedIssue?.title ??
                                null,
                              narrative:
                                rel.rationale ??
                                rel.fromClaim?.claimSummary ??
                                rel.toClaim?.claimSummary ??
                                null,
                              chips: [
                                rel.relationType,
                                rel.fromAgency?.name ?? "Unknown source",
                                rel.toAgency?.name ?? "Unknown target",
                              ],
                              provenance: rel.provenance,
                            })
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                                  {rel.relationType}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {(rel.confidence ?? 0).toFixed(2)} confidence
                                </span>
                              </div>
                              <div className="mt-2 text-sm font-semibold text-slate-900">
                                {rel.fromAgency?.name ?? "Unknown"} →{" "}
                                {rel.toAgency?.name ?? "Unknown"}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-slate-600">
                                {compactText(
                                  rel.rationale ??
                                    rel.fromClaim?.claimSummary ??
                                    rel.toClaim?.claimSummary,
                                  "No rationale extracted",
                                )}
                              </div>
                              {(rel.fromClaim?.claimText ||
                                rel.toClaim?.claimText) && (
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                                    <div className="font-semibold text-slate-900">
                                      From claim
                                    </div>
                                    <div className="mt-1 leading-5">
                                      {compactText(rel.fromClaim?.claimText)}
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                                    <div className="font-semibold text-slate-900">
                                      To claim
                                    </div>
                                    <div className="mt-1 leading-5">
                                      {compactText(rel.toClaim?.claimText)}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </SmartCard>
              </div>

              <div className="space-y-6">
                <SmartCard
                  className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                  tabIndex={-1}
                >
                  <SectionHeader
                    icon={<Building2 className="h-5 w-5" />}
                    title="Agency landscape"
                    subtitle={
                      selectedAgency
                        ? `Mandates, positions, and coordination signals for ${selectedAgency.name}`
                        : "Choose an agency to inspect its landscape."
                    }
                  />
                  <div className="mt-5 space-y-4">
                    {!landscape ? (
                      <EmptyPanel
                        title="No agency landscape yet"
                        body="Select an agency from the left column to inspect its issue matrix and related evidence."
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <MetricCard
                            label="Issues"
                            value={landscape.summary.issueCount}
                            icon={<Landmark className="h-4 w-4" />}
                            tone="emerald"
                            detail="Linked issue records"
                          />
                          <MetricCard
                            label="Positions"
                            value={landscape.summary.positionCount}
                            icon={<FileText className="h-4 w-4" />}
                            tone="blue"
                            detail="Actor positions"
                          />
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Issue matrix spotlight
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                Focus the selected agency against the currently
                                active issue lens.
                              </div>
                            </div>
                            {selectedIssue ? (
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700">
                                {selectedIssue.title}
                              </span>
                            ) : null}
                          </div>

                          {selectedLandscapeIssueRow ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                linked {selectedLandscapeIssueRow.counts.linked}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                mandates{" "}
                                {selectedLandscapeIssueRow.counts.mandates}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                positions{" "}
                                {selectedLandscapeIssueRow.counts.positions}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                gaps {selectedLandscapeIssueRow.counts.gaps}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                outgoing{" "}
                                {
                                  selectedLandscapeIssueRow.counts
                                    .outgoingRelations
                                }
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                incoming{" "}
                                {
                                  selectedLandscapeIssueRow.counts
                                    .incomingRelations
                                }
                              </span>
                            </div>
                          ) : (
                            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                              This agency has no matrix row for the currently
                              selected issue.
                            </div>
                          )}

                          <div className="mt-4 space-y-2">
                            {landscape.issueMatrix.length === 0 ? (
                              <div className="text-sm text-slate-600">
                                No issue matrix rows were derived for this
                                agency.
                              </div>
                            ) : (
                              landscape.issueMatrix.slice(0, 8).map((row) => {
                                const active = row.issue.id === selectedIssueId;

                                return (
                                  <button
                                    key={row.issue.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedIssueId(row.issue.id);
                                      setSelectedProvenance(null);
                                    }}
                                    className={[
                                      "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition",
                                      active
                                        ? "border-sky-300 bg-sky-50 shadow-sm"
                                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                                    ].join(" ")}
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-slate-900">
                                        {row.issue.title}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">
                                        mandates {row.counts.mandates} •
                                        positions {row.counts.positions} • gaps{" "}
                                        {row.counts.gaps}
                                      </div>
                                    </div>
                                    <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                  Mandates vs positions
                                </div>
                                <div className="mt-1 text-sm text-slate-600">
                                  Compare formal responsibility with observed
                                  actor stance for the active issue.
                                </div>
                              </div>
                              {selectedIssue ? (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700">
                                  {selectedIssueMandates.length} mandates •{" "}
                                  {selectedIssuePositions.length} positions
                                </span>
                              ) : null}
                            </div>

                            {!selectedIssueId ? (
                              <div className="mt-4 text-sm text-slate-600">
                                Choose an issue to compare mandates and
                                positions.
                              </div>
                            ) : (
                              <div className="mt-4 space-y-3">
                                {selectedIssueMandates
                                  .slice(0, 3)
                                  .map((mandate) => (
                                    <button
                                      key={mandate.id}
                                      type="button"
                                      onClick={() =>
                                        setSelectedProvenance({
                                          title: mandate.title,
                                          subtitle:
                                            mandate.agency?.name ?? "Mandate",
                                          narrative: mandate.description,
                                          chips: [
                                            "mandate",
                                            prettifyTokenLabel(
                                              mandate.mandateType,
                                            ),
                                            selectedIssue?.title ??
                                              mandate.issue?.title ??
                                              "Issue",
                                          ].filter((chip): chip is string =>
                                            Boolean(chip),
                                          ),
                                          provenance: mandate.provenance,
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-white"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="text-sm font-semibold text-slate-900">
                                          {mandate.title}
                                        </div>
                                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                                          {prettifyTokenLabel(
                                            mandate.mandateType,
                                          )}
                                        </span>
                                      </div>
                                      <div className="mt-2 text-xs leading-5 text-slate-600">
                                        {compactText(
                                          mandate.description,
                                          "No mandate description extracted",
                                        )}
                                      </div>
                                    </button>
                                  ))}

                                {selectedIssuePositions
                                  .slice(0, 3)
                                  .map((position) => (
                                    <button
                                      key={position.id}
                                      type="button"
                                      onClick={() =>
                                        setSelectedProvenance({
                                          title:
                                            position.claim?.claimSummary ||
                                            position.claim?.claimText ||
                                            position.stanceSummary ||
                                            "Actor position",
                                          subtitle:
                                            position.agency?.name ?? "Position",
                                          narrative:
                                            position.stanceSummary ||
                                            position.stanceText,
                                          chips: [
                                            "position",
                                            position.polarity
                                              ? prettifyTokenLabel(
                                                  position.polarity,
                                                )
                                              : null,
                                            position.effectiveDateText ||
                                              formatShortDate(
                                                position.effectiveDate,
                                              ),
                                          ].filter((chip): chip is string =>
                                            Boolean(chip),
                                          ),
                                          provenance: position.provenance,
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="text-sm font-semibold text-slate-900">
                                          {position.agency?.shortName ||
                                            position.agency?.name ||
                                            "Unattributed position"}
                                        </div>
                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                                          {position.polarity
                                            ? prettifyTokenLabel(
                                                position.polarity,
                                              )
                                            : "Unscored"}
                                        </span>
                                      </div>
                                      <div className="mt-2 text-xs leading-5 text-slate-600">
                                        {compactText(
                                          position.stanceSummary ||
                                            position.claim?.claimSummary ||
                                            position.claim?.claimText ||
                                            position.stanceText,
                                          "No structured position summary extracted",
                                        )}
                                      </div>
                                    </button>
                                  ))}

                                {selectedIssueMandates.length === 0 &&
                                selectedIssuePositions.length === 0 ? (
                                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                                    No mandates or positions were extracted for
                                    this agency on the active issue.
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                  Gaps & relation watchlist
                                </div>
                                <div className="mt-1 text-sm text-slate-600">
                                  Surface accountability gaps and cross-agency
                                  pressure points around the active issue.
                                </div>
                              </div>
                              {selectedIssue ? (
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700">
                                  {selectedIssueGaps.length} gaps •{" "}
                                  {selectedIssueRelationWatchlist.length}{" "}
                                  relations
                                </span>
                              ) : null}
                            </div>

                            {!selectedIssueId ? (
                              <div className="mt-4 text-sm text-slate-600">
                                Choose an issue to inspect gap and relation
                                evidence.
                              </div>
                            ) : (
                              <div className="mt-4 space-y-3">
                                {selectedIssueGaps.slice(0, 3).map((gap) => (
                                  <button
                                    key={gap.id}
                                    type="button"
                                    onClick={() =>
                                      setSelectedProvenance({
                                        title: gap.summary,
                                        subtitle: prettifyTokenLabel(
                                          gap.gapType,
                                        ),
                                        narrative: gap.summary,
                                        chips: [
                                          "gap",
                                          prettifyTokenLabel(gap.gapType),
                                          gap.primaryAgency?.shortName ||
                                            gap.primaryAgency?.name ||
                                            "Primary agency",
                                          gap.secondaryAgency?.shortName ||
                                            gap.secondaryAgency?.name ||
                                            "Secondary agency",
                                        ].filter((chip): chip is string =>
                                          Boolean(chip),
                                        ),
                                        provenance: gap.provenance,
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-white"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-sm font-semibold text-slate-900">
                                        {prettifyTokenLabel(gap.gapType)}
                                      </div>
                                      <span
                                        className={`rounded-full border px-2 py-1 text-[11px] font-medium ${gapSeverityTone(
                                          gap.severity,
                                        )}`}
                                      >
                                        {gap.severity === null
                                          ? "Severity n/a"
                                          : `Severity ${Math.round(gap.severity * 100)}%`}
                                      </span>
                                    </div>
                                    <div className="mt-2 text-xs leading-5 text-slate-600">
                                      {compactText(gap.summary)}
                                    </div>
                                  </button>
                                ))}

                                {selectedIssueRelationWatchlist
                                  .slice(0, 4)
                                  .map((item) => (
                                    <button
                                      key={`${item.direction}-${item.relation.id}`}
                                      type="button"
                                      onClick={() =>
                                        setSelectedProvenance({
                                          title:
                                            item.relation.rationale ||
                                            item.relation.fromClaim
                                              ?.claimSummary ||
                                            item.relation.toClaim
                                              ?.claimSummary ||
                                            `${relationDirectionLabel(item.direction)} evidence`,
                                          subtitle:
                                            item.relation.otherAgency?.name ??
                                            relationDirectionLabel(
                                              item.direction,
                                            ),
                                          narrative:
                                            item.relation.rationale ||
                                            item.relation.fromClaim
                                              ?.claimText ||
                                            item.relation.toClaim?.claimText ||
                                            null,
                                          chips: [
                                            item.direction,
                                            prettifyTokenLabel(
                                              item.relation.relationType,
                                            ),
                                            item.relation.otherAgency
                                              ?.shortName ||
                                              item.relation.otherAgency?.name ||
                                              "External agency",
                                          ].filter((chip): chip is string =>
                                            Boolean(chip),
                                          ),
                                          provenance: item.relation.provenance,
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="text-sm font-semibold text-slate-900">
                                          {item.relation.otherAgency?.name ||
                                            "Related agency"}
                                        </div>
                                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                                          {prettifyTokenLabel(
                                            item.relation.relationType,
                                          )}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-500">
                                        {relationDirectionLabel(item.direction)}
                                      </div>
                                      <div className="mt-2 text-xs leading-5 text-slate-600">
                                        {compactText(
                                          item.relation.rationale ||
                                            item.relation.fromClaim
                                              ?.claimSummary ||
                                            item.relation.toClaim?.claimSummary,
                                          "No relation rationale extracted",
                                        )}
                                      </div>
                                    </button>
                                  ))}

                                {selectedIssueGaps.length === 0 &&
                                selectedIssueRelationWatchlist.length === 0 ? (
                                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                                    No gap or relation watchlist items were
                                    extracted for this agency on the active
                                    issue.
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Comparison candidates
                              </div>
                              <div className="mt-1 text-sm text-slate-600">
                                Jump to adjacent institutions that appear in the
                                same gaps or relations for the active issue.
                              </div>
                            </div>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                              {comparisonAgencyPreview.length} related agencies
                            </span>
                          </div>

                          {comparisonAgencyPreview.length === 0 ? (
                            <div className="mt-4 text-sm text-slate-600">
                              No adjacent agencies were surfaced from the
                              current issue-specific gaps or relations.
                            </div>
                          ) : (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {comparisonAgencyPreview.map((agency) => (
                                <button
                                  key={agency.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedAgencyId(agency.id);
                                    setSelectedProvenance(null);
                                  }}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  {agency.shortName || agency.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </SmartCard>

                <SmartCard
                  className="sticky top-[92px] border-white/70 bg-white/90 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
                  tabIndex={-1}
                >
                  <SectionHeader
                    icon={<BookOpen className="h-5 w-5" />}
                    title="Evidence drawer"
                    subtitle="Every structured item should stay traceable to chunks, pages, and capture lineage."
                  />

                  {!selectedProvenance ? (
                    <div className="mt-5">
                      <EmptyPanel
                        title="Select a timeline or relation item"
                        body="Click any timeline entry or contradiction card to inspect its provenance, evidence snippet, and capture lineage."
                      />
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-950">
                          {selectedProvenance.title}
                        </div>
                        {selectedProvenance.subtitle && (
                          <div className="mt-1 text-sm text-slate-600">
                            {selectedProvenance.subtitle}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {selectedProvenance.chips.map((chip) => (
                          <span
                            key={chip}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>

                      {selectedProvenance.narrative && (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-6 text-slate-700">
                          {selectedProvenance.narrative}
                        </div>
                      )}

                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Provenance metadata
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-950">
                                Trust and extraction signals
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Confidence is conservative and comes only from
                                recorded extraction traces.
                              </div>
                            </div>
                            <div
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceTone(
                                selectedProvenance.provenance?.confidence,
                              )}`}
                            >
                              {confidenceLabel(
                                selectedProvenance.provenance?.confidence,
                              )}
                            </div>
                          </div>

                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                            <div
                              className="h-full rounded-full bg-slate-900/80"
                              style={{
                                width: `${
                                  confidencePct(
                                    selectedProvenance.provenance?.confidence,
                                  ) ?? 0
                                }%`,
                              }}
                            />
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-700">
                            <div>
                              <div className="text-xs text-slate-500">
                                Pipeline
                              </div>
                              <div className="mt-1 font-medium text-slate-900">
                                {compactText(
                                  selectedProvenance.provenance?.pipeline?.name,
                                )}{" "}
                                •{" "}
                                {compactText(
                                  selectedProvenance.provenance?.pipeline
                                    ?.version,
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-500">
                                Model / extraction version
                              </div>
                              <div className="mt-1 font-medium text-slate-900">
                                {compactText(
                                  selectedProvenance.provenance
                                    ?.extractionModel,
                                )}{" "}
                                •{" "}
                                {compactText(
                                  selectedProvenance.provenance
                                    ?.extractionVersion,
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 text-sm text-slate-700">
                          <div>
                            <div className="text-xs text-slate-500">Pages</div>
                            <div className="mt-1 font-medium text-slate-900">
                              {(
                                selectedProvenance.provenance?.pageNumbers ?? []
                              ).length
                                ? selectedProvenance.provenance?.pageNumbers.join(
                                    ", ",
                                  )
                                : "No page markers"}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Chunks</div>
                            <div className="mt-1 font-medium text-slate-900">
                              {(selectedProvenance.provenance?.chunkIds ?? [])
                                .length
                                ? `${selectedProvenance.provenance?.chunkIds.length} linked chunks`
                                : "No linked chunks"}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">
                              Model / extraction version
                            </div>
                            <div className="mt-1 font-medium text-slate-900">
                              {compactText(
                                selectedProvenance.provenance?.extractionModel,
                              )}{" "}
                              •{" "}
                              {compactText(
                                selectedProvenance.provenance
                                  ?.extractionVersion,
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">
                              Captured artifact
                            </div>
                            <div className="mt-1 font-medium text-slate-900">
                              {selectedProvenance.provenance?.documentRevision
                                ?.storedFile?.fileName ??
                                "No stored file attached"}
                            </div>
                          </div>
                        </div>

                        {selectedProvenance.provenance?.evidenceText && (
                          <div className="mt-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                              Evidence snippet
                            </div>
                            <div className="mt-2 text-sm leading-6 text-emerald-950">
                              {selectedProvenance.provenance.evidenceText}
                            </div>
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              openArtifactPreview(selectedProvenance.provenance)
                            }
                            disabled={
                              !selectedProvenance.provenance?.documentRevision
                                ?.storedFile?.id
                            }
                            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <ArrowUpRight className="mr-2 h-4 w-4" />
                            Open artifact
                          </button>
                          <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            Trace created{" "}
                            {formatDate(
                              selectedProvenance.provenance?.createdAt,
                            )}
                          </div>
                        </div>
                        {evidenceAuditQuery.data?.length ? (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Recent document activity
                            </div>
                            <div className="mt-3 space-y-2">
                              {evidenceAuditQuery.data.map(
                                (row: AuditLogRow) => (
                                  <div
                                    key={row.id}
                                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2"
                                  >
                                    <div>
                                      <div className="text-sm font-medium text-slate-900">
                                        {prettifyAuditAction(row.action)}
                                      </div>
                                      <div className="mt-1 text-[12px] text-slate-500">
                                        {row.status} ·{" "}
                                        {formatDate(row.createdAt)}
                                      </div>
                                    </div>
                                    <div className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
                                      {row.resourceType}
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </SmartCard>
              </div>
            </div>
          )}
        </>
      )}

      <NotebookTemplateModal
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        defaultTemplateKey={templatePreset}
        documentId={activeDocumentId}
        issueId={selectedIssueId}
        issueTitle={selectedIssue?.title ?? null}
        agencyId={selectedAgencyId}
        agencyName={selectedAgency?.name ?? null}
        relationType={relationFilter === "all" ? null : relationFilter}
        workspaceMode={workspaceMode}
        sourceLabel={sourceDescriptor}
        documentContext={
          overview?.document
            ? {
                documentId: overview.document.id,
                kind: overview.document.kind,
                urlId: overview.document.urlId,
                primaryFileId: overview.document.primaryFileId,
              }
            : null
        }
      />
    </div>
  );
}
