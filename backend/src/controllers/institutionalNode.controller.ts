import type { Request, Response } from "express";
import {
  inspectInstitutionalArticleProxy,
  searchInstitutionalArticleFallbackProxy,
} from "../services/institutionalNode.service";
import { log, requestMeta } from "../utils/logger";

export async function institutionalInspectArticleHandler(
  req: Request,
  res: Response,
) {
  const data = await inspectInstitutionalArticleProxy(req.body || {});

  log.info("institutional_article_inspected", {
    ...requestMeta(req),
    url: req.body?.url ?? null,
    reachable: data.reachable,
    paywallDetected: data.paywallDetected,
    isLikelyArticle: data.isLikelyArticle,
    provider: data.provider,
    sourceHost: data.sourceHost,
  });

  return res.json(data);
}

export async function institutionalFallbackSearchHandler(
  req: Request,
  res: Response,
) {
  const data = await searchInstitutionalArticleFallbackProxy(req.body || {});

  log.info("institutional_fallback_search_completed", {
    ...requestMeta(req),
    url: req.body?.url ?? null,
    reachable: data.reachable,
    searchedProviders: data.searchedProviders,
    candidateCount: data.candidates.length,
    bestProvider: data.bestCandidate?.provider ?? null,
    bestScore: data.bestCandidate?.score ?? null,
  });

  return res.json(data);
}
