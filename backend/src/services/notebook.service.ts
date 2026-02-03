import prisma from "../config/database";
import { env } from "../config/env";
import { extractTextFromUrl, extractTextFromFile } from "./extract.service";
import { enqueueEmbeddingJob } from "../queues/embedding.queue";
import { enqueueIngestionJob } from "../queues/ingestion.queue";
import crypto from "crypto";

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
    include: { url: true, file: true },
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
    include: { url: true, file: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function attachUrlSource(notebookId: string, urlId: number) {
  const url = await prisma.url.findUnique({ where: { id: urlId } });
  if (!url) throw new Error("URL not found");

  const src = await prisma.notebookSource.create({
    data: { notebookId, kind: "URL", urlId },
  });

  // Durable ingestion (Phase 3): enqueue job + track status
  await prisma.ingestionJob.upsert({
    where: { sourceId: src.id },
    create: { sourceId: src.id, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueIngestionJob(src.id);

  return prisma.notebookSource.findUnique({
    where: { id: src.id },
    include: { url: true, file: true },
  });
}

export async function attachFileSource(notebookId: string, fileId: string) {
  const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!file) throw new Error("File not found");

  const src = await prisma.notebookSource.create({
    data: { notebookId, kind: "FILE", fileId },
  });

  // Durable ingestion (Phase 3): enqueue job + track status
  await prisma.ingestionJob.upsert({
    where: { sourceId: src.id },
    create: { sourceId: src.id, status: "PENDING", attemptCount: 0 },
    update: { status: "PENDING", error: null },
  });

  await enqueueIngestionJob(src.id);

  return prisma.notebookSource.findUnique({
    where: { id: src.id },
    include: { url: true, file: true },
  });
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
      idx: { gte: lo, lte: hi },
    },
    orderBy: { idx: "asc" },
    select: { id: true, idx: true, text: true },
  });

  const total = await prisma.sourceChunk.count({
    where: { sourceId: center.sourceId },
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
  // safer than compound unique name guessing
  return (prisma as any).sourcePage.findFirst({
    where: { sourceId, pageNumber },
    select: {
      sourceId: true,
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
  payload: { fullText: string; pages?: { pageNumber: number; text: string }[] },
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
