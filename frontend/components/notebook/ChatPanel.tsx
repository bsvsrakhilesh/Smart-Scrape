import { useCallback, useEffect, useRef, useState } from "react";
import { notebookClient as api } from "../../lib/notebookClient";
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
  html: string;
  citations?: import("../../lib/notebookClient").Citation[];
  suggested?: string[];
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

export default function ChatPanel({
  notebookId,
  sourceIds,
  totalSources,
}: {
  notebookId: string | null;
  sourceIds?: string[];
  totalSources?: number;
}) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [showJump, setShowJump] = useState(false);

  const [readerOpen, setReaderOpen] = useState(false);
  const [readerCitation, setReaderCitation] = useState<
    import("../../lib/notebookClient").Citation | null
  >(null);

  const includedCount = sourceIds?.length ?? 0;
  const totalCount = totalSources ?? includedCount;

  // Persist chat history per notebook (so refresh doesn't wipe the conversation)
  const historyKey = notebookId ? `nb:chatHistory:${notebookId}` : null;

  // Load saved history when notebook changes
  useEffect(() => {
    if (!historyKey) {
      setMessages([]);
      return;
    }
    try {
      const raw = localStorage.getItem(historyKey);
      if (!raw) {
        setMessages([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setMessages(parsed as Msg[]);
      else setMessages([]);
    } catch {
      setMessages([]);
    }
  }, [historyKey]);

  // Ensure we flush the latest messages before refresh/navigation.
  useEffect(() => {
    if (!historyKey) return;

    const saveNow = () => {
      try {
        localStorage.setItem(historyKey, JSON.stringify(messages.slice(-200)));
      } catch {
        // ignore
      }
    };

    window.addEventListener("beforeunload", saveNow);
    window.addEventListener("pagehide", saveNow);
    return () => {
      window.removeEventListener("beforeunload", saveNow);
      window.removeEventListener("pagehide", saveNow);
    };
  }, [historyKey, messages]);

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

  const addToNotes = (html: string) => {
    const md = html.replace(/<br\/?>/g, "\n");
    window.dispatchEvent(new CustomEvent("nb:add-note", { detail: md }));
  };

  const send = useCallback(
    async (
      q: string,
      saveToNotes?: { title: string; mode: "append" | "replace" },
    ) => {
      if (!notebookId) return;

      const userMsg: Msg = { id: uid(), ts: Date.now(), role: "user", html: q };
      setMessages((m) => [...m, userMsg]);
      setPending(true);

      try {
        const res = await api.chat(notebookId, q, { sourceIds });
        const full = renderMarkdown(res.answer);

        const assistantId = uid();
        const base: Msg = {
          id: assistantId,
          ts: Date.now(),
          role: "assistant",
          html: "",
          citations: res.citations,
          suggested: res.suggested,
        };

        setMessages((m) => [...m, base]);

        // typewriter streaming (kept, but made safer: no object mutation)
        let i = 0;
        const step = 14;

        while (i < full.length) {
          // Studio: push final answer into Notes as a titled artifact (markdown).
          if (saveToNotes?.title) {
            window.dispatchEvent(
              new CustomEvent("nb:add-note", {
                detail: {
                  title: saveToNotes.title,
                  content: res.answer,
                  mode: saveToNotes.mode,
                },
              }),
            );
          }

          await new Promise((r) => setTimeout(r, 12));
          i += step;
          const slice = full.slice(0, i);

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.id !== assistantId) return prev;
            return [...prev.slice(0, -1), { ...last, html: slice }];
          });
        }
      } finally {
        setPending(false);
      }
    },
    [notebookId],
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
    const q = messages[prevUserIndex].html;
    if (q) send(q);
  };

  const jumpToBottom = () =>
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white/10">
      <div className="px-4 md:px-6 py-3 border-b border-emerald-200/70 bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/40">
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700">
            Using {includedCount}/{totalCount} sources
          </span>

          {totalCount > 0 && includedCount === 0 ? (
            <span className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1">
              No sources selected — answers may be weak.
            </span>
          ) : null}

          <div className="flex-1" />

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

          {/* Empty state */}
          {messages.length === 0 && (
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

                    {/* Citations */}
                    {m.role === "assistant" && m.citations?.length ? (
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
                        content={m.html}
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
