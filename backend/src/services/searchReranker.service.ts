import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "../config/env";
import { log } from "../utils/logger";
import { canonicalizeUrl } from "../utils/urlCanonical";
import { fastModel, openaiClient } from "./openaiClient";
import type { GoogleSearchOpts } from "./search.service";
import type { EnrichedSearchResult } from "./searchResultIntelligence.service";

type RankedSearchResult = EnrichedSearchResult & {
  ranking: {
    rank: number;
    score: number;
    heuristicScore: number;
    llmScore: number;
    reasons: string[];
  };
};

type QueryHints = {
  siteHost?: string;
  wantsPdfOnly: boolean;
  wantsHtmlOnly: boolean;
  excludePdf: boolean;
  yearFrom?: number;
  yearTo?: number;
  isCourtIntent: boolean;
  isPolicyIntent: boolean;
  isParliamentIntent: boolean;
  isReportIntent: boolean;
  isNewsIntent: boolean;
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "after",
  "before",
  "site",
  "filetype",
  "pdf",
  "html",
]);

const RerankItemSchema = z.object({
  index: z.number().int().min(0),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1).max(48)).max(3).default([]),
});

const RerankBatchSchema = z.object({
  items: z.array(RerankItemSchema).default([]),
});

function safeHost(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/\bsite:[^\s]+/g, " ")
    .replace(/\bfiletype:[^\s]+/g, " ")
    .replace(/\b(after|before):\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function parseYearRange(
  query: string,
  opts?: GoogleSearchOpts,
): {
  yearFrom?: number;
  yearTo?: number;
} {
  const fromQuery = query.match(/\bafter:(\d{4})-\d{2}-\d{2}\b/i)?.[1];
  const toQuery = query.match(/\bbefore:(\d{4})-\d{2}-\d{2}\b/i)?.[1];

  const yearFrom =
    typeof opts?.yearFrom === "number"
      ? opts.yearFrom
      : fromQuery
        ? Number(fromQuery)
        : undefined;

  const yearTo =
    typeof opts?.yearTo === "number"
      ? opts.yearTo
      : toQuery
        ? Number(toQuery)
        : undefined;

  return { yearFrom, yearTo };
}

function parseSiteHost(
  query: string,
  opts?: GoogleSearchOpts,
): string | undefined {
  const explicit = String(opts?.site || "").trim();
  if (explicit) {
    const raw = explicit
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim();
    return raw || undefined;
  }

  const fromQuery = query.match(/\bsite:([^\s]+)/i)?.[1];
  if (!fromQuery) return undefined;

  return (
    fromQuery
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim() || undefined
  );
}

function buildQueryHints(query: string, opts?: GoogleSearchOpts): QueryHints {
  const q = normalizeText(query);

  const { yearFrom, yearTo } = parseYearRange(query, opts);
  const siteHost = parseSiteHost(query, opts);

  const wantsPdfOnly =
    opts?.fileType === "pdf" || /\bfiletype:pdf\b/i.test(query);

  const wantsHtmlOnly = opts?.fileType === "html";

  const excludePdf =
    opts?.excludeFileType === "pdf" || /\b-filetype:pdf\b/i.test(query);

  const isCourtIntent =
    /\bcourt\b|\bjudg(e)?ment\b|\border\b|\btribunal\b|\bwrit\b|\bpetition\b|\baffidavit\b/.test(
      q,
    );

  const isPolicyIntent =
    /\bnotification\b|\bgazette\b|\bcircular\b|\bguideline\b|\brule\b|\bact\b|\bministry\b|\bdepartment\b/.test(
      q,
    );

  const isParliamentIntent =
    /\bparliament\b|\blok sabha\b|\brajya sabha\b|\bcommittee\b|\bquestion\b|\bdebate\b/.test(
      q,
    );

  const isReportIntent =
    /\breport\b|\bassessment\b|\bstudy\b|\bwhite paper\b|\bworking paper\b|\bsurvey\b/.test(
      q,
    );

  const isNewsIntent =
    /\bnews\b|\blatest\b|\btoday\b|\brecent\b|\bheadline\b|\barticle\b|\bexplained\b/.test(
      q,
    );

  return {
    siteHost,
    wantsPdfOnly,
    wantsHtmlOnly,
    excludePdf,
    yearFrom,
    yearTo,
    isCourtIntent,
    isPolicyIntent,
    isParliamentIntent,
    isReportIntent,
    isNewsIntent,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeScores(raw: number[]): number[] {
  if (!raw.length) return [];
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  if (Math.abs(max - min) < 1e-9) return raw.map(() => 0.5);
  return raw.map((v) => clamp01((v - min) / (max - min)));
}

function dedupeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const reason of reasons) {
    const clean = String(reason || "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 3) break;
  }

  return out;
}

function getYearsMentioned(text: string): number[] {
  const hits = text.match(/\b(19|20)\d{2}\b/g) || [];
  return hits.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

function scoreHeuristic(
  row: EnrichedSearchResult,
  query: string,
  hints: QueryHints,
): { raw: number; reasons: string[] } {
  const title = String(row.title || "");
  const snippet = String(row.snippet || "");
  const url = String(row.url || "");
  const host = safeHost(url);

  const titleNorm = normalizeText(title);
  const snippetNorm = normalizeText(snippet);
  const urlNorm = normalizeText(url);
  const queryNorm = normalizeText(query);
  const terms = tokenize(query);

  let score = 0;
  const reasons: string[] = [];

  if (queryNorm && queryNorm.length >= 4 && titleNorm.includes(queryNorm)) {
    score += 18;
    reasons.push("Exact phrase match in title");
  } else if (
    queryNorm &&
    queryNorm.length >= 4 &&
    snippetNorm.includes(queryNorm)
  ) {
    score += 10;
    reasons.push("Exact phrase match in snippet");
  }

  for (const term of terms) {
    if (titleNorm.includes(term)) score += 4;
    if (snippetNorm.includes(term)) score += 2.5;
    if (urlNorm.includes(term)) score += 1.25;
  }

  if (hints.siteHost && host.includes(hints.siteHost.replace(/^www\./i, ""))) {
    score += 8;
    reasons.push("Matches requested site");
  }

  if (hints.wantsPdfOnly && row.intelligence.fileTypeHint === "pdf") {
    score += 7;
    reasons.push("PDF matches requested format");
  }

  if (hints.wantsHtmlOnly && row.intelligence.fileTypeHint === "html") {
    score += 5;
    reasons.push("HTML matches requested format");
  }

  if (hints.excludePdf && row.intelligence.fileTypeHint === "pdf") {
    score -= 5;
  }

  if (row.intelligence.confidence === "high") score += 4;
  if (row.intelligence.confidence === "medium") score += 2;

  if (hints.isCourtIntent) {
    if (row.intelligence.docType === "court_order") {
      score += 16;
      reasons.push("Court-order intent match");
    }
    if (row.intelligence.docType === "affidavit_filing") {
      score += 13;
      reasons.push("Court filing intent match");
    }
    if (row.intelligence.sourceType === "court") score += 8;
  }

  if (hints.isPolicyIntent) {
    if (row.intelligence.docType === "notification") {
      score += 16;
      reasons.push("Notification intent match");
    }
    if (row.intelligence.docType === "guideline_circular") {
      score += 14;
      reasons.push("Circular/guideline intent match");
    }
    if (row.intelligence.docType === "official_document") score += 8;
    if (row.intelligence.sourceType === "government") score += 8;
  }

  if (hints.isParliamentIntent) {
    if (row.intelligence.docType === "parliamentary_material") {
      score += 18;
      reasons.push("Parliament intent match");
    }
    if (row.intelligence.sourceType === "parliament") score += 10;
  }

  if (hints.isReportIntent) {
    if (row.intelligence.docType === "report") {
      score += 16;
      reasons.push("Report intent match");
    }
    if (row.intelligence.sourceType === "research") score += 8;
  }

  if (hints.isNewsIntent) {
    if (row.intelligence.docType === "news_article") {
      score += 15;
      reasons.push("News intent match");
    }
    if (row.intelligence.sourceType === "news") score += 8;
  } else {
    if (row.intelligence.sourceType === "news") score -= 4;
    if (
      row.intelligence.sourceType === "government" ||
      row.intelligence.sourceType === "court" ||
      row.intelligence.sourceType === "parliament"
    ) {
      score += 5;
      reasons.push("Primary/official source");
    }
  }

  const yearText = `${title} ${snippet} ${url}`;
  const years = getYearsMentioned(yearText);
  if (
    years.length &&
    typeof hints.yearFrom === "number" &&
    typeof hints.yearTo === "number" &&
    years.some((y) => y >= hints.yearFrom! && y <= hints.yearTo!)
  ) {
    score += 4;
    reasons.push("Within requested year range");
  }

  return { raw: score, reasons: dedupeReasons(reasons) };
}

async function scoreWithOpenAI(
  query: string,
  hints: QueryHints,
  rows: Array<{
    index: number;
    title: string;
    url: string;
    snippet?: string;
    intelligence: EnrichedSearchResult["intelligence"];
    heuristicScore: number;
  }>,
): Promise<Map<number, { score: number; reasons: string[] }>> {
  const out = new Map<number, { score: number; reasons: string[] }>();

  if (!env.OPENAI_ENABLED || !env.OPENAI_API_KEY || rows.length === 0) {
    return out;
  }

  try {
    const system = [
      "You rerank governance and evidence search results for a URL collector.",
      "Return only valid structured output.",
      "Score each candidate from 0 to 1 for relevance to the user's query.",
      "Prefer primary evidence sources over derivative coverage unless the query clearly asks for news.",
      "Primary evidence includes court orders, filings, government notifications, circulars, gazettes, parliamentary material, and official reports.",
      "Use only the query, filters, title, URL, snippet, and the supplied intelligence fields.",
      "Do not invent facts. Keep reasons short and concrete.",
    ].join("\n");

    const resp = await openaiClient().responses.parse({
      model: fastModel(),
      max_output_tokens: env.OPENAI_FAST_MAX_OUTPUT_TOKENS,
      input: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(
            {
              query,
              hints,
              candidates: rows,
            },
            null,
            2,
          ),
        },
      ],
      text: {
        format: zodTextFormat(RerankBatchSchema, "search_result_rerank"),
      },
    });

    const parsed = resp.output_parsed;
    if (!parsed?.items?.length) return out;

    for (const item of parsed.items) {
      out.set(item.index, {
        score: clamp01(item.score),
        reasons: dedupeReasons(item.reasons || []),
      });
    }

    return out;
  } catch (err: any) {
    log.warn("search.rerank.openai_failed", {
      reason: err?.message || "unknown",
    });
    return out;
  }
}

function diversify<T extends RankedSearchResult>(rows: T[]): T[] {
  const remaining = [...rows];
  const picked: T[] = [];
  const hostSeen = new Map<string, number>();
  const canonSeen = new Set<string>();

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i];
      const host = safeHost(row.url);
      const canon = canonicalizeUrl(row.url);

      let adjusted = row.ranking.score;
      adjusted -= (hostSeen.get(host) ?? 0) * 0.03;
      if (canonSeen.has(canon)) adjusted -= 0.2;

      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    picked.push(chosen);

    const host = safeHost(chosen.url);
    const canon = canonicalizeUrl(chosen.url);
    hostSeen.set(host, (hostSeen.get(host) ?? 0) + 1);
    canonSeen.add(canon);
  }

  return picked;
}

export async function rerankSearchResults(input: {
  query: string;
  results: EnrichedSearchResult[];
  opts?: GoogleSearchOpts;
}): Promise<RankedSearchResult[]> {
  const { query, results, opts } = input;

  if (!Array.isArray(results) || results.length === 0) return [];

  const startedAt = Date.now();
  const hints = buildQueryHints(query, opts);

  const heuristicRaw = results.map((row) => scoreHeuristic(row, query, hints));
  const heuristicNorm = normalizeScores(heuristicRaw.map((x) => x.raw));

  const llmCandidates = results
    .map((row, index) => ({
      index,
      title: row.title,
      url: row.url,
      snippet: row.snippet,
      intelligence: row.intelligence,
      heuristicScore: heuristicNorm[index] ?? 0.5,
    }))
    .sort((a, b) => b.heuristicScore - a.heuristicScore)
    .slice(0, Math.min(12, results.length));

  const llmScores = await scoreWithOpenAI(query, hints, llmCandidates);

  const combined: RankedSearchResult[] = results.map((row, index) => {
    const heuristicScore = heuristicNorm[index] ?? 0.5;
    const llm = llmScores.get(index);
    const llmScore = llm?.score ?? heuristicScore;

    const score = clamp01(0.65 * heuristicScore + 0.35 * llmScore);
    const reasons = dedupeReasons([
      ...heuristicRaw[index].reasons,
      ...(llm?.reasons || []),
    ]);

    return {
      ...row,
      ranking: {
        rank: 0,
        score: Number(score.toFixed(4)),
        heuristicScore: Number(heuristicScore.toFixed(4)),
        llmScore: Number(llmScore.toFixed(4)),
        reasons,
      },
    };
  });

  const sorted = diversify(
    combined.sort((a, b) => {
      if (b.ranking.score !== a.ranking.score) {
        return b.ranking.score - a.ranking.score;
      }
      if (b.ranking.heuristicScore !== a.ranking.heuristicScore) {
        return b.ranking.heuristicScore - a.ranking.heuristicScore;
      }
      return a.url.localeCompare(b.url);
    }),
  ).map((row, idx) => ({
    ...row,
    ranking: {
      ...row.ranking,
      rank: idx + 1,
    },
  }));

  log.info("search.rerank.ok", {
    items_count: sorted.length,
    usedOpenAI: env.OPENAI_ENABLED && !!env.OPENAI_API_KEY,
    ms: Date.now() - startedAt,
  });

  return sorted;
}
