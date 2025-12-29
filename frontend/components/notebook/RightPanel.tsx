import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { notebookClient as api } from '../../lib/notebookClient';

export default function RightPanel({ notebookId }: { notebookId: string | null }) {
  const [tab, setTab] = useState<'notes'|'outline'>('notes');
  const q = useQuery({ queryKey: ['nb:detail', notebookId], queryFn: () => api.getNotebook(notebookId!), enabled: !!notebookId });

  if (!notebookId) return <div className="p-3 text-sm text-gray-500">Select a notebook.</div>;
  const openNote = (n: any) => {
    window.dispatchEvent(new CustomEvent('nb:open-note', { detail: n }));
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="flex border-b bg-white/60 backdrop-blur">
        <button onClick={()=>setTab('notes')} className={`px-4 py-2 text-sm ${tab==='notes'?'border-b-2 border-indigo-600 text-indigo-700':'text-gray-600'}`}>Recent notes</button>
        <button onClick={()=>setTab('outline')} className={`px-4 py-2 text-sm ${tab==='outline'?'border-b-2 border-indigo-600 text-indigo-700':'text-gray-600'}`}>Outline</button>
      </div>

      {tab==='notes' ? (
        <div className="p-3 space-y-2">
          {q.data?.notes?.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNote(n)}
              className="w-full text-left border rounded-xl p-3 bg-white shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              title="Open note"
            >
              <div className="text-xs font-semibold truncate">{n.title || 'Untitled'}</div>
              <div className="text-[11px] text-gray-500">{new Date(n.updatedAt).toLocaleString()}</div>
              <div className="text-[11px] text-slate-600 mt-1 line-clamp-2">
                {(n.content || '').slice(0, 160)}
              </div>
            </button>
          ))}
          {!q.data?.notes?.length && <p className="text-xs text-gray-500">No notes yet.</p>}
        </div>
      ) : (
        <OutlinePanel notebookId={notebookId} />
      )}
    </div>
  );
}

function OutlinePanel({ notebookId }: { notebookId: string }) {

  const sections = [
    { h: '1. Executive Summary', b: ['Problem & Context', 'Key Findings', 'Recommendations'] },
    { h: '2. Methods & Sources', b: ['Included URLs/Files', 'Assumptions', 'Limitations'] },
    { h: '3. Analysis', b: ['Topic A', 'Topic B', 'Topic C'] },
    { h: '4. Next Questions', b: ['What remains unclear?', 'What to verify?'] },
  ];
  return (
    <div className="p-3">
      <div className="text-xs text-gray-500 mb-2">Generated outline (mock). Will be LLM-backed later.</div>
      <ol className="text-sm list-decimal ml-5 space-y-2">
        {sections.map((s, i)=>(
          <li key={i}>
            <div className="font-semibold">{s.h}</div>
            <ul className="list-disc ml-5">
              {s.b.map((x, j)=><li key={j} className="text-gray-700">{x}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
