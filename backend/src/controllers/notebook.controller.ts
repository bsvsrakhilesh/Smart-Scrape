import { Request, Response, NextFunction } from "express";
import prisma from "../config/database";
import type {
  AuditLogStatus,
  AuditResourceType,
} from "../generated/prisma/client";
import {
  listNotebooks,
  createNotebook,
  getNotebook,
  updateNotebook,
  deleteNotebook,
  listSources,
  attachUrlSource,
  attachFileSource,
  deleteSource,
  createNote,
  updateNote,
  deleteNote,
  pickNotebookCitations,
  getSourceDiagnostics,
  retrySourceIngestion,
  retrySourceEmbedding,
  rebuildSourceEmbedding,
  runSourceOcr,
} from "../services/notebook.service";
import {
  createNotebookTemplateNote,
  listNotebookTemplates,
} from "../services/notebookTemplate.service";
import {
  runNotebookChat,
  listNotebookChatRuns,
} from "../services/notebookChat.service";
import { writeAuditLog } from "../services/audit.service";
import {
  buildActorAuditMetadata,
  buildAuditActorFields,
} from "../services/requestActor.service";

const firstParam = (v: unknown): string =>
  Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");

async function logAudit(
  req: Request,
  args: {
    action: string;
    resourceType: AuditResourceType;
    resourceId?: string | null;
    status?: AuditLogStatus;
    metadata?: any;
  },
) {
  try {
    await writeAuditLog(prisma, {
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId ?? null,
      status: args.status ?? "SUCCESS",
      requestId: (req as any).requestId ?? null,
      ...buildAuditActorFields(req),
      metadata: {
        ...(args.metadata ?? {}),
        ...buildActorAuditMetadata(req),
      },
    });
  } catch {
    // audit logging must never break primary flow
  }
}

export async function getNotebookTemplatesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await listNotebookTemplates());
  } catch (e) {
    next(e);
  }
}

export async function getNotebooksHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await listNotebooks());
  } catch (e) {
    next(e);
  }
}

export async function postNotebookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const data = await createNotebook(req.body || {});
    await logAudit(req, {
      action: "notebook.created",
      resourceType: "NOTEBOOK",
      resourceId: data.id,
      metadata: { title: data.title },
    });
    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function getNotebookDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const data = await getNotebook(notebookId);
    if (!data) return res.status(404).json({ message: "Notebook not found" });

    await logAudit(req, {
      action: "notebook.opened",
      resourceType: "NOTEBOOK",
      resourceId: notebookId,
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function patchNotebookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const data = await updateNotebook(notebookId, req.body || {});
    await logAudit(req, {
      action: "notebook.updated",
      resourceType: "NOTEBOOK",
      resourceId: notebookId,
      metadata: {
        title: req.body?.title ?? null,
        descriptionUpdated: req.body?.description !== undefined,
      },
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteNotebookHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const ok = await deleteNotebook(notebookId);
    if (!ok) return res.status(404).json({ message: "Notebook not found" });

    await logAudit(req, {
      action: "notebook.deleted",
      resourceType: "NOTEBOOK",
      resourceId: notebookId,
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export async function getNotebookSourcesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await listSources(firstParam(req.params.id)));
  } catch (e) {
    next(e);
  }
}

export async function postNotebookSourceUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const data = await attachUrlSource(notebookId, Number(req.body?.urlId));

    await logAudit(req, {
      action: "notebook.source.url_attached",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: data?.id ?? null,
      metadata: {
        notebookId,
        kind: "URL",
        urlId: Number(req.body?.urlId),
      },
    });

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookSourceFileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const fileId = String(req.body?.fileId);
    const data = await attachFileSource(notebookId, fileId);

    await logAudit(req, {
      action: "notebook.source.file_attached",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: data?.id ?? null,
      metadata: {
        notebookId,
        kind: "FILE",
        fileId,
      },
    });

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteNotebookSourceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const sourceId = firstParam(req.params.sourceId);

    await deleteSource(notebookId, sourceId);

    await logAudit(req, {
      action: "notebook.source.deleted",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: sourceId,
      metadata: { notebookId },
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
}

export async function postNotebookSourceRetryIngestionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const sourceId = firstParam(req.params.sourceId);
    const data = await retrySourceIngestion(notebookId, sourceId);

    await logAudit(req, {
      action: "notebook.source.retry_ingestion",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: sourceId,
      metadata: { notebookId },
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookSourceRunOcrHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const sourceId = firstParam(req.params.sourceId);
    const data = await runSourceOcr(notebookId, sourceId);

    await logAudit(req, {
      action: "notebook.source.run_ocr",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: sourceId,
      metadata: { notebookId },
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookSourceRetryEmbeddingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const sourceId = firstParam(req.params.sourceId);
    const data = await retrySourceEmbedding(notebookId, sourceId);

    await logAudit(req, {
      action: "notebook.source.retry_embedding",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: sourceId,
      metadata: { notebookId },
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookSourceRebuildEmbeddingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const sourceId = firstParam(req.params.sourceId);
    const data = await rebuildSourceEmbedding(notebookId, sourceId);

    await logAudit(req, {
      action: "notebook.source.rebuild_embedding",
      resourceType: "NOTEBOOK_SOURCE",
      resourceId: sourceId,
      metadata: { notebookId },
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getNotebookSourceDiagnosticsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const maxChars = req.query?.maxChars ? Number(req.query.maxChars) : 20000;
    const data = await getSourceDiagnostics(
      firstParam(req.params.id),
      firstParam(req.params.sourceId),
      Number.isFinite(maxChars) ? maxChars : 20000,
    );
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getNotebookChatHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const limit = req.query?.limit ? Number(req.query.limit) : 50;

    const items = await listNotebookChatRuns({
      notebookId: firstParam(req.params.id),
      limit: Number.isFinite(limit) ? limit : 50,
    });

    res.json(items);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookChatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);

    const out = await runNotebookChat({
      notebookId,
      message: req.body.message,
      history: Array.isArray(req.body?.history) ? req.body.history : undefined,
      sourceIds: Array.isArray(req.body?.sourceIds)
        ? req.body.sourceIds
        : undefined,
      answerMode:
        req.body?.answerMode === "draft" ||
        req.body?.answerMode === "evidence" ||
        req.body?.answerMode === "briefing"
          ? req.body.answerMode
          : undefined,
      requestId: (req as any).requestId ?? null,
      createdBy: null,
    });

    await logAudit(req, {
      action: "notebook.chat.executed",
      resourceType: "CHAT_RUN",
      resourceId: out.runId ?? null,
      metadata: {
        notebookId,
        answerMode: out.mode,
        sourceCount: Array.isArray(req.body?.sourceIds)
          ? req.body.sourceIds.length
          : null,
        model: out.model ?? null,
      },
    });

    res.json(out);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookTemplateNoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);

    const data = await createNotebookTemplateNote({
      notebookId,
      templateKey: String(req.body?.templateKey || "") as any,
      documentId:
        typeof req.body?.documentId === "string"
          ? req.body.documentId
          : undefined,
      issueId:
        typeof req.body?.issueId === "string" ? req.body.issueId : undefined,
      agencyId:
        typeof req.body?.agencyId === "string" ? req.body.agencyId : undefined,
      relationType:
        typeof req.body?.relationType === "string"
          ? req.body.relationType
          : undefined,
      titleOverride:
        typeof req.body?.titleOverride === "string"
          ? req.body.titleOverride
          : undefined,
    });

    await logAudit(req, {
      action: "notebook.template_note.created",
      resourceType: "NOTE",
      resourceId: data.note.id,
      metadata: {
        notebookId,
        templateKey: req.body?.templateKey ?? null,
        documentId: req.body?.documentId ?? null,
        issueId: req.body?.issueId ?? null,
        agencyId: req.body?.agencyId ?? null,
        relationType: req.body?.relationType ?? null,
      },
    });

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function postNotebookNoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const data = await createNote(notebookId, req.body || {});

    await logAudit(req, {
      action: "notebook.note.created",
      resourceType: "NOTE",
      resourceId: data.id,
      metadata: {
        notebookId,
        title: data.title ?? null,
      },
    });

    res.status(201).json(data);
  } catch (e) {
    next(e);
  }
}

export async function patchNotebookNoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const noteId = firstParam(req.params.noteId);
    const data = await updateNote(notebookId, noteId, req.body || {});

    await logAudit(req, {
      action: "notebook.note.updated",
      resourceType: "NOTE",
      resourceId: noteId,
      metadata: { notebookId },
    });

    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function deleteNotebookNoteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const notebookId = firstParam(req.params.id);
    const noteId = firstParam(req.params.noteId);
    const ok = await deleteNote(notebookId, noteId);
    if (!ok) return res.status(404).json({ message: "Note not found" });

    await logAudit(req, {
      action: "notebook.note.deleted",
      resourceType: "NOTE",
      resourceId: noteId,
      metadata: { notebookId },
    });

    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
