import { Router } from 'express';
import {
  getNotebooksHandler, postNotebookHandler, getNotebookDetailHandler, patchNotebookHandler,
  getNotebookSourcesHandler, postNotebookSourceUrlHandler, postNotebookSourceFileHandler, deleteNotebookSourceHandler,
  postNotebookChatHandler, postNotebookNoteHandler, patchNotebookNoteHandler
} from '../controllers/notebook.controller';
import { z } from 'zod';
import { validate } from '../middlewares/validate';

const r = Router();

r.get('/notebooks', getNotebooksHandler);

r.post(
  '/notebooks',
  validate({ body: z.object({ title: z.string().min(1), description: z.string().max(2000).optional() }) }),
  postNotebookHandler
);

r.get(
  '/notebooks/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getNotebookDetailHandler
);

r.patch(
  '/notebooks/:id',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ title: z.string().min(1).optional(), description: z.string().max(2000).optional() })
  }),
  patchNotebookHandler
);

r.get(
  '/notebooks/:id/sources',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getNotebookSourcesHandler
);

r.post(
  '/notebooks/:id/sources/url',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ url: z.string().url(), title: z.string().min(1).optional() })
  }),
  postNotebookSourceUrlHandler
);

r.post(
  '/notebooks/:id/sources/file',
  validate({
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ folderId: z.string().optional() }).optional()
  }),
  postNotebookSourceFileHandler
);

r.delete(
  '/notebooks/:id/sources/:sourceId',
  validate({ params: z.object({ id: z.string().min(1), sourceId: z.string().min(1) }) }),
  deleteNotebookSourceHandler
);

r.post(
  '/notebooks/:id/chat',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      message: z.string().min(1),
      history: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string() })).optional()
    })
  }),
  postNotebookChatHandler
);

r.post(
  '/notebooks/:id/notes',
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ text: z.string().min(1) })
  }),
  postNotebookNoteHandler
);

r.patch(
  '/notebooks/:id/notes/:noteId',
  validate({
    params: z.object({ id: z.string().min(1), noteId: z.string().min(1) }),
    body: z.object({ text: z.string().min(1) })
  }),
  patchNotebookNoteHandler
);

export default r;
