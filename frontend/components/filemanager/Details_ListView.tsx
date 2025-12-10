import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import type { FileItem } from '../../types';
import { formatBytes } from '../../utils/fileHelpers';
import ContextMenu, { type MenuItem } from '../common/ContextMenu';
import { useConfirm } from '../providers/Confirm';
import gsap from 'gsap';
import { motion, AnimatePresence } from 'framer-motion';
import ReactDOM from 'react-dom';

import BookIcon from '../icons/BookIcon';
import ImageIcon from '../icons/ImageIcon';
import VideoIcon from '../icons/VideoIcon';
import MusicIcon from '../icons/MusicIcon';
import ArchiveIcon from '../icons/ArchiveIcon';
import CodeIcon from '../icons/CodeIcon';
import FileIcon from '../icons/FileIcon';
import FolderIcon from '../icons/FolderIcon';

type ViewMode = 'details' | 'list';
type ColumnKey = 'name' | 'size' | 'date' | 'type';
const ALL_COLS: ColumnKey[] = ['name', 'size', 'date', 'type'];

type ColWidths = Partial<Record<ColumnKey, number>>;
const DEFAULT_WIDTHS: ColWidths = { name: 420, size: 140, date: 200, type: 140 };

const isZip = (f: FileItem) => {
  const n = (f as any).title || (f as any).fileName || '';
  return String(n).toLowerCase().endsWith('.zip');
};
const fileDisplayName = (f: FileItem) =>
  (f as any).title || (f as any).fileName || '';

/** Props aligned to your page (Option B: ID-based callbacks) */
type Props = {
  files: FileItem[];

  // selection (ID-based). If omitted, component manages its own selection.
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: string[]) => void;

  /** actions (ID-based for multi; single-file actions get FileItem) */
  onCopy?: (ids: string[]) => void;
  onCut?: (ids: string[]) => void;
  onPaste?: () => void;
  onDelete?: (f: FileItem) => void;
  onDeleteMany?: (ids: string[]) => void;
  onRename?: (id: string, nextName: string) => void;
  onPreview?: (f: FileItem, opts?: any) => void;
  onDownload?: (f: FileItem) => void;
  onOpenVirtual?: (ctx: { zipId: string; prefix: string }) => void;

  /** drag & drop */
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[]) => void;
  onDrop?: (ids: string[], targetFolderId: string | null) => void;

  /** view/layout */
  currentFolderId?: string | null;
  sortKey?: 'name' | 'date' | 'type' | 'size';
  sortDir?: 'asc' | 'desc';
  onSortChange?: (key: ColumnKey, dir: 'asc' | 'desc') => void;
  onShowProperties?: (file: FileItem) => void;
  showCheckCol?: boolean;

  /** tokens (from parent) */
  resetColumnsToken?: number | string;
  autosizeColumnsToken?: number | string;

  layout?: 'details' | 'list';
  selectable?: boolean;
  clipboard?: unknown;
  density?: 'comfortable' | 'compact';
  onUpdateTags?: (fileId: string, nextTags: string[]) => Promise<void> | void;
  onEditTags?: (file: any) => void;
  onNew?: (kind: 'folder' | 'file') => void;
  onRefresh?: () => void;
};

export default function Details_ListView({
  files,

  selectedIds: selectedIdsProp,
  onSelectionChange,

  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDeleteMany,
  onRename,
  onPreview,
  onDownload,
  onOpenVirtual,
  onShowProperties,
  onDragStart,
  onDragEnd,
  onDrop,
  onNew,
  onRefresh,

  currentFolderId,
  sortKey,
  sortDir,
  onSortChange,
  showCheckCol = true,

  resetColumnsToken,
  autosizeColumnsToken,

  layout,
  selectable = true,
  density = 'comfortable',

}: Props) {
  // Row context menu
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; file: FileItem } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);

  const { confirm } = useConfirm();
  const buildBGMenu = (): MenuItem[] => {
  return [
    { type: 'item', id: 'newfolder', label: 'New folder', onSelect: () => onNew?.('folder') },
    { type: 'item', id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', disabled: !onPaste, onSelect: () => onPaste?.() },
    { type: 'separator' },
    { type: 'item', id: 'selectall', label: 'Select all', shortcut: 'Ctrl+A', onSelect: () => {
      const all = new Set(sorted.map(x => x.id));
      setSelectedIds(all);
    }},
    { type: 'separator' },
    { type: 'item', id: 'refresh', label: 'Refresh', onSelect: () => onRefresh?.() },
  ];
  };

  const buildRowMenu = (file: FileItem): MenuItem[] => {
  const many = selectedIds.size > 1;
  const anySel = selectedIds.size > 0;
  const targetIds = many ? Array.from(selectedIds) : [file.id];

  return [
    { type: 'item', id: 'open', label: 'Open', shortcut: 'Enter', onSelect: () => onRowDoubleClick(file) },
    { type: 'item', id: 'preview', label: 'Preview', onSelect: () => onPreview?.(file) },
    { type: 'separator' },
    { type: 'item', id: 'rename', label: 'Rename', shortcut: 'F2', onSelect: () => { setRenameId(file.id); setRenameDraft(fileDisplayName(file)); } },
    { type: 'item', id: 'copy', label: many ? `Copy ${targetIds.length} items` : 'Copy', shortcut: 'Ctrl+C', onSelect: () => onCopy?.(targetIds) },
    { type: 'item', id: 'cut', label: many ? `Cut ${targetIds.length} items` : 'Cut', shortcut: 'Ctrl+X', onSelect: () => onCut?.(targetIds) },
    { type: 'item', id: 'paste', label: 'Paste', shortcut: 'Ctrl+V', disabled: !onPaste, onSelect: () => onPaste?.() },
    { type: 'separator' },
    { type: 'item', id: 'download', label: 'Download', onSelect: () => onDownload?.(file) },
    ...(isZip(file) ? [{ type: 'item', id: 'openzip', label: 'Open ZIP', onSelect: () => onOpenVirtual?.({ zipId: file.id, prefix: '' }) } as MenuItem] : []),
    { type: 'item', id: 'selectall', label: anySel ? 'Deselect all' : 'Select all', onSelect: () => {
      if (anySel) {
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set(files.map(f => f.id)));
      }
    } },
    { type: 'separator' },
    {
      type: 'item',
      id: 'delete',
      label: many ? `Delete ${targetIds.length} items` : 'Delete',
      danger: true,
      shortcut: 'Del',
      onSelect: async () => {
        const ok = await confirm({
          title: 'Move to Trash?',
          description: many
            ? `Move ${targetIds.length} items to Trash?`
            : `Move "${fileDisplayName(file)}" to Trash?`,
        });
        if (!ok) return;

        // Bulk path
        if (many && onDeleteMany) {
          onDeleteMany(targetIds);
          return;
        }

        // Single-file path
        if (!many && onDelete) {
          onDelete(file);
        }
      },
    },
  ];
};

  /** ---------- sorting ---------- */
  const effectiveSortKey = sortKey ?? 'name';
  const effectiveSortDir = sortDir ?? 'asc';
  const draggedIdsRef = useRef<string[] | null>(null);

  /** ---------- per-folder persistence keys ---------- */
  const scope = currentFolderId || 'root';
  const colsKey = `fm.cols.${scope}`;
  const widthsKey = `fm.widths.${scope}`;
  const viewKey = `fm.view.${scope}`;

  /** ---------- view mode (persisted), mapped from optional `layout` ---------- */
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem(viewKey) as ViewMode) || 'details';
  });
  useEffect(() => {
    localStorage.setItem(viewKey, viewMode);
  }, [viewMode, viewKey]);

// Map external layout (details/list) -> internal viewMode
useEffect(() => {
  if (!layout) return;
  const mapped: ViewMode =
    layout === 'list'
      ? 'list'
      : 'details';
  setViewMode(mapped);
  // we persist viewMode already
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [layout]);

  /** ---------- columns (persisted) ---------- */
  const [visibleCols, setVisibleCols] = useState<ColumnKey[]>(() => {
    try {
      const persisted = localStorage.getItem(colsKey);
      if (persisted) return JSON.parse(persisted);
    } catch {}
    return ALL_COLS;
  });
  useEffect(() => {
    localStorage.setItem(colsKey, JSON.stringify(visibleCols));
  }, [visibleCols, colsKey]);

  const [colWidths, setColWidths] = useState<ColWidths>(() => {
    try {
      const persisted = localStorage.getItem(widthsKey);
      if (persisted) return JSON.parse(persisted);
    } catch {}
    return DEFAULT_WIDTHS;
  });
  
  useEffect(() => {
    localStorage.setItem(widthsKey, JSON.stringify(colWidths));
  }, [colWidths, widthsKey]);

  /** reset & autosize column effects (from parent “tokens”) */
  useEffect(() => {
    if (!resetColumnsToken) return;
    setVisibleCols(ALL_COLS);
    setColWidths(DEFAULT_WIDTHS);
  }, [resetColumnsToken]);

  useEffect(() => {
    if (!autosizeColumnsToken) return;
    const next = { ...colWidths };
    const maxName = Math.min(
      640,
      Math.max(280, Math.floor(Math.log10(Math.max(1, files.length)) * 40 + 360))
    );
    next.name = maxName;
    setColWidths(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autosizeColumnsToken, files.length]);

  /** ---------- selection ---------- */
  const [selectedIdsInternal, setSelectedIdsInternal] = useState<Set<string>>(
    () => new Set<string>()
  );
  // Controlled/uncontrolled: prefer prop if given
  const selectedIds = selectedIdsProp ?? selectedIdsInternal;

  const setSelectedIds = (next: Set<string>) => {
    if (!selectedIdsProp) setSelectedIdsInternal(next);
    // ALWAYS emit a real array (never undefined)
    onSelectionChange?.(Array.from(next));
  };
  

  /** ---------- rename ---------- */
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const renameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!renameId || !renameInputRef.current) return;
    const el = renameInputRef.current;
    const val = el.value;
    const dot = val.lastIndexOf('.');
    const end = dot > 0 ? dot : val.length;
    // select basename only
    el.setSelectionRange(0, end);
    el.focus();
  }, [renameId]);

  const nameFrom = (f: FileItem) => fileDisplayName(f);

  /** ---------- sorting ---------- */
  const sorted = useMemo(() => {
    const arr = [...files];
    const dir = effectiveSortDir === 'asc' ? 1 : -1;
    const key = effectiveSortKey;

    arr.sort((a, b) => {
      const an = nameFrom(a).toLowerCase();
      const bn = nameFrom(b).toLowerCase();
      switch (key) {
        case 'name':
          return an < bn ? -dir : an > bn ? dir : 0;
        case 'date': {
          const ad = (a as any).updatedAt || (a as any).createdAt || 0;
          const bd = (b as any).updatedAt || (b as any).createdAt || 0;
          return ad < bd ? -dir : ad > bd ? dir : 0;
        }
        case 'type': {
          const at = (a as any).mimeType || '';
          const bt = (b as any).mimeType || '';
          return at < bt ? -dir : at > bt ? dir : 0;
        }
        case 'size': {
          const asz = (a as any).size || 0;
          const bsz = (b as any).size || 0;
          return asz < bsz ? -dir : asz > bsz ? dir : 0;
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [files, effectiveSortDir, effectiveSortKey]);

  /** ---------- marquee selection ---------- */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverCard, setHoverCard] = useState<{ item: FileItem; x: number; y: number } | null>(null);

  // GSAP: entrance animation on visible rows
  useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const rows = el.querySelectorAll<HTMLElement>('[data-row]');
  if (!rows.length) return;

  gsap.killTweensOf(rows);
  gsap.fromTo(rows,
    { opacity: 0, y: 8, scale: 0.98 },
    {
      opacity: 1, y: 0, scale: 1,
      duration: 0.35, ease: 'power2.out', stagger: 0.015, overwrite: true
    }
  );
  }, [files?.length, layout]);

  // GSAP: card tilt / parallax on hover
  useEffect(() => {
  const el = containerRef.current;
  if (!el) return;

  const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-row]'));
  const enter = (card: HTMLElement) => {
    gsap.to(card, { transformPerspective: 800, duration: 0.2, ease: 'power2.out' });
  };
  const move = (e: MouseEvent) => {
    const card = e.currentTarget as HTMLElement;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(card, { rotateX: -py * 4, rotateY: px * 6, duration: 0.2, ease: 'power2.out' });
  };
  const leave = (e: MouseEvent) => gsap.to(e.currentTarget as HTMLElement, { rotateX: 0, rotateY: 0, duration: 0.25 });

  rows.forEach((card) => {
    card.classList.add('fm-hover-glow');
    card.addEventListener('mouseenter', () => enter(card));
    card.addEventListener('mousemove', move);
    card.addEventListener('mouseleave', leave);
  });

  return () => {
    rows.forEach((card) => {
      card.classList.remove('fm-hover-glow');
      card.removeEventListener('mousemove', move);
      // @ts-ignore
      card.removeEventListener('mouseenter', enter);
      // @ts-ignore
      card.removeEventListener('mouseleave', leave);
    });
  };
  }, [files?.length, layout]);

  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const onMouseDownBG = (e: React.MouseEvent) => {
    if (e.button !== 0 || !containerRef.current) return;
    if ((e.target as HTMLElement).closest('[data-row]')) return; // started on a row
    const hostRect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - hostRect.left;
    const sy = e.clientY - hostRect.top;
    setMarquee({ x: sx, y: sy, w: 0, h: 0 });

    const onMove = (ev: MouseEvent) => {
      const cx = ev.clientX - hostRect.left;
      const cy = ev.clientY - hostRect.top;
      setMarquee((m) => (m ? { ...m, w: cx - m.x, h: cy - m.y } : null));
    };
    const onUp = () => {
      if (marquee && containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        const mx = Math.min(marquee.x, marquee.x + marquee.w);
        const my = Math.min(marquee.y, marquee.y + marquee.h);
        const mw = Math.abs(marquee.w);
        const mh = Math.abs(marquee.h);
        const hit = new Set<string>();
        containerRef.current
          .querySelectorAll<HTMLElement>('[data-row]')
          .forEach((el) => {
            const er = el.getBoundingClientRect();
            const ex = er.left - r.left;
            const ey = er.top - r.top;
            const ew = er.width;
            const eh = er.height;
            const overlap = !(ex > mx + mw || ex + ew < mx || ey > my + mh || ey + eh < my);
            if (overlap && el.dataset.id) hit.add(el.dataset.id);
          });
        setSelectedIds(hit);
      }
      setMarquee(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /** ---------- header column chooser menu ---------- */
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragCol, setDragCol] = useState<ColumnKey | null>(null);
  const openHeaderMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setColMenu({ x: e.clientX, y: e.clientY });
  };

  /** ---------- column resizing ---------- */
  const startResize = (e: React.MouseEvent, key: ColumnKey) => {
    e.preventDefault();
    const startX = e.clientX;
    const base = (colWidths[key] ?? DEFAULT_WIDTHS[key]) || 120;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(80, base + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [key]: w }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /** ---------- keyboard shortcuts (ID-based) ---------- */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      const selIds = Array.from(selectedIds);
      // common actions
      if (isMod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        onCopy?.(selIds);
      }
      if (isMod && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        onCut?.(selIds);
      }
      if (isMod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        onPaste?.();
      }
      if (isMod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(new Set(sorted.map(f => f.id)));
      }
      if (e.key === 'Delete' && selIds.length) {
        e.preventDefault();
        const ids = selIds.slice();

        if (ids.length > 1 && onDeleteMany) {
          onDeleteMany(ids);
        } else if (onDelete) {
          const f = sorted.find(x => selectedIds.has(x.id));
          if (f) onDelete(f);
        }
      }
      if (e.key === 'F2' && selIds.length === 1) {
        e.preventDefault();
        const f = sorted.find((x) => selectedIds.has(x.id));
        if (f) {
          setRenameId(f.id);
          setRenameDraft(fileDisplayName(f));
        }
      }
      if (e.key === 'Enter' && selIds.length === 1) {
        e.preventDefault();
        const f = sorted.find((x) => selectedIds.has(x.id));
        if (f) {
          if (isZip(f)) onOpenVirtual?.({ zipId: f.id, prefix: '' });
          else onPreview?.(f);
        }
      }
      // Quick Preview on Space (when exactly one selected)
      if (e.key === ' ' && selIds.length === 1) {
        e.preventDefault();
        const f = sorted.find(x => selectedIds.has(x.id));
        if (f) onPreview?.(f);
      }

      // Alt+Enter => Properties
      if (e.altKey && e.key === 'Enter' && selIds.length === 1) {
        e.preventDefault();
        const f = sorted.find(x => selectedIds.has(x.id));
        if (f) onShowProperties?.(f);
      }

      // Escape => Deselect all
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedIds(new Set());
      }

      // Navigation parity
      if (
        ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)
      ) {
        e.preventDefault();
        if (!sorted.length) return;
        const vis = sorted;
        const curId = selIds[selIds.length - 1] || vis[0].id;
        const curIdx = Math.max(0, vis.findIndex((f) => f.id === curId));
        const pageStep = 10;
        let nextIdx = curIdx;
        switch (e.key) {
          case 'ArrowUp':
            nextIdx = Math.max(0, curIdx - 1);
            break;
          case 'ArrowDown':
            nextIdx = Math.min(vis.length - 1, curIdx + 1);
            break;
          case 'Home':
            nextIdx = 0;
            break;
          case 'End':
            nextIdx = vis.length - 1;
            break;
          case 'PageUp':
            nextIdx = Math.max(0, curIdx - pageStep);
            break;
          case 'PageDown':
            nextIdx = Math.min(vis.length - 1, curIdx + pageStep);
            break;
        }
        if (e.shiftKey) {
          const lo = Math.min(curIdx, nextIdx);
          const hi = Math.max(curIdx, nextIdx);
          const rangeIds = vis.slice(lo, hi + 1).map((x) => x.id);
          setSelectedIds(new Set(rangeIds));
        } else {
          setSelectedIds(new Set([vis[nextIdx].id]));
        }
        document
          .querySelector<HTMLElement>(`[data-id="${vis[nextIdx].id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      }
    },
    [sorted, selectedIds, onCopy, onCut, onPaste, onDelete, onDeleteMany, onPreview, onOpenVirtual]
  );

  /** ---------- row interactions ---------- */
  const toggleSelect = (id: string, multi = false, range = false) => {
    if (!selectable) return;
    const cur = new Set(selectedIds);
    if (range) {
      const vis = sorted;
      const last = Array.from(selectedIds).pop() ?? id;
      const i0 = Math.max(0, vis.findIndex((f) => f.id === last));
      const i1 = Math.max(0, vis.findIndex((f) => f.id === id));
      const lo = Math.min(i0, i1);
      const hi = Math.max(i0, i1);
      const rangeIds = vis.slice(lo, hi + 1).map((x) => x.id);
      setSelectedIds(new Set([...cur, ...rangeIds]));
      return;
    }
    if (!multi) {
      setSelectedIds(new Set([id]));
      return;
    }
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    setSelectedIds(cur);
  };

  const onRowDoubleClick = (f: FileItem) => {
    if (isZip(f)) onOpenVirtual?.({ zipId: f.id, prefix: '' });
    else onPreview?.(f);
  };

  /** ---------- render helpers ---------- */
  const renderHeader = () => {
    const gridCols =
      (showCheckCol ? '36px ' : '') +
      visibleCols.map((k) => `${colWidths[k] ?? DEFAULT_WIDTHS[k]}px`).join(' ');

    return (
      <div
        className="grid items-center sticky top-0 z-10 border-b border-border supports-[backdrop-filter]:bg-[hsl(var(--surface))]/80 select-none fm-header"
        style={{ gridTemplateColumns: gridCols }}
        onContextMenu={openHeaderMenu}
      > 
        {showCheckCol && (
        <div className="px-3 py-2 w-[36px] shrink-0">
          <input
            aria-label="Select all"
            type="checkbox"
            checked={selectedIds.size === sorted.length && sorted.length > 0}
            ref={(el) => {
              if (!el) return;
              const ind = selectedIds.size > 0 && selectedIds.size < sorted.length;
              // set the 'indeterminate' property on the DOM element
              (el as any).indeterminate = ind;
            }}
            onChange={(e) => {
              if (e.target.checked) setSelectedIds(new Set(sorted.map((f) => f.id)));
              else setSelectedIds(new Set());
            }}
          />
        </div>
       )}

        {visibleCols.includes('name') && (
          <div
            className="px-3 py-2 font-medium relative cursor-pointer select-none hover:bg-[hsl(var(--surface-elev))]"
            data-col="name"
            onClick={() => onSortChange?.('name', sortKey === 'name' && sortDir === 'asc' ? 'desc' : 'asc')}
          >
            Name {sortKey === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(e) => startResize(e, 'name')}
              draggable
              onDragStart={(e) => { setDragCol('name'); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragCol || dragCol === 'name') return;
                const from = visibleCols.indexOf(dragCol);
                const to = visibleCols.indexOf('name');
                const next = [...visibleCols];
                next.splice(from, 1);
                next.splice(to, 0, dragCol);
                setVisibleCols(next);
                setDragCol(null);
              }}
            />
          </div>
        )}
        {visibleCols.includes('date') && (
          <div className="px-3 py-2 font-medium relative" data-col="date">
            Date modified
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(e) => startResize(e, 'date')}
            />
          </div>
        )}
        {visibleCols.includes('type') && (
          <div className="px-3 py-2 font-medium relative" data-col="type">
            Type
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(e) => startResize(e, 'type')}
            />
          </div>
        )}
        {visibleCols.includes('size') && (
          <div className="px-3 py-2 font-medium relative" data-col="size">
            Size
            <span
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize"
              onMouseDown={(e) => startResize(e, 'size')}
            />
          </div>
        )}
      </div>
    );
  };

  const renderCompactList = () => {
  return (
    <div
      className="fm-list-compact divide-y divide-border/60"
      role="list"
      onClick={(e) => {
        // clicking outside a row clears selection
        if (!(e.target as HTMLElement).closest('[data-row]')) setSelectedIds(new Set());
      }}
    >
      {sorted.map((f) => {
        const isSel = selectedIds.has(f.id);
        const sizeLabel =
          (f as any).size ? ` • ${formatBytes((f as any).size)}` : '';
        const updated =
          (f as any).updatedAt
            ? new Date((f as any).updatedAt).toLocaleString()
            : '';
        const updatedLabel = updated ? ` • ${updated}` : '';

        return (
          <div
            key={f.id}
            data-row
            tabIndex={0}
            className={`fm-row group ${isSel ? 'is-selected' : ''}`}
            onDoubleClick={() => onPreview?.(f)}
            onContextMenu={(e) => {
              e.preventDefault();
              setRowMenu({ x: e.clientX, y: e.clientY, file: f });
            }}
            onClick={(e) => {
              // preserve your multi-select conventions
              const next = new Set(selectedIds);
              const additive = e.ctrlKey || e.metaKey;
              if (additive) {
                next.has(f.id) ? next.delete(f.id) : next.add(f.id);
              } else {
                next.clear();
                next.add(f.id);
              }
              setSelectedIds(next);
              onSelectionChange?.(Array.from(next));
            }}
          >
            {/* Left: icon + title + subtle meta */}
            <div className="fm-list-item__left">
              <div className="fm-thumb">{renderIcon(f, 20)}</div>
              <div className="min-w-0">
                {/* inline rename shares variables with details view */}
                {renameId === f.id ? (
                  <input
                    ref={renameInputRef}
                    className="px-2 py-1 rounded border outline-none w-full"
                    value={renameDraft}
                    autoFocus
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => {
                      setRenameId(null);
                      if (renameDraft && renameDraft !== fileDisplayName(f)) {
                        onRename?.(f.id, renameDraft);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                      if (e.key === 'Escape') {
                        setRenameId(null);
                        setRenameDraft(fileDisplayName(f));
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="fm-list-name truncate">
                      {fileDisplayName(f)}
                    </div>
                    <div className="fm-list-subtle">
                      {(f as any).mimeType || '—'}
                      {sizeLabel}
                      {updatedLabel}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Middle: tags / quick meta (hidden on small screens) */}
            <div className="fm-row-meta">
              {(f as any).tags?.length ? (
                <div className="flex items-center gap-1">
                  {(f as any).tags.slice(0, 3).map((t: string) => (
                    <span key={t} className="fm-tag">{t}</span>
                  ))}
                  {(f as any).tags.length > 3 ? (
                    <span className="fm-tag">+{(f as any).tags.length - 3}</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Right: hover-only quick actions (don’t steal focus) */}
            <div className="fm-row-actions" aria-hidden="true">
              <button
                className="fm-action"
                title="Open"
                onClick={(e) => { e.stopPropagation(); onPreview?.(f); }}
              >
                Open
              </button>
              <button
                className="fm-action"
                title="Download"
                onClick={(e) => { e.stopPropagation(); onDownload?.(f); }}
              >
                Download
              </button>
              <button
                className="fm-action"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenameId(f.id);
                  setRenameDraft(fileDisplayName(f));
                }}
              >
                Rename
              </button>
              <button
                className="fm-action danger"
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete?.(f); }}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

  const renderIcon = (f: FileItem, size = 24) => {
  const t = ((f as any).mimeType || '').toLowerCase();
  const name = fileDisplayName(f).toLowerCase();
  const style = { width: size, height: size };
  const base = 'opacity-90';
  const inner = 'w-full h-full';

  if (t.startsWith('image/')) return <span style={style} className={base}><ImageIcon className={inner} /></span>;
  if (t.startsWith('video/')) return <span style={style} className={base}><VideoIcon className={inner} /></span>;
  if (t.startsWith('audio/')) return <span style={style} className={base}><MusicIcon className={inner} /></span>;
  if (name.endsWith('.zip')) return <span style={style} className={base}><ArchiveIcon className={inner} /></span>;
  if (t.includes('pdf') || name.endsWith('.pdf')) return <span style={style} className={base}><BookIcon className={inner} /></span>;
  if (t.includes('javascript') || t.includes('typescript') || t.includes('text/'))
    return <span style={style} className={base}><CodeIcon className={inner} /></span>;

  if ((f as any).mimeType === 'folder') {
    return <span style={style} className="text-amber-500"><FolderIcon className={inner} /></span>;
  }
  return <span style={style} className={base}><FileIcon className={inner} /></span>;
};

  const renderRow = (f: FileItem) => {
    const isSel = selectedIds.has(f.id);
    const cells: React.ReactNode[] = [];

    if (showCheckCol) {
    cells.push(
      <div className="px-3 py-2 w-[36px] shrink-0">
        <input
          aria-label={`Select ${fileDisplayName(f)}`}
          type="checkbox"
          checked={isSel}
          onChange={(e) => {
            if (e.target.checked) {
              toggleSelect(f.id, true, false);
            } else {
              const cur = new Set(selectedIds);
              cur.delete(f.id);
              setSelectedIds(cur);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          draggable
          onDragStart={(e) => {
            // Default to dragging currently selected ids; if none, drag this one
            const ids = selectedIds.size ? Array.from(selectedIds) : [f.id];
            draggedIdsRef.current = ids;
            try { e.dataTransfer?.setData('text/plain', JSON.stringify(ids)); } catch {}
            e.dataTransfer!.effectAllowed = 'move';
          }}
          onDragEnd={() => { draggedIdsRef.current = null; }}
        />
      </div>
      );
    }
    if (visibleCols.includes('name')) {
      cells.push(
        <div className="fm-col-name px-3 py-2 truncate">
          <div className="flex items-center gap-2">
            <span className="inline-flex shrink-0">
              {renderIcon(f)}
            </span>
            {renameId === f.id ? (
              <input
                ref={renameInputRef}  
                className="px-2 py-1 rounded border outline-none w-full"
                value={renameDraft}
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => {
                  setRenameId(null);
                  if (renameDraft && renameDraft !== fileDisplayName(f)) {
                    onRename?.(f.id, renameDraft);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    setRenameId(null);
                    setRenameDraft('');
                  }
                }}
              />
            ) : (
              <span className="truncate">{fileDisplayName(f)}</span>
            )}
          </div>
        </div>
      );
    }

    if (visibleCols.includes('date')) {
    const d = (f as any).updatedAt || (f as any).createdAt;
    const label = d
      ? new Date(d).toLocaleDateString(undefined, {
       month: 'short', day: 'numeric', year: 'numeric'
     })
     : '—';
     cells.push(<div className="px-3 py-2 text-[0.95rem] text-[hsl(var(--foreground))]/90">{label}</div>);
    }

    if (visibleCols.includes('type')) {
      const t = (f as any).mimeType || '';
      cells.push(<div className="px-3 py-2">{t}</div>);
    }

    if (visibleCols.includes('size')) {
      const isFolder = (f as any).mimeType === 'folder';
      const s = (f as any).size || 0;
      cells.push(
      <div className="px-3 py-2 tabular-nums">
        {isFolder ? '—' : formatBytes(s)}
      </div>
      );
    }

    const gridCols =
    (showCheckCol ? '36px ' : '') +
    visibleCols.map((k) => `${colWidths[k] ?? DEFAULT_WIDTHS[k]}px`).join(' ');

    return (
      <div
        key={f.id}
        role="row"
        tabIndex={0}
        data-row
        onMouseEnter={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setHoverCard({ item: f, x: rect.left + rect.width / 2, y: rect.top + 10 });
        }}
        onMouseMove={(e) => setHoverCard(h => h ? ({ ...h, x: e.clientX + 16, y: e.clientY + 16 }) : h)}
        onMouseLeave={() => setHoverCard(null)}
        className={`fm-row cursor-default hover:bg-muted/20 hover-lift transition-colors ${isSel ? 'is-selected bg-muted/40 ring-1 ring-accent/30' : ''}`}
        style={{ gridTemplateColumns: gridCols }}
        onDoubleClick={() => onRowDoubleClick(f)}
        onClick={(e) => {
          if (e.shiftKey) toggleSelect(f.id, false, true);
          else if (e.metaKey || e.ctrlKey) toggleSelect(f.id, true, false);
          else toggleSelect(f.id, false, false);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
            if (!selectedIds.has(f.id)) {
              toggleSelect(f.id, false, false);
              }
            setRowMenu({ x: e.clientX, y: e.clientY, file: f });
        }}
        draggable
        onDragStart={() => onDragStart?.(Array.from(selectedIds))}
        onDragEnd={() => onDragEnd?.(Array.from(selectedIds))}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const ids = draggedIdsRef.current || [];
          const targetFolderId = (f as any).mimeType === 'folder' ? f.id : (currentFolderId ?? null);
          onDrop?.(ids, targetFolderId);
        }}
      >
        {cells}
        {/* Hover Preview */}
        {hoverCard && ReactDOM.createPortal(
          <AnimatePresence>
            <motion.div
              key={hoverCard.item.id}
              className="fixed z-[70] pointer-events-none fm-glass rounded-2xl p-3 shadow-2xl border border-[hsl(var(--border))/60] max-w-[280px]"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: 'easeOut' } }}
              exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
              style={{ left: hoverCard.x, top: hoverCard.y }}
            >
              <div className="text-[13px] font-medium truncate mb-1">{fileDisplayName(hoverCard.item)}</div>
              <div className="text-[12px] text-[hsl(var(--muted))] mb-2">
                {((hoverCard.item.mimeType || (hoverCard.item as any).ext || '')).toUpperCase()} • {formatBytes(hoverCard.item.size || 0)}
              </div>
              {/* quick actions hint */}
              <div className="flex gap-2 opacity-80">
                <span className="text-[11px] px-2 py-0.5 rounded-lg border">Enter to open</span>
                <span className="text-[11px] px-2 py-0.5 rounded-lg border">F2 rename</span>
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body
        )}
      </div>
    );
  };

  /** ---------- progressive rendering for large lists ---------- */
    const [renderCount, setRenderCount] = useState(() => {
       return sorted.length > 600 ? 300 : sorted.length;
     });
   
     useEffect(() => {
       if (sorted.length <= 600) {
         setRenderCount(sorted.length);
         return;
       }
       let cancelled = false;
       // Start from a modest chunk, then stream additional rows
       setRenderCount(300);
       const step = () => {
         if (cancelled) return;
         setRenderCount((c) => {
           if (c >= sorted.length) return c;
           const next = Math.min(sorted.length, c + 300);
           if (next < sorted.length) requestAnimationFrame(step);
           return next;
         });
       };
       requestAnimationFrame(step);
       return () => { cancelled = true; };
    }, [sorted]);

  /** ---------- render ---------- */
  return (
    <div
      className={`filelist-root rounded-2xl ${density === 'compact' ? 'fm-list-compact' : ''}`}
      onMouseDown={(e) => { (e.currentTarget as HTMLElement).focus(); }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      aria-label="file list"
    >

      <div
        ref={containerRef}
        role="grid"
        aria-multiselectable="true"
        className="relative -mt-1 min-h-0 flex-1 overflow-auto rounded-lg fm-scroll-slim"
        onMouseDown={onMouseDownBG}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('[data-row]')) {
            setSelectedIds(new Set());
          }
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-row]')) return;
          e.preventDefault();
          setRowMenu(null); // close any row menu
          setBgMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {viewMode === 'details' && (
          <div data-view="details" className="fm-table-wrap">
            {renderHeader()}
            <div>
              {sorted.slice(0, renderCount).map((f) => renderRow(f))}
            </div>
          </div>
        )}
        {viewMode === 'list' ? renderCompactList() : null}

        {/* Marquee overlay */}
        {marquee && (
          <div
            className="absolute border border-blue-400/70 bg-blue-200/20 pointer-events-none"
            style={{
              left: Math.min(marquee.x, marquee.x + marquee.w),
              top: Math.min(marquee.y, marquee.y + marquee.h),
              width: Math.abs(marquee.w),
              height: Math.abs(marquee.h),
            }}
          />
        )}

        {/* Row context menu */}
        {rowMenu && (
          <ContextMenu
            open={true}
            x={rowMenu.x}
            y={rowMenu.y}
            items={buildRowMenu(rowMenu.file)}
            onClose={() => setRowMenu(null)}
          />
        )}

        {/* Background context menu */}
        {bgMenu && (
          <ContextMenu
            open={true}
            x={bgMenu.x}
            y={bgMenu.y}
            items={buildBGMenu()}
            onClose={() => setBgMenu(null)}
          />
        )}

        {/* Column chooser menu (header context menu) */}
        {colMenu && (
          <div
            className="fixed z-50 bg-background border border-border rounded-lg shadow-lg text-sm min-w-[220px]"
            style={{ left: colMenu.x, top: colMenu.y }}
            onMouseLeave={() => setColMenu(null)}
          >
            <div className="px-3 py-2 font-semibold opacity-80">Columns</div>
            <div className="border-t border-border" />
            {ALL_COLS.map((k) => {
              const checked = visibleCols.includes(k);
              return (
                <button
                  key={k}
                  className="w-full flex items-center gap-2 text-left px-3 py-2 hover:bg-[hsl(var(--surface-elev))]"
                  onClick={() => {
                    setVisibleCols((prev) =>
                      checked ? prev.filter((x) => x !== k) : [...prev, k]
                    );
                  }}
                >
                  <input type="checkbox" checked={checked} readOnly />
                  <span className="capitalize">{k}</span>
                </button>
              );
            })}
            <div className="border-t border-border my-1" />
            <button
              className="w-full text-left px-3 py-2 hover:bg-[hsl(var(--surface-elev))]"
              onClick={() => {
                const next = { ...colWidths, name: Math.max(colWidths.name ?? 360, 420) };
                setColWidths(next);
                setColMenu(null);
              }}
            >
              Autosize All Columns
            </button>
            <button
              className="w-full text-left px-3 py-2 hover:bg-[hsl(var(--surface-elev))]"
              onClick={() => {
                setVisibleCols(ALL_COLS);
                setColWidths(DEFAULT_WIDTHS);
                setColMenu(null);
              }}
            >
              Reset Columns
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
