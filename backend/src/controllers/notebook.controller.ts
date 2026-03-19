import { Request, Response, NextFunction } from "express";
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

import { runNotebookChat } from "../services/notebookChat.service";

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
    res.status(201).json(await createNotebook(req.body || {}));
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
    const data = await getNotebook(req.params.id);
    if (!data) return res.status(404).json({ message: "Notebook not found" });
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
    res.json(await updateNotebook(req.params.id, req.body || {}));
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
    const ok = await deleteNotebook(req.params.id);
    if (!ok) return res.status(404).json({ message: "Notebook not found" });
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
    res.json(await listSources(req.params.id));
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
    res
      .status(201)
      .json(await attachUrlSource(req.params.id, Number(req.body?.urlId)));
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
    res
      .status(201)
      .json(await attachFileSource(req.params.id, String(req.body?.fileId)));
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
    await deleteSource(req.params.id, req.params.sourceId);
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
    const data = await retrySourceIngestion(req.params.id, req.params.sourceId);
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
    const data = await runSourceOcr(req.params.id, req.params.sourceId);
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
    const data = await retrySourceEmbedding(req.params.id, req.params.sourceId);
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
    const data = await rebuildSourceEmbedding(
      req.params.id,
      req.params.sourceId,
    );
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
      req.params.id,
      req.params.sourceId,
      Number.isFinite(maxChars) ? maxChars : 20000,
    );
    res.json(data);
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
    const notebookId = req.params.id;

    const out = await runNotebookChat({
      notebookId: req.params.id,
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

    res.json(out);
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
    res.status(201).json(await createNote(req.params.id, req.body || {}));
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
    res.json(
      await updateNote(req.params.id, req.params.noteId, req.body || {}),
    );
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
    const ok = await deleteNote(req.params.id, req.params.noteId);
    if (!ok) return res.status(404).json({ message: "Note not found" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
