import type { Request, Response } from "express";
import {
  getInstitutionalNodeHealthProxy,
  getInstitutionalSessionStatusProxy,
  openInstitutionalLoginProxy,
} from "../services/institutionalNode.service";
import { log, requestMeta } from "../utils/logger";

export async function institutionalNodeHealthHandler(
  req: Request,
  res: Response,
) {
  const data = await getInstitutionalNodeHealthProxy();
  return res.json(data);
}

export async function institutionalNodeSessionStatusHandler(
  req: Request,
  res: Response,
) {
  const data = await getInstitutionalSessionStatusProxy();
  return res.json(data);
}

export async function institutionalNodeOpenLoginHandler(
  req: Request,
  res: Response,
) {
  try {
    const data = await openInstitutionalLoginProxy(req.body || {});

    log.info("institutional_login_opened", {
      ...requestMeta(req),
      provider: req.body?.provider ?? null,
      url: req.body?.url ?? null,
    });

    return res.json(data);
  } catch (error: any) {
    log.warn("institutional_login_open_failed", {
      ...requestMeta(req),
      provider: req.body?.provider ?? null,
      url: req.body?.url ?? null,
      error: String(error?.message || error),
    });

    return res.status(error?.status || 500).json({
      ok: false,
      message:
        error?.message || "Could not open the institutional login window.",
    });
  }
}
