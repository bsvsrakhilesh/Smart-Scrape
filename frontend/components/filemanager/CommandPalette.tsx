"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, CornerDownLeft } from "lucide-react";

export type PaletteCommand = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  group?: string;
  run: () => void;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
};

function scoreMatch(q: string, text: string) {
  // simple fuzzy-ish scoring: exact includes + word boundary boost
  const t = text.toLowerCase();
  const qq = q.toLowerCase().trim();
  if (!qq) return 1;
  if (t === qq) return 100;
  if (t.includes(qq)) return 60;
  // token scoring
  const tokens = qq.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) score += 10;
  }
  return score;
}

function groupBy<T>(arr: T[], keyFn: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    const v = m.get(k) ?? [];
    v.push(x);
    m.set(k, v);
  }
  return m;
}

export default function CommandPalette({ isOpen, onClose, commands }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = commands
      .map((c) => {
        const hay = [c.title, c.subtitle, ...(c.keywords ?? [])].filter(Boolean).join(" ");
        return { c, s: scoreMatch(q, hay) };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.title.localeCompare(b.c.title))
      .map((x) => x.c);

    return scored.slice(0, 50);
  }, [commands, query]);

  const grouped = useMemo(() => {
    return groupBy(filtered, (c) => c.group ?? "Commands");
  }, [filtered]);

  const flat = useMemo(() => filtered, [filtered]);

  // reset state when opening
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  // a11y: trap focus + esc + outside click + scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevActive = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = flat[activeIdx];
        if (cmd) {
          onClose();
          cmd.run();
        }
        return;
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onMouseDown, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      setTimeout(() => prevActive?.focus?.(), 0);
    };
  }, [isOpen, onClose, flat, activeIdx]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-3"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          className="w-[min(760px,96vw)] rounded-2xl border border-app surface shadow-2xl overflow-hidden"
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-app">
            <Search className="w-4 h-4 text-neutral-500" />
            <input
              ref={inputRef}
              name="command-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command…"
              className="w-full bg-transparent outline-none text-sm"
            />
            <div className="text-[11px] text-neutral-500 flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" /> Enter
            </div>
          </div>

          <div className="max-h-[60vh] overflow-auto">
            {flat.length === 0 ? (
              <div className="p-6 text-sm text-neutral-500">No results.</div>
            ) : (
              Array.from(grouped.entries()).map(([group, items]) => (
                <div key={group} className="py-2">
                  <div className="px-4 pb-1 text-[11px] uppercase tracking-wide text-neutral-500">
                    {group}
                  </div>
                  <div className="px-2">
                    {items.map((c) => {
                      const idx = flat.findIndex((x) => x.id === c.id);
                      const active = idx === activeIdx;
                      return (
                        <button
                          key={c.id}
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => {
                            onClose();
                            c.run();
                          }}
                          className={[
                            "w-full text-left px-3 py-2 rounded-xl flex items-start gap-2",
                            active
                              ? "bg-[hsl(var(--surface-elev))]"
                              : "hover:bg-[hsl(var(--surface-elev))]",
                          ].join(" ")}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{c.title}</div>
                            {c.subtitle && (
                              <div className="text-xs text-neutral-500 line-clamp-1">
                                {c.subtitle}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t border-app text-[11px] text-neutral-500 flex items-center justify-between">
            <span>↑ ↓ to navigate • Enter to run • Esc to close</span>
            <span>Ctrl/Cmd + K</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
