import { Request, Response, NextFunction } from 'express';
import { googleSearch } from '../services/search.service';
import { log } from '../utils/logger';

export async function searchHandler(req: Request, res: Response, next: NextFunction) {
  const q = String(req.query.q || '').trim();

  if (!q) {
    log.warn('search.request.invalid', { reason: 'missing q' });
    return res.status(400).json({ error: 'Missing query parameter `q`' });
  }

  const startedAt = Date.now();
  try {
    const results = await googleSearch(q);
    log.info('search.response.ok', { items_count: results.length, ms: Date.now() - startedAt });
    return res.json(results);
  } catch (err: any) {
    log.error('search.response.error', { ms: Date.now() - startedAt, reason: err?.message });
    return next(err);
  }
}
