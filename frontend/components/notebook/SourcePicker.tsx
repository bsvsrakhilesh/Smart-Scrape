import { useEffect, useMemo, useState } from 'react';
import { notebookClient as api } from '../../lib/notebookClient';

export default function SourcePicker({
  open, onClose, kind, notebookId
}: { open: boolean; onClose: () => void; kind: 'url'|'file'; notebookId: string | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    (async () => {
      setItems(kind==='url' ? await api.listAllUrls() : await api.listAllFiles());
      setSelected(new Set());
    })();
  }, [open, kind]);

  const filtered = useMemo(() => {
    const key = (x:any) => kind==='url' ? (x.title || x.url) : x.fileName;
    return items.filter(x => key(x).toLowerCase().includes(q.toLowerCase()));
  }, [items, q, kind]);

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const attach = async () => {
    if (!notebookId) return;
    for (const id of selected) {
      if (kind==='url') await api.addUrlSource(notebookId, id);
      else await api.addFileSource(notebookId, id);
    }
    onClose();
    window.dispatchEvent(new Event('focus'));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-50 flex items-center justify-center">
      <div className="bg-white w-[640px] max-h-[72vh] rounded-2xl border border-slate-200/80 shadow-xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60 flex items-center gap-2">
          <input
            autoFocus
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            placeholder={`Search ${kind==='url'?'URLs':'Files'}…`}
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <button onClick={onClose} className="text-sm px-2 py-1 border rounded">Close</button>
          <button
            onClick={attach}
            disabled={!selected.size}
            className="text-sm px-3 py-1.5 border rounded bg-gray-900 text-white disabled:opacity-60"
          >
            Attach {selected.size ? `(${selected.size})` : ''}
          </button>
        </div>
        <div className="p-2 overflow-auto">
          {filtered.map((item:any) => {
            const title = kind==='url' ? (item.title || item.url) : item.fileName;
            const sub = kind==='url' ? item.url : (item.mimeType || 'file');
            const checked = selected.has(item.id);
            return (
              <label key={item.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 rounded border-b cursor-pointer">
                <input type="checkbox" checked={checked} onChange={()=>toggle(item.id)} className="accent-indigo-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{title}</div>
                  <div className="text-[11px] text-gray-500 truncate">{sub}</div>
                </div>
              </label>
            );
          })}
          {!filtered.length && <div className="text-xs text-gray-500 p-3">No items.</div>}
        </div>
      </div>
    </div>
  );
}
