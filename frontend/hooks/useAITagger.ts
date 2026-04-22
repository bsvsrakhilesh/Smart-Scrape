import { useCallback, useRef, useState } from "react";
import { getJob, startFileTagJob, startUrlTagJob } from "../lib/api";
import {
  AI_TAG_JOB_POLL_MS,
  AI_TAG_JOB_TIMEOUT_SEC,
  deriveAiTagRuntimeFromJob,
} from "../lib/aiTagUi";

type StartOpts = {
  timeoutSec?: number;
  onProgress?: (pct: number) => void;
  onSuccess?: (tags: string[]) => void;
  onFailure?: (msg: string) => void;
  onStatus?: (runtime: {
    jobId: string;
    state: string;
    progress: number | null;
    stage: string | null;
    message: string | null;
    attempt: number | null;
    cached: boolean | null;
  }) => void;
  attachId: { fileId?: string; urlId?: number };
};

export function useAITagger() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<number | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const stopRef = useRef(false);

  const cancel = useCallback(() => {
    stopRef.current = true;
  }, []);

  const reset = useCallback(() => {
    stopRef.current = false;
    setProgress(0);
    setStage(null);
    setMessage(null);
    setAttempt(null);
    setCached(null);
  }, []);

  const start = useCallback(
    async (opts: StartOpts) => {
      const {
        timeoutSec = AI_TAG_JOB_TIMEOUT_SEC,
        onProgress,
        onSuccess,
        onFailure,
        onStatus,
        attachId,
      } = opts;

      if (!!attachId.fileId === !!attachId.urlId) {
        throw new Error("Pass exactly one of fileId or urlId");
      }

      setRunning(true);
      setProgress(0);
      setStage(null);
      setMessage(null);
      setAttempt(null);
      setCached(null);
      stopRef.current = false;

      try {
        const started = attachId.fileId
          ? await startFileTagJob(attachId.fileId)
          : await startUrlTagJob(attachId.urlId as number);

        const { jobId } = started;

        const qs = attachId.fileId
          ? `fileId=${encodeURIComponent(attachId.fileId)}`
          : `urlId=${encodeURIComponent(String(attachId.urlId))}`;

        const maxTicks = Math.max(
          10,
          Math.ceil((timeoutSec * 1000) / AI_TAG_JOB_POLL_MS),
        );

        for (let t = 0; t < maxTicks; t++) {
          if (stopRef.current) {
            setRunning(false);
            return {
              ok: false as const,
              cancelled: true as const,
              error: "Cancelled",
            };
          }

          await new Promise((r) => setTimeout(r, AI_TAG_JOB_POLL_MS));

          const data = await getJob(jobId, qs);
          const runtime = deriveAiTagRuntimeFromJob(data, progress);

          if (
            data.state === "PENDING" ||
            data.state === "STARTED" ||
            data.state === "RETRY"
          ) {
            const pct = runtime.aiTagJobProgress ?? 0;
            setProgress(pct);
            setStage(runtime.aiTagJobStage ?? null);
            setMessage(runtime.aiTagJobMessage ?? null);
            setAttempt(runtime.aiTagJobAttempt ?? null);
            setCached(runtime.aiTagJobCached ?? null);
            onProgress?.(pct);
            onStatus?.({
              jobId,
              state: data.state,
              progress: runtime.aiTagJobProgress ?? null,
              stage: runtime.aiTagJobStage ?? null,
              message: runtime.aiTagJobMessage ?? null,
              attempt: runtime.aiTagJobAttempt ?? null,
              cached: runtime.aiTagJobCached ?? null,
            });
            continue;
          }

          if (data.state === "FAILURE") {
            const msg =
              (data as any).error ||
              (data as any).message ||
              "AI tagging failed";
            setStage(runtime.aiTagJobStage ?? null);
            setMessage(runtime.aiTagJobMessage ?? msg);
            setAttempt(runtime.aiTagJobAttempt ?? null);
            setRunning(false);
            onFailure?.(msg);
            onStatus?.({
              jobId,
              state: data.state,
              progress: runtime.aiTagJobProgress ?? null,
              stage: runtime.aiTagJobStage ?? null,
              message: runtime.aiTagJobMessage ?? msg,
              attempt: runtime.aiTagJobAttempt ?? null,
              cached: null,
            });
            return { ok: false as const, error: msg };
          }

          if (data.state === "SUCCESS") {
            const tags = (data as any).tags ?? [];
            const isCached =
              typeof (data as any).cached === "boolean"
                ? Boolean((data as any).cached)
                : null;

            setProgress(100);
            setStage(null);
            setMessage(null);
            setAttempt(null);
            setCached(isCached);
            onProgress?.(100);
            onStatus?.({
              jobId,
              state: data.state,
              progress: 100,
              stage: null,
              message: null,
              attempt: null,
              cached: isCached,
            });
            onSuccess?.(tags);
            setRunning(false);
            return { ok: true as const, tags, cached: isCached };
          }
        }

        const msg = "AI tagging timed out";
        onFailure?.(msg);
        setRunning(false);
        return { ok: false as const, error: msg };
      } catch (e: any) {
        const msg = e?.message || "AI tagging failed";
        onFailure?.(msg);
        setRunning(false);
        return { ok: false as const, error: msg };
      }
    },
    [progress],
  );

  return {
    running,
    progress,
    stage,
    message,
    attempt,
    cached,
    start,
    cancel,
    reset,
  };
}
