import prisma from "../config/database";
import { createNote } from "./notebook.service";
import {
  getAgencyLandscape,
  getDocumentGovernanceOverview,
  getIssueCaseWorkspace,
} from "./governanceRead.service";

export const NOTEBOOK_TEMPLATE_KEYS = [
  "governance_brief",
  "contradiction_brief",
  "agency_comparison_summary",
  "issue_landscape_summary",
  "case_timeline_note",
  "accountability_coordination_gap_note",
] as const;

export type NotebookTemplateKey = (typeof NOTEBOOK_TEMPLATE_KEYS)[number];

type TemplateDefinition = {
  key: NotebookTemplateKey;
  label: string;
  badge: string;
  description: string;
  defaultTitlePrefix: string;
  required: {
    document: boolean;
    issue: boolean;
    agency: boolean;
  };
  sections: string[];
};

const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: "governance_brief",
    label: "Governance Brief",
    badge: "Briefing",
    description:
      "Executive-ready governance note with issue framing, institutional landscape, contradictions, and evidence anchors.",
    defaultTitlePrefix: "Governance Brief",
    required: { document: true, issue: false, agency: false },
    sections: [
      "Scope",
      "Executive readout",
      "Institutional landscape",
      "Contradictions and tensions",
      "Evidence anchors",
      "Analyst follow-ups",
    ],
  },
  {
    key: "contradiction_brief",
    label: "Contradiction Brief",
    badge: "Risk Review",
    description:
      "Conservative contradiction/tension review with counter-evidence and scope-change checks.",
    defaultTitlePrefix: "Contradiction Brief",
    required: { document: false, issue: true, agency: false },
    sections: [
      "Scope",
      "Contradiction set",
      "Alignment / counter-evidence",
      "Actor position shifts",
      "Analyst checks",
    ],
  },
  {
    key: "agency_comparison_summary",
    label: "Agency Comparison Summary",
    badge: "Comparison",
    description:
      "Cross-agency comparison note grounded in mandates, issue links, and current actor positions.",
    defaultTitlePrefix: "Agency Comparison",
    required: { document: true, issue: false, agency: false },
    sections: [
      "Compared institutions",
      "Mandate / role representation",
      "Issue touchpoints",
      "Overlap / ambiguity signals",
      "Evidence anchors",
    ],
  },
  {
    key: "issue_landscape_summary",
    label: "Issue Landscape Summary",
    badge: "Landscape",
    description:
      "Issue-centric view of actors, mandates, gaps, and current evidence coverage.",
    defaultTitlePrefix: "Issue Landscape",
    required: { document: false, issue: true, agency: false },
    sections: [
      "Issue snapshot",
      "Actors involved",
      "Mandates and positions",
      "Governance gaps",
      "Source coverage",
    ],
  },
  {
    key: "case_timeline_note",
    label: "Case Timeline Note",
    badge: "Timeline",
    description:
      "Chronological note for multi-document case tracing with actor-linked entries.",
    defaultTitlePrefix: "Case Timeline",
    required: { document: false, issue: true, agency: false },
    sections: [
      "Scope",
      "Timeline snapshot",
      "Actor evolution",
      "Timeline tensions",
      "Follow-up requests",
    ],
  },
  {
    key: "accountability_coordination_gap_note",
    label: "Accountability / Coordination Gap Note",
    badge: "Gap Review",
    description:
      "Focused note on handoff failures, ambiguity, overlap, and accountability gaps.",
    defaultTitlePrefix: "Coordination Gap Note",
    required: { document: false, issue: true, agency: false },
    sections: [
      "Scope",
      "Gap inventory",
      "Handoff / overlap signals",
      "Impacted institutions",
      "Verification checklist",
    ],
  },
];

function httpError(status: number, message: string) {
  const err: any = new Error(message);
  err.status = status;
  return err;
}

function getTemplateDefinition(templateKey: string): TemplateDefinition {
  const found = TEMPLATE_DEFINITIONS.find((item) => item.key === templateKey);
  if (!found) throw httpError(400, "Unsupported notebook template");
  return found;
}

function limitText(value: unknown, max = 240) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatShortDate(value?: string | null) {
  if (!value) return "Undated";
  try {
    return new Date(value).toLocaleDateString("en-CA");
  } catch {
    return value;
  }
}

function toArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function visibleSourceLabel(provenance: any) {
  return (
    provenance?.documentRevision?.storedFile?.fileName ||
    provenance?.documentRevision?.storedFile?.sourceUrl ||
    provenance?.sourceDocument?.id ||
    "Source"
  );
}

function provenanceToCitation(provenance: any) {
  if (!provenance) return null;

  const pages = toArray<number>(provenance.pageNumbers).filter((value) =>
    Number.isFinite(value),
  );
  const storedFile = provenance?.documentRevision?.storedFile;

  return {
    chunkId:
      String(toArray<string>(provenance.chunkIds)[0] || "").trim() ||
      `trace:${String(provenance.id ?? "unknown")}`,
    quote: limitText(
      provenance?.evidenceText ||
        provenance?.evidenceLocator ||
        visibleSourceLabel(provenance),
      320,
    ),
    pageStart: pages.length ? pages[0] : null,
    pageEnd: pages.length ? pages[pages.length - 1] : null,
    charStart:
      typeof provenance?.charStart === "number" ? provenance.charStart : null,
    charEnd:
      typeof provenance?.charEnd === "number" ? provenance.charEnd : null,
    sourceId: provenance?.sourceDocument?.id ?? null,
    sourceKind:
      storedFile?.sourceUrl ||
      storedFile?.urlId ||
      provenance?.sourceDocument?.urlId
        ? "URL"
        : "FILE",
    sourceLabel: visibleSourceLabel(provenance),
    sourceUrl: storedFile?.sourceUrl ?? null,
    fileName: storedFile?.fileName ?? null,
    sourceRevisionId: provenance?.sourceRevision?.id ?? null,
    documentRevisionId: provenance?.documentRevision?.id ?? null,
    pipelineConfigId: provenance?.pipeline?.id ?? null,
  };
}

function renderEvidenceRef(provenance: any) {
  const citation = provenanceToCitation(provenance);
  if (!citation) return "";

  const pageBit =
    citation.pageStart != null
      ? citation.pageEnd != null && citation.pageEnd !== citation.pageStart
        ? `, p. ${citation.pageStart}-${citation.pageEnd}`
        : `, p. ${citation.pageStart}`
      : "";

  return ` _(Source: ${citation.sourceLabel}${pageBit})_`;
}

function pushEvidence(
  evidence: Array<{ claim: string; citations: any[] }>,
  claim: string,
  provenance: any,
) {
  const citation = provenanceToCitation(provenance);
  if (!citation) return;
  evidence.push({
    claim: limitText(claim, 420),
    citations: [citation],
  });
}

function renderBulletList(items: string[], emptyText: string) {
  if (!items.length) return `- ${emptyText}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function dedupeCitations(citations: any[]) {
  return uniqueBy(citations.filter(Boolean), (citation) =>
    [
      citation.chunkId,
      citation.documentRevisionId,
      citation.pageStart,
      citation.pageEnd,
    ].join("::"),
  );
}

type LoadedTemplateContext = {
  documentOverview: any | null;
  caseWorkspace: any | null;
  agencyLandscape: any | null;
  documentId: string | null;
  issueId: string | null;
  agencyId: string | null;
  relationType: string | null;
};

async function loadTemplateContext(input: {
  documentId?: string;
  issueId?: string;
  agencyId?: string;
  relationType?: string;
}): Promise<LoadedTemplateContext> {
  const [documentOverview, caseWorkspace, agencyLandscape] = await Promise.all([
    input.documentId
      ? getDocumentGovernanceOverview(input.documentId, { limit: 160 })
      : Promise.resolve(null),
    input.issueId
      ? getIssueCaseWorkspace(input.issueId, {
          actorAgencyId: input.agencyId || undefined,
          relationType: input.relationType || undefined,
          limit: 220,
        })
      : Promise.resolve(null),
    input.agencyId
      ? getAgencyLandscape(input.agencyId, { limit: 160 })
      : Promise.resolve(null),
  ]);

  return {
    documentOverview,
    caseWorkspace,
    agencyLandscape,
    documentId: input.documentId ?? null,
    issueId: input.issueId ?? null,
    agencyId: input.agencyId ?? null,
    relationType: input.relationType ?? null,
  };
}

function buildTemplateTitle(
  template: TemplateDefinition,
  context: LoadedTemplateContext,
  titleOverride?: string,
) {
  const manual = String(titleOverride ?? "").trim();
  if (manual) return manual;

  const issueTitle = context.caseWorkspace?.issue?.title;
  const agencyName =
    context.agencyLandscape?.agency?.shortName ||
    context.agencyLandscape?.agency?.name ||
    null;
  const documentLabel =
    context.documentOverview?.document?.kind && context.documentId
      ? `${context.documentOverview.document.kind} ${context.documentId}`
      : context.documentId
        ? `Document ${context.documentId}`
        : null;

  const suffix = issueTitle || agencyName || documentLabel || "Workspace";
  return `${template.defaultTitlePrefix} — ${suffix}`;
}

function buildGovernanceBriefContent(context: LoadedTemplateContext) {
  const evidence: Array<{ claim: string; citations: any[] }> = [];

  const documentOverview = context.documentOverview;
  const caseWorkspace = context.caseWorkspace;
  const agencyLandscape = context.agencyLandscape;

  const executive = [
    documentOverview
      ? `The current document evidence base maps ${documentOverview.summary?.agencyCount ?? 0} agencies, ${documentOverview.summary?.issueCount ?? 0} issues, ${documentOverview.summary?.mandateCount ?? 0} mandates, and ${documentOverview.summary?.relationCount ?? 0} extracted relations.`
      : null,
    caseWorkspace?.issue?.title
      ? `${caseWorkspace.issue.title}: ${limitText(caseWorkspace.issue.summary || "No issue summary extracted.", 220)}`
      : null,
    caseWorkspace
      ? `The current issue view surfaces ${caseWorkspace.summary?.contradictionCount ?? 0} contradiction/tension candidates and ${caseWorkspace.summary?.gapCount ?? 0} governance gaps across ${caseWorkspace.summary?.agencyCount ?? 0} actors.`
      : null,
    agencyLandscape?.agency?.name
      ? `${agencyLandscape.agency.name} is currently linked to ${agencyLandscape.summary?.issueCount ?? 0} issues and ${agencyLandscape.summary?.mandateCount ?? 0} mandates in the extracted graph.`
      : null,
  ].filter((line): line is string => Boolean(line));

  const actorLines = toArray<any>(caseWorkspace?.actors)
    .slice(0, 6)
    .map((actor) => {
      const latest = actor.latestPosition;
      const text = `${actor.agency?.name || "Unknown actor"} — ${limitText(actor.evolution?.summary || "No evolution summary.", 180)}${latest?.stanceSummary || latest?.stanceText ? ` Latest position: ${limitText(latest?.stanceSummary || latest?.stanceText, 180)}.` : ""}`;
      if (latest?.provenance) pushEvidence(evidence, text, latest.provenance);
      return `${text}${renderEvidenceRef(latest?.provenance)}`;
    });

  const contradictionLines = toArray<any>(
    caseWorkspace?.relations?.contradictions,
  )
    .slice(0, 5)
    .map((relation) => {
      const text = `${relation.fromAgency?.name || "Source"} → ${relation.toAgency?.name || "Target"} (${relation.relationType}): ${limitText(relation.rationale || relation.fromClaim?.claimSummary || relation.toClaim?.claimSummary || "No rationale extracted.", 220)}`;
      pushEvidence(evidence, text, relation.provenance);
      return `${text}${renderEvidenceRef(relation.provenance)}`;
    });

  const mandateLines = [
    ...toArray<any>(agencyLandscape?.mandates).slice(0, 3),
    ...toArray<any>(documentOverview?.mandates).slice(0, 3),
  ]
    .slice(0, 6)
    .map((mandate) => {
      const text = `${mandate.agency?.name ? `${mandate.agency.name}: ` : ""}${mandate.title}${mandate.issue?.title ? ` — issue: ${mandate.issue.title}` : ""}`;
      pushEvidence(evidence, text, mandate.provenance);
      return `${text}${renderEvidenceRef(mandate.provenance)}`;
    });

  const gapLines = [
    ...toArray<any>(caseWorkspace?.gaps).slice(0, 3),
    ...toArray<any>(agencyLandscape?.gaps).slice(0, 3),
  ]
    .slice(0, 6)
    .map((gap) => {
      const text = `${gap.gapType}: ${limitText(gap.summary, 200)}${gap.primaryAgency?.name ? ` [${gap.primaryAgency.name}` : ""}${gap.secondaryAgency?.name ? ` ↔ ${gap.secondaryAgency.name}` : gap.primaryAgency?.name ? "]" : ""}`;
      pushEvidence(evidence, text, gap.provenance);
      return `${text}${renderEvidenceRef(gap.provenance)}`;
    });

  const content = [
    "# Governance Brief",
    "",
    "## Scope",
    renderBulletList(
      [
        context.documentId ? `Document: ${context.documentId}` : "",
        caseWorkspace?.issue?.title
          ? `Issue: ${caseWorkspace.issue.title}`
          : "",
        agencyLandscape?.agency?.name
          ? `Agency lens: ${agencyLandscape.agency.name}`
          : "",
        `Generated at: ${new Date().toLocaleString()}`,
      ].filter(Boolean),
      "No scope metadata available.",
    ),
    "",
    "## Executive readout",
    renderBulletList(
      executive,
      "No high-level governance summary available yet.",
    ),
    "",
    "## Institutional landscape",
    renderBulletList(actorLines, "No actor-level positions extracted yet."),
    "",
    "## Contradictions and tensions",
    renderBulletList(
      contradictionLines,
      "No contradiction, tension, or override relations are currently extracted for this scope.",
    ),
    "",
    "## Mandates and coordination signals",
    renderBulletList(
      [...mandateLines, ...gapLines].slice(0, 8),
      "No mandate or coordination-gap evidence is currently extracted for this scope.",
    ),
    "",
    "## Analyst follow-ups",
    renderBulletList(
      [
        "Check whether any contradictions are true conflicts, later overrides, or scope differences.",
        "Verify whether missing institutions are absent from the source or absent from extraction coverage.",
        "Promote the strongest evidence anchors into a final briefing after manual review.",
      ],
      "No follow-ups recorded.",
    ),
    "",
  ].join("\n");

  return { content, evidence };
}

function buildContradictionBriefContent(context: LoadedTemplateContext) {
  const evidence: Array<{ claim: string; citations: any[] }> = [];
  const caseWorkspace = context.caseWorkspace;

  const contradictionLines = toArray<any>(
    caseWorkspace?.relations?.contradictions,
  )
    .slice(0, 8)
    .map((relation) => {
      const text = `${relation.fromAgency?.name || "Source"} → ${relation.toAgency?.name || "Target"} (${relation.relationType}): ${limitText(relation.rationale || relation.fromClaim?.claimSummary || relation.toClaim?.claimSummary || "No rationale extracted.", 220)}`;
      pushEvidence(evidence, text, relation.provenance);
      return `${text}${renderEvidenceRef(relation.provenance)}`;
    });

  const alignmentLines = toArray<any>(caseWorkspace?.relations?.alignments)
    .slice(0, 6)
    .map((relation) => {
      const text = `${relation.fromAgency?.name || "Source"} → ${relation.toAgency?.name || "Target"} (${relation.relationType}): ${limitText(relation.rationale || relation.fromClaim?.claimSummary || relation.toClaim?.claimSummary || "No rationale extracted.", 220)}`;
      pushEvidence(evidence, text, relation.provenance);
      return `${text}${renderEvidenceRef(relation.provenance)}`;
    });

  const evolutionLines = toArray<any>(caseWorkspace?.actors)
    .filter((actor) => actor?.evolution?.changed)
    .slice(0, 6)
    .map((actor) => {
      const latest = actor.latestPosition;
      const text = `${actor.agency?.name || "Unknown actor"}: ${limitText(actor.evolution?.summary || "Position shift detected.", 220)}`;
      if (latest?.provenance) pushEvidence(evidence, text, latest.provenance);
      return `${text}${renderEvidenceRef(latest?.provenance)}`;
    });

  const content = [
    "# Contradiction Brief",
    "",
    "## Scope",
    renderBulletList(
      [
        caseWorkspace?.issue?.title
          ? `Issue: ${caseWorkspace.issue.title}`
          : "",
        context.relationType
          ? `Relation filter: ${context.relationType}`
          : "Relation filter: all contradiction classes",
        context.agencyId ? `Agency lens: ${context.agencyId}` : "",
        `Generated at: ${new Date().toLocaleString()}`,
      ].filter(Boolean),
      "No scope metadata available.",
    ),
    "",
    "## Contradiction set",
    renderBulletList(
      contradictionLines,
      "No contradiction, tension, or override relations are currently extracted for this issue/filter.",
    ),
    "",
    "## Alignment / counter-evidence",
    renderBulletList(
      alignmentLines,
      "No alignment or reinforcement evidence is currently extracted for this issue/filter.",
    ),
    "",
    "## Actor position shifts",
    renderBulletList(
      evolutionLines,
      "No material actor-position shifts are currently flagged in this issue view.",
    ),
    "",
    "## Analyst checks",
    renderBulletList(
      [
        "Distinguish direct contradiction from later institutional revision.",
        "Check whether the apparently conflicting claims operate on different dates, forums, or legal scopes.",
        "Promote only evidence-backed contradictions into external-facing notes.",
      ],
      "No analyst checks recorded.",
    ),
    "",
  ].join("\n");

  return { content, evidence };
}

function buildAgencyComparisonSummaryContent(context: LoadedTemplateContext) {
  const evidence: Array<{ claim: string; citations: any[] }> = [];
  const documentOverview = context.documentOverview;
  const caseWorkspace = context.caseWorkspace;

  const agencyLines = toArray<any>(documentOverview?.agencies)
    .slice(0, 10)
    .map((agency) => {
      const actorCard = toArray<any>(caseWorkspace?.actors).find(
        (actor) => actor.agency?.id === agency.id,
      );
      const latest = actorCard?.latestPosition;
      const text = `${agency.name}${agency.category ? ` (${agency.category})` : ""}${agency.jurisdiction ? ` — ${agency.jurisdiction}` : ""}${actorCard ? `. Positions: ${actorCard.stats?.positionCount ?? 0}, timeline entries: ${actorCard.stats?.timelineEntryCount ?? 0}.` : ""}`;
      if (latest?.provenance) pushEvidence(evidence, text, latest.provenance);
      return `${text}${renderEvidenceRef(latest?.provenance)}`;
    });

  const comparisonLines = toArray<any>(caseWorkspace?.relations?.contradictions)
    .slice(0, 5)
    .map((relation) => {
      const text = `${relation.fromAgency?.name || "Source"} ↔ ${relation.toAgency?.name || "Target"}: ${limitText(relation.rationale || "No rationale extracted.", 220)}`;
      pushEvidence(evidence, text, relation.provenance);
      return `${text}${renderEvidenceRef(relation.provenance)}`;
    });

  const mandateLines = toArray<any>(documentOverview?.mandates)
    .slice(0, 6)
    .map((mandate) => {
      const text = `${mandate.agency?.name ? `${mandate.agency.name}: ` : ""}${mandate.title}${mandate.issue?.title ? ` — ${mandate.issue.title}` : ""}`;
      pushEvidence(evidence, text, mandate.provenance);
      return `${text}${renderEvidenceRef(mandate.provenance)}`;
    });

  const content = [
    "# Agency Comparison Summary",
    "",
    "## Compared institutions",
    renderBulletList(
      agencyLines,
      "No agencies are currently extracted in the selected document scope.",
    ),
    "",
    "## Mandate / role representation",
    renderBulletList(
      mandateLines,
      "No mandate evidence is currently available for cross-agency comparison.",
    ),
    "",
    "## Overlap / ambiguity signals",
    renderBulletList(
      comparisonLines,
      "No contradiction/tension signals are currently extracted between agencies in this scope.",
    ),
    "",
    "## Analyst follow-ups",
    renderBulletList(
      [
        "Check whether mandates differ by forum, geography, or time horizon before calling them overlaps.",
        "Flag agencies that appear in issue links but not in current position evidence.",
        "Use the strongest agency-level extracts to seed a final comparison note.",
      ],
      "No analyst follow-ups recorded.",
    ),
    "",
  ].join("\n");

  return { content, evidence };
}

function buildIssueLandscapeSummaryContent(context: LoadedTemplateContext) {
  const evidence: Array<{ claim: string; citations: any[] }> = [];
  const caseWorkspace = context.caseWorkspace;

  const actorLines = toArray<any>(caseWorkspace?.actors)
    .slice(0, 8)
    .map((actor) => {
      const latest = actor.latestPosition;
      const text = `${actor.agency?.name || "Unknown actor"} — positions: ${actor.stats?.positionCount ?? 0}, events: ${actor.stats?.eventCount ?? 0}, gaps: ${actor.stats?.gapCount ?? 0}. ${limitText(actor.evolution?.summary || "", 180)}`;
      if (latest?.provenance) pushEvidence(evidence, text, latest.provenance);
      return `${text}${renderEvidenceRef(latest?.provenance)}`;
    });

  const mandateLines = toArray<any>(caseWorkspace?.mandates)
    .slice(0, 6)
    .map((mandate) => {
      const text = `${mandate.agency?.name ? `${mandate.agency.name}: ` : ""}${mandate.title}${mandate.issue?.title ? ` — ${mandate.issue.title}` : ""}`;
      pushEvidence(evidence, text, mandate.provenance);
      return `${text}${renderEvidenceRef(mandate.provenance)}`;
    });

  const gapLines = toArray<any>(caseWorkspace?.gaps)
    .slice(0, 6)
    .map((gap) => {
      const text = `${gap.gapType}: ${limitText(gap.summary, 220)}`;
      pushEvidence(evidence, text, gap.provenance);
      return `${text}${renderEvidenceRef(gap.provenance)}`;
    });

  const sourceLines = toArray<any>(caseWorkspace?.sources)
    .slice(0, 8)
    .map((source) => {
      const label =
        source.documentRevision?.storedFile?.fileName ||
        source.documentRevision?.storedFile?.sourceUrl ||
        source.sourceDocument?.id ||
        "Source artifact";
      return `${label} — ${source.itemCount ?? 0} structured items`;
    });

  const content = [
    "# Issue Landscape Summary",
    "",
    "## Issue snapshot",
    renderBulletList(
      [
        caseWorkspace?.issue?.title
          ? `Issue: ${caseWorkspace.issue.title}`
          : "",
        caseWorkspace?.issue?.kind ? `Kind: ${caseWorkspace.issue.kind}` : "",
        caseWorkspace?.summary
          ? `Actors: ${caseWorkspace.summary.agencyCount}, timeline entries: ${caseWorkspace.summary.timelineEntryCount}, contradictions: ${caseWorkspace.summary.contradictionCount}, gaps: ${caseWorkspace.summary.gapCount}`
          : "",
      ].filter(Boolean),
      "No issue snapshot available.",
    ),
    "",
    "## Actors involved",
    renderBulletList(
      actorLines,
      "No actor-level evidence is currently available.",
    ),
    "",
    "## Mandates and positions",
    renderBulletList(
      mandateLines,
      "No mandate evidence is currently extracted for this issue.",
    ),
    "",
    "## Governance gaps",
    renderBulletList(
      gapLines,
      "No governance-gap evidence is currently extracted for this issue.",
    ),
    "",
    "## Source coverage",
    renderBulletList(
      sourceLines,
      "No source-coverage rollup is currently available.",
    ),
    "",
  ].join("\n");

  return { content, evidence };
}

function buildCaseTimelineNoteContent(context: LoadedTemplateContext) {
  const evidence: Array<{ claim: string; citations: any[] }> = [];
  const caseWorkspace = context.caseWorkspace;

  const timelineLines = toArray<any>(caseWorkspace?.timeline?.entries)
    .slice(0, 14)
    .map((entry) => {
      const text = `${formatShortDate(entry.sortDate)} — ${entry.actorAgency?.name || "Unattributed"}: ${entry.label}. ${limitText(entry.summary || entry.position?.stanceSummary || entry.position?.stanceText || entry.event?.summary || "", 200)}`;
      pushEvidence(evidence, text, entry.provenance);
      return `${text}${renderEvidenceRef(entry.provenance)}`;
    });

  const actorShiftLines = toArray<any>(caseWorkspace?.actors)
    .filter((actor) => actor?.evolution?.changed)
    .slice(0, 6)
    .map((actor) => {
      const latest = actor.latestPosition;
      const text = `${actor.agency?.name || "Unknown actor"}: ${limitText(actor.evolution?.summary || "No evolution summary.", 220)}`;
      if (latest?.provenance) pushEvidence(evidence, text, latest.provenance);
      return `${text}${renderEvidenceRef(latest?.provenance)}`;
    });

  const content = [
    "# Case Timeline Note",
    "",
    "## Scope",
    renderBulletList(
      [
        caseWorkspace?.issue?.title
          ? `Issue: ${caseWorkspace.issue.title}`
          : "",
        context.agencyId ? `Actor lens: ${context.agencyId}` : "",
        `Generated at: ${new Date().toLocaleString()}`,
      ].filter(Boolean),
      "No scope metadata available.",
    ),
    "",
    "## Timeline snapshot",
    renderBulletList(
      timelineLines,
      "No normalized timeline entries are currently extracted for this issue/filter.",
    ),
    "",
    "## Actor evolution",
    renderBulletList(
      actorShiftLines,
      "No actor-position changes are currently flagged in this issue view.",
    ),
    "",
    "## Follow-up requests",
    renderBulletList(
      [
        "Check whether any apparent breaks in the timeline are due to missing source capture.",
        "Review approximate dates separately from exact procedural dates.",
        "Promote the top verified entries into a finalized chronology once cross-checked.",
      ],
      "No follow-up requests recorded.",
    ),
    "",
  ].join("\n");

  return { content, evidence };
}

function buildAccountabilityGapNoteContent(context: LoadedTemplateContext) {
  const evidence: Array<{ claim: string; citations: any[] }> = [];
  const caseWorkspace = context.caseWorkspace;
  const agencyLandscape = context.agencyLandscape;

  const gapLines = [
    ...toArray<any>(caseWorkspace?.gaps).slice(0, 6),
    ...toArray<any>(agencyLandscape?.gaps).slice(0, 4),
  ]
    .slice(0, 8)
    .map((gap) => {
      const text = `${gap.gapType}: ${limitText(gap.summary, 220)}${gap.primaryAgency?.name ? ` [${gap.primaryAgency.name}` : ""}${gap.secondaryAgency?.name ? ` ↔ ${gap.secondaryAgency.name}` : gap.primaryAgency?.name ? "]" : ""}`;
      pushEvidence(evidence, text, gap.provenance);
      return `${text}${renderEvidenceRef(gap.provenance)}`;
    });

  const relationLines = toArray<any>(caseWorkspace?.relations?.contradictions)
    .slice(0, 6)
    .map((relation) => {
      const text = `${relation.fromAgency?.name || "Source"} ↔ ${relation.toAgency?.name || "Target"} (${relation.relationType}): ${limitText(relation.rationale || "No rationale extracted.", 220)}`;
      pushEvidence(evidence, text, relation.provenance);
      return `${text}${renderEvidenceRef(relation.provenance)}`;
    });

  const content = [
    "# Accountability / Coordination Gap Note",
    "",
    "## Scope",
    renderBulletList(
      [
        caseWorkspace?.issue?.title
          ? `Issue: ${caseWorkspace.issue.title}`
          : "",
        agencyLandscape?.agency?.name
          ? `Agency lens: ${agencyLandscape.agency.name}`
          : "",
        `Generated at: ${new Date().toLocaleString()}`,
      ].filter(Boolean),
      "No scope metadata available.",
    ),
    "",
    "## Gap inventory",
    renderBulletList(
      gapLines,
      "No coordination or accountability gaps are currently extracted for this issue/filter.",
    ),
    "",
    "## Handoff / overlap signals",
    renderBulletList(
      relationLines,
      "No contradiction/tension evidence is currently available to support a gap review.",
    ),
    "",
    "## Verification checklist",
    renderBulletList(
      [
        "Confirm whether the gap reflects a true responsibility vacuum or just missing evidence in the current source set.",
        "Check whether any apparent overlap is resolved by legal hierarchy, timing, or forum.",
        "Escalate only evidence-backed coordination failures into final briefing notes.",
      ],
      "No verification checklist recorded.",
    ),
    "",
  ].join("\n");

  return { content, evidence };
}

function buildTemplateContent(
  templateKey: NotebookTemplateKey,
  context: LoadedTemplateContext,
) {
  switch (templateKey) {
    case "governance_brief":
      return buildGovernanceBriefContent(context);
    case "contradiction_brief":
      return buildContradictionBriefContent(context);
    case "agency_comparison_summary":
      return buildAgencyComparisonSummaryContent(context);
    case "issue_landscape_summary":
      return buildIssueLandscapeSummaryContent(context);
    case "case_timeline_note":
      return buildCaseTimelineNoteContent(context);
    case "accountability_coordination_gap_note":
      return buildAccountabilityGapNoteContent(context);
    default:
      throw httpError(400, "Unsupported notebook template");
  }
}

function buildProvenanceBundle(args: {
  template: TemplateDefinition;
  context: LoadedTemplateContext;
  content: string;
  evidence: Array<{ claim: string; citations: any[] }>;
}) {
  const allCitations = dedupeCitations(
    args.evidence.flatMap((item) => item.citations || []),
  );

  return {
    version: "note-provenance-v1",
    artifacts: [
      {
        kind: "template-note",
        templateKey: args.template.key,
        templateLabel: args.template.label,
        promptVersion: "template-note-v1",
        createdAt: new Date().toISOString(),
        answer: args.content,
        citations: allCitations,
        evidence: args.evidence,
        sourceContext: {
          documentId: args.context.documentId,
          issueId: args.context.issueId,
          agencyId: args.context.agencyId,
          relationType: args.context.relationType,
          issueTitle: args.context.caseWorkspace?.issue?.title ?? null,
          agencyName: args.context.agencyLandscape?.agency?.name ?? null,
          documentKind: args.context.documentOverview?.document?.kind ?? null,
        },
      },
    ],
  };
}

export async function listNotebookTemplates() {
  return TEMPLATE_DEFINITIONS.map((item) => ({ ...item }));
}

export async function createNotebookTemplateNote(input: {
  notebookId: string;
  templateKey: NotebookTemplateKey;
  documentId?: string;
  issueId?: string;
  agencyId?: string;
  relationType?: string;
  titleOverride?: string;
}) {
  const notebook = await prisma.notebook.findUnique({
    where: { id: input.notebookId },
    select: { id: true, title: true },
  });

  if (!notebook) throw httpError(404, "Notebook not found");

  const template = getTemplateDefinition(input.templateKey);

  if (template.required.document && !input.documentId) {
    throw httpError(400, `${template.label} requires a document context.`);
  }

  if (template.required.issue && !input.issueId) {
    throw httpError(400, `${template.label} requires an issue context.`);
  }

  if (!input.documentId && !input.issueId && !input.agencyId) {
    throw httpError(
      400,
      "At least one governance context (document, issue, or agency) is required.",
    );
  }

  const context = await loadTemplateContext({
    documentId: input.documentId,
    issueId: input.issueId,
    agencyId: input.agencyId,
    relationType: input.relationType,
  });

  const built = buildTemplateContent(template.key, context);
  const title = buildTemplateTitle(template, context, input.titleOverride);
  const citations = buildProvenanceBundle({
    template,
    context,
    content: built.content,
    evidence: built.evidence,
  });

  const note = await createNote(input.notebookId, {
    title,
    content: built.content,
    citations,
  });

  return {
    note,
    template,
    context: {
      documentId: context.documentId,
      issueId: context.issueId,
      agencyId: context.agencyId,
      relationType: context.relationType,
      issueTitle: context.caseWorkspace?.issue?.title ?? null,
      agencyName: context.agencyLandscape?.agency?.name ?? null,
      documentKind: context.documentOverview?.document?.kind ?? null,
    },
  };
}
