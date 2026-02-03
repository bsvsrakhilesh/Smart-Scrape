// backend/src/services/document.service.ts
import prisma from "../config/database";

/**
 * Ensures a global canonical Document + DocumentRevision exist for a StoredFile.
 * Returns the documentRevisionId that represents THIS storedFile capture.
 *
 * Rules:
 * - URL_TEXT / URL_PDF snapshots map to Document(kind=URL, urlId=...)
 * - UPLOAD (and other non-URL captures) map to Document(kind=FILE, primaryFileId=<this file>)
 * - DocumentRevision is 1:1 with StoredFile (storedFileId is unique)
 */
export async function ensureDocumentRevisionForStoredFile(storedFileId: string) {
  const f = await prisma.storedFile.findUnique({
    where: { id: storedFileId },
    select: {
      id: true,
      urlId: true,
      captureType: true,
      contentHash: true,
      sha256: true,
      sourceUrl: true,
    },
  });

  if (!f) throw new Error(`StoredFile not found: ${storedFileId}`);

  // Already linked?
  const existing = await prisma.documentRevision.findUnique({
    where: { storedFileId },
    select: { id: true, documentId: true },
  });
  if (existing) return existing;

  let documentId: string;

  const isUrlSnapshot = f.captureType === "URL_TEXT" || f.captureType === "URL_PDF";

  if (isUrlSnapshot) {
    // Ensure we have a urlId. If crawl saved without urlId, repair using sourceUrl.
    let urlId = f.urlId ?? null;

    if (!urlId) {
      if (!f.sourceUrl) {
        throw new Error(
          `URL snapshot StoredFile(${storedFileId}) missing urlId and sourceUrl`,
        );
      }

      const u = await prisma.url.upsert({
        where: { url: f.sourceUrl },
        update: {},
        create: {
          url: f.sourceUrl,
          title: f.sourceUrl,
          snippet: null,
          tags: [],
          isFavorited: false,
        },
        select: { id: true },
      });

      urlId = u.id;

      // Repair storedFile.urlId so future queries work
      await prisma.storedFile.update({
        where: { id: storedFileId },
        data: { urlId },
      });
    }

    const doc = await prisma.document.upsert({
      where: { urlId },
      update: {},
      create: { kind: "URL", urlId },
      select: { id: true },
    });

    documentId = doc.id;
  } else {
    // Uploads: the file itself is the canonical document anchor (v1)
    const doc = await prisma.document.upsert({
      where: { primaryFileId: storedFileId },
      update: {},
      create: { kind: "FILE", primaryFileId: storedFileId },
      select: { id: true },
    });

    documentId = doc.id;
  }

  const maxOrd = await prisma.documentRevision.aggregate({
    where: { documentId },
    _max: { ordinal: true },
  });
  const nextOrdinal = (maxOrd._max.ordinal ?? 0) + 1;

  const contentHash = f.contentHash ?? f.sha256 ?? null;

  const rev = await prisma.documentRevision.create({
    data: {
      documentId,
      ordinal: nextOrdinal,
      storedFileId,
      captureType: f.captureType as any,
      contentHash,
    },
    select: { id: true, documentId: true },
  });

  return rev;
}
