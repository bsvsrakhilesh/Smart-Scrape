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

export const ingestionQueue = new Queue("ingestion", {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueIngestionJob(
  sourceId: string,
  opts?: { forceOcr?: boolean },
) {
  const mode = opts?.forceOcr ? "ocr" : "ingest";
  const jobId = `${sourceId}:${mode}`;

  const existing = await ingestionQueue.getJob(jobId);
  if (
    existing &&
    ((await existing.isActive()) ||
      (await existing.isWaiting()) ||
      (await existing.isDelayed()))
  ) {
    return;
  }

  await ingestionQueue.add(
    "ingest_source",
    { sourceId, forceOcr: Boolean(opts?.forceOcr) },
    { jobId },
  );

  await markJobQueued(prisma, "ingestion", sourceId, {
    queueJobId: jobId,
    stage: "queued",
    statusMessage: opts?.forceOcr
      ? "Queued OCR ingestion job"
      : "Queued ingestion job",
    meta: {
      bullQueue: "ingestion",
      forceOcr: Boolean(opts?.forceOcr),
    },
  });
}
