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
import StructuredTags from "../common/StructuredTags";

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

function shortHash(value?: string | null) {
  if (!value) return "—";
  const s = String(value);
  return s.length <= 18 ? s : `${s.slice(0, 12)}…${s.slice(-4)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

function getSourceHost(file: FileItem) {
  const raw = file.sourceUrl ?? file.captureEvent?.sourceUrl ?? "";
  if (!raw) {
    return file.captureType && String(file.captureType).startsWith("URL_")
      ? "Captured web"
      : "Direct upload";
  }

  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return (
      String(raw)
        .replace(/^https?:\/\//, "")
        .split("/")[0] || "Unknown source"
    );
  }
}

function getIntegritySummary(file: FileItem): {
  tone: "green" | "blue" | "slate";
  label: string;
  meta: string;
} {
  if (file.sha256) {
    return {
      tone: "green",
      label: "Verified hash",
      meta: shortHash(file.sha256),
    };
  }

  if (file.contentHash) {
    return {
      tone: "blue",
      label: "Content hash",
      meta: shortHash(file.contentHash),
    };
  }

  return {
    tone: "slate",
    label: "Hash pending",
    meta: "No immutable hash recorded",
  };
}

function getTaggingSummary(file: FileItem): {
  tone: "green" | "blue" | "slate";
  label: string;
  meta: string;
} {
  const status = file.taggingStatus ?? "NONE";

  if (status === "SUCCESS") {
    return {
      tone: "green",
      label: "AI tags ready",
      meta: file.taggerVersion
        ? `Tagger ${file.taggerVersion}`
        : "Structured labels extracted",
    };
  }

  if (status === "RUNNING") {
    return {
      tone: "blue",
      label: "AI tagging running",
      meta: file.taggingJobId
        ? `Job ${shortHash(file.taggingJobId)}`
        : "Extraction in progress",
    };
  }

  if (status === "PENDING") {
    return {
      tone: "blue",
      label: "AI tagging queued",
      meta: "Waiting for worker pickup",
    };
  }

  if (status === "FAILED") {
    return {
      tone: "slate",
      label: "AI tagging failed",
      meta: file.taggingError || "Retry from the preview modal",
    };
  }

  return {
    tone: "slate",
    label: "AI tags not started",
    meta: "No background tag job recorded",
  };
}

export default function EvidenceInspector({ file }: Props) {
  const sourceUrl = file?.sourceUrl ?? null;

  const [revisions, setRevisions] = useState<BackendDocumentRevision[]>([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState<string | null>(null);

  useEffect(() => {
    if (!file?.id) return;

    const isFolder =
      file.mimeType === "folder" || String(file.id).startsWith("folder:");

    if (isFolder) {
      setRevisions([]);
      setRevError(null);
      setRevLoading(false);
      return;
    }

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
  }, [file?.id, file?.mimeType]);

  const tagging = file ? getTaggingSummary(file) : null;

  const sourceHost = file ? getSourceHost(file) : "Unknown source";
  const integrity = file ? getIntegritySummary(file) : null;

  const pipelineLabel = file?.captureEvent?.pipelineConfig
    ? `${file.captureEvent.pipelineConfig.name} v${file.captureEvent.pipelineConfig.version}`
    : "No pipeline recorded";

  const actorLabel =
    file?.captureEvent?.actorName ?? file?.uploader?.name ?? "Unknown actor";

  const authorsLabel =
    file?.sourceAuthors && file.sourceAuthors.length
      ? file.sourceAuthors.join(", ")
      : "—";

  const timelineItems = React.useMemo(() => {
    if (!file)
      return [] as Array<{
        id: string;
        title: string;
        time?: string | null;
        detail: string;
        tone: "blue" | "green" | "violet" | "slate";
      }>;

    const items: Array<{
      id: string;
      title: string;
      time?: string | null;
      detail: string;
      tone: "blue" | "green" | "violet" | "slate";
    }> = [
      {
        id: "archive-record",
        title: "Archived record available",
        time: file.uploadDate,
        detail: `${file.mimeType} • ${formatBytes(file.size)} • ${file.visibility}`,
        tone: "blue",
      },
    ];

    if (file.documentRevision) {
      items.push({
        id: "revision",
        title: `Revision R${file.documentRevision.ordinal}`,
        time: file.documentRevision.createdAt,
        detail:
          revisions.length > 0
            ? `${revisions.length} canonical revisions loaded`
            : "Revision metadata recorded",
        tone: "violet",
      });
    }

    if (file.captureEvent) {
      items.push({
        id: "capture-event",
        title: "Capture event recorded",
        time: file.captureEvent.createdAt,
        detail: `${actorLabel} • ${file.captureMeta?.method ?? file.captureType ?? "Unknown method"}`,
        tone: "green",
      });
    }

    if (file.sourcePublishedAt) {
      items.push({
        id: "source-published",
        title: "Source publication detected",
        time: file.sourcePublishedAt,
        detail: authorsLabel,
        tone: "slate",
      });
    }

    return items;
  }, [file, revisions.length, actorLabel, authorsLabel]);

  return (
    <aside className="rounded-2xl border border-[hsl(var(--border))] bg-white/80 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
          <div className="text-sm font-semibold text-slate-900">Evidence</div>
        </div>
      </div>

      {!file ? (
        <div className="ei-empty">
          <div className="ei-empty-hero">
            <div className="ei-empty-eyebrow">Provenance drawer</div>
            <h3 className="ei-empty-title">
              Select one file to inspect trust, source, and revision history
            </h3>
            <p className="ei-empty-copy">
              This panel should explain where a file came from, whether it
              changed, what was captured, and whether it is ready for notebook
              use.
            </p>
          </div>

          <div className="ei-empty-grid">
            <div className="ei-empty-card">
              <div className="ei-empty-card__label">What appears here</div>
              <ul className="ei-empty-list">
                <li>Source URL and capture method</li>
                <li>SHA-256 / content hash state</li>
                <li>Document revision timeline</li>
                <li>AI tags and structured metadata</li>
              </ul>
            </div>

            <div className="ei-empty-card">
              <div className="ei-empty-card__label">Integrity legend</div>
              <div className="ei-empty-badges">
                <span className="ei-badge ei-badge--green">Verified hash</span>
                <span className="ei-badge ei-badge--blue">Snapshot</span>
                <span className="ei-badge ei-badge--violet">Revisioned</span>
              </div>
            </div>

            <div className="ei-empty-card">
              <div className="ei-empty-card__label">Helpful shortcuts</div>
              <div className="ei-empty-shortcuts">
                <span>
                  <kbd>Ctrl</kbd> + <kbd>K</kbd> Command palette
                </span>
                <span>
                  <kbd>?</kbd> Hotkeys
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-4">
          <div className="ei-shell">
            <div className="ei-hero">
              <div className="ei-hero__eyebrow">Selected evidence</div>
              <h3 className="ei-hero__title">{file.title}</h3>
              <p className="ei-hero__subtitle">
                {sourceHost} • {file.captureType ?? "UPLOAD"} • {file.mimeType}
              </p>

              <div className="ei-pill-row">
                {integrity ? (
                  <span className={`ei-pill ei-pill--${integrity.tone}`}>
                    {integrity.label}
                  </span>
                ) : null}
                <span className="ei-pill ei-pill--ghost">
                  {file.documentRevision?.ordinal
                    ? `Revision R${file.documentRevision.ordinal}`
                    : "Base file"}
                </span>
                <span className="ei-pill ei-pill--ghost">
                  {file.visibility}
                </span>

                {tagging ? (
                  <span className={`ei-pill ei-pill--${tagging.tone}`}>
                    {tagging.label}
                  </span>
                ) : null}
                {revisions.length > 0 && (
                  <span className="ei-pill ei-pill--ghost">
                    {revisions.length} revisions
                  </span>
                )}
              </div>
            </div>
            <div className="ei-toolbar">
              <button
                type="button"
                className="ei-toolbar__btn"
                onClick={() =>
                  window.open(apiUrl(`/api/files/${file.id}/preview`), "_blank")
                }
                title="Open current file preview"
              >
                Open preview
              </button>

              {sourceUrl ? (
                <>
                  <button
                    type="button"
                    className="ei-toolbar__btn"
                    onClick={() => window.open(sourceUrl, "_blank", "noopener")}
                    title="Open source URL"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open source
                  </button>

                  <button
                    type="button"
                    className="ei-toolbar__btn"
                    onClick={() => copyToClipboard(sourceUrl)}
                    title="Copy source URL"
                  >
                    <Copy className="w-4 h-4" />
                    Copy URL
                  </button>
                </>
              ) : null}

              <button
                type="button"
                className="ei-toolbar__btn ei-toolbar__btn--primary"
                onClick={() => useRevisionInNotebook(file.id)}
                title="Use this evidence in Notebook"
              >
                Use in notebook
              </button>
            </div>
            <div className="ei-summary-grid">
              <div className="ei-summary-card">
                <span className="ei-summary-card__label">Integrity</span>
                <strong className="ei-summary-card__value">
                  {integrity?.label ?? "—"}
                </strong>
                <small className="ei-summary-card__meta">
                  {integrity?.meta ?? "—"}
                </small>
              </div>

              <div className="ei-summary-card">
                <span className="ei-summary-card__label">Captured by</span>
                <strong className="ei-summary-card__value">{actorLabel}</strong>
                <small className="ei-summary-card__meta">
                  {formatDateTime(
                    file.captureEvent?.createdAt ?? file.uploadDate,
                  )}
                </small>
              </div>

              <div className="ei-summary-card">
                <span className="ei-summary-card__label">Pipeline</span>
                <strong className="ei-summary-card__value">
                  {pipelineLabel}
                </strong>
                <small className="ei-summary-card__meta">
                  {file.captureEvent?.pipelineConfig?.configHash
                    ? shortHash(file.captureEvent.pipelineConfig.configHash)
                    : "No config hash"}
                </small>
              </div>

              <div className="ei-summary-card">
                <span className="ei-summary-card__label">Published</span>
                <strong className="ei-summary-card__value">
                  {file.sourcePublishedAt
                    ? formatDateTime(file.sourcePublishedAt)
                    : "Unknown"}
                </strong>
                <small className="ei-summary-card__meta">{sourceHost}</small>
              </div>
            </div>

            <div className="ei-summary-card">
              <span className="ei-summary-card__label">AI tagging</span>
              <strong className="ei-summary-card__value">
                {tagging?.label ?? "—"}
              </strong>
              <small className="ei-summary-card__meta">
                {tagging?.meta ?? "—"}
              </small>
            </div>

            <div className="ei-card">
              <div className="ei-card__head">
                <div className="ei-card__title">Chain of custody</div>
                <div className="ei-card__meta">Timeline-first provenance</div>
              </div>

              <div className="ei-timeline">
                {timelineItems.map((item) => (
                  <div key={item.id} className="ei-timeline__item">
                    <div
                      className={`ei-timeline__dot ei-timeline__dot--${item.tone}`}
                    />
                    <div className="ei-timeline__body">
                      <div className="ei-timeline__titleRow">
                        <div className="ei-timeline__title">{item.title}</div>
                        <div className="ei-timeline__time">
                          {formatDateTime(item.time)}
                        </div>
                      </div>
                      <div className="ei-timeline__detail">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <StructuredTags
              structured={
                (file as any)?.tagsMetaRaw?.tagger?.structured ??
                (file as any)?.tagsMetaRaw?.aiTagger?.structured ??
                null
              }
            />
            <div className="ei-card">
              <div className="ei-card__head">
                <div className="ei-card__title">Source intelligence</div>
                <div className="ei-card__meta">
                  Origin and publication context
                </div>
              </div>

              <div className="divide-y divide-[hsl(var(--border))]">
                <Row label="Domain" value={sourceHost} />
                <Row
                  label="Source URL"
                  value={file.sourceUrl ?? file.captureEvent?.sourceUrl ?? "—"}
                />
                <Row
                  label="Published"
                  value={formatDateTime(file.sourcePublishedAt)}
                />
                <Row label="Authors" value={authorsLabel} />
                <Row
                  label="URL ID"
                  value={file.urlId != null ? String(file.urlId) : "—"}
                />
              </div>
            </div>
            <div className="ei-card">
              <div className="ei-card__head">
                <div className="ei-card__title">Raw provenance</div>
                <div className="ei-card__meta">
                  Traceability and audit fields
                </div>
              </div>

              <div className="divide-y divide-[hsl(var(--border))]">
                <Row label="File ID" value={file.id} mono />
                <Row label="SHA-256" value={file.sha256 ?? "—"} mono />
                <Row
                  label="Content hash"
                  value={file.contentHash ?? "—"}
                  mono
                />
                <Row label="Capture type" value={file.captureType ?? "—"} />
                <Row
                  label="Capture method"
                  value={file.captureMeta?.method ?? "—"}
                />
                <Row
                  label="Captured URL"
                  value={file.captureMeta?.capturedUrl ?? "—"}
                />
                <Row label="Tagger version" value={file.taggerVersion ?? "—"} />
                <Row
                  label="Tagging status"
                  value={file.taggingStatus ?? "NONE"}
                />
                <Row
                  label="Tagging job"
                  value={file.taggingJobId ?? "—"}
                  mono
                />
                <Row label="Tagging error" value={file.taggingError ?? "—"} />
                <Row label="Actor" value={actorLabel} />
                <Row
                  label="Request ID"
                  value={file.captureEvent?.requestId ?? "—"}
                  mono
                />
                <Row label="Pipeline" value={pipelineLabel} />
              </div>
            </div>
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
        </div>
      )}
    </aside>
  );
}
