// components/ContextMenu.tsx
import React, { useEffect, useLayoutEffect, useRef } from 'react';

export type MenuItem =
  | { type: 'item'; id: string; label: string; onSelect: () => void; shortcut?: string; danger?: boolean; disabled?: boolean }
  | { type: 'separator' }
  | { type: 'label'; label: string };

type Props = {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

const ContextMenu: React.FC<Props> = ({ open, x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);

  // close on outside / escape
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('contextmenu', outside, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('contextmenu', outside, true);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  // keep onscreen
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const pad = 6;
    let nx = x, ny = y;
    if (r.right > window.innerWidth) nx = Math.max(pad, window.innerWidth - r.width - pad);
    if (r.bottom > window.innerHeight) ny = Math.max(pad, window.innerHeight - r.height - pad);
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  }, [open, x, y]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[220px] bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-xl shadow-2xl py-1"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((it, i) => {
        if (it.type === 'separator') return <div key={`sep-${i}`} className="my-1 border-t dark:border-gray-800" />;
        if (it.type === 'label') return <div key={`lbl-${i}`} className="px-3 py-1.5 text-xs text-neutral-500">{it.label}</div>;
        return (
          <button
            key={it.id}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => { it.onSelect(); onClose(); }}
            className={[
              'w-full flex items-center justify-between gap-6 px-3 py-2 text-sm',
              it.danger ? 'text-red-600' : 'text-neutral-800 dark:text-neutral-100',
              it.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'
            ].join(' ')}
          >
            <span className="truncate">{it.label}</span>
            {it.shortcut && <span className="text-[11px] text-neutral-400">{it.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default ContextMenu;
