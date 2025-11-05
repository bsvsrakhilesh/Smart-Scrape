// frontend/components/filemanager/WindowsGrid.tsx
import { useMemo, useState } from 'react';
import { Folder, File as FileIcon } from 'lucide-react';
import { formatBytes } from '../../utils/fileHelpers';
import type { FileItem } from '../../types';

type Props = {
  files: FileItem[];
  onOpen: (f: FileItem) => void;
  variant?: 'large' | 'icons';
  density?: 'comfortable' | 'cozy' | 'compact';

  // sync with FileList
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: string[]) => void;
  sortKey?: 'name' | 'date' | 'type' | 'size';
  sortDir?: 'asc' | 'desc';
};

const isFolder = (f: FileItem) => String(f.id).startsWith('folder:');
const displayName = (f: FileItem) =>
  (f as any).title || (f as any).fileName || '';

const keyOf = (f: FileItem, key: Props['sortKey']) => {
  switch (key) {
    case 'date': return (f as any).updatedAt || (f as any).createdAt || 0;
    case 'type': return (f as any).mimeType || '';
    case 'size': return (f as any).size || 0;
    case 'name':
    default:     return displayName(f).toLowerCase();
  }
};

export default function WindowsGrid({
  files,
  onOpen,
  variant = 'large',
  density = 'comfortable',
  selectedIds,
  onSelectionChange,
  sortKey,
  sortDir,
}: Props) {
  // highlight a card while dragging files over it
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const gridAttrs = {
    'data-variant': variant,
    'data-density': density,
  } as Record<string, any>;

  // ---- selection (controlled/uncontrolled) ----
  const [internalSel, setInternalSel] = useState<Set<string>>(new Set());
  const sel = selectedIds ?? internalSel;
  const setSel = (next: Set<string>) => {
    if (!selectedIds) setInternalSel(next);
    onSelectionChange?.(Array.from(next));
  };

  const toggle = (id: string, additive: boolean) => {
    const cur = new Set(sel);
    if (!additive) {
      cur.clear();
      cur.add(id);
    } else {
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
    }
    setSel(cur);
  };

  // ---- sort to match FileList ----
  const sortedFiles = useMemo(() => {
    const k = (typeof sortKey !== 'undefined' ? sortKey : 'name') as Props['sortKey'];
    const d = (typeof sortDir !== 'undefined' ? sortDir : 'asc') as Props['sortDir'];
    const arr = [...files];
    arr.sort((a: any, b: any) => {
      const ka = keyOf(a, k);
      const kb = keyOf(b, k);
      if (ka < kb) return d === 'asc' ? -1 : 1;
      if (ka > kb) return d === 'asc' ?  1 : -1;
      return 0;
    });
    return arr;
  }, [files, sortKey, sortDir]);

  return (
    <div
      className="wg-grid p-2 sm:p-3 gap-3 sm:gap-4"
      {...gridAttrs}
      // clicking empty space clears selection
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.wg-card')) return;
        setSel(new Set());
      }}
    >
      {sortedFiles.map((f) => {
        const id = String(f.id);
        const folder = isFolder(f);
        const name = displayName(f);
        const size =
          (f as any).size != null ? ` • ${formatBytes((f as any).size)}` : '';
        const mime = (f as any).mimeType || '—';
        const isSel = sel.has(id);

        return (
          <div
            key={id}
            data-item
            className={`wg-card ${isSel ? 'is-selected' : ''} group rounded-2xl ring-1 ring-border/50 hover:ring-border/70 transition-shadow hover-lift elev-1 ${folder ? 'is-folder' : 'is-file'} ${
              dragOverId === id ? 'is-dragover' : ''
            }`}
            tabIndex={0}
            draggable={false}
            onClick={(e) => toggle(id, e.ctrlKey || e.metaKey)}
            onDoubleClick={() => onOpen(f)}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOverId(id);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOverId((cur: string | null) => (cur === id ? null : cur));
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              // Integrate your drop handler here if/when you wire it.
            }}
          >
            {/* Thumb */}
            <div className="wg-thumb aspect-[4/3] rounded-xl overflow-hidden flex items-center justify-center bg-muted/50 group-hover:bg-muted/70 transition-colors">
              {folder ? (
                <Folder className="wg-thumb__icon" />
              ) : (
                <FileIcon className="wg-thumb__icon" />
              )}
            </div>

            {/* Title + meta */}
            <div className="wg-body">
              <div className="wg-name truncate" title={name}>
                {name}
              </div>

              <div className="wg-meta truncate">
                {mime}
                {size}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
