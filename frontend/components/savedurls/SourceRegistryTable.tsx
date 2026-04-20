import React, { useEffect, useMemo, useRef } from "react";
import type { SavedUrl } from "../../lib/types";
import { recordUrlVisit } from "../../lib/api";
import { formatDate } from "../../utils/fileHelpers";
import { BookmarkIcon } from "../icons";

type Props = {
  rows: SavedUrl[];
  selection: Set<string>;
  allPageRowsSelected: boolean;
  onToggleSelect: (id: string) => void;
  onSelectAllPage: () => void;
  onClearSelection: () => void;
  onOpenDetail: (url: SavedUrl) => void;
  onFavoriteToggle: (url: SavedUrl) => void;
  onCapture?: (url: SavedUrl, mode: "text" | "pdf") => void;
};

const SNAPSHOT_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getFreshnessMeta(url: SavedUrl) {
  const snap = (url as any).latestSnapshot;
  if (!snap?.createdAt) {
    return {
      label: "Missing",
      cls: "chip chip-amber",
      title: "No snapshot captured yet",
    };
  }

  const ageMs = Date.now() - new Date(snap.createdAt).getTime();
  const ageDays = Math.floor(ageMs / DAY_MS);

  if (ageMs > SNAPSHOT_STALE_DAYS * DAY_MS) {
    return {
      label: `Stale (${ageDays}d)`,
      cls: "chip chip-rose",
      title: `Snapshot is older than ${SNAPSHOT_STALE_DAYS} days`,
    };
  }

  return {
    label: `Fresh (${ageDays}d)`,
    cls: "chip chip-emerald",
    title: "Snapshot is recent",
  };
}

function getAiMeta(url: SavedUrl) {
  const s = (url as any).taggingStatus as string | undefined;

  if (!s || s === "NONE") {
    return { label: "Not tagged", cls: "chip chip-gray" };
  }
  if (s === "SUCCESS") {
    return { label: "Tagged", cls: "chip chip-emerald" };
  }
  if (s === "PENDING") {
    return { label: "Queued", cls: "chip chip-slate" };
  }
  if (s === "RUNNING") {
    return { label: "Running", cls: "chip chip-sky" };
  }
  if (s === "FAILED") {
    return {
      label: "Failed",
      cls: "chip chip-red",
      title: (url as any).taggingError || "AI tagging failed",
    };
  }

  return { label: s, cls: "chip chip-gray" };
}

function getSnapshotMeta(url: SavedUrl) {
  const snap = (url as any).latestSnapshot;
  if (!snap?.createdAt) return null;

  const kind =
    snap.captureType === "URL_PDF"
      ? "PDF"
      : snap.captureType === "URL_TEXT"
        ? "Text"
        : "Upload";

  return {
    label: kind,
    title: snap.fileName || kind,
    createdAt: snap.createdAt,
  };
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

function stopPropagation(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function trackSavedUrlVisit(urlId: string) {
  const numericId = Number(urlId);
  if (!Number.isFinite(numericId)) return;
  void recordUrlVisit(numericId).catch(() => {});
}

const SourceRegistryTable: React.FC<Props> = ({
  rows,
  selection,
  allPageRowsSelected,
  onToggleSelect,
  onSelectAllPage,
  onClearSelection,
  onOpenDetail,
  onFavoriteToggle,
  onCapture,
}) => {
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const someVisibleSelected = useMemo(
    () => rows.some((r) => selection.has(r.id)),
    [rows, selection],
  );

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate =
      someVisibleSelected && !allPageRowsSelected;
  }, [someVisibleSelected, allPageRowsSelected]);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/10 bg-white/90 dark:bg-neutral-950/70 shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-900/90 border-b border-black/5 dark:border-white/10">
            <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              <th className="px-4 py-3 w-12">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={allPageRowsSelected && rows.length > 0}
                  onChange={() =>
                    allPageRowsSelected ? onClearSelection() : onSelectAllPage()
                  }
                  aria-label="Select all rows on the current page"
                  className="h-4 w-4"
                />
              </th>
              <th className="px-4 py-3 min-w-[320px]">Source</th>
              <th className="px-4 py-3 min-w-[160px]">Domain</th>
              <th className="px-4 py-3 min-w-[120px]">Published</th>
              <th className="px-4 py-3 min-w-[140px]">Last capture</th>
              <th className="px-4 py-3 min-w-[120px]">Freshness</th>
              <th className="px-4 py-3 min-w-[200px]">Tags</th>
              <th className="px-4 py-3 min-w-[110px]">AI status</th>
              <th className="px-4 py-3 min-w-[240px] text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((url) => {
              const snapshot = getSnapshotMeta(url);
              const freshness = getFreshnessMeta(url);
              const ai = getAiMeta(url);
              const isSelected = selection.has(url.id);
              const isPdf = isPdfUrlLike(url.url);

              return (
                <tr
                  key={url.id}
                  onClick={() => onOpenDetail(url)}
                  className={[
                    "border-b border-black/5 dark:border-white/5 transition-colors cursor-pointer",
                    "hover:bg-neutral-50 dark:hover:bg-neutral-900/60",
                    isSelected
                      ? "bg-brand-primary/5 dark:bg-brand-primary/10"
                      : "",
                  ].join(" ")}
                >
                  <td className="px-4 py-4 align-top" onClick={stopPropagation}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(url.id)}
                      aria-label={`Select ${url.title}`}
                      className="mt-1 h-4 w-4"
                    />
                  </td>

                  <td className="px-4 py-4 align-top">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-start gap-3">
                        {url.faviconUrl ? (
                          <img
                            src={url.faviconUrl}
                            alt=""
                            className="mt-0.5 h-4 w-4 rounded-sm shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="mt-0.5 h-4 w-4 rounded-sm bg-neutral-200 dark:bg-neutral-700 shrink-0" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-neutral-950 dark:text-neutral-100 line-clamp-2">
                                {url.title || url.url}
                              </div>

                              <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                {url.url}
                              </div>

                              {url.description ? (
                                <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 line-clamp-2">
                                  {url.description}
                                </div>
                              ) : null}
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                stopPropagation(e);
                                onFavoriteToggle(url);
                              }}
                              className="shrink-0 rounded-lg border border-black/10 bg-white p-2 transition hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                              title={
                                url.isFavorited
                                  ? "Remove favorite"
                                  : "Add favorite"
                              }
                              aria-label={
                                url.isFavorited
                                  ? "Remove favorite"
                                  : "Add favorite"
                              }
                            >
                              <BookmarkIcon
                                className={[
                                  "h-4 w-4",
                                  url.isFavorited
                                    ? "text-yellow-400"
                                    : "text-neutral-400 dark:text-neutral-500",
                                ].join(" ")}
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-4 align-top">
                    <div className="font-medium text-neutral-800 dark:text-neutral-200 break-all">
                      {url.domain || "—"}
                    </div>
                  </td>

                  <td className="px-4 py-4 align-top text-neutral-700 dark:text-neutral-300">
                    {url.publishedAt ? formatDate(url.publishedAt) : "—"}
                  </td>

                  <td className="px-4 py-4 align-top">
                    {snapshot ? (
                      <div className="space-y-1">
                        <span
                          className="chip chip-violet"
                          title={snapshot.title}
                        >
                          {snapshot.label}
                        </span>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {formatDate(snapshot.createdAt)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-500">
                        —
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-4 align-top">
                    <span className={freshness.cls} title={freshness.title}>
                      {freshness.label}
                    </span>
                  </td>

                  <td className="px-4 py-4 align-top">
                    {url.tags?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {url.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="chip chip-gray">
                            {tag}
                          </span>
                        ))}
                        {url.tags.length > 3 ? (
                          <span className="chip chip-slate">
                            +{url.tags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-neutral-400 dark:text-neutral-500">
                        —
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-4 align-top">
                    <span className={ai.cls} title={(ai as any).title}>
                      {ai.label}
                    </span>
                  </td>

                  <td
                    className="px-4 py-4 align-top text-right"
                    onClick={stopPropagation}
                  >
                    <div className="ml-auto grid w-[220px] grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => onCapture?.(url, "text")}
                        disabled={!onCapture || isPdf}
                        title={
                          isPdf
                            ? "Text capture is disabled for PDF links"
                            : "Capture as text"
                        }
                        className={[
                          "rounded-lg px-3 py-2 text-xs font-medium transition",
                          "bg-violet-50 text-violet-700 hover:bg-violet-100",
                          "dark:bg-violet-900/30 dark:text-violet-200 dark:hover:bg-violet-800/40",
                          !onCapture || isPdf
                            ? "cursor-not-allowed opacity-50"
                            : "",
                        ].join(" ")}
                      >
                        Text
                      </button>

                      <button
                        type="button"
                        onClick={() => onCapture?.(url, "pdf")}
                        disabled={!onCapture}
                        title={
                          isPdf
                            ? "Download original PDF"
                            : "Capture as PDF snapshot"
                        }
                        className={[
                          "rounded-lg px-3 py-2 text-xs font-medium transition",
                          "bg-rose-50 text-rose-700 hover:bg-rose-100",
                          "dark:bg-rose-900/30 dark:text-rose-200 dark:hover:bg-rose-800/40",
                          !onCapture ? "cursor-not-allowed opacity-50" : "",
                        ].join(" ")}
                      >
                        PDF
                      </button>

                      <button
                        type="button"
                        className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:bg-slate-900/30 dark:text-slate-200 dark:hover:bg-slate-800/40"
                        onClick={() => onOpenDetail(url)}
                        title="Open source details"
                      >
                        Inspect
                      </button>

                      <a
                        href={url.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => trackSavedUrlVisit(url.id)}
                        className="rounded-lg bg-brand-primary px-3 py-2 text-center text-xs font-medium text-white transition hover:opacity-95"
                        title="Open source in a new tab"
                      >
                        Open
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SourceRegistryTable;
