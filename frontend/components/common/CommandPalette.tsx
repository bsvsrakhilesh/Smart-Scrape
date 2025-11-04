import { useEffect, useMemo, useRef, useState } from 'react';
import { Page } from '../../types';

type Entry = { label: string; page: Page; hint?: string };

const ENTRIES: Entry[] = [
  { label: 'Go to URL Collector', page: 'url-collector', hint: 'Collect and tag links' },
  { label: 'Go to Saved URLs',    page: 'saved-urls',    hint: 'Your saved link set' },
  { label: 'Go to File Manager',  page: 'file-manager',  hint: 'Upload & browse files' },
  { label: 'Go to Notebook',      page: 'notebook',      hint: 'Notes & snippets' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  setCurrentPage: (p: Page) => void;
}

export default function CommandPalette({ isOpen, onClose, setCurrentPage }: Props) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ENTRIES;
    return ENTRIES.filter(e => e.label.toLowerCase().includes(s) || (e.hint ?? '').toLowerCase().includes(s));
  }, [q]);

  // Cmd/Ctrl + K open, Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!isOpen) document.dispatchEvent(new CustomEvent('open-command-palette'));
      }
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 0);
    else setQ('');
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-[15vh] -translate-x-1/2 w-[92vw] max-w-[720px] rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-3 border-b border-border">
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Type a command… (Ctrl/Cmd+K)"
            className="w-full h-11 rounded-xl bg-muted/70 hover:bg-muted focus:bg-background border border-transparent focus:border-border outline-none px-3"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-sm text-foreground/60">No results.</div>
          ) : filtered.map((e) => (
            <button
              key={e.label}
              onClick={() => { setCurrentPage(e.page); onClose(); }}
              className="w-full text-left px-4 py-3 hover:bg-muted flex items-center justify-between"
            >
              <div>
                <div className="text-sm">{e.label}</div>
                {e.hint && <div className="text-xs text-foreground/60">{e.hint}</div>}
              </div>
              <div className="text-[10px] chip chip-blue">Go</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
