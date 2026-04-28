import { TaggingStatus } from "../generated/prisma/client";
import prisma from "../config/database";
import { createJobFromFile } from "./pyTaggerClient";
import { startOrReuseAiTagJobForFile } from "./aiTagJobStart.service";
import { finalizeAiTagJobForFile } from "./aiTagJobFinalize.service";
import { persistAiTagFailureForFile } from "./aiTagPersistence.service";
import {
  getAiTaggingUnavailableMessage,
  getFileCapability,
} from "../utils/fileCapabilities";

const TOPK = Number(process.env.TAGS_TOPK || 10);
const USE_LLM = (process.env.TAGS_USE_LLM || "true").toLowerCase() === "true";

/**
 * Runs Python ai-tagger for an existing StoredFile row and persists results when done.
 * This now uses the same finalization path as the manual route.
 */
export async function runAiTagForFile(
  fileId: string,
  opts?: { force?: boolean; throwOnTerminalFailure?: boolean },
) {
  const force = Boolean(opts?.force);
  const throwOnTerminalFailure = opts?.throwOnTerminalFailure !== false;

  const rec = await prisma.storedFile.findUnique({
    where: { id: String(fileId) },
  });

  if (!rec) throw new Error(`StoredFile not found: ${fileId}`);
  if (!rec.storagePath)
    throw new Error(`StoredFile.storagePath missing: ${fileId}`);

  const capability = getFileCapability(rec.fileName, rec.mimeType);
  if (!capability.aiTagSupported) {
    const msg = getAiTaggingUnavailableMessage(rec.fileName, rec.mimeType);

    await prisma.storedFile.update({
      where: { id: String(fileId) },
      data: {
        taggingStatus: "NONE",
        taggingJobId: null,
        taggingError: msg,
      },
    });

    return {
      skipped: true as const,
      reason: "unsupported_type" as const,
      message: msg,
      tags: rec.tags || [],
    };
  }

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

  const started = await startOrReuseAiTagJobForFile({
    fileId: String(fileId),
    startJob: () => createJobFromFile(rec.storagePath, TOPK, USE_LLM),
  });

  const jobId = started.jobId;

  try {
    const data = await finalizeAiTagJobForFile(String(fileId), jobId);

    if (data?.state === "FAILURE") {
      const err = data?.error || data?.message || "Unknown ai-tagger failure";

      if (throwOnTerminalFailure) {
        throw new Error(
          `ai-tagger failed for fileId=${fileId} jobId=${jobId}: ${err}`,
        );
      }

      return {
        skipped: false as const,
        failed: true as const,
        jobId,
        tags: [] as string[],
      };
    }

    const latest = await prisma.storedFile.findUnique({
      where: { id: String(fileId) },
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

    await persistAiTagFailureForFile(String(fileId), jobId, { error: msg });

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
export function scheduleAiTagForFile(
  fileId: string,
  opts?: { force?: boolean },
) {
  setImmediate(async () => {
    try {
      await prisma.storedFile.update({
        where: { id: String(fileId) },
        data: {
          taggingStatus: TaggingStatus.PENDING,
          taggingJobId: null,
          taggingError: null,
        },
      });

      await runAiTagForFile(String(fileId), {
        ...(opts || {}),
        throwOnTerminalFailure: false,
      });
    } catch (e: any) {
      const msg = String(e?.message || e || "Unknown error").slice(0, 500);

      try {
        await prisma.storedFile.update({
          where: { id: String(fileId) },
          data: {
            taggingStatus: TaggingStatus.FAILED,
            taggingJobId: null,
            taggingError: msg,
          },
        });
      } catch {}

      console.error("[aiTagAuto] scheduleAiTagForFile failed", { fileId }, e);
    }
  });
}
