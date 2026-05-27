// backend/src/services/url.service.ts
import { CaptureType, Prisma, TaggingStatus } from "../generated/prisma/client";
import prisma from "../config/database";
import { scheduleAiTagForUrl } from "./aiTagUrlAuto.service";
import {
  canonicalizeUrl,
  normalizedDomainFromUrl,
} from "../utils/urlCanonical";
import { getDiscoverySummariesByUrlId } from "./documentDiscovery.service";
import {
  deriveSeparatedTags,
  mergeUniqueTags,
  normalizeTagList,
  withSeparatedTagsMeta,
} from "../utils/tagBuckets";
import {
  countUpdatedSinceReview,
  filterUpdatedSinceReview,
} from "./savedUrlReview.service";
import { extractUrlMetadata } from "./extract.service";

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type SnapshotStatusFilter = "all" | "missing" | "stale" | "fresh";
type MetadataStateFilter = "all" | "missing" | "complete";
type UrlVisibility = "public" | "private";

/** Payload used to create URLs from the URL Collector */
export type CreateUrlInput = {
  url: string;
  title: string;
  snippet?: string | null;
  publishedAt?: Date | null;
  authors?: string[] | null;
  tagsMeta?: any | null;
};

export async function enrichUrlCreateRows(
  rows: CreateUrlInput[],
): Promise<CreateUrlInput[]> {
  const enriched: CreateUrlInput[] = [];

  for (const row of rows) {
    const needsMetadata =
      !row.snippet ||
      !String(row.snippet).trim() ||
      !row.title ||
      row.title.trim() === row.url.trim();

    if (!needsMetadata) {
      enriched.push(row);
      continue;
    }

    try {
      const metadata = await extractUrlMetadata(row.url);
      enriched.push({
        ...row,
        title:
          row.title?.trim() && row.title.trim() !== row.url.trim()
            ? row.title
            : metadata.title,
        snippet:
          row.snippet && String(row.snippet).trim()
            ? row.snippet
            : metadata.snippet,
        authors: metadata.authors,
        publishedAt: metadata.publishedAt,
        tagsMeta: {
          ...(row.tagsMeta ?? {}),
          publishedAtMeta: metadata.publishedAtMeta,
        },
      });
    } catch {
      enriched.push(row);
    }
  }

  return enriched;
}

/** Update payload */
export type UpdateUrlInput = Partial<
  Pick<CreateUrlInput, "title" | "snippet">
> & {
  tags?: string[];
  notes?: string | null;
  isFavorited?: boolean;
  visibility?: UrlVisibility;
};

/** Query options for listing URLs */
export type GetAllOpts = {
  year?: string;
  sortKey?: "createdAt" | "updatedAt" | "title";
  sortOrder?: "asc" | "desc";
  tags?: string[];
  domains?: string[];
  q?: string;
  collectionId?: string;
  collectorPurposeId?: string;
  favoritesOnly?: boolean;
  visibility?: "all" | UrlVisibility;
  dateFrom?: string;
  dateTo?: string;
  publishedFrom?: string;
  publishedTo?: string;
  snapshotStatus?: SnapshotStatusFilter;
  taggingStatus?: TaggingStatus | "all";
  metadataState?: MetadataStateFilter;
  reviewStatus?: "updated-since-review";
  ownerId?: string;
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
  updatedSinceReview: number;
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

const ACTIVE_URL_SNAPSHOT_WHERE: Prisma.StoredFileWhereInput = {
  deletedAt: null,
  captureType: { in: [CaptureType.URL_TEXT, CaptureType.URL_PDF] },
};

function activeUrlSnapshotWhere(
  extra?: Prisma.StoredFileWhereInput,
): Prisma.StoredFileWhereInput {
  if (!extra || Object.keys(extra).length === 0) {
    return ACTIVE_URL_SNAPSHOT_WHERE;
  }

  return {
    AND: [ACTIVE_URL_SNAPSHOT_WHERE, extra],
  };
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
    const domains = Array.from(
      new Set(
        opts.domains
          .map((d) => normalizedDomainFromUrl(d))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (domains.length) {
      and.push({ normalizedDomain: { in: domains } });
    }
  }

  if (opts.visibility && opts.visibility !== "all") {
    and.push({ visibility: opts.visibility });
  }

  if (opts.q && String(opts.q).trim()) {
    const term = String(opts.q).trim();
    const normalizedTerm = term.toLowerCase();
    const normalizedDomainTerm = normalizedDomainFromUrl(term);

    const searchOr: Prisma.UrlWhereInput[] = [
      { title: { contains: term, mode: "insensitive" } },
      { url: { contains: term, mode: "insensitive" } },
      { snippet: { contains: term, mode: "insensitive" } },
      { notes: { contains: term, mode: "insensitive" } },
      { tags: { has: normalizedTerm } },

      // Allow free-text search to match the stored normalized domain,
      // e.g. "nature.com", "www.nature.com", or "https://www.nature.com/article".
      { normalizedDomain: { contains: normalizedTerm, mode: "insensitive" } },
    ];

    if (normalizedDomainTerm && normalizedDomainTerm !== normalizedTerm) {
      searchOr.push({
        normalizedDomain: {
          contains: normalizedDomainTerm,
          mode: "insensitive",
        },
      });
    }

    and.push({ OR: searchOr });
  }

  if (opts.collectionId) {
    and.push({
      collections: {
        some: { collectionId: opts.collectionId },
      },
    });
  }

  if (opts.collectorPurposeId) {
    and.push({
      collectorPurposeLinks: {
        some: {
          purposeId: opts.collectorPurposeId,
          ...(opts.ownerId ? { purpose: { ownerId: opts.ownerId } } : {}),
        },
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

  const publishedAt: Prisma.DateTimeNullableFilter = {};
  const publishedFrom = toValidDate(opts.publishedFrom);
  const publishedTo = toValidDate(opts.publishedTo);

  if (publishedFrom) publishedAt.gte = publishedFrom;
  if (publishedTo) publishedAt.lte = publishedTo;
  if (publishedFrom || publishedTo) and.push({ publishedAt });

  if (opts.snapshotStatus && opts.snapshotStatus !== "all") {
    const staleCutoff = new Date(Date.now() - SNAPSHOT_STALE_DAYS * DAY_MS);

    if (opts.snapshotStatus === "missing") {
      and.push({
        snapshots: {
          none: activeUrlSnapshotWhere(),
        },
      });
    } else if (opts.snapshotStatus === "fresh") {
      and.push({
        snapshots: {
          some: activeUrlSnapshotWhere({
            createdAt: { gte: staleCutoff },
          }),
        },
      });
    } else if (opts.snapshotStatus === "stale") {
      and.push({
        snapshots: {
          some: activeUrlSnapshotWhere(),
        },
      });

      and.push({
        snapshots: {
          none: activeUrlSnapshotWhere({
            createdAt: { gte: staleCutoff },
          }),
        },
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
  return normalizedDomainFromUrl(rawUrl);
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
      select: { normalizedDomain: true, canonical_url: true, url: true },
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
        .map(
          (row) =>
            row.normalizedDomain ||
            safeHostnameFromUrl(row.canonical_url || row.url),
        )
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
      {
        snapshots: {
          some: activeUrlSnapshotWhere(),
        },
      },
      {
        snapshots: {
          none: activeUrlSnapshotWhere({
            createdAt: { gte: staleCutoff },
          }),
        },
      },
    ],
  };

  const [all, neverCaptured, staleCapture, aiFailed, metadataMissing] =
    await Promise.all([
      prisma.url.count({ where: baseWhere }),
      prisma.url.count({
        where: andWhere(baseWhere, {
          snapshots: {
            none: activeUrlSnapshotWhere(),
          },
        }),
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

  const updatedSinceReview = opts.ownerId
    ? await countUpdatedSinceReview(
        opts.ownerId,
        await prisma.url.findMany({
          where: baseWhere,
          select: { id: true, updatedAt: true },
        }),
      )
    : 0;

  return {
    all,
    neverCaptured,
    staleCapture,
    aiFailed,
    metadataMissing,
    updatedSinceReview,
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
  discoverySummary: any = null,
) {
  return {
    ...url,
    collections: (url.collections || []).map((link) => link.collectionId),
    latestSnapshot,
    discoverySummary,
  };
}

type LatestUrlSnapshot = Prisma.StoredFileGetPayload<{
  select: {
    id: true;
    urlId: true;
    fileName: true;
    captureType: true;
    createdAt: true;
    sha256: true;
  };
}>;

async function getLatestSnapshotsByUrlId(
  urlIds: number[],
): Promise<Map<number, LatestUrlSnapshot>> {
  const uniqueIds = Array.from(new Set(urlIds)).filter((id) =>
    Number.isFinite(id),
  );

  const latestByUrl = new Map<number, LatestUrlSnapshot>();

  if (uniqueIds.length === 0) return latestByUrl;

  const snapshots = await prisma.storedFile.findMany({
    where: {
      urlId: { in: uniqueIds },
      ...ACTIVE_URL_SNAPSHOT_WHERE,
    },
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

  for (const snapshot of snapshots) {
    if (typeof snapshot.urlId !== "number") continue;

    if (!latestByUrl.has(snapshot.urlId)) {
      latestByUrl.set(snapshot.urlId, snapshot);
    }
  }

  return latestByUrl;
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

  const filteredUrls =
    opts.reviewStatus === "updated-since-review" && opts.ownerId
      ? await filterUpdatedSinceReview(opts.ownerId, urls)
      : urls;

  // Attach latest active URL snapshot and PDF discovery info, if any.
  const urlIds = filteredUrls.map((u) => u.id);
  const latestByUrl = await getLatestSnapshotsByUrlId(urlIds);
  const discoveryByUrl = await getDiscoverySummariesByUrlId(urlIds);

  return filteredUrls.map((u) =>
    serializeUrlRow(
      u,
      latestByUrl.get(u.id) ?? null,
      discoveryByUrl.get(u.id) ?? null,
    ),
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

  if (opts.reviewStatus === "updated-since-review" && opts.ownerId) {
    const allUrls = await prisma.url.findMany({
      where,
      orderBy,
      include: {
        collections: {
          select: { collectionId: true },
        },
      },
    });

    const filtered = await filterUpdatedSinceReview(opts.ownerId, allUrls);
    const total = filtered.length;
    const pageRows = filtered.slice(skip, skip + pageSize);

    const urlIds = pageRows.map((u) => u.id);
    const latestByUrl = await getLatestSnapshotsByUrlId(urlIds);
    const discoveryByUrl = await getDiscoverySummariesByUrlId(urlIds);

    const items = pageRows.map((u) =>
      serializeUrlRow(
        u,
        latestByUrl.get(u.id) ?? null,
        discoveryByUrl.get(u.id) ?? null,
      ),
    ) as any[];

    return { items, total, page, pageSize };
  }

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

  // Attach latest active URL snapshot info, if any — only for the returned page.
  const urlIds = urls.map((u) => u.id);
  const latestByUrl = await getLatestSnapshotsByUrlId(urlIds);
  const discoveryByUrl = await getDiscoverySummariesByUrlId(urlIds);

  const items = urls.map((u) =>
    serializeUrlRow(
      u,
      latestByUrl.get(u.id) ?? null,
      discoveryByUrl.get(u.id) ?? null,
    ),
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
  const latestByUrl = await getLatestSnapshotsByUrlId([rec.id]);
  const discoveryByUrl = await getDiscoverySummariesByUrlId([rec.id]);
  return serializeUrlRow(
    rec,
    latestByUrl.get(rec.id) ?? null,
    discoveryByUrl.get(rec.id) ?? null,
  );
}

export async function recordUrlVisit(id: number) {
  try {
    return await prisma.url.update({
      where: { id },
      data: {
        lastVisitedAt: new Date(),
        visitCount: { increment: 1 },
      },
      select: {
        id: true,
        lastVisitedAt: true,
        visitCount: true,
      },
    });
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

// List snapshots for a URL (timeline)
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
    const normalizedDomain = normalizedDomainFromUrl(canonical || r0.url);

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
      normalizedDomain: normalizedDomain ?? null,
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

  // Non-blocking tagging via the controlled backend FIFO queue.
  // Rows enter PENDING immediately; the backend worker starts only one URL
  // tagging job at a time by default, so PDFs/heavy pages cannot overload the tagger.
  created.forEach(({ id }) => {
    scheduleAiTagForUrl(id);
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
      scheduleAiTagForUrl(id);
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

/** Update title/snippet/user tags of a URL (does NOT re-run tagger) */
export async function updateUrlById(id: number, data: UpdateUrlInput) {
  const existing = await prisma.url.findUnique({ where: { id } });

  if (!existing) {
    const err = Object.assign(new Error(`URL with id ${id} not found`), {
      status: 404,
    });
    throw err;
  }

  const patch: Prisma.UrlUpdateInput = {};

  if (typeof data.title === "string") patch.title = data.title.trim();
  if (typeof data.snippet === "string" || data.snippet === null) {
    patch.snippet = data.snippet ?? null;
  }

  if (Array.isArray(data.tags)) {
    const currentTagState = deriveSeparatedTags(
      existing.tags,
      existing.tagsMeta,
    );
    const nextUserTags = normalizeTagList(data.tags);
    const nextEffectiveTags = mergeUniqueTags(
      nextUserTags,
      currentTagState.aiTags,
    );

    patch.tags = nextEffectiveTags;
    patch.tagsMeta = withSeparatedTagsMeta(existing.tagsMeta, {
      userTags: nextUserTags,
      aiTags: currentTagState.aiTags,
    }) as any;
  }

  if (typeof data.isFavorited === "boolean") {
    patch.isFavorited = data.isFavorited;
  }

  if (data.visibility === "public" || data.visibility === "private") {
    patch.visibility = data.visibility;
  }

  if (typeof data.notes === "string" || data.notes === null) {
    patch.notes = data.notes ?? null;
  }

  const updated = await prisma.url.update({
    where: { id },
    data: patch,
  });

  const nextTagState = deriveSeparatedTags(updated.tags, updated.tagsMeta);

  return {
    ...updated,
    userTags: nextTagState.userTags,
    aiTags: nextTagState.aiTags,
    effectiveTags: nextTagState.effectiveTags,
  };
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
export type UrlTaggingSummaryItem = {
  id: number;
  url: string;
  title: string | null;
  normalizedDomain: string | null;
  taggingStatus: TaggingStatus;
  taggingJobId: string | null;
  taggingError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const TAGGING_SUMMARY_ITEM_SELECT = {
  id: true,
  url: true,
  title: true,
  normalizedDomain: true,
  taggingStatus: true,
  taggingJobId: true,
  taggingError: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UrlSelect;

export type UrlTaggingSummary = {
  total: number;
  untagged: number;
  byStatus: Record<string, number>;
  inProgress: number;
  failed: number;

  queueMode: "sequential";
  queueHealth:
    | "idle"
    | "processing"
    | "waiting_for_worker"
    | "attention_required";

  currentRunning: UrlTaggingSummaryItem | null;
  nextPending: UrlTaggingSummaryItem[];
  oldestPendingAt: Date | null;

  failedSample: Array<{
    id: number;
    url: string;
    title: string | null;
    taggingError: string | null;
    updatedAt: Date;
  }>;
};

export async function getUrlTaggingSummary(): Promise<UrlTaggingSummary> {
  const [
    total,
    untagged,
    grouped,
    failedSample,
    currentRunning,
    nextPending,
    oldestPending,
  ] = await Promise.all([
    prisma.url.count(),

    prisma.url.count({
      where: { tags: { isEmpty: true } },
    }),

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

    prisma.url.findFirst({
      where: { taggingStatus: TaggingStatus.RUNNING },
      select: TAGGING_SUMMARY_ITEM_SELECT,
      orderBy: { updatedAt: "desc" },
    }),

    prisma.url.findMany({
      where: { taggingStatus: TaggingStatus.PENDING },
      select: TAGGING_SUMMARY_ITEM_SELECT,
      orderBy: { updatedAt: "asc" },
      take: 3,
    }),

    prisma.url.findFirst({
      where: { taggingStatus: TaggingStatus.PENDING },
      select: { updatedAt: true },
      orderBy: { updatedAt: "asc" },
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

  const pending = byStatus[TaggingStatus.PENDING] || 0;
  const running = byStatus[TaggingStatus.RUNNING] || 0;
  const inProgress = pending + running;
  const failed = byStatus[TaggingStatus.FAILED] || 0;

  const queueHealth: UrlTaggingSummary["queueHealth"] =
    running > 0
      ? "processing"
      : pending > 0
        ? "waiting_for_worker"
        : failed > 0
          ? "attention_required"
          : "idle";

  return {
    total,
    untagged,
    byStatus,
    inProgress,
    failed,

    queueMode: "sequential",
    queueHealth,
    currentRunning,
    nextPending,
    oldestPendingAt: oldestPending?.updatedAt ?? null,

    failedSample,
  };
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
  return canonicalizeUrl(raw);
}
