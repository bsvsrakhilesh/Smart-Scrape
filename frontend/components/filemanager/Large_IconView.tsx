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
  Check as CheckIcon,
} from "lucide-react";
import { formatBytes } from "../../utils/fileHelpers";
import type { FileItem } from "../../lib/types";

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
  (f as any).mimeType ?? (f as any).contentType ?? (f as any).type ?? undefined;

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

const getThumb = (f: FileItem): string | null => {
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

const getTaggingInfo = (
  f: FileItem,
): {
  tone: "green" | "blue" | "amber" | "red" | "slate";
  label: string;
  meta: string;
} | null => {
  if (isFolder(f)) return null;

  const status = String((f as any).taggingStatus || "NONE").toUpperCase();
  const tags = Array.isArray((f as any).tags) ? (f as any).tags.length : 0;
  const err = String((f as any).taggingError || "").trim();

  switch (status) {
    case "PENDING":
      return {
        tone: "amber",
        label: "AI pending",
        meta: "Queued for extraction",
      };

    case "RUNNING":
      return {
        tone: "blue",
        label: "AI processing",
        meta: "Extracting labels",
      };

    case "SUCCESS":
      return {
        tone: "green",
        label: "AI ready",
        meta: tags
          ? `${tags} label${tags === 1 ? "" : "s"} extracted`
          : "Metadata extracted",
      };

    case "FAILED":
      return {
        tone: "red",
        label: "AI failed",
        meta: err || "Extraction needs retry",
      };

    default:
      return null;
  }
};

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

  /** actions */
  onCopy?: (ids: string[]) => void;
  onCut?: (ids: string[]) => void;
  onPaste?: () => void;
  onDelete?: (f: FileItem) => void;
  onDeleteMany?: (ids: string[]) => void;
  onRestore?: (f: FileItem) => void;
  onRestoreMany?: (ids: string[]) => void;
  onRename?: (id: string, nextName: string) => void;
  onPreview?: (f: FileItem, opts?: any) => void;
  onDownload?: (f: FileItem) => void;
  onShowProperties?: (f: FileItem) => void;
  onNew?: (kind: "folder" | "file") => void;
  onRefresh?: () => void;

  // zip/virtual navigation
  onOpenVirtual?: (opts: { zipId: string; prefix: string }) => void;

  // DnD
  onDragStart?: (ids: string[]) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent) => void;

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

export default function Large_IconView({
  files,
  onOpen,
  variant = "large",
  density = "comfortable",

  selectedIds,
  onSelectionChange,

  sortKey,
  sortDir,
  onSortChange,

  onCopy,
  onCut,
  onPaste,
  onDelete,
  onDeleteMany,
  onRestore,
  onRestoreMany,
  onRename,
  onPreview,
  onDownload,
  onShowProperties,
  onNew,
  onRefresh,
  onOpenVirtual,

  onDragStart,
  onDragEnd,
  onDrop,

  currentFolderId,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Manual double-click detector (more reliable than native onDoubleClick)
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const DOUBLE_CLICK_MS = 320;

  // selection bridge
  const [uncontrolledSel, setUncontrolledSel] = useState<Set<string>>(
    () => new Set(),
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
    [onSelectionChange],
  );

  // sort
  const sortedFiles = useMemo(() => {
    // Parent owns sorting + paging; avoid client re-sort.
    return files;
  }, [files]);

  // context menus
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    file: FileItem;
  } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);

  const buildBGMenu = useCallback((): MenuItem[] => {
    const items: MenuItem[] = [];

    if (onNew) {
      items.push({
        type: "item",
        id: "newfolder",
        label: "New folder",
        onSelect: () => onNew?.("folder"),
      });
    }

    if (onPaste) {
      const pasteLabel = currentFolderId ? "Paste into this folder" : "Paste";
      items.push({
        type: "item",
        id: "paste",
        label: pasteLabel,
        shortcut: "Ctrl+V",
        onSelect: () => onPaste?.(),
      });
    }

    if (items.length) items.push({ type: "separator" });

    return [
      ...items,

      {
        type: "item",
        id: "selectall",
        label: "Select all",
        shortcut: "Ctrl+A",
        onSelect: () => {
          const all = new Set<string>(
            sortedFiles.map((f) => String((f as any).id)),
          );
          setSel(all);
        },
      },
      { type: "separator" },
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
                  sortKey === "name" && sortDir === "asc" ? "desc" : "asc",
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
                  sortKey === "date" && sortDir === "asc" ? "desc" : "asc",
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
                  sortKey === "type" && sortDir === "asc" ? "desc" : "asc",
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
                  sortKey === "size" && sortDir === "asc" ? "desc" : "asc",
                ),
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
        ...(onRestore || onRestoreMany
          ? [
              {
                type: "item" as const,
                id: "restore",
                label: many ? `Restore ${targetIds.length} items` : "Restore",
                onSelect: () => {
                  if (many && onRestoreMany) {
                    onRestoreMany(targetIds);
                  } else if (onRestore) {
                    onRestore(file);
                  }
                },
              },
              {
                type: "item" as const,
                id: "delete",
                label: many
                  ? `Delete ${targetIds.length} items permanently`
                  : "Delete permanently",
                shortcut: "Del",
                danger: true,
                disabled: !onDelete && !onDeleteMany,
                onSelect: () => {
                  if (many && onDeleteMany) {
                    onDeleteMany(targetIds);
                  } else if (onDelete) {
                    onDelete(file);
                  }
                },
              },
            ]
          : [
              {
                type: "item" as const,
                id: "delete",
                label: many ? `Delete ${targetIds.length} items` : "Delete",
                shortcut: "Del",
                danger: true,
                disabled: !onDelete && !onDeleteMany,
                onSelect: () => {
                  if (many && onDeleteMany) {
                    onDeleteMany(targetIds);
                  } else if (onDelete) {
                    onDelete(file);
                  }
                },
              },
            ]),
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
            else setSel(new Set(sortedFiles.map((f) => String((f as any).id))));
          },
        },
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
      onDeleteMany,
      onShowProperties,
      onOpenVirtual,
      currentFolderId,
    ],
  );

  // card size depends on variant + density
  const cardSize = useMemo(() => {
    const base =
      variant === "large"
        ? { w: 160, h: 160, thumb: 80, icon: 40 }
        : { w: 120, h: 120, thumb: 56, icon: 28 };

    // Make density visibly affect how many tiles fit + tile height.
    // (Previously, `gap` was calculated but never used, and tile size never changed.)
    const sizeDelta = density === "compact" ? -12 : density === "cozy" ? -6 : 0;

    const densityOffsets = {
      comfortable: { pad: 12, gap: 12 },
      cozy: { pad: 8, gap: 10 },
      compact: { pad: 4, gap: 8 },
    } as const;

    return {
      ...base,
      // slightly smaller tiles for compact, slightly smaller for cozy
      w: Math.max(96, base.w + sizeDelta),
      h: Math.max(96, base.h + sizeDelta),
      thumb: Math.max(44, base.thumb + Math.round(sizeDelta * 0.5)),
      icon: Math.max(22, base.icon + Math.round(sizeDelta * 0.35)),
      pad: densityOffsets[density].pad,
      gap: densityOffsets[density].gap,
    };
  }, [variant, density]);

  const handleTileClick = useCallback(
    (file: FileItem, e: React.MouseEvent) => {
      const id = String((file as any).id);
      const now = Date.now();

      // If user clicks same item twice quickly => treat as double click (open)
      const last = lastClickRef.current;
      const isModifiedClick = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

      if (
        !isModifiedClick &&
        last &&
        last.id === id &&
        now - last.t < DOUBLE_CLICK_MS
      ) {
        lastClickRef.current = null; // reset
        onOpen(file); // ✅ open on 2nd click
        return;
      }

      lastClickRef.current = { id, t: now };

      // Otherwise: normal selection behavior (Explorer-like)
      const next = new Set(sel);

      if (e.metaKey || e.ctrlKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        next.clear();
        next.add(id);
      }

      setSel(next);
    },
    [sel, setSel, onOpen],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, f: FileItem) => {
      const id = String((f as any).id);
      const ids = sel.size > 0 ? Array.from(sel) : [id];
      e.dataTransfer.setData("text/plain", JSON.stringify(ids));
      onDragStart?.(ids);
    },
    [sel, onDragStart],
  );

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      ref={rootRef}
      className="fm-canvas wg-grid relative w-full h-full overflow-auto px-2"
      style={{ display: "block" }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".wg-card")) return;
        e.preventDefault();
        setRowMenu(null);
        setBgMenu({ x: e.clientX, y: e.clientY });
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
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.w}px, 1fr))`,
          gridAutoFlow: "row dense",
          justifyItems: "stretch",
          gap: cardSize.gap,
          padding: cardSize.pad,
        }}
      >
        {sortedFiles.map((f, index) => {
          const id = String((f as any).id);
          const selected = sel.has(id);
          const folder = isFolder(f);
          const size = getSize(f);
          const title = getTitle(f);
          const tagging = getTaggingInfo(f);

          const titleAttr = [
            title,
            !folder && size != null ? `• ${formatBytes(size)}` : null,
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={id}
              className="wg-card wg-card-animate ex-tile group"
              data-selected={selected ? "true" : "false"}
              data-variant={variant}
              data-density={density}
              style={{
                height: cardSize.h,
                animationDelay: `${Math.min(index * 0.02, 0.25)}s`,
              }}
              tabIndex={0}
              role="option"
              aria-selected={selected}
              draggable
              onDragStart={(e) => handleDragStart(e, f)}
              onDragEnd={handleDragEnd}
              onClick={(e) => handleTileClick(f, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                const id = String((f as any).id);

                if (!sel.has(id)) {
                  setSel(new Set([id]));
                }

                setBgMenu(null);
                setRowMenu({ x: e.clientX, y: e.clientY, file: f });
              }}
              title={titleAttr}
            >
              {/* Windows-style selection check */}
              <div className="ex-tile-check" aria-hidden="true">
                <CheckIcon className="h-3.5 w-3.5" />
              </div>

              {(f as any).isFavorited && (
                <div className="ex-tile-star" title="Starred">
                  <StarIcon className="h-3.5 w-3.5" />
                </div>
              )}

              <div className="ex-tile-preview">
                {getThumb(f) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getThumb(f)!}
                    alt={title}
                    className="ex-tile-preview-img"
                  />
                ) : (
                  <div className="ex-tile-preview-fallback">
                    {renderIcon(f, Math.round(cardSize.icon * 2))}
                  </div>
                )}
              </div>

              <div className="ex-tile-meta">
                {tagging && (
                  <div className="ex-tile-status">
                    <span
                      className={`fm-state-pill fm-state-pill--${tagging.tone} ex-tile-status-pill`}
                      title={tagging.meta}
                    >
                      {tagging.label}
                    </span>
                  </div>
                )}

                <div className="ex-tile-name">{title}</div>

                {(f as any).captureType &&
                  String((f as any).captureType).startsWith("URL_") && (
                    <div
                      className="ex-tile-sub"
                      title={
                        (f as any).sourceUrl
                          ? `Source: ${(f as any).sourceUrl}`
                          : "URL Snapshot"
                      }
                    >
                      Snapshot
                    </div>
                  )}

                {!folder && size != null && (
                  <div className="ex-tile-sub">{formatBytes(size)}</div>
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
