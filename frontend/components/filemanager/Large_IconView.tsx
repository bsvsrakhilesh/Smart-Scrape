"use client";

import React, { useMemo, useState, useCallback, useRef } from "react";
import ContextMenu, { type MenuItem } from "../common/ContextMenu";
import {
  Folder as FolderIcon,
  File as FileIcon,
  Archive as ArchiveIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  Book as BookIcon,
  Code as CodeIcon,
  Star as StarIcon,
} from "lucide-react";
import { formatBytes } from "../../utils/fileHelpers";
import type { FileItem } from "../../types";

/** -------------------------------
 *  Compat helpers (no type changes)
 *  ------------------------------- */
const getTitle = (f: FileItem): string =>
  ((f as any).title ??
    (f as any).name ??
    (f as any).fileName ??
    (f as any).filename ??
    "") as string;

const getMime = (f: FileItem): string | undefined =>
  (f as any).mimeType ??
  (f as any).contentType ??
  (f as any).type ??
  undefined;

const getSize = (f: FileItem): number | null => {
  const v =
    (f as any).size ??
    (f as any).fileSize ??
    (f as any).bytes ??
    (f as any).length ??
    null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const getUpdated = (f: FileItem): Date | null => {
  // Your FileItem has uploadDate (ISO). Also tolerate a few alternates.
  const v =
    (f as any).uploadDate ??
    (f as any).updatedAt ??
    (f as any).modifiedAt ??
    (f as any).lastModified ??
    (f as any).updated_at ??
    (f as any).modified ??
    null;
  if (!v) return null;
  try {
    return new Date(v);
  } catch {
    return null;
  }
};

const isFolder = (f: FileItem): boolean =>
  (f as any).isFolder === true ||
  (f as any).mimeType === "folder" ||
  (f as any).type === "folder";

const isZip = (f: FileItem): boolean => {
  const name = getTitle(f).toLowerCase();
  const t = getMime(f)?.toLowerCase() ?? "";
  return (
    name.endsWith(".zip") ||
    t === "application/zip" ||
    t === "application/x-zip-compressed"
  );
};

const fileType = (f: FileItem): string => {
  if (isFolder(f)) return "folder";
  const t = getMime(f)?.toLowerCase() ?? "";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t.includes("pdf")) return "pdf";
  if (t.includes("zip")) return "archive";
  return t || "file";
};

const getThumb = (f: FileItem): string | null => {
  // if your FileItem has thumbnailUrl / thumb / preview / etc
  const v =
    (f as any).thumbnailUrl ??
    (f as any).thumbnail ??
    (f as any).thumb ??
    (f as any).preview ??
    null;
  return typeof v === "string" && v.trim() ? v : null;
};

const fileDisplayName = (f: FileItem) =>
  (f as any).title || (f as any).fileName || "";

const renderIcon = (f: FileItem, size = 24) => {
  const t = ((f as any).mimeType || "").toLowerCase();
  const name = fileDisplayName(f).toLowerCase();
  const style = { width: size, height: size };
  const base = "opacity-90";
  const inner = "w-full h-full";

  if (t.startsWith("image/"))
    return (
      <span style={style} className={base}>
        <ImageIcon className={inner} />
      </span>
    );
  if (t.startsWith("video/"))
    return (
      <span style={style} className={base}>
        <VideoIcon className={inner} />
      </span>
    );
  if (t.startsWith("audio/"))
    return (
      <span style={style} className={base}>
        <MusicIcon className={inner} />
      </span>
    );
  if (name.endsWith(".zip"))
    return (
      <span style={style} className={base}>
        <ArchiveIcon className={inner} />
      </span>
    );
  if (t.includes("pdf") || name.endsWith(".pdf"))
    return (
      <span style={style} className={base}>
        <BookIcon className={inner} />
      </span>
    );
  if (
    t.includes("javascript") ||
    t.includes("typescript") ||
    t.includes("text/")
  )
    return (
      <span style={style} className={base}>
        <CodeIcon className={inner} />
      </span>
    );

  if ((f as any).mimeType === "folder") {
    return (
      <span style={style} className="text-amber-500">
        <FolderIcon className={inner} />
      </span>
    );
  }
  return (
    <span style={style} className={base}>
      <FileIcon className={inner} />
    </span>
  );
};

type SortKey = "name" | "date" | "type" | "size";
type SortDir = "asc" | "desc";

type Props = {
  files: FileItem[];

  // selection (ID-based). If omitted, component manages its own selection.
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: string[]) => void;

  /** actions (parent can wire to lib/api.ts) */
  onCopy?: (ids: string[]) => void;
  onCut?: (ids: string[]) => void;
  onPaste?: () => void;
  onDelete?: (f: FileItem) => void; // typically calls trashFile(id)
  onRename?: (id: string, nextName: string) => void;
  onPreview?: (f: FileItem, opts?: any) => void;
  onDownload?: (f: FileItem) => void; // e.g. navigate to /api/files/:id/download
  onShowProperties?: (f: FileItem) => void;
  onNew?: (kind: "folder" | "file") => void;
  onRefresh?: () => void;

  // zip/virtual navigation (optional — wire to listZipChildren/streamZipFile)
  onOpenVirtual?: (opts: { zipId: string; prefix: string }) => void;

  // DnD
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent) => void;

  // current folder (used to scope paste target)
  currentFolderId?: string;

  // open handler (file/folder)
  onOpen: (f: FileItem) => void;

  // layout
  variant?: "large" | "icons";
  density?: "comfortable" | "cozy" | "compact";

  // sorting (shared with FileList)
  sortKey?: SortKey;
  sortDir?: SortDir;
  onSortChange?: (key: SortKey, dir: SortDir) => void;
};

function safeNumber(n: any): number {
  if (n == null) return 0;
  const num = typeof n === "string" ? parseFloat(n) : Number(n);
  return Number.isFinite(num) ? num : 0;
}

export default function Large_IconView({
  files,
  onOpen,
  variant = "large",
  density = "comfortable",

  // selection
  selectedIds,
  onSelectionChange,

  // sorting
  sortKey,
  sortDir,
  onSortChange,

  // actions
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onRename,
  onPreview,
  onDownload,
  onShowProperties,
  onNew,
  onRefresh,
  onOpenVirtual,

  // DnD
  onDragStart,
  onDragEnd,
  onDrop,

  currentFolderId,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  // ----- Controlled/Uncontrolled selection bridge -----
  const [uncontrolledSel, setUncontrolledSel] = useState<Set<string>>(
    () => new Set()
  );
  const sel = selectedIds ?? uncontrolledSel;
  const setSel = useCallback(
    (next: Set<string>) => {
      if (onSelectionChange) {
        onSelectionChange(Array.from(next));
      } else {
        setUncontrolledSel(next);
      }
    },
    [onSelectionChange]
  );

  // ----- Derived + sorting -----
  const sortedFiles = useMemo(() => {
    const byFolder = (a: FileItem, b: FileItem) => {
      const af = isFolder(a);
      const bf = isFolder(b);
      if (af === bf) return 0;
      return af ? -1 : 1;
    };

    const byKey = (a: FileItem, b: FileItem) => {
      if (!sortKey) return 0;
      const dir = sortDir === "desc" ? -1 : 1;

      switch (sortKey) {
        case "name": {
          const aa = getTitle(a).toLowerCase();
          const bb = getTitle(b).toLowerCase();
          return aa === bb ? 0 : aa > bb ? dir : -dir;
        }
        case "date": {
          const aa = getUpdated(a)?.getTime() ?? 0; // uses uploadDate if present
          const bb = getUpdated(b)?.getTime() ?? 0;
          return aa === bb ? 0 : aa > bb ? dir : -dir;
        }
        case "type": {
          const aa = fileType(a);
          const bb = fileType(b);
          return aa === bb ? 0 : aa > bb ? dir : -dir;
        }
        case "size": {
          const aa = safeNumber(getSize(a));
          const bb = safeNumber(getSize(b));
          return aa === bb ? 0 : aa > bb ? dir : -dir;
        }
        default:
          return 0;
      }
    };

    return [...files].sort((a, b) => {
      const f = byFolder(a, b);
      if (f) return f;
      return byKey(a, b);
    });
  }, [files, sortKey, sortDir]);

  // ----- Context menus -----
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    file: FileItem;
  } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);

  const buildBGMenu = useCallback((): MenuItem[] => {
    const pasteLabel = currentFolderId ? `Paste into this folder` : `Paste`;

    return [
      // Match FileList: New folder + Paste + Select all + Refresh
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
        // same as FileList: enabled whenever onPaste exists
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
            sortedFiles.map((f) => String((f as any).id))
          );
          setSel(all);
        },
      },
      { type: "separator" },
      // Keep existing "Sort by" group
      ...(onSortChange
        ? ([
            { type: "label", label: "Sort by" } as MenuItem,
            {
              type: "item",
              id: "sort_name",
              label: `Name ${
                sortKey === "name" ? `(${sortDir ?? "asc"})` : ""
              }`,
              onSelect: () =>
                onSortChange?.(
                  "name",
                  sortKey === "name" && sortDir === "asc" ? "desc" : "asc"
                ),
            },
            {
              type: "item",
              id: "sort_date",
              label: `Date ${
                sortKey === "date" ? `(${sortDir ?? "asc"})` : ""
              }`,
              onSelect: () =>
                onSortChange?.(
                  "date",
                  sortKey === "date" && sortDir === "asc" ? "desc" : "asc"
                ),
            },
            {
              type: "item",
              id: "sort_type",
              label: `Type ${
                sortKey === "type" ? `(${sortDir ?? "asc"})` : ""
              }`,
              onSelect: () =>
                onSortChange?.(
                  "type",
                  sortKey === "type" && sortDir === "asc" ? "desc" : "asc"
                ),
            },
            {
              type: "item",
              id: "sort_size",
              label: `Size ${
                sortKey === "size" ? `(${sortDir ?? "asc"})` : ""
              }`,
              onSelect: () =>
                onSortChange?.(
                  "size",
                  sortKey === "size" && sortDir === "asc" ? "desc" : "asc"
                ),
            },
          ] as MenuItem[])
        : []),
      // Optional Refresh item (if provided)
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
    sortedFiles,
    setSel,
    onNew,
    onPaste,
    onSortChange,
    sortKey,
    sortDir,
    onRefresh,
    currentFolderId,
  ]);

  const buildRowMenu = useCallback(
    (file: FileItem): MenuItem[] => {
      const id = String((file as any).id);
      const many = sel.size > 1;
      const targetIds = many ? Array.from(sel) : [id];

      const items: MenuItem[] = [
        {
          type: "item",
          id: "open",
          label: "Open",
          shortcut: "Enter",
          onSelect: () => onOpen(file),
        },
      ];

      // ZIP virtual navigation hook (lib/api.ts: listZipChildren / streamZipFile)
      if (isZip(file) && onOpenVirtual) {
        items.push({
          type: "item",
          id: "open_archive",
          label: "Open archive",
          onSelect: () =>
            onOpenVirtual({
              zipId: String((file as any).id),
              prefix: "",
            }),
        });
      }

      items.push(
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
          onSelect: async () => {
            if (!onRename) return;
            const current = getTitle(file);
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
          label: currentFolderId ? "Paste into this folder" : "Paste",
          shortcut: "Ctrl+V",
          // enabled whenever onPaste exists
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
        {
          type: "item",
          id: "delete",
          label: "Delete",
          shortcut: "Del",
          disabled: !onDelete,
          onSelect: () => onDelete?.(file), // parent can call trashFile(id)
        },
        {
          type: "item",
          id: "properties",
          label: "Properties",
          shortcut: "Alt+Enter",
          onSelect: () => onShowProperties?.(file),
        },
        {
          type: "item",
          id: "selectall",
          label: sel.size ? "Deselect all" : "Select all",
          onSelect: () => {
            if (sel.size) setSel(new Set());
            else
              setSel(
                new Set(sortedFiles.map((f) => String((f as any).id)))
              );
          },
        }
      );

      return items;
    },
    [
      sel,
      setSel,
      sortedFiles,
      onOpen,
      onPreview,
      onRename,
      onCopy,
      onCut,
      onPaste,
      onDownload,
      onDelete,
      onShowProperties,
      onOpenVirtual,
      currentFolderId,
    ]
  );

  // card size depends on variant + density
  const cardSize = useMemo(() => {
    const base =
      variant === "large"
        ? { w: 160, h: 160, thumb: 80, icon: 40 }
        : { w: 120, h: 120, thumb: 56, icon: 28 };

    const densityOffsets = {
      comfortable: { pad: 12, gap: 12 },
      cozy: { pad: 8, gap: 10 },
      compact: { pad: 4, gap: 8 },
    } as const;

    return {
      ...base,
      pad: densityOffsets[density].pad,
      gap: densityOffsets[density].gap,
    };
  }, [variant, density]);

  const toggleSelect = useCallback(
    (file: FileItem, e: React.MouseEvent) => {
      const id = String((file as any).id);
      const next = new Set(sel);

      if (e.shiftKey) {
        // multi range - not strictly necessary for grid, but keep semantics
        const ids = sortedFiles.map((f) => String((f as any).id));
        const lastId =
          Array.from(sel).length > 0
            ? Array.from(sel)[Array.from(sel).length - 1]
            : id;
        const start = ids.indexOf(lastId);
        const end = ids.indexOf(id);
        if (start !== -1 && end !== -1) {
          const [s, eidx] =
            start < end ? [start, end] : [end, start];
          for (let i = s; i <= eidx; i++) {
            next.add(ids[i]);
          }
        } else {
          next.add(id);
        }
      } else if (e.metaKey || e.ctrlKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        if (next.has(id) && next.size === 1) {
          const alreadyOnlyThis = next.size === 1 && next.has(id);
          next.clear();
          if (!alreadyOnlyThis) next.add(id);
        } else {
          const alreadyOnlyThis = next.size === 1 && next.has(id);
          next.clear();
          if (!alreadyOnlyThis) next.add(id);
        }
      }
      setSel(next);
    },
    [sel, setSel, sortedFiles]
  );

  const handleDoubleClick = useCallback(
    (f: FileItem) => {
      onOpen(f);
    },
    [onOpen]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, f: FileItem) => {
      const id = String((f as any).id);
      const ids = sel.size > 0 ? Array.from(sel) : [id];
      e.dataTransfer.setData("text/plain", JSON.stringify(ids));
      onDragStart?.(ids);
    },
    [sel, onDragStart]
  );

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  // ----- Render -----
  return (
    <div
      ref={rootRef}
      className="wg-grid relative w-full h-full overflow-auto px-2"
      style={{ display: "block" }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onContextMenu={(e) => {
        e.preventDefault();
        const rect = rootRef.current?.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;
        if (rect) {
          x -= rect.left;
          y -= rect.top;
        }
        setRowMenu(null);
        setBgMenu({ x, y });
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest(".wg-card")) return;
        setSel(new Set());
        setRowMenu(null);
        setBgMenu(null);
      }}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${
            variant === "large" ? 160 : 120
          }px, 1fr))`,
          gridAutoFlow: "row dense",
          justifyItems: "stretch",
          gap: 14,
          padding: cardSize.pad,
        }}
      >
        {sortedFiles.map((f, index) => {
          const id = String((f as any).id);
          const selected = sel.has(id);
          const folder = isFolder(f);
          const size = getSize(f);
          const title = getTitle(f);

          const titleAttr = [
            title,
            !folder && size != null ? `• ${formatBytes(size)}` : null,
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={id}
              className={`wg-card wg-card-animate group relative w-full overflow-visible rounded-xl border ${
                selected
                  ? "border-blue-500 ring-2 ring-blue-400/40"
                  : "border-neutral-200 hover:border-neutral-300"
              } bg-white shadow-sm hover:shadow transition-all`}
              style={{
                height: cardSize.h,
                animationDelay: `${Math.min(index * 0.02, 0.25)}s`,
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, f)}
              onDragEnd={handleDragEnd}
              onClick={(e) => toggleSelect(f, e)}
              onDoubleClick={() => handleDoubleClick(f)}
              onContextMenu={(e) => {
                e.preventDefault();
                const id = String((f as any).id);

                // If right-clicking an unselected card, focus selection on it
                if (!sel.has(id)) {
                  setSel(new Set([id]));
                }

                const rect = rootRef.current?.getBoundingClientRect();
                let x = e.clientX;
                let y = e.clientY;
                if (rect) {
                  x -= rect.left;
                  y -= rect.top;
                }
                setBgMenu(null);
                setRowMenu({ x, y, file: f });
              }}
              title={titleAttr}
            >
              {/* Favorite badge */}
              {(f as any).isFavorited && (
                <div className="wg-badge-star" title="Starred">
                  <StarIcon className="h-3.5 w-3.5" />
                </div>
              )}
              {/* Thumbnail / Icon */}
              <div className="flex items-center justify-center pt-4">
                {getThumb(f) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getThumb(f)!}
                    alt={title}
                    className="max-h-[72px] max-w-[90%] rounded-md object-cover shadow-sm"
                  />
                ) : (
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-lg bg-neutral-50">
                    {renderIcon(f, Math.round(cardSize.icon * 2))}
                  </div>
                )}
              </div>

              {/* Title + (optional) size */}
              <div className="absolute bottom-2 left-2 right-2">
                <div
                  className={`truncate text-center ${
                    selected
                      ? "font-semibold text-blue-700"
                      : "text-neutral-800"
                  } text-sm`}
                >
                  {title}
                </div>
                {!folder && size != null && (
                  <div className="mt-0.5 text-center text-xs text-neutral-500">
                    {formatBytes(size)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rowMenu && (
        <ContextMenu
          open
          x={rowMenu.x}
          y={rowMenu.y}
          items={buildRowMenu(rowMenu.file)}
          onClose={() => setRowMenu(null)}
        />
      )}

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
