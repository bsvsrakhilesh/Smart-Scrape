import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import {
  institutionalInspectArticleHandler,
  institutionalFallbackSearchHandler,
} from "../controllers/institutionalNode.controller";

const r = Router();

const inspectArticleBody = z.object({
  url: z.string().url(),
});

const fallbackSearchBody = z.object({
  url: z.string().url(),
  providerOrder: z
    .array(z.enum(["pressreader", "proquest", "nexis"]))
    .optional(),
  maxCandidates: z.coerce.number().int().min(1).max(15).optional(),
});

r.post(
  "/icn/inspect/article",
  validate({ body: inspectArticleBody }),
  institutionalInspectArticleHandler,
);

r.post(
  "/icn/search/fallback/article",
  validate({ body: fallbackSearchBody }),
  institutionalFallbackSearchHandler,
);

export default r;
