import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type {
  CollectorJob,
  CollectorJobActions,
  CollectorJobStatus,
} from "../../hooks/useCollectorJobs";

type Props = {
  jobs: CollectorJob[];
  actions: CollectorJobActions;
};

const STATUS_LABEL: Record<CollectorJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  success: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

function statusTone(status: CollectorJobStatus) {
  if (status === "success") return "text-emerald-700 bg-emerald-50";
  if (status === "failed") return "text-red-700 bg-red-50";
  if (status === "canceled") return "text-neutral-600 bg-neutral-100";
  if (status === "queued") return "text-sky-700 bg-sky-50";
  return "text-amber-700 bg-amber-50";
}

function statusIcon(status: CollectorJobStatus) {
  if (status === "success") return CheckCircle2;
  if (status === "failed") return AlertTriangle;
  if (status === "canceled") return X;
  return Activity;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const JobRow: React.FC<{
  job: CollectorJob;
  actions: CollectorJobActions;
}> = ({ job, actions }) => {
  const Icon = statusIcon(job.status);
  const live = job.status === "queued" || job.status === "running";
  const progress = Math.max(0, Math.min(100, Math.round(job.progressPct || 0)));

  return (
    <li className="border-t border-black/5 px-4 py-3 first:border-t-0 dark:border-white/10">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                statusTone(job.status),
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {STATUS_LABEL[job.status]}
            </span>
            <span className="text-sm font-semibold text-neutral-950 dark:text-white">
              {job.title}
            </span>
            {job.targetLabel && (
              <span
                className="max-w-[30rem] truncate text-xs text-neutral-500 dark:text-neutral-400"
                title={job.targetLabel}
              >
                {job.targetLabel}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            {job.stage && <span>{job.stage}</span>}
            {job.message && <span>{job.message}</span>}
            <span>{formatTime(job.updatedAt)}</span>
          </div>

          {job.error && (
            <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {job.error}
            </div>
          )}

          {(live || progress > 0) && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  job.status === "failed"
                    ? "bg-red-500"
                    : job.status === "success"
                      ? "bg-emerald-500"
                      : "bg-sky-500",
                ].join(" ")}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {job.status === "failed" && job.retryable && (
            <button
              type="button"
              onClick={() => actions.retryJob(job.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
              title="Retry this operation"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </button>
          )}

          {live && job.cancelable && (
            <button
              type="button"
              onClick={() => actions.cancelRunningJob(job.id)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
              title="Cancel this operation"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

const CollectorJobConsole: React.FC<Props> = ({ jobs, actions }) => {
  const liveCount = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const completedCount = jobs.filter(
    (job) => job.status === "success" || job.status === "canceled",
  ).length;

  const [open, setOpen] = useState(() => liveCount > 0 || failedCount > 0);

  useEffect(() => {
    if (liveCount > 0 || failedCount > 0) setOpen(true);
  }, [failedCount, liveCount]);

  const visibleJobs = useMemo(() => jobs.slice(0, open ? 8 : 3), [jobs, open]);

  if (jobs.length === 0) return null;

  return (
    <section
      aria-label="Collector job console"
      className="overflow-hidden rounded-3xl border border-black/10 bg-white/82 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-neutral-950/70"
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
            <Activity className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-neutral-950 dark:text-white">
              Job console
            </span>
            <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
              Search, harvest, and capture operations with retryable history.
            </span>
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-neutral-400" aria-hidden="true" />
          ) : (
            <ChevronDown
              className="h-4 w-4 text-neutral-400"
              aria-hidden="true"
            />
          )}
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
            {liveCount} active
          </span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
            {failedCount} failed
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            {completedCount} done
          </span>

          <button
            type="button"
            onClick={actions.clearCompleted}
            disabled={completedCount === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/10 px-2.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
            title="Clear completed and canceled jobs"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Clear done
          </button>
          <button
            type="button"
            onClick={actions.clearHistory}
            disabled={jobs.length === liveCount}
            className="h-8 rounded-full border border-black/10 px-2.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-neutral-300 dark:hover:bg-white/10"
            title="Clear all non-running job history"
          >
            Clear history
          </button>
        </div>
      </div>

      {open && (
        <ul className="m-0 border-t border-black/5 p-0 dark:border-white/10">
          {visibleJobs.map((job) => (
            <JobRow key={job.id} job={job} actions={actions} />
          ))}
        </ul>
      )}
    </section>
  );
};

export default CollectorJobConsole;
