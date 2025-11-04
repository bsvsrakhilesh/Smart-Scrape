// backend/src/services/tag.service.ts
import { PrismaClient } from "@prisma/client";
import { extractTextFromUrl, extractTextFromFile } from "./extract.service";
import { tagText } from "./tagger";

const prisma = new PrismaClient();

// Tunables (aligned with dist/services/tag.service.js)
const TAGS_TOPK     = Number(process.env.TAGS_TOPK ?? 20);
const TAGS_MAX_GRAM = Number(process.env.TAGS_MAX_GRAM ?? 3);
const TAGS_PMI      = Number(process.env.TAGS_PMI ?? 1.2);

/**
 * Auto-tag a URL record that was just created.
 * Mirrors the behavior in dist/services/tag.service.js so dev == prod.
 */
export async function tagUrlRecord(id: number, url: string) {
  const raw = await extractTextFromUrl(url);
  const { phrases, unigrams, combined } = tagText(raw, {
    topk: TAGS_TOPK,
    maxGram: TAGS_MAX_GRAM,
    pmiThresh: TAGS_PMI,
  });

  // Prefer writing tags; add meta if the columns exist in schema (they do in your Prisma)
  try {
    await prisma.url.update({
      where: { id },
      data: {
        tags: combined,
        tagsMeta: { phrases, unigrams } as any,
      },
    });
  } catch {
    // Fallback if tagsMeta type mismatch in older DBs
    await prisma.url.update({
      where: { id },
      data: { tags: combined },
    });
  }
  return combined;
}

/**
 * Auto-tag a StoredFile record after upload/finalize.
 * Mirrors dist/services/tag.service.js for dev parity.
 */
export async function tagFileRecord(id: string, filePath: string, mimeType: string) {
  const raw = await extractTextFromFile(filePath, mimeType);
  const { phrases, unigrams, combined } = tagText(raw, {
    topk: TAGS_TOPK,
    maxGram: TAGS_MAX_GRAM,
    pmiThresh: TAGS_PMI,
  });

  try {
    await prisma.storedFile.update({
      where: { id: String(id) },
      data: {
        tags: combined,
        tagsMeta: { phrases, unigrams } as any,
      },
    });
  } catch {
    await prisma.storedFile.update({
      where: { id: String(id) },
      data: { tags: combined },
    });
  }
  return combined;
}

/**
 * Keep your crawler helper so /api/crawl/* continues to schedule tagging.
 * We simply fetch the file and delegate to tagFileRecord asynchronously.
 */
export async function scheduleFileAutoTag(_prisma: PrismaClient, fileId: string) {
  setImmediate(async () => {
    try {
      const f = await prisma.storedFile.findUnique({ where: { id: String(fileId) } });
      if (!f || !f.storagePath) return;
      await tagFileRecord(String(f.id), String(f.storagePath), String(f.mimeType || "application/octet-stream"));
    } catch (e) {
      console.error("[tag.service] scheduleFileAutoTag failed", fileId, e);
    }
  });
}
