import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env";

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

export const embeddingQueue = new Queue("embeddings", {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueEmbeddingJob(sourceId: string) {
  await embeddingQueue.add("embed_source", { sourceId }, { jobId: sourceId });
}
