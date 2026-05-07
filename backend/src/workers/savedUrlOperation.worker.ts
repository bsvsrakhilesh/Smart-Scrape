import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { env } from "../config/env";
import type { SavedUrlOperationQueueJobData } from "../queues/savedUrlOperation.queue";
import { processSavedUrlOperationRun } from "../services/savedUrlOperation.service";

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

const concurrency = Math.max(1, env.SAVED_URL_OPERATION_QUEUE_CONCURRENCY || 2);

export const savedUrlOperationWorker =
  new Worker<SavedUrlOperationQueueJobData>(
    "saved-url-operations",
    async (job: Job<SavedUrlOperationQueueJobData>) => {
      if (!job.data.runId) {
        throw new Error("Missing saved URL operation run id.");
      }

      await job.updateProgress(5);
      const result = await processSavedUrlOperationRun(job.data.runId);
      await job.updateProgress(100);
      return result;
    },
    {
      connection: bullConnection(),
      concurrency,
    },
  );

savedUrlOperationWorker.on("completed", (job) => {
  console.log("[saved-url-operations] completed", {
    queueJobId: job.id,
    runId: job.data.runId,
  });
});

savedUrlOperationWorker.on("failed", (job, err) => {
  console.error("[saved-url-operations] failed", {
    queueJobId: job?.id,
    runId: job?.data?.runId,
    error: err?.message || err,
  });
});
