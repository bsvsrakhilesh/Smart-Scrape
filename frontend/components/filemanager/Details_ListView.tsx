import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  KeyboardEvent,
} from "react";
import type { FileItem } from "../../lib/types";
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
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  MoreHorizontal,
} from "lucide-react";

type ViewMode = "details" | "list";
type ColumnKey = "name" | "date" | "type" | "size";
type ArchiveColumnId =
  | "evidence"
  | "source"
  | "captured"
  | "integrity"
  | "revision"
  | "tags";

const DETAIL_COLUMNS: Array<{
  id: ArchiveColumnId;
  label: string;
  sortKey?: ColumnKey;
  align?: "left" | "right";
}> = [
  { id: "evidence", label: "Evidence", sortKey: "name" },
  { id: "source", label: "Source" },
  { id: "captured", label: "Captured", sortKey: "date" },
  { id: "integrity", label: "Integrity" },
  { id: "revision", label: "Revision" },
  { id: "tags", label: "Tags" },
];

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

const getShortDateLabel = (f: FileItem): string => {
  const d =
    (f as any).updatedAt ||
    (f as any).modifiedAt ||
    (f as any).uploadDate ||
    (f as any).createdAt ||
    (f as any).lastModified ||
    null;

  if (!d) return "Unknown";
  try {
    return new Date(d).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
};

const getSourceHost = (f: FileItem): string => {
  const raw = (f as any).sourceUrl || (f as any).captureEvent?.sourceUrl || "";

  if (!raw) {
    return String((f as any).captureType || "").startsWith("URL_")
      ? "Captured web"
      : "Direct upload";
  }

  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return (
      String(raw)
        .replace(/^https?:\/\//, "")
        .split("/")[0] || "Unknown source"
    );
  }
};

const getActorLabel = (f: FileItem): string =>
  (f as any).captureEvent?.actorName ||
  (f as any).uploader?.name ||
  "Unknown actor";

const getCaptureLabel = (f: FileItem): string => {
  const captureType = String((f as any).captureType || "");
  const mime = String((f as any).mimeType || "").toLowerCase();
  const isFolder = Boolean((f as any).isFolder) || mime === "folder";

  if (isFolder) return "Folder";
  if (captureType === "URL_TEXT") return "Web capture";
  if (captureType === "URL_PDF") return "Printed snapshot";
  return "Upload";
};

const getIntegrityInfo = (
  f: FileItem,
): {
  tone: "green" | "blue" | "slate";
  label: string;
  meta: string;
} => {
  const sha256 = (f as any).sha256;
  const contentHash = (f as any).contentHash;

  if (sha256) {
    return {
      tone: "green",
      label: "Verified hash",
      meta: `${String(sha256).slice(0, 12)}…`,
    };
  }

  if (contentHash) {
    return {
      tone: "blue",
      label: "Content hash",
      meta: `${String(contentHash).slice(0, 12)}…`,
    };
  }

  return {
    tone: "slate",
    label: "Hash pending",
    meta: "No immutable hash yet",
  };
};

const getTaggingInfo = (
  f: FileItem,
): {
  tone: "green" | "blue" | "amber" | "red" | "slate";
  label: string;
  meta: string;
} | null => {
  const mime = String((f as any).mimeType || "").toLowerCase();
  const folder = Boolean((f as any).isFolder) || mime === "folder";
  if (folder) return null;

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

const getRevisionInfo = (f: FileItem): { label: string; meta: string } => {
  const rev = (f as any).documentRevision;
  const pipeline = (f as any).captureEvent?.pipelineConfig;

  if (rev?.ordinal) {
    return {
      label: `R${rev.ordinal}`,
      meta: pipeline?.name
        ? `${pipeline.name} v${pipeline.version}`
        : "Tracked revision",
    };
  }

  return {
    label: "Base file",
    meta: getCaptureLabel(f),
  };
};

const getTypeLabel = (f: FileItem): string => {
  const mime = String((f as any).mimeType || "").toLowerCase();
  if (!mime) return "Unknown";
  if (mime === "folder") return "Folder";
  return mime.split("/").pop() || mime;
};

const getTagList = (f: FileItem): string[] =>
  Array.isArray((f as any).tags) ? ((f as any).tags as string[]) : [];

const canRetryAiTag = (f: FileItem): boolean => {
  const mime = String((f as any).mimeType || "").toLowerCase();
  const folder = Boolean((f as any).isFolder) || mime === "folder";
  if (folder) return false;

  const status = String((f as any).taggingStatus || "NONE").toUpperCase();
  const err = String((f as any).taggingError || "").trim();

  return status === "FAILED" || Boolean(err);
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
  onRestore?: (f: FileItem) => void;
  onRestoreMany?: (ids: string[]) => void;

  onOpen?: (f: FileItem) => void;
  onRename?: (id: string, nextName: string) => void;
  onPreview?: (f: FileItem, opts?: any) => void;
  onDownload?: (f: FileItem) => void;
  onOpenVirtual?: (ctx: { zipId: string; prefix: string }) => void;
  onShowProperties?: (file: FileItem) => void;
  onRetryAiTag?: (file: FileItem) => void;

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
  density?: "cozy" | "compact";

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
  onRestore,
  onRestoreMany,
  onOpen,
  onRename,
  onPreview,
  onDownload,
  onOpenVirtual,
  onShowProperties,
  onRetryAiTag,
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
  density = "cozy",
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Manual double-click detector (more reliable than native onDoubleClick)
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const DOUBLE_CLICK_MS = 320;

  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    file: FileItem;
  } | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null);

  const { confirm } = useConfirm();

  /** ---- controlled/uncontrolled selection bridge ---- */
  const [selectedIdsInternal, setSelectedIdsInternal] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedIds = selectedIdsProp ?? selectedIdsInternal;

  const setSelectedIds = (next: Set<string>) => {
    if (!selectedIdsProp) setSelectedIdsInternal(next);
    onSelectionChange?.(Array.from(next));
  };

  /** ---- view mode ---- */
  const [viewMode, setViewMode] = useState<ViewMode>(
    layout ?? ("details" as ViewMode),
  );
  React.useEffect(() => {
    if (layout) setViewMode(layout);
  }, [layout]);

  /** ---- sorting ---- */
  const [internalSortKey, setInternalSortKey] = useState<ColumnKey>("name");
  const [internalSortDir, setInternalSortDir] = useState<"asc" | "desc">("asc");

  const effectiveSortKey: ColumnKey =
    (sortKey as ColumnKey | undefined) ?? internalSortKey;
  const effectiveSortDir: "asc" | "desc" = sortDir ?? internalSortDir ?? "asc";

  const setSort = (key: ColumnKey) => {
    const isSame = effectiveSortKey === key;
    const nextDir: "asc" | "desc" =
      isSame && effectiveSortDir === "asc" ? "desc" : "asc";

    setInternalSortKey(key);
    setInternalSortDir(nextDir);
    onSortChange?.(key, nextDir);
  };

  const sorted = useMemo(() => {
    return files;
  }, [files]);

  /** ---- selection helpers ---- */
  const handleRowClick = (file: FileItem, e: React.MouseEvent) => {
    if (!selectable) return;
    const id = String(
      (file as any).id ?? (file as any).fileId ?? fileDisplayName(file),
    );
    const now = Date.now();
    const last = lastClickRef.current;
    const isModifiedClick = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

    if (
      !isModifiedClick &&
      last &&
      last.id === id &&
      now - last.t < DOUBLE_CLICK_MS
    ) {
      lastClickRef.current = null; // reset
      handleRowDoubleClick(file); // ✅ open on 2nd click
      return;
    }

    lastClickRef.current = { id, t: now };

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
            sorted.map((f) => String((f as any).id ?? fileDisplayName(f))),
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
                effectiveSortKey === "name" ? `(${effectiveSortDir})` : ""
              }`,
              onSelect: () => setSort("name"),
            },
            {
              type: "item",
              id: "sort_date",
              label: `Date ${
                effectiveSortKey === "date" ? `(${effectiveSortDir})` : ""
              }`,
              onSelect: () => setSort("date"),
            },
            {
              type: "item",
              id: "sort_type",
              label: `Type ${
                effectiveSortKey === "type" ? `(${effectiveSortDir})` : ""
              }`,
              onSelect: () => setSort("type"),
            },
            {
              type: "item",
              id: "sort_size",
              label: `Size ${
                effectiveSortKey === "size" ? `(${effectiveSortDir})` : ""
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
        ...(canRetryAiTag(file) && onRetryAiTag
          ? [
              {
                type: "item" as const,
                id: "retry_ai",
                label: "Retry AI extraction",
                onSelect: () => onRetryAiTag(file),
              },
            ]
          : []),
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
                  files.map((f) => String((f as any).id ?? fileDisplayName(f))),
                ),
              );
            }
          },
        },
        { type: "separator" },
        ...(onRestore || onRestoreMany
          ? [
              {
                type: "item" as const,
                id: "restore",
                label: many ? `Restore ${targetIds.length} items` : "Restore",
                onSelect: () => {
                  if (many && onRestoreMany) {
                    onRestoreMany(targetIds);
                    return;
                  }
                  if (!many && onRestore) {
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
                danger: true,
                shortcut: "Del",
                onSelect: async () => {
                  const ok = await confirm({
                    title: "Delete permanently?",
                    description: many
                      ? `Permanently delete ${targetIds.length} items? This cannot be undone.`
                      : `Permanently delete "${fileDisplayName(file)}"? This cannot be undone.`,
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
              },
            ]
          : [
              {
                type: "item" as const,
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
              },
            ]),
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
      onRestore,
      onRestoreMany,
      onDownload,
      onRename,
      onPreview,
      onOpenVirtual,
      onShowProperties,
      onRetryAiTag,
      setSelectedIds,
    ],
  );

  /** ---- keyboard shortcuts ---- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isMod = e.ctrlKey || e.metaKey;
    const selIds = Array.from(selectedIds);

    if (isMod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelectedIds(
        new Set(sorted.map((f) => String((f as any).id ?? fileDisplayName(f)))),
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
          selectedIds.has(String((x as any).id ?? fileDisplayName(x))),
        );
        if (f) onDelete(f);
      }
    }
    if (e.key === "Enter" && selIds.length === 1) {
      e.preventDefault();
      const f = sorted.find((x) =>
        selectedIds.has(String((x as any).id ?? fileDisplayName(x))),
      );
      if (f) handleRowDoubleClick(f);
    }
    if (e.altKey && e.key === "Enter" && selIds.length === 1) {
      e.preventDefault();
      const f = sorted.find((x) =>
        selectedIds.has(String((x as any).id ?? fileDisplayName(x))),
      );
      if (f && onShowProperties) onShowProperties(f);
    }
  };

  /** ---- rendering helpers ---- */
  const renderHeader = () => {
    const iconFor = (key: ColumnKey) => {
      if (effectiveSortKey !== key) {
        return (
          <ChevronsUpDown className="fm-sort-icon fm-sort-icon--neutral" />
        );
      }

      return effectiveSortDir === "asc" ? (
        <ChevronUp className="fm-sort-icon" />
      ) : (
        <ChevronDown className="fm-sort-icon" />
      );
    };

    return (
      <div className="fm-table-header fm-row-grid" role="row">
        {DETAIL_COLUMNS.map((col) => {
          const isSorted = col.sortKey
            ? effectiveSortKey === col.sortKey
            : false;
          const ariaSort = col.sortKey
            ? isSorted
              ? effectiveSortDir === "asc"
                ? "ascending"
                : "descending"
              : "none"
            : undefined;

          if (!col.sortKey) {
            return (
              <div
                key={col.id}
                role="columnheader"
                className={`fm-th is-static ${
                  col.align === "right" ? "is-right" : ""
                }`}
              >
                <span className="fm-th-label">{col.label}</span>
              </div>
            );
          }

          return (
            <button
              key={col.id}
              type="button"
              role="columnheader"
              aria-sort={ariaSort as any}
              className={`fm-th ${col.align === "right" ? "is-right" : ""}`}
              onClick={() => setSort(col.sortKey!)}
            >
              <span className="fm-th-label">{col.label}</span>
              <span className="fm-th-sort" aria-hidden="true">
                {iconFor(col.sortKey)}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderDetailsRows = () =>
    sorted.map((f) => {
      const id = String((f as any).id ?? fileDisplayName(f));
      const isSel = selectedIds.has(id);

      const rawSize = (f as any).size;
      const sizeLabel =
        rawSize != null && rawSize !== ""
          ? formatBytes(
              typeof rawSize === "string" ? parseFloat(rawSize) : rawSize,
            )
          : "—";

      const sourceHost = getSourceHost(f);
      const actorLabel = getActorLabel(f);
      const capturedLabel = getShortDateLabel(f);
      const captureLabel = getCaptureLabel(f);
      const integrity = getIntegrityInfo(f);
      const revision = getRevisionInfo(f);
      const typeLabel = getTypeLabel(f);
      const tagList = getTagList(f);
      const canRetry = canRetryAiTag(f);
      const tagging = getTaggingInfo(f);
      const sourceUrl =
        (f as any).sourceUrl || (f as any).captureEvent?.sourceUrl;

      return (
        <div
          key={id}
          data-row
          data-id={id}
          data-selected={isSel ? "true" : "false"}
          draggable
          onDragStart={(e) => handleRowDragStart(e, f)}
          onDragEnd={handleRowDragEnd}
          onClick={(e) => handleRowClick(f, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selectedIds.has(id)) {
              setSelectedIds(new Set([id]));
            }
            setBgMenu(null);
            setRowMenu({ x: e.clientX, y: e.clientY, file: f });
          }}
          className="fm-row fm-row--details fm-row-grid"
        >
          <div className="fm-td fm-td--evidence">
            <div className="fm-evidence-main">
              {showCheckCol && (
                <input
                  name="details-row-select"
                  type="checkbox"
                  className="fm-check"
                  checked={isSel}
                  onChange={(e) => handleRowClick(f, e as any)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={isSel ? "Deselect item" : "Select item"}
                />
              )}

              <span className="fm-file-icon" aria-hidden="true">
                {renderTypeIcon(f)}
              </span>

              <div className="fm-cell-stack min-w-0">
                <span className="fm-file-name" title={fileDisplayName(f)}>
                  {fileDisplayName(f)}
                </span>
                <span className="fm-cell-subtle">
                  {typeLabel} · {sizeLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="fm-td fm-td--source">
            <div className="fm-cell-stack">
              <span className="fm-source-name" title={sourceHost}>
                {sourceHost}
              </span>
              <span className="fm-cell-subtle" title={sourceUrl || actorLabel}>
                {sourceUrl ? sourceUrl : actorLabel}
              </span>
            </div>
          </div>

          <div className="fm-td fm-td--captured">
            <div className="fm-cell-stack">
              <span className="fm-cell-strong">{capturedLabel}</span>
              <div className="fm-inline-pills">
                <span className="fm-mini-pill">{captureLabel}</span>
                <span className="fm-mini-pill fm-mini-pill--ghost">
                  {(f as any).visibility || "private"}
                </span>
              </div>
            </div>
          </div>

          <div className="fm-td fm-td--integrity">
            <div className="fm-cell-stack">
              <span
                className={`fm-state-pill fm-state-pill--${integrity.tone}`}
              >
                {integrity.label}
              </span>
              <span className="fm-cell-subtle fm-cell-mono">
                {integrity.meta}
              </span>
            </div>
          </div>

          <div className="fm-td fm-td--revision">
            <div className="fm-cell-stack">
              <span className="fm-cell-strong">{revision.label}</span>
              <span className="fm-cell-subtle">{revision.meta}</span>
            </div>
          </div>

          <div className="fm-td fm-td--tags">
            {tagging || tagList.length || canRetry ? (
              <div className="fm-inline-pills">
                {tagging && (
                  <span
                    className={`fm-state-pill fm-state-pill--${tagging.tone}`}
                    title={tagging.meta}
                  >
                    {tagging.label}
                  </span>
                )}

                {tagList.length ? (
                  <>
                    {tagList.slice(0, 2).map((tag) => (
                      <span key={tag} className="fm-mini-pill">
                        {tag}
                      </span>
                    ))}
                    {tagList.length > 2 && (
                      <span className="fm-mini-pill fm-mini-pill--ghost">
                        +{tagList.length - 2}
                      </span>
                    )}
                  </>
                ) : tagging?.tone === "green" ? (
                  <span className="fm-mini-pill fm-mini-pill--ghost">
                    No labels
                  </span>
                ) : null}

                {canRetry && onRetryAiTag && (
                  <button
                    type="button"
                    className="fm-mini-pill fm-mini-pill--ghost fm-inline-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryAiTag(f);
                    }}
                    title="Retry AI extraction"
                  >
                    Retry AI
                  </button>
                )}
              </div>
            ) : (
              <span className="fm-cell-subtle">No tags</span>
            )}
          </div>
        </div>
      );
    });

  const renderList = () =>
    sorted.map((f) => {
      const id = String((f as any).id ?? fileDisplayName(f));
      const isSel = selectedIds.has(id);

      const dateLabel = getDateLabel(f);
      const canRetry = canRetryAiTag(f);
      const tagging = getTaggingInfo(f);

      return (
        <div
          key={id}
          data-row
          data-id={id}
          data-selected={isSel ? "true" : "false"}
          draggable
          onDragStart={(e) => handleRowDragStart(e, f)}
          onDragEnd={handleRowDragEnd}
          onClick={(e) => handleRowClick(f, e)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!selectedIds.has(id)) setSelectedIds(new Set([id]));
            setBgMenu(null);
            setRowMenu({ x: e.clientX, y: e.clientY, file: f });
          }}
          className={`fm-row ${isSel ? "is-selected" : ""}`}
          role="option"
          aria-selected={isSel}
          tabIndex={0}
        >
          {/* Left: checkbox + icon + name */}
          <div className="fm-list-item__left">
            {showCheckCol && (
              <input
                name="list-row-select"
                type="checkbox"
                className="fm-check"
                checked={isSel}
                onChange={(e) => handleRowClick(f, e as any)}
                onClick={(e) => e.stopPropagation()}
                aria-label={isSel ? "Deselect item" : "Select item"}
              />
            )}

            <span className="fm-thumb" aria-hidden="true">
              {renderTypeIcon(f)}
            </span>

            <div className="fm-list-text">
              <div className="fm-list-name" title={fileDisplayName(f)}>
                {fileDisplayName(f)}
              </div>
              <div className="fm-list-subtle fm-list-subline">
                {getSourceHost(f)} · {getCaptureLabel(f)}
              </div>
            </div>
          </div>

          <div className="fm-row-meta" aria-hidden="true">
            {tagging && (
              <span
                className={`fm-state-pill fm-state-pill--${tagging.tone}`}
                title={tagging.meta}
              >
                {tagging.label}
              </span>
            )}

            <span className="fm-tag">{getIntegrityInfo(f).label}</span>

            {((f as any).documentRevision?.ordinal ?? null) && (
              <span className="fm-tag">
                R{(f as any).documentRevision.ordinal}
              </span>
            )}

            {dateLabel && <span className="fm-tag">{dateLabel}</span>}
          </div>

          {/* Right: quick menu button */}
          <div className="fm-row-actions">
            {canRetry && onRetryAiTag && (
              <button
                type="button"
                className="fm-mini-pill fm-mini-pill--ghost fm-inline-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryAiTag(f);
                }}
                title="Retry AI extraction"
              >
                Retry AI
              </button>
            )}

            <button
              type="button"
              className="fm-iconbtn"
              aria-label="More actions"
              onClick={(e) => {
                e.stopPropagation();
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                setBgMenu(null);
                if (!selectedIds.has(id)) setSelectedIds(new Set([id]));
                setRowMenu({ x: rect.left, y: rect.bottom + 6, file: f });
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      );
    });

  /** ---- render ---- */
  return (
    <div
      ref={containerRef}
      className="fm-canvas relative w-full h-full overflow-auto text-sm"
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
        <div
          data-view="details"
          className="fm-table-wrap fm-table-wrap--archive"
          data-density={density}
        >
          {renderHeader()}
          <div className="fm-table-body">{renderDetailsRows()}</div>
        </div>
      )}

      {viewMode === "list" && (
        <div data-view="list" className="fm-list-surface">
          <div className="fm-list-compact" data-density={density}>
            {renderList()}
          </div>
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
