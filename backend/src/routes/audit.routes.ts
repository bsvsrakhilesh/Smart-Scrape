import { Router } from "express";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { getAuditLogsHandler } from "../controllers/audit.controller";

const r = Router();

const auditResourceTypeSchema = z.enum([
  "DOCUMENT",
  "FILE",
  "URL",
  "NOTEBOOK",
  "NOTE",
  "NOTEBOOK_SOURCE",
  "ISSUE",
  "AGENCY",
  "CHAT_RUN",
  "SYSTEM",
]);

r.get(
  "/audit/logs",
  validate({
    query: z
      .object({
        resourceType: auditResourceTypeSchema.optional(),
        resourceId: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .optional(),
  }),
  getAuditLogsHandler,
);

export default r;
