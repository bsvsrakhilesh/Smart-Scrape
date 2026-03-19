import { useCallback, useEffect, useRef, useState } from "react";
import { notebookClient as api } from "../../lib/notebookClient";
import type {
  AnswerMode,
  EvidenceBlock,
  Citation,
  NoteProvenanceBundle,
  ChatHistoryRun,
} from "../../lib/notebookClient";
import { Loader2 } from "lucide-react";
import CitationBadge from "./CitationBadge";
import MessageActions from "./MessageActions";
import SourceReaderDrawer from "./SourceReaderDrawer";

type ChatPromptDetail =
  | string
  | {
      prompt: string;
      /** default true */
      autoSend?: boolean;
      /** if true, the final assistant answer is pushed into Notes as a new artifact */
      saveToNotes?: boolean;
      noteTitle?: string;
      /** append (default) or replace the current note editor contents */
      noteMode?: "append" | "replace";
    };

type Msg = {
  id: string;
  ts: number;
  role: "user" | "assistant";
  text: string;
  html: string;
  suggested?: string[];
  mode?: AnswerMode;
  evidence?: EvidenceBlock[];
  citations?: Citation[];

  runId?: string;
  promptVersion?: string;
  model?: string | null;
  latencyMs?: number | null;
};

function uid() {
  // avoids crypto usage issues in some environments
  return `m_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function renderMarkdown(md: string) {
  const esc = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\_(.+?)\_/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}

function renderErrorHtml(message: string) {
  const safe = String(message ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<div class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
    <strong>Error:</strong> ${safe}
  </div>`;
}

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function fmtTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function historyRunsToMessages(runs: ChatHistoryRun[]): Msg[] {
  const out: Msg[] = [];

  for (const run of runs || []) {
    const ts = Number(new Date(run.createdAt).getTime()) || Date.now();

    out.push({
      id: `${run.id}:user`,
      ts,
      role: "user",
      text: run.userMessage,
      html: run.userMessage,
    });

    if (run.status === "FAILED") {
      const errText = `Error: ${String(run.error || "Chat failed. Please try again.")}`;
      out.push({
        id: `${run.id}:assistant`,
        ts: ts + 1,
        role: "assistant",
        text: errText,
        html: renderErrorHtml(
          String(run.error || "Chat failed. Please try again."),
        ),
        mode: run.answerMode,
        runId: run.id,
        promptVersion: run.promptVersion ?? undefined,
        model: run.model ?? null,
        latencyMs: run.latencyMs ?? null,
      });
      continue;
    }

    const answerText = String(run.answer ?? "");
    out.push({
      id: `${run.id}:assistant`,
      ts: ts + 1,
      role: "assistant",
      text: answerText,
      html: renderMarkdown(answerText),
      citations: run.citations ?? [],
      suggested: run.suggested ?? [],
      mode: run.answerMode,
      evidence: run.evidence ?? [],
      runId: run.id,
      promptVersion: run.promptVersion ?? undefined,
      model: run.model ?? null,
      latencyMs: run.latencyMs ?? null,
    });
  }

  return out;
}

export default function ChatPanel({
  notebookId,
  sourceIds,
  totalSources,
  scopeIncludedCount,
  notReadyIncludedCount,
}: {
  notebookId: string | null;
  sourceIds?: string[]; // ready ids only
  totalSources?: number; // total sources in notebook
  scopeIncludedCount?: number; // included by scope (ready + not ready)
  notReadyIncludedCount?: number; // included but not ready
}) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Keep latest messages in a ref so we can build chat history without re-creating callbacks
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [showJump, setShowJump] = useState(false);

  const [readerOpen, setReaderOpen] = useState(false);
  const [readerCitation, setReaderCitation] = useState<
    import("../../lib/notebookClient").Citation | null
  >(null);

  const readyCount = sourceIds?.length ?? 0;
  const scopeCount = scopeIncludedCount ?? readyCount;
  const totalCount = totalSources ?? scopeCount;
  const blockedCount = notReadyIncludedCount ?? 0;

  // Load chat history from the backend for this notebook.
  useEffect(() => {
    let alive = true;

    async function loadHistory() {
      if (!notebookId) {
        setMessages([]);
        setLoadingHistory(false);
        return;
      }

      try {
        setLoadingHistory(true);
        const runs = await api.getChatHistory(notebookId, 80);
        if (!alive) return;
        setMessages(historyRunsToMessages(runs));
      } catch {
        if (!alive) return;
        setMessages([]);
      } finally {
        if (alive) setLoadingHistory(false);
      }
    }

    loadHistory();

    return () => {
      alive = false;
    };
  }, [notebookId]);

  // ===== Answer mode (Draft / Evidence / Briefing) =====
  const modeKey = notebookId ? `nb:chatMode:${notebookId}` : null;
  const [answerMode, setAnswerMode] = useState<AnswerMode>("draft");

  // Load persisted mode when notebook changes
  useEffect(() => {
    if (!modeKey) {
      setAnswerMode("draft");
      return;
    }
    const saved = localStorage.getItem(modeKey) as AnswerMode | null;
    if (saved === "draft" || saved === "evidence" || saved === "briefing") {
      setAnswerMode(saved);
    } else {
      setAnswerMode("draft");
    }
  }, [modeKey]);

  // Persist mode
  useEffect(() => {
    if (!modeKey) return;
    try {
      localStorage.setItem(modeKey, answerMode);
    } catch {
      // ignore
    }
  }, [modeKey, answerMode]);

  // Persist composer draft per notebook
  const draftKey = notebookId ? `nb:chatDraft:${notebookId}` : null;
  useEffect(() => {
    if (!draftKey) return;
    const saved = localStorage.getItem(draftKey);
    if (saved) setInput(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    const t = setTimeout(() => localStorage.setItem(draftKey, input), 150);
    return () => clearTimeout(t);
  }, [draftKey, input]);

  // Auto-resize composer (feels premium immediately)
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(160, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [input]);

  // Autoscroll + show jump button when user scrolls up
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;

    const onScroll = () => {
      const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 240;
      setShowJump(!nearBottom);
    };

    sc.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => sc.removeEventListener("scroll", onScroll as any);
  }, []);

  useEffect(() => {
    // If user is near bottom, keep them there when new tokens stream in
    if (!showJump) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, showJump]);

  const openSource = (c: import("../../lib/notebookClient").Citation) => {
    setReaderCitation(c);
    setReaderOpen(true);
  };

  const addToNotes = (payload: {
    content: string;
    citations?: NoteProvenanceBundle | null;
  }) => {
    const clean = String(payload?.content ?? "").trim();
    if (!clean) return;

    window.dispatchEvent(
      new CustomEvent("nb:add-note", {
        detail: {
          content: clean,
          mode: "append",
          citations: payload?.citations ?? null,
        },
      }),
    );
  };

  const buildHistory = (maxMsgs = 12) => {
    const prior = messagesRef.current ?? [];
    const MAX_CHARS = 1400; // keep prompts bounded for latency + cost

    return prior
      .filter((m) => String(m?.text ?? "").trim())
      .filter((m) => !(m.role === "assistant" && /^Error:/i.test(m.text)))
      .slice(-maxMsgs)
      .map((m) => ({
        role: m.role,
        content:
          m.text.length > MAX_CHARS ? m.text.slice(0, MAX_CHARS) + "…" : m.text,
      }));
  };

  const send = useCallback(
    async (
      q: string,
      saveToNotes?: { title: string; mode: "append" | "replace" },
    ) => {
      if (!notebookId) return;

      const question = (q || "").trim();
      if (!question) return;

      const history = buildHistory(12);

      const userMsg: Msg = {
        id: uid(),
        ts: Date.now(),
        role: "user",
        text: question,
        html: question,
      };

      setMessages((m) => [...m, userMsg]);
      setPending(true);

      try {
        const res = await api.chat(notebookId, question, {
          sourceIds,
          history,
          answerMode,
        });
        const full = renderMarkdown(res.answer);

        const assistantId = uid();
        const base: Msg = {
          id: assistantId,
          ts: Date.now(),
          role: "assistant",
          text: res.answer,
          html: "",
          citations: res.citations,
          suggested: res.suggested,
          mode: res.mode,
          evidence: res.evidence,

          runId: res.runId,
          promptVersion: res.promptVersion,
          model: res.model ?? null,
          latencyMs: res.latencyMs ?? null,
        };

        setMessages((m) => [...m, base]);

        if (saveToNotes?.title) {
          window.dispatchEvent(
            new CustomEvent("nb:add-note", {
              detail: {
                title: saveToNotes.title,
                content: res.answer,
                mode: saveToNotes.mode,
                citations: {
                  version: "note-provenance-v1",
                  artifacts: [
                    {
                      kind: "chat-answer",
                      runId: res.runId ?? null,
                      promptVersion: res.promptVersion ?? null,
                      model: res.model ?? null,
                      answerMode: res.mode ?? null,
                      createdAt: new Date().toISOString(),
                      latencyMs: res.latencyMs ?? null,
                      answer: res.answer,
                      citations: res.citations ?? [],
                      evidence:
                        Array.isArray(res.evidence) && res.evidence.length
                          ? res.evidence
                          : undefined,
                    },
                  ],
                } as NoteProvenanceBundle,
              },
            }),
          );
        }

        let i = 0;
        const step = 14;

        while (i < full.length) {
          await new Promise((r) => setTimeout(r, 12));
          i += step;
          const slice = full.slice(0, i);

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.id !== assistantId) return prev;
            return [...prev.slice(0, -1), { ...last, html: slice }];
          });
        }
      } catch (e: any) {
        const errMessage = String(
          e?.message || "Chat failed. Please try again.",
        );
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            ts: Date.now(),
            role: "assistant",
            text: `Error: ${errMessage}`,
            html: renderErrorHtml(errMessage),
          },
        ]);
      } finally {
        setPending(false);
      }
    },

    [notebookId, sourceIds, answerMode],
  );

  // Notebook Guide / Studio can fire a "send this prompt" event.
  useEffect(() => {
    function onPrompt(e: any) {
      const d: ChatPromptDetail = e?.detail;
      const detailObj =
        typeof d === "string" ? { prompt: d } : d || { prompt: "" };
      const prompt = String((detailObj as any).prompt || "").trim();
      if (!prompt) return;

      const autoSend = (detailObj as any).autoSend !== false;
      const saveToNotes = !!(detailObj as any).saveToNotes;
      const noteTitle = String((detailObj as any).noteTitle || "").trim();
      const noteMode: "append" | "replace" =
        (detailObj as any).noteMode === "replace" ? "replace" : "append";

      // Pre-fill composer for transparency
      setInput(prompt);
      composerRef.current?.focus();

      if (autoSend && notebookId && !pending) {
        setInput("");
        const note =
          saveToNotes && noteTitle
            ? ({ title: noteTitle, mode: noteMode } as {
                title: string;
                mode: "append" | "replace";
              })
            : undefined;
        send(prompt, note);
      }
    }

    window.addEventListener("nb:chat-prompt", onPrompt as any);
    return () => window.removeEventListener("nb:chat-prompt", onPrompt as any);
  }, [notebookId, pending, send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!pending && notebookId && input.trim()) {
        const q = input.trim();
        setInput("");
        send(q);
      }
    }
  };

  const onRegenerate = (i: number) => {
    if (!notebookId || pending) return;
    const prevUserIndex = [...messages.slice(0, i)]
      .map((m, j) => ({ m, j }))
      .reverse()
      .find(({ m }) => m.role === "user")?.j;
    if (prevUserIndex == null) return;
    const q = messages[prevUserIndex].text;
    if (q) send(q);
  };

  const jumpToBottom = () =>
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white/10">
      <div className="px-4 md:px-6 py-3 border-b border-emerald-200/70 bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/40">
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700">
            Using {readyCount}/{Math.max(scopeCount, 0)} ready sources
          </span>

          {blockedCount > 0 ? (
            <span
              className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"
              title="These sources are included by scope but are still indexing or failed indexing, so they are excluded from chat for reliability."
            >
              {blockedCount} not ready
            </span>
          ) : null}

          {totalCount > 0 && scopeCount === 0 ? (
            <span className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1">
              No sources selected — include sources to get cited answers.
            </span>
          ) : null}

          {scopeCount > 0 && readyCount === 0 ? (
            <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              Sources are still indexing — chat will work once at least one is
              “Ready”.
            </span>
          ) : null}

          <div className="flex-1" />

          <div
            className="inline-flex items-center rounded-full border border-slate-200 bg-white overflow-hidden"
            role="group"
            aria-label="Answer mode"
            title="Controls the style of the answer. Evidence mode returns atomic claims with quotes. Briefing mode is policy/ops oriented."
          >
            <button
              type="button"
              onClick={() => setAnswerMode("draft")}
              className={clsx(
                "px-3 py-1 text-[11px] font-semibold",
                answerMode === "draft"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-50",
              )}
            >
              Draft
            </button>
            <button
              type="button"
              onClick={() => setAnswerMode("evidence")}
              className={clsx(
                "px-3 py-1 text-[11px] font-semibold border-l border-slate-200",
                answerMode === "evidence"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-50",
              )}
            >
              Evidence
            </button>
            <button
              type="button"
              onClick={() => setAnswerMode("briefing")}
              className={clsx(
                "px-3 py-1 text-[11px] font-semibold border-l border-slate-200",
                answerMode === "briefing"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-50",
              )}
            >
              Briefing
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("nb:manage-sources"))
            }
            className="text-[11px] px-3 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
            title="Manage which sources are included"
          >
            Manage
          </button>
        </div>
      </div>
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto overscroll-contain px-4 md:px-6 py-5 relative"
      >
        <div className="mx-auto w-full max-w-[760px]">
          {/* Jump to bottom */}
          {showJump && (
            <button
              onClick={jumpToBottom}
              className="fixed md:absolute right-6 bottom-28 md:bottom-24 z-20 px-3 py-2 rounded-full border border-slate-200 bg-white/90 backdrop-blur shadow-[0_16px_40px_rgba(15,23,42,0.18)] text-xs font-semibold text-slate-700 hover:bg-white"
              aria-label="Jump to latest"
              title="Jump to latest"
            >
              ↓ New messages
            </button>
          )}

          {loadingHistory && messages.length === 0 && (
            <div className="h-full w-full grid place-items-center">
              <div className="rounded-2xl border border-white/30 bg-white/70 backdrop-blur px-4 py-3 shadow-[0_16px_50px_rgba(15,23,42,0.12)] text-sm text-slate-600 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading notebook conversation…
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loadingHistory && messages.length === 0 && (
            <div className="h-full w-full grid place-items-center">
              <div className="max-w-xl w-full">
                <div className="rounded-3xl border border-white/30 bg-white/70 backdrop-blur shadow-[0_24px_80px_rgba(15,23,42,0.18)] p-6 md:p-7">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-b from-emerald-500 to-emerald-700 text-white grid place-items-center shadow-[0_18px_44px_rgba(16,185,129,0.35)]">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M12 2l2.5 5 5.5.8-4 3.9.9 5.6L12 15.9 7.1 17.3l.9-5.6-4-3.9 5.5-.8L12 2z"
                          stroke="currentColor"
                          strokeWidth="1.4"
                        />
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h2 className="text-[18px] md:text-[20px] font-semibold text-slate-900 tracking-tight">
                        Ask about your sources
                      </h2>
                      <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                        Get summaries, extract insights, and turn sources into
                        clean notes.
                      </p>

                      {!notebookId && (
                        <div className="mt-4 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                          Create/select a notebook first to start chatting.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages list */}
          <div className="space-y-4">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const isUser = m.role === "user";
              const isFirstInGroup = !prev || prev.role !== m.role;
              const isLastInGroup = !next || next.role !== m.role;

              const bubbleRound = clsx(
                "rounded-2xl",
                isFirstInGroup && isLastInGroup && "rounded-2xl",
                isFirstInGroup &&
                  !isLastInGroup &&
                  (isUser ? "rounded-br-lg" : "rounded-bl-lg"),
                !isFirstInGroup &&
                  isLastInGroup &&
                  (isUser ? "rounded-tr-lg" : "rounded-tl-lg"),
                !isFirstInGroup &&
                  !isLastInGroup &&
                  (isUser ? "rounded-r-lg" : "rounded-l-lg"),
              );

              return (
                <div
                  key={m.id}
                  className={clsx(
                    "flex gap-3",
                    isUser ? "justify-end" : "justify-start",
                  )}
                >
                  {/* Avatar column */}
                  {!isUser ? (
                    <div
                      className={clsx(
                        "w-9 shrink-0",
                        isFirstInGroup ? "opacity-100" : "opacity-0",
                      )}
                    >
                      <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white grid place-items-center shadow-[0_14px_34px_rgba(15,23,42,0.25)]">
                        <span className="text-[12px] font-bold tracking-tight">
                          AI
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={clsx(
                        "w-9 shrink-0",
                        isFirstInGroup ? "opacity-100" : "opacity-0",
                      )}
                    >
                      <div className="w-9 h-9 rounded-2xl bg-gradient-to-b from-slate-600 to-slate-900 text-white grid place-items-center shadow-[0_14px_34px_rgba(15,23,42,0.22)]">
                        <span className="text-[12px] font-bold tracking-tight">
                          You
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Bubble */}
                  <div
                    className={clsx(
                      isUser ? "max-w-[520px] w-full" : "max-w-[720px] w-full",
                      isUser ? "items-end" : "items-start",
                    )}
                  >
                    {isFirstInGroup && (
                      <div
                        className={clsx(
                          "mb-1 flex items-center gap-2",
                          isUser ? "justify-end" : "justify-start",
                        )}
                      >
                        <div className="text-[11px] font-semibold text-slate-700">
                          {isUser ? "You" : "Assistant"}
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {fmtTime(m.ts)}
                        </div>
                      </div>
                    )}

                    <div
                      className={clsx(
                        "border shadow-[0_18px_60px_rgba(15,23,42,0.08)] px-4 py-3 text-sm leading-[1.65]",
                        bubbleRound,
                        isUser
                          ? "bg-white border-slate-200 text-slate-900"
                          : "bg-white/80 backdrop-blur border-white/40 text-slate-900",
                      )}
                      {...(m.role === "assistant"
                        ? { dangerouslySetInnerHTML: { __html: m.html } }
                        : { children: m.html })}
                    />

                    {/* Evidence blocks (Evidence mode) */}
                    {m.role === "assistant" && m.evidence?.length ? (
                      <div className="mt-2 space-y-2">
                        <div className="text-[11px] font-semibold tracking-wide text-slate-600">
                          Evidence
                        </div>

                        {m.evidence.map((b, bIdx) => (
                          <div
                            key={`${m.id}_ev_${bIdx}`}
                            className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur px-4 py-3 shadow-sm"
                          >
                            <div className="text-sm text-slate-900 leading-[1.5]">
                              <span className="font-semibold mr-2">
                                {bIdx + 1}.
                              </span>
                              {b.claim}
                            </div>

                            {b.citations?.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {b.citations.map((c, idx) => (
                                  <CitationBadge
                                    key={`${c.chunkId}_${idx}`}
                                    index={idx + 1}
                                    citation={c}
                                    onOpenSource={openSource}
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* Citations */}
                    {m.role === "assistant" &&
                    !m.evidence?.length &&
                    m.citations?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.citations.map((c, idx) => (
                          <CitationBadge
                            key={c.chunkId}
                            index={idx + 1}
                            citation={c}
                            onOpenSource={openSource}
                          />
                        ))}
                      </div>
                    ) : null}

                    {/* Actions */}
                    {m.role === "assistant" ? (
                      <MessageActions
                        text={m.text}
                        citations={m.citations}
                        mode={m.mode}
                        evidence={m.evidence}
                        runId={m.runId}
                        promptVersion={m.promptVersion}
                        model={m.model}
                        latencyMs={m.latencyMs}
                        messageTs={m.ts}
                        onRegenerate={() => onRegenerate(i)}
                        onAddToNotes={addToNotes}
                      />
                    ) : null}

                    {/* Suggested follow-ups */}
                    {m.role === "assistant" && m.suggested?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.suggested.map((s, sIdx) => (
                          <button
                            key={`${m.id}_s_${sIdx}`}
                            onClick={() => setInput(s)}
                            className="text-[12px] px-3 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 shadow-sm text-slate-700"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator bubble */}
            {pending && (
              <div className="flex gap-3 justify-start">
                <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white grid place-items-center shadow-[0_14px_34px_rgba(15,23,42,0.25)]">
                  <span className="text-[12px] font-bold tracking-tight">
                    AI
                  </span>
                </div>

                <div className="max-w-[720px] w-full">
                  <div className="text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-2">
                    Assistant{" "}
                    <span className="text-slate-500 font-normal">thinking</span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/40 bg-white/80 backdrop-blur shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                    <span className="text-sm text-slate-600">Generating…</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200/70 bg-white/75 backdrop-blur supports-[backdrop-filter]:bg-white/60 px-3 md:px-4 py-3">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="rounded-3xl border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.10)] px-3 py-2">
                <textarea
                  ref={composerRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    notebookId
                      ? "Ask about your sources…"
                      : "Create/select a notebook to start"
                  }
                  disabled={!notebookId}
                  className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-slate-400 disabled:text-slate-400"
                  rows={1}
                />

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">
                    Enter to send · Shift+Enter for newline
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {input.trim().length
                        ? `${input.trim().length} chars`
                        : ""}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                if (!notebookId || pending) return;
                const q = input.trim();
                if (!q) return;
                setInput("");
                send(q);
              }}
              disabled={!notebookId || pending || !input.trim()}
              className={clsx(
                "w-11 h-11 grid place-items-center rounded-2xl text-white shadow-[0_18px_50px_rgba(15,23,42,0.25)] transition-all",
                !notebookId || pending || !input.trim()
                  ? "bg-slate-400 cursor-not-allowed opacity-70"
                  : "bg-slate-900 hover:bg-black active:scale-[0.98]",
              )}
              aria-label="Send"
              title="Send"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M2 21l19-9L2 3l3 7 9 2-9 2-3 7z" />
              </svg>
            </button>
          </div>
        </div>
        <SourceReaderDrawer
          open={readerOpen}
          citation={readerCitation}
          onClose={() => setReaderOpen(false)}
        />
      </div>
    </div>
  );
}
