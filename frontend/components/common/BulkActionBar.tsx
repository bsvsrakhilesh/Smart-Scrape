type Selectable = { id: string };

interface BulkActionBarProps<T extends Selectable = Selectable> {
  selected: T[];

  onDelete?: (ids: string[]) => void;
  onRestore?: (ids: string[]) => void;
  onAddTag?: (ids: string[], tag: string) => void;
  onRequestAddTag?: (ids: string[]) => void;
  onFavorite?: (ids: string[]) => void;
  onExport: (selected: T[]) => void;
  onCopy?: (ids: string[]) => void;
  onCut?: (ids: string[]) => void;
  onPaste?: () => void;
  canPaste?: boolean;
  onMoveTo?: (ids: string[]) => void;
  deleteLabel?: string;
  restoreLabel?: string;
}

function BulkActionBar<T extends Selectable>({
  selected,
  onDelete,
  onRestore,
  onAddTag,
  onRequestAddTag,
  onFavorite,
  onExport,
  onCopy,
  onCut,
  onPaste,
  canPaste,
  onMoveTo,
  deleteLabel = "Delete",
  restoreLabel = "Restore",
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
      <div className="text-sm">{selected.length} selected</div>

      {onFavorite && (
        <button
          onClick={() => onFavorite(selectedIds)}
          className={baseBtn}
          title="Mark as favorite"
        >
          Favorite
        </button>
      )}

      {(onAddTag || onRequestAddTag) && (
        <button
          onClick={addTag}
          className={baseBtn}
          title="Add a tag to all selected"
        >
          + Tag
        </button>
      )}

      {onMoveTo && (
        <button
          onClick={() => onMoveTo(selectedIds)}
          className={baseBtn}
          title="Move selected to category…"
        >
          Move to…
        </button>
      )}

      {onCopy && (
        <button
          onClick={() => onCopy(selectedIds)}
          className={baseBtn}
          title="Copy (Ctrl/Cmd+C)"
        >
          Copy
        </button>
      )}

      {onCut && (
        <button
          onClick={() => onCut(selectedIds)}
          className={baseBtn}
          title="Cut (Ctrl/Cmd+X)"
        >
          Cut
        </button>
      )}

      {onPaste && (
        <button
          onClick={onPaste}
          disabled={!canPaste}
          className={`${baseBtn} disabled:opacity-50`}
          title="Paste (Ctrl/Cmd+V)"
        >
          Paste
        </button>
      )}

      {hasPrimaryActions && <span className="mx-1 opacity-30">|</span>}

      <button
        onClick={() => onExport(selected)}
        className={baseBtn}
        title="Export selected as CSV"
      >
        Export
      </button>

      {onRestore && (
        <button
          onClick={() => onRestore(selectedIds)}
          className={`${baseBtn} text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100`}
          title="Restore selected items from Trash"
        >
          {restoreLabel}
        </button>
      )}

      {onDelete && (
        <button
          onClick={() => onDelete(selectedIds)}
          className={`${baseBtn} text-red-600 hover:bg-red-100 active:bg-red-200`}
          title={deleteLabel}
        >
          {deleteLabel}
        </button>
      )}
    </div>
  );
}

export default BulkActionBar;
