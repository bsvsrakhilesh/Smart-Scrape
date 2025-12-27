import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notebookClient as api, Notebook, NBSource } from '../lib/notebookClient';
import UrlIcon from '../components/icons/UrlIcon';
import FolderIcon from '../components/icons/FolderIcon';
import ChatPanel from '../components/notebook/ChatPanel';
import NotesEditor from '../components/notebook/NotesEditor';
import RightPanel from '../components/notebook/RightPanel';
import SourcePicker from '../components/notebook/SourcePicker';
import { ListSkeleton } from '../components/common/Skeleton';
import SmartCard from '../components/ui/SmartCard';
import { StaggerList, StaggerItem } from '../components/motion/StaggerList';
import { PlusButton } from '../components/ui/PlusButton';

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}
const ACTIVE_KEY = 'nb:lastId';

export default function NotebookPage() {
  const qc = useQueryClient();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | 'url' | 'file'>(null);

  // Step 1: mobile panel switcher state
  const [mobileTab, setMobileTab] = useState<'sources' | 'chat' | 'notes'>('chat');

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({}); // sourceId -> element

  // ===== Step 4: Sources Library UI state =====
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceKind, setSourceKind] = useState<'all' | 'URL' | 'FILE'>('all');
  const [sourceSort, setSourceSort] = useState<'recent' | 'name'>('recent');

  // data
  const listQ = useQuery({ queryKey: ['nb:list'], queryFn: api.listNotebooks });
  const detailQ = useQuery({
    queryKey: ['nb:detail', activeId],
    queryFn: () => api.getNotebook(activeId!),
    enabled: !!activeId,
  });
  const sourcesQ = useQuery({
    queryKey: ['nb:sources', activeId],
    queryFn: () => api.listSources(activeId!),
    enabled: !!activeId,
  });

  // restore last or default
  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved) setActiveId(saved);
  }, []);

  useEffect(() => {
    if (!activeId && listQ.data?.length) setActiveId(listQ.data[0].id);
  }, [listQ.data, activeId]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  // Step 1 polish: when switching notebooks on mobile, default to Chat
  useEffect(() => {
    if (activeId) setMobileTab('chat');
  }, [activeId]);

  // create / update
  const createM = useMutation({
    mutationFn: (p: { title: string; description?: string }) => api.createNotebook(p),
    onSuccess: (nb) => {
      qc.invalidateQueries({ queryKey: ['nb:list'] });
      setActiveId(nb.id);
    },
  });

  const updateTitle = useMutation({
    mutationFn: (p: { id: string; title: string }) => api.updateNotebook(p.id, { title: p.title }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['nb:list'] });
      qc.invalidateQueries({ queryKey: ['nb:detail', vars.id] });
    },
  });

  const delSourceM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) =>
      api.deleteSource(vars.notebookId, vars.sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nb:sources', activeId] }),
  });

  const active: Notebook | null = detailQ.data?.notebook ?? null;

  // ===== Step 4: Sources Library computed list =====
  const sources: NBSource[] = (sourcesQ.data || []) as NBSource[];

  const sourceTitle = (s: NBSource) =>
    s.kind === 'URL' ? (s.url?.title || s.url?.url || 'URL') : (s.file?.fileName || 'File');

  const sourceSub = (s: NBSource) =>
    s.kind === 'URL' ? (s.url?.url || '') : (s.file?.mimeType || 'file');

  const filteredSources = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();

    let out = sources.slice();

    if (sourceKind !== 'all') {
      out = out.filter((s) => s.kind === sourceKind);
    }

    if (q) {
      out = out.filter((s) => {
        const t = sourceTitle(s).toLowerCase();
        const sub = sourceSub(s).toLowerCase();
        return (t + ' ' + sub).includes(q);
      });
    }

    // "recent" = keep backend order (stable). "name" = alphabetical.
    if (sourceSort === 'name') {
      out.sort((a, b) => sourceTitle(a).localeCompare(sourceTitle(b)));
    }

    return out;
  }, [sources, sourceQuery, sourceKind, sourceSort]);

  // highlight + scroll to a source card
  const focusSource = (sourceId: string) => {
    // mobile UX: jump to Sources tab before scrolling/highlighting
    if (typeof window !== 'undefined' && window.innerWidth < 768) setMobileTab('sources');

    const el = cardRefs.current[sourceId];
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-500', 'animate-pulse');
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-indigo-500', 'animate-pulse');
    }, 1500);
  };

  // listen for events (when backend maps chunkId -> sourceId, emit nb:focus-source)
  useEffect(() => {
    const onFocus = (e: Event) => {
      const sourceId = (e as CustomEvent).detail as string;
      if (sourceId) focusSource(sourceId);
    };
    window.addEventListener('nb:focus-source', onFocus as any);
    return () => window.removeEventListener('nb:focus-source', onFocus as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd/Ctrl+K opens picker (Shift selects Files)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPicker(e.shiftKey ? 'file' : 'url');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="p-5 md:p-6 space-y-4">
      <header className="page-header">
        <div className="page-header-main">
          <p className="page-header-kicker">Notebook</p>
          <h1 className="page-header-title">AI Research Notebook</h1>
          <p className="page-header-subtitle">
            Pin sources on the left, chat in the centre, and write notes on the right.
          </p>
        </div>

        <div className="page-header-meta">
          <div className="page-header-pill">
            <span className="page-header-pill-label">Notebooks</span>
            <span className="page-header-pill-value">{listQ.data?.length ?? 0}</span>
          </div>
          {active && (
            <div className="page-header-pill page-header-pill--accent">
              <span className="page-header-pill-label">Active</span>
              <span className="page-header-pill-value truncate max-w-[10rem]">{active.title}</span>
            </div>
          )}
        </div>
      </header>

      <div className="min-h-full rounded-[28px] border border-emerald-200/70 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.07),_rgba(59,130,246,0.06),_rgba(15,23,42,0.03))] shadow-[0_40px_120px_rgba(15,23,42,0.32)] px-4 md:px-6 py-4 md:py-5 flex flex-col">
        {/* Step 1: Mobile panel switcher */}
        <div className="md:hidden mb-3">
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-2xl border border-emerald-200/80 bg-white/75 shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur supports-[backdrop-filter]:bg-white/60">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/5 border border-slate-200/70">
              {(['sources', 'chat', 'notes'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setMobileTab(t)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-[12px] font-semibold tracking-tight transition-all',
                    mobileTab === t
                      ? 'bg-white text-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.12)]'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-white/60'
                  )}
                  aria-pressed={mobileTab === t}
                >
                  {t === 'sources' ? 'Sources' : t === 'chat' ? 'Chat' : 'Notes'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={!activeId}
                onClick={() => setPicker('url')}
                className="text-[12px] px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-60"
                title="Add URL (Ctrl/⌘+K)"
              >
                + URL
              </button>
              <button
                disabled={!activeId}
                onClick={() => setPicker('file')}
                className="text-[12px] px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-60"
                title="Add File (Ctrl/⌘+Shift+K)"
              >
                + File
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[320px_1fr_420px] items-stretch h-full gap-4 md:gap-5">
          {/* Left rail */}
          <div
            className={clsx(
              'rounded-2xl border border-emerald-200/80 bg-emerald-50/60 shadow-[0_10px_30px_rgba(15,23,42,0.18)] p-3 flex flex-col overflow-hidden backdrop-blur-sm',
              mobileTab === 'sources' ? 'flex' : 'hidden',
              'md:flex'
            )}
          >
            {/* Notebooks */}
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-800">Notebooks</h2>
              <button
                onClick={() => createM.mutate({ title: `Notebook ${new Date().toLocaleTimeString()}` })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-medium shadow-[0_10px_24px_rgba(15,23,42,0.35)] hover:bg-slate-950 hover:-translate-y-0.5 active:translate-y-[1px] active:shadow-[0_4px_14px_rgba(15,23,42,0.55)] transition-all duration-200 transform"
              >
                New
              </button>
            </div>

            <div className="space-y-1 overflow-auto max-h-44 pr-1 pb-1">
              {listQ.isLoading ? (
                <ListSkeleton rows={4} />
              ) : (
                (listQ.data || []).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setActiveId(n.id)}
                    className={clsx(
                      'group relative w-full h-9 flex items-center text-left px-3 rounded-md text-sm transition-all duration-200 transform',
                      'shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]',
                      activeId === n.id
                        ? 'bg-emerald-50/80 text-slate-900 shadow-[0_10px_26px_rgba(16,185,129,0.45)] -translate-y-[1px]'
                        : 'bg-white/85 text-slate-700 hover:bg-emerald-50/70 hover:shadow-[0_10px_24px_rgba(15,23,42,0.14)] hover:-translate-y-[1px]'
                    )}
                  >
                    <span
                      className={clsx(
                        'absolute left-0 top-1/2 -translate-y-1/2 h-5 rounded-r transition-all duration-200',
                        activeId === n.id
                          ? 'w-1.5 bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.5)]'
                          : 'w-[3px] bg-emerald-300/80 opacity-0 group-hover:opacity-100 group-hover:translate-x-[1px]'
                      )}
                    />
                    <span className="truncate">{n.title}</span>
                  </button>
                ))
              )}
            </div>

            {/* Sources (Step 4: library panel) */}
            <div className="mt-4 border-t pt-3 flex-1 min-h-0">
              <div className="sticky top-0 z-10 mb-2 rounded-t-2xl border-b border-emerald-300/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60 shadow-[0_1px_0_rgba(16,185,129,0.15)]">
                {/* Row 1: title + counts + add actions */}
                <div className="px-2 pt-2 pb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-xs font-semibold text-slate-800">Sources</h3>
                    <span className="text-[11px] text-slate-600 bg-slate-100/80 border border-slate-200 rounded-full px-2 py-0.5 tabular-nums">
                      {filteredSources.length}/{sources.length}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      disabled={!activeId}
                      onClick={() => setPicker('url')}
                      className="text-xs px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 shadow-sm disabled:opacity-60"
                    >
                      <UrlIcon className="w-3 h-3" /> Add URL
                    </button>
                    <button
                      disabled={!activeId}
                      onClick={() => setPicker('file')}
                      className="text-xs px-3 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1 shadow-sm disabled:opacity-60"
                    >
                      <FolderIcon className="w-3 h-3" /> Add File
                    </button>
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
                        onClick={() => setSourceQuery('')}
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
                    {(['all', 'URL', 'FILE'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSourceKind(k)}
                        className={clsx(
                          'h-7 px-2.5 rounded-full text-[11px] font-semibold border transition',
                          sourceKind === k
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        )}
                        aria-pressed={sourceKind === k}
                      >
                        {k === 'all' ? 'All' : k === 'URL' ? 'URLs' : 'Files'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSourceSort((s) => (s === 'recent' ? 'name' : 'recent'))}
                    className="h-7 px-2.5 rounded-full text-[11px] font-semibold border bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    title={sourceSort === 'recent' ? 'Sorting: Recent' : 'Sorting: A→Z'}
                  >
                    {sourceSort === 'recent' ? 'Recent' : 'A→Z'}
                  </button>
                </div>
              </div>

              <StaggerList as="div" className="overflow-auto h-full space-y-2 pr-1 pb-1">
                {sourcesQ.isLoading ? (
                  <ListSkeleton rows={6} />
                ) : filteredSources.length === 0 ? (
                  <div className="p-3">
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                      <div className="text-sm font-semibold text-slate-800">No sources found</div>
                      <div className="mt-1 text-[12px] text-slate-600 leading-relaxed">
                        {sources.length === 0
                          ? 'Add a URL or file to start building your library.'
                          : 'Try a different search or filter.'}
                      </div>
                    </div>
                  </div>
                ) : (
                  filteredSources.map((s: NBSource) => {
                    const title = sourceTitle(s);
                    const sub = sourceSub(s);
                    const isUrl = s.kind === 'URL';
                    const href = isUrl ? s.url?.url : null;

                    return (
                      <StaggerItem as="div" key={s.id}>
                        <SmartCard
                          as="div"
                          ref={(el) => {
                            if (el) cardRefs.current[s.id] = el as unknown as HTMLDivElement;
                          }}
                          onClick={() => {
                            if (href) window.open(href, '_blank', 'noopener,noreferrer');
                          }}
                          className={clsx(
                            'group relative flex items-start gap-3 p-3 rounded-2xl border border-slate-200/80 bg-white/85',
                            'hover:bg-white hover:shadow-[0_16px_50px_rgba(15,23,42,0.10)] transition-all duration-200',
                            href ? 'cursor-pointer' : 'cursor-default'
                          )}
                        >
                          {/* icon chip */}
                          <div
                            className={clsx(
                              'w-9 h-9 rounded-2xl grid place-items-center border shadow-sm',
                              isUrl
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            )}
                            title={isUrl ? 'URL' : 'File'}
                          >
                            {isUrl ? <UrlIcon className="w-4 h-4" /> : <FolderIcon className="w-4 h-4" />}
                          </div>

                          <div className="text-xs flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-semibold truncate text-slate-900">{title}</div>
                              {href ? (
                                <span className="opacity-0 group-hover:opacity-100 transition text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                                  Open
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-1 text-[11px] text-slate-500 truncate">{sub}</div>

                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600">
                                {isUrl ? 'URL' : 'FILE'}
                              </span>
                            </div>
                          </div>

                          <PlusButton
                            variant="ghost"
                            size="sm"
                            aria-label="Remove source"
                            title="Remove"
                            onClick={(e: any) => {
                              e?.stopPropagation?.();
                              activeId && delSourceM.mutate({ notebookId: activeId, sourceId: s.id });
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
              'rounded-2xl border border-emerald-300/70 bg-transparent flex flex-col overflow-hidden min-h-[70vh] backdrop-blur-sm',
              mobileTab === 'chat' ? 'flex' : 'hidden',
              'md:flex'
            )}
          >
            <div className="border-b border-emerald-300/70 px-5 py-3 flex items-center gap-3 bg-white/75 backdrop-blur supports-[backdrop-filter]:bg-white/55 sticky top-0 z-10 shadow-[0_1px_0_rgba(16,185,129,0.15)]">
              <input
                value={detailQ.data?.notebook?.title || ''}
                onChange={(e) => activeId && updateTitle.mutate({ id: activeId, title: e.target.value })}
                disabled={!active}
                className="text-xl font-semibold w-full bg-transparent border-none outline-none placeholder:text-slate-400 text-slate-900 focus:ring-2 focus:ring-emerald-400/40 focus:ring-offset-0 rounded-md px-1 -mx-1"
                placeholder="Untitled notebook"
              />
              <div className="ml-auto text-[11px] text-slate-600 bg-slate-100/70 px-2 py-0.5 rounded-md tabular-nums">
                {active
                  ? new Date(active.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : ''}
              </div>
            </div>
            <ChatPanel notebookId={activeId} />
          </div>

          {/* Right (Notes) */}
          <SmartCard
            as="section"
            className={clsx(
              'rounded-2xl border border-emerald-200/80 bg-emerald-50/70 shadow-[0_10px_30px_rgba(15,23,42,0.16)] flex flex-col overflow-hidden backdrop-blur-sm',
              mobileTab === 'notes' ? 'flex' : 'hidden',
              'md:flex'
            )}
          >
            <NotesEditor notebookId={activeId} />
            <div className="border-t border-emerald-300/70" />
            <RightPanel notebookId={activeId} />
          </SmartCard>

          {/* Picker modal */}
          <SourcePicker
            open={!!picker}
            kind={picker || 'url'}
            notebookId={activeId}
            onClose={() => setPicker(null)}
          />
        </div>
      </div>
    </div>
  );
}
