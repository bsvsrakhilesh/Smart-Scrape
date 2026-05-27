import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { ownerIdForRequest } from "../utils/requestOwner";
import {
  createCollectorPurpose,
  getCollectorPurpose,
  listCollectorPurposes,
  planCollectorPurpose,
  saveCollectorPurposeSelection,
  updateCollectorPurpose,
} from "../services/collectorPurpose.service";
import { resolveCollectorPurposeEvidenceScope } from "../services/collectorPurposeEvidence.service";

const r = Router();

const idParams = z.object({ id: z.string().trim().min(1) });
const purposeBody = z.object({
  title: z.string().trim().min(1).max(160),
  researchQuestion: z.string().trim().min(1).max(1500),
  jurisdiction: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  yearFrom: z.string().trim().max(10).optional().nullable(),
  yearTo: z.string().trim().max(10).optional().nullable(),
  sourcePreferences: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  targetActors: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  outputGoal: z.string().trim().max(500).optional().nullable(),
});
const selectionBody = z.object({
  searchId: z.string().trim().min(1).optional().nullable(),
  urls: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().trim().min(1).max(1000),
      snippet: z.string().max(4000).optional().nullable(),
    }),
  ).min(1).max(100),
});

r.get("/collector-purposes", async (req, res, next) => {
  try {
    res.json(await listCollectorPurposes(ownerIdForRequest(req)));
  } catch (error) {
    next(error);
  }
});

r.post(
  "/collector-purposes",
  validate({ body: purposeBody }),
  async (req, res, next) => {
    try {
      res.status(201).json(await createCollectorPurpose(ownerIdForRequest(req), req.body));
    } catch (error) {
      next(error);
    }
  },
);

r.get(
  "/collector-purposes/:id",
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json(await getCollectorPurpose(ownerIdForRequest(req), req.params.id));
    } catch (error) {
      next(error);
    }
  },
);

r.patch(
  "/collector-purposes/:id",
  validate({ params: idParams, body: purposeBody }),
  async (req, res, next) => {
    try {
      res.json(
        await updateCollectorPurpose(ownerIdForRequest(req), req.params.id, req.body),
      );
    } catch (error) {
      next(error);
    }
  },
);

r.post(
  "/collector-purposes/:id/plan",
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json(await planCollectorPurpose(ownerIdForRequest(req), req.params.id));
    } catch (error) {
      next(error);
    }
  },
);

r.post(
  "/collector-purposes/:id/save-selection",
  validate({ params: idParams, body: selectionBody }),
  async (req, res, next) => {
    try {
      res.status(201).json(
        await saveCollectorPurposeSelection({
          ownerId: ownerIdForRequest(req),
          purposeId: req.params.id,
          searchId: req.body.searchId,
          rows: req.body.urls,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

r.get(
  "/collector-purposes/:id/evidence-scope",
  validate({ params: idParams }),
  async (req, res, next) => {
    try {
      res.json(await resolveCollectorPurposeEvidenceScope(ownerIdForRequest(req), req.params.id));
    } catch (error) {
      next(error);
    }
  },
);

export default r;
