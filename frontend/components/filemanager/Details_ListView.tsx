import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  KeyboardEvent,
} from "react";
import type { FileItem } from "../../types";
import { formatBytes } from "../../utils/fileHelpers";
import ContextMenu, { type MenuItem } from "../common/ContextMenu";
import { useConfirm } from "../providers/Confirm";

import BookIcon from "../icons/BookIcon";
import ImageIcon from "../icons/ImageIcon";
import VideoIcon from "../icons/VideoIcon";
import MusicIcon from "../icons/MusicIcon";
import ArchiveIcon from "../icons/ArchiveIcon";
import CodeIcon from "../icons/CodeIcon";
import FileIcon from "../icons/FileIcon";
import FolderIcon from "../icons/FolderIcon";

type ViewMode = "details" | "list";
type ColumnKey = "name" | "size" | "date" | "type";

const ALL_COLS: ColumnKey[] = ["name", "size", "date", "type"];

const isZip = (f: FileItem) => {
  const n =
    (f as any).title ||
    (f as any).fileName ||
    (f as any).name ||
    (f as any).filename ||
    "";
  return String(n).toLowerCase().endsWith(".zip");
};

const fileDisplayName = (f: FileItem): string =>
  ((f as any).title ??
    (f as any).fileName ??
    (f as any).name ??
    (f as any).filename ??
    "") as string;

const getDateLabel = (f: FileItem): string => {
  const d =
    (f as any).updatedAt ||
    (f as any).modifiedAt ||
    (f as any).uploadDate ||
    (f as any).createdAt ||
    (f as any).lastModified ||
    null;
  if (!d) return "";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return "";
  }
};

const renderTypeIcon = (f: FileItem) => {
  const name = fileDisplayName(f).toLowerCase();
  const mime = ((f as any).mimeType || (f as any).type || "").toLowerCase();

  if ((f as any).isFolder || mime === "folder") {
    return <FolderIcon />;
  }
  if (mime.startsWith("image/")) return <ImageIcon />;
  if (mime.startsWith("video/")) return <VideoIcon />;
  if (mime.startsWith("audio/")) return <MusicIcon />;
  if (name.endsWith(".zip") || mime.includes("zip")) return <ArchiveIcon />;
  if (mime.includes("pdf") || name.endsWith(".pdf")) return <BookIcon />;
  if (
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.startsWith("text/")
  )
    return <CodeIcon />;

  return <FileIcon />;
};

/** Props aligned with FileManagerPage (ID-based selection & actions). */
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

  onOpen?: (f: FileItem) => void;
  onRename?: (id: string, nextName: string) => void;
  onPreview?: (f: FileItem, opts?: any) => void;
  onDownload?: (f: FileItem) => void;
  onOpenVirtual?: (ctx: { zipId: string; prefix: string }) => void;
  onShowProperties?: (file: FileItem) => void;

  /** drag & drop */
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: (ids: string[]) => void;
  onDrop?: (ids: string[], targetFolderId: string | null) => void;

  /** view/layout */
  currentFolderId?: string | null;
  sortKey?: "name" | "date" | "type" | "size";
  sortDir?: "asc" | "desc";
  onSortChange?: (key: ColumnKey, dir: "asc" | "desc") => void;
  showCheckCol?: boolean;

  /** tokens (from parent) – currently unused but kept for compatibility */
  resetColumnsToken?: number | string;
  autosizeColumnsToken?: number | string;

  layout?: "details" | "list";
  selectable?: boolean;
  clipboard?: unknown;
  density?: "comfortable" | "compact";

  onUpdateTags?: (fileId: string, nextTags: string[]) => Promise<void> | void;
  onEditTags?: (file: any) => void;
  onNew?: (kind: "folder" | "file") => void;
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
  onOpen,
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

  layout,
  selectable = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    file: FileItem;
  } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);

  const { confirm } = useConfirm();

  /** ---- controlled/uncontrolled selection bridge ---- */
  const [selectedIdsInternal, setSelectedIdsInternal] = useState<Set<string>>(
    () => new Set()
  );
  const selectedIds = selectedIdsProp ?? selectedIdsInternal;

  const setSelectedIds = (next: Set<string>) => {
    if (!selectedIdsProp) setSelectedIdsInternal(next);
    onSelectionChange?.(Array.from(next));
  };

  /** ---- view mode ---- */
  const [viewMode, setViewMode] = useState<ViewMode>(
    layout ?? ("details" as ViewMode)
  );
  React.useEffect(() => {
    if (layout) setViewMode(layout);
  }, [layout]);

  /** ---- sorting ---- */
  const [internalSortKey, setInternalSortKey] = useState<ColumnKey>("name");
  const [internalSortDir, setInternalSortDir] = useState<"asc" | "desc">("asc");

  const effectiveSortKey: ColumnKey =
    (sortKey as ColumnKey | undefined) ?? internalSortKey;
  const effectiveSortDir: "asc" | "desc" =
    sortDir ?? internalSortDir ?? "asc";

  const setSort = (key: ColumnKey) => {
    const isSame = effectiveSortKey === key;
    const nextDir: "asc" | "desc" =
      isSame && effectiveSortDir === "asc" ? "desc" : "asc";

    setInternalSortKey(key);
    setInternalSortDir(nextDir);
    onSortChange?.(key, nextDir);
  };

  const sorted = useMemo(() => {
    const arr = [...files];
    const dir = effectiveSortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      const an = fileDisplayName(a).toLowerCase();
      const bn = fileDisplayName(b).toLowerCase();

      switch (effectiveSortKey) {
        case "name":
          return an < bn ? -dir : an > bn ? dir : 0;
        case "date": {
          const ad =
            (a as any).updatedAt ||
            (a as any).modifiedAt ||
            (a as any).uploadDate ||
            0;
          const bd =
            (b as any).updatedAt ||
            (b as any).modifiedAt ||
            (b as any).uploadDate ||
            0;
          return ad < bd ? -dir : ad > bd ? dir : 0;
        }
        case "size": {
          const asz = Number((a as any).size ?? 0);
          const bsz = Number((b as any).size ?? 0);
          return asz < bsz ? -dir : asz > bsz ? dir : 0;
        }
        case "type": {
          const at = ((a as any).mimeType || "").toLowerCase();
          const bt = ((b as any).mimeType || "").toLowerCase();
          return at < bt ? -dir : at > bt ? dir : 0;
        }
        default:
          return 0;
      }
    });

    return arr;
  }, [files, effectiveSortKey, effectiveSortDir]);

  /** ---- selection helpers ---- */
  const handleRowClick = (file: FileItem, e: React.MouseEvent) => {
    if (!selectable) return;
    const id = String((file as any).id ?? (file as any).fileId ?? fileDisplayName(file));
    const next = new Set(selectedIds);
    const isSelected = next.has(id);

    const additive = e.ctrlKey || e.metaKey;

    if (additive) {
      if (isSelected) next.delete(id);
      else next.add(id);
    } else {
      next.clear();
      next.add(id);
    }

    setSelectedIds(next);
  };

  const handleRowDoubleClick = (file: FileItem) => {
    if (isZip(file) && onOpenVirtual) {
      onOpenVirtual({ zipId: (file as any).id, prefix: "" });
      return;
    }
    if (onOpen) {
      onOpen(file);
      return;
    }
    if (onPreview) {
      onPreview(file);
    }
  };

  /** ---- DnD ---- */
  const handleRowDragStart = (e: React.DragEvent, file: FileItem) => {
    const id = String((file as any).id ?? fileDisplayName(file));
    const ids =
      selectedIds.size > 0 && selectedIds.has(id)
        ? Array.from(selectedIds)
        : [id];
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    onDragStart?.(ids);
  };

  const handleRowDragEnd = () => {
    onDragEnd?.(Array.from(selectedIds));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!onDrop) return;

    let ids: string[] = [];
    try {
      const data = e.dataTransfer.getData("text/plain");
      if (data) ids = JSON.parse(data);
    } catch {
      ids = [];
    }

    onDrop(ids, currentFolderId ?? null);
  };

  /** ---- context menus ---- */
  const buildBGMenu = useCallback((): MenuItem[] => {
    const pasteLabel = currentFolderId ? "Paste into this folder" : "Paste";
    return [
      {
        type: "item",
        id: "newfolder",
        label: "New folder",
        onSelect: () => onNew?.("folder"),
      },
      {
        type: "item",
        id: "paste",
        label: pasteLabel,
        shortcut: "Ctrl+V",
        disabled: !onPaste,
        onSelect: () => onPaste?.(),
      },
      { type: "separator" },
      {
        type: "item",
        id: "selectall",
        label: "Select all",
        shortcut: "Ctrl+A",
        onSelect: () => {
          const all = new Set<string>(
            sorted.map((f) => String((f as any).id ?? fileDisplayName(f)))
          );
          setSelectedIds(all);
        },
      },
      ...(onSortChange
        ? ([
            { type: "separator" } as MenuItem,
            { type: "label", label: "Sort by" } as MenuItem,
            {
              type: "item",
              id: "sort_name",
              label: `Name ${
                effectiveSortKey === "name"
                  ? `(${effectiveSortDir})`
                  : ""
              }`,
              onSelect: () => setSort("name"),
            },
            {
              type: "item",
              id: "sort_date",
              label: `Date ${
                effectiveSortKey === "date"
                  ? `(${effectiveSortDir})`
                  : ""
              }`,
              onSelect: () => setSort("date"),
            },
            {
              type: "item",
              id: "sort_type",
              label: `Type ${
                effectiveSortKey === "type"
                  ? `(${effectiveSortDir})`
                  : ""
              }`,
              onSelect: () => setSort("type"),
            },
            {
              type: "item",
              id: "sort_size",
              label: `Size ${
                effectiveSortKey === "size"
                  ? `(${effectiveSortDir})`
                  : ""
              }`,
              onSelect: () => setSort("size"),
            },
          ] as MenuItem[])
        : []),
      ...(onRefresh
        ? ([
            { type: "separator" } as MenuItem,
            {
              type: "item",
              id: "refresh",
              label: "Refresh",
              onSelect: () => onRefresh?.(),
            },
          ] as MenuItem[])
        : []),
    ];
  }, [
    sorted,
    currentFolderId,
    onNew,
    onPaste,
    onSortChange,
    onRefresh,
    setSelectedIds,
    effectiveSortKey,
    effectiveSortDir,
  ]);

  const buildRowMenu = useCallback(
    (file: FileItem): MenuItem[] => {
      const id = String((file as any).id ?? fileDisplayName(file));
      const many = selectedIds.size > 1;
      const targetIds = many ? Array.from(selectedIds) : [id];

      const items: MenuItem[] = [
        {
          type: "item",
          id: "open",
          label: "Open",
          shortcut: "Enter",
          onSelect: () => handleRowDoubleClick(file),
        },
        {
          type: "item",
          id: "preview",
          label: "Preview",
          onSelect: () => onPreview?.(file),
        },
        { type: "separator" },
        {
          type: "item",
          id: "rename",
          label: "Rename",
          shortcut: "F2",
          onSelect: () => {
            if (!onRename) return;
            const current = fileDisplayName(file);
            const next = window.prompt("Rename to:", current);
            if (next && next !== current) onRename(id, next);
          },
        },
        {
          type: "item",
          id: "copy",
          label: many ? `Copy ${targetIds.length} items` : "Copy",
          shortcut: "Ctrl+C",
          onSelect: () => onCopy?.(targetIds),
        },
        {
          type: "item",
          id: "cut",
          label: many ? `Cut ${targetIds.length} items` : "Cut",
          shortcut: "Ctrl+X",
          onSelect: () => onCut?.(targetIds),
        },
        {
          type: "item",
          id: "paste",
          label: "Paste",
          shortcut: "Ctrl+V",
          disabled: !onPaste,
          onSelect: () => onPaste?.(),
        },
        { type: "separator" },
        {
          type: "item",
          id: "download",
          label: "Download",
          onSelect: () => onDownload?.(file),
        },
      ];

      if (isZip(file) && onOpenVirtual) {
        items.push({
          type: "item",
          id: "openzip",
          label: "Open ZIP",
          onSelect: () =>
            onOpenVirtual({ zipId: (file as any).id, prefix: "" }),
        });
      }

      items.push(
        {
          type: "item",
          id: "selectall",
          label: selectedIds.size ? "Deselect all" : "Select all",
          onSelect: () => {
            if (selectedIds.size) {
              setSelectedIds(new Set());
            } else {
              setSelectedIds(
                new Set(
                  files.map((f) =>
                    String((f as any).id ?? fileDisplayName(f))
                  )
                )
              );
            }
          },
        },
        { type: "separator" },
        {
          type: "item",
          id: "delete",
          label: many ? `Delete ${targetIds.length} items` : "Delete",
          danger: true,
          shortcut: "Del",
          onSelect: async () => {
            const ok = await confirm({
              title: "Move to Trash?",
              description: many
                ? `Move ${targetIds.length} items to Trash?`
                : `Move "${fileDisplayName(file)}" to Trash?`,
            });
            if (!ok) return;

            if (many && onDeleteMany) {
              onDeleteMany(targetIds);
              return;
            }
            if (!many && onDelete) {
              onDelete(file);
            }
          },
        }
      );

      if (onShowProperties) {
        items.push({
          type: "item",
          id: "properties",
          label: "Properties",
          shortcut: "Alt+Enter",
          onSelect: () => onShowProperties?.(file),
        });
      }

      return items;
    },
    [
      selectedIds,
      files,
      confirm,
      onCopy,
      onCut,
      onPaste,
      onDelete,
      onDeleteMany,
      onDownload,
      onRename,
      onPreview,
      onOpenVirtual,
      onShowProperties,
      setSelectedIds,
    ]
  );

  /** ---- keyboard shortcuts ---- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.ctrlKey || e.metaKey;
    const selIds = Array.from(selectedIds);

    if (isMod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelectedIds(
        new Set(
          sorted.map((f) => String((f as any).id ?? fileDisplayName(f)))
        )
      );
    }
    if (isMod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      onCopy?.(selIds);
    }
    if (isMod && e.key.toLowerCase() === "x") {
      e.preventDefault();
      onCut?.(selIds);
    }
    if (isMod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      onPaste?.();
    }
    if (e.key === "Delete" && selIds.length) {
      e.preventDefault();
      if (selIds.length > 1 && onDeleteMany) {
        onDeleteMany(selIds);
      } else if (onDelete) {
        const f = sorted.find((x) =>
          selectedIds.has(String((x as any).id ?? fileDisplayName(x)))
        );
        if (f) onDelete(f);
      }
    }
    if (e.key === "Enter" && selIds.length === 1) {
      e.preventDefault();
      const f = sorted.find((x) =>
        selectedIds.has(String((x as any).id ?? fileDisplayName(x)))
      );
      if (f) handleRowDoubleClick(f);
    }
    if (e.altKey && e.key === "Enter" && selIds.length === 1) {
      e.preventDefault();
      const f = sorted.find((x) =>
        selectedIds.has(String((x as any).id ?? fileDisplayName(x)))
      );
      if (f && onShowProperties) onShowProperties(f);
    }
  };

  /** ---- rendering helpers ---- */
  const renderHeader = () => {
    const arrow = (key: ColumnKey) =>
      effectiveSortKey === key ? (effectiveSortDir === "asc" ? "↑" : "↓") : "";

    const labelFor = (key: ColumnKey) => {
      switch (key) {
        case "name":
          return "Name";
        case "size":
          return "Size";
        case "date":
          return "Date modified";
        case "type":
          return "Type";
        default:
          return key;
      }
    };

    return (
      <div className="fm-table-header grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] border-b border-border/70 bg-[hsl(var(--surface-elev))] text-xs uppercase tracking-wide text-muted-foreground select-none">
        {ALL_COLS.map((key) => {
          const common = "px-3 py-2 cursor-pointer";
          const extra =
            key === "name"
              ? "flex items-center gap-2"
              : key === "size"
              ? "text-right"
              : "";

          return (
            <div
              key={key}
              className={`${common} ${extra}`}
              onClick={() => setSort(key)}
            >
              <span>{labelFor(key)}</span>
              <span>{arrow(key)}</span>
            </div>
          );
        })}
      </div>
    );
  };


  const renderDetailsRows = () =>
    sorted.map((f) => {
      const id = String((f as any).id ?? fileDisplayName(f));
      const isSel = selectedIds.has(id);
      const size = (f as any).size;
      const sizeLabel =
        size != null && size !== ""
          ? formatBytes(typeof size === "string" ? parseFloat(size) : size)
          : "";
      const dateLabel = getDateLabel(f);
      const typeLabel = ((f as any).mimeType || "").split("/").pop() || "";

      return (
        <div
          key={id}
          data-row
          data-id={id}
          draggable
          onDragStart={(e) => handleRowDragStart(e, f)}
          onDragEnd={handleRowDragEnd}
          onDoubleClick={() => handleRowDoubleClick(f)}
          onClick={(e) => handleRowClick(f, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selectedIds.has(id)) {
              setSelectedIds(new Set([id]));
            }
            setBgMenu(null);
            setRowMenu({ x: e.clientX, y: e.clientY, file: f });
          }}
          className={`fm-row grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] items-center text-sm border-b border-border/40 hover:bg-[hsl(var(--surface-elev))] ${
            isSel ? "bg-blue-50/70" : ""
          }`}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 min-w-0">
            {showCheckCol && (
              <input
                type="checkbox"
                className="mr-2"
                checked={isSel}
                onChange={(e) => handleRowClick(f, e as any)}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <span className="w-4 h-4 flex-shrink-0">{renderTypeIcon(f)}</span>
            <span className="truncate">{fileDisplayName(f)}</span>
          </div>
          <div className="px-3 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
            {sizeLabel}
          </div>
          <div className="px-3 py-1.5 text-xs text-muted-foreground truncate">
            {dateLabel}
          </div>
          <div className="px-3 py-1.5 text-xs text-muted-foreground truncate">
            {typeLabel}
          </div>
        </div>
      );
    });

  const renderCompactList = () =>
    sorted.map((f) => {
      const id = String((f as any).id ?? fileDisplayName(f));
      const isSel = selectedIds.has(id);
      const size = (f as any).size;
      const sizeLabel =
        size != null && size !== ""
          ? ` • ${formatBytes(
              typeof size === "string" ? parseFloat(size) : size
            )}`
          : "";
      const dateLabel = getDateLabel(f);
      const datePart = dateLabel ? ` • ${dateLabel}` : "";

      return (
        <div
          key={id}
          data-row
          data-id={id}
          draggable
          onDragStart={(e) => handleRowDragStart(e, f)}
          onDragEnd={handleRowDragEnd}
          onDoubleClick={() => handleRowDoubleClick(f)}
          onClick={(e) => handleRowClick(f, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selectedIds.has(id)) {
              setSelectedIds(new Set([id]));
            }
            setBgMenu(null);
            setRowMenu({ x: e.clientX, y: e.clientY, file: f });
          }}
          className={`fm-row flex items-center px-3 py-1.5 text-sm hover:bg-[hsl(var(--surface-elev))] ${
            isSel ? "bg-blue-50/70" : ""
          }`}
        >
          <span className="mr-2 w-4 h-4 flex-shrink-0">
            {renderTypeIcon(f)}
          </span>
          <span className="truncate">
            {fileDisplayName(f)}
            {sizeLabel}
            {datePart}
          </span>
        </div>
      );
    });

  /** ---- render ---- */
  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-auto text-sm"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("[data-row]")) return;
        setSelectedIds(new Set());
        setRowMenu(null);
        setBgMenu(null);
      }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("[data-row]")) return;
        e.preventDefault();
        setRowMenu(null);
        setBgMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {viewMode === "details" && (
        <div data-view="details" className="fm-table-wrap">
          {renderHeader()}
          <div>{renderDetailsRows()}</div>
        </div>
      )}

      {viewMode === "list" && (
        <div data-view="list" className="fm-list-compact divide-y divide-border/60">
          {renderCompactList()}
        </div>
      )}

      {/* Row context menu */}
      {rowMenu && (
        <ContextMenu
          open
          x={rowMenu.x}
          y={rowMenu.y}
          items={buildRowMenu(rowMenu.file)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {/* Background context menu */}
      {bgMenu && (
        <ContextMenu
          open
          x={bgMenu.x}
          y={bgMenu.y}
          items={buildBGMenu()}
          onClose={() => setBgMenu(null)}
        />
      )}
    </div>
  );
}
