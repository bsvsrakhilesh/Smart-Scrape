import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Building2,
  FileText,
  GitBranch,
  Landmark,
  Loader2,
  Network,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";

import SmartCard from "../components/ui/SmartCard";
import CaseWorkspacePanel from "../components/governance/CaseWorkspacePanel";
import {
  apiUrl,
  getAuditLogs,
  getDocumentGovernance,
  getGovernanceAgencyLandscape,
  getGovernanceIssueRelations,
  getGovernanceIssueTimeline,
  getUrlRevisions,
  type AuditLogRow,
  type GovernanceAgency,
  type GovernanceIssue,
  type GovernanceProvenance,
  type GovernanceRelationType,
} from "../lib/api";
import NotebookTemplateModal from "../components/governance/NotebookTemplateModal";
import type { NotebookTemplateKey } from "../lib/notebookClient";
import {
  consumeGovernanceWorkspaceIntent,
  type GovernanceWorkspaceIntent,
} from "../lib/governanceWorkspace";

type RelationFilter = "all" | GovernanceRelationType;

type ProvenanceSelection = {
  title: string;
  subtitle: string | null;
  narrative: string | null;
  chips: string[];
  provenance: GovernanceProvenance | null;
};

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

    if (pending.documentId) {
      setDocumentInput(pending.documentId);
      setActiveDocumentId(pending.documentId);
    }

    if (pending.selectedIssueId) {
      setSelectedIssueId(pending.selectedIssueId);
    }

    if (pending.selectedAgencyId) {
      setSelectedAgencyId(pending.selectedAgencyId);
    }
  }, []);

  const urlResolutionQuery = useQuery({
    queryKey: ["governance-workspace", "resolve-url", launchIntent?.urlId],
    enabled: Boolean(launchIntent?.urlId) && !activeDocumentId,
    queryFn: async () => getUrlRevisions(Number(launchIntent?.urlId), 1),
  });

  useEffect(() => {
    if (urlResolutionQuery.data?.documentId) {
      setDocumentInput(urlResolutionQuery.data.documentId);
      setActiveDocumentId(urlResolutionQuery.data.documentId);
    }
  }, [urlResolutionQuery.data?.documentId]);

  const documentQuery = useQuery({
    queryKey: ["governance-document", activeDocumentId],
    enabled: Boolean(activeDocumentId),
    queryFn: async () =>
      getDocumentGovernance(String(activeDocumentId), { limit: 160 }),
  });

  const overview = documentQuery.data ?? null;

  useEffect(() => {
    if (!overview) return;

    if (
      !selectedIssueId ||
      !overview.issues.some((issue) => issue.id === selectedIssueId)
    ) {
      setSelectedIssueId(overview.issues[0]?.id ?? null);
    }

    if (
      !selectedAgencyId ||
      !overview.agencies.some((agency) => agency.id === selectedAgencyId)
    ) {
      setSelectedAgencyId(overview.agencies[0]?.id ?? null);
    }
  }, [overview, selectedIssueId, selectedAgencyId]);

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
    if (!overview || !selectedIssueId) return null;
    return (
      overview.issues.find((issue) => issue.id === selectedIssueId) ?? null
    );
  }, [overview, selectedIssueId]);

  const selectedAgency = useMemo<GovernanceAgency | null>(() => {
    if (!overview || !selectedAgencyId) return null;
    return (
      overview.agencies.find((agency) => agency.id === selectedAgencyId) ?? null
    );
  }, [overview, selectedAgencyId]);

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
    documentQuery.isLoading ||
    urlResolutionQuery.isLoading ||
    timelineQuery.isLoading ||
    relationsQuery.isLoading ||
    agencyLandscapeQuery.isLoading;

  const anyError =
    (urlResolutionQuery.error as Error | null) ||
    (documentQuery.error as Error | null) ||
    (timelineQuery.error as Error | null) ||
    (relationsQuery.error as Error | null) ||
    (agencyLandscapeQuery.error as Error | null);

  const sourceDescriptor =
    launchIntent?.sourceLabel ??
    overview?.document.kind ??
    "Bring in a document from File Manager or Saved URLs";

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

  function openTemplateModal(templateKey: NotebookTemplateKey) {
    setTemplatePreset(templateKey);
    setTemplateModalOpen(true);
  }

  return (
    <div className="space-y-6 py-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.86),rgba(240,249,255,0.82),rgba(236,253,245,0.84))] p-6 shadow-[0_24px_60px_rgba(15,23,42,0.10)] backdrop-blur-xl"
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.12),transparent_30%),radial-gradient(circle_at_left,rgba(16,185,129,0.12),transparent_35%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
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

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] lg:min-w-[480px]">
            <label className="rounded-2xl border border-white/70 bg-white/85 p-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Document ID
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
            </label>

            <div className="flex items-center gap-2">
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
                  if (activeDocumentId) {
                    void documentQuery.refetch();
                    if (selectedIssueId) void timelineQuery.refetch();
                    if (selectedIssueId) void relationsQuery.refetch();
                    if (selectedAgencyId) void agencyLandscapeQuery.refetch();
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
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="inline-flex items-center rounded-full border border-white/70 bg-white/70 px-3 py-1 shadow-sm">
            Launch source: {sourceDescriptor}
          </span>
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

        {activeDocumentId ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[26px] border border-white/70 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <div className="mr-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Notebook actions
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Turn the current governance lens into a durable notebook
                artifact.
              </div>
            </div>

            <button
              type="button"
              onClick={() => openTemplateModal("governance_brief")}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50"
            >
              <BookOpen className="h-4 w-4" />
              Governance Brief
            </button>

            <button
              type="button"
              onClick={() => openTemplateModal("contradiction_brief")}
              disabled={!selectedIssueId}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4" />
              Contradiction Brief
            </button>

            <button
              type="button"
              onClick={() => openTemplateModal("case_timeline_note")}
              disabled={!selectedIssueId}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Network className="h-4 w-4" />
              Case Timeline Note
            </button>

            <button
              type="button"
              onClick={() =>
                openTemplateModal("accountability_coordination_gap_note")
              }
              disabled={!selectedIssueId}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Landmark className="h-4 w-4" />
              Gap Note
            </button>
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
                : "Case Review mode"}
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
                Case Review
              </button>
            </div>
          </div>

          {workspaceMode === "case" && selectedIssueId ? (
            <CaseWorkspacePanel
              issueId={selectedIssueId}
              issueTitle={selectedIssue?.title ?? null}
              actorAgencyId={selectedAgencyId}
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
                    title="Document focus"
                    subtitle="Choose the issue and agency lens for the workspace."
                  />
                  <div className="mt-5 space-y-4">
                    <label className="block">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Governance issue
                      </div>
                      <select
                        value={selectedIssueId ?? ""}
                        onChange={(e) => {
                          setSelectedIssueId(e.target.value || null);
                          setSelectedProvenance(null);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      >
                        {(overview?.issues ?? []).map((issue) => (
                          <option key={issue.id} value={issue.id}>
                            {issue.title}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Agency lens
                      </div>
                      <select
                        value={selectedAgencyId ?? ""}
                        onChange={(e) => {
                          setSelectedAgencyId(e.target.value || null);
                          setSelectedProvenance(null);
                        }}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                      >
                        {(overview?.agencies ?? []).map((agency) => (
                          <option key={agency.id} value={agency.id}>
                            {agency.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-6 space-y-3">
                    {(overview?.issues ?? []).length === 0 ? (
                      <EmptyPanel
                        title="No governance issues extracted yet"
                        body="Run tagging/extraction on a richer governance document and reopen this workspace."
                      />
                    ) : (
                      (overview?.issues ?? []).slice(0, 8).map((issue) => {
                        const active = issue.id === selectedIssueId;
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
                                {issue.kind}
                              </span>
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
                    title="Agencies"
                    subtitle="Scan institutions represented in the current document."
                  />
                  <div className="mt-5 space-y-3">
                    {(overview?.agencies ?? []).length === 0 ? (
                      <EmptyPanel
                        title="No agencies extracted"
                        body="The selected document does not yet contain structured institution entities."
                      />
                    ) : (
                      (overview?.agencies ?? []).slice(0, 12).map((agency) => {
                        const active = agency.id === selectedAgencyId;
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
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-600">
                              {agency.category && (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                  {agency.category}
                                </span>
                              )}
                              {agency.jurisdiction && (
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                                  {agency.jurisdiction}
                                </span>
                              )}
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
                          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Issue matrix
                          </div>
                          <div className="mt-3 space-y-2">
                            {landscape.issueMatrix.length === 0 ? (
                              <div className="text-sm text-slate-600">
                                No issue matrix rows were derived for this
                                agency.
                              </div>
                            ) : (
                              landscape.issueMatrix.slice(0, 8).map((row) => (
                                <button
                                  key={row.issue.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedIssueId(row.issue.id);
                                  }}
                                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-900">
                                      {row.issue.title}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">
                                      mandates {row.counts.mandates} • positions{" "}
                                      {row.counts.positions} • gaps{" "}
                                      {row.counts.gaps}
                                    </div>
                                  </div>
                                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-400" />
                                </button>
                              ))
                            )}
                          </div>
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
      />
    </div>
  );
}
