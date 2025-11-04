import React, { useMemo, useState } from 'react';
import CollectionPickerModal from '../savedurls/CollectionPickerModal';
import { getCollections, createCollection, addUrlToCollection } from '../../utils/collections';
import { SearchResult } from '../../types';
import { saveUrls, type SaveUrlsResponse, type SaveUrlsRequestRow, crawlSavePdf, crawlSaveText } from '../../lib/api';
import DownloadIcon from '../icons/DownloadIcon';
import FolderPickerModal from '../common/FolderPickerModal';
import { StaggerList, StaggerItem } from '../motion/StaggerList';

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

const host = (url: string) => { try { return new URL(url).host; } catch { return ''; } };
const nicePath = (url: string) => {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname || '/');
    const short = p.length > 48 ? p.slice(0, 45) + '…' : p || '/';
    return short + (u.search ? '…' : '');
  } catch { return url; }
};
const favicon = (url: string) => `https://icons.duckduckgo.com/ip3/${host(url)}.ico`;

function exportToCsv(rows: SearchResult[], filename = 'results') {
  const headers = ['title', 'url', 'snippet'];
  const esc = (v: any) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  };
  const body = rows.map(r => [r.title, r.url, r.snippet ?? ''].map(esc).join(',')).join('\r\n');
  const csv = [headers.join(','), body].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

type SortKey = 'original' | 'title' | 'domain';

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
  const [rowSaving] = useState<string | null>(null);
  const [rowSaved, setRowSaved] = useState<Record<string, boolean>>({});
  const [sortKeyLocal, setSortKeyLocal] = useState<SortKey>('original');
  const sortKey = (sortKeyProp ?? sortKeyLocal) as SortKey;
  const setSortKey = (onSortChange ?? setSortKeyLocal);

  // Collection picker state (new)
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collections, setCollections] = useState(getCollections());
  const [pendingRows, setPendingRows] = useState<SaveUrlsRequestRow[] | null>(null);

  // capture modal state (existing)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<'text' | 'pdf'>('text');
  const [pickerTarget, setPickerTarget] = useState<{ url: string; title: string }>({ url: '', title: '' });
  const [captureBusy, setCaptureBusy] = useState<string | null>(null);

  const allSelected = useMemo(
    () => results.length > 0 && selected.size === results.length,
    [results.length, selected]
  );

  const sorted = useMemo(() => {
    if (sortKey === 'original') return results;
    const clone = [...results];
    if (sortKey === 'title') clone.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    if (sortKey === 'domain') clone.sort((a, b) => host(a.url).localeCompare(host(b.url)));
    return clone;
  }, [results, sortKey]);

  const toggleAll = () => {
    if (onToggleAll) return onToggleAll();
    if (allSelected) setLocalSelected(new Set());
    else setLocalSelected(new Set(results.map(r => r.url)));
  };
  const toggleRow = (url: string) => {
    if (onToggleRow) return onToggleRow(url);
    const next = new Set(localSelected);
    next.has(url) ? next.delete(url) : next.add(url);
    setLocalSelected(next);
  };

  // --- Updated: open category picker first, then save + assign ---
  const saveSelected = async () => {
    if (selected.size === 0) return;
    const rows: SaveUrlsRequestRow[] = results
      .filter(r => selected.has(r.url))
      .map(r => ({ url: r.url, title: r.title ?? r.url, snippet: r.snippet ?? '' }));
    if (rows.length === 0) return;
    setPendingRows(rows);
    setCollectionPickerOpen(true);
  };

  const saveSingle = async (r: SearchResult) => {
    if (rowSaved[r.url]) return;
    const rows: SaveUrlsRequestRow[] = [{ url: r.url, title: r.title ?? r.url, snippet: r.snippet ?? '' }];
    setPendingRows(rows);
    setCollectionPickerOpen(true);
  };

  // Category picker handlers
  const onPickCancel = () => {
    setCollectionPickerOpen(false);
    setPendingRows(null);
  };

  const onPickConfirm = async (collectionId: string) => {
    if (!pendingRows) return;
    setCollectionPickerOpen(false);
    setIsSaving(true);
    try {
      const res: SaveUrlsResponse = await saveUrls(pendingRows);
      const mark: Record<string, boolean> = {};
      pendingRows.forEach(r => {
        mark[r.url] = true;
        addUrlToCollection(collectionId, r.url);
      });
      setRowSaved(prev => ({ ...prev, ...mark }));
      alert(`✅ Added: ${res.added}  •  Skipped: ${res.skipped}`);
    } catch (e: any) {
      alert(`❌ Failed to save URLs: ${e?.message ?? 'Unknown error'}`);
    } finally {
      setIsSaving(false);
      setPendingRows(null);
    }
  };

  const exportSelected = () => {
    const rows = selected.size > 0 ? results.filter(r => selected.has(r.url)) : results;
    exportToCsv(rows, selected.size > 0 ? 'results_selected' : 'results_all');
  };

  const copyUrl = async (url: string) => {
    try { await navigator.clipboard.writeText(url); } catch {}
  };

  // open modal to choose destination + filename (existing capture flow)
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
      // mark as saved (visual cue like others)
      setRowSaved(prev => ({ ...prev, [url]: true }));
    } catch (e) {
      console.error(e);
      alert('Capture failed. See console for details.');
    } finally {
      setCaptureBusy(null);
    }
  };

  // Comfort density only
  const padY = 'py-4';
  const titleSize = 'text-[16px]';

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-600">
            {results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'No results'}
            {selectable && selected.size > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                {selected.size} selected
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
          {onClear && (
            <button
              onClick={() => onClear?.()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-red-200 bg-red-50 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 transition"
              title="Clear searches"
            >
              Clear searches
            </button>
          )}
          </div>
          
          {selectable && selected.size > 0 && (
            <button
              type="button"
              className="md3-btn md3-btn--tonal px-3 py-1 rounded-full"
              onClick={() => {
                const text = Array.from(selected).join('\n');
                navigator.clipboard?.writeText(text).catch(() => {});
              }}
              title="Copy selected URLs"
            >
              Copy URLs
            </button>
          )}

          <div className="hidden sm:flex items-center gap-2 text-sm">
            <ListFilterIcon className="h-4 w-4 text-gray-500" />
            {/* Show internal sort UI only when uncontrolled */}
            {!(sortKeyProp && onSortChange) && (
              <div className="flex items-center gap-2">
                <ListFilterIcon className="h-4 w-4 text-gray-500" />
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40 dark:bg-gray-800 dark:border-gray-700"
                  aria-label="Sort results"
                >
                  <option value="original">Original order</option>
                  <option value="title">Title</option>
                  <option value="domain">Domain</option>
                </select>
              </div>
            )}
          </div>

          {selectable && results.length > 0 && (
            <label className="ml-1 flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
          )}
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

      {/* Results list (card rows) */}
      <StaggerList as="ul" className="space-y-2 m-0 p-0">
        {sorted.map((r) => {
          const h = host(r.url);
          const isChecked = selected.has(r.url);
          const isSaved = rowSaved[r.url];

          return (
            <StaggerItem
              as="li"
              key={r.url}
              onClick={(e: React.MouseEvent) => {
              const t = e.target as HTMLElement;
              if (t.closest('button, a, input')) return;
              window.open(r.url, '_blank', 'noopener,noreferrer');
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('button, a, input')) {
                  e.preventDefault();
                  window.open(r.url, '_blank', 'noopener,noreferrer');
                }
              }}
              role="link"
              tabIndex={0}
              className={[
                'group relative rounded-xl border border-gray-200 bg-white',
                'hover:shadow-soft hover:ring-1 hover:ring-green-200 transition-all cursor-pointer',
              ].join(' ')}
            >
              {/* left accent on hover */}
              <span className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-transparent group-hover:bg-green-400" />

              <div className={['grid grid-cols-[auto,1fr,auto] items-start gap-3 px-3 sm:px-4', padY].join(' ')}>
                {/* checkbox (optional) */}
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
                ) : <div />}

                {/* main content */}
                <div className="min-w-0">
                  {/* title row */}
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

                  {/* domain chip */}
                  <div className="mt-1 inline-flex items-center gap-2 text-xs text-gray-700">
                    <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/90 px-2 py-0.5">
                      <img
                        src={favicon(r.url)}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm"
                        referrerPolicy="no-referrer"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                      />
                      {h || 'unknown'}
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-500">{nicePath(r.url)}</span>
                    </span>
                  </div>

                  {/* snippet */}
                  {r.snippet && (
                    <p className="mt-2 text-[13.5px] leading-6 text-gray-700 line-clamp-3">
                      {r.snippet}
                    </p>
                  )}
                </div>

                {/* actions (Save / Capture / Copy) */}
                <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                  {!isSaved ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); saveSingle(r); }}
                      disabled={rowSaving === r.url}
                      className="btn-primary px-3 py-1.5 rounded-full"
                      title="Save URL"
                    >
                      {rowSaving === r.url ? 'Saving…' : (
                        <>
                          <SaveIcon className="h-4 w-4" />
                          <span className="hidden sm:inline">Save</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <span
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-700"
                    >
                      <CheckIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">Saved</span>
                    </span>
                  )}

                  {/* Capture as Text / PDF */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); openCapture('text', r.url, r.title || h || 'page'); }}
                      className="btn-ghost px-3 py-1.5"
                      title="Capture as text"
                    >
                      <DownloadIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">Text</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openCapture('pdf', r.url, r.title || h || 'page'); }}
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
                    onClick={(e) => { e.stopPropagation(); copyUrl(r.url); }}
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

        {results.length === 0 && (
          <li className="rounded-xl border border-dashed border-gray-300 bg-white/60 p-10 text-center">
            <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
              <SearchGlassIcon className="h-5 w-5 text-green-700" />
            </div>
            <div className="text-lg font-semibold text-gray-900">No results yet</div>
            <div className="text-gray-600">Try a broader query or adjust your filters.</div>
          </li>
        )}
      </StaggerList>

      {/* Category picker for Save actions */}
      <CollectionPickerModal
        isOpen={collectionPickerOpen}
        collections={collections}
        onCancel={onPickCancel}
        onConfirm={onPickConfirm}
        onCreate={(name) => { createCollection(name); setCollections(getCollections()); }}
      />

      {/* Folder picker modal (existing capture flow) */}
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
      <path fill="currentColor" d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z"/>
    </svg>
  );
}
function SaveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M17 3H5a2 2 0 0 0-2 2v14l4-4h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm-2 6H7V7h8v2Z"/>
    </svg>
  );
}
function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="m9 16.2-3.5-3.6L4 14l5 5 11-11-1.5-1.5L9 16.2Z"/>
    </svg>
  );
}
function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14h13a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/>
    </svg>
  );
}
function ListFilterIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M10 18v-2h10v2H10Zm-6-5v-2h16v2H4Zm3-5V6h13v2H7Z"/>
    </svg>
  );
}
function SearchGlassIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79L20 21.5 21.5 20l-6-6Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/>
    </svg>
  );
}
function SpinnerMini() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".2"></circle>
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none"></path>
    </svg>
  );
}
