import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  type BackendStoredFile,
  duplicateFile,
  moveFile,
  getFileTagJob,
  startFileTagJob,
  listFolders,
  getFileById,
  queryFiles,
  getStorageUsage,
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
import FileSidebar from "../components/filemanager/FileSidebar";
import PageTransition from "../components/motion/PageTransition";
import { useExplorerHistory } from "../hooks/useExplorerHistory";
import { formatBytes } from "../utils/fileHelpers";

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

/** Small themed buttons with motion */
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

  // Search text from the header input.
  // Important: the listing is paginated, so we must send search to the server
  // (otherwise users will think items "disappeared" when they exist on other pages).
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

  // ---------- hotkeys overlay ----------
  const [showHotkeys, setShowHotkeys] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?") setShowHotkeys((v) => !v);
      if (e.key === "Escape") setShowHotkeys(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  // properties modal
  const [propertiesFile, setPropertiesFile] = useState<FileItem | null>(null);
  const [showProperties, setShowProperties] = useState<boolean>(false);

  // data
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [storageUsedBytes, setStorageUsedBytes] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"drive" | "trash">("drive");

  // preview + upload modal
  const [selectedPreview, setSelectedPreview] = useState<FileDetail | null>(
    null,
  );
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
  const visibleFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter((f) => (f.title ?? "").toLowerCase().includes(q));
  }, [allFiles, search]);

  // Selection + clipboard for cut/copy/paste
  const [selected, setSelected] = useState<FileItem[]>([]);
  const selectedIds = useMemo(
    () => new Set(selected.map((f) => f.id)),
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
  const handleRenameById = async (id: string, nextName: string) => {
    const file = allFiles.find((f) => f.id === id);
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

  // ------- Data fetch -------
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const inTrash = currentFolderId === "trash";
    const params = new URLSearchParams();
    if (!inTrash) {
      params.set(
        "folderId",
        currentFolderId ? String(currentFolderId) : "root",
      );
    }

    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    // Map frontend sortKey to backend expected values
    const backendSortKey = sortKey === "date" ? "createdAt" : sortKey;
    params.set("sortKey", backendSortKey);
    params.set("sortOrder", sortDir);
    if (searchQuery.trim()) {
      params.set("q", searchQuery.trim());
    }

    (async () => {
      try {
        const data = inTrash
          ? await listTrashFiles(Object.fromEntries(params.entries()))
          : await queryFiles(Object.fromEntries(params.entries()));

        // NEW: fetch child folders for the selected folder (or root)
        const folderRows = inTrash
          ? []
          : await listFolders(currentFolderId ?? "root");

        // Map files to FileItem (existing)
        const fileRows: BackendStoredFile[] = Array.isArray(data)
          ? data
          : Array.isArray(data.items)
            ? data.items
            : [];
        const fileItems: FileItem[] = fileRows.map(toFileItem);

        // Map folders to FileItem-like rows so FileList can render them
        const folderItems: FileItem[] = folderRows.map((fr) => ({
          id: `folder:${fr.id}`,
          title: fr.name,
          description: "",
          uploader: { id: "system", name: "—" },
          uploadDate: fr.createdAt,
          size: 0,
          mimeType: "folder", // <-- key: lets us treat it differently
          tags: [],
          visibility: "private",
        }));

        if (!cancelled) {
          // Folders first, then files (Windows Explorer behavior)
          const items = [...folderItems, ...fileItems];
          setAllFiles(items);

          // Total counts include folders
          const totalCount =
            typeof (data as any)?.total === "number"
              ? (data as any).total + folderItems.length
              : items.length;
          setTotal(totalCount);

          // Bytes: folders count as 0
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
    refreshToken,
  ]);

  // ------- Storage usage (sidebar) -------
  // Sidebar should show *global* usage, not only the current folder's total bytes.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/storage/usage");
        if (!res.ok)
          throw new Error(`Failed to fetch storage usage (${res.status})`);
        const data = await res.json();
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
  const handleOpenPreview = useCallback((f: FileDetail) => {
    setSelectedPreview(f);
    // reset the flag once modal mounts (prevents sticking true for next open)
    setTimeout(() => {}, 0);
  }, []);

  const handleEditTagsInPreview = useCallback(
    (file: FileDetail) => {
      handleOpenPreview(file);
    },
    [handleOpenPreview],
  );

  const handleDownload = (f: FileDetail | FileItem) => {
    window.open(`/api/files/${f.id}/download`, "_blank");
  };
  const handleDownloadItem = (f: FileItem) => handleDownload(f);

  const handleDelete = async (file: FileItem) => {
    const isFolder =
      (file as any).mimeType === "folder" ||
      String(file.id).startsWith("folder:");

    const label = file.title || (isFolder ? "this folder" : "this file");
    if (!confirm(`Move ${label} to Trash?`)) return;

    try {
      if (isFolder) {
        const rawId = String(file.id).startsWith("folder:")
          ? String(file.id).slice("folder:".length)
          : String(file.id);

        await moveFolderToTrash(rawId);
      } else {
        await moveFileToTrash(String(file.id));
      }

      notify("Moved to Trash", "success");

      // Instant UI: if it's a file, subtract its size right away
      if (!isFolder && typeof file.size === "number") {
        setStorageUsedBytes((s) => Math.max(0, s - file.size));
      }

      // Then sync from server (folders can remove many files)
      refreshAll();
    } catch (e: any) {
      notify(e?.message || "Failed to move to Trash", "error");
    }
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
      const res = await fetch(`/api/files/${file.id}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: name }),
      });
      if (!res.ok) throw new Error("Rename failed");
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
  }, [clipboard, currentFolderId, notify, refreshAll]);

  const buildEmptyBGMenu = useCallback((): MenuItem[] => {
    const items: MenuItem[] = [
      {
        type: "item",
        id: "new-folder",
        label: "New folder",
        onSelect: () => {
          void handleNewFolder();
        },
      },
      {
        type: "item",
        id: "upload",
        label: "Upload files",
        onSelect: () => setShowUpload(true),
      },
    ];

    if (clipboard?.files?.length) {
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
  }, [clipboard, handlePaste, refreshAll]);

  // Drag and drop handlers
  const handleDragStart = useCallback((ids: string[]) => {
    setIsDragging(true);
    console.log("Dragging files:", ids);
  }, []);

  const handleDragEnd = useCallback((ids: string[]) => {
    setIsDragging(false);
    console.log("Drag ended for files:", ids);
  }, []);

  const handleDrop = useCallback(
    async (ids: string[], targetFolderId: string | null) => {
      if (!ids.length) return;
      try {
        await Promise.all(ids.map((id) => moveFile(id, targetFolderId)));
        notify(`Moved ${ids.length} item(s)`, "success");
        refresh();
      } catch {
        notify("Move failed", "error");
      }
    },
    [notify, refresh],
  );

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );

  // ------- Navigation handlers  -------
  const onFolderSelect = useCallback(
    async (id?: string, folderName?: string) => {
      setSelected([]);
      setEmptyBgMenu(null);

      const folderId = id || "";
      // Update history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(folderId);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

      // Optimistically cache folder metadata when caller provides a name
      // so buildBreadcrumb can pick it up immediately without an extra fetch.
      if (id && folderName) {
        folderCache.current.set(id, {
          id,
          name: folderName,
          parentId: currentFolderId ?? null,
        });
      }

      setCurrentFolderId(id);
      setPage(1);
      const bc = await buildBreadcrumb(id);
      setBreadcrumb(bc);
    },
    [buildBreadcrumb, history, historyIndex, currentFolderId],
  );

  const handleBack = useCallback(() => {
    if (historyIndex > 0) {
      setSelected([]);
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
      setSelected([]);
      setEmptyBgMenu(null);
      const newIndex = historyIndex + 1;
      const folderId = history[newIndex] || undefined;
      setHistoryIndex(newIndex);
      setCurrentFolderId(folderId);
      setPage(1);
      buildBreadcrumb(folderId).then(setBreadcrumb);
    }
  }, [history, historyIndex, buildBreadcrumb]);

  const onCrumbClick = useCallback(
    async (idx: number) => {
      setSelected([]);
      setEmptyBgMenu(null);
      const target = breadcrumb[idx];
      const bc = await buildBreadcrumb(target.id);
      setBreadcrumb(bc);
      setCurrentFolderId(target.id);
      setPage(1);
    },
    [breadcrumb, buildBreadcrumb],
  );

  const onDeleteSelected = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      if (!confirm(`Move ${ids.length} selected item(s) to Trash?`)) return;

      const backup = allFiles;

      // optimistic removal from UI
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
        refreshAll();
      } catch (e: any) {
        // revert optimistic change if anything failed
        setAllFiles(backup);
        notify(e?.message || "Failed to move some items to Trash", "error");
      }
    },
    [allFiles, notify, refreshAll],
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
      // optimistic update
      setAllFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, tags: nextTags } : f)),
      );
      try {
        await fetch(`/api/files/${fileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: nextTags }),
        });
        // refresh tags list
        setRefreshToken((n) => n + 1);
      } catch (e) {
        notify("Failed to update tags", "error");
        refresh();
      }
    },
    [notify, refresh],
  );

  // Bulk AI auto-tag selected files
  const onAutoTagSelected = useCallback(
    async (ids: string[]) => {
      if (!ids?.length) return;
      const targets = allFiles.filter((f) => ids.includes(f.id));

      for (const f of targets) {
        try {
          // 1) start job
          const { jobId } = await startFileTagJob(f.id);

          // 2) poll job
          let attempt = 0;
          while (attempt < 90) {
            // ~90s
            const data = await getFileTagJob(jobId, f.id);

            if (data?.state === "SUCCESS") {
              const ai = Array.from(
                new Set<string>((data.tags ?? []).map(String)),
              );

              // merge in UI
              const mergedUi = (curr: string[] = []) =>
                Array.from(new Set([...(curr ?? []), ...ai]));

              setAllFiles((prev) =>
                prev.map((x) =>
                  x.id === f.id ? { ...x, tags: mergedUi(x.tags) } : x,
                ),
              );

              // NEW: replace optimistic tags with server truth (backend merge + meta)
              try {
                const fresh = await getFileById(f.id);
                setAllFiles((prev) =>
                  prev.map((x) =>
                    x.id === f.id ? { ...x, tags: fresh.tags ?? [] } : x,
                  ),
                );
              } catch (e) {
                console.warn("Failed to refresh file after AI tag", f.id, e);
              }

              // Persist is handled by GET /api/tag-jobs/:jobId?fileId=... when state=SUCCESS
              break;
            }

            if (data?.state === "FAILURE") {
              throw new Error(data?.error || "AI tagging failed");
            }

            await new Promise((r) => setTimeout(r, 1000));
            attempt++;
          }
        } catch (err) {
          console.error("Auto-tag file failed", f.id, err);
        }
      }
    },
    [allFiles, setAllFiles],
  );

  const onAddTagSelected = useCallback(
    async (ids: string[], tag: string) => {
      if (!ids.length || !tag) return;

      // optimistic tag update
      setAllFiles((prev) =>
        prev.map((f) => {
          if (!ids.includes(f.id)) return f;
          const next = Array.from(new Set([...(f.tags || []), tag]));
          return { ...f, tags: next };
        }),
      );

      try {
        await Promise.all(
          ids.map(async (id) => {
            const current = allFiles.find((f) => f.id === id)?.tags ?? [];
            const next = Array.from(new Set([...current, tag]));
            const res = await fetch(`/api/files/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tags: next }),
            });
            if (!res.ok) throw new Error("Tag patch failed");
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

      // optimistic: set favorite true
      setAllFiles((prev) =>
        prev.map((f) =>
          ids.includes(f.id)
            ? {
                ...f,
                isFavorited: true,
                favoritesCount: (f.favoritesCount ?? 0) + 1,
              }
            : f,
        ),
      );

      try {
        await Promise.all(ids.map((id) => toggleFileFavorite(id, true)));
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

  return (
    <PageTransition>
      <motion.div
        className="h-full py-4 md:py-6 overflow-visible"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <motion.header
          className="page-header max-w-7xl mx-auto px-1 md:px-0 mb-4 md:mb-6"
          initial={{ y: 0, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05, duration: 0.45, ease: "easeOut" }}
        >
          <div className="page-header-main">
            <p className="page-header-kicker">Workspace</p>
            <h1 className="page-header-title">File Explorer</h1>
            <p className="page-header-subtitle">
              Upload, organise, and search all your project files in one focused
              workspace.
            </p>
          </div>

          <div className="page-header-meta">
            <div className="page-header-pill">
              <span className="page-header-pill-label">Files</span>
              <span className="page-header-pill-value">{allFiles.length}</span>
            </div>
            {selected.length > 0 && (
              <div className="page-header-pill page-header-pill--accent">
                <span className="page-header-pill-label">Selected</span>
                <span className="page-header-pill-value">
                  {selected.length}
                </span>
              </div>
            )}
          </div>
        </motion.header>

        {/* Content */}
        <div className="max-w-7xl w-full mx-auto mt-4 ex-grid">
          {/* Left: Quick Access + Folder tree */}
          <aside className="ex-sidebar">
            <motion.div
              className="ex-sidebar-surface p-4 md:p-5"
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6, ease: "easeOut" }}
            >
              <FileSidebar
                onFolderSelect={onFolderSelect}
                currentFolderId={currentFolderId}
                storageUsedBytes={storageUsedBytes}
                storageCapacityBytes={1024 ** 4}
                viewMode={viewMode}
                setViewMode={setViewMode}
              />
            </motion.div>
          </aside>

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
                    currentFolderId={currentFolderId ?? null}
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
                      setCurrentFolderId(folderId ?? undefined);
                      setPage(1);
                      const bc = await buildBreadcrumb(folderId ?? undefined);
                      setBreadcrumb(bc);
                    }}
                    onSearchSubmit={(q) => setSearch(q)}
                    initialSearch={search}
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
                    onUpload={() => setShowUpload(true)}
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
                <motion.div
                  className="fm-panel"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45, duration: 0.45, ease: "easeOut" }}
                >
                  <div className="fm-panel-header">
                    <div className="flex h-11 sm:h-12 items-center justify-between gap-2 px-3 sm:px-4">
                      {/* Left: context + optional search state */}
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full bg-slate-900/[0.02] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
                            {currentFolderId ? "Current folder" : "Home"}
                          </span>
                          {search && (
                            <span className="hidden sm:inline-flex text-[11px] text-[hsl(var(--muted-foreground))]">
                              Filtered by{" "}
                              <span className="ml-1 font-medium">
                                "{search}"
                              </span>
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-[hsl(var(--muted-foreground))] sm:hidden">
                          {visibleFiles.length} items
                        </span>
                      </div>
                      {/* Right: density micro-chips + total items */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className={`fm-chip-density ${density === "cozy" ? "fm-chip-density-active" : ""}`}
                          onClick={() => setDensity("cozy")}
                        >
                          Cozy
                        </button>
                        <button
                          type="button"
                          className={`fm-chip-density ${density === "compact" ? "fm-chip-density-active" : ""}`}
                          onClick={() => setDensity("compact")}
                        >
                          Compact
                        </button>
                        <span className="hidden sm:inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-white/70 px-3 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))] shadow-sm">
                          {visibleFiles.length} items
                        </span>
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

                        // Don't hijack right-click on buttons/inputs/links inside the empty card
                        if (t.closest("button, a, input, textarea, select"))
                          return;

                        e.preventDefault();
                        setEmptyBgMenu({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseDown={() => setEmptyBgMenu(null)}
                    >
                      <h3>This folder is feeling a little empty</h3>
                      <p>
                        Create a new folder, upload files, or drag & drop from
                        your desktop.
                      </p>
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
                        {currentFolderId ? " into this folder." : " into Home."}
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
                    onClose={() => setShowProperties(false)}
                  />

                  {!isLoading && !error && visibleFiles.length > 0 && (
                    <div>
                      {layout === "large" || layout === "icons" ? (
                        <Large_IconView
                          files={visibleFiles}
                          variant={layout === "icons" ? "icons" : "large"}
                          density={density === "compact" ? "compact" : "cozy"}
                          onOpen={(f) => {
                            const isFolder = String(f.id).startsWith("folder:");
                            if (isFolder) {
                              const folderId = f.id.startsWith("folder:")
                                ? f.id.slice("folder:".length)
                                : String(f.id);
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
                            setPropertiesFile(f);
                          }}
                          onDownload={handleDownloadItem}
                          onDelete={
                            currentFolderId === "trash"
                              ? handleRestore
                              : handleDelete
                          }
                          onDeleteMany={
                            currentFolderId === "trash"
                              ? onRestoreSelected
                              : onDeleteSelected
                          }
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
                        <Details_ListView
                          {...({
                            viewMode: layout === "details" ? "details" : "list",
                            files: visibleFiles,
                            layout,
                            selectable: true,
                            selectedIds: selectedIds,
                            onOpen: (f: any) => {
                              if (f.mimeType === "folder") {
                                const folderId = f.id.startsWith("folder:")
                                  ? f.id.slice("folder:".length)
                                  : f.id;
                                onFolderSelect(folderId, f.title);
                              } else {
                                handleOpenPreview(f as any);
                              }
                            },
                            onShowProperties: (f: FileItem) => {
                              setPropertiesFile(f);
                            },
                            onDownload: handleDownloadItem,
                            onDelete:
                              currentFolderId === "trash"
                                ? handleRestore
                                : handleDelete,
                            onDeleteMany:
                              currentFolderId === "trash"
                                ? onRestoreSelected
                                : onDeleteSelected,
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
            </div>
          </section>
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
              setSelectedPreview((prev) =>
                prev && prev.id === fileId ? ({ ...prev, tags } as any) : prev,
              );
            }}
            autoFocusTags={false}
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
      </motion.div>
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
