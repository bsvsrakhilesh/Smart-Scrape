import { useCallback, useEffect, useRef, useState } from 'react';
import { notebookClient as api } from '../../lib/notebookClient';
import { Loader2 } from 'lucide-react';
import CitationBadge from './CitationBadge';
import MessageActions from './MessageActions';

type Msg = { role: 'user'|'assistant'; html: string; citations?: { chunkId: string }[]; suggested?: string[] };

function renderMarkdown(md: string) {
  const esc = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\_(.+?)\_/g,'<em>$1</em>').replace(/\n/g,'<br/>');
}

export default function ChatPanel({ notebookId }: { notebookId: string | null }) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Persist composer draft per notebook
  const draftKey = notebookId ? `nb:chatDraft:${notebookId}` : null;
  useEffect(() => {
    if (!draftKey) return;
    const saved = localStorage.getItem(draftKey);
    if (saved) setInput(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => localStorage.setItem(draftKey, input), 150);
    return () => clearTimeout(t);
  }, [draftKey, input]);

  // autoscroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pending]);

  const send = useCallback(async (q: string) => {
    setMessages(m => [...m, { role:'user', html: q }]);
    setPending(true);
    try {
      const res = await api.chat(notebookId!, q);
      const full = renderMarkdown(res.answer);
      let i = 0; const step = 14;
      const msg: Msg = { role:'assistant', html: '', citations: res.citations, suggested: res.suggested };
      setMessages(m => [...m, msg]);
      while (i < full.length) {
        await new Promise(r => setTimeout(r, 12));
        i += step;
        msg.html = full.slice(0, i);
        setMessages(m => [...m.slice(0, -1), { ...msg }]);
      }
    } finally {
      setPending(false);
    }
  }, [notebookId]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (notebookId && input.trim()) {
        const q = input.trim();
        setInput('');
        send(q);
      }
    }
  };

  const onRegenerate = (i: number) => {
    if (!notebookId) return;
    const prevUserIndex = [...messages.slice(0, i)].map((m, j) => ({ m, j })).reverse().find(({ m }) => m.role === 'user')?.j;
    if (prevUserIndex == null) return;
    const q = messages[prevUserIndex].html;
    if (q) send(q);
  };

  const addToNotes = (html: string) => {
    const md = html.replace(/<br\/?>/g, '\n');
    window.dispatchEvent(new CustomEvent('nb:add-note', { detail: md }));
  };

  const openSource = (chunkId: string) => {
    // When backend maps chunkId -> sourceId, emit a second event:
    window.dispatchEvent(new CustomEvent('nb:open-source', { detail: chunkId }));
    // Optionally: window.dispatchEvent(new CustomEvent('nb:focus-source', { detail: sourceId }));
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50/50">
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {messages.map((m,i)=>(
          <div key={i} className={`max-w-[80%] ${m.role==='user'?'ml-auto':''}`}>
            <div className={`p-3 rounded-2xl border shadow-sm ${m.role==='user'?'bg-white':'bg-white'}`}
                 {...(m.role==='assistant' ? { dangerouslySetInnerHTML: { __html: m.html } } : { children: m.html })}/>
            {m.role==='assistant' && m.citations?.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.citations.map((c, idx)=>(
                  <CitationBadge key={c.chunkId} index={idx+1} chunkId={c.chunkId} onOpenSource={openSource}/>
                ))}
              </div>
            ) : null}
            {m.role==='assistant' &&
              <MessageActions content={m.html} onRegenerate={()=>onRegenerate(i)} onAddToNotes={addToNotes} />
            }
            {m.role==='assistant' && m.suggested?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.suggested.map((s, sIdx)=>(
                  <button key={sIdx} onClick={()=>setInput(s)} className="text-[11px] px-2 py-1 border rounded">
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {pending && <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Generating…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3 bg-white">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e)=>setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={notebookId ? 'Ask about your sources…' : 'Create/select a notebook to start'}
            disabled={!notebookId}
            className="flex-1 border rounded-xl px-3 py-2 text-sm focus:outline-none disabled:bg-gray-50 resize-none shadow-sm"
          />
          <button
            onClick={()=>notebookId && input.trim() && (setInput(''), send(input.trim()))}
            disabled={!notebookId}
            className="px-4 py-2 border rounded-full bg-gray-900 text-white text-sm disabled:opacity-60"
          >
            Send
          </button>
        </div>
        <div className="mt-1 text-[11px] text-gray-500">Enter to send · Shift+Enter for newline</div>
      </div>
    </div>
  );
}
