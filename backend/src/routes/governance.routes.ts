import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import {
  getAgencyLandscapeHandler,
  getDocumentGovernanceHandler,
  getIssueRelationsHandler,
  getIssueTimelineHandler,
} from "../controllers/governance.controller";

const r = Router();

const idParams = z.object({
  id: z.string().min(1),
});

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date format YYYY-MM-DD");

const relationTypeSchema = z.enum([
  "contradiction",
  "tension",
  "override",
  "reinforcement",
  "alignment",
  "duplication",
  "reference",
  "supersedes",
  "other",
]);

const docGovernanceQuery = z.object({
  limit: z.coerce.number().int().positive().max(250).optional(),
});

const issueTimelineQuery = z.object({
  actorAgencyId: z.string().min(1).optional(),
  dateFrom: ymd.optional(),
  dateTo: ymd.optional(),
  limit: z.coerce.number().int().positive().max(300).optional(),
});

const issueRelationsQuery = z.object({
  relationType: relationTypeSchema.optional(),
  limit: z.coerce.number().int().positive().max(300).optional(),
});

const agencyLandscapeQuery = z.object({
  limit: z.coerce.number().int().positive().max(250).optional(),
});

r.get(
  "/documents/:id/governance",
  validate({ params: idParams, query: docGovernanceQuery }),
  getDocumentGovernanceHandler,
);

r.get(
  "/issues/:id/timeline",
  validate({ params: idParams, query: issueTimelineQuery }),
  getIssueTimelineHandler,
);

r.get(
  "/issues/:id/relations",
  validate({ params: idParams, query: issueRelationsQuery }),
  getIssueRelationsHandler,
);

r.get(
  "/agencies/:id/landscape",
  validate({ params: idParams, query: agencyLandscapeQuery }),
  getAgencyLandscapeHandler,
);

export default r;
