import { useEffect, useMemo, useState } from "react";
import { notebookClient as api } from "../../lib/notebookClient";

function emit(event: string, detail?: any) {
  window.dispatchEvent(new CustomEvent(event, { detail }));
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
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        setSelected(new Set());
        setQ("");

        const data =
          kind === "url" ? await api.listAllUrls() : await api.listAllFiles();
        if (cancelled) return;

        setItems(Array.isArray(data) ? data : []);
      } catch (e: any) {
        if (cancelled) return;
        setItems([]);
        setErr(e?.message || "Failed to load items.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, kind]);

  const filtered = useMemo(() => {
    const key = (x: any) => (kind === "url" ? x.title || x.url : x.fileName);
    return items.filter((x) =>
      String(key(x)).toLowerCase().includes(q.toLowerCase()),
    );
  }, [items, q, kind]);

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const attach = async () => {
    if (!notebookId) return;

    try {
      setLoading(true);
      setErr(null);

      const selectedIds = [...selected];
      const now = new Date().toISOString();

      // 1) Close immediately + optimistic UI update (target: < 80ms)
      //    NotebookPage listens and updates the Sources list instantly.
      const optimisticSources = selectedIds
        .map((id) => items.find((x) => String(x.id) === String(id)))
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

      // 2) Attach in parallel, but do not let one failure kill the whole batch
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

      // If anything succeeded, confirm those (this replaces matching temp cards)
      if (ok.length) {
        emit("nb:sources-confirmed", { notebookId, sources: ok });
      }

      // Clear leftover temp cards (especially needed when some failed)
      if (!ok.length || bad.length) {
        emit("nb:sources-rollback", { notebookId });
      }

      // Optional: emit a toast event for failures (Step 3 will wire the listener)
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
      }
    } catch (e: any) {
      emit("nb:sources-rollback", { notebookId });

      const msg = e?.message || "Failed to attach selected items.";
      setErr(msg);

      window.dispatchEvent(
        new CustomEvent("nb:toast", {
          detail: { kind: "error", text: msg },
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-50 flex items-center justify-center">
      <div className="bg-white w-[640px] max-h-[72vh] rounded-2xl border border-slate-200/80 shadow-xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60 flex items-center gap-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${kind === "url" ? "URLs" : "Files"}…`}
            className="flex-1 border rounded px-3 py-2 text-sm"
            disabled={loading}
          />

          <button
            onClick={onClose}
            className="text-sm px-2 py-1 border rounded"
          >
            Close
          </button>

          <button
            onClick={attach}
            disabled={!selected.size || loading}
            className="text-sm px-3 py-1.5 border rounded bg-gray-900 text-white disabled:opacity-60"
          >
            {loading
              ? "Working…"
              : `Attach ${selected.size ? `(${selected.size})` : ""}`}
          </button>
        </div>

        <div className="flex-1 min-h-0 p-2 overflow-y-auto">
          {err && (
            <div className="p-3 mb-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm">
              <div className="font-semibold mb-1">Something went wrong</div>
              <div className="text-[13px] leading-snug">{err}</div>
            </div>
          )}

          {loading && <div className="text-sm text-gray-500 p-3">Loading…</div>}

          {!loading &&
            filtered.map((item: any) => {
              const title =
                kind === "url" ? item.title || item.url : item.fileName;
              const sub = kind === "url" ? item.url : item.mimeType || "file";
              const checked = selected.has(item.id);

              return (
                <label
                  key={item.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 rounded border-b cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(item.id)}
                    className="accent-indigo-600"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{title}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {sub}
                    </div>
                  </div>
                </label>
              );
            })}

          {!loading && !filtered.length && !err && (
            <div className="text-xs text-gray-500 p-3">No items.</div>
          )}
        </div>
      </div>
    </div>
  );
}
