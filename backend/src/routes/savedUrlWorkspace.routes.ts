import { Router } from "express";
import { z } from "zod";
import prisma from "../config/database";
import { validate } from "../middlewares/validate";
import { ownerIdForRequest } from "../utils/requestOwner";
import {
  getUrlFacets,
  getUrlReviewQueueSummary,
  getUrlsPaged,
  getUrlTaggingSummary,
  type GetPagedUrlsOpts,
} from "../services/url.service";

const r = Router();

const workspaceQuery = z.object({
  q: z.string().optional(),
  year: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  domains: z.union([z.string(), z.array(z.string())]).optional(),
  visibility: z.enum(["all", "public", "private"]).optional(),
  collectionId: z.string().min(1).optional(),
  collectorPurposeId: z.string().min(1).optional(),
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
  queueId: z
    .enum([
      "all",
      "never-captured",
      "stale-capture",
      "ai-failed",
      "metadata-missing",
      "updated-since-review",
    ])
    .optional(),
  sortKey: z.enum(["createdAt", "updatedAt", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

function parseMulti(value: unknown): string[] | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value : [value];
  const out = raw
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

function buildOpts(query: any, ownerId: string): GetPagedUrlsOpts {
  const queueId = query.queueId || "all";

  const snapshotStatus =
    queueId === "never-captured"
      ? "missing"
      : queueId === "stale-capture"
        ? "stale"
        : query.snapshotStatus;

  const taggingStatus =
    queueId === "ai-failed" ? "FAILED" : query.taggingStatus;

  const metadataState =
    queueId === "metadata-missing" ? "missing" : query.metadataState;

  return {
    q: typeof query.q === "string" ? query.q : undefined,
    year: typeof query.year === "string" ? query.year : undefined,
    tags: parseMulti(query.tags),
    domains: parseMulti(query.domains),
    collectionId:
      typeof query.collectionId === "string" && query.collectionId.trim()
        ? query.collectionId
        : undefined,
    collectorPurposeId:
      typeof query.collectorPurposeId === "string" && query.collectorPurposeId.trim()
        ? query.collectorPurposeId
        : undefined,
    favoritesOnly: query.favoritesOnly === true || query.favoritesOnly === "true",
    visibility: query.visibility,
    dateFrom: typeof query.dateFrom === "string" ? query.dateFrom : undefined,
    dateTo: typeof query.dateTo === "string" ? query.dateTo : undefined,
    publishedFrom:
      typeof query.publishedFrom === "string" ? query.publishedFrom : undefined,
    publishedTo:
      typeof query.publishedTo === "string" ? query.publishedTo : undefined,
    snapshotStatus,
    taggingStatus,
    metadataState,
    reviewStatus:
      queueId === "updated-since-review" ? "updated-since-review" : undefined,
    ownerId,
    sortKey: query.sortKey ?? "createdAt",
    sortOrder: query.sortOrder ?? "desc",
    page: Number(query.page ?? 1),
    pageSize: Number(query.pageSize ?? 50),
  };
}

r.get(
  "/saved-url-workspace",
  validate({ query: workspaceQuery }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const opts = buildOpts(req.query, ownerId);
      const queueSummaryOpts = {
        ...opts,
        page: undefined,
        pageSize: undefined,
        reviewStatus: undefined,
        snapshotStatus:
          req.query.snapshotStatus === "all"
            ? undefined
            : (req.query.snapshotStatus as any),
        taggingStatus:
          req.query.taggingStatus === "all"
            ? undefined
            : (req.query.taggingStatus as any),
        metadataState:
          req.query.metadataState === "all"
            ? undefined
            : (req.query.metadataState as any),
      };

      const [
        urls,
        facets,
        queueSummary,
        collections,
        savedSearches,
        taggingSummary,
        libraryTotal,
      ] = await Promise.all([
        getUrlsPaged(opts),
        getUrlFacets(opts),
        getUrlReviewQueueSummary(queueSummaryOpts),
        prisma.collection.findMany({
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { urls: true } } },
        }),
        prisma.savedUrlSearchPreset.findMany({
          where: { ownerId },
          orderBy: { updatedAt: "desc" },
        }),
        getUrlTaggingSummary(),
        prisma.url.count(),
      ]);

      return res.json({
        urls,
        facets,
        queueSummary,
        collections: collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          description: collection.description,
          ownerId: collection.ownerId,
          visibility: collection.visibility,
          createdAt: collection.createdAt,
          updatedAt: collection.updatedAt,
          urlCount: collection._count.urls,
        })),
        savedSearches,
        taggingSummary,
        libraryTotal,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default r;
