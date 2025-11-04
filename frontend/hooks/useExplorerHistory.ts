import { useCallback, useEffect, useMemo, useRef } from 'react';

type Options = {
  /** Query parameter to store folder id in URL (default: 'folder') */
  param?: string;
  /** Called when browser back/forward happens */
  onPopNavigate?: (folderId: string | null) => void;
};

export function useExplorerHistory(currentFolderId: string | null, opts: Options = {}) {
  const param = opts.param ?? 'folder';
  const onPopNavigate = opts.onPopNavigate;

  // Read initial value from URL once (on mount)
  const initialFromUrl = useMemo(() => {
    const u = new URL(window.location.href);
    return (u.searchParams.get(param) as string | null) ?? null;
  }, [param]);

  // Track last id we pushed, to avoid redundant pushState
  const lastIdRef = useRef<string | null>(initialFromUrl);

  // When currentFolderId changes (via app navigation), push to URL
  useEffect(() => {
    const now = currentFolderId ?? null;
    if (lastIdRef.current === now) return;
    const url = new URL(window.location.href);
    if (now) url.searchParams.set(param, now);
    else url.searchParams.delete(param);
    window.history.pushState({ [param]: now }, '', url.toString());
    lastIdRef.current = now;
  }, [currentFolderId, param]);

  // Handle browser back/forward
  useEffect(() => {
    const onPop = (_e: PopStateEvent) => {
      const url = new URL(window.location.href);
      const next = (url.searchParams.get(param) as string | null) ?? null;
      lastIdRef.current = next;
      onPopNavigate?.(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onPopNavigate, param]);

  // Programmatic back/forward helpers
  const goBack = useCallback(() => window.history.back(), []);
  const goForward = useCallback(() => window.history.forward(), []);

  // Not reliably knowable; expose as always-true so UI can enable them.
  const canGoBack = true;
  const canGoForward = true;

  return {
    initialFolderId: initialFromUrl,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
  };
}
