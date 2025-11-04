// frontend/components/filemanager/WindowsGrid.tsx
import { Folder, File as FileIcon, ShieldAlert, HardDrive } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactDOM from 'react-dom';
import { formatBytes } from '../../utils/fileHelpers';
import type { FileItem } from '../../types';

type Props = {
  files: FileItem[];
  onOpen: (f: FileItem) => void;
  variant?: 'tiles' | 'icons';
};

const isFolder = (f: FileItem) => String(f.id).startsWith('folder:');
const displayName = (f: FileItem) => (f as any).title || (f as any).fileName || '';
const isSystemFolder = (name: string) => /^(system32)$/i.test(name);
const isSystemFile = (name: string) => /^pagefile\.sys$/i.test(name);

export default function WindowsGrid({ files, onOpen, variant = 'tiles' }: Props) {
  const gridClass = variant === 'icons' ? 'fm-grid-icons' : 'fm-grid-tiles';
  const iconSize   = variant === 'icons' ? 'w-12 h-12' : 'w-9 h-9';
  const nameClass  = variant === 'icons' ? 'text-sm'   : 'text-[15px]';
  const [hoverCard, setHoverCard] = useState<{ item: FileItem; x: number; y: number } | null>(null);

  return (
    <div className={`${gridClass}`}>
      {files.map((f) => {
        const name = displayName(f);
        const folder = isFolder(f);
        const systemFolder = folder && isSystemFolder(name);
        const systemFile   = !folder && isSystemFile(name);

        return (
          <button
            key={String(f.id)}
            className={`fm-tile p-3 text-left group ${systemFile ? 'fm-system-file' : ''}`}
            onDoubleClick={() => onOpen(f)}
            onKeyDown={(e) => (e.key === 'Enter' ? onOpen(f) : null)}
            onMouseEnter={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setHoverCard({ item: f, x: rect.left + rect.width / 2, y: rect.top + 10 });
            }}
            onMouseMove={(e) => setHoverCard(h => h ? ({ ...h, x: e.clientX + 16, y: e.clientY + 16 }) : h)}
            onMouseLeave={() => setHoverCard(null)}
          >
            <div className="fm-thumb-box">
              {/* Special micro-badges */}
              {systemFolder && (
                <span className="fm-badge inline-flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> system
                </span>
              )}
              {systemFile && (
                <span className="fm-badge inline-flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> os
                </span>
              )}

              {/* Icon */}
              {folder ? (
                <Folder className={`${iconSize} text-amber-600`} />
              ) : (
                <FileIcon className={`${iconSize}`} />
              )}
            </div>

            {/* Title + meta */}
            <div className="mt-2">
              <div className={`${nameClass} font-medium truncate`}>{name}</div>
              <div className="fm-meta-line">
                {folder
                  ? (f as any)?.childrenCount ? `${(f as any).childrenCount} item(s)` : 'Folder'
                  : (f as any)?.mimeType || 'File'}
              </div>
            </div>

            {/* Optional chip for known “library” folders */}
            {/(documents|downloads|music|pictures|videos)/i.test(name) && (
              <div className="mt-2">
                <span className="fm-folder-chip">{name}</span>
              </div>
            )}
          </button>
        );
      })}

            {/* Hover Preview (parity with FileList) */}
      {hoverCard && ReactDOM.createPortal(
        <AnimatePresence>
          <motion.div
            key={hoverCard.item.id}
            className="fixed z-[70] pointer-events-none fm-hover-card bg-[hsl(var(--popover))]/95 backdrop-blur-lg rounded-xl p-3 shadow-2xl border border-[hsl(var(--border))/60] max-w-[280px]"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: 'easeOut' } }}
            exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.12 } }}
            style={{ left: hoverCard.x, top: hoverCard.y }}
          >
            <div className="text-[13px] font-medium truncate mb-1">
              {(hoverCard.item as any).title || (hoverCard.item as any).fileName || ''}
            </div>
            <div className="text-[12px] text-[hsl(var(--muted))] mb-2">
              {(((hoverCard.item as any).mimeType || (hoverCard.item as any).type || '') as string).toUpperCase()} • {formatBytes((hoverCard.item as any).size || 0)}
            </div>
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
}
