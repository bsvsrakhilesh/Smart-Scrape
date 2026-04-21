type Selectable = { id: string };

interface BulkActionBarProps<T extends Selectable = Selectable> {
  selected: T[];

  onDelete?: (ids: string[]) => void;
  onRestore?: (ids: string[]) => void;
  onAddTag?: (ids: string[], tag: string) => void;
  onRequestAddTag?: (ids: string[]) => void;
  onFavorite?: (ids: string[]) => void;
  onDownload?: (selected: T[]) => void;
  onExport: (selected: T[]) => void;
  onCopy?: (ids: string[]) => void;
  onCut?: (ids: string[]) => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onMoveTo?: (ids: string[]) => void;
  selectionSummary?: string;
  deleteLabel?: string;
  restoreLabel?: string;
  downloadLabel?: string;
  exportLabel?: string;
  copyLabel?: string;
  cutLabel?: string;
  pasteLabel?: string;
  moveToLabel?: string;
  favoriteTitle?: string;
  addTagTitle?: string;
  deleteTitle?: string;
  restoreTitle?: string;
  downloadTitle?: string;
  exportTitle?: string;
  copyTitle?: string;
  cutTitle?: string;
  pasteTitle?: string;
  moveToTitle?: string;
}

function BulkActionBar<T extends Selectable>({
  selected,
  onDelete,
  onRestore,
  onAddTag,
  onRequestAddTag,
  onFavorite,
  onDownload,
  onExport,
  onCopy,
  onCut,
  onPaste,
  canPaste,
  onMoveTo,
  selectionSummary,
  deleteLabel = "Delete",
  restoreLabel = "Restore",
  downloadLabel = "Download",
  exportLabel = "Export",
  copyLabel = "Copy",
  cutLabel = "Cut",
  pasteLabel = "Paste",
  moveToLabel = "Move to…",
  favoriteTitle = "Mark the selected items as favorite",
  addTagTitle = "Add a tag to the selected items",
  deleteTitle = "Delete the selected items",
  restoreTitle = "Restore the selected items",
  downloadTitle = "Download the selected items",
  exportTitle = "Export the selected items as CSV",
  copyTitle = "Copy (Ctrl/Cmd+C)",
  cutTitle = "Cut (Ctrl/Cmd+X)",
  pasteTitle = "Paste (Ctrl/Cmd+V)",
  moveToTitle = "Move selected to category…",
}: BulkActionBarProps<T>) {
  if (!selected.length) return null;

  const selectedIds = selected.map((s) => s.id);

  const addTag = () => {
    if (onRequestAddTag) {
      onRequestAddTag(selectedIds);
      return;
    }
    if (!onAddTag) return;

    const tag = prompt("Add tag");
    if (tag && tag.trim()) onAddTag(selectedIds, tag.trim());
  };

  const hasPrimaryActions =
    !!onFavorite ||
    !!onAddTag ||
    !!onRequestAddTag ||
    !!onMoveTo ||
    !!onCopy ||
    !!onCut ||
    !!onPaste;

  // Button base classes add a subtle scale + translate on active (click) for tactile feedback.
  // Adjust these if your Tailwind build doesn't include translate-y-1; use translate-y-0.5 or remove as needed.
  const baseBtn =
    "text-xs px-3 py-1 border rounded hover:bg-gray-100 transition-transform transition-colors transform active:scale-95 active:translate-y-1 active:opacity-90 focus:outline-none";

  return (
    <div className="card p-2 flex flex-wrap items-center gap-2">
      <div className="text-sm">
        {selectionSummary ?? `${selected.length} selected`}
      </div>

      {onFavorite && (
        <button
          onClick={() => onFavorite(selectedIds)}
          className={baseBtn}
          title={favoriteTitle}
        >
          Favorite
        </button>
      )}

      {(onAddTag || onRequestAddTag) && (
        <button onClick={addTag} className={baseBtn} title={addTagTitle}>
          + Tag
        </button>
      )}

      {onMoveTo && (
        <button
          onClick={() => onMoveTo(selectedIds)}
          className={baseBtn}
          title={moveToTitle}
        >
          {moveToLabel}
        </button>
      )}

      {onCopy && (
        <button
          onClick={() => onCopy(selectedIds)}
          className={baseBtn}
          title={copyTitle}
        >
          {copyLabel}
        </button>
      )}

      {onCut && (
        <button
          onClick={() => onCut(selectedIds)}
          className={baseBtn}
          title={cutTitle}
        >
          {cutLabel}
        </button>
      )}

      {onPaste && (
        <button
          onClick={onPaste}
          disabled={!canPaste}
          className={`${baseBtn} disabled:opacity-50`}
          title={pasteTitle}
        >
          {pasteLabel}
        </button>
      )}

      {hasPrimaryActions && <span className="mx-1 opacity-30">|</span>}

      {onDownload && (
        <button
          onClick={() => onDownload(selected)}
          className={baseBtn}
          title={downloadTitle}
        >
          {downloadLabel}
        </button>
      )}

      <button
        onClick={() => onExport(selected)}
        className={baseBtn}
        title={exportTitle}
      >
        {exportLabel}
      </button>

      {onRestore && (
        <button
          onClick={() => onRestore(selectedIds)}
          className={`${baseBtn} text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100`}
          title={restoreTitle}
        >
          {restoreLabel}
        </button>
      )}

      {onDelete && (
        <button
          onClick={() => onDelete(selectedIds)}
          className={`${baseBtn} text-red-600 hover:bg-red-100 active:bg-red-200`}
          title={deleteTitle}
        >
          {deleteLabel}
        </button>
      )}
    </div>
  );
}

export default BulkActionBar;
