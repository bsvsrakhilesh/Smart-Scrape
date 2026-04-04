import prisma from "../config/database";
import { env } from "../config/env";

type JobRow = {
  status: string;
  lastHeartbeatAt: Date | null;
};

function summarizeJobRows(rows: JobRow[]) {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);

  const summary = {
    pendingCount: 0,
    runningCount: 0,
    successCount: 0,
    failedCount: 0,
    staleRunningCount: 0,
  };

  for (const row of rows) {
    switch (String(row.status)) {
      case "PENDING":
        summary.pendingCount += 1;
        break;
      case "RUNNING":
        summary.runningCount += 1;
        if (!row.lastHeartbeatAt || row.lastHeartbeatAt < staleBefore) {
          summary.staleRunningCount += 1;
        }
        break;
      case "SUCCESS":
        summary.successCount += 1;
        break;
      case "FAILED":
        summary.failedCount += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}

export async function getSystemStatus() {
  const [
    ingestionJobs,
    embeddingJobs,
    notebookCount,
    notebookSourceCount,
    noteCount,
    chatRunCount,
    auditLogCount,
  ] = await Promise.all([
    prisma.ingestionJob.findMany({
      select: {
        status: true,
        lastHeartbeatAt: true,
      },
    }),
    prisma.embeddingJob.findMany({
      select: {
        status: true,
        lastHeartbeatAt: true,
      },
    }),
    prisma.notebook.count(),
    prisma.notebookSource.count(),
    prisma.note.count(),
    prisma.notebookChatRun.count(),
    prisma.auditLog.count(),
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    auth: {
      devAuthEnabled: env.DEV_AUTH_ENABLED,
      headerAuthSupported: true,
    },
    services: {
      redisConfigured: Boolean(env.REDIS_URL),
      openaiEnabled: env.OPENAI_ENABLED,
      icnEnabled: env.ICN_ENABLED,
    },
    queues: {
      ingestionConcurrency: env.INGESTION_QUEUE_CONCURRENCY,
      embeddingConcurrency: env.EMBEDDING_QUEUE_CONCURRENCY,
      ingestion: summarizeJobRows(ingestionJobs),
      embedding: summarizeJobRows(embeddingJobs),
    },
    data: {
      notebookCount,
      notebookSourceCount,
      noteCount,
      chatRunCount,
      auditLogCount,
    },
  };
}
