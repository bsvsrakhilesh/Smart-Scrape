import { Request, Response, NextFunction } from "express";
import {
  getAllUrls,
  getUrlsPaged,
  getUrlById,
  createManyUrls,
  urlsExist,
  deleteUrlById,
  deleteUrlsBulk,
  updateUrlById,
  getUrlTaggingSummary,
  retryFailedUrlTagging,
  CreateUrlInput,
  GetAllOpts,
  GetPagedUrlsOpts,
  UpdateUrlInput,
  getUrlSnapshots,
} from "../services/url.service";
import { extractUrlMetadata } from "../services/extract.service";
import {
  listRevisionsForUrl,
  ensureDocumentRevisionForStoredFile,
} from "../services/document.service";
import prisma from "../config/database";
import { recordCaptureEvent } from "../services/provenance.service";

/* ----------------------- helpers ----------------------- */

function parseTagsQuery(q: unknown): string[] | undefined {
  if (!q) return undefined;
  if (Array.isArray(q)) {
    const flat = q.flatMap((v) => String(v).split(","));
    const tags = flat.map((s) => s.trim()).filter(Boolean);
    return tags.length ? tags : undefined;
  }
  const str = String(q).trim();
  if (!str) return undefined;
  const tags = str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return tags.length ? tags : undefined;
}

function ensureNumericId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    const err = Object.assign(new Error("Invalid id"), { status: 400 });
    throw err;
  }
  return id;
}

function isLikelyJsonString(s: string) {
  const t = s.trim();
  return (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  );
}

function splitLinesOrCsv(s: string): string[] {
  // supports newline, comma, semicolon, whitespace-separated URLs
  return s
    .split(/[\n\r,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** normalize many input shapes into CreateUrlInput[] */
function normalizeCreateBody(body: any, req: Request): CreateUrlInput[] {
  const coerceUrlObj = (u: any): CreateUrlInput | null => {
    if (typeof u === "string") {
      const url = u.trim();
      return url ? { url, title: url } : null;
    }
    if (u && typeof u === "object") {
      const url = String(u.url ?? "").trim();
      if (!url) return null;
      const title = String(u.title ?? "").trim() || url;
      const snippet = typeof u.snippet === "string" ? u.snippet : undefined;
      return { url, title, snippet };
    }
    return null;
  };

  // 1) Query fallback: POST /api/urls?url=... or ?urls=a,b
  const qUrl = (req.query.url as string) || "";
  const qUrls = (req.query.urls as string) || "";
  const fromQuery = [...splitLinesOrCsv(qUrl), ...splitLinesOrCsv(qUrls)].map(
    (u) => ({ url: u, title: u }),
  );

  // 2) Nothing in body? Return query-derived rows (if any)
  if (body == null || body === "") {
    return fromQuery;
  }

  // 3) If text/plain (string), accept JSON, CSV, newline block, or a single URL
  if (typeof body === "string") {
    if (isLikelyJsonString(body)) {
      try {
        const parsed = JSON.parse(body);
        body = parsed; // fallthrough to next blocks
      } catch {
        // Not JSON → treat as CSV/newlines or single URL
        const items = splitLinesOrCsv(body).map((u) => ({ url: u, title: u }));
        return items.length ? items : fromQuery;
      }
    } else {
      const items = splitLinesOrCsv(body).map((u) => ({ url: u, title: u }));
      return items.length ? items : fromQuery;
    }
  }

  // 4) Support
  const candidates =
    body?.urls ?? body?.links ?? body?.items ?? body?.data ?? body?.rows;
  if (Array.isArray(candidates)) {
    const rows = candidates
      .map(coerceUrlObj)
      .filter(Boolean) as CreateUrlInput[];
    if (rows.length) return rows;
  }

  // 5) Array payload
  if (Array.isArray(body)) {
    const rows = (body as any[])
      .map(coerceUrlObj)
      .filter(Boolean) as CreateUrlInput[];
    if (rows.length) return rows;
  }

  // 6) Single object
  const single = coerceUrlObj(body);
  if (single) return [single];

  // Fallback: query urls if present
  return fromQuery;
}

/* ----------------------- handlers ----------------------- */

export async function getUrlsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const {
      year,
      sortKey = "createdAt",
      sortOrder = "desc",
      q,
      page,
      pageSize,
    } = req.query as Partial<GetPagedUrlsOpts> as any;

    const tags = parseTagsQuery(req.query.tags);

    const hasPagination =
      Number.isInteger(Number(page)) && Number.isInteger(Number(pageSize));

    if (hasPagination) {
      const out = await getUrlsPaged({
        year,
        q: typeof q === "string" ? q : undefined,
        page: Number(page),
        pageSize: Number(pageSize),
        sortKey: (sortKey as GetAllOpts["sortKey"]) ?? "createdAt",
        sortOrder: (sortOrder as GetAllOpts["sortOrder"]) ?? "desc",
        tags,
      });
      return res.json(out);
    }

    // Back-compat (older clients expect an array)
    const data = await getAllUrls({
      year,
      sortKey: (sortKey as GetAllOpts["sortKey"]) ?? "createdAt",
      sortOrder: (sortOrder as GetAllOpts["sortOrder"]) ?? "desc",
      tags,
    });

    // Optional: client-side search without pagination (only for small libraries)
    if (typeof q === "string" && q.trim()) {
      const term = q.trim().toLowerCase();
      const match = (u: any) =>
        String(u.title ?? "")
          .toLowerCase()
          .includes(term) ||
        String(u.url ?? "")
          .toLowerCase()
          .includes(term) ||
        String(u.snippet ?? "")
          .toLowerCase()
          .includes(term);

      return res.json(data.filter(match));
    }

    return res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getUrlByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = ensureNumericId(req);
    const row = await getUrlById(id);
    res.json(row);
  } catch (err) {
    next(err);
  }
}

export async function getUrlSnapshotsHandler(req: Request, res: Response) {
  const id = Number(req.params.id);
  const limitRaw = req.query.limit;
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : undefined;

  const out = await getUrlSnapshots(
    id,
    Number.isFinite(limit) ? (limit as number) : 50,
  );
  res.json(out);
}

export async function getUrlRevisionsHandler(req: Request, res: Response) {
  const id = Number(req.params.id);
  const limitRaw = req.query.limit;
  const limit = typeof limitRaw === "string" ? Number(limitRaw) : undefined;

  const out = await listRevisionsForUrl(id, {
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
  });
  res.json(out);
}

export async function createUrlsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const rows = normalizeCreateBody(req.body, req)
      // only require a URL; title defaults to url in normalizer
      .filter((r) => !!r.url);

    if (!rows.length) {
      return res.status(400).json({
        message: "No URLs detected in payload.",
        hint: "Send JSON, CSV/newlines, or use ?url= / ?urls= query params.",
      });
    }

    // Best-effort metadata enrichment (fast + resilient).
    // Only enrich rows that look "thin" (title==url or missing snippet).
    const enriched = [];
    for (const r of rows) {
      const needs =
        !r.snippet ||
        !String(r.snippet).trim() ||
        !r.title ||
        r.title.trim() === r.url.trim();

      if (!needs) {
        enriched.push(r);
        continue;
      }

      try {
        const meta = await extractUrlMetadata(r.url);
        enriched.push({
          ...r,
          title:
            r.title?.trim() && r.title.trim() !== r.url.trim()
              ? r.title
              : meta.title,
          snippet:
            r.snippet && String(r.snippet).trim() ? r.snippet : meta.snippet,
          authors: meta.authors,
          publishedAt: meta.publishedAt,
        } as any);
      } catch {
        enriched.push(r);
      }
    }

    const result = await createManyUrls(enriched as any);
    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function urlsExistHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = (req.body ?? {}) as any;
    const urls = Array.isArray(body.urls) ? body.urls : [];
    const out = await urlsExist(urls);
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function updateUrlByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = ensureNumericId(req);
    const payload = req.body as UpdateUrlInput;
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }
    const updated = await updateUrlById(id, payload);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function previewUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { url } = (req.body ?? {}) as { url?: string };
    if (!url)
      return res.status(400).json({ message: "Body must include { url }" });

    const { title, snippet, authors, publishedAt } =
      await extractUrlMetadata(url);

    res.json({
      url,
      title,
      snippet,
      authors,
      publishedAt: publishedAt ? publishedAt.toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteUrlByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = ensureNumericId(req);
    await deleteUrlById(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function deleteUrlsBulkHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { ids } = (req.body ?? {}) as { ids?: number[] };
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((n) => Number.isFinite(Number(n)))
    ) {
      return res
        .status(400)
        .json({ message: "Body must include { ids: number[] }" });
    }
    const result = await deleteUrlsBulk(ids.map(Number));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUrlTaggingSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const summary = await getUrlTaggingSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

export async function retryFailedUrlTaggingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { ids, limit } = (req.body ?? {}) as {
      ids?: number[];
      limit?: number;
    };
    const result = await retryFailedUrlTagging({ ids, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function refreshUrlMetadataHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = ensureNumericId(req);

    const u = await prisma.url.findUnique({
      where: { id },
      select: { id: true, url: true },
    });

    if (!u) return res.status(404).json({ message: "URL not found" });

    // re-extract from live URL
    let meta: Awaited<ReturnType<typeof extractUrlMetadata>>;
    try {
      meta = await extractUrlMetadata(u.url);
    } catch (err: any) {
      const isTimeout =
        err?.code === "ECONNABORTED" ||
        String(err?.message || "")
          .toLowerCase()
          .includes("timeout");

      return res.status(isTimeout ? 504 : 502).json({
        code: isTimeout ? "METADATA_TIMEOUT" : "METADATA_FETCH_FAILED",
        message: isTimeout
          ? "Metadata refresh timed out while fetching the URL."
          : "Metadata refresh failed while fetching the URL.",
        url: u.url,
        requestId: (req as any)?.requestId ?? null,
      });
    }

    const updatedUrl = await prisma.url.update({
      where: { id },
      data: {
        publishedAt: meta.publishedAt,
        authors: meta.authors ?? [],
      },
      select: {
        id: true,
        publishedAt: true,
        authors: true,
      },
    });

    await prisma.storedFile.updateMany({
      where: {
        urlId: id,
        OR: [{ sourcePublishedAt: null }, { sourceAuthors: { equals: [] } }],
      },
      data: {
        sourcePublishedAt: meta.publishedAt ?? null,
        sourceAuthors: meta.authors ?? [],
      },
    });

    // provenance: record capture event on latest URL snapshot (if any)
    try {
      const latest = await prisma.storedFile.findFirst({
        where: { urlId: id, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          captureType: true,
          urlId: true,
          sourceUrl: true,
          uploaderId: true,
          uploaderName: true,
        },
      });

      if (latest) {
        const docRev = await ensureDocumentRevisionForStoredFile(latest.id);
        await recordCaptureEvent({
          pipelineName: "metadata.refresh",
          pipelineConfig: { url: true },
          captureType: (latest.captureType as any) || "URL_TEXT",
          storedFileId: latest.id,
          documentRevisionId: docRev.id,
          urlId: latest.urlId ?? null,
          sourceUrl: latest.sourceUrl ?? null,
          actorId: latest.uploaderId ?? null,
          actorName: latest.uploaderName ?? null,
          requestId: (req as any)?.requestId ?? null,
        });
      }
    } catch {
      // non-fatal
    }

    return res.json({
      id: updatedUrl.id,
      publishedAt: updatedUrl.publishedAt
        ? updatedUrl.publishedAt.toISOString()
        : null,
      authors: updatedUrl.authors ?? [],
    });
  } catch (err) {
    next(err);
  }
}
