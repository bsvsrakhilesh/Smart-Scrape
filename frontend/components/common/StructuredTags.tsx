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

type Props = {
  structured: Structured | null | undefined;
  tagDetails?: AiTagDetail[] | null;
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
  emptyText = "-",
}: {
  title: string;
  items: LabelItem[];
  showEvidence: boolean;
  emptyText?: string;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-slate-900">{title}</div>
        <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
          {items.length ? `${items.length}` : ""}
        </div>
      </div>

      {items.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((it, idx) => (
            <div key={`${it.value ?? "x"}-${idx}`} className="flex flex-col">
              <Pill item={it} showEvidence={showEvidence} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))]">
          {emptyText}
        </div>
      )}
    </div>
  );
}

export default function StructuredTags({
  structured,
  tagDetails,
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
  const hasAnything = hasStructuredSignals || safeTagDetails.length > 0;

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
            if (!structured && !safeTagDetails.length) return;
            const ok = await copyToClipboard(
              JSON.stringify({ structured, tagDetails: safeTagDetails }, null, 2),
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
        "rounded-lg border border-[hsl(var(--border))] bg-white px-3",
        className,
      )}
      onPointerDownCapture={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 px-1 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <div className="text-[11px] font-semibold text-slate-900">
            Smart tags
          </div>
          {structured?.profile ? (
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {structured.profile}
              {structured.version ? ` - v${structured.version}` : ""}
            </div>
          ) : null}
        </div>
        {headerRight}
      </div>

      {!hasAnything ? (
        <div className="px-1 pb-3 text-[12px] text-[hsl(var(--muted-foreground))]">
          No structured tags yet. Run the tagger (or re-tag) to populate CAQM
          labels like doc type, sector, GRAP stage, agencies, and geography.
        </div>
      ) : !expanded ? (
        <div className="px-1 pb-3 text-[12px] text-[hsl(var(--muted-foreground))]">
          {docType?.value ? (
            <span>
              Doc type:{" "}
              <span className="font-medium text-slate-900">
                {prettyLabel(docType.value)}
              </span>
            </span>
          ) : (
            <span>
              {safeTagDetails.length
                ? `${safeTagDetails.length} evidence-backed tags`
                : sectors.length
                  ? `${sectors.length} sector labels`
                  : "Labels ready"}
            </span>
          )}
        </div>
      ) : (
        <div className="px-1 pb-3">
          {!compact ? (
            <div className="flex items-center justify-between py-2">
              <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
                Confidence, type, source, and evidence are kept with each AI tag.
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2 text-[12px] shadow-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={showEvidence}
                  onChange={(e) => setShowEvidence(e.target.checked)}
                />
                Show evidence
              </label>
            </div>
          ) : null}

          {safeTagDetails.length ? (
            <div className="mt-2 rounded-lg border border-[hsl(var(--border))] bg-slate-50/60 px-3 py-3">
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

          {/* Doc type + GRAP */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-900">
                Document type
              </div>
              {docType?.value ? (
                <div className="mt-2 flex flex-col gap-2">
                  <Pill item={docType} showEvidence={showEvidence} />
                </div>
              ) : (
                <div className="mt-2 text-[12px] text-[hsl(var(--muted-foreground))]">
                  -
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[hsl(var(--border))] bg-white px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-900">
                GRAP
              </div>
              <div className="mt-2">
                {grap?.mentioned ? (
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
                ) : (
                  <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
                    Not detected
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Labels */}
          <div className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-white px-3">
            <div className="divide-y divide-[hsl(var(--border))]">
              <Section title="Sectors" items={sectors} showEvidence={showEvidence} />
              <Section title="Agencies" items={agencies} showEvidence={showEvidence} />
              <Section title="Geography" items={geography} showEvidence={showEvidence} />
              <Section title="Programs" items={programs} showEvidence={showEvidence} />
              <Section title="Pollutants" items={pollutants} showEvidence={showEvidence} />
            </div>
          </div>

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
