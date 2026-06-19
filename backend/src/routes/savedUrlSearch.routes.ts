import { Router } from "express";
import { z } from "zod";
import prisma from "../config/database";
import { validate } from "../middlewares/validate";

const r = Router();

const filterSchema = z.object({
  query: z.string(),
  domains: z.array(z.string()),
  tags: z.array(z.string()),
  visibility: z.enum(["all", "public", "private"]),

  // Saved URL created-date filters.
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),

  // Saved URL published-date filters.
  // These must be preserved when saving/loading saved searches.
  publishedFrom: z.string().optional(),
  publishedTo: z.string().optional(),

  favoritesOnly: z.boolean(),
  collectorPurposeId: z.string().min(1).nullable().optional(),
  snapshotStatus: z.enum(["all", "missing", "stale", "fresh"]).optional(),
  taggingStatus: z
    .enum(["all", "NONE", "PENDING", "RUNNING", "SUCCESS", "FAILED"])
    .optional(),
  metadataState: z.enum(["all", "missing", "complete"]).optional(),
});

const savedSearchBody = z.object({
  name: z.string().min(1).max(100),
  filter: filterSchema,
  sortKey: z.enum(["createdAt", "updatedAt", "title"]),
  sortOrder: z.enum(["asc", "desc"]),
  year: z.string().min(1),
  selectedCollectionId: z.string().min(1).nullable().optional(),
  queueId: z.enum([
    "all",
    "never-captured",
    "stale-capture",
    "ai-failed",
    "metadata-missing",
    "updated-since-review",
  ]),
});

function ownerIdForRequest(req: any): string {
  return req.auth?.userId ?? "anonymous";
}

// GET /api/saved-url-searches
r.get("/saved-url-searches", async (req, res, next) => {
  try {
    const ownerId = ownerIdForRequest(req);

    const rows = await prisma.savedUrlSearchPreset.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
    });

    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/saved-url-searches
r.post(
  "/saved-url-searches",
  validate({ body: savedSearchBody }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const body = req.body as z.infer<typeof savedSearchBody>;
      const trimmedName = body.name.trim();

      const count = await prisma.savedUrlSearchPreset.count({
        where: { ownerId },
      });

      if (count >= 10) {
        return res.status(400).json({
          code: "SAVED_SEARCH_LIMIT",
          message: "You can store up to 10 saved searches.",
        });
      }

      const duplicate = await prisma.savedUrlSearchPreset.findFirst({
        where: {
          ownerId,
          name: { equals: trimmedName, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (duplicate) {
        return res.status(409).json({
          code: "SAVED_SEARCH_EXISTS",
          message: `A saved search named "${trimmedName}" already exists.`,
        });
      }

      const created = await prisma.savedUrlSearchPreset.create({
        data: {
          ownerId,
          name: trimmedName,
          filter: body.filter,
          sortKey: body.sortKey,
          sortOrder: body.sortOrder,
          year: body.year,
          selectedCollectionId: body.selectedCollectionId ?? null,
          queueId: body.queueId,
        },
      });

      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

// PATCH /api/saved-url-searches/:id
r.patch(
  "/saved-url-searches/:id",
  validate({ body: savedSearchBody }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const id = String(req.params.id);
      const body = req.body as z.infer<typeof savedSearchBody>;
      const trimmedName = body.name.trim();

      const existing = await prisma.savedUrlSearchPreset.findFirst({
        where: { id, ownerId },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({
          code: "SAVED_SEARCH_NOT_FOUND",
          message: "Saved search not found.",
        });
      }

      const duplicate = await prisma.savedUrlSearchPreset.findFirst({
        where: {
          ownerId,
          id: { not: id },
          name: { equals: trimmedName, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (duplicate) {
        return res.status(409).json({
          code: "SAVED_SEARCH_EXISTS",
          message: `A saved search named "${trimmedName}" already exists.`,
        });
      }

      const updated = await prisma.savedUrlSearchPreset.update({
        where: { id },
        data: {
          name: trimmedName,
          filter: body.filter,
          sortKey: body.sortKey,
          sortOrder: body.sortOrder,
          year: body.year,
          selectedCollectionId: body.selectedCollectionId ?? null,
          queueId: body.queueId,
        },
      });

      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// DELETE /api/saved-url-searches/:id
r.delete("/saved-url-searches/:id", async (req, res, next) => {
  try {
    const ownerId = ownerIdForRequest(req);
    const id = String(req.params.id);

    const existing = await prisma.savedUrlSearchPreset.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({
        code: "SAVED_SEARCH_NOT_FOUND",
        message: "Saved search not found.",
      });
    }

    await prisma.savedUrlSearchPreset.delete({
      where: { id },
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default r;
