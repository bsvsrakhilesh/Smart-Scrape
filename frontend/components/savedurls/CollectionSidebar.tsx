import React, { useMemo } from "react";
import { Collection } from "../../lib/types";

interface CollectionSidebarProps {
  collections: Collection[];
  collectionCounts: Record<string, number>;
  totalUrlCount: number;
  selectedCollectionId?: string;
  onSelect: (id: string | undefined) => void;
  onCreateClick?: () => void;
  onRenameClick?: (collection: Collection) => void;
  onDeleteClick?: (collection: Collection) => void;
}

const CollectionSidebar: React.FC<CollectionSidebarProps> = ({
  collections,
  collectionCounts,
  totalUrlCount,
  selectedCollectionId,
  onSelect,
  onCreateClick,
  onRenameClick,
  onDeleteClick,
}) => {
  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId),
    [collections, selectedCollectionId],
  );

  const baseBtn =
    "w-full text-left rounded-xl px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40";
  const active =
    "bg-green-100 text-green-900 shadow-sm dark:bg-green-900/30 dark:text-green-100";
  const hover =
    "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300";

  const chipClass =
    "inline-flex min-w-[2rem] items-center justify-center rounded-full border border-black/10 dark:border-white/10 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-300";

  const canDeleteSelected =
    !!selectedCollection && selectedCollection.id !== "c_general";

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-neutral-950 dark:text-neutral-100">
            Collections
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Organize saved URLs into reusable review buckets.
          </p>
        </div>

        <button
          className="rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 dark:hover:bg-neutral-800"
          onClick={onCreateClick}
          title="Create collection"
          type="button"
        >
          + Add
        </button>
      </div>

      <div className="space-y-1">
        <button
          className={`${baseBtn} ${!selectedCollectionId ? active : hover}`}
          onClick={() => onSelect(undefined)}
          type="button"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-medium">All saved URLs</span>
            <span className={chipClass}>{totalUrlCount}</span>
          </div>
        </button>

        {collections.map((c) => {
          const count = collectionCounts[c.id] ?? 0;
          const isActive = selectedCollectionId === c.id;

          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`${baseBtn} ${isActive ? active : hover}`}
              title={c.name}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">{c.name}</span>
                <span className={chipClass}>{count}</span>
              </div>
            </button>
          );
        })}
      </div>

      {selectedCollection && (
        <div className="rounded-2xl border border-black/10 bg-neutral-50/80 p-3 dark:border-white/10 dark:bg-neutral-900/60">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {selectedCollection.name}
              </div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {collectionCounts[selectedCollection.id] ?? 0} URL
                {(collectionCounts[selectedCollection.id] ?? 0) === 1
                  ? ""
                  : "s"}{" "}
                in this collection
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onRenameClick?.(selectedCollection)}
              className="rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-white dark:hover:bg-neutral-800"
            >
              Rename
            </button>

            <button
              type="button"
              onClick={() => onDeleteClick?.(selectedCollection)}
              disabled={!canDeleteSelected}
              className="rounded-xl border px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30"
              title={
                canDeleteSelected
                  ? "Delete collection"
                  : "The default General collection is protected"
              }
            >
              Delete
            </button>
          </div>

          {!canDeleteSelected && (
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              The default General collection is protected.
            </p>
          )}
        </div>
      )}
    </aside>
  );
};

export default CollectionSidebar;
