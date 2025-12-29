import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate';
import { getChunkHandler, getChunkReaderHandler } from '../controllers/chunk.controller';

const r = Router();

r.get(
  '/chunks/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getChunkHandler
);

r.get(
  '/chunks/:id/reader',
  validate({
    params: z.object({ id: z.string().min(1) }),
    query: z
      .object({
        radius: z.coerce.number().int().min(0).max(20).optional(),
      })
      .optional(),
  }),
  getChunkReaderHandler
);

export default r;
