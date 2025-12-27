import { Request, Response, NextFunction } from 'express';
import {
  listNotebooks, createNotebook, getNotebook, updateNotebook,
  listSources, attachUrlSource, attachFileSource, deleteSource,
  createNote, updateNote, pickNotebookCitations
} from '../services/notebook.service';

export async function getNotebooksHandler(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await listNotebooks()); } catch (e) { next(e); }
}
export async function postNotebookHandler(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await createNotebook(req.body || {})); } catch (e) { next(e); }
}
export async function getNotebookDetailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await getNotebook(req.params.id);
    if (!data) return res.status(404).json({ message: 'Notebook not found' });
    res.json(data);
  } catch (e) { next(e); }
}
export async function patchNotebookHandler(req: Request, res: Response, next: NextFunction) {
  try { res.json(await updateNotebook(req.params.id, req.body || {})); } catch (e) { next(e); }
}
export async function getNotebookSourcesHandler(req: Request, res: Response, next: NextFunction) {
  try { res.json(await listSources(req.params.id)); } catch (e) { next(e); }
}
export async function postNotebookSourceUrlHandler(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await attachUrlSource(req.params.id, Number(req.body?.urlId))); } catch (e) { next(e); }
}
export async function postNotebookSourceFileHandler(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await attachFileSource(req.params.id, String(req.body?.fileId))); } catch (e) { next(e); }
}
export async function deleteNotebookSourceHandler(req: Request, res: Response, next: NextFunction) {
  try { await deleteSource(req.params.id, req.params.sourceId); res.status(204).end(); } catch (e) { next(e); }
}
export async function postNotebookChatHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const notebookId = req.params.id;

    const citations = await pickNotebookCitations(notebookId, 2);

    res.json({
      answer: `**Draft answer (backend)**\n\nYou asked: _${req.body?.message || ''}_`,
      citations,
      suggested: []
    });
  } catch (e) {
    next(e);
  }
}

export async function postNotebookNoteHandler(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await createNote(req.params.id, req.body || {})); } catch (e) { next(e); }
}
export async function patchNotebookNoteHandler(req: Request, res: Response, next: NextFunction) {
  try { res.json(await updateNote(req.params.id, req.params.noteId, req.body || {})); } catch (e) { next(e); }
}
