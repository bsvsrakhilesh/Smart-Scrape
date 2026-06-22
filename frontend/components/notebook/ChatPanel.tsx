import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { notebookClient as api } from "../../lib/notebookClient";
import type {
  AnswerMode,
  EvidenceBlock,
  Citation,
  NoteProvenanceBundle,
  ChatHistoryRun,
  GroundingReport,
  ClaimCitationLink,
} from "../../lib/notebookClient";
import { Loader2, RefreshCcw } from "lucide-react";
import {
  emitNotebookEvent,
  subscribeNotebookEvent,
} from "../../lib/notebookEvents";
import CitationBadge from "./CitationBadge";
import MessageActions from "./MessageActions";
import SourceReaderDrawer from "./SourceReaderDrawer";

type Msg = {
  id: string;
  ts: number;
  role: "user" | "assistant";
  text: string;
  displayText?: string;
  suggested?: string[];
  mode?: AnswerMode;
  evidence?: EvidenceBlock[];
  citations?: Citation[];

  runId?: string;
  promptVersion?: string;
  model?: string | null;
  latencyMs?: number | null;
  grounding?: GroundingReport | null;
  claimLinks?: ClaimCitationLink[];
  scopeSnapshot?: SourceScopeSnapshot;
  scopedSourceIds?: string[];
};

type SourceScopeSnapshot = {
  totalCount: number;
  scopeCount: number;
  readyCount: number;
  blockedCount: number;
};

function sameSourceScope(
  left?: SourceScopeSnapshot | null,
  right?: SourceScopeSnapshot | null,
) {
  if (!left || !right) return false;
  return (
    left.totalCount === right.totalCount &&
    left.scopeCount === right.scopeCount &&
    left.readyCount === right.readyCount &&
    left.blockedCount === right.blockedCount
  );
}

function sameScopedSourceIds(left?: string[] | null, right?: string[] | null) {
  const a = Array.isArray(left) ? [...new Set(left.filter(Boolean))].sort() : [];
  const b = Array.isArray(right)
    ? [...new Set(right.filter(Boolean))].sort()
    : [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function messageScopeDrifted(args: {
  message: Msg;
  currentScope: SourceScopeSnapshot;
  currentSourceIds?: string[];
}) {
  const scopeMismatch =
    !!args.message.scopeSnapshot &&
    !sameSourceScope(args.message.scopeSnapshot, args.currentScope);
  const sourceIdMismatch =
    !!args.message.scopedSourceIds?.length &&
    !sameScopedSourceIds(args.message.scopedSourceIds, args.currentSourceIds ?? []);

  return scopeMismatch || sourceIdMismatch;
}

function uid() {
  // avoids crypto usage issues in some environments
  return `m_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function clsx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function renderInlineMarkdown(text: string) {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|_[^_]+_)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function MarkdownText({ text }: { text: string }) {
  const lines = String(text ?? "").split(/\r?\n/);
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

  lines.forEach((line, index) => {
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
      const size =
        heading[1].length === 1
          ? "text-base"
          : heading[1].length === 2
            ? "text-[15px]"
            : "text-sm";
      blocks.push(
        <div
          key={`h-${index}`}
          className={`${size} mt-2 first:mt-0 font-semibold text-slate-950`}
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

  return <>{blocks}</>;
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

function groundingSummary(g: GroundingReport) {
  if (g.status === "verified") {
    const n = g.supportedClaimsCount;
    return `All ${n} evaluated claim${n === 1 ? "" : "s"} are supported by cited source text.`;
  }

  if (g.status === "partially_supported") {
    const n = g.unsupportedClaimsCount;
    return `${n} claim${n === 1 ? "" : "s"} need review before relying on this answer.`;
  }

  return "The cited evidence does not adequately support this answer yet. Review the sources before relying on it.";
}

function groundingTone(g: GroundingReport) {
  if (g.status === "verified") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (g.status === "partially_supported") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function groundingLabel(g?: GroundingReport | null) {
  if (!g) return "Grounding not checked";
  if (g.status === "verified") return "Verified";
  if (g.status === "partially_supported") return "Needs review";
  return "Unsupported";
}

function answerTrustTone(message: Msg) {
  if (message.text.startsWith("Error:")) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (message.grounding) return groundingTone(message.grounding);
  if ((message.citations?.length ?? 0) > 0 || (message.evidence?.length ?? 0) > 0) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function answerTrustSummary(message: Msg) {
  if (message.text.startsWith("Error:")) return "Generation failed";
  if (message.grounding) return groundingLabel(message.grounding);
  if ((message.citations?.length ?? 0) > 0) return "Cited answer";
  return "No citations returned";
}

function sourceTruthLabel(args: {
  totalCount: number;
  scopeCount: number;
  readyCount: number;
  blockedCount: number;
}) {
  if (args.totalCount === 0) return "No sources attached";
  if (args.scopeCount === 0) return "No sources included";
  if (args.readyCount === 0) return "Sources not ready";
  if (args.blockedCount > 0) return "Partial source context";
  return "Ready source context";
}

function sourceTruthTone(args: {
  totalCount: number;
  scopeCount: number;
  readyCount: number;
  blockedCount: number;
}) {
  if (args.totalCount === 0 || args.scopeCount === 0 || args.readyCount === 0) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (args.blockedCount > 0) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function claimLinkTone(status: ClaimCitationLink["status"]) {
  return status === "linked"
    ? "border-slate-200 bg-white/70"
    : "border-amber-200 bg-amber-50";
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
    });

    if (run.status === "FAILED") {
      const errText = `Error: ${String(run.error || "Chat failed. Please try again.")}`;
      out.push({
        id: `${run.id}:assistant`,
        ts: ts + 1,
        role: "assistant",
        text: errText,
        displayText: String(run.error || "Chat failed. Please try again."),
        mode: run.answerMode,
        runId: run.id,
        promptVersion: run.promptVersion ?? undefined,
        model: run.model ?? null,
        latencyMs: run.latencyMs ?? null,
        scopedSourceIds: run.scopedSourceIds ?? [],
        grounding: run.grounding ?? null,
        claimLinks: run.claimLinks ?? [],
      });
      continue;
    }

    const answerText = String(run.answer ?? "");
    out.push({
      id: `${run.id}:assistant`,
      ts: ts + 1,
      role: "assistant",
      text: answerText,
      displayText: answerText,
      citations: run.citations ?? [],
      suggested: run.suggested ?? [],
      mode: run.answerMode,
      evidence: run.evidence ?? [],
      runId: run.id,
      promptVersion: run.promptVersion ?? undefined,
      model: run.model ?? null,
      latencyMs: run.latencyMs ?? null,
      scopedSourceIds: run.scopedSourceIds ?? [],
      grounding: run.grounding ?? null,
      claimLinks: run.claimLinks ?? [],
    });
  }

  return out;
}

function noteProvenanceFromAnswer(answer: {
  runId?: string;
  promptVersion?: string;
  model?: string | null;
  mode?: AnswerMode | null;
  latencyMs?: number | null;
  answer: string;
  citations?: Citation[];
  evidence?: EvidenceBlock[];
  claimLinks?: ClaimCitationLink[];
}): NoteProvenanceBundle {
  return {
    version: "note-provenance-v1",
    artifacts: [
      {
        kind: "chat-answer",
        runId: answer.runId ?? null,
        promptVersion: answer.promptVersion ?? null,
        model: answer.model ?? null,
        answerMode: answer.mode ?? null,
        createdAt: new Date().toISOString(),
        latencyMs: answer.latencyMs ?? null,
        answer: answer.answer,
        citations: answer.citations ?? [],
        evidence:
          Array.isArray(answer.evidence) && answer.evidence.length
            ? answer.evidence
            : undefined,
        claimLinks:
          Array.isArray(answer.claimLinks) && answer.claimLinks.length
            ? answer.claimLinks
            : undefined,
      },
    ],
  };
}

function quickActionBlockedMessage(args: {
  notebookId: string | null;
  pending: boolean;
  canChat: boolean;
  sourceGuardMessage: string | null;
}) {
  if (!args.notebookId) {
    return "Select a notebook first. The prompt was added to the composer.";
  }
  if (args.pending) {
    return "A response is already in progress. The prompt was added to the composer.";
  }
  if (!args.canChat) {
    return `${args.sourceGuardMessage || "Chat is waiting on sources."} The prompt was added to the composer.`;
  }
  return null;
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
  const [streamStatus, setStreamStatus] = useState("Thinking");
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [activeScopeSnapshot, setActiveScopeSnapshot] =
    useState<SourceScopeSnapshot | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const userStopRef = useRef(false);

  // Keep latest messages in a ref so we can build chat history without re-creating callbacks
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

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
  const sourceGuardMessage =
    totalCount === 0
      ? "Add a source before asking."
      : scopeCount === 0
        ? "Include at least one source before asking."
        : readyCount === 0
          ? "Wait for at least one included source to become Ready."
          : null;
  const canChat = !!notebookId && !sourceGuardMessage;
  const displayScope =
    pending && activeScopeSnapshot
      ? activeScopeSnapshot
      : {
          totalCount,
          scopeCount,
          readyCount,
          blockedCount,
        };
  const displaySourceGuardMessage =
    displayScope.totalCount === 0
      ? "Add a source before asking."
      : displayScope.scopeCount === 0
        ? "Include at least one source before asking."
        : displayScope.readyCount === 0
          ? "Wait for at least one included source to become Ready."
          : null;
  const currentScopeSnapshot: SourceScopeSnapshot = {
    totalCount,
    scopeCount,
    readyCount,
    blockedCount,
  };

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
        setHistoryError(null);
        const runs = await api.getChatHistory(notebookId, 80);
        if (!alive) return;
        setMessages(historyRunsToMessages(runs));
      } catch (err: any) {
        if (!alive) return;
        setMessages([]);
        setHistoryError(
          err?.message || "Could not load this notebook conversation.",
        );
      } finally {
        if (alive) setLoadingHistory(false);
      }
    }

    loadHistory();

    return () => {
      alive = false;
    };
  }, [notebookId, historyReloadKey]);

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

    emitNotebookEvent("add-note", {
      content: clean,
      mode: "append",
      citations: payload?.citations ?? null,
    });
  };

  const stageComposerPrompt = useCallback(
    (nextPrompt: string, reason: string) => {
      const trimmedCurrent = input.trim();
      const trimmedNext = nextPrompt.trim();
      if (!trimmedNext) return false;
      if (!trimmedCurrent || trimmedCurrent === trimmedNext) {
        setInput(trimmedNext);
        composerRef.current?.focus();
        return true;
      }

      emitNotebookEvent("toast", {
        kind: "warning",
        text: `Composer already has a draft. ${reason} was not inserted.`,
      });
      composerRef.current?.focus();
      return false;
    },
    [input],
  );

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
          m.text.length > MAX_CHARS ? m.text.slice(0, MAX_CHARS) + "..." : m.text,
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
      if (sourceGuardMessage) {
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            ts: Date.now(),
            role: "assistant",
            text: sourceGuardMessage,
            displayText: sourceGuardMessage,
          },
        ]);
        return;
      }

      const history = buildHistory(12);

      const userMsg: Msg = {
        id: uid(),
        ts: Date.now(),
        role: "user",
        text: question,
      };
      const runScopeSnapshot = {
        totalCount,
        scopeCount,
        readyCount,
        blockedCount,
      };
      const runScopedSourceIds = Array.isArray(sourceIds) ? [...sourceIds] : [];

      const assistantId = uid();
      let streamedText = "";
      let liveRunId: string | null = null;
      let finalAnswerPayload: {
        runId?: string;
        promptVersion?: string;
        model?: string | null;
        mode?: AnswerMode | null;
        latencyMs?: number | null;
        answer: string;
        citations?: Citation[];
        evidence?: EvidenceBlock[];
        claimLinks?: ClaimCitationLink[];
      } | null = null;

      setMessages((m) => [
        ...m,
        userMsg,
        {
          id: assistantId,
          ts: Date.now(),
          role: "assistant",
          text: "",
          displayText: "",
          scopeSnapshot: runScopeSnapshot,
          scopedSourceIds: runScopedSourceIds,
        },
      ]);
      setActiveScopeSnapshot(runScopeSnapshot);
      setPending(true);
      setStreamStatus("Starting");
      setStreamMessageId(assistantId);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      userStopRef.current = false;

      try {
        const res = await api.chatStream(notebookId, question, {
          sourceIds,
          history,
          answerMode,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "status") {
              setStreamStatus(event.message);
              return;
            }

            if (event.type === "run") {
              liveRunId = event.runId || null;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, runId: event.runId } : msg,
                ),
              );
              return;
            }

            if (event.type === "delta") {
              streamedText += event.text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        text: streamedText,
                        displayText: streamedText,
                      }
                    : msg,
                ),
              );
              return;
            }

            if (event.type === "final") {
              const answer = event.answer;
              finalAnswerPayload = answer;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        text: answer.answer,
                        displayText: answer.answer,
                        citations: answer.citations,
                        suggested: answer.suggested,
                        mode: answer.mode,
                        evidence: answer.evidence,
                        runId: answer.runId,
                        promptVersion: answer.promptVersion,
                        model: answer.model ?? null,
                        latencyMs: answer.latencyMs ?? null,
                        grounding: answer.grounding ?? null,
                        claimLinks: answer.claimLinks ?? [],
                        scopeSnapshot: runScopeSnapshot,
                        scopedSourceIds: runScopedSourceIds,
                      }
                    : msg,
                ),
              );
            }
          },
        });

        if (!streamedText) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    text: res.answer,
                    displayText: res.answer,
                    citations: res.citations,
                    suggested: res.suggested,
                    mode: res.mode,
                    evidence: res.evidence,
                    runId: res.runId,
                    promptVersion: res.promptVersion,
                    model: res.model ?? null,
                    latencyMs: res.latencyMs ?? null,
                    grounding: res.grounding ?? null,
                    claimLinks: res.claimLinks ?? [],
                    scopeSnapshot: runScopeSnapshot,
                    scopedSourceIds: runScopedSourceIds,
                  }
                : msg,
            ),
          );
        }

        const canonicalAnswer = finalAnswerPayload ?? res;

        if (saveToNotes?.title) {
          emitNotebookEvent("add-note", {
            title: saveToNotes.title,
            content: canonicalAnswer.answer,
            mode: saveToNotes.mode,
            citations: noteProvenanceFromAnswer(canonicalAnswer),
          });
        }

      } catch (e: any) {
        if (
          e?.code === "ERR_CANCELED" ||
          e?.name === "CanceledError" ||
          e?.name === "AbortError"
        ) {
          const stoppedText = userStopRef.current
            ? "Stopped by you."
            : "Stopped.";
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                    ...msg,
                    text: streamedText || stoppedText,
                    displayText: streamedText || stoppedText,
                  }
                : msg,
            ),
          );
          return;
        }
        const errMessage = String(
          e?.message || "Chat failed. Please try again.",
        );
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  text: `Error: ${errMessage}`,
                  displayText: errMessage,
                }
              : msg,
          ),
        );
        if (liveRunId) setHistoryReloadKey((key) => key + 1);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        userStopRef.current = false;
        setPending(false);
        setActiveScopeSnapshot(null);
        setStreamStatus("Thinking");
        setStreamMessageId(null);
      }
    },

    [
      notebookId,
      sourceIds,
      answerMode,
      sourceGuardMessage,
      totalCount,
      scopeCount,
      readyCount,
      blockedCount,
    ],
  );

  // Notebook Guide / Studio can fire a "send this prompt" event.
  useEffect(() => {
    return subscribeNotebookEvent("chat-prompt", (d) => {
      const detailObj =
        typeof d === "string" ? { prompt: d } : d || { prompt: "" };
      const prompt = String((detailObj as any).prompt || "").trim();
      if (!prompt) return;

      const autoSend = (detailObj as any).autoSend !== false;
      const saveToNotes = !!(detailObj as any).saveToNotes;
      const noteTitle = String((detailObj as any).noteTitle || "").trim();
      const noteMode: "append" | "replace" =
        (detailObj as any).noteMode === "replace" ? "replace" : "append";

      if (autoSend && notebookId && !pending && canChat) {
        const note =
          saveToNotes && noteTitle
            ? ({
                title: noteTitle,
                mode: noteMode,
              } as { title: string; mode: "append" | "replace" })
            : undefined;
        send(prompt, note);
        return;
      }

      if (!autoSend) {
        stageComposerPrompt(prompt, "Suggested prompt");
        return;
      }

      const blockedMessage = quickActionBlockedMessage({
        notebookId,
        pending,
        canChat,
        sourceGuardMessage,
      });
      const staged = stageComposerPrompt(prompt, "Quick action prompt");
      if (!blockedMessage) return;

      emitNotebookEvent("toast", {
        kind: canChat ? "info" : "error",
        text: staged
          ? blockedMessage
          : `${blockedMessage} Your existing draft was kept.`,
      });
    });
  }, [canChat, notebookId, pending, send, sourceGuardMessage, stageComposerPrompt]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!pending && canChat && input.trim()) {
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
    const answerScope = messages[i]?.scopeSnapshot ?? null;
    const answerSourceIds = messages[i]?.scopedSourceIds ?? null;
    if (
      (answerScope && !sameSourceScope(answerScope, currentScopeSnapshot)) ||
      (answerSourceIds &&
        answerSourceIds.length > 0 &&
        !sameScopedSourceIds(answerSourceIds, sourceIds ?? []))
    ) {
      emitNotebookEvent("toast", {
        kind: "warning",
        text: "Source scope changed since this answer. Regenerate will use the current ready sources.",
      });
    }
    if (q) send(q);
  };

  const jumpToBottom = () =>
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white/10">
      <div className="px-4 md:px-6 py-3 border-b border-emerald-200/70 bg-white/60 backdrop-blur supports-[backdrop-filter]:bg-white/40">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              "text-[11px] px-2.5 py-1 rounded-full border font-semibold",
              sourceTruthTone({
                totalCount: displayScope.totalCount,
                scopeCount: displayScope.scopeCount,
                readyCount: displayScope.readyCount,
                blockedCount: displayScope.blockedCount,
              }),
            )}
            title="This is the exact source boundary used for chat. Only ready, included sources are sent to the LLM."
          >
            {sourceTruthLabel({
              totalCount: displayScope.totalCount,
              scopeCount: displayScope.scopeCount,
              readyCount: displayScope.readyCount,
              blockedCount: displayScope.blockedCount,
            })}
          </span>
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700">
            Using {displayScope.readyCount}/{Math.max(displayScope.scopeCount, 0)} ready sources
          </span>

          {displayScope.blockedCount > 0 ? (
            <span
              className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"
              title="These sources are included by scope but are still indexing or failed indexing, so they are excluded from chat for reliability."
            >
              {displayScope.blockedCount} not ready
            </span>
          ) : null}

          {displayScope.totalCount > 0 && displayScope.scopeCount === 0 ? (
            <span className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1">
              No sources selected - include sources to get cited answers.
            </span>
          ) : null}

          {displayScope.scopeCount > 0 && displayScope.readyCount === 0 ? (
            <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              Sources are still indexing - chat will work once at least one is
              "Ready".
            </span>
          ) : null}

          {pending && activeScopeSnapshot ? (
            <span
              className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-full px-2.5 py-1"
              title="Source scope is locked to the snapshot taken when this answer started."
            >
              Scope locked for this answer
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
            onClick={() => emitNotebookEvent("manage-sources", undefined)}
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
              New messages
            </button>
          )}

          {loadingHistory && messages.length === 0 && (
            <div className="h-full w-full grid place-items-center">
              <div className="rounded-2xl border border-white/30 bg-white/70 backdrop-blur px-4 py-3 shadow-[0_16px_50px_rgba(15,23,42,0.12)] text-sm text-slate-600 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading notebook conversation...
              </div>
            </div>
          )}

          {!loadingHistory && historyError && messages.length === 0 ? (
            <div className="h-full w-full grid place-items-center">
              <div className="max-w-xl rounded-3xl border border-rose-200 bg-rose-50/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
                <div className="text-sm font-semibold text-rose-900">
                  Conversation could not be loaded
                </div>
                <p className="mt-2 text-sm leading-6 text-rose-800">
                  {historyError}
                </p>
                <button
                  type="button"
                  onClick={() => setHistoryReloadKey((key) => key + 1)}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-50"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Retry loading history
                </button>
              </div>
            </div>
          ) : null}

          {/* Empty state */}
          {!loadingHistory && !historyError && messages.length === 0 && (
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
              const isScopeDrifted =
                m.role === "assistant" &&
                messageScopeDrifted({
                  message: m,
                  currentScope: currentScopeSnapshot,
                  currentSourceIds: sourceIds ?? [],
                });
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
                        m.text.startsWith("Error:")
                          ? "border-red-200 bg-red-50 text-red-800"
                          : "",
                        bubbleRound,
                        isUser
                          ? "bg-white border-slate-200 text-slate-900"
                          : m.text.startsWith("Error:")
                            ? ""
                            : "bg-white/80 backdrop-blur border-white/40 text-slate-900",
                      )}
                    >
                      {m.role === "assistant" ? (
                        m.text.startsWith("Error:") ? (
                          <>
                            <strong>Error:</strong>{" "}
                            {m.displayText || m.text.replace(/^Error:\s*/, "")}
                          </>
                        ) : (
                          <MarkdownText text={m.displayText ?? m.text} />
                        )
                      ) : (
                        m.text
                      )}
                    </div>

                    {m.role === "assistant" ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={clsx(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                            answerTrustTone(m),
                          )}
                          title="Trust is derived from backend grounding, citations, and evidence blocks returned with this answer."
                        >
                          {answerTrustSummary(m)}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600">
                          Citations {m.citations?.length ?? 0}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600">
                          Evidence blocks {m.evidence?.length ?? 0}
                        </span>
                        {m.scopeSnapshot ? (
                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600">
                            Sources {m.scopeSnapshot.readyCount}/{Math.max(m.scopeSnapshot.scopeCount, 0)}
                          </span>
                        ) : m.scopedSourceIds?.length ? (
                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600">
                            Used {m.scopedSourceIds.length} sources
                          </span>
                        ) : null}
                        {m.model ? (
                          <span className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] text-slate-600">
                            {m.model}
                          </span>
                        ) : null}
                        {isScopeDrifted ? (
                          <span
                            className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800"
                            title="This answer used a different source boundary than the notebook's current ready scope."
                          >
                            Scope changed since answer
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {m.role === "assistant" && m.grounding ? (
                      <div
                        className={clsx(
                          "mt-2 rounded-2xl border px-3 py-2 text-[12px] leading-5",
                          groundingTone(m.grounding),
                        )}
                      >
                        <span className="font-semibold">Grounding check:</span>{" "}
                        {groundingSummary(m.grounding)}
                      </div>
                    ) : null}

                    {isScopeDrifted ? (
                      <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
                        This answer was generated from an older source scope.
                        Regenerate or ask a follow-up to use the notebook's current ready sources.
                      </div>
                    ) : null}

                    {/* Claim-to-citation map (Draft / Briefing) */}
                    {m.role === "assistant" &&
                    !m.evidence?.length &&
                    m.claimLinks?.length ? (
                      <div className="mt-2 space-y-2">
                        <div className="text-[11px] font-semibold tracking-wide text-slate-600">
                          Claim-to-citation map
                        </div>

                        {m.claimLinks.map((link, linkIdx) => (
                          <div
                            key={`${m.id}_cl_${linkIdx}`}
                            className={clsx(
                              "rounded-2xl border px-4 py-3 shadow-sm",
                              claimLinkTone(link.status),
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm text-slate-900 leading-[1.5]">
                                <span className="font-semibold mr-2">
                                  {linkIdx + 1}.
                                </span>
                                {link.claim}
                              </div>

                              <div className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                                {Math.round((link.supportScore ?? 0) * 100)}%
                              </div>
                            </div>

                            <div className="mt-1 text-[11px] text-slate-500">
                              {link.source === "derived"
                                ? "Linked from answer text"
                                : "Linked from evidence block"}
                            </div>

                            {link.citations?.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {link.citations.map((c, idx) => (
                                  <CitationBadge
                                    key={`${linkIdx}_${c.chunkId}_${idx}`}
                                    index={idx + 1}
                                    citation={c}
                                    onOpenSource={openSource}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="mt-2 text-[12px] text-amber-700">
                                No direct citations could be confidently linked
                                to this claim yet.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}

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
                            key={`${m.id}_cit_${c.chunkId}_${idx}`}
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
                        claimLinks={m.claimLinks}
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
                            onClick={() => {
                              if (
                                (m.scopeSnapshot &&
                                  !sameSourceScope(
                                    m.scopeSnapshot,
                                    currentScopeSnapshot,
                                  )) ||
                                (m.scopedSourceIds?.length &&
                                  !sameScopedSourceIds(
                                    m.scopedSourceIds,
                                    sourceIds ?? [],
                                  ))
                              ) {
                                emitNotebookEvent("toast", {
                                  kind: "warning",
                                  text: "Source scope changed since this answer. Follow-up will use the current ready sources.",
                                });
                              }
                              stageComposerPrompt(s, "Follow-up prompt");
                            }}
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
            {pending && !streamMessageId && (
              <div className="flex gap-3 justify-start">
                <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white grid place-items-center shadow-[0_14px_34px_rgba(15,23,42,0.25)]">
                  <span className="text-[12px] font-bold tracking-tight">
                    AI
                  </span>
                </div>

                <div className="max-w-[720px] w-full">
                  <div className="text-[11px] font-semibold text-slate-700 mb-1 flex items-center gap-2">
                    Assistant{" "}
                    <span className="text-slate-500 font-normal">
                      {streamStatus}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/40 bg-white/80 backdrop-blur shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                    <span className="text-sm text-slate-600">
                      {streamStatus}...
                    </span>
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
          {displaySourceGuardMessage ? (
            <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
              <span className="font-semibold">Chat is waiting on sources.</span>{" "}
              {displaySourceGuardMessage}
              {displayScope.totalCount > 0 ? (
                <button
                  type="button"
                  onClick={() => emitNotebookEvent("manage-sources", undefined)}
                  className="ml-2 font-semibold underline decoration-amber-700/40 underline-offset-2"
                >
                  Review source scope
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="rounded-3xl border border-slate-200 bg-white shadow-[0_14px_40px_rgba(15,23,42,0.10)] px-3 py-2">
                <textarea
                  ref={composerRef}
                  name="chat-composer"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    notebookId
                      ? displaySourceGuardMessage || "Ask about your sources..."
                      : "Create/select a notebook to start"
                  }
                  disabled={!notebookId || !!displaySourceGuardMessage}
                  className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-slate-400 disabled:text-slate-400"
                  rows={1}
                />

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">
                    Enter to send | Shift+Enter for newline
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
                if (pending) {
                  userStopRef.current = true;
                  abortRef.current?.abort();
                  return;
                }
                if (!canChat) return;
                const q = input.trim();
                if (!q) return;
                setInput("");
                send(q);
              }}
              disabled={!canChat || (!pending && !input.trim())}
              className={clsx(
                "w-11 h-11 grid place-items-center rounded-2xl text-white shadow-[0_18px_50px_rgba(15,23,42,0.25)] transition-all",
                !canChat || (!pending && !input.trim())
                  ? "bg-slate-400 cursor-not-allowed opacity-70"
                  : pending
                    ? "bg-rose-600 hover:bg-rose-700 active:scale-[0.98]"
                    : "bg-slate-900 hover:bg-black active:scale-[0.98]",
              )}
              aria-label={pending ? "Stop" : "Send"}
              title={pending ? "Stop" : "Send"}
            >
              {pending ? (
                <span className="h-3.5 w-3.5 rounded-[3px] bg-white" />
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M2 21l19-9L2 3l3 7 9 2-9 2-3 7z" />
                </svg>
              )}
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
