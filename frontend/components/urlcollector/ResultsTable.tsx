import React, { useEffect, useMemo, useRef, useState } from 'react';
import CollectionPickerModal from '../savedurls/CollectionPickerModal';
import {
  addUrlToCollection,
  createCollection,
  getCollections,
  getUrlCollections,
  removeUrlFromCollection,
  setUrlCollections,
} from '../../utils/collections';
import { SearchResult } from '../../lib/types';
import {
  fetchSavedUrls,
  saveUrls,
  deleteUrlsBulk,
  type SaveUrlsRequestRow,
  type SaveUrlsResponse,
  type BackendUrlRow,
  crawlSavePdf,
  crawlSaveText,
} from '../../lib/api';
import DownloadIcon from '../icons/DownloadIcon';
import FolderPickerModal from '../savedurls/FolderPickerModal';
import { StaggerList, StaggerItem } from '../motion/StaggerList';
import { canonicalize as canonicalizeSaved, removeSaved, SAVED_KEY } from '../../utils/saved';

interface ResultsTableProps {
  results: SearchResult[];
  selectable?: boolean;
  selectedUrls?: Set<string>;
  onToggleRow?: (url: string) => void;
  onToggleAll?: () => void;
  onClear?: () => void;
  sortKey?: 'original' | 'title' | 'domain';
  onSortChange?: (k: 'original' | 'title' | 'domain') => void;
}

/* ---------------- helpers ---------------- */

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

const nicePath = (url: string) => {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname || '/');
    const short = p.length > 48 ? p.slice(0, 45) + '…' : p || '/';
    return short + (u.search ? '…' : '');
  } catch {
    return url;
  }
};

const favicon = (url: string) => `https://icons.duckduckgo.com/ip3/${host(url)}.ico`;

// Dedupe canonicalization (strip common tracking params)
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_reader',
  'utm_referrer',
  'gclid',
  'fbclid',
  'igshid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
]);

const canonicalUrl = (raw: string) => {
  try {
    const u = new URL(raw);

    u.hash = '';
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));

    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }

    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }

    const params = Array.from(u.searchParams.entries());
    params.sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    params.forEach(([k, v]) => u.searchParams.append(k, v));

    return u.toString();
  } catch {
    return raw;
  }
};

function exportToCsv(rows: SearchResult[], filename = 'results') {
  const headers = ['title', 'url', 'snippet'];
  const esc = (v: any) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  };
  const body = rows.map((r) => [r.title, r.url, r.snippet ?? ''].map(esc).join(',')).join('\r\n');
  const csv = [headers.join(','), body].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type SavedFilter = 'all' | 'saved' | 'unsaved';
type SortKey = 'original' | 'title' | 'domain';
type SortDir = 'asc' | 'desc';

/* ---------------- component ---------------- */

const ResultsTable: React.FC<ResultsTableProps> = ({
  results,
  selectable = true,
  selectedUrls = new Set<string>(),
  onToggleRow,
  onToggleAll,
  onClear,
  sortKey: sortKeyProp,
  onSortChange,
}) => {
  // local selection if parent doesn't control it
  const [localSelected, setLocalSelected] = useState<Set<string>>(selectedUrls);
  const selected = onToggleRow || onToggleAll ? selectedUrls : localSelected;

  const [isSaving, setIsSaving] = useState(false);
  const [rowSaving, setRowSaving] = useState<string | null>(null);
  const [rowSaved, setRowSaved] = useState<Record<string, boolean>>({});

  const [sortKeyLocal, setSortKeyLocal] = useState<SortKey>('original');
  const sortKey = (sortKeyProp ?? sortKeyLocal) as SortKey;
  const setSortKey = onSortChange ?? setSortKeyLocal;
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Collection picker state (Save)
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collections, setCollections] = useState(getCollections());
  const [pendingRows, setPendingRows] = useState<SaveUrlsRequestRow[] | null>(null);

  // Remove-from-collection picker state
  const [removePickerOpen, setRemovePickerOpen] = useState(false);
  const [removeTargetUrl, setRemoveTargetUrl] = useState<string | null>(null);

  // capture modal state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'text' | 'pdf'>('text');
  const [pickerTarget, setPickerTarget] = useState<{ url: string; title: string }>({ url: '', title: '' });
  const [captureBusy, setCaptureBusy] = useState<string | null>(null);

  // Dedupe toggle
  const [hideDuplicates, setHideDuplicates] = useState(true);

  // Filtering UI
  const [filterQuery, setFilterQuery] = useState('');
  const [filterDomain, setFilterDomain] = useState<'all' | string>('all');
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('all');
  const [selectedOnly, setSelectedOnly] = useState(false);

  // Non-blocking notifications
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const pushNotice = (type: 'success' | 'error' | 'info', message: string) => {
    setNotice({ type, message });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4500);
  };

  // Backend saved index (canonicalUrl -> id)
  const backendIdsRef = useRef<Record<string, number>>({});
  const backendSetRef = useRef<Set<string>>(new Set());

  const refreshBackendSavedIndex = async (rowsForRecalc: SearchResult[] = results) => {
    try {
      const saved: BackendUrlRow[] = await fetchSavedUrls();
      const idMap: Record<string, number> = {};
      const set = new Set<string>();

      for (const r of saved) {
        const c = canonicalizeSaved(r.url);
        set.add(c);
        idMap[c] = r.id;
      }

      backendIdsRef.current = idMap;
      backendSetRef.current = set;

      // Merge backend-saved OR locally categorized
      setRowSaved((prev) => {
        const next = { ...prev };
        for (const rr of rowsForRecalc) {
          const c = canonicalizeSaved(rr.url);
          const inBackend = set.has(c);
          const inLocalCategory = getUrlCollections(rr.url).length > 0;
          next[rr.url] = inBackend || inLocalCategory;
        }
        return next;
      });
    } catch (e) {
      // If backend is unreachable, keep UI usable with local categories
      setRowSaved((prev) => {
        const next = { ...prev };
        for (const rr of rowsForRecalc) {
          const inLocalCategory = getUrlCollections(rr.url).length > 0;
          next[rr.url] = prev[rr.url] || inLocalCategory;
        }
        return next;
      });
    }
  };

  // Initial sync + when results change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    refreshBackendSavedIndex(results);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  // Recompute saved states if local storage changes (other tabs/pages)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === 'collections' || e.key === 'urlCollectionsByUrl' || e.key === SAVED_KEY) {
        refreshBackendSavedIndex(results);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  const sorted = useMemo(() => {
    if (sortKey === 'original') return results;
    const dir = sortDir === 'asc' ? 1 : -1;
    const clone = [...results];
  
    if (sortKey === 'title') {
      // Stable-ish sort: tie-break by URL so ordering doesn't flicker
      clone.sort((a, b) => {
        const tA = (a.title || '').toLowerCase();
        const tB = (b.title || '').toLowerCase();
        if (tA === tB) return a.url.localeCompare(b.url) * dir;
        return tA.localeCompare(tB) * dir;
      });
    }
  
    if (sortKey === 'domain') {
      clone.sort((a, b) => {
        const dA = host(a.url).toLowerCase();
        const dB = host(b.url).toLowerCase();
        if (dA === dB) {
          const tA = (a.title || '').toLowerCase();
          const tB = (b.title || '').toLowerCase();
          if (tA === tB) return a.url.localeCompare(b.url) * dir;
          return tA.localeCompare(tB) * dir;
        }
        return dA.localeCompare(dB) * dir;
      });
    }
  
    return clone;
  }, [results, sortKey, sortDir]);

  // Dedupe + duplicate counters
  const { displayed, dupCountByUrl, duplicatesRemoved } = useMemo(() => {
    if (!hideDuplicates) {
      return { displayed: sorted, dupCountByUrl: {} as Record<string, number>, duplicatesRemoved: 0 };
    }

    const seen = new Map<string, string>(); // canonical -> first original url
    const dupCount: Record<string, number> = {};
    const out: SearchResult[] = [];

    for (const r of sorted) {
      const canon = canonicalUrl(r.url);
      const first = seen.get(canon);

      if (!first) {
        seen.set(canon, r.url);
        out.push(r);
      } else {
        dupCount[first] = (dupCount[first] ?? 0) + 1;
      }
    }

    return {
      displayed: out,
      dupCountByUrl: dupCount,
      duplicatesRemoved: sorted.length - out.length,
    };
  }, [sorted, hideDuplicates]);

  // Domain options derived from displayed list
  const domainOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of displayed) {
      const d = host(r.url) || 'unknown';
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const arr = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([d, c]) => ({ d, c }));
    return arr;
  }, [displayed]);

  // Apply filters on top of displayed list
  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();

    return displayed.filter((r) => {
      const d = host(r.url) || 'unknown';
      if (filterDomain !== 'all' && d !== filterDomain) return false;

      const isSaved = !!rowSaved[r.url];
      if (savedFilter === 'saved' && !isSaved) return false;
      if (savedFilter === 'unsaved' && isSaved) return false;

      if (selectedOnly && !selected.has(r.url)) return false;

      if (q) {
        const hay = `${r.title ?? ''}\n${r.snippet ?? ''}\n${r.url}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [displayed, filterQuery, filterDomain, savedFilter, selectedOnly, selected, rowSaved]);

  // Pagination (10 per page)
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), [filtered.length]);
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(filtered.length, pageStart + PAGE_SIZE);
  const pageRows = useMemo(() => filtered.slice(pageStart, pageStart + PAGE_SIZE), [filtered, pageStart]);
  
  // When filters/sort/dedupe change, jump back to page 1 so the user doesn't land on an empty page.
  useEffect(() => {
    setPage(1);
  }, [filterQuery, filterDomain, savedFilter, selectedOnly, sortKey, sortDir, hideDuplicates, results.length]);

  const allSelected = useMemo(() => {
    if (pageRows.length === 0) return false;
    for (const r of pageRows) if (!selected.has(r.url)) return false;
    return true;
  }, [filtered, selected]);

  const toggleAll = () => {
    // Parent-controlled selection: keep existing behavior.
    // Local selection: toggle only the current page to match pagination UX.
    if (onToggleAll) return onToggleAll();
    
    if (allSelected) {
      const next = new Set(localSelected);
      pageRows.forEach((r) => next.delete(r.url));
      setLocalSelected(next);
    } else {
      const next = new Set(localSelected);
      pageRows.forEach((r) => next.add(r.url));
      setLocalSelected(next);
    }
  };

  const toggleRow = (url: string) => {
    if (onToggleRow) return onToggleRow(url);
    const next = new Set(localSelected);
    next.has(url) ? next.delete(url) : next.add(url);
    setLocalSelected(next);
  };

  const saveSelected = async () => {
    if (selected.size === 0) return;

    const rows: SaveUrlsRequestRow[] = filtered
      .filter((r) => selected.has(r.url))
      .map((r) => ({ url: r.url, title: r.title ?? r.url, snippet: r.snippet ?? '' }));

    if (rows.length === 0) {
      pushNotice('info', 'No selected rows match current filters.');
      return;
    }

    setPendingRows(rows);
    setCollections(getCollections());
    setCollectionPickerOpen(true);
  };

  const saveSingle = async (r: SearchResult) => {
    if (rowSaved[r.url]) return;
    const rows: SaveUrlsRequestRow[] = [{ url: r.url, title: r.title ?? r.url, snippet: r.snippet ?? '' }];
    setPendingRows(rows);
    setCollections(getCollections());
    setCollectionPickerOpen(true);
  };

  const onPickCancel = () => {
    setCollectionPickerOpen(false);
    setPendingRows(null);
  };

  const onPickConfirm = async (collectionId: string) => {
    if (!pendingRows) return;
    setCollectionPickerOpen(false);

    const isSingle = pendingRows.length === 1;
    if (isSingle) setRowSaving(pendingRows[0].url);
    setIsSaving(true);

    try {
      const res: SaveUrlsResponse = await saveUrls(pendingRows);

      // local category assignment
      pendingRows.forEach((r) => addUrlToCollection(collectionId, r.url));

      // optimistic saved UI
      setRowSaved((prev) => {
        const next = { ...prev };
        pendingRows.forEach((r) => (next[r.url] = true));
        return next;
      });

      pushNotice('success', `Saved ${res.added} URL${res.added === 1 ? '' : 's'} (skipped ${res.skipped}).`);

      // refresh to get backend ids
      await refreshBackendSavedIndex(results);
    } catch (e: any) {
      pushNotice('error', `Failed to save URLs: ${e?.message ?? 'Unknown error'}`);
    } finally {
      setRowSaving(null);
      setIsSaving(false);
      setPendingRows(null);
    }
  };

  const exportSelected = () => {
    const rows = selected.size > 0 ? filtered.filter((r) => selected.has(r.url)) : filtered;
    exportToCsv(rows, selected.size > 0 ? 'results_selected' : 'results_filtered');
    pushNotice('info', `Exported ${rows.length} row${rows.length === 1 ? '' : 's'} to CSV.`);
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      pushNotice('info', 'Copied URL to clipboard.');
    } catch {
      pushNotice('error', 'Copy failed (clipboard not available).');
    }
  };

  // Remove Saved (backend + local categories)
  const unsaveUrl = async (rawUrl: string) => {
    const canon = canonicalizeSaved(rawUrl);

    setRowSaving(rawUrl);

    try {
      // 1) Remove from backend if we have an id
      let id = backendIdsRef.current[canon];
      if (!id) {
        await refreshBackendSavedIndex(results);
        id = backendIdsRef.current[canon];
      }
      if (id) {
        await deleteUrlsBulk([id]);
      }

      // 2) Remove from local “saved” list if present
      removeSaved(rawUrl);

      // 3) Remove from all local categories
      setUrlCollections(rawUrl, []);

      // 4) UI update
      setRowSaved((prev) => ({ ...prev, [rawUrl]: false }));
      pushNotice('success', 'Removed from Saved.');

      // 5) Refresh backend set/map (in case multiple rows share same canonical)
      await refreshBackendSavedIndex(results);
    } catch (e: any) {
      pushNotice('error', `Could not remove: ${e?.message ?? 'Unknown error'}`);
    } finally {
      setRowSaving(null);
    }
  };

  // Remove from a single category
  const openRemoveFromCategory = (url: string) => {
    setCollections(getCollections());
    setRemoveTargetUrl(url);
    setRemovePickerOpen(true);
  };

  const onRemoveCancel = () => {
    setRemovePickerOpen(false);
    setRemoveTargetUrl(null);
  };

  const onRemoveConfirm = (collectionId: string) => {
    if (!removeTargetUrl) return;

    removeUrlFromCollection(collectionId, removeTargetUrl);

    const canon = canonicalizeSaved(removeTargetUrl);
    const stillBackendSaved = backendSetRef.current.has(canon);
    const stillInAnyCategory = getUrlCollections(removeTargetUrl).length > 0;

    setRowSaved((prev) => ({ ...prev, [removeTargetUrl]: stillBackendSaved || stillInAnyCategory }));

    pushNotice('info', 'Removed from category.');
    setRemovePickerOpen(false);
    setRemoveTargetUrl(null);
  };

  // open modal to choose destination + filename
  const openCapture = (mode: 'text' | 'pdf', url: string, title: string) => {
    setPickerMode(mode);
    setPickerTarget({ url, title });
    setPickerOpen(true);
  };

  // confirm + call backend to persist capture
  const onConfirmCapture = async (opts: { folderId?: string | null; fileName: string; mode: 'text' | 'pdf' }) => {
    setPickerOpen(false);
    const { folderId, fileName, mode } = opts;
    const url = pickerTarget.url;

    setCaptureBusy(url);
    try {
      if (mode === 'text') {
        await crawlSaveText(url, folderId ?? undefined, fileName);
      } else {
        await crawlSavePdf(url, folderId ?? undefined, fileName, true, true);
      }
      pushNotice('success', 'Captured and saved successfully.');
    } catch (e) {
      console.error(e);
      pushNotice('error', 'Capture failed. See console for details.');
    } finally {
      setCaptureBusy(null);
    }
  };

  const padY = 'py-4';
  const titleSize = 'text-[16px]';

  const filtersActive =
    filterQuery.trim() !== '' || filterDomain !== 'all' || savedFilter !== 'all' || selectedOnly;

  const clearFilters = () => {
    setFilterQuery('');
    setFilterDomain('all');
    setSavedFilter('all');
    setSelectedOnly(false);
  };

  const removeCollectionsForTarget = useMemo(() => {
    if (!removeTargetUrl) return [];
    const ids = new Set(getUrlCollections(removeTargetUrl));
    return getCollections().filter((c) => ids.has(c.id));
  }, [removeTargetUrl]);

  return (
    <div className="w-full">
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={[
            'mb-3 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
            notice.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : notice.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-gray-200 bg-gray-50 text-gray-800',
          ].join(' ')}
        >
          <div className="min-w-0">{notice.message}</div>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium hover:bg-black/5"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="text-sm text-gray-600">
            {results.length ? (
              <>
                Showing{' '}
                <span className="font-medium text-gray-900">
                  {filtered.length === 0 ? 0 : pageStart + 1}-{pageEnd}
                </span>{' '}
                of <span className="font-medium text-gray-900">{filtered.length}</span>
                {hideDuplicates && duplicatesRemoved > 0 && (
                  <span className="ml-2 text-xs text-gray-500">
                    ({duplicatesRemoved} duplicate{duplicatesRemoved === 1 ? '' : 's'} hidden)
                  </span>
                )}
                {selectable && selected.size > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                    {selected.size} selected
                  </span>
                )}
              </>
            ) : (
              'No results'
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-[260px] max-w-[70vw] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              placeholder="Search title, snippet, or URL…"
            />

            <select
              value={filterDomain}
              onChange={(e) => setFilterDomain(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              title="Filter by domain"
            >
              <option value="all">All domains</option>
              {domainOptions.map((x) => (
                <option key={x.d} value={x.d}>
                  {x.d} ({x.c})
                </option>
              ))}
            </select>

            <select
              value={savedFilter}
              onChange={(e) => setSavedFilter(e.target.value as SavedFilter)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              title="Filter by saved status"
            >
              <option value="all">All</option>
              <option value="unsaved">Unsaved</option>
              <option value="saved">Saved</option>
            </select>

            <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={selectedOnly}
                onChange={() => setSelectedOnly((v) => !v)}
              />
              Selected only
            </label>

            {filtersActive && (
              <button
                type="button"
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onClear && (
              <button
                onClick={() => onClear?.()}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 transition"
                title="Clear searches"
              >
                Clear searches
              </button>
            )}

            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={hideDuplicates}
                onChange={() => setHideDuplicates((v) => !v)}
              />
              Hide duplicates
              {hideDuplicates && duplicatesRemoved > 0 && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  {duplicatesRemoved} removed
                </span>
              )}
            </label>

            <div className="flex items-center gap-2 text-sm">
              <ListFilterIcon className="h-4 w-4 text-gray-500" />
              <select
                value={sortKey}
                onChange={(e) => {
                  const next = e.target.value as SortKey;
                  setSortKey(next);
                  if (next === 'original') setSortDir('asc');
                }}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
                aria-label="Sort results"
              >
                <option value="original">Relevance</option>
                <option value="title">Title</option>
                <option value="domain">Domain</option>
              </select>
              
              {sortKey !== 'original' && (
                <button
                  type="button"
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-200"
                  aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
                  title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {sortDir === 'asc' ? 'A→Z' : 'Z→A'}
                </button>
              )}
            </div>

            {selectable && filtered.length > 0 && (
              <label className="ml-1 flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={toggleAll} />
                Select all ({onToggleAll ? 'loaded' : 'page'})
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectable && (
            <button
              onClick={saveSelected}
              disabled={selected.size === 0 || isSaving}
              className="btn-primary rounded-full px-4 py-2 disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : `Save selected (${selected.size || 0})`}
            </button>
          )}

          <button onClick={exportSelected} className="btn-ghost px-4 py-2">
            <DownloadIcon className="h-5 w-5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        </div>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && totalPages > 1 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white/70 px-3 py-2 text-sm">
          <div className="text-gray-600">
            Page <span className="font-medium text-gray-900">{safePage}</span> of{' '}
            <span className="font-medium text-gray-900">{totalPages}</span>
          </div>
      
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={safePage <= 1}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="First page"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="Previous page"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="Next page"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={safePage >= totalPages}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
              aria-label="Last page"
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      <StaggerList as="ul" className="space-y-2 m-0 p-0">
        {pageRows.map((r) => {
          const h = host(r.url);
          const isChecked = selected.has(r.url);
          const isSaved = !!rowSaved[r.url];
          const dupN = dupCountByUrl[r.url] ?? 0;
          const categoryCount = getUrlCollections(r.url).length;

          return (
            <StaggerItem
              as="li"
              key={r.url}
              onClick={(e: React.MouseEvent) => {
                const t = e.target as HTMLElement;
                if (t.closest('button, a, input, select, textarea, label')) return;
                window.open(r.url, '_blank', 'noopener,noreferrer');
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (
                  (e.key === 'Enter' || e.key === ' ') &&
                  !(e.target as HTMLElement).closest('button, a, input, select, textarea, label')
                ) {
                  e.preventDefault();
                  window.open(r.url, '_blank', 'noopener,noreferrer');
                }
              }}
              role="link"
              tabIndex={0}
              className={[
                'group relative rounded-xl border border-gray-100 bg-white/80 backdrop-blur-sm',
                'hover:shadow-soft hover:-translate-y-[1px] hover:border-green-200/80 hover:bg-white',
                'transition-all duration-200 ease-out cursor-pointer',
              ].join(' ')}
            >
              <span className="absolute left-0 top-0 h-full w-[2px] rounded-l-xl bg-transparent group-hover:bg-green-400/90 group-hover:w-[3px] transition-all duration-200 ease-out" />

              <div className={['grid grid-cols-[auto,1fr,auto] items-start gap-3 px-3 sm:px-4', padY].join(' ')}>
                {selectable ? (
                  <div className="pt-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isChecked}
                      onChange={() => toggleRow(r.url)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${r.title || r.url}`}
                    />
                  </div>
                ) : (
                  <div />
                )}

                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`font-medium text-gray-900 hover:underline ${titleSize} leading-snug group/title`}
                      title={r.title || r.url}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.title || r.url}
                    </a>
                    <ExternalIcon className="mt-[2px] h-3.5 w-3.5 text-gray-400 opacity-0 transition-opacity group-hover/title:opacity-100" />
                  </div>

                  <div className="mt-1 inline-flex items-center gap-2 text-xs text-gray-700">
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 px-2 py-0.5">
                      <img
                        src={favicon(r.url)}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                        }}
                      />
                      {h || 'unknown'}
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-500">{nicePath(r.url)}</span>
                    </span>

                    {dupN > 0 && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                        title="Other results were the same page with tracking parameters"
                      >
                        +{dupN} duplicate{dupN === 1 ? '' : 's'}
                      </span>
                    )}

                    {categoryCount > 0 && (
                      <span
                        className="ml-1 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                        title="This URL is assigned to local categories"
                      >
                        {categoryCount} categor{categoryCount === 1 ? 'y' : 'ies'}
                      </span>
                    )}
                  </div>

                  {r.snippet && (
                    <p className="mt-2 text-[13.5px] leading-6 text-gray-700 line-clamp-3">{r.snippet}</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                  {!isSaved ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        saveSingle(r);
                      }}
                      disabled={rowSaving === r.url}
                      className="btn-primary px-3 py-1.5 rounded-full"
                      title="Save URL"
                    >
                      {rowSaving === r.url ? (
                        'Saving…'
                      ) : (
                        <>
                          <SaveIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">Save</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-700"
                      >
                        <CheckIcon className="h-4 w-4" />
                        <span className="hidden sm:inline">Saved</span>
                      </span>

                      {categoryCount > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openRemoveFromCategory(r.url);
                          }}
                          className="btn-ghost px-3 py-1.5"
                          title="Remove from a category"
                        >
                          <TagOffIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">Un-tag</span>
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          unsaveUrl(r.url);
                        }}
                        disabled={rowSaving === r.url}
                        className="btn-ghost px-3 py-1.5"
                        title="Remove from Saved"
                      >
                        {rowSaving === r.url ? <SpinnerMini /> : <TrashIcon className="h-4 w-4" />}
                        <span className="hidden sm:inline">Unsave</span>
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openCapture('text', r.url, r.title || h || 'page');
                      }}
                      className="btn-ghost px-3 py-1.5"
                      title="Capture as text"
                    >
                      <DownloadIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">Text</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openCapture('pdf', r.url, r.title || h || 'page');
                      }}
                      className="btn-ghost px-3 py-1.5"
                      title="Capture as PDF"
                    >
                      <DownloadIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">PDF</span>
                    </button>

                    {captureBusy === r.url && (
                      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 text-neutral-700">
                        <SpinnerMini /> Capturing…
                      </span>
                    )}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyUrl(r.url);
                    }}
                    className="btn-ghost px-3 py-1.5"
                    title="Copy URL"
                  >
                    <CopyIcon className="h-4 w-4" />
                    <span className="hidden sm:inline">Copy</span>
                  </button>
                </div>
              </div>
            </StaggerItem>
          );
        })}

        {results.length > 0 && filtered.length === 0 && (
          <li className="rounded-xl border border-dashed border-gray-300 bg-white/60 p-10 text-center">
            <div className="text-lg font-semibold text-gray-900">No matches</div>
            <div className="text-gray-600">Your filters removed all results. Try clearing filters.</div>
            <button
              type="button"
              className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </li>
        )}
      </StaggerList>

      {/* Save-to-category modal */}
      <CollectionPickerModal
        isOpen={collectionPickerOpen}
        title="Save to category"
        collections={collections}
        onCancel={onPickCancel}
        onConfirm={onPickConfirm}
        onCreate={(name) => {
          createCollection(name);
          setCollections(getCollections());
        }}
      />

      {/* Remove-from-category modal */}
      <CollectionPickerModal
        isOpen={removePickerOpen}
        title="Remove from category"
        collections={removeCollectionsForTarget}
        onCancel={onRemoveCancel}
        onConfirm={onRemoveConfirm}
      />

      <FolderPickerModal
        open={pickerOpen}
        suggestedName={
          pickerMode === 'pdf'
            ? `${(pickerTarget.title || host(pickerTarget.url) || 'page').slice(0, 60)}.pdf`
            : `${(pickerTarget.title || host(pickerTarget.url) || 'page').slice(0, 60)}.txt`
        }
        mode={pickerMode}
        onCancel={() => setPickerOpen(false)}
        onConfirm={onConfirmCapture}
      />
    </div>
  );
};

export default ResultsTable;

/* ---------------- tiny svg icons ---------------- */

function ExternalIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z"
      />
    </svg>
  );
}

function SaveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-2 6H7V7h8v2Z"
      />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="m9 16.2-3.5-3.6L4 14l5 5 11-11-1.5-1.5L9 16.2Z" />
    </svg>
  );
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
      />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v9H7V9Z"
      />
    </svg>
  );
}

function TagOffIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M21 10.41V6a2 2 0 0 0-2-2h-4.41l-1.83-1.83A2 2 0 0 0 11.34 2H6a2 2 0 0 0-2 2v5.34a2 2 0 0 0 .59 1.42l9.24 9.24a2 2 0 0 0 2.83 0l3.34-3.34-1.41-1.41-3.34 3.34L6 9.34V4h5.34l1.83 1.83H19v4.17l2 2Zm-6.5-3.91a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Z"
      />
      <path fill="currentColor" d="M3 3l18 18-1.41 1.41L1.59 4.41 3 3Z" />
    </svg>
  );
}

function ListFilterIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M10 18v-2h10v2H10Zm-6-5v-2h16v2H4Zm3-5V6h13v2H7Z" />
    </svg>
  );
}

function SpinnerMini() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none" />
    </svg>
  );
}
