import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notebookClient as api, ChunkReader } from "../../lib/notebookClient";

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function sourceTitle(s: ChunkReader["source"]) {
  if (s.kind === "URL") return s.url?.title || s.url?.url || "URL Source";
  return s.file?.fileName || "File Source";
}

function sourceSub(s: ChunkReader["source"]) {
  if (s.kind === "URL") return s.url?.url || "";
  return s.file?.mimeType || "";
}

function highlightQuote(text: string, quote?: string) {
  if (!quote) return text;
  const i = text.indexOf(quote);
  if (i < 0) return text;

  const a = text.slice(0, i);
  const b = text.slice(i, i + quote.length);
  const c = text.slice(i + quote.length);

  return (
    <>
      {a}
      <mark className="bg-yellow-200/70 rounded px-0.5">{b}</mark>
      {c}
    </>
  );
}

function highlightSpan(
  text: string,
  start?: number | null,
  end?: number | null,
) {
  if (start == null || end == null) return text;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  if (e <= s) return text;

  return (
    <>
      {text.slice(0, s)}
      <mark className="bg-yellow-200/70 rounded px-0.5">
        {text.slice(s, e)}
      </mark>
      {text.slice(e)}
    </>
  );
}

// Quick heuristic "key points" extractor (replace with LLM later if needed)
function extractKeyPoints(chunks: { text: string }[], max = 6) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const c of chunks) {
    const t = (c.text || "").replace(/\s+/g, " ").trim();
    if (!t) continue;

    // Take first “sentence-ish” snippet
    const m = t.match(/^(.+?)([.!?]\s|$)/);
    const s = (m?.[1] || t).trim();

    if (s.length < 30) continue;

    const key = s.toLowerCase().slice(0, 90);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }

  return out;
}

export default function SourceReaderDrawer({
  open,
  citation,
  onClose,
}: {
  open: boolean;
  citation: {
    chunkId: string;
    quote?: string;
    pageStart?: number | null;
    pageEnd?: number | null;
    charStart?: number | null;
    charEnd?: number | null;
  } | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reader, setReader] = useState<ChunkReader | null>(null);
  const [radius, setRadius] = useState(3);
  const [query, setQuery] = useState("");

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [pageText, setPageText] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageErr, setPageErr] = useState<string | null>(null);
  const [viewPage, setViewPage] = useState<number | null>(null);
  const [pageJump, setPageJump] = useState<string>("");

  // Lock background scroll while the drawer is open (prevents scroll bleed / jank)
  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    // Prevent layout shift when scrollbar disappears
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  // ESC to close (expected modal behavior)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    setRadius(3);
    setQuery("");
    setReader(null);
    setErr(null);

    setPageText(null);
    setPageErr(null);

    const initial =
      citation?.pageStart != null ? Number(citation.pageStart) : null;
    setViewPage(initial);
    setPageJump(initial != null ? String(initial) : "");
  }, [open, citation?.chunkId]);

  useEffect(() => {
    if (!open || !citation?.chunkId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const data = await api.getChunkReader(citation.chunkId, radius);
        if (!cancelled) setReader(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load source reader.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, citation?.chunkId, radius]);

  useEffect(() => {
    if (!open || !reader?.sourceId) return;

    if (viewPage == null) {
      setPageText(null);
      setPageErr(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setPageLoading(true);
        setPageErr(null);

        const page = await api.getSourcePage(reader.sourceId, Number(viewPage));
        if (!cancelled) setPageText(page.text || "");
      } catch (e: any) {
        if (!cancelled) {
          setPageText(null);
          setPageErr(e?.message || "Page text unavailable.");
        }
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, reader?.sourceId, viewPage]);

  const title = useMemo(
    () => (reader ? sourceTitle(reader.source) : "Source"),
    [reader],
  );
  const sub = useMemo(() => (reader ? sourceSub(reader.source) : ""), [reader]);

  const citedPages = useMemo(() => {
    const ps = citation?.pageStart;
    const pe = citation?.pageEnd ?? ps;
    if (ps == null) return [];
    const start = Number(ps);
    const end = pe != null ? Number(pe) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    const a = Math.min(start, end);
    const b = Math.max(start, end);

    const span = b - a;
    if (span > 10)
      return [a, a + 1, a + 2, b - 2, b - 1, b].filter((x) => x >= 1);

    const out: number[] = [];
    for (let p = a; p <= b; p++) out.push(p);
    return out;
  }, [citation?.pageStart, citation?.pageEnd]);

  const highlightForViewPage = useMemo(() => {
    if (!pageText || viewPage == null)
      return { start: null as number | null, end: null as number | null };

    const ps = citation?.pageStart;
    const pe = citation?.pageEnd ?? ps;
    if (ps == null) return { start: null, end: null };

    const startPage = Number(ps);
    const endPage = pe != null ? Number(pe) : startPage;

    if (startPage === endPage) {
      return {
        start: citation?.charStart ?? null,
        end: citation?.charEnd ?? null,
      };
    }

    if (viewPage === startPage)
      return { start: citation?.charStart ?? null, end: pageText.length };
    if (viewPage === endPage)
      return { start: 0, end: citation?.charEnd ?? null };

    if (
      viewPage > Math.min(startPage, endPage) &&
      viewPage < Math.max(startPage, endPage)
    ) {
      return { start: 0, end: pageText.length };
    }

    return { start: null, end: null };
  }, [
    citation?.pageStart,
    citation?.pageEnd,
    citation?.charStart,
    citation?.charEnd,
    viewPage,
    pageText,
  ]);

  const goToPage = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const p = Math.max(1, Math.floor(n));
    setViewPage(p);
    setPageJump(String(p));
  };

  const copyEvidence = async () => {
    if (viewPage == null || pageText == null) return;

    const s = highlightForViewPage.start;
    const e = highlightForViewPage.end;

    let out = pageText;
    if (s != null && e != null && e > s) out = pageText.slice(s, e);

    const header = `${title} · page ${viewPage}`;
    await navigator.clipboard.writeText(`${header}\n\n${out}`.trim());

    window.dispatchEvent(
      new CustomEvent("nb:toast", {
        detail: { kind: "success", text: "Evidence copied to clipboard." },
      }),
    );
  };

  const jumpToSourceCard = () => {
    if (!reader) return;
    window.dispatchEvent(
      new CustomEvent("nb:focus-source", { detail: reader.sourceId }),
    );
    onClose();
  };

  const copyHighlighted = async () => {
    if (!reader) return;
    const center = reader.chunks.find((c) => c.id === reader.centerChunkId);
    if (!center) return;
    await navigator.clipboard.writeText(center.text || "");
  };

  const filteredChunks = useMemo(() => {
    if (!reader) return [];
    const q = query.trim().toLowerCase();
    if (!q) return reader.chunks;
    return reader.chunks.filter((c) =>
      (c.text || "").toLowerCase().includes(q),
    );
  }, [reader, query]);

  const canExpand =
    !!reader &&
    (reader.centerIdx - radius > 0 ||
      reader.centerIdx + radius < reader.totalChunks - 1);

  const keyPoints = useMemo(
    () => (reader ? extractKeyPoints(reader.chunks) : []),
    [reader, radius],
  );

  const addKeyPointsToNotes = () => {
    if (!reader) return;

    const md =
      `## Key points — ${title}\n\n` +
      (keyPoints.length
        ? keyPoints.map((k) => `- ${k}`).join("\n")
        : "- (No key points extracted)\n") +
      (sub ? `\n\n_Source: ${sub}_\n` : "\n");

    window.dispatchEvent(new CustomEvent("nb:add-note", { detail: md }));
    onClose();
  };

  // Auto-scroll to highlighted chunk when loaded
  useEffect(() => {
    if (!open || !reader?.centerChunkId) return;
    const el = rowRefs.current[reader.centerChunkId];
    if (!el) return;

    const t = setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "center" }),
      80,
    );
    return () => clearTimeout(t);
  }, [open, reader?.centerChunkId, radius]);

  if (!open) return null;

  const node = (
    <div className="fixed inset-0 z-[70]">
      {/* backdrop */}
      <button
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close source reader"
      />

      {/* panel */}
      <div
        className={clsx(
          "absolute right-0 top-0 h-full w-full sm:w-[640px]",
          "bg-white shadow-[0_40px_120px_rgba(15,23,42,0.35)]",
          "border-l border-slate-200/80",
        )}
      >
        <div className="h-full flex flex-col">
          {/* header */}
          <div className="px-5 py-4 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-500 tracking-wide uppercase">
                  Source reader
                </div>
                <div className="mt-1 text-[16px] font-semibold text-slate-900 truncate">
                  {title}
                </div>
                {sub ? (
                  <div className="mt-1 text-[12px] text-slate-500 truncate">
                    {sub}
                  </div>
                ) : null}

                {reader ? (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Showing chunks around citation
                    {citation?.pageStart != null ? (
                      <> · Page {citation.pageStart}</>
                    ) : null}
                    {" · "}
                    {reader.chunks.length}/{reader.totalChunks} loaded
                  </div>
                ) : null}
              </div>

              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-full border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12px] font-semibold"
              >
                Close
              </button>
            </div>

            {/* controls */}
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <button
                onClick={jumpToSourceCard}
                disabled={!reader}
                className="px-4 py-2 rounded-full bg-slate-900 text-white text-[12px] font-semibold shadow-[0_18px_50px_rgba(15,23,42,0.25)] hover:bg-black disabled:opacity-60"
              >
                Jump to source (left)
              </button>

              <button
                onClick={copyHighlighted}
                disabled={!reader}
                className="px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-60"
              >
                Copy cited chunk
              </button>

              <button
                onClick={addKeyPointsToNotes}
                disabled={!reader}
                className="px-4 py-2 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 text-[12px] font-semibold hover:bg-emerald-100 disabled:opacity-60"
              >
                Add key points to Notes
              </button>

              <div className="flex-1 min-w-[180px]" />

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search within loaded chunks…"
                className="px-3 py-2 rounded-full border border-slate-200 text-[12px] w-full sm:w-[240px]"
              />

              <button
                onClick={() => setRadius((r) => Math.min(20, r + 3))}
                disabled={!reader || loading || !canExpand}
                className="px-4 py-2 rounded-full border border-slate-200 bg-white text-slate-700 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-60"
                title="Load more context around the cited chunk"
              >
                Show more context
              </button>
            </div>
          </div>

          {/* body */}
          <div className="flex-1 overflow-auto overscroll-contain p-5">
            {loading && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Loading source context…
              </div>
            )}

            {err && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {err}
              </div>
            )}

            {reader && (
              <div className="space-y-4">
                {/* Key points */}
                <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-4 shadow-sm">
                  <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide">
                    Key points from this source
                  </div>

                  {keyPoints.length ? (
                    <ul className="mt-2 space-y-1 text-sm text-slate-900">
                      {keyPoints.map((k, i) => (
                        <li key={i} className="leading-relaxed">
                          • {k}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-sm text-slate-600">
                      No key points extracted yet.
                    </div>
                  )}
                </div>

                {/* Page view */}
                {viewPage != null ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                          Evidence · Page {viewPage}
                          {citation?.pageStart != null &&
                          citation?.pageEnd != null &&
                          citation.pageEnd !== citation.pageStart ? (
                            <>
                              {" "}
                              (cited p.{citation.pageStart}–{citation.pageEnd})
                            </>
                          ) : null}
                        </div>

                        {citedPages.length ? (
                          <div className="mt-1 text-[11px] text-slate-500 truncate">
                            Click a cited page:{" "}
                            {citedPages.map((p, i) => (
                              <button
                                key={`${p}-${i}`}
                                type="button"
                                onClick={() => goToPage(String(p))}
                                className={clsx(
                                  "inline-flex items-center px-2 h-5 rounded-full border text-[11px] mr-1 mt-1",
                                  p === viewPage
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                )}
                                title={`Jump to page ${p}`}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <button
                        onClick={copyEvidence}
                        disabled={pageText == null || pageLoading}
                        className="shrink-0 px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-60"
                        title="Copy highlighted evidence (or full page if no highlight)"
                      >
                        Copy evidence
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          goToPage(String(Math.max(1, (viewPage ?? 1) - 1)))
                        }
                        disabled={(viewPage ?? 1) <= 1 || pageLoading}
                        className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-60"
                      >
                        ← Prev
                      </button>

                      <button
                        type="button"
                        onClick={() => goToPage(String((viewPage ?? 1) + 1))}
                        disabled={pageLoading}
                        className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-700 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-60"
                      >
                        Next →
                      </button>

                      <div className="w-px h-6 bg-slate-200 mx-1" />

                      <div className="flex items-center gap-2">
                        <input
                          value={pageJump}
                          onChange={(e) => setPageJump(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") goToPage(pageJump);
                          }}
                          placeholder="Page #"
                          inputMode="numeric"
                          className="w-20 px-3 py-1.5 rounded-full border border-slate-200 text-[12px]"
                          disabled={pageLoading}
                        />
                        <button
                          type="button"
                          onClick={() => goToPage(pageJump)}
                          disabled={pageLoading || !pageJump.trim()}
                          className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-[12px] font-semibold hover:bg-black disabled:opacity-60"
                        >
                          Go
                        </button>
                      </div>
                    </div>

                    {pageLoading ? (
                      <div className="mt-3 text-sm text-slate-600">
                        Loading page…
                      </div>
                    ) : pageErr ? (
                      <div className="mt-3 text-sm text-rose-700">
                        {pageErr}
                      </div>
                    ) : pageText == null ? (
                      <div className="mt-3 text-sm text-rose-700">
                        Page text unavailable (source has no per-page
                        extraction).
                      </div>
                    ) : (
                      <div className="mt-3 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap">
                        {highlightSpan(
                          pageText,
                          highlightForViewPage.start,
                          highlightForViewPage.end,
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Chunks */}
                <div className="space-y-3">
                  {filteredChunks.map((c) => {
                    const isCenter = c.id === reader.centerChunkId;
                    return (
                      <div
                        key={c.id}
                        ref={(el) => {
                          rowRefs.current[c.id] = el;
                        }}
                        className={clsx(
                          "rounded-2xl border p-4 shadow-sm",
                          isCenter
                            ? "border-emerald-200 bg-emerald-50/60 ring-1 ring-emerald-200"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-slate-500">
                            Chunk #{c.idx + 1}
                          </div>

                          {isCenter ? (
                            <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold">
                              Cited
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap">
                          {isCenter
                            ? highlightQuote(c.text, citation?.quote)
                            : c.text}
                        </div>
                      </div>
                    );
                  })}

                  {!filteredChunks.length && (
                    <div className="text-sm text-slate-500">
                      No chunks match your search.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* footer */}
          <div className="px-5 py-3 border-t border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60 text-[11px] text-slate-500">
            NotebookLM feel: click citations → verify claims with surrounding
            context → save key points.
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
