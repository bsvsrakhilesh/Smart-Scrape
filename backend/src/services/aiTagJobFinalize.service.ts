import { getJob } from "./pyTaggerClient";
import {
  persistAiTagFailureForFile,
  persistAiTagFailureForUrl,
  persistAiTagSuccessForFile,
  persistAiTagSuccessForUrl,
} from "./aiTagPersistence.service";

const MAX_WAIT_MS = Number(process.env.TAGS_JOB_MAX_WAIT_MS || 4 * 60 * 1000);
const INITIAL_DELAY_MS = Number(process.env.TAGS_JOB_POLL_INITIAL_MS || 1000);
const MAX_DELAY_MS = Number(process.env.TAGS_JOB_POLL_MAX_MS || 8000);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function awaitTerminalJobState(jobId: string) {
  const startedAt = Date.now();
  let delay = INITIAL_DELAY_MS;

  while (true) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error(`ai-tagger job timed out for jobId=${jobId}`);
    }

    let data: any;
    try {
      data = await getJob(jobId);
    } catch {
      await sleep(delay);
      delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.3));
      continue;
    }

    if (data?.state === "SUCCESS" || data?.state === "FAILURE") {
      return data;
    }

    await sleep(delay);
    delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.3));
  }
}

export async function finalizeAiTagJobForFile(fileId: string, jobId: string) {
  const data = await awaitTerminalJobState(jobId);

  if (data?.state === "FAILURE") {
    await persistAiTagFailureForFile(fileId, jobId, data);
    return data;
  }

  await persistAiTagSuccessForFile(fileId, jobId, data);
  return data;
}

export async function finalizeAiTagJobForUrl(urlId: number, jobId: string) {
  const data = await awaitTerminalJobState(jobId);

  if (data?.state === "FAILURE") {
    await persistAiTagFailureForUrl(urlId, jobId, data);
    return data;
  }

  await persistAiTagSuccessForUrl(urlId, jobId, data);
  return data;
}

export function scheduleAiTagJobFinalizationForFile(
  fileId: string,
  jobId: string,
) {
  setImmediate(async () => {
    try {
      await finalizeAiTagJobForFile(fileId, jobId);
    } catch (e: any) {
      const msg = String(e?.message || e || "Unknown ai-tagger error").slice(
        0,
        500,
      );

      await persistAiTagFailureForFile(fileId, jobId, { error: msg });

      console.error("[aiTagJobFinalize] file finalization failed", {
        fileId,
        jobId,
        error: msg,
      });
    }
  });
}

export function scheduleAiTagJobFinalizationForUrl(
  urlId: number,
  jobId: string,
) {
  setImmediate(async () => {
    try {
      await finalizeAiTagJobForUrl(urlId, jobId);
    } catch (e: any) {
      const msg = String(e?.message || e || "Unknown ai-tagger error").slice(
        0,
        500,
      );

      await persistAiTagFailureForUrl(urlId, jobId, { error: msg });

      console.error("[aiTagJobFinalize] url finalization failed", {
        urlId,
        jobId,
        error: msg,
      });
    }
  });
}
