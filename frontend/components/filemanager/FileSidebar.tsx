import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Star,
  Trash2,
  Monitor,
  Download,
  FileText,
  Image as ImageIcon,
  Music,
  Video,
  Database,
  Folder as FolderIcon,
  ChevronDown,
  ChevronRight,
  Pin,
  Heart,
} from "lucide-react";
import type { FolderNode } from "../../types/file";
import { fetchRootFolders, fetchChildren } from "../../lib/folders";

type FileSidebarProps = {
  onFolderSelect: (id?: string, name?: string) => void;
  onViewSelect: (mode: "trash" | "favorites") => void;
  currentFolderId?: string;
  storageUsedBytes?: number;
  storageCapacityBytes?: number;
  viewMode: "drive" | "trash" | "favorites";
  setViewMode: (m: "drive" | "trash" | "favorites") => void;
};

const SectionShell: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <div className="ex-nav-section">{children}</div>;

const SectionHeader: React.FC<{
  title: string;
  collapsed?: boolean;
  onToggle?: () => void;
  right?: React.ReactNode;
}> = ({ title, collapsed, onToggle, right }) => (
  <div className="ex-nav-section-head">
    <button
      type="button"
      className="ex-nav-section-btn"
      onClick={onToggle}
      disabled={!onToggle}
      aria-expanded={onToggle ? !collapsed : undefined}
      title={
        onToggle ? (collapsed ? `Expand ${title}` : `Collapse ${title}`) : title
      }
    >
      {onToggle ? (
        collapsed ? (
          <ChevronRight className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )
      ) : (
        <span className="ex-nav-section-dot" aria-hidden="true" />
      )}
      <span className="ex-nav-section-title">{title}</span>
    </button>

    {right ? <div className="ex-nav-section-right">{right}</div> : null}
  </div>
);

const NavItem: React.FC<{
  label: string;
  onClick: () => void;
  left?: React.ReactNode;
  right?: React.ReactNode;
  active?: boolean;
  pinned?: boolean;
}> = ({ label, onClick, left, right, active, pinned }) => (
  <button
    type="button"
    onClick={onClick}
    className="ex-nav-item"
    data-active={active ? "true" : "false"}
    title={label}
  >
    <span className="ex-nav-ico" aria-hidden="true">
      {left}
    </span>

    <span className="ex-nav-label">{label}</span>

    <span className="ex-nav-right" aria-hidden="true">
      {pinned ? <Pin className="w-3.5 h-3.5 opacity-70" /> : null}
      {right}
    </span>
  </button>
);

/** map common library names to nice icons (fallback: folder) */
const iconFor = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("document")) return <FileText className="w-4 h-4" />;
  if (n.includes("picture") || n.includes("image") || n === "photos")
    return <ImageIcon className="w-4 h-4" />;
  if (n.includes("music") || n.includes("audio") || n.includes("songs"))
    return <Music className="w-4 h-4" />;
  if (n.includes("video") || n.includes("movies"))
    return <Video className="w-4 h-4" />;
  if (n.includes("download")) return <Download className="w-4 h-4" />;
  if (n.includes("desktop")) return <Monitor className="w-4 h-4" />;
  return <FolderIcon className="w-4 h-4 text-amber-500" />;
};

/** resolve “Libraries”: if you have a real Libraries folder, use it; else use common names at root */
async function getLibraryFolders(): Promise<FolderNode[]> {
  const roots = await fetchRootFolders();
  const libRoot = roots.find((r) => r.name.toLowerCase().includes("librar"));
  if (libRoot) return fetchChildren(libRoot.id);

  const COMMON = [
    "documents",
    "pictures",
    "music",
    "videos",
    "downloads",
    "desktop",
  ];
  const libs = roots.filter((r) =>
    COMMON.some((c) => r.name.toLowerCase().includes(c)),
  );
  return libs.length ? libs : roots;
}

const FileSidebar: React.FC<FileSidebarProps> = ({
  onFolderSelect,
  onViewSelect,
  currentFolderId,
  storageUsedBytes,
  storageCapacityBytes,
  viewMode,
}) => {
  const [libraryFolders, setLibraryFolders] = useState<FolderNode[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState({
    quick: false,
    libraries: false,
    thispc: false,
  });

  const toggle = useCallback((k: keyof typeof collapsed) => {
    setCollapsed((s) => ({ ...s, [k]: !s[k] }));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const libs = await getLibraryFolders();
        if (!alive) return;
        setLibraryFolders(libs);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load libraries");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const goHome = useCallback(() => {
    onFolderSelect?.(undefined, "All evidence");
  }, [onFolderSelect]);

  const goTrash = useCallback(() => {
    onViewSelect?.("trash");
  }, [onViewSelect]);

  const quickAccess = useMemo(() => {
    const HOME = {
      label: "All evidence",
      icon: <Star className="w-4 h-4" />,
      go: goHome,
      active: viewMode === "drive" && !currentFolderId,
      pinned: true,
    };

    const FAVORITES = {
      label: "Favorites",
      icon: <Heart className="w-4 h-4" />,
      go: () => onViewSelect?.("favorites"),
      active: viewMode === "favorites",
      pinned: true,
    };

    const TRASH = {
      label: "Trash",
      icon: <Trash2 className="w-4 h-4" />,
      go: goTrash,
      active: viewMode === "trash",
      pinned: true,
    };

    const COMMON_ORDER = [
      "desktop",
      "downloads",
      "documents",
      "pictures",
      "music",
      "videos",
    ];

    const libs = (libraryFolders ?? []).slice().sort((a, b) => {
      const ai = COMMON_ORDER.findIndex((x) =>
        a.name.toLowerCase().includes(x),
      );
      const bi = COMMON_ORDER.findIndex((x) =>
        b.name.toLowerCase().includes(x),
      );
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const pinned = libs
      .filter((l) => COMMON_ORDER.some((x) => l.name.toLowerCase().includes(x)))
      .slice(0, 6)
      .map((l) => ({
        label: l.name,
        icon: iconFor(l.name),
        go: () => onFolderSelect?.(l.id, l.name),
        active: viewMode === "drive" && currentFolderId === l.id,
        pinned: true,
      }));

    return [HOME, FAVORITES, ...pinned, TRASH];
  }, [
    goHome,
    goTrash,
    currentFolderId,
    libraryFolders,
    onFolderSelect,
    onViewSelect,
    viewMode,
  ]);

  return (
    <nav className="ex-nav" aria-label="Folders">
      <div className="ex-nav-stack">
        {/* Quick access */}
        <SectionShell>
          <SectionHeader
            title="Archive views"
            collapsed={collapsed.quick}
            onToggle={() => toggle("quick")}
          />
          {!collapsed.quick && (
            <div className="ex-nav-list">
              {quickAccess.map((x) => (
                <NavItem
                  key={x.label}
                  label={x.label}
                  onClick={x.go}
                  left={x.icon}
                  active={x.active}
                  pinned={x.pinned}
                />
              ))}
            </div>
          )}
        </SectionShell>

        {/* Libraries */}
        <SectionShell>
          <SectionHeader
            title="Collections"
            collapsed={collapsed.libraries}
            onToggle={() => toggle("libraries")}
            right={
              !libraryFolders && !error ? (
                <span className="ex-nav-pill">Loading…</span>
              ) : error ? (
                <span className="ex-nav-pill ex-nav-pill--danger">Error</span>
              ) : (
                <span className="ex-nav-pill">
                  {libraryFolders?.length ?? 0}
                </span>
              )
            }
          />

          {!collapsed.libraries && (
            <div className="ex-nav-list">
              {!libraryFolders && !error && (
                <div className="ex-nav-skeleton">
                  <div className="ex-nav-skel-row" />
                  <div className="ex-nav-skel-row" />
                  <div className="ex-nav-skel-row" />
                </div>
              )}

              {error && (
                <div className="px-3 py-2 text-xs text-red-600/80">{error}</div>
              )}

              {libraryFolders?.map((lib) => (
                <NavItem
                  key={lib.id}
                  label={lib.name}
                  onClick={() => onFolderSelect?.(lib.id, lib.name)}
                  left={iconFor(lib.name)}
                  active={viewMode === "drive" && currentFolderId === lib.id}
                />
              ))}
            </div>
          )}
        </SectionShell>

        {/* Storage Used */}
        <div className="ex-storage">
          <div className="ex-storage-head">
            <Database className="w-4 h-4" />
            <span className="text-sm font-medium">Storage</span>
          </div>

          <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
            {(() => {
              const used = storageUsedBytes ?? 0;
              const cap = storageCapacityBytes ?? 1024 ** 4;
              const pct = Math.min(100, Math.round((used / cap) * 100 || 0));
              const fmt = (n: number) => {
                const kb = 1024,
                  mb = 1024 ** 2,
                  gb = 1024 ** 3,
                  tb = 1024 ** 4;
                if (n >= tb) return (n / tb).toFixed(1) + " TB";
                if (n >= gb) return (n / gb).toFixed(1) + " GB";
                if (n >= mb) return (n / mb).toFixed(1) + " MB";
                if (n >= kb) return (n / kb).toFixed(1) + " KB";
                return n + " B";
              };
              return (
                <div className="flex items-center justify-between">
                  <span>
                    {fmt(used)} of {fmt(cap)}
                  </span>
                  <span className="font-semibold text-[hsl(var(--foreground))]">
                    {pct}%
                  </span>
                </div>
              );
            })()}
          </div>

          {(() => {
            const used = storageUsedBytes ?? 0;
            const cap = storageCapacityBytes ?? 1024 ** 4;
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
  );
};

export default FileSidebar;
