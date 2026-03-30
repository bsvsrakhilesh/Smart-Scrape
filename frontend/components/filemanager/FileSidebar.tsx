import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  Home,
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
  Heart,
  Search,
} from "lucide-react";
import type { FolderNode } from "../../types/file";
import { fetchRootFolders, fetchChildren } from "../../lib/folders";

type FileSidebarProps = {
  onFolderSelect: (id?: string, name?: string) => void;
  onViewSelect: (mode: "trash" | "favorites") => void;
  currentFolderId?: string;
  storageUsedBytes?: number;
  storageCapacityBytes?: number | null;
  viewMode: "drive" | "trash" | "favorites";
  refreshKey?: number;
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
}> = ({ label, onClick, left, right, active }) => (
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

async function getSidebarCollections(): Promise<FolderNode[]> {
  const roots = await fetchRootFolders();
  const libRoot = roots.find((r) => r.name.toLowerCase().includes("librar"));

  if (!libRoot) return roots;

  const libraryChildren = await fetchChildren(libRoot.id);
  const otherRoots = roots.filter((r) => r.id !== libRoot.id);

  return [...libraryChildren, ...otherRoots].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

const SIDEBAR_COLLAPSE_STORAGE_KEY = "fm.sidebar.collapsed.v1";

const DEFAULT_COLLAPSED = {
  quick: false,
  libraries: false,
  storage: false,
};

const FileSidebar: React.FC<FileSidebarProps> = ({
  onFolderSelect,
  onViewSelect,
  currentFolderId,
  storageUsedBytes,
  storageCapacityBytes,
  viewMode,
  refreshKey,
}) => {
  const [libraryFolders, setLibraryFolders] = useState<FolderNode[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [sidebarQuery, setSidebarQuery] = useState("");

  const [collapsed, setCollapsed] = useState<typeof DEFAULT_COLLAPSED>(() => {
    if (typeof window === "undefined") return DEFAULT_COLLAPSED;

    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      if (!raw) return DEFAULT_COLLAPSED;

      const parsed = JSON.parse(raw);
      return {
        quick: !!parsed?.quick,
        libraries: !!parsed?.libraries,
        storage: !!parsed?.storage,
      };
    } catch {
      return DEFAULT_COLLAPSED;
    }
  });

  const toggle = useCallback((k: keyof typeof collapsed) => {
    setCollapsed((s) => ({ ...s, [k]: !s[k] }));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_STORAGE_KEY,
        JSON.stringify(collapsed),
      );
    } catch {
      // ignore localStorage failures
    }
  }, [collapsed]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setError(null);
        const collections = await getSidebarCollections();
        if (!alive) return;
        setLibraryFolders(collections);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load collections");
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const goHome = useCallback(() => {
    onFolderSelect?.(undefined, "All evidence");
  }, [onFolderSelect]);

  const goTrash = useCallback(() => {
    onViewSelect?.("trash");
  }, [onViewSelect]);

  const normalizedSidebarQuery = sidebarQuery.trim().toLowerCase();

  const matchesSidebarQuery = useCallback(
    (label: string) => {
      if (!normalizedSidebarQuery) return true;
      return label.toLowerCase().includes(normalizedSidebarQuery);
    },
    [normalizedSidebarQuery],
  );

  const quickAccess = useMemo(() => {
    const HOME = {
      label: "All evidence",
      icon: <Home className="w-4 h-4" />,
      go: goHome,
      active: viewMode === "drive" && !currentFolderId,
    };

    const FAVORITES = {
      label: "Favorites",
      icon: <Heart className="w-4 h-4" />,
      go: () => onViewSelect?.("favorites"),
      active: viewMode === "favorites",
    };

    const TRASH = {
      label: "Trash",
      icon: <Trash2 className="w-4 h-4" />,
      go: goTrash,
      active: viewMode === "trash",
    };

    return [HOME, FAVORITES, TRASH];
  }, [goHome, goTrash, currentFolderId, onViewSelect, viewMode]);

  const filteredQuickAccess = useMemo(() => {
    return quickAccess.filter((item) => matchesSidebarQuery(item.label));
  }, [quickAccess, matchesSidebarQuery]);

  const filteredLibraryFolders = useMemo(() => {
    const libs = libraryFolders ?? [];
    return libs.filter((lib) => matchesSidebarQuery(lib.name));
  }, [libraryFolders, matchesSidebarQuery]);

  const storageSummary = useMemo(() => {
    const used = storageUsedBytes ?? 0;
    const cap =
      typeof storageCapacityBytes === "number" &&
      Number.isFinite(storageCapacityBytes) &&
      storageCapacityBytes > 0
        ? storageCapacityBytes
        : null;

    const pct =
      cap !== null ? Math.min(100, Math.round((used / cap) * 100 || 0)) : null;

    const fmt = (n: number) => {
      const kb = 1024;
      const mb = 1024 ** 2;
      const gb = 1024 ** 3;
      const tb = 1024 ** 4;

      if (n >= tb) return (n / tb).toFixed(1) + " TB";
      if (n >= gb) return (n / gb).toFixed(1) + " GB";
      if (n >= mb) return (n / mb).toFixed(1) + " MB";
      if (n >= kb) return (n / kb).toFixed(1) + " KB";
      return n + " B";
    };

    return {
      used,
      cap,
      pct,
      usedLabel: fmt(used),
      capLabel: cap !== null ? fmt(cap) : null,
    };
  }, [storageUsedBytes, storageCapacityBytes]);

  return (
    <nav className="ex-nav" aria-label="Folders">
      <div className="ex-nav-stack">
        <div className="ex-nav-search">
          <Search className="w-4 h-4 ex-nav-search-ico" />
          <input
            type="search"
            value={sidebarQuery}
            onChange={(e) => setSidebarQuery(e.target.value)}
            placeholder="Filter sidebar"
            className="ex-nav-search-input"
            aria-label="Filter sidebar items"
          />
          {sidebarQuery ? (
            <button
              type="button"
              className="ex-nav-search-clear"
              onClick={() => setSidebarQuery("")}
              aria-label="Clear sidebar filter"
              title="Clear filter"
            >
              ×
            </button>
          ) : null}
        </div>
        {/* Quick access */}
        <SectionShell>
          <SectionHeader
            title="Views"
            collapsed={collapsed.quick}
            onToggle={() => toggle("quick")}
          />
          {!collapsed.quick && (
            <div className="ex-nav-list">
              {filteredQuickAccess.map((x) => (
                <NavItem
                  key={x.label}
                  label={x.label}
                  onClick={x.go}
                  left={x.icon}
                  active={x.active}
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
                  {normalizedSidebarQuery &&
                    filteredQuickAccess.length === 0 &&
                    filteredLibraryFolders.length === 0 &&
                    !error && (
                      <div className="ex-nav-empty">
                        No sidebar items match “{sidebarQuery}”.
                      </div>
                    )}
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

              {filteredLibraryFolders.map((lib) => (
                <NavItem
                  key={lib.id}
                  label={lib.name}
                  onClick={() => onFolderSelect?.(lib.id, lib.name)}
                  left={iconFor(lib.name)}
                  active={viewMode === "drive" && currentFolderId === lib.id}
                />
              ))}

              {normalizedSidebarQuery &&
                quickAccess.length === 0 &&
                filteredLibraryFolders.length === 0 &&
                !error && (
                  <div className="ex-nav-empty">
                    No sidebar items match “{sidebarQuery}”.
                  </div>
                )}
            </div>
          )}
        </SectionShell>

        {/* Storage */}
        <div className="ex-storage">
          <button
            type="button"
            className="ex-storage-toggle"
            onClick={() => toggle("storage")}
            aria-expanded={!collapsed.storage}
            title={collapsed.storage ? "Expand Storage" : "Collapse Storage"}
          >
            <span className="ex-storage-toggle-left">
              <Database className="w-4 h-4" />
              <span className="text-sm font-medium">Storage</span>
            </span>

            <span className="ex-storage-toggle-right">
              {storageSummary.pct !== null ? (
                <span className="ex-nav-pill">{storageSummary.pct}%</span>
              ) : null}
              {collapsed.storage ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </span>
          </button>

          {!collapsed.storage && (
            <>
              <div className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
                <div className="flex items-center justify-between">
                  {storageSummary.pct !== null && (
                    <div className="mt-3 h-2 w-full rounded-full bg-[hsl(var(--border))]/50 overflow-hidden">
                      <div
                        className="h-full w-0 bg-gradient-to-r from-green-500 to-blue-500 transition-[width] duration-700"
                        style={{ width: `${storageSummary.pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 h-2 w-full rounded-full bg-[hsl(var(--border))]/50 overflow-hidden">
                <div
                  className="h-full w-0 bg-gradient-to-r from-green-500 to-blue-500 transition-[width] duration-700"
                  style={{ width: `${storageSummary.pct}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default FileSidebar;
