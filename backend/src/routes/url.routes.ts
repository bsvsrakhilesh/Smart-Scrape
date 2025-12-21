import { Router } from 'express';
import {
  getUrlsHandler,
  getUrlByIdHandler,
  createUrlsHandler,
  deleteUrlByIdHandler,
  deleteUrlsBulkHandler,
  updateUrlByIdHandler,
  previewUrlHandler,
  getUrlTaggingSummaryHandler,
  retryFailedUrlTaggingHandler,
} from '../controllers/url.controller';
import { z } from 'zod';
import { validate } from '../middlewares/validate';
const r = Router();

const createUrlsBody = z.object({
  urls: z.array(z.object({
    url: z.string().url(),
    title: z.string().min(1),
    snippet: z.string().optional().nullable(),
  })).min(1),
});

const previewUrlBody = z.object({
  url: z.string().url(),
});

const retryFailedBody = z.object({
  ids: z.array(z.number().int().positive()).optional(),
  limit: z.number().int().positive().max(500).optional(),
}).default({});

// Mounted at /api
r.post('/urls/preview', validate({ body: previewUrlBody }), previewUrlHandler);
r.get('/urls', getUrlsHandler);

r.get('/urls/tagging/summary', getUrlTaggingSummaryHandler);
r.post('/urls/tagging/retry-failed', validate({ body: retryFailedBody }), retryFailedUrlTaggingHandler);

r.get('/urls/:id', getUrlByIdHandler);
r.post('/urls', validate({ body: createUrlsBody }), createUrlsHandler);
r.delete('/urls/:id', deleteUrlByIdHandler);
r.delete('/urls', deleteUrlsBulkHandler); 
r.patch('/urls/:id', updateUrlByIdHandler);

export default r;
