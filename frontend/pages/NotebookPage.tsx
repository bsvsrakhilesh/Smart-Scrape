import { useEffect, useRef, useState } from 'react';
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


function clsx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }
const ACTIVE_KEY = 'nb:lastId';

export default function NotebookPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | 'url' | 'file'>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({}); // sourceId -> element

  // data
  const listQ = useQuery({ queryKey: ['nb:list'], queryFn: api.listNotebooks });
  const detailQ = useQuery({ queryKey: ['nb:detail', activeId], queryFn: () => api.getNotebook(activeId!), enabled: !!activeId });
  const sourcesQ = useQuery({ queryKey: ['nb:sources', activeId], queryFn: () => api.listSources(activeId!), enabled: !!activeId });

  // restore last or default
  useEffect(() => { const saved = localStorage.getItem(ACTIVE_KEY); if (saved) setActiveId(saved); }, []);
  useEffect(() => { if (!activeId && listQ.data?.length) setActiveId(listQ.data[0].id); }, [listQ.data, activeId]);
  useEffect(() => { if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); }, [activeId]);

  // create / update
  const createM = useMutation({
    mutationFn: (p: { title: string; description?: string }) => api.createNotebook(p),
    onSuccess: (nb) => { qc.invalidateQueries({ queryKey: ['nb:list'] }); setActiveId(nb.id); },
  });
  const updateTitle = useMutation({
    mutationFn: (p: { id: string; title: string }) => api.updateNotebook(p.id, { title: p.title }),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['nb:list'] }); qc.invalidateQueries({ queryKey: ['nb:detail', vars.id] }); },
  });
  const delSourceM = useMutation({
    mutationFn: (vars: { notebookId: string; sourceId: string }) => api.deleteSource(vars.notebookId, vars.sourceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nb:sources', activeId] }),
  });

  const active: Notebook | null = detailQ.data?.notebook ?? null;

  // highlight + scroll to a source card
  const focusSource = (sourceId: string) => {
    const el = cardRefs.current[sourceId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-500', 'animate-pulse');
    setTimeout(() => { el.classList.remove('ring-2', 'ring-indigo-500', 'animate-pulse'); }, 1500);
  };

  // listen for events (when backend maps chunkId -> sourceId, emit nb:focus-source)
  useEffect(() => {
    const onFocus = (e: Event) => {
      const sourceId = (e as CustomEvent).detail as string;
      if (sourceId) focusSource(sourceId);
    };
    window.addEventListener('nb:focus-source', onFocus as any);
    return () => window.removeEventListener('nb:focus-source', onFocus as any);
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
    <div className="min-h-[calc(100vh-6rem)] grid grid-cols-1 md:grid-cols-[320px_1fr_420px] gap-4 items-stretch">
      {/* Left rail */}
      <div className="bg-white rounded-2xl border shadow-sm p-3 flex flex-col overflow-hidden">
        {/* Notebooks */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold tracking-wide text-gray-700">Notebooks</h2>
          <button onClick={() => createM.mutate({ title: `Notebook ${new Date().toLocaleTimeString()}` })}
                  className="text-xs px-2 py-1 border rounded-full hover:bg-gray-50">New</button>
        </div>
        <div className="space-y-1 overflow-auto max-h-44">
          {listQ.isLoading ? <ListSkeleton rows={4} /> : (listQ.data || []).map(n => (
            <button key={n.id}
              onClick={() => setActiveId(n.id)}
              className={clsx('w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-gray-50',
                              activeId===n.id && 'bg-gray-100 font-medium')}>
              {n.title}
            </button>
          ))}
        </div>

        {/* Sources */}
        <div className="mt-4 border-t pt-3 flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold">Sources</h3>
            <div className="flex gap-2">
              <button disabled={!activeId} onClick={() => setPicker('url')}
                className="text-xs px-2 py-1 border rounded-full bg-white hover:bg-gray-50 flex items-center gap-1">
                <UrlIcon className="w-3 h-3" /> Add URL
              </button>
              <button disabled={!activeId} onClick={() => setPicker('file')}
                className="text-xs px-2 py-1 border rounded-full bg-white hover:bg-gray-50 flex items-center gap-1">
                <FolderIcon className="w-3 h-3" /> Add File
              </button>
            </div>
          </div>

          <StaggerList as="div" className="overflow-auto h-full space-y-2">
         {sourcesQ.isLoading ? (
           <ListSkeleton rows={6} />
         ) : (
           sourcesQ.data?.map((s: NBSource) => (
             <StaggerItem as="div" key={s.id}>
               <SmartCard
                 as="div"
                 ref={(el) => {
                   if (el) cardRefs.current[s.id] = el as unknown as HTMLDivElement;
                 }}
                 className="group flex items-start gap-2 p-2"
               >
                 <div className="text-xs flex-1 min-w-0">
                   <div className="font-medium truncate">
                     {s.kind === 'URL' ? (s.url?.title || s.url?.url) : s.file?.fileName}
                   </div>
                   <div className="text-[11px] text-gray-500 truncate">
                     {s.kind === 'URL' ? s.url?.url : (s.file?.mimeType || 'file')}
                   </div>
                 </div>

               <PlusButton
                 variant="ghost"
                 size="sm"
                 aria-label="Remove source"
                 title="Remove"
                 onClick={() =>
                   activeId && delSourceM.mutate({ notebookId: activeId, sourceId: s.id })
                 }
                 className="opacity-0 group-hover:opacity-100"
               >
                 ✕
               </PlusButton>
             </SmartCard>
           </StaggerItem>
         ))
       )}
       </StaggerList>
        </div>
      </div>

      {/* Center */}
      <div className="bg-white rounded-2xl border shadow-sm flex flex-col overflow-hidden min-h-[70vh]">
        <div className="border-b px-5 py-3 flex items-center gap-3">
          <input
            value={detailQ.data?.notebook?.title || ''}
            onChange={(e) => activeId && updateTitle.mutate({ id: activeId, title: e.target.value })}
            disabled={!active}
            className="text-lg font-semibold w-full focus:outline-none disabled:bg-transparent placeholder-gray-400"
            placeholder="Untitled notebook"
          />
          <div className="ml-auto text-xs text-gray-500">
            {active ? new Date(active.updatedAt).toLocaleString() : ''}
          </div>
        </div>
        <ChatPanel notebookId={activeId} />
      </div>

      {/* Right */}
      <SmartCard as="section" className="flex flex-col overflow-hidden">
      <NotesEditor notebookId={activeId} />
      <div className="border-t" />
      <RightPanel notebookId={activeId} />
      </SmartCard>

      {/* Picker modal */}
      <SourcePicker open={!!picker} kind={picker || 'url'} notebookId={activeId} onClose={() => setPicker(null)} />
    </div>
  );
}
