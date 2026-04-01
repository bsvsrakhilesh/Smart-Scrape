import React, { useEffect, useState } from "react";
import { ExternalLink, Copy, Info } from "lucide-react";
import type { FileItem } from "../../lib/types";
import { formatBytes } from "../../utils/fileHelpers";
import {
  getFileRevisions,
  type BackendDocumentRevision,
  apiUrl,
} from "../../lib/api";
import { openGovernanceWorkspace } from "../../lib/governanceWorkspace";
import { useToast } from "../providers/Toast";
import RevisionHistoryPanel from "../common/RevisionHistoryPanel";
import EvidenceOverviewPanel from "../common/EvidenceOverviewPanel";

type Props = {
  file: FileItem | null;
};

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
      label: "Artifact SHA-256",
      meta: shortHash(file.sha256),
    };
  }

  if (file.contentHash) {
    return {
      tone: "blue",
      label: "Normalized content SHA-256",
      meta: shortHash(file.contentHash),
    };
  }

  return {
    tone: "slate",
    label: "Hash pending",
    meta: "No artifact or content hash recorded",
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

  const { notify } = useToast();

  const openGovernance = React.useCallback(async () => {
    if (!file) return;

    try {
      const resolvedDocumentId =
        file.document?.id ??
        (await getFileRevisions(file.id, 1)).document?.id ??
        null;

      if (!resolvedDocumentId) {
        notify({
          text: "No canonical document id is available for this file yet.",
          kind: "error",
        });
        return;
      }

      openGovernanceWorkspace({
        documentId: resolvedDocumentId,
        title: file.title,
        sourceLabel: file.sourceUrl ?? file.captureEvent?.sourceUrl ?? null,
        origin: "file-manager",
      });
    } catch (e: any) {
      notify({
        text: e?.message ?? "Failed to open governance workspace",
        kind: "error",
      });
    }
  }, [file, notify]);

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

  const evidencePills: Array<{
    label: string;
    tone: "green" | "blue" | "violet" | "slate" | "ghost";
  }> = [];

  if (integrity) {
    evidencePills.push({ label: integrity.label, tone: integrity.tone });
  }

  if (file) {
    evidencePills.push({
      label: file.documentRevision?.ordinal
        ? `Revision R${file.documentRevision.ordinal}`
        : "Base file",
      tone: "ghost",
    });
    evidencePills.push({ label: file.visibility, tone: "ghost" });
  }

  if (tagging) {
    evidencePills.push({ label: tagging.label, tone: tagging.tone });
  }

  if (revisions.length > 0) {
    evidencePills.push({
      label: `${revisions.length} revisions`,
      tone: "ghost",
    });
  }

  const evidenceSummaryCards = file
    ? [
        {
          label: "Integrity",
          value: integrity?.label ?? "—",
          meta: integrity?.meta ?? "—",
        },
        {
          label: "Captured by",
          value: actorLabel,
          meta: formatDateTime(file.captureEvent?.createdAt ?? file.uploadDate),
        },
        {
          label: "Pipeline",
          value: pipelineLabel,
          meta: file.captureEvent?.pipelineConfig?.configHash
            ? shortHash(file.captureEvent.pipelineConfig.configHash)
            : "No config hash",
        },
        {
          label: "Published",
          value: file.sourcePublishedAt
            ? formatDateTime(file.sourcePublishedAt)
            : "Unknown",
          meta: sourceHost,
        },
      ]
    : [];

  const evidenceAiCard = tagging
    ? {
        label: "AI tagging",
        value: tagging.label,
        meta: tagging.meta,
      }
    : null;

  const evidenceStructured =
    (file as any)?.tagsMetaRaw?.tagger?.structured ??
    (file as any)?.tagsMetaRaw?.aiTagger?.structured ??
    null;

  const evidenceIntelligenceRows = file
    ? [
        { label: "Domain", value: sourceHost },
        {
          label: "Source URL",
          value: file.sourceUrl ?? file.captureEvent?.sourceUrl ?? "—",
        },
        {
          label: "Published",
          value: formatDateTime(file.sourcePublishedAt),
        },
        {
          label: "Authors",
          value: authorsLabel,
        },
        {
          label: "URL ID",
          value: file.urlId != null ? String(file.urlId) : "—",
        },
      ]
    : [];

  const evidenceProvenanceRows = file
    ? [
        { label: "File ID", value: file.id, mono: true },
        { label: "SHA-256", value: file.sha256 ?? "—", mono: true },
        {
          label: "Normalized content SHA-256",
          value: file.contentHash ?? "—",
          mono: true,
        },
        { label: "Capture type", value: file.captureType ?? "—" },
        { label: "Capture method", value: file.captureMeta?.method ?? "—" },
        {
          label: "Captured URL",
          value: file.captureMeta?.capturedUrl ?? "—",
        },
        { label: "Tagger version", value: file.taggerVersion ?? "—" },
        { label: "Tagging status", value: file.taggingStatus ?? "NONE" },
        { label: "Tagging job", value: file.taggingJobId ?? "—", mono: true },
        { label: "Tagging error", value: file.taggingError ?? "—" },
        { label: "Actor", value: actorLabel },
        {
          label: "Request ID",
          value: file.captureEvent?.requestId ?? "—",
          mono: true,
        },
        { label: "Pipeline", value: pipelineLabel },
      ]
    : [];

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
          <EvidenceOverviewPanel
            eyebrow="Selected evidence"
            title={file.title}
            subtitle={`${sourceHost} • ${file.captureType ?? "UPLOAD"} • ${file.mimeType}`}
            pills={evidencePills}
            actions={[
              {
                label: "Open preview",
                onClick: () => {
                  window.open(
                    apiUrl(`/api/files/${file.id}/preview`),
                    "_blank",
                  );
                },
                title: "Open current file preview",
              },
              ...(sourceUrl
                ? [
                    {
                      label: "Open source",
                      onClick: () => {
                        window.open(sourceUrl, "_blank", "noopener");
                      },
                      icon: <ExternalLink className="w-4 h-4" />,
                      title: "Open source URL",
                    },
                    {
                      label: "Copy URL",
                      onClick: () => copyToClipboard(sourceUrl),
                      icon: <Copy className="w-4 h-4" />,
                      title: "Copy source URL",
                    },
                  ]
                : []),
              {
                label: "Open governance",
                onClick: openGovernance,
                title: "Open Governance Workspace for this evidence",
              },
              {
                label: "Use in notebook",
                onClick: () => useRevisionInNotebook(file.id),
                primary: true,
                title: "Use this evidence in Notebook",
              },
            ]}
            summaryCards={evidenceSummaryCards}
            aiCard={evidenceAiCard}
            timelineItems={timelineItems}
            structured={evidenceStructured}
            intelligenceRows={evidenceIntelligenceRows}
            provenanceRows={evidenceProvenanceRows}
          />

          <div className="mt-4">
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
