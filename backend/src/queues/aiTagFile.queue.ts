import { Queue, type ConnectionOptions } from "bullmq";
import prisma from "../config/database";
import { env } from "../config/env";
import { TaggingStatus } from "../generated/prisma/client";
import { buildAiTagFileQueueJobId } from "./queueJobId.util";

export type AiTagFileQueueJobData = {
  fileId: string;
  force?: boolean;
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

export const aiTagFileQueue = new Queue<AiTagFileQueueJobData>("ai-tag-file", {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueAiTagFile(
  fileId: string,
  opts: { force?: boolean } = {},
) {
  const safeFileId = String(fileId || "").trim();

  if (!safeFileId) {
    throw new Error(`Invalid file id for AI tagging: ${fileId}`);
  }

  const queueJobId = buildAiTagFileQueueJobId(safeFileId);
  const existing = await aiTagFileQueue.getJob(queueJobId);

  if (existing) {
    if (
      (await existing.isActive()) ||
      (await existing.isWaiting()) ||
      (await existing.isDelayed())
    ) {
      await prisma.storedFile.updateMany({
        where: { id: safeFileId },
        data: {
          taggingStatus: TaggingStatus.PENDING,
          taggingError: null,
        },
      });

      return {
        queued: false as const,
        reused: true as const,
        queueJobId,
      };
    }

    await existing.remove().catch(() => undefined);
  }

  await prisma.storedFile.updateMany({
    where: { id: safeFileId },
    data: {
      taggingStatus: TaggingStatus.PENDING,
      taggingJobId: null,
      taggingError: null,
    },
  });

  await aiTagFileQueue.add(
    "tag_file",
    {
      fileId: safeFileId,
      force: Boolean(opts.force),
    },
    {
      jobId: queueJobId,
    },
  );

  return {
    queued: true as const,
    reused: false as const,
    queueJobId,
  };
}
