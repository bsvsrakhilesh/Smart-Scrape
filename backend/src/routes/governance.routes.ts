import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { requireRole } from "../middlewares/authContext";
import {
  getAgenciesDirectoryHandler,
  getAgencyLandscapeHandler,
  getDocumentGovernanceHandler,
  getIssueCaseWorkspaceHandler,
  getIssueRelationsHandler,
  getIssueTimelineHandler,
  getIssuesDirectoryHandler,
  listGovernanceAnswerSessionsHandler,
  postGovernanceAnswerSessionHandler,
  getGovernanceAnswerSessionHandler,
  postGovernanceWorkspaceAnswerEvaluateHandler,
  postGovernanceWorkspaceAnswerFeedbackHandler,
  postGovernanceWorkspaceAnswerHandler,
  postGovernanceWorkspaceAnswerStreamHandler,
  postGovernanceWorkspaceQueryHandler,
  postGovernanceWorkspaceRetrieveHandler,
} from "../controllers/governance.controller";

const r = Router();

const analystOrAbove = requireRole(["analyst", "editor", "admin"]);

r.use(analystOrAbove);

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

const sourceTypeSchema = z.enum(["URL", "FILE"]);

const timelineGroupBySchema = z.enum(["none", "actor", "sourceType"]);

const docGovernanceQuery = z.object({
  limit: z.coerce.number().int().positive().max(250).optional(),
});

const issueTimelineQuery = z.object({
  actorAgencyId: z.string().min(1).optional(),
  dateFrom: ymd.optional(),
  dateTo: ymd.optional(),
  sourceType: sourceTypeSchema.optional(),
  groupBy: timelineGroupBySchema.optional(),
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


const workspaceAnswerHistoryItem = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
});

const nullableOptionalString = (min = 1, max?: number) => {
  let schema = z.string().trim().min(min);
  if (typeof max === "number") schema = schema.max(max);
  return z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    schema.optional(),
  );
};

const nullableOptionalQuestion = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().trim().max(4000).optional(),
);

const workspaceOfficerFilters = z
  .object({
    questionType: nullableOptionalString(1, 120),
    issueHint: nullableOptionalString(1, 240),
    jurisdiction: nullableOptionalString(1, 160),
    timeRange: nullableOptionalString(1, 160),
    pollutants: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
    agencies: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
  })
  .optional();

const workspaceAnswerSessionBody = z.object({
  sessionId: nullableOptionalString(),
  question: nullableOptionalQuestion,
  anchorDocumentIds: z.array(z.string().trim().min(1)).max(25).optional(),
  anchorUrlIds: z.array(z.coerce.number().int().positive()).max(25).optional(),
  sourceScope: z.enum(["all", "files", "urls", "mixed"]).optional(),
  workflowMode: z
    .enum(["auto", "landscape", "case_trace", "question_review"])
    .optional(),
  officerFilters: workspaceOfficerFilters,
  selectedIssueId: nullableOptionalString(),
  selectedAgencyId: nullableOptionalString(),
  collectorPurposeId: nullableOptionalString(),
  selectedDocumentIds: z.array(z.string().trim().min(1)).max(25).optional(),
});

const workspaceAnswerSessionListQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  q: nullableOptionalString(1, 240),
  collectorPurposeId: nullableOptionalString(),
  sourceScope: z.enum(["all", "files", "urls", "mixed"]).optional(),
});

const workspaceAnswerBody = workspaceAnswerSessionBody.extend({
  question: z.string().trim().min(1).max(4000),
  history: z.array(workspaceAnswerHistoryItem).max(24).optional(),
  previousRunId: nullableOptionalString(),
  previousResponseId: nullableOptionalString(),
  limit: z.coerce.number().int().positive().max(12).optional(),
  deepReview: z.boolean().optional(),
});

const workspaceAnswerEvaluateBody = z.object({
  runId: z.string().trim().min(1),
});

const workspaceAnswerFeedbackBody = z.object({
  runId: z.string().trim().min(1),
  rating: z.enum([
    "useful",
    "wrong_citation",
    "missing_source",
    "hallucinated_claim",
    "needs_deeper_review",
  ]),
  target: z.enum(["answer", "claim", "citation", "evidence"]).optional(),
  claim: nullableOptionalString(1, 900),
  evidenceId: nullableOptionalString(1, 240),
  citationQuote: nullableOptionalString(1, 600),
  comment: nullableOptionalString(1, 1200),
});

const workspaceQueryBody = z.object({
  question: z.string().trim().max(4000).optional(),
  anchorDocumentIds: z.array(z.string().trim().min(1)).max(25).optional(),
  anchorUrlIds: z.array(z.coerce.number().int().positive()).max(25).optional(),
  sourceScope: z.enum(["all", "files", "urls", "mixed"]).optional(),
  workflowMode: z
    .enum(["auto", "landscape", "case_trace", "question_review"])
    .optional(),
  limit: z.coerce.number().int().positive().max(12).optional(),
  collectorPurposeId: nullableOptionalString(),
  officerFilters: workspaceOfficerFilters,
});


r.post(
  "/governance/workspace/answer-sessions",
  validate({ body: workspaceAnswerSessionBody }),
  postGovernanceAnswerSessionHandler,
);

r.get(
  "/governance/workspace/answer-sessions",
  validate({ query: workspaceAnswerSessionListQuery }),
  listGovernanceAnswerSessionsHandler,
);

r.get(
  "/governance/workspace/answer-sessions/:id",
  validate({ params: idParams }),
  getGovernanceAnswerSessionHandler,
);

r.post(
  "/governance/workspace/answer",
  validate({ body: workspaceAnswerBody }),
  postGovernanceWorkspaceAnswerHandler,
);

r.post(
  "/governance/workspace/answer/stream",
  validate({ body: workspaceAnswerBody }),
  postGovernanceWorkspaceAnswerStreamHandler,
);

r.post(
  "/governance/workspace/answer/evaluate",
  validate({ body: workspaceAnswerEvaluateBody }),
  postGovernanceWorkspaceAnswerEvaluateHandler,
);

r.post(
  "/governance/workspace/answer/feedback",
  validate({ body: workspaceAnswerFeedbackBody }),
  postGovernanceWorkspaceAnswerFeedbackHandler,
);

r.post(
  "/governance/workspace/retrieve",
  validate({ body: workspaceQueryBody }),
  postGovernanceWorkspaceRetrieveHandler,
);

r.post(
  "/governance/workspace/query",
  validate({ body: workspaceQueryBody }),
  postGovernanceWorkspaceQueryHandler,
);

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
