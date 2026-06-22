import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, Save, ShieldCheck } from "lucide-react";
import {
  notebookClient as api,
  type NoteProvenanceBundle,
} from "../../lib/notebookClient";
import { emitNotebookEvent, subscribeNotebookEvent } from "../../lib/notebookEvents";
import { useConfirm } from "../providers/Confirm";

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

function draftStorageBase(notebookId: string, noteId?: string | null) {
  return noteId
    ? `nb:noteDraft:${notebookId}:note:${noteId}`
    : `nb:noteDraft:${notebookId}:new`;
}

function readDraftBundle(base: string) {
  const title = localStorage.getItem(`${base}:title`) || "";
  const content = localStorage.getItem(`${base}:content`) || "";
  const savedAtRaw = localStorage.getItem(`${base}:savedAt`);
  const citationsRaw = localStorage.getItem(`${base}:citations`);

  let citations: NoteProvenanceBundle | null = null;
  if (citationsRaw) {
    try {
      const parsed = JSON.parse(citationsRaw);
      citations = isNoteProvenanceBundle(parsed) ? parsed : null;
    } catch {
      citations = null;
    }
  }

  const savedAt =
    savedAtRaw && !Number.isNaN(new Date(savedAtRaw).getTime())
      ? new Date(savedAtRaw)
      : null;

  return { title, content, citations, savedAt };
}

function clearDraftBundle(base: string) {
  localStorage.removeItem(`${base}:title`);
  localStorage.removeItem(`${base}:content`);
  localStorage.removeItem(`${base}:citations`);
  localStorage.removeItem(`${base}:savedAt`);
}

function clearDraftBundlesForSavedNote(args: {
  notebookId: string;
  previousNoteId?: string | null;
  savedNoteId: string;
  mode: "create" | "update";
}) {
  const { notebookId, previousNoteId, savedNoteId, mode } = args;

  if (mode === "create") {
    clearDraftBundle(draftStorageBase(notebookId, null));
    clearDraftBundle(draftStorageBase(notebookId, savedNoteId));
    return;
  }

  clearDraftBundle(draftStorageBase(notebookId, previousNoteId ?? savedNoteId));
  if (previousNoteId && previousNoteId !== savedNoteId) {
    clearDraftBundle(draftStorageBase(notebookId, savedNoteId));
  }
}

function renderInlineMarkdown(text: string) {
  return String(text ?? "")
    .split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }
      return <span key={index}>{part}</span>;
    });
}

function MarkdownPreview({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-2 list-disc pl-5 space-y-1">
        {items.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
  };

  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const trimmed = line.trim();
      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        listItems.push(bullet[1]);
        return;
      }

      flushList();
      if (!trimmed) {
        blocks.push(<div key={`br-${index}`} className="h-2" />);
        return;
      }

      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        blocks.push(
          <div
            key={`h-${index}`}
            className="mt-3 first:mt-0 text-sm font-semibold text-slate-950"
          >
            {renderInlineMarkdown(heading[2])}
          </div>,
        );
        return;
      }

      blocks.push(
        <p key={`p-${index}`} className="my-1 first:mt-0 last:mb-0">
          {renderInlineMarkdown(trimmed)}
        </p>,
      );
    });

  flushList();

  return <>{blocks.length ? blocks : <span className="text-slate-400">Nothing to preview yet.</span>}</>;
}

export default function NotesEditor({
  notebookId,
}: {
  notebookId: string | null;
}) {
  const qc = useQueryClient();
  const { confirm } = useConfirm();
  const lastSaveToastRef = useRef<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<"write" | "preview">("write");

  // UX state (NotebookLM-style): draft vs saved note
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastDraftAt, setLastDraftAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement | null>(null);

  // When set, we are editing an existing saved note
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [citationsPayload, setCitationsPayload] =
    useState<NoteProvenanceBundle | null>(null);

  const resetNote = useCallback(() => {
    setActiveNoteId(null);
    setTitle("");
    setContent("");
    setDirty(false);
    setSaveError(null);
    setLastSavedAt(null);
    setLastDraftAt(null);
    setCitationsPayload(null);
    setView("write");
  }, []);

  const flushDraftNow = useCallback(
    (targetNoteId?: string | null) => {
      if (!notebookId) return;
      const base = draftStorageBase(notebookId, targetNoteId ?? activeNoteId);
      localStorage.setItem(`${base}:title`, title);
      localStorage.setItem(`${base}:content`, content);
      if (citationsPayload) {
        localStorage.setItem(`${base}:citations`, JSON.stringify(citationsPayload));
      } else {
        localStorage.removeItem(`${base}:citations`);
      }
      const now = new Date();
      localStorage.setItem(`${base}:savedAt`, now.toISOString());
      setLastDraftAt(now);
    },
    [activeNoteId, citationsPayload, content, notebookId, title],
  );

  const confirmDiscardIfDirty = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: "Unsaved note changes",
      description:
        "You have unsaved note edits. Continue and keep them only as a local draft?",
      confirmText: "Continue",
      cancelText: "Stay here",
    });
  }, [confirm, dirty]);

  const startNewNote = useCallback(async () => {
    if (!(await confirmDiscardIfDirty())) return;
    if (dirty || title.trim() || content.trim() || citationsPayload?.artifacts?.length) {
      flushDraftNow();
    }
    resetNote();
  }, [
    citationsPayload?.artifacts?.length,
    confirmDiscardIfDirty,
    content,
    dirty,
    flushDraftNow,
    resetNote,
    title,
  ]);

  // Switching notebooks should exit edit-mode cleanly
  useEffect(() => {
    setActiveNoteId(null);
    setTitle("");
    setContent("");
    setDirty(false);
    setSaveError(null);
    setLastSavedAt(null);
    setLastDraftAt(null);
    setCitationsPayload(null);
    setView("write");
  }, [notebookId]);

  useEffect(() => {
    emitNotebookEvent("note-active", { noteId: activeNoteId });
  }, [activeNoteId]);

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

      if (notebookId) {
        clearDraftBundlesForSavedNote({
          notebookId,
          previousNoteId: vars.noteId ?? activeNoteId,
          savedNoteId: note.id,
          mode: vars.mode,
        });
      }

      const savedVersionKey = `${note.id}:${note.updatedAt}`;
      if (lastSaveToastRef.current !== savedVersionKey) {
        emitNotebookEvent("toast", {
          kind: "success",
          text:
            vars.mode === "create"
              ? "Note saved."
              : "Note changes saved.",
        });
        lastSaveToastRef.current = savedVersionKey;
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
    if (activeNoteId) return;

    const draft = readDraftBundle(draftStorageBase(notebookId, null));
    setTitle(draft.title);
    setContent(draft.content);
    setCitationsPayload(draft.citations);
    setLastDraftAt(draft.savedAt);
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
      if (citationsPayload) {
        localStorage.setItem(`${base}:citations`, JSON.stringify(citationsPayload));
      } else {
        localStorage.removeItem(`${base}:citations`);
      }
      const now = new Date();
      localStorage.setItem(`${base}:savedAt`, now.toISOString());
      setLastDraftAt(now);
    }, 150);

    return () => clearTimeout(id);
  }, [notebookId, activeNoteId, title, content, citationsPayload]);

  // listen for Add-to-Notes events from Chat
  useEffect(() => {
    return subscribeNotebookEvent("add-note", (d) => {
      if (typeof d === "string") {
        const md = d;
        setContent((prev) => (prev ? prev + "\n\n" + md : md));
        setDirty(true);
        emitNotebookEvent("toast", {
          kind: "info",
          text: "Added to note draft. Save the note to persist it.",
        });
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
      emitNotebookEvent("toast", {
        kind: "info",
        text: "Added to note draft. Save the note to persist it.",
      });
    });
  }, []);

  // Open an existing note from the Recent notes list
  useEffect(() => {
    return subscribeNotebookEvent("open-note", (n) => {
      void (async () => {
        if (!n || !n.id) return;
        if (!(await confirmDiscardIfDirty())) return;
        if (dirty || title.trim() || content.trim() || citationsPayload?.artifacts?.length) {
          flushDraftNow();
        }

        const draft = notebookId
          ? readDraftBundle(draftStorageBase(notebookId, n.id))
          : { title: "", content: "", citations: null, savedAt: null };
        const hasRecoveredDraft =
          Boolean(draft.title || draft.content || draft.citations);

        setActiveNoteId(n.id);
        setTitle(hasRecoveredDraft ? draft.title : n.title || "");
        setContent(hasRecoveredDraft ? draft.content : n.content || "");
        setDirty(hasRecoveredDraft);
        setSaveError(null);
        setLastSavedAt(new Date(n.updatedAt));
        setLastDraftAt(hasRecoveredDraft ? draft.savedAt : null);
        setCitationsPayload(
          hasRecoveredDraft ? draft.citations : (n.citations ?? null),
        );
        setView("write");

        if (hasRecoveredDraft) {
          emitNotebookEvent("toast", {
            kind: "info",
            text: "Recovered your local draft for this note.",
          });
        }

        editorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      })();
    });
  }, [
    citationsPayload?.artifacts?.length,
    confirmDiscardIfDirty,
    content,
    dirty,
    flushDraftNow,
    notebookId,
    title,
  ]);

  useEffect(() => {
    return subscribeNotebookEvent("new-note", () => {
      startNewNote();
    });
  }, [startNewNote]);

  useEffect(() => {
    return subscribeNotebookEvent("note-deleted", ({ noteId }) => {
      if (!noteId || noteId !== activeNoteId) return;

      const hasLocalEdits =
        dirty ||
        Boolean(title.trim()) ||
        Boolean(content.trim()) ||
        Boolean(citationsPayload?.artifacts?.length);

      setActiveNoteId(null);
      setLastSavedAt(null);
      setSaveError(null);
      setView("write");

      if (hasLocalEdits) {
        setDirty(true);
        setLastDraftAt(new Date());
        emitNotebookEvent("toast", {
          kind: "info",
          text: "Deleted the saved note. Kept your current edits as a local draft.",
        });
      } else {
        setTitle("");
        setContent("");
        setDirty(false);
        setLastDraftAt(null);
        setCitationsPayload(null);
      }
    });
  }, [activeNoteId, citationsPayload, content, dirty, title]);

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

  const provenanceArtifacts = citationsPayload?.artifacts ?? [];

  return (
    <div
      ref={editorRef}
      className="p-4 flex flex-col gap-3 border border-slate-200/80 bg-white/85 rounded-xl shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-white/70"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-slate-950">Notes</div>

          {activeNoteId ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800">
              Editing
            </span>
          ) : (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
              New
            </span>
          )}

          {activeNoteId && (
            <button
              type="button"
              onClick={startNewNote}
              className="ml-1 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
              title="Start a new note"
            >
              <Plus className="h-3 w-3" />
              New note
            </button>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
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

      <div className="flex items-center justify-between gap-2">
        <div
          className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5"
          role="group"
          aria-label="Note view"
        >
          <button
            type="button"
            onClick={() => setView("write")}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              view === "write"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Pencil className="h-3 w-3" />
            Write
          </button>
          <button
            type="button"
            onClick={() => setView("preview")}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              view === "preview"
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>

        {provenanceArtifacts.length ? (
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800"
            title="This note includes saved provenance from chat or template generation."
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {provenanceArtifacts.length} evidence bundle
            {provenanceArtifacts.length === 1 ? "" : "s"}
          </div>
        ) : null}
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
      {view === "write" ? (
        <textarea
          name="note-content"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          placeholder="Write notes (markdown allowed)..."
          className="h-44 border rounded-xl p-3 text-sm shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
          disabled={!notebookId}
        />
      ) : (
        <div className="min-h-44 border rounded-xl p-3 text-sm leading-6 bg-slate-50/70 text-slate-800">
          <MarkdownPreview text={content} />
        </div>
      )}

      {provenanceArtifacts.length ? (
        <div className="flex flex-wrap gap-1.5">
          {provenanceArtifacts.slice(0, 4).map((artifact, index) => (
            <span
              key={`${artifact.runId ?? "artifact"}_${artifact.createdAt}_${index}`}
              className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
              title={artifact.model || artifact.promptVersion || undefined}
            >
              {artifact.kind === "chat-answer" ? "Chat" : "Template"} ·{" "}
              {artifact.citations?.length ?? 0} citations
            </span>
          ))}
        </div>
      ) : null}
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
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-950 text-white text-sm font-semibold disabled:opacity-55 disabled:cursor-not-allowed shadow-[0_16px_40px_rgba(15,23,42,0.18)] hover:bg-black"
        >
          <Save className="h-4 w-4" />
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
