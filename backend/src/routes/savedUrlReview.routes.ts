import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { ownerIdForRequest } from "../utils/requestOwner";
import {
  clearSavedUrlReviews,
  getSavedUrlReviewMap,
  markSavedUrlsReviewed,
} from "../services/savedUrlReview.service";

const r = Router();

function parseUrlIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((value) => parseUrlIds(value));
  }

  return String(raw ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

const reviewIdsBody = z.object({
  urlIds: z.array(z.number().int().positive()).min(1).max(1000),
});

const clearReviewBody = z
  .object({
    urlIds: z.array(z.number().int().positive()).max(1000).optional(),
  })
  .default({});

r.get("/saved-url-reviews", async (req, res, next) => {
  try {
    const ownerId = ownerIdForRequest(req);
    const urlIds = parseUrlIds(req.query.urlIds);

    if (!urlIds.length) {
      return res.json({ ownerId, reviews: {} });
    }

    const reviews = await getSavedUrlReviewMap(ownerId, urlIds);
    return res.json({ ownerId, reviews });
  } catch (e) {
    next(e);
  }
});

r.post(
  "/saved-url-reviews/mark-reviewed",
  validate({ body: reviewIdsBody }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const out = await markSavedUrlsReviewed(ownerId, req.body.urlIds);
      return res.json({
        ownerId,
        ...out,
        reviewedAt: out.reviewedAt.toISOString(),
      });
    } catch (e) {
      next(e);
    }
  },
);

r.post(
  "/saved-url-reviews/clear",
  validate({ body: clearReviewBody }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const out = await clearSavedUrlReviews(ownerId, req.body.urlIds);
      return res.json({ ownerId, ...out });
    } catch (e) {
      next(e);
    }
  },
);

export default r;
