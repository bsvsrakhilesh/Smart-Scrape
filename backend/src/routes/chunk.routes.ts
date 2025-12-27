import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate';
import { getChunkHandler } from '../controllers/chunk.controller';

const r = Router();

r.get(
  '/chunks/:id',
  validate({ params: z.object({ id: z.string().min(1) }) }),
  getChunkHandler
);

export default r;
