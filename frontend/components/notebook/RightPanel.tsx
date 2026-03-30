import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notebookClient as api } from "../../lib/notebookClient";

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function uniqueById<T extends { id: string | number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sendChatPrompt(detail: any) {
  window.dispatchEvent(new CustomEvent("nb:chat-prompt", { detail }));
}

function prettyTime(ts?: string | number | Date) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString([], {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type Tab = "guide" | "studio" | "recent";

export default function RightPanel({
  notebookId,
  sourceStats,
}: {
  notebookId: string | null;
  sourceStats?: { included: number; total: number };
}) {
  const [tab, setTab] = useState<Tab>("guide");
  const q = useQuery({
    queryKey: ["nb:detail", notebookId],
    queryFn: () => api.getNotebook(notebookId!),
    enabled: !!notebookId,
  });

  const notes = useMemo(() => uniqueById(q.data?.notes || []), [q.data?.notes]);

  if (!notebookId)
    return <div className="p-3 text-sm text-gray-500">Select a notebook.</div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Tabs */}
      <div className="flex border-b bg-white/60 backdrop-blur">
        <TabButton active={tab === "guide"} onClick={() => setTab("guide")}>
          Guide
        </TabButton>
        <TabButton active={tab === "studio"} onClick={() => setTab("studio")}>
          Studio
        </TabButton>
        <TabButton active={tab === "recent"} onClick={() => setTab("recent")}>
          Recent
        </TabButton>
      </div>

      {/* ✅ This is the scrollable region */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {tab === "guide" ? (
          <NotebookGuide sourceStats={sourceStats} />
        ) : tab === "studio" ? (
          <NotebookStudio />
        ) : (
          <RecentNotes notebookId={notebookId} notes={notes} />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: any) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-4 py-2 text-sm font-semibold",
        active
          ? "border-b-2 border-emerald-600 text-emerald-800"
          : "text-slate-600 hover:text-slate-800"
      )}
    >
      {children}
    </button>
  );
}

function NotebookGuide({
  sourceStats,
}: {
  sourceStats?: { included: number; total: number };
}) {
  const statsText = useMemo(() => {
    if (!sourceStats) return null;
    return `Using ${sourceStats.included}/${sourceStats.total} sources`;
  }, [sourceStats]);

  const quick = [
    {
      label: "Summarize sources",
      sub: "8 bullets + citations",
      prompt:
        'Summarize the included sources in 8 concise bullets. For each bullet, add at least one citation. End with 3 "open questions" that need verification.',
    },
    {
      label: "Key takeaways",
      sub: "What matters most",
      prompt:
        "From the included sources, extract the 10 most important takeaways. Each takeaway must cite the source chunk(s) used.",
    },
    {
      label: "Compare sources",
      sub: "agreements & conflicts",
      prompt:
        "Compare the included sources: list where they agree, where they conflict, and what evidence supports each side. Use citations for every claim.",
    },
    {
      label: "Find missing info",
      sub: "what to add next",
      prompt:
        "Based on the included sources, what key information is missing? Give a prioritized list of 8 missing items and suggest what sources I should add to fill the gaps.",
    },
  ];

  const suggested = [
    "What is the single best summary in 5 sentences, with citations?",
    "Pull definitions / glossary of key terms used across sources.",
    "Extract any numbers, metrics, dates, and claims in a table-like list with citations.",
    "Create a timeline of events mentioned, with dates and citations.",
    "What should I verify? List the top 7 claims that might be wrong or disputed, with citations.",
  ];

  return (
    <div className="p-3 space-y-4">
      <div className="rounded-2xl border border-emerald-200/70 bg-white/70 backdrop-blur p-4 shadow-sm">
        <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
          Notebook guide
        </div>
        <div className="mt-1 text-sm text-slate-700 leading-relaxed">
          Turn your sources into answers and notes. Click an action to send a
          well-structured prompt.
        </div>
        {statsText ? (
          <div className="mt-2 inline-flex items-center gap-2 text-[11px] px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700">
            {statsText}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2">
        {quick.map((x) => (
          <button
            key={x.label}
            onClick={() => sendChatPrompt({ prompt: x.prompt, autoSend: true })}
            className="group text-left rounded-2xl border border-slate-200 bg-white/80 hover:bg-white shadow-sm p-4 transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  {x.label}
                </div>
                <div className="mt-0.5 text-[12px] text-slate-500">{x.sub}</div>
              </div>
              <div className="shrink-0 text-[11px] font-semibold text-emerald-700 group-hover:text-emerald-800">
                Send →
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
        <div className="text-xs font-semibold text-slate-800">
          Suggested questions
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {suggested.map((s, idx) => (
            <button
              key={idx}
              onClick={() => sendChatPrompt({ prompt: s, autoSend: true })}
              className="text-[12px] px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 shadow-sm text-slate-700"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NotebookStudio() {
  const templates = [
    {
      title: "Briefing doc",
      desc: "1-page summary + recommendations",
      noteTitle: "Briefing Doc",
      prompt:
        "Create a one-page briefing doc from the included sources with these sections: (1) Executive summary (5 bullets), (2) Key evidence (bullets with citations), (3) Risks/unknowns (bullets), (4) Recommendations (5 bullets). Keep it crisp. Add citations for every evidence bullet.",
    },
    {
      title: "Study guide",
      desc: "Concepts + Q&A",
      noteTitle: "Study Guide",
      prompt:
        "Create a study guide from the included sources: (1) Key concepts with short explanations, (2) 10 flashcards (Q/A), (3) 5 exam-style questions with answers. Use citations for each concept and answer.",
    },
    {
      title: "FAQ",
      desc: "Questions people will ask",
      noteTitle: "FAQ",
      prompt:
        "Write an FAQ (12 questions) based only on the included sources. Each answer must be short, accurate, and include citations.",
    },
    {
      title: "Timeline",
      desc: "Dates + events",
      noteTitle: "Timeline",
      prompt:
        "Extract a chronological timeline from the included sources. For each entry: date (or approximate), event summary, and citations.",
    },
    {
      title: "Action items",
      desc: "Tasks + owners placeholders",
      noteTitle: "Action Items",
      prompt:
        "Extract actionable TODOs from the included sources. Output as a checklist. For each item: task, why it matters, and citations. If an owner is not known, put [OWNER].",
    },
  ];

  return (
    <div className="p-3 space-y-4">
      <div className="rounded-2xl border border-emerald-200/70 bg-white/70 backdrop-blur p-4 shadow-sm">
        <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
          Studio
        </div>
        <div className="mt-1 text-sm text-slate-700 leading-relaxed">
          Generate durable artifacts. Each output will be pushed into the Notes
          editor automatically.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {templates.map((t) => (
          <button
            key={t.title}
            onClick={() =>
              sendChatPrompt({
                prompt: t.prompt,
                autoSend: true,
                saveToNotes: true,
                noteTitle: t.noteTitle,
                noteMode: "replace",
              })
            }
            className="group text-left rounded-2xl border border-slate-200 bg-white/80 hover:bg-white shadow-sm p-4 transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  {t.title}
                </div>
                <div className="mt-0.5 text-[12px] text-slate-500">
                  {t.desc}
                </div>
              </div>
              <div className="shrink-0 text-[11px] font-semibold text-emerald-700 group-hover:text-emerald-800">
                Generate →
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
        <div className="text-xs font-semibold text-slate-800">Tip</div>
        <div className="mt-1 text-[12px] text-slate-600 leading-relaxed">
          After generation, hit <span className="font-semibold">Save now</span>{" "}
          in Notes (Ctrl/⌘+S) to persist the artifact.
        </div>
      </div>
    </div>
  );
}

function RecentNotes({ notebookId, notes }: { notebookId: string; notes: any[] }) {
  const qc = useQueryClient();

  const delM = useMutation({
    mutationFn: (noteId: string) => api.deleteNote(notebookId, noteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nb:detail", notebookId] });
      window.dispatchEvent(new CustomEvent("nb:new-note"));
    },
  });

  return (
    <div className="p-3 space-y-2">
      {notes.map((n) => (
        <div
          key={n.id}
          role="button"
          tabIndex={0}
          onClick={() => window.dispatchEvent(new CustomEvent("nb:open-note", { detail: n }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("nb:open-note", { detail: n }));
            }
          }}
          className="group border rounded-xl p-3 bg-white shadow-sm cursor-pointer hover:bg-slate-50 flex items-start justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{n.title || "Untitled"}</div>
            <div className="text-[11px] text-gray-500">{prettyTime(n.updatedAt)}</div>
          </div>

          <button
            type="button"
            className="text-[11px] text-red-600 hover:text-red-700 opacity-0 group-hover:opacity-100"
            disabled={delM.isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (!confirm("Delete this note? This cannot be undone.")) return;
              delM.mutate(n.id);
            }}
          >
            {delM.isPending ? "Deleting…" : "Delete"}
          </button>
        </div>
      ))}

      {!notes.length && <p className="text-xs text-gray-500">No notes yet.</p>}
    </div>
  );
}
