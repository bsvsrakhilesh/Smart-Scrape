import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notebookClient as api,
  Notebook,
  NBSource,
  type SourceDiagnostics,
} from "../lib/notebookClient";
import UrlIcon from "../components/icons/UrlIcon";
import FolderIcon from "../components/icons/FolderIcon";
import ChatPanel from "../components/notebook/ChatPanel";
import NotesEditor from "../components/notebook/NotesEditor";
import RightPanel from "../components/notebook/RightPanel";
import SourcePicker from "../components/notebook/SourcePicker";
import { ListSkeleton } from "../components/common/Skeleton";
import SmartCard from "../components/ui/SmartCard";
import { StaggerList, StaggerItem } from "../components/motion/StaggerList";
import { PlusButton } from "../components/ui/PlusButton";
import { useToast } from "../components/providers/Toast";
import { useConfirm } from "../components/providers/Confirm";
import { consumeNotebookOpenTarget } from "../lib/notebookLaunch";
import { apiRequest } from "../lib/api";
import {
  emitNotebookEvent,
  subscribeNotebookEvent,
} from "../lib/notebookEvents";

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function uniqueById<T extends { id: string | number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const ACTIVE_KEY = "nb:lastId";
const PENDING_ADD_KEY = "nb:pendingAddSource";
const PANEL_SHELL =
  "rounded-2xl border border-slate-200/70 bg-white/75 shadow-[0_1px_0_rgba(255,255,255,0.65)_inset,0_18px_65px_rgba(15,23,42,0.12)] backdrop-blur supports-[backdrop-filter]:bg-white/60";
const PANEL_CONTENT = "flex flex-col overflow-hidden min-h-0";
const PANEL_BAR =
  "border-b border-slate-200/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/65 shadow-[0_1px_0_rgba(255,255,255,0.70)_inset,0_1px_0_rgba(15,23,42,0.06)]";
const PANEL_STICKY =
  "rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/65 shadow-[0_1px_0_rgba(255,255,255,0.70)_inset,0_12px_34px_rgba(15,23,42,0.10)]";

function clampJobPct(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "—";
  const deltaMs = Date.now() - ts;
  const deltaMin = Math.round(deltaMs / 60000);

  if (Math.abs(deltaMin) < 1) return "just now";
  if (Math.abs(deltaMin) < 60) return `${deltaMin}m ago`;

  const deltaHr = Math.round(deltaMin / 60);
  if (Math.abs(deltaHr) < 24) return `${deltaHr}h ago`;

  const deltaDay = Math.round(deltaHr / 24);
  return `${deltaDay}d ago`;
}

type RuntimeJob = NonNullable<SourceDiagnostics["jobs"]["ingestion"]>;
type SourceJobStatus = RuntimeJob["status"] | "NONE";
type SourceReadinessSeverity = "ready" | "processing" | "repair" | "blocked";
type SourceRepairAction =
  | "none"
  | "wait"
  | "retry-ingestion"
  | "retry-indexing"
  | "rebuild-index"
  | "open-repair"
  | "run-ocr";

type SourceReadinessRecommendation = {
  severity: SourceReadinessSeverity;
  label: string;
  detail: string;
  action: SourceRepairAction;
  actionLabel?: string;
};

function jobMessage(job?: RuntimeJob | null) {
  return job?.error || job?.statusMessage || job?.stage || "";
}

function sourceReadinessTone(severity: SourceReadinessSeverity) {
  switch (severity) {
    case "ready":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "processing":
      return "border-blue-200 bg-blue-50 text-blue-900";
    case "repair":
      return "border-rose-200 bg-rose-50 text-rose-900";
    default:
      return "border-amber-200 bg-amber-50 text-amber-900";
  }
}

function sourceReadinessPillTone(severity: SourceReadinessSeverity) {
  switch (severity) {
    case "ready":
      return "border-emerald-200 bg-white text-emerald-800";
    case "processing":
      return "border-blue-200 bg-white text-blue-800";
    case "repair":
      return "border-rose-200 bg-white text-rose-800";
    default:
      return "border-amber-200 bg-white text-amber-800";
  }
}

function sourceKindLooksLikePdf(s?: Pick<NBSource, "kind" | "file"> | null) {
  if (!s || s.kind !== "FILE") return false;
  const mime = (s.file?.mimeType || "").toLowerCase();
  const name = (s.file?.fileName || "").toLowerCase();
  return mime.includes("pdf") || name.endsWith(".pdf");
}

function sourceReadinessRecommendation(s: NBSource): SourceReadinessRecommendation {
  const ing = (s.ingestionJob?.status || "NONE") as SourceJobStatus;
  const emb = (s.embeddingJob?.status || "NONE") as SourceJobStatus;
  const ingMsg = jobMessage(s.ingestionJob);
  const embMsg = jobMessage(s.embeddingJob);

  if (ing === "FAILED") {
    const pdfHint = sourceKindLooksLikePdf(s)
      ? " For scanned PDFs, open repair and try OCR if extraction produced little text."
      : "";
    return {
      severity: "repair",
      label: "Action needed: ingestion failed",
      detail: `${ingMsg || "The source text could not be extracted."}${pdfHint}`,
      action: sourceKindLooksLikePdf(s) ? "open-repair" : "retry-ingestion",
      actionLabel: sourceKindLooksLikePdf(s) ? "Open OCR repair" : "Retry ingestion",
    };
  }

  if (ing === "PENDING" || ing === "RUNNING") {
    return {
      severity: "processing",
      label: ing === "PENDING" ? "Waiting to ingest" : "Ingestion in progress",
      detail:
        ingMsg ||
        "Notebook is extracting source text. Chat will use it after indexing finishes.",
      action: "wait",
    };
  }

  if (ing !== "SUCCESS") {
    return {
      severity: "blocked",
      label: "Not ingested yet",
      detail:
        "No completed ingestion job is attached to this source, so there is no text for chat to retrieve.",
      action: "retry-ingestion",
      actionLabel: "Start ingestion",
    };
  }

  if (emb === "FAILED") {
    return {
      severity: "repair",
      label: "Action needed: index failed",
      detail:
        embMsg ||
        "Text was extracted, but semantic indexing failed. Chat cannot retrieve this source reliably.",
      action: "retry-indexing",
      actionLabel: "Retry indexing",
    };
  }

  if (emb === "PENDING" || emb === "RUNNING") {
    return {
      severity: "processing",
      label: emb === "PENDING" ? "Waiting to index" : "Indexing in progress",
      detail:
        embMsg ||
        "Semantic index is being built. Chat will include this source when indexing completes.",
      action: "wait",
    };
  }

  if (emb !== "SUCCESS") {
    return {
      severity: "blocked",
      label: "Not indexed yet",
      detail:
        "Source text exists but has not been embedded, so evidence-backed chat cannot use it.",
      action: "retry-indexing",
      actionLabel: "Start indexing",
    };
  }

  return {
    severity: "ready",
    label: "Ready for chat",
    detail: "Text extraction and semantic indexing are complete.",
    action: "none",
  };
}

function diagnosticsRecommendation(
  diag: SourceDiagnostics,
): SourceReadinessRecommendation {
  const ing = (diag.jobs.ingestion?.status || "NONE") as SourceJobStatus;
  const emb = (diag.jobs.embedding?.status || "NONE") as SourceJobStatus;
  const ingMsg = jobMessage(diag.jobs.ingestion);
  const embMsg = jobMessage(diag.jobs.embedding);
  const isPdf =
    diag.source.kind === "FILE" &&
    (((diag.source.file?.mimeType || "").toLowerCase().includes("pdf")) ||
      (diag.source.file?.fileName || "").toLowerCase().endsWith(".pdf"));

  if (ing === "FAILED") {
    return {
      severity: "repair",
      label: isPdf ? "Recommended: try OCR or retry ingestion" : "Recommended: retry ingestion",
      detail:
        ingMsg ||
        (isPdf
          ? "The source failed during extraction. If this is scanned, OCR is the highest-signal repair."
          : "The source failed during extraction. Retry ingestion after checking the source."),
      action: isPdf ? "run-ocr" : "retry-ingestion",
      actionLabel: isPdf ? "Run OCR" : "Retry ingestion",
    };
  }

  if (ing === "PENDING" || ing === "RUNNING") {
    return {
      severity: "processing",
      label: "Recommended: wait for ingestion",
      detail: ingMsg || "Extraction is still running. Repair actions are premature.",
      action: "wait",
    };
  }

  if (ing !== "SUCCESS") {
    return {
      severity: "blocked",
      label: "Recommended: start ingestion",
      detail: "No successful ingestion job exists for this source.",
      action: "retry-ingestion",
      actionLabel: "Start ingestion",
    };
  }

  if (emb === "FAILED") {
    return {
      severity: "repair",
      label: "Recommended: retry indexing",
      detail:
        embMsg ||
        "Extraction succeeded but embeddings failed. Retry indexing before rebuilding.",
      action: "retry-indexing",
      actionLabel: "Retry indexing",
    };
  }

  if (emb === "PENDING" || emb === "RUNNING") {
    return {
      severity: "processing",
      label: "Recommended: wait for indexing",
      detail: embMsg || "Embeddings are still being built.",
      action: "wait",
    };
  }

  if (emb !== "SUCCESS") {
    return {
      severity: "blocked",
      label: "Recommended: start indexing",
      detail: "Ingestion succeeded, but no completed embedding job exists.",
      action: "retry-indexing",
      actionLabel: "Start indexing",
    };
  }

  if (diag.counts.chunkCount > 0 && diag.counts.embeddedCount < diag.counts.chunkCount) {
    return {
      severity: "repair",
      label: "Recommended: rebuild index",
      detail: `Only ${diag.counts.embeddedCount} of ${diag.counts.chunkCount} chunks are embedded.`,
      action: "rebuild-index",
      actionLabel: "Rebuild index",
    };
  }

  return {
    severity: "ready",
    label: "No repair needed",
    detail: "This source is ingested, indexed, and available to chat.",
    action: "none",
  };
}

function JobRuntimeCard({
  label,
  job,
}: {
  label: string;
  job: RuntimeJob | null;
}) {
  if (!job) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="text-[12px] font-semibold text-slate-900">{label}</div>
        <div className="mt-2 text-[12px] text-slate-500">
          No recorded job yet.
        </div>
      </div>
    );
  }

  const pct = clampJobPct(job.progressPct);
  const tone =
    job.status === "FAILED"
      ? "border-rose-200 bg-rose-50"
      : job.status === "SUCCESS"
        ? "border-emerald-200 bg-emerald-50"
        : job.status === "RUNNING" || job.status === "PENDING"
          ? "border-blue-200 bg-blue-50"
          : "border-slate-200 bg-slate-50";

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold text-slate-900">{label}</div>
        <div className="rounded-full border border-white/70 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
          {job.status}
        </div>
      </div>

      <div className="mt-2 text-sm font-medium text-slate-900">
        {job.statusMessage || job.stage || "Status reported"}
      </div>

      <div className="mt-1 text-[12px] text-slate-600">
        {job.stage ? `Stage: ${job.stage}` : "Stage not reported"} · Attempt{" "}
        {job.attemptCount ?? 0}
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
        <div
          className="h-full rounded-full bg-slate-900/80 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <span>{pct}%</span>
        <span>Updated {formatRelativeTime(job.updatedAt)}</span>
        {job.lastHeartbeatAt ? (
          <span>Heartbeat {formatRelativeTime(job.lastHeartbeatAt)}</span>
        ) : null}
      </div>
    </div>
  );
}

export default function NotebookPage() {
  const qc = useQueryClient();
  const { notify } = useToast();
  const { confirm } = useConfirm();

  useEffect(() => {
    return subscribeNotebookEvent("toast", (detail) => {
      if (!detail) return;
      notify(detail);
    });
  }, [notify]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "url" | "file">(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [fixSourceId, setFixSourceId] = useState<string | null>(null);
  const [ocrLangs, setOcrLangs] = useState("eng");
  const [ocrPages, setOcrPages] = useState("");
  const [ocrEngine, setOcrEngine] = useState<
    "auto" | "ocrmypdf" | "tesseract"
  >("auto");
  const [ocrDeskew, setOcrDeskew] = useState(true);
  const [ocrRotatePages, setOcrRotatePages] = useState(true);
  const [ocrClean, setOcrClean] = useState(false);
  const [ocrFallback, setOcrFallback] = useState(true);

  // mobile panel switcher state
  const [mobileTab, setMobileTab] = useState<"sources" | "chat" | "notes">(
    "chat",
  );

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({}); // sourceId -> element
  // When there are zero notebooks, auto-create one so Chat is immediately usable.
  const autoCreateRef = useRef(false);
  const pendingOpenTargetRef = useRef(consumeNotebookOpenTarget());

  // ===== Sources Library UI state =====
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceKind, setSourceKind] = useState<"all" | "URL" | "FILE">("all");
  const [sourceSort, setSourceSort] = useState<"recent" | "name">("recent");

  // ===== scope control (include/exclude sources) =====
  const scopeKey = activeId ? `nb:scope:excluded:${activeId}` : null;
  const [excludedSourceIds, setExcludedSourceIds] = useState<Set<string>>(
    new Set(),
  );

  // load scope when switching notebooks
  useEffect(() => {
    if (!scopeKey) return;
    try {
      const raw = localStorage.getItem(scopeKey);
      const arr = raw ? (JSON.parse(raw) as string[]) : [];
      setExcludedSourceIds(new Set(Array.isArray(arr) ? arr : []));
    } catch {
      setExcludedSourceIds(new Set());
    }
  }, [scopeKey]);

  // persist scope
  useEffect(() => {
    if (!scopeKey) return;
    localStorage.setItem(scopeKey, JSON.stringify([...excludedSourceIds]));
  }, [scopeKey, excludedSourceIds]);

  const toggleSourceIncluded = (sourceId: string) => {
    setExcludedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const useAllSources = () => setExcludedSourceIds(new Set());

  // data
  const listQ = useQuery({ queryKey: ["nb:list"], queryFn: api.listNotebooks });
  const detailQ = useQuery({
    queryKey: ["nb:detail", activeId],
    queryFn: () => api.getNotebook(activeId!),
    enabled: !!activeId,
  });
  const sourcesQ = useQuery({
    queryKey: ["nb:sources", activeId],
    queryFn: () => api.listSources(activeId!),
    enabled: !!activeId,
    refetchInterval: (query) => {
      const arr = query.state.data ?? [];
      const needs = arr.some((s) => {
        const ing = s.ingestionJob?.status ?? "NONE";
        const emb = s.embeddingJob?.status ?? "NONE";

        if (ing === "PENDING" || ing === "RUNNING") return true;
        if (ing === "SUCCESS" && (emb === "PENDING" || emb === "RUNNING"))
          return true;

        return false;
      });

      return needs ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const notebookList = useMemo(
    () => uniqueById((listQ.data || []) as Notebook[]),
    [listQ.data],
  );

  useEffect(() => {
    const pending = pendingOpenTargetRef.current;
    if (!pending?.notebookId) return;

    setActiveId(pending.notebookId);
    try {
      localStorage.setItem(ACTIVE_KEY, pending.notebookId);
    } catch {
      // ignore
    }
  }, []);

  // If another page sent a FILE revision here, add it as a source automatically.
  useEffect(() => {
    if (!activeId) return;

    let pendingRaw: string | null = null;
    try {
      pendingRaw = localStorage.getItem(PENDING_ADD_KEY);
    } catch {
      pendingRaw = null;
    }
    if (!pendingRaw) return;

    let payload: any = null;
    try {
      payload = JSON.parse(pendingRaw);
    } catch {
      payload = null;
    }

    // Always clear so we don't loop
    try {
      localStorage.removeItem(PENDING_ADD_KEY);
    } catch {
      // ignore
    }

    if (!payload || payload.kind !== "FILE" || !payload.id) return;

    const fileId = String(payload.id);

    const already = (sourcesQ.data || []).some(
      (s: any) => s.kind === "FILE" && s.file?.id === fileId,
    );

    if (already) {
      notify({ text: "Already in this notebook.", kind: "info" });
      return;
    }

    api
      .addFileSource(activeId, fileId)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["nb:sources", activeId] });
        notify({
          text: "Added revision to notebook sources.",
          kind: "success",
        });
      })
      .catch((e: any) => {
        notify({
          text: e?.message ?? "Failed to add source to notebook",
          kind: "error",
        });
      });
  }, [activeId, sourcesQ.data, qc, notify]);

  useEffect(() => {
    const pending = pendingOpenTargetRef.current;
    if (!pending?.noteId) return;
    if (!activeId || pending.notebookId !== activeId) return;

    const note = (detailQ.data?.notes || []).find(
      (item) => item.id === pending.noteId,
    );
    if (!note) return;

    emitNotebookEvent("open-note", note);
    pendingOpenTargetRef.current = null;
    setMobileTab("notes");
  }, [activeId, detailQ.data?.notes]);

  // restore last selected notebook (can be stale if DB was reset)
  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved) setActiveId(saved);
  }, []);

  // validate / choose active notebook once list loads
  useEffect(() => {
    if (listQ.isLoading) return;

    const list = notebookList;

    // If we have an activeId but it's not in the DB anymore, clear it (and localStorage)
    if (activeId) {
      const exists = list.some((n) => n.id === activeId);
      if (!exists) {
        localStorage.removeItem(ACTIVE_KEY);
        setActiveId(list[0]?.id ?? null);
      }
      return;
    }

    // No activeId yet → pick the first notebook if any exist
    if (list.length) setActiveId(list[0].id);
  }, [listQ.isLoading, notebookList, activeId]);

  // persist active notebook id (and clean up when null)
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  }, [activeId]);

  // when switching notebooks on mobile, default to Chat
  useEffect(() => {
    if (activeId) setMobileTab("chat");
  }, [activeId]);

  useEffect(() => {
    setConfirmDeleteId(null);
  }, [activeId]);

  // create / update
  const createM = useMutation({
    mutationFn: (p: { title: string; description?: string }) =>
      api.createNotebook(p),
    onSuccess: (nb) => {
      qc.invalidateQueries({ queryKey: ["nb:list"] });
      setActiveId(nb.id);
      notify({ text: "Notebook created.", kind: "success" });
    },
    onError: (err: any) => {
      autoCreateRef.current = false;
      notify({
        text: err?.message || "Could not create notebook.",
        kind: "error",
      });
    },
  });

  // Auto-create the very first notebook (fresh user / empty DB).
  useEffect(() => {
    if (autoCreateRef.current) return;
    if (activeId) return;
    if (listQ.isLoading) return;

    const hasAny = notebookList.length > 0;
    if (hasAny) return;

    autoCreateRef.current = true;

    createM.mutate({
      title: "My first notebook",
      description: "Auto-created to start chatting.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, listQ.isLoading, notebookList]);

  const updateTitle = useMutation({
    mutationFn: (p: { id: string; title: string }) =>
      api.updateNotebook(p.id, { title: p.title }),

    onMutate: async (vars) => {
      // Cancel in-flight fetches so our optimistic update isn't overwritten.
      await qc.cancelQueries({ queryKey: ["nb:list"] });
      await qc.cancelQueries({ queryKey: ["nb:detail", vars.id] });

      const prevList = qc.getQueryData(["nb:list"]) as Notebook[] | undefined;
      const prevDetail = qc.getQueryData(["nb:detail", vars.id]) as any;

      const nowIso = new Date().toISOString();

      // Optimistically update list
      if (prevList) {
        qc.setQueryData(
          ["nb:list"],
          prevList.map((n) =>
            n.id === vars.id
              ? { ...n, title: vars.title, updatedAt: nowIso }
              : n,
          ),
        );
      }

      // Optimistically update detail
      if (prevDetail?.notebook) {
        qc.setQueryData(["nb:detail", vars.id], {
          ...prevDetail,
          notebook: {
            ...prevDetail.notebook,
            title: vars.title,
            updatedAt: nowIso,
          },
        });
      }

      return { prevList, prevDetail };
    },

    onError: (err, vars, ctx) => {
      // Rollback optimistic update
      if (ctx?.prevList) qc.setQueryData(["nb:list"], ctx.prevList);
      if (ctx?.prevDetail)
        qc.setQueryData(["nb:detail", vars.id], ctx.prevDetail);

      notify({
        text: `Could not rename notebook: ${String((err as any)?.message || err)}`,
        kind: "error",
      });
    },

    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:list"] });
      qc.invalidateQueries({ queryKey: ["nb:detail", vars.id] });
    },
  });

  const deleteNotebookM = useMutation({
    mutationFn: (id: string) => api.deleteNotebook(id),
    onMutate: (id) => {
      setConfirmDeleteId(null);

      const prev = (qc.getQueryData(["nb:list"]) as Notebook[]) || [];
      const prevActiveId = activeId;
      const nextList = prev.filter((n) => n.id !== id);
      qc.setQueryData(["nb:list"], nextList);

      qc.removeQueries({ queryKey: ["nb:detail", id] });
      qc.removeQueries({ queryKey: ["nb:sources", id] });

      if (activeId === id) {
        setActiveId(nextList[0]?.id ?? null);
      }

      return { prev, prevActiveId };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["nb:list"], ctx.prev);
      if (ctx?.prevActiveId) setActiveId(ctx.prevActiveId);
      notify({
        text: "Could not delete notebook. Your workspace was restored.",
        kind: "error",
      });
    },
    onSuccess: () => {
      notify({ text: "Notebook deleted.", kind: "success" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["nb:list"] });
    },
  });

  const delSourceM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) =>
      api.deleteSource(vars.notebookId, vars.sourceId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:sources", vars.notebookId] });
      notify({ text: "Source removed from notebook.", kind: "success" });
    },
    onError: (e: any) =>
      notify({
        text: e?.message || "Failed to remove source.",
        kind: "error",
      }),
  });

  const removeSource = async (source: NBSource) => {
    if (!activeId) return;
    const label = sourceTitle(source);
    const ok = await confirm({
      title: "Remove source?",
      description: `Remove "${label}" from this notebook. The original saved URL or file stays in your library.`,
      confirmText: "Remove",
      cancelText: "Cancel",
      danger: true,
    });
    if (!ok) return;
    delSourceM.mutate({ notebookId: activeId, sourceId: source.id });
  };

  // =======================
  // Source diagnostics + repair
  // =======================
  function apiReq<T>(method: string, path: string, body?: any): Promise<T> {
    return apiRequest<T>(method, `/api${path}`, { body });
  }

  const diagQ = useQuery({
    queryKey: ["nb:sourceDiag", activeId, fixSourceId],
    queryFn: () =>
      apiReq<SourceDiagnostics>(
        "GET",
        `/notebooks/${activeId!}/sources/${fixSourceId!}/diagnostics?maxChars=20000`,
      ),
    enabled: !!activeId && !!fixSourceId,
  });

  const retryIngestionM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) =>
      apiReq<NBSource>(
        "POST",
        `/notebooks/${vars.notebookId}/sources/${vars.sourceId}/retry-ingestion`,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:sources", vars.notebookId] });
      qc.invalidateQueries({
        queryKey: ["nb:sourceDiag", vars.notebookId, vars.sourceId],
      });
      notify({ text: "Retrying ingestion…", kind: "success" });
    },
    onError: (e: any) =>
      notify({
        text: e?.message || "Failed to retry ingestion",
        kind: "error",
      }),
  });

  const retryEmbeddingM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) =>
      apiReq<NBSource>(
        "POST",
        `/notebooks/${vars.notebookId}/sources/${vars.sourceId}/retry-embedding`,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:sources", vars.notebookId] });
      qc.invalidateQueries({
        queryKey: ["nb:sourceDiag", vars.notebookId, vars.sourceId],
      });
      notify({ text: "Retrying indexing…", kind: "success" });
    },
    onError: (e: any) =>
      notify({ text: e?.message || "Failed to retry indexing", kind: "error" }),
  });

  const rebuildEmbeddingM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) =>
      apiReq<NBSource>(
        "POST",
        `/notebooks/${vars.notebookId}/sources/${vars.sourceId}/rebuild-embedding`,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:sources", vars.notebookId] });
      qc.invalidateQueries({
        queryKey: ["nb:sourceDiag", vars.notebookId, vars.sourceId],
      });
      notify({ text: "Rebuilding index…", kind: "success" });
    },
    onError: (e: any) =>
      notify({ text: e?.message || "Failed to rebuild index", kind: "error" }),
  });

  const runOcrM = useMutation({
    mutationFn: (vars: {
      notebookId: string;
      sourceId: string;
      options?: {
        langs?: string;
        pages?: string;
        engine?: "auto" | "ocrmypdf" | "tesseract";
        deskew?: boolean;
        rotatePages?: boolean;
        clean?: boolean;
        fallback?: boolean;
      };
    }) =>
      apiReq<NBSource>(
        "POST",
        `/notebooks/${vars.notebookId}/sources/${vars.sourceId}/run-ocr`,
        vars.options ?? {},
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:sources", vars.notebookId] });
      qc.invalidateQueries({
        queryKey: ["nb:sourceDiag", vars.notebookId, vars.sourceId],
      });
      notify({ text: "OCR started… (this can take a bit)", kind: "success" });
    },
    onError: (e: any) =>
      notify({ text: e?.message || "Failed to start OCR", kind: "error" }),
  });

  const diag = diagQ.data as SourceDiagnostics | undefined;
  const diagnosticReadiness = diag ? diagnosticsRecommendation(diag) : null;
  const ocrMeta = (diag?.jobs?.ingestion?.meta as any)?.ocr ?? null;
  const scanMeta =
    (diag?.jobs?.ingestion?.meta as any)?.scan ??
    (diag?.activeRevision?.pipelineConfig as any)?.config?.scanMetrics ??
    null;

  const active: Notebook | null = detailQ.data?.notebook ?? null;
  const notebookLoadError =
    (listQ.error as Error | null) ||
    (detailQ.error as Error | null) ||
    (sourcesQ.error as Error | null);

  // ===== Notebook title editing (world-class UX) =====
  const TITLE_DEBOUNCE_MS = 650;

  const [titleDraft, setTitleDraft] = useState<string>("");
  const titleTimerRef = useRef<number | null>(null);
  const pendingTitleRef = useRef<string>("");
  const lastSavedTitleRef = useRef<string>("");
  const activeIdRef = useRef<string | null>(null);
  const titleReqSeqRef = useRef<number>(0);

  const normalizeTitle = (t: string) =>
    String(t ?? "")
      .replace(/\s+/g, " ")
      .trim();

  const flushTitleSave = (raw?: string) => {
    if (titleTimerRef.current != null) {
      window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }
    if (!activeId) return;

    const candidate = normalizeTitle(
      raw ?? pendingTitleRef.current ?? titleDraft,
    );
    const next = candidate || "Untitled notebook";
    const prev = normalizeTitle(lastSavedTitleRef.current);

    if (next === prev) return;

    // Sequence guard to prevent late responses from overwriting newer state
    const seq = ++titleReqSeqRef.current;

    updateTitle.mutate(
      { id: activeId, title: next },
      {
        onSuccess: () => {
          if (seq === titleReqSeqRef.current) {
            lastSavedTitleRef.current = next;
          }
        },
      },
    );
  };

  const scheduleTitleSave = (nextDraft: string) => {
    pendingTitleRef.current = nextDraft;

    if (titleTimerRef.current != null) {
      window.clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
    }

    titleTimerRef.current = window.setTimeout(() => {
      flushTitleSave(nextDraft);
    }, TITLE_DEBOUNCE_MS);
  };

  // Sync draft when switching notebooks, without clobbering in-progress edits
  useEffect(() => {
    const serverTitle = detailQ.data?.notebook?.title ?? "";

    // No active notebook
    if (!activeId) {
      setTitleDraft("");
      pendingTitleRef.current = "";
      lastSavedTitleRef.current = "";
      activeIdRef.current = null;

      if (titleTimerRef.current != null) {
        window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      return;
    }

    // Notebook switched
    if (activeIdRef.current !== activeId) {
      activeIdRef.current = activeId;
      setTitleDraft(serverTitle);
      pendingTitleRef.current = serverTitle;
      lastSavedTitleRef.current = serverTitle;

      if (titleTimerRef.current != null) {
        window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
      return;
    }

    // If server updates title and user isn't dirty, sync it
    const dirty =
      normalizeTitle(titleDraft) !== normalizeTitle(lastSavedTitleRef.current);

    if (!dirty && serverTitle !== lastSavedTitleRef.current) {
      setTitleDraft(serverTitle);
      pendingTitleRef.current = serverTitle;
      lastSavedTitleRef.current = serverTitle;
    }
  }, [activeId, detailQ.data?.notebook?.title, titleDraft]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (titleTimerRef.current != null) {
        window.clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
      }
    };
  }, []);

  // ===== Sources Library computed list =====
  const sources: NBSource[] = useMemo(
    () => uniqueById((sourcesQ.data || []) as NBSource[]),
    [sourcesQ.data],
  );

  const isSourceReady = (s: NBSource) => {
    const ing = s.ingestionJob?.status ?? "NONE";
    const emb = s.embeddingJob?.status ?? "NONE";
    return ing === "SUCCESS" && emb === "SUCCESS";
  };

  const { includedSourceIds, readySourceIds, notReadyIncludedCount } =
    useMemo(() => {
      const included = sources.filter((s) => !excludedSourceIds.has(s.id));
      const ready = included.filter(isSourceReady);

      return {
        includedSourceIds: included.map((s) => s.id),
        readySourceIds: ready.map((s) => s.id),
        notReadyIncludedCount: Math.max(0, included.length - ready.length),
      };
    }, [sources, excludedSourceIds]);

  const includedCount = includedSourceIds.length;
  const excludedCount = Math.max(0, sources.length - includedCount);
  const sourceReadinessCounts = useMemo(() => {
    const counts: Record<SourceReadinessSeverity, number> = {
      ready: 0,
      processing: 0,
      repair: 0,
      blocked: 0,
    };

    for (const source of sources) {
      counts[sourceReadinessRecommendation(source).severity] += 1;
    }

    return counts;
  }, [sources]);

  // if sources change, drop exclusions that no longer exist
  useEffect(() => {
    if (!sourcesQ.isFetched) return;
    const all = new Set(sources.map((s) => s.id));
    setExcludedSourceIds((prev) => {
      const next = new Set([...prev].filter((id) => all.has(id)));
      return next;
    });
  }, [sources, sourcesQ.isFetched]);

  const sourceTitle = (s: NBSource) =>
    s.kind === "URL"
      ? s.url?.title || s.url?.url || "URL"
      : s.file?.fileName || "File";

  const sourceSub = (s: NBSource) =>
    s.kind === "URL" ? s.url?.url || "" : s.file?.mimeType || "file";

  const indexBadgeForSource = (s: NBSource) => {
    const ing = s.ingestionJob?.status || "NONE";
    const emb = s.embeddingJob?.status || "NONE";
    const ingPct = clampJobPct(s.ingestionJob?.progressPct);
    const embPct = clampJobPct(s.embeddingJob?.progressPct);

    if (ing === "FAILED") {
      return {
        label: "Failed",
        tone: "red",
        title:
          s.ingestionJob?.error ||
          s.ingestionJob?.statusMessage ||
          "Ingestion failed",
      };
    }
    if (ing === "PENDING") {
      return {
        label: ingPct > 0 ? `Queued ${ingPct}%` : "Queued",
        tone: "amber",
        title: s.ingestionJob?.statusMessage || "Waiting to ingest",
      };
    }
    if (ing === "RUNNING") {
      return {
        label: ingPct > 0 ? `${ingPct}% ingest` : "Processing",
        tone: "blue",
        title: s.ingestionJob?.statusMessage || "Ingesting content",
      };
    }

    if (ing !== "SUCCESS") {
      return { label: "Not ready", tone: "slate", title: "Not indexed yet" };
    }

    if (emb === "FAILED") {
      return {
        label: "Index failed",
        tone: "red",
        title:
          s.embeddingJob?.error ||
          s.embeddingJob?.statusMessage ||
          "Embedding/index job failed",
      };
    }

    if (emb === "PENDING" || emb === "RUNNING") {
      return {
        label: embPct > 0 ? `Index ${embPct}%` : "Indexing",
        tone: "amber",
        title:
          s.embeddingJob?.statusMessage ||
          "Building semantic index (embeddings)",
      };
    }

    return { label: "Ready", tone: "green", title: "Ready for chat" };
  };

  const renderIndexBadge = (s: NBSource) => {
    const b = indexBadgeForSource(s);
    const cls =
      b.tone === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : b.tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : b.tone === "blue"
            ? "border-blue-200 bg-blue-50 text-blue-800"
            : b.tone === "red"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-slate-200 bg-slate-50 text-slate-700";

    return (
      <span
        title={b.title}
        className={`text-[10px] px-2 py-0.5 rounded-full border ${cls}`}
      >
        {b.label}
      </span>
    );
  };

  const filteredSources = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();

    let out = sources.slice();

    if (sourceKind !== "all") {
      out = out.filter((s) => s.kind === sourceKind);
    }

    if (q) {
      out = out.filter((s) => {
        const t = sourceTitle(s).toLowerCase();
        const sub = sourceSub(s).toLowerCase();
        return (t + " " + sub).includes(q);
      });
    }

    // "recent" = keep backend order (stable). "name" = alphabetical.
    if (sourceSort === "name") {
      out.sort((a, b) => sourceTitle(a).localeCompare(sourceTitle(b)));
    }

    return out;
  }, [sources, sourceQuery, sourceKind, sourceSort]);

  // highlight + scroll to a source card
  const focusSource = (sourceId: string) => {
    // mobile UX: jump to Sources tab before scrolling/highlighting
    if (typeof window !== "undefined" && window.innerWidth < 768)
      setMobileTab("sources");

    const el = cardRefs.current[sourceId];
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-indigo-500", "animate-pulse");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-indigo-500", "animate-pulse");
    }, 1500);
  };

  // listen for events (when backend maps chunkId -> sourceId, emit nb:focus-source)
  useEffect(() => {
    return subscribeNotebookEvent("focus-source", (sourceId) => {
      if (sourceId) focusSource(sourceId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return subscribeNotebookEvent("manage-sources", () => {
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setMobileTab("sources");
      }
    });
  }, []);

  // Cmd/Ctrl+K opens picker (Shift selects Files)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPicker(e.shiftKey ? "file" : "url");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <div className="h-full min-h-0 flex flex-col p-3 md:p-4">
        {/* Mobile panel switcher */}
        <div className="md:hidden mb-3">
          <div
            className={clsx(
              PANEL_SHELL,
              "px-3 py-2 flex items-center justify-between gap-3",
            )}
          >
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/5 border border-slate-200/70">
              {(["sources", "chat", "notes"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMobileTab(t)}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-[12px] font-semibold tracking-tight transition-all",
                    mobileTab === t
                      ? "bg-white text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.12)]"
                      : "text-slate-600 hover:text-slate-800 hover:bg-white/60",
                  )}
                  aria-pressed={mobileTab === t}
                >
                  {t === "sources"
                    ? "Sources"
                    : t === "chat"
                      ? "Chat"
                      : "Notes"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={!activeId}
                onClick={() => setPicker("url")}
                className="text-[12px] px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-60"
                title="Add URL (Ctrl/⌘+K)"
              >
                + URL
              </button>
              <button
                disabled={!activeId}
                onClick={() => setPicker("file")}
                className="text-[12px] px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-60"
                title="Add File (Ctrl/⌘+Shift+K)"
              >
                + File
              </button>
            </div>
          </div>
        </div>

        {notebookLoadError ? (
          <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-800 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-rose-950">
                  Notebook data could not be fully loaded
                </div>
                <div className="mt-1 text-rose-800/90">
                  {notebookLoadError.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void listQ.refetch();
                  if (activeId) {
                    void detailQ.refetch();
                    void sourcesQ.refetch();
                  }
                }}
                className="rounded-2xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-50"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)_420px] items-stretch flex-1 min-h-0 gap-3 md:gap-4">
          {/* Left rail */}
          <div
            className={clsx(
              PANEL_SHELL,
              PANEL_CONTENT,
              "p-3",
              mobileTab === "sources" ? "flex" : "hidden",
              "md:flex",
            )}
          >
            {/* Notebooks */}
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">
                Notebooks
              </h2>
              <button
                onClick={() =>
                  createM.mutate({
                    title: `Notebook ${new Date().toLocaleTimeString()}`,
                  })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-medium shadow-[0_10px_24px_rgba(15,23,42,0.35)] hover:bg-slate-950 hover:-translate-y-0.5 active:translate-y-[1px] active:shadow-[0_4px_14px_rgba(15,23,42,0.55)] transition-all duration-200 transform"
              >
                New
              </button>
            </div>

            <div className="space-y-1 overflow-auto overscroll-contain max-h-44 pr-1 pb-1">
              {listQ.isLoading ? (
                <ListSkeleton rows={4} />
              ) : (
                notebookList.map((n) => (
                  <div key={n.id} className="group relative">
                    <button
                      onClick={() => setActiveId(n.id)}
                      className={clsx(
                        "group relative w-full h-9 flex items-center text-left px-3 pr-10 rounded-md text-sm transition-all duration-200 transform",
                        "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]",
                        activeId === n.id
                          ? "bg-slate-50 text-slate-900 shadow-[0_10px_26px_rgba(15,23,42,0.12)] -translate-y-[1px]"
                          : "bg-white/85 text-slate-700 hover:bg-slate-50 hover:shadow-[0_10px_24px_rgba(15,23,42,0.10)] hover:-translate-y-[1px]",
                      )}
                    >
                      <span
                        className={clsx(
                          "absolute left-0 top-1/2 -translate-y-1/2 h-5 rounded-r transition-all duration-200",
                          activeId === n.id
                            ? "w-1.5 bg-slate-900/70"
                            : "w-[3px] bg-slate-300/80 opacity-0 group-hover:opacity-100 group-hover:translate-x-[1px]",
                        )}
                      />
                      <span className="truncate">{n.title}</span>
                    </button>

                    {/* Delete affordance */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId((prev) =>
                          prev === n.id ? null : n.id,
                        );
                      }}
                      className={clsx(
                        "absolute right-1.5 top-1/2 -translate-y-1/2 z-10",
                        "w-8 h-8 rounded-xl grid place-items-center",
                        "border border-transparent",
                        "text-slate-500 hover:text-rose-700 hover:bg-rose-50",
                        "opacity-0 group-hover:opacity-100 transition-opacity",
                      )}
                      aria-label="Delete notebook"
                      title="Delete"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M9 3h6m-8 4h10m-1 0-1 16H8L7 7"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <path
                          d="M10 11v7M14 11v7"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>

                    {/* Inline confirm popover */}
                    {confirmDeleteId === n.id ? (
                      <div
                        className={clsx(
                          "absolute right-1 top-[calc(100%+6px)] z-20 w-[220px]",
                          "rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]",
                          "p-3",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-[12px] font-semibold text-slate-900">
                          Delete notebook?
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600 leading-relaxed">
                          This will remove its sources, chunks and notes.
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="h-8 px-3 rounded-xl text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteNotebookM.mutate(n.id)}
                            className="h-8 px-3 rounded-xl text-[12px] font-semibold text-white bg-rose-600 hover:bg-rose-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {/* Sources (library panel) */}
            <div className="mt-4 border-t border-slate-200/70 pt-3 flex-1 min-h-0 flex flex-col">
              <div className={clsx(PANEL_STICKY, "sticky top-0 z-10 mb-2")}>
                {/* Row 1: title + counts + add actions */}
                <div className="px-2 pt-2 pb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold text-slate-800">
                        Sources
                      </h3>
                      <span className="text-[11px] text-slate-600 bg-slate-100/80 border border-slate-200 rounded-full px-2 py-0.5 tabular-nums">
                        Using {includedCount}/{sources.length}
                      </span>
                    </div>
                    {sources.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                          Ready {sourceReadinessCounts.ready}
                        </span>
                        {sourceReadinessCounts.repair ? (
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-800">
                            Repair {sourceReadinessCounts.repair}
                          </span>
                        ) : null}
                        {sourceReadinessCounts.processing ? (
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">
                            Processing {sourceReadinessCounts.processing}
                          </span>
                        ) : null}
                        {sourceReadinessCounts.blocked ? (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                            Blocked {sourceReadinessCounts.blocked}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <button
                      disabled={!activeId}
                      onClick={() => setPicker("url")}
                      className="text-xs px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 shadow-sm disabled:opacity-60"
                    >
                      <UrlIcon className="w-3 h-3" /> Add URL
                    </button>
                    <button
                      disabled={!activeId}
                      onClick={() => setPicker("file")}
                      className="text-xs px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 shadow-sm disabled:opacity-60"
                    >
                      <FolderIcon className="w-3 h-3" /> Add File
                    </button>
                    {excludedCount > 0 ? (
                      <button
                        type="button"
                        onClick={useAllSources}
                        className="text-xs px-3 py-1.5 rounded-full border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-sm"
                        title="Include all sources"
                      >
                        Use all
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Row 2: search */}
                <div className="px-2 pb-2">
                  <div className="relative">
                    <input
                      name="notebook-source-query"
                      value={sourceQuery}
                      onChange={(e) => setSourceQuery(e.target.value)}
                      placeholder="Search sources…"
                      className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 pr-9 text-[12px] text-slate-800 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                    />
                    {sourceQuery.trim() ? (
                      <button
                        type="button"
                        onClick={() => setSourceQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 text-xs"
                        aria-label="Clear search"
                        title="Clear"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Row 3: filters + sort */}
                <div className="px-2 pb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {(["all", "URL", "FILE"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSourceKind(k)}
                        className={clsx(
                          "h-7 px-2.5 rounded-full text-[11px] font-semibold border transition",
                          sourceKind === k
                            ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                        )}
                        aria-pressed={sourceKind === k}
                      >
                        {k === "all" ? "All" : k === "URL" ? "URLs" : "Files"}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setSourceSort((s) => (s === "recent" ? "name" : "recent"))
                    }
                    className="h-7 px-2.5 rounded-full text-[11px] font-semibold border bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    title={
                      sourceSort === "recent"
                        ? "Sorting: Recent"
                        : "Sorting: A→Z"
                    }
                  >
                    {sourceSort === "recent" ? "Recent" : "A→Z"}
                  </button>
                </div>
              </div>

              {sources.length > 0 && readySourceIds.length === 0 ? (
                <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-[12px] leading-5 text-amber-900">
                  <div className="font-semibold">No chat-ready sources yet</div>
                  <div className="text-amber-800/80">
                    Keep sources included, then repair failed jobs or wait for
                    indexing to finish before asking evidence-backed questions.
                  </div>
                </div>
              ) : null}

              {sources.length > 0 && includedCount === 0 ? (
                <div className="mb-2 rounded-2xl border border-rose-200 bg-rose-50/90 px-3 py-2 text-[12px] leading-5 text-rose-900">
                  <div className="font-semibold">All sources are excluded</div>
                  <div className="text-rose-800/80">
                    Use all sources, or include specific cards, so chat cannot
                    answer from an unintended scope.
                  </div>
                </div>
              ) : null}

              <StaggerList
                as="div"
                className="flex-1 min-h-0 overflow-auto overscroll-contain space-y-2 pr-1 pb-1"
              >
                {sourcesQ.isLoading ? (
                  <ListSkeleton rows={6} />
                ) : filteredSources.length === 0 ? (
                  <div className="p-3">
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                      <div className="text-sm font-semibold text-slate-800">
                        No sources found
                      </div>
                      <div className="mt-1 text-[12px] text-slate-600 leading-relaxed">
                        {sources.length === 0
                          ? "Add a URL or file to start building your library."
                          : "Try a different search or filter."}
                      </div>
                    </div>
                  </div>
                ) : (
                  filteredSources.map((s: NBSource) => {
                    const title = sourceTitle(s);
                    const sub = sourceSub(s);
                    const isUrl = s.kind === "URL";
                    const href = isUrl ? s.url?.url : null;
                    const liveRuntime =
                      s.ingestionJob && s.ingestionJob.status !== "SUCCESS"
                        ? s.ingestionJob
                        : s.embeddingJob && s.embeddingJob.status !== "SUCCESS"
                          ? s.embeddingJob
                          : null;
                    const readiness = sourceReadinessRecommendation(s);
                    const canOpenRepair =
                      readiness.action !== "none" && readiness.action !== "wait";

                    return (
                      <StaggerItem as="div" key={s.id}>
                        <SmartCard
                          as="div"
                          ref={(el) => {
                            if (el)
                              cardRefs.current[s.id] =
                                el as unknown as HTMLDivElement;
                          }}
                          onClick={() => {
                            if (href)
                              window.open(
                                href,
                                "_blank",
                                "noopener,noreferrer",
                              );
                          }}
                          className={clsx(
                            "group relative flex items-start gap-3 p-3 rounded-2xl border border-slate-200/80 bg-white/85",
                            "hover:bg-white hover:shadow-[0_16px_50px_rgba(15,23,42,0.10)] transition-all duration-200",
                            href ? "cursor-pointer" : "cursor-default",
                          )}
                        >
                          <div
                            className={clsx(
                              "w-9 h-9 rounded-2xl grid place-items-center border shadow-sm",
                              isUrl
                                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                                : "bg-emerald-50 border-emerald-200 text-emerald-700",
                            )}
                            title={isUrl ? "URL" : "File"}
                          >
                            {isUrl ? (
                              <UrlIcon className="w-4 h-4" />
                            ) : (
                              <FolderIcon className="w-4 h-4" />
                            )}
                          </div>

                          <div className="text-xs flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold truncate text-slate-900">
                                {title}
                              </div>
                              {href ? (
                                <span className="opacity-0 group-hover:opacity-100 transition text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                                  Open
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-1 text-[11px] text-slate-500 truncate">
                              {sub}
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                              {renderIndexBadge(s)}
                              {(s.ingestionJob?.status === "FAILED" ||
                                s.embeddingJob?.status === "FAILED") &&
                              activeId ? (
                                <button
                                  type="button"
                                  onClick={(e: any) => {
                                    e?.stopPropagation?.();
                                    setFixSourceId(s.id);
                                  }}
                                  className="text-[10px] px-2.5 py-0.5 rounded-full border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                                  title="See error + retry"
                                >
                                  Fix
                                </button>
                              ) : null}
                              <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">
                                {isUrl ? "URL" : "FILE"}
                              </span>
                              <button
                                type="button"
                                onClick={(e: any) => {
                                  e?.stopPropagation?.();
                                  toggleSourceIncluded(s.id);
                                }}
                                className={clsx(
                                  "text-[10px] px-2.5 py-0.5 rounded-full border transition",
                                  excludedSourceIds.has(s.id)
                                    ? "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
                                )}
                                title={
                                  excludedSourceIds.has(s.id)
                                    ? "Excluded from chat context"
                                    : "Included in chat context"
                                }
                              >
                                {excludedSourceIds.has(s.id)
                                  ? "Excluded"
                                  : "Included"}
                              </button>
                            </div>

                            <div
                              className={clsx(
                                "mt-2 rounded-2xl border px-3 py-2 text-[11px] leading-5",
                                sourceReadinessTone(readiness.severity),
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold">
                                    {readiness.label}
                                  </div>
                                  <div className="mt-0.5 opacity-90">
                                    {readiness.detail}
                                  </div>
                                </div>
                                <span
                                  className={clsx(
                                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                    sourceReadinessPillTone(readiness.severity),
                                  )}
                                >
                                  {readiness.severity === "ready"
                                    ? "Usable"
                                    : readiness.severity === "processing"
                                      ? "Wait"
                                      : "Fix"}
                                </span>
                              </div>
                              {canOpenRepair && activeId ? (
                                <button
                                  type="button"
                                  onClick={(e: any) => {
                                    e?.stopPropagation?.();
                                    setFixSourceId(s.id);
                                  }}
                                  className="mt-2 rounded-full border border-white/70 bg-white/85 px-2.5 py-1 text-[11px] font-semibold shadow-sm transition hover:bg-white"
                                >
                                  {readiness.actionLabel || "Open repair"}
                                </button>
                              ) : null}
                            </div>

                            {liveRuntime?.statusMessage ||
                            liveRuntime?.stage ? (
                              <div className="mt-2 text-[11px] text-slate-500 truncate">
                                {liveRuntime.statusMessage ?? liveRuntime.stage}
                                {typeof liveRuntime.progressPct === "number"
                                  ? ` · ${Math.round(liveRuntime.progressPct)}%`
                                  : ""}
                              </div>
                            ) : null}
                          </div>

                          <PlusButton
                            variant="ghost"
                            size="sm"
                            aria-label="Remove source"
                            title="Remove"
                            onClick={(e: any) => {
                              e?.stopPropagation?.();
                              removeSource(s);
                            }}
                            className="opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition"
                          >
                            ✕
                          </PlusButton>
                        </SmartCard>
                      </StaggerItem>
                    );
                  })
                )}
              </StaggerList>
            </div>
          </div>

          {/* Center (Chat) */}
          <div
            className={clsx(
              PANEL_SHELL,
              PANEL_CONTENT,
              mobileTab === "chat" ? "flex" : "hidden",
              "md:flex",
            )}
          >
            <div
              className={clsx(
                PANEL_BAR,
                "px-5 py-3 flex items-center gap-3 sticky top-0 z-10",
              )}
            >
              <input
                name="notebook-title"
                value={titleDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setTitleDraft(next);
                  scheduleTitleSave(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Normalize display + flush immediately
                    const normalized =
                      normalizeTitle(titleDraft) || "Untitled notebook";
                    setTitleDraft(normalized);
                    pendingTitleRef.current = normalized;
                    flushTitleSave(normalized);
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    // Revert to last saved
                    const back =
                      lastSavedTitleRef.current || "Untitled notebook";
                    setTitleDraft(back);
                    pendingTitleRef.current = back;
                    if (titleTimerRef.current != null) {
                      window.clearTimeout(titleTimerRef.current);
                      titleTimerRef.current = null;
                    }
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                onBlur={() => {
                  const normalized =
                    normalizeTitle(titleDraft) || "Untitled notebook";
                  setTitleDraft(normalized);
                  pendingTitleRef.current = normalized;
                  flushTitleSave(normalized);
                }}
                disabled={!active}
                className="text-xl font-semibold w-full bg-transparent border-none outline-none placeholder:text-slate-400 text-slate-900 focus:ring-2 focus:ring-emerald-400/40 focus:ring-offset-0 rounded-md px-1 -mx-1"
                placeholder="Untitled notebook"
              />

              <div className="ml-auto text-[11px] text-slate-600 bg-slate-100/70 px-2 py-0.5 rounded-md tabular-nums">
                {(() => {
                  const dirty =
                    normalizeTitle(titleDraft) !==
                    normalizeTitle(lastSavedTitleRef.current);

                  if (updateTitle.isPending) return "Saving…";
                  if (dirty) return "Unsaved";

                  return active
                    ? new Date(active.updatedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";
                })()}
              </div>
            </div>

            <ChatPanel
              notebookId={activeId}
              sourceIds={readySourceIds}
              totalSources={sources.length}
              scopeIncludedCount={includedSourceIds.length}
              notReadyIncludedCount={notReadyIncludedCount}
            />
          </div>

          {/* Right (Notes) */}
          <SmartCard
            as="section"
            className={clsx(
              PANEL_SHELL,
              PANEL_CONTENT,
              mobileTab === "notes" ? "flex" : "hidden",
              "md:flex",
            )}
          >
            <NotesEditor notebookId={activeId} />
            <div className="border-t border-slate-200/70" />
            <RightPanel
              notebookId={activeId}
              sourceStats={{
                included: includedSourceIds.length,
                total: sources.length,
              }}
            />
          </SmartCard>

          {/* Picker modal */}
          <SourcePicker
            open={!!picker}
            kind={picker || "url"}
            notebookId={activeId}
            onClose={() => setPicker(null)}
          />

          {/* Repair modal */}
          {activeId && fixSourceId ? (
            <div
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex items-center justify-center"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setFixSourceId(null);
              }}
            >
              <div
                className="w-[900px] max-w-[94vw] max-h-[78vh] bg-white rounded-2xl border border-slate-200/80 shadow-2xl overflow-hidden flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60 flex items-center gap-2">
                  <div className="font-extrabold tracking-tight text-slate-900">
                    Repair source
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFixSourceId(null)}
                      className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto p-4">
                  {diagQ.isLoading ? (
                    <div className="text-sm text-slate-600">
                      Loading diagnostics…
                    </div>
                  ) : diagQ.isError ? (
                    <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                      {(diagQ.error as any)?.message ||
                        "Failed to load diagnostics."}
                    </div>
                  ) : diag ? (
                    <>
                      {/* Summary */}
                      <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {diag.source.kind === "URL"
                            ? diag.source.url?.title ||
                              diag.source.url?.url ||
                              "URL"
                            : diag.source.file?.fileName || "File"}
                        </div>
                        <div className="mt-1 text-[12px] text-slate-500 truncate">
                          {diag.source.kind === "URL"
                            ? diag.source.url?.url || ""
                            : diag.source.file?.mimeType || "file"}
                        </div>

                        {diagnosticReadiness ? (
                          <div
                            className={clsx(
                              "mt-3 rounded-2xl border p-4",
                              sourceReadinessTone(diagnosticReadiness.severity),
                            )}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">
                                  Recommended next action
                                </div>
                                <div className="mt-1 text-sm font-semibold">
                                  {diagnosticReadiness.label}
                                </div>
                                <div className="mt-1 text-[12px] leading-5 opacity-90">
                                  {diagnosticReadiness.detail}
                                </div>
                              </div>
                              <span
                                className={clsx(
                                  "rounded-full border px-3 py-1 text-[11px] font-semibold",
                                  sourceReadinessPillTone(diagnosticReadiness.severity),
                                )}
                              >
                                {diagnosticReadiness.severity === "ready"
                                  ? "Ready"
                                  : diagnosticReadiness.severity === "processing"
                                    ? "Processing"
                                    : "Repair"}
                              </span>
                            </div>

                            {diagnosticReadiness.action !== "none" &&
                            diagnosticReadiness.action !== "wait" ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {diagnosticReadiness.action === "run-ocr" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      runOcrM.mutate({
                                        notebookId: activeId,
                                        sourceId: fixSourceId,
                                        options: {
                                          langs: ocrLangs.trim() || "eng",
                                          pages: ocrPages.trim() || undefined,
                                          engine: ocrEngine,
                                          deskew: ocrDeskew,
                                          rotatePages: ocrRotatePages,
                                          clean: ocrClean,
                                          fallback: ocrFallback,
                                        },
                                      })
                                    }
                                    disabled={runOcrM.isPending}
                                    className="rounded-xl border border-emerald-200 bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                                  >
                                    {runOcrM.isPending
                                      ? "Starting OCR..."
                                      : diagnosticReadiness.actionLabel || "Run OCR"}
                                  </button>
                                ) : null}
                                {diagnosticReadiness.action ===
                                "retry-ingestion" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      retryIngestionM.mutate({
                                        notebookId: activeId,
                                        sourceId: fixSourceId,
                                      })
                                    }
                                    disabled={retryIngestionM.isPending}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                                  >
                                    {retryIngestionM.isPending
                                      ? "Starting..."
                                      : diagnosticReadiness.actionLabel ||
                                        "Retry ingestion"}
                                  </button>
                                ) : null}
                                {diagnosticReadiness.action ===
                                "retry-indexing" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      retryEmbeddingM.mutate({
                                        notebookId: activeId,
                                        sourceId: fixSourceId,
                                      })
                                    }
                                    disabled={retryEmbeddingM.isPending}
                                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                                  >
                                    {retryEmbeddingM.isPending
                                      ? "Starting..."
                                      : diagnosticReadiness.actionLabel ||
                                        "Retry indexing"}
                                  </button>
                                ) : null}
                                {diagnosticReadiness.action ===
                                "rebuild-index" ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      rebuildEmbeddingM.mutate({
                                        notebookId: activeId,
                                        sourceId: fixSourceId,
                                      })
                                    }
                                    disabled={rebuildEmbeddingM.isPending}
                                    className="rounded-xl border border-rose-200 bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                                  >
                                    {rebuildEmbeddingM.isPending
                                      ? "Rebuilding..."
                                      : diagnosticReadiness.actionLabel ||
                                        "Rebuild index"}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="text-slate-500">Pages</div>
                            <div className="font-semibold text-slate-900">
                              {diag.counts.pageCount}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="text-slate-500">Chunks</div>
                            <div className="font-semibold text-slate-900">
                              {diag.counts.chunkCount}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="text-slate-500">Embedded</div>
                            <div className="font-semibold text-slate-900">
                              {diag.counts.embeddedCount}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <JobRuntimeCard
                            label="Ingestion runtime"
                            job={diag.jobs.ingestion}
                          />
                          <JobRuntimeCard
                            label="Index runtime"
                            job={diag.jobs.embedding}
                          />
                        </div>

                        {diag.recentAudit?.length ? (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="text-sm font-semibold text-slate-900">
                              Recent activity
                            </div>
                            <div className="mt-3 space-y-2">
                              {diag.recentAudit.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <div>
                                    <div className="text-[12px] font-medium text-slate-900">
                                      {item.action.replace(/[._]/g, " ")}
                                    </div>
                                    <div className="mt-1 text-[11px] text-slate-500">
                                      {item.status} ·{" "}
                                      {formatRelativeTime(item.createdAt)}
                                    </div>
                                  </div>
                                  <div className="text-[10px] rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-600">
                                    {item.resourceType}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {diag?.source?.kind === "FILE" &&
                        ((diag.source.file?.mimeType || "")
                          .toLowerCase()
                          .includes("pdf") ||
                          (diag.source.file?.fileName || "")
                            .toLowerCase()
                            .endsWith(".pdf")) ? (
                          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-950">
                                  OCR
                                </div>
                                <div className="mt-1 text-[12px] leading-5 text-slate-600">
                                  Auto uses OCRmyPDF first, then direct
                                  Tesseract fallback if needed.
                                </div>
                              </div>
                              {ocrMeta?.quality ? (
                                <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-[11px] text-emerald-900">
                                  {ocrMeta.quality.charCount ?? 0} chars ·{" "}
                                  {ocrMeta.quality.pageCount ?? 0} pages
                                </div>
                              ) : null}
                            </div>

                            {scanMeta ? (
                              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                                <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5">
                                  Pages: {scanMeta.pageCount ?? "—"}
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5">
                                  Native chars: {scanMeta.totalChars ?? "—"}
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5">
                                  Avg/page:{" "}
                                  {typeof scanMeta.avgCharsPerPage === "number"
                                    ? Math.round(scanMeta.avgCharsPerPage)
                                    : "—"}
                                </div>
                              </div>
                            ) : null}

                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                              <label className="text-[11px] font-semibold text-slate-700">
                                Language
                                <input
                                  value={ocrLangs}
                                  onChange={(e) => setOcrLangs(e.target.value)}
                                  placeholder="eng or eng+hin"
                                  className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-normal"
                                />
                              </label>
                              <label className="text-[11px] font-semibold text-slate-700">
                                Pages
                                <input
                                  value={ocrPages}
                                  onChange={(e) => setOcrPages(e.target.value)}
                                  placeholder="1-10 or 1,3,8-12"
                                  className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-normal"
                                />
                              </label>
                              <label className="text-[11px] font-semibold text-slate-700">
                                Engine
                                <select
                                  value={ocrEngine}
                                  onChange={(e) =>
                                    setOcrEngine(
                                      e.target.value as
                                        | "auto"
                                        | "ocrmypdf"
                                        | "tesseract",
                                    )
                                  }
                                  className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[12px] font-normal"
                                >
                                  <option value="auto">Auto</option>
                                  <option value="ocrmypdf">OCRmyPDF</option>
                                  <option value="tesseract">Tesseract</option>
                                </select>
                              </label>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {[
                                ["deskew", ocrDeskew, setOcrDeskew, "Deskew"],
                                [
                                  "rotate",
                                  ocrRotatePages,
                                  setOcrRotatePages,
                                  "Rotate pages",
                                ],
                                ["clean", ocrClean, setOcrClean, "Clean"],
                                [
                                  "fallback",
                                  ocrFallback,
                                  setOcrFallback,
                                  "Fallback",
                                ],
                              ].map(([key, value, setter, label]) => (
                                <label
                                  key={String(key)}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700"
                                >
                                  <input
                                    type="checkbox"
                                    checked={Boolean(value)}
                                    onChange={(e) =>
                                      (setter as (v: boolean) => void)(
                                        e.target.checked,
                                      )
                                    }
                                  />
                                  {String(label)}
                                </label>
                              ))}

                              <button
                                type="button"
                                onClick={() =>
                                  runOcrM.mutate({
                                    notebookId: activeId,
                                    sourceId: fixSourceId,
                                    options: {
                                      langs: ocrLangs.trim() || "eng",
                                      pages: ocrPages.trim() || undefined,
                                      engine: ocrEngine,
                                      deskew: ocrDeskew,
                                      rotatePages: ocrRotatePages,
                                      clean: ocrClean,
                                      fallback: ocrFallback,
                                    },
                                  })
                                }
                                disabled={runOcrM.isPending}
                                className="ml-auto text-sm font-semibold px-4 py-2 rounded-xl border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                                title="Use OCR for scanned PDFs"
                              >
                                {runOcrM.isPending ? "Starting OCR..." : "Run OCR"}
                              </button>
                            </div>

                            {ocrMeta?.errors?.length ? (
                              <div className="mt-2 text-[11px] text-amber-800">
                                Last fallback reason: {ocrMeta.errors[0]}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Actions */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              retryIngestionM.mutate({
                                notebookId: activeId,
                                sourceId: fixSourceId,
                              })
                            }
                            disabled={retryIngestionM.isPending}
                            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Retry ingestion
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              retryEmbeddingM.mutate({
                                notebookId: activeId,
                                sourceId: fixSourceId,
                              })
                            }
                            disabled={retryEmbeddingM.isPending}
                            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Retry indexing
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              rebuildEmbeddingM.mutate({
                                notebookId: activeId,
                                sourceId: fixSourceId,
                              })
                            }
                            disabled={rebuildEmbeddingM.isPending}
                            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 disabled:opacity-60"
                            title="Clears embeddings for this source and re-embeds all chunks"
                          >
                            Rebuild index
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              const txt = [
                                "Ingestion:",
                                diag.jobs.ingestion?.status ?? "NONE",
                                diag.jobs.ingestion?.error ?? "",
                                "\nIndexing:",
                                diag.jobs.embedding?.status ?? "NONE",
                                diag.jobs.embedding?.error ?? "",
                              ].join(" ");
                              try {
                                await navigator.clipboard.writeText(txt.trim());
                                notify({
                                  text: "Copied error details.",
                                  kind: "success",
                                });
                              } catch {
                                notify({
                                  text: "Copy failed (browser blocked).",
                                  kind: "error",
                                });
                              }
                            }}
                            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
                          >
                            Copy error
                          </button>
                        </div>

                        {/* Errors */}
                        {(diag.jobs.ingestion?.error ||
                          diag.jobs.embedding?.error) && (
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                              <div className="text-[12px] font-semibold text-rose-900">
                                Ingestion
                              </div>
                              <div className="mt-1 text-[12px] text-rose-800 whitespace-pre-wrap">
                                {diag.jobs.ingestion?.error || "—"}
                              </div>
                            </div>
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                              <div className="text-[12px] font-semibold text-rose-900">
                                Indexing
                              </div>
                              <div className="mt-1 text-[12px] text-rose-800 whitespace-pre-wrap">
                                {diag.jobs.embedding?.error || "—"}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Preview */}
                      <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-slate-900">
                            Extracted text preview
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  diag.textPreview || "",
                                );
                                notify({
                                  text: "Copied preview text.",
                                  kind: "success",
                                });
                              } catch {
                                notify({
                                  text: "Copy failed (browser blocked).",
                                  kind: "error",
                                });
                              }
                            }}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50"
                          >
                            Copy preview
                          </button>
                        </div>

                        {diag.pagePreviews?.length ? (
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                            {diag.pagePreviews.map((p) => (
                              <div
                                key={p.pageNumber}
                                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                              >
                                <div className="text-[12px] font-semibold text-slate-900">
                                  Page {p.pageNumber} ·{" "}
                                  {p.charCount.toLocaleString()} chars
                                </div>
                                <div className="mt-1 text-[12px] text-slate-700 whitespace-pre-wrap">
                                  {p.preview}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre className="mt-2 text-[12px] whitespace-pre-wrap text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-[280px] overflow-auto">
                            {diag.textPreview || "No extracted text available."}
                          </pre>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
