import React, { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { openGovernanceWorkspace } from "../../lib/governanceWorkspace";
import { openNotebookWithPendingSource } from "../../lib/notebookLaunch";
import { useToast } from "../providers/Toast";
import DiffViewer from "../common/DiffViewer";
import RevisionHistoryPanel from "../common/RevisionHistoryPanel";
import EvidenceOverviewPanel from "../common/EvidenceOverviewPanel";
import { useDialogA11y } from "../common/useDialogA11y";

interface SavedUrlDetailModalProps {
  url: SavedUrl;
  isOpen: boolean;
  onClose: () => void;
  onFavoriteToggle: (url: SavedUrl) => void;
  onTagUpdate?: (urlId: string, newTags: string[]) => void;
  onNotesChange?: (urlId: string, notes: string) => void;
  onUrlHydrate?: (fresh: any) => void | Promise<void>;
  collectionNamesById?: Record<string, string>;
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

function evidencePillClass(
  tone: "green" | "blue" | "violet" | "slate" | "ghost",
) {
  switch (tone) {
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300";
    case "violet":
      return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300";
    case "slate":
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300";
    default:
      return "border-black/10 bg-white text-neutral-700 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-300";
  }
}

const SavedUrlDetailModal: React.FC<SavedUrlDetailModalProps> = ({
  url,
  isOpen,
  onClose,
  onFavoriteToggle,
  onTagUpdate,
  onNotesChange,
  onUrlHydrate,
  collectionNamesById = {},
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogTitleId = useId();

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

  useDialogA11y({
    isOpen,
    onClose,
    dialogRef,
    initialFocusRef: closeButtonRef,
  });

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

  const openGovernanceView = async () => {
    try {
      const out = await getUrlRevisions(Number(url.id), 1);
      const documentId = out.documentId ?? null;

      if (!documentId) {
        notify({
          text: "No canonical document revision is available for this URL yet.",
          kind: "error",
        });
        return;
      }

      openGovernanceWorkspace({
        anchorDocumentIds: [documentId],
        anchorUrlIds: [Number(url.id)],
        title: url.title,
        sourceLabel: url.url,
        sourceScope: "mixed",
        origin: "saved-urls",
      });
    } catch (e: any) {
      notify({
        text: e?.message ?? "Failed to open governance workspace",
        kind: "error",
      });
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
    openNotebookWithPendingSource({ kind: "FILE", id: storedFileId });
  }

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
  const readableCollections = useMemo(
    () =>
      (url.collections || [])
        .map(
          (collectionId) => collectionNamesById[collectionId] || collectionId,
        )
        .filter(Boolean),
    [url.collections, collectionNamesById],
  );
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
    {
      label: "Source URL",
      value: (
        <a
          href={url.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline break-all dark:text-blue-400"
        >
          {url.url}
        </a>
      ),
    },
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
      value: readableCollections.length ? readableCollections.join(", ") : "—",
    },
    {
      label: "Latest snapshot",
      value: latestSnapshot?.captureType ?? "—",
    },
  ];

  const copySourceUrl = async () => {
    try {
      await navigator.clipboard.writeText(url.url);
      notify({ text: "Source URL copied.", kind: "success" });
    } catch {
      notify({ text: "Failed to copy the source URL.", kind: "error" });
    }
  };

  const visibleTaggingError =
    url.taggingStatus === "FAILED"
      ? url.taggingError || "Retry tagging from this record."
      : null;

  const modalHeaderPills = useMemo(
    () =>
      evidencePills.map((pill, idx) => (
        <span
          key={`${pill.label}-${idx}`}
          className={[
            "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
            evidencePillClass(pill.tone),
          ].join(" ")}
        >
          {pill.label}
        </span>
      )),
    [evidencePills],
  );

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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 backdrop-blur-[2px]">
      <div className="flex min-h-full items-start justify-center p-4 md:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          className="relative flex w-full max-w-7xl max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900"
        >
          {/* Header */}
          <div className="sticky top-0 z-20 border-b border-black/10 bg-white/95 px-5 py-4 backdrop-blur dark:border-white/10 dark:bg-gray-900/95 md:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                  {url.faviconUrl ? (
                    <img
                      src={url.faviconUrl}
                      alt=""
                      className="mt-1 h-8 w-8 shrink-0 rounded-sm"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="mt-1 h-8 w-8 shrink-0 rounded-sm bg-neutral-200 dark:bg-neutral-800" />
                  )}

                  <div className="min-w-0 flex-1">
                    <h2
                      id={dialogTitleId}
                      className="text-lg font-semibold text-neutral-950 dark:text-neutral-100 md:text-xl"
                    >
                      {url.title}
                    </h2>

                    <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 break-words">
                      {sourceHost} • saved {formatDateTime(url.createdAt)}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {modalHeaderPills}
                    </div>
                  </div>
                </div>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close saved URL details"
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <span className="inline-flex items-center gap-2">
                  <CloseIcon className="h-4 w-4" />
                  Close
                </span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-3 md:p-6">
              {/* Left: editable / operator area */}
              <div className="min-w-0 space-y-4 xl:col-span-2">
                {/* Source URL + main actions */}
                <section className="rounded-2xl border border-black/10 bg-neutral-50/80 p-4 dark:border-white/10 dark:bg-neutral-950/40">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Source URL
                      </div>

                      <a
                        href={url.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 block break-all rounded-xl border border-black/10 bg-white px-3 py-3 text-sm text-blue-700 underline dark:border-white/10 dark:bg-neutral-900 dark:text-blue-400"
                      >
                        {url.url}
                      </a>

                      <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                        Open the live source, copy the exact URL, or route the
                        canonical evidence into governance/notebook workflows.
                      </div>
                    </div>

                    <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[18rem]">
                      <button
                        type="button"
                        onClick={() =>
                          window.open(url.url, "_blank", "noopener,noreferrer")
                        }
                        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        Open source
                      </button>

                      <button
                        type="button"
                        onClick={copySourceUrl}
                        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        Copy URL
                      </button>

                      <button
                        type="button"
                        onClick={openGovernanceView}
                        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        Open governance
                      </button>

                      <button
                        type="button"
                        onClick={() => onFavoriteToggle(url)}
                        className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        {url.isFavorited ? "Remove favorite" : "Add favorite"}
                      </button>

                      {notebookFileId && (
                        <button
                          type="button"
                          onClick={() => useRevisionInNotebook(notebookFileId)}
                          className="sm:col-span-2 rounded-xl bg-brand-primary px-3 py-2 text-sm font-medium text-white transition hover:opacity-95"
                        >
                          Use latest evidence in notebook
                        </button>
                      )}
                    </div>
                  </div>
                </section>

                {/* Notes */}
                <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Notes
                      </div>
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        These notes stay attached to this saved URL record.
                      </div>
                    </div>
                  </div>

                  <textarea
                    defaultValue={url.notes}
                    onBlur={(e) => onNotesChange?.(url.id, e.target.value)}
                    className="mt-3 min-h-[140px] w-full rounded-xl border border-black/10 bg-white p-3 text-sm outline-none transition focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 dark:border-white/10 dark:bg-neutral-900"
                    placeholder="Add context, review notes, follow-up tasks, or why this source matters."
                  />
                </section>

                {/* Tags */}
                <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/20">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Tags
                      </div>
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {localTags.length === 0
                          ? "No tags yet."
                          : `${localTags.length} tag${localTags.length === 1 ? "" : "s"} attached to this source.`}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <AITagButton
                        kind="url"
                        id={Number(url.id)}
                        onMerge={(aiTags) => {
                          const merged = Array.from(
                            new Set([...(url.tags || []), ...aiTags]),
                          );
                          setLocalTags(merged);
                          onTagUpdate?.(url.id, merged);
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {localTags.map((t) => (
                      <div
                        key={t}
                        className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300"
                      >
                        <span className="break-all">{t}</span>
                        <button
                          type="button"
                          onClick={() => removeTag(t)}
                          aria-label={`Remove tag ${t}`}
                          className="rounded-full px-1 text-[11px] font-semibold hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      placeholder="Add a tag"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10 dark:border-white/10 dark:bg-neutral-900"
                    />

                    <button
                      type="button"
                      onClick={addTag}
                      className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                    >
                      Add tag
                    </button>
                  </div>

                  {visibleTaggingError && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                      {visibleTaggingError}
                    </div>
                  )}
                </section>

                {/* Metadata */}
                <section className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/20">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Metadata
                      </div>
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        Publication and registry metadata for this saved source.
                      </div>
                    </div>

                    <button
                      type="button"
                      className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium transition hover:bg-neutral-50 disabled:opacity-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                      disabled={metaRefreshing}
                      onClick={async () => {
                        try {
                          setMetaRefreshing(true);
                          await refreshUrlMetadata(Number(url.id));
                          const fresh = await getUrlById(Number(url.id));
                          await onUrlHydrate?.(fresh);
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
                          notify({
                            text: "Metadata refreshed.",
                            kind: "success",
                          });
                        } catch (e: any) {
                          notify({
                            text: e?.message || "Failed to refresh metadata.",
                            kind: "error",
                          });
                        } finally {
                          setMetaRefreshing(false);
                        }
                      }}
                      title="Re-fetch published date and authors from the live page"
                    >
                      {metaRefreshing ? "Refreshing…" : "Refresh metadata"}
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-xl border border-black/10 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-neutral-900">
                      <div className="text-xs uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Created
                      </div>
                      <div className="mt-1 break-words text-neutral-900 dark:text-neutral-100">
                        {formatDate(url.createdAt)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-neutral-900">
                      <div className="text-xs uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Last visited
                      </div>
                      <div className="mt-1 break-words text-neutral-900 dark:text-neutral-100">
                        {url.lastVisitedAt
                          ? formatDate(url.lastVisitedAt)
                          : "—"}
                      </div>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-neutral-900">
                      <div className="text-xs uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Visit count
                      </div>
                      <div className="mt-1 text-neutral-900 dark:text-neutral-100">
                        {url.visitCount}
                      </div>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-neutral-900">
                      <div className="text-xs uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Visibility
                      </div>
                      <div className="mt-1 text-neutral-900 dark:text-neutral-100">
                        {url.visibility}
                      </div>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-neutral-900">
                      <div className="text-xs uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Published
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-neutral-900 dark:text-neutral-100">
                        <span>
                          {publishedAt ? formatDate(publishedAt) : "—"}
                        </span>

                        {publishedAt &&
                          publishedAtMeta?.source &&
                          publishedAtMeta.source !== "unknown" &&
                          publishedAtMeta.source !== "jsonld" && (
                            <span
                              className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-white dark:bg-neutral-950"
                              title={`Inferred from: ${publishedAtMeta.source}\nConfidence: ${Math.round(
                                (publishedAtMeta.confidence ?? 0) * 100,
                              )}%`}
                            >
                              Inferred
                            </span>
                          )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-neutral-50 px-3 py-3 dark:border-white/10 dark:bg-neutral-900">
                      <div className="text-xs uppercase tracking-[0.08em] text-neutral-500 dark:text-neutral-400">
                        Authors
                      </div>
                      <div className="mt-1 break-words text-neutral-900 dark:text-neutral-100">
                        {authors.length ? authors.join(", ") : "—"}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* Right: evidence and revision tools */}
              <div className="space-y-4 xl:max-h-[calc(100vh-14rem)] xl:overflow-y-auto xl:pr-1">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-white/80 p-4 shadow-sm backdrop-blur dark:bg-neutral-950/20">
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
                        onClick: copySourceUrl,
                        title: "Copy source URL",
                      },
                      ...(notebookFileId
                        ? [
                            {
                              label: "Use in notebook",
                              onClick: () =>
                                useRevisionInNotebook(notebookFileId),
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

                <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        Re-capture
                      </div>
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        Create a new revision from the current live URL.
                      </div>
                    </div>

                    <select
                      className="rounded-lg border border-black/10 px-2 py-1 text-xs dark:border-white/10 dark:bg-neutral-900"
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

                  <button
                    className="mt-3 w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/10"
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

                <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/20">
                  <div className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Snapshots
                  </div>

                  {snapshotsLoading && (
                    <div className="text-sm text-gray-500">Loading…</div>
                  )}

                  {snapshotsError && (
                    <div className="text-sm text-red-600">{snapshotsError}</div>
                  )}

                  {!snapshotsLoading &&
                    !snapshotsError &&
                    snapshots.length === 0 && (
                      <div className="text-sm text-gray-500">
                        No snapshots yet.
                      </div>
                    )}

                  <div className="space-y-2">
                    {snapshots.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10"
                      >
                        <div className="min-w-0">
                          <div className="break-words font-medium">
                            {s.fileName}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {s.captureType} • {formatDate(s.createdAt)}
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-2">
                          <button
                            className="rounded-lg border border-black/10 px-2 py-1 text-xs dark:border-white/10"
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
                            className="rounded-lg border border-black/10 px-2 py-1 text-xs dark:border-white/10"
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

                <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-950/20">
                  <div className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Compare snapshots
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <select
                      className="rounded-lg border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900"
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
                      className="rounded-lg border border-black/10 px-2 py-2 text-sm dark:border-white/10 dark:bg-neutral-900"
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
                      className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm font-medium disabled:opacity-50 dark:border-white/10"
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
                    <div className="mt-4">
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
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 bg-white/95 px-5 py-3 backdrop-blur dark:border-white/10 dark:bg-gray-900/95 md:px-6">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              Review source details, update notes/tags, and manage evidence
              snapshots from one place.
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  window.open(url.url, "_blank", "noopener,noreferrer")
                }
                className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Open source
              </button>

              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SavedUrlDetailModal;
