import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import {
  getAgenciesDirectoryHandler,
  getAgencyLandscapeHandler,
  getDocumentGovernanceHandler,
  getIssueCaseWorkspaceHandler,
  getIssueRelationsHandler,
  getIssueTimelineHandler,
  getIssuesDirectoryHandler,
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

const issueCaseWorkspaceQuery = z.object({
  actorAgencyId: z.string().min(1).optional(),
  relationType: relationTypeSchema.optional(),
  dateFrom: ymd.optional(),
  dateTo: ymd.optional(),
  limit: z.coerce.number().int().positive().max(300).optional(),
});

const agencyLandscapeQuery = z.object({
  limit: z.coerce.number().int().positive().max(250).optional(),
});

const issuesDirectoryQuery = z.object({
  q: z.string().trim().min(1).optional(),
  kind: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  agencyId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const agenciesDirectoryQuery = z.object({
  q: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  jurisdiction: z.string().trim().min(1).optional(),
  issueId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

r.get(
  "/documents/:id/governance",
  validate({ params: idParams, query: docGovernanceQuery }),
  getDocumentGovernanceHandler,
);

r.get(
  "/issues",
  validate({ query: issuesDirectoryQuery }),
  getIssuesDirectoryHandler,
);

r.get(
  "/agencies",
  validate({ query: agenciesDirectoryQuery }),
  getAgenciesDirectoryHandler,
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
  "/issues/:id/case-workspace",
  validate({ params: idParams, query: issueCaseWorkspaceQuery }),
  getIssueCaseWorkspaceHandler,
);

r.get(
  "/agencies/:id/landscape",
  validate({ params: idParams, query: agencyLandscapeQuery }),
  getAgencyLandscapeHandler,
);

export default r;
