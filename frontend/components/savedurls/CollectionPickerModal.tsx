import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Collection } from "../../lib/types";
import CloseIcon from "../icons/CloseIcon";
import { useDialogA11y } from "../common/useDialogA11y";

interface Props {
  isOpen: boolean;
  title?: string;
  description?: string;
  collections: Collection[];
  selectedCount?: number;
  onCancel: () => void;
  onConfirm?: (collectionId: string) => void;
  onAddToCollection?: (collectionId: string) => void | Promise<void>;
  onMoveToCollection?: (collectionId: string) => void | Promise<void>;
  onRequestCreate?: () => void;
  onCreateCollection?: (
    name: string,
  ) => void | Promise<void | { id: string; name?: string }>;
}

const CollectionPickerModal: React.FC<Props> = ({
  isOpen,
  title = "Choose collection",
  description,
  collections,
  selectedCount,
  onCancel,
  onConfirm,
  onAddToCollection,
  onMoveToCollection,
  onRequestCreate,
  onCreateCollection,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const createErrorId = useId();

  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const initialFocusRef = createOpen ? createInputRef : closeButtonRef;

  useDialogA11y({
    isOpen,
    onClose: () => {
      if (!createBusy) onCancel();
    },
    dialogRef,
    initialFocusRef,
  });

  useEffect(() => {
    if (!isOpen) return;

    setSelectedId((prev) => {
      if (prev && collections.some((c) => c.id === prev)) return prev;
      return collections[0]?.id ?? "";
    });
  }, [isOpen, collections]);

  useEffect(() => {
    if (!isOpen) {
      setCreateOpen(false);
      setCreateName("");
      setCreateError(null);
      setCreateBusy(false);
      return;
    }

    if (!createOpen) {
      setCreateName("");
      setCreateError(null);
    }
  }, [isOpen, createOpen]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedId),
    [collections, selectedId],
  );

  const hasDualActions = !!onAddToCollection || !!onMoveToCollection;
  const canInlineCreate = typeof onCreateCollection === "function";
  const canCreate = canInlineCreate || !!onRequestCreate;
  const descriptionText =
    (description || selectedCount !== undefined)
      ? `${description ?? ""}${description && selectedCount !== undefined ? " " : ""}${
          selectedCount !== undefined
            ? `Selected: ${selectedCount} URL${selectedCount === 1 ? "" : "s"}.`
            : ""
        }`
      : "";

  const submitCreate = async () => {
    if (!onCreateCollection) return;

    const name = createName.trim();
    if (!name) {
      setCreateError("Enter a collection name.");
      return;
    }

    const duplicate = collections.some(
      (collection) => collection.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      setCreateError(`A collection named "${name}" already exists.`);
      return;
    }

    setCreateBusy(true);
    setCreateError(null);

    try {
      const created = await onCreateCollection(name);
      if (created && typeof created === "object" && "id" in created) {
        setSelectedId(String(created.id));
      }
      setCreateName("");
      setCreateOpen(false);
    } catch (e: any) {
      setCreateError(e?.message ?? "Unable to create the collection right now.");
    } finally {
      setCreateBusy(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionText ? descriptionId : undefined}
        className="relative z-[51] w-full max-w-lg rounded-2xl border bg-white p-4 shadow-xl dark:bg-gray-900"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3
              id={titleId}
              className="font-semibold text-neutral-950 dark:text-neutral-100"
            >
              {title}
            </h3>
            {!!descriptionText && (
              <p
                id={descriptionId}
                className="mt-1 text-sm text-neutral-600 dark:text-neutral-300"
              >
                {descriptionText}
              </p>
            )}
          </div>

          <button
            ref={closeButtonRef}
            className="btn-ghost"
            onClick={onCancel}
            title="Close"
            type="button"
            disabled={createBusy}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-auto">
          {collections.map((c) => {
            const active = c.id === selectedId;

            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={[
                  "w-full rounded-xl border px-3 py-3 text-left transition",
                  active
                    ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                    : "border-black/10 hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-neutral-800",
                ].join(" ")}
              >
                <div className="font-medium">{c.name}</div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {active ? "Selected destination" : "Choose this collection"}
                </div>
              </button>
            );
          })}

          {collections.length === 0 && (
            <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No collections available yet.
            </div>
          )}
        </div>

        {canCreate && (
          <div className="mt-4 border-t pt-3">
            {canInlineCreate ? (
              createOpen ? (
                <form
                  className="space-y-3 rounded-xl border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-950/40"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitCreate();
                  }}
                >
                  <div>
                    <label
                      htmlFor="collection-create-name"
                      className="mb-1 block text-sm font-medium text-neutral-900 dark:text-neutral-100"
                    >
                      New collection name
                    </label>
                    <input
                      ref={createInputRef}
                      id="collection-create-name"
                      type="text"
                      value={createName}
                      onChange={(e) => {
                        setCreateName(e.target.value);
                        if (createError) setCreateError(null);
                      }}
                      placeholder="e.g. Indoor air papers"
                      aria-invalid={createError ? "true" : "false"}
                      aria-describedby={createError ? createErrorId : undefined}
                      className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                    />
                    {createError && (
                      <p
                        id={createErrorId}
                        role="alert"
                        className="mt-2 text-xs text-red-700 dark:text-red-300"
                      >
                        {createError}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (createBusy) return;
                        setCreateOpen(false);
                        setCreateName("");
                        setCreateError(null);
                      }}
                      disabled={createBusy}
                      className="rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={createBusy}
                      className="rounded-xl bg-brand-primary px-3 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
                    >
                      {createBusy ? "Creating..." : "Create collection"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="w-full rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  + Create new collection
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={onRequestCreate}
                className="w-full rounded-xl border px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                + Create new collection
              </button>
            )}
          </div>
        )}

        <div className="mt-4 border-t pt-4">
          {hasDualActions ? (
            <>
              <div className="mb-3 rounded-xl border border-black/10 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-white/10 dark:bg-neutral-950/40 dark:text-neutral-300">
                <strong>Add to collection</strong> keeps existing memberships.{" "}
                <strong>Move only here</strong> replaces existing memberships
                with the selected collection.
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={createBusy}
                  className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>

                {onAddToCollection && (
                  <button
                    type="button"
                    disabled={!selectedCollection || createBusy}
                    onClick={() => {
                      if (!selectedId) return;
                      void onAddToCollection(selectedId);
                    }}
                    className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                  >
                    Add to collection
                  </button>
                )}

                {onMoveToCollection && (
                  <button
                    type="button"
                    disabled={!selectedCollection || createBusy}
                    onClick={() => {
                      if (!selectedId) return;
                      void onMoveToCollection(selectedId);
                    }}
                    className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
                  >
                    Move only here
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={createBusy}
                className="rounded-xl border px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={!selectedCollection || createBusy}
                onClick={() => {
                  if (!selectedId || !onConfirm) return;
                  onConfirm(selectedId);
                }}
                className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CollectionPickerModal;
