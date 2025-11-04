// frontend/components/filemanager/WindowsGrid.tsx
import { useState } from 'react';
import { Folder, File as FileIcon } from 'lucide-react';
import { formatBytes } from '../../utils/fileHelpers';
import type { FileItem } from '../../types';

type Props = {
  files: FileItem[];
  onOpen: (f: FileItem) => void;
  /** “tiles” (bigger metadata tiles) or “icons” (tight square icon matrix) */
  variant?: 'large' | 'icons';
  /** Visual density presets for spacing & sizes */
  density?: 'comfortable' | 'cozy' | 'compact';
};

const isFolder = (f: FileItem) => String(f.id).startsWith('folder:');
const displayName = (f: FileItem) =>
  (f as any).title || (f as any).fileName || '';

export default function WindowsGrid({
  files,
  onOpen,
  variant = 'large',
  density = 'comfortable',
}: Props) {
  // highlight a card while dragging files over it
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const gridAttrs = {
    'data-variant': variant,
    'data-density': density,
  } as Record<string, any>;

  return (
    <div className="wg-grid" {...gridAttrs}>
      {files.map((f) => {
        const id = String(f.id);
        const folder = isFolder(f);
        const name = displayName(f);
        const size =
          (f as any).size != null ? ` • ${formatBytes((f as any).size)}` : '';
        const mime = (f as any).mimeType || '—';

        return (
          <div
            key={id}
            className={`wg-card group ${folder ? 'is-folder' : 'is-file'} ${
              dragOverId === id ? 'is-dragover' : ''
            }`}
            tabIndex={0}
            draggable={false}
            onDoubleClick={() => onOpen(f)}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOverId(id);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOverId((cur) => (cur === id ? null : cur));
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              // Integrate your drop handler here if/when you wire it.
            }}
          >
            {/* Thumb */}
            <div className="wg-thumb">
              {folder ? (
                <Folder className="wg-thumb__icon" />
              ) : (
                <FileIcon className="wg-thumb__icon" />
              )}
            </div>

            {/* Title + meta */}
            <div className="wg-body">
              <div className="wg-name" title={name}>
                {name}
              </div>

              {/* In "icons" variant we hide meta via CSS; tiles show it */}
              <div className="wg-meta">
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
