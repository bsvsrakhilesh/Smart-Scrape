import prisma from "../config/database";
import { env } from "../config/env";
import { enqueueEmbeddingJob } from "../queues/embedding.queue";
import { enqueueIngestionJob } from "../queues/ingestion.queue";
import crypto from "crypto";
import { Prisma } from "../generated/prisma/client";

export async function listNotebooks() {
  return prisma.notebook.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function createNotebook(p: {
  title: string;
  description?: string;
}) {
  return prisma.notebook.create({
    data: { title: p.title || "Untitled", description: p.description ?? "" },
  });
}

export async function getNotebook(id: string) {
  const notebook = await prisma.notebook.findUnique({ where: { id } });
  if (!notebook) return null;

  const sources = await prisma.notebookSource.findMany({
    where: { notebookId: id },
    include: {
      url: true,
      file: true,
      ingestionJob: { select: { status: true, error: true, updatedAt: true } },
      embeddingJob: { select: { status: true, error: true, updatedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const notes = await prisma.note.findMany({
    where: { notebookId: id },
    orderBy: { updatedAt: "desc" },
  });

  return { notebook, sources, notes };
}

export async function updateNotebook(
  id: string,
  p: { title?: string; description?: string },
) {
  return prisma.notebook.update({ where: { id }, data: p });
}

export async function deleteNotebook(id: string) {
  try {
    await prisma.notebook.delete({ where: { id } });
    return true;
  } catch (e: any) {
    // Prisma "record not found"
    if (e?.code === "P2025") return false;
    throw e;
  }
}

export async function listSources(notebookId: string) {
  return prisma.notebookSource.findMany({
    where: { notebookId },
    include: {
      url: true,
      file: true,
      ingestionJob: { select: { status: true, error: true, updatedAt: true } },
      embeddingJob: { select: { status: true, error: true, updatedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// =======================
// Source repair + diagnostics
// =======================

const SOURCE_INCLUDE = {
  url: true,
  file: true,
  ingestionJob: { select: { status: true, error: true, updatedAt: true } },
  embeddingJob: { select: { status: true, error: true, updatedAt: true } },
} as const;

async function assertSourceInNotebook(notebookId: string, sourceId: string) {
  const src = await prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: SOURCE_INCLUDE,
  });

  if (!src || src.notebookId !== notebookId) {
    const err: any = new Error("Source not found");
    err.status = 404;
    throw err;
  }
  return src;
}

function clampPreview(s: string, maxChars: number) {
  const t = (s || "").replace(/\u0000/g, "");
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)) + "…";
}

export async function getSourceDiagnostics(
  notebookId: string,
  sourceId: string,
  maxChars = 20000,
) {
  const src = await prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: {
      url: true,
      file: true,
      ingestionJob: {
        select: {
          status: true,
          error: true,
          updatedAt: true,
          attemptCount: true,
        },
      },
      embeddingJob: {
        select: {
          status: true,
          error: true,
          updatedAt: true,
          attemptCount: true,
        },
      },
      activeRevision: {
        select: {
          id: true,
          ordinal: true,
          contentHash: true,
          createdAt: true,
          pipelineConfig: {
            select: { name: true, version: true, configHash: true },
          },
        },
      },
    },
  });

  if (!src || src.notebookId !== notebookId) {
    const err: any = new Error("Source not found");
    err.status = 404;
    throw err;
  }

  const revisionId = src.activeRevisionId || null;

  const [pageCount, chunkCount, embeddedCount] = revisionId
    ? await Promise.all([
        prisma.sourcePage.count({ where: { sourceId, revisionId } }),
        prisma.sourceChunk.count({ where: { sourceId, revisionId } }),
        prisma.sourceChunk.count({
          where: { sourceId, revisionId, embeddedAt: { not: null } },
        }),
      ])
    : [0, 0, 0];

  // Preview text (prefer pages for PDFs)
  let textPreview = "";
  let pagePreviews:
    | { pageNumber: number; charCount: number; preview: string }[]
    | null = null;

  if (revisionId && pageCount > 0) {
    const pages = await prisma.sourcePage.findMany({
      where: { sourceId, revisionId },
      orderBy: { pageNumber: "asc" },
      take: 8,
      select: { pageNumber: true, text: true },
    });

    pagePreviews = pages.map((p) => ({
      pageNumber: p.pageNumber,
      charCount: (p.text || "").length,
      preview: clampPreview((p.text || "").trim(), 900),
    }));

    let acc = "";
    for (const p of pages) {
      if (acc.length >= maxChars) break;
      const header = `\n\n--- Page ${p.pageNumber} ---\n`;
      acc += header + (p.text || "").trim();
    }
    textPreview = clampPreview(acc.trim(), maxChars);
  } else if (revisionId && chunkCount > 0) {
    const chunks = await prisma.sourceChunk.findMany({
      where: { sourceId, revisionId },
      orderBy: { idx: "asc" },
      take: 12,
      select: { idx: true, text: true },
    });

    const acc = chunks
      .map((c) => `\n\n--- Chunk ${c.idx} ---\n${(c.text || "").trim()}`)
      .join("")
      .trim();

    textPreview = clampPreview(acc, maxChars);
  }

  return {
    source: {
      id: src.id,
      notebookId: src.notebookId,
      kind: src.kind,
      url: src.url,
      file: src.file,
      createdAt: src.createdAt,
    },
    jobs: {
      ingestion: src.ingestionJob
        ? {
            status: src.ingestionJob.status,
            error: src.ingestionJob.error,
            updatedAt: src.ingestionJob.updatedAt,
            attemptCount: src.ingestionJob.attemptCount,
          }
        : null,
      embedding: src.embeddingJob
        ? {
            status: src.embeddingJob.status,
            error: src.embeddingJob.error,
            updatedAt: src.embeddingJob.updatedAt,
            attemptCount: src.embeddingJob.attemptCount,
          }
        : null,
    },
    activeRevision: src.activeRevision,
    counts: { pageCount, chunkCount, embeddedCount },
    textPreview,
    pagePreviews,
  };
}

export async function retrySourceIngestion(
  notebookId: string,
  sourceId: string,
) {
  await assertSourceInNotebook(notebookId, sourceId);

  await prisma.ingestionJob.upsert({
    where: { sourceId },
    create: { sourceId, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueIngestionJob(sourceId);

  return prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: SOURCE_INCLUDE,
  });
}

export async function runSourceOcr(notebookId: string, sourceId: string) {
  const src = await prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: { file: true },
  });

  if (!src || src.notebookId !== notebookId) {
    const err: any = new Error("Source not found");
    err.status = 404;
    throw err;
  }

  if (src.kind !== "FILE" || !src.file) {
    const err: any = new Error("OCR can only run on FILE sources");
    err.status = 400;
    throw err;
  }

  const isPdf =
    (src.file.mimeType || "").toLowerCase().includes("pdf") ||
    (src.file.fileName || "").toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    const err: any = new Error("OCR can only run on PDF files");
    err.status = 400;
    throw err;
  }

  await prisma.ingestionJob.upsert({
    where: { sourceId },
    create: { sourceId, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueIngestionJob(sourceId, { forceOcr: true });

  return prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: {
      url: true,
      file: true,
      ingestionJob: { select: { status: true, error: true, updatedAt: true } },
      embeddingJob: { select: { status: true, error: true, updatedAt: true } },
    },
  });
}

export async function retrySourceEmbedding(
  notebookId: string,
  sourceId: string,
) {
  const src = await assertSourceInNotebook(notebookId, sourceId);

  if (!env.OPENAI_ENABLED) {
    const err: any = new Error(
      "Embeddings are disabled (OPENAI_ENABLED=false).",
    );
    err.status = 400;
    throw err;
  }
  if (!src.activeRevisionId) {
    const err: any = new Error(
      "This source has no active revision yet. Ingest it first.",
    );
    err.status = 400;
    throw err;
  }
  if (src.ingestionJob?.status !== "SUCCESS") {
    const err: any = new Error(
      "Ingestion is not complete. Fix ingestion first.",
    );
    err.status = 400;
    throw err;
  }

  await prisma.embeddingJob.upsert({
    where: { sourceId },
    create: { sourceId, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueEmbeddingJob(sourceId);

  return prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: SOURCE_INCLUDE,
  });
}

export async function rebuildSourceEmbedding(
  notebookId: string,
  sourceId: string,
) {
  const src = await assertSourceInNotebook(notebookId, sourceId);

  if (!env.OPENAI_ENABLED) {
    const err: any = new Error(
      "Embeddings are disabled (OPENAI_ENABLED=false).",
    );
    err.status = 400;
    throw err;
  }
  if (!src.activeRevisionId) {
    const err: any = new Error(
      "This source has no active revision yet. Ingest it first.",
    );
    err.status = 400;
    throw err;
  }

  const revId = src.activeRevisionId;

  // prisma.updateMany can't set unsupported vector field -> raw SQL.
  await prisma.$executeRaw`
    UPDATE "SourceChunk"
    SET "embedding" = NULL,
        "embeddingModel" = NULL,
        "embeddedAt" = NULL
    WHERE "sourceId" = ${sourceId}
      AND "revisionId" = ${revId}
  `;

  await prisma.embeddingJob.upsert({
    where: { sourceId },
    create: { sourceId, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueEmbeddingJob(sourceId);

  return prisma.notebookSource.findUnique({
    where: { id: sourceId },
    include: SOURCE_INCLUDE,
  });
}

export async function attachUrlSource(notebookId: string, urlId: number) {
  const url = await prisma.url.findUnique({ where: { id: urlId } });
  if (!url) {
    const err: any = new Error("URL not found");
    err.status = 404;
    throw err;
  }

  try {
    const src = await prisma.notebookSource.create({
      data: { notebookId, kind: "URL", urlId },
    });

    // Durable ingestion enqueue job + track status
    await prisma.ingestionJob.upsert({
      where: { sourceId: src.id },
      create: { sourceId: src.id, status: "PENDING", attemptCount: 0 },
      update: { status: "PENDING", error: null },
    });

    await enqueueIngestionJob(src.id);

    return prisma.notebookSource.findUnique({
      where: { id: src.id },
      include: {
        url: true,
        file: true,
        ingestionJob: {
          select: { status: true, error: true, updatedAt: true },
        },
        embeddingJob: {
          select: { status: true, error: true, updatedAt: true },
        },
      },
    });
  } catch (e: any) {
    // Duplicate attach -> 409
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const err: any = new Error(
        "This URL is already attached to the notebook.",
      );
      err.status = 409;
      throw err;
    }

    // Notebook does not exist (FK constraint) -> 404
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      const err: any = new Error("Notebook not found");
      err.status = 404;
      throw err;
    }

    throw e;
  }
}

export async function attachFileSource(notebookId: string, fileId: string) {
  const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!file) {
    const err: any = new Error("File not found");
    err.status = 404;
    throw err;
  }

  try {
    const src = await prisma.notebookSource.create({
      data: { notebookId, kind: "FILE", fileId },
    });

    // Durable ingestion enqueue job + track status
    await prisma.ingestionJob.upsert({
      where: { sourceId: src.id },
      create: { sourceId: src.id, status: "PENDING", attemptCount: 0 },
      update: { status: "PENDING", error: null },
    });

    await enqueueIngestionJob(src.id);

    return prisma.notebookSource.findUnique({
      where: { id: src.id },
      include: {
        url: true,
        file: true,
        ingestionJob: {
          select: { status: true, error: true, updatedAt: true },
        },
        embeddingJob: {
          select: { status: true, error: true, updatedAt: true },
        },
      },
    });
  } catch (e: any) {
    // Duplicate attach -> 409
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const err: any = new Error(
        "This file is already attached to the notebook.",
      );
      err.status = 409;
      throw err;
    }

    // Notebook does not exist (FK constraint) -> 404
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003"
    ) {
      const err: any = new Error("Notebook not found");
      err.status = 404;
      throw err;
    }

    throw e;
  }
}

export async function deleteSource(notebookId: string, sourceId: string) {
  const src = await prisma.notebookSource.findUnique({
    where: { id: sourceId },
  });
  if (!src || src.notebookId !== notebookId) return;

  // If you added SourcePage model, clean it too (or rely on cascade)
  await prisma.sourceChunk.deleteMany({ where: { sourceId } });
  // @ts-ignore - will exist after prisma migrate+generate if SourcePage is added
  await prisma.sourcePage?.deleteMany?.({ where: { sourceId } });

  await prisma.notebookSource.delete({ where: { id: sourceId } });
}

export async function createNote(
  notebookId: string,
  p: { title?: string; content: string; citations?: any },
) {
  return prisma.note.create({
    data: {
      notebookId,
      title: p.title ?? "",
      content: p.content,
      citations: p.citations ?? undefined,
    },
  });
}

export async function updateNote(
  notebookId: string,
  noteId: string,
  p: { title?: string; content?: string; citations?: any },
) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || note.notebookId !== notebookId)
    throw new Error("Note not found");
  return prisma.note.update({ where: { id: noteId }, data: p });
}

export async function deleteNote(notebookId: string, noteId: string) {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || note.notebookId !== notebookId) return false;

  await prisma.note.delete({ where: { id: noteId } });
  return true;
}

export async function getSourceChunk(chunkId: string) {
  return prisma.sourceChunk.findUnique({
    where: { id: chunkId },
    include: {
      source: { include: { url: true, file: true } },
    },
  });
}

export async function getChunkReader(chunkId: string, radius = 3) {
  const center = await prisma.sourceChunk.findUnique({
    where: { id: chunkId },
    include: { source: { include: { url: true, file: true } } },
  });

  if (!center) return null;

  const r = Math.max(0, Math.min(20, Number(radius || 3))); // clamp 0..20
  const lo = Math.max(0, center.idx - r);
  const hi = center.idx + r;

  const chunks = await prisma.sourceChunk.findMany({
    where: {
      sourceId: center.sourceId,
      revisionId: center.revisionId,
      idx: { gte: lo, lte: hi },
    },
    orderBy: { idx: "asc" },
    select: { id: true, idx: true, text: true },
  });

  const total = await prisma.sourceChunk.count({
    where: { sourceId: center.sourceId, revisionId: center.revisionId },
  });

  return {
    sourceId: center.sourceId,
    source: center.source,
    centerChunkId: center.id,
    centerIdx: center.idx,
    radius: r,
    totalChunks: total,
    chunks,
  };
}

export async function getSourcePage(sourceId: string, pageNumber: number) {
  const src = await prisma.notebookSource.findUnique({
    where: { id: sourceId },
    select: { activeRevisionId: true },
  });
  if (!src?.activeRevisionId) return null;

  return (prisma as any).sourcePage.findFirst({
    where: { sourceId, revisionId: src.activeRevisionId, pageNumber },
    select: {
      sourceId: true,
      revisionId: true,
      pageNumber: true,
      text: true,
      globalStart: true,
      globalEnd: true,
    },
  });
}

export async function pickNotebookCitations(
  notebookId: string,
  limit = 2,
  sourceIds?: string[],
) {
  const chunks = await prisma.sourceChunk.findMany({
    where: {
      revision: { isActive: true },
      source: { notebookId },
      ...(sourceIds?.length ? { sourceId: { in: sourceIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });

  return chunks.map((c) => ({ chunkId: c.id }));
}

/* ---------- helpers ---------- */

function splitTextWithOffsets(text: string, maxChars = 1400, overlap = 220) {
  const clean = (text || "").replace(/\u0000/g, "").replace(/\r/g, "");
  const out: { text: string; start: number; end: number }[] = [];

  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + maxChars);
    const raw = clean.slice(i, end);
    const chunk = raw.trim();

    if (chunk.length >= 40) {
      const leftTrim = raw.indexOf(chunk);
      const start = i + Math.max(0, leftTrim);
      const finish = start + chunk.length;
      out.push({ text: chunk, start, end: finish });
    }

    if (end >= clean.length) break;
    i = Math.max(0, end - overlap);
  }

  return out;
}

function roughTokens(s: string) {
  return Math.ceil((s || "").length / 4);
}

export async function createChunksForSource(
  sourceId: string,
  payload: {
    fullText: string;
    pages?: { pageNumber: number; text: string }[];
    documentRevisionId?: string | null;
    pipelineConfigId?: string | null;
  },
) {
  const fullText = payload.fullText || "";
  const chunks = splitTextWithOffsets(fullText, 1400, 220);
  if (!chunks.length) return;

  // Each ingestion produces a new SourceRevision. Old evidence remains immutable.
  const contentHash = crypto
    .createHash("sha256")
    .update(fullText)
    .digest("hex");

  const maxOrd = await prisma.sourceRevision.aggregate({
    where: { sourceId },
    _max: { ordinal: true },
  });
  const nextOrdinal = (maxOrd._max.ordinal ?? 0) + 1;

  // Deactivate old revisions + create a new active one
  await prisma.sourceRevision.updateMany({
    where: { sourceId, isActive: true },
    data: { isActive: false },
  });

  const revision = await prisma.sourceRevision.create({
    data: {
      sourceId,
      ordinal: nextOrdinal,
      contentHash,
      isActive: true,
      documentRevisionId: payload.documentRevisionId ?? null,
      pipelineConfigId: payload.pipelineConfigId ?? null,
    },
    select: { id: true },
  });

  // Pin notebook source to this active revision
  await prisma.notebookSource.update({
    where: { id: sourceId },
    data: { activeRevisionId: revision.id },
  });

  // If we have pages, store them with global offsets
  let pageRanges:
    | { pageNumber: number; globalStart: number; globalEnd: number }[]
    | null = null;

  if (payload.pages?.length) {
    let offset = 0;
    const SEP = "\n\n"; // MUST match how fullText is constructed (join with \n\n)
    pageRanges = [];

    // @ts-ignore - prisma.sourcePage exists after schema/migrate/generate
    const pageCreates = payload.pages.map((p, idx) => {
      const start = offset;
      const isLast = idx === payload.pages!.length - 1;
      const pageText = (p.text || "") + (isLast ? "" : SEP);
      offset += pageText.length;
      const end = offset;

      pageRanges!.push({
        pageNumber: p.pageNumber,
        globalStart: start,
        globalEnd: end,
      });

      return prisma.sourcePage.create({
        data: {
          sourceId,
          revisionId: revision.id,
          pageNumber: p.pageNumber,
          text: p.text || "",
          globalStart: start,
          globalEnd: end,
        },
      });
    });

    await prisma.$transaction(pageCreates);
  }

  function mapGlobalStart(globalPos: number) {
    if (!pageRanges?.length) return null;
    const r =
      pageRanges.find(
        (x) => globalPos >= x.globalStart && globalPos < x.globalEnd,
      ) ?? pageRanges[pageRanges.length - 1];
    return {
      pageNumber: r.pageNumber,
      char: Math.max(0, globalPos - r.globalStart),
    };
  }

  function mapGlobalEnd(globalPos: number) {
    if (!pageRanges?.length) return null;
    const pos = Math.max(0, globalPos - 1); // end boundary: map to the preceding char
    const r =
      pageRanges.find((x) => pos >= x.globalStart && pos < x.globalEnd) ??
      pageRanges[pageRanges.length - 1];
    return {
      pageNumber: r.pageNumber,
      char: Math.max(0, globalPos - r.globalStart),
    };
  }

  await prisma.$transaction(
    chunks.map((c, idx) => {
      const s = mapGlobalStart(c.start);
      const e = mapGlobalEnd(c.end);

      return prisma.sourceChunk.create({
        data: {
          sourceId,
          revisionId: revision.id,
          idx,
          text: c.text,
          tokens: roughTokens(c.text),

          globalStart: c.start,
          globalEnd: c.end,

          pageStart: s?.pageNumber ?? null,
          pageEnd: e?.pageNumber ?? null,
          charStart: s?.char ?? null,
          charEnd: e?.char ?? null,
        } as any,
        select: { id: true },
      });
    }),
  );

  // Queue embeddings (durable + retryable)
  if (!env.OPENAI_ENABLED) return;

  await prisma.embeddingJob.upsert({
    where: { sourceId },
    create: { sourceId, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueEmbeddingJob(sourceId);
}
