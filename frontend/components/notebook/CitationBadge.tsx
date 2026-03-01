import { useEffect, useMemo, useRef, useState } from "react";
import { notebookClient as api, ChunkDetail } from "../../lib/notebookClient";

const chunkCache = new Map<string, ChunkDetail>();
const pageCache = new Map<string, string>();

function sourceTitle(s: ChunkDetail["source"]) {
  if (s.kind === "URL") return s.url?.title || s.url?.url || "URL Source";
  return s.file?.fileName || "File Source";
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(n);
  return Math.max(min, Math.min(max, x));
}

function renderHighlightedSnippet(p: {
  text: string;
  start: number;
  end: number;
  pad?: number;
}) {
  const pad = p.pad ?? 180;
  const text = p.text;
  const s = clampInt(p.start, 0, text.length);
  const e = clampInt(p.end, s, text.length);

  const winStart = Math.max(0, s - pad);
  const winEnd = Math.min(text.length, e + pad);

  const prefix = winStart > 0 ? "…" : "";
  const suffix = winEnd < text.length ? "…" : "";

  const slice = text.slice(winStart, winEnd);
  const hs = s - winStart;
  const he = e - winStart;

  return (
    <span className="whitespace-pre-wrap">
      {prefix}
      {slice.slice(0, hs)}
      <mark className="bg-yellow-200/70 rounded px-0.5">
        {slice.slice(hs, he)}
      </mark>
      {slice.slice(he)}
      {suffix}
    </span>
  );
}

export default function CitationBadge({
  index,
  citation,
  onOpenSource,
}: {
  index: number;
  citation: {
    chunkId: string;
    quote: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    charStart?: number | null;
    charEnd?: number | null;
  };
  onOpenSource?: (c: any) => void;
}) {
  const pageLabel =
    citation.pageStart != null
      ? `p.${citation.pageStart}${
          citation.pageEnd != null && citation.pageEnd !== citation.pageStart
            ? `–${citation.pageEnd}`
            : ""
        }`
      : null;

  const [peekOpen, setPeekOpen] = useState(false);
  const [peekLoading, setPeekLoading] = useState(false);
  const [peekErr, setPeekErr] = useState<string | null>(null);
  const [peekChunk, setPeekChunk] = useState<ChunkDetail | null>(null);
  const [peekPageText, setPeekPageText] = useState<string | null>(null);

  const hoverTimer = useRef<number | null>(null);
  const reqId = useRef(0);

  const canPeek = citation.pageStart != null;

  const loadPeek = async () => {
    if (!canPeek) return;

    const rid = ++reqId.current;

    try {
      setPeekLoading(true);
      setPeekErr(null);

      let chunk = chunkCache.get(citation.chunkId) ?? null;
      if (!chunk) {
        chunk = await api.getChunk(citation.chunkId);
        chunkCache.set(citation.chunkId, chunk);
      }
      if (rid !== reqId.current) return;
      setPeekChunk(chunk);

      const k = `${chunk.sourceId}:${citation.pageStart}`;
      let txt = pageCache.get(k) ?? null;
      if (!txt) {
        const page = await api.getSourcePage(
          chunk.sourceId,
          Number(citation.pageStart),
        );
        txt = page.text || "";
        pageCache.set(k, txt);
      }
      if (rid !== reqId.current) return;
      setPeekPageText(txt);
    } catch (e: any) {
      if (rid !== reqId.current) return;
      setPeekErr(e?.message || "Preview unavailable.");
      setPeekPageText(null);
      setPeekChunk(null);
    } finally {
      if (rid === reqId.current) setPeekLoading(false);
    }
  };

  const openPeek = () => {
    setPeekOpen(true);

    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      loadPeek();
    }, 220);
  };

  const closePeek = () => {
    setPeekOpen(false);
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };

  useEffect(() => {
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, []);

  const previewBody = useMemo(() => {
    if (!peekPageText) return null;

    // Prefer exact char offsets (page-relative).
    let s = citation.charStart;
    let e = citation.charEnd;

    // Fallback: try to find quote on this page.
    if ((s == null || e == null) && citation.quote) {
      const i = peekPageText.indexOf(citation.quote);
      if (i >= 0) {
        s = i;
        e = i + citation.quote.length;
      }
    }

    if (s == null || e == null) {
      return (
        <span className="whitespace-pre-wrap">{citation.quote || ""}</span>
      );
    }

    return renderHighlightedSnippet({ text: peekPageText, start: s, end: e });
  }, [peekPageText, citation.charStart, citation.charEnd, citation.quote]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={openPeek}
      onMouseLeave={closePeek}
      onFocus={openPeek}
      onBlur={closePeek}
    >
      <button
        type="button"
        onClick={() => onOpenSource?.(citation)}
        className="inline-flex items-center justify-center ml-0.5 px-2 h-4 rounded-md
                   text-indigo-700 bg-indigo-50 border border-indigo-200 text-[10px] leading-4
                   hover:bg-indigo-100 hover:border-indigo-300 transition gap-1"
        title={citation.quote || "Open evidence"}
        aria-label={`Open evidence ${index}`}
      >
        <span>{index}</span>
        {pageLabel ? (
          <span className="text-indigo-500">{pageLabel}</span>
        ) : null}
      </button>

      {peekOpen ? (
        <div
          className="absolute left-0 top-full mt-2 z-50 w-[min(520px,80vw)] rounded-2xl border border-slate-200 bg-white shadow-xl"
          role="dialog"
          aria-label="Citation preview"
        >
          <div className="p-3 border-b border-slate-200/70 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 rounded-t-2xl">
            <div className="text-[11px] font-semibold text-slate-700">
              {peekChunk ? sourceTitle(peekChunk.source) : "Evidence"}
            </div>
            <div className="text-[11px] text-slate-500">
              {pageLabel ? `Preview · ${pageLabel}` : "Preview"}
              {canPeek ? "" : " · (no page mapping)"}
            </div>
          </div>

          <div className="p-3">
            {peekLoading ? (
              <div className="text-sm text-slate-600">Loading preview…</div>
            ) : peekErr ? (
              <div className="text-sm text-rose-700">{peekErr}</div>
            ) : previewBody ? (
              <div className="text-sm leading-relaxed text-slate-900">
                {previewBody}
              </div>
            ) : (
              <div className="text-sm text-slate-600">
                {citation.quote || "No preview available."}
              </div>
            )}

            <div className="mt-2 text-[11px] text-slate-500">
              Click badge to open full reader.
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
