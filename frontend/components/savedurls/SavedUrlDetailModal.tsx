import React, { useEffect, useState } from 'react';
import { SavedUrl } from '../../types';
import { createPortal } from 'react-dom';
import { formatDate } from '../../utils/fileHelpers';
import CloseIcon from '../icons/CloseIcon';
import AITagButton from '../common/AITagButton';

interface SavedUrlDetailModalProps {
  url: SavedUrl;
  isOpen: boolean;
  onClose: () => void;
  onFavoriteToggle: (url: SavedUrl) => void;
  onTagUpdate?: (urlId: string, newTags: string[]) => void;
  onNotesChange?: (urlId: string, notes: string) => void;
}

const SavedUrlDetailModal: React.FC<SavedUrlDetailModalProps> = ({
  url,
  isOpen,
  onClose,
  onFavoriteToggle,
  onTagUpdate,
  onNotesChange,
}) => {
  // Local state for tags and new tag input
  const [localTags, setLocalTags] = useState<string[]>(url.tags);
  const [newTagInput, setNewTagInput] = useState<string>('');

  // Sync localTags when url changes
  useEffect(() => {
    setLocalTags(url.tags);
  }, [url.tags]);

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Handlers for adding/removing tags
  const addTag = () => {
    const trimmed = newTagInput.trim();
    if (trimmed && !localTags.includes(trimmed)) {
      const updated = [...localTags, trimmed];
      setLocalTags(updated);
      onTagUpdate?.(url.id, updated);
    }
    setNewTagInput('');
  };

  const removeTag = (tag: string) => {
    const updated = localTags.filter((t) => t !== tag);
    setLocalTags(updated);
    onTagUpdate?.(url.id, updated);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-4">
      <div className="relative max-w-4xl w-full bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{url.title}</h2>
            <div className="text-sm text-gray-500 truncate">{url.domain}</div>
          </div>
          <button onClick={onClose} aria-label="Close">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left: Main details */}
          <div className="md:col-span-2 space-y-4">
            {/* URL & Favorite */}
            <div className="flex justify-between items-start">
              <div className="flex gap-4">
                {url.faviconUrl && (
                  <img
                    src={url.faviconUrl}
                    alt="favicon"
                    className="w-8 h-8 rounded-sm"
                  />
                )}
                <div>
                  <div className="text-sm text-gray-500">URL</div>
                  <a
                    href={url.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline break-all"
                  >
                    {url.url}
                  </a>
                </div>
              </div>
              <button
                onClick={() => onFavoriteToggle(url)}
                className="px-3 py-2 border rounded flex items-center gap-1"
              >
                {url.isFavorited ? 'Unfavorite' : 'Favorite'}
              </button>
            </div>

            {/* Notes */}
            <div>
              <div className="text-sm text-gray-500">Description / Notes</div>
              <textarea
                defaultValue={url.notes}
                onBlur={(e) => onNotesChange?.(url.id, e.target.value)}
                className="w-full border rounded p-2 min-h-[120px]"
              />
            </div>

            {/* Tags - Editable */}
            <div>
              <div className="text-sm text-gray-500">Tags</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {localTags.map((t) => (
                  <div
                    key={t}
                    className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 rounded-full"
                  >
                    <span>{t}</span>
                    <button
                      onClick={() => removeTag(t)}
                      aria-label={`Remove tag ${t}`}
                      className="text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    placeholder="Add tag"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    className="px-2 py-1 border rounded text-xs"
                  />
                  <button
                    onClick={addTag}
                    className="px-2 py-1 border rounded text-xs"
                  >
                    Add
                  </button>
                  <AITagButton
                  kind="url"
                  id={Number(url.id)}   // SavedUrl.id is string in UI; backend expects number
                  onMerge={(aiTags) => {
                  const merged = Array.from(new Set([...(url.tags || []), ...aiTags]));
                  setLocalTags(merged);
                  onTagUpdate?.(url.id, merged); // persists via your page handler
                  }}
                  />
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div>
              <div className="text-sm text-gray-500">Metadata</div>
              <div className="grid grid-cols-2 gap-4 text-xs mt-1">
                <div>
                  <strong>Created:</strong> {formatDate(url.createdAt)}
                </div>
                <div>
                  <strong>Last visited:</strong>{' '}
                  {url.lastVisitedAt
                    ? formatDate(url.lastVisitedAt)
                    : '—'}
                </div>
                <div>
                  <strong>Visits:</strong> {url.visitCount}
                </div>
                <div>
                  <strong>Visibility:</strong> {url.visibility}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Related & Collections */}
          <div className="space-y-4">
            <div>
              <div className="font-semibold mb-1">Related Links</div>
              <div className="text-sm text-gray-500">
                (placeholder — implement similarity / same domain / tag-based)
              </div>
            </div>
            <div>
              <div className="font-semibold mb-1">Collections</div>
              <div className="flex flex-wrap gap-2">
                {url.collections.map((c) => (
                  <span
                    key={c}
                    className="text-xs px-2 py-1 bg-gray-200 rounded-full"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-md"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SavedUrlDetailModal;
