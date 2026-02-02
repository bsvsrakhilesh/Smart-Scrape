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

export const ingestionQueue = new Queue("ingestion", {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueIngestionJob(sourceId: string) {
  await ingestionQueue.add("ingest_source", { sourceId }, { jobId: sourceId });
}
