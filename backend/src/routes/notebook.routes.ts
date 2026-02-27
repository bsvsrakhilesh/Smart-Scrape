import { Router } from "express";
import {
  getNotebooksHandler,
  postNotebookHandler,
  getNotebookDetailHandler,
  patchNotebookHandler,
  deleteNotebookHandler,
  getNotebookSourcesHandler,
  postNotebookSourceUrlHandler,
  postNotebookSourceFileHandler,
  deleteNotebookSourceHandler,
  postNotebookChatHandler,
  postNotebookNoteHandler,
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

const r = Router();

r.get("/notebooks", getNotebooksHandler);

r.post(
  "/notebooks",
  validate({
    body: z.object({
      title: z.string().min(1),
      description: z.string().max(2000).optional(),
    }),
  }),
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
  patchNotebookHandler,
);

r.delete(
  "/notebooks/:id",
  validate({ params: z.object({ id: z.string().min(1) }) }),
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
  postNotebookSourceFileHandler,
);

r.delete(
  "/notebooks/:id/sources/:sourceId",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
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
  postNotebookSourceRetryIngestionHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/run-ocr",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  postNotebookSourceRunOcrHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/retry-embedding",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  postNotebookSourceRetryEmbeddingHandler,
);

r.post(
  "/notebooks/:id/sources/:sourceId/rebuild-embedding",
  validate({
    params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }),
  }),
  postNotebookSourceRebuildEmbeddingHandler,
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
  "/notebooks/:id/notes",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional().default(""),
      citations: z.any().optional(),
    }),
  }),
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
  patchNotebookNoteHandler,
);

r.delete(
  "/notebooks/:id/notes/:noteId",
  validate({
    params: z.object({ id: z.string().min(1), noteId: z.string().min(1) }),
  }),
  deleteNotebookNoteHandler,
);

export default r;
