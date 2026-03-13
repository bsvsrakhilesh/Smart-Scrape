// frontend/components/filemanager/CommandBar.tsx
"use client";

import {
  Plus,
  Upload,
  LayoutGrid,
  Square,
  List,
  Rows3,
  ArrowUpDown,
  Check,
  SlidersHorizontal,
} from "lucide-react";

type LayoutKind = "large" | "icons" | "details" | "list";

type Props = {
  layout?: LayoutKind;
  onLayoutChange?: (layout: LayoutKind) => void;
  onToggleView?: () => void;
  onNew?: () => void;
  onUpload?: () => void;

  /** sorting */
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSortKeyChange?: (key: string) => void;
  onSortDirChange?: () => void;

  /** bulk select */
  isAllSelected?: boolean;
  onSelectAll?: (checked: boolean) => void;

  /** density */
  density?: "cozy" | "compact";
  onDensityChange?: (d: "cozy" | "compact") => void;
};

const SORT_KEYS: Array<{ key: string; label: string }> = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
];

export default function CommandBar({
  layout = "icons",
  onLayoutChange,
  onToggleView,
  onNew,
  onUpload,
  sortKey = "date",
  sortDir = "desc",
  onSortKeyChange,
  onSortDirChange,
  isAllSelected,
  onSelectAll,
  density = "cozy",
  onDensityChange,
}: Props) {
  const setLayout = (next: LayoutKind) => {
    // prefer explicit layout change
    if (onLayoutChange) onLayoutChange(next);
    // fallback: cycle via old toggle if consumer hasn't migrated
    else if (onToggleView) onToggleView();
  };

  const nextSortKey = () => {
    const idx = SORT_KEYS.findIndex((s) => s.key === sortKey);
    const next = SORT_KEYS[(idx + 1) % SORT_KEYS.length];
    onSortKeyChange?.(next.key);
  };

  return (
    <div className="fm-toolbar" role="toolbar" aria-label="Explorer commands">
      <div className="fm-toolbar-row">
        <div className="fm-toolbar-group">
          <span className="fm-toolbar-label">Actions</span>

          <button
            type="button"
            onClick={() => onSelectAll?.(!(isAllSelected ?? false))}
            className="fm-toolbar-btn"
            data-active={isAllSelected ? "true" : "false"}
            title={isAllSelected ? "Deselect all" : "Select all"}
            aria-pressed={!!isAllSelected}
          >
            <span
              className={[
                "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                isAllSelected
                  ? "bg-teal-500 border-teal-500"
                  : "border-gray-400",
              ].join(" ")}
              aria-hidden
            >
              {isAllSelected && (
                <Check className="w-3 h-3 text-white" strokeWidth={2.5} />
              )}
            </span>
            <span>{isAllSelected ? "Deselect" : "Select all"}</span>
          </button>

          <button
            type="button"
            onClick={onNew}
            disabled={!onNew}
            className="fm-toolbar-btn"
            title="New folder"
          >
            <Plus className="h-4 w-4" />
            <span>New folder</span>
          </button>

          <button
            type="button"
            onClick={onUpload}
            disabled={!onUpload}
            className="fm-toolbar-btn fm-toolbar-btn--primary"
            title="Upload files"
          >
            <Upload className="h-4 w-4" />
            <span>Upload</span>
          </button>
        </div>

        <div className="fm-toolbar-group fm-toolbar-group--center">
          <span className="fm-toolbar-label">View</span>

          <div className="fm-toolbar-segment-wrap">
            <button
              className="fm-toolbar-segment"
              data-active={layout === "large" ? "true" : "false"}
              onClick={() => setLayout("large")}
              title="Large"
              type="button"
            >
              <LayoutGrid className="h-4 w-4" />
              <span>Large</span>
            </button>

            <button
              className="fm-toolbar-segment"
              data-active={layout === "icons" ? "true" : "false"}
              onClick={() => setLayout("icons")}
              title="Icons"
              type="button"
            >
              <Square className="h-4 w-4" />
              <span>Icons</span>
            </button>

            <button
              className="fm-toolbar-segment"
              data-active={layout === "details" ? "true" : "false"}
              onClick={() => setLayout("details")}
              title="Details"
              type="button"
            >
              <List className="h-4 w-4" />
              <span>Details</span>
            </button>

            <button
              className="fm-toolbar-segment"
              data-active={layout === "list" ? "true" : "false"}
              onClick={() => setLayout("list")}
              title="List"
              type="button"
            >
              <Rows3 className="h-4 w-4" />
              <span>List</span>
            </button>
          </div>
        </div>

        <div className="fm-toolbar-group fm-toolbar-group--right">
          <span className="fm-toolbar-label">Sort & density</span>

          <button
            type="button"
            onClick={nextSortKey}
            className="fm-toolbar-chip"
            title="Change sort key"
          >
            <ArrowUpDown className="h-4 w-4" />
            <span>
              {SORT_KEYS.find((s) => s.key === sortKey)?.label ?? "Date"}
            </span>
          </button>

          <button
            type="button"
            onClick={onSortDirChange}
            className="fm-toolbar-chip"
            title="Toggle sort order"
          >
            {(sortDir ?? "desc").toUpperCase()}
          </button>

          <span className="fm-toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            className="fm-toolbar-segment"
            data-active={density === "cozy" ? "true" : "false"}
            onClick={() => onDensityChange?.("cozy")}
            title="Cozy"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Cozy</span>
          </button>

          <button
            type="button"
            className="fm-toolbar-segment"
            data-active={density === "compact" ? "true" : "false"}
            onClick={() => onDensityChange?.("compact")}
            title="Compact"
          >
            <Rows3 className="h-4 w-4" />
            <span>Compact</span>
          </button>
        </div>
      </div>
    </div>
  );
}
