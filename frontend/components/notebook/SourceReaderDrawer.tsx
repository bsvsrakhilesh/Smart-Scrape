import { useEffect, useMemo, useState } from 'react';
import { notebookClient as api, ChunkReader } from '../../lib/notebookClient';

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

function sourceTitle(s: ChunkReader['source']) {
  if (s.kind === 'URL') return s.url?.title || s.url?.url || 'URL Source';
  return s.file?.fileName || 'File Source';
}

function sourceSub(s: ChunkReader['source']) {
  if (s.kind === 'URL') return s.url?.url || '';
  return s.file?.mimeType || '';
}

export default function SourceReaderDrawer({
  open,
  chunkId,
  onClose,
}: {
  open: boolean;
  chunkId: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reader, setReader] = useState<ChunkReader | null>(null);
  const [radius, setRadius] = useState(3);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setRadius(3);
    setQuery('');
    setReader(null);
    setErr(null);
  }, [open, chunkId]);

  useEffect(() => {
    if (!open || !chunkId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const data = await api.getChunkReader(chunkId, radius);
        if (!cancelled) setReader(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load source reader.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, chunkId, radius]);

  const title = useMemo(() => (reader ? sourceTitle(reader.source) : 'Source'), [reader]);
  const sub = useMemo(() => (reader ? sourceSub(reader.source) : ''), [reader]);

  const jumpToSourceCard = () => {
    if (!reader) return;
    window.dispatchEvent(new CustomEvent('nb:focus-source', { detail: reader.sourceId }));
  };

  const copyHighlighted = async () => {
    if (!reader) return;
    const center = reader.chunks.find((c) => c.id === reader.centerChunkId);
    if (!center) return;
    await navigator.clipboard.writeText(center.text || '');
  };

  const filteredChunks = useMemo(() => {
    if (!reader) return [];
    const q = query.trim().toLowerCase();
    if (!q) return reader.chunks;
    return reader.chunks.filter((c) => (c.text || '').toLowerCase().includes(q));
  }, [reader, query]);

  const canExpand =
    !!reader && (reader.centerIdx - radius > 0 || reader.centerIdx + radius < reader.totalChunks - 1);

  if (!open) return null;

  return (
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
          'absolute right-0 top-0 h-full w-full sm:w-[640px]',
          'bg-white shadow-[0_40px_120px_rgba(15,23,42,0.35)]',
          'border-l border-slate-200/80'
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
                <div className="mt-1 text-[16px] font-semibold text-slate-900 truncate">{title}</div>
                {sub ? <div className="mt-1 text-[12px] text-slate-500 truncate">{sub}</div> : null}

                {reader ? (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Showing chunks around citation · {reader.chunks.length}/{reader.totalChunks} loaded
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
                Copy highlighted
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
          <div className="flex-1 overflow-auto p-5">
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
              <div className="space-y-3">
                {filteredChunks.map((c) => {
                  const isCenter = c.id === reader.centerChunkId;
                  return (
                    <div
                      key={c.id}
                      className={clsx(
                        'rounded-2xl border p-4 shadow-sm',
                        isCenter
                          ? 'border-emerald-200 bg-emerald-50/60 ring-1 ring-emerald-200'
                          : 'border-slate-200 bg-white'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-slate-500">
                          Chunk #{c.idx + 1} {isCenter ? '· highlighted citation' : ''}
                        </div>
                      </div>

                      <div className="mt-2 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap">
                        {c.text}
                      </div>
                    </div>
                  );
                })}

                {!filteredChunks.length && (
                  <div className="text-sm text-slate-500">No chunks match your search.</div>
                )}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="px-5 py-3 border-t border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60 text-[11px] text-slate-500">
            NotebookLM feel = click citation → read source context → save what matters.
          </div>
        </div>
      </div>
    </div>
  );
}
