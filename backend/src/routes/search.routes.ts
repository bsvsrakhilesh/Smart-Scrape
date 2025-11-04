import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate';
import { searchHandler } from '../controllers/search.controller';

const router = Router();

// GET /api/search?q=your+terms&page=1
const querySchema = z.object({
  q: z.string().min(2, 'q must be at least 2 chars'),
  page: z.coerce.number().int().min(1).optional()
});

router.get('/', validate({ query: querySchema }), searchHandler);

export default router;
