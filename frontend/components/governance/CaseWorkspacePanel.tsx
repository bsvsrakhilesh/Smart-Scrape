import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Building2,
  CalendarClock,
  FileText,
  Filter,
  GitBranch,
  Loader2,
  Scale,
  ShieldAlert,
} from "lucide-react";

import SmartCard from "../ui/SmartCard";
import {
  apiUrl,
  getGovernanceIssueCaseWorkspace,
  type GovernanceCaseActorCard,
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

type CaseWorkspacePanelProps = {
  issueId: string;
  issueTitle?: string | null;
  actorAgencyId: string | null;
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

export default function CaseWorkspacePanel({
  issueId,
  issueTitle,
  actorAgencyId,
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

  const anyError = caseQuery.error as Error | null;

  return (
    <div className="space-y-6">
      <SmartCard
        className="border-white/70 bg-white/85 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
        tabIndex={-1}
      >
        <SectionHeader
          icon={<Scale className="h-5 w-5" />}
          title="Case Review"
          subtitle={
            workspace?.issue?.title ??
            issueTitle ??
            "Merged case tracing, actor evolution, and contradiction review"
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
              title="Merged timeline"
              subtitle="Chronological entries merged from events and actor positions."
            />

            <div className="mt-5 space-y-3">
              {caseQuery.isLoading ? (
                <div className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-sm text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Building timeline…
                </div>
              ) : timelineEntries.length === 0 ? (
                <EmptyPanel
                  title="No timeline entries match the current filter"
                  body="Clear the actor/date filters or enrich this issue with more structured events and positions."
                />
              ) : (
                timelineEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() =>
                      setSelectedProvenance(buildTimelineProvenance(entry))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {entry.itemType} · {entry.sortPrecision ?? "unknown"}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {entry.label}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          {compactText(entry.summary, "No summary extracted")}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-600">
                        <div>{formatShortDate(entry.sortDate)}</div>
                        <div className="mt-1 truncate max-w-[120px]">
                          {entry.actorAgency?.shortName ||
                            entry.actorAgency?.name ||
                            "Unattributed"}
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
