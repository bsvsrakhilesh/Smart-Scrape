import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import prisma from "../config/database";
import { env } from "../config/env";
import { CaptureType, Prisma } from "../generated/prisma/client";
import { canonicalizeUrl, normalizedDomainFromUrl } from "../utils/urlCanonical";
import { scheduleAiTagForUrl } from "./aiTagUrlAuto.service";
import { enrichUrlCreateRows, type CreateUrlInput } from "./url.service";
import { fastModel, openaiClient } from "./openaiClient";

export type CollectorPurposeInput = {
  title: string;
  researchQuestion: string;
  jurisdiction?: string | null;
  region?: string | null;
  yearFrom?: string | null;
  yearTo?: string | null;
  sourcePreferences?: string[];
  targetActors?: string[];
  outputGoal?: string | null;
};

export type CollectorLane = {
  key: string;
  label: string;
  rationale: string;
  website: string;
  keywords: string;
  jurisdiction: string;
  region: string;
  yearFrom: string;
  yearTo: string;
  format: "any" | "pdfOnly" | "excludePdf";
};

export type CollectorAuthoritySource = {
  key: string;
  label: string;
  domain: string;
  evidenceRole: string;
  reason: string;
  confidence: number;
  queryHints: string[];
  documentTerms: string[];
};

const PurposePlanSchema = z.object({
  lanes: z.array(
    z.object({
      key: z.string().min(1).max(40),
      label: z.string().min(1).max(80),
      rationale: z.string().min(1).max(240),
      website: z.string().default(""),
      keywords: z.string().min(1).max(500),
      jurisdiction: z.string().default(""),
      region: z.string().default(""),
      yearFrom: z.string().default(""),
      yearTo: z.string().default(""),
      format: z.enum(["any", "pdfOnly", "excludePdf"]).default("any"),
    }),
  ).min(2).max(6),
});

function httpError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanYear(value: unknown) {
  const hit = cleanText(value, 10).match(/^(\d{4})/);
  return hit ? hit[1] : "";
}

function cleanDomain(value: unknown) {
  const raw = cleanText(value, 255).toLowerCase();
  if (!raw) return "";
  try {
    const maybeUrl = /^[a-z][a-z0-9+\-.]*:\/\//i.test(raw)
      ? raw
      : `https://${raw}`;
    return new URL(maybeUrl).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[\/?#\s]/)[0];
  }
}

function hostMatchesDomain(urlOrHost: string | undefined, authorityDomain: string) {
  const host = cleanDomain(urlOrHost);
  const domain = cleanDomain(authorityDomain);
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

function uniqueText(values: unknown, maxItems = 12) {
  if (!Array.isArray(values)) return [] as string[];
  return Array.from(
    new Set(values.map((item) => cleanText(item, 120)).filter(Boolean)),
  ).slice(0, maxItems);
}

function dedupeUrlInputsByCanonical(rows: CreateUrlInput[]): CreateUrlInput[] {
  const seen = new Set<string>();
  const deduped: CreateUrlInput[] = [];

  for (const row of rows) {
    const rawUrl = String(row.url || "").trim();
    if (!rawUrl) continue;

    const key = canonicalizeUrl(rawUrl) || rawUrl;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push({ ...row, url: rawUrl });
  }

  return deduped;
}

function normalizePurposeInput(input: CollectorPurposeInput) {
  const title = cleanText(input.title, 160);
  const researchQuestion = cleanText(input.researchQuestion, 1500);
  if (!title) throw httpError("Purpose title is required.");
  if (!researchQuestion) throw httpError("Research question is required.");
  return {
    title,
    researchQuestion,
    jurisdiction: cleanText(input.jurisdiction, 120) || null,
    region: cleanText(input.region, 120) || null,
    yearFrom: cleanYear(input.yearFrom) || null,
    yearTo: cleanYear(input.yearTo) || null,
    sourcePreferences: uniqueText(input.sourcePreferences),
    targetActors: uniqueText(input.targetActors),
    outputGoal: cleanText(input.outputGoal, 500) || null,
  };
}

async function requirePurpose(ownerId: string, purposeId: string) {
  const purpose = await prisma.collectorPurpose.findFirst({
    where: { id: purposeId, ownerId },
  });
  if (!purpose) throw httpError("Collector purpose not found.", 404);
  return purpose;
}

export async function summarizeCollectorPurpose(purposeId: string) {
  const links = await prisma.collectorPurposeUrl.findMany({
    where: { purposeId },
    select: { urlId: true },
  });
  const urlIds = links.map((link) => link.urlId);
  if (!urlIds.length) {
    return {
      savedUrlCount: 0,
      capturedEvidenceCount: 0,
      governanceReadyDocumentCount: 0,
    };
  }

  const files = await prisma.storedFile.findMany({
    where: {
      deletedAt: null,
      urlId: { in: urlIds },
      captureType: { in: [CaptureType.URL_TEXT, CaptureType.URL_PDF] },
    },
    select: {
      id: true,
      documentRevision: { select: { documentId: true } },
    },
  });
  const documentIds = new Set(
    files
      .map((file) => file.documentRevision?.documentId)
      .filter((id): id is string => Boolean(id)),
  );
  return {
    savedUrlCount: urlIds.length,
    capturedEvidenceCount: files.length,
    governanceReadyDocumentCount: documentIds.size,
  };
}

async function withSummary<T extends { id: string }>(purpose: T) {
  return {
    ...purpose,
    summary: await summarizeCollectorPurpose(purpose.id),
    authoritySources: inferAuthoritySources(purpose as unknown as AuthorityPurpose),
  };
}

export async function listCollectorPurposes(ownerId: string) {
  const purposes = await prisma.collectorPurpose.findMany({
    where: { ownerId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  return Promise.all(purposes.map(withSummary));
}

export async function getCollectorPurpose(ownerId: string, purposeId: string) {
  const purpose = await requirePurpose(ownerId, purposeId);
  const searches = await prisma.collectorPurposeSearch.findMany({
    where: { purposeId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return { ...(await withSummary(purpose)), searches };
}

export async function createCollectorPurpose(
  ownerId: string,
  input: CollectorPurposeInput,
) {
  const data = normalizePurposeInput(input);
  return withSummary(
    await prisma.collectorPurpose.create({ data: { ownerId, ...data } }),
  );
}

export async function updateCollectorPurpose(
  ownerId: string,
  purposeId: string,
  input: CollectorPurposeInput,
) {
  await requirePurpose(ownerId, purposeId);
  const data = normalizePurposeInput(input);
  return withSummary(
    await prisma.collectorPurpose.update({ where: { id: purposeId }, data }),
  );
}

export async function deleteCollectorPurpose(ownerId: string, purposeId: string) {
  await requirePurpose(ownerId, purposeId);
  await prisma.collectorPurpose.delete({ where: { id: purposeId } });
  return { ok: true as const };
}

function domainForPreference(value: string) {
  const clean = cleanDomain(value);
  if (clean.includes(".")) return clean.replace(/^https?:\/\//, "").split("/")[0];
  if (/court|judg|tribunal/.test(clean)) return "sci.gov.in";
  if (/gazette|notification/.test(clean)) return "egazette.nic.in";
  if (/parliament|lok sabha|rajya sabha/.test(clean)) return "sansad.in";
  return "";
}

type AuthorityPurpose = {
  title?: string | null;
  researchQuestion: string;
  jurisdiction: string | null;
  region: string | null;
  yearFrom?: string | null;
  yearTo?: string | null;
  sourcePreferences: string[];
  targetActors: string[];
  outputGoal?: string | null;
};

type AuthorityRegistryEntry = {
  key: string;
  label: string;
  domain: string;
  aliases: string[];
  topicTerms: string[];
  jurisdictionTerms?: string[];
  evidenceRole: string;
  reason: string;
  queryHints: string[];
  documentTerms: string[];
};

const AUTHORITY_REGISTRY: AuthorityRegistryEntry[] = [
  {
    key: "caqm",
    label: "CAQM",
    domain: "caqm.nic.in",
    aliases: ["caqm", "commission for air quality management"],
    topicTerms: ["grap", "graded response action plan", "stage iv", "stage 4", "air quality", "ncr"],
    jurisdictionTerms: ["delhi", "ncr", "national capital region"],
    evidenceRole: "Primary orders",
    reason: "Primary commission for GRAP and air-quality management orders in Delhi-NCR.",
    queryHints: ["GRAP", "Stage IV", "Stage 4", "Sub-Committee", "CAQM"],
    documentTerms: ["order", "direction", "revocation", "invocation", "press release"],
  },
  {
    key: "cpcb",
    label: "CPCB",
    domain: "cpcb.nic.in",
    aliases: ["cpcb", "central pollution control board"],
    topicTerms: ["air quality", "aqi", "grap", "pollution", "emission", "ambient air"],
    jurisdictionTerms: ["india", "delhi", "ncr"],
    evidenceRole: "National standard",
    reason: "National pollution-control authority and source for AQI, air-quality, and GRAP reference material.",
    queryHints: ["AQI", "air quality", "GRAP", "pollution control"],
    documentTerms: ["report", "guideline", "direction", "bulletin", "notification"],
  },
  {
    key: "dpcc",
    label: "DPCC",
    domain: "dpcc.delhigovt.nic.in",
    aliases: ["dpcc", "delhi pollution control committee"],
    topicTerms: ["delhi", "air quality", "pollution", "construction", "dust", "emission"],
    jurisdictionTerms: ["delhi"],
    evidenceRole: "Local implementation",
    reason: "Delhi implementation authority for pollution-control directions and local compliance material.",
    queryHints: ["Delhi", "pollution control", "air quality", "directions"],
    documentTerms: ["direction", "notice", "order", "circular", "report"],
  },
  {
    key: "delhi-environment",
    label: "Delhi Environment Department",
    domain: "environment.delhi.gov.in",
    aliases: ["environment department", "delhi environment", "department of environment"],
    topicTerms: ["delhi", "air quality", "pollution", "grap", "environment"],
    jurisdictionTerms: ["delhi"],
    evidenceRole: "Government notices",
    reason: "Delhi government department likely to carry local notices, implementation updates, and environment orders.",
    queryHints: ["Delhi", "environment", "GRAP", "air quality"],
    documentTerms: ["notification", "order", "circular", "notice", "guideline"],
  },
  {
    key: "hspcb",
    label: "HSPCB",
    domain: "hspcb.gov.in",
    aliases: ["hspcb", "haryana state pollution control board", "haryana pollution control board"],
    topicTerms: ["grap", "air quality", "pollution", "dust", "construction", "emission", "ncr"],
    jurisdictionTerms: ["haryana", "gurugram", "faridabad", "ncr", "national capital region"],
    evidenceRole: "State implementation",
    reason: "Haryana pollution-control authority for NCR implementation, directions, and compliance material.",
    queryHints: ["Haryana", "NCR", "GRAP", "air quality", "directions"],
    documentTerms: ["direction", "order", "notice", "letter", "action plan"],
  },
  {
    key: "uppcb",
    label: "UPPCB",
    domain: "uppcb.com",
    aliases: ["uppcb", "u.p. pollution control board", "up pollution control board", "uttar pradesh pollution control board"],
    topicTerms: ["grap", "air quality", "pollution", "dust", "construction", "emission", "ncr"],
    jurisdictionTerms: ["uttar pradesh", "up", "noida", "ghaziabad", "greater noida", "ncr"],
    evidenceRole: "State implementation",
    reason: "Uttar Pradesh pollution-control authority for NCR implementation and compliance records.",
    queryHints: ["Uttar Pradesh", "Noida", "Ghaziabad", "NCR", "GRAP"],
    documentTerms: ["direction", "order", "notice", "circular", "action plan"],
  },
  {
    key: "rspcb",
    label: "RSPCB",
    domain: "environment.rajasthan.gov.in",
    aliases: ["rspcb", "rajasthan state pollution control board", "rajasthan pollution control board"],
    topicTerms: ["grap", "air quality", "pollution", "dust", "construction", "emission", "ncr"],
    jurisdictionTerms: ["rajasthan", "alwar", "bharatpur", "ncr", "national capital region"],
    evidenceRole: "State implementation",
    reason: "Rajasthan pollution-control authority for NCR districts and state-level air-quality implementation.",
    queryHints: ["Rajasthan", "NCR", "GRAP", "air quality", "pollution control"],
    documentTerms: ["direction", "order", "notice", "guideline", "action plan"],
  },
  {
    key: "ppcb",
    label: "PPCB",
    domain: "ppcb.punjab.gov.in",
    aliases: ["ppcb", "punjab pollution control board", "punjab state pollution control board"],
    topicTerms: ["stubble", "paddy", "crop residue", "air quality", "pollution", "emission", "burning"],
    jurisdictionTerms: ["punjab", "delhi ncr", "ncr"],
    evidenceRole: "Source control",
    reason: "Punjab pollution-control authority for paddy stubble burning, enforcement, and source-control evidence.",
    queryHints: ["Punjab", "paddy stubble burning", "crop residue", "air quality"],
    documentTerms: ["action taken report", "direction", "order", "notice", "status report"],
  },
  {
    key: "imd",
    label: "IMD",
    domain: "mausam.imd.gov.in",
    aliases: ["imd", "india meteorological department", "meteorological department", "mausam"],
    topicTerms: ["air quality", "forecast", "meteorology", "wind", "dispersion", "aerosol", "aqi"],
    jurisdictionTerms: ["india", "delhi", "ncr"],
    evidenceRole: "Forecast context",
    reason: "Official meteorological source for weather, dispersion, and air-quality forecast context.",
    queryHints: ["IMD", "air quality forecast", "meteorology", "dispersion"],
    documentTerms: ["forecast", "bulletin", "advisory", "report"],
  },
  {
    key: "safar",
    label: "SAFAR",
    domain: "safar.tropmet.res.in",
    aliases: ["safar", "system of air quality and weather forecasting and research"],
    topicTerms: ["air quality", "forecast", "aqi", "advisory", "weather forecasting", "safar"],
    jurisdictionTerms: ["delhi", "ncr", "india"],
    evidenceRole: "AQI forecast",
    reason: "Official air-quality forecasting and advisory system for metro-level AQI context.",
    queryHints: ["SAFAR", "AQI", "air quality forecast", "advisory"],
    documentTerms: ["forecast", "advisory", "bulletin", "report"],
  },
  {
    key: "moefcc",
    label: "MoEFCC",
    domain: "moef.gov.in",
    aliases: ["moefcc", "moef", "ministry of environment", "environment ministry"],
    topicTerms: ["environment", "air quality", "pollution", "commission", "rules", "notification"],
    jurisdictionTerms: ["india", "national"],
    evidenceRole: "Policy context",
    reason: "Parent environment ministry for national policy, rules, notifications, and institutional context.",
    queryHints: ["environment ministry", "air quality", "notification", "rules"],
    documentTerms: ["notification", "rule", "office memorandum", "press release", "order"],
  },
  {
    key: "egazette",
    label: "e-Gazette",
    domain: "egazette.nic.in",
    aliases: ["gazette", "egazette", "official gazette"],
    topicTerms: ["notification", "rules", "act", "regulation", "appointment", "statutory"],
    evidenceRole: "Legal notification",
    reason: "Official gazette source for statutory notifications and formal legal instruments.",
    queryHints: ["notification", "rules", "statutory", "gazette"],
    documentTerms: ["notification", "gazette", "rules", "order"],
  },
  {
    key: "ngt",
    label: "National Green Tribunal",
    domain: "greentribunal.gov.in",
    aliases: ["ngt", "national green tribunal", "green tribunal"],
    topicTerms: ["tribunal", "environment", "pollution", "order", "case", "appeal"],
    evidenceRole: "Tribunal orders",
    reason: "Environmental tribunal for orders and case material tied to pollution governance.",
    queryHints: ["NGT", "environment", "pollution", "order"],
    documentTerms: ["order", "judgment", "case", "application"],
  },
  {
    key: "supreme-court",
    label: "Supreme Court of India",
    domain: "sci.gov.in",
    aliases: ["supreme court", "sci", "hon'ble supreme court", "honble supreme court"],
    topicTerms: ["court", "judgment", "order", "writ", "matter"],
    evidenceRole: "Court orders",
    reason: "Official Supreme Court source for orders and judgments when court supervision is relevant.",
    queryHints: ["Supreme Court", "order", "judgment"],
    documentTerms: ["order", "judgment", "record of proceedings"],
  },
];

const MAX_AUTHORITY_SOURCES = 8;

function textIncludes(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function scoreAuthority(entry: AuthorityRegistryEntry, text: string, domains: Set<string>) {
  let score = domains.has(entry.domain) ? 100 : 0;
  const aliasHits = entry.aliases.filter((term) => textIncludes(text, term));
  const topicHits = entry.topicTerms.filter((term) => textIncludes(text, term));
  const jurisdictionHits = (entry.jurisdictionTerms ?? []).filter((term) =>
    textIncludes(text, term),
  );

  score += Math.min(45, aliasHits.length * 24);
  score += Math.min(36, topicHits.length * 9);
  score += Math.min(15, jurisdictionHits.length * 5);
  if (aliasHits.length && topicHits.length) score += 18;
  if (entry.key === "caqm" && textIncludes(text, "grap")) score += 36;
  if (entry.key === "caqm" && /\bgrap\s*(4|iv)\b|\bstage\s*(4|iv)\b/i.test(text)) score += 10;
  if (entry.key === "cpcb" && textIncludes(text, "grap")) score += 28;
  if (["hspcb", "uppcb", "rspcb"].includes(entry.key) && /grap|ncr|delhi ncr/i.test(text)) {
    score += 24;
  }
  if (entry.key === "ppcb" && /stubble|paddy|crop residue|burning/i.test(text)) {
    score += 42;
  }
  if (["imd", "safar"].includes(entry.key) && /aqi|forecast|meteorolog|dispersion|air quality/i.test(text)) {
    score += 28;
  }
  if (entry.key === "egazette" && /notification|rules?|statutory|gazette/i.test(text)) {
    score += 18;
  }
  return Math.min(100, score);
}

export function inferAuthoritySources(purpose: AuthorityPurpose): CollectorAuthoritySource[] {
  const text = [
    purpose.title,
    purpose.researchQuestion,
    purpose.jurisdiction,
    purpose.region,
    purpose.outputGoal,
    ...(purpose.sourcePreferences ?? []),
    ...(purpose.targetActors ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const preferredDomains = new Set(
    (purpose.sourcePreferences ?? []).map(cleanDomain).filter(Boolean),
  );

  const registryHits = AUTHORITY_REGISTRY.map((entry) => ({
    entry,
    confidence: scoreAuthority(entry, text, preferredDomains),
  }))
    .filter((hit) => hit.confidence >= 45)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_AUTHORITY_SOURCES)
    .map(({ entry, confidence }) => ({
      key: entry.key,
      label: entry.label,
      domain: entry.domain,
      evidenceRole: entry.evidenceRole,
      reason: entry.reason,
      confidence,
      queryHints: entry.queryHints,
      documentTerms: entry.documentTerms,
    }));

  const knownDomains = new Set(registryHits.map((hit) => hit.domain));
  const customDomains = Array.from(preferredDomains)
    .filter((domain) => domain.includes(".") && !knownDomains.has(domain))
    .slice(0, 4)
    .map((domain) => ({
      key: `custom-${domain.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: domain,
      domain,
      evidenceRole: "Researcher seed",
      reason: "User-provided official or preferred source domain.",
      confidence: 92,
      queryHints: ["official", "order", "notification", "report"],
      documentTerms: ["order", "notification", "report", "guideline"],
    }));

  return [...registryHits, ...customDomains]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_AUTHORITY_SOURCES);
}

export function authoritySourceForUrl(
  authoritySources: CollectorAuthoritySource[],
  url: string | undefined,
) {
  return authoritySources.find((source) => hostMatchesDomain(url, source.domain)) ?? null;
}

function authorityLane(source: CollectorAuthoritySource, purpose: AuthorityPurpose): CollectorLane {
  const topic = cleanText(purpose.researchQuestion, 220);
  const actorTerms = purpose.targetActors.slice(0, 3).join(" | ");
  const keywords = [
    topic,
    actorTerms,
    source.queryHints.slice(0, 5).join(" | "),
    source.documentTerms.slice(0, 5).join(" | "),
  ]
    .filter(Boolean)
    .join(", ");
  return {
    key: `official-${source.key}`.slice(0, 40),
    label: `${source.label} official source`.slice(0, 80),
    rationale: `Directly search ${source.domain} so the main authority is not missed.`.slice(0, 240),
    website: source.domain,
    keywords,
    jurisdiction: purpose.jurisdiction ?? "",
    region: purpose.region ?? "",
    yearFrom: purpose.yearFrom ?? "",
    yearTo: purpose.yearTo ?? "",
    format: "pdfOnly",
  };
}

function ensureAuthorityLanes(lanes: CollectorLane[], purpose: AuthorityPurpose) {
  const authoritySources = inferAuthoritySources(purpose);
  const existingDomains = new Set(lanes.map((lane) => cleanDomain(lane.website)).filter(Boolean));
  const additions = authoritySources
    .filter((source) => !existingDomains.has(source.domain))
    .slice(0, 4)
    .map((source) => authorityLane(source, purpose));
  return [...additions, ...lanes].slice(0, 6);
}

export function fallbackPurposeLanes(purpose: {
  researchQuestion: string;
  jurisdiction: string | null;
  region: string | null;
  yearFrom: string | null;
  yearTo: string | null;
  sourcePreferences: string[];
  targetActors: string[];
}): CollectorLane[] {
  const topic = cleanText(purpose.researchQuestion, 260);
  const actorTerms = purpose.targetActors.slice(0, 3).join(" | ");
  const officialSite =
    purpose.sourcePreferences.map(domainForPreference).find(Boolean) ?? "";
  const base = {
    jurisdiction: purpose.jurisdiction ?? "",
    region: purpose.region ?? "",
    yearFrom: purpose.yearFrom ?? "",
    yearTo: purpose.yearTo ?? "",
  };
  return ensureAuthorityLanes([
    {
      key: "official-record",
      label: "Official record",
      rationale: "Find authoritative decisions, notifications, and source records.",
      website: officialSite,
      keywords: [topic, actorTerms, "order | notification | decision"].filter(Boolean).join(", "),
      format: "pdfOnly",
      ...base,
    },
    {
      key: "implementation",
      label: "Implementation and oversight",
      rationale: "Find compliance, monitoring, audit, and implementation evidence.",
      website: "",
      keywords: [topic, actorTerms, "compliance | implementation | audit | monitoring"].filter(Boolean).join(", "),
      format: "pdfOnly",
      ...base,
    },
    {
      key: "context",
      label: "Public record and analysis",
      rationale: "Locate reporting and analysis that identify further primary documents.",
      website: "",
      keywords: [topic, actorTerms, "report | analysis | hearing | coverage"].filter(Boolean).join(", "),
      format: "any",
      ...base,
    },
  ], purpose);
}

function sanitizeLanes(lanes: CollectorLane[], fallback: CollectorLane[]) {
  const cleaned = lanes
    .map((lane, index) => ({
      key: cleanText(lane.key, 40) || `lane-${index + 1}`,
      label: cleanText(lane.label, 80) || `Search lane ${index + 1}`,
      rationale: cleanText(lane.rationale, 240),
      website: cleanText(lane.website, 255),
      keywords: cleanText(lane.keywords, 500),
      jurisdiction: cleanText(lane.jurisdiction, 120),
      region: cleanText(lane.region, 120),
      yearFrom: cleanYear(lane.yearFrom),
      yearTo: cleanYear(lane.yearTo),
      format: lane.format,
    }))
    .filter((lane) => lane.keywords.length >= 2)
    .slice(0, 6);
  return cleaned.length >= 2 ? cleaned : fallback;
}

export async function planCollectorPurpose(ownerId: string, purposeId: string) {
  const purpose = await requirePurpose(ownerId, purposeId);
  const fallback = fallbackPurposeLanes(purpose);
  let lanes = fallback;

  if (env.OPENAI_ENABLED && env.OPENAI_API_KEY) {
    try {
      const authoritySources = inferAuthoritySources(purpose);
      const response = await openaiClient().responses.parse({
        model: fastModel(),
        max_output_tokens: env.OPENAI_FAST_MAX_OUTPUT_TOKENS,
        input: [
          {
            role: "system",
            content: [
              "Create editable evidence-discovery search lanes for a governance research URL collector.",
              "Each lane must support a distinct discovery job and preserve the user's stated scope.",
              "Use commas for AND terms and pipes for OR alternatives in keywords.",
              "Prefer official sources for primary records; do not invent case numbers, agencies, dates, or domains.",
              "When candidate authoritySources are provided, create direct website-scoped lanes for high-confidence primary agencies.",
              "Return 2 to 6 lanes with website blank only for mixed-source discovery lanes.",
            ].join("\n"),
          },
          { role: "user", content: JSON.stringify({ purpose, authoritySources }) },
        ],
        text: { format: zodTextFormat(PurposePlanSchema, "purpose_search_lanes") },
      });
      if (response.output_parsed?.lanes) {
        lanes = ensureAuthorityLanes(
          sanitizeLanes(response.output_parsed.lanes, fallback),
          purpose,
        );
      }
    } catch {
      lanes = fallback;
    }
  }

  const plan = { lanes, generatedAt: new Date().toISOString() };
  await prisma.collectorPurpose.update({ where: { id: purposeId }, data: { plan } });
  return plan;
}

export async function recordCollectorPurposeSearch(args: {
  ownerId: string;
  purposeId: string;
  query: string;
  laneKey?: string | null;
  parameters?: unknown;
  resultCount: number;
}) {
  await requirePurpose(args.ownerId, args.purposeId);
  return prisma.collectorPurposeSearch.create({
    data: {
      purposeId: args.purposeId,
      query: cleanText(args.query, 1000),
      laneKey: cleanText(args.laneKey, 40) || null,
      parameters: (args.parameters ?? undefined) as Prisma.InputJsonValue | undefined,
      resultCount: Math.max(0, Number(args.resultCount) || 0),
    },
  });
}

export async function scoreResultsForPurpose<T extends {
  title?: string;
  snippet?: string;
  url?: string;
  ranking?: { score: number; reasons: string[]; rank: number };
}>(ownerId: string, purposeId: string, rows: T[]) {
  const purpose = await requirePurpose(ownerId, purposeId);
  const authoritySources = inferAuthoritySources(purpose);
  const terms = Array.from(
    new Set(
      `${purpose.researchQuestion} ${purpose.targetActors.join(" ")} ${purpose.jurisdiction ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length >= 4),
    ),
  ).slice(0, 16);

  const scored = rows.map((row) => {
    const text = `${row.title ?? ""} ${row.snippet ?? ""} ${row.url ?? ""}`.toLowerCase();
    const hits = terms.filter((term) => text.includes(term));
    const relevanceScore = Math.min(1, hits.length / Math.max(3, terms.length / 2));
    const authoritySource = authoritySourceForUrl(authoritySources, row.url);
    const authorityBoost = authoritySource
      ? Math.min(0.18, 0.08 + authoritySource.confidence / 1000)
      : 0;
    const authorityReason = authoritySource
      ? `Official source match: ${authoritySource.label}`
      : "";
    const relevance = {
      score: Math.min(1, relevanceScore + authorityBoost),
      matchedTerms: hits.slice(0, 5),
      reason: [
        hits.length
          ? `Matches purpose terms: ${hits.slice(0, 3).join(", ")}`
          : "No direct purpose-term match detected.",
        authorityReason,
      ].filter(Boolean).join(" "),
    };
    if (!row.ranking) return { ...row, purposeRelevance: relevance };
    return {
      ...row,
      ranking: {
        ...row.ranking,
        score: Math.min(1, row.ranking.score + relevanceScore * 0.12 + authorityBoost),
        reasons: [...row.ranking.reasons, relevance.reason].slice(0, 6),
      },
      purposeRelevance: relevance,
    };
  });

  return scored
    .sort((a, b) => (b.ranking?.score ?? 0) - (a.ranking?.score ?? 0))
    .map((row, index) =>
      row.ranking ? { ...row, ranking: { ...row.ranking, rank: index + 1 } } : row,
    );
}

export async function saveCollectorPurposeSelection(args: {
  ownerId: string;
  purposeId: string;
  searchId?: string | null;
  rows: CreateUrlInput[];
}) {
  await requirePurpose(args.ownerId, args.purposeId);
  const enriched = dedupeUrlInputsByCanonical(
    await enrichUrlCreateRows(args.rows),
  );

  if (args.searchId) {
    const search = await prisma.collectorPurposeSearch.findFirst({
      where: { id: args.searchId, purposeId: args.purposeId },
      select: { id: true },
    });
    if (!search) throw httpError("Purpose search record not found.", 404);
  }

  const outcomes = await prisma.$transaction(async (tx) => {
    const saved: Array<{
      urlId: number;
      url: string;
      newlySaved: boolean;
      newlyLinked: boolean;
      needsTagging: boolean;
      status: "saved_to_purpose" | "added_to_purpose" | "already_in_purpose";
    }> = [];

    for (const row of enriched) {
      const canonical = canonicalizeUrl(row.url);
      let url = await tx.url.findFirst({
        where: { OR: [{ url: row.url }, ...(canonical ? [{ canonical_url: canonical }] : [])] },
      });
      const newlySaved = !url;
      if (!url) {
        url = await tx.url.create({
          data: {
            url: row.url,
            canonical_url: canonical,
            normalizedDomain: normalizedDomainFromUrl(canonical || row.url),
            title: row.title?.trim() || row.url,
            snippet: row.snippet ?? null,
            publishedAt: row.publishedAt ?? null,
            authors: row.authors ?? [],
            tagsMeta: row.tagsMeta ?? undefined,
          },
        });
      }

      const existingLink = await tx.collectorPurposeUrl.findUnique({
        where: { purposeId_urlId: { purposeId: args.purposeId, urlId: url.id } },
      });
      const newlyLinked = !existingLink;
      if (!existingLink) {
        await tx.collectorPurposeUrl.create({
          data: {
            purposeId: args.purposeId,
            urlId: url.id,
            sourceSearchId: args.searchId ?? null,
          },
        });
      }

      saved.push({
        urlId: url.id,
        url: url.url,
        newlySaved,
        newlyLinked,
        needsTagging:
          newlySaved ||
          !url.taggerVersion ||
          url.tags.length === 0 ||
          url.taggingStatus === "FAILED",
        status: newlySaved
          ? "saved_to_purpose"
          : newlyLinked
            ? "added_to_purpose"
            : "already_in_purpose",
      });
    }
    return saved;
  });

  outcomes.filter((row) => row.needsTagging).forEach((row) => scheduleAiTagForUrl(row.urlId));
  return {
    rows: outcomes.map((row) => ({
      urlId: row.urlId,
      url: row.url,
      newlySaved: row.newlySaved,
      newlyLinked: row.newlyLinked,
      status: row.status,
    })),
    summary: await summarizeCollectorPurpose(args.purposeId),
  };
}
