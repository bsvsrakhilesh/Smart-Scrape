import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { ownerIdForRequest } from "../utils/requestOwner";
import {
  cancelSavedUrlOperation,
  createSavedUrlOperation,
  getSavedUrlOperation,
  listSavedUrlOperations,
  retryFailedSavedUrlOperation,
  SAVED_URL_OPERATION_TYPES,
} from "../services/savedUrlOperation.service";

const r = Router();

const operationTypeSchema = z.enum(SAVED_URL_OPERATION_TYPES);

const operationOptionsSchema = z
  .object({
    folderId: z.string().min(1).nullable().optional(),
    collectionId: z.string().min(1).optional(),
    collectionMode: z.enum(["add", "move"]).optional(),
    accessMode: z.enum(["public", "institutional"]).optional(),
  })
  .default({});

const createOperationBody = z.object({
  type: operationTypeSchema,
  urlIds: z.array(z.number().int().positive()).min(1).max(1000),
  options: operationOptionsSchema.optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

r.get(
  "/saved-url-operations",
  validate({ query: listQuery }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const rows = await listSavedUrlOperations(
        ownerId,
        Number(req.query.limit ?? 20),
      );
      res.json({ items: rows });
    } catch (e) {
      next(e);
    }
  },
);

r.post(
  "/saved-url-operations",
  validate({ body: createOperationBody }),
  async (req, res, next) => {
    try {
      const ownerId = ownerIdForRequest(req);
      const run = await createSavedUrlOperation({
        ownerId,
        type: req.body.type,
        urlIds: req.body.urlIds,
        options: req.body.options ?? {},
      });
      res.status(201).json(run);
    } catch (e) {
      next(e);
    }
  },
);

r.get("/saved-url-operations/:id", async (req, res, next) => {
  try {
    const ownerId = ownerIdForRequest(req);
    const run = await getSavedUrlOperation(ownerId, String(req.params.id));
    res.json(run);
  } catch (e) {
    next(e);
  }
});

r.post("/saved-url-operations/:id/cancel", async (req, res, next) => {
  try {
    const ownerId = ownerIdForRequest(req);
    const run = await cancelSavedUrlOperation(ownerId, String(req.params.id));
    res.json(run);
  } catch (e) {
    next(e);
  }
});

r.post("/saved-url-operations/:id/retry-failed", async (req, res, next) => {
  try {
    const ownerId = ownerIdForRequest(req);
    const run = await retryFailedSavedUrlOperation(
      ownerId,
      String(req.params.id),
    );
    res.status(201).json(run);
  } catch (e) {
    next(e);
  }
});

export default r;
