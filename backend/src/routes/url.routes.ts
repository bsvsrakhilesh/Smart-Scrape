import { Router } from 'express';
import {
  getUrlsHandler,
  getUrlByIdHandler,
  createUrlsHandler,
  deleteUrlByIdHandler,
  deleteUrlsBulkHandler,
  updateUrlByIdHandler,
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

// Mounted at /api
r.get('/urls', getUrlsHandler);
r.get('/urls/:id', getUrlByIdHandler);
r.post('/urls', validate({ body: createUrlsBody }), createUrlsHandler);
r.delete('/urls/:id', deleteUrlByIdHandler);
r.delete('/urls', deleteUrlsBulkHandler); 
r.patch('/urls/:id', updateUrlByIdHandler);

export default r;
