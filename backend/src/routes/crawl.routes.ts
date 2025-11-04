// backend/src/routes/crawl.routes.ts
import { Router } from 'express';
import { crawlTextHandler, crawlPdfHandler } from '../controllers/crawl.controller';
import { z } from 'zod';
import { validate } from '../middlewares/validate';

const r = Router();

const crawlTextBody = z.object({
  url: z.string().url(),
  folderId: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
});
r.post('/crawl/text', validate({ body: crawlTextBody }), crawlTextHandler);

const crawlPdfBody = z.object({
  url: z.string().url(),
  folderId: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  fullPage: z.boolean().optional(),
});
r.post('/crawl/pdf', validate({ body: crawlPdfBody }), crawlPdfHandler);

export default r;
