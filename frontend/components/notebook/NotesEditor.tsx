import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notebookClient as api,
  type NoteProvenanceBundle,
} from "../../lib/notebookClient";

function isNoteProvenanceBundle(value: unknown): value is NoteProvenanceBundle {
  return (
    !!value &&
    typeof value === "object" &&
    (value as any).version === "note-provenance-v1" &&
    Array.isArray((value as any).artifacts)
  );
}

function mergeNoteProvenance(
  current: NoteProvenanceBundle | null,
  incoming: unknown,
): NoteProvenanceBundle | null {
  if (!incoming) return current ?? null;
  if (!current) {
    return isNoteProvenanceBundle(incoming) ? incoming : null;
  }

  const curr = isNoteProvenanceBundle(current) ? current : null;
  const next = isNoteProvenanceBundle(incoming) ? incoming : null;

  if (!curr || !next) return curr ?? next ?? null;

  const seen = new Set<string>();
  const artifacts = [...curr.artifacts, ...next.artifacts].filter(
    (artifact) => {
      const key = `${artifact.runId ?? "no-run"}::${artifact.createdAt}::${artifact.answer.slice(0, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  );

  return {
    version: "note-provenance-v1",
    artifacts,
  };
}

export default function NotesEditor({
  notebookId,
}: {
  notebookId: string | null;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  // UX state (NotebookLM-style): draft vs saved note
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastDraftAt, setLastDraftAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement | null>(null);

  // When set, we are editing an existing saved note
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [citationsPayload, setCitationsPayload] =
    useState<NoteProvenanceBundle | null>(null);

  const startNewNote = () => {
    setActiveNoteId(null);
    setTitle("");
    setContent("");
    setDirty(false);
    setSaveError(null);
    setLastSavedAt(null);
    setLastDraftAt(null);
    setCitationsPayload(null);
  };

  // Switching notebooks should exit edit-mode cleanly
  useEffect(() => {
    setActiveNoteId(null);
    setDirty(false);
    setSaveError(null);
    setLastSavedAt(null);
    setLastDraftAt(null);
    setCitationsPayload(null);
  }, [notebookId]);

  const saveM = useMutation({
    mutationFn: async (vars: {
      mode: "create" | "update";
      noteId?: string;
    }) => {
      setSaveError(null);

      if (vars.mode === "update") {
        return api.updateNote(notebookId!, vars.noteId!, {
          title,
          content,
          citations: (citationsPayload as NoteProvenanceBundle | null) ?? null,
        });
      }
      return api.createNote(notebookId!, {
        title,
        content,
        citations: (citationsPayload as NoteProvenanceBundle | null) ?? null,
      });
    },
    onSuccess: (note, vars) => {
      qc.invalidateQueries({ queryKey: ["nb:detail", notebookId] });

      setLastSavedAt(new Date(note.updatedAt));
      setDirty(false);
      setSaveError(null);

      // clear local draft for this mode
      if (notebookId) {
        const base =
          vars.mode === "update"
            ? `nb:noteDraft:${notebookId}:note:${note.id}`
            : `nb:noteDraft:${notebookId}:new`;
        localStorage.removeItem(`${base}:title`);
        localStorage.removeItem(`${base}:content`);
      }

      // After a successful save, keep the note open for editing.
      setActiveNoteId(note.id);
      setTitle(note.title || "");
      setContent(note.content || "");
      setLastDraftAt(null);
      setCitationsPayload(note.citations ?? null);
    },
    onError: (err: any) => {
      setSaveError(err?.message || "Save failed.");
    },
  });

  // load drafts (separate drafts for "new note" vs "editing note")
  useEffect(() => {
    if (!notebookId) return;

    const base = activeNoteId
      ? `nb:noteDraft:${notebookId}:note:${activeNoteId}`
      : `nb:noteDraft:${notebookId}:new`;

    const t = localStorage.getItem(`${base}:title`) || "";
    const c = localStorage.getItem(`${base}:content`) || "";

    if (t) setTitle(t);
    if (c) setContent(c);
  }, [notebookId, activeNoteId]);

  // persist drafts (debounced)
  useEffect(() => {
    if (!notebookId) return;

    const base = activeNoteId
      ? `nb:noteDraft:${notebookId}:note:${activeNoteId}`
      : `nb:noteDraft:${notebookId}:new`;

    const id = setTimeout(() => {
      localStorage.setItem(`${base}:title`, title);
      localStorage.setItem(`${base}:content`, content);
      setLastDraftAt(new Date());
    }, 150);

    return () => clearTimeout(id);
  }, [notebookId, activeNoteId, title, content]);

  // listen for Add-to-Notes events from Chat
  useEffect(() => {
    function onAdd(e: any) {
      const d = e?.detail;

      // Backwards compatible: detail can be a plain markdown string.
      if (typeof d === "string") {
        const md = d;
        setContent((prev) => (prev ? prev + "\n\n" + md : md));
        setDirty(true);
        return;
      }

      const titleFromEvent = String(d?.title || "").trim();
      const md = String(d?.content || "");
      const mode = d?.mode === "replace" ? "replace" : "append";
      const incomingCitations = d?.citations ?? null;

      if (titleFromEvent) setTitle(titleFromEvent);

      setContent((prev) => {
        if (mode === "replace") return md;
        return prev ? prev + "\n\n" + md : md;
      });

      if (mode === "replace") {
        setCitationsPayload(incomingCitations);
      } else if (incomingCitations) {
        setCitationsPayload(
          (prev: NoteProvenanceBundle | null) =>
            mergeNoteProvenance(
              prev,
              incomingCitations,
            ) as NoteProvenanceBundle | null,
        );
      }

      setDirty(true);
    }

    window.addEventListener("nb:add-note", onAdd as any);
    return () => window.removeEventListener("nb:add-note", onAdd as any);
  }, []);

  // Open an existing note from the Recent notes list
  useEffect(() => {
    function onOpen(e: any) {
      const n = e.detail;
      if (!n || !n.id) return;

      setActiveNoteId(n.id);
      setTitle(n.title || "");
      setContent(n.content || "");
      setDirty(false);
      setSaveError(null);
      setLastSavedAt(new Date(n.updatedAt));
      setLastDraftAt(null);
      setCitationsPayload(n.citations ?? null);

      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    window.addEventListener("nb:open-note", onOpen as any);
    return () => window.removeEventListener("nb:open-note", onOpen as any);
  }, []);

  useEffect(() => {
    function onNew() {
      startNewNote();
    }
    window.addEventListener("nb:new-note", onNew as any);
    return () => window.removeEventListener("nb:new-note", onNew as any);
  }, [startNewNote]);

  // Cmd/Ctrl+S quick save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
      if (!isSave) return;

      e.preventDefault();

      if (!notebookId) return;
      if (!title.trim() && !content.trim()) return;
      if (activeNoteId && !dirty) return;

      saveM.mutate({
        mode: activeNoteId ? "update" : "create",
        noteId: activeNoteId || undefined,
      });
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notebookId, title, content, activeNoteId, dirty, saveM]);

  return (
    <div
      ref={editorRef}
      className="p-4 flex flex-col gap-2 border-emerald-100/70 bg-white/75 rounded-xl shadow-md backdrop-blur supports-[backdrop-filter]:bg-white/55"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Notes</div>

          {activeNoteId ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Editing
            </span>
          ) : (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              New
            </span>
          )}

          {activeNoteId && (
            <button
              type="button"
              onClick={startNewNote}
              className="ml-1 text-[11px] px-2 py-0.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
              title="Start a new note"
            >
              New note
            </button>
          )}
        </div>
        <div className="text-[11px] text-gray-500">
          {saveM.isPending
            ? "Saving…"
            : saveError
              ? `Save failed: ${saveError}`
              : lastSavedAt
                ? `Saved ${lastSavedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : dirty
                  ? lastDraftAt
                    ? `Draft saved ${lastDraftAt.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "Draft"
                  : "—"}
        </div>
      </div>

      <input
        name="note-title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          setDirty(true);
        }}
        placeholder="Note title"
        className="border rounded-xl px-3 py-2 text-sm shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
        disabled={!notebookId}
      />
      <textarea
        name="note-content"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
        placeholder="Write notes (markdown allowed)…"
        className="h-40 border rounded-xl p-3 text-sm shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
        disabled={!notebookId}
      />
      <div className="flex justify-end">
        <button
          onClick={() =>
            saveM.mutate({
              mode: activeNoteId ? "update" : "create",
              noteId: activeNoteId || undefined,
            })
          }
          disabled={
            !notebookId ||
            saveM.isPending ||
            (!title.trim() && !content.trim()) ||
            (activeNoteId ? !dirty : false)
          }
          className="px-6 py-2.5 rounded-full bg-slate-500 text-white text-sm disabled:opacity-60 shadow hover:bg-slate-600"
        >
          {saveM.isPending
            ? "Saving…"
            : activeNoteId
              ? "Update note"
              : "Save note"}
        </button>
      </div>
    </div>
  );
}
