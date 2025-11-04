"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Home } from "lucide-react";
import { motion } from "framer-motion";

type Crumb = { id: string; label: string; onClick: () => void };

type Props = {
  path: Crumb[];

  /** Current folder id if you want the component to maintain its own history and path text */
  currentFolderId?: string | null;

  /** Optional: provide back/forward from outside (e.g., useExplorerHistory) */
  onBack?: () => void;
  onForward?: () => void;
  backEnabled?: boolean;
  forwardEnabled?: boolean;

  /** Optional: navigate to a target folder (used by address bar resolution) */
  onNavigate?: (folderId: string | null) => void;

  /**
   * Resolve free-form text from the address bar to a folderId.
   * If not provided, fallback tries to match last segment by label within current path.
   */
  onResolvePathText?: (text: string) => Promise<string | null> | string | null;

  /** Optional: show a search box on the right */
  onSearchSubmit?: (q: string) => void;
  initialSearch?: string;
  getChildren?: (id: string | null) => Promise<Array<{ id: string; name: string }>>;
};

export default function ExplorerBreadcrumbs({
  path,
  currentFolderId = null,
  onBack,
  onForward,
  backEnabled,
  forwardEnabled,
  onNavigate,
  onResolvePathText,
  onSearchSubmit,
  initialSearch = "",
  getChildren
}: Props) {
  // ----------- Derived strings -----------
  const currentPathString = useMemo(
    () => (path.length ? path.map((p) => p.label).join("/") : "Home"),
    [path]
  );

  const [editing, setEditing] = useState(false);
  const [pathText, setPathText] = useState(currentPathString);
  const [addrError, setAddrError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const crumbsRef = useRef<HTMLDivElement | null>(null);

 // Quick-jump menu state
  const [menu, setMenu] = useState<{
     x: number;
     y: number;
     items: Array<{ id: string; name: string }>;
  } | null>(null);

  useEffect(() => {
    if (!editing) setPathText(currentPathString);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPathString]);

  // Auto-scroll right to reveal the most specific crumb
  useEffect(() => {
    const el = crumbsRef.current;
    if (!el) return;
    // Defer till after layout
    requestAnimationFrame(() => {
       el.scrollLeft = el.scrollWidth;
    });
  }, [path]);

  useEffect(() => {
    if (!menu) return;
    const onClick = () => setMenu(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menu]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  // Ctrl+L: toggle into address edit and select the whole path
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setEditing(true);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ----------- Internal history (only used if no external onBack/onForward given) -----------
  const [backStack, setBackStack] = useState<(string | null)[]>([]);
  const [fwdStack, setFwdStack] = useState<(string | null)[]>([]);
  const lastIdRef = useRef<string | null>(currentFolderId ?? null);

  useEffect(() => {
    const now = currentFolderId ?? null;
    const prev = lastIdRef.current ?? null;
    if (prev === now) return;

    // push prev to back and clear forward
    if (prev !== null || now !== null) {
      setBackStack((bs) => [...bs, prev]);
      setFwdStack([]);
    }
    lastIdRef.current = now;
  }, [currentFolderId]);

  const internalCanBack = backStack.length > 0;
  const internalCanForward = fwdStack.length > 0;

  const internalBack = useCallback(() => {
    if (!internalCanBack) return;
    const target = backStack[backStack.length - 1];
    const prev = currentFolderId ?? null;
    setBackStack((bs) => bs.slice(0, bs.length - 1));
    setFwdStack((fs) => [...fs, prev]);
    lastIdRef.current = target;
    if (onNavigate) onNavigate(target);
    else {
      // try to find the crumb for target id; if none, click the closest earlier crumb
      const targetCrumb = path.find((c) => c.id === target);
      if (targetCrumb) targetCrumb.onClick();
      else path[path.length - 1]?.onClick();
    }
  }, [internalCanBack, backStack, currentFolderId, onNavigate, path]);

  const internalForward = useCallback(() => {
    if (!internalCanForward) return;
    const target = fwdStack[fwdStack.length - 1];
    const prev = currentFolderId ?? null;
    setFwdStack((fs) => fs.slice(0, fs.length - 1));
    setBackStack((bs) => [...bs, prev]);
    lastIdRef.current = target;
    if (onNavigate) onNavigate(target);
    else {
      const targetCrumb = path.find((c) => c.id === target);
      if (targetCrumb) targetCrumb.onClick();
      else path[path.length - 1]?.onClick();
    }
  }, [internalCanForward, fwdStack, currentFolderId, onNavigate, path]);

  const doBack = onBack ?? internalBack;
  const doForward = onForward ?? internalForward;
  const canBack = backEnabled ?? internalCanBack;
  const canForward = forwardEnabled ?? internalCanForward;

  // ----------- Address resolution -----------
  const fallbackResolve = useCallback(
    (text: string): string | null => {
      // Very basic: match the last segment by label within the current breadcrumb chain
      const parts = text
        .split(/[\\/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!parts.length) return path[0]?.id ?? null;
      const needle = parts[parts.length - 1].toLowerCase();
      const match = [...path]
        .reverse()
        .find((c) => c.label.toLowerCase() === needle);
      return match?.id ?? path[path.length - 1]?.id ?? null;
    },
    [path]
  );

  const applyAddress = useCallback(async () => {
    setAddrError(null);
    try {
      const trimmed = pathText.trim();
      if (!trimmed) {
        if (onNavigate) onNavigate(path[0]?.id ?? null);
        else path[0]?.onClick?.();
        setEditing(false);
        return;
      }
      const target = onResolvePathText
        ? await onResolvePathText(trimmed)
        : fallbackResolve(trimmed);

      if (typeof target === "undefined") {
        throw new Error("Unable to resolve path.");
      }
      if (onNavigate) onNavigate(target ?? null);
      else {
        const crumb = path.find((c) => c.id === target);
        if (crumb) crumb.onClick();
        else path[path.length - 1]?.onClick?.();
      }
      setEditing(false);
    } catch (err: any) {
      setAddrError(err?.message || "Invalid path");
    }
  }, [fallbackResolve, onNavigate, onResolvePathText, path, pathText]);

  // ----------- UI -----------
  const AddressOrCrumbs = (
    <div className="flex-1 min-w-0">
      {editing ? (
        <div className="relative">
          <input
            ref={inputRef}
            className={`w-full h-9 pl-3 pr-9 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))] ${addrError ? "ring-2 ring-red-500" : ""}`}
            value={pathText}
            onChange={(e) => setPathText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyAddress();
              if (e.key === "Escape") {
                setEditing(false);
                setAddrError(null);
                setPathText(currentPathString);
              }
            }}
            aria-label="Address input"
          />
          <div className="absolute right-1 top-1 flex gap-1">
            <button
              className="px-2 py-1 text-xs rounded-md bg-[hsl(var(--surface-elev))] hover:bg-[hsl(var(--surface-elev-2))] border"
              onClick={() => {
                setEditing(false);
                setAddrError(null);
                setPathText(currentPathString);
              }}
              title="Cancel"
            >
              Esc
            </button>
            <button
              className="px-2 py-1 text-xs rounded-md bg-[hsl(var(--accent))] text-white hover:opacity-90"
              onClick={applyAddress}
              title="Go"
            >
              Go
            </button>
          </div>
          {addrError && (
            <div className="mt-1 text-xs text-red-600">{addrError}</div>
          )}
        </div>
      ) : (
        <div
          role="group"
          aria-label="Breadcrumb"
          className="h-9 flex items-center gap-1 px-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] overflow-x-auto scrollbar-thin"
          ref={crumbsRef}
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit path"
        >
          <button
            onClick={path[0]?.onClick}
            className="rounded-lg px-2 py-1 hover:bg-[hsl(var(--surface-elev))]"
            aria-label="Home"
            title="Home"
          >
            <Home className="h-4 w-4" />
          </button>
          {path.slice(1).map((c) => (
            <div key={c.id} className="flex items-center">
              <ChevronRight className="h-4 w-4 text-[hsl(var(--muted))]" />
              <button
                onClick={c.onClick}
                className="rounded-lg px-2 py-1 hover:bg-[hsl(var(--surface-elev))]"
              >
                {c.label}
              </button>
              {getChildren && (
              <button
                className="ml-1 px-1.5 py-1 rounded-md opacity-60 group-hover:opacity-100 hover:bg-[hsl(var(--surface-elev))]"
                title="Quick jump"
                onClick={async (e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const items = await getChildren(c.id);
                  setMenu({ x: rect.left, y: rect.bottom + 6, items });
                }}
              >
                ▾
              </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const SearchBox = onSearchSubmit ? (
    <form
      className="hidden md:flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSearchSubmit(String(fd.get("q") || ""));
      }}
    >
      <input
        name="q"
        defaultValue={initialSearch}
        placeholder="Search this folder"
        className="h-9 w-64 pl-3 pr-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
        aria-label="Search"
      />
    </form>
  ) : null;

  {menu && createPortal(
    <div
      className="fixed z-[80] min-w-[220px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-xl p-1"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => setMenu(null)}
    >
      {menu.items.length === 0 ? (
        <div className="px-3 py-2 text-sm text-[hsl(var(--muted))]">No subfolders</div>
      ) : (
        menu.items.map((it) => (
          <button
            key={it.id}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-[hsl(var(--surface-elev))] text-sm"
            onClick={() => {
              setMenu(null);
              onNavigate?.(it.id);
            }}
          >
            {it.name}
          </button>
        ))
      )}
    </div>,
    document.body
  )}

  return (
    <motion.nav
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="text-sm flex items-center gap-2"
    >
      {/* Back / Forward */}
      <div className="inline-flex rounded-xl border border-[hsl(var(--border))] overflow-hidden">
        <button
          className={`px-3 py-2 ${canBack ? "hover:bg-[hsl(var(--surface-elev))]" : "opacity-40 cursor-not-allowed"}`}
          onClick={doBack}
          disabled={!canBack}
          aria-label="Back"
          title="Back"
        >
          ←
        </button>
        <button
          className={`px-3 py-2 ${canForward ? "hover:bg-[hsl(var(--surface-elev))]" : "opacity-40 cursor-not-allowed"}`}
          onClick={doForward}
          disabled={!canForward}
          aria-label="Forward"
          title="Forward"
        >
          →
        </button>
      </div>

      {/* Address / Breadcrumbs */}
      {AddressOrCrumbs}

      {/* Right-side actions */}
      <div className="flex items-center gap-2">
        <button
          className="h-9 px-3 rounded-xl border hover:bg-[hsl(var(--surface-elev))]"
          onClick={() => setEditing((v) => !v)}
          title={editing ? "Show breadcrumbs" : "Edit address"}
        >
          {editing ? "Breadcrumbs" : "Edit"}
        </button>
        {SearchBox}
      </div>
    </motion.nav>
  );
}
