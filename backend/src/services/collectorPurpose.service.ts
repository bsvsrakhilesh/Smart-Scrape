import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import prisma from "../config/database";
import { env } from "../config/env";
import { CaptureType, Prisma } from "../generated/prisma/client";
import { canonicalizeUrl, normalizedDomainFromUrl } from "../utils/urlCanonical";
import { scheduleAiTagForUrl } from "./aiTagUrlAuto.service";
import { enrichUrlCreateRows, type CreateUrlInput } from "./url.service";
import { defaultModel, openaiClient } from "./openaiClient";

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

function uniqueText(values: unknown, maxItems = 12) {
  if (!Array.isArray(values)) return [] as string[];
  return Array.from(
    new Set(values.map((item) => cleanText(item, 120)).filter(Boolean)),
  ).slice(0, maxItems);
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
  return { ...purpose, summary: await summarizeCollectorPurpose(purpose.id) };
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

function domainForPreference(value: string) {
  const clean = value.trim().toLowerCase();
  if (clean.includes(".")) return clean.replace(/^https?:\/\//, "").split("/")[0];
  if (/court|judg|tribunal/.test(clean)) return "sci.gov.in";
  if (/gazette|notification/.test(clean)) return "egazette.nic.in";
  if (/parliament|lok sabha|rajya sabha/.test(clean)) return "sansad.in";
  return "";
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
  return [
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
  ];
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
      const response = await openaiClient().responses.parse({
        model: defaultModel(),
        input: [
          {
            role: "system",
            content: [
              "Create editable evidence-discovery search lanes for a governance research URL collector.",
              "Each lane must support a distinct discovery job and preserve the user's stated scope.",
              "Use commas for AND terms and pipes for OR alternatives in keywords.",
              "Prefer official sources for primary records; do not invent case numbers, agencies, dates, or domains.",
              "Return 2 to 5 lanes with website blank unless a stated preference or obvious official source supports it.",
            ].join("\n"),
          },
          { role: "user", content: JSON.stringify(purpose) },
        ],
        text: { format: zodTextFormat(PurposePlanSchema, "purpose_search_lanes") },
      });
      if (response.output_parsed?.lanes) {
        lanes = sanitizeLanes(response.output_parsed.lanes, fallback);
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
    const relevance = {
      score: relevanceScore,
      matchedTerms: hits.slice(0, 5),
      reason: hits.length
        ? `Matches purpose terms: ${hits.slice(0, 3).join(", ")}`
        : "No direct purpose-term match detected.",
    };
    if (!row.ranking) return { ...row, purposeRelevance: relevance };
    return {
      ...row,
      ranking: {
        ...row.ranking,
        score: row.ranking.score + relevanceScore * 0.12,
        reasons: [...row.ranking.reasons, relevance.reason].slice(0, 5),
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
  const enriched = await enrichUrlCreateRows(args.rows);

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
