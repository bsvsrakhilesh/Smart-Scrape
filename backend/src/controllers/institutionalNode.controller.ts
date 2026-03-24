import type { Request, Response } from "express";
import { inspectInstitutionalArticleProxy } from "../services/institutionalNode.service";
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
