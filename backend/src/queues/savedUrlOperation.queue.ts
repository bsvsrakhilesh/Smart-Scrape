import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env";

export type SavedUrlOperationQueueJobData = {
  runId: string;
};

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

export const savedUrlOperationQueue =
  new Queue<SavedUrlOperationQueueJobData>("saved-url-operations", {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });

export async function enqueueSavedUrlOperation(runId: string) {
  const queueJobId = `saved-url-operation__${runId}`;
  const existing = await savedUrlOperationQueue.getJob(queueJobId);

  if (existing) {
    if (
      (await existing.isActive()) ||
      (await existing.isWaiting()) ||
      (await existing.isDelayed())
    ) {
      return { queued: false as const, reused: true as const, queueJobId };
    }

    await existing.remove().catch(() => undefined);
  }

  await savedUrlOperationQueue.add(
    "run_saved_url_operation",
    { runId },
    { jobId: queueJobId },
  );

  return { queued: true as const, reused: false as const, queueJobId };
}
