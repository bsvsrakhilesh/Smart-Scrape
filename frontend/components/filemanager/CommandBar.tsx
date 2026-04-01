// frontend/components/filemanager/CommandBar.tsx
"use client";

import {
  Upload,
  LayoutGrid,
  Square,
  List,
  Rows3,
  Check,
  Minus,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  SlidersHorizontal,
  PanelTop,
  Layers3,
} from "lucide-react";

type LayoutKind = "large" | "icons" | "details" | "list";

type Props = {
  layout?: LayoutKind;
  onLayoutChange?: (layout: LayoutKind) => void;
  onToggleView?: () => void;

  onNew?: () => void;
  onUpload?: () => void;

  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSortKeyChange?: (key: string) => void;
  onSortDirChange?: () => void;

  isAllSelected?: boolean;
  onSelectAll?: (checked: boolean) => void;
  selectedCount?: number;
  visibleCount?: number;
  totalCount?: number;

  density?: "cozy" | "compact";
  onDensityChange?: (d: "cozy" | "compact") => void;

  readOnly?: boolean;
  scopeLabel?: string;
};

const SORT_KEYS: Array<{ key: string; label: string }> = [
  { key: "date", label: "Date" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
];

const LAYOUT_OPTIONS: Array<{
  key: LayoutKind;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { key: "large", label: "Large", icon: LayoutGrid },
  { key: "icons", label: "Icons", icon: Square },
  { key: "details", label: "Details", icon: List },
  { key: "list", label: "List", icon: Rows3 },
];

const DENSITY_OPTIONS: Array<{ key: "cozy" | "compact"; label: string }> = [
  { key: "cozy", label: "Cozy" },
  { key: "compact", label: "Compact" },
];

const formatCount = (value: number) =>
  Math.max(0, Number(value || 0)).toLocaleString();

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
  isAllSelected = false,
  onSelectAll,
  selectedCount = 0,
  visibleCount = 0,
  totalCount = 0,
  density = "cozy",
  onDensityChange,
  readOnly = false,
  scopeLabel = "Current scope",
}: Props) {
  const setLayout = (next: LayoutKind) => {
    if (onLayoutChange) onLayoutChange(next);
    else if (onToggleView) onToggleView();
  };

  const safeSelectedCount = Math.max(0, Number(selectedCount || 0));
  const safeVisibleCount = Math.max(0, Number(visibleCount || 0));
  const safeTotalCount = Math.max(safeVisibleCount, Number(totalCount || 0));

  const hasVisibleItems = safeVisibleCount > 0;
  const hasSelection = safeSelectedCount > 0;
  const isMixedSelection = hasSelection && !isAllSelected;
  const showsTotal = safeTotalCount > safeVisibleCount;

  const selectLabel = isAllSelected
    ? "All on page"
    : isMixedSelection
      ? `${formatCount(safeSelectedCount)} selected`
      : "Select all";

  const selectTitle = !hasVisibleItems
    ? "No items on this page"
    : isAllSelected
      ? "Deselect all items on this page"
      : "Select all items on this page";

  const summaryText = hasSelection
    ? `${formatCount(safeSelectedCount)} selected · ${formatCount(safeVisibleCount)} visible${showsTotal ? ` · ${formatCount(safeTotalCount)} total` : ""}`
    : `${formatCount(safeVisibleCount)} visible on this page${showsTotal ? ` · ${formatCount(safeTotalCount)} total in scope` : ""}`;

  return (
    <div className="fm-toolbar" role="toolbar" aria-label="Explorer commands">
      <div className="cmdbar-surface">
        <div className="cmdbar-top">
          <section className="cmdbar-context" aria-label="Scope overview">
            <div className="cmdbar-eyebrow">Workspace controls</div>

            <div className="cmdbar-heading-row">
              <div className="cmdbar-heading-wrap">
                <h2 className="cmdbar-heading">{scopeLabel}</h2>
                <p className="cmdbar-summary" aria-live="polite">
                  {summaryText}
                </p>
              </div>

              <div className="cmdbar-badges" aria-label="Scope status">
                <span
                  className="cmdbar-badge"
                  data-tone={readOnly ? "muted" : "success"}
                >
                  <span className="cmdbar-badge-dot" aria-hidden="true" />
                  {readOnly ? "Read-only" : "Editable"}
                </span>

                <span className="cmdbar-badge">
                  <Layers3 className="h-3.5 w-3.5" />
                  {formatCount(safeVisibleCount)} on page
                </span>

                {showsTotal ? (
                  <span className="cmdbar-badge">
                    <PanelTop className="h-3.5 w-3.5" />
                    {formatCount(safeTotalCount)} in scope
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          <section className="cmdbar-actions" aria-label="Primary actions">
            <button
              type="button"
              onClick={() => onSelectAll?.(!isAllSelected)}
              disabled={!onSelectAll || !hasVisibleItems}
              className="cmdbar-button cmdbar-button--secondary"
              data-active={hasSelection ? "true" : "false"}
              title={selectTitle}
              aria-pressed={hasSelection}
            >
              <span
                className="cmdbar-checkbox"
                data-state={
                  isAllSelected ? "checked" : isMixedSelection ? "mixed" : "empty"
                }
                aria-hidden="true"
              >
                {isAllSelected ? (
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                ) : isMixedSelection ? (
                  <Minus className="h-3 w-3" strokeWidth={2.5} />
                ) : null}
              </span>
              <span>{selectLabel}</span>
            </button>

            <button
              type="button"
              onClick={onNew}
              disabled={!onNew || readOnly}
              className="cmdbar-button cmdbar-button--secondary"
              title={
                readOnly
                  ? "New folders are unavailable in read-only scopes"
                  : "Create a new folder"
              }
            >
              <FolderPlus className="h-4 w-4" />
              <span>New folder</span>
            </button>

            <button
              type="button"
              onClick={onUpload}
              disabled={!onUpload || readOnly}
              className="cmdbar-button cmdbar-button--primary"
              title={
                readOnly
                  ? "Uploads are unavailable in read-only scopes"
                  : "Upload files"
              }
            >
              <Upload className="h-4 w-4" />
              <span>Upload</span>
            </button>
          </section>
        </div>

        <div className="cmdbar-bottom">
          <section className="cmdbar-control-block" aria-label="View mode">
            <div className="cmdbar-block-head">
              <span className="cmdbar-block-label">View</span>
            </div>

            <div className="cmdbar-segmented" role="group" aria-label="Layout mode">
              {LAYOUT_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = layout === option.key;

                return (
                  <button
                    key={option.key}
                    type="button"
                    className="cmdbar-segment"
                    data-active={active ? "true" : "false"}
                    onClick={() => setLayout(option.key)}
                    title={option.label}
                    aria-pressed={active}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="cmdbar-control-block cmdbar-control-block--utility" aria-label="Sort and density controls">
            <div className="cmdbar-select-field">
              <span className="cmdbar-block-label">Sort</span>
              <label className="cmdbar-select-wrap">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <select
                  className="cmdbar-select"
                  value={sortKey}
                  onChange={(e) => onSortKeyChange?.(e.target.value)}
                  aria-label="Sort by"
                >
                  {SORT_KEYS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={onSortDirChange}
              className="cmdbar-chip"
              title={
                sortDir === "asc"
                  ? "Currently ascending. Toggle to descending"
                  : "Currently descending. Toggle to ascending"
              }
              aria-label={
                sortDir === "asc"
                  ? "Ascending sort order"
                  : "Descending sort order"
              }
            >
              {sortDir === "asc" ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
              <span>{sortDir === "asc" ? "Ascending" : "Descending"}</span>
            </button>

            <div className="cmdbar-density" role="group" aria-label="Density">
              {DENSITY_OPTIONS.map((option) => {
                const active = density === option.key;

                return (
                  <button
                    key={option.key}
                    type="button"
                    className="cmdbar-chip"
                    data-active={active ? "true" : "false"}
                    onClick={() => onDensityChange?.(option.key)}
                    aria-pressed={active}
                    title={`${option.label} density`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
