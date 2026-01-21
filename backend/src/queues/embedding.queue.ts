import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const embeddingQueue = new Queue("embeddings", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueEmbeddingJob(sourceId: string) {
  // jobId = sourceId => idempotent enqueue (re-ingest won’t spam)
  await embeddingQueue.add("embed_source", { sourceId }, { jobId: sourceId });
}
