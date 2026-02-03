import React, { useEffect, useRef, useState } from 'react';
import { FileDetail } from '../../lib/types';
import PdfCanvas from '../common/PdfCanvas';
import { formatBytes, formatDate } from '../../utils/fileHelpers';
import FavoriteButton from "../common/FavoriteButton";
import AITagButton from "../common/AITagButton";

type Props = {
  file: FileDetail | null | undefined;
  isOpen: boolean;
  onClose: () => void;
  onDownload: (file: FileDetail) => void;
  onToggleFavorite: (file: FileDetail) => void;
  onTagUpdate?: (fileId: string, newTags: string[]) => void;
  autoFocusTags?: boolean;
};

const PreviewModal: React.FC<Props> = ({
  file,
  isOpen,
  onClose,
  onDownload,
  onToggleFavorite,
  onTagUpdate,
  autoFocusTags = false,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [hadError, setHadError] = useState<string | null>(null);

  // image zoom state
  const [fitMode, setFitMode] = useState<'contain' | 'actual'>('contain');
  const [zoom, setZoom] = useState<number>(1);

  // PDF pagination
  const [pdfPages, setPdfPages] = useState<number>(0);
  const [pdfPage, setPdfPage] = useState<number>(1);

  const f = file ?? null;

  // Refs for focusing/scrolling the tag area
const tagInputRef = useRef<HTMLInputElement | null>(null);
const tagSectionRef = useRef<HTMLDivElement | null>(null);

useEffect(() => {
  if (!isOpen || !autoFocusTags) return;
  // small delay to ensure the modal contents rendered
  const t = setTimeout(() => {
    tagSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tagInputRef.current?.focus();
  }, 50);
  return () => clearTimeout(t);
}, [isOpen, autoFocusTags]);


// ---- Tag editor (like SavedUrlDetailModal) ----
const [localTags, setLocalTags] = useState<string[]>(f?.tags || []);
const [newTagInput, setNewTagInput] = useState<string>("");

useEffect(() => {
  setLocalTags(f?.tags || []);
}, [f?.id, f?.tags]);

const persistTags = async (next: string[]) => {
  onTagUpdate?.(String(f!.id), next);
  if (!onTagUpdate) {
    try {
      await fetch(`/api/files/${encodeURIComponent(String(f!.id))}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
    } catch (e) {
      console.error("Failed to update tags", e);
    }
  }
};

const addTag = () => {
  const t = newTagInput.trim();
  if (!t || localTags.includes(t)) return;
  const next = [...localTags, t];
  setLocalTags(next);
  setNewTagInput("");
  if (f) persistTags(next);
};

const removeTag = (t: string) => {
  const next = localTags.filter(x => x !== t);
  setLocalTags(next);
  if (f) persistTags(next);
};


  const rawMime = (f?.mimeType || '').toLowerCase();
  const mimeBase = rawMime.split(';')[0]?.trim() || '';
  const title = ((f as any)?.title as string) || '';
  const previewUrl = f ? `/api/files/${f.id}/preview` : '';

  const isImage = mimeBase.startsWith('image/');
  const isPDF   = mimeBase === 'application/pdf';
  const isText  = mimeBase.startsWith('text/') || mimeBase === 'application/json' || mimeBase.endsWith('+json');
  const [textContent, setTextContent] = useState<string>('');

  // reset state when file changes
  useEffect(() => {
    setIsLoading(true);
    setHadError(null);
    setFitMode('contain');
    setZoom(1);
    setTextContent('');
    setPdfPages(0);
    setPdfPage(1);
  }, [f?.id]);

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dialogRef.current && e.target instanceof Node && !dialogRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [isOpen, onClose]);

  // Focus a control when opening
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => firstFocusableRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Fetch text content when needed
  useEffect(() => {
    if (!isOpen || !f || !isText || !previewUrl) return;
    setIsLoading(true);
    setHadError(null);
    fetch(previewUrl, {
      headers: { Accept: 'text/plain, text/*;q=0.9, application/json;q=0.8, */*;q=0.1' },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((txt) => {
        setTextContent(txt);
        setIsLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setHadError('text');
        setIsLoading(false);
      });
  }, [isOpen, f, isText, previewUrl]);

  // image style (contain vs actual with zoom)
  const imageStyle: React.CSSProperties =
    fitMode === 'contain'
      ? { maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }
      : { transform: `scale(${zoom})`, transformOrigin: 'top left', display: 'inline-block' };

  const uploadedRaw =
    (f ? (f as any).uploadDate : null) ??
    (f ? (f as any).createdAt : null) ??
    null;

  const metaRows: Array<[string, string]> = [
    ['Title', title || (f?.id || '')],
    ['Type', rawMime || '—'],
    ['Size', typeof f?.size === 'number' ? formatBytes(f.size) : '—'],
    ['Uploaded', uploadedRaw ? formatDate(uploadedRaw) : '—'],
  ];

  const canPaginate = isPDF && !hadError && pdfPages > 1;
  const goPrev = () => setPdfPage((p) => Math.max(1, p - 1));
  const goNext = () => setPdfPage((p) => Math.min(pdfPages || p, p + 1));

  return !isOpen || !f ? null : (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" />
      <div
        ref={dialogRef}
        className="relative w-[95vw] max-w-5xl bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${title}`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b dark:border-neutral-800 flex items-center justify-between gap-2">
          <div className="truncate">
            <div className="text-xs text-neutral-500">Preview</div>
            <div className="font-semibold truncate">{title || f.id}</div>
          </div>

          <div className="flex items-center gap-2">
            {/* PDF Pagination controls in header */}
            {isPDF && (
              <div className="hidden sm:flex items-center gap-2 mr-2">
                <button
                  className="px-2 py-1 rounded border dark:border-neutral-800 disabled:opacity-50"
                  onClick={goPrev}
                  disabled={!canPaginate || pdfPage <= 1}
                  title="Previous page"
                >
                  Prev
                </button>
                <span className="text-sm text-neutral-600 dark:text-neutral-400 min-w-[90px] text-center">
                  Page {Math.min(pdfPage, Math.max(1, pdfPages || 1))} / {pdfPages || '—'}
                </span>
                <button
                  className="px-2 py-1 rounded border dark:border-neutral-800 disabled:opacity-50"
                  onClick={goNext}
                  disabled={!canPaginate || pdfPage >= pdfPages}
                  title="Next page"
                >
                  Next
                </button>
              </div>
            )}

            {/* Favorite */}
            <FavoriteButton
              isOn={!!f.isFavorited}
              count={f.favoritesCount ?? undefined}
              size="sm"
              variant="ghost"
              onToggle={() => onToggleFavorite(f)}
              className="mr-1"
            />

            <button
              ref={firstFocusableRef}
              className="px-3 py-1.5 rounded-lg border dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              onClick={() => onDownload(f)}
              title="Download"
            >
              Download
            </button>
            <button
              className="px-3 py-1.5 rounded-lg border dark:border-neutral-800 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              onClick={onClose}
              title="Close"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 max-h-[70vh] overflow-auto bg-neutral-50/40 dark:bg-neutral-900">
          {/* Loading */}
          {isLoading && !hadError && (
            <div className="h-[65vh] grid place-items-center">
              <div className="w-24 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                <div className="h-full w-1/2 animate-pulse" />
              </div>
            </div>
          )}

          {/* Generic error (suppressed for PDF so the fallback can render) */}
          {hadError && hadError !== 'pdf' && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
              Failed to load preview. You can still use “Download”.
            </div>
          )}

          {/* PDF via pdf.js (controlled page) */}
          {!hadError && isPDF && (
            <PdfCanvas
              url={previewUrl}
              page={pdfPage}
              onReady={(pages) => { setPdfPages(pages); setIsLoading(false); }}
              onError={() => { setHadError('pdf'); setIsLoading(false); }}
            />
          )}

          {/* PDF fallback (browser viewer) */}
          {hadError === 'pdf' && (
            <div className="w-full">
              <iframe
                src={previewUrl + '#view=FitH'}
                title={title || 'PDF'}
                className="w-full h-[70vh] rounded-xl border dark:border-neutral-800"
              />
              <div className="mt-2 text-sm text-neutral-500">
                Viewer fallback shown. You can also use the Download button above.
              </div>
            </div>
          )}

          {/* Image */}
          {!hadError && isImage && (
            <div className="w-full">
              <div className={fitMode === 'actual' ? 'min-h-[65vh]' : ''}>
                <img
                  src={previewUrl}
                  alt={title}
                  style={imageStyle}
                  className={fitMode === 'contain' ? 'rounded-xl shadow-sm' : ''}
                  onLoad={() => setIsLoading(false)}
                  onError={() => setHadError('image')}
                />
              </div>
            </div>
          )}

          {/* Text */}
          {!hadError && isText && (
            <div className="w-full h-[65vh] rounded-xl overflow-auto border dark:border-neutral-800 bg-white">
              {!isLoading && (
                <pre className="p-4 text-sm leading-6 whitespace-pre-wrap break-words font-mono">
                  {textContent}
                </pre>
              )}
            </div>
          )}

          {/* Tags - Editable (like SavedUrlDetailModal) */}
          <div ref={tagSectionRef} className="mt-4">
          <div className="text-sm text-neutral-500">Tags</div>
          <div className="flex flex-wrap gap-2 mt-2">
          {localTags.map(t => (
          <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 dark:bg-indigo-900/40 rounded-full">
          <span>{t}</span>
          <button
          type="button"
          aria-label={`Remove tag ${t}`}
          className="text-[10px] opacity-70 hover:opacity-100"
          onClick={() => removeTag(t)}
          >
          ×
        </button>
        </span>
        ))}
        </div>
        
        <div className="mt-2 flex items-center gap-2">
        <input
            ref={tagInputRef} 
            type="text"
            placeholder="Add tag"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTag(); }}
            className="input h-8 w-48 rounded-lg shadow-sm focus:ring-2 focus:ring-brand-primary/40"
        />
        <button
        type="button"
        onClick={addTag}
        className="text-xs px-2 py-1 border rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
        >
       Add
      </button>
      {f && (
      <AITagButton
        kind="file"
        id={String(f.id)}
        onMerge={(aiTags) => {
          const merged = Array.from(new Set([...(f.tags || []), ...aiTags]));
          setLocalTags(merged);
          persistTags(merged);
        }}
      />
      )}
      </div>
    </div>


    {/* Metadata (always) */}
    <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        {metaRows.map(([k, v]) => (
              <div key={k}>
                <div className="text-neutral-500">{k}</div>
                <div className="font-medium break-words">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreviewModal;
