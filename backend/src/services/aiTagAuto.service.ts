import { TaggingStatus } from "../generated/prisma/client";
import prisma from "../config/database";
import { createJobFromFile, getJob } from "./pyTaggerClient";
import {
  getAiTaggingUnavailableMessage,
  getFileCapability,
} from "../utils/fileCapabilities";

const TOPK = Number(process.env.TAGS_TOPK || 10);
const USE_LLM = (process.env.TAGS_USE_LLM || "false").toLowerCase() === "true";

// Poll tuning
const MAX_WAIT_MS = Number(process.env.TAGS_JOB_MAX_WAIT_MS || 4 * 60 * 1000); // 4 min
const INITIAL_DELAY_MS = Number(process.env.TAGS_JOB_POLL_INITIAL_MS || 1000); // 1s
const MAX_DELAY_MS = Number(process.env.TAGS_JOB_POLL_MAX_MS || 8000); // 8s

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function mergeUnique(
  existing: string[] | null | undefined,
  incoming: string[] | null | undefined,
) {
  return Array.from(new Set([...(existing || []), ...(incoming || [])]));
}

/**
 * Runs Python ai-tagger for an existing StoredFile row and persists results when done.
 * Safe to call multiple times (merges tags).
 */
export async function runAiTagForFile(
  fileId: string,
  opts?: { force?: boolean },
) {
  const force = Boolean(opts?.force);

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
    };
  }

  // Avoid duplicate work unless forced
  if (
    !force &&
    rec.taggerVersion &&
    rec.contentHash &&
    (rec.tags?.length || 0) > 0
  ) {
    return { skipped: true as const, reason: "already_tagged" as const };
  }

  const { jobId } = await createJobFromFile(rec.storagePath, TOPK, USE_LLM);

  await prisma.storedFile.update({
    where: { id: String(fileId) },
    data: {
      taggingStatus: TaggingStatus.RUNNING,
      taggingJobId: jobId,
      taggingError: null,
    },
  });

  const startedAt = Date.now();
  let delay = INITIAL_DELAY_MS;

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(
        `ai-tagger job timed out for fileId=${fileId} jobId=${jobId}`,
      );
    }

    let data: any;
    try {
      data = await getJob(jobId);
    } catch (e) {
      console.warn(
        "[aiTagAuto] getJob transient error",
        { fileId, jobId, delay },
        e,
      );
      await sleep(delay);
      delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.3));
      continue;
    }

    if (data?.state === "SUCCESS") {
      const tags = Array.isArray(data?.tags) ? data.tags : [];
      const phrases = Array.isArray(data?.phrases) ? data.phrases : [];
      const unigrams = Array.isArray(data?.unigrams) ? data.unigrams : [];
      const structured = data?.structured ?? null;
      const extraction = data?.extraction ?? null;

      const latest = await prisma.storedFile.findUnique({
        where: { id: String(fileId) },
        select: { tags: true, tagsMeta: true },
      });

      const merged = mergeUnique(latest?.tags, tags);

      await prisma.storedFile.update({
        where: { id: String(fileId) },
        data: {
          tags: { set: merged },
          contentHash: data?.hash ?? null,
          taggerVersion: data?.tagger_version ?? null,
          tagsMeta: {
            ...((latest?.tagsMeta as any) || {}),
            tagger: {
              phrases: phrases || [],
              unigrams: unigrams || [],
              structured: structured || null,
              extraction: extraction || null,
              topk: TOPK,
              use_llm: USE_LLM,
              jobId,
              updatedAt: new Date().toISOString(),
            },
            aiTagger: {
              phrases,
              unigrams,
            },
          } as any,
          taggingStatus: TaggingStatus.SUCCESS,
          taggingJobId: null,
          taggingError: null,
        },
      });

      return { skipped: false as const, jobId, tags: merged };
    }

    if (data?.state === "FAILURE") {
      const err = data?.error || data?.message || "Unknown ai-tagger failure";
      throw new Error(
        `ai-tagger failed for fileId=${fileId} jobId=${jobId}: ${err}`,
      );
    }

    await sleep(delay);
    delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.3));
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

      await runAiTagForFile(fileId, opts);
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
