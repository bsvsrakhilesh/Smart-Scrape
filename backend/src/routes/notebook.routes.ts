import { Router } from "express";
import {
  getNotebookTemplatesHandler,
  getNotebooksHandler,
  postNotebookHandler,
  getNotebookDetailHandler,
  patchNotebookHandler,
  deleteNotebookHandler,
  getNotebookSourcesHandler,
  postNotebookSourceUrlHandler,
  postNotebookSourceFileHandler,
  deleteNotebookSourceHandler,
  getNotebookChatHistoryHandler,
  postNotebookChatStreamHandler,
  postNotebookChatHandler,
  postNotebookNoteHandler,
  postNotebookTemplateNoteHandler,
  patchNotebookNoteHandler,
  deleteNotebookNoteHandler,
  postNotebookSourceRetryIngestionHandler,
  postNotebookSourceRetryEmbeddingHandler,
  postNotebookSourceRebuildEmbeddingHandler,
  getNotebookSourceDiagnosticsHandler,
  postNotebookSourceRunOcrHandler,
} from "../controllers/notebook.controller";
import { z } from "zod";
import { validate } from "../middlewares/validate";
import { requireRole } from "../middlewares/authContext";

const notebookTemplateKeyEnum = z.enum([
  "governance_brief",
  "contradiction_brief",
  "agency_comparison_summary",
  "issue_landscape_summary",
  "case_timeline_note",
  "accountability_coordination_gap_note",
  "question_review_brief",
]);

const r = Router();

const analystOrAbove = requireRole(["analyst", "editor", "admin"]);
const editorOrAbove = requireRole(["editor", "admin"]);

r.use("/notebook-templates", analystOrAbove);
r.use("/notebooks", analystOrAbove);

r.get("/notebook-templates", getNotebookTemplatesHandler);
r.get("/notebooks", getNotebooksHandler);

r.post(
  "/notebooks",
  validate({
    body: z.object({
      title: z.string().min(1),
      description: z.string().max(2000).optional(),
    }),
  }),
  editorOrAbove,
  postNotebookHandler,
);

r.get(
  "/notebooks/:id",
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getNotebookDetailHandler,
);

r.patch(
  "/notebooks/:id",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      title: z.string().min(1).optional(),
      description: z.string().max(2000).optional(),
    }),
  }),
  editorOrAbove,
  patchNotebookHandler,
);

r.delete(
  "/notebooks/:id",
  validate({ params: z.object({ id: z.string().min(1) }) }),
  editorOrAbove,
  deleteNotebookHandler,
);

r.get(
  "/notebooks/:id/sources",
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getNotebookSourcesHandler,
);

r.post(
  "/notebooks/:id/sources/url",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      urlId: z.coerce.number().int().positive(),
      title: z.string().min(1).optional(),
    }),
  }),
  editorOrAbove,
  postNotebookSourceUrlHandler,
);

r.post(
  "/notebooks/:id/sources/file",
  validate({
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ folderId: z.string().optional() }).optional(),
    body: z.object({
      fileId: z.string().min(1),
    }),
  }),
  editorOrAbove,
  postNotebookSourceFileHandler,
);

r.delete(
  "/notebooks/:id/sources/:sourceId",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  editorOrAbove,
  deleteNotebookSourceHandler,
);

r.get(
  "/notebooks/:id/sources/:sourceId/diagnostics",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
    query: z
      .object({
        maxChars: z.coerce.number().int().min(1000).max(200000).optional(),
      })
      .optional(),
  }),
  getNotebookSourceDiagnosticsHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/retry-ingestion",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  editorOrAbove,
  postNotebookSourceRetryIngestionHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/run-ocr",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
    body: z
      .object({
        langs: z.string().min(1).max(80).optional(),
        pages: z.string().min(1).max(120).optional(),
        engine: z.enum(["auto", "ocrmypdf", "tesseract"]).optional(),
        deskew: z.boolean().optional(),
        rotatePages: z.boolean().optional(),
        clean: z.boolean().optional(),
        fallback: z.boolean().optional(),
      })
      .optional(),
  }),
  editorOrAbove,
  postNotebookSourceRunOcrHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/retry-embedding",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  editorOrAbove,
  postNotebookSourceRetryEmbeddingHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/rebuild-embedding",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  editorOrAbove,
  postNotebookSourceRebuildEmbeddingHandler,
);

r.get(
  "/notebooks/:id/chat/history",
  validate({
    params: z.object({ id: z.string().min(1) }),
    query: z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .optional(),
  }),
  getNotebookChatHistoryHandler,
);

r.post(
  "/notebooks/:id/chat/stream",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      message: z.string().min(1),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1),
          }),
        )
        .optional(),
      sourceIds: z.array(z.string().min(1)).optional(),
      answerMode: z.enum(["draft", "evidence", "briefing"]).optional(),
    }),
  }),
  postNotebookChatStreamHandler,
);

r.post(
  "/notebooks/:id/chat",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      message: z.string().min(1),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1),
          }),
        )
        .optional(),
      sourceIds: z.array(z.string().min(1)).optional(),
      answerMode: z.enum(["draft", "evidence", "briefing"]).optional(),
    }),
  }),
  postNotebookChatHandler,
);

r.post(
  "/notebooks/:id/template-notes",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      templateKey: notebookTemplateKeyEnum,
      documentId: z.string().min(1).optional(),
      issueId: z.string().min(1).optional(),
      agencyId: z.string().min(1).optional(),
      relationType: z.string().min(1).optional(),
      titleOverride: z.string().max(240).optional(),
    }),
  }),
  editorOrAbove,
  postNotebookTemplateNoteHandler,
);

r.post(
  "/notebooks/:id/notes",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional().default(""),
      citations: z.any().optional(),
    }),
  }),
  editorOrAbove,
  postNotebookNoteHandler,
);

r.patch(
  "/notebooks/:id/notes/:noteId",
  validate({
    params: z.object({ id: z.string().min(1), noteId: z.string().min(1) }),
    body: z
      .object({
        title: z.string().optional(),
        content: z.string().optional(),
        citations: z.any().optional(),
      })
      .refine(
        (v) =>
          v.title !== undefined ||
          v.content !== undefined ||
          v.citations !== undefined,
        { message: "At least one field (title/content/citations) is required" },
      ),
  }),
  editorOrAbove,
  patchNotebookNoteHandler,
);

r.delete(
  "/notebooks/:id/notes/:noteId",
  validate({
    params: z.object({ id: z.string().min(1), noteId: z.string().min(1) }),
  }),
  editorOrAbove,
  deleteNotebookNoteHandler,
);

export default r;
