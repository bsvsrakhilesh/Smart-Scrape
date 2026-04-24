import { Request, Response, NextFunction } from "express";
import { googleSearch } from "../services/search.service";
import { planCollectorQuery } from "../services/searchPlanner.service";
import {
  enrichSearchResults,
  type EnrichedSearchResult,
  type SearchResultIntelligence,
  type SearchResultRow,
} from "../services/searchResultIntelligence.service";
import { rerankSearchResults } from "../services/searchReranker.service";
import { env } from "../config/env";
import { log } from "../utils/logger";

type IncomingRerankRow = SearchResultRow & {
  intelligence?: SearchResultIntelligence;
};

function numOrUndef(v: unknown): number | undefined {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function strOrUndef(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
}

export async function searchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const q = String(req.query.q || "").trim();
  const page = Number(req.query.page ?? 1);

  const opts = {
    site: strOrUndef(req.query.site),
    yearFrom: numOrUndef(req.query.yearFrom),
    yearTo: numOrUndef(req.query.yearTo),
    jurisdiction: strOrUndef(req.query.jurisdiction),
    region: strOrUndef(req.query.region),
    fileType: strOrUndef(req.query.fileType) as "pdf" | "html" | undefined,
    lr: strOrUndef(req.query.lr),
    cr: strOrUndef(req.query.cr),
    gl: strOrUndef(req.query.gl),
  };

  if (!q && !opts.site) {
    log.warn("search.request.invalid", { reason: "missing q and site" });
    return res.status(400).json({
      error: "Missing query parameter `q` or site filter",
    });
  }

  const startedAt = Date.now();
  try {
    const { results, nextPage, totalResults } = await googleSearch(
      q,
      page,
      opts,
    );

    const enrichedResults = await enrichSearchResults(results);
    const rerankedResults = await rerankSearchResults({
      query: q,
      results: enrichedResults,
      opts,
    });

    if (typeof nextPage === "number")
      res.setHeader("x-next-page", String(nextPage));
    res.setHeader("x-has-more", typeof nextPage === "number" ? "1" : "0");
    res.setHeader(
      "x-ai-reranked",
      env.OPENAI_ENABLED && env.OPENAI_API_KEY ? "1" : "0",
    );

    if (typeof totalResults === "number" && !Number.isNaN(totalResults)) {
      res.setHeader("x-total-results", String(totalResults));
    }

    log.info("search.response.ok", {
      items_count: rerankedResults.length,
      ms: Date.now() - startedAt,
    });

    return res.json(rerankedResults);
  } catch (err: any) {
    log.error("search.response.error", {
      ms: Date.now() - startedAt,
      reason: err?.message,
    });
    return next(err);
  }
}

export async function searchRerankHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const q = String(req.body?.q || "").trim();

  const incoming = Array.isArray(req.body?.results) ? req.body.results : [];
  if (!incoming.length) {
    log.warn("search.rerank.invalid", { reason: "missing results" });
    return res.status(400).json({ error: "Missing body field `results`" });
  }

  const opts = {
    site: strOrUndef(req.body?.site),
    yearFrom: numOrUndef(req.body?.yearFrom),
    yearTo: numOrUndef(req.body?.yearTo),
    jurisdiction: strOrUndef(req.body?.jurisdiction),
    region: strOrUndef(req.body?.region),
    fileType: strOrUndef(req.body?.fileType) as "pdf" | "html" | undefined,
  };

  if (!q && !opts.site) {
    log.warn("search.rerank.invalid", { reason: "missing q and site" });
    return res
      .status(400)
      .json({ error: "Missing body field `q` or site filter" });
  }

  const startedAt = Date.now();

  try {
    const normalized: IncomingRerankRow[] = incoming.map(
      (row: any): IncomingRerankRow => ({
        title: String(row?.title || "").trim(),
        url: String(row?.url || "").trim(),
        snippet: typeof row?.snippet === "string" ? row.snippet : "",
        intelligence:
          row?.intelligence &&
          typeof row.intelligence === "object" &&
          typeof row.intelligence.docType === "string" &&
          typeof row.intelligence.sourceType === "string" &&
          typeof row.intelligence.fileTypeHint === "string" &&
          typeof row.intelligence.confidence === "string"
            ? {
                docType: row.intelligence.docType,
                sourceType: row.intelligence.sourceType,
                fileTypeHint: row.intelligence.fileTypeHint,
                confidence: row.intelligence.confidence,
                reason: String(row.intelligence.reason || ""),
              }
            : undefined,
      }),
    );

    const fullyEnriched = normalized.every(
      (row): row is EnrichedSearchResult => !!row.intelligence,
    );

    const enrichedRows: EnrichedSearchResult[] = fullyEnriched
      ? normalized
      : await enrichSearchResults(
          normalized.map(({ title, url, snippet }: SearchResultRow) => ({
            title,
            url,
            snippet,
          })),
        );

    const rerankedResults = await rerankSearchResults({
      query: q,
      results: enrichedRows as any,
      opts,
    });

    res.setHeader(
      "x-ai-reranked",
      env.OPENAI_ENABLED && env.OPENAI_API_KEY ? "1" : "0",
    );

    log.info("search.rerank.response.ok", {
      items_count: rerankedResults.length,
      ms: Date.now() - startedAt,
    });

    return res.json(rerankedResults);
  } catch (err: any) {
    log.error("search.rerank.response.error", {
      ms: Date.now() - startedAt,
      reason: err?.message,
    });
    return next(err);
  }
}

export async function searchPlanHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const startedAt = Date.now();

  try {
    const plan = await planCollectorQuery({
      website: strOrUndef(req.body?.website),
      keywords: strOrUndef(req.body?.keywords) ?? "",
      yearFrom: strOrUndef(req.body?.yearFrom),
      yearTo: strOrUndef(req.body?.yearTo),
      jurisdiction: strOrUndef(req.body?.jurisdiction),
      region: strOrUndef(req.body?.region),
      format: strOrUndef(req.body?.format) as
        | "any"
        | "pdfOnly"
        | "excludePdf"
        | undefined,
    });

    log.info("search.plan.ok", { ms: Date.now() - startedAt });
    return res.json(plan);
  } catch (err: any) {
    log.error("search.plan.error", {
      ms: Date.now() - startedAt,
      reason: err?.message,
    });
    return next(err);
  }
}
