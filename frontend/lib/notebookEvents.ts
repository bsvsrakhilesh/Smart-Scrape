import type { NBNote, NoteProvenanceBundle } from "./notebookClient";

export type NotebookToastDetail = {
  kind: "success" | "error" | "info" | "warning";
  text: string;
};

export type NotebookChatPromptDetail =
  | string
  | {
      prompt: string;
      autoSend?: boolean;
      saveToNotes?: boolean;
      noteTitle?: string;
      noteMode?: "append" | "replace";
    };

export type NotebookAddNoteDetail =
  | string
  | {
      title?: string;
      content: string;
      mode?: "append" | "replace";
      citations?: NoteProvenanceBundle | null;
    };

type NotebookEventMap = {
  toast: NotebookToastDetail;
  "open-note": NBNote;
  "new-note": undefined;
  "note-active": { noteId: string | null };
  "note-save-state": { saving: boolean; noteId: string | null };
  "note-deleted": { noteId: string };
  "add-note": NotebookAddNoteDetail;
  "chat-prompt": NotebookChatPromptDetail;
  "manage-sources": undefined;
  "focus-source": string;
};

type NotebookEventName = keyof NotebookEventMap;

const bus = new EventTarget();

function eventType(name: NotebookEventName) {
  return `nb:${name}`;
}

export function emitNotebookEvent<K extends NotebookEventName>(
  name: K,
  detail: NotebookEventMap[K],
) {
  bus.dispatchEvent(
    new CustomEvent<NotebookEventMap[K]>(eventType(name), { detail }),
  );
}

export function subscribeNotebookEvent<K extends NotebookEventName>(
  name: K,
  handler: (detail: NotebookEventMap[K]) => void,
) {
  const listener: EventListener = (event) => {
    handler((event as CustomEvent<NotebookEventMap[K]>).detail);
  };

  bus.addEventListener(eventType(name), listener);
  return () => bus.removeEventListener(eventType(name), listener);
}
