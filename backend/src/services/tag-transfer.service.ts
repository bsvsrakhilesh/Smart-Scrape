import type { PrismaClient } from "@prisma/client";
import { mergeTags, mergeTagsMeta, TagMeta } from "../utils/tags";
import type { StoredFileId, UrlId } from "../types/prisma-ids";

/**
 * Copy URL tags onto a StoredFile, merging with existing file tags.
 * Works with String or Int ids because types come from Prisma.
 */
export async function copyUrlTagsToFile(
  prisma: PrismaClient,
  urlId: UrlId,
  fileId: StoredFileId
) {
  await prisma.$transaction(async (tx) => {
    const [src, file] = await Promise.all([
      tx.url.findUnique({
        where: { id: urlId },
        select: { tags: true, tagsMeta: true },
      }),
      tx.storedFile.findUnique({
        where: { id: fileId },
        select: { tags: true, tagsMeta: true },
      }),
    ]);

    if (!file) return;

    const mergedTags = mergeTags(file.tags, src?.tags ?? []);
    const mergedMeta = mergeTagsMeta(
      (file.tagsMeta as TagMeta[] | null) ?? [],
      (src?.tagsMeta as TagMeta[] | null) ?? []
    );

    await tx.storedFile.update({
      where: { id: fileId },
      data: { tags: mergedTags, tagsMeta: mergedMeta as unknown as any },
    });
  });
}
