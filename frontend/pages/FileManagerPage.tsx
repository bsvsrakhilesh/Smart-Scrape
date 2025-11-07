import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Filter, ChevronLeft, ChevronRight, X, Plus, File, Database } from 'lucide-react';
import SearchFilter, { FilterState } from '../components/filemanager/SearchFilter';
import FileList from '../components/filemanager/FileList';
import AdvancedFileUpload from '../components/filemanager/AdvancedFileUpload';
import { useToast } from '../components/providers/Toast';
import { FileItem, FileDetail } from '../types';
import { formatBytes } from '../utils/fileHelpers';
import { createFolder, getFolder, toggleFileFavorite, toFileItem, type BackendStoredFile, duplicateFile, moveFile, getJob, startFileTagJob, listFolders } from '../lib/api';
import BulkActionBar from '../components/common/BulkActionBar';
import ExplorerCommandBar from "../components/filemanager/ExplorerCommandBar";
import ExplorerBreadcrumbs from "../components/filemanager/ExplorerBreadcrumbs";
import ExplorerPreviewModal from "../components/filemanager/ExplorerPreviewModal";
import PropertiesModal from "../components/filemanager/PropertiesModal";
import FileSidebar from "../components/filemanager/FileSidebar";
import PageTransition from '../components/motion/PageTransition';
import { useExplorerHistory } from '../hooks/useExplorerHistory';
import WindowsGrid from '../components/filemanager/WindowsGrid';

const DEFAULT_PAGE_SIZE = 30;
// --- layout persistence helpers ---
const getLS = <T,>(k: string, v: T) => {
  try { return JSON.parse(localStorage.getItem(k) || '') as T; } catch { return v; }
};
const setLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

type Layout = 'large' | 'icons' | 'details' | 'list';
type SortKey = 'name' | 'date' | 'type' | 'size';
type SortDir = 'asc' | 'desc';

/** Small themed buttons with motion */
const ToolbarButton: React.FC<
  React.ComponentProps<typeof motion.button> & { variant?: 'primary' | 'outline' | 'ghost' }
> = ({ variant = 'outline', className = '', children, ...rest }) => {
  const base = variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : 'btn-outline';
  return (
    <motion.button
      className={`${base} whitespace-nowrap ${className}`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
};

const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({
  open,
  onClose,
  title,
  children,
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="px-5 py-4 border-b dark:border-neutral-800 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="btn-ghost text-sm px-3" onClick={onClose}>Close</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

export default function FileManagerPage() {
  const { notify } = useToast();

  // layout / filters / pagination
  const [layout, setLayout] = useState<Layout>(() => getLS<Layout>('fm:layout', 'icons'));
  useEffect(() => setLS('fm:layout', layout), [layout]);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [filters, setFilters] = useState<FilterState>({
    query: '',
    fileTypes: [],
    tags: [],
    visibility: 'all',
    favoritesOnly: false,
  });
  const applyQuickFilter = useCallback((tag: string) => {
    setFilters(f => {
     switch (tag) {
         case 'All':        return { ...f, favoritesOnly: false, fileTypes: [], query: '', minSize: undefined, recentDays: undefined };
         case 'Images':     return { ...f, fileTypes: ['image/'] };
         case 'Docs':       return { ...f, fileTypes: ['application/pdf','text/plain','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument'] };
         case 'Videos':     return { ...f, fileTypes: ['video/'] };
         case 'Archives':   return { ...f, fileTypes: ['application/zip','application/x-7z-compressed','application/x-rar-compressed'] };
         case 'Favorites':  return { ...f, favoritesOnly: true };
         case 'Recent':     return { ...f, recentDays: 14 };
         case '>100MB':     return { ...f, minSize: 100 * 1024 * 1024 };
         default:           return f;
       }
     });
    setPage(1);
   }, []);

  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => getLS('fm:density', 'comfortable'));
  useEffect(() => setLS('fm:density', density), [density]);

  // ---------- hotkeys overlay ----------
  const [showHotkeys, setShowHotkeys] = useState(false);

  useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === '?') setShowHotkeys(v => !v);
    if (e.key === 'Escape') setShowHotkeys(false);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
  }, []);

  // folders / breadcrumb
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const { initialFolderId } =
  useExplorerHistory(currentFolderId ?? null, {
    onPopNavigate: async (fid) => {
      // load folder when user presses Back/Forward
      setCurrentFolderId(fid ?? undefined);
      setPage(1);
      const bc = await buildBreadcrumb(fid ?? undefined);
      setBreadcrumb(bc);
    },
  });

// On first mount, if URL has ?folder=..., adopt it
useEffect(() => {
  if (initialFolderId && initialFolderId !== currentFolderId) {
    setCurrentFolderId(initialFolderId);
    // optionally trigger your existing loader to rebuild breadcrumb + files
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  const [breadcrumb, setBreadcrumb] = useState<{ id?: string; name: string }[]>([{ name: 'Home' }]);

  // navigation history
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // properties modal
  const [propertiesFile, setPropertiesFile] = useState<FileItem | null>(null);
  const [showProperties, setShowProperties] = useState<boolean>(false);


  // data
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);

  // tags
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [focusTagsOnOpen, setFocusTagsOnOpen] = useState(false);

  // preview + upload modal
  const [selectedPreview, setSelectedPreview] = useState<FileDetail | null>(null);
  const [showUpload, setShowUpload] = useState<boolean>(false);

  // refresh flag
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'files' | 'storage'>('files');
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  // Drag state for UI feedback
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Apply dragging class to body for global UI feedback
  useEffect(() => {
    if (isDragging) {
      document.body.classList.add('dragging');
    } else {
      document.body.classList.remove('dragging');
    }
    return () => document.body.classList.remove('dragging');
  }, [isDragging]);

  // Selection + clipboard for cut/copy/paste
  const [selected, setSelected] = useState<FileItem[]>([]);
  const selectedIds = useMemo(() => new Set(selected.map(f => f.id)), [selected]);
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'cut'; files: FileItem[] } | null>(null);

  // ---- Select-all helper (shim) ----
  const handleSelectAll = () => {
  if (selected.length === allFiles.length && allFiles.length > 0) {
    handleSelectionChangeByIds([]);           // clear
  } else {
    handleSelectionChangeByIds(allFiles.map(f => f.id)); // select all
  }
  };

  const handleSelectionChangeByIds = (ids?: string[]) => {
  const set = new Set(ids ?? []);
  setSelected(allFiles.filter(f => set.has(f.id)));
};
const handleRenameById = async (id: string, nextName: string) => {
  const file = allFiles.find(f => f.id === id);
  if (file) await handleRename(file, nextName);
};

  // Favorites toggle handler
  const handleToggleFavorite = useCallback(
    async (file: FileItem) => {
      const prev = !!file.isFavorited;

      // optimistic: flip immediately
      setAllFiles((list) =>
        list.map((f) =>
          f.id === file.id
            ? {
                ...f,
                isFavorited: !prev,
                favoritesCount: Math.max(
                  0,
                  (f.favoritesCount ?? 0) + (prev ? -1 : 1)
                ),
              }
            : f
        )
      );
      if (selectedPreview?.id === file.id) {
        setSelectedPreview((p) =>
          p
            ? {
                ...p,
                isFavorited: !prev,
                favoritesCount: Math.max(
                  0,
                  (p.favoritesCount ?? 0) + (prev ? -1 : 1)
                ),
              }
            : p
        );
      }

      try {
        const updated = await toggleFileFavorite(file.id, !prev);
        // sync with server response
        setAllFiles((list) =>
          list.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  isFavorited: updated.isFavorited,
                  favoritesCount: updated.favoritesCount,
                }
              : f
          )
        );
        if (selectedPreview?.id === file.id) {
          setSelectedPreview((p) =>
            p
              ? {
                  ...p,
                  isFavorited: updated.isFavorited,
                  favoritesCount: updated.favoritesCount,
                }
              : p
          );
        }
        notify(
          `${file.title} ${
            updated.isFavorited ? "added to" : "removed from"
          } favorites`
        );
      } catch (err: any) {
        // revert
        setAllFiles((list) =>
          list.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  isFavorited: prev,
                  favoritesCount: Math.max(
                    0,
                    (f.favoritesCount ?? 0) + (prev ? 1 : -1)
                  ),
                }
              : f
          )
        );
        if (selectedPreview?.id === file.id) {
          setSelectedPreview((p) =>
            p
              ? {
                  ...p,
                  isFavorited: prev,
                  favoritesCount: Math.max(
                    0,
                    (p.favoritesCount ?? 0) + (prev ? 1 : -1)
                  ),
                }
              : p
          );
        }
        notify("Could not update favorite", "error");
      }
    },
    [notify, selectedPreview]
  );

  // ------- Breadcrumb: build from authoritative parent chain -------
  const folderCache = useRef(new Map<string, { id: string; name: string; parentId: string | null }>());

  const fetchFolderMeta = useCallback(async (id: string) => {
    const cached = folderCache.current.get(id);
    if (cached) return cached;
    try {
      const meta = await getFolder(id); // expected: { id, name, parentId }
      const norm = { id, name: meta?.name ?? 'Folder', parentId: meta?.parentId ?? null };
      folderCache.current.set(id, norm);
      return norm;
    } catch {
      const norm = { id, name: 'Folder', parentId: null };
      folderCache.current.set(id, norm);
      return norm;
    }
  }, []);

  const buildBreadcrumb = useCallback(async (id?: string) => {
    if (!id) return [{ name: 'Home' }];
    const chain: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = id;

    for (let i = 0; i < 50 && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const meta = await fetchFolderMeta(cur);
      chain.push({ id: meta.id, name: meta.name });
      cur = meta.parentId || undefined;
    }
    chain.reverse();
    return [{ name: 'Home' }, ...chain];
  }, [fetchFolderMeta]);

  // ------- Data fetch -------
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.fileTypes.length) params.set('mimeTypes', filters.fileTypes.join(','));
    if (filters.tags.length) params.set('tags', filters.tags.join(','));
    if (filters.visibility && filters.visibility !== 'all') params.set('visibility', String(filters.visibility));
    if (filters.favoritesOnly) params.set('favoritesOnly', 'true');
    if (currentFolderId) params.set('folderId', String(currentFolderId));
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    // Map frontend sortKey to backend expected values
    const backendSortKey = sortKey === 'date' ? 'createdAt' : sortKey;
    params.set('sortKey', backendSortKey);
    params.set('sortOrder', sortDir);

    (async () => {
      try {
        // Build the files query as you already do
        const resFiles = await fetch(`/api/files?${params.toString()}`);
        if (!resFiles.ok) throw new Error(`Failed to fetch files (${resFiles.status})`);
        const data = await resFiles.json();
    
        // NEW: fetch child folders for the selected folder (or root)
        const folderRows = await listFolders(currentFolderId ?? 'root');
    
        // Map files to FileItem (existing)
        const fileRows: BackendStoredFile[] = Array.isArray(data)
          ? data
          : (Array.isArray(data.items) ? data.items : []);
        const fileItems: FileItem[] = fileRows.map(toFileItem);
    
        // Map folders to FileItem-like rows so FileList can render them
        const folderItems: FileItem[] = folderRows.map(fr => ({
          id: `folder:${fr.id}`,
          title: fr.name,
          description: '',
          uploader: { id: 'system', name: '—' },
          uploadDate: fr.createdAt,
          size: 0,
          mimeType: 'folder',           // <-- key: lets us treat it differently
          tags: [],
          visibility: 'private',
        }));
    
        if (!cancelled) {
          // Folders first, then files (Windows Explorer behavior)
          const items = [...folderItems, ...fileItems];
          setAllFiles(items);
    
          // Total counts include folders
          const totalCount =
            typeof data.total === 'number'
              ? data.total + folderItems.length
              : items.length;
          setTotal(totalCount);
    
          // Bytes: folders count as 0
          const bytes = fileItems.reduce((acc, f) => acc + (typeof f.size === 'number' ? f.size : 0), 0);
          setTotalBytes(bytes);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load');
          setAllFiles([]);
          setTotal(0);
          setTotalBytes(0);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.query,
    filters.fileTypes.join(','),
    filters.tags.join(','),
    filters.visibility,
    filters.favoritesOnly,
    page,
    pageSize,
    currentFolderId,
    sortKey,
    sortDir,
    refreshToken,
  ]);

  // load available tags (for filters + editor)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tags');
        if (!res.ok) throw new Error('Failed to load tags');
        const data = await res.json() as { label: string; count: number }[];
        if (!cancelled) setAvailableTags(data.map(d => d.label));
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [refreshToken]);

  // ------- Actions -------
  const handleOpenPreview = useCallback((f: FileDetail, opts?: { focusTags?: boolean }) => {
  setFocusTagsOnOpen(!!opts?.focusTags);
  setSelectedPreview(f);
  // reset the flag once modal mounts (prevents sticking true for next open)
  setTimeout(() => setFocusTagsOnOpen(false), 0);
  }, []);

  const handleEditTagsInPreview = useCallback((file: FileDetail) => {
  handleOpenPreview(file, { focusTags: true });
  }, [handleOpenPreview]);

  const handleDownload = (f: FileDetail | FileItem) => {
    window.open(`/api/files/${f.id}/download`, '_blank');
  };
  const handleDownloadItem = (f: FileItem) => handleDownload(f);

  const handleDelete = async (file: FileItem) => {
    if (!confirm(`Delete ${file.title ?? 'this file'}?`)) return;
    try {
      const res = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      notify('File deleted', 'success');
      refresh();
    } catch (e: any) {
      notify(e?.message || 'Delete failed', 'error');
    }
  };

  const handleNewFolder = async () => {
    const name = prompt('New folder name');
    if (!name) return;
    try {
      await createFolder(name, currentFolderId);
      notify('Folder created', 'success');
      const bc = await buildBreadcrumb(currentFolderId);
      setBreadcrumb(bc);
      refresh();
    } catch (e: any) {
      notify(e?.message || 'Failed to create folder', 'error');
    }
  };

  // Optimistic insert after upload if it matches current filters/folder
  const handleUploaded = useCallback(
    (nf: FileItem) => {
      notify(`Uploaded ${nf.title}`, 'success');

      const matchesFolder = !currentFolderId || (nf as any).folderId === currentFolderId;
      const matchesVisibility =
        !filters.visibility || filters.visibility === 'all' || nf.visibility === filters.visibility;
      const matchesQuery = !filters.query || nf.title.toLowerCase().includes(filters.query.toLowerCase());
      const matchesType =
        !filters.fileTypes.length ||
        filters.fileTypes.some((mt) => nf.mimeType === mt || nf.mimeType.startsWith(mt));

      if (matchesFolder && matchesVisibility && matchesQuery && matchesType) {
        setAllFiles((prev: FileItem[]) => [nf, ...prev]);
        setTotal((t) => t + 1);
        setTotalBytes((b) => b + (typeof (nf as any).size === 'number' ? (nf as any).size : 0));
      } else {
        refresh();
      }
      setShowUpload(false);
    },
    [notify, currentFolderId, filters.visibility, filters.query, filters.fileTypes, refresh]
  );

  const handleRename = async (file: FileItem, newName?: string) => {
    const name = (newName ?? prompt('Rename to', file.title)) || '';
    if (!name || name === file.title) return;
    try {
      const res = await fetch(`/api/files/${file.id}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: name }),
      });
      if (!res.ok) throw new Error('Rename failed');
      notify('Renamed', 'success');
      refresh();
    } catch (e: any) {
      notify(e?.message || 'Rename failed', 'error');
    }
  };

  const handleCopy = useCallback((sel?: FileItem[]) => {
    const curr = sel && sel.length ? sel : selected;
    if (curr.length) setClipboard({ mode: 'copy', files: curr });
  }, [selected]);

  const handleCut = useCallback((sel?: FileItem[]) => {
    const curr = sel && sel.length ? sel : selected;
    if (curr.length) setClipboard({ mode: 'cut', files: curr });
  }, [selected]);

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    const ids = clipboard.files.map(f => f.id);
    try {
      if (clipboard.mode === 'copy') {
        await Promise.all(ids.map(id => duplicateFile(id, currentFolderId ?? null)));
        notify(`Copied ${ids.length} item(s)`, 'success');
      } else {
        await Promise.all(ids.map(id => moveFile(id, currentFolderId ?? null)));
        notify(`Moved ${ids.length} item(s)`, 'success');
      }
      refresh();
    } catch {
      notify('Paste failed', 'error');
    } finally {
      setClipboard(null);
    }
  }, [clipboard, currentFolderId, notify, refresh]);

  // Drag and drop handlers
  const handleDragStart = useCallback((ids: string[]) => {
    setIsDragging(true);
    console.log('Dragging files:', ids);
  }, []);

  const handleDragEnd = useCallback((ids: string[]) => {
    setIsDragging(false);
    console.log('Drag ended for files:', ids);
  }, []);

  const handleDrop = useCallback(async (ids: string[], targetFolderId: string | null) => {
    if (!ids.length) return;
    try {
      await Promise.all(ids.map(id => moveFile(id, targetFolderId)));
      notify(`Moved ${ids.length} item(s)`, 'success');
      refresh();
    } catch {
      notify('Move failed', 'error');
    }
  }, [notify, refresh]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  // ------- Navigation handlers  -------
  const onFolderSelect = useCallback(async (id?: string, folderName?: string) => {
    const folderId = id || '';
    // Update history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(folderId);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Optimistically cache folder metadata when caller provides a name
    // so buildBreadcrumb can pick it up immediately without an extra fetch.
    if (id && folderName) {
      folderCache.current.set(id, { id, name: folderName, parentId: currentFolderId ?? null });
    }

    setCurrentFolderId(id);
    setPage(1);
    const bc = await buildBreadcrumb(id);
    setBreadcrumb(bc);
  }, [buildBreadcrumb, history, historyIndex, currentFolderId]);

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const folderId = history[newIndex] || undefined;
      setHistoryIndex(newIndex);
      setCurrentFolderId(folderId);
      setPage(1);
      buildBreadcrumb(folderId).then(setBreadcrumb);
    }
  }, [history, historyIndex, buildBreadcrumb]);

  const handleForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const folderId = history[newIndex] || undefined;
      setHistoryIndex(newIndex);
      setCurrentFolderId(folderId);
      setPage(1);
      buildBreadcrumb(folderId).then(setBreadcrumb);
    }
  }, [history, historyIndex, buildBreadcrumb]);

  // Up navigation removed; use breadcrumbs / folder tree for moving up

  const onCrumbClick = useCallback(async (idx: number) => {
    const target = breadcrumb[idx];
    const bc = await buildBreadcrumb(target.id);
    setBreadcrumb(bc);
    setCurrentFolderId(target.id);
    setPage(1);
  }, [breadcrumb, buildBreadcrumb]);

    const onDeleteSelected = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected item(s)?`)) return;

    const backup = allFiles;
    setAllFiles(prev => prev.filter(f => !ids.includes(f.id)));
    setSelected([]);

    try {
      await Promise.all(ids.map(id =>
        fetch(`/api/files/${id}`, { method: 'DELETE' }).then(res => {
          if (!res.ok) throw new Error('Delete failed');
        })
      ));
      notify('Deleted', 'success');
      refresh();
    } catch (e: any) {
      setAllFiles(backup);
      notify(e?.message || 'Failed to delete some items', 'error');
    }
  }, [allFiles, notify, refresh]);

   // keyboard shortcut to toggle filters + core actions (safe shims)
  useEffect(() => {
  const isTyping = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const t = el.tagName.toLowerCase();
    return t === 'input' || t === 'textarea' || el.getAttribute('contenteditable') === 'true';
  };

  const onKey = (e: KeyboardEvent) => {
    // Focus search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      (document.getElementById('fm-search') as HTMLInputElement | null)?.focus();
      return;
    }

    if (isTyping()) return;

    // Delete selected
    if (e.key === 'Delete') {
      onDeleteSelected?.(selected.map(s => s.id));
      return;
    }

    // Select all
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      handleSelectAll();
      return;
    }

    // Backspace navigation (go up) removed to avoid accidental folder changes.

    // Clear selection
    if (e.key === 'Escape') {
      handleSelectionChangeByIds([]); // <-- ensure we pass []
      return;
    }
  };

  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
  }, [onDeleteSelected, handleSelectAll, handleSelectionChangeByIds, selected, allFiles]);

  // ---------- NEW: Bulk actions ----------
  const byIds = useCallback((ids: string[]) => {
    const set = new Set(ids);
    return allFiles.filter(f => set.has(f.id));
  }, [allFiles]);

  const handleUpdateTags = useCallback(async (fileId: string, nextTags: string[]) => {
    // optimistic update
    setAllFiles(prev => prev.map(f => f.id === fileId ? { ...f, tags: nextTags } : f));
    try {
      await fetch(`/api/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: nextTags }),
      });
      // refresh tags list
      setRefreshToken(n => n + 1);
    } catch (e) {
      notify('Failed to update tags', 'error');
      refresh();
    }
  }, [notify, refresh]);

   // Bulk AI auto-tag selected files
  const onAutoTagSelected = useCallback(async (ids: string[]) => {
  if (!ids?.length) return;
  const targets = allFiles.filter(f => ids.includes(f.id));

  for (const f of targets) {
    try {
      // 1) start job
      const { jobId } = await startFileTagJob(f.id);

      // 2) poll job
      let attempt = 0;
      while (attempt < 90) { // ~90s
        const data = await getJob(jobId, 'topk=10&useLLM=true');

        if (data?.state === 'SUCCESS') {
          const ai = Array.from(new Set<string>((data.tags ?? []).map(String)));

          // merge in UI
          const mergedUi = (curr: string[] = []) =>
            Array.from(new Set([...(curr ?? []), ...ai]));

          setAllFiles(prev =>
            prev.map(x => x.id === f.id ? { ...x, tags: mergedUi(x.tags) } : x)
          );

          // persist to backend (mirror your PATCH style used elsewhere)
          const current = allFiles.find(x => x.id === f.id)?.tags ?? [];
          const merged = Array.from(new Set([...current, ...ai]));
          await fetch(`/api/files/${f.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: merged })
          });
          break;
        }

        if (data?.state === 'FAILURE') {
          throw new Error(data?.error || 'AI tagging failed');
        }

        await new Promise(r => setTimeout(r, 1000));
        attempt++;
      }
    } catch (err) {
      console.error('Auto-tag file failed', f.id, err);
    }
  }
}, [allFiles, setAllFiles]);


  const onAddTagSelected = useCallback(async (ids: string[], tag: string) => {
    if (!ids.length || !tag) return;

    // optimistic tag update
    setAllFiles(prev => prev.map(f => {
      if (!ids.includes(f.id)) return f;
      const next = Array.from(new Set([...(f.tags || []), tag]));
      return { ...f, tags: next };
    }));

    try {
      await Promise.all(ids.map(async (id) => {
        const current = allFiles.find(f => f.id === id)?.tags ?? [];
        const next = Array.from(new Set([...current, tag]));
        const res = await fetch(`/api/files/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: next }),
        });
        if (!res.ok) throw new Error('Tag patch failed');
      }));
      notify('Tag added', 'success');
    } catch {
      notify('Failed to add tag to some items', 'error');
      refresh(); // revert to server truth
    }
  }, [allFiles, notify, refresh]);

  const onFavoriteSelected = useCallback(async (ids: string[]) => {
    if (!ids.length) return;

    // optimistic: set favorite true
    setAllFiles(prev => prev.map(f =>
      ids.includes(f.id) ? { ...f, isFavorited: true, favoritesCount: (f.favoritesCount ?? 0) + 1 } : f
    ));

    try {
      await Promise.all(ids.map(id => toggleFileFavorite(id, true)));
      notify('Added to favorites', 'success');
    } catch {
      notify('Failed to favorite some items', 'error');
      refresh();
    }
  }, [notify, refresh]);

  const onExportSelected = useCallback((sel: FileItem[]) => {
    if (!sel.length) return;
    const headers = ['id', 'title', 'size', 'mimeType', 'uploadDate', 'visibility', 'tags'];
    const csv = [
      headers.join(','),
      ...sel.map(f => [
        f.id,
        f.title,
        String(f.size ?? 0),
        f.mimeType ?? '',
        f.uploadDate ?? '',
        f.visibility ?? '',
        (f.tags || []).join('|'),
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'files.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  return (
    <PageTransition>
      <motion.div
        className="min-h-screen bg-background"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <motion.div
          className="relative bg-gradient-to-br from-surface/80 via-accent/5 to-info/5 backdrop-blur-xl border-b border-border/30 overflow-hidden"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-accent/10 via-info/5 to-success/10" />
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent via-info to-success" />
          <div className="max-w-7xl mx-auto px-6 py-10 relative z-10">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="relative flex-1">
                 <h1 className="text-5xl font-black text-text tracking-tight mb-2 drop-shadow-lg">File Explorer</h1>
        <p className="text-lg text-muted-foreground max-w-md leading-relaxed flex items-center gap-2">
          <span className="inline-flex w-2 h-2 bg-info rounded-full animate-pulse" />
          Innovate your journey with seamless
        </p>
      {/* Left decorative dots - smaller and less prominent */}
      <motion.div
        className="flex items-center gap-2 opacity-70 absolute left-6 top-1/2 -translate-y-1/2"
        initial={{ scale: 0.8, opacity: 0 }}
      />
              </div>

    {/* Tabs */}
    <motion.div
      className="mt-8 flex gap-2"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.5, duration: 0.6 }}
    >
      <motion.button
        className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === 'files' ? 'bg-surface text-text shadow-md' : 'border border-border text-muted-foreground hover:bg-surface/50'}`}
        onClick={() => setActiveTab('files')}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.98 }}
      >
        <File className="w-4 h-4" />
        Files ({total})
      </motion.button>
      <motion.button
        className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${activeTab === 'storage' ? 'bg-surface text-text shadow-md' : 'border border-border text-muted-foreground hover:bg-surface/50'}`}
        onClick={() => setActiveTab('storage')}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.98 }}
      >
        <Database className="w-4 h-4" />
        Storage Used ({formatBytes(totalBytes)})
      </motion.button>
    </motion.div>
          </div>
        </div>
        </motion.div>

        {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-12 gap-6">
        {/* Left: Quick Access + Folder tree + Filters - Enhanced Creative Sidebar */}
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <motion.div
            className="bg-surface/60 backdrop-blur-xl rounded-3xl p-6 shadow-2xl border border-border/30"
            initial={{ x: -30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
          >
            <FileSidebar
              onFolderSelect={onFolderSelect}
              currentFolderId={currentFolderId}
            />
          </motion.div>

          <motion.div
            className="bg-surface/50 backdrop-blur-xl rounded-3xl shadow-xl border border-border/20 overflow-hidden"
            initial={{ x: -30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6, ease: "easeOut" }}
          >
            <div className="flex items-center justify-between mb-4 px-6 pt-6 bg-gradient-to-r from-success/5 to-info/5">
              <h3 className="text-lg font-bold text-text flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-success to-info rounded-xl flex items-center justify-center shadow-lg">
                  <Filter className="w-4 h-4 text-white" />
                </div>
                Filters
              </h3>
              <motion.button
                className="btn-ghost text-sm px-3 py-1.5 rounded-xl hover:bg-white/20 transition-all duration-200 flex items-center gap-1"
                onClick={() => setShowFilters((s) => !s)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {showFilters ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showFilters ? 'Hide' : 'Show'}
              </motion.button>
            </div>
            {showFilters && (
              <motion.div
                className="px-6 pb-6"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <SearchFilter
                  initial={filters}
                  availableFileTypes={[
                    { mime: 'pdf', label: 'PDF' },
                    { mime: 'image/', label: 'Images' },
                    { mime: 'text/csv', label: 'CSV' },
                    { mime: 'text/plain', label: 'Text' },
                  ]}
                  availableTags={availableTags}
                  onChange={(f) => { setFilters(f); setPage(1); }}
                />
              </motion.div>
            )}
          </motion.div>
        </aside>

        {/* Center: Files area */}
        <section className={`col-span-12 ${inspectorOpen ? 'lg:col-span-6' : 'lg:col-span-9'}`}>
          {/* Sticky toolbar - Enhanced with glassmorphism and animations */}

          <div className="sticky top-[calc(72px+16px)] z-10 -mt-2 mb-3">
            <div className="rounded-2xl border border-black/5 bg-white/90 backdrop-blur px-2 py-2 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
              <ExplorerBreadcrumbs
                path={breadcrumb.map((b, idx) => ({
                  id: b.id ?? `home-${idx}`,
                  label: idx === 0 ? "Home" : b.name,
                  onClick: () => onCrumbClick(idx),
                }))}
                currentFolderId={currentFolderId ?? null}
                onBack={handleBack}
                onForward={handleForward}
                backEnabled={historyIndex > 0}
                forwardEnabled={historyIndex < history.length - 1}
                onResolvePathText={async (text) => {
                  const parts = text.split(/[\\/]+/).map(s => s.trim()).filter(Boolean);
                  const last = parts[parts.length - 1]?.toLowerCase();
                  const match = [...breadcrumb].reverse().find(c => (c.name || '').toLowerCase() === last);
                  return match?.id ?? null;
                }}
                onNavigate={async (folderId) => {
                  setCurrentFolderId(folderId ?? undefined);
                  setPage(1);
                  const bc = await buildBreadcrumb(folderId ?? undefined);
                  setBreadcrumb(bc);
                }}
                onSearchSubmit={(q) => { setFilters({ ...filters, query: q }); setPage(1); }}
                initialSearch={filters.query}
                getChildren={async (id) => {
                const rows = await listFolders(id ?? undefined);
                return rows.map(r => ({ id: r.id, name: r.name }));
                 }}
              />
            </div>
          </div>

          {/* Secondary command row (Up, New, Upload, Sort, View toggle) */}
          <div className="mb-4 rounded-2xl shadow-sm overflow-hidden border border-black/5 bg-white/90 backdrop-blur">
            <ExplorerCommandBar
              layout={layout as any}
              onLayoutChange={(next) => {
              setLayout(next as Layout);
              setPage(1);
              }}            
              onNew={handleNewFolder}
              onUpload={() => setShowUpload(true)}
              sortKey={sortKey}
              sortDir={sortDir}
              onSortKeyChange={(k) => { setSortKey(k as SortKey); setPage(1); }}
              onSortDirChange={() => { setSortDir(d => d === "asc" ? "desc" : "asc"); setPage(1); }}
            
              isAllSelected={selected.length === allFiles.length && allFiles.length > 0}
              onSelectAll={handleSelectAll}
              onToggleInspector={() => setInspectorOpen(v => !v)}
            
              density={density}
              onDensityChange={(d) => setDensity(d)}
            
              onQuickFilter={applyQuickFilter}
            />
          
          </div>

          <div className="space-y-4" data-density={density} data-layout={layout}>

          {/* NEW: Bulk action bar (appears when you have a selection) */}
          {selected.length > 0 && (
            <motion.div className="sticky top-4 z-10 mt-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <ToolbarButton
                variant="primary"
                onClick={() => onAutoTagSelected(selected.map(s => s.id))}
                title="Run AI auto-tag on selected files"
                className="mr-2"
              >
              AI Auto-Tag selected
              </ToolbarButton>
              <BulkActionBar
                selected={selected}
                onDelete={onDeleteSelected}
                onAddTag={onAddTagSelected}
                onFavorite={onFavoriteSelected}
                onExport={onExportSelected}
                onCopy={(ids) => handleCopy(byIds(ids))}
                onCut={(ids) => handleCut(byIds(ids))}
                onPaste={handlePaste}
                canPaste={!!clipboard}
              />
            </motion.div>
          )}

          {/* Files list */}
          <div className="mt-2 rounded-2xl bg-white/80 backdrop-blur ring-1 ring-black/5 shadow-sm overflow-hidden">
            {/* Sticky chrome header (matches screenshot style) */}
            <div className="sticky top-0 z-[5] bg-[hsl(var(--background)_/_0.88)] backdrop-blur
                            border-b border-[hsl(var(--border))]">
              <div className="h-12 px-3 sm:px-4 flex items-center gap-2">
                <div className="flex-1">
                  {/* Keep using your existing breadcrumbs component just above the list */}
                  {/* This slot intentionally blank – your ExplorerBreadcrumbs sits higher in the page */}
                </div>
          
                {/* right: quick density + layout controls mirror your CommandBar */}
                <div className="flex items-center gap-1 text-[13px]">
                  {/* we don't add new state here; ExplorerCommandBar already manages layout/density */}
                  <span className="px-2 py-1 rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
                    {allFiles.length} items
                  </span>
                </div>
              </div>
            </div>

            {isLoading && <div className="p-6 text-sm opacity-70">Loading…</div>}
            {error && !isLoading && (
              <div className="m-4 p-3 rounded bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</div>
            )}
            {!isLoading && !error && allFiles.length === 0 && (
            <div className="fm-empty">
              {/* subtle illustration card using your surface/border/shadow tokens */}
              <div
                aria-hidden
                className="h-24 w-36 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-[var(--shadow-soft)] mb-3"
              />
          
              <h3>This folder is feeling a little empty</h3>
              <p>Create a new folder, upload files, or drag & drop from your desktop.</p>
          
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleNewFolder}
                >
                  New folder
                </button>
          
                <button
                  type="button"
                  className="fm-btn"
                  onClick={() => setShowUpload(true)}
                  title="Upload files"
                >
                  Upload files
                </button>
              </div>
          
              <div className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">          
              Tip: You can paste files with <kbd>Ctrl</kbd>+<kbd>V</kbd> after copying.
              </div>
            </div>
          )}

            {clipboard && (
              <div className="mb-3 rounded-lg border bg-amber-50 dark:bg-amber-900/30 p-3 text-sm flex items-center justify-between">
                <span>
                  {clipboard.mode === 'copy' ? 'Ready to paste copy' : 'Ready to move'} — {clipboard.files.length} item(s)
                  {currentFolderId ? ' into this folder.' : ' into Home.'}
                </span>
                <div className="flex gap-2">
                  <button className="btn" onClick={handlePaste}>Paste here</button>
                  <button className="btn-ghost" onClick={() => setClipboard(null)}>Clear</button>
                </div>
              </div>
          )}

            {/* Properties modal */}
            <PropertiesModal
              file={propertiesFile}
              isOpen={showProperties}
              onClose={() => setShowProperties(false)}
            />

            {!isLoading && !error && allFiles.length > 0 && (
            <div className="rounded-2xl bg-card/90 dark:bg-card/80 ring-1 ring-border/60 p-2 sm:p-3">
              {layout === 'large' || layout === 'icons' ? (
                <WindowsGrid
                  files={allFiles}
                  variant={layout === 'icons' ? 'icons' : 'large'} 
                  density="cozy" 
                  onOpen={(f) => {
                    const isFolder = String(f.id).startsWith('folder:');
                    if (isFolder) {
                      const folderId = f.id.startsWith('folder:') ? f.id.slice('folder:'.length) : String(f.id);
                      onFolderSelect(folderId, (f as any).title);
                    } else {
                      handleOpenPreview(f as any);
                    }
                  }}
                  selectedIds={selectedIds}
                  onSelectionChange={handleSelectionChangeByIds}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onShowProperties={(f: FileItem) => { setPropertiesFile(f); }}
                  onDownload={handleDownloadItem}
                  onDelete={handleDelete}
                  onPaste={handlePaste}
                  onRename={handleRenameById}
                  onCopy={(ids: string[]) => handleCopy(byIds(ids))}
                  onCut={(ids: string[]) => handleCut(byIds(ids))}
                  onDragStart={handleDragStart}
                  onDragEnd={() => handleDragEnd([])}
                  onDrop={(e) => {
                    try {
                      const raw = e.dataTransfer.getData("text/plain");
                      const ids = raw ? JSON.parse(raw) : [];
                      // currentFolderId is already in scope in your page props
                      void handleDrop(ids, currentFolderId ?? null);
                    } catch (err) {
                      console.error("Drop payload parse error:", err);
                    }
                  }}
                  currentFolderId={currentFolderId}
                  onSortChange={(key: any, dir: any) => {
                    setSortKey(key as SortKey);
                    setSortDir(dir as SortDir);
                    setPage(1);
                  }}
                />
              ) : (
                <FileList
                  {...({
                    viewMode: layout === 'details' ? 'details' : 'list',
                    files: allFiles,
                    layout,
                    selectable: true,
                    selectedIds: selectedIds,
                    onOpen: (f: any) => {
                      if (f.mimeType === 'folder') {
                        const folderId = f.id.startsWith('folder:') ? f.id.slice('folder:'.length) : f.id;
                        onFolderSelect(folderId, f.title);
                      } else {
                        handleOpenPreview(f as any);
                      }
                    },
                    onShowProperties: (f: FileItem) => { setPropertiesFile(f); },
                    onDownload: handleDownloadItem,
                    onDelete: handleDelete,
                    clipboard,
                    onPaste: handlePaste,
                    onUpdateTags: handleUpdateTags,
                    onEditTags: handleEditTagsInPreview,
                    onSelectionChange: handleSelectionChangeByIds,
                    onRename: handleRenameById,
                    onCopy: (ids: string[]) => handleCopy(byIds(ids)),
                    onCut: (ids: string[]) => handleCut(byIds(ids)),
                    onDragStart: handleDragStart,
                    onDragEnd: handleDragEnd,
                    onDrop: handleDrop,
                    currentFolderId,
                    sortKey,
                    sortDir,
                    onSortChange: (key: any, dir: any) => {
                      setSortKey(key as SortKey);
                      setSortDir(dir as SortDir);
                      setPage(1);
                    },
                    density: "comfortable",
                  } as any)}
                />
              )}
            </div>
          )}
          </div>

          {/* Pagination - Enhanced with glassmorphism and animations */}
          <motion.div
            className="mt-6 bg-white/70 dark:bg-slate-800/70 backdrop-blur-xl rounded-2xl shadow-xl border border-white/30 dark:border-slate-700/30 p-4 flex items-center justify-between text-sm text-slate-700 dark:text-slate-300"
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.5 }}
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center ">
                <span className="font-medium-bold text-s">{page}</span>
              </div>
              <span className="font-medium">of {pageCount} pages</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Show:</span>
                <select
                  className="bg-white/80 dark:bg-slate-700/80 backdrop-blur-sm rounded-xl border border-white/40 dark:border-slate-600/40 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                >
                  {[15, 30, 60, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <ToolbarButton
                  variant="ghost"
                  className="px-3 py-1.5 rounded-xl hover:bg-surface/20 transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Prev
                </ToolbarButton>
                <ToolbarButton
                  variant="ghost"
                  className="px-3 py-1.5 rounded-xl hover:bg-surface/20 transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </ToolbarButton>
              </div>
            </div>
          </motion.div>
          </div>

        </section>
        {/* Right: Inspector */}
        <aside className="col-span-12 lg:col-span-3 relative">
          <div
            className={[
              "rounded-3xl border border-border/30 bg-surface/70 backdrop-blur-xl shadow-2xl overflow-hidden",
              inspectorOpen ? "opacity-100 translate-x-0" : "opacity-0 pointer-events-none translate-x-2"
            ].join(" ")}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
              <div className="text-sm font-semibold">Details</div>
              <button
                className="text-xs underline"
                onClick={() => setInspectorOpen(false)}
              >
                Close
              </button>
            </div>
        
            {/* Body */}
            <div className="p-4 space-y-4">
              {selected.length === 0 ? (
                <div className="text-[13px] text-muted">
                  Select a file to see details here.
                </div>
              ) : (
              <>

            {/* Summary of first selected */}
            <div className="space-y-1">
              <div className="font-medium truncate">{selected[0].title ?? (selected[0] as any).fileName}</div>
              <div className="text-xs text-muted">
                {(selected[0] as any).mimeType || (selected[0] as any).ext} • {formatBytes((selected[0] as any).size || 0)}
              </div>
            </div>
  
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded-lg border border-border/40 hover:bg-surface/20"
                onClick={() => window.open(`/api/files/${selected[0].id}/download`, "_blank")}
              >
                Download
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-lg border border-border/40 hover:bg-surface/20"
                onClick={() => handleToggleFavorite(selected[0] as any)}
              >
                {(selected[0] as any).isFavorited ? "Unfavorite" : "Favorite"}
              </button>
            </div>

                <div>
                  <button
                    className="px-3 py-1.5 text-sm rounded-lg border border-border/40 hover:bg-surface/20"
                    onClick={() => handleOpenPreview(selected[0] as any, { focusTags: true })}
                  >
                    Edit tags…
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
      </div>

      {/* Preview modal */}
      {selectedPreview && (
        <ExplorerPreviewModal
          file={selectedPreview}
          isOpen={true}
          onClose={() => setSelectedPreview(null)}
          onDownload={(f) => handleDownload(f)}
          onToggleFavorite={handleToggleFavorite}
          onTagUpdate={(fileId, tags) => {
          handleUpdateTags(fileId, tags);
          setSelectedPreview(prev => prev && prev.id === fileId ? { ...prev, tags } as any : prev);
         }}
         autoFocusTags={focusTagsOnOpen}
        />
      )}

        {/* Upload modal */}
        <Modal open={showUpload} onClose={() => setShowUpload(false)} title="Upload files">
          <AdvancedFileUpload onUploaded={handleUploaded} folderId={currentFolderId} />
        </Modal>
      </motion.div>
      {showHotkeys && (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-[hsl(var(--popover))] border border-[hsl(var(--border))] rounded-2xl shadow-2xl p-6 w-[460px] max-w-[90%]">
          <h2 className="text-lg font-semibold mb-3">Keyboard Shortcuts</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div><kbd className="kbd">Enter</kbd></div><div>Open file / folder</div>
            <div><kbd className="kbd">F2</kbd></div><div>Rename</div>
            <div><kbd className="kbd">Delete</kbd></div><div>Move to trash</div>
            <div><kbd className="kbd">Ctrl + C / V / X</kbd></div><div>Copy / Paste / Cut</div>
            <div><kbd className="kbd">Arrow Keys</kbd></div><div>Navigate items</div>
            <div><kbd className="kbd">Ctrl + F</kbd></div><div>Search within folder</div>
            <div><kbd className="kbd">?</kbd></div><div>Show this overlay</div>
          </div>
          <p className="mt-4 text-xs text-[hsl(var(--muted))]">Press Esc to close.</p>
        </div>
      </div>
    )}
    </PageTransition>
  );
}
