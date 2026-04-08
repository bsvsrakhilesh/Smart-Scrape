import React from "react";
import { Collection } from "../../lib/types";

interface CollectionSidebarProps {
  collections: Collection[];
  selectedCollectionId?: string;
  onSelect: (id: string | undefined) => void;
  onCreateClick?: () => void;
}

const CollectionSidebar: React.FC<CollectionSidebarProps> = ({
  collections,
  selectedCollectionId,
  onSelect,
  onCreateClick,
}) => {
  const baseBtn =
    "w-full text-left px-3 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40";
  const active =
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200";
  const hover =
    "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300";

  return (
    <aside className="bg-white dark:bg-gray-900 rounded-2xl border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Collections</h3>
        <button
          className="px-2 py-1 text-sm rounded border hover:bg-neutral-50 dark:hover:bg-neutral-800"
          onClick={onCreateClick}
          title="Add new collection"
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
          All
        </button>

        {collections.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`${baseBtn} ${selectedCollectionId === c.id ? active : hover}`}
            title={c.name}
            type="button"
          >
            {c.name}
          </button>
        ))}
      </div>
    </aside>
  );
};

export default CollectionSidebar;
