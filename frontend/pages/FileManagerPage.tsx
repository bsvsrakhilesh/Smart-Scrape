import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useToast } from "../components/providers/Toast";
import { FileItem, FileDetail } from "../lib/types";
import {
  createFolder,
  getFolder,
  moveFolder,
  moveFolderToTrash,
  moveFileToTrash,
  restoreFileFromTrash,
  restoreFolderFromTrash,
  listTrashFiles,
  toggleFileFavorite,
  toFileItem,
  normalizeFileDetail,
  type BackendStoredFile,
  duplicateFile,
  moveFile,
  getFileTagJob,
  startFileTagJob,
  listFolders,
  listZipChildren,
  streamZipFile,
  getFileById,
  refreshFileMetadata,
  queryFiles,
  getStorageUsage,
  renameFile,
  renameFolder,
  updateFileTags,
  apiUrl,
} from "../lib/api";
import BulkActionBar from "../components/common/BulkActionBar";
import ContextMenu, { type MenuItem } from "../components/common/ContextMenu";
import Details_ListView from "../components/filemanager/Details_ListView";
import Large_IconView from "../components/filemanager/Large_IconView";
import AdvancedFileUpload from "../components/filemanager/AdvancedFileUpload";
import ExplorerCommandBar from "../components/filemanager/CommandBar";
import ExplorerBreadcrumbs from "../components/filemanager/Breadcrumbs";
import ExplorerPreviewModal from "../components/filemanager/ExplorerPreviewModal";
import PropertiesModal from "../components/filemanager/PropertiesModal";
import EvidenceInspector from "../components/filemanager/EvidenceInspector";
import CommandPalette, {
  type PaletteCommand,
} from "../components/filemanager/CommandPalette";
import FileSidebar from "../components/filemanager/FileSidebar";
import PageTransition from "../components/motion/PageTransition";
import { useExplorerHistory } from "../hooks/useExplorerHistory";
import { formatBytes } from "../utils/fileHelpers";

type FolderRow = {
  id: string;
  name: string;
  createdAt?: string | Date | null;
  deletedAt?: string | Date | null;
};

const DEFAULT_PAGE_SIZE = 15;
const getLS = <T,>(k: string, v: T) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "") as T;
  } catch {
    return v;
  }
};
const setLS = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

type Layout = "large" | "icons" | "details" | "list";
type SortKey = "name" | "date" | "type" | "size";
type SortDir = "asc" | "desc";

type ArchiveCaptureKind = "all" | "upload" | "web";
type ArchiveIntegrityKind = "all" | "verified" | "hashed" | "pending";
type ArchiveRevisionKind = "all" | "revisioned" | "base";

type ArchiveFilterState = {
  captureKind: ArchiveCaptureKind;
  visibility: "all" | "public" | "private";
  integrity: ArchiveIntegrityKind;
  revision: ArchiveRevisionKind;
  sourceDomain: string;
};

const DEFAULT_ARCHIVE_FILTERS: ArchiveFilterState = {
  captureKind: "all",
  visibility: "all",
  integrity: "all",
  revision: "all",
  sourceDomain: "",
};

type ArchiveViewSnapshot = {
  layout: Layout;
  sortKey: SortKey;
  sortDir: SortDir;
  density: "cozy" | "compact";
  filters: ArchiveFilterState;
};

type SavedArchiveView = ArchiveViewSnapshot & {
  id: string;
  name: string;
  builtIn?: boolean;
};

const archiveViewSignature = (view: ArchiveViewSnapshot) =>
  JSON.stringify({
    layout: view.layout,
    sortKey: view.sortKey,
    sortDir: view.sortDir,
    density: view.density,
    filters: view.filters,
  });

const BUILTIN_ARCHIVE_VIEWS: SavedArchiveView[] = [
  {
    id: "all-evidence",
    name: "All evidence",
    builtIn: true,
    layout: "icons",
    sortKey: "date",
    sortDir: "desc",
    density: "cozy",
    filters: { ...DEFAULT_ARCHIVE_FILTERS },
  },
  {
    id: "evidence-table",
    name: "Evidence table",
    builtIn: true,
    layout: "details",
    sortKey: "date",
    sortDir: "desc",
    density: "compact",
    filters: { ...DEFAULT_ARCHIVE_FILTERS },
  },
  {
    id: "verified-evidence",
    name: "Verified evidence",
    builtIn: true,
    layout: "details",
    sortKey: "date",
    sortDir: "desc",
    density: "compact",
    filters: {
      ...DEFAULT_ARCHIVE_FILTERS,
      integrity: "verified",
    },
  },
  {
    id: "web-captures",
    name: "Web captures",
    builtIn: true,
    layout: "details",
    sortKey: "date",
    sortDir: "desc",
    density: "compact",
    filters: {
      ...DEFAULT_ARCHIVE_FILTERS,
      captureKind: "web",
    },
  },
  {
    id: "revision-review",
    name: "Revision review",
    builtIn: true,
    layout: "details",
    sortKey: "date",
    sortDir: "desc",
    density: "compact",
    filters: {
      ...DEFAULT_ARCHIVE_FILTERS,
      revision: "revisioned",
    },
  },
];

const ToolbarButton: React.FC<
  React.ComponentProps<typeof motion.button> & {
    variant?: "primary" | "outline" | "ghost";
  }
> = ({ variant = "outline", className = "", children, ...rest }) => {
  const base =
    variant === "primary"
      ? "btn-primary"
      : variant === "ghost"
        ? "btn-ghost"
        : "btn-outline";
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

const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 dark:bg-black/50"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl">
        <div className="px-5 py-4 border-b dark:border-neutral-800 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="btn-ghost text-sm px-3" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

export default function FileManagerPage() {
  const { notify } = useToast();

  // layout / pagination / minor UI state
  const [layout, setLayout] = useState<Layout>(() =>
    getLS<Layout>("fm:layout", "icons"),
  );
  useEffect(() => setLS("fm:layout", layout), [layout]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [density, setDensity] = useState<"cozy" | "compact">(() =>
    getLS("fm:density", "cozy"),
  );
  useEffect(() => setLS("fm:density", density), [density]);

  // Focus Mode (collapses the left sidebar for a distraction-free workspace)
  const [focusMode, setFocusMode] = useState<boolean>(() =>
    getLS("fm:focusMode", false),
  );
  useEffect(() => setLS("fm:focusMode", focusMode), [focusMode]);

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() =>
    getLS("fm:inspectorOpen", true),
  );
  useEffect(() => setLS("fm:inspectorOpen", inspectorOpen), [inspectorOpen]);

  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Debounce search → avoids hammering the API on every keypress.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = search.trim();
      setSearchQuery(next);
      // changing the query should always reset pagination
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const [archiveFilters, setArchiveFilters] = useState<ArchiveFilterState>(
    DEFAULT_ARCHIVE_FILTERS,
  );

  const activeArchiveFilterCount = useMemo(
    () =>
      Number(archiveFilters.captureKind !== "all") +
      Number(archiveFilters.visibility !== "all") +
      Number(archiveFilters.integrity !== "all") +
      Number(archiveFilters.revision !== "all") +
      Number(archiveFilters.sourceDomain.trim().length > 0),
    [archiveFilters],
  );

  const clearArchiveFilters = useCallback(() => {
    setArchiveFilters(DEFAULT_ARCHIVE_FILTERS);
    setPage(1);
  }, []);

  const [savedArchiveViews, setSavedArchiveViews] = useState<
    SavedArchiveView[]
  >(() => getLS<SavedArchiveView[]>("fm:savedArchiveViews", []));

  useEffect(() => {
    setLS("fm:savedArchiveViews", savedArchiveViews);
  }, [savedArchiveViews]);

  const [activeArchiveViewId, setActiveArchiveViewId] =
    useState<string>("all-evidence");

  const allArchiveViews = useMemo(
    () => [...BUILTIN_ARCHIVE_VIEWS, ...savedArchiveViews],
    [savedArchiveViews],
  );

  const activeArchiveView = useMemo<SavedArchiveView>(
    () =>
      allArchiveViews.find((view) => view.id === activeArchiveViewId) ??
      BUILTIN_ARCHIVE_VIEWS[0],
    [allArchiveViews, activeArchiveViewId],
  );

  const currentArchiveViewState = useMemo<ArchiveViewSnapshot>(
    () => ({
      layout,
      sortKey,
      sortDir,
      density,
      filters: archiveFilters,
    }),
    [layout, sortKey, sortDir, density, archiveFilters],
  );

  const activeArchiveViewIsDirty = useMemo(
    () =>
      archiveViewSignature(activeArchiveView) !==
      archiveViewSignature(currentArchiveViewState),
    [activeArchiveView, currentArchiveViewState],
  );

  const applyArchiveView = useCallback((view: SavedArchiveView) => {
    setViewMode("drive");
    setVirtualZip(null);
    setLayout(view.layout);
    setSortKey(view.sortKey);
    setSortDir(view.sortDir);
    setDensity(view.density);
    setArchiveFilters({ ...view.filters });
    setSearch("");
    setSearchQuery("");
    setPage(1);
    setSelected([]);
    setEmptyBgMenu(null);
    setActiveArchiveViewId(view.id);
  }, []);

  const saveCurrentArchiveView = useCallback(() => {
    const suggestedName =
      activeArchiveView && !activeArchiveView.builtIn
        ? activeArchiveView.name
        : "";

    const raw = window.prompt("Save current archive view as", suggestedName);
    const name = raw?.trim();
    if (!name) return;

    const existing = savedArchiveViews.find(
      (view) => view.name.toLowerCase() === name.toLowerCase(),
    );

    const nextView: SavedArchiveView = {
      id: existing?.id ?? `saved-${Date.now()}`,
      name,
      layout,
      sortKey,
      sortDir,
      density,
      filters: { ...archiveFilters },
    };

    setSavedArchiveViews((prev) => {
      if (existing) {
        return prev.map((view) => (view.id === existing.id ? nextView : view));
      }
      return [nextView, ...prev].slice(0, 8);
    });

    setActiveArchiveViewId(nextView.id);
    notify(`Saved view: ${name}`, "success");
  }, [
    activeArchiveView,
    savedArchiveViews,
    layout,
    sortKey,
    sortDir,
    density,
    archiveFilters,
    notify,
  ]);

  const deleteActiveArchiveView = useCallback(() => {
    if (!activeArchiveView || activeArchiveView.builtIn) return;

    setSavedArchiveViews((prev) =>
      prev.filter((view) => view.id !== activeArchiveView.id),
    );
    setActiveArchiveViewId("all-evidence");
    notify(`Deleted view: ${activeArchiveView.name}`, "success");
  }, [activeArchiveView, notify]);

  const applySortShortcut = useCallback(
    (nextKey: SortKey, nextDir: SortDir) => {
      setSortKey(nextKey);
      setSortDir(nextDir);
      setPage(1);
    },
    [],
  );

  // ---------- Command palette ----------
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // ---------- hotkeys overlay ----------
  const [showHotkeys, setShowHotkeys] = useState(false);

  // ---------- Bulk AI auto-tag UI ----------
  const autoTagCancelRef = useRef(false);
  const [autoTagUI, setAutoTagUI] = useState<{
    open: boolean;
    running: boolean;
    total: number;
    done: number;
    success: number;
    failed: number;
    currentLabel: string;
    errors: { id: string; label: string; message: string }[];
  }>({
    open: false,
    running: false,
    total: 0,
    done: 0,
    success: 0,
    failed: 0,
    currentLabel: "",
    errors: [],
  });

  const requestCancelAutoTag = useCallback(() => {
    if (!autoTagUI.open) return;

    // If not running, just close the modal
    if (!autoTagUI.running) {
      setAutoTagUI((p) => ({ ...p, open: false }));
      return;
    }

    // Running: request cancellation
    autoTagCancelRef.current = true;
    notify("Cancelling auto-tag…", "info");
  }, [autoTagUI.open, autoTagUI.running, notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?") setShowHotkeys((v) => !v);
      if (e.key === "Escape") setShowHotkeys(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // Cmd+K (Mac) or Ctrl+K (Win/Linux)
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && key === "k") {
        e.preventDefault();
        setIsPaletteOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // folders / breadcrumb
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(
    undefined,
  );
  const { initialFolderId } = useExplorerHistory(currentFolderId ?? null, {
    onPopNavigate: async (fid) => {
      // load folder when user presses Back/Forward
      setSelected([]);
      setEmptyBgMenu(null);
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

  const [breadcrumb, setBreadcrumb] = useState<{ id?: string; name: string }[]>(
    [{ name: "Home" }],
  );

  // navigation history
  const [history, setHistory] = useState<string[]>([""]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);

  // ---------- Zip-as-folder (virtual archive browsing) ----------
  const [virtualZip, setVirtualZip] = useState<null | {
    zipId: string;
    label: string; // archive file name shown in breadcrumb
    prefix: string; // e.g. "", "dir1/", "dir1/dir2/"
  }>(null);

  // properties modal
  const [propertiesFile, setPropertiesFile] = useState<FileItem | null>(null);
  const [showProperties, setShowProperties] = useState<boolean>(false);

  // ----- Safe destructive actions: confirm + undo -----
  const TRASH_UNDO_MS = 10_000;

  const [trashConfirm, setTrashConfirm] = useState<null | {
    ids: string[];
    names: string[];
  }>(null);

  const [undoTrash, setUndoTrash] = useState<null | {
    ids: string[];
    label: string;
    expiresAt: number;
  }>(null);

  // data
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [storageUsedBytes, setStorageUsedBytes] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"drive" | "trash" | "favorites">(
    "drive",
  );

  // Remember the last Drive location so returning from Trash/Favorites restores context
  const lastDriveLocationRef = useRef<{
    folderId?: string;
    breadcrumb: { id?: string; name: string }[];
  } | null>(null);

  // preview + upload modal
  const [selectedPreview, setSelectedPreview] = useState<FileDetail | null>(
    null,
  );
  const [previewFocusTags, setPreviewFocusTags] = useState(false);
  const [showUpload, setShowUpload] = useState<boolean>(false);

  // refresh flag
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  // ------- Sidebar Storage (global usage) -------
  const fetchStorageUsage = useCallback(async () => {
    try {
      const data = await getStorageUsage();
      setStorageUsedBytes(Number(data?.usedBytes ?? 0));
    } catch {
      // keep the last value (don’t flash 0 / break UI)
    }
  }, []);

  const refreshAll = useCallback(() => {
    refresh(); // refresh listing
    void fetchStorageUsage(); // refresh sidebar immediately
  }, [refresh, fetchStorageUsage]);

  // initial load for sidebar storage
  useEffect(() => {
    void fetchStorageUsage();
  }, [fetchStorageUsage]);

  // Drag state for UI feedback
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Apply dragging class to body for global UI feedback
  useEffect(() => {
    if (isDragging) {
      document.body.classList.add("dragging");
    } else {
      document.body.classList.remove("dragging");
    }
    return () => document.body.classList.remove("dragging");
  }, [isDragging]);

  // derived files based on header search
  const visibleFiles = allFiles;

  const activeLocationLabel = useMemo(() => {
    if (viewMode === "trash") return "Trash";
    if (viewMode === "favorites") return "Favorites";
    if (virtualZip) return virtualZip.label;
    return breadcrumb[breadcrumb.length - 1]?.name || "Home";
  }, [viewMode, virtualZip, breadcrumb]);

  const activeModeLabel = useMemo(() => {
    if (viewMode === "trash") return "Trash";
    if (viewMode === "favorites") return "Favorites";
    return virtualZip ? "Archive browser" : "Drive";
  }, [viewMode, virtualZip]);

  const sortSummaryLabel = useMemo(() => {
    const labels: Record<SortKey, string> = {
      date: "Date",
      name: "Name",
      type: "Type",
      size: "Size",
    };
    return `${labels[sortKey]} • ${sortDir === "asc" ? "Ascending" : "Descending"}`;
  }, [sortKey, sortDir]);

  const storagePercent = useMemo(() => {
    const capacity = 1024 ** 4;
    return Math.min(
      100,
      Math.round(((storageUsedBytes ?? 0) / capacity || 0) * 100),
    );
  }, [storageUsedBytes]);

  // Selection + clipboard for cut/copy/paste
  const [selected, setSelected] = useState<FileItem[]>([]);
  const selectedIds = useMemo(
    () => new Set(selected.map((f) => f.id)),
    [selected],
  );
  const selectedSingle = useMemo(
    () => (selected.length === 1 ? selected[0] : null),
    [selected],
  );

  const [clipboard, setClipboard] = useState<{
    mode: "copy" | "cut";
    files: FileItem[];
  } | null>(null);
  const [emptyBgMenu, setEmptyBgMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // ---- Folder helpers (folders are represented as id = "folder:<id>") ----
  const isFolderId = (id: string) => String(id).startsWith("folder:");
  const rawFolderId = (id: string) =>
    isFolderId(id) ? String(id).slice("folder:".length) : String(id);

  const isFolderItem = (f: FileItem) =>
    (f as any)?.mimeType === "folder" || isFolderId(String(f.id));

  const splitSelectionIds = (ids: string[]) => {
    const folderIds: string[] = [];
    const fileIds: string[] = [];
    for (const id of ids) {
      const sid = String(id);
      if (isFolderId(sid)) folderIds.push(rawFolderId(sid));
      else fileIds.push(sid);
    }
    return { folderIds, fileIds };
  };

  // ---- Zip-as-folder helpers ----
  const ZIP_HIST_PREFIX = "zip|";
  const ZIP_DIR_PREFIX = "zipdir|";
  const ZIP_FILE_PREFIX = "zipfile|";

  const makeZipHist = (zipId: string, prefix: string) =>
    `${ZIP_HIST_PREFIX}${zipId}|${prefix}`;

  const isZipHist = (h: string) => h.startsWith(ZIP_HIST_PREFIX);

  const parseZipHist = (h: string) => {
    const parts = h.split("|");
    return { zipId: parts[1] ?? "", prefix: parts[2] ?? "" };
  };

  const makeZipDirId = (zipId: string, path: string) =>
    `${ZIP_DIR_PREFIX}${zipId}|${path}`; // path ends with "/"
  const makeZipFileId = (zipId: string, path: string) =>
    `${ZIP_FILE_PREFIX}${zipId}|${path}`;

  const isZipDirId = (id: string) => id.startsWith(ZIP_DIR_PREFIX);
  const isZipFileId = (id: string) => id.startsWith(ZIP_FILE_PREFIX);

  const parseZipItemId = (id: string) => {
    const parts = id.split("|");
    const zipId = parts[1] ?? "";
    const path = parts.slice(2).join("|"); // defensive
    return { zipId, path };
  };

  const selectedBytes = useMemo(() => {
    return selected.reduce((acc, f) => {
      const isFolder =
        (f as any)?.mimeType === "folder" || String(f.id).startsWith("folder:");
      return acc + (isFolder ? 0 : typeof f.size === "number" ? f.size : 0);
    }, 0);
  }, [selected]);

  // ---- Select-all helper (shim) ----
  const handleSelectAll = () => {
    if (selected.length === allFiles.length && allFiles.length > 0) {
      handleSelectionChangeByIds([]); // clear
    } else {
      handleSelectionChangeByIds(allFiles.map((f) => f.id)); // select all
    }
  };

  const handleSelectionChangeByIds = (ids?: string[]) => {
    const set = new Set(ids ?? []);
    setSelected(allFiles.filter((f) => set.has(f.id)));
  };

  const patchFileEverywhere = useCallback(
    (
      fileId: string,
      updater:
        | (Partial<FileItem> & Partial<FileDetail>)
        | ((
            current: FileItem | FileDetail,
          ) => Partial<FileItem> & Partial<FileDetail>),
    ) => {
      const id = String(fileId);
      if (!id) return;

      const apply = <T extends { id: string }>(current: T): T => {
        const patch =
          typeof updater === "function"
            ? (
                updater as (
                  current: FileItem | FileDetail,
                ) => Partial<FileItem> & Partial<FileDetail>
              )(current as any)
            : updater;

        return { ...current, ...patch } as T;
      };

      setAllFiles((prev) =>
        prev.map((x) => (String((x as any).id) === id ? apply(x as any) : x)),
      );

      setSelected((prev) =>
        prev.map((x) => (String((x as any).id) === id ? apply(x as any) : x)),
      );

      setPropertiesFile((prev) =>
        prev && String((prev as any).id) === id ? apply(prev as any) : prev,
      );

      setSelectedPreview((prev) =>
        prev && String((prev as any).id) === id ? apply(prev as any) : prev,
      );
    },
    [],
  );

  const applyLatestFileEverywhere = useCallback(
    (fresh: FileItem | FileDetail | null | undefined) => {
      const id = String((fresh as any)?.id ?? "");
      if (!fresh || !id) return;

      patchFileEverywhere(id, fresh as Partial<FileItem> & Partial<FileDetail>);
    },
    [patchFileEverywhere],
  );

  const handleRenameById = async (id: string, nextName: string) => {
    const file = allFiles.find((f) => f.id === id);
    if (file) await handleRename(file, nextName);
  };

  // Favorites toggle handler
  const handleToggleFavorite = useCallback(
    async (file: FileItem) => {
      if (isFolderItem(file)) {
        notify("Folders can't be favorited yet.", "info");
        return;
      }

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
                  (f.favoritesCount ?? 0) + (prev ? -1 : 1),
                ),
              }
            : f,
        ),
      );
      if (selectedPreview?.id === file.id) {
        setSelectedPreview((p) =>
          p
            ? {
                ...p,
                isFavorited: !prev,
                favoritesCount: Math.max(
                  0,
                  (p.favoritesCount ?? 0) + (prev ? -1 : 1),
                ),
              }
            : p,
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
              : f,
          ),
        );
        if (selectedPreview?.id === file.id) {
          setSelectedPreview((p) =>
            p
              ? {
                  ...p,
                  isFavorited: updated.isFavorited,
                  favoritesCount: updated.favoritesCount,
                }
              : p,
          );
        }
        notify(
          `${file.title} ${
            updated.isFavorited ? "added to" : "removed from"
          } favorites`,
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
                    (f.favoritesCount ?? 0) + (prev ? 1 : -1),
                  ),
                }
              : f,
          ),
        );
        if (selectedPreview?.id === file.id) {
          setSelectedPreview((p) =>
            p
              ? {
                  ...p,
                  isFavorited: prev,
                  favoritesCount: Math.max(
                    0,
                    (p.favoritesCount ?? 0) + (prev ? 1 : -1),
                  ),
                }
              : p,
          );
        }
        notify("Could not update favorite", "error");
      }
    },
    [notify, selectedPreview],
  );

  // ------- Breadcrumb: build from authoritative parent chain -------
  const folderCache = useRef(
    new Map<string, { id: string; name: string; parentId: string | null }>(),
  );

  const fetchFolderMeta = useCallback(async (id: string) => {
    const cached = folderCache.current.get(id);
    if (cached) return cached;
    try {
      const meta = await getFolder(id); // expected: { id, name, parentId }
      const norm = {
        id,
        name: meta?.name ?? "Folder",
        parentId: meta?.parentId ?? null,
      };
      folderCache.current.set(id, norm);
      return norm;
    } catch {
      const norm = { id, name: "Folder", parentId: null };
      folderCache.current.set(id, norm);
      return norm;
    }
  }, []);

  const buildBreadcrumb = useCallback(
    async (id?: string) => {
      if (id === "trash")
        return [{ name: "Home" }, { id: "trash", name: "Trash" }];

      if (id === "favorites")
        return [{ name: "Home" }, { id: "favorites", name: "Favorites" }];

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
      return [{ name: "Home" }, ...chain];
    },
    [fetchFolderMeta],
  );

  const buildZipBreadcrumb = useCallback(
    (zipId: string, label: string, prefix: string) => {
      const crumbs: { id?: string; name: string }[] = [
        { name: "Home" },
        { id: makeZipHist(zipId, ""), name: label || "Archive" },
      ];

      const clean = (prefix || "").replace(/^\/+/, "");
      if (!clean) return crumbs;

      const segs = clean.split("/").filter(Boolean);
      let acc = "";
      for (const seg of segs) {
        acc += `${seg}/`;
        crumbs.push({ id: makeZipHist(zipId, acc), name: seg });
      }
      return crumbs;
    },
    [],
  );

  // ------- Data fetch -------
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const inZip = !!virtualZip;
    const inFavorites = !inZip && viewMode === "favorites";
    const inTrash = !inZip && viewMode === "trash";

    const params = new URLSearchParams();

    if (!inZip && viewMode === "drive") {
      params.set(
        "folderId",
        currentFolderId ? String(currentFolderId) : "root",
      );
    }

    if (inFavorites) {
      params.set("favoritesOnly", "true");
    }

    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const backendSortKey =
      sortKey === "date"
        ? "createdAt"
        : sortKey === "name"
          ? "fileName"
          : sortKey === "type"
            ? "mimeType"
            : sortKey;

    params.set("sortKey", backendSortKey);
    params.set("sortOrder", sortDir);

    if (searchQuery.trim()) params.set("q", searchQuery.trim());

    if (!inZip && !inTrash) {
      if (archiveFilters.captureKind !== "all") {
        params.set("captureKind", archiveFilters.captureKind);
      }

      if (archiveFilters.visibility !== "all") {
        params.set("visibility", archiveFilters.visibility);
      }

      if (archiveFilters.integrity !== "all") {
        params.set("integrity", archiveFilters.integrity);
      }

      if (archiveFilters.revision !== "all") {
        params.set("revision", archiveFilters.revision);
      }

      if (archiveFilters.sourceDomain.trim()) {
        params.set("sourceDomain", archiveFilters.sourceDomain.trim());
      }
    }

    (async () => {
      try {
        // ----------------------------
        // ZIP MODE: listZipChildren()
        // ----------------------------
        if (virtualZip) {
          const z = virtualZip;
          const data = await listZipChildren(z.zipId, z.prefix);

          const q = searchQuery.trim().toLowerCase();

          const folderItems: FileItem[] = (data.folders || []).map((name) => ({
            id: makeZipDirId(z.zipId, `${data.prefix}${name}/`),
            title: name,
            description: "",
            uploader: { id: "system", name: "—" },
            uploadDate: new Date().toISOString(),
            size: 0,
            mimeType: "folder",
            tags: [],
            visibility: "private",
          }));

          const fileItems: FileItem[] = (data.files || []).map((f) => ({
            id: makeZipFileId(z.zipId, `${data.prefix}${f.name}`),
            title: f.name,
            description: "",
            uploader: { id: "system", name: "—" },
            uploadDate: f.modified
              ? new Date(f.modified as any).toISOString()
              : new Date().toISOString(),
            size: Number(f.size ?? 0),
            mimeType: "application/octet-stream",
            tags: [],
            visibility: "private",
          }));

          const filteredFolderItems =
            q.length > 0
              ? folderItems.filter((x) =>
                  String(x.title || "")
                    .toLowerCase()
                    .includes(q),
                )
              : folderItems;

          const filteredFileItems =
            q.length > 0
              ? fileItems.filter((x) =>
                  String(x.title || "")
                    .toLowerCase()
                    .includes(q),
                )
              : fileItems;

          // Keep folders pinned on page 1, paginate files in the remaining slots.
          const folderCount = filteredFolderItems.length;
          const fileSlotsPage1 = Math.max(0, pageSize - folderCount);

          const pageFiles =
            page === 1
              ? filteredFileItems.slice(0, fileSlotsPage1)
              : filteredFileItems.slice(
                  fileSlotsPage1 + (page - 2) * pageSize,
                  fileSlotsPage1 + (page - 2) * pageSize + pageSize,
                );

          const items =
            page === 1 ? [...filteredFolderItems, ...pageFiles] : pageFiles;

          if (!cancelled) {
            setAllFiles(items);
            setTotal(filteredFileItems.length);
            setTotalBytes(
              filteredFileItems.reduce((acc, it) => acc + (it.size || 0), 0),
            );
          }

          return;
        }

        const data = inTrash
          ? await listTrashFiles(Object.fromEntries(params.entries()))
          : await queryFiles(Object.fromEntries(params.entries()));

        const folderRows = inTrash
          ? Array.isArray((data as any)?.folders)
            ? (data as any).folders
            : []
          : inFavorites
            ? []
            : await listFolders(currentFolderId ?? "root");

        const fileRows: BackendStoredFile[] = inTrash
          ? Array.isArray((data as any)?.files)
            ? (data as any).files
            : []
          : Array.isArray(data)
            ? (data as any)
            : Array.isArray((data as any).items)
              ? (data as any).items
              : [];

        const fileItems: FileItem[] = fileRows.map(toFileItem);

        const folderItems: FileItem[] = (folderRows as FolderRow[]).map(
          (fr) => ({
            id: `folder:${fr.id}`,
            title: fr.name,
            description: "",
            uploader: { id: "system", name: "—" },
            uploadDate: String(
              fr.deletedAt ?? fr.createdAt ?? new Date().toISOString(),
            ),
            size: 0,
            mimeType: "folder",
            tags: [],
            visibility: "private",
          }),
        );

        if (!cancelled) {
          const q = searchQuery.trim().toLowerCase();
          const filteredFolderItems =
            q.length > 0
              ? folderItems.filter((f) =>
                  String(f.title || "")
                    .toLowerCase()
                    .includes(q),
                )
              : folderItems;

          const showFolders = page === 1;
          const items = showFolders
            ? [...filteredFolderItems, ...fileItems]
            : fileItems;
          setAllFiles(items);

          const totalCount =
            typeof (data as any)?.total === "number"
              ? (data as any).total
              : fileItems.length;
          setTotal(totalCount);

          const bytes =
            typeof (data as any)?.totalBytes === "number"
              ? (data as any).totalBytes
              : fileItems.reduce(
                  (acc, f) => acc + (typeof f.size === "number" ? f.size : 0),
                  0,
                );

          setTotalBytes(bytes);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load");
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
  }, [
    page,
    pageSize,
    currentFolderId,
    sortKey,
    sortDir,
    searchQuery,
    archiveFilters,
    refreshToken,
    virtualZip,
  ]);

  // ------- Storage usage (sidebar) -------
  // Sidebar should show *global* usage, not only the current folder's total bytes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await getStorageUsage();
        if (!cancelled) setStorageUsedBytes(Number(data?.usedBytes ?? 0));
      } catch {
        // graceful fallback (won't be perfect, but avoids showing 0)
        if (!cancelled) setStorageUsedBytes(totalBytes);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshToken, totalBytes]);

  // ------- Actions -------
  const handleOpenPreview = useCallback((f: any) => {
    const normalized = normalizeFileDetail(f);

    // If we somehow get a bogus object with no id, don't open.
    if (!normalized?.id) return;

    setSelectedPreview(normalized);
    setTimeout(() => {}, 0);
  }, []);

  const handleEditTagsInPreview = useCallback(
    (file: FileDetail) => {
      handleOpenPreview(file);
    },
    [handleOpenPreview],
  );

  const handleDownload = (f: FileDetail | FileItem) => {
    window.open(apiUrl(`/api/files/${f.id}/download`), "_blank");
  };
  const handleDownloadItem = (f: FileItem) => handleDownload(f);

  const openProperties = useCallback(async (f: FileItem) => {
    // open immediately (no waiting)
    setPropertiesFile(f);
    setShowProperties(true);

    // For real files, fetch fresh details (provenance, hashes, etc.)
    const id = String((f as any)?.id ?? "");
    const isFolder =
      (f as any)?.mimeType === "folder" || id.startsWith("folder:");
    if (isFolder) return;

    // Zip virtual items don't exist as DB files
    if (isZipDirId(id) || isZipFileId(id)) return;

    try {
      const fresh = await getFileById(id);
      setPropertiesFile(fresh);
    } catch {
      // non-fatal: keep what we already have
    }
  }, []);

  const openTrashConfirm = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;

      // build display names from current visible list
      const names = ids
        .map((id) => allFiles.find((f) => String(f.id) === String(id))?.title)
        .filter(Boolean) as string[];

      const fallbackName = (id: string) => {
        if (String(id).startsWith("folder:")) return "Folder";
        return "File";
      };

      setTrashConfirm({
        ids,
        names: names.length ? names : ids.map(fallbackName),
      });
    },
    [allFiles],
  );

  const performMoveToTrash = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;

      const backup = allFiles;

      // optimistic remove
      setAllFiles((prev) => prev.filter((f) => !ids.includes(f.id)));
      setSelected([]);

      try {
        const itemsToTrash = allFiles.filter((f) => ids.includes(f.id));

        await Promise.all(
          itemsToTrash.map(async (f) => {
            const isFolder =
              (f as any).mimeType === "folder" ||
              String(f.id).startsWith("folder:");

            if (isFolder) {
              const rawId = String(f.id).startsWith("folder:")
                ? String(f.id).slice("folder:".length)
                : String(f.id);
              await moveFolderToTrash(rawId);
            } else {
              await moveFileToTrash(String(f.id));
            }
          }),
        );

        notify("Moved to Trash", "success");

        // show undo
        setUndoTrash({
          ids,
          label: ids.length === 1 ? "1 item" : `${ids.length} items`,
          expiresAt: Date.now() + TRASH_UNDO_MS,
        });

        refreshAll();
      } catch (e: any) {
        setAllFiles(backup);
        notify(e?.message || "Failed to move some items to Trash", "error");
      }
    },
    [TRASH_UNDO_MS, allFiles, notify, refreshAll],
  );

  const undoMoveToTrash = useCallback(async () => {
    if (!undoTrash) return;
    if (Date.now() > undoTrash.expiresAt) {
      setUndoTrash(null);
      return;
    }

    const { folderIds, fileIds } = splitSelectionIds(undoTrash.ids);

    try {
      await Promise.all([
        ...folderIds.map((fid) => restoreFolderFromTrash(fid)),
        ...fileIds.map((fid) => restoreFileFromTrash(fid)),
      ]);
      notify("Undo: restored from Trash", "success");
      setUndoTrash(null);
      refreshAll();
    } catch (e: any) {
      notify(e?.message || "Undo failed", "error");
    }
  }, [notify, refreshAll, splitSelectionIds, undoTrash]);

  useEffect(() => {
    if (!undoTrash) return;
    const ms = Math.max(0, undoTrash.expiresAt - Date.now());
    const t = window.setTimeout(() => setUndoTrash(null), ms);
    return () => window.clearTimeout(t);
  }, [undoTrash]);

  const handleDelete = async (file: FileItem) => {
    // safety: never trash inside virtual zip view
    if (virtualZip) {
      notify("Archive browsing is read-only.", "info");
      return;
    }
    openTrashConfirm([String(file.id)]);
  };

  const handleRestore = async (item: FileItem) => {
    const isFolder =
      (item as any).mimeType === "folder" ||
      String(item.id).startsWith("folder:");

    try {
      if (isFolder) {
        const rawId = String(item.id).startsWith("folder:")
          ? String(item.id).slice("folder:".length)
          : String(item.id);

        await restoreFolderFromTrash(rawId);
      } else {
        await restoreFileFromTrash(String(item.id));
      }

      notify("Restored", "success");
      refreshAll();
    } catch (e: any) {
      notify(e?.message || "Restore failed", "error");
    }
  };

  const handleNewFolder = async () => {
    if (virtualZip || viewMode !== "drive") {
      notify("You can only create folders in Drive.", "info");
      return;
    }

    const name = prompt("New folder name");
    if (!name) return;
    try {
      await createFolder(name, currentFolderId);
      notify("Folder created", "success");
      const bc = await buildBreadcrumb(currentFolderId);
      setBreadcrumb(bc);
      refresh();
    } catch (e: any) {
      notify(e?.message || "Failed to create folder", "error");
    }
  };

  // After upload, refresh the listing (removes search-filter insertion logic)
  const handleUploaded = useCallback(
    (nf: FileItem) => {
      notify(`Uploaded ${nf.title}`, "success");
      // Instant UI bump (then we sync from server)
      if (typeof nf.size === "number") {
        setStorageUsedBytes((s) => s + nf.size);
      }
      refreshAll();
      setShowUpload(false);
    },
    [notify, refresh],
  );

  const handleRename = async (file: FileItem, newName?: string) => {
    const name = (newName ?? prompt("Rename to", file.title)) || "";
    if (!name || name === file.title) return;
    try {
      if (isFolderItem(file)) {
        await renameFolder(rawFolderId(String(file.id)), name);
      } else {
        await renameFile(String(file.id), name);
      }

      notify("Renamed", "success");
      refresh();
    } catch (e: any) {
      notify(e?.message || "Rename failed", "error");
    }
  };

  const handleCopy = useCallback(
    (sel?: FileItem[]) => {
      const curr = sel && sel.length ? sel : selected;
      if (curr.length) setClipboard({ mode: "copy", files: curr });
    },
    [selected],
  );

  const handleCut = useCallback(
    (sel?: FileItem[]) => {
      const curr = sel && sel.length ? sel : selected;
      if (curr.length) setClipboard({ mode: "cut", files: curr });
    },
    [selected],
  );

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;

    // Safety: archive browsing is read-only
    if (virtualZip) {
      notify("Archive browsing is read-only.", "info");
      return;
    }

    // Safety: only allow paste in Drive
    if (viewMode !== "drive") {
      notify("This view is read-only.", "info");
      return;
    }

    const isFolderItem = (f: FileItem) =>
      (f as any)?.mimeType === "folder" ||
      String((f as any)?.id).startsWith("folder:");
    const rawFolderId = (id: string) =>
      id.startsWith("folder:") ? id.slice("folder:".length) : id;

    const folderIds = clipboard.files
      .filter(isFolderItem)
      .map((f) => rawFolderId(String(f.id)));
    const fileIds = clipboard.files
      .filter((f) => !isFolderItem(f))
      .map((f) => String(f.id));

    try {
      if (clipboard.mode === "copy") {
        // Copying folders (deep copy) isn't implemented on the backend yet.
        if (folderIds.length > 0) {
          notify(
            "Copying folders is not supported yet. Select files only.",
            "info",
          );
        }
        if (fileIds.length > 0) {
          await Promise.all(
            fileIds.map((id) => duplicateFile(id, currentFolderId ?? null)),
          );
          notify(`Copied ${fileIds.length} file(s)`, "success");
        }
      } else {
        const moves: Promise<any>[] = [];
        if (fileIds.length > 0)
          moves.push(
            ...fileIds.map((id) => moveFile(id, currentFolderId ?? null)),
          );
        if (folderIds.length > 0)
          moves.push(
            ...folderIds.map((id) => moveFolder(id, currentFolderId ?? null)),
          );
        if (moves.length > 0) await Promise.all(moves);
        notify(`Moved ${fileIds.length + folderIds.length} item(s)`, "success");
      }

      // Copy increases storage; Move does not
      if (clipboard.mode === "copy") {
        const added = clipboard.files.reduce((acc, f) => {
          if (isFolderItem(f)) return acc;
          return acc + (typeof f.size === "number" ? f.size : 0);
        }, 0);
        if (added > 0) setStorageUsedBytes((s) => s + added);
      }

      refreshAll();
    } catch (e: any) {
      notify(e?.message || "Paste failed", "error");
    } finally {
      setClipboard(null);
    }
  }, [clipboard, currentFolderId, notify, refreshAll, viewMode, virtualZip]);

  const buildEmptyBGMenu = useCallback((): MenuItem[] => {
    const isReadOnlyHere = !!virtualZip || viewMode !== "drive";

    const items: MenuItem[] = [
      {
        type: "item",
        id: "new-folder",
        label: "New folder",
        disabled: isReadOnlyHere,
        onSelect: () => {
          void handleNewFolder();
        },
      },
      {
        type: "item",
        id: "upload",
        label: "Upload files",
        disabled: isReadOnlyHere,
        onSelect: () => setShowUpload(true),
      },
    ];

    if (clipboard?.files?.length && !isReadOnlyHere) {
      items.push({ type: "separator" });
      items.push({
        type: "item",
        id: "paste",
        label: clipboard.mode === "cut" ? "Move here" : "Paste",
        shortcut: "Ctrl+V",
        onSelect: () => {
          void handlePaste();
        },
      });
    }

    items.push({ type: "separator" });
    items.push({
      type: "item",
      id: "refresh",
      label: "Refresh",
      onSelect: () => refreshAll(),
    });

    return items;
  }, [
    clipboard,
    handlePaste,
    refreshAll,
    handleNewFolder,
    viewMode,
    virtualZip,
  ]);

  // Drag and drop handlers
  const handleDragStart = useCallback((_ids: string[]) => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback((_ids: string[]) => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (ids: string[], targetFolderId: string | null) => {
      if (!ids.length) return;

      // Safety: archive browsing is read-only
      if (virtualZip) {
        notify("Archive browsing is read-only.", "info");
        return;
      }

      // Safety: don't allow moving while viewing Trash
      if (viewMode === "trash" || currentFolderId === "trash") {
        notify("Restore items first — moving from Trash is disabled.", "info");
        return;
      }

      // No-op move (dropping into the same folder)
      if ((currentFolderId ?? null) === (targetFolderId ?? null)) return;

      try {
        const { fileIds, folderIds } = splitSelectionIds(ids);

        // Prevent moving a folder into itself (client-side guard)
        if (targetFolderId && folderIds.includes(targetFolderId)) {
          notify("You can’t move a folder into itself.", "info");
          return;
        }

        const moves: Promise<any>[] = [];
        if (fileIds.length > 0)
          moves.push(...fileIds.map((id) => moveFile(id, targetFolderId)));
        if (folderIds.length > 0)
          moves.push(...folderIds.map((id) => moveFolder(id, targetFolderId)));

        if (moves.length > 0) await Promise.all(moves);

        notify(`Moved ${fileIds.length + folderIds.length} item(s)`, "success");

        refresh();
      } catch {
        notify("Move failed", "error");
      }
    },
    [notify, refresh, currentFolderId, viewMode, virtualZip],
  );

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );

  // ------- Navigation handlers  -------
  const onZipSelect = useCallback(
    async (zipId: string, label: string, prefix = "") => {
      setSelected([]);
      setEmptyBgMenu(null);

      const entry = makeZipHist(zipId, prefix);
      const currentEntry = history[historyIndex] ?? "";
      if (currentEntry !== entry) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(entry);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }

      setViewMode("drive");
      setCurrentFolderId(undefined);
      setVirtualZip({ zipId, label, prefix });
      setPage(1);
      setBreadcrumb(buildZipBreadcrumb(zipId, label, prefix));
    },
    [history, historyIndex, buildZipBreadcrumb],
  );

  const onViewSelect = useCallback(
    async (mode: "trash" | "favorites") => {
      setSelected([]);

      // Snapshot where we were in Drive so we can restore it later
      if (viewMode === "drive") {
        lastDriveLocationRef.current = {
          folderId: currentFolderId,
          breadcrumb,
        };
      }

      setEmptyBgMenu(null);
      setVirtualZip(null);

      // Store view navigation in local history (so Back/Forward works)
      const token = mode; // history token ("trash" | "favorites")
      const currentEntry = history[historyIndex] ?? "";
      if (currentEntry !== token) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(token);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }

      setViewMode(mode);
      setCurrentFolderId(undefined);
      setPage(1);
      setBreadcrumb([
        { name: "Home" },
        { id: mode, name: mode === "trash" ? "Trash" : "Favorites" },
      ]);
    },
    [history, historyIndex, viewMode, currentFolderId, breadcrumb],
  );

  const onFolderSelect = useCallback(
    async (
      id?: string,
      folderName?: string,
      parentIdOverride?: string | null,
    ) => {
      setSelected([]);
      setEmptyBgMenu(null);

      const folderId = id || "";
      setVirtualZip(null);

      // Route special views WITHOUT treating them as folder IDs
      if (folderId === "trash") {
        await onViewSelect("trash");
        return;
      }
      if (folderId === "favorites") {
        await onViewSelect("favorites");
        return;
      }

      setViewMode("drive");

      // If user is coming back from Trash/Favorites and clicks Home,
      // restore their last Drive folder instead of dumping them at root.
      if (!folderId && viewMode !== "drive" && lastDriveLocationRef.current) {
        const saved = lastDriveLocationRef.current;
        setCurrentFolderId(saved.folderId);
        setBreadcrumb(saved.breadcrumb);
        setPage(1);

        // Also push the restored folder into history so Back/Forward feels consistent
        const token = saved.folderId ?? "";
        const currentEntry = history[historyIndex] ?? "";
        if (currentEntry !== token) {
          const newHistory = history.slice(0, historyIndex + 1);
          newHistory.push(token);
          setHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
        }
        return;
      }

      // Update history ONLY if folder actually changed
      const currentHistFolder = history[historyIndex] ?? "";
      if (currentHistFolder !== folderId) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(folderId);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }

      // Optimistically cache folder metadata when caller provides a name
      // so buildBreadcrumb can pick it up immediately without an extra fetch.
      if (id && folderName) {
        folderCache.current.set(id, {
          id,
          name: folderName,
          // IMPORTANT: for "open child folder from list", parent is currentFolderId.
          // For breadcrumb navigation, caller will pass the correct parentIdOverride.
          parentId: parentIdOverride ?? currentFolderId ?? null,
        });
      }

      setCurrentFolderId(id);
      setPage(1);
      const bc = await buildBreadcrumb(id);
      setBreadcrumb(bc);
    },
    [
      buildBreadcrumb,
      history,
      historyIndex,
      currentFolderId,
      onViewSelect,
      viewMode,
      breadcrumb,
    ],
  );

  const paletteCommands: PaletteCommand[] = useMemo(() => {
    const cmds: PaletteCommand[] = [];
    const isReadOnly = !!virtualZip || viewMode !== "drive";

    // Navigation
    cmds.push({
      id: "nav.home",
      title: "Go to Home",
      subtitle: "Root folder",
      group: "Navigation",
      keywords: ["home", "root"],
      run: () => void onFolderSelect(undefined, "Home"),
    });

    cmds.push({
      id: "nav.favorites",
      title: "Go to Favorites",
      subtitle: "Your favorited files",
      group: "Navigation",
      keywords: ["favorites", "star", "liked"],
      run: () => void onViewSelect("favorites"),
    });

    cmds.push({
      id: "nav.trash",
      title: "Go to Trash",
      subtitle: "Deleted files",
      group: "Navigation",
      keywords: ["trash", "bin", "deleted"],
      run: () => void onViewSelect("trash"),
    });

    // Actions
    cmds.push({
      id: "action.upload",
      title: "Upload files",
      subtitle: "Open upload dialog",
      group: "Actions",
      keywords: ["upload", "import", "add"],
      run: () => {
        if (isReadOnly) {
          notify("This view is read-only.", "info");
          return;
        }
        setShowUpload(true);
      },
    });

    cmds.push({
      id: "action.newfolder",
      title: "Create folder",
      subtitle: "Create a folder in current location",
      group: "Actions",
      keywords: ["new folder", "mkdir", "create"],
      run: () => {
        if (isReadOnly) {
          notify("You can only create folders in Drive.", "info");
          return;
        }
        void handleNewFolder();
      },
    });

    // Search
    cmds.push({
      id: "search.clear",
      title: "Clear search",
      subtitle: "Reset query and reload listing",
      group: "Search",
      keywords: ["clear", "reset", "remove filter"],
      run: () => {
        setSearch("");
        setSearchQuery("");
        setPage(1);
        setSelected([]);
        setEmptyBgMenu(null);
      },
    });

    // View / layout
    cmds.push({
      id: "view.icons",
      title: "Switch to Icon view",
      subtitle: "Compact icon grid",
      group: "View",
      keywords: ["icons", "grid"],
      run: () => setLayout("icons"),
    });

    cmds.push({
      id: "view.details",
      title: "Switch to Details view",
      subtitle: "Table with columns",
      group: "View",
      keywords: ["details", "table"],
      run: () => setLayout("details"),
    });

    cmds.push({
      id: "view.list",
      title: "Switch to List view",
      subtitle: "Simple list",
      group: "View",
      keywords: ["list"],
      run: () => setLayout("list"),
    });

    cmds.push({
      id: "view.large",
      title: "Switch to Large view",
      subtitle: "Large thumbnails",
      group: "View",
      keywords: ["large", "thumbnails"],
      run: () => setLayout("large"),
    });

    cmds.push({
      id: "view.density",
      title: density === "compact" ? "Set Cozy density" : "Set Compact density",
      subtitle: "Change row spacing",
      group: "View",
      keywords: ["density", "spacing", "compact"],
      run: () => setDensity((d) => (d === "compact" ? "cozy" : "compact")),
    });

    cmds.push({
      id: "view.focus",
      title: focusMode ? "Exit Focus Mode" : "Enter Focus Mode",
      subtitle: "Collapse the sidebar for distraction-free work",
      group: "View",
      keywords: ["focus", "zen", "sidebar", "collapse"],
      run: () => setFocusMode((v) => !v),
    });

    // Sort
    cmds.push({
      id: "sort.name",
      title: "Sort by Name",
      subtitle: "A → Z / Z → A",
      group: "Sort",
      keywords: ["sort", "name", "title"],
      run: () => {
        setSortKey("name");
        setSortDir((d) =>
          sortKey === "name" ? (d === "asc" ? "desc" : "asc") : "asc",
        );
        setPage(1);
      },
    });

    cmds.push({
      id: "sort.date",
      title: "Sort by Date",
      subtitle: "Newest / Oldest",
      group: "Sort",
      keywords: ["sort", "date", "created"],
      run: () => {
        setSortKey("date");
        setSortDir((d) =>
          sortKey === "date" ? (d === "asc" ? "desc" : "asc") : "desc",
        );
        setPage(1);
      },
    });

    cmds.push({
      id: "sort.size",
      title: "Sort by Size",
      subtitle: "Largest / Smallest",
      group: "Sort",
      keywords: ["sort", "size"],
      run: () => {
        setSortKey("size");
        setSortDir((d) =>
          sortKey === "size" ? (d === "asc" ? "desc" : "asc") : "desc",
        );
        setPage(1);
      },
    });

    cmds.push({
      id: "sort.type",
      title: "Sort by Type",
      subtitle: "A → Z / Z → A",
      group: "Sort",
      keywords: ["sort", "type", "mime"],
      run: () => {
        setSortKey("type");
        setSortDir((d) =>
          sortKey === "type" ? (d === "asc" ? "desc" : "asc") : "asc",
        );
        setPage(1);
      },
    });

    // Help
    cmds.push({
      id: "help.hotkeys",
      title: "Show hotkeys",
      subtitle: "Keyboard shortcuts overlay",
      group: "Help",
      keywords: ["help", "shortcuts", "hotkeys"],
      run: () => setShowHotkeys(true),
    });

    // -------------------------
    // Contextual (Selection)
    // -------------------------
    if (selectedSingle) {
      const isFolder = isFolderItem(selectedSingle);

      cmds.push({
        id: "sel.preview",
        title: "Open Preview",
        subtitle: "Preview selected file",
        group: "Selection",
        keywords: ["open", "preview", "view"],
        run: async () => {
          if (isFolder) return;

          try {
            setPreviewFocusTags(false);

            const hasDetail =
              !!(selectedSingle as any).mimeType &&
              typeof (selectedSingle as any).size === "number";

            if (hasDetail) {
              handleOpenPreview(selectedSingle as any);
              return;
            }

            const detail = await getFileById(String(selectedSingle.id));
            handleOpenPreview(normalizeFileDetail(detail as any));
          } catch (e) {
            console.error(e);
            notify("Couldn't open preview for the selected file.", "error");
          }
        },
      });

      cmds.push({
        id: "sel.tags",
        title: "Tag selected",
        subtitle: "Open preview focused on tags",
        group: "Selection",
        keywords: ["tag", "labels", "ai tag"],
        run: async () => {
          if (isFolder) return;

          try {
            setPreviewFocusTags(true);

            const hasDetail =
              !!(selectedSingle as any).mimeType &&
              typeof (selectedSingle as any).size === "number";

            if (hasDetail) {
              handleOpenPreview(selectedSingle as any);
              return;
            }

            const detail = await getFileById(String(selectedSingle.id));
            handleOpenPreview(normalizeFileDetail(detail as any));
          } catch (e) {
            console.error(e);
            notify("Couldn't open tagging for the selected file.", "error");
          }
        },
      });

      cmds.push({
        id: "sel.download",
        title: "Download selected",
        subtitle: "Download selected file",
        group: "Selection",
        keywords: ["download", "export", "save"],
        run: () => {
          if (isFolder) return;
          handleDownload(selectedSingle as any);
        },
      });

      cmds.push({
        id: "sel.favorite",
        title: (selectedSingle as any).isFavorited
          ? "Unfavorite selected"
          : "Favorite selected",
        subtitle: "Toggle favorite",
        group: "Selection",
        keywords: ["favorite", "star", "like"],
        run: () => {
          handleToggleFavorite(selectedSingle as any);
        },
      });
    }

    return cmds;
  }, [
    onFolderSelect,
    handleNewFolder,
    density,
    focusMode,
    sortKey,
    setSearch,
    setSearchQuery,
    setPage,
    setSelected,
    setEmptyBgMenu,
    setLayout,
    setDensity,
    setFocusMode,
    setSortKey,
    setSortDir,
    setShowUpload,
    setShowHotkeys,
    selectedSingle,
    handleOpenPreview,
    handleDownload,
    handleToggleFavorite,
    notify,
    getFileById,
    normalizeFileDetail,
    setPreviewFocusTags,
    onViewSelect,
    viewMode,
    virtualZip,
  ]);

  const handleBack = useCallback(() => {
    if (historyIndex <= 0) return;

    setSelected([]);
    setEmptyBgMenu(null);

    const newIndex = historyIndex - 1;
    const entry = history[newIndex] ?? "";

    setHistoryIndex(newIndex);
    setPage(1);

    if (isZipHist(entry)) {
      const { zipId, prefix } = parseZipHist(entry);
      const label = virtualZip?.zipId === zipId ? virtualZip.label : "Archive";

      setViewMode("drive");
      setCurrentFolderId(undefined);
      setVirtualZip({ zipId, label, prefix });
      setBreadcrumb(buildZipBreadcrumb(zipId, label, prefix));
      return;
    }

    setVirtualZip(null);

    if (entry === "trash" || entry === "favorites") {
      setViewMode(entry);
      setBreadcrumb([
        { name: "Home" },
        { id: entry, name: entry === "trash" ? "Trash" : "Favorites" },
      ]);
      return;
    }

    const folderId = entry || undefined;

    // Polished behavior: if leaving Favorites/Trash and the history entry is "Home" (root),
    // restore last Drive location instead of dumping user at root.
    if (!folderId && viewMode !== "drive" && lastDriveLocationRef.current) {
      const saved = lastDriveLocationRef.current;
      setViewMode("drive");
      setCurrentFolderId(saved.folderId);
      setBreadcrumb(saved.breadcrumb);
      return;
    }

    setViewMode("drive");
    setCurrentFolderId(folderId);
    buildBreadcrumb(folderId).then(setBreadcrumb);
  }, [
    history,
    historyIndex,
    buildBreadcrumb,
    buildZipBreadcrumb,
    virtualZip,
    viewMode,
  ]);

  const handleForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;

    setSelected([]);
    setEmptyBgMenu(null);

    const newIndex = historyIndex + 1;
    const entry = history[newIndex] ?? "";

    setHistoryIndex(newIndex);
    setPage(1);

    if (isZipHist(entry)) {
      const { zipId, prefix } = parseZipHist(entry);
      const label = virtualZip?.zipId === zipId ? virtualZip.label : "Archive";

      setViewMode("drive");
      setCurrentFolderId(undefined);
      setVirtualZip({ zipId, label, prefix });
      setBreadcrumb(buildZipBreadcrumb(zipId, label, prefix));
      return;
    }

    setVirtualZip(null);

    if (entry === "trash" || entry === "favorites") {
      setViewMode(entry);
      setBreadcrumb([
        { name: "Home" },
        { id: entry, name: entry === "trash" ? "Trash" : "Favorites" },
      ]);
      return;
    }

    const folderId = entry || undefined;

    // Polished behavior: if leaving Favorites/Trash and the history entry is "Home" (root),
    // restore last Drive location instead of dumping user at root.
    if (!folderId && viewMode !== "drive" && lastDriveLocationRef.current) {
      const saved = lastDriveLocationRef.current;
      setViewMode("drive");
      setCurrentFolderId(saved.folderId);
      setBreadcrumb(saved.breadcrumb);
      return;
    }

    setViewMode("drive");
    setCurrentFolderId(folderId);
    buildBreadcrumb(folderId).then(setBreadcrumb);
  }, [
    history,
    historyIndex,
    buildBreadcrumb,
    buildZipBreadcrumb,
    virtualZip,
    viewMode,
  ]);

  const onCrumbClick = useCallback(
    async (idx: number) => {
      if (idx <= 0) {
        await onFolderSelect(undefined);
        return;
      }

      const target = breadcrumb[idx];
      const tid = String((target as any)?.id ?? "");

      // Zip breadcrumb navigation
      if (tid && isZipHist(tid)) {
        const { zipId, prefix } = parseZipHist(tid);
        const label =
          virtualZip?.zipId === zipId
            ? virtualZip.label
            : breadcrumb[1]?.name || "Archive";
        await onZipSelect(zipId, label, prefix);
        return;
      }

      // Normal folder breadcrumb navigation
      const parentId =
        idx <= 1 ? null : ((breadcrumb[idx - 1] as any)?.id ?? null);

      await onFolderSelect(target.id, target.name, parentId);
    },
    [breadcrumb, onFolderSelect, onZipSelect, virtualZip],
  );

  const onDeleteSelected = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (virtualZip) {
        notify("Archive browsing is read-only.", "info");
        return;
      }
      openTrashConfirm(ids);
    },
    [notify, openTrashConfirm, virtualZip],
  );

  const onRestoreSelected = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (!confirm(`Restore ${ids.length} selected item(s)?`)) return;

      const backup = allFiles;

      // optimistic removal from UI (restored items leave trash)
      setAllFiles((prev) => prev.filter((f) => !ids.includes(f.id)));
      setSelected([]);

      try {
        const itemsToRestore = allFiles.filter((f) => ids.includes(f.id));

        await Promise.all(
          itemsToRestore.map(async (f) => {
            const isFolder =
              (f as any).mimeType === "folder" ||
              String(f.id).startsWith("folder:");

            if (isFolder) {
              const rawId = String(f.id).startsWith("folder:")
                ? String(f.id).slice("folder:".length)
                : String(f.id);

              await restoreFolderFromTrash(rawId);
            } else {
              await restoreFileFromTrash(String(f.id));
            }
          }),
        );

        notify("Restored", "success");
        refreshAll();
      } catch (e: any) {
        setAllFiles(backup);
        notify(e?.message || "Failed to restore some items", "error");
      }
    },
    [allFiles, notify, refreshAll],
  );

  // ---------- NEW: Bulk actions ----------
  const byIds = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      return allFiles.filter((f) => set.has(f.id));
    },
    [allFiles],
  );

  const handleUpdateTags = useCallback(
    async (fileId: string, nextTags: string[]) => {
      if (isFolderId(String(fileId))) {
        notify("Tags for folders aren't supported yet.", "info");
        return;
      }

      // optimistic update
      setAllFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, tags: nextTags } : f)),
      );
      try {
        await updateFileTags(fileId, nextTags);

        // refresh tags list
        setRefreshToken((n) => n + 1);
      } catch (e) {
        notify("Failed to update tags", "error");
        refresh();
      }
    },
    [notify, refresh],
  );

  // Bulk AI auto-tag selected files (progress + cancel + proper errors)
  const onAutoTagSelected = useCallback(
    async (ids: string[]) => {
      if (!ids?.length) return;

      const { fileIds, folderIds } = splitSelectionIds(ids);
      if (folderIds.length > 0) {
        notify(
          "AI auto-tagging folders isn't supported yet (files only).",
          "info",
        );
      }

      const targets = allFiles.filter((f) => fileIds.includes(f.id));
      if (!targets.length) return;

      // init UI
      autoTagCancelRef.current = false;
      setAutoTagUI({
        open: true,
        running: true,
        total: targets.length,
        done: 0,
        success: 0,
        failed: 0,
        currentLabel: "",
        errors: [],
      });

      const labelFor = (f: any) =>
        String(f?.title || f?.name || f?.filename || f?.id || "file");

      const pollOne = async (fileId: string) => {
        // 1) start job
        const { jobId } = await startFileTagJob(fileId);

        // 2) poll job (timeout ~90s)
        let attempt = 0;
        while (attempt < 90) {
          if (autoTagCancelRef.current) {
            throw new Error("Cancelled");
          }

          const data = await getFileTagJob(jobId, fileId);

          if (data?.state === "SUCCESS") {
            const ai = Array.from(
              new Set<string>((data.tags ?? []).map(String)),
            );
            return ai;
          }

          if (data?.state === "FAILURE") {
            throw new Error(data?.error || "AI tagging failed");
          }

          await new Promise((r) => setTimeout(r, 1000));
          attempt++;
        }

        throw new Error("Timed out waiting for AI tags");
      };

      // Small concurrency so UI feels fast without hammering backend
      const CONCURRENCY = Math.min(3, targets.length);
      let cursor = 0;

      const worker = async () => {
        while (true) {
          if (autoTagCancelRef.current) return;

          const i = cursor++;
          const f = targets[i];
          if (!f) return;

          const label = labelFor(f);
          setAutoTagUI((p) => ({ ...p, currentLabel: label }));

          try {
            const aiTags = await pollOne(f.id);

            // optimistic merge everywhere for instant feedback
            patchFileEverywhere(f.id, (current) => ({
              tags: Array.from(new Set([...(current.tags ?? []), ...aiTags])),
              taggingError: null,
            }));

            // replace optimistic state with full server truth
            try {
              const fresh = await getFileById(f.id);
              applyLatestFileEverywhere(fresh);
            } catch {
              // non-fatal — optimistic tags are already visible
            }

            setAutoTagUI((p) => ({
              ...p,
              done: p.done + 1,
              success: p.success + 1,
            }));
          } catch (e: any) {
            // "Cancelled" is not a failure in UX terms
            const msg = String(e?.message || "Auto-tag failed");
            if (msg !== "Cancelled") {
              setAutoTagUI((p) => ({
                ...p,
                done: p.done + 1,
                failed: p.failed + 1,
                errors: [
                  ...p.errors,
                  { id: String(f.id), label, message: msg },
                ].slice(-10),
              }));
            } else {
              // cancelled: count as done so progress completes gracefully
              setAutoTagUI((p) => ({ ...p, done: p.done + 1 }));
            }
          }
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      // finish UI + show summary toast
      setAutoTagUI((p) => ({ ...p, running: false, currentLabel: "" }));

      if (autoTagCancelRef.current) {
        notify("Auto-tag cancelled", "info");
      } else {
        // We can approximate from UI state by reading via updater:
        setAutoTagUI((p) => {
          notify(
            p.failed > 0
              ? `Auto-tag done: ${p.success} success, ${p.failed} failed`
              : `Auto-tag done: ${p.success} tagged`,
            p.failed > 0 ? "error" : "success",
          );
          return p;
        });
      }
    },
    [
      allFiles,
      notify,
      requestCancelAutoTag,
      patchFileEverywhere,
      applyLatestFileEverywhere,
    ],
  );

  const onAddTagSelected = useCallback(
    async (ids: string[], tag: string) => {
      if (!ids.length || !tag) return;

      const { fileIds, folderIds } = splitSelectionIds(ids);
      if (folderIds.length > 0) {
        notify(
          "Folders don't support tags yet (tag applied to files only).",
          "info",
        );
      }
      if (!fileIds.length) return;

      // optimistic tag update
      setAllFiles((prev) =>
        prev.map((f) => {
          if (!fileIds.includes(f.id)) return f;
          const next = Array.from(new Set([...(f.tags || []), tag]));
          return { ...f, tags: next };
        }),
      );

      try {
        await Promise.all(
          fileIds.map(async (id) => {
            const current = allFiles.find((f) => f.id === id)?.tags ?? [];
            const next = Array.from(new Set([...current, tag]));
            await updateFileTags(id, next);
          }),
        );
        notify("Tag added", "success");
      } catch {
        notify("Failed to add tag to some items", "error");
        refresh(); // revert to server truth
      }
    },
    [allFiles, notify, refresh],
  );

  const onFavoriteSelected = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;

      const { fileIds, folderIds } = splitSelectionIds(ids);
      if (folderIds.length > 0) {
        notify(
          "Folders can't be favorited yet (favorited files only).",
          "info",
        );
      }
      if (!fileIds.length) return;

      // optimistic: set favorite true
      setAllFiles((prev) =>
        prev.map((f) =>
          fileIds.includes(f.id)
            ? {
                ...f,
                isFavorited: true,
                favoritesCount: (f.favoritesCount ?? 0) + 1,
              }
            : f,
        ),
      );

      try {
        await Promise.all(fileIds.map((id) => toggleFileFavorite(id, true)));
        notify("Added to favorites", "success");
      } catch {
        notify("Failed to favorite some items", "error");
        refresh();
      }
    },
    [notify, refresh],
  );

  const onExportSelected = useCallback((sel: FileItem[]) => {
    if (!sel.length) return;
    const headers = [
      "id",
      "title",
      "size",
      "mimeType",
      "uploadDate",
      "visibility",
      "tags",
    ];
    const csv = [
      headers.join(","),
      ...sel.map((f) =>
        [
          f.id,
          f.title,
          String(f.size ?? 0),
          f.mimeType ?? "",
          f.uploadDate ?? "",
          f.visibility ?? "",
          (f.tags || []).join("|"),
        ]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "files.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const archiveTrustChips = useMemo(
    () => [
      {
        label: "Revisions",
        value: selectedSingle?.documentRevision?.ordinal
          ? `R${selectedSingle.documentRevision.ordinal}`
          : "Enabled",
        tone: "blue",
      },
      {
        label: "Provenance",
        value: selectedSingle?.captureEvent?.id ? "Recorded" : "Ready",
        tone: "emerald",
      },
      {
        label: "AI tags",
        value:
          selectedSingle?.tags && selectedSingle.tags.length > 0
            ? `${selectedSingle.tags.length} tags`
            : "Available",
        tone: "violet",
      },
    ],
    [selectedSingle],
  );

  return (
    <PageTransition>
      <motion.div
        className="fm-searchfirst h-full py-4 md:py-6 overflow-visible"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* header */}
        <motion.header
          className="fm-archive-header max-w-7xl mx-auto px-1 md:px-0 mb-4 md:mb-5"
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05, duration: 0.45, ease: "easeOut" }}
        >
          <div className="fm-archive-header__row">
            <div className="fm-archive-header__copy">
              <p className="fm-archive-header__eyebrow">CAQM workspace</p>

              <div className="fm-archive-header__headline">
                <h1 className="fm-archive-header__title">Evidence Archive</h1>
                {searchQuery ? (
                  <span className="fm-archive-header__query">
                    Query: “{searchQuery}”
                  </span>
                ) : null}
              </div>

              <p className="fm-archive-header__subtitle">
                High-trust archive for reports, PDFs, captured web evidence,
                revisions, and notebook-ready research assets.
              </p>

              <div className="fm-archive-chip-row">
                {archiveTrustChips.map((chip) => (
                  <span
                    key={chip.label}
                    className="fm-archive-chip"
                    data-tone={chip.tone}
                  >
                    <strong>{chip.label}</strong>
                    <span>{chip.value}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="fm-archive-header__actions">
              {viewMode === "drive" && !virtualZip && (
                <ToolbarButton
                  variant="primary"
                  onClick={() => setShowUpload(true)}
                  className="min-w-[168px] h-11 rounded-full justify-center px-6"
                >
                  Upload evidence
                </ToolbarButton>
              )}

              <button
                type="button"
                className="fm-exec-toggle"
                onClick={() => setFocusMode((v) => !v)}
                title={focusMode ? "Exit Focus Mode" : "Enter Focus Mode"}
                aria-pressed={focusMode}
              >
                {focusMode ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
                <span>{focusMode ? "Focus on" : "Focus off"}</span>
              </button>

              <button
                type="button"
                className="fm-exec-toggle"
                onClick={() => setInspectorOpen((v) => !v)}
                title={inspectorOpen ? "Hide Inspector" : "Show Inspector"}
                aria-pressed={inspectorOpen}
              >
                {inspectorOpen ? (
                  <PanelRightClose className="w-4 h-4" />
                ) : (
                  <PanelRightOpen className="w-4 h-4" />
                )}
                <span>{inspectorOpen ? "Inspector on" : "Inspector off"}</span>
              </button>
            </div>
          </div>

          <div className="fm-archive-stats">
            <div className="fm-archive-stat-card">
              <span className="fm-archive-stat-card__label">Mode</span>
              <strong className="fm-archive-stat-card__value">
                {activeModeLabel}
              </strong>
              <small className="fm-archive-stat-card__meta">
                Archive-first workspace
              </small>
            </div>

            <div className="fm-archive-stat-card">
              <span className="fm-archive-stat-card__label">Location</span>
              <strong className="fm-archive-stat-card__value">
                {activeLocationLabel}
              </strong>
              <small className="fm-archive-stat-card__meta">
                Current evidence scope
              </small>
            </div>

            <div className="fm-archive-stat-card">
              <span className="fm-archive-stat-card__label">Visible items</span>
              <strong className="fm-archive-stat-card__value">
                {visibleFiles.length}
              </strong>
              <small className="fm-archive-stat-card__meta">
                Filtered result set
              </small>
            </div>

            <div className="fm-archive-stat-card">
              <span className="fm-archive-stat-card__label">Storage used</span>
              <strong className="fm-archive-stat-card__value">
                {formatBytes(storageUsedBytes)}
              </strong>
              <small className="fm-archive-stat-card__meta">
                {storagePercent}% of capacity
              </small>
            </div>

            <div className="fm-archive-stat-card">
              <span className="fm-archive-stat-card__label">Sorting</span>
              <strong className="fm-archive-stat-card__value">
                {sortSummaryLabel}
              </strong>
              <small className="fm-archive-stat-card__meta">
                Server-backed ordering
              </small>
            </div>

            {selected.length > 0 && (
              <div className="fm-archive-stat-card fm-archive-stat-card--selected">
                <span className="fm-archive-stat-card__label">Selected</span>
                <strong className="fm-archive-stat-card__value">
                  {selected.length}
                </strong>
                <small className="fm-archive-stat-card__meta">
                  {formatBytes(selectedBytes)}
                </small>
              </div>
            )}
          </div>
        </motion.header>

        {/* Content */}
        <div
          className={`max-w-7xl w-full mx-auto mt-4 ex-grid ${
            focusMode ? "ex-grid--focus" : ""
          }`}
        >
          {/* Left: Quick Access + Folder tree */}
          {!focusMode && (
            <aside className="ex-sidebar">
              <motion.div
                className="ex-sidebar-surface p-4 md:p-5"
                initial={{ x: -10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
              >
                <FileSidebar
                  onFolderSelect={onFolderSelect}
                  onViewSelect={onViewSelect}
                  currentFolderId={currentFolderId}
                  storageUsedBytes={storageUsedBytes}
                  storageCapacityBytes={1024 ** 4}
                  viewMode={viewMode}
                  setViewMode={setViewMode}
                />
              </motion.div>
            </aside>
          )}

          {/* Right: Explorer */}
          <section className="ex-main">
            <div className="ex-main-surface p-4 md:p-5">
              {/* Sticky address bar + command bar */}
              <div className="ex-sticky-top">
                <div className="ex-addressbar">
                  <ExplorerBreadcrumbs
                    path={breadcrumb.map((b, idx) => ({
                      id: b.id ?? `home-${idx}`,
                      label: idx === 0 ? "Home" : b.name,
                      onClick: () => onCrumbClick(idx),
                    }))}
                    currentFolderId={
                      viewMode === "drive" ? (currentFolderId ?? null) : null
                    }
                    onBack={handleBack}
                    onForward={handleForward}
                    backEnabled={historyIndex > 0}
                    forwardEnabled={historyIndex < history.length - 1}
                    onResolvePathText={async (text) => {
                      const parts = text
                        .split(/[\\/]+/)
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const last = parts[parts.length - 1]?.toLowerCase();
                      const match = [...breadcrumb]
                        .reverse()
                        .find((c) => (c.name || "").toLowerCase() === last);
                      return match?.id ?? null;
                    }}
                    onNavigate={async (folderId) => {
                      await onFolderSelect(folderId ?? undefined);
                    }}
                    onSearchSubmit={(q) => {
                      const next = q.trim();
                      if (next === search) return;

                      setSearch(next);
                      setPage(1);
                      setSelected([]);
                      setEmptyBgMenu(null);
                    }}
                    initialSearch={search}
                    searchPlaceholder={
                      virtualZip
                        ? "Search in archive"
                        : viewMode === "favorites"
                          ? "Search favorites"
                          : viewMode === "trash"
                            ? "Search trash"
                            : currentFolderId
                              ? "Search this folder"
                              : "Search drive"
                    }
                  />
                </div>

                <div className="ex-commandbar">
                  <ExplorerCommandBar
                    layout={layout as any}
                    onLayoutChange={(next) => {
                      setLayout(next as Layout);
                      setPage(1);
                    }}
                    onNew={handleNewFolder}
                    onUpload={
                      virtualZip || viewMode !== "drive"
                        ? undefined
                        : () => setShowUpload(true)
                    }
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSortKeyChange={(k) => {
                      setSortKey(k as SortKey);
                      setPage(1);
                    }}
                    onSortDirChange={() => {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      setPage(1);
                    }}
                    isAllSelected={
                      selected.length === allFiles.length && allFiles.length > 0
                    }
                    onSelectAll={handleSelectAll}
                    density={density}
                    onDensityChange={(d) => setDensity(d)}
                  />
                </div>
                {!virtualZip && viewMode !== "trash" && (
                  <div className="fm-filter-strip">
                    <div className="fm-filter-strip__head">
                      <div className="fm-filter-strip__meta">
                        <span
                          className="fm-filter-count"
                          data-active={
                            activeArchiveFilterCount > 0 ? "true" : "false"
                          }
                        >
                          {activeArchiveFilterCount} active
                        </span>

                        {activeArchiveFilterCount > 0 && (
                          <button
                            type="button"
                            className="fm-filter-clear"
                            onClick={clearArchiveFilters}
                          >
                            Clear filters
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="fm-filter-strip__controls">
                      <label className="fm-filter-field">
                        <span>Capture</span>
                        <select
                          className="fm-filter-select"
                          value={archiveFilters.captureKind}
                          onChange={(e) => {
                            setArchiveFilters((prev) => ({
                              ...prev,
                              captureKind: e.target.value as ArchiveCaptureKind,
                            }));
                            setPage(1);
                          }}
                        >
                          <option value="all">All captures</option>
                          <option value="upload">Direct upload</option>
                          <option value="web">Web capture</option>
                        </select>
                      </label>

                      <label className="fm-filter-field">
                        <span>Visibility</span>
                        <select
                          className="fm-filter-select"
                          value={archiveFilters.visibility}
                          onChange={(e) => {
                            setArchiveFilters((prev) => ({
                              ...prev,
                              visibility: e.target.value as
                                | "all"
                                | "public"
                                | "private",
                            }));
                            setPage(1);
                          }}
                        >
                          <option value="all">All visibility</option>
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                      </label>

                      <label className="fm-filter-field">
                        <span>Integrity</span>
                        <select
                          className="fm-filter-select"
                          value={archiveFilters.integrity}
                          onChange={(e) => {
                            setArchiveFilters((prev) => ({
                              ...prev,
                              integrity: e.target.value as ArchiveIntegrityKind,
                            }));
                            setPage(1);
                          }}
                        >
                          <option value="all">All integrity states</option>
                          <option value="verified">Verified hash</option>
                          <option value="hashed">Any hash present</option>
                          <option value="pending">Hash pending</option>
                        </select>
                      </label>

                      <label className="fm-filter-field">
                        <span>Revision</span>
                        <select
                          className="fm-filter-select"
                          value={archiveFilters.revision}
                          onChange={(e) => {
                            setArchiveFilters((prev) => ({
                              ...prev,
                              revision: e.target.value as ArchiveRevisionKind,
                            }));
                            setPage(1);
                          }}
                        >
                          <option value="all">All files</option>
                          <option value="revisioned">Revisioned only</option>
                          <option value="base">Base files only</option>
                        </select>
                      </label>

                      <label className="fm-filter-field">
                        <span>Source domain</span>
                        <input
                          className="fm-filter-input"
                          type="search"
                          placeholder="caqm.nic.in or nytimes.com"
                          value={archiveFilters.sourceDomain}
                          onChange={(e) => {
                            setArchiveFilters((prev) => ({
                              ...prev,
                              sourceDomain: e.target.value,
                            }));
                            setPage(1);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                {!virtualZip && viewMode === "drive" && (
                  <div className="fm-view-presets">
                    <div className="fm-view-presets__head">
                      <div>
                        <div className="fm-view-presets__eyebrow">
                          Analyst views
                        </div>
                        <div className="fm-view-presets__title">
                          Switch between recurring CAQM workflows and save your
                          own archive states for review, provenance checks, and
                          evidence triage.
                        </div>
                      </div>

                      <div className="fm-view-presets__actions">
                        <span
                          className="fm-view-presets__status"
                          data-dirty={
                            activeArchiveViewIsDirty ? "true" : "false"
                          }
                        >
                          {activeArchiveViewIsDirty
                            ? `Edited from ${activeArchiveView.name}`
                            : `Active: ${activeArchiveView.name}`}
                        </span>

                        <button
                          type="button"
                          className="fm-view-presets__btn fm-view-presets__btn--primary"
                          onClick={saveCurrentArchiveView}
                        >
                          Save current view
                        </button>

                        {!activeArchiveView.builtIn && (
                          <button
                            type="button"
                            className="fm-view-presets__btn"
                            onClick={deleteActiveArchiveView}
                          >
                            Delete saved view
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="fm-view-presets__row">
                      {allArchiveViews.map((view) => {
                        const isActive =
                          activeArchiveViewId === view.id &&
                          !activeArchiveViewIsDirty;
                        const isEdited =
                          activeArchiveViewId === view.id &&
                          activeArchiveViewIsDirty;

                        return (
                          <button
                            key={view.id}
                            type="button"
                            className="fm-view-preset"
                            data-active={isActive ? "true" : "false"}
                            data-edited={isEdited ? "true" : "false"}
                            data-kind={view.builtIn ? "builtin" : "saved"}
                            onClick={() => applyArchiveView(view)}
                          >
                            <span className="fm-view-preset__name">
                              {view.name}
                            </span>
                            <span className="fm-view-preset__meta">
                              {view.builtIn ? "Built-in" : "Saved"}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="fm-sort-shortcuts">
                      <div className="fm-view-presets__eyebrow">
                        Quick sorting
                      </div>

                      <div className="fm-sort-shortcuts__row">
                        <button
                          type="button"
                          className="fm-sort-shortcut"
                          data-active={
                            sortKey === "date" && sortDir === "desc"
                              ? "true"
                              : "false"
                          }
                          onClick={() => applySortShortcut("date", "desc")}
                        >
                          Newest first
                        </button>

                        <button
                          type="button"
                          className="fm-sort-shortcut"
                          data-active={
                            sortKey === "name" && sortDir === "asc"
                              ? "true"
                              : "false"
                          }
                          onClick={() => applySortShortcut("name", "asc")}
                        >
                          Name A–Z
                        </button>

                        <button
                          type="button"
                          className="fm-sort-shortcut"
                          data-active={
                            sortKey === "size" && sortDir === "desc"
                              ? "true"
                              : "false"
                          }
                          onClick={() => applySortShortcut("size", "desc")}
                        >
                          Largest first
                        </button>

                        <button
                          type="button"
                          className="fm-sort-shortcut"
                          data-active={
                            sortKey === "type" && sortDir === "asc"
                              ? "true"
                              : "false"
                          }
                          onClick={() => applySortShortcut("type", "asc")}
                        >
                          File type
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Workspace */}
              <div
                className="ex-workspace space-y-4"
                data-density={density}
                data-layout={layout}
              >
                {/* NEW: Bulk action bar (appears when you have a selection) */}
                {selected.length > 0 && (
                  <motion.div
                    className="sticky top-4 z-10 mt-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <ToolbarButton
                      variant="primary"
                      onClick={() =>
                        onAutoTagSelected(selected.map((s) => s.id))
                      }
                      title="Run AI auto-tag on selected files"
                      className="mr-2 mb-2"
                    >
                      AI Auto-Tag selected
                    </ToolbarButton>
                    <BulkActionBar
                      selected={selected}
                      onDelete={
                        viewMode === "trash"
                          ? onRestoreSelected
                          : onDeleteSelected
                      }
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

                <div
                  className={
                    !focusMode && inspectorOpen
                      ? "grid gap-4 items-start xl:grid-cols-[minmax(0,1fr)_360px]"
                      : "grid gap-4"
                  }
                >
                  <div className="min-w-0 space-y-4">
                    {/* Files list */}
                    <motion.div
                      className="fm-panel"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        delay: 0.45,
                        duration: 0.45,
                        ease: "easeOut",
                      }}
                    >
                      <div className="fm-panel-header">
                        <div className="fm-panel-headbar">
                          <div className="fm-panel-headcopy">
                            <span className="fm-panel-eyebrow">
                              {activeModeLabel}
                            </span>
                            <h2 className="fm-panel-heading">
                              {activeLocationLabel}
                            </h2>
                            {search ? (
                              <p className="fm-panel-caption">
                                Filtering results for “{search}”
                              </p>
                            ) : (
                              <p className="fm-panel-caption">
                                Browse and manage files in this workspace
                              </p>
                            )}
                          </div>

                          <div className="fm-panel-headmeta">
                            <span className="fm-panel-meta-pill">
                              {visibleFiles.length} items
                            </span>
                            {selected.length > 0 && (
                              <span className="fm-panel-meta-pill fm-panel-meta-pill--accent">
                                {selected.length} selected
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {isLoading && (
                        <div className="p-6 text-sm opacity-70">Loading…</div>
                      )}
                      {error && !isLoading && (
                        <div className="m-4 p-3 rounded bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200">
                          {error}
                        </div>
                      )}
                      {!isLoading && !error && visibleFiles.length === 0 && (
                        <div
                          className="fm-empty"
                          onContextMenu={(e) => {
                            const t = e.target as HTMLElement;

                            if (t.closest("button, a, input, textarea, select"))
                              return;

                            e.preventDefault();
                            setEmptyBgMenu({ x: e.clientX, y: e.clientY });
                          }}
                          onMouseDown={() => setEmptyBgMenu(null)}
                        >
                          <div className="fm-empty-shell">
                            <div className="fm-empty-card">
                              <div
                                className="fm-empty-art"
                                aria-hidden="true"
                              />
                              <div className="fm-empty-eyebrow">
                                Workspace ready
                              </div>
                              <h3 className="fm-empty-title">
                                This workspace is empty
                              </h3>
                              <p className="fm-empty-sub">
                                Upload the first set of files, create folders,
                                or drag and drop documents directly into this
                                view to start building your evidence workspace.
                              </p>

                              {viewMode === "drive" && !virtualZip && (
                                <div className="fm-empty-actions">
                                  <ToolbarButton
                                    variant="outline"
                                    onClick={handleNewFolder}
                                  >
                                    New folder
                                  </ToolbarButton>
                                  <ToolbarButton
                                    variant="primary"
                                    onClick={() => setShowUpload(true)}
                                  >
                                    Upload files
                                  </ToolbarButton>
                                </div>
                              )}

                              <p className="fm-empty-hint">
                                Use folders, favorites, and tags to keep
                                CAQM-ready evidence collections organised.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      {emptyBgMenu && (
                        <ContextMenu
                          open
                          x={emptyBgMenu.x}
                          y={emptyBgMenu.y}
                          items={buildEmptyBGMenu()}
                          onClose={() => setEmptyBgMenu(null)}
                        />
                      )}

                      {clipboard && (
                        <div className="mb-3 rounded-lg border bg-amber-50 dark:bg-amber-900/30 p-3 text-sm flex items-center justify-between">
                          <span>
                            {clipboard.mode === "copy"
                              ? "Ready to paste copy"
                              : "Ready to move"}{" "}
                            — {clipboard.files.length} item(s)
                            {currentFolderId
                              ? " into this folder."
                              : " into Home."}
                          </span>
                          <div className="flex gap-2">
                            <button className="btn" onClick={handlePaste}>
                              Paste here
                            </button>
                            <button
                              className="btn-ghost"
                              onClick={() => setClipboard(null)}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Properties modal */}
                      <PropertiesModal
                        file={propertiesFile}
                        isOpen={showProperties}
                        onClose={() => {
                          setShowProperties(false);
                          setPropertiesFile(null);
                        }}
                        onRefreshMetadata={async (fileId) => {
                          await refreshFileMetadata(fileId);
                          const latest = await getFileById(fileId);
                          applyLatestFileEverywhere(latest);
                        }}
                      />

                      {!isLoading && !error && visibleFiles.length > 0 && (
                        <div>
                          {layout === "large" || layout === "icons" ? (
                            <Large_IconView
                              files={visibleFiles}
                              variant={layout === "icons" ? "icons" : "large"}
                              density={
                                density === "compact" ? "compact" : "cozy"
                              }
                              onOpenVirtual={({ zipId, prefix }) => {
                                const label =
                                  visibleFiles.find(
                                    (x) => String(x.id) === zipId,
                                  )?.title ?? "Archive";
                                void onZipSelect(zipId, label, prefix);
                              }}
                              onOpen={(f) => {
                                const id = String((f as any).id);

                                // Zip folder inside virtual archive
                                if (isZipDirId(id)) {
                                  const { zipId, path } = parseZipItemId(id);
                                  const label =
                                    virtualZip?.zipId === zipId
                                      ? virtualZip.label
                                      : "Archive";
                                  void onZipSelect(zipId, label, path);
                                  return;
                                }

                                // Zip file inside virtual archive
                                if (isZipFileId(id)) {
                                  const { zipId, path } = parseZipItemId(id);
                                  window.open(
                                    streamZipFile(zipId, path),
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                                  return;
                                }

                                // Normal folder/file behavior
                                const isFolder =
                                  String(id).startsWith("folder:");
                                if (isFolder) {
                                  if (viewMode === "trash") {
                                    notify(
                                      "Restore the folder to open it",
                                      "info",
                                    );
                                    return;
                                  }
                                  const folderId = id.startsWith("folder:")
                                    ? id.slice("folder:".length)
                                    : String(id);
                                  onFolderSelect(folderId, (f as any).title);
                                } else {
                                  handleOpenPreview(f as any);
                                }
                              }}
                              selectedIds={selectedIds}
                              onSelectionChange={handleSelectionChangeByIds}
                              sortKey={sortKey}
                              sortDir={sortDir}
                              onShowProperties={(f: FileItem) => {
                                void openProperties(f);
                              }}
                              onDownload={(f) => {
                                const id = String((f as any).id);
                                if (isZipFileId(id)) {
                                  const { zipId, path } = parseZipItemId(id);
                                  window.open(
                                    streamZipFile(zipId, path),
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                                  return;
                                }
                                handleDownloadItem(f);
                              }}
                              onDelete={
                                virtualZip
                                  ? undefined
                                  : viewMode === "trash"
                                    ? handleRestore
                                    : handleDelete
                              }
                              onDeleteMany={
                                virtualZip
                                  ? undefined
                                  : viewMode === "trash"
                                    ? onRestoreSelected
                                    : onDeleteSelected
                              }
                              onPaste={
                                virtualZip || viewMode !== "drive"
                                  ? undefined
                                  : handlePaste
                              }
                              onRename={
                                virtualZip ? undefined : handleRenameById
                              }
                              onCopy={
                                virtualZip
                                  ? undefined
                                  : (ids: string[]) => handleCopy(byIds(ids))
                              }
                              onCut={
                                virtualZip
                                  ? undefined
                                  : (ids: string[]) => handleCut(byIds(ids))
                              }
                              onDragStart={handleDragStart}
                              onDragEnd={() => handleDragEnd([])}
                              onDrop={(e) => {
                                try {
                                  const raw =
                                    e.dataTransfer.getData("text/plain");
                                  const ids = raw ? JSON.parse(raw) : [];
                                  if (viewMode !== "drive") return;

                                  void handleDrop(ids, currentFolderId ?? null);
                                } catch (err) {
                                  console.error(
                                    "Drop payload parse error:",
                                    err,
                                  );
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
                            <Details_ListView
                              {...({
                                viewMode:
                                  layout === "details" ? "details" : "list",
                                files: visibleFiles,
                                layout,
                                selectable: true,
                                selectedIds: selectedIds,

                                onOpenVirtual: ({ zipId, prefix }: any) => {
                                  const label =
                                    visibleFiles.find(
                                      (x) => String(x.id) === String(zipId),
                                    )?.title ?? "Archive";
                                  void onZipSelect(
                                    String(zipId),
                                    label,
                                    String(prefix ?? ""),
                                  );
                                },

                                onOpen: (f: any) => {
                                  const id = String(f?.id ?? "");

                                  // Zip folder inside virtual archive
                                  if (isZipDirId(id)) {
                                    const { zipId, path } = parseZipItemId(id);
                                    const label =
                                      virtualZip?.zipId === zipId
                                        ? virtualZip.label
                                        : "Archive";
                                    void onZipSelect(zipId, label, path);
                                    return;
                                  }

                                  // Zip file inside virtual archive
                                  if (isZipFileId(id)) {
                                    const { zipId, path } = parseZipItemId(id);
                                    window.open(
                                      streamZipFile(zipId, path),
                                      "_blank",
                                      "noopener,noreferrer",
                                    );
                                    return;
                                  }

                                  if (f.mimeType === "folder") {
                                    if (viewMode === "trash") {
                                      notify(
                                        "Restore the folder to open it",
                                        "info",
                                      );
                                      return;
                                    }
                                    const folderId = id.startsWith("folder:")
                                      ? id.slice("folder:".length)
                                      : id;
                                    onFolderSelect(folderId, f.title);
                                  } else {
                                    handleOpenPreview(f as any);
                                  }
                                },

                                onShowProperties: (f: FileItem) => {
                                  void openProperties(f);
                                },

                                onDownload: (f: any) => {
                                  const id = String(f?.id ?? "");
                                  if (isZipFileId(id)) {
                                    const { zipId, path } = parseZipItemId(id);
                                    window.open(
                                      streamZipFile(zipId, path),
                                      "_blank",
                                      "noopener,noreferrer",
                                    );
                                    return;
                                  }
                                  handleDownloadItem(f);
                                },

                                onDelete: virtualZip
                                  ? undefined
                                  : viewMode === "trash"
                                    ? handleRestore
                                    : handleDelete,

                                onDeleteMany: virtualZip
                                  ? undefined
                                  : viewMode === "trash"
                                    ? onRestoreSelected
                                    : onDeleteSelected,

                                clipboard,

                                onPaste:
                                  virtualZip || viewMode !== "drive"
                                    ? undefined
                                    : handlePaste,
                                onUpdateTags: handleUpdateTags,
                                onEditTags: handleEditTagsInPreview,
                                onSelectionChange: handleSelectionChangeByIds,
                                onRename: virtualZip
                                  ? undefined
                                  : handleRenameById,
                                onCopy: virtualZip
                                  ? undefined
                                  : (ids: string[]) => handleCopy(byIds(ids)),
                                onCut: virtualZip
                                  ? undefined
                                  : (ids: string[]) => handleCut(byIds(ids)),
                                onDragStart: handleDragStart,
                                onDragEnd: handleDragEnd,
                                onDrop:
                                  virtualZip || viewMode !== "drive"
                                    ? undefined
                                    : handleDrop,

                                currentFolderId,
                                sortKey,
                                sortDir,
                                onSortChange: (key: any, dir: any) => {
                                  setSortKey(key as SortKey);
                                  setSortDir(dir as SortDir);
                                  setPage(1);
                                },
                                density,
                              } as any)}
                            />
                          )}
                        </div>
                      )}
                    </motion.div>

                    {/* Status bar (Explorer-style) */}
                    <motion.div
                      className="ex-statusbar"
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.9, duration: 0.4 }}
                    >
                      <div className="ex-status-left">
                        <span className="ex-status-pill">
                          {visibleFiles.length} item
                          {visibleFiles.length === 1 ? "" : "s"}
                        </span>

                        {selected.length > 0 && (
                          <span className="ex-status-pill ex-status-pill--accent">
                            {selected.length} selected •{" "}
                            {formatBytes(selectedBytes)}
                          </span>
                        )}

                        <span className="ex-status-pill">
                          This folder • {formatBytes(totalBytes)}
                        </span>
                      </div>

                      <div className="ex-status-right">
                        <select
                          className="ex-page-size"
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                          }}
                        >
                          {[15, 30, 60, 100].map((n) => (
                            <option key={n} value={n}>
                              {n}/page
                            </option>
                          ))}
                        </select>

                        <div className="flex items-center gap-1">
                          <ToolbarButton
                            variant="ghost"
                            className="px-3 py-1.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1}
                          >
                            <ChevronLeft className="w-4 h-4" />
                            Prev
                          </ToolbarButton>

                          <ToolbarButton
                            variant="ghost"
                            className="px-3 py-1.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() =>
                              setPage((p) => Math.min(pageCount, p + 1))
                            }
                            disabled={page >= pageCount}
                          >
                            Next
                            <ChevronRight className="w-4 h-4" />
                          </ToolbarButton>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  {!focusMode && inspectorOpen && (
                    <div className="hidden xl:block w-[360px] shrink-0 sticky top-4">
                      <EvidenceInspector file={selectedSingle} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>

        <CommandPalette
          isOpen={isPaletteOpen}
          onClose={() => setIsPaletteOpen(false)}
          commands={paletteCommands}
        />

        {/* Preview modal */}
        {selectedPreview && (
          <ExplorerPreviewModal
            file={selectedPreview}
            isOpen={true}
            onClose={() => {
              setSelectedPreview(null);
              setPreviewFocusTags(false);
            }}
            onDownload={(f) => handleDownload(f)}
            onToggleFavorite={handleToggleFavorite}
            onTagUpdate={(fileId, newTags) => {
              handleUpdateTags(fileId, newTags);

              patchFileEverywhere(String(fileId), { tags: newTags });

              (async () => {
                try {
                  const fresh = await getFileById(String(fileId));
                  applyLatestFileEverywhere(fresh);
                } catch {
                  // ignore; tags already updated
                }
              })();
            }}
            autoFocusTags={previewFocusTags}
          />
        )}

        {/* Upload modal */}
        <Modal
          open={showUpload}
          onClose={() => setShowUpload(false)}
          title="Upload files"
        >
          <AdvancedFileUpload
            onUploaded={handleUploaded}
            folderId={currentFolderId}
          />
        </Modal>

        {/* Bulk AI auto-tag modal */}
        <Modal
          open={autoTagUI.open}
          onClose={requestCancelAutoTag}
          title="AI auto-tagging"
        >
          <div className="space-y-4">
            <div className="text-sm text-neutral-600 dark:text-neutral-300">
              {autoTagUI.running
                ? "Tagging selected files…"
                : "Finished auto-tagging."}
            </div>

            <div className="text-sm">
              <div className="flex items-center justify-between mb-2">
                <span>
                  {autoTagUI.done}/{autoTagUI.total}
                </span>
                <span>
                  {Math.round(
                    (autoTagUI.done / Math.max(1, autoTagUI.total)) * 100,
                  )}
                  %
                </span>
              </div>

              <div className="h-2 w-full bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-2 bg-black/70 dark:bg-white/70"
                  style={{
                    width: `${Math.round(
                      (autoTagUI.done / Math.max(1, autoTagUI.total)) * 100,
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-3 text-xs text-neutral-600 dark:text-neutral-400 flex gap-4">
                <span>Success: {autoTagUI.success}</span>
                <span>Failed: {autoTagUI.failed}</span>
              </div>

              {autoTagUI.currentLabel && autoTagUI.running && (
                <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                  Current:{" "}
                  <span className="font-medium">{autoTagUI.currentLabel}</span>
                </div>
              )}
            </div>

            {autoTagUI.errors.length > 0 && (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
                <div className="text-sm font-semibold mb-2">Recent errors</div>
                <ul className="text-xs text-neutral-700 dark:text-neutral-300 space-y-1">
                  {autoTagUI.errors.slice(-3).map((e) => (
                    <li key={e.id}>
                      <span className="font-medium">{e.label}:</span>{" "}
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <ToolbarButton variant="ghost" onClick={requestCancelAutoTag}>
                {autoTagUI.running ? "Cancel" : "Close"}
              </ToolbarButton>
            </div>
          </div>
        </Modal>
      </motion.div>

      {/* Confirm: Move to Trash */}
      <Modal
        open={!!trashConfirm}
        onClose={() => setTrashConfirm(null)}
        title="Move to Trash?"
      >
        <div className="space-y-4">
          <div className="text-sm text-neutral-700 dark:text-neutral-300">
            This will move the selected item(s) to Trash. You can undo for 10
            seconds.
          </div>

          {trashConfirm?.names?.length ? (
            <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
              {trashConfirm.names.slice(0, 8).map((n) => (
                <span
                  key={n}
                  className="px-2 py-1 rounded-full bg-black/5 dark:bg-white/10 text-xs"
                >
                  {n}
                </span>
              ))}
              {trashConfirm.names.length > 8 && (
                <span className="text-xs text-neutral-500">
                  +{trashConfirm.names.length - 8} more
                </span>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <ToolbarButton
              variant="ghost"
              onClick={() => setTrashConfirm(null)}
            >
              Cancel
            </ToolbarButton>
            <ToolbarButton
              variant="primary"
              onClick={async () => {
                const ids = trashConfirm?.ids ?? [];
                setTrashConfirm(null);
                await performMoveToTrash(ids);
              }}
            >
              Move to Trash
            </ToolbarButton>
          </div>
        </div>
      </Modal>

      {/* Undo bar */}
      {undoTrash && Date.now() <= undoTrash.expiresAt && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[130]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-2xl px-4 py-3 flex items-center gap-3">
            <div className="text-sm">
              Moved <span className="font-medium">{undoTrash.label}</span> to
              Trash.
            </div>
            <ToolbarButton variant="outline" onClick={undoMoveToTrash}>
              Undo
            </ToolbarButton>
            <ToolbarButton variant="ghost" onClick={() => setUndoTrash(null)}>
              Dismiss
            </ToolbarButton>
          </div>
        </div>
      )}

      {showHotkeys && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[hsl(var(--popover))] border border-[hsl(var(--border))] rounded-2xl shadow-2xl p-6 w-[460px] max-w-[90%]">
            <h2 className="text-lg font-semibold mb-3">Keyboard Shortcuts</h2>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div>
                <kbd className="kbd">Enter</kbd>
              </div>
              <div>Open file / folder</div>
              <div>
                <kbd className="kbd">F2</kbd>
              </div>
              <div>Rename</div>
              <div>
                <kbd className="kbd">Delete</kbd>
              </div>
              <div>Move to trash</div>
              <div>
                <kbd className="kbd">Ctrl + C / V / X</kbd>
              </div>
              <div>Copy / Paste / Cut</div>
              <div>
                <kbd className="kbd">Arrow Keys</kbd>
              </div>
              <div>Navigate items</div>
              <div>
                <kbd className="kbd">Ctrl + F</kbd>
              </div>
              <div>Search within folder</div>
              <div>
                <kbd className="kbd">?</kbd>
              </div>
              <div>Show this overlay</div>
            </div>
            <p className="mt-4 text-xs text-[hsl(var(--muted))]">
              Press Esc to close.
            </p>
          </div>
        </div>
      )}
    </PageTransition>
  );
}
