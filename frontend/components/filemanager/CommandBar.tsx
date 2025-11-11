// frontend/components/filemanager/CommandBar.tsx
"use client";
import { useMemo } from "react";
import {
  Plus, Upload, ChevronDown, LayoutGrid, Square, List, Rows3, ArrowUpDown, PanelRight, Check, Filter, SlidersHorizontal, Sparkles,
} from "lucide-react";

type LayoutKind = "large" | "icons" | "details" | "list"; 

type Props = {
  layout?: LayoutKind;
  onLayoutChange?: (layout: LayoutKind) => void;
  onToggleView?: () => void;
  onNew?: () => void;
  onUpload?: () => void;
  isInspectorVisible?: boolean;

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

export default function CommandBar({
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
  isInspectorVisible,
  density = "comfortable",
  onDensityChange,
  onQuickFilter,
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
    () => (density === "compact" ? "Compact" : "Comfortable"),
    [density]
  );

  return (
    <div
      className="glass-card fm-toolbar sticky top-2 z-30 px-3 py-2 md:px-4 md:py-3"
      role="toolbar"
      aria-label="Explorer commands"
    >
      {/* Row 1 — primary controls */}
      <div className="flex items-center justify-between gap-x-6 gap-y-1 whitespace-nowrap">
        <div className="flex items-center gap-2 flex-shrink-0">
         {/* Select All (updated classes) */}
         <button
           type="button"
           onClick={() => onSelectAll?.(!(isAllSelected ?? false))}
           className="flex items-center h-8 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium"
           title={isAllSelected ? "Deselect all" : "Select all"}
           aria-pressed={!!isAllSelected}
         >
           <div
             className={`w-4 h-4 rounded border-2 ${isAllSelected ? "bg-teal-500 border-teal-500" : "border-gray-400"} flex items-center justify-center mr-2.5 transition-colors`}
             aria-hidden
           >
             {isAllSelected && <Check className="w-3 h-3 text-white" strokeWidth={2.5} />}
           </div>
           <span className="hidden sm:inline">
             {isAllSelected ? "Deselect" : "Select all"}
           </span>
         </button>

         {/* New / Upload (updated classes, preserved handlers) */}
         <button
           onClick={onNew}
           className="flex items-center h-8 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium"
           title="New…"
         >
           <Plus className="h-4 w-4" />
           <span className="ml-2 hidden sm:inline">New</span>
           <ChevronDown className="w-4 h-4 ml-1 text-gray-500" />
         </button>
        <button
           onClick={onUpload}
           className="flex items-center h-8 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium"
           title="Upload files"
         >
           <Upload className="h-4 w-4" />
           <span className="ml-2 hidden sm:inline">Upload</span>
         </button>
        </div>
        
        {/* right group (sort / density / inspector) */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center bg-gray-100 rounded-lg">
           <button
             onClick={nextSortKey}
             className="flex items-center h-8 px-4 text-gray-700 text-sm font-medium hover:bg-gray-200/50 rounded-l-lg"
             title="Change sort key"
           >
             <ArrowUpDown className="h-4 w-4" />
             <span className="mx-2">
               {SORT_KEYS.find((s) => s.key === sortKey)?.label ?? "Date"}
             </span>
           </button>

           <button
             onClick={onSortDirChange}
             className="h-8 px-4 text-gray-700 text-sm font-medium border-l border-gray-300 hover:bg-gray-200/50 rounded-r-lg"
             title="Toggle sort order"
           >
             {(sortDir ?? "desc").toUpperCase()}
           </button>
         </div>

          <div className="mx-3 h-4 w-px bg-[hsl(var(--border))]" aria-hidden />

          {/* Density */}
          <div className="hidden md:flex items-center gap-1.5">
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
         
          {/* Inspector */}
          <div className="mx-3 h-4 w-px bg-[hsl(var(--border))]" aria-hidden />

          <button
            onClick={onToggleInspector}
            className={`flex items-center h-8 px-4 rounded-lg text-sm font-medium ${isInspectorVisible ? 'bg-gray-200 text-gray-800' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
            title="Toggle Inspector"
          >
            <PanelRight className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Inspector</span>
          </button>
          </div>
        </div>
      </div>

      {/* Row 2 — view switch + quick filters */}
      <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* View segmented control: Large (tiles), Icons, Details, List (alias details) */}
        <div className="inline-flex items-center gap-1.5 rounded-2xl bg-white/60 ring-1 ring-white/60 p-1.5 overflow-x-auto fm-no-scrollbar shadow-sm"
>
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

        <div className="flex items-center gap-1.5 overflow-x-auto fm-no-scrollbar py-1 pl-1">
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
