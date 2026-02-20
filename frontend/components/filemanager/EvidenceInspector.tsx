import React, { useEffect, useState } from "react";
import { ExternalLink, Copy, Info } from "lucide-react";
import type { FileItem } from "../../lib/types";
import { formatBytes } from "../../utils/fileHelpers";
import {
  getFileRevisions,
  type BackendDocumentRevision,
  apiUrl,
} from "../../lib/api";
import RevisionHistoryPanel from "../common/RevisionHistoryPanel";

type Props = {
  file: FileItem | null;
};

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
        {label}
      </div>
      <div
        className={`min-w-0 text-right text-[12px] text-slate-900 ${
          mono ? "font-mono" : ""
        }`}
      >
        <div className="truncate max-w-[240px]">{value}</div>
      </div>
    </div>
  );
}

async function copyToClipboard(txt?: string | null) {
  try {
    if (!txt) return;
    await navigator.clipboard.writeText(txt);
  } catch {
    // ignore
  }
}

function useRevisionInNotebook(storedFileId: string) {
  try {
    localStorage.setItem(
      "nb:pendingAddSource",
      JSON.stringify({ kind: "FILE", id: storedFileId, ts: Date.now() }),
    );
  } catch {
    // ignore
  }
  window.location.href = "/notebook";
}

export default function EvidenceInspector({ file }: Props) {
  const sourceUrl = file?.sourceUrl ?? null;

  const [revisions, setRevisions] = useState<BackendDocumentRevision[]>([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState<string | null>(null);

  useEffect(() => {
    if (!file?.id) return;

    (async () => {
      try {
        setRevLoading(true);
        setRevError(null);
        const out = await getFileRevisions(file.id, 50);
        setRevisions(out.revisions || []);
      } catch (e: any) {
        setRevError(e?.message ?? "Failed to load revision history");
      } finally {
        setRevLoading(false);
      }
    })();
  }, [file?.id]);

  return (
    <aside className="rounded-2xl border border-[hsl(var(--border))] bg-white/80 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <div className="text-sm font-semibold text-slate-900">Evidence</div>
        </div>
      </div>

      {!file ? (
        <div className="px-4 py-5 text-sm text-[hsl(var(--muted-foreground))]">
          Select a single file to see provenance, capture metadata, and tags.
        </div>
      ) : (
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 pb-3">
            {sourceUrl ? (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-[12px] font-medium shadow-sm hover:bg-slate-50"
                  onClick={() => window.open(sourceUrl, "_blank", "noopener")}
                  title="Open source URL"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open source
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-white px-3 py-2 text-[12px] font-medium shadow-sm hover:bg-slate-50"
                  onClick={() => copyToClipboard(sourceUrl)}
                  title="Copy source URL"
                >
                  <Copy className="w-4 h-4" />
                  Copy URL
                </button>
              </>
            ) : (
              <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
                No source URL.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3">
            <div className="px-1 pt-3 pb-1 text-[11px] font-semibold text-slate-900">
              Basics
            </div>
            <div className="divide-y divide-[hsl(var(--border))]">
              <Row label="Name" value={file.title} />
              <Row label="Type" value={file.mimeType} />
              <Row label="Size" value={formatBytes(file.size)} />
              <Row
                label="Uploaded"
                value={new Date(file.uploadDate).toLocaleString()}
              />
              <Row label="Visibility" value={file.visibility} />
              <Row label="Tags" value={file.tags?.join(", ") || "—"} />
            </div>
          </div>

          <div className="h-3" />

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white px-3">
            <div className="px-1 pt-3 pb-1 text-[11px] font-semibold text-slate-900">
              Provenance
            </div>
            <div className="divide-y divide-[hsl(var(--border))]">
              <Row label="Capture type" value={file.captureType ?? "—"} />
              <Row label="Source URL" value={file.sourceUrl ?? "—"} />
              <Row
                label="URL ID"
                value={file.urlId != null ? String(file.urlId) : "—"}
              />
              <Row label="SHA-256" value={file.sha256 ?? "—"} mono />
              <Row label="Content hash" value={file.contentHash ?? "—"} mono />
              <Row label="Tagger version" value={file.taggerVersion ?? "—"} />
              <Row
                label="Capture method"
                value={file.captureMeta?.method ?? "—"}
              />
              <Row
                label="Captured URL"
                value={file.captureMeta?.capturedUrl ?? "—"}
              />
            </div>
          </div>
          <div className="h-3" />

          {revLoading ? (
            <div className="text-[12px] text-[hsl(var(--muted-foreground))]">
              Loading revision history…
            </div>
          ) : revError ? (
            <div className="text-[12px] text-red-600">{revError}</div>
          ) : (
            <RevisionHistoryPanel
              revisions={revisions}
              onOpen={(storedFileId) =>
                window.open(
                  apiUrl(`/api/files/${storedFileId}/preview`),
                  "_blank",
                )
              }
              onUseInNotebook={(storedFileId) =>
                useRevisionInNotebook(storedFileId)
              }
            />
          )}
        </div>
      )}
    </aside>
  );
}
