import React, { useEffect } from 'react';
import { Collection } from '../../types';
import CloseIcon from '../icons/CloseIcon';

interface Props {
  isOpen: boolean;
  collections: Collection[];
  onCancel: () => void;
  onConfirm: (collectionId: string) => void;
  onCreate?: (name: string) => void;
}

const CollectionPickerModal: React.FC<Props> = ({
  isOpen,
  collections,
  onCancel,
  onConfirm,
  onCreate,
}) => {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    if (isOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md shadow-xl border p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Save to category</h3>
          <button className="btn-ghost" onClick={onCancel} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-auto">
          {collections.map((c) => (
            <button
              key={c.id}
              onClick={() => onConfirm(c.id)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {c.name}
            </button>
          ))}
        </div>

        {onCreate && (
          <div className="mt-4 border-t pt-3">
            <button
              onClick={() => {
                const name = window.prompt('New category name?') || '';
                const trimmed = name.trim();
                if (!trimmed) return;
                onCreate(trimmed);
              }}
              className="w-full px-3 py-2 rounded-lg border hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              + Create new category
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionPickerModal;
