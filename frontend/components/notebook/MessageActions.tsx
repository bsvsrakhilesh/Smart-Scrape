import type { AnswerMode, Citation } from "../../lib/notebookClient";

type Props = {
  text: string;
  citations?: Citation[];
  mode?: AnswerMode;

  onRegenerate?: () => void;
  onAddToNotes?: (md: string) => void;
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
        ? `p.${c.pageStart}${c.pageEnd != null && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""}`
        : null;

    const head = `[${i + 1}] ${label}${page ? ` (${page})` : ""}`;
    const quote = (c.quote || "").replace(/\s+/g, " ").trim();
    return `${head}: "${quote}"`;
  });

  return lines.length ? `\n\nSources\n${lines.join("\n")}` : "";
}

export default function MessageActions({
  text,
  citations,
  mode,
  onRegenerate,
  onAddToNotes,
}: Props) {
  const copy = async () => {
    await navigator.clipboard.writeText(text || "");
  };

  const copyWithCitations = async () => {
    const suffix = citations?.length ? formatCitations(citations) : "";
    const tuned =
      mode === "briefing"
        ? suffix.replace("\n\nSources\n", "\n\nSources (verbatim quotes)\n")
        : suffix;

    await navigator.clipboard.writeText(`${text || ""}${tuned}`);
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
          onClick={() => onAddToNotes(text)}
          className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50"
        >
          Add to notes
        </button>
      )}
    </div>
  );
}
