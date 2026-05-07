import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CollectorJobKind =
  | "search"
  | "load_more"
  | "save"
  | "capture"
  | "pdf_discovery"
  | "pdf_capture";

export type CollectorJobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceled";

export type CollectorJob = {
  id: string;
  kind: CollectorJobKind;
  title: string;
  targetLabel?: string;
  status: CollectorJobStatus;
  stage?: string;
  message?: string;
  progressPct: number;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  retryable?: boolean;
  cancelable?: boolean;
  meta?: Record<string, unknown>;
};

export type CollectorJobPatch = Partial<
  Pick<
    CollectorJob,
    | "status"
    | "stage"
    | "message"
    | "progressPct"
    | "error"
    | "finishedAt"
    | "startedAt"
    | "retryable"
    | "cancelable"
    | "meta"
  >
>;

type JobHandlers = {
  onRetry?: () => void | Promise<void>;
  onCancel?: () => void;
};

type StartJobInput = {
  kind: CollectorJobKind;
  title: string;
  targetLabel?: string;
  stage?: string;
  message?: string;
  progressPct?: number;
  retryable?: boolean;
  cancelable?: boolean;
  meta?: Record<string, unknown>;
} & JobHandlers;

export type CollectorJobActions = {
  startJob: (input: StartJobInput) => string;
  registerJobHandlers: (id: string, handlers: JobHandlers) => void;
  updateJob: (id: string, patch: CollectorJobPatch) => void;
  succeedJob: (
    id: string,
    message?: string,
    patch?: CollectorJobPatch,
  ) => void;
  failJob: (id: string, error: unknown, patch?: CollectorJobPatch) => void;
  cancelJob: (id: string, message?: string) => void;
  retryJob: (id: string) => void;
  cancelRunningJob: (id: string) => void;
  clearCompleted: () => void;
  clearHistory: () => void;
};

const STORAGE_KEY = "uc:collector-jobs:v1";
const MAX_JOBS = 40;

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clampProgress(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeError(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }

  return String(error || "Unknown error");
}

function isLive(status: CollectorJobStatus) {
  return status === "queued" || status === "running";
}

function restoreJobs(): CollectorJob[] {
  if (typeof localStorage === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const restored = parsed
      .filter((job): job is CollectorJob => {
        return (
          job &&
          typeof job === "object" &&
          typeof job.id === "string" &&
          typeof job.title === "string" &&
          typeof job.status === "string"
        );
      })
      .slice(0, MAX_JOBS);

    const updatedAt = nowIso();
    return restored.map((job) =>
      isLive(job.status)
        ? {
            ...job,
            status: "failed",
            stage: "interrupted",
            message: "Interrupted by page reload",
            error:
              "This operation was still running when the page was reloaded.",
            progressPct: Math.min(clampProgress(job.progressPct), 98),
            retryable: false,
            cancelable: false,
            finishedAt: updatedAt,
            updatedAt,
          }
        : job,
    );
  } catch {
    return [];
  }
}

function sortJobs(jobs: CollectorJob[]) {
  return [...jobs].sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() -
      new Date(a.updatedAt || a.createdAt).getTime(),
  );
}

export function useCollectorJobs() {
  const [jobs, setJobs] = useState<CollectorJob[]>(restoreJobs);
  const handlersRef = useRef<Record<string, JobHandlers>>({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, MAX_JOBS)));
    } catch {
      // Job history should never break collector work.
    }
  }, [jobs]);

  const registerJobHandlers = useCallback(
    (id: string, handlers: JobHandlers) => {
      handlersRef.current[id] = {
        ...handlersRef.current[id],
        ...handlers,
      };
    },
    [],
  );

  const updateJob = useCallback((id: string, patch: CollectorJobPatch) => {
    setJobs((prev) => {
      const updatedAt = nowIso();
      return sortJobs(
        prev.map((job) =>
          job.id === id
            ? {
                ...job,
                ...patch,
                progressPct:
                  patch.progressPct === undefined
                    ? job.progressPct
                    : clampProgress(patch.progressPct),
                updatedAt,
              }
            : job,
        ),
      ).slice(0, MAX_JOBS);
    });
  }, []);

  const startJob = useCallback(
    (input: StartJobInput) => {
      const id = makeId();
      const createdAt = nowIso();
      const job: CollectorJob = {
        id,
        kind: input.kind,
        title: input.title,
        targetLabel: input.targetLabel,
        status: "queued",
        stage: input.stage || "queued",
        message: input.message || "Queued",
        progressPct: clampProgress(input.progressPct ?? 0),
        error: null,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        finishedAt: null,
        retryable: Boolean(input.retryable && input.onRetry),
        cancelable: Boolean(input.cancelable && input.onCancel),
        meta: input.meta,
      };

      if (input.onRetry || input.onCancel) {
        handlersRef.current[id] = {
          onRetry: input.onRetry,
          onCancel: input.onCancel,
        };
      }

      setJobs((prev) => sortJobs([job, ...prev]).slice(0, MAX_JOBS));
      return id;
    },
    [],
  );

  const succeedJob = useCallback(
    (id: string, message = "Completed", patch: CollectorJobPatch = {}) => {
      updateJob(id, {
        ...patch,
        status: "success",
        stage: patch.stage || "completed",
        message,
        error: null,
        progressPct: patch.progressPct ?? 100,
        finishedAt: nowIso(),
        retryable: false,
        cancelable: false,
      });
    },
    [updateJob],
  );

  const failJob = useCallback(
    (id: string, error: unknown, patch: CollectorJobPatch = {}) => {
      updateJob(id, {
        ...patch,
        status: "failed",
        stage: patch.stage || "failed",
        message: patch.message || "Failed",
        error: normalizeError(error),
        progressPct: patch.progressPct ?? undefined,
        finishedAt: nowIso(),
        cancelable: false,
      });
    },
    [updateJob],
  );

  const cancelJob = useCallback(
    (id: string, message = "Canceled") => {
      updateJob(id, {
        status: "canceled",
        stage: "canceled",
        message,
        error: null,
        finishedAt: nowIso(),
        cancelable: false,
      });
    },
    [updateJob],
  );

  const retryJob = useCallback((id: string) => {
    const handler = handlersRef.current[id]?.onRetry;
    if (handler) void handler();
  }, []);

  const cancelRunningJob = useCallback(
    (id: string) => {
      const handler = handlersRef.current[id]?.onCancel;
      if (handler) handler();
      cancelJob(id);
    },
    [cancelJob],
  );

  const clearCompleted = useCallback(() => {
    setJobs((prev) =>
      prev.filter(
        (job) =>
          job.status === "queued" ||
          job.status === "running" ||
          job.status === "failed",
      ),
    );
  }, []);

  const clearHistory = useCallback(() => {
    setJobs((prev) => prev.filter((job) => isLive(job.status)));
  }, []);

  const actions = useMemo<CollectorJobActions>(
    () => ({
      startJob,
      registerJobHandlers,
      updateJob,
      succeedJob,
      failJob,
      cancelJob,
      retryJob,
      cancelRunningJob,
      clearCompleted,
      clearHistory,
    }),
    [
      startJob,
      registerJobHandlers,
      updateJob,
      succeedJob,
      failJob,
      cancelJob,
      retryJob,
      cancelRunningJob,
      clearCompleted,
      clearHistory,
    ],
  );

  const liveJobs = useMemo(
    () => jobs.filter((job) => isLive(job.status)),
    [jobs],
  );

  const failedJobs = useMemo(
    () => jobs.filter((job) => job.status === "failed"),
    [jobs],
  );

  return {
    jobs,
    liveJobs,
    failedJobs,
    actions,
  };
}
