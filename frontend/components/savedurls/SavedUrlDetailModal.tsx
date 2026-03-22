import React, { useEffect, useState } from "react";
import { SavedUrl } from "../../lib/types";
import { createPortal } from "react-dom";
import { formatDate } from "../../utils/fileHelpers";
import CloseIcon from "../icons/CloseIcon";
import AITagButton from "../common/AITagButton";
import {
  getUrlSnapshots,
  getUrlRevisions,
  getUrlById,
  refreshUrlMetadata,
  getFileExtractedText,
  crawlSaveText,
  crawlSavePdf,
  apiUrl,
  type BackendDocumentRevision,
} from "../../lib/api";
import { useToast } from "../providers/Toast";
import DiffViewer from "../common/DiffViewer";
import RevisionHistoryPanel from "../common/RevisionHistoryPanel";
import EvidenceOverviewPanel from "../common/EvidenceOverviewPanel";

interface SavedUrlDetailModalProps {
  url: SavedUrl;
  isOpen: boolean;
  onClose: () => void;
  onFavoriteToggle: (url: SavedUrl) => void;
  onTagUpdate?: (urlId: string, newTags: string[]) => void;
  onNotesChange?: (urlId: string, notes: string) => void;
  onUrlHydrate?: (fresh: any) => void;
}

function isPdfUrlLike(raw: string): boolean {
  try {
    const u = new URL(raw);
    const path = (u.pathname || "").toLowerCase();
    const q = (u.search || "").toLowerCase();
    return path.endsWith(".pdf") || q.includes(".pdf");
  } catch {
    const s = (raw || "").toLowerCase();
    return s.includes(".pdf");
  }
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

function getUrlSourceHost(saved: SavedUrl) {
  if (saved.domain) return saved.domain.replace(/^www\./, "");
  try {
    return new URL(saved.url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown source";
  }
}

function getUrlTaggingSummary(saved: SavedUrl): {
  tone: "green" | "blue" | "slate";
  label: string;
  meta: string;
} {
  const status = saved.taggingStatus ?? "NONE";

  if (status === "SUCCESS") {
    return {
      tone: "green",
      label: "AI tags ready",
      meta: saved.taggerVersion
        ? `Tagger ${saved.taggerVersion}`
        : `${saved.tags.length} labels on record`,
    };
  }

  if (status === "RUNNING") {
    return {
      tone: "blue",
      label: "AI tagging running",
      meta: "Background extraction in progress",
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
      meta: saved.taggingError || "Retry tagging from this record",
    };
  }

  return {
    tone: "slate",
    label: "AI tags not started",
    meta: "No background tag job recorded",
  };
}

function getUrlIntegritySummary(
  saved: SavedUrl,
  revisions: BackendDocumentRevision[],
): {
  tone: "green" | "blue" | "slate";
  label: string;
  meta: string;
} {
  const latestRevision = revisions[0];

  if (latestRevision?.storedFile?.sha256) {
    return {
      tone: "green",
      label: "Artifact SHA-256",
      meta: shortHash(latestRevision.storedFile.sha256),
    };
  }

  if (saved.latestSnapshot?.sha256) {
    return {
      tone: "blue",
      label: "Snapshot SHA-256",
      meta: shortHash(saved.latestSnapshot.sha256),
    };
  }

  if (saved.contentHash) {
    return {
      tone: "blue",
      label: "Normalized content SHA-256",
      meta: shortHash(saved.contentHash),
    };
  }

  return {
    tone: "slate",
    label: "Hash pending",
    meta: "No snapshot or content hash recorded",
  };
}

const SavedUrlDetailModal: React.FC<SavedUrlDetailModalProps> = ({
  url,
  isOpen,
  onClose,
  onFavoriteToggle,
  onTagUpdate,
  onNotesChange,
  onUrlHydrate,
}) => {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);

  const [revisions, setRevisions] = useState<BackendDocumentRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);

  const [leftSnapId, setLeftSnapId] = useState<string>("");
  const [rightSnapId, setRightSnapId] = useState<string>("");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [leftPayload, setLeftPayload] = useState<{
    fileName: string;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [rightPayload, setRightPayload] = useState<{
    fileName: string;
    text: string;
    truncated: boolean;
  } | null>(null);

  // Local state for tags and new tag input
  const [localTags, setLocalTags] = useState<string[]>(url.tags);
  const [newTagInput, setNewTagInput] = useState<string>("");

  // Sync localTags when url changes
  useEffect(() => {
    setLocalTags(url.tags);
  }, [url.tags]);

  const { notify } = useToast();

  const [metaRefreshing, setMetaRefreshing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(
    (url as any).publishedAt ?? null,
  );
  const [publishedAtMeta, setPublishedAtMeta] = useState<any | null>(
    (url as any)?.tagsMetaRaw?.publishedAtMeta ??
      (url as any)?.tagsMeta?.publishedAtMeta ??
      null,
  );
  const [authors, setAuthors] = useState<string[]>(
    Array.isArray((url as any).authors) ? (url as any).authors : [],
  );

  useEffect(() => {
    setPublishedAt((url as any).publishedAt ?? null);
    setPublishedAtMeta(
      (url as any)?.tagsMetaRaw?.publishedAtMeta ??
        (url as any)?.tagsMeta?.publishedAtMeta ??
        null,
    );
    setAuthors(Array.isArray((url as any).authors) ? (url as any).authors : []);
  }, [url.id]);

  const [recaptureMode, setRecaptureMode] = useState<"text" | "pdf">("text");
  const [recaptureLoading, setRecaptureLoading] = useState(false);

  const isPdf = isPdfUrlLike(url.url);

  useEffect(() => {
    if (isPdf) setRecaptureMode("pdf");
  }, [url.url]);

  // Reusable reloaders (so we can refresh after re-capture)
  const refreshSnapshots = async () => {
    try {
      setSnapshotsLoading(true);
      setSnapshotsError(null);
      const rows = await getUrlSnapshots(Number(url.id), 50);
      setSnapshots(rows);
      return rows;
    } catch (e: any) {
      setSnapshotsError(e?.message ?? "Failed to load snapshots");
      return [];
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const refreshRevisions = async () => {
    try {
      setRevisionsLoading(true);
      setRevisionsError(null);
      const out = await getUrlRevisions(Number(url.id), 50);
      const next = out.revisions || [];
      setRevisions(next);
      return next;
    } catch (e: any) {
      setRevisionsError(e?.message ?? "Failed to load revision history");
      return [];
    } finally {
      setRevisionsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, url.id]);

  useEffect(() => {
    if (!isOpen) return;
    refreshRevisions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, url.id]);

  async function runCompare(aId = leftSnapId, bId = rightSnapId) {
    if (!aId || !bId) return;

    try {
      setCompareLoading(true);
      setCompareError(null);

      const [L, R] = await Promise.all([
        getFileExtractedText(aId, 200000),
        getFileExtractedText(bId, 200000),
      ]);

      setLeftPayload({
        fileName: L.fileName,
        text: L.text,
        truncated: L.truncated,
      });
      setRightPayload({
        fileName: R.fileName,
        text: R.text,
        truncated: R.truncated,
      });
    } catch (e: any) {
      setCompareError(
        e?.response?.data?.message ?? e?.message ?? "Compare failed",
      );
    } finally {
      setCompareLoading(false);
    }
  }

  // Re-capture live URL into a new canonical revision
  async function recaptureNow() {
    try {
      setRecaptureLoading(true);

      if (recaptureMode === "pdf") {
        await crawlSavePdf(
          url.url,
          undefined,
          undefined,
          false, // fullPage
          true, // reader mode
          Number(url.id),
        );
      } else {
        // "text" mode is already PDF-aware on the backend.
        await crawlSaveText(url.url, undefined, undefined, Number(url.id));
      }

      notify({ text: "Re-captured. New revision created.", kind: "success" });

      // Reload + auto-compare newest vs previous (best UX for amendments)
      const nextRevs = await refreshRevisions();
      await refreshSnapshots();

      const newestId = nextRevs[0]?.storedFile?.id ?? null;
      const prevId = nextRevs[1]?.storedFile?.id ?? null;

      if (newestId && prevId) {
        setLeftSnapId(prevId);
        setRightSnapId(newestId);
        await runCompare(prevId, newestId);
      }
    } catch (e: any) {
      notify({
        text: e?.response?.data?.message ?? e?.message ?? "Re-capture failed",
        kind: "error",
      });
    } finally {
      setRecaptureLoading(false);
    }
  }

  // Use any revision inside Notebook (handoff)
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

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Handlers for adding/removing tags
  const addTag = () => {
    const trimmed = newTagInput.trim();
    if (trimmed && !localTags.includes(trimmed)) {
      const updated = [...localTags, trimmed];
      setLocalTags(updated);
      onTagUpdate?.(url.id, updated);
    }
    setNewTagInput("");
  };

  const removeTag = (tag: string) => {
    const updated = localTags.filter((t) => t !== tag);
    setLocalTags(updated);
    onTagUpdate?.(url.id, updated);
  };

  const sourceHost = getUrlSourceHost(url);
  const latestRevision = revisions[0] ?? null;
  const latestSnapshot = snapshots[0] ?? url.latestSnapshot ?? null;
  const notebookFileId =
    latestRevision?.storedFile?.id ?? latestSnapshot?.id ?? null;

  const integrity = getUrlIntegritySummary(url, revisions);
  const tagging = getUrlTaggingSummary(url);

  const evidencePills: Array<{
    label: string;
    tone: "green" | "blue" | "violet" | "slate" | "ghost";
  }> = [
    { label: integrity.label, tone: integrity.tone },
    { label: url.visibility, tone: "ghost" },
    { label: tagging.label, tone: tagging.tone },
  ];

  if (latestRevision) {
    evidencePills.push({
      label: `Revision R${latestRevision.ordinal}`,
      tone: "ghost",
    });
  }

  if (latestSnapshot?.captureType) {
    evidencePills.push({
      label: latestSnapshot.captureType,
      tone: "ghost",
    });
  }

  const evidenceSummaryCards = [
    {
      label: "Integrity",
      value: integrity.label,
      meta: integrity.meta,
    },
    {
      label: "Published",
      value: publishedAt ? formatDateTime(publishedAt) : "Unknown",
      meta:
        publishedAtMeta?.source && publishedAtMeta.source !== "unknown"
          ? `Source: ${publishedAtMeta.source}`
          : sourceHost,
    },
    {
      label: "Latest capture",
      value: latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : "None",
      meta: latestSnapshot?.fileName ?? "No stored snapshot yet",
    },
    {
      label: "Registry state",
      value: url.visibility,
      meta: `Saved ${formatDateTime(url.createdAt)}`,
    },
  ];

  const evidenceAiCard = {
    label: "AI tagging",
    value: tagging.label,
    meta: tagging.meta,
  };

  const evidenceTimeline = [
    {
      id: "saved",
      title: "Source saved to registry",
      time: url.createdAt,
      detail: `${sourceHost} • ${url.visibility}`,
      tone: "blue" as const,
    },
    ...(publishedAt
      ? [
          {
            id: "published",
            title: "Published date detected",
            time: publishedAt,
            detail: authors.length
              ? authors.join(", ")
              : "Author data unavailable",
            tone: "slate" as const,
          },
        ]
      : []),
    ...(latestSnapshot
      ? [
          {
            id: "snapshot",
            title: `${latestSnapshot.captureType} snapshot available`,
            time: latestSnapshot.createdAt,
            detail: latestSnapshot.fileName ?? "Stored evidence snapshot",
            tone: "violet" as const,
          },
        ]
      : []),
    ...(latestRevision
      ? [
          {
            id: "revision",
            title: `Canonical revision R${latestRevision.ordinal}`,
            time: latestRevision.createdAt,
            detail: latestRevision.captureType,
            tone: "green" as const,
          },
        ]
      : []),
    {
      id: "updated",
      title: "Registry record updated",
      time: url.updatedAt,
      detail: tagging.meta,
      tone: "slate" as const,
    },
  ];

  const evidenceStructured =
    (url as any)?.tagsMetaRaw?.tagger?.structured ??
    (url as any)?.tagsMetaRaw?.aiTagger?.structured ??
    null;

  const evidenceIntelligenceRows = [
    { label: "Domain", value: sourceHost },
    { label: "Source URL", value: url.url },
    {
      label: "Published",
      value: publishedAt ? formatDateTime(publishedAt) : "—",
    },
    {
      label: "Authors",
      value: authors.length ? authors.join(", ") : "—",
    },
    {
      label: "Collections",
      value: url.collections.length ? url.collections.join(", ") : "—",
    },
    {
      label: "Latest snapshot",
      value: latestSnapshot?.captureType ?? "—",
    },
  ];

  const evidenceProvenanceRows = [
    { label: "URL ID", value: url.id, mono: true },
    { label: "Content hash", value: url.contentHash ?? "—", mono: true },
    {
      label: "Latest artifact hash",
      value:
        latestRevision?.storedFile?.sha256 ?? url.latestSnapshot?.sha256 ?? "—",
      mono: true,
    },
    {
      label: "Latest snapshot ID",
      value: latestSnapshot?.id ?? "—",
      mono: true,
    },
    {
      label: "Tagger version",
      value: url.taggerVersion ?? "—",
    },
    {
      label: "Tagging status",
      value: url.taggingStatus ?? "NONE",
    },
    {
      label: "Tagging error",
      value: url.taggingError ?? "—",
    },
    {
      label: "Updated at",
      value: formatDateTime(url.updatedAt),
    },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-4">
      <div className="relative max-w-7xl w-full bg-white dark:bg-gray-900 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{url.title}</h2>
            <div className="text-sm text-gray-500 truncate">{url.domain}</div>
          </div>
          <button onClick={onClose} aria-label="Close">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left: Main details */}
          <div className="xl:col-span-2 space-y-4 min-w-0">
            {/* URL & Favorite */}
            <div className="flex justify-between items-start">
              <div className="flex gap-4">
                {url.faviconUrl && (
                  <img
                    src={url.faviconUrl}
                    alt="favicon"
                    className="w-8 h-8 rounded-sm"
                  />
                )}
                <div>
                  <div className="text-sm text-gray-500">URL</div>
                  <a
                    href={url.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline break-all"
                  >
                    {url.url}
                  </a>
                </div>
              </div>
              <button
                onClick={() => onFavoriteToggle(url)}
                className="px-3 py-2 border rounded flex items-center gap-1"
              >
                {url.isFavorited ? "Unfavorite" : "Favorite"}
              </button>
            </div>

            {/* Notes */}
            <div>
              <div className="text-sm text-gray-500">Description / Notes</div>
              <textarea
                defaultValue={url.notes}
                onBlur={(e) => onNotesChange?.(url.id, e.target.value)}
                className="w-full border rounded p-2 min-h-[120px]"
              />
            </div>

            {/* Tags - Editable */}
            <div>
              <div className="text-sm text-gray-500">Tags</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {localTags.map((t) => (
                  <div
                    key={t}
                    className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-100 rounded-full"
                  >
                    <span>{t}</span>
                    <button
                      onClick={() => removeTag(t)}
                      aria-label={`Remove tag ${t}`}
                      className="text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    placeholder="Add tag"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    className="px-2 py-1 border rounded text-xs"
                  />
                  <button
                    onClick={addTag}
                    className="px-2 py-1 border rounded text-xs"
                  >
                    Add
                  </button>
                  <AITagButton
                    kind="url"
                    id={Number(url.id)} // SavedUrl.id is string in UI; backend expects number
                    onMerge={(aiTags) => {
                      const merged = Array.from(
                        new Set([...(url.tags || []), ...aiTags]),
                      );
                      setLocalTags(merged);
                      onTagUpdate?.(url.id, merged); // persists via your page handler
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div>
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-500">Metadata</div>
                <button
                  type="button"
                  className="px-2 py-1 border rounded text-xs disabled:opacity-50"
                  disabled={metaRefreshing}
                  onClick={async () => {
                    try {
                      setMetaRefreshing(true);
                      await refreshUrlMetadata(Number(url.id));
                      const fresh = await getUrlById(Number(url.id));
                      onUrlHydrate?.(fresh);
                      setPublishedAt((fresh as any).publishedAt ?? null);
                      setPublishedAtMeta(
                        (fresh as any)?.tagsMetaRaw?.publishedAtMeta ??
                          (fresh as any)?.tagsMeta?.publishedAtMeta ??
                          null,
                      );
                      setAuthors(
                        Array.isArray((fresh as any).authors)
                          ? (fresh as any).authors
                          : [],
                      );
                      notify("Metadata refreshed");
                    } catch (e: any) {
                      notify(e?.message || "Failed to refresh metadata");
                    } finally {
                      setMetaRefreshing(false);
                    }
                  }}
                  title="Re-fetch published date and author(s) from the live page"
                >
                  {metaRefreshing ? "Refreshing…" : "Refresh metadata"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs mt-1">
                <div>
                  <strong>Created:</strong> {formatDate(url.createdAt)}
                </div>
                <div>
                  <strong>Last visited:</strong>{" "}
                  {url.lastVisitedAt ? formatDate(url.lastVisitedAt) : "—"}
                </div>
                <div>
                  <strong>Visits:</strong> {url.visitCount}
                </div>
                <div>
                  <strong>Visibility:</strong> {url.visibility}
                </div>
                <div>
                  <strong>Published:</strong>{" "}
                  <span className="inline-flex items-center gap-2">
                    <span>{publishedAt ? formatDate(publishedAt) : "—"}</span>

                    {publishedAt &&
                      publishedAtMeta?.source &&
                      publishedAtMeta.source !== "unknown" &&
                      publishedAtMeta.source !== "jsonld" && (
                        <span
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-gray-50"
                          title={`Inferred from: ${publishedAtMeta.source}\nConfidence: ${Math.round(
                            (publishedAtMeta.confidence ?? 0) * 100,
                          )}%`}
                        >
                          Inferred
                        </span>
                      )}
                  </span>
                </div>
                <div>
                  <strong>Authors:</strong>{" "}
                  {authors.length ? authors.join(", ") : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Unified evidence inspector + revision tools */}
          <div className="space-y-4 xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto xl:pr-1">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/80 shadow-sm backdrop-blur p-4">
              <EvidenceOverviewPanel
                eyebrow="Source evidence"
                title={url.title}
                subtitle={`${sourceHost} • registry entry`}
                pills={evidencePills}
                actions={[
                  {
                    label: "Open source",
                    onClick: () => {
                      window.open(url.url, "_blank", "noopener,noreferrer");
                    },
                    title: "Open source URL",
                  },
                  {
                    label: "Copy URL",
                    onClick: async () => {
                      try {
                        await navigator.clipboard.writeText(url.url);
                        notify({ text: "Source URL copied", kind: "success" });
                      } catch {
                        notify({ text: "Copy failed", kind: "error" });
                      }
                    },
                    title: "Copy source URL",
                  },
                  ...(notebookFileId
                    ? [
                        {
                          label: "Use in notebook",
                          onClick: () => useRevisionInNotebook(notebookFileId),
                          primary: true,
                          title: "Use latest evidence revision in Notebook",
                        },
                      ]
                    : []),
                ]}
                summaryCards={evidenceSummaryCards}
                aiCard={evidenceAiCard}
                timelineItems={evidenceTimeline}
                structured={evidenceStructured}
                intelligenceRows={evidenceIntelligenceRows}
                provenanceRows={evidenceProvenanceRows}
              />
            </div>

            {/* Re-capture (creates a new canonical revision) */}
            <div className="border rounded-xl p-3 bg-white">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-sm">Re-capture</div>

                <select
                  className="border rounded-lg px-2 py-1 text-xs"
                  value={recaptureMode}
                  onChange={(e) =>
                    setRecaptureMode(e.target.value as "text" | "pdf")
                  }
                  disabled={recaptureLoading || isPdf}
                >
                  <option value="text" disabled={isPdf}>
                    Text
                  </option>
                  <option value="pdf">PDF</option>
                </select>
              </div>

              <div className="text-xs text-gray-500 mt-1">
                Creates a new revision from the current live URL. Use this when
                a news article is updated or a judgment gets amended.
              </div>

              <button
                className="mt-2 w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
                onClick={recaptureNow}
                disabled={recaptureLoading}
                type="button"
              >
                {recaptureLoading ? "Re-capturing…" : "Re-capture now"}
              </button>
            </div>

            <div>
              {revisionsLoading ? (
                <div className="text-sm text-gray-500">
                  Loading revision history…
                </div>
              ) : revisionsError ? (
                <div className="text-sm text-red-600">{revisionsError}</div>
              ) : (
                <RevisionHistoryPanel
                  revisions={revisions}
                  onOpen={(storedFileId) =>
                    window.open(
                      apiUrl(`/api/files/${storedFileId}/preview`),
                      "_blank",
                    )
                  }
                  onSetA={(storedFileId) => setLeftSnapId(storedFileId)}
                  onSetB={(storedFileId) => setRightSnapId(storedFileId)}
                  currentA={leftSnapId}
                  currentB={rightSnapId}
                  onCompareWithPrev={async (currentId, prevId) => {
                    setLeftSnapId(prevId);
                    setRightSnapId(currentId);
                    await runCompare(prevId, currentId);
                  }}
                  onUseInNotebook={(storedFileId) =>
                    useRevisionInNotebook(storedFileId)
                  }
                />
              )}
            </div>

            <div>
              <div className="font-semibold mb-2">Snapshots</div>
              {snapshotsLoading && (
                <div className="text-sm text-gray-500">Loading…</div>
              )}

              {snapshotsError && (
                <div className="text-sm text-red-600">{snapshotsError}</div>
              )}

              {!snapshotsLoading &&
                !snapshotsError &&
                snapshots.length === 0 && (
                  <div className="text-sm text-gray-500">No snapshots yet.</div>
                )}

              <div className="space-y-2">
                {snapshots.map((s) => (
                  <div
                    key={s.id}
                    className="border rounded-lg p-2 text-sm flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.fileName}</div>
                      <div className="text-xs text-gray-500">
                        {s.captureType} • {formatDate(s.createdAt)}
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <button
                        className="px-2 py-1 border rounded text-xs"
                        onClick={() =>
                          window.open(
                            apiUrl(`/api/files/${s.id}/preview`),
                            "_blank",
                          )
                        }
                        title="Open preview"
                      >
                        Open
                      </button>
                      <button
                        className="px-2 py-1 border rounded text-xs"
                        onClick={() =>
                          window.open(
                            apiUrl(`/api/files/${s.id}/download`),
                            "_blank",
                          )
                        }
                        title="Download"
                      >
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <div className="font-semibold text-sm">Compare snapshots</div>

              <div className="grid grid-cols-1 gap-2">
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={leftSnapId}
                  onChange={(e) => setLeftSnapId(e.target.value)}
                >
                  <option value="">Select snapshot A…</option>
                  {snapshots.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.captureType} • {formatDate(s.createdAt)}
                    </option>
                  ))}
                </select>

                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={rightSnapId}
                  onChange={(e) => setRightSnapId(e.target.value)}
                >
                  <option value="">Select snapshot B…</option>
                  {snapshots.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.captureType} • {formatDate(s.createdAt)}
                    </option>
                  ))}
                </select>

                <button
                  className="mt-2 w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
                  onClick={() => runCompare()}
                  disabled={!leftSnapId || !rightSnapId || compareLoading}
                  type="button"
                >
                  {compareLoading ? "Comparing…" : "Compare"}
                </button>

                {compareError && (
                  <div className="text-sm text-red-600">{compareError}</div>
                )}
              </div>

              {leftPayload && rightPayload && (
                <DiffViewer
                  leftTitle={
                    leftPayload.fileName +
                    (leftPayload.truncated ? " (truncated)" : "")
                  }
                  rightTitle={
                    rightPayload.fileName +
                    (rightPayload.truncated ? " (truncated)" : "")
                  }
                  leftText={leftPayload.text}
                  rightText={rightPayload.text}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-md">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SavedUrlDetailModal;
