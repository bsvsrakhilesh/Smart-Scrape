import React from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  SavedUrlOperationRun,
  SavedUrlOperationStatus,
} from "../../lib/api";

type Props = {
  operations: SavedUrlOperationRun[];
  loading?: boolean;
  onCancel: (id: string) => void;
  onRetryFailed: (id: string) => void;
};

const STATUS_LABEL: Record<SavedUrlOperationStatus, string> = {
  queued: "Queued",
  running: "Running",
  success: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

const TYPE_LABEL: Record<string, string> = {
  saved_url_bulk_capture_text: "Bulk text capture",
  saved_url_bulk_capture_pdf: "Bulk PDF capture",
  saved_url_bulk_ai_tag: "Bulk AI tagging",
  saved_url_metadata_refresh: "Metadata refresh",
  saved_url_bulk_delete: "Bulk delete",
  saved_url_collection_assign: "Collection assignment",
};

function statusTone(status: SavedUrlOperationStatus) {
  if (status === "success") return "text-emerald-700 bg-emerald-50";
  if (status === "failed") return "text-red-700 bg-red-50";
  if (status === "canceled") return "text-neutral-600 bg-neutral-100";
  if (status === "queued") return "text-sky-700 bg-sky-50";
  return "text-amber-700 bg-amber-50";
}

function statusIcon(status: SavedUrlOperationStatus) {
  if (status === "success") return CheckCircle2;
  if (status === "failed") return AlertTriangle;
  if (status === "canceled") return X;
  return Activity;
}

function isLive(status: SavedUrlOperationStatus) {
  return status === "queued" || status === "running";
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const dt = new Date(value);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SavedUrlsOperationsPanel: React.FC<Props> = ({
  operations,
  loading = false,
  onCancel,
  onRetryFailed,
}) => {
  if (!operations.length && !loading) return null;

  const active = operations.filter((op) => isLive(op.status)).length;
  const failed = operations.filter((op) => op.status === "failed").length;

  return (
    <section
      aria-label="Saved URLs operations"
      className="overflow-hidden rounded-3xl border border-black/10 bg-white/85 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-neutral-950/75"
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
            <Activity className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-950 dark:text-white">
              Operations
            </h2>
            <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              Durable capture, tagging, collection, and review work.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
            {active} active
          </span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
            {failed} failed
          </span>
        </div>
      </div>

      {operations.length > 0 && (
        <ul className="m-0 border-t border-black/5 p-0 dark:border-white/10">
          {operations.slice(0, 6).map((operation) => {
            const Icon = statusIcon(operation.status);
            const progress = Math.max(
              0,
              Math.min(100, Math.round(operation.progressPct || 0)),
            );

            return (
              <li
                key={operation.id}
                className="border-t border-black/5 px-4 py-3 first:border-t-0 dark:border-white/10"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          statusTone(operation.status),
                        ].join(" ")}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {STATUS_LABEL[operation.status]}
                      </span>
                      <span className="text-sm font-semibold text-neutral-950 dark:text-white">
                        {TYPE_LABEL[operation.type] ?? operation.type}
                      </span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">
                        {formatTime(operation.updatedAt)}
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {operation.statusMessage ||
                        `${operation.completed}/${operation.total} processed`}
                      {operation.failed > 0
                        ? ` · ${operation.failed} failed`
                        : ""}
                    </div>

                    {operation.error && (
                      <div className="mt-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                        {operation.error}
                      </div>
                    )}

                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-white/10">
                      <div
                        className={[
                          "h-full rounded-full transition-all",
                          operation.status === "failed"
                            ? "bg-red-500"
                            : operation.status === "success"
                              ? "bg-emerald-500"
                              : "bg-sky-500",
                        ].join(" ")}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-2">
                    {isLive(operation.status) && (
                      <button
                        type="button"
                        onClick={() => onCancel(operation.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                        title="Cancel this operation"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Cancel
                      </button>
                    )}

                    {operation.status === "failed" && operation.failed > 0 && (
                      <button
                        type="button"
                        onClick={() => onRetryFailed(operation.id)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-white/5 dark:text-neutral-200 dark:hover:bg-white/10"
                        title="Retry failed items"
                      >
                        <RotateCcw
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        Retry failed
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default SavedUrlsOperationsPanel;
