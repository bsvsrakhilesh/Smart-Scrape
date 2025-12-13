import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { listFolders, createFolder, getFolder } from '../../lib/api';
import CloseIcon from '../icons/CloseIcon';
import { PlusButton } from '../ui/PlusButton';

type Folder = { id: string; name: string; parentId?: string | null };
type Mode = 'text' | 'pdf';

interface Props {
  open: boolean;
  suggestedName: string;
  mode: Mode;
  onCancel: () => void;
  onConfirm: (opts: { folderId?: string | null; fileName: string; mode: Mode }) => void;
}

const FolderPickerModal: React.FC<Props> = ({ open, suggestedName, mode, onCancel, onConfirm }) => {
  const [current, setCurrent] = useState<string | null>(null); // null = root
  const [stack, setStack] = useState<Folder[]>([]);
  const [children, setChildren] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);

  const [fileName, setFileName] = useState(suggestedName);

  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [currentInfo, setCurrentInfo] = useState<Folder | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Which folder in the list is selected as the destination (single click)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Manual double-click detector (more reliable than native dblclick if UI re-renders)
  const lastClickRef = useRef<{ id: string; t: number } | null>(null);
  const DOUBLE_CLICK_MS = 320;

  useEffect(() => {
    if (!open) return;
    setFileName(suggestedName);
    setCurrent(null);
    setStack([]);
    setSelectedFolderId(null);
    lastClickRef.current = null;
  }, [open, suggestedName]);

  // Close on Escape (expected modal behavior)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const load = useCallback(async (parentId: string | null) => {
    setLoading(true);
    try {
      const res = await listFolders(parentId ?? undefined);
      setChildren(res);
      setSelectedFolderId(null);
      lastClickRef.current = null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Load current folder info (name, etc.) for header/labels
  useEffect(() => {
    let active = true;

    // Modal closed → clear state and stop
    if (!open) {
      setCurrentInfo(null);
      setInfoLoading(false);
      return () => {
        active = false;
      };
    }

    // Root (no current folder) → clear and stop
    if (!current) {
      setCurrentInfo(null);
      setInfoLoading(false);
      return () => {
        active = false;
      };
    }

    setInfoLoading(true);

    (async () => {
      try {
        const info = await getFolder(current);
        if (active) setCurrentInfo(info);
      } catch (e) {
        if (active) setCurrentInfo(null);
        // eslint-disable-next-line no-console
        console.error('Failed to load folder info', e);
      } finally {
        if (active) setInfoLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [current, open]);

  useEffect(() => {
    if (open) load(current);
  }, [open, current, load]);

  const goInto = (f: Folder) => {
    setStack((s) => [...s, f]);
    setCurrent(f.id);
  };

  const handleChildClick = (f: Folder) => {
    const now = Date.now();
    const last = lastClickRef.current;

    // If the same folder is clicked twice quickly → enter it
    if (last && last.id === f.id && now - last.t < DOUBLE_CLICK_MS) {
      lastClickRef.current = null;
      setSelectedFolderId(null);
      goInto(f);
      return;
    }

    // Otherwise just select it as the destination
    lastClickRef.current = { id: f.id, t: now };
    setSelectedFolderId(f.id);
  };

  const goUp = () => {
    if (stack.length === 0) {
      setCurrent(null);
      return;
    }
    const next = [...stack];
    next.pop();
    setStack(next);
    setCurrent(next.length ? next[next.length - 1].id : null);
  };

  const breadcrumb = useMemo(() => [{ id: '', name: 'Home' }, ...stack], [stack]);

  const selectedFolder = useMemo(
    () => children.find((f) => f.id === selectedFolderId) ?? null,
    [children, selectedFolderId]
  );

  const destinationName = selectedFolder?.name ?? currentInfo?.name ?? 'Home';

  const handleCreate = async () => {
    const name = newFolderName.trim();
    if (!name) return;

    setCreating(true);
    try {
      const f = await createFolder(name, current ?? undefined);
      // Enter the new folder
      setStack((s) => [...s, f]);
      setCurrent(f.id);
      setNewFolderName('');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[2px]"
        onClick={onCancel}
      />

      {/* Panel */}
      <div className="relative w-full max-w-3xl">
        <div className="bg-landing-gradient rounded-3xl p-[1px] shadow-2xl">
          <div className="md3-surface overflow-hidden rounded-3xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="md3-chip">{mode === 'pdf' ? 'PDF' : 'TEXT'}</span>

                  <span className="text-sm text-muted truncate flex items-center gap-2">
                    <span className="truncate">
                      Saving to:{' '}
                      <span className="font-medium text-foreground">{destinationName}</span>
                    </span>

                    {infoLoading && (
                      <span className="md3-chip inline-flex items-center gap-1">
                        <svg
                          className="h-3.5 w-3.5 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            className="opacity-75"
                            d="M4 12a8 8 0 0 1 8-8"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                        Loading
                      </span>
                    )}
                  </span>
                </div>

                <h3 className="mt-2 text-xl font-semibold leading-snug">Choose a destination</h3>
                <p className="mt-1 text-sm text-muted">
                  Click a folder to select it. Double-click to open it.
                </p>
              </div>

              <PlusButton type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Close">
                <CloseIcon className="h-4 w-4" />
              </PlusButton>
            </div>

            <div className="md3-divider" />

            {/* Content */}
            <div className="px-6 py-5 space-y-4">
              {/* Breadcrumb */}
              <div className="flex flex-wrap items-center gap-2">
                {breadcrumb.map((b, i) => (
                  <React.Fragment key={b.id || `root-${i}`}>
                    <PlusButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full px-3"
                      onClick={() => {
                        const next = stack.slice(0, i);
                        setStack(next);
                        setCurrent(next.length ? next[next.length - 1].id : null);
                        setSelectedFolderId(null);
                        lastClickRef.current = null;
                      }}
                    >
                      {b.name}
                    </PlusButton>

                    {i < breadcrumb.length - 1 && <span className="text-neutral-400 select-none">›</span>}
                  </React.Fragment>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* Folder list */}
                <div className="md:col-span-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Folders</div>
                      <div className="text-xs text-muted">Tip: double-click to open (reliable)</div>
                    </div>

                    <PlusButton
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={stack.length === 0}
                      onClick={() => {
                        setSelectedFolderId(null);
                        lastClickRef.current = null;
                        goUp();
                      }}
                    >
                      Up
                    </PlusButton>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 overflow-hidden">
                    <div className="max-h-[46vh] overflow-auto p-2">
                      {loading ? (
                        <div className="text-sm text-muted p-3">Loading…</div>
                      ) : children.length === 0 ? (
                        <div className="text-sm text-muted p-3">No folders here.</div>
                      ) : (
                        <ul className="space-y-1">
                          {children.map((f) => {
                            const active = selectedFolderId === f.id;

                            return (
                              <li key={f.id}>
                                <div
                                  className={[
                                    "flex items-center justify-between gap-3 rounded-2xl px-3 py-2 transition cursor-pointer",
                                    active
                                      ? "bg-[color-mix(in_oklab,var(--color-accent),transparent_90%)] ring-1 ring-[color-mix(in_oklab,var(--color-accent),transparent_70%)]"
                                      : "hover:bg-[color-mix(in_oklab,var(--color-foreground),transparent_96%)]",
                                  ].join(" ")}
                                  onClick={() => handleChildClick(f)}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <svg
                                      className="h-4 w-4 text-neutral-500 shrink-0"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                                    </svg>

                                    <div className="min-w-0">
                                      <div className="truncate font-medium">{f.name}</div>
                                      <div className="text-xs text-muted truncate">
                                        {active ? "Selected as destination" : "Click to select"}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {active && <span className="md3-chip">Selected</span>}
                                    <PlusButton
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedFolderId(null);
                                        lastClickRef.current = null;
                                        goInto(f);
                                      }}
                                    >
                                      Open
                                    </PlusButton>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right column: create + filename */}
                <div className="md:col-span-2 space-y-4">
                  <div className="rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 p-4">
                    <div className="text-sm font-semibold">Create folder</div>
                    <p className="text-xs text-muted mt-1">
                      Create inside{' '}
                      <span className="font-medium text-foreground">{currentInfo?.name || 'Home'}</span>.
                    </p>

                    <div className="mt-3 flex gap-2">
                      <div className="bg-landing-gradient rounded-2xl p-[1px] flex-1">
                        <input
                          className="md3-input w-full rounded-2xl"
                          placeholder="New folder name"
                          value={newFolderName}
                          onChange={(e) => setNewFolderName(e.target.value)}
                        />
                      </div>

                      <PlusButton
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={creating}
                        disabled={creating || !newFolderName.trim()}
                        onClick={handleCreate}
                      >
                        Create
                      </PlusButton>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-white/60 dark:bg-neutral-900/40 p-4">
                    <div className="text-sm font-semibold">File name</div>
                    <p className="text-xs text-muted mt-1">
                      {mode === 'pdf' ? 'Saved as a PDF file.' : 'Saved as a text file.'}
                    </p>

                    <div className="mt-3 bg-landing-gradient rounded-2xl p-[1px]">
                      <input
                        className="md3-input w-full rounded-2xl"
                        value={fileName}
                        onChange={(e) => setFileName(e.target.value)}
                        placeholder={mode === 'pdf' ? 'page.pdf' : 'page.txt'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="md3-divider" />

            {/* Footer actions */}
            <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-muted flex items-center gap-2">
                <span className="truncate">
                  Destination:{' '}
                  <span className="font-medium text-foreground">{destinationName}</span>
                </span>

                {infoLoading && (
                  <span className="md3-chip inline-flex items-center gap-1">
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                      />
                      <path
                        className="opacity-75"
                        d="M4 12a8 8 0 0 1 8-8"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                    Loading
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 justify-end">
                <PlusButton type="button" variant="ghost" onClick={onCancel}>
                  Cancel
                </PlusButton>

                <PlusButton
                  type="button"
                  variant="solid"
                  onClick={() => onConfirm({ folderId: (selectedFolderId ?? current), fileName, mode })}
                  disabled={!fileName.trim() || infoLoading || loading}
                >
                  Save
                </PlusButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FolderPickerModal;
