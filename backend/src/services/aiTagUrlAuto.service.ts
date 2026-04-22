// backend/src/services/aiTagUrlAuto.service.ts
import { TaggingStatus } from "../generated/prisma/client";
import prisma from "../config/database";
import { createJobFromFile, createJobFromUrl } from "./pyTaggerClient";
import { finalizeAiTagJobForUrl } from "./aiTagJobFinalize.service";
import { persistAiTagFailureForUrl } from "./aiTagPersistence.service";

const TOPK = Number(process.env.TAGS_TOPK || 10);
const USE_LLM = (process.env.TAGS_USE_LLM || "false").toLowerCase() === "true";

/**
 * Runs Python ai-tagger for an existing Url row and persists results when done.
 * This now uses the same finalization path as the manual route.
 */
export async function runAiTagForUrl(
  urlId: number,
  opts?: { force?: boolean; throwOnTerminalFailure?: boolean },
) {
  const force = Boolean(opts?.force);
  const throwOnTerminalFailure = opts?.throwOnTerminalFailure !== false;

  const rec = await prisma.url.findUnique({ where: { id: urlId } });
  if (!rec) throw new Error(`Url not found: ${urlId}`);

  if (
    !force &&
    rec.taggerVersion &&
    rec.contentHash &&
    (rec.tags?.length || 0) > 0
  ) {
    return {
      skipped: true as const,
      reason: "already_tagged" as const,
      tags: rec.tags || [],
    };
  }

  const latestSnapshot = await prisma.storedFile.findFirst({
    where: { urlId },
    orderBy: { createdAt: "desc" },
    select: { storagePath: true, mimeType: true, captureType: true },
  });

  let jobId: string;

  if (latestSnapshot?.storagePath) {
    const created = await createJobFromFile(
      latestSnapshot.storagePath,
      TOPK,
      USE_LLM,
    );
    jobId = created.jobId;
  } else {
    const created = await createJobFromUrl(rec.url, TOPK, USE_LLM);
    jobId = created.jobId;
  }

  await prisma.url.update({
    where: { id: urlId },
    data: {
      taggingStatus: TaggingStatus.RUNNING,
      taggingJobId: jobId,
      taggingError: null,
    },
  });

  try {
    const data = await finalizeAiTagJobForUrl(urlId, jobId);

    if (data?.state === "FAILURE") {
      const err = data?.error || data?.message || "Unknown ai-tagger failure";

      if (throwOnTerminalFailure) {
        throw new Error(
          `ai-tagger failed for urlId=${urlId} jobId=${jobId}: ${err}`,
        );
      }

      return {
        skipped: false as const,
        failed: true as const,
        jobId,
        tags: [] as string[],
      };
    }

    const latest = await prisma.url.findUnique({
      where: { id: urlId },
      select: { tags: true },
    });

    return {
      skipped: false as const,
      jobId,
      tags: latest?.tags ?? (Array.isArray(data?.tags) ? data.tags : []),
    };
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown ai-tagger error").slice(
      0,
      500,
    );

    await persistAiTagFailureForUrl(urlId, jobId, { error: msg });

    if (throwOnTerminalFailure) throw e;

    return {
      skipped: false as const,
      failed: true as const,
      jobId,
      tags: [] as string[],
    };
  }
}

/** Fire-and-forget wrapper */
export function scheduleAiTagForUrl(urlId: number, opts?: { force?: boolean }) {
  setImmediate(async () => {
    try {
      await prisma.url.update({
        where: { id: urlId },
        data: {
          taggingStatus: TaggingStatus.PENDING,
          taggingError: null,
        },
      });

      await runAiTagForUrl(urlId, {
        ...(opts || {}),
        throwOnTerminalFailure: false,
      });
    } catch (e: any) {
      const msg = String(e?.message || e || "Unknown error").slice(0, 500);

      try {
        await prisma.url.update({
          where: { id: urlId },
          data: {
            taggingStatus: TaggingStatus.FAILED,
            taggingJobId: null,
            taggingError: msg,
          },
        });
      } catch {}

      console.error("[aiTagUrlAuto] scheduleAiTagForUrl failed", { urlId }, e);
    }
  });
}
