// frontend/components/filemanager/CommandBar.tsx
"use client";

import { useMemo } from "react";
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

  const densityLabel = useMemo(
    () => (density === "compact" ? "Compact" : "Cozy"),
    [density],
  );

  const toggleDensity = () => {
    onDensityChange?.(density === "compact" ? "cozy" : "compact");
  };

  return (
    <div
      className="fm-toolbar px-3 py-2 md:px-4 md:py-3"
      role="toolbar"
      aria-label="Explorer commands"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: select + core actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectAll?.(!(isAllSelected ?? false))}
            className="flex items-center h-8 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium"
            title={isAllSelected ? "Deselect all" : "Select all"}
            aria-pressed={!!isAllSelected}
          >
            <span
              className={[
                "w-4 h-4 rounded border-2 flex items-center justify-center mr-2 transition-colors",
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
            <span className="hidden sm:inline">
              {isAllSelected ? "Deselect" : "Select all"}
            </span>
          </button>

          <button
            type="button"
            onClick={onNew}
            disabled={!onNew}
            className="flex items-center h-8 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
            title="New folder"
          >
            <Plus className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">New</span>
          </button>

          <button
            type="button"
            onClick={onUpload}
            disabled={!onUpload}
            className="flex items-center h-8 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-100"
            title="Upload files"
          >
            <Upload className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Upload</span>
          </button>
        </div>

        {/* Center: view/layout (single place) */}
        <div className="flex-1 min-w-[240px] flex justify-center">
          <div className="inline-flex items-center gap-1.5 rounded-2xl bg-white/60 ring-1 ring-white/60 p-1.5 overflow-x-auto fm-no-scrollbar shadow-sm">
            <button
              className={`fm-segmented ${layout === "large" ? "fm-seg-active" : ""}`}
              onClick={() => setLayout("large")}
              title="Large"
              type="button"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline text-xs ml-1">Large</span>
            </button>

            <button
              className={`fm-segmented ${layout === "icons" ? "fm-seg-active" : ""}`}
              onClick={() => setLayout("icons")}
              title="Icons"
              type="button"
            >
              <Square className="h-4 w-4" />
              <span className="hidden sm:inline text-xs ml-1">Icons</span>
            </button>

            <button
              className={`fm-segmented ${layout === "details" ? "fm-seg-active" : ""}`}
              onClick={() => setLayout("details")}
              title="Details"
              type="button"
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline text-xs ml-1">Details</span>
            </button>

            <button
              className={`fm-segmented ${layout === "list" ? "fm-seg-active" : ""}`}
              onClick={() => setLayout("list")}
              title="List"
              type="button"
            >
              <Rows3 className="h-4 w-4" />
              <span className="hidden sm:inline text-xs ml-1">List</span>
            </button>
          </div>
        </div>

        {/* Right: sort + density (single place) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={nextSortKey}
              className="flex items-center h-8 px-3 text-gray-700 text-sm font-medium hover:bg-gray-200/50 rounded-l-lg"
              title="Change sort key"
            >
              <ArrowUpDown className="h-4 w-4" />
              <span className="mx-2">
                {SORT_KEYS.find((s) => s.key === sortKey)?.label ?? "Date"}
              </span>
            </button>

            <button
              type="button"
              onClick={onSortDirChange}
              className="h-8 px-3 text-gray-700 text-sm font-medium border-l border-gray-300 hover:bg-gray-200/50 rounded-r-lg"
              title="Toggle sort order"
            >
              {(sortDir ?? "desc").toUpperCase()}
            </button>
          </div>

          <div className="mx-1 h-4 w-px bg-[hsl(var(--border))]" aria-hidden />

          {/* Density: show a single toggle on small screens, segmented on md+ */}
          <button
            type="button"
            className="md:hidden flex items-center h-8 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium"
            onClick={toggleDensity}
            title="Toggle density"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="ml-2">{densityLabel}</span>
          </button>

          <div className="hidden md:flex items-center gap-1.5">
            <button
              type="button"
              className={`fm-segmented ${density === "cozy" ? "fm-seg-active" : ""}`}
              onClick={() => onDensityChange?.("cozy")}
              title="Cozy"
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="ml-1 hidden xl:inline text-[12px] text-[hsl(var(--muted-foreground))]">
                Cozy
              </span>
            </button>

            <button
              type="button"
              className={`fm-segmented ${density === "compact" ? "fm-seg-active" : ""}`}
              onClick={() => onDensityChange?.("compact")}
              title="Compact"
            >
              <Rows3 className="h-4 w-4" />
              <span className="ml-1 hidden xl:inline text-[12px] text-[hsl(var(--muted-foreground))]">
                Compact
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
