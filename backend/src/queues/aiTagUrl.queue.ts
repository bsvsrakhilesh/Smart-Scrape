import { Queue, type ConnectionOptions } from "bullmq";
import prisma from "../config/database";
import { env } from "../config/env";
import { TaggingStatus } from "../generated/prisma/client";
import { buildAiTagUrlQueueJobId } from "./queueJobId.util";

export type AiTagUrlQueueJobData = {
  urlId: number;
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

export const aiTagUrlQueue = new Queue<AiTagUrlQueueJobData>("ai-tag-url", {
  connection: bullConnection(),
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export async function enqueueAiTagUrl(
  urlId: number,
  opts: { force?: boolean } = {},
) {
  const safeUrlId = Number(urlId);

  if (!Number.isFinite(safeUrlId)) {
    throw new Error(`Invalid URL id for AI tagging: ${urlId}`);
  }

  const queueJobId = buildAiTagUrlQueueJobId(safeUrlId);
  const existing = await aiTagUrlQueue.getJob(queueJobId);

  if (existing) {
    if (
      (await existing.isActive()) ||
      (await existing.isWaiting()) ||
      (await existing.isDelayed())
    ) {
      await prisma.url.updateMany({
        where: { id: safeUrlId },
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

  await prisma.url.updateMany({
    where: { id: safeUrlId },
    data: {
      taggingStatus: TaggingStatus.PENDING,
      taggingJobId: null,
      taggingError: null,
    },
  });

  await aiTagUrlQueue.add(
    "tag_url",
    {
      urlId: safeUrlId,
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
