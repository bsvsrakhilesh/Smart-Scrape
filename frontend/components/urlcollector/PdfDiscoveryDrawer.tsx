import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cancelSavedUrlOperation,
  createDiscoveredPdfCaptureRun,
  crawlSavePdf,
  discoverPdfDocuments,
  fetchDiscoveredPdfDocuments,
  fetchSavedUrlOperation,
  type DiscoveredPdfDocument,
  type PdfDiscoverySummary,
  type SavedUrlOperationRun,
} from "../../lib/api";
import FolderPickerModal from "./FolderPickerModal";
import CloseIcon from "../icons/CloseIcon";
import { useDialogA11y } from "../common/useDialogA11y";
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import type { CollectorJobActions } from "../../hooks/useCollectorJobs";

type Props = {
  open: boolean;
  sourceUrlId: number | null;
  sourceUrl: string;
  sourceTitle?: string;
  query?: string | null;
  autoDiscover?: boolean;
  jobs?: CollectorJobActions;
  onClose: () => void;
  onAfterCapture?: () => void | Promise<void>;
};

type Notice = { type: "success" | "error" | "info"; text: string } | null;
type DocumentFilter = "uncaptured" | "captured" | "all";

const EMPTY_SUMMARY: PdfDiscoverySummary = {
  discoveredCount: 0,
  capturedCount: 0,
  verifiedCount: 0,
  lastDiscoveredAt: null,
};

function formatBytes(n?: number | null) {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function sanitizePdfName(raw: string) {
  const stem =
    String(raw || "document")
      .replace(/\s+/g, " ")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim()
      .slice(0, 140) || "document";
  return stem.toLowerCase().endsWith(".pdf") ? stem : `${stem}.pdf`;
}

function isAbortLike(error: any) {
  return (
    error?.name === "AbortError" ||
    error?.name === "CanceledError" ||
    error?.code === "ERR_CANCELED"
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isCapturedDocument(doc: DiscoveredPdfDocument) {
  return (
    doc.status === "CAPTURED" ||
    !!doc.capturedAt ||
    !!doc.capturedFiles?.length
  );
}

function confidenceClass(confidence: string) {
  if (confidence === "high") return "chip chip-emerald";
  if (confidence === "medium") return "chip chip-amber";
  return "chip chip-gray";
}

function methodLabel(method: string) {
  return method
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function scoreLabel(doc: DiscoveredPdfDocument) {
  return `${Math.max(0, Math.min(100, Math.round(doc.score * 100)))}%`;
}

function searchHaystack(doc: DiscoveredPdfDocument) {
  return [
    doc.title,
    doc.anchorText,
    doc.contextText,
    doc.fileNameHint,
    doc.url,
    doc.dateHint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function displayUrlName(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
  } catch {
    return url;
  }
}

const PdfDiscoveryDrawer: React.FC<Props> = ({
  open,
  sourceUrlId,
  sourceUrl,
  sourceTitle,
  query,
  autoDiscover = false,
  jobs,
  onClose,
  onAfterCapture,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const autoKeyRef = useRef<string>("");

  const [documents, setDocuments] = useState<DiscoveredPdfDocument[]>([]);
  const [summary, setSummary] = useState<PdfDiscoverySummary>(EMPTY_SUMMARY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [capturePickerOpen, setCapturePickerOpen] = useState(false);
  const [pageSnapshotPickerOpen, setPageSnapshotPickerOpen] = useState(false);
  const [captureTargets, setCaptureTargets] = useState<DiscoveredPdfDocument[]>(
    [],
  );
  const [capturing, setCapturing] = useState(false);
  const [captureDone, setCaptureDone] = useState(0);
  const [captureFailures, setCaptureFailures] = useState<
    Array<{ id: string; title: string; error: string }>
  >([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<DocumentFilter>("uncaptured");

  useDialogA11y({
    isOpen: open,
    onClose,
    dialogRef,
    initialFocusRef: closeRef,
    closeOnOutsideClick: !capturePickerOpen && !pageSnapshotPickerOpen,
  });

  const uncaptured = useMemo(
    () => documents.filter((doc) => !isCapturedDocument(doc)),
    [documents],
  );

  const selectedDocs = useMemo(
    () =>
      documents.filter(
        (doc) => selected.has(doc.id) && !isCapturedDocument(doc),
      ),
    [documents, selected],
  );

  const visibleDocuments = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return documents.filter((doc) => {
      const captured = isCapturedDocument(doc);
      if (statusFilter === "uncaptured" && captured) return false;
      if (statusFilter === "captured" && !captured) return false;
      if (!q) return true;
      return searchHaystack(doc).includes(q);
    });
  }, [documents, filterText, statusFilter]);

  const visibleUncaptured = useMemo(
    () => visibleDocuments.filter((doc) => !isCapturedDocument(doc)),
    [visibleDocuments],
  );

  const visibleSelectedCount = useMemo(
    () => visibleUncaptured.filter((doc) => selected.has(doc.id)).length,
    [selected, visibleUncaptured],
  );

  const load = useCallback(
    async (runDiscovery: boolean) => {
      if (!sourceUrlId) return;
      setNotice(null);
      if (runDiscovery) setDiscovering(true);
      else setLoading(true);
      const controller = new AbortController();
      const jobId = runDiscovery
        ? jobs?.startJob({
            kind: "pdf_discovery",
            title: "Harvest linked PDFs",
            targetLabel: sourceTitle || sourceUrl,
            stage: "discovering",
            message: "Scanning links, embeds, scripts, and browser-visible PDFs",
            progressPct: 10,
            retryable: true,
            cancelable: true,
            onRetry: () => void load(true),
            onCancel: () => controller.abort(),
            meta: { sourceUrlId, sourceUrl, query: query || null },
          })
        : null;

      try {
        if (jobId) {
          jobs?.updateJob(jobId, {
            status: "running",
            stage: "discovering",
            message: "Scanning source page for PDF candidates",
            progressPct: 28,
            startedAt: new Date().toISOString(),
          });
        }

        const out = runDiscovery
          ? await discoverPdfDocuments(sourceUrlId, {
              query,
              maxDepth: 1,
              useBrowserFallback: true,
            }, { signal: controller.signal })
          : await fetchDiscoveredPdfDocuments(sourceUrlId, {
              signal: controller.signal,
            });
        setDocuments(out.documents || []);
        setSummary(out.summary || EMPTY_SUMMARY);
        setSelected(new Set());
        if (runDiscovery) {
          const count = out.documents?.length || 0;
          if (jobId) {
            jobs?.succeedJob(
              jobId,
              count
                ? `Found ${count} PDF candidate${count === 1 ? "" : "s"}`
                : "No PDF candidates found",
              {
                meta: {
                  sourceUrlId,
                  sourceUrl,
                  discoveredCount: count,
                  verifiedCount: out.summary?.verifiedCount ?? 0,
                },
              },
            );
          }
          setNotice({
            type: count ? "success" : "info",
            text: count
              ? `Found ${count} PDF candidate${count === 1 ? "" : "s"}.`
              : "No PDF candidates were found on this page.",
          });
        }
      } catch (error: any) {
        if (isAbortLike(error)) {
          if (jobId) jobs?.cancelJob(jobId, "PDF harvest canceled");
        } else {
          setNotice({
            type: "error",
            text: error?.message || "PDF discovery failed.",
          });
          if (jobId) {
            jobs?.failJob(jobId, error, {
              message: "PDF harvest failed",
            });
          }
        }
      } finally {
        setLoading(false);
        setDiscovering(false);
      }
    },
    [jobs, query, sourceTitle, sourceUrl, sourceUrlId],
  );

  useEffect(() => {
    if (!open || !sourceUrlId) return;
    const key = `${sourceUrlId}:${autoDiscover ? "auto" : "view"}:${query || ""}`;
    if (autoDiscover && autoKeyRef.current !== key) {
      autoKeyRef.current = key;
      void load(true);
    } else {
      void load(false);
    }
  }, [autoDiscover, load, open, query, sourceUrlId]);

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllUncaptured = () => {
    setSelected(new Set(uncaptured.map((doc) => doc.id)));
  };

  const toggleVisibleSelection = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allVisibleSelected =
        visibleUncaptured.length > 0 &&
        visibleSelectedCount === visibleUncaptured.length;

      for (const doc of visibleUncaptured) {
        if (allVisibleSelected) next.delete(doc.id);
        else next.add(doc.id);
      }

      return next;
    });
  };

  const copyPdfUrl = async (url: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      setNotice({ type: "success", text: "PDF URL copied." });
    } catch {
      setNotice({ type: "error", text: "Could not copy the PDF URL." });
    }
  };

  const openCapturePicker = (targets: DiscoveredPdfDocument[]) => {
    if (!targets.length) {
      setNotice({ type: "info", text: "Choose at least one uncaptured PDF." });
      return;
    }
    setCaptureTargets(targets);
    setCaptureFailures([]);
    setCaptureDone(0);
    setCapturePickerOpen(true);
  };

  const runCapture = async (opts: {
    folderId?: string | null;
    fileName: string;
    mode: "text" | "pdf";
    accessMode?: "public" | "institutional";
  }) => {
    if (!sourceUrlId) return;
    setCapturePickerOpen(false);
    setCapturing(true);
    setCaptureDone(0);
    setCaptureFailures([]);

    const targets = [...captureTargets];
    const controller = new AbortController();
    let operationId: string | null = null;
    const jobId = jobs?.startJob({
      kind: "pdf_capture",
      title: "Capture discovered PDFs",
      targetLabel: sourceTitle || sourceUrl,
      stage: "capturing",
      message: `Preparing ${targets.length} PDF capture${targets.length === 1 ? "" : "s"}`,
      progressPct: 4,
      retryable: true,
      cancelable: true,
      onRetry: () => {
        setCaptureTargets(targets);
        void runCapture(opts);
      },
      onCancel: () => {
        controller.abort();
        if (operationId) void cancelSavedUrlOperation(operationId).catch(() => {});
      },
      meta: {
        sourceUrlId,
        sourceUrl,
        count: targets.length,
      },
    });

    const titleById = new Map(targets.map((doc) => [doc.id, doc.title]));
    const failuresFromRun = (run: SavedUrlOperationRun) =>
      (run.items ?? [])
        .filter((item) => item.status === "failed")
        .map((item) => ({
          id: item.resourceKey || String(item.resourceId || item.id),
          title:
            (item.resourceKey ? titleById.get(item.resourceKey) : null) ||
            "Discovered PDF",
          error: item.error || "Capture failed",
        }));

    try {
      jobs?.updateJob(jobId || "", {
        status: "running",
        stage: "queued",
        message: `Queued ${targets.length} discovered PDF capture${targets.length === 1 ? "" : "s"}`,
        progressPct: 8,
        startedAt: new Date().toISOString(),
      });

      let run = await createDiscoveredPdfCaptureRun(sourceUrlId, {
        discoveredDocumentIds: targets.map((doc) => doc.id),
        folderId: opts.folderId ?? undefined,
        accessMode: opts.accessMode || "public",
      });
      operationId = run.id;

      while (
        !controller.signal.aborted &&
        (run.status === "queued" || run.status === "running")
      ) {
        setCaptureDone(run.completed || 0);
        setCaptureFailures(failuresFromRun(run));
        jobs?.updateJob(jobId || "", {
          status: "running",
          stage: run.stage || "capturing",
          message:
            run.statusMessage ||
            `Capturing ${run.completed || 0}/${run.total || targets.length} PDFs`,
          progressPct: Math.max(8, Math.min(99, run.progressPct || 8)),
          meta: { sourceUrlId, sourceUrl, operationRunId: run.id },
        });

        await sleep(2000);
        run = await fetchSavedUrlOperation(run.id);
      }

      if (controller.signal.aborted) {
        if (operationId) await cancelSavedUrlOperation(operationId).catch(() => {});
      }

      const finalRun = operationId
        ? await fetchSavedUrlOperation(operationId).catch(() => run)
        : run;
      const failures = failuresFromRun(finalRun);
      const succeeded =
        (finalRun.items ?? []).filter((item) => item.status === "success").length ||
        Math.max(0, (finalRun.completed || 0) - (finalRun.failed || 0));

      setCaptureDone(finalRun.completed || 0);
      setCaptureFailures(failures);
      await load(false);
      await onAfterCapture?.();

      setNotice({
        type: controller.signal.aborted
          ? "info"
          : failures.length
            ? "error"
            : "success",
        text: controller.signal.aborted
          ? `Canceled after ${finalRun.completed || 0} of ${targets.length} PDFs.`
          : failures.length
            ? `Captured ${succeeded} of ${targets.length} PDFs.`
            : `Captured ${succeeded} PDF${succeeded === 1 ? "" : "s"}.`,
      });

      if (controller.signal.aborted) {
        jobs?.cancelJob(jobId, "PDF capture canceled");
      } else if (failures.length) {
        jobs?.failJob(
          jobId,
          `Captured ${succeeded} of ${targets.length} PDFs.`,
          {
            stage: "partial-failure",
            message: "Some PDF captures failed",
            progressPct: 100,
            meta: {
              sourceUrlId,
              sourceUrl,
              operationRunId: finalRun.id,
              succeeded,
              failed: failures.length,
            },
          },
        );
      } else {
        jobs?.succeedJob(
          jobId,
          `Captured ${succeeded} PDF${succeeded === 1 ? "" : "s"}`,
          {
            meta: { sourceUrlId, sourceUrl, operationRunId: finalRun.id, succeeded },
          },
        );
      }
    } catch (error: any) {
      if (isAbortLike(error) || controller.signal.aborted) {
        if (operationId) await cancelSavedUrlOperation(operationId).catch(() => {});
        if (jobId) jobs?.cancelJob(jobId, "PDF capture canceled");
        setNotice({ type: "info", text: "PDF capture canceled." });
      } else {
        setNotice({
          type: "error",
          text: error?.message || "PDF capture failed.",
        });
        if (jobId) {
          jobs?.failJob(jobId, error, {
            message: "PDF capture failed",
          });
        }
      }
    } finally {
      setCapturing(false);
      setCaptureTargets([]);
    }
  };

  const runPageSnapshotCapture = async (opts: {
    folderId?: string | null;
    fileName: string;
    mode: "text" | "pdf";
    accessMode?: "public" | "institutional";
  }) => {
    if (!sourceUrlId) return;
    setPageSnapshotPickerOpen(false);
    setCapturing(true);
    setCaptureDone(0);
    setCaptureFailures([]);
    const controller = new AbortController();
    const jobId = jobs?.startJob({
      kind: "pdf_capture",
      title: "Capture page PDF snapshot",
      targetLabel: sourceTitle || sourceUrl,
      stage: "capturing-page",
      message: "Preparing page snapshot",
      progressPct: 10,
      retryable: true,
      cancelable: true,
      onRetry: () => void runPageSnapshotCapture(opts),
      onCancel: () => controller.abort(),
      meta: { sourceUrlId, sourceUrl },
    });

    try {
      jobs?.updateJob(jobId || "", {
        status: "running",
        stage: "capturing-page",
        message: "Rendering source page as PDF",
        progressPct: 45,
        startedAt: new Date().toISOString(),
      });
      await crawlSavePdf(
        sourceUrl,
        opts.folderId ?? undefined,
        opts.fileName || sanitizePdfName(sourceTitle || "page"),
        true,
        true,
        sourceUrlId,
        opts.accessMode || "public",
        undefined,
        { signal: controller.signal },
      );
      await onAfterCapture?.();
      setNotice({ type: "success", text: "Captured page PDF snapshot." });
      if (jobId) {
        jobs?.succeedJob(jobId, "Captured page PDF snapshot", {
          meta: { sourceUrlId, sourceUrl },
        });
      }
    } catch (error: any) {
      if (isAbortLike(error)) {
        if (jobId) jobs?.cancelJob(jobId, "Page snapshot capture canceled");
      } else {
        setNotice({
          type: "error",
          text: error?.message || "Page snapshot capture failed.",
        });
        if (jobId) {
          jobs?.failJob(jobId, error, {
            message: "Page snapshot capture failed",
          });
        }
      }
    } finally {
      setCapturing(false);
    }
  };

  if (!open) return null;

  const busy = loading || discovering;
  const captureTotal = captureTargets.length;
  const captureProgress =
    captureTotal > 0 ? Math.round((captureDone / captureTotal) * 100) : 0;
  const visibleSelectionComplete =
    visibleUncaptured.length > 0 &&
    visibleSelectedCount === visibleUncaptured.length;
  const hasActiveFilter = Boolean(filterText.trim()) || statusFilter !== "all";

  const node = (
    <>
      <div className="fixed inset-0 z-[90] bg-slate-950/35 backdrop-blur-[2px]" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Discovered PDFs"
        className="fixed bottom-3 left-1/2 top-3 z-[91] flex w-[min(1400px,calc(100vw-1.5rem))] -translate-x-1/2 flex-col overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl shadow-slate-950/20 dark:border-white/10 dark:bg-neutral-950"
      >
        <header className="border-b border-black/10 bg-white/95 px-5 py-4 dark:border-white/10 dark:bg-neutral-950/95">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  PDF harvest
                </div>
              </div>
              <h2 className="mt-2 line-clamp-2 text-xl font-semibold leading-snug text-neutral-950 dark:text-white">
                {sourceTitle || "Discovered PDFs"}
              </h2>
              <div className="mt-2 max-w-3xl truncate rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
                {sourceUrl}
              </div>
            </div>

            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Close"
              title="Close"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">
              {summary.discoveredCount} discovered
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
              {summary.capturedCount} saved
            </span>
            <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-700 dark:bg-sky-400/10 dark:text-sky-200">
              {summary.verifiedCount} verified
            </span>
            {summary.lastDiscoveredAt && (
              <span className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
                Last harvest: {formatDate(summary.lastDiscoveredAt)}
              </span>
            )}
          </div>
        </header>

        <div className="border-b border-black/10 bg-white px-5 py-3 dark:border-white/10 dark:bg-neutral-950">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || capturing}
                onClick={() => void load(true)}
              >
                {discovering ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                {discovering ? "Harvesting" : "Harvest again"}
              </button>

              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Filter discovered PDFs</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                  aria-hidden="true"
                />
                <input
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder="Filter title, date, context, or URL..."
                  className="h-10 w-full rounded-full border border-black/10 bg-neutral-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:bg-white/10"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(["uncaptured", "captured", "all"] as DocumentFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setStatusFilter(filter)}
                    className={[
                      "h-9 rounded-full px-3 text-sm font-medium capitalize transition",
                      statusFilter === filter
                        ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-white/10 dark:text-neutral-300 dark:hover:bg-white/15",
                    ].join(" ")}
                  >
                    {filter}
                  </button>
                ),
              )}

              <button
                type="button"
                className="h-9 rounded-full border border-black/10 px-3 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
                disabled={!visibleUncaptured.length || busy || capturing}
                onClick={toggleVisibleSelection}
              >
                {visibleSelectionComplete
                  ? "Clear shown"
                  : `Select shown (${visibleUncaptured.length})`}
              </button>
            </div>
          </div>

          {notice && (
            <div
              className={[
                "mt-3 rounded-2xl border px-3 py-2 text-sm",
                notice.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : notice.type === "error"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-sky-200 bg-sky-50 text-sky-800",
              ].join(" ")}
            >
              {notice.text}
            </div>
          )}

          {capturing && (
            <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {captureTotal > 0
                    ? `Capturing ${captureDone} / ${captureTotal} PDFs`
                    : "Capturing page snapshot"}
                </span>
                {captureTotal > 0 && <span>{captureProgress}%</span>}
              </div>
              {captureTotal > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-200/70 dark:bg-emerald-900">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{ width: `${captureProgress}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden bg-neutral-50/70 dark:bg-black/20">
          {busy && !documents.length ? (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-sm rounded-3xl border border-dashed border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-neutral-950">
                <Loader2
                  className="mx-auto h-6 w-6 animate-spin text-emerald-600"
                  aria-hidden="true"
                />
                <div className="mt-3 text-sm font-semibold text-neutral-900 dark:text-white">
                  Searching the page
                </div>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  Checking links, embeds, scripts, and browser-visible PDF
                  responses.
                </p>
              </div>
            </div>
          ) : documents.length ? (
            <div className="flex h-full flex-col">
              <div className="hidden border-b border-black/10 bg-white/90 px-5 py-3 dark:border-white/10 dark:bg-neutral-950/90 lg:block">
                <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_11rem_13rem] items-center gap-3 rounded-2xl border border-black/5 bg-neutral-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-400">
                  <div />
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Document
                  </div>
                  <div>Signal</div>
                  <div>Source</div>
                  <div className="text-right">Actions</div>
                </div>
              </div>

              {visibleDocuments.length ? (
                <div className="flex-1 overflow-y-auto">
                  <ul className="divide-y divide-black/10 bg-white dark:divide-white/10 dark:bg-neutral-950">
                    {visibleDocuments.map((doc) => {
                      const captured = isCapturedDocument(doc);
                      const date = formatDate(doc.dateHint);
                      const size = formatBytes(doc.contentLength);

                      return (
                        <li
                          key={doc.id}
                          className={[
                            "grid gap-3 px-5 py-3 transition hover:bg-neutral-50 dark:hover:bg-white/[0.03]",
                            "grid-cols-[2.5rem_minmax(0,1fr)] lg:grid-cols-[2.5rem_minmax(0,1fr)_8rem_11rem_13rem]",
                            captured
                              ? "bg-emerald-50/30 dark:bg-emerald-400/[0.04]"
                              : "bg-white dark:bg-neutral-950",
                          ].join(" ")}
                        >
                          <div className="pt-1">
                            {captured ? (
                              <span
                                className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200"
                                title="Captured"
                              >
                                <CheckCircle2
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                className="h-5 w-5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                                checked={selected.has(doc.id)}
                                onChange={() => toggleSelected(doc.id)}
                                aria-label={`Select ${doc.title}`}
                              />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-start justify-between gap-3 lg:block">
                              <h3 className="line-clamp-2 text-sm font-semibold leading-6 text-neutral-950 dark:text-white">
                                {doc.title}
                              </h3>
                              <div className="flex shrink-0 gap-1 lg:hidden">
                                <span
                                  className={confidenceClass(doc.confidence)}
                                >
                                  {scoreLabel(doc)}
                                </span>
                                {captured && (
                                  <span className="chip chip-emerald">
                                    Saved
                                  </span>
                                )}
                              </div>
                            </div>

                            {doc.contextText && (
                              <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                                {doc.contextText}
                              </p>
                            )}

                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                              {date && <span>{date}</span>}
                              {size && <span>{size}</span>}
                              <span className="lg:hidden">
                                {methodLabel(doc.discoveryMethod)}
                              </span>
                              {doc.fileNameHint && (
                                <span className="max-w-[24rem] truncate">
                                  {doc.fileNameHint}
                                </span>
                              )}
                            </div>

                            {doc.captureError && (
                              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                                {doc.captureError}
                              </div>
                            )}
                          </div>

                          <div className="hidden lg:block">
                            <span className={confidenceClass(doc.confidence)}>
                              {scoreLabel(doc)}
                            </span>
                            <div className="mt-0 text-xs text-neutral-500 dark:text-neutral-400 lg:mt-2">
                              {doc.verified ? "Verified PDF" : "Candidate"}
                            </div>
                            {captured && (
                              <span className="mt-0 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200 lg:mt-2">
                                Saved
                              </span>
                            )}
                          </div>

                          <div className="hidden min-w-0 text-xs text-neutral-500 dark:text-neutral-400 lg:block">
                            <div className="truncate font-medium text-neutral-700 dark:text-neutral-200">
                              {methodLabel(doc.discoveryMethod)}
                            </div>
                            <div className="mt-1 truncate" title={doc.url}>
                              {displayUrlName(doc.url)}
                            </div>
                          </div>

                          <div className="col-span-2 flex items-center justify-end gap-2 lg:col-span-1 lg:pl-2">
                            <div className="inline-flex items-center rounded-2xl border border-black/10 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
                                aria-label={`Open ${doc.title}`}
                                title="Open PDF"
                              >
                                <ExternalLink
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              </a>
                              <button
                                type="button"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
                                onClick={() => void copyPdfUrl(doc.url)}
                                aria-label={`Copy URL for ${doc.title}`}
                                title="Copy URL"
                              >
                                <Copy className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                            {!captured && (
                              <button
                                type="button"
                                className="inline-flex h-11 min-w-[7.75rem] items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-900/10 transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/35 disabled:opacity-60"
                                disabled={capturing}
                                onClick={() => openCapturePicker([doc])}
                              >
                                <Download
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                                Capture
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6">
                  <div className="max-w-sm rounded-3xl border border-dashed border-black/10 bg-white p-8 text-center dark:border-white/10 dark:bg-neutral-950">
                    <Search
                      className="mx-auto h-6 w-6 text-neutral-400"
                      aria-hidden="true"
                    />
                    <div className="mt-3 text-sm font-semibold text-neutral-900 dark:text-white">
                      No PDFs match this view
                    </div>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                      Adjust the filter or switch the status segment to see more
                      discovered documents.
                    </p>
                    {hasActiveFilter && (
                      <button
                        type="button"
                        className="mt-4 rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
                        onClick={() => {
                          setFilterText("");
                          setStatusFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-6">
              <div className="max-w-md rounded-3xl border border-dashed border-black/10 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-neutral-950">
                <FileText
                  className="mx-auto h-7 w-7 text-neutral-400"
                  aria-hidden="true"
                />
                <div className="mt-3 text-sm font-semibold text-neutral-900 dark:text-white">
                  No PDFs discovered yet
                </div>
                <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                  Harvest the source page to look for linked, embedded, or
                  browser-visible PDF documents.
                </p>
                <button
                  type="button"
                  className="mt-5 rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
                  disabled={capturing || !sourceUrlId}
                  onClick={() => setPageSnapshotPickerOpen(true)}
                >
                  Capture page snapshot instead
                </button>
              </div>
            </div>
          )}

          {captureFailures.length > 0 && (
            <div className="mx-5 my-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <div className="font-semibold">Capture failures</div>
              <ul className="mt-2 space-y-1">
                {captureFailures.map((failure) => (
                  <li key={failure.id}>
                    {failure.title}: {failure.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="border-t border-black/10 bg-white/95 px-5 py-3 dark:border-white/10 dark:bg-neutral-950/95">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-neutral-600 dark:text-neutral-300">
              <span className="font-medium text-neutral-950 dark:text-white">
                {selectedDocs.length}
              </span>{" "}
              selected
              <span className="mx-2 text-neutral-300">/</span>
              <span className="font-medium text-neutral-950 dark:text-white">
                {visibleDocuments.length}
              </span>{" "}
              shown
              <span className="mx-2 text-neutral-300">/</span>
              <span className="font-medium text-neutral-950 dark:text-white">
                {uncaptured.length}
              </span>{" "}
              uncaptured
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="h-10 rounded-full border border-black/10 px-4 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
                disabled={!uncaptured.length || busy || capturing}
                onClick={selectAllUncaptured}
              >
                Select all uncaptured
              </button>
              <button
                type="button"
                className="h-10 rounded-full border border-black/10 px-4 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-neutral-200 dark:hover:bg-white/10"
                disabled={!selectedDocs.length || capturing}
                onClick={() => openCapturePicker(selectedDocs)}
              >
                Capture selected ({selectedDocs.length})
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!uncaptured.length || capturing}
                onClick={() => openCapturePicker(uncaptured)}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Capture all ({uncaptured.length})
              </button>
            </div>
          </div>
        </footer>
      </aside>

      <FolderPickerModal
        open={capturePickerOpen}
        suggestedName="discovered-pdfs.pdf"
        mode="pdf"
        fileNameMode="hidden"
        onCancel={() => setCapturePickerOpen(false)}
        onConfirm={runCapture}
      />

      <FolderPickerModal
        open={pageSnapshotPickerOpen}
        suggestedName={sanitizePdfName(sourceTitle || "page")}
        mode="pdf"
        onCancel={() => setPageSnapshotPickerOpen(false)}
        onConfirm={runPageSnapshotCapture}
      />
    </>
  );

  return createPortal(node, document.body);
};

export default PdfDiscoveryDrawer;
