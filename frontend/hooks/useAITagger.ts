import { useCallback, useRef, useState } from "react";
import { getJob, startFileTagJob, startUrlTagJob } from "../lib/api";

type StartOpts = {
  timeoutSec?: number;                    // default 90s
  onProgress?: (pct: number) => void;
  onSuccess?: (tags: string[]) => void;
  onFailure?: (msg: string) => void;
  attachId: { fileId?: string; urlId?: number }; // exactly one
};

export function useAITagger() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const stopRef = useRef(false);

  const cancel = useCallback(() => { stopRef.current = true; }, []);
  const reset  = useCallback(() => { stopRef.current = false; setProgress(0); }, []);

  const start = useCallback(async (opts: StartOpts) => {
    const { timeoutSec = 90, onProgress, onSuccess, onFailure, attachId } = opts;
    if (!!attachId.fileId === !!attachId.urlId) throw new Error("Pass exactly one of fileId or urlId");
    setRunning(true); setProgress(0); stopRef.current = false;

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
        await new Promise(r => setTimeout(r, 1000));

        const data = await getJob(jobId, qs);

        if (data.state === "STARTED") {
          const pct = typeof (data as any).progress === "number" ? Math.min(100, Math.max(0, (data as any).progress)) : Math.min(99, (t / maxTicks) * 100);
          setProgress(pct); onProgress?.(pct); continue;
        }
        if (data.state === "PENDING" || data.state === "RETRY") {
          const pct = Math.min(25, (t / maxTicks) * 25);
          setProgress(pct); onProgress?.(pct); continue;
        }
        if (data.state === "FAILURE") {
          const msg = (data as any).error || "AI tagging failed";
          onFailure?.(msg); setRunning(false);
          return { ok: false, error: msg };
        }
        if (data.state === "SUCCESS") {
          const tags = (data as any).tags ?? [];
          setProgress(100); onProgress?.(100);
          onSuccess?.(tags); setRunning(false);
          return { ok: true, tags };
        }
      }
      const msg = "AI tagging timed out";
      onFailure?.(msg); setRunning(false);
      return { ok: false, error: msg };
    } catch (e: any) {
      const msg = e?.message || "AI tagging failed";
      onFailure?.(msg); setRunning(false);
      return { ok: false, error: msg };
    }
  }, []);

  return { running, progress, start, cancel, reset };
}
