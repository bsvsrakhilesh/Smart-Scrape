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

export function openNotebookWithTarget(target: PendingNotebookOpenTarget) {
  queueNotebookOpenTarget(target);

  if (typeof window !== "undefined") {
    window.location.href = "/notebook";
  }
}
