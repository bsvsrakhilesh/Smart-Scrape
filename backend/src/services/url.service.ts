import { PrismaClient, Prisma, TaggingStatus } from '@prisma/client';
import { scheduleAiTagForUrl } from './aiTagUrlAuto.service';

const prisma = new PrismaClient();

/** Payload used to create URLs from the URL Collector */
export type CreateUrlInput = {
  url: string;
  title: string;
  snippet?: string | null;
};

/** Update payload */
export type UpdateUrlInput = Partial<Pick<CreateUrlInput, 'title' | 'snippet'>> & {
  tags?: string[];
  notes?: string | null;
  isFavorited?: boolean;
};

/** Query options for listing URLs */
export type GetAllOpts = {
  year?: string;
  sortKey?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  /** Require that results contain ALL these tags */
  tags?: string[];
};

function buildOrderBy(
  sortKey: GetAllOpts['sortKey'] = 'createdAt',
  sortOrder: GetAllOpts['sortOrder'] = 'desc'
): Prisma.Enumerable<Prisma.UrlOrderByWithRelationInput> {
  const key = sortKey ?? 'createdAt';
  const dir = sortOrder ?? 'desc';
  if (key === 'title') return [{ title: dir }];
  if (key === 'updatedAt') return [{ updatedAt: dir }];
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

/* ------------------------------ queries ------------------------------ */

/** List URLs with optional year + tag filters and sorting */
export async function getAllUrls(opts: GetAllOpts) {
  const where: Prisma.UrlWhereInput = {};

  // year filter (inclusive)
  const yearWhere = buildYearWhere(opts.year);
  if (yearWhere) Object.assign(where, yearWhere);

  // NEW: tags filter (hasEvery semantics)
  if (opts.tags && opts.tags.length) {
    const tags = opts.tags.map((t) => t.trim()).filter(Boolean);
    if (tags.length) where.tags = { hasEvery: tags };
  }

  const orderBy = buildOrderBy(opts.sortKey, opts.sortOrder);

  return prisma.url.findMany({
    where,
    orderBy,
  });
}

/** Get one URL by id */
export async function getUrlById(id: number) {
  const rec = await prisma.url.findUnique({ where: { id } });
  if (!rec) {
    const err = Object.assign(new Error(`URL with id ${id} not found`), { status: 404 });
    throw err;
  }
  return rec;
}

/** Create MANY URLs; skips duplicates; triggers async tagging for each created row */
export async function createManyUrls(rows: CreateUrlInput[]) {
  let added = 0;
  let skipped = 0;
  const skippedUrls: string[] = [];
  const created: Array<{ id: number; url: string }> = [];

  for (const r0 of rows) {
    const data: Prisma.UrlCreateInput = {
      url: r0.url,
      title: r0.title?.trim() || r0.url,
      snippet: r0.snippet ?? null,
    };
    try {
      const rec = await prisma.url.create({ data });
      created.push({ id: rec.id, url: rec.url });
      added++;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        skipped++;
        skippedUrls.push(data.url);
      } else {
        throw e;
      }
    }
  }

  // 🔹 Non-blocking tagging via Python ai-tagger
  // Stagger starts a bit to avoid hammering the tagger when the user saves many URLs at once.
  const STAGGER_MS = Number(process.env.TAGS_STAGGER_MS || 250);

  created.forEach(({ id }, i) => {
    setTimeout(() => scheduleAiTagForUrl(id), i * STAGGER_MS);
  });

  return { added, skipped, skippedUrls };
}

/** Update title/snippet/tags of a URL (does NOT re-run tagger) */
export async function updateUrlById(id: number, data: UpdateUrlInput) {
  const patch: Prisma.UrlUpdateInput = {};
  if (typeof data.title === 'string') patch.title = data.title.trim();
  if (typeof data.snippet === 'string' || data.snippet === null) patch.snippet = data.snippet ?? null;
  if (Array.isArray(data.tags)) patch.tags = data.tags.map((t) => t.trim()).filter(Boolean);
  if (typeof data.isFavorited === 'boolean') patch.isFavorited = data.isFavorited;
  if (typeof data.notes === 'string' || data.notes === null) patch.notes = data.notes ?? null;

  try {
    const updated = await prisma.url.update({
      where: { id },
      data: patch,
    });
    return updated;
  } catch (error: any) {
    if (error?.code === 'P2025') {
      const err = Object.assign(new Error(`URL with id ${id} not found`), { status: 404 });
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
    if (error?.code === 'P2025') {
      const err = Object.assign(new Error(`URL with id ${id} not found`), { status: 404 });
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
      failures.push({ id, error: e?.message || 'delete failed' });
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
      by: ['taggingStatus'],
      _count: { _all: true },
    }),
    prisma.url.findMany({
      where: { taggingStatus: TaggingStatus.FAILED },
      select: { id: true, url: true, title: true, taggingError: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
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

  const inProgress = (byStatus[TaggingStatus.PENDING] || 0) + (byStatus[TaggingStatus.RUNNING] || 0);
  const failed = byStatus[TaggingStatus.FAILED] || 0;

  return { total, untagged, byStatus, inProgress, failed, failedSample };
}

export async function retryFailedUrlTagging(opts: { ids?: number[]; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);

  let targetIds: number[] = [];
  if (Array.isArray(opts.ids) && opts.ids.length) {
    targetIds = opts.ids.map(Number).filter((n) => Number.isFinite(n));
  } else {
    const rows = await prisma.url.findMany({
      where: { taggingStatus: TaggingStatus.FAILED },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
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
      failures.push({ id, error: e?.message || 'schedule failed' });
    }
  }

  return { scheduled: scheduled.length, ids: scheduled, failures };
}

/** Keep exported: canonical URL normalizer (if other code imports it) */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    return u.toString();
  } catch {
    return String(raw).trim();
  }
}
