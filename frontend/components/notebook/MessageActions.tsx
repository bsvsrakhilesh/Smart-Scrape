import type {
  AnswerMode,
  Citation,
  EvidenceBlock,
  NoteProvenanceBundle,
  ClaimCitationLink,
} from "../../lib/notebookClient";
import { emitNotebookEvent } from "../../lib/notebookEvents";

type Props = {
  text: string;
  citations?: Citation[];
  mode?: AnswerMode;
  evidence?: EvidenceBlock[];
  claimLinks?: ClaimCitationLink[];

  runId?: string;
  promptVersion?: string;
  model?: string | null;
  latencyMs?: number | null;
  messageTs?: number;

  onRegenerate?: () => void;
  onAddToNotes?: (payload: {
    content: string;
    citations?: NoteProvenanceBundle | null;
  }) => void;
};

function formatCitations(citations: Citation[]) {
  const uniq = new Map<string, Citation>();
  for (const c of citations || []) {
    const key = `${c.chunkId}::${c.quote}`;
    if (!uniq.has(key)) uniq.set(key, c);
  }
  const list = Array.from(uniq.values()).slice(0, 12);

  const lines = list.map((c, i) => {
    const label =
      c.sourceLabel ??
      c.fileName ??
      c.sourceUrl ??
      (c.sourceKind ? `${c.sourceKind}` : null) ??
      c.chunkId;

    const page =
      c.pageStart != null
        ? `p.${c.pageStart}${c.pageEnd != null && c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""}`
        : null;

    const head = `[${i + 1}] ${label}${page ? ` (${page})` : ""}`;
    const quote = (c.quote || "").replace(/\s+/g, " ").trim();
    return `${head}: "${quote}"`;
  });

  return lines.length ? `\n\nSources\n${lines.join("\n")}` : "";
}

function buildNoteProvenance(p: {
  text: string;
  citations?: Citation[];
  evidence?: EvidenceBlock[];
  claimLinks?: ClaimCitationLink[];
  mode?: AnswerMode;
  runId?: string;
  promptVersion?: string;
  model?: string | null;
  latencyMs?: number | null;
  messageTs?: number;
}): NoteProvenanceBundle | null {
  const safeText = String(p.text ?? "").trim();
  const safeCitations = Array.isArray(p.citations) ? p.citations : [];
  const safeEvidence = Array.isArray(p.evidence) ? p.evidence : [];
  const safeClaimLinks = Array.isArray(p.claimLinks) ? p.claimLinks : [];

  if (!safeText && !safeCitations.length && !safeEvidence.length) return null;

  return {
    version: "note-provenance-v1",
    artifacts: [
      {
        kind: "chat-answer",
        runId: p.runId ?? null,
        promptVersion: p.promptVersion ?? null,
        model: p.model ?? null,
        answerMode: p.mode ?? null,
        createdAt: new Date(p.messageTs ?? Date.now()).toISOString(),
        latencyMs: p.latencyMs ?? null,
        answer: safeText,
        citations: safeCitations,
        evidence: safeEvidence.length ? safeEvidence : undefined,
        claimLinks: safeClaimLinks.length ? safeClaimLinks : undefined,
      },
    ],
  };
}

export default function MessageActions({
  text,
  citations,
  mode,
  evidence,
  claimLinks,
  runId,
  promptVersion,
  model,
  latencyMs,
  messageTs,
  onRegenerate,
  onAddToNotes,
}: Props) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || "");
      emitNotebookEvent("toast", { kind: "success", text: "Copied answer." });
    } catch {
      emitNotebookEvent("toast", {
        kind: "error",
        text: "Copy failed. Your browser blocked clipboard access.",
      });
    }
  };

  const copyWithCitations = async () => {
    const suffix = citations?.length ? formatCitations(citations) : "";
    const tuned =
      mode === "briefing"
        ? suffix.replace("\n\nSources\n", "\n\nSources (verbatim quotes)\n")
        : suffix;

    try {
      await navigator.clipboard.writeText(`${text || ""}${tuned}`);
      emitNotebookEvent("toast", {
        kind: "success",
        text: "Copied answer with citations.",
      });
    } catch {
      emitNotebookEvent("toast", {
        kind: "error",
        text: "Copy failed. Your browser blocked clipboard access.",
      });
    }
  };

  return (
    <div className="mt-2 flex gap-2 flex-wrap">
      <button
        onClick={copy}
        className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50"
      >
        Copy
      </button>

      {citations && citations.length > 0 ? (
        <button
          onClick={copyWithCitations}
          className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50"
          title="Copies the answer and appends a Sources section with quotes."
        >
          Copy + citations
        </button>
      ) : null}

      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50"
        >
          Regenerate
        </button>
      )}

      {onAddToNotes && (
        <button
          onClick={() =>
            onAddToNotes({
              content: text,
              citations: buildNoteProvenance({
                text,
                citations,
                evidence,
                claimLinks,
                mode,
                runId,
                promptVersion,
                model,
                latencyMs,
                messageTs,
              }),
            })
          }
          className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50"
        >
          Add to notes
        </button>
      )}
    </div>
  );
}
