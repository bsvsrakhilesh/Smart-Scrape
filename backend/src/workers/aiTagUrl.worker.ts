import { Worker, type ConnectionOptions, type Job } from "bullmq";
import prisma from "../config/database";
import { env } from "../config/env";
import { TaggingStatus } from "../generated/prisma/client";
import { runAiTagForUrl } from "../services/aiTagUrlAuto.service";
import type { AiTagUrlQueueJobData } from "../queues/aiTagUrl.queue";

function bullConnection(): ConnectionOptions {
  const u = new URL(env.REDIS_URL);

  return {
    host: u.hostname,
    port: Number(u.port || "6379"),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname ? Number(u.pathname.replace("/", "") || "0") : 0,
    maxRetriesPerRequest: null,
  };
}

const concurrency = Math.max(1, env.AI_TAG_URL_QUEUE_CONCURRENCY || 1);

export const aiTagUrlWorker = new Worker<AiTagUrlQueueJobData>(
  "ai-tag-url",
  async (job: Job<AiTagUrlQueueJobData>) => {
    const urlId = Number(job.data.urlId);

    if (!Number.isFinite(urlId)) {
      throw new Error(
        `Invalid URL id in ai-tag-url queue job: ${job.data.urlId}`,
      );
    }

    await job.updateProgress(5);

    try {
      const result = await runAiTagForUrl(urlId, {
        force: Boolean(job.data.force),
        throwOnTerminalFailure: false,
      });

      await job.updateProgress(100);

      if (result.skipped) {
        await prisma.url.updateMany({
          where: { id: urlId },
          data: {
            taggingStatus: TaggingStatus.SUCCESS,
            taggingJobId: null,
            taggingError: null,
          },
        });
      }

      return result;
    } catch (e: any) {
      const msg = String(
        e?.message || e || "Unknown AI URL tagging error",
      ).slice(0, 500);

      await prisma.url.updateMany({
        where: { id: urlId },
        data: {
          taggingStatus: TaggingStatus.FAILED,
          taggingJobId: null,
          taggingError: msg,
        },
      });

      throw e;
    }
  },
  {
    connection: bullConnection(),
    concurrency,
  },
);

aiTagUrlWorker.on("completed", (job) => {
  console.log("[ai-tag-url] completed", {
    queueJobId: job.id,
    urlId: job.data.urlId,
  });
});

aiTagUrlWorker.on("failed", (job, err) => {
  console.error("[ai-tag-url] failed", {
    queueJobId: job?.id,
    urlId: job?.data?.urlId,
    error: err?.message || err,
  });
});
