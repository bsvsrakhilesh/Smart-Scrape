import React, { useEffect, useMemo, useState } from 'react'
import {
  Star, Monitor, Download,
  FileText, Image as ImageIcon, Music, Video, HardDrive, Database,
  Folder as FolderIcon
} from 'lucide-react'
import type { FileItem, FolderNode } from '../../types/file'
import { fetchRootFolders, fetchChildren } from '../../lib/folders'

type FileSidebarProps = {
  onFolderSelect: (id?: string, name?: string) => void
  onFileSelect?: (file: FileItem) => void
  currentFolderId?: string
  storageUsedBytes?: number
  storageCapacityBytes?: number
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="px-3 text-[11px] uppercase tracking-wider text-[hsl(var(--muted))] mb-2">{title}</div>
    <div className="space-y-1">{children}</div>
  </div>
)

const NavBtn: React.FC<{ label: string; onClick: () => void; left?: React.ReactNode; active?: boolean }> =
({ label, onClick, left, active }) => (
  <button
    onClick={onClick}
    className={[
    "w-full h-9 px-3 rounded-lg flex items-center gap-3 text-sm transition-colors",
    active
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : "hover:bg-slate-100"
    ].join(' ')}

    title={label}
  >
    <span className="shrink-0 opacity-80">{left}</span>
    <span className="truncate">{label}</span>
  </button>
)

/** map common library names to nice icons (fallback: folder) */
const iconFor = (name: string) => {
  const n = name.toLowerCase()
  if (n.includes('document')) return <FileText className="w-4 h-4" />
  if (n.includes('picture') || n.includes('image') || n === 'photos') return <ImageIcon className="w-4 h-4" />
  if (n.includes('music') || n.includes('audio') || n.includes('songs')) return <Music className="w-4 h-4" />
  if (n.includes('video') || n.includes('movies')) return <Video className="w-4 h-4" />
  if (n.includes('download')) return <Download className="w-4 h-4" />
  if (n.includes('desktop')) return <Monitor className="w-4 h-4" />
  return <FolderIcon className="w-4 h-4 text-amber-500" />
}

/** resolve “Libraries”: if you have a real Libraries folder, use it; else use common names at root */
async function getLibraryFolders(): Promise<FolderNode[]> {
  const roots = await fetchRootFolders()
  const libRoot = roots.find(r => r.name.toLowerCase().includes('librar'))
  if (libRoot) return fetchChildren(libRoot.id)

  const COMMON = ['documents', 'pictures', 'music', 'videos', 'downloads', 'desktop']
  const libs = roots.filter(r => COMMON.some(c => r.name.toLowerCase().includes(c)))
  return libs.length ? libs : roots
}

const FileSidebar: React.FC<FileSidebarProps> = ({
  onFolderSelect,
  onFileSelect,
  currentFolderId,
  storageUsedBytes,
  storageCapacityBytes
}) => {
  const [libraryFolders, setLibraryFolders] = useState<FolderNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const libs = await getLibraryFolders()
        if (!alive) return
        setLibraryFolders(libs)
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || 'Failed to load libraries')
      }
    })()
    return () => { alive = false }
  }, [])

  const favorites = useMemo(() => ([
    { label: 'Quick Access', icon: <Star className="w-4 h-4" />, go: () => onFolderSelect?.(undefined, 'Quick Access') },
    { label: 'Desktop',      icon: <Monitor className="w-4 h-4" />, go: () => onFolderSelect?.(undefined, 'Desktop') },
    { label: 'Downloads',    icon: <Download className="w-4 h-4" />, go: () => onFolderSelect?.(undefined, 'Downloads') },
  ]), [onFolderSelect])

  return (
    <nav className="h-full overflow-y-auto pr-1" aria-label="Folders">
      <div className="space-y-6">
        <Section title="Favorites">
          {favorites.map(x =>
            <NavBtn key={x.label} label={x.label} onClick={x.go} left={x.icon} />
          )}
        </Section>

        <Section title="Libraries">
          {!libraryFolders && !error && (
            <div className="px-3 py-2 text-xs text-[hsl(var(--muted))]">Loading…</div>
          )}
          {error && (
            <div className="px-3 py-2 text-xs text-red-600/80">{error}</div>
          )}
          {libraryFolders?.map(lib => (
            <NavBtn
              key={lib.id}
              label={lib.name}
              onClick={() => onFolderSelect?.(lib.id, lib.name)}
              left={iconFor(lib.name)}
              active={currentFolderId === lib.id}
            />
          ))}
        </Section>

        <Section title="This PC">
          <NavBtn
            label="Local Disk (C:)"
            onClick={() => onFolderSelect?.('root', 'C:')}
            left={<HardDrive className="w-4 h-4" />}
            active={currentFolderId === 'root' || (!currentFolderId)}
          />
        </Section>

         {/* Storage Used (matches the screenshot) */}
         <div className="mt-6 rounded-2xl border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface))]/80 shadow-[var(--shadow-soft)] p-4">
           <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
             <Database className="w-4 h-4" />
             <span className="text-sm font-medium">Storage Used</span>
           </div>
 
           {/* numbers */}
           <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
             {(() => {
               const used = storageUsedBytes ?? 0;
               const cap = storageCapacityBytes ?? (1024 ** 4); // default 1 TB
               const pct = Math.min(100, Math.round((used / cap) * 100 || 0));
               const fmt = (n: number) => {
                 const kb = 1024, mb = 1024 ** 2, gb = 1024 ** 3, tb = 1024 ** 4;
                 if (n >= tb) return (n / tb).toFixed(1) + ' TB';
                 if (n >= gb) return (n / gb).toFixed(1) + ' GB';
                 if (n >= mb) return (n / mb).toFixed(1) + ' MB';
                 if (n >= kb) return (n / kb).toFixed(1) + ' KB';
                 return n + ' B';
               };
               return (
                 <div className="flex items-center justify-between">
                   <span>{fmt(used)} of {fmt(cap)}</span>
                   <span className="font-semibold text-[hsl(var(--foreground))]">{pct}%</span>
                 </div>
               );
             })()}
           </div>
 
           {/* progress bar */}
           {(() => {
             const used = storageUsedBytes ?? 0;
             const cap = storageCapacityBytes ?? (1024 ** 4);
             const pct = Math.min(100, Math.round((used / cap) * 100 || 0));
             return (
               <div className="mt-3 h-2 w-full rounded-full bg-[hsl(var(--border))]/50 overflow-hidden">
                 <div
                   className="h-full w-0 bg-gradient-to-r from-green-500 to-blue-500 transition-[width] duration-700"
                   style={{ width: `${pct}%` }}
                 />
               </div>
             );
           })()}
         </div>

      </div>
    </nav>
  )
}

export default FileSidebar
