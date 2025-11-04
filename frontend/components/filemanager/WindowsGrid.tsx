// frontend/components/filemanager/WindowsGrid.tsx
import { Folder, File as FileIcon, ShieldAlert, HardDrive } from 'lucide-react';
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
    </div>
  );
}
