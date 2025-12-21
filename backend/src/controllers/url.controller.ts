import { Request, Response, NextFunction } from 'express';
import {
  getAllUrls,
  getUrlById,
  createManyUrls,
  deleteUrlById,
  deleteUrlsBulk,
  updateUrlById,
  getUrlTaggingSummary,
  retryFailedUrlTagging,
  CreateUrlInput,
  GetAllOpts,
  UpdateUrlInput,
} from '../services/url.service';
import { extractPreviewFromUrl } from '../services/extract.service';

/* ----------------------- helpers ----------------------- */

function parseTagsQuery(q: unknown): string[] | undefined {
  if (!q) return undefined;
  if (Array.isArray(q)) {
    const flat = q.flatMap((v) => String(v).split(','));
    const tags = flat.map((s) => s.trim()).filter(Boolean);
    return tags.length ? tags : undefined;
  }
  const str = String(q).trim();
  if (!str) return undefined;
  const tags = str.split(',').map((s) => s.trim()).filter(Boolean);
  return tags.length ? tags : undefined;
}

function ensureNumericId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    const err = Object.assign(new Error('Invalid id'), { status: 400 });
    throw err;
  }
  return id;
}

function isLikelyJsonString(s: string) {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

function splitLinesOrCsv(s: string): string[] {
  // supports newline, comma, semicolon, whitespace-separated URLs
  return s
    .split(/[\n\r,;]+/)
    .map(x => x.trim())
    .filter(Boolean);
}

/** normalize many input shapes into CreateUrlInput[] */
function normalizeCreateBody(body: any, req: Request): CreateUrlInput[] {
  const coerceUrlObj = (u: any): CreateUrlInput | null => {
    if (typeof u === 'string') {
      const url = u.trim();
      return url ? { url, title: url } : null;
    }
    if (u && typeof u === 'object') {
      const url = String(u.url ?? '').trim();
      if (!url) return null;
      const title = String(u.title ?? '').trim() || url;
      const snippet = typeof u.snippet === 'string' ? u.snippet : undefined;
      return { url, title, snippet };
    }
    return null;
  };

  // 1) Query fallback: POST /api/urls?url=... or ?urls=a,b
  const qUrl = (req.query.url as string) || '';
  const qUrls = (req.query.urls as string) || '';
  const fromQuery = [
    ...splitLinesOrCsv(qUrl),
    ...splitLinesOrCsv(qUrls),
  ].map(u => ({ url: u, title: u }));

  // 2) Nothing in body? Return query-derived rows (if any)
  if (body == null || body === '') {
    return fromQuery;
  }

  // 3) If text/plain (string), accept JSON, CSV, newline block, or a single URL
  if (typeof body === 'string') {
    if (isLikelyJsonString(body)) {
      try {
        const parsed = JSON.parse(body);
        body = parsed; // fallthrough to next blocks
      } catch {
        // Not JSON → treat as CSV/newlines or single URL
        const items = splitLinesOrCsv(body).map(u => ({ url: u, title: u }));
        return items.length ? items : fromQuery;
      }
    } else {
      const items = splitLinesOrCsv(body).map(u => ({ url: u, title: u }));
      return items.length ? items : fromQuery;
    }
  }

  // 4) Support 
  const candidates = body?.urls ?? body?.links ?? body?.items ?? body?.data ?? body?.rows;
  if (Array.isArray(candidates)) {
    const rows = candidates.map(coerceUrlObj).filter(Boolean) as CreateUrlInput[];
    if (rows.length) return rows;
  }

  // 5) Array payload
  if (Array.isArray(body)) {
    const rows = (body as any[]).map(coerceUrlObj).filter(Boolean) as CreateUrlInput[];
    if (rows.length) return rows;
  }

  // 6) Single object
  const single = coerceUrlObj(body);
  if (single) return [single];

  // Fallback: query urls if present
  return fromQuery;
}

/* ----------------------- handlers ----------------------- */

export async function getUrlsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { year, sortKey = 'createdAt', sortOrder = 'desc' } = req.query as Partial<GetAllOpts>;
    const tags = parseTagsQuery(req.query.tags);

    const data = await getAllUrls({
      year,
      sortKey: (sortKey as GetAllOpts['sortKey']) ?? 'createdAt',
      sortOrder: (sortOrder as GetAllOpts['sortOrder']) ?? 'desc',
      tags,
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getUrlByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = ensureNumericId(req);
    const row = await getUrlById(id);
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function createUrlsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = normalizeCreateBody(req.body, req)
      // only require a URL; title defaults to url in normalizer
      .filter((r) => !!r.url);

    if (!rows.length) {
      return res.status(400).json({
        message: 'No URLs detected in payload.',
        hint: 'Send JSON, CSV/newlines, or use ?url= / ?urls= query params.',
      });
    }

    const result = await createManyUrls(rows);
    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateUrlByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = ensureNumericId(req);
    const payload = req.body as UpdateUrlInput;
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    const updated = await updateUrlById(id, payload);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function previewUrlHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { url } = (req.body ?? {}) as { url?: string };
    if (!url) return res.status(400).json({ message: 'Body must include { url }' });

    const { title, snippet } = await extractPreviewFromUrl(url);
    res.json({ url, title, snippet });
  } catch (err) {
    next(err);
  }
}

export async function deleteUrlByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const id = ensureNumericId(req);
    await deleteUrlById(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function deleteUrlsBulkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { ids } = (req.body ?? {}) as { ids?: number[] };
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isFinite(Number(n)))) {
      return res.status(400).json({ message: 'Body must include { ids: number[] }' });
    }
    const result = await deleteUrlsBulk(ids.map(Number));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUrlTaggingSummaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await getUrlTaggingSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

export async function retryFailedUrlTaggingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { ids, limit } = (req.body ?? {}) as { ids?: number[]; limit?: number };
    const result = await retryFailedUrlTagging({ ids, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
