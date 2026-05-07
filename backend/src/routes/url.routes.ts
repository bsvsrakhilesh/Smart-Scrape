import { Router } from "express";
import {
  getUrlsHandler,
  getUrlFacetsHandler,
  getUrlReviewQueueSummaryHandler,
  getUrlByIdHandler,
  recordUrlVisitHandler,
  createUrlsHandler,
  urlsExistHandler,
  deleteUrlByIdHandler,
  deleteUrlsBulkHandler,
  updateUrlByIdHandler,
  previewUrlHandler,
  getUrlTaggingSummaryHandler,
  retryFailedUrlTaggingHandler,
  getUrlSnapshotsHandler,
  getUrlRevisionsHandler,
  refreshUrlMetadataHandler,
  probeUrlHandler,
  probeUrlByIdHandler,
  discoverUrlDocumentsHandler,
  getUrlDiscoveredDocumentsHandler,
} from "../controllers/url.controller";
import { z } from "zod";
import { validate } from "../middlewares/validate";
const r = Router();

const createUrlsBody = z.object({
  urls: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().min(1),
        snippet: z.string().optional().nullable(),
      }),
    )
    .min(1),
});

const urlsExistsBody = z.object({
  urls: z.array(z.string().min(1)).min(1),
});

const previewUrlBody = z.object({
  url: z.string().url(),
});

const probeUrlQuery = z.object({
  url: z.string().url(),
});

const retryFailedBody = z
  .object({
    ids: z.array(z.number().int().positive()).optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .default({});

const urlSnapshotsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const urlRevisionsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const discoverDocumentsBody = z
  .object({
    query: z.string().trim().max(1000).optional().nullable(),
    maxDepth: z.number().int().min(1).max(2).optional().nullable(),
    useBrowserFallback: z.boolean().optional().nullable(),
  })
  .default({});

const listUrlsQuery = z.object({
  q: z.string().optional(),
  year: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  domains: z.union([z.string(), z.array(z.string())]).optional(),
  visibility: z.enum(["all", "public", "private"]).optional(),
  collectionId: z.string().min(1).optional(),
  favoritesOnly: z.coerce.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  publishedFrom: z.string().optional(),
  publishedTo: z.string().optional(),
  snapshotStatus: z.enum(["all", "missing", "stale", "fresh"]).optional(),
  taggingStatus: z
    .enum(["all", "NONE", "PENDING", "RUNNING", "SUCCESS", "FAILED"])
    .optional(),
  metadataState: z.enum(["all", "missing", "complete"]).optional(),
  reviewStatus: z.enum(["updated-since-review"]).optional(),
  sortKey: z.enum(["createdAt", "updatedAt", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

// Mounted at /api
r.post("/urls/preview", validate({ body: previewUrlBody }), previewUrlHandler);
r.get("/urls/probe", validate({ query: probeUrlQuery }), probeUrlHandler);
r.get("/urls/:id/probe", probeUrlByIdHandler);
r.get("/urls", validate({ query: listUrlsQuery }), getUrlsHandler);
r.get("/urls/facets", validate({ query: listUrlsQuery }), getUrlFacetsHandler);
r.get(
  "/urls/queue-summary",
  validate({ query: listUrlsQuery }),
  getUrlReviewQueueSummaryHandler,
);

r.get("/urls/tagging/summary", getUrlTaggingSummaryHandler);
r.post(
  "/urls/tagging/retry-failed",
  validate({ body: retryFailedBody }),
  retryFailedUrlTaggingHandler,
);

r.get("/urls/:id", getUrlByIdHandler);
r.post("/urls/:id/visit", recordUrlVisitHandler);
r.post("/urls/:id/refresh-metadata", refreshUrlMetadataHandler);
r.get(
  "/urls/:id/snapshots",
  validate({ query: urlSnapshotsQuery }),
  getUrlSnapshotsHandler,
);
r.get(
  "/urls/:id/revisions",
  validate({ query: urlRevisionsQuery }),
  getUrlRevisionsHandler,
);
r.get("/urls/:id/discovered-documents", getUrlDiscoveredDocumentsHandler);
r.post(
  "/urls/:id/discover-documents",
  validate({ body: discoverDocumentsBody }),
  discoverUrlDocumentsHandler,
);
r.post("/urls/exists", validate({ body: urlsExistsBody }), urlsExistHandler);
r.post("/urls", validate({ body: createUrlsBody }), createUrlsHandler);
r.delete("/urls/:id", deleteUrlByIdHandler);
r.delete("/urls", deleteUrlsBulkHandler);
r.patch("/urls/:id", updateUrlByIdHandler);

export default r;
