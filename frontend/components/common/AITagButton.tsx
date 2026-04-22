import { useState } from "react";
import { useAITagger } from "../../hooks/useAITagger";
import { AI_TAG_JOB_TIMEOUT_SEC } from "../../lib/aiTagUi";

type Props = {
  kind: "file" | "url";
  id: string | number;
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
  onMerge?: (tags: string[]) => void;
};

export default function AITagButton({
  kind,
  id,
  className = "",
  disabled = false,
  disabledReason,
  onMerge,
}: Props) {
  const [msg, setMsg] = useState("");
  const { running, progress, stage, message, attempt, cached, start } =
    useAITagger();

  const go = async () => {
    if (disabled) return;

    setMsg("");

    const res = await start({
      timeoutSec: AI_TAG_JOB_TIMEOUT_SEC,
      attachId:
        kind === "file" ? { fileId: String(id) } : { urlId: Number(id) },
      onSuccess: (tags) => {
        const suffix =
          tags.length === 1
            ? "1 label applied"
            : `${tags.length} labels applied`;
        setMsg(cached ? `${suffix} · cached` : suffix);
        onMerge?.(tags);
      },
      onFailure: (m) => setMsg(m),
    });

    if (!res.ok && !("cancelled" in res)) {
      console.error(res.error);
    }
  };

  const liveLine = running
    ? [
        message || stage || "AI extraction in progress",
        typeof progress === "number" ? `${Math.round(progress)}%` : null,
        attempt && attempt > 1 ? `Attempt ${attempt}` : null,
        cached ? "Cached" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : msg;

  return (
    <div className="inline-flex max-w-full flex-col gap-1">
      <div className="inline-flex items-center gap-2 whitespace-nowrap">
        <button
          onClick={go}
          disabled={running || disabled}
          className={`text-xs px-2.5 py-1.5 border rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-60 ${className}`}
          title={
            disabled
              ? disabledReason || "AI tagging is unavailable for this item"
              : "Suggest tags using AI"
          }
        >
          {running
            ? `AI tagging… ${Math.round(progress)}%`
            : "Suggest tags (AI)"}
        </button>

        {cached && !running ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            Cached
          </span>
        ) : null}
      </div>

      {liveLine ? (
        <span className="max-w-[26rem] break-words text-[10px] text-gray-500">
          {liveLine}
        </span>
      ) : null}
    </div>
  );
}
