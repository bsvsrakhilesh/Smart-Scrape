// backend/src/services/url.service.ts
import { Prisma, TaggingStatus } from "../generated/prisma/client";
import prisma from "../config/database";
import { scheduleAiTagForUrl } from "./aiTagUrlAuto.service";
import { canonicalizeUrl } from "../utils/urlCanonical";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type SnapshotStatusFilter = "all" | "missing" | "stale" | "fresh";
type MetadataStateFilter = "all" | "missing" | "complete";

/** Payload used to create URLs from the URL Collector */
export type CreateUrlInput = {
  url: string;
  title: string;
  snippet?: string | null;
  publishedAt?: Date | null;
  authors?: string[] | null;
  tagsMeta?: any | null;
};

/** Update payload */
export type UpdateUrlInput = Partial<
  Pick<CreateUrlInput, "title" | "snippet">
> & {
  tags?: string[];
  notes?: string | null;
  isFavorited?: boolean;
};

/** Query options for listing URLs */
export type GetAllOpts = {
  year?: string;
  sortKey?: "createdAt" | "updatedAt" | "title";
  sortOrder?: "asc" | "desc";
  /** Require that results contain ALL these tags */
  tags?: string[];
  domains?: string[];
  q?: string;
  collectionId?: string;
  favoritesOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  snapshotStatus?: SnapshotStatusFilter;
  taggingStatus?: TaggingStatus | "all";
  metadataState?: MetadataStateFilter;
};

export type UrlFacetSummary = {
  domains: string[];
  tags: string[];
  years: string[];
};

export type UrlReviewQueueSummary = {
  all: number;
  neverCaptured: number;
  staleCapture: number;
  aiFailed: number;
  metadataMissing: number;
};

function buildOrderBy(
  sortKey: GetAllOpts["sortKey"] = "createdAt",
  sortOrder: GetAllOpts["sortOrder"] = "desc",
): Prisma.Enumerable<Prisma.UrlOrderByWithRelationInput> {
  const key = sortKey ?? "createdAt";
  const dir = sortOrder ?? "desc";
  if (key === "title") return [{ title: dir }];
  if (key === "updatedAt") return [{ updatedAt: dir }];
  return [{ createdAt: dir }];
}

function buildYearWhere(year?: string): Prisma.UrlWhereInput | undefined {
  if (!year) return undefined;
  const y = parseInt(year, 10);
  if (Number.isNaN(y)) return undefined;
  const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
  return { createdAt: { gte: start, lt: end } };
}

function toValidDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const dt = new Date(value);
  return Number.isFinite(dt.getTime()) ? dt : undefined;
}

function buildListWhere(opts: GetAllOpts): Prisma.UrlWhereInput {
  const and: Prisma.UrlWhereInput[] = [];

  const yearWhere = buildYearWhere(opts.year);
  if (yearWhere) and.push(yearWhere);

  if (opts.tags && opts.tags.length) {
    const tags = opts.tags.map((t) => t.trim()).filter(Boolean);
    if (tags.length) and.push({ tags: { hasEvery: tags } });
  }

  if (opts.domains && opts.domains.length) {
    const domains = opts.domains.map((d) => d.trim()).filter(Boolean);
    if (domains.length) {
      and.push({
        OR: domains.map((domain) => ({
          url: { contains: domain, mode: "insensitive" },
        })),
      });
    }
  }

  if (opts.q && String(opts.q).trim()) {
    const term = String(opts.q).trim();
    and.push({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { url: { contains: term, mode: "insensitive" } },
        { snippet: { contains: term, mode: "insensitive" } },
        { notes: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  if (opts.collectionId) {
    and.push({
      collections: {
        some: { collectionId: opts.collectionId },
      },
    });
  }

  if (opts.favoritesOnly) {
    and.push({ isFavorited: true });
  }

  const createdAt: Prisma.DateTimeFilter = {};
  const from = toValidDate(opts.dateFrom);
  const to = toValidDate(opts.dateTo);

  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  if (from || to) and.push({ createdAt });

  if (opts.snapshotStatus && opts.snapshotStatus !== "all") {
    const staleCutoff = new Date(Date.now() - SNAPSHOT_STALE_DAYS * DAY_MS);

    if (opts.snapshotStatus === "missing") {
      and.push({ snapshots: { none: {} } });
    } else if (opts.snapshotStatus === "fresh") {
      and.push({
        snapshots: { some: { createdAt: { gte: staleCutoff } } },
      });
    } else if (opts.snapshotStatus === "stale") {
      and.push({ snapshots: { some: {} } });
      and.push({
        snapshots: { none: { createdAt: { gte: staleCutoff } } },
      });
    }
  }

  if (opts.taggingStatus && opts.taggingStatus !== "all") {
    and.push({ taggingStatus: opts.taggingStatus as TaggingStatus });
  }

  if (opts.metadataState === "missing") {
    and.push({
      OR: [
        { publishedAt: null },
        { authors: { isEmpty: true } },
        { tags: { isEmpty: true } },
      ],
    });
  } else if (opts.metadataState === "complete") {
    and.push({ publishedAt: { not: null } });
    and.push({
      NOT: { authors: { isEmpty: true } },
    } as Prisma.UrlWhereInput);
    and.push({
      NOT: { tags: { isEmpty: true } },
    } as Prisma.UrlWhereInput);
  }

  return and.length ? { AND: and } : {};
}

function andWhere(
  base: Prisma.UrlWhereInput,
  extra: Prisma.UrlWhereInput,
): Prisma.UrlWhereInput {
  const clauses: Prisma.UrlWhereInput[] = [];

  if (base && Object.keys(base).length) clauses.push(base);
  if (extra && Object.keys(extra).length) clauses.push(extra);

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];

  return { AND: clauses };
}

function safeHostnameFromUrl(rawUrl: string): string | null {
  try {
    const hostname = new URL(rawUrl).hostname.trim().toLowerCase();
    return hostname || null;
  } catch {
    return null;
  }
}

function sortTextAsc(a: string, b: string) {
  return a.localeCompare(b);
}

function sortYearDesc(a: string, b: string) {
  return Number(b) - Number(a);
}

export async function getUrlFacets(opts: GetAllOpts): Promise<UrlFacetSummary> {
  const [domainRows, tagRows, yearRows] = await Promise.all([
    prisma.url.findMany({
      where: buildListWhere({ ...opts, domains: undefined }),
      select: { url: true },
    }),
    prisma.url.findMany({
      where: buildListWhere({ ...opts, tags: undefined }),
      select: { tags: true },
    }),
    prisma.url.findMany({
      where: buildListWhere({ ...opts, year: undefined }),
      select: { createdAt: true },
    }),
  ]);

  const domains = Array.from(
    new Set(
      domainRows
        .map((row) => safeHostnameFromUrl(row.url))
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort(sortTextAsc);

  const tags = Array.from(
    new Set(
      tagRows
        .flatMap((row) => (Array.isArray(row.tags) ? row.tags : []))
        .map((tag) => String(tag).trim())
        .filter(Boolean),
    ),
  ).sort(sortTextAsc);

  const years = Array.from(
    new Set(
      yearRows
        .map((row) => String(new Date(row.createdAt).getUTCFullYear()))
        .filter((year) => /^\d{4}$/.test(year)),
    ),
  ).sort(sortYearDesc);

  return { domains, tags, years };
}

export async function getUrlReviewQueueSummary(
  opts: GetAllOpts,
): Promise<UrlReviewQueueSummary> {
  const baseWhere = buildListWhere(opts);
  const staleCutoff = new Date(Date.now() - SNAPSHOT_STALE_DAYS * DAY_MS);

  const metadataMissingWhere: Prisma.UrlWhereInput = {
    OR: [
      { publishedAt: null },
      { authors: { isEmpty: true } },
      { tags: { isEmpty: true } },
    ],
  };

  const staleCaptureWhere: Prisma.UrlWhereInput = {
    AND: [
      { snapshots: { some: {} } },
      { snapshots: { none: { createdAt: { gte: staleCutoff } } } },
    ],
  };

  const [all, neverCaptured, staleCapture, aiFailed, metadataMissing] =
    await Promise.all([
      prisma.url.count({ where: baseWhere }),
      prisma.url.count({
        where: andWhere(baseWhere, { snapshots: { none: {} } }),
      }),
      prisma.url.count({
        where: andWhere(baseWhere, staleCaptureWhere),
      }),
      prisma.url.count({
        where: andWhere(baseWhere, { taggingStatus: TaggingStatus.FAILED }),
      }),
      prisma.url.count({
        where: andWhere(baseWhere, metadataMissingWhere),
      }),
    ]);

  return {
    all,
    neverCaptured,
    staleCapture,
    aiFailed,
    metadataMissing,
  };
}

type UrlWithCollectionLinks = Prisma.UrlGetPayload<{
  include: {
    collections: {
      select: { collectionId: true };
    };
  };
}>;

function serializeUrlRow(
  url: UrlWithCollectionLinks,
  latestSnapshot: any = null,
) {
  return {
    ...url,
    collections: (url.collections || []).map((link) => link.collectionId),
    latestSnapshot,
  };
}

/* ------------------------------ queries ------------------------------ */

/** List URLs with optional year + tag filters and sorting */
export async function getAllUrls(opts: GetAllOpts) {
  const where = buildListWhere(opts);

  const orderBy = buildOrderBy(opts.sortKey, opts.sortOrder);

  const urls = await prisma.url.findMany({
    where,
    orderBy,
    include: {
      collections: {
        select: { collectionId: true },
      },
    },
  });

  // Attach latest snapshot info (if any)
  const ids = urls.map((u) => u.id);
  if (ids.length === 0) return urls.map((u) => serializeUrlRow(u)) as any;

  const snaps = await prisma.storedFile.findMany({
    where: { urlId: { in: ids } },
    select: {
      id: true,
      urlId: true,
      fileName: true,
      captureType: true,
      createdAt: true,
      sha256: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const latestByUrl = new Map<number, any>();
  for (const s of snaps) {
    if (!latestByUrl.has(s.urlId as number))
      latestByUrl.set(s.urlId as number, s);
  }

  return urls.map((u) =>
    serializeUrlRow(u, latestByUrl.get(u.id) ?? null),
  ) as any;
}

// ------------------------------ pagination + search ------------------------------

export type GetPagedUrlsOpts = GetAllOpts & {
  q?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Paged URL listing for large libraries (SourcePicker, etc.)
 * - Supports q (search over title/url/snippet)
 * - Supports year/tags/sortKey/sortOrder
 * - Returns { items, total, page, pageSize }
 */
export async function getUrlsPaged(opts: GetPagedUrlsOpts) {
  const where = buildListWhere(opts);

  const orderBy = buildOrderBy(opts.sortKey, opts.sortOrder);

  const pageSize = Math.max(1, Math.min(Number(opts.pageSize ?? 50), 200));
  const page = Math.max(1, Number(opts.page ?? 1));
  const skip = (page - 1) * pageSize;

  const [urls, total] = await Promise.all([
    prisma.url.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
      include: {
        collections: {
          select: { collectionId: true },
        },
      },
    }),
    prisma.url.count({ where }),
  ]);

  // Attach latest snapshot info (if any) — only for the returned page
  const ids = urls.map((u) => u.id);
  if (ids.length === 0) {
    return {
      items: urls.map((u) => serializeUrlRow(u)) as any[],
      total,
      page,
      pageSize,
    };
  }

  const snaps = await prisma.storedFile.findMany({
    where: { urlId: { in: ids } },
    select: {
      id: true,
      urlId: true,
      fileName: true,
      captureType: true,
      createdAt: true,
      sha256: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const latestByUrl = new Map<number, any>();
  for (const s of snaps) {
    if (!latestByUrl.has(s.urlId as number))
      latestByUrl.set(s.urlId as number, s);
  }

  const items = urls.map((u) =>
    serializeUrlRow(u, latestByUrl.get(u.id) ?? null),
  ) as any[];

  return { items, total, page, pageSize };
}

/** Get one URL by id */
export async function getUrlById(id: number) {
  const rec = await prisma.url.findUnique({
    where: { id },
    include: {
      collections: {
        select: { collectionId: true },
      },
    },
  });
  if (!rec) {
    const err = Object.assign(new Error(`URL with id ${id} not found`), {
      status: 404,
    });
    throw err;
  }
  return serializeUrlRow(rec);
}

// NEW: List snapshots for a URL (timeline)
export async function getUrlSnapshots(urlId: number, limit = 50) {
  // Ensure URL exists (clean 404)
  const url = await prisma.url.findUnique({ where: { id: urlId } });
  if (!url) {
    const err = Object.assign(new Error(`URL with id ${urlId} not found`), {
      status: 404,
    });
    throw err;
  }

  const safeLimit = Math.max(1, Math.min(limit, 200));

  return prisma.storedFile.findMany({
    where: {
      urlId,
      deletedAt: null,
      captureType: { in: ["URL_TEXT", "URL_PDF"] },
    },
    select: {
      id: true,
      fileName: true,
      captureType: true,
      createdAt: true,
      sha256: true,
      mimeType: true,
      size: true,
      sourceUrl: true,
      urlId: true,
    },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
  });
}

/** Create MANY URLs; skips duplicates; triggers async tagging for each created row */
export async function createManyUrls(rows: CreateUrlInput[]) {
  let added = 0;
  let skipped = 0;
  const skippedUrls: string[] = [];
  const created: Array<{ id: number; url: string }> = [];

  for (const r0 of rows) {
    const canonical = canonicalizeUrl(r0.url);

    // If canonical exists already, skip (even if raw url differs).
    // This prevents duplicate rows before canonical_url becomes unique.
    const existingByCanonical = canonical
      ? await prisma.url.findFirst({
          where: { canonical_url: canonical },
          select: { id: true },
        })
      : null;

    if (existingByCanonical) {
      skipped++;
      skippedUrls.push(r0.url);
      continue;
    }

    const data: Prisma.UrlCreateInput = {
      url: r0.url,
      canonical_url: canonical,
      title: r0.title?.trim() || r0.url,
      snippet: r0.snippet ?? null,
      publishedAt: r0.publishedAt ?? null,
      authors: Array.isArray(r0.authors) ? r0.authors : [],
      tagsMeta: (r0 as any).tagsMeta ?? undefined,
    };

    try {
      const rec = await prisma.url.create({ data });
      created.push({ id: rec.id, url: rec.url });
      added++;
    } catch (e: any) {
      if (e?.code === "P2002") {
        skipped++;
        skippedUrls.push(data.url);
      } else {
        throw e;
      }
    }
  }

  // Non-blocking tagging via Python ai-tagger
  // Stagger starts a bit to avoid hammering the tagger when the user saves many URLs at once.
  const STAGGER_MS = Number(process.env.TAGS_STAGGER_MS || 250);

  created.forEach(({ id }, i) => {
    setTimeout(() => scheduleAiTagForUrl(id), i * STAGGER_MS);
  });

  // Resolve ids for skipped (already-existing) URLs so callers can always get urlId.
  const skippedCanon = skippedUrls
    .map((u) => canonicalizeUrl(u))
    .filter((v): v is string => Boolean(v));

  const existingRows =
    skippedUrls.length > 0
      ? await prisma.url.findMany({
          where: {
            OR: [
              { url: { in: skippedUrls } },
              { canonical_url: { in: skippedCanon } },
            ],
          },
          select: {
            id: true,
            url: true,
            tags: true,
            taggerVersion: true,
            taggingStatus: true,
          },
        })
      : [];

  // Also tag already-existing rows if they are not tagged yet (or previously failed)
  existingRows.forEach(({ id, tags, taggerVersion, taggingStatus }, i) => {
    const needsTagging =
      !taggerVersion ||
      !tags ||
      tags.length === 0 ||
      taggingStatus === "FAILED";

    if (needsTagging) {
      const offset = created.length + i; // continue staggering after "created"
      setTimeout(() => scheduleAiTagForUrl(id), offset * STAGGER_MS);
    }
  });

  const rowsOut = [
    ...created.map((r) => ({ id: r.id, url: r.url, isNew: true })),
    ...existingRows.map((r) => ({ id: r.id, url: r.url, isNew: false })),
  ];

  return { added, skipped, skippedUrls, rows: rowsOut };
}

export async function urlsExist(urls: string[]) {
  const cleaned = (urls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);

  if (cleaned.length === 0) return { exists: {} as Record<string, number> };

  const canon = cleaned.map((u) => canonicalizeUrl(u)).filter(Boolean);

  // During rollout (canonical_url nullable), match either canonical_url OR raw url
  const found = await prisma.url.findMany({
    where: {
      OR: [{ canonical_url: { in: canon } }, { url: { in: cleaned } }],
    },
    select: { id: true, canonical_url: true, url: true },
  });

  const exists: Record<string, number> = {};
  for (const r of found) {
    const key = r.canonical_url || canonicalizeUrl(r.url);
    if (key) exists[key] = r.id;
  }
  return { exists };
}

/** Update title/snippet/tags of a URL (does NOT re-run tagger) */
export async function updateUrlById(id: number, data: UpdateUrlInput) {
  const patch: Prisma.UrlUpdateInput = {};
  if (typeof data.title === "string") patch.title = data.title.trim();
  if (typeof data.snippet === "string" || data.snippet === null)
    patch.snippet = data.snippet ?? null;
  if (Array.isArray(data.tags))
    patch.tags = data.tags.map((t) => t.trim()).filter(Boolean);
  if (typeof data.isFavorited === "boolean")
    patch.isFavorited = data.isFavorited;
  if (typeof data.notes === "string" || data.notes === null)
    patch.notes = data.notes ?? null;

  try {
    const updated = await prisma.url.update({
      where: { id },
      data: patch,
    });
    return updated;
  } catch (error: any) {
    if (error?.code === "P2025") {
      const err = Object.assign(new Error(`URL with id ${id} not found`), {
        status: 404,
      });
      throw err;
    }
    throw error;
  }
}

/** Delete a URL by id */
export async function deleteUrlById(id: number) {
  try {
    await prisma.url.delete({ where: { id } });
  } catch (error: any) {
    if (error?.code === "P2025") {
      const err = Object.assign(new Error(`URL with id ${id} not found`), {
        status: 404,
      });
      throw err;
    }
    throw error;
  }
}

/** Bulk delete by ids */
export async function deleteUrlsBulk(ids: number[]) {
  const deleted: number[] = [];
  const failures: Array<{ id: number; error: string }> = [];

  for (const raw of ids) {
    const id = Number(raw);
    try {
      await deleteUrlById(id);
      deleted.push(id);
    } catch (e: any) {
      failures.push({ id, error: e?.message || "delete failed" });
    }
  }
  return { deleted, failures };
}

/* -------------------------- tagging health -------------------------- */

export type UrlTaggingSummary = {
  total: number;
  untagged: number;
  byStatus: Record<string, number>;
  inProgress: number;
  failed: number;
  failedSample: Array<{
    id: number;
    url: string;
    title: string | null;
    taggingError: string | null;
    updatedAt: Date;
  }>;
};

export async function getUrlTaggingSummary(): Promise<UrlTaggingSummary> {
  const [total, untagged, grouped, failedSample] = await Promise.all([
    prisma.url.count(),
    prisma.url.count({ where: { tags: { isEmpty: true } } }),
    prisma.url.groupBy({
      by: ["taggingStatus"],
      _count: { _all: true },
    }),
    prisma.url.findMany({
      where: { taggingStatus: TaggingStatus.FAILED },
      select: {
        id: true,
        url: true,
        title: true,
        taggingError: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  const byStatus: Record<string, number> = {
    [TaggingStatus.NONE]: 0,
    [TaggingStatus.PENDING]: 0,
    [TaggingStatus.RUNNING]: 0,
    [TaggingStatus.SUCCESS]: 0,
    [TaggingStatus.FAILED]: 0,
  };

  for (const g of grouped) {
    const key = g.taggingStatus ?? TaggingStatus.NONE;
    byStatus[key] = g._count._all;
  }

  const inProgress =
    (byStatus[TaggingStatus.PENDING] || 0) +
    (byStatus[TaggingStatus.RUNNING] || 0);
  const failed = byStatus[TaggingStatus.FAILED] || 0;

  return { total, untagged, byStatus, inProgress, failed, failedSample };
}

export async function retryFailedUrlTagging(
  opts: { ids?: number[]; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);

  let targetIds: number[] = [];
  if (Array.isArray(opts.ids) && opts.ids.length) {
    targetIds = opts.ids.map(Number).filter((n) => Number.isFinite(n));
  } else {
    const rows = await prisma.url.findMany({
      where: { taggingStatus: TaggingStatus.FAILED },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    targetIds = rows.map((r) => r.id);
  }

  if (!targetIds.length) {
    return { scheduled: 0, ids: [] as number[] };
  }

  // Flip state immediately so UI can reflect "retrying" even before tagger finishes
  await prisma.url.updateMany({
    where: { id: { in: targetIds } },
    data: {
      taggingStatus: TaggingStatus.PENDING,
      taggingError: null,
      taggingJobId: null,
    },
  });

  const scheduled: number[] = [];
  const failures: Array<{ id: number; error: string }> = [];

  for (const id of targetIds) {
    try {
      scheduleAiTagForUrl(id, { force: true });
      scheduled.push(id);
    } catch (e: any) {
      failures.push({ id, error: e?.message || "schedule failed" });
    }
  }

  return { scheduled: scheduled.length, ids: scheduled, failures };
}

/** Keep exported: canonical URL normalizer (if other code imports it) */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(String(raw).trim());
    u.hash = "";
    return u.toString();
  } catch {
    return String(raw).trim();
  }
}
