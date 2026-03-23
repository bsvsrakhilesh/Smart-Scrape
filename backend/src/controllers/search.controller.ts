import { Request, Response, NextFunction } from "express";
import { googleSearch } from "../services/search.service";
import { planCollectorQuery } from "../services/searchPlanner.service";
import { enrichSearchResults } from "../services/searchResultIntelligence.service";
import { rerankSearchResults } from "../services/searchReranker.service";
import { env } from "../config/env";
import { log } from "../utils/logger";

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

  if (!q) {
    log.warn("search.request.invalid", { reason: "missing q" });
    return res.status(400).json({ error: "Missing query parameter `q`" });
  }

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
