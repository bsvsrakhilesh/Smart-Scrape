import { navigateWithinApp } from "./navigation";

const ACTIVE_NOTEBOOK_KEY = "nb:lastId";
const PENDING_OPEN_NOTE_KEY = "nb:pendingOpenNote";

export type PendingNotebookOpenTarget = {
  notebookId: string;
  noteId?: string | null;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function queueNotebookOpenTarget(target: PendingNotebookOpenTarget) {
  if (!canUseStorage()) return;

  localStorage.setItem(ACTIVE_NOTEBOOK_KEY, target.notebookId);
  localStorage.setItem(PENDING_OPEN_NOTE_KEY, JSON.stringify(target));
}

export function consumeNotebookOpenTarget(): PendingNotebookOpenTarget | null {
  if (!canUseStorage()) return null;

  const raw = localStorage.getItem(PENDING_OPEN_NOTE_KEY);
  if (!raw) return null;

  localStorage.removeItem(PENDING_OPEN_NOTE_KEY);

  try {
    const parsed = JSON.parse(raw) as PendingNotebookOpenTarget;
    if (!parsed?.notebookId) return null;
    return parsed;
  } catch {
    return null;
  }
}

const PENDING_ADD_SOURCE_KEY = "nb:pendingAddSource";

export type PendingNotebookSource = {
  kind: "FILE";
  id: string;
  ts?: number;
};

export function queueNotebookAddSource(
  source: Omit<PendingNotebookSource, "ts">,
) {
  if (!canUseStorage()) return;

  localStorage.setItem(
    PENDING_ADD_SOURCE_KEY,
    JSON.stringify({
      ...source,
      ts: Date.now(),
    }),
  );
}

export function openNotebookWithPendingSource(
  source: Omit<PendingNotebookSource, "ts">,
) {
  queueNotebookAddSource(source);
  navigateWithinApp("/notebook");
}

export function openNotebookWithTarget(target: PendingNotebookOpenTarget) {
  queueNotebookOpenTarget(target);
  navigateWithinApp("/notebook");
}
