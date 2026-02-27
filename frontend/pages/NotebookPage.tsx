import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notebookClient as api,
  Notebook,
  NBSource,
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

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
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

export default function NotebookPage() {
  const qc = useQueryClient();
  const { notify } = useToast();

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      if (!detail) return;
      notify(detail);
    };

    window.addEventListener("nb:toast", onToast as any);
    return () => window.removeEventListener("nb:toast", onToast as any);
  }, [notify]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "url" | "file">(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // mobile panel switcher state
  const [mobileTab, setMobileTab] = useState<"sources" | "chat" | "notes">(
    "chat",
  );

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({}); // sourceId -> element
  // When there are zero notebooks, auto-create one so Chat is immediately usable.
  const autoCreateRef = useRef(false);

  // ===== Sources Library UI state =====
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceKind, setSourceKind] = useState<"all" | "URL" | "FILE">("all");
  const [sourceSort, setSourceSort] = useState<"recent" | "name">("recent");

  // ===== NotebookLM-style scope control (include/exclude sources) =====
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

  // restore last selected notebook (can be stale if DB was reset)
  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved) setActiveId(saved);
  }, []);

  // validate / choose active notebook once list loads
  useEffect(() => {
    if (listQ.isLoading) return;

    const list = listQ.data || [];

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
  }, [listQ.isLoading, listQ.data, activeId]);

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
    },
  });

  // Auto-create the very first notebook (fresh user / empty DB).
  useEffect(() => {
    if (autoCreateRef.current) return;
    if (activeId) return;
    if (listQ.isLoading) return;

    const hasAny = (listQ.data?.length || 0) > 0;
    if (hasAny) return;

    autoCreateRef.current = true;

    createM.mutate({
      title: "My first notebook",
      description: "Auto-created to start chatting.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, listQ.isLoading, listQ.data]);

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
      const nextList = prev.filter((n) => n.id !== id);
      qc.setQueryData(["nb:list"], nextList);

      qc.removeQueries({ queryKey: ["nb:detail", id] });
      qc.removeQueries({ queryKey: ["nb:sources", id] });

      if (activeId === id) {
        setActiveId(nextList[0]?.id ?? null);
      }

      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["nb:list"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["nb:list"] });
    },
  });

  const delSourceM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) =>
      api.deleteSource(vars.notebookId, vars.sourceId),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["nb:sources", vars.notebookId] }),
  });

  const active: Notebook | null = detailQ.data?.notebook ?? null;

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
  const sources: NBSource[] = (sourcesQ.data || []) as NBSource[];

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

  // if sources change, drop exclusions that no longer exist
  useEffect(() => {
    if (!sources.length) return;
    const all = new Set(sources.map((s) => s.id));
    setExcludedSourceIds((prev) => {
      const next = new Set([...prev].filter((id) => all.has(id)));
      return next;
    });
  }, [sources]);

  const sourceTitle = (s: NBSource) =>
    s.kind === "URL"
      ? s.url?.title || s.url?.url || "URL"
      : s.file?.fileName || "File";

  const sourceSub = (s: NBSource) =>
    s.kind === "URL" ? s.url?.url || "" : s.file?.mimeType || "file";

  const indexBadgeForSource = (s: NBSource) => {
    const ing = s.ingestionJob?.status || "NONE";
    const emb = s.embeddingJob?.status || "NONE";

    if (ing === "FAILED") {
      return {
        label: "Failed",
        tone: "red",
        title: s.ingestionJob?.error || "Ingestion failed",
      };
    }
    if (ing === "PENDING") {
      return { label: "Queued", tone: "amber", title: "Waiting to ingest" };
    }
    if (ing === "RUNNING") {
      return { label: "Processing", tone: "blue", title: "Ingesting content" };
    }

    if (ing !== "SUCCESS") {
      return { label: "Not ready", tone: "slate", title: "Not indexed yet" };
    }

    if (emb === "FAILED") {
      return {
        label: "Index failed",
        tone: "red",
        title: s.embeddingJob?.error || "Embedding/index job failed",
      };
    }
    if (emb === "PENDING" || emb === "RUNNING") {
      return {
        label: "Indexing",
        tone: "amber",
        title: "Building semantic index (embeddings)",
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
    const onFocus = (e: Event) => {
      const sourceId = (e as CustomEvent).detail as string;
      if (sourceId) focusSource(sourceId);
    };
    window.addEventListener("nb:focus-source", onFocus as any);
    return () => window.removeEventListener("nb:focus-source", onFocus as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onManage = () => {
      if (typeof window !== "undefined" && window.innerWidth < 768)
        setMobileTab("sources");
    };
    window.addEventListener("nb:manage-sources", onManage as any);
    return () =>
      window.removeEventListener("nb:manage-sources", onManage as any);
  }, []);

  // =========================================================
  // Instant source attach (no refresh): optimistic cache updates
  // SourcePicker emits nb:sources-optimistic / confirmed / rollback
  // =========================================================
  useEffect(() => {
    const onOptimistic = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { notebookId: string; sources: NBSource[] }
        | undefined;
      if (!d || !d.notebookId) return;
      if (d.notebookId !== activeId) return;

      qc.setQueryData(["nb:sources", d.notebookId], (prev: any) => {
        const cur = Array.isArray(prev) ? (prev as NBSource[]) : [];
        return [...d.sources, ...cur];
      });
    };

    const onConfirmed = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { notebookId: string; sources: NBSource[] }
        | undefined;
      if (!d || !d.notebookId) return;
      if (d.notebookId !== activeId) return;

      qc.setQueryData(["nb:sources", d.notebookId], (prev: any) => {
        const cur = Array.isArray(prev) ? (prev as NBSource[]) : [];
        const real = d.sources || [];

        const realUrlIds = new Set(
          real
            .filter((s) => s.kind === "URL" && s.url?.id)
            .map((s) => String(s.url!.id)),
        );
        const realFileIds = new Set(
          real
            .filter((s) => s.kind === "FILE" && s.file?.id)
            .map((s) => String(s.file!.id)),
        );

        const kept = cur.filter((s) => {
          if (!String(s.id).startsWith("temp-")) return true;
          if (s.kind === "URL") return !realUrlIds.has(String(s.url?.id));
          if (s.kind === "FILE") return !realFileIds.has(String(s.file?.id));
          return true;
        });

        return [...real, ...kept];
      });

      qc.invalidateQueries({ queryKey: ["nb:sources", d.notebookId] });
      qc.invalidateQueries({ queryKey: ["nb:detail", d.notebookId] });
    };

    const onRollback = (e: Event) => {
      const d = (e as CustomEvent).detail as { notebookId: string } | undefined;
      const nbId = d?.notebookId;
      if (!nbId) return;
      if (nbId !== activeId) return;

      qc.setQueryData(["nb:sources", nbId], (prev: any) => {
        const cur = Array.isArray(prev) ? (prev as NBSource[]) : [];
        return cur.filter((s) => !String(s.id).startsWith("temp-"));
      });
      qc.invalidateQueries({ queryKey: ["nb:sources", nbId] });
    };

    window.addEventListener("nb:sources-optimistic", onOptimistic as any);
    window.addEventListener("nb:sources-confirmed", onConfirmed as any);
    window.addEventListener("nb:sources-rollback", onRollback as any);
    return () => {
      window.removeEventListener("nb:sources-optimistic", onOptimistic as any);
      window.removeEventListener("nb:sources-confirmed", onConfirmed as any);
      window.removeEventListener("nb:sources-rollback", onRollback as any);
    };
  }, [activeId, qc]);

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
                (listQ.data || []).map((n) => (
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

                    {/* Delete affordance (ChatGPT-style hover) */}
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
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-xs font-semibold text-slate-800">
                      Sources
                    </h3>
                    <span className="text-[11px] text-slate-600 bg-slate-100/80 border border-slate-200 rounded-full px-2 py-0.5 tabular-nums">
                      Using {includedCount}/{sources.length}
                    </span>
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
                          </div>

                          <PlusButton
                            variant="ghost"
                            size="sm"
                            aria-label="Remove source"
                            title="Remove"
                            onClick={(e: any) => {
                              e?.stopPropagation?.();
                              activeId &&
                                delSourceM.mutate({
                                  notebookId: activeId,
                                  sourceId: s.id,
                                });
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
        </div>
      </div>
    </div>
  );
}
