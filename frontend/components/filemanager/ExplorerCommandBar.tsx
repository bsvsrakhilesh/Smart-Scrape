// frontend/components/filemanager/ExplorerCommandBar.tsx
"use client";

import { useMemo } from "react";

import {
  Plus,
  Upload,
  ChevronDown,
  LayoutGrid,
  Square,
  List,
  Rows3,
  ArrowUpDown,
  PanelRight,
  Check,
  Filter,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

type LayoutKind = "large" | "icons" | "details" | "list"; // list will alias to details

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

  /** inspector right pane */
  onToggleInspector?: () => void;

  /** density */
  density?: "comfortable" | "compact";
  onDensityChange?: (d: "comfortable" | "compact") => void;

  /** quick filters */
  onQuickFilter?: (key: string) => void;
};

const SORT_KEYS: Array<{ key: string; label: string }> = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
];

const QUICK_FILTERS: Array<{ key: string; label: string }> = [
  { key: "recent", label: "Recent" },
  { key: "images", label: "Images" },
  { key: "videos", label: "Videos" },
  { key: "docs", label: "Docs" },
  { key: "starred", label: "Starred" },
];

export default function ExplorerCommandBar({
  layout,
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
  onToggleInspector,
  density = "comfortable",
  onDensityChange,
  onQuickFilter,
}: Props) {
  const normalizedLayout: LayoutKind = layout ?? "large";
  // Optional alias used only where you truly need 'list' to behave as 'details'
  const effectiveLayout = normalizedLayout === "list" ? "details" : normalizedLayout;

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
    () => (density === "compact" ? "Compact" : "Comfortable"),
    [density]
  );

  return (
    <div
      className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))]/80 backdrop-blur-md shadow-[var(--shadow-soft)] px-3 py-2 md:px-4 md:py-3"
      role="toolbar"
      aria-label="Explorer commands"
    >
      {/* Row 1 — primary controls */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Select All */}
        <button
          type="button"
          onClick={() => onSelectAll?.(!(isAllSelected ?? false))}
          className="fm-btn"
          title={isAllSelected ? "Deselect all" : "Select all"}
          aria-pressed={!!isAllSelected}
        >
          <Check className="h-4 w-4" />
          <span className="hidden sm:inline text-sm">
            {isAllSelected ? "Deselect" : "Select all"}
          </span>
        </button>

        {/* New / Upload */}
        <div className="inline-flex items-center gap-1 rounded-xl bg-[hsl(var(--surface-elev))] p-1">
          <button onClick={onNew} className="fm-btn" title="New…">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">New</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
          <button onClick={onUpload} className="fm-btn" title="Upload files">
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">Upload</span>
          </button>
        </div>

        {/* Divider */}
        <div className="mx-2 h-6 w-px bg-[hsl(var(--border))]" aria-hidden />

        {/* Sort */}
        <div className="flex items-center gap-1">
          <button
            className="fm-btn"
            onClick={onSortDirChange}
            title={`Sort ${sortDir === "asc" ? "descending" : "ascending"}`}
          >
            <ArrowUpDown className="h-4 w-4" />
            <span className="hidden md:inline text-sm">
              {SORT_KEYS.find((s) => s.key === sortKey)?.label ?? "Sort"}
            </span>
          </button>
          <button className="fm-chip" onClick={nextSortKey} title="Change sort">
            {SORT_KEYS.find((s) => s.key === sortKey)?.label}
          </button>
          <span className="fm-chip-muted uppercase text-[11px] tracking-wide">
            {sortDir}
          </span>
        </div>

        {/* Divider */}
        <div className="mx-2 h-6 w-px bg-[hsl(var(--border))]" aria-hidden />

        {/* Density */}
        <div className="hidden md:flex items-center gap-1">
          <button
            className={`fm-segmented ${density === "comfortable" ? "fm-seg-active" : ""}`}
            onClick={() => onDensityChange?.("comfortable")}
            title="Comfortable"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <button
            className={`fm-segmented ${density === "compact" ? "fm-seg-active" : ""}`}
            onClick={() => onDensityChange?.("compact")}
            title="Compact"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <Rows3 className="h-3.5 w-3.5 -ml-0.5" />
          </button>
          <span className="ml-1 hidden xl:inline text-[12px] text-[hsl(var(--muted-foreground))]">
            {densityLabel}
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Inspector */}
        <button
          onClick={onToggleInspector}
          className="fm-btn"
          title="Toggle Inspector"
        >
          <PanelRight className="h-4 w-4" />
          <span className="hidden sm:inline text-sm">Inspector</span>
        </button>
      </div>

      {/* Row 2 — view switch + quick filters */}
      <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        {/* View segmented control: Large (tiles), Icons, Details, List (alias details) */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1">
          <button
            className={`fm-segmented ${layout === "large" ? "fm-seg-active" : ""}`}
            onClick={() => setLayout("large")}
            title="Large"
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline text-xs ml-1">Large</span>
          </button>
          <button
            className={`fm-segmented ${layout === "icons" ? "fm-seg-active" : ""}`}
            onClick={() => setLayout("icons")}
            title="Icons"
          >
            <Square className="h-4 w-4" />
            <span className="hidden sm:inline text-xs ml-1">Icons</span>
          </button>
          <button
            className={`fm-segmented ${layout === "details" ? "fm-seg-active" : ""}`}
            onClick={() => setLayout("details")}
            title="Details"
          >
            <List className="h-4 w-4" />
            <span className="hidden sm:inline text-xs ml-1">Details</span>
          </button>
          <button
            className={`fm-segmented ${layout === "list" ? "fm-seg-active" : ""}`}
            onClick={() => setLayout("list")}
            title="List"
          >
            <Rows3 className="h-4 w-4" />
            <span className="hidden sm:inline text-xs ml-1">List</span>
          </button>
        </div>

        {/* Quick filter chips (no search here; search lives in ExplorerBreadcrumbs) */}
        <div className="flex items-center gap-1 overflow-x-auto fm-no-scrollbar py-1">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.key}
              className="fm-chip"
              onClick={() => onQuickFilter?.(f.key)}
              title={`Filter: ${f.label}`}
            >
              <Filter className="h-3.5 w-3.5 mr-1" />
              {f.label}
            </button>
          ))}
          <span className="text-[11px] text-[hsl(var(--muted-foreground))] ml-1 inline-flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" /> smart filters
          </span>
        </div>
      </div>
    </div>
  );
}
