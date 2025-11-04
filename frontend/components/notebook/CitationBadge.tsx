import { useEffect, useRef, useState } from 'react';

export default function CitationBadge({
  index,
  chunkId,
  onOpenSource,
}: {
  index: number;
  chunkId: string;
  onOpenSource?: (chunkId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [snippet, setSnippet] = useState<string>('Loading…');
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Placeholder until backend hydrate is wired
    setSnippet('“…context snippet for this citation will appear here in a popover…”');
  }, [open]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <span ref={ref} className="relative inline-block">
      <sup
        className="ml-0.5 cursor-pointer select-none px-1 rounded text-indigo-700 bg-indigo-50 border border-indigo-200 text-[10px] leading-4"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => onOpenSource?.(chunkId)}
      >
        {index}
      </sup>
      {open && (
        <div className="absolute z-50 mt-2 w-72 p-2 bg-white border rounded shadow-lg">
          <div className="text-[11px] text-gray-500 mb-1">Citation {index}</div>
          <div className="text-xs text-gray-800 line-clamp-5">{snippet}</div>
          <div className="mt-2 text-right">
            <button
              className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50"
              onClick={() => onOpenSource?.(chunkId)}
            >
              Open source
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
