// backend/src/services/aiTagAuto.service.ts
import prisma from "../config/database";
import { createJobFromFile, getJob } from "./pyTaggerClient";

const TOPK = Number(process.env.TAGS_TOPK || 10);
const USE_LLM = (process.env.TAGS_USE_LLM || "false").toLowerCase() === "true";

// Poll tuning
const MAX_WAIT_MS = Number(process.env.TAGS_JOB_MAX_WAIT_MS || 4 * 60 * 1000); // 4 minutes
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
 * - Safe to call multiple times (merges tags)
 * - Skips if file already has ai-tagger output unless force=true
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

  // Avoid duplicate work unless explicitly forced
  if (
    !force &&
    rec.taggerVersion &&
    rec.contentHash &&
    (rec.tags?.length || 0) > 0
  ) {
    return { skipped: true as const, reason: "already_tagged" as const };
  }

  const { jobId } = await createJobFromFile(rec.storagePath, TOPK, USE_LLM);

  const startedAt = Date.now();
  let delay = INITIAL_DELAY_MS;

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(
        `ai-tagger job timed out for fileId=${fileId} jobId=${jobId}`,
      );
    }

    const data = await getJob(jobId);

    if (data?.state === "SUCCESS") {
      const tags = Array.isArray(data?.tags) ? data.tags : [];
      const phrases = Array.isArray(data?.phrases) ? data.phrases : [];
      const unigrams = Array.isArray(data?.unigrams) ? data.unigrams : [];

      const merged = mergeUnique(rec.tags, tags);

      await prisma.storedFile.update({
        where: { id: String(fileId) },
        data: {
          tags: { set: merged },
          contentHash: data?.hash ?? null,
          taggerVersion: data?.tagger_version ?? null,
          tagsMeta: {
            ...((rec.tagsMeta as any) || {}),
            aiTagger: { phrases, unigrams },
          } as any,
        },
      });

      return { skipped: false as const, jobId, tags: merged };
    }

    if (data?.state === "FAILURE") {
      // Surface useful error info if present
      const err = data?.error || data?.message || "Unknown ai-tagger failure";
      throw new Error(
        `ai-tagger failed for fileId=${fileId} jobId=${jobId}: ${err}`,
      );
    }

    // PENDING / STARTED / RETRY / etc.
    await sleep(delay);
    delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.3));
  }
}

/**
 * Fire-and-forget wrapper (doesn't block request thread).
 */
export function scheduleAiTagForFile(
  fileId: string,
  opts?: { force?: boolean },
) {
  setImmediate(async () => {
    try {
      await runAiTagForFile(fileId, opts);
    } catch (e) {
      console.error("[aiTagAuto] scheduleAiTagForFile failed", { fileId }, e);
    }
  });
}
