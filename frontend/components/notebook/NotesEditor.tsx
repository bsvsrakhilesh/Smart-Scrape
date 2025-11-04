import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notebookClient as api } from '../../lib/notebookClient';

export default function NotesEditor({ notebookId }: { notebookId: string | null }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveM = useMutation({
    mutationFn: () => api.createNote(notebookId!, { title, content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nb:detail', notebookId] });
      setDirty(false);
      // clear draft after a successful save
      if (notebookId) {
        localStorage.removeItem(`nb:noteDraft:title:${notebookId}`);
        localStorage.removeItem(`nb:noteDraft:content:${notebookId}`);
      }
    },
  });

  // load drafts
  useEffect(() => {
    if (!notebookId) return;
    const t = localStorage.getItem(`nb:noteDraft:title:${notebookId}`) || '';
    const c = localStorage.getItem(`nb:noteDraft:content:${notebookId}`) || '';
    if (t) setTitle(t);
    if (c) setContent(c);
  }, [notebookId]);

  // persist drafts (debounced)
  useEffect(() => {
    if (!notebookId) return;
    const id = setTimeout(() => {
      localStorage.setItem(`nb:noteDraft:title:${notebookId}`, title);
      localStorage.setItem(`nb:noteDraft:content:${notebookId}`, content);
    }, 150);
    return () => clearTimeout(id);
  }, [notebookId, title, content]);

  // autosave (debounced)
  useEffect(() => {
    if (!notebookId || !dirty) return;
    const t = setTimeout(async () => {
      setSaving(true);
      await saveM.mutateAsync();
      setSaving(false);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, dirty, notebookId]);

  // listen for Add-to-Notes events from Chat
  useEffect(() => {
    function onAdd(e: any) {
      const md = String(e.detail || '');
      setContent(prev => (prev ? prev + '\n\n' + md : md));
      setDirty(true);
    }
    window.addEventListener('nb:add-note', onAdd as any);
    return () => window.removeEventListener('nb:add-note', onAdd as any);
  }, []);

  // Cmd/Ctrl+S quick save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (notebookId && (title || content)) saveM.mutate();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notebookId, title, content, saveM]);

  return (
    <div className="p-4 flex flex-col gap-2 bg-white">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Notes</div>
        <div className="text-[11px] text-gray-500">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</div>
      </div>
      <input
        value={title}
        onChange={(e)=>{ setTitle(e.target.value); setDirty(true); }}
        placeholder="Note title"
        className="border rounded-xl px-3 py-2 text-sm shadow-sm"
        disabled={!notebookId}
      />
      <textarea
        value={content}
        onChange={(e)=>{ setContent(e.target.value); setDirty(true); }}
        placeholder="Write notes (markdown allowed)…"
        className="h-40 border rounded-xl p-3 text-sm font-mono shadow-sm"
        disabled={!notebookId}
      />
      <div className="flex justify-end">
        <button
          onClick={()=>saveM.mutate()}
          disabled={!notebookId || (!dirty && !content.trim())}
          className="text-xs px-4 py-2 border rounded-full bg-gray-900 text-white disabled:opacity-60"
        >
          Save now
        </button>
      </div>
    </div>
  );
}
