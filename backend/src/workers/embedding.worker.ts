import { Worker } from "bullmq";
import IORedis from "ioredis";
import prisma from "../config/database";
import { env, requireOpenAI } from "../config/env";
import {
  DEFAULT_EMBEDDING_MODEL,
  embedTexts,
  toPgVectorLiteral,
} from "../services/embeddings.service";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const embeddingWorker = new Worker(
  "embeddings",
  async (job) => {
    requireOpenAI();

    const { sourceId } = job.data as { sourceId: string };
    if (!sourceId) throw new Error("Missing sourceId");

    // Upsert status row (durable state)
    await prisma.embeddingJob.upsert({
      where: { sourceId },
      create: { sourceId, status: "RUNNING", attemptCount: 1 },
      update: {
        status: "RUNNING",
        attemptCount: { increment: 1 },
        error: null,
      },
    });

    // Pull chunks that aren’t embedded yet
    const chunks = await prisma.sourceChunk.findMany({
      where: { sourceId, embeddedAt: null },
      orderBy: { idx: "asc" },
      select: { id: true, text: true },
    });

    if (!chunks.length) {
      await prisma.embeddingJob.update({
        where: { sourceId },
        data: { status: "SUCCESS", error: null },
      });
      return;
    }

    const texts = chunks.map((c) => c.text);
    const embeddings = await embedTexts(texts, DEFAULT_EMBEDDING_MODEL);
    if (!embeddings.length || embeddings.length !== chunks.length) {
      throw new Error("Embedding generation failed or count mismatch.");
    }

    const now = new Date();

    await prisma.$transaction(
      chunks.map((row, i) => {
        const v = toPgVectorLiteral(embeddings[i]);
        return prisma.$executeRaw`
          UPDATE "SourceChunk"
          SET
            "embedding" = ${v}::vector,
            "embeddingModel" = ${DEFAULT_EMBEDDING_MODEL},
            "embeddedAt" = ${now}
          WHERE "id" = ${row.id}
        `;
      })
    );

    await prisma.embeddingJob.update({
      where: { sourceId },
      data: { status: "SUCCESS", error: null },
    });
  },
  { connection, concurrency: env.EMBEDDING_QUEUE_CONCURRENCY }
);

embeddingWorker.on("failed", async (job, err) => {
  const sourceId = (job?.data as any)?.sourceId;
  if (!sourceId) return;

  await prisma.embeddingJob.update({
    where: { sourceId },
    data: { status: "FAILED", error: err?.message ?? String(err) },
  });
});
