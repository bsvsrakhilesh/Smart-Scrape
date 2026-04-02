import { Worker, type ConnectionOptions } from "bullmq";
import prisma from "../config/database";
import { env, requireOpenAI } from "../config/env";
import {
  DEFAULT_EMBEDDING_MODEL,
  embedTexts,
  toPgVectorLiteral,
} from "../services/embeddings.service";
import {
  markJobFailed,
  markJobProgress,
  markJobRunning,
  markJobSucceeded,
} from "../services/jobTelemetry.service";
import { log } from "../utils/logger";

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

export const embeddingWorker = new Worker(
  "embeddings",
  async (job) => {
    requireOpenAI();

    const { sourceId } = job.data as { sourceId: string };
    if (!sourceId) throw new Error("Missing sourceId");

    await markJobRunning(prisma, "embedding", sourceId, {
      queueJobId: job.id,
      stage: "starting",
      progressPct: 4,
      statusMessage: "Worker picked up embedding job",
      meta: { bullJobName: job.name, model: DEFAULT_EMBEDDING_MODEL },
    });

    log.info("embedding_job_started", {
      sourceId,
      queueJobId: job.id,
      model: DEFAULT_EMBEDDING_MODEL,
    });

    const src = await prisma.notebookSource.findUnique({
      where: { id: sourceId },
      select: { activeRevisionId: true },
    });

    await markJobProgress(prisma, "embedding", sourceId, {
      stage: "loading_chunks",
      progressPct: 16,
      statusMessage: "Loading chunks for active revision",
      meta: { activeRevisionId: src?.activeRevisionId ?? null },
    });

    const chunks = await prisma.sourceChunk.findMany({
      where: {
        sourceId,
        revisionId: src?.activeRevisionId ?? undefined,
        embeddedAt: null,
      },
      orderBy: { idx: "asc" },
      select: { id: true, text: true },
    });

    if (!chunks.length) {
      await markJobSucceeded(prisma, "embedding", sourceId, {
        stage: "completed",
        statusMessage: "All chunks are already indexed",
        meta: { indexedChunkCount: 0, model: DEFAULT_EMBEDDING_MODEL },
      });
      return;
    }

    await markJobProgress(prisma, "embedding", sourceId, {
      stage: "embedding_model_call",
      progressPct: 48,
      statusMessage: `Embedding ${chunks.length} chunk(s)`,
      meta: { chunkCount: chunks.length, model: DEFAULT_EMBEDDING_MODEL },
    });

    const texts = chunks.map((c) => c.text);
    const embeddings = await embedTexts(texts, DEFAULT_EMBEDDING_MODEL);
    if (embeddings.length !== chunks.length) {
      throw new Error("Embedding count mismatch.");
    }

    await markJobProgress(prisma, "embedding", sourceId, {
      stage: "persisting_embeddings",
      progressPct: 82,
      statusMessage: "Persisting vector index rows",
      meta: { chunkCount: chunks.length, model: DEFAULT_EMBEDDING_MODEL },
    });

    const now = new Date();
    await prisma.$transaction(
      chunks.map((row, i) => {
        const v = toPgVectorLiteral(embeddings[i]);
        return prisma.$executeRaw`
          UPDATE "SourceChunk"
          SET "embedding" = ${v}::vector,
              "embeddingModel" = ${DEFAULT_EMBEDDING_MODEL},
              "embeddedAt" = ${now}
          WHERE "id" = ${row.id}
        `;
      }),
    );

    await markJobSucceeded(prisma, "embedding", sourceId, {
      stage: "completed",
      statusMessage: "Semantic index is ready",
      meta: { chunkCount: chunks.length, model: DEFAULT_EMBEDDING_MODEL },
    });

    log.info("embedding_job_succeeded", {
      sourceId,
      queueJobId: job.id,
      chunkCount: chunks.length,
      model: DEFAULT_EMBEDDING_MODEL,
    });
  },
  {
    connection: bullConnection(),
    concurrency: env.EMBEDDING_QUEUE_CONCURRENCY,
  },
);

embeddingWorker.on("failed", async (job, err) => {
  const sourceId = (job?.data as any)?.sourceId;
  if (!sourceId) return;

  await markJobFailed(prisma, "embedding", sourceId, {
    stage: "failed",
    statusMessage: "Embedding job failed",
    error: err?.message ?? String(err),
    meta: { queueJobId: job?.id ?? null, model: DEFAULT_EMBEDDING_MODEL },
  });

  log.error("embedding_job_failed", {
    sourceId,
    queueJobId: job?.id ?? null,
    error: err?.message ?? String(err),
    model: DEFAULT_EMBEDDING_MODEL,
  });
});
