import { Worker, type ConnectionOptions, type Job } from "bullmq";
import prisma from "../config/database";
import { env } from "../config/env";
import { TaggingStatus } from "../generated/prisma/client";
import { runAiTagForFile } from "../services/aiTagAuto.service";
import type { AiTagFileQueueJobData } from "../queues/aiTagFile.queue";

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

const concurrency = Math.max(1, env.AI_TAG_FILE_QUEUE_CONCURRENCY || 1);

export const aiTagFileWorker = new Worker<AiTagFileQueueJobData>(
  "ai-tag-file",
  async (job: Job<AiTagFileQueueJobData>) => {
    const fileId = String(job.data.fileId || "").trim();

    if (!fileId) {
      throw new Error(`Invalid file id in ai-tag-file queue job: ${job.data.fileId}`);
    }

    await job.updateProgress(5);

    try {
      const result = await runAiTagForFile(fileId, {
        force: Boolean(job.data.force),
        throwOnTerminalFailure: false,
      });

      await job.updateProgress(100);
      return result;
    } catch (e: any) {
      const msg = String(e?.message || e || "Unknown AI file tagging error").slice(
        0,
        500,
      );

      await prisma.storedFile.updateMany({
        where: { id: fileId },
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

aiTagFileWorker.on("completed", (job) => {
  console.log("[ai-tag-file] completed", {
    queueJobId: job.id,
    fileId: job.data.fileId,
  });
});

aiTagFileWorker.on("failed", (job, err) => {
  console.error("[ai-tag-file] failed", {
    queueJobId: job?.id,
    fileId: job?.data?.fileId,
    error: err?.message || err,
  });
});
