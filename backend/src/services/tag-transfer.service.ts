import type { PrismaClient } from "../generated/prisma/client";
import { TaggingStatus } from "../generated/prisma/client";
import type { StoredFileId, UrlId } from "../types/prisma-ids";
import {
  deriveSeparatedTags,
  mergeUniqueTags,
  withSeparatedTagsMeta,
} from "../utils/tagBuckets";

function asMetaRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function hasAiTaggerPayload(meta: Record<string, any>) {
  const tagger = asMetaRecord(meta.tagger);
  const aiTagger = asMetaRecord(meta.aiTagger);

  return Boolean(
    (Array.isArray(tagger.aiTags) && tagger.aiTags.length > 0) ||
      (Array.isArray(aiTagger.tags) && aiTagger.tags.length > 0) ||
      tagger.structured ||
      aiTagger.structured ||
      tagger.aiTagObjects ||
      aiTagger.tagObjects,
  );
}

/**
 * Copy URL tags onto a StoredFile, merging with existing file tags.
 * Preserves separated user/AI tag buckets so captured files do not need
 * to re-run the tagger when the Saved URL already has AI tag metadata.
 * Works with String or Int ids because types come from Prisma.
 */
export async function copyUrlTagsToFile(
  prisma: PrismaClient,
  urlId: UrlId,
  fileId: StoredFileId,
) {
  return prisma.$transaction(async (tx) => {
    const [src, file] = await Promise.all([
      tx.url.findUnique({
        where: { id: urlId },
        select: {
          tags: true,
          tagsMeta: true,
          taggerVersion: true,
          taggingStatus: true,
          publishedAt: true,
          authors: true,
        },
      }),
      tx.storedFile.findUnique({
        where: { id: fileId },
        select: {
          tags: true,
          tagsMeta: true,
          taggerVersion: true,
          sourcePublishedAt: true,
          sourceAuthors: true,
        },
      }),
    ]);

    if (!src || !file) {
      return { copied: false, copiedAiTags: false };
    }

    const fileState = deriveSeparatedTags(file.tags, file.tagsMeta);
    const srcState = deriveSeparatedTags(src.tags, src.tagsMeta);

    const nextUserTags = mergeUniqueTags(
      fileState.userTags,
      srcState.userTags,
    );
    const nextAiTags = mergeUniqueTags(fileState.aiTags, srcState.aiTags);
    const nextEffectiveTags = mergeUniqueTags(
      file.tags,
      src.tags,
      nextUserTags,
      nextAiTags,
    );

    const srcMeta = asMetaRecord(src.tagsMeta);
    const fileMeta = asMetaRecord(file.tagsMeta);
    const copiedAiTags =
      srcState.aiTags.length > 0 ||
      src.taggingStatus === TaggingStatus.SUCCESS ||
      hasAiTaggerPayload(srcMeta);

    const mergedMeta = withSeparatedTagsMeta(
      {
        ...srcMeta,
        ...fileMeta,
        tagTransfer: {
          from: "url",
          urlId,
          transferredAt: new Date().toISOString(),
        },
      },
      {
        userTags: nextUserTags,
        aiTags: nextAiTags,
      },
    );

    await tx.storedFile.update({
      where: { id: fileId },
      data: {
        tags: { set: nextEffectiveTags },
        tagsMeta: mergedMeta as any,
        sourcePublishedAt: file.sourcePublishedAt ?? src.publishedAt ?? null,
        sourceAuthors: file.sourceAuthors.length
          ? file.sourceAuthors
          : src.authors,
        ...(copiedAiTags
          ? {
              taggerVersion: file.taggerVersion ?? src.taggerVersion ?? null,
              taggingStatus: TaggingStatus.SUCCESS,
              taggingJobId: null,
              taggingError: null,
            }
          : {}),
      },
    });

    return {
      copied: nextEffectiveTags.length > 0,
      copiedAiTags,
    };
  });
}
