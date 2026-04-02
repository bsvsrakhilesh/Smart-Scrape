import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env";
import prisma from "../config/database";
import { markJobQueued } from "../services/jobTelemetry.service";

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
  const jobId = sourceId;

  const existing = await embeddingQueue.getJob(jobId);
  if (
    existing &&
    ((await existing.isActive()) ||
      (await existing.isWaiting()) ||
      (await existing.isDelayed()))
  ) {
    return;
  }

  await embeddingQueue.add("embed_source", { sourceId }, { jobId });

  await markJobQueued(prisma, "embedding", sourceId, {
    queueJobId: jobId,
    stage: "queued",
    statusMessage: "Queued embedding job",
    meta: {
      bullQueue: "embeddings",
    },
  });
}
