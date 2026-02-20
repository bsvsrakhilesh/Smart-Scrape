import type { BackendDocumentRevision } from "../../lib/api";

function shortHash(h?: string | null) {
  if (!h) return null;
  const s = String(h);
  return s.length <= 14 ? s : `${s.slice(0, 10)}…${s.slice(-4)}`;
}

type Props = {
  revisions: BackendDocumentRevision[];
  onOpen: (storedFileId: string) => void;

  // Optional compare controls (Saved URLs modal uses these)
  onSetA?: (storedFileId: string) => void;
  onSetB?: (storedFileId: string) => void;
  currentA?: string;
  currentB?: string;

  // one-click diff against previous revision
  onCompareWithPrev?: (currentId: string, prevId: string) => void;

  // handoff this specific revision into Notebook
  onUseInNotebook?: (storedFileId: string) => void;
};

export default function RevisionHistoryPanel({
  revisions,
  onOpen,
  onSetA,
  onSetB,
  currentA,
  currentB,
  onCompareWithPrev,
  onUseInNotebook,
}: Props) {
  return (
    <div className="border rounded-xl p-3 bg-white">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Revision history</div>
        <div className="text-xs text-gray-500">
          {revisions.length} revision{revisions.length === 1 ? "" : "s"}
        </div>
      </div>

      {revisions.length === 0 ? (
        <div className="text-sm text-gray-500 mt-2">
          No canonical revisions yet. Capture again to create a new revision.
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {revisions.map((r, idx) => {
            const fileId = r.storedFile?.id;
            if (!fileId) return null;

            // Backend orders by ordinal DESC → idx+1 is "previous"
            const prevFileId = revisions[idx + 1]?.storedFile?.id ?? null;

            const isA = currentA && fileId === currentA;
            const isB = currentB && fileId === currentB;

            const btn =
              "inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-medium hover:bg-slate-50";

            return (
              <div key={r.id} className="border rounded-lg p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      Rev {r.ordinal}{" "}
                      <span className="text-xs text-gray-500">
                        • {r.captureType}
                        {r.captureEvent?.pipeline?.name
                          ? ` • ${r.captureEvent.pipeline.name}@${r.captureEvent.pipeline.version}`
                          : ""}
                        {r.contentHash ? ` • ${shortHash(r.contentHash)}` : ""}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0 justify-end">
                    {onSetA && (
                      <button
                        className={`${btn} ${isA ? "bg-slate-900 text-white border-slate-900" : ""}`}
                        onClick={() => onSetA(fileId)}
                        title="Set as Compare A"
                        type="button"
                      >
                        A
                      </button>
                    )}

                    {onSetB && (
                      <button
                        className={`${btn} ${isB ? "bg-slate-900 text-white border-slate-900" : ""}`}
                        onClick={() => onSetB(fileId)}
                        title="Set as Compare B"
                        type="button"
                      >
                        B
                      </button>
                    )}

                    {onCompareWithPrev && prevFileId && (
                      <button
                        className={btn}
                        onClick={() => onCompareWithPrev(fileId, prevFileId)}
                        title="Compare this revision with the immediately previous revision"
                        type="button"
                      >
                        Diff prev
                      </button>
                    )}

                    {onUseInNotebook && (
                      <button
                        className={btn}
                        onClick={() => onUseInNotebook(fileId)}
                        title="Use this revision inside Notebook"
                        type="button"
                      >
                        Notebook
                      </button>
                    )}

                    <button
                      className={btn}
                      onClick={() => onOpen(fileId)}
                      title="Open preview"
                      type="button"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}