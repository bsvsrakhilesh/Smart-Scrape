import { useState } from "react";
import { useAITagger } from "../../hooks/useAITagger";

type Props = {
  kind: "file" | "url";
  id: string | number;
  className?: string;
  onMerge?: (tags: string[]) => void; // merge into UI or refetch
};

export default function AITagButton({ kind, id, className = "", onMerge }: Props) {
  const [msg, setMsg] = useState("");
  const { running, progress, start } = useAITagger();

  const go = async () => {
    setMsg("");
    const res = await start({
      timeoutSec: 90,
      attachId: kind === "file" ? { fileId: String(id) } : { urlId: Number(id) },
      onSuccess: (tags) => { setMsg(`+${tags.length}`); onMerge?.(tags); },
      onFailure: (m) => setMsg(m),
    });
    if (!res.ok) console.error(res.error);
  };

  return (
    <div className="inline-flex items-center gap-2 whitespace-nowrap">
      <button
        onClick={go}
        disabled={running}
        className={`text-xs px-2 py-1 border rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-60 ${className}`}
        title="Suggest tags using AI"
      >
        {running ? `AI… ${Math.round(progress)}%` : "Suggest tags (AI)"}
      </button>
      {msg && <span className="text-[10px] text-gray-500">{msg}</span>}
    </div>
  );
}
