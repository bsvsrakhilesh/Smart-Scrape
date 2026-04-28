import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  value: string[];
  suggestions?: string[];
  onChange?: (next: string[]) => void;
  onClose?: () => void;
  maxVisible?: number;
};

const TagChip: React.FC<{ text: string; onRemove?: () => void }> = ({
  text,
  onRemove,
}) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 border dark:border-gray-700"
    // Make sure container chips don't leak events upward
    onPointerDownCapture={(e) => e.stopPropagation()}
    onMouseDownCapture={(e) => e.stopPropagation()}
  >
    <span className="truncate max-w-[140px]">{text}</span>
    {onRemove && (
      <button
        type="button"
        className="rounded hover:bg-gray-200 dark:hover:bg-gray-700 px-1 leading-none"
        aria-label={`Remove tag ${text}`}
        title="Remove"
        // Stop *both* pointer and mouse before they reach document capture listeners
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        x
      </button>
    )}
  </span>
);

const match = (q: string, s: string) =>
  s.toLowerCase().includes(q.trim().toLowerCase());

const TagEditor: React.FC<Props> = ({
  value,
  suggestions = [],
  onChange,
  onClose,
  maxVisible = 6,
}) => {
  const [tags, setTags] = useState<string[]>(value || []);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setTags(value || []), [value]);

  // Close only on *true* outside pointer/mouse down
  useEffect(() => {
    const handler = (e: Event) => {
      const target = e.target as Node | null;
      if (!ref.current || !target) return;
      // If the event originated inside any TagEditor root, ignore
      const el = (target as Element).closest?.('[data-tageditor-root="true"]');
      if (el && ref.current.contains(el)) return;
      onClose?.();
    };

    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("mousedown", handler, true);
    return () => {
      document.removeEventListener("pointerdown", handler, true);
      document.removeEventListener("mousedown", handler, true);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const base = q
      ? suggestions.filter((s) => match(q, s))
      : suggestions.slice();
    return base.filter((s) => !tags.includes(s)).slice(0, 50);
  }, [q, suggestions, tags]);

  const commit = (next: string[]) => {
    setTags(next);
    onChange?.(next);
    // Keep focus in the editor so follow-up clicks don't blur/close
    queueMicrotask(() => inputRef.current?.focus());
  };

  const add = (t: string) => {
    const tag = t.trim();
    if (!tag || tags.includes(tag)) return;
    commit([...tags, tag]);
    setQ("");
    setActive(0);
  };

  const remove = (t: string) => {
    commit(tags.filter((x) => x !== t));
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (q && q.trim()) return add(q);
      if (filtered[active]) return add(filtered[active]);
    }
    if (e.key === "Backspace" && !q && tags.length) {
      remove(tags[tags.length - 1]);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    }
    if (e.key === "Escape") onClose?.();
  };

  return (
    <div
      ref={ref}
      data-tageditor-root="true"
      className="w-72 p-3 bg-white dark:bg-gray-900 border rounded-lg shadow-xl"
      // Block capture-phase outside-click handlers above us for *both* pointer and mouse
      onPointerDownCapture={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap gap-1">
        {tags.slice(0, maxVisible).map((t) => (
          <TagChip key={t} text={t} onRemove={() => remove(t)} />
        ))}
        {tags.length > maxVisible && (
          <span className="text-xs text-gray-500">
            +{tags.length - maxVisible} more
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        className="mt-2 w-full input-pill"
        placeholder="Add tag..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        // Prevent outside-click handlers when interacting with the input
        onPointerDownCapture={(e) => e.stopPropagation()}
        onMouseDownCapture={(e) => e.stopPropagation()}
      />

      <div className="mt-2 max-h-40 overflow-auto space-y-1">
        {filtered.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`w-full text-left px-2 py-1 rounded ${
              i === active
                ? "bg-gray-100 dark:bg-gray-800"
                : "hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setActive(i)}
            onClick={() => add(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-2 text-right">
        <button className="btn-ghost text-xs" onClick={() => onClose?.()}>
          Close
        </button>
      </div>
    </div>
  );
};

export default TagEditor;
