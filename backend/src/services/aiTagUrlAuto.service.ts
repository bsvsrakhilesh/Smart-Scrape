// backend/src/services/aiTagUrlAuto.service.ts
import { TaggingStatus } from "../generated/prisma/client";
import prisma from "../config/database";
import { createJobFromUrl, getJob } from "./pyTaggerClient";

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
 * Runs Python ai-tagger for an existing Url row and persists results when done.
 * Safe to call multiple times (merges tags).
 */
export async function runAiTagForUrl(
  urlId: number,
  opts?: { force?: boolean },
) {
  const force = Boolean(opts?.force);

  const rec = await prisma.url.findUnique({ where: { id: urlId } });
  if (!rec) throw new Error(`Url not found: ${urlId}`);

  // Avoid duplicate work unless forced
  if (
    !force &&
    rec.taggerVersion &&
    rec.contentHash &&
    (rec.tags?.length || 0) > 0
  ) {
    return { skipped: true as const, reason: "already_tagged" as const };
  }

  const { jobId } = await createJobFromUrl(rec.url, TOPK, USE_LLM);
  await prisma.url.update({
    where: { id: urlId },
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
        `ai-tagger job timed out for urlId=${urlId} jobId=${jobId}`,
      );
    }

    let data: any;
    try {
      data = await getJob(jobId);
    } catch (e) {
      // Treat as transient (network hiccup / timeout / tagger under load).
      // Keep polling until MAX_WAIT_MS instead of failing the whole auto-tag run.
      console.warn(
        "[aiTagUrlAuto] getJob transient error",
        { urlId, jobId, delay },
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

      const latest = await prisma.url.findUnique({
        where: { id: urlId },
        select: { tags: true, tagsMeta: true },
      });

      const merged = mergeUnique(latest?.tags, tags);

      await prisma.url.update({
        where: { id: urlId },
        data: {
          tags: { set: merged },
          contentHash: data?.hash ?? null,
          taggerVersion: data?.tagger_version ?? null,
          tagsMeta: {
            ...((rec.tagsMeta as any) || {}),
            tagger: {
              phrases,
              unigrams,
              structured,
              topk: TOPK,
              use_llm: USE_LLM,
              jobId,
              updatedAt: new Date().toISOString(),
            },
            
            aiTagger: { phrases, unigrams },
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
        `ai-tagger failed for urlId=${urlId} jobId=${jobId}: ${err}`,
      );
    }

    await sleep(delay);
    delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.3));
  }
}

/** Fire-and-forget wrapper */
export function scheduleAiTagForUrl(urlId: number, opts?: { force?: boolean }) {
  setImmediate(async () => {
    try {
      // Show status immediately in UI
      await prisma.url.update({
        where: { id: urlId },
        data: {
          taggingStatus: TaggingStatus.PENDING,
          taggingError: null,
        },
      });

      await runAiTagForUrl(urlId, opts);
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
