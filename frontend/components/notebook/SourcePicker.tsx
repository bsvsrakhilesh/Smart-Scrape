import { useEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import { notebookClient as api, type NBSource } from "../../lib/notebookClient";
import UrlIcon from "../icons/UrlIcon";
import FileIcon from "../icons/FileIcon";

function emit(event: string, detail?: any) {
  window.dispatchEvent(new CustomEvent(event, { detail }));
}

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

type PickerRow = {
  id: string;
  title: string;
  sub: string;
  raw: any;
};

type RowExtraProps = {
  rows: PickerRow[];
  kind: "url" | "file";
  selected: Set<string>;
  attached: Set<string>;
  toggle: (id: string) => void;
  hasMore: boolean;
  loadingMore: boolean;
  requestMore: () => void;
};

const PAGE_SIZE = 200;
const ROW_HEIGHT = 62;
const PREFETCH_THRESHOLD = 18;

async function fetchJson<T = any>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = raw || `HTTP ${res.status}`;

    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        const m = (parsed as any).message;
        if (typeof m === "string" && m.trim()) message = m;
      }
    } catch {
      // ignore
    }

    throw new Error(message);
  }
  return res.json();
}

function normalizeUrlRow(u: any): PickerRow {
  const id = String(u?.id ?? "");
  const url = String(u?.url ?? "");
  const title = String(u?.title ?? "").trim() || url || "Untitled URL";
  return {
    id,
    title,
    sub: url || "url",
    raw: u,
  };
}

function normalizeFileRow(f: any): PickerRow {
  const id = String(f?.id ?? "");
  const name = String(f?.fileName ?? "").trim() || "Untitled file";
  const mt = String(f?.mimeType ?? "").trim();
  return {
    id,
    title: name,
    sub: mt || "file",
    raw: f,
  };
}

function RowsListItem({
  index,
  style,
  rows,
  kind,
  selected,
  attached,
  toggle,
  hasMore,
  loadingMore,
  requestMore,
}: RowComponentProps<RowExtraProps>) {
  // "Load more" sentinel row
  if (hasMore && index >= rows.length) {
    return (
      <div style={style} className="px-2 py-2">
        <div className="h-full rounded-xl border border-slate-200/80 bg-white flex items-center justify-between px-3">
          <div className="text-sm text-slate-600">
            {loadingMore ? "Loading more…" : "More results available"}
          </div>
          <button
            onClick={requestMore}
            disabled={loadingMore}
            className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
          >
            {loadingMore ? "Working…" : "Load more"}
          </button>
        </div>
      </div>
    );
  }

  const row = rows[index];
  if (!row) return <div style={style} />;

  const isAttached = attached.has(row.id);
  const isChecked = selected.has(row.id);

  return (
    <div style={style} className="px-2 py-1.5">
      <button
        type="button"
        onClick={() => toggle(row.id)}
        disabled={isAttached}
        className={clsx(
          "w-full h-full text-left rounded-xl border px-3 py-2.5 flex items-start gap-3 transition",
          "bg-white hover:bg-slate-50",
          isChecked &&
            "border-indigo-300 bg-indigo-50/40 hover:bg-indigo-50/50",
          !isChecked && "border-slate-200/80",
          isAttached && "opacity-60 cursor-not-allowed hover:bg-white",
        )}
      >
        <div className="mt-0.5 shrink-0">
          <div
            className={clsx(
              "w-8 h-8 rounded-xl border flex items-center justify-center",
              isChecked
                ? "border-indigo-200 bg-indigo-100 text-indigo-700"
                : "border-slate-200 bg-slate-50 text-slate-700",
            )}
            aria-hidden="true"
          >
            {kind === "url" ? (
              <UrlIcon className="w-4 h-4" />
            ) : (
              <FileIcon className="w-4 h-4" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {row.title}
            </div>

            {isAttached && (
              <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                Attached
              </span>
            )}
          </div>

          <div className="text-[12px] text-slate-500 truncate mt-0.5">
            {row.sub}
          </div>
        </div>

        <div className="shrink-0 pt-0.5">
          <input
            name="picker-row-select"
            type="checkbox"
            checked={isChecked}
            readOnly
            disabled={isAttached}
            className="w-4 h-4 accent-indigo-600"
            aria-label={isChecked ? "Selected" : "Not selected"}
          />
        </div>
      </button>
    </div>
  );
}

export default function SourcePicker({
  open,
  onClose,
  kind,
  notebookId,
}: {
  open: boolean;
  onClose: () => void;
  kind: "url" | "file";
  notebookId: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());

  const [rawItems, setRawItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  // Focus search on open
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Load "already attached" ids for this notebook/kind
  useEffect(() => {
    if (!open || !notebookId) {
      setAttachedIds(new Set());
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const sources: NBSource[] = await api.listSources(notebookId);
        if (cancelled) return;

        const ids = new Set<string>();
        for (const s of sources || []) {
          if (kind === "url" && s.kind === "URL" && s.url?.id) {
            ids.add(String(s.url.id));
          }
          if (kind === "file" && s.kind === "FILE" && s.file?.id) {
            ids.add(String(s.file.id));
          }
        }
        setAttachedIds(ids);
      } catch {
        // non-fatal
        setAttachedIds(new Set());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, notebookId, kind]);

  // Load items (URLs = full list; Files = server-paged if available)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const reset = () => {
      setSelected(new Set());
      setErr(null);
      setRawItems([]);
      setPage(1);
      setHasMore(false);
    };

    reset();

    (async () => {
      try {
        setLoadingInitial(true);

        if (kind === "url") {
          // URLs endpoint in this codebase is not paginated; virtualize rendering instead.
          const data = await api.listAllUrls();
          if (cancelled) return;
          setRawItems(Array.isArray(data) ? data : []);
          setHasMore(false);
          return;
        }

        // kind === "file": prefer server pagination (GET /api/files?page=&pageSize=&q=)
        const params = new URLSearchParams();
        params.set("page", "1");
        params.set("pageSize", String(PAGE_SIZE));
        if (debouncedQ) params.set("q", debouncedQ);

        const res = await fetchJson<any>(`/files?${params.toString()}`);

        if (cancelled) return;

        if (Array.isArray(res)) {
          setRawItems(res);
          setHasMore(false);
        } else {
          const items = Array.isArray(res.items) ? res.items : [];
          const total = Number(res.total ?? items.length);
          setRawItems(items);
          setHasMore(items.length < total);
        }
      } catch (e: any) {
        if (cancelled) return;
        setRawItems([]);
        setHasMore(false);
        setErr(e?.message || "Failed to load items.");
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, kind, debouncedQ]);

  const rows: PickerRow[] = useMemo(() => {
    const base = (rawItems || []).map((x) =>
      kind === "url" ? normalizeUrlRow(x) : normalizeFileRow(x),
    );

    // URL search is client-side (since we load all URLs); file search is mostly server-side but this extra filter is harmless.
    if (!debouncedQ) return base;

    const needle = debouncedQ.toLowerCase();
    return base.filter((r) => {
      const hay = `${r.title} ${r.sub}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rawItems, kind, debouncedQ]);

  const rowCount = rows.length + (hasMore ? 1 : 0);

  const toggle = (id: string) => {
    if (attachedIds.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const requestMore = async () => {
    if (!open) return;
    if (kind !== "file") return;
    if (!hasMore || loadingMore || loadingInitial) return;

    const nextPage = page + 1;

    try {
      setLoadingMore(true);

      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("pageSize", String(PAGE_SIZE));
      if (debouncedQ) params.set("q", debouncedQ);

      const res = await fetchJson<any>(`/files?${params.toString()}`);

      if (Array.isArray(res)) {
        // server didn't paginate; treat as complete
        setRawItems(res);
        setHasMore(false);
        setPage(1);
        return;
      }

      const items = Array.isArray(res.items) ? res.items : [];
      const total = Number(res.total ?? 0);

      setRawItems((prev) => {
        const seen = new Set((prev || []).map((x: any) => String(x?.id)));
        const merged = [...(prev || [])];
        for (const it of items) {
          const id = String(it?.id);
          if (!seen.has(id)) merged.push(it);
        }
        return merged;
      });

      setPage(nextPage);

      // hasMore based on total if available, otherwise conservative: if we got a full page, assume more
      setHasMore((prevHas) => {
        const currentCount = (rawItems?.length || 0) + items.length;
        if (Number.isFinite(total) && total > 0) return currentCount < total;
        return items.length === PAGE_SIZE ? true : prevHas;
      });
    } catch (e: any) {
      setErr(e?.message || "Failed to load more files.");
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  // Prefetch when scrolling near end
  const onRowsRendered = (info: any) => {
    if (!hasMore || loadingMore || loadingInitial) return;

    const stop =
      info?.visibleStopIndex ??
      info?.stopIndex ??
      info?.visibleRows?.stopIndex ??
      info?.visibleRows?.stop ??
      0;

    // When we include the sentinel row, the last *data* index is rows.length - 1
    const lastDataIndex = Math.max(0, rows.length - 1);
    if (stop >= lastDataIndex - PREFETCH_THRESHOLD) {
      requestMore();
    }
  };

  const attach = async () => {
    if (!notebookId) {
      window.dispatchEvent(
        new CustomEvent("nb:toast", {
          detail: { kind: "error", text: "No active notebook selected." },
        }),
      );
      return;
    }

    const selectedIds = [...selected].filter((id) => !attachedIds.has(id));
    if (!selectedIds.length) {
      window.dispatchEvent(
        new CustomEvent("nb:toast", {
          detail: { kind: "info", text: "Nothing new to attach." },
        }),
      );
      return;
    }

    try {
      const now = new Date().toISOString();

      const lookup = new Map(rows.map((r) => [String(r.id), r.raw]));

      const optimisticSources = selectedIds
        .map((id) => lookup.get(String(id)))
        .filter(Boolean)
        .map((x: any) =>
          kind === "url"
            ? {
                id: `temp-${Date.now()}-${x.id}`,
                notebookId,
                kind: "URL",
                url: { id: String(x.id), url: x.url, title: x.title ?? null },
                file: null,
                createdAt: now,
              }
            : {
                id: `temp-${Date.now()}-${x.id}`,
                notebookId,
                kind: "FILE",
                url: null,
                file: {
                  id: String(x.id),
                  fileName: x.fileName,
                  mimeType: x.mimeType ?? null,
                },
                createdAt: now,
              },
        );

      onClose();
      emit("nb:sources-optimistic", { notebookId, sources: optimisticSources });

      const results = await Promise.allSettled(
        selectedIds.map((id) =>
          kind === "url"
            ? api.addUrlSource(notebookId, id)
            : api.addFileSource(notebookId, id),
        ),
      );

      const ok = results
        .filter(
          (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
        )
        .map((r) => r.value);

      const bad = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );

      if (ok.length) {
        emit("nb:sources-confirmed", { notebookId, sources: ok });
      }

      if (!ok.length || bad.length) {
        emit("nb:sources-rollback", { notebookId });
      }

      if (bad.length) {
        const reason0: any = bad[0].reason;
        const msg =
          reason0?.message ||
          (typeof reason0 === "string"
            ? reason0
            : "Some items failed to attach.");

        window.dispatchEvent(
          new CustomEvent("nb:toast", {
            detail: {
              kind: ok.length ? "warning" : "error",
              text: ok.length
                ? `Attached ${ok.length}; failed ${bad.length}. ${msg}`
                : `Attach failed. ${msg}`,
            },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent("nb:toast", {
            detail: { kind: "success", text: `Attached ${ok.length} items.` },
          }),
        );
      }
    } catch (e: any) {
      emit("nb:sources-rollback", { notebookId });

      const msg = e?.message || "Failed to attach selected items.";
      window.dispatchEvent(
        new CustomEvent("nb:toast", {
          detail: { kind: "error", text: msg },
        }),
      );
    }
  };

  // ESC closes, Cmd/Ctrl+Enter attaches
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") attach();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, notebookId, kind, attachedIds, rows]);

  if (!open) return null;

  const selectedCount = [...selected].filter(
    (id) => !attachedIds.has(id),
  ).length;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-50 flex items-center justify-center"
      onMouseDown={(e) => {
        // click outside closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white w-[760px] max-w-[92vw] max-h-[76vh] rounded-2xl border border-slate-200/80 shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="flex items-center gap-2">
            <div className="text-sm font-extrabold tracking-tight text-slate-900">
              Add {kind === "url" ? "URLs" : "Files"} to notebook
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={attach}
                disabled={!selectedCount}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 disabled:hover:bg-slate-900"
              >
                Attach{selectedCount ? ` (${selectedCount})` : ""}
              </button>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <input
              ref={inputRef}
              name="picker-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${kind === "url" ? "URLs" : "Files"}…`}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              disabled={loadingInitial}
            />
            <div className="text-[12px] text-slate-500 shrink-0">
              {loadingInitial
                ? "Loading…"
                : `${rows.length.toLocaleString()} results`}
            </div>
          </div>

          <div className="mt-2 text-[12px] text-slate-500">
            Tip: <span className="font-semibold">Esc</span> to close ·{" "}
            <span className="font-semibold">Ctrl/Cmd + Enter</span> to attach
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0">
          {err && (
            <div className="p-3 m-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm">
              <div className="font-semibold mb-1">Something went wrong</div>
              <div className="text-[13px] leading-snug">{err}</div>
            </div>
          )}

          {!err && !loadingInitial && rows.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-sm font-semibold text-slate-800">
                No matches
              </div>
              <div className="text-[12px] text-slate-500 mt-1">
                Try a different search term.
              </div>
            </div>
          )}

          {(rows.length > 0 || loadingInitial) && (
            <div className="h-full min-h-0">
              <List
                rowCount={rowCount}
                rowHeight={ROW_HEIGHT}
                rowComponent={RowsListItem}
                rowProps={{
                  rows,
                  kind,
                  selected,
                  attached: attachedIds,
                  toggle,
                  hasMore,
                  loadingMore,
                  requestMore,
                }}
                onRowsRendered={onRowsRendered as any}
                style={{ height: "100%", width: "100%" }}
                role="list"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 flex items-center justify-between">
          <div className="text-[12px] text-slate-600">
            Selected:{" "}
            <span className="font-semibold text-slate-900">
              {selectedCount}
            </span>
            {attachedIds.size > 0 && (
              <>
                {" "}
                · Attached in notebook:{" "}
                <span className="font-semibold text-slate-900">
                  {attachedIds.size}
                </span>
              </>
            )}
          </div>

          {kind === "file" && hasMore && (
            <button
              onClick={requestMore}
              disabled={loadingMore || loadingInitial}
              className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
