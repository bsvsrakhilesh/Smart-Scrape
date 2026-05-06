import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Activity,
  ArrowUpRight,
  BookOpen,
  Building2,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Filter,
  GitBranch,
  Gauge,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  Scale,
  ShieldAlert,
} from "lucide-react";

import SmartCard from "../ui/SmartCard";
import {
  apiUrl,
  getGovernanceIssueCaseWorkspace,
  type GovernanceCaseActorCard,
  type GovernanceClaim,
  type GovernanceGap,
  type GovernanceWorkspaceEvidenceResponse,
  type GovernanceMandate,
  type GovernanceProvenance,
  type GovernanceRelation,
  type GovernanceRelationType,
  type GovernanceTimelineEntry,
} from "../../lib/api";

type RelationFilter = "all" | GovernanceRelationType;

type ProvenanceSelection = {
  title: string;
  subtitle: string | null;
  narrative: string | null;
  chips: string[];
  provenance: GovernanceProvenance | null;
};

type DecisionFactor = {
  key: string;
  label: string;
  description: string;
  count: number;
  tone: string;
  icon: React.ReactNode;
  evidence: ProvenanceSelection | null;
};

type DecisionRecord = {
  id: string;
  title: string;
  detail: string;
  date: string | null;
  agency: string;
  kind: string;
  provenance: ProvenanceSelection;
};

type QuestionReviewSurface =
  GovernanceWorkspaceEvidenceResponse["questionReviewSurface"];

type CaseWorkspacePanelProps = {
  issueId: string;
  issueTitle?: string | null;
  actorAgencyId: string | null;
  reviewQuestion?: string | null;
  questionReviewSurface?: QuestionReviewSurface | null;
  onActorAgencyIdChange: (agencyId: string | null) => void;
  onClose: () => void;
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

const decisionFactorDefinitions = [
  {
    key: "context",
    label: "Context and trigger",
    description: "Background conditions, events, timing, or circumstances that made the question relevant.",
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
    tone: "border-sky-200 bg-sky-50 text-sky-900",
    icon: <Gauge className="h-4 w-4" />,
  },
  {
    key: "evidence",
    label: "Evidence considered",
    description: "Reports, records, observations, data, findings, or source material cited in the evidence set.",
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
    tone: "border-cyan-200 bg-cyan-50 text-cyan-900",
    icon: <Activity className="h-4 w-4" />,
  },
  {
    key: "agency_inputs",
    label: "Institutional inputs",
    description: "Agency positions, submissions, recommendations, dissent, and inter-institutional signals.",
    terms: [
      "meeting",
      "minutes",
      "recommended",
      "input",
      "committee",
      "agency",
      "department",
      "member",
      "reviewed",
    ],
    tone: "border-violet-200 bg-violet-50 text-violet-900",
    icon: <MessageSquareQuote className="h-4 w-4" />,
  },
  {
    key: "authority",
    label: "Authority or mandate basis",
    description: "Legal, policy, mandate, direction, order, jurisdiction, or responsibility basis.",
    terms: [
      "direction",
      "order",
      "mandate",
      "jurisdiction",
      "authority",
      "policy",
      "rule",
      "act",
      "compliance",
      "responsible",
    ],
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    icon: <ClipboardCheck className="h-4 w-4" />,
  },
  {
    key: "decision_actions",
    label: "Decision and actions",
    description: "Conclusions, approvals, restrictions, actions taken, or implementation choices.",
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
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    icon: <ListChecks className="h-4 w-4" />,
  },
  {
    key: "follow_up",
    label: "Follow-up and outcomes",
    description: "Follow-up actions, monitoring, reports, outcomes, compliance status, or continuity signals.",
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
    tone: "border-teal-200 bg-teal-50 text-teal-900",
    icon: <ClipboardCheck className="h-4 w-4" />,
  },
  {
    key: "uncertainty",
    label: "Contradictions and gaps",
    description: "Conflicts, unresolved questions, scope differences, missing evidence, or analyst-review flags.",
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
    tone: "border-rose-200 bg-rose-50 text-rose-900",
    icon: <ShieldAlert className="h-4 w-4" />,
  },
] as const;

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

function relationBucketTone(bucket?: string) {
  switch (bucket) {
    case "conflict":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "alignment":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "temporal_shift_candidate":
      return "border-violet-200 bg-violet-50 text-violet-800";
    case "scope_variant_candidate":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function humanizeBucket(bucket?: string) {
  return String(bucket || "reference").replace(/_/g, " ");
}

function openArtifactPreview(provenance: GovernanceProvenance | null) {
  const fileId = provenance?.documentRevision?.storedFile?.id;
  if (!fileId) return;
  window.open(apiUrl(`/api/files/${fileId}/preview`), "_blank", "noopener");
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-6 text-sm text-slate-600">
      <div className="font-medium text-slate-900">{title}</div>
      <p className="mt-2 leading-6">{body}</p>
    </div>
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
    <div className="flex items-start justify-between gap-4 ">
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

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <SmartCard
      className="overflow-hidden border border-white/70 bg-white/85 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
      tabIndex={-1}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-950">
              {value}
            </div>
            <div className="mt-2 text-sm text-slate-600">{detail}</div>
          </div>
          <div className="rounded-2xl border border-white/70 bg-slate-50 p-3 text-slate-700 shadow-sm">
            {icon}
          </div>
        </div>
      </div>
    </SmartCard>
  );
}

function buildTimelineProvenance(
  entry: GovernanceTimelineEntry,
): ProvenanceSelection {
  return {
    title: entry.label,
    subtitle: entry.actorAgency?.name ?? entry.itemType,
    narrative:
      entry.summary ??
      entry.position?.stanceSummary ??
      entry.position?.stanceText ??
      entry.event?.summary ??
      null,
    chips: [
      entry.itemType,
      entry.sortPrecision ?? "unknown",
      entry.actorAgency?.name ?? "Unattributed",
    ].filter((chip): chip is string => Boolean(chip)),
    provenance: entry.provenance,
  };
}

function buildRelationProvenance(
  relation: GovernanceRelation,
): ProvenanceSelection {
  return {
    title:
      relation.fromAgency?.name && relation.toAgency?.name
        ? `${relation.fromAgency.name} → ${relation.toAgency.name}`
        : relation.relationType,
    subtitle: relation.relationType,
    narrative:
      relation.rationale ??
      relation.fromClaim?.claimSummary ??
      relation.toClaim?.claimSummary ??
      null,
    chips: [
      relation.relationType,
      relation.analysis?.bucket
        ? humanizeBucket(relation.analysis.bucket)
        : null,
      relation.fromAgency?.shortName || relation.fromAgency?.name || "Source",
      relation.toAgency?.shortName || relation.toAgency?.name || "Target",
    ].filter((chip): chip is string => Boolean(chip)),
    provenance: relation.provenance,
  };
}

function includesAnyTerm(text: string, terms: readonly string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function timelineText(entry: GovernanceTimelineEntry) {
  return [
    entry.label,
    entry.summary,
    entry.position?.stanceSummary,
    entry.position?.stanceText,
    entry.event?.summary,
    entry.actorAgency?.name,
    entry.actorAgency?.shortName,
  ]
    .filter(Boolean)
    .join(" ");
}

function claimText(claim: GovernanceClaim) {
  return [
    claim.claimSummary,
    claim.claimText,
    claim.scopeText,
    claim.subjectAgency?.name,
    claim.subjectAgency?.shortName,
  ]
    .filter(Boolean)
    .join(" ");
}

function mandateText(mandate: GovernanceMandate) {
  return [
    mandate.title,
    mandate.description,
    mandate.mandateType,
    mandate.agency?.name,
    mandate.agency?.shortName,
  ]
    .filter(Boolean)
    .join(" ");
}

function gapText(gap: GovernanceGap) {
  return [
    gap.summary,
    gap.gapType,
    gap.primaryAgency?.name,
    gap.primaryAgency?.shortName,
    gap.secondaryAgency?.name,
    gap.secondaryAgency?.shortName,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildDecisionFactors(args: {
  timelineEntries: GovernanceTimelineEntry[];
  claims: GovernanceClaim[];
  mandates: GovernanceMandate[];
  gaps: GovernanceGap[];
}): DecisionFactor[] {
  return decisionFactorDefinitions.map((definition) => {
    const timelineMatches = args.timelineEntries.filter((entry) =>
      includesAnyTerm(timelineText(entry), definition.terms),
    );
    const claimMatches = args.claims.filter((claim) =>
      includesAnyTerm(claimText(claim), definition.terms),
    );
    const mandateMatches = args.mandates.filter((mandate) =>
      includesAnyTerm(mandateText(mandate), definition.terms),
    );
    const gapMatches = args.gaps.filter((gap) =>
      includesAnyTerm(gapText(gap), definition.terms),
    );

    const firstTimeline = timelineMatches[0];
    const firstClaim = claimMatches[0];
    const firstMandate = mandateMatches[0];
    const firstGap = gapMatches[0];

    const evidence = firstTimeline
      ? buildTimelineProvenance(firstTimeline)
      : firstClaim
        ? {
            title: firstClaim.claimSummary || firstClaim.claimText,
            subtitle: firstClaim.subjectAgency?.name ?? "claim",
            narrative: firstClaim.claimText,
            chips: ["claim", firstClaim.polarity ?? "unknown"],
            provenance: firstClaim.provenance,
          }
        : firstMandate
          ? {
              title: firstMandate.title,
              subtitle: firstMandate.agency?.name ?? firstMandate.mandateType,
              narrative: firstMandate.description,
              chips: ["mandate", firstMandate.mandateType],
              provenance: firstMandate.provenance,
            }
          : firstGap
            ? {
                title: firstGap.summary,
                subtitle: firstGap.primaryAgency?.name ?? firstGap.gapType,
                narrative: firstGap.summary,
                chips: ["gap", firstGap.gapType],
                provenance: firstGap.provenance,
              }
            : null;

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      count:
        timelineMatches.length +
        claimMatches.length +
        mandateMatches.length +
        gapMatches.length,
      tone: definition.tone,
      icon: definition.icon,
      evidence,
    };
  });
}

function buildDecisionRecords(
  timelineEntries: GovernanceTimelineEntry[],
): DecisionRecord[] {
  const triggerTerms = [
    "decision",
    "decided",
    "considered",
    "reason",
    "because",
    "evidence",
    "meeting",
    "direction",
    "order",
    "action",
    "compliance",
    "review",
    "restriction",
    "approval",
    "permitted",
  ];

  return timelineEntries
    .filter((entry) => includesAnyTerm(timelineText(entry), triggerTerms))
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      title: entry.label,
      detail: compactText(
        entry.summary ?? entry.position?.stanceSummary ?? entry.event?.summary,
        "No reasoning summary extracted",
      ),
      date: entry.sortDate,
      agency:
        entry.actorAgency?.shortName ||
        entry.actorAgency?.name ||
        "Unattributed",
      kind: entry.itemType,
      provenance: buildTimelineProvenance(entry),
    }));
}

function buildActionRecords(
  timelineEntries: GovernanceTimelineEntry[],
): DecisionRecord[] {
  const actionTerms = [
    "directed",
    "direction",
    "shall",
    "submit",
    "report",
    "compliance",
    "implemented",
    "monitor",
    "enforce",
    "inspection",
    "follow-up",
    "follow up",
    "action taken",
  ];

  return timelineEntries
    .filter((entry) => includesAnyTerm(timelineText(entry), actionTerms))
    .slice(0, 8)
    .map((entry) => ({
      id: entry.id,
      title: entry.label,
      detail: compactText(
        entry.summary ?? entry.position?.stanceSummary ?? entry.event?.summary,
        "No follow-up summary extracted",
      ),
      date: entry.sortDate,
      agency:
        entry.actorAgency?.shortName ||
        entry.actorAgency?.name ||
        "Unattributed",
      kind: entry.itemType,
      provenance: buildTimelineProvenance(entry),
    }));
}

export default function CaseWorkspacePanel({
  issueId,
  issueTitle,
  actorAgencyId,
  reviewQuestion,
  questionReviewSurface,
  onActorAgencyIdChange,
  onClose,
}: CaseWorkspacePanelProps) {
  const [relationFilter, setRelationFilter] = useState<RelationFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedProvenance, setSelectedProvenance] =
    useState<ProvenanceSelection | null>(null);

  const caseQuery = useQuery({
    queryKey: [
      "governance-case-workspace",
      issueId,
      actorAgencyId,
      relationFilter,
      dateFrom,
      dateTo,
    ],
    enabled: Boolean(issueId),
    queryFn: async () =>
      getGovernanceIssueCaseWorkspace(issueId, {
        actorAgencyId: actorAgencyId || undefined,
        relationType: relationFilter === "all" ? undefined : relationFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: 220,
      }),
  });

  const workspace = caseQuery.data ?? null;
  const actors = workspace?.actors ?? [];
  const contradictions = workspace?.relations.contradictions ?? [];
  const alignments = workspace?.relations.alignments ?? [];
  const timelineEntries = workspace?.timeline.entries ?? [];
  const sources = workspace?.sources ?? [];
  const claims = workspace?.claims ?? [];
  const mandates = workspace?.mandates ?? [];
  const gaps = workspace?.gaps ?? [];
  const relationSummary = workspace?.relations.summary ?? null;
  const relationBucketSummary = relationSummary?.byBucket ?? {};

  useEffect(() => {
    setSelectedProvenance(null);
  }, [issueId, actorAgencyId, relationFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!workspace || selectedProvenance) return;

    const firstRelation = contradictions[0];
    if (firstRelation) {
      setSelectedProvenance(buildRelationProvenance(firstRelation));
      return;
    }

    const firstTimeline = timelineEntries[0];
    if (firstTimeline) {
      setSelectedProvenance(buildTimelineProvenance(firstTimeline));
    }
  }, [workspace, contradictions, timelineEntries, selectedProvenance]);

  const selectedActor = useMemo<GovernanceCaseActorCard | null>(() => {
    if (!actorAgencyId) return null;
    return actors.find((actor) => actor.agency?.id === actorAgencyId) ?? null;
  }, [actors, actorAgencyId]);

  const decisionFactors = useMemo(
    () => buildDecisionFactors({ timelineEntries, claims, mandates, gaps }),
    [timelineEntries, claims, mandates, gaps],
  );
  const coveredDecisionFactors = decisionFactors.filter(
    (factor) => factor.count > 0,
  );
  const decisionRecords = useMemo(
    () => buildDecisionRecords(timelineEntries),
    [timelineEntries],
  );
  const actionRecords = useMemo(
    () => buildActionRecords(timelineEntries),
    [timelineEntries],
  );
  const decisionReadiness =
    workspace && workspace.summary.sourceCount > 0
      ? Math.min(
          100,
          Math.round(
            (coveredDecisionFactors.length / decisionFactors.length) * 55 +
              Math.min(workspace.summary.sourceCount, 10) * 3 +
              Math.min(actionRecords.length, 5) * 3,
          ),
        )
      : 0;
  const reviewReadiness = questionReviewSurface?.active
    ? Math.min(
        100,
        Math.round(
          (questionReviewSurface.summary.factorCount /
            Math.max(1, decisionFactorDefinitions.length)) *
            45 +
            Math.min(questionReviewSurface.summary.sourceCount, 10) * 3 +
            Math.min(questionReviewSurface.summary.timelineHighlightCount, 8) *
              2 +
            Math.min(questionReviewSurface.summary.actorCount, 6) * 2,
        ),
      )
    : decisionReadiness;

  const surfaceFactorByKey = useMemo(() => {
    const map = new Map(
      (questionReviewSurface?.factors ?? []).map((factor) => [
        factor.key,
        factor,
      ]),
    );
    return map;
  }, [questionReviewSurface?.factors]);

  const reviewFactors = decisionFactors.map((factor) => {
    const surfaceFactor = surfaceFactorByKey.get(factor.key);
    return {
      ...factor,
      count: Math.max(factor.count, surfaceFactor?.count ?? 0),
      description: surfaceFactor?.description ?? factor.description,
      surfaceSignal: surfaceFactor?.strongestSignal ?? null,
    };
  });

  const coveredReviewFactors = reviewFactors.filter(
    (factor) => factor.count > 0,
  );

  const answerSignals = questionReviewSurface?.answerSignals ?? [];
  const openQuestions =
    questionReviewSurface?.openQuestions?.length
      ? questionReviewSurface.openQuestions
      : [
          gaps[0]?.summary,
          relationSummary?.requiresAnalystReviewCount
            ? `${relationSummary.requiresAnalystReviewCount} relation signal(s) need analyst review before final use.`
            : null,
          !sources.length
            ? "No source trail is available for this issue yet."
            : null,
        ].filter((item): item is string => Boolean(item));
  const questionLabel =
    compactText(reviewQuestion, workspace?.issue?.title ?? issueTitle ?? "Review this issue");

  const anyError = caseQuery.error as Error | null;

  return (
    <div className="space-y-6">
      <SmartCard
        className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
        tabIndex={-1}
      >
        <SectionHeader
          icon={<Scale className="h-5 w-5" />}
          title="Question Review"
          subtitle={
            questionLabel
          }
          action={
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Back to governance map
            </button>
          }
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Actors"
            value={workspace?.summary.agencyCount ?? 0}
            detail="Agencies linked to this issue in positions, events, mandates, and relations."
            icon={<Building2 className="h-5 w-5" />}
          />
          <MetricCard
            label="Timeline entries"
            value={workspace?.summary.timelineEntryCount ?? 0}
            detail="Merged event and position entries ready for chronological review."
            icon={<CalendarClock className="h-5 w-5" />}
          />
          <MetricCard
            label="Contradictions"
            value={workspace?.summary.contradictionCount ?? 0}
            detail="Conservative contradiction, tension, or override candidates only."
            icon={<ShieldAlert className="h-5 w-5" />}
          />
          <MetricCard
            label="Sources"
            value={workspace?.summary.sourceCount ?? 0}
            detail="Distinct source documents contributing structured case evidence."
            icon={<FileText className="h-5 w-5" />}
          />
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-[0_22px_50px_rgba(15,23,42,0.18)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-100">
                <Gauge className="h-3.5 w-3.5" />
                Evidence-backed question review
              </div>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">
                Analyst workbench for the exact question
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Review what the evidence supports, which factors appear in the
                record, who contributed, what actions followed, and where the
                answer still needs human verification.
              </p>
            </div>

            <div className="grid min-w-[240px] grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-300">
                  Readiness
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {reviewReadiness}%
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-300">
                  Factors
                </div>
                <div className="mt-2 text-2xl font-semibold">
                  {coveredReviewFactors.length}/{reviewFactors.length}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {reviewFactors.map((factor) => (
              <button
                key={factor.key}
                type="button"
                onClick={() => {
                  if (factor.evidence) setSelectedProvenance(factor.evidence);
                }}
                disabled={!factor.evidence}
                className={[
                  "rounded-2xl border bg-white p-3 text-left transition disabled:cursor-default disabled:opacity-55",
                  factor.tone,
                  factor.evidence ? "hover:-translate-y-0.5 hover:shadow-lg" : "",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-xl border border-black/5 bg-white/70 p-2">
                    {factor.icon}
                  </span>
                  <span className="rounded-full border border-black/5 bg-white/70 px-2 py-1 text-[11px] font-semibold">
                    {factor.count}
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold">
                  {factor.label}
                </div>
                <div className="mt-1 text-xs leading-5 opacity-80">
                  {factor.description}
                </div>
                {!factor.evidence && factor.surfaceSignal ? (
                  <div className="mt-2 rounded-xl border border-black/5 bg-white/70 p-2 text-xs leading-5 opacity-90">
                    {factor.surfaceSignal.detail}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr),minmax(280px,0.6fr)]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Answer snapshot
            </div>
            {answerSignals.length ? (
              <div className="mt-3 space-y-3">
                {answerSignals.slice(0, 3).map((signal) => (
                  <div
                    key={signal.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/80 p-3"
                  >
                    <div className="text-sm font-semibold text-slate-900">
                      {signal.label}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-slate-600">
                      {signal.detail}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      {signal.agencyName ? <span>{signal.agencyName}</span> : null}
                      {signal.issueTitle ? <span>{signal.issueTitle}</span> : null}
                      {signal.sourceTitle ? <span>{signal.sourceTitle}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The panel will build a concise answer after evidence retrieval
                surfaces ranked source signals. The sections below still show
                structured issue evidence and provenance.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
              Needs verification
            </div>
            {openQuestions.length ? (
              <div className="mt-3 space-y-2">
                {openQuestions.slice(0, 4).map((question) => (
                  <div
                    key={question}
                    className="rounded-xl border border-amber-200 bg-white/80 p-3 text-sm leading-6 text-slate-700"
                  >
                    {question}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                No verification warnings were generated for the current view.
              </p>
            )}
          </div>
        </div>

        {anyError && (
          <div className="mt-5 rounded-2xl border border-red-200/80 bg-red-50/90 p-4 text-sm text-red-700">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold text-red-900">
                  Case review request failed
                </div>
                <div className="mt-1">{anyError.message}</div>
              </div>
            </div>
          </div>
        )}
      </SmartCard>

      <div className="grid gap-6 xl:grid-cols-[300px,minmax(0,1fr),360px]">
        <div className="space-y-6">
          <SmartCard
            className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            tabIndex={-1}
          >
            <SectionHeader
              icon={<Filter className="h-5 w-5" />}
              title="Case filters"
              subtitle="Narrow by actor, relation type, and date window."
            />

            <div className="mt-5 space-y-4">
              <label className="block">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Actor filter
                </div>
                <select
                  value={actorAgencyId ?? ""}
                  onChange={(e) =>
                    onActorAgencyIdChange(e.target.value || null)
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">All actors</option>
                  {actors.map((actor) => (
                    <option
                      key={actor.agency?.id ?? actor.agency?.name}
                      value={actor.agency?.id ?? ""}
                    >
                      {actor.agency?.name ?? "Unknown actor"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Relation filter
                </div>
                <select
                  value={relationFilter}
                  onChange={(e) =>
                    setRelationFilter(e.target.value as RelationFilter)
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                >
                  {relationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Date from
                  </div>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Date to
                  </div>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                  />
                </label>
              </div>
            </div>
          </SmartCard>

          <SmartCard
            className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            tabIndex={-1}
          >
            <SectionHeader
              icon={<ListChecks className="h-5 w-5" />}
              title="Review checklist"
              subtitle="Questions an analyst can answer before relying on the draft."
            />

            <div className="mt-5 space-y-3">
              {[
                "What evidence directly answers the user's question?",
                "Which institutions gave inputs, changed position, or carried responsibility?",
                "What decision, action, restriction, approval, or conclusion is recorded?",
                "What follow-up actions, reports, compliance checks, or outcomes are visible?",
                "What gaps, contradictions, or source limitations need verification?",
              ].map((question, index) => (
                <div
                  key={question}
                  className="rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700"
                >
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      {index + 1}
                    </span>
                    <span>{question}</span>
                  </div>
                </div>
              ))}

              {gaps.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedProvenance({
                      title: gaps[0].summary,
                      subtitle: gaps[0].gapType,
                      narrative: gaps[0].summary,
                      chips: ["gap", gaps[0].gapType],
                      provenance: gaps[0].provenance,
                    })
                  }
                  className="w-full rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-left transition hover:bg-rose-50"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                    Evidence gap spotlight
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">
                    {gaps[0].summary}
                  </div>
                </button>
              ) : null}
            </div>
          </SmartCard>

          <SmartCard
            className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            tabIndex={-1}
          >
            <SectionHeader
              icon={<Building2 className="h-5 w-5" />}
              title="Actor positions"
              subtitle="Agencies and stance evolution in the current issue."
            />

            <div className="mt-5 space-y-3">
              {caseQuery.isLoading ? (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading actors…
                </div>
              ) : actors.length === 0 ? (
                <EmptyPanel
                  title="No actors found"
                  body="This issue does not yet have actor-level mappings in the extracted evidence."
                />
              ) : (
                actors.map((actor) => {
                  const active = actor.agency?.id === actorAgencyId;
                  return (
                    <button
                      key={actor.agency?.id ?? actor.agency?.name}
                      type="button"
                      onClick={() =>
                        onActorAgencyIdChange(
                          active ? null : (actor.agency?.id ?? null),
                        )
                      }
                      className={[
                        "w-full rounded-2xl border p-3 text-left transition",
                        active
                          ? "border-sky-300 bg-sky-50 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {actor.agency?.name ?? "Unknown actor"}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            {actor.evolution.summary}
                          </div>
                        </div>
                        <span
                          className={[
                            "rounded-full border px-2 py-1 text-[11px] font-medium",
                            actor.evolution.changed
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700",
                          ].join(" ")}
                        >
                          {actor.evolution.kind}
                        </span>
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
              icon={<CalendarClock className="h-5 w-5" />}
              title="Decision chronology"
              subtitle="Past reasoning, triggers, and action records ranked for meeting prep."
            />

            <div className="mt-5 space-y-3">
              {caseQuery.isLoading ? (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Building timeline…
                </div>
              ) : decisionRecords.length === 0 ? (
                <EmptyPanel
                  title="No decision records match the current filter"
                  body="Clear filters or enrich this issue with decisions, meeting notes, evidence records, institutional inputs, and follow-up actions."
                />
              ) : (
                decisionRecords.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelectedProvenance(record.provenance)}
                    className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {record.kind} - decision evidence
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {record.title}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          {record.detail}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-600">
                        <div>{formatShortDate(record.date)}</div>
                        <div className="mt-1 truncate max-w-[120px]">
                          {record.agency}
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
              icon={<ClipboardCheck className="h-5 w-5" />}
              title="Action and follow-up"
              subtitle="What was directed, who owned it, and where continuity may break."
            />

            <div className="mt-5 space-y-3">
              {caseQuery.isLoading ? (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Finding follow-up actions...
                </div>
              ) : actionRecords.length === 0 ? (
                <EmptyPanel
                  title="No follow-up actions found"
                  body="The current evidence set does not yet expose directed actions, compliance reporting, inspections, or implementation records."
                />
              ) : (
                actionRecords.map((record) => (
                  <button
                    key={record.id}
                    type="button"
                    onClick={() => setSelectedProvenance(record.provenance)}
                    className="w-full rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-left transition hover:bg-emerald-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {record.title}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          {record.detail}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-right text-xs text-emerald-800">
                        <div>{formatShortDate(record.date)}</div>
                        <div className="mt-1 truncate max-w-[120px]">
                          {record.agency}
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
              title="Contradictions and alignments"
              subtitle="Evidence-backed relation review only."
            />

            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">
                  conflicts: {relationBucketSummary.conflict ?? 0}
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-800">
                  alignments: {relationBucketSummary.alignment ?? 0}
                </span>
                <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-medium text-violet-800">
                  temporal shifts:{" "}
                  {relationBucketSummary.temporal_shift_candidate ?? 0}
                </span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-800">
                  scope variants:{" "}
                  {relationBucketSummary.scope_variant_candidate ?? 0}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700">
                  analyst review:{" "}
                  {relationSummary?.requiresAnalystReviewCount ?? 0}
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Tension set
                  </div>
                  {contradictions.length === 0 ? (
                    <EmptyPanel
                      title="No contradiction candidates"
                      body="The current filter does not expose contradiction, tension, or override links."
                    />
                  ) : (
                    contradictions.map((relation) => (
                      <button
                        key={relation.id}
                        type="button"
                        onClick={() =>
                          setSelectedProvenance(
                            buildRelationProvenance(relation),
                          )
                        }
                        className="w-full rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 text-left transition hover:bg-amber-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {relation.fromAgency?.shortName ||
                              relation.fromAgency?.name ||
                              "Source"}
                            <span className="mx-2 text-slate-400">→</span>
                            {relation.toAgency?.shortName ||
                              relation.toAgency?.name ||
                              "Target"}
                          </div>
                          <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[11px] font-medium text-amber-700">
                            {relation.relationType}
                          </span>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          {compactText(
                            relation.rationale,
                            relation.analysis?.reason ||
                              "No explicit rationale extracted",
                          )}
                        </div>
                        {relation.analysis ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span
                              className={`rounded-full border px-2 py-1 text-[11px] font-medium ${relationBucketTone(
                                relation.analysis.bucket,
                              )}`}
                            >
                              {humanizeBucket(relation.analysis.bucket)}
                            </span>
                            {relation.analysis.requiresAnalystReview ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                analyst review
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Alignment set
                  </div>
                  {alignments.length === 0 ? (
                    <EmptyPanel
                      title="No alignments in current filter"
                      body="Expand the relation filter to inspect reinforcement, alignment, duplication, or reference links."
                    />
                  ) : (
                    alignments.slice(0, 8).map((relation) => (
                      <button
                        key={relation.id}
                        type="button"
                        onClick={() =>
                          setSelectedProvenance(
                            buildRelationProvenance(relation),
                          )
                        }
                        className="w-full rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-4 text-left transition hover:bg-emerald-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {relation.fromAgency?.shortName ||
                              relation.fromAgency?.name ||
                              "Source"}
                            <span className="mx-2 text-slate-400">→</span>
                            {relation.toAgency?.shortName ||
                              relation.toAgency?.name ||
                              "Target"}
                          </div>
                          <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700">
                            {relation.relationType}
                          </span>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          {compactText(
                            relation.rationale,
                            relation.analysis?.reason ||
                              "No explicit rationale extracted",
                          )}
                        </div>
                        {relation.analysis ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span
                              className={`rounded-full border px-2 py-1 text-[11px] font-medium ${relationBucketTone(
                                relation.analysis.bucket,
                              )}`}
                            >
                              {humanizeBucket(relation.analysis.bucket)}
                            </span>
                            {relation.analysis.requiresAnalystReview ? (
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700">
                                analyst review
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </SmartCard>
        </div>

        <div className="space-y-6">
          <SmartCard
            className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            tabIndex={-1}
          >
            <SectionHeader
              icon={<BookOpen className="h-5 w-5" />}
              title="Selected actor evolution"
              subtitle="Latest stance chronology and provenance for the active actor filter."
            />

            <div className="mt-5 space-y-4">
              {!selectedActor ? (
                <EmptyPanel
                  title="No actor selected"
                  body="Choose an actor card on the left to inspect its extracted position history."
                />
              ) : (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedActor.agency?.name}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedActor.evolution.summary}
                    </div>
                  </div>

                  {(selectedActor.positions || []).map((position) => (
                    <button
                      key={position.id}
                      type="button"
                      onClick={() =>
                        setSelectedProvenance({
                          title: selectedActor.agency?.name ?? "Actor position",
                          subtitle: position.polarity ?? "position",
                          narrative:
                            position.stanceSummary ?? position.stanceText,
                          chips: [
                            position.polarity ?? "unknown",
                            position.effectiveDatePrecision ?? "unknown",
                          ],
                          provenance: position.provenance,
                        })
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">
                            {compactText(
                              position.stanceSummary,
                              position.stanceText,
                            )}
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-600 line-clamp-4">
                            {position.stanceText}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-600">
                          <div>{position.polarity ?? "UNKNOWN"}</div>
                          <div className="mt-1">
                            {formatShortDate(position.effectiveDate)}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </SmartCard>

          <SmartCard
            className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            tabIndex={-1}
          >
            <SectionHeader
              icon={<FileText className="h-5 w-5" />}
              title="Evidence sources"
              subtitle="Documents contributing structured case evidence in the current view."
            />

            <div className="mt-5 space-y-3">
              {sources.length === 0 ? (
                <EmptyPanel
                  title="No source trail available"
                  body="Structured case items have not yet been linked back to source documents."
                />
              ) : (
                sources.map((source) => (
                  <div
                    key={
                      source.sourceDocument?.id ??
                      `${source.documentRevision?.id}-${source.itemCount}`
                    }
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">
                          {source.documentRevision?.storedFile?.fileName ||
                            source.documentRevision?.storedFile?.sourceUrl ||
                            source.sourceDocument?.id ||
                            "Source artifact"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          {source.itemCount} structured items · last seen{" "}
                          {formatDate(source.latestSeenAt)}
                        </div>
                      </div>
                      {source.documentRevision?.storedFile?.id ? (
                        <button
                          type="button"
                          onClick={() =>
                            openArtifactPreview({
                              id:
                                source.documentRevision?.id ||
                                source.sourceDocument?.id ||
                                "",
                              chunkIds: [],
                              pageNumbers: [],
                              charStart: null,
                              charEnd: null,
                              evidenceText: null,
                              evidenceLocator: null,
                              confidence: null,
                              extractionModel: null,
                              extractionVersion: null,
                              structured: null,
                              createdAt: source.latestSeenAt,
                              updatedAt: source.latestSeenAt,
                              sourceDocument: source.sourceDocument,
                              documentRevision: source.documentRevision,
                              sourceRevision: null,
                              pipeline: source.pipeline,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Preview
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
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
              subtitle="Selected item provenance, extraction metadata, and preview access."
            />

            <div className="mt-5 space-y-4">
              {!selectedProvenance ? (
                <EmptyPanel
                  title="Nothing selected"
                  body="Click a timeline entry, relation, or actor position to inspect its provenance."
                />
              ) : (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedProvenance.title}
                    </div>
                    {selectedProvenance.subtitle ? (
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                        {selectedProvenance.subtitle}
                      </div>
                    ) : null}
                    {selectedProvenance.narrative ? (
                      <div className="mt-3 text-sm leading-6 text-slate-600">
                        {selectedProvenance.narrative}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Confidence
                        </div>
                        <div className="mt-1">
                          {selectedProvenance.provenance?.confidence ?? "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Pages
                        </div>
                        <div className="mt-1">
                          {(
                            selectedProvenance.provenance?.pageNumbers || []
                          ).join(", ") || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Extraction model
                        </div>
                        <div className="mt-1">
                          {selectedProvenance.provenance?.extractionModel ||
                            "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Pipeline version
                        </div>
                        <div className="mt-1">
                          {selectedProvenance.provenance?.pipeline?.version ||
                            selectedProvenance.provenance?.extractionVersion ||
                            "—"}
                        </div>
                      </div>
                    </div>

                    {selectedProvenance.provenance?.evidenceText ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                        {selectedProvenance.provenance.evidenceText}
                      </div>
                    ) : null}

                    {selectedProvenance.provenance?.documentRevision?.storedFile
                      ?.id ? (
                      <button
                        type="button"
                        onClick={() =>
                          openArtifactPreview(selectedProvenance.provenance)
                        }
                        className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
                      >
                        Open source preview
                        <ArrowUpRight className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </SmartCard>
        </div>
      </div>
    </div>
  );
}
