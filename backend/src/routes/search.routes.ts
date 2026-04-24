import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import {
  searchHandler,
  searchPlanHandler,
  searchRerankHandler,
} from "../controllers/search.controller";

const router = Router();

const planBodySchema = z
  .object({
    website: z.string().trim().max(255).optional(),
    keywords: z.string().trim().min(2, "keywords must be at least 2 chars"),
    yearFrom: z.string().trim().max(10).optional(),
    yearTo: z.string().trim().max(10).optional(),
    jurisdiction: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    format: z.enum(["any", "pdfOnly", "excludePdf"]).optional(),
  })
  .superRefine((v, ctx) => {
    const y1 = Number(String(v.yearFrom ?? "").slice(0, 4));
    const y2 = Number(String(v.yearTo ?? "").slice(0, 4));

    if (Number.isFinite(y1) && Number.isFinite(y2) && y1 > y2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "yearFrom must be <= yearTo",
        path: ["yearFrom"],
      });
    }
  });

const rerankBodySchema = z
  .object({
    q: z.string().trim().max(500).optional(),

    results: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(500),
          url: z.string().trim().min(4).max(2000),
          snippet: z.string().trim().max(3000).optional(),
          intelligence: z
            .object({
              docType: z.enum([
                "court_order",
                "notification",
                "report",
                "news_article",
                "parliamentary_material",
                "affidavit_filing",
                "guideline_circular",
                "official_document",
                "other",
              ]),
              sourceType: z.enum([
                "court",
                "government",
                "parliament",
                "news",
                "research",
                "other",
              ]),
              fileTypeHint: z.enum(["pdf", "html", "doc", "other"]),
              confidence: z.enum(["high", "medium", "low"]),
              reason: z.string().optional(),
            })
            .optional(),
        }),
      )
      .min(1)
      .max(100),

    site: z.string().trim().min(2).optional(),
    yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
    yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
    jurisdiction: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    fileType: z.enum(["pdf", "html"]).optional(),
  })
  .superRefine((v, ctx) => {
    const q = String(v.q ?? "").trim();
    const hasSite = !!String(v.site ?? "").trim();

    if (!hasSite && q.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "q must be at least 2 chars when no site filter is provided",
        path: ["q"],
      });
    } else if (q.length > 0 && q.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "q must be at least 2 chars",
        path: ["q"],
      });
    }

    if (
      typeof v.yearFrom === "number" &&
      typeof v.yearTo === "number" &&
      v.yearFrom > v.yearTo
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "yearFrom must be <= yearTo",
        path: ["yearFrom"],
      });
    }
  });

const querySchema = z
  .object({
    q: z.string().trim().max(500).optional(),
    page: z.coerce.number().int().min(1).optional(),

    // Optional structured filters (URL Collector)
    site: z.string().trim().min(2).optional(),
    yearFrom: z.coerce.number().int().min(1900).max(2100).optional(),
    yearTo: z.coerce.number().int().min(1900).max(2100).optional(),
    jurisdiction: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    fileType: z.enum(["pdf", "html"]).optional(),

    // Google CSE knobs (advanced; still safe to expose)
    lr: z.string().trim().max(40).optional(), // e.g. lang_en
    cr: z.string().trim().max(40).optional(), // e.g. countryIN
    gl: z.string().trim().max(10).optional(), // e.g. IN
  })
  .superRefine((v, ctx) => {
    const q = String(v.q ?? "").trim();
    const hasSite = !!String(v.site ?? "").trim();

    if (!hasSite && q.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "q must be at least 2 chars when no site filter is provided",
        path: ["q"],
      });
    } else if (q.length > 0 && q.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "q must be at least 2 chars",
        path: ["q"],
      });
    }

    if (
      typeof v.yearFrom === "number" &&
      typeof v.yearTo === "number" &&
      v.yearFrom > v.yearTo
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "yearFrom must be <= yearTo",
        path: ["yearFrom"],
      });
    }
  });

router.get("/", validate({ query: querySchema }), searchHandler);
router.post(
  "/rerank",
  validate({ body: rerankBodySchema }),
  searchRerankHandler,
);
router.post("/plan", validate({ body: planBodySchema }), searchPlanHandler);

export default router;
