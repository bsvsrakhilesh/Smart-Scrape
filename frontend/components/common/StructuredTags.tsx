import { useMemo, useState } from "react";
import { Sparkles, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/utils";

type LabelItem = {
  value?: string | null;
  score?: number | null;
  evidence?: string | null;
  locator?: Record<string, any> | null;
};

type AiTagDetail = {
  value?: string | null;
  display?: string | null;
  type?: string | null;
  source?: string | null;
  confidence?: number | null;
  evidence?: string | null;
  rank?: number | null;
};

type SmartTagEvidence = {
  quote?: string | null;
  page?: number | null;
  section?: string | null;
  locator?: Record<string, any> | null;
};

type SmartTag = {
  value?: string | null;
  category?: string | null;
  type?: string | null;
  source?: string | null;
  confidence?: number | null;
  confidenceBand?: string | null;
  matchedTaxonomy?: string | null;
  status?: string | null;
  evidence?: SmartTagEvidence[] | string | null;
};

type SmartTags = {
  profile?: string;
  version?: number;
  taxonomyTags?: SmartTag[];
  aiDiscoveredTags?: SmartTag[];
  topics?: SmartTag[];
  entities?: {
    agencies?: SmartTag[];
    organizations?: SmartTag[];
    locations?: SmartTag[];
    people?: SmartTag[];
    legalReferences?: SmartTag[];
    schemesPrograms?: SmartTag[];
    datesDeadlines?: SmartTag[];
  };
  documentType?: SmartTag[];
  actionsDecisions?: SmartTag[];
  userTags?: SmartTag[];
  taxonomySuggestions?: SmartTag[];
  items?: SmartTag[];
};

type Structured = {
  profile?: string;
  version?: number;
  docType?: LabelItem | null;
  labels?: {
    sectors?: LabelItem[];
    agencies?: LabelItem[];
    geography?: LabelItem[];
    programs?: LabelItem[];
    pollutants?: LabelItem[];
  };
  grap?: {
    mentioned?: boolean;
    stage?: string | null;
    evidence?: string | null;
  };
  entities?: {
    directionNumbers?: string[];
    orderNumbers?: string[];
    referenceNumbers?: string[];
    dates?: string[];
  };
};

type IntelligenceItem = {
  id?: string | null;
  label?: string | null;
  type?: string | null;
  category?: string | null;
  normalizedValue?: string | null;
  confidence?: number | null;
  source?: string | null;
  evidence?: SmartTagEvidence[] | string | null;
  locator?: Record<string, any> | null;
  status?: string | null;
};

type StructuredIntelligence = {
  profile?: string;
  version?: number;
  domain?: string;
  topics?: IntelligenceItem[];
  agencies?: IntelligenceItem[];
  programs?: IntelligenceItem[];
  programStages?: IntelligenceItem[];
  legalReferences?: IntelligenceItem[];
  actionsDecisions?: IntelligenceItem[];
  requirements?: IntelligenceItem[];
  restrictions?: IntelligenceItem[];
  locations?: IntelligenceItem[];
  sectors?: IntelligenceItem[];
  pollutantsMeasurements?: IntelligenceItem[];
  datesDeadlines?: IntelligenceItem[];
  claims?: IntelligenceItem[];
  items?: IntelligenceItem[];
};

type IntelligenceSectionKey =
  | "topics"
  | "agencies"
  | "programs"
  | "programStages"
  | "legalReferences"
  | "actionsDecisions"
  | "requirements"
  | "restrictions"
  | "locations"
  | "sectors"
  | "pollutantsMeasurements"
  | "datesDeadlines"
  | "claims";

type Props = {
  structured: Structured | null | undefined;
  tagDetails?: AiTagDetail[] | null;
  smartTags?: SmartTags | null;
  structuredIntelligence?: StructuredIntelligence | null;
  compact?: boolean;
  className?: string;
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function prettyLabel(v?: string | null) {
  if (!v) return "-";
  const map: Record<string, string> = {
    construction_demolition: "C&D",
    waste_burning: "Waste burning",
    biomass_burning: "Biomass burning",
    industry_power: "Industry & power",
    dg_sets: "DG sets",
    office_memorandum: "Office memorandum",
    sop_guideline: "SOP / Guideline",
    pm25: "PM2.5",
    pm10: "PM10",
    no2: "NO2",
    o3: "O3",
    co: "CO",
    grap: "GRAP",
  };
  return map[v] ?? v.replaceAll("_", " ");
}

function scoreBadge(score?: number | null) {
  const s = typeof score === "number" ? score : 0;
  if (s >= 0.85) return "High";
  if (s >= 0.6) return "Med";
  if (s >= 0.45) return "Low";
  return "-";
}

function scoreClasses(score?: number | null) {
  const s = typeof score === "number" ? score : 0;
  if (s >= 0.85)
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (s >= 0.6) return "border-amber-200 bg-amber-50 text-amber-900";
  if (s >= 0.45) return "border-slate-200 bg-slate-50 text-slate-800";
  return "border-[hsl(var(--border))] bg-white text-slate-700";
}

function confidencePct(value?: number | null) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "-";
}

function smartEvidenceCount(items: SmartTag[]) {
  return items.reduce((sum, item) => sum + cleanSmartEvidence(item.evidence).length, 0);
}

function cleanTagDetails(input?: AiTagDetail[] | null) {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: AiTagDetail[] = [];

  for (const raw of input) {
    const value = String(raw?.value ?? "").trim();
    if (!value) continue;

    const type = String(raw?.type ?? "keyword").trim() || "keyword";
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...raw,
      value,
      display: String(raw?.display ?? prettyLabel(value)).trim(),
      type,
      source: String(raw?.source ?? "tagger").trim() || "tagger",
      confidence:
        typeof raw?.confidence === "number"
          ? Math.max(0, Math.min(1, raw.confidence))
          : null,
      evidence: raw?.evidence ? String(raw.evidence).trim() : null,
    });
  }

  return out.slice(0, 30);
}

function cleanSmartEvidence(input: SmartTag["evidence"]): SmartTagEvidence[] {
  const arr = Array.isArray(input) ? input : input ? [{ quote: String(input) }] : [];
  return arr
    .map((raw) => {
      if (!raw || typeof raw !== "object") {
        const quote = String(raw ?? "").trim();
        return quote ? { quote, page: null, section: null } : null;
      }

      const quote = String(raw.quote ?? "").trim();
      if (!quote) return null;
      const page =
        typeof raw.page === "number" && Number.isFinite(raw.page)
          ? raw.page
          : null;
      const section = raw.section ? String(raw.section).trim() : null;
      const locator =
        raw.locator && typeof raw.locator === "object" ? raw.locator : null;
      return { quote, page, section, locator };
    })
    .filter(Boolean) as SmartTagEvidence[];
}

function cleanSmartTagArray(input?: SmartTag[] | null, fallbackCategory = "") {
  if (!Array.isArray(input)) return [];
  const out: SmartTag[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    const value = String(raw?.value ?? "").trim();
    if (!value) continue;

    const category = String(raw?.category ?? fallbackCategory).trim();
    const type = String(raw?.type ?? "keyword").trim() || "keyword";
    const key = `${category}:${type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...raw,
      value,
      category,
      type,
      source: String(raw?.source ?? "tagger").trim() || "tagger",
      status: String(raw?.status ?? "suggested").trim() || "suggested",
      confidence:
        typeof raw?.confidence === "number"
          ? Math.max(0, Math.min(1, raw.confidence))
          : null,
      confidenceBand: raw?.confidenceBand
        ? String(raw.confidenceBand).trim()
        : null,
      matchedTaxonomy: raw?.matchedTaxonomy
        ? String(raw.matchedTaxonomy).trim()
        : null,
      evidence: cleanSmartEvidence(raw?.evidence),
    });
  }

  return out.slice(0, 80);
}

function cleanSmartTags(input?: SmartTags | null): SmartTags | null {
  if (!input || typeof input !== "object") return null;
  const entities = input.entities ?? {};

  const out: SmartTags = {
    profile: input.profile ?? "smart_tags",
    version: input.version ?? 1,
    taxonomyTags: cleanSmartTagArray(input.taxonomyTags, "Taxonomy Tags"),
    aiDiscoveredTags: cleanSmartTagArray(input.aiDiscoveredTags, "AI-Discovered Tags"),
    topics: cleanSmartTagArray(input.topics, "Topics"),
    entities: {
      agencies: cleanSmartTagArray(entities.agencies, "Entities"),
      organizations: cleanSmartTagArray(entities.organizations, "Entities"),
      locations: cleanSmartTagArray(entities.locations, "Entities"),
      people: cleanSmartTagArray(entities.people, "Entities"),
      legalReferences: cleanSmartTagArray(entities.legalReferences, "Entities"),
      schemesPrograms: cleanSmartTagArray(entities.schemesPrograms, "Entities"),
      datesDeadlines: cleanSmartTagArray(entities.datesDeadlines, "Entities"),
    },
    documentType: cleanSmartTagArray(input.documentType, "Document Type"),
    actionsDecisions: cleanSmartTagArray(input.actionsDecisions, "Actions / Decisions"),
    userTags: cleanSmartTagArray(input.userTags, "User Tags"),
    taxonomySuggestions: cleanSmartTagArray(
      input.taxonomySuggestions,
      "AI-Discovered Tags",
    ),
  };

  out.items = [
    ...(out.taxonomyTags ?? []),
    ...(out.aiDiscoveredTags ?? []),
    ...(out.topics ?? []),
    ...(out.entities?.agencies ?? []),
    ...(out.entities?.organizations ?? []),
    ...(out.entities?.locations ?? []),
    ...(out.entities?.people ?? []),
    ...(out.entities?.legalReferences ?? []),
    ...(out.entities?.schemesPrograms ?? []),
    ...(out.entities?.datesDeadlines ?? []),
    ...(out.documentType ?? []),
    ...(out.actionsDecisions ?? []),
    ...(out.userTags ?? []),
  ];

  return out.items.length ? out : null;
}

const INTELLIGENCE_SECTIONS: {
  key: IntelligenceSectionKey;
  title: string;
}[] = [
  { key: "topics", title: "Topics" },
  { key: "agencies", title: "Agencies" },
  { key: "programs", title: "Programs" },
  { key: "programStages", title: "Programs / Stages" },
  { key: "legalReferences", title: "Legal References" },
  { key: "actionsDecisions", title: "Actions / Decisions" },
  { key: "requirements", title: "Requirements" },
  { key: "restrictions", title: "Restrictions" },
  { key: "locations", title: "Locations" },
  { key: "sectors", title: "Sectors" },
  { key: "pollutantsMeasurements", title: "Pollutants / Measurements" },
  { key: "datesDeadlines", title: "Dates / Deadlines" },
  { key: "claims", title: "Claims" },
];

function cleanIntelligenceArray(input?: IntelligenceItem[] | null) {
  if (!Array.isArray(input)) return [];
  const out: IntelligenceItem[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    const label = String(raw?.label ?? "").trim();
    if (!label) continue;
    const category = String(raw?.category ?? "").trim();
    const type = String(raw?.type ?? "intelligence_item").trim();
    const evidence = cleanSmartEvidence(raw?.evidence);
    if (!category || !type || evidence.length === 0) continue;

    const normalizedValue = String(
      raw?.normalizedValue ?? label.toLowerCase(),
    ).trim();
    const key = `${category}:${type}:${normalizedValue.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      ...raw,
      label,
      category,
      type,
      normalizedValue,
      source: String(raw?.source ?? "structured_intelligence").trim(),
      status: String(raw?.status ?? "matched").trim(),
      confidence:
        typeof raw?.confidence === "number"
          ? Math.max(0, Math.min(1, raw.confidence))
          : null,
      evidence,
      locator:
        raw?.locator && typeof raw.locator === "object" ? raw.locator : null,
    });
  }

  return out.slice(0, 80);
}

function cleanStructuredIntelligence(
  input?: StructuredIntelligence | null,
): StructuredIntelligence | null {
  if (!input || typeof input !== "object") return null;
  const out: StructuredIntelligence = {
    profile: input.profile ?? "structured_intelligence",
    version: input.version ?? 1,
    domain: input.domain ?? "air_quality_governance",
  };

  for (const section of INTELLIGENCE_SECTIONS) {
    out[section.key] = cleanIntelligenceArray(
      input[section.key] as IntelligenceItem[] | undefined,
    );
  }

  const flattened = INTELLIGENCE_SECTIONS.flatMap(
    (section) => (out[section.key] as IntelligenceItem[] | undefined) ?? [],
  );
  const fromItems = cleanIntelligenceArray(input.items);
  out.items = (fromItems.length ? fromItems : flattened).slice(0, 240);

  return out.items.length ? out : null;
}

function intelligenceToSmartTag(item: IntelligenceItem): SmartTag {
  return {
    value: item.label,
    category: item.category,
    type: item.type,
    source: item.source,
    confidence: item.confidence,
    confidenceBand:
      typeof item.confidence === "number"
        ? item.confidence >= 0.85
          ? "high"
          : item.confidence >= 0.6
            ? "medium"
            : "low"
        : null,
    matchedTaxonomy: item.normalizedValue,
    status: item.status,
    evidence: item.evidence,
  };
}

function TagDetailRow({
  tag,
  showEvidence,
}: {
  tag: AiTagDetail;
  showEvidence: boolean;
}) {
  const label = tag.display || prettyLabel(tag.value);
  const evidence = (tag.evidence || "").trim();
  const type = (tag.type || "keyword").replaceAll("_", " ");
  const source = (tag.source || "tagger").replaceAll("_", " ");

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-slate-900">
            {label}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 capitalize text-slate-700">
              {type}
            </span>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 capitalize text-slate-700">
              {source}
            </span>
            {tag.rank ? <span>Rank {tag.rank}</span> : null}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold",
            scoreClasses(tag.confidence),
          )}
          title={`Confidence ${confidencePct(tag.confidence)}`}
        >
          {confidencePct(tag.confidence)}
        </span>
      </div>

      {showEvidence && evidence ? (
        <div className="mt-2 line-clamp-3 text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
          {evidence}
        </div>
      ) : null}
    </div>
  );
}

function SmartTagRow({
  tag,
  showEvidence,
}: {
  tag: SmartTag;
  showEvidence: boolean;
}) {
  const evidence = cleanSmartEvidence(tag.evidence);
  const first = evidence[0];
  const type = (tag.type || "tag").replaceAll("_", " ");
  const source = (tag.source || "tagger").replaceAll("_", " ");
  const highConfidence =
    tag.confidenceBand === "high" ||
    (typeof tag.confidence === "number" && tag.confidence >= 0.85);

  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-words text-[12px] font-semibold leading-snug text-slate-950">
            {tag.value}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 capitalize text-slate-700 ring-1 ring-slate-200/70">
              {type}
            </span>
            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 capitalize text-slate-600 ring-1 ring-slate-200/70">
              {source}
            </span>
            {evidence.length ? <span>{evidence.length} evidence</span> : null}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
            highConfidence
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : scoreClasses(tag.confidence),
          )}
          title={`Confidence ${confidencePct(tag.confidence)}`}
        >
          {tag.confidenceBand ?? scoreBadge(tag.confidence)}
        </span>
      </div>

      {showEvidence && first?.quote ? (
        <div className="mt-2 rounded-lg border border-slate-200/70 bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-600">
          {first.page ? (
            <span className="mr-1 font-semibold text-slate-800">
              Page {first.page}
            </span>
          ) : null}
          <span className="line-clamp-4">{first.quote}</span>
        </div>
      ) : null}
    </div>
  );
}

function SmartTagSection({
  title,
  items,
  showEvidence,
}: {
  title: string;
  items: SmartTag[];
  showEvidence: boolean;
}) {
  if (!items.length) return null;
  const evidenceCount = smartEvidenceCount(items);

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] font-semibold text-slate-950">{title}</div>
          {evidenceCount ? (
            <div className="mt-0.5 text-[10px] text-slate-500">
              {evidenceCount} evidence anchor{evidenceCount === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
        <div className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {items.length}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2">
        {items.slice(0, 12).map((tag, idx) => (
          <SmartTagRow
            key={`${title}-${tag.value ?? idx}-${idx}`}
            tag={tag}
            showEvidence={showEvidence}
          />
        ))}
      </div>
    </div>
  );
}

function Pill({
  item,
  showEvidence,
}: {
  item: LabelItem;
  showEvidence: boolean;
}) {
  const label = prettyLabel(item.value);
  const evidence = (item.evidence || "").trim();
  const score = item.score ?? null;

  return (
    <span className="relative inline-flex">
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-medium",
          "shadow-[0_1px_0_rgba(0,0,0,0.02)]",
          scoreClasses(score),
        )}
        title={evidence ? evidence : label}
      >
        <span className="max-w-[220px] truncate">{label}</span>
        <span className="rounded-full border border-black/5 bg-white/70 px-1.5 py-0.5 text-[10px] leading-none text-slate-700">
          {scoreBadge(score)}
        </span>
      </span>

      {showEvidence && evidence ? (
        <span className="mt-1 block w-full text-[11px] leading-snug text-[hsl(var(--muted-foreground))]">
          <span className="block max-w-[620px] break-words">{evidence}</span>
        </span>
      ) : null}
    </span>
  );
}

function Section({
  title,
  items,
  showEvidence,
}: {
  title: string;
  items: LabelItem[];
  showEvidence: boolean;
}) {
  if (!items.length) return null;

  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-slate-900">{title}</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {items.length}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((it, idx) => (
          <div key={`${it.value ?? "x"}-${idx}`} className="flex flex-col">
            <Pill item={it} showEvidence={showEvidence} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StructuredTags({
  structured,
  tagDetails,
  smartTags,
  structuredIntelligence,
  compact = false,
  className,
}: Props) {
  const [expanded, setExpanded] = useState(!compact);
  const [showEvidence, setShowEvidence] = useState(false);
  const [copied, setCopied] = useState(false);

  const docType = structured?.docType ?? null;

  const labels = structured?.labels ?? {};
  const sectors = labels.sectors ?? [];
  const agencies = labels.agencies ?? [];
  const geography = labels.geography ?? [];
  const programs = labels.programs ?? [];
  const pollutants = labels.pollutants ?? [];

  const grap = structured?.grap ?? null;

  const entities = structured?.entities ?? {};
  const safeTagDetails = useMemo(() => cleanTagDetails(tagDetails), [tagDetails]);
  const safeSmartTags = useMemo(() => cleanSmartTags(smartTags), [smartTags]);
  const safeStructuredIntelligence = useMemo(
    () => cleanStructuredIntelligence(structuredIntelligence),
    [structuredIntelligence],
  );
  const intelligenceItems = safeStructuredIntelligence?.items ?? [];
  const smartCount = safeSmartTags?.items?.length ?? 0;
  const intelligenceCount = intelligenceItems.length;
  const entityLines = useMemo(() => {
    const out: { k: string; v: string }[] = [];
    const push = (k: string, arr?: string[]) => {
      const a = Array.isArray(arr) ? arr.filter(Boolean) : [];
      if (!a.length) return;
      out.push({
        k,
        v: a.slice(0, 6).join(", ") + (a.length > 6 ? " ..." : ""),
      });
    };
    push("Direction no.", entities.directionNumbers);
    push("Order no.", entities.orderNumbers);
    push("Ref no.", entities.referenceNumbers);
    push("Dates", entities.dates);
    return out;
  }, [entities]);

  const hasStructuredSignals =
    !!structured &&
    (docType?.value ||
      sectors.length ||
      agencies.length ||
      geography.length ||
      programs.length ||
      pollutants.length ||
      grap?.mentioned ||
      entityLines.length);
  const hasAnything =
    hasStructuredSignals || safeTagDetails.length > 0 || intelligenceCount > 0;
  const hasRenderableContent = hasAnything || smartCount > 0;
  const showLegacyStructured =
    !safeStructuredIntelligence && !safeSmartTags && hasStructuredSignals;
  const primarySmartTags = safeSmartTags
    ? [
        ...(safeSmartTags.taxonomyTags ?? []),
        ...(safeSmartTags.aiDiscoveredTags ?? []),
        ...(safeSmartTags.topics ?? []),
        ...(safeSmartTags.documentType ?? []),
        ...(safeSmartTags.actionsDecisions ?? []),
      ]
    : [];
  const entitySmartTags = safeSmartTags
    ? [
        ...(safeSmartTags.entities?.agencies ?? []),
        ...(safeSmartTags.entities?.organizations ?? []),
        ...(safeSmartTags.entities?.locations ?? []),
        ...(safeSmartTags.entities?.people ?? []),
        ...(safeSmartTags.entities?.legalReferences ?? []),
        ...(safeSmartTags.entities?.schemesPrograms ?? []),
        ...(safeSmartTags.entities?.datesDeadlines ?? []),
      ]
    : [];
  const evidenceAnchorCount = safeStructuredIntelligence
    ? intelligenceItems.reduce(
        (sum, item) => sum + cleanSmartEvidence(item.evidence).length,
        0,
      )
    : safeSmartTags
    ? smartEvidenceCount(safeSmartTags.items ?? [])
    : safeTagDetails.filter((tag) => tag.evidence).length;

  const headerRight = (
    <div className="flex items-center gap-2">
      {!compact ? (
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))]",
            "bg-white px-3 py-2 text-[12px] font-medium shadow-sm hover:bg-slate-50",
          )}
          onClick={async (e) => {
            e.stopPropagation();
            if (
              !structured &&
              !safeTagDetails.length &&
              !safeSmartTags &&
              !safeStructuredIntelligence
            )
              return;
            const ok = await copyToClipboard(
              JSON.stringify(
                {
                  structuredIntelligence: safeStructuredIntelligence,
                  smartTags: safeSmartTags,
                  structured,
                  tagDetails: safeTagDetails,
                },
                null,
                2,
              ),
            );
            if (ok) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1100);
            }
          }}
          title="Copy structured tags JSON"
        >
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy JSON"}
        </button>
      ) : null}

      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-[hsl(var(--border))]",
          "bg-white px-3 py-2 text-[12px] font-medium shadow-sm hover:bg-slate-50",
        )}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        title={expanded ? "Collapse" : "Expand"}
      >
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {expanded ? "Hide" : "Show"}
      </button>
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm",
        className,
      )}
      onPointerDownCapture={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 rounded-xl bg-slate-50/80 px-3 py-3 ring-1 ring-slate-200/70">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-slate-950">
              Document intelligence
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
              <span>{intelligenceCount || smartCount || safeTagDetails.length} tags</span>
              <span>-</span>
              <span>{evidenceAnchorCount} evidence anchors</span>
              {safeStructuredIntelligence?.profile ? (
                <>
                  <span>-</span>
                  <span>
                    {safeStructuredIntelligence.profile}
                    {safeStructuredIntelligence.version
                      ? ` v${safeStructuredIntelligence.version}`
                      : ""}
                  </span>
                </>
              ) : safeSmartTags?.profile ? (
                <>
                  <span>-</span>
                  <span>
                    {safeSmartTags.profile}
                    {safeSmartTags.version ? ` v${safeSmartTags.version}` : ""}
                  </span>
                </>
              ) : structured?.profile ? (
                <>
                  <span>-</span>
                  <span>
                    {structured.profile}
                    {structured.version ? ` v${structured.version}` : ""}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        {headerRight}
      </div>

      {!hasRenderableContent ? (
        <div className="px-1 pb-3 text-[12px] text-[hsl(var(--muted-foreground))]">
          No structured tags yet. Run the tagger (or re-tag) to populate CAQM
          labels like doc type, sector, GRAP stage, agencies, and geography.
        </div>
      ) : !expanded ? (
        <div className="px-1 py-3 text-[12px] text-slate-500">
          {intelligenceCount
            ? `${intelligenceCount} evidence-backed intelligence items`
            : smartCount
            ? `${primarySmartTags.length} review tags and ${entitySmartTags.length} entities`
            : safeTagDetails.length
            ? `${safeTagDetails.length} evidence-backed tags`
            : docType?.value
              ? `Doc type: ${prettyLabel(docType.value)}`
              : "Labels ready"}
        </div>
      ) : (
        <div className="px-1 pt-3">
          {!compact ? (
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[12px] leading-5 text-slate-500">
                Reviewable tags are grouped by purpose and backed by evidence when available.
              </div>
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] shadow-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={showEvidence}
                  onChange={(e) => setShowEvidence(e.target.checked)}
                />
                Show evidence
              </label>
            </div>
          ) : null}

          {safeStructuredIntelligence ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Intelligence items
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {intelligenceCount}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Sections
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {
                      INTELLIGENCE_SECTIONS.filter(
                        (section) =>
                          (
                            safeStructuredIntelligence[
                              section.key
                            ] as IntelligenceItem[] | undefined
                          )?.length,
                      ).length
                    }
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Evidence
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {evidenceAnchorCount}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {INTELLIGENCE_SECTIONS.map((section) => {
                  const items =
                    (safeStructuredIntelligence[
                      section.key
                    ] as IntelligenceItem[] | undefined) ?? [];
                  return (
                    <SmartTagSection
                      key={section.key}
                      title={section.title}
                      items={items.map(intelligenceToSmartTag)}
                      showEvidence={showEvidence}
                    />
                  );
                })}
              </div>
            </div>
          ) : safeSmartTags ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Review tags
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {primarySmartTags.length}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Entities
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {entitySmartTags.length}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Evidence
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    {evidenceAnchorCount}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <SmartTagSection
                  title="Taxonomy Tags"
                  items={safeSmartTags.taxonomyTags ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="AI-Discovered Tags"
                  items={safeSmartTags.aiDiscoveredTags ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Topics"
                  items={safeSmartTags.topics ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Document Type"
                  items={safeSmartTags.documentType ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Actions / Decisions"
                  items={safeSmartTags.actionsDecisions ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Agencies"
                  items={safeSmartTags.entities?.agencies ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Organizations"
                  items={safeSmartTags.entities?.organizations ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Locations"
                  items={safeSmartTags.entities?.locations ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="People"
                  items={safeSmartTags.entities?.people ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Legal References"
                  items={safeSmartTags.entities?.legalReferences ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Schemes / Programs"
                  items={safeSmartTags.entities?.schemesPrograms ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="Dates / Deadlines"
                  items={safeSmartTags.entities?.datesDeadlines ?? []}
                  showEvidence={showEvidence}
                />
                <SmartTagSection
                  title="User Tags"
                  items={safeSmartTags.userTags ?? []}
                  showEvidence={showEvidence}
                />
              </div>
            </div>
          ) : null}

          {!safeSmartTags && safeTagDetails.length ? (
            <div className="mt-2 rounded-2xl border border-slate-200/80 bg-slate-50/60 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-slate-900">
                    Evidence-backed AI tags
                  </div>
                  <div className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                    Typed tag objects persisted in metadata, not just flat strings.
                  </div>
                </div>
                <div className="rounded-md border border-[hsl(var(--border))] bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                  {safeTagDetails.length}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                {safeTagDetails.slice(0, compact ? 8 : 16).map((tag, idx) => (
                  <TagDetailRow
                    key={`${tag.type ?? "tag"}-${tag.value ?? idx}-${idx}`}
                    tag={tag}
                    showEvidence={showEvidence}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {showLegacyStructured ? (
            <>
              {/* Doc type + GRAP */}
              {docType?.value || grap?.mentioned ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {docType?.value ? (
                <div className="rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2">
                  <div className="text-[11px] font-semibold text-slate-900">
                    Document type
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    <Pill item={docType} showEvidence={showEvidence} />
                  </div>
                </div>
                ) : null}

                {grap?.mentioned ? (
                <div className="rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2">
                  <div className="text-[11px] font-semibold text-slate-900">
                    GRAP
                  </div>
                  <div className="mt-2">
                    <div className="flex flex-col gap-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-900">
                          Mentioned
                        </span>
                        {grap.stage ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-800">
                            Stage {grap.stage}
                          </span>
                        ) : null}
                      </span>
                      {showEvidence && grap.evidence ? (
                        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
                          {grap.evidence}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                ) : null}
              </div>
              ) : null}

              {/* Labels */}
              {sectors.length ||
              agencies.length ||
              geography.length ||
              programs.length ||
              pollutants.length ? (
              <div className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-white px-3">
                <div className="divide-y divide-[hsl(var(--border))]">
                  <Section title="Sectors" items={sectors} showEvidence={showEvidence} />
                  <Section title="Agencies" items={agencies} showEvidence={showEvidence} />
                  <Section title="Geography" items={geography} showEvidence={showEvidence} />
                  <Section title="Programs" items={programs} showEvidence={showEvidence} />
                  <Section title="Pollutants" items={pollutants} showEvidence={showEvidence} />
                </div>
              </div>
              ) : null}
            </>
          ) : null}

          {/* Entities */}
          {entityLines.length ? (
            <div className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-white px-3">
              <div className="px-1 pt-3 pb-1 text-[11px] font-semibold text-slate-900">
                Extracted identifiers
              </div>
              <div className="divide-y divide-[hsl(var(--border))] pb-2">
                {entityLines.map((l) => (
                  <div
                    key={l.k}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div className="text-[11px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                      {l.k}
                    </div>
                    <div className="min-w-0 text-right text-[12px] text-slate-900">
                      <div className="truncate max-w-[520px]" title={l.v}>
                        {l.v}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
