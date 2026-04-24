import type { SearchResult } from "../lib/types";

export type CaptureMode = "text" | "pdf";
export type CollectorSearchWebOptions = {
  site?: string;
  yearFrom?: number;
  yearTo?: number;
  jurisdiction?: string;
  region?: string;
  fileType?: "pdf" | "html";
  lr?: string;
  cr?: string;
  gl?: string;
};

const PDF_FIRST_DOC_TYPES = new Set([
  "court_order",
  "notification",
  "report",
  "parliamentary_material",
  "affidavit_filing",
  "guideline_circular",
  "official_document",
]);

function formatPlanValue(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  const alreadyQuoted =
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"));
  if (alreadyQuoted) return t;
  return t.includes(" ") ? `"${t}"` : t;
}

export function toYYYY(s: string): string {
  const t = (s || "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{4})/);
  return m ? m[1] : "";
}

export function normalizeCollectorWebsite(raw: string): string {
  const v = raw.trim();
  if (!v) return "";

  try {
    const maybeUrl = v.match(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//)
      ? v
      : `https://${v}`;
    const u = new URL(maybeUrl);
    return u.hostname.replace(/^\s*www\./i, "").trim();
  } catch {
    return v.replace(/^\s*www\./i, "").split(/[\/\s?#]/)[0];
  }
}

export function normalizeCollectorKeywords(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";

  const cleaned = s.replace(/\bAND\b/gi, " ").trim();
  const orGroups = cleaned
    .split("|")
    .map((g) => g.trim())
    .filter(Boolean);

  const groupQueries = orGroups.map((group) => {
    const parts = group
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const terms = parts.map((p) => {
      const alreadyQuoted =
        (p.startsWith('"') && p.endsWith('"')) ||
        (p.startsWith("'") && p.endsWith("'"));
      if (alreadyQuoted) return p;
      return p.includes(" ") ? `"${p}"` : p;
    });

    return terms.join(" ");
  });

  return groupQueries.length > 1
    ? `(${groupQueries.join(") OR (")})`
    : groupQueries[0];
}

export function buildCollectorSearchQuery(kws: string): string {
  return (kws || "").trim();
}

export function formatAppliedCollectorSearchPlan(
  query: string,
  opts?: CollectorSearchWebOptions | null,
): string {
  const parts: string[] = [];
  const q = (query || "").trim();

  if (q) parts.push(q);

  const site = String(opts?.site ?? "").trim();
  if (site) parts.push(`site=${site}`);

  const yearFrom =
    typeof opts?.yearFrom === "number" ? String(opts.yearFrom) : "";
  const yearTo = typeof opts?.yearTo === "number" ? String(opts.yearTo) : "";
  if (yearFrom || yearTo) {
    parts.push(`years=${yearFrom || "..."}-${yearTo || "..."}`);
  }

  const jurisdiction = String(opts?.jurisdiction ?? "").trim();
  if (jurisdiction) {
    parts.push(`jurisdiction=${formatPlanValue(jurisdiction)}`);
  }

  const region = String(opts?.region ?? "").trim();
  if (region) {
    parts.push(`region=${formatPlanValue(region)}`);
  }

  if (opts?.fileType === "pdf") parts.push("format=pdf");
  if (opts?.fileType === "html") parts.push("format=html");

  return parts.join(" | ");
}

export function inferPreferredCollectorCapture(
  result: SearchResult,
): CaptureMode {
  const docType = result.intelligence?.docType;

  if (docType) {
    return PDF_FIRST_DOC_TYPES.has(docType) ? "pdf" : "text";
  }

  const url = String(result.url || "").toLowerCase();
  if (/\.pdf(?:$|[?#])/.test(url) || /format=pdf/.test(url)) return "pdf";
  return "text";
}

export function getCollectorCaptureMeta(mode: CaptureMode) {
  return mode === "pdf"
    ? {
        shortLabel: "PDF",
        longLabel: "Capture PDF",
        title: "Capture this result as PDF",
      }
    : {
        shortLabel: "Text",
        longLabel: "Capture Text",
        title: "Capture this result as text",
      };
}

export function suggestCollectorCaptureName(
  url: string,
  title: string | undefined,
  mode: CaptureMode,
) {
  const looksLikeUrlTitle = (t?: string) =>
    !!t && /^https?:\/\//i.test(t.trim());

  const fromUrl = (u: string) => {
    try {
      const parsed = new URL(u);

      for (const [, value] of parsed.searchParams.entries()) {
        const s = String(value || "");
        if (s.toLowerCase().includes(".pdf")) {
          const base = s.split("/").pop() || "document.pdf";
          return decodeURIComponent(base);
        }
      }

      const base = decodeURIComponent(parsed.pathname.split("/").pop() || "");
      return base || parsed.hostname || "page";
    } catch {
      return "page";
    }
  };

  const raw =
    title && !looksLikeUrlTitle(title) ? title.trim() : fromUrl(url).trim();

  const stem = raw.replace(/\.(pdf|txt)$/i, "").slice(0, 60) || "page";
  return mode === "pdf" ? `${stem}.pdf` : `${stem}.txt`;
}
