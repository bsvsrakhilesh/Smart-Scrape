import { useCallback, useRef, useState } from "react";
import { getJob, startFileTagJob, startUrlTagJob } from "../lib/api";

type StartOpts = {
  timeoutSec?: number;
  onProgress?: (pct: number) => void;
  onSuccess?: (tags: string[]) => void;
  onFailure?: (msg: string) => void;
  attachId: { fileId?: string; urlId?: number };
};

function clampPct(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function useAITagger() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const stopRef = useRef(false);

  const cancel = useCallback(() => {
    stopRef.current = true;
  }, []);

  const reset = useCallback(() => {
    stopRef.current = false;
    setProgress(0);
  }, []);

  const start = useCallback(
    async (opts: StartOpts) => {
      const {
        timeoutSec = 90,
        onProgress,
        onSuccess,
        onFailure,
        attachId,
      } = opts;

      if (!!attachId.fileId === !!attachId.urlId) {
        throw new Error("Pass exactly one of fileId or urlId");
      }

      setRunning(true);
      setProgress(0);
      stopRef.current = false;

      try {
        const { jobId } = attachId.fileId
          ? await startFileTagJob(attachId.fileId)
          : await startUrlTagJob(attachId.urlId as number);

        const qs = attachId.fileId
          ? `fileId=${encodeURIComponent(attachId.fileId)}`
          : `urlId=${encodeURIComponent(String(attachId.urlId))}`;

        const maxTicks = Math.max(5, Math.floor(timeoutSec));

        for (let t = 0; t < maxTicks; t++) {
          if (stopRef.current) break;
          await new Promise((r) => setTimeout(r, 1000));

          const data = await getJob(jobId, qs);

          if (
            data.state === "PENDING" ||
            data.state === "STARTED" ||
            data.state === "RETRY"
          ) {
            const fallback =
              data.state === "PENDING"
                ? Math.min(20, ((t + 1) / maxTicks) * 20)
                : data.state === "RETRY"
                  ? Math.min(85, Math.max(progress, 35))
                  : Math.min(95, ((t + 1) / maxTicks) * 95);

            const pct = clampPct((data as any).progress, fallback);
            setProgress(pct);
            onProgress?.(pct);
            continue;
          }

          if (data.state === "FAILURE") {
            const msg =
              (data as any).error ||
              (data as any).message ||
              "AI tagging failed";
            onFailure?.(msg);
            setRunning(false);
            return { ok: false as const, error: msg };
          }

          if (data.state === "SUCCESS") {
            const tags = (data as any).tags ?? [];
            setProgress(100);
            onProgress?.(100);
            onSuccess?.(tags);
            setRunning(false);
            return { ok: true as const, tags };
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

  return { running, progress, start, cancel, reset };
}
