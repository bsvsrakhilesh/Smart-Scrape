import { PrismaClient } from "@prisma/client";
import { extractTextFromUrl, extractTextFromFile } from "./extract.service";
const prisma = new PrismaClient();

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
  p: { title?: string; description?: string }
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

  // Extract + chunk in the background (best-effort)
  void (async () => {
    try {
      const fullText = await extractTextFromUrl(url.url);
      await createChunksForSource(src.id, fullText);
    } catch {
      // Fall back to metadata if extraction fails
      const fallback = `${url.title ?? ""}\n${url.url}\n${
        url.snippet ?? ""
      }`.trim();
      await createChunksForSource(src.id, fallback);
    }
  })();

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

  // Extract + chunk in the background (best-effort)
  void (async () => {
    try {
      const fullText = await extractTextFromFile(
        file.storagePath,
        file.mimeType
      );
      const header = `FILE: ${file.fileName}\nMIME: ${file.mimeType}\n\n`;
      await createChunksForSource(src.id, (header + fullText).trim());
    } catch {
      const fallback = `File: ${file.fileName} (${file.mimeType})`;
      await createChunksForSource(src.id, fallback);
    }
  })();

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
  await prisma.sourceChunk.deleteMany({ where: { sourceId } });
  await prisma.notebookSource.delete({ where: { id: sourceId } });
}

export async function createNote(
  notebookId: string,
  p: { title?: string; content: string; citations?: any }
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
  p: { title?: string; content?: string; citations?: any }
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

export async function pickNotebookCitations(
  notebookId: string,
  limit = 2,
  sourceIds?: string[]
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
function splitText(text: string, maxChars = 1400, overlap = 220) {
  const clean = (text || "").replace(/\u0000/g, "").replace(/\r/g, "");
  const out: string[] = [];
  let i = 0;

  while (i < clean.length) {
    const end = Math.min(clean.length, i + maxChars);
    let chunk = clean.slice(i, end).trim();

    // Avoid tiny chunks
    if (chunk.length >= 40) out.push(chunk);

    if (end >= clean.length) break;
    i = Math.max(0, end - overlap); // overlap
  }

  return out;
}

function roughTokens(s: string) {
  return Math.ceil((s || "").length / 4);
}

async function createChunksForSource(sourceId: string, text: string) {
  const chunks = splitText(text || "", 1400, 220);
  if (!chunks.length) return;

  // Re-ingestion safe: wipe old chunks then re-create
  await prisma.sourceChunk.deleteMany({ where: { sourceId } });

  await prisma.$transaction(
    chunks.map((t, idx) =>
      prisma.sourceChunk.create({
        data: { sourceId, idx, text: t, tokens: roughTokens(t) },
      })
    )
  );
}